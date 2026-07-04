#!/usr/bin/env python3
import csv, io, os, sys, time, urllib.request
import psycopg2
import psycopg2.extras

YEAR=int(os.environ.get('GAOKAO_IMPORT_YEAR','2025'))
BASE='https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M/resolve/main/data'
PROVINCES=['anhui','beijing','chongqing','fujian','gansu','guangdong','guangxi','guizhou','hainan','hebei','heilongjiang','henan','hubei','hunan','jiangsu','jiangxi','jilin','liaoning','neimenggu','ningxia','qinghai','shaanxi','shandong','shanghai','shanxi','sichuan','tianjin','xinjiang','xizang','yunnan','zhejiang']
EXCLUDE=('专科','高职','艺术','体育','提前','专项','单招','征集','预科')
INCLUDE=('本科','一段','普通类','平行录取','常规批','特殊类型')

def fetch(slug,fname):
    url=f'{BASE}/{YEAR}/{slug}/{fname}'
    raw=urllib.request.urlopen(url,timeout=90).read().decode('utf-8-sig')
    return url,list(csv.DictReader(io.StringIO(raw)))
def to_int(v):
    v=(v or '').strip()
    if not v: return 0
    try: return int(float(v))
    except Exception: return 0
def keep(row,rank=True):
    text=(row.get('batch','') or '')+(row.get('category','') or '')
    if any(k in text for k in EXCLUDE): return False
    if not any(k in text for k in INCLUDE) and not any(k in text for k in ('物理','历史','理科','文科','综合')): return False
    if rank and (to_int(row.get('min_score'))<=0 or to_int(row.get('min_rank'))<=0): return False
    return True
def scode(row,slug):
    c=(row.get('university_code') or '').strip()
    return c or f"gc-{slug}-{(row.get('university_name') or '').strip().replace(' ','')}"
def mcode(row,slug):
    c=(row.get('major_code') or '').strip(); n=(row.get('major_name') or '').strip().replace(' ','')
    return f"{scode(row,slug)}-{c or n}"
def gkey(row,slug):
    g=(row.get('major_group') or '').strip()
    if g: return g[:512]
    return f"{scode(row,slug)}-{row.get('batch','')}-{row.get('category','')}-{row.get('major_code','')}-{row.get('major_name','')}"[:512]
def level(row):
    out=[]
    if str(row.get('is_985','')).strip() in ('1','true','True'): out.append('985')
    if str(row.get('is_211','')).strip() in ('1','true','True'): out.append('211')
    return ' / '.join(out) or '普通本科'
def infer_cat(name):
    for k,c in [('计算机','计算机类'),('软件','计算机类'),('数据','计算机类'),('人工智能','计算机类'),('电子','电子信息类'),('通信','电子信息类'),('自动化','自动化类'),('电气','电气类'),('医学','医学类'),('临床','医学类'),('会计','工商管理类'),('金融','金融学类'),('法学','法学类')]:
        if k in name: return c
    return '专业类'

def load_maps(cur):
    cur.execute('select id,code from gaokao_schools'); schools={c:i for i,c in cur.fetchall()}
    cur.execute('select id,code from gaokao_majors'); majors={c:i for i,c in cur.fetchall()}
    return schools,majors

def insert_missing_schools(cur, schools, rows):
    vals=[]; seen=set()
    for slug,row in rows:
        c=scode(row,slug)
        if c in schools or c in seen: continue
        seen.add(c); vals.append((c,(row.get('university_name') or '').strip(),(row.get('school_province') or '').strip(),'',level(row),(row.get('school_nature') or '').strip() or '未知','GaokaoCompass'))
    if not vals: return 0
    ret=psycopg2.extras.execute_values(cur,"insert into gaokao_schools (code,name,province,city,level,ownership,tags,created_at,updated_at) values %s returning id,code",[(c,n,p,city,l,o,t) for c,n,p,city,l,o,t in vals],template="(%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())",fetch=True,page_size=1000)
    schools.update({c:i for i,c in ret}); return len(vals)

def insert_missing_majors(cur, majors, rows):
    vals=[]; seen=set()
    for slug,row in rows:
        c=mcode(row,slug); name=(row.get('major_name') or '').strip() or '未命名专业'
        if c in majors or c in seen: continue
        seen.add(c); vals.append((c,name[:512],infer_cat(name),'中','',''))
    if not vals: return 0
    ret=psycopg2.extras.execute_values(cur,"insert into gaokao_majors (code,name,category,heat,employment,postgrad,created_at,updated_at) values %s returning id,code",vals,template="(%s,%s,%s,%s,%s,%s,NOW(),NOW())",fetch=True,page_size=2000)
    majors.update({c:i for i,c in ret}); return len(vals)

