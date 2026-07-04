#!/usr/bin/env python3
"""Import authoritative school metadata.

Sources:
- Ministry of Education 2025 national ordinary higher-education school list (XLS)
- gaokao-pro school-index.json.gz as supplemental type/nature/985/211/dual-class data
"""
import gzip, json, os, re, shutil, subprocess, urllib.request
from pathlib import Path

import pandas as pd
import psycopg2

MOE_URL = "https://www.moe.gov.cn/jyb_xxgk/s5743/s5744/A03/202506/W020250729615142156867.xls"
BASE = Path("data/gaokao-sources")
MOE_FILE = BASE / "moe-universities-2025.xls"
GAOKAO_PRO_DIR = Path("/tmp/gaokao-pro-school-index")

PROVINCE_NAMES = ["北京","天津","上海","重庆","河北","山西","内蒙古","辽宁","吉林","黑龙江","江苏","浙江","安徽","福建","江西","山东","河南","湖北","湖南","广东","广西","海南","四川","贵州","云南","西藏","陕西","甘肃","青海","宁夏","新疆"]
MUNICIPALITIES = {"北京":"北京市","上海":"上海市","天津":"天津市","重庆":"重庆市"}

def norm_name(name: str) -> str:
    return re.sub(r"[\s　（）()\[\]【】·•\-—_]", "", str(name or "").strip())

def infer_province(city_or_location: str) -> str:
    s = str(city_or_location or "")
    for p, city in MUNICIPALITIES.items():
        if s.startswith(p) or s.startswith(city): return p
    for p in PROVINCE_NAMES:
        if s.startswith(p): return p
    return ""

def download_sources():
    BASE.mkdir(parents=True, exist_ok=True)
    if not MOE_FILE.exists():
        urllib.request.urlretrieve(MOE_URL, MOE_FILE)
    # gaokao-pro is optional supplement; install by npm pack to avoid adding project dep.
    GAOKAO_PRO_DIR.mkdir(parents=True, exist_ok=True)
    tgz = GAOKAO_PRO_DIR / "gaokao-pro-1.0.2.tgz"
    if not tgz.exists():
        subprocess.run(["npm", "pack", "gaokao-pro", "--silent"], cwd=GAOKAO_PRO_DIR, check=True)
    gz = GAOKAO_PRO_DIR / "package/data/school-index.json.gz"
    if not gz.exists():
        subprocess.run(["tar", "-xzf", str(tgz.name), "package/data/school-index.json.gz"], cwd=GAOKAO_PRO_DIR, check=True)
    return gz

def load_moe():
    df = pd.read_excel(MOE_FILE, header=None)
    records = {}
    for _, row in df.iterrows():
        name = str(row.get(1, "") or "").strip()
        if not name or name == "学校名称" or name.startswith("nan"):
            continue
        code = str(row.get(2, "") or "").strip().replace(".0", "")
        department = str(row.get(3, "") or "").strip()
        city = str(row.get(4, "") or "").strip()
        level = str(row.get(5, "") or "").strip()
        note = str(row.get(6, "") or "").strip()
        if not code or not re.match(r"^\d{10}$", code):
            continue
        province = infer_province(city)
        ownership = "民办" if "民办" in note else "公办"
        records[norm_name(name)] = {
            "name": name, "moe_code": code, "department": department, "city": city,
            "province": province, "level": level, "ownership": ownership,
            "tags": "教育部2025全国普通高等学校名单" + ((";" + note) if note and note != "nan" else ""),
        }
    return records

def load_gaokao_pro(gz_path):
    records = {}
    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        obj = json.load(f)
    for row in obj.get("rows", []):
        name = row.get("name") or ""
        if not name: continue
        level_parts = []
        if row.get("f985"): level_parts.append("985")
        if row.get("f211"): level_parts.append("211")
        if row.get("dual_class"): level_parts.append(str(row.get("dual_class")))
        records[norm_name(name)] = {
            "name": name,
            "zs_code": str(row.get("zs_code") or ""),
            "province": row.get("province") or "",
            "city": row.get("city") or "",
            "level_extra": " / ".join(level_parts),
            "school_type": row.get("type") or "",
            "ownership": row.get("nature") or "",
            "department": row.get("belong") or "",
            "dual_class": row.get("dual_class") or "",
        }
    return records

