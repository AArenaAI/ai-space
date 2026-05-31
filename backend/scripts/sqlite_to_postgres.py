#!/usr/bin/env python3
import json
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SQLITE_PATH = ROOT / "backend" / "data" / "aipool.db"


def run(cmd, input_text=None):
    res = subprocess.run(cmd, input=input_text, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(cmd)}\nSTDOUT={res.stdout}\nSTDERR={res.stderr[:4000]}")
    return res.stdout


def copy_text_value(value):
    # PostgreSQL COPY text format:
    #   \N means NULL
    #   backslash escapes preserve tabs/newlines/backslashes inside text fields
    # This preserves SQLite NULL vs empty string and supports multiline content.
    if value is None:
        return r"\N"
    if isinstance(value, (bytes, bytearray)):
        value = r"\x" + bytes(value).hex()
    else:
        value = str(value)
    return (
        value
        .replace("\\", "\\\\")
        .replace("\t", r"\t")
        .replace("\n", r"\n")
        .replace("\r", r"\r")
    )


conn = sqlite3.connect(str(SQLITE_PATH))
conn.row_factory = sqlite3.Row
conn.text_factory = lambda b: b.decode("utf-8", "replace")
cur = conn.cursor()

sqlite_tables = [
    r[0]
    for r in cur.execute(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"
    )
]
pg_tables = [
    x.strip()
    for x in run([
        "docker", "exec", "aipool-postgres", "psql", "-U", "aipool", "-d", "aipool", "-tAc",
        "select tablename from pg_tables where schemaname='public' order by tablename;",
    ]).splitlines()
    if x.strip()
]

tables = [t for t in sqlite_tables if t in pg_tables]
missing = [t for t in sqlite_tables if t not in pg_tables]

if tables:
    quoted = ", ".join('"%s"' % t.replace('"', '""') for t in tables)
    run(["docker", "exec", "aipool-postgres", "psql", "-U", "aipool", "-d", "aipool", "-v", "ON_ERROR_STOP=1", "-c", f"TRUNCATE {quoted} RESTART IDENTITY CASCADE;"])

summary = []
for table in tables:
    sqlite_cols = [r[1] for r in cur.execute(f'PRAGMA table_info("{table}")')]
    pg_cols = json.loads(
        run([
            "docker", "exec", "aipool-postgres", "psql", "-U", "aipool", "-d", "aipool", "-tAc",
            "select coalesce(json_agg(column_name order by ordinal_position),'[]'::json) "
            "from information_schema.columns where table_schema='public' and table_name='%s';" % table.replace("'", "''"),
        ]).strip() or "[]"
    )
    cols = [c for c in pg_cols if c in sqlite_cols]
    if not cols:
        summary.append((table, 0, "no common cols"))
        continue
    rows = cur.execute(
        'select %s from "%s"' % (", ".join('"%s"' % c for c in cols), table)
    ).fetchall()
    if not rows:
        summary.append((table, 0, "empty"))
        continue

    data = "".join("\t".join(copy_text_value(row[c]) for c in cols) + "\n" for row in rows)
    copy_sql = 'COPY "%s" (%s) FROM STDIN WITH (FORMAT text);' % (
        table.replace('"', '""'),
        ", ".join('"%s"' % c.replace('"', '""') for c in cols),
    )
    run(["docker", "exec", "-i", "aipool-postgres", "psql", "-U", "aipool", "-d", "aipool", "-v", "ON_ERROR_STOP=1", "-c", copy_sql], data)
    summary.append((table, len(rows), "imported"))

seq_sql = r"""
DO $$
DECLARE r record;
DECLARE max_id bigint;
DECLARE seq text;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id' LOOP
    EXECUTE format('SELECT COALESCE(MAX(id),0) FROM %I', r.table_name) INTO max_id;
    seq := pg_get_serial_sequence(format('%I', r.table_name), 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('SELECT setval(%L, GREATEST(%s, 1), %s)', seq, max_id, CASE WHEN max_id > 0 THEN 'true' ELSE 'false' END);
    END IF;
  END LOOP;
END $$;
"""
run(["docker", "exec", "aipool-postgres", "psql", "-U", "aipool", "-d", "aipool", "-v", "ON_ERROR_STOP=1", "-c", seq_sql])

print("missing_pg_tables=" + (",".join(missing) if missing else "none"))
for table, count, status in summary:
    if count:
        print(f"{table}: {count} {status}")
print(f"total_imported_rows={sum(count for _, count, status in summary if status == 'imported')}")