def main():
    db=os.environ.get('DATABASE_URL')
    if not db: print('DATABASE_URL missing',file=sys.stderr); return 2
    conn=psycopg2.connect(db); conn.autocommit=False
    report=[]; totals={'major_rows':0,'major_inserted':0,'plan_rows':0,'plan_updates':0,'schools_new':0,'majors_new':0}
    with conn:
      with conn.cursor() as cur:
        # Clear previous imported professional records for deterministic re-import.
        cur.execute("delete from gaokao_admission_records where year=%s and source like 'GaokaoCompass-11M major %%'",(YEAR,))
        print('deleted_major_records',cur.rowcount,flush=True)
        schools,majors=load_maps(cur)
        for slug in PROVINCES:
            try:
                major_url,raw=fetch(slug,'major-admission.csv')
            except Exception as e:
                print('WARN major fetch failed',slug,e,file=sys.stderr,flush=True); report.append([slug,0,0,0,0,0,'major_fetch_failed']); continue
            rows=[(slug,r) for r in raw if keep(r,True)]
            totals['major_rows']+=len(rows)
            sn=insert_missing_schools(cur,schools,rows); mn=insert_missing_majors(cur,majors,rows)
            vals=[]
            for _,r in rows:
                vals.append((YEAR,(r.get('province') or '').strip(),(r.get('batch') or '').strip(),(r.get('category') or '').strip(),schools[scode(r,slug)],majors[mcode(r,slug)],gkey(r,slug),(r.get('subject_req') or '').strip()[:512],to_int(r.get('min_score')),to_int(r.get('min_rank')),to_int(r.get('avg_score')),0,to_int(r.get('admit_count')),0,(r.get('major_note') or '').strip(),f'GaokaoCompass-11M major {major_url}'))
            if vals:
                psycopg2.extras.execute_values(cur,"""insert into gaokao_admission_records (year,source_province,batch,subject_type,school_id,major_id,major_group,subject_requirement,min_score,min_rank,avg_score,avg_rank,plan_count,tuition,campus,source,created_at,updated_at) values %s""", vals, template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())", page_size=5000)
            # Plan update, batch execute by exact mapped IDs/group. Faster enough after rows inserted.
            plan_updates=0; plan_count=0
            if os.environ.get('GAOKAO_IMPORT_PLANS','1')=='1':
                try:
                    plan_url,plans=fetch(slug,'enrollment-plan.csv')
                except Exception as e:
                    print('WARN plan fetch failed',slug,e,file=sys.stderr,flush=True); plans=[]
                updates=[]
                for r in plans:
                    if not keep(r,False): continue
                    sc=scode(r,slug); mc=mcode(r,slug)
                    if sc not in schools or mc not in majors: continue
                    updates.append((to_int(r.get('plan_count')),to_int(r.get('tuition')),(r.get('subject_req') or '').strip()[:512],f'GaokaoCompass-11M plan {plan_url}',YEAR,(r.get('province') or '').strip(),schools[sc],majors[mc],gkey(r,slug)))
                plan_count=len(updates)
                if updates:
                    psycopg2.extras.execute_batch(cur,"""update gaokao_admission_records set plan_count=case when %s>0 then %s else plan_count end, tuition=case when %s>0 then %s else tuition end, subject_requirement=case when %s<>'' then %s else subject_requirement end, source=source || ' | plan: ' || %s, updated_at=now() where year=%s and source_province=%s and school_id=%s and major_id=%s and major_group=%s""",[(pc,pc,tu,tu,sr,sr,src,yr,sp,sid,mid,grp) for pc,tu,sr,src,yr,sp,sid,mid,grp in updates],page_size=2000)
                    plan_updates=cur.rowcount if cur.rowcount and cur.rowcount>0 else 0
            conn.commit()
            totals['major_inserted']+=len(vals); totals['plan_rows']+=plan_count; totals['plan_updates']+=plan_updates; totals['schools_new']+=sn; totals['majors_new']+=mn
            print(f'{slug}: major={len(vals)} schools_new={sn} majors_new={mn} plan_rows={plan_count} plan_updates={plan_updates}',flush=True)
            report.append([slug,len(raw),len(vals),sn,mn,plan_count,plan_updates,'ok'])
            time.sleep(.1)
    print('TOTAL',totals,flush=True)
    with open('/tmp/gaokao_compass_major_plan_fast_report.csv','w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['province_slug','major_downloaded','major_inserted','schools_new','majors_new','plan_rows','plan_updates','status']); w.writerows(report)
    return 0
if __name__=='__main__': raise SystemExit(main())
