#!/usr/bin/env python3
import csv, io, os, urllib.request, time
import psycopg2, psycopg2.extras

YEAR=int(os.environ.get('GAOKAO_IMPORT_YEAR','2025'))
BASE='https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M/resolve/main/data'
PROVINCES=['anhui','beijing','chongqing','fujian','gansu','guangdong','guangxi','guizhou','hainan','hebei','heilongjiang','henan','hubei','hunan','jiangsu','jiangxi','jilin','liaoning','neimenggu','ningxia','qinghai','shaanxi','shandong','shanghai','shanxi','sichuan','tianjin','xinjiang','xizang','yunnan','zhejiang']
EXCLUDE=('专科','高职','艺术','体育','提前','专项','单招','征集','预科')
INCLUDE=('本科','一段','普通类','平行录取','常规批','特殊类型')

def fetch(slug):
    url=f'{BASE}/{YEAR}/{slug}/enrollment-plan.csv'
    raw=urllib.request.urlopen(url,timeout=90).read().decode('utf-8-sig')
    return url,list(csv.DictReader(io.StringIO(raw)))
def to_int(v):
    v=(v or '').strip()
    if not v: return 0
    try: return int(float(v))
    except Exception: return 0
def keep(r):
    text=(r.get('batch','') or '')+(r.get('category','') or '')
    if any(k in text for k in EXCLUDE): return False
    return any(k in text for k in INCLUDE) or any(k in text for k in ('物理','历史','理科','文科','综合'))
def scode(r,slug):
    c=(r.get('university_code') or '').strip()
    return c or f"gc-{slug}-{(r.get('university_name') or '').strip().replace(' ','')}"
def mcode(r,slug):
    c=(r.get('major_code') or '').strip(); n=(r.get('major_name') or '').strip().replace(' ','')
    return f"{scode(r,slug)}-{c or n}"
def gkey(r,slug):
    g=(r.get('major_group') or '').strip()
    if g: return g[:512]
    return f"{scode(r,slug)}-{r.get('batch','')}-{r.get('category','')}-{r.get('major_code','')}-{r.get('major_name','')}"[:512]
def infer_cat(name):
    for k,c in [('计算机','计算机类'),('软件','计算机类'),('数据','计算机类'),('人工智能','计算机类'),('电子','电子信息类'),('通信','电子信息类'),('自动化','自动化类'),('电气','电气类'),('医学','医学类'),('临床','医学类'),('会计','工商管理类'),('金融','金融学类'),('法学','法学类')]:
        if k in name: return c
    return '专业类'
def load_maps(cur):
    cur.execute('select id,code from gaokao_schools'); schools={c:i for i,c in cur.fetchall()}
    cur.execute('select id,code from gaokao_majors'); majors={c:i for i,c in cur.fetchall()}
    return schools,majors
def ensure_majors(cur, majors, rows):
    vals=[]; seen=set()
    for slug,r in rows:
        c=mcode(r,slug); name=(r.get('major_name') or '').strip() or '未命名专业'
        if c in majors or c in seen: continue
        seen.add(c); vals.append((c,name[:512],infer_cat(name),'中','',''))
    if not vals: return 0
    ret=psycopg2.extras.execute_values(cur,"insert into gaokao_majors (code,name,category,heat,employment,postgrad,created_at,updated_at) values %s returning id,code",vals,template='(%s,%s,%s,%s,%s,%s,NOW(),NOW())',fetch=True,page_size=2000)
    majors.update({c:i for i,c in ret}); return len(vals)

def main():
    db=os.environ.get('DATABASE_URL')
    if not db: raise SystemExit('DATABASE_URL missing')
    conn=psycopg2.connect(db); conn.autocommit=False
    totals={'downloaded':0,'kept':0,'inserted':0,'majors_new':0,'provinces':0}
    report=[]
    with conn:
      with conn.cursor() as cur:
        cur.execute('delete from gaokao_enrollment_plans where year=%s and source like %s',(YEAR,'GaokaoCompass-11M plan %'))
        print('deleted_plans',cur.rowcount,flush=True)
        schools,majors=load_maps(cur)
        for slug in PROVINCES:
            try: url,raw=fetch(slug)
            except Exception as e:
                print('WARN fetch failed',slug,e,flush=True); report.append([slug,0,0,0,'fetch_failed']); continue
            rows=[(slug,r) for r in raw if keep(r)]
            mn=ensure_majors(cur,majors,rows)
            vals=[]; skipped=0
            for _,r in rows:
                sc=scode(r,slug); mc=mcode(r,slug)
                if sc not in schools: skipped+=1; continue
                vals.append((YEAR,(r.get('province') or '').strip(),(r.get('batch') or '').strip()[:128],(r.get('category') or '').strip()[:64],schools[sc],majors[mc],gkey(r,slug),(r.get('major_name') or '').strip()[:512],(r.get('major_code') or '').strip()[:128],(r.get('subject_req') or '').strip()[:512],to_int(r.get('plan_count')),(r.get('duration') or '').strip()[:64],to_int(r.get('tuition')),(r.get('major_note') or '').strip(),f'GaokaoCompass-11M plan {url}'))
            if vals:
                psycopg2.extras.execute_values(cur,"""insert into gaokao_enrollment_plans (year,source_province,batch,subject_type,school_id,major_id,major_group,major_name_raw,major_code_raw,subject_requirement,plan_count,duration,tuition,major_note,source,created_at,updated_at) values %s""",vals,template='(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())',page_size=5000)
            conn.commit()
            totals['downloaded']+=len(raw); totals['kept']+=len(rows); totals['inserted']+=len(vals); totals['majors_new']+=mn; totals['provinces']+=1
            print(f'{slug}: downloaded={len(raw)} kept={len(rows)} inserted={len(vals)} skipped_no_school={skipped} majors_new={mn}',flush=True)
            report.append([slug,len(raw),len(rows),len(vals),'ok'])
            time.sleep(.1)
    print('TOTAL',totals,flush=True)
    with open('/tmp/gaokao_enrollment_plan_import_report.csv','w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['province_slug','downloaded','kept','inserted','status']); w.writerows(report)
if __name__=='__main__': main()
