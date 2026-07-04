#!/usr/bin/env python3
"""Import GaokaoCompass school-admission CSV data into AI Space gaokao tables.

Source: https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M
License noted by upstream project: MIT. Keep source URL on every admission record.
"""
import csv
import io
import os
import sys
import time
import urllib.request
from typing import Dict, Tuple

import psycopg2
import psycopg2.extras

YEAR = int(os.environ.get("GAOKAO_IMPORT_YEAR", "2025"))
BASE = "https://huggingface.co/datasets/choucsan/Gaokao-Compass-11M/resolve/main/data"
PROVINCES = [
    "anhui","beijing","chongqing","fujian","gansu","guangdong","guangxi","guizhou","hainan","hebei",
    "heilongjiang","henan","hubei","hunan","jiangsu","jiangxi","jilin","liaoning","neimenggu","ningxia",
    "qinghai","shaanxi","shandong","shanghai","shanxi","sichuan","tianjin","xinjiang","xizang","yunnan","zhejiang",
]

# Avoid importing specialist/college batches into the default undergraduate recommender.
EXCLUDE_BATCH_KEYWORDS = ("专科", "高职", "艺术", "体育", "提前", "专项", "单招", "征集", "预科")
INCLUDE_BATCH_KEYWORDS = ("本科", "一段", "普通类", "平行录取", "特殊类型")

MAJOR_CODE = "school-admission"
MAJOR_NAME = "院校投档线"


def keep_row(row: Dict[str, str]) -> bool:
    rank = (row.get("min_rank") or "").strip()
    score = (row.get("min_score") or "").strip()
    if not rank or not rank.isdigit() or not score or not score.isdigit():
        return False
    batch = row.get("batch", "") or ""
    category = row.get("category", "") or ""
    text = batch + category
    if any(k in text for k in EXCLUDE_BATCH_KEYWORDS):
        return False
    if any(k in text for k in INCLUDE_BATCH_KEYWORDS):
        return True
    # Some provinces use terse categories. Keep normal physics/history/science/liberal-arts rows when not explicitly excluded.
    if any(k in text for k in ("物理", "历史", "理科", "文科", "综合")):
        return True
    return False


def fetch_csv(year: int, province_slug: str):
    url = f"{BASE}/{year}/{province_slug}/school-admission.csv"
    with urllib.request.urlopen(url, timeout=60) as resp:
        raw = resp.read().decode("utf-8-sig")
    return url, list(csv.DictReader(io.StringIO(raw)))


def get_or_create_school(cur, cache, row, province_slug=""):
    code = (row.get("university_code") or "").strip()
    if not code:
        # Some provinces in GaokaoCompass omit university_code. Use a stable synthetic code
        # scoped by source province slug to avoid merging unrelated schools into one blank-code row.
        name_key = (row.get("university_name") or "").strip().replace(" ", "")
        code = f"gc-{province_slug}-{name_key}"
    if code in cache:
        return cache[code]
    cur.execute("SELECT id FROM gaokao_schools WHERE code=%s", (code,))
    got = cur.fetchone()
    name = (row.get("university_name") or "").strip()
    level_parts = []
    if str(row.get("is_985", "")).strip() in ("1", "true", "True"):
        level_parts.append("985")
    if str(row.get("is_211", "")).strip() in ("1", "true", "True"):
        level_parts.append("211")
    level = " / ".join(level_parts) or "普通本科"
    ownership = (row.get("school_nature") or "").strip() or "未知"
    province = (row.get("school_province") or "").strip()
    if got:
        sid = got[0]
        cur.execute(
            "UPDATE gaokao_schools SET name=%s, province=%s, level=%s, ownership=%s, updated_at=NOW() WHERE id=%s",
            (name, province, level, ownership, sid),
        )
    else:
        cur.execute(
            "INSERT INTO gaokao_schools (code,name,province,city,level,ownership,tags,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,NOW(),NOW()) RETURNING id",
            (code, name, province, "", level, ownership, "GaokaoCompass"),
        )
        sid = cur.fetchone()[0]
    cache[code] = sid
    return sid


def get_or_create_major(cur):
    cur.execute("SELECT id FROM gaokao_majors WHERE code=%s", (MAJOR_CODE,))
    got = cur.fetchone()
    if got:
        return got[0]
    cur.execute(
        "INSERT INTO gaokao_majors (code,name,category,heat,employment,postgrad,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s,NOW(),NOW()) RETURNING id",
        (MAJOR_CODE, MAJOR_NAME, "院校录取", "中", "按院校/专业组投档线评估", ""),
    )
    return cur.fetchone()[0]