def merge_meta(moe, gp):
    keys = set(moe) | set(gp)
    out = {}
    for k in keys:
        m = dict(moe.get(k, {}))
        g = gp.get(k, {})
        if not m:
            m = {"name": g.get("name", "")}
        # MOE is authoritative for code/location/level, gaokao-pro enriches type/985/211/dual-class/nature.
        for field in ["province", "city", "ownership", "department"]:
            if not m.get(field) and g.get(field): m[field] = g[field]
        if g.get("level_extra"):
            base = m.get("level", "")
            m["level"] = (g["level_extra"] if not base or base == "本科" else base + " / " + g["level_extra"])
        m["school_type"] = g.get("school_type", "")
        m["dual_class"] = g.get("dual_class", "")
        if g.get("zs_code"): m["zs_code"] = g["zs_code"]
        out[k] = m
    return out

def main():
    gz = download_sources()
    moe = load_moe()
    gp = load_gaokao_pro(gz)
    meta = merge_meta(moe, gp)
    print("moe_records", len(moe), "gaokao_pro_records", len(gp), "merged", len(meta))
    db = os.environ.get("DATABASE_URL")
    if not db: raise SystemExit("DATABASE_URL missing")
    conn = psycopg2.connect(db); cur = conn.cursor()
    # Add columns if AutoMigrate hasn't run yet.
    for sql in [
        "alter table gaokao_schools add column if not exists moe_code varchar(32)",
        "alter table gaokao_schools add column if not exists department varchar(128)",
        "alter table gaokao_schools add column if not exists school_type varchar(64)",
        "alter table gaokao_schools add column if not exists dual_class varchar(64)",
    ]:
        cur.execute(sql)
    before = {}
    for label, where in [
        ("missing_city", "city is null or city=''"),
        ("unknown_ownership", "ownership is null or ownership='' or ownership='未知'"),
        ("missing_type", "school_type is null or school_type=''"),
        ("missing_moe", "moe_code is null or moe_code=''"),
    ]:
        cur.execute(f"select count(*) from gaokao_schools where {where}")
        before[label] = cur.fetchone()[0]
    cur.execute("select id,name,tags from gaokao_schools")
    rows = cur.fetchall()
    updated = matched = 0
    for sid, name, tags in rows:
        rec = meta.get(norm_name(name))
        if not rec: continue
        matched += 1
        new_tags = (tags or "")
        if "教育部2025全国普通高等学校名单" not in new_tags:
            new_tags = (new_tags + ";" if new_tags else "") + rec.get("tags", "教育部2025全国普通高等学校名单")
        cur.execute('''update gaokao_schools set
            province = case when %s<>'' then %s else province end,
            city = case when %s<>'' then %s else city end,
            level = case when %s<>'' then %s else level end,
            ownership = case when %s<>'' then %s else ownership end,
            moe_code = case when %s<>'' then %s else moe_code end,
            department = case when %s<>'' then %s else department end,
            school_type = case when %s<>'' then %s else school_type end,
            dual_class = case when %s<>'' then %s else dual_class end,
            tags = %s,
            updated_at=now()
            where id=%s''', (
            rec.get("province",""), rec.get("province",""),
            rec.get("city",""), rec.get("city",""),
            rec.get("level",""), rec.get("level",""),
            rec.get("ownership",""), rec.get("ownership",""),
            rec.get("moe_code", rec.get("zs_code", "")), rec.get("moe_code", rec.get("zs_code", "")),
            rec.get("department",""), rec.get("department",""),
            rec.get("school_type",""), rec.get("school_type",""),
            rec.get("dual_class",""), rec.get("dual_class",""),
            new_tags, sid,
        ))
        updated += cur.rowcount
    conn.commit()
    after = {}
    for label, where in [
        ("missing_city", "city is null or city=''"),
        ("unknown_ownership", "ownership is null or ownership='' or ownership='未知'"),
        ("missing_type", "school_type is null or school_type=''"),
        ("missing_moe", "moe_code is null or moe_code=''"),
    ]:
        cur.execute(f"select count(*) from gaokao_schools where {where}")
        after[label] = cur.fetchone()[0]
    print("matched_schools", matched, "updated_rows", updated)
    print("before", before)
    print("after", after)
    cur.execute("select name,province,city,level,ownership,school_type,dual_class,moe_code,department from gaokao_schools where name in ('广东工业大学','深圳大学','宁夏大学','延边大学','北京大学') order by name, id limit 20")
    for r in cur.fetchall(): print(r)
    conn.close()

if __name__ == "__main__": main()
