#!/usr/bin/env python3
import csv, io, os, re, urllib.request
import psycopg2

YEAR = int(os.environ.get('GAOKAO_REPAIR_YEAR', '2025'))
BASE = 'https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M/resolve/main/data'
PROVINCES = ['anhui','beijing','chongqing','fujian','gansu','guangdong','guangxi','guizhou','hainan','hebei','heilongjiang','henan','hubei','hunan','jiangsu','jiangxi','jilin','liaoning','neimenggu','ningxia','qinghai','shaanxi','shandong','shanghai','shanxi','sichuan','tianjin','xinjiang','xizang','yunnan','zhejiang']
MUNICIPALITIES = {'北京','上海','天津','重庆'}
CITY_HINTS = ['广州','深圳','珠海','汕头','佛山','东莞','惠州','中山','江门','湛江','茂名','肇庆','梅州','汕尾','河源','阳江','清远','潮州','揭阳','云浮','韶关',
'杭州','宁波','温州','嘉兴','湖州','绍兴','金华','衢州','舟山','台州','丽水','南京','苏州','无锡','常州','南通','扬州','镇江','徐州','盐城','泰州','宿迁','淮安','连云港',
'武汉','长沙','成都','西安','郑州','济南','青岛','烟台','潍坊','临沂','合肥','芜湖','南昌','福州','厦门','泉州','南宁','桂林','贵阳','昆明','太原','沈阳','大连','长春','哈尔滨','兰州','银川','乌鲁木齐','呼和浩特','石家庄','保定','秦皇岛','唐山']
PROVINCE_TO_CAPITAL = {'广东':'广州','浙江':'杭州','江苏':'南京','山东':'济南','河南':'郑州','湖北':'武汉','湖南':'长沙','四川':'成都','陕西':'西安','安徽':'合肥','江西':'南昌','福建':'福州','广西':'南宁','贵州':'贵阳','云南':'昆明','山西':'太原','辽宁':'沈阳','吉林':'长春','黑龙江':'哈尔滨','甘肃':'兰州','宁夏':'银川','新疆':'乌鲁木齐','内蒙古':'呼和浩特','河北':'石家庄','青海':'西宁','海南':'海口','西藏':'拉萨'}

def scode(row, slug):
    code=(row.get('university_code') or '').strip()
    return code or f"gc-{slug}-{(row.get('university_name') or '').strip().replace(' ','')}"

def fetch(slug, fname):
    url=f'{BASE}/{YEAR}/{slug}/{fname}'
    raw=urllib.request.urlopen(url, timeout=60).read().decode('utf-8-sig')
    return list(csv.DictReader(io.StringIO(raw)))

def infer_city(name, province):
    for city in CITY_HINTS:
        if city in name:
            return city
    for m in MUNICIPALITIES:
        if m in name or province == m:
            return m
    # Province-name universities are commonly in the capital, but not always. Use only for common naming patterns.
    if province in PROVINCE_TO_CAPITAL and (name.startswith(province) or name.startswith(PROVINCE_TO_CAPITAL[province])):
        return PROVINCE_TO_CAPITAL[province]
    return ''

def level_from(row, old=''):
    parts=[]
    if str(row.get('is_985','')).strip() in ('1','true','True'): parts.append('985')
    if str(row.get('is_211','')).strip() in ('1','true','True'): parts.append('211')
    return ' / '.join(parts) or old or '普通本科'

def main():
    db=os.environ.get('DATABASE_URL')
    if not db:
        raise SystemExit('DATABASE_URL missing')
    conn=psycopg2.connect(db); cur=conn.cursor()
    updates=0; seen={}
    for slug in PROVINCES:
        for fname in ('school-admission.csv','major-admission.csv','enrollment-plan.csv'):
            try: rows=fetch(slug,fname)
            except Exception: continue
            for r in rows:
                code=scode(r,slug); name=(r.get('university_name') or '').strip()
                if not code or not name: continue
                province=(r.get('school_province') or '').strip()
                ownership=(r.get('school_nature') or '').strip()
                lvl=level_from(r)
                key=code
                if key in seen:
                    old=seen[key]
                    province=province or old[1]; ownership=ownership or old[2]; lvl=lvl or old[3]
                seen[key]=(name,province,ownership,lvl)
    for code,(name,province,ownership,lvl) in seen.items():
        city=infer_city(name, province)
        cur.execute('''update gaokao_schools set
            name = case when %s <> '' then %s else name end,
            province = case when %s <> '' then %s else province end,
            ownership = case when %s <> '' then %s when ownership='未知' then ownership else ownership end,
            level = case when %s <> '' and %s <> '普通本科' then %s else level end,
            city = case when (city is null or city='') and %s <> '' then %s else city end,
            updated_at=now()
            where code=%s''', (name,name,province,province,ownership,ownership,lvl,lvl,lvl,city,city,code))
        updates += cur.rowcount
    conn.commit()
    print('metadata_candidates', len(seen))
    print('schools_updated', updates)
    cur.execute("select count(*) from gaokao_schools where tags='GaokaoCompass' and (city='' or city is null)")
    print('missing_city_after', cur.fetchone()[0])
    cur.execute("select count(*) from gaokao_schools where tags='GaokaoCompass' and (ownership='未知' or ownership='' or ownership is null)")
    print('unknown_ownership_after', cur.fetchone()[0])
    conn.close()
if __name__=='__main__': main()
