#!/usr/bin/env python3
"""
测试后端各模型的深度思考流式日志
唯一变量：是否开启深度思考
注意：使用 X-Forwarded-For 绕过本地 IP 限流（每次不同 IP）
"""

import json
import os
import sys
import time
import requests

os.environ["PYTHONUNBUFFERED"] = "1"
API_URL = "http://localhost:9091/api/chat"
TASK_STREAM_URL = "http://localhost:9091/api/tasks/{task_id}/stream"
TASK_SNAPSHOT_URL = "http://localhost:9091/api/tasks/{task_id}"
LOG_DIR = "/workspace/aipool/backend/test_logs"
os.makedirs(LOG_DIR, exist_ok=True)

# 测试配置：(model, reasoning, reasoning_effort, test_ip_index)
TESTS = [
    ("deepseek-v4-pro", True, "medium", 1),
    ("deepseek-v4-pro", False, "", 2),
    ("gpt-5.4", True, "medium", 3),
    ("gpt-5.4", False, "", 4),
    ("gpt-5.5", True, "medium", 5),
    ("gpt-5.5", False, "", 6),
    ("gpt-5.5-pro", True, "minimal", 7),
    ("gpt-5.5-pro", False, "", 8),
    ("gemini-3.1-pro-preview", True, "medium", 9),
    ("gemini-3.1-pro-preview", False, "", 10),
]

GUEST_ID = f"test-reasoning-{int(time.time())}"


def make_headers(ip_index):
    return {
        "Content-Type": "application/json",
        "X-Guest-ID": GUEST_ID,
        "X-Forwarded-For": f"10.0.0.{ip_index}",
    }


def save_log(model, suffix, raw_text):
    path = os.path.join(LOG_DIR, f"{model}_{suffix}.sse")
    with open(path, "w", encoding="utf-8") as f:
        f.write(raw_text)
    return path


def parse_sse(text):
    events = []
    for block in text.strip().split("\n\n"):
        block = block.strip()
        if not block:
            continue
        data = ""
        for line in block.split("\n"):
            if line.startswith("data: "):
                data = line[len("data: "):]
        if data == "[DONE]":
            events.append({"_done": True})
        elif data:
            try:
                events.append(json.loads(data))
            except Exception:
                events.append({"_raw": data})
    return events


def extract_task_id(events):
    for ev in events:
        gt = ev.get("_generation_task")
        if gt and gt.get("id"):
            return gt["id"]
    return None


def is_task_done(events):
    for ev in events:
        if ev.get("_done"):
            return True
    return False


def run_single_test(model, reasoning, effort, ip_index):
    suffix = f"reasoning-{effort}" if reasoning else "no-reasoning"
    print(f"\n===== {model} | reasoning={reasoning} | effort={effort} =====", flush=True)

    body = {
        "model": model,
        "messages": [{"role": "user", "content": "用一句话介绍你自己，然后说明1+1等于几。"}],
        "stream": True,
        "reasoning": reasoning,
    }
    if effort:
        body["reasoning_effort"] = effort

    headers = make_headers(ip_index)
    raw_text = ""
    try:
        r = requests.post(API_URL, json=body, headers=headers, stream=True, timeout=95)
        r.raise_for_status()
        for chunk in r.iter_content(chunk_size=8192):
            if chunk:
                raw_text += chunk.decode("utf-8", errors="replace")
    except requests.exceptions.Timeout:
        print("  POST timeout (95s)", flush=True)
    except Exception as e:
        print(f"  POST error: {e}", flush=True)
        save_log(model, suffix, f"ERROR: {e}")
        return

    events = parse_sse(raw_text)
    task_id = extract_task_id(events)
    print(f"  task_id={task_id}, events_in_post={len(events)}, done_in_post={is_task_done(events)}", flush=True)

    # 如果有 task 但没看到 [DONE]，说明可能是后台任务流还没结束，轮询补充
    if task_id and not is_task_done(events):
        print(f"  polling task events...", flush=True)
        poll_start = time.time()
        while time.time() - poll_start < 120:
            try:
                r2 = requests.get(
                    TASK_STREAM_URL.format(task_id=task_id),
                    headers=headers,
                    stream=True,
                    timeout=95
                )
                r2.raise_for_status()
                poll_text = ""
                for chunk in r2.iter_content(chunk_size=8192):
                    if chunk:
                        poll_text += chunk.decode("utf-8", errors="replace")
                raw_text += "\n\n" + poll_text
                poll_events = parse_sse(poll_text)
                print(f"  poll got {len(poll_events)} events", flush=True)
                if is_task_done(poll_events):
                    break
                # 检查任务状态
                snap = requests.get(TASK_SNAPSHOT_URL.format(task_id=task_id), headers=headers, timeout=10)
                if snap.status_code == 200:
                    status = snap.json().get("status", "")
                    if status in ("completed", "failed", "cancelled", "incomplete"):
                        if not is_task_done(poll_events):
                            raw_text += "\n\ndata: [DONE]\n\n"
                        break
            except Exception as e:
                print(f"  poll error: {e}", flush=True)
            time.sleep(2)

    log_path = save_log(model, suffix, raw_text)
    all_events = parse_sse(raw_text)
    print(f"  total_events={len(all_events)}, log={log_path}", flush=True)

    # 分析：检查 reasoning_content delta
    has_rc = False
    has_think = False
    rc_chars = 0
    c_chars = 0
    final_content = ""
    for ev in all_events:
        choices = ev.get("choices", [])
        if choices and isinstance(choices, list):
            delta = choices[0].get("delta", {})
            rc = delta.get("reasoning_content")
            c = delta.get("content")
            if rc:
                has_rc = True
                rc_chars += len(rc)
            if c:
                c_chars += len(c)
                final_content += c
    if "<think>" in final_content:
        has_think = True

    print(f"  has_reasoning_content={has_rc}, has_think={has_think}, rc_chars={rc_chars}, content_chars={c_chars}", flush=True)

    expected = reasoning
    actual = has_rc or has_think
    if expected == actual:
        print("  ✅ 符合预期", flush=True)
    else:
        print(f"  ❌ 不符：预期 reasoning={expected}, 实际={actual}", flush=True)


if __name__ == "__main__":
    for model, reasoning, effort, ip_idx in TESTS:
        try:
            run_single_test(model, reasoning, effort, ip_idx)
        except Exception as e:
            print(f"  UNEXPECTED: {e}", flush=True)
            import traceback
            traceback.print_exc()
        # 每次测试间隔 3 秒，避免瞬间爆发
        time.sleep(3)
    print("\n===== ALL TESTS COMPLETE =====", flush=True)