def upsert_record(cur, rec):
    cur.execute(
        """
        SELECT id FROM gaokao_admission_records
        WHERE year=%s AND source_province=%s AND batch=%s AND subject_type=%s
          AND school_id=%s AND major_id=%s AND major_group=%s
        """,
        (rec["year"], rec["source_province"], rec["batch"], rec["subject_type"], rec["school_id"], rec["major_id"], rec["major_group"]),
    )
    got = cur.fetchone()
    values = (
        rec["year"], rec["source_province"], rec["batch"], rec["subject_type"], rec["school_id"], rec["major_id"],
        rec["major_group"], rec["subject_requirement"], rec["min_score"], rec["min_rank"], rec["avg_score"], rec["avg_rank"],
        rec["plan_count"], rec["tuition"], rec["campus"], rec["source"],
    )
    if got:
        cur.execute(
            """
            UPDATE gaokao_admission_records SET
              min_score=%s, min_rank=%s, avg_score=%s, avg_rank=%s, plan_count=%s, tuition=%s,
              campus=%s, source=%s, updated_at=NOW()
            WHERE id=%s
            """,
            (rec["min_score"], rec["min_rank"], rec["avg_score"], rec["avg_rank"], rec["plan_count"], rec["tuition"], rec["campus"], rec["source"], got[0]),
        )
        return "updated"
    cur.execute(
        """
        INSERT INTO gaokao_admission_records
        (year,source_province,batch,subject_type,school_id,major_id,major_group,subject_requirement,min_score,min_rank,avg_score,avg_rank,plan_count,tuition,campus,source,created_at,updated_at)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
        """,
        values,
    )
    return "inserted"


def to_int(value, default=0):
    value = (value or "").strip()
    if value == "":
        return default
    try:
        return int(float(value))
    except Exception:
        return default


def main():
    dburl = os.environ.get("DATABASE_URL")
    if not dburl:
        print("DATABASE_URL missing", file=sys.stderr)
        return 2
    conn = psycopg2.connect(dburl)
    conn.autocommit = False
    school_cache: Dict[str, int] = {}
    totals = {"downloaded": 0, "kept": 0, "inserted": 0, "updated": 0, "skipped": 0, "provinces": 0}
    per_province = []
    with conn:
        with conn.cursor() as cur:
            major_id = get_or_create_major(cur)
            for slug in PROVINCES:
                try:
                    source_url, rows = fetch_csv(YEAR, slug)
                except Exception as e:
                    print(f"WARN fetch failed {slug}: {e}", file=sys.stderr)
                    per_province.append((slug, 0, 0, 0, 0, "fetch_failed"))
                    continue
                totals["downloaded"] += len(rows)
                kept = inserted = updated = skipped = 0
                for row in rows:
                    if not keep_row(row):
                        skipped += 1
                        continue
                    school_id = get_or_create_school(cur, school_cache, row, slug)
                    subject_type = (row.get("category") or "").strip()
                    batch = (row.get("batch") or "").strip()
                    raw_code = (row.get("university_code") or "").strip()
                    synthetic_code = raw_code or f"gc-{slug}-{(row.get('university_name') or '').strip().replace(' ', '')}"
                    explicit_group = (row.get("major_group") or "").strip()
                    if explicit_group:
                        major_group = explicit_group
                    else:
                        # Some provinces publish school-admission rows without major_group but with
                        # multiple lines per school. Include score/rank to avoid merging distinct lines.
                        major_group = f"{synthetic_code}-{batch}-{subject_type}-{row.get('min_score','')}-{row.get('min_rank','')}"
                    rec = {
                        "year": YEAR,
                        "source_province": (row.get("province") or "").strip(),
                        "batch": batch,
                        "subject_type": subject_type,
                        "school_id": school_id,
                        "major_id": major_id,
                        "major_group": major_group,
                        "subject_requirement": (row.get("subject_req") or "").strip(),
                        "min_score": to_int(row.get("min_score")),
                        "min_rank": to_int(row.get("min_rank")),
                        "avg_score": 0,
                        "avg_rank": 0,
                        "plan_count": to_int(row.get("admit_count")),
                        "tuition": 0,
                        "campus": "",
                        "source": f"GaokaoCompass-11M {source_url}",
                    }
                    status = upsert_record(cur, rec)
                    if status == "inserted": inserted += 1
                    else: updated += 1
                    kept += 1
                conn.commit()
                totals["kept"] += kept; totals["inserted"] += inserted; totals["updated"] += updated; totals["skipped"] += skipped; totals["provinces"] += 1
                per_province.append((slug, len(rows), kept, inserted, updated, "ok"))
                print(f"{slug}: downloaded={len(rows)} kept={kept} inserted={inserted} updated={updated} skipped={skipped}")
                time.sleep(0.2)
    print("TOTAL", totals)
    out_path = os.environ.get("GAOKAO_IMPORT_REPORT", "/tmp/gaokao_compass_import_report.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(["province_slug","downloaded","kept","inserted","updated","status"]); w.writerows(per_province)
    print("report", out_path)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
