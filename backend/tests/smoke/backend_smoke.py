#!/usr/bin/env python3
"""
AI Pool backend smoke test.

Default scope is fast and safe: health, model metadata, file accept metadata,
unauthenticated boundary, guest upload/parser/chunk DB verification.

Run from backend directory:
  python3 tests/smoke/backend_smoke.py

Optional real chat smoke, may consume provider credits:
  python3 tests/smoke/backend_smoke.py --chat
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = os.environ.get("AIPOOL_BASE_URL", "http://localhost:9091").rstrip("/")
DEFAULT_DB = ROOT / "data" / "aipool.db"
DEFAULT_MODEL = os.environ.get("AIPOOL_SMOKE_MODEL", "gpt-5.4-mini")

REQUIRED_FILE_EXTS = [
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
    ".txt",
    ".md",
    ".json",
    ".py",
    ".js",
    ".ts",
    ".go",
]


class SmokeFailure(Exception):
    pass


def log(message: str) -> None:
    print(f"[smoke] {message}", flush=True)


def fail(message: str) -> None:
    raise SmokeFailure(message)


def request(
    method: str,
    path: str,
    *,
    base_url: str,
    headers: dict[str, str] | None = None,
    data: bytes | None = None,
    json_body: Any | None = None,
    timeout: int = 20,
) -> tuple[int, Any, str]:
    url = path if path.startswith("http") else base_url + path
    req_headers = dict(headers or {})
    body = data
    if json_body is not None:
        body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        req_headers.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            parsed = parse_json(raw)
            return resp.status, parsed, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        return e.code, parse_json(raw), raw
    except urllib.error.URLError as e:
        fail(f"request failed: {method} {url}: {e}")
    raise AssertionError("unreachable")


def parse_json(raw: str) -> Any:
    if raw == "":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def multipart_upload(path: Path, *, base_url: str, guest_id: str) -> tuple[int, Any, str]:
    boundary = "----aipool-smoke-" + uuid.uuid4().hex
    file_bytes = path.read_bytes()
    parts = [
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'.encode(),
        b"Content-Type: text/markdown\r\n\r\n",
        file_bytes,
        b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ]
    body = b"".join(parts)
    return request(
        "POST",
        "/api/files/upload",
        base_url=base_url,
        headers={
            "X-Guest-ID": guest_id,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        data=body,
        timeout=60,
    )


def copy_sqlite_for_read(db_path: Path) -> Path:
    if not db_path.exists():
        fail(f"db not found: {db_path}")
    tmpdir = Path(tempfile.mkdtemp(prefix="aipool-smoke-db-"))
    dst = tmpdir / db_path.name
    shutil.copy2(db_path, dst)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(db_path) + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, Path(str(dst) + suffix))
    return dst


def query_db(db_path: Path, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
    copied = copy_sqlite_for_read(db_path)
    conn = sqlite3.connect(copied)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def check_health(base_url: str) -> None:
    code, body, raw = request("GET", "/health", base_url=base_url)
    if code != 200:
        fail(f"health expected 200, got {code}: {raw[:300]}")
    if not isinstance(body, dict) or body.get("status") != "ok":
        fail(f"health payload unexpected: {raw[:300]}")
    log("health ok")


def check_models(base_url: str) -> None:
    code, models, raw = request("GET", "/api/models/chat", base_url=base_url)
    if code != 200 or not isinstance(models, list) or not models:
        fail(f"chat models expected non-empty list, got {code}: {raw[:300]}")
    log(f"chat models ok: count={len(models)}")

    candidates = [m for m in models if isinstance(m, dict) and m.get("file_accept")]
    if not candidates:
        raise SmokeFailure("no chat model exposes file_accept")
    candidate: dict[str, Any] = candidates[0]
    accept = str(candidate.get("file_accept") or "")
    model_id = str(candidate.get("id") or "unknown")
    missing = [ext for ext in REQUIRED_FILE_EXTS if ext not in accept]
    if missing:
        fail(f"file_accept missing extensions for {model_id}: {missing}")
    for key in ("supported_inputs", "supported_file_extensions", "supported_file_mime_types"):
        if not candidate.get(key):
            fail(f"model metadata missing {key} for {model_id}")
    log(f"file metadata ok: model={model_id}")


def check_auth_boundary(base_url: str) -> None:
    code, _, raw = request("GET", "/api/files", base_url=base_url)
    if code != 401:
        fail(f"/api/files without auth expected 401, got {code}: {raw[:300]}")
    code, _, raw = request("POST", "/api/files/upload", base_url=base_url)
    if code not in (400, 401):
        fail(f"upload without auth/guest expected 400/401, got {code}: {raw[:300]}")
    log("auth boundary ok")


def check_guest_file_upload(base_url: str, db_path: Path) -> str:
    guest_id = "smoke_" + uuid.uuid4().hex
    with tempfile.TemporaryDirectory(prefix="aipool-smoke-file-") as td:
        sample = Path(td) / "smoke.md"
        marker = "AIPOOL_SMOKE_MARKER_" + uuid.uuid4().hex
        sample.write_text(
            "# Smoke Test File\n\n"
            f"Marker: {marker}\n\n"
            "This markdown file verifies upload, parsing, chunking, and DB visibility.\n",
            encoding="utf-8",
        )
        code, body, raw = multipart_upload(sample, base_url=base_url, guest_id=guest_id)
    if code != 200 or not isinstance(body, dict):
        fail(f"guest upload expected 200 JSON, got {code}: {raw[:500]}")
    public_id = body.get("public_id")
    if not public_id:
        fail(f"upload response missing public_id: {raw[:500]}")
    mime_type = str(body.get("mime_type") or "")
    if mime_type and mime_type not in ("text/markdown", "text/plain", "application/octet-stream"):
        fail(f"unexpected upload mime_type: {mime_type}")
    if not mime_type:
        log("upload warning: response mime_type is empty; continue with DB/parser verification")
    log(f"upload ok: public_id={public_id}")

    deadline = time.time() + 30
    last_status = None
    file_row = None
    while time.time() < deadline:
        rows = query_db(
            db_path,
            """
            SELECT id, public_id, filename, guest_id, parse_status, embedding_status, error_message, content
            FROM files
            WHERE public_id = ?
            LIMIT 1
            """,
            (public_id,),
        )
        if rows:
            file_row = rows[0]
            last_status = (file_row["parse_status"], file_row["embedding_status"], file_row["error_message"])
            if file_row["parse_status"] == "done":
                break
        time.sleep(1)
    if not file_row:
        fail(f"uploaded file not found in DB: public_id={public_id}")
    if file_row["guest_id"] != guest_id:
        fail(f"guest_id mismatch in DB: expected={guest_id}, got={file_row['guest_id']}")
    if file_row["parse_status"] != "done":
        fail(f"parse not done after timeout: public_id={public_id}, status={last_status}")
    if "Smoke Test File" not in (file_row["content"] or ""):
        fail("parsed content missing expected text")

    chunk_rows = query_db(
        db_path,
        """
        SELECT COUNT(*) AS chunk_count,
               SUM(CASE WHEN embedding_status IN ('done','skipped','pending','indexing') THEN 1 ELSE 0 END) AS known_embedding_status_count
        FROM file_chunks
        WHERE file_id = ?
        """,
        (file_row["id"],),
    )
    chunk_count = int(chunk_rows[0]["chunk_count"] or 0)
    if chunk_count <= 0:
        fail(f"no file_chunks created for public_id={public_id}")
    log(f"parser/chunks ok: chunks={chunk_count}, embedding_status={file_row['embedding_status']}")

    code, body, raw = request(
        "GET",
        f"/api/files/{urllib.parse.quote(public_id)}",
        base_url=base_url,
        headers={"X-Guest-ID": guest_id},
    )
    if code != 200 or not isinstance(body, dict) or body.get("public_id") != public_id:
        fail(f"GET uploaded guest file expected 200, got {code}: {raw[:300]}")
    code, _, raw = request(
        "GET",
        f"/api/files/{urllib.parse.quote(public_id)}",
        base_url=base_url,
        headers={"X-Guest-ID": "smoke_different_guest"},
    )
    if code == 200:
        fail(f"different guest can access uploaded file: {raw[:300]}")
    log("guest file access boundary ok")
    return public_id


def check_optional_chat(base_url: str, public_id: str, model: str) -> None:
    guest_id = "smoke_chat_" + uuid.uuid4().hex
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Say OK only."}],
        "stream": False,
    }
    code, body, raw = request(
        "POST",
        "/api/chat",
        base_url=base_url,
        headers={"X-Guest-ID": guest_id},
        json_body=payload,
        timeout=90,
    )
    if code != 200:
        fail(f"optional chat expected 200, got {code}: {raw[:500]}")
    if not raw.strip():
        fail("optional chat returned empty body")
    log(f"optional chat ok: model={model}")

    payload["messages"] = [{"role": "user", "content": "Summarize the uploaded file in one short sentence."}]
    payload["file_ids"] = [public_id]
    code, body, raw = request(
        "POST",
        "/api/chat",
        base_url=base_url,
        headers={"X-Guest-ID": guest_id},
        json_body=payload,
        timeout=120,
    )
    if code != 200:
        fail(f"optional chat-with-file expected 200, got {code}: {raw[:500]}")
    if "Smoke" not in raw and "smoke" not in raw:
        log("optional chat-with-file returned 200 but did not echo Smoke marker; inspect manually if needed")
    else:
        log("optional chat-with-file ok")


def main() -> int:
    parser = argparse.ArgumentParser(description="AI Pool backend smoke test")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--chat", action="store_true", help="also call /api/chat; may consume provider credits")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    db_path = Path(args.db).resolve()

    log(f"base_url={base_url}")
    log(f"db={db_path}")

    check_health(base_url)
    check_models(base_url)
    check_auth_boundary(base_url)
    public_id = check_guest_file_upload(base_url, db_path)
    if args.chat:
        check_optional_chat(base_url, public_id, args.model)
    log("PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SmokeFailure as e:
        print(f"[smoke] FAIL: {e}", file=sys.stderr)
        raise SystemExit(1)
