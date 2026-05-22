#!/usr/bin/env python3
"""
测试后端各模型的深度思考流式日志
唯一变量：是否开启深度思考
"""

import json
import re
import sys
import time
import os
from datetime import datetime
import requests

API_URL = "http://localhost:9091/api/chat"
TASK_STREAM_URL = "http://localhost:9091/api/tasks/{task_id}/stream"
GUEST_ID = f"test-reasoning-{int(time.time())}"
LOG_DIR = "/workspace/aipool/backend/test_logs"
os.makedirs(LOG_DIR, exist_ok=True)

# 测试配置：(model, reasoning, reasoning_effort)
TESTS = [
    ("deepseek-v4-pro", True, "medium"),
    ("deepseek-v4-pro", False, ""),
    ("gpt-5.4", True, "medium"),
    ("gpt-5.4", False, ""),
    ("gpt-5.5", True, "medium"),
    ("gpt-5.5", False, ""),
    ("gpt-5.5-pro", True, "minimal"),
    ("gpt-5.5-pro", False, ""),
    ("gemini-3.1-pro-preview", True, "medium"),
    ("gemini-3.1-pro-preview", False, ""),
]


def save_log(model, suffix, lines):
    path = os.path.join(LOG_DIR, f"{model}_{suffix}.log")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
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
            events.append({"type": "done"})
        elif data:
            try:
                events.append(json.loads(data))
            except Exception:
                events.append({"_raw": data})
    return events


def extract_task_id(events):
    for ev in events:
        gt = ev.get("_generation_task") or ev.get("generation_task")
        if gt and gt.get("id"):
            return gt["id"]
    return None


def poll_task_events(task_id, guest_id, timeout=120):
    """轮询 task events，直到收到 [DONE] 且任务完成"""
    url = TASK_STREAM_URL.format(task_id=task_id)
    all_events = []
    seen_seqs = set()
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(url, headers={"X-Guest-ID": guest_id}, stream=True, timeout=30)
            r.raise_for_status()
            text = r.text
            events = parse_sse(text)
            new_events = []
            for ev in events:
                # 用序列号去重
                seq = ev.get("_sequence") or ev.get("sequence")
                if seq is not None:
                    if seq in seen_seqs:
                        continue
                    seen_seqs.add(seq)
                new_events.append(ev)
            if new_events:
                all_events.extend(new_events)
            # 检查是否已经完成
            done_found = any(
                ev.get("type") == "done" or ev.get("_event_type") == "done"
                for ev in new_events
            )
            if done_found:
                # 检查任务状态
                snap = requests.get(
                    f"http://localhost:9091/api/tasks/{task_id}",
                    headers={"X-Guest-ID": guest_id},
                    timeout=10
                )
                if snap.status_code == 200:
                    status = snap.json().get("status", "")
                    if status in ("completed", "failed", "cancelled", "incomplete"):
                        break
            time.sleep(1)
        except Exception as e:
            print(f"  poll error: {e}")
            time.sleep(2)
    return all_events


def run_test(model, reasoning, effort):
    suffix = f"reasoning-{effort}" if reasoning else "no-reasoning"
    print(f"\n===== {datetime.now().isoformat()} | {model} | reasoning={reasoning} | effort={effort} =====")

    body = {
        "model": model,
        "messages": [{"role": "user", "content": "用一句话介绍你自己，然后说明1+1等于几。"}],
        "stream": True,
        "reasoning": reasoning,
    }
    if effort:
        body["reasoning_effort"] = effort

    try:
        r = requests.post(API_URL, json=body, headers={
            "Content-Type": "application/json",
            "X-Guest-ID": GUEST_ID,
        }, stream=True, timeout=60)
        r.raise_for_status()
        chat_text = r.text
    except Exception as e:
        print(f"  POST error: {e}")
        save_log(model, suffix, [f"ERROR: {e}"])
        return

    chat_events = parse_sse(chat_text)
    task_id = extract_task_id(chat_events)

    all_events = list(chat_events)
    if task_id:
        print(f"  task_id={task_id}, polling remaining events...")
        extra = poll_task_events(task_id, GUEST_ID, timeout=180)
        all_events.extend(extra)
    else:
        print(f"  no task_id found (direct stream)")

    # 记录日志
    lines = []
    for ev in all_events:
        lines.append(json.dumps(ev, ensure_ascii=False))
    log_path = save_log(model, suffix, lines)
    print(f"  log saved: {log_path}")

    # 分析
    has_reasoning_content = False
    has_think = False
    has_reasoning_delta_event = False
    content_len = 0
    reasoning_len = 0
    final_content = ""

    for ev in all_events:
        choices = ev.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            rc = delta.get("reasoning_content")
            c = delta.get("content")
            if rc:
                has_reasoning_content = True
                reasoning_len += len(rc)
            if c:
                content_len += len(c)
                final_content += c
        if ev.get("_event_type") == "delta" and "reasoning_content" in str(ev):
            has_reasoning_delta_event = True

    if "<think>" in final_content:
        has_think = True

    print(f"  has_reasoning_content={has_reasoning_content}")
    print(f"  has_think_tag={has_think}")
    print(f"  reasoning_chars={reasoning_len}")
    print(f"  content_chars={content_len}")
    print(f"  total_events={len(all_events)}")

    # 测试结论
    expected_reasoning = reasoning
    actual_reasoning = has_reasoning_content or has_think
    status = "✅ 符合预期" if (expected_reasoning == actual_reasoning) else "❌ 与预期不符"
    print(f"  result: {status}")
    if expected_reasoning and not actual_reasoning:
        print(f"  ⚠️ 警告：开启了深度思考但未收到 reasoning 内容")
    if not expected_reasoning and actual_reasoning:
        print(f"  ⚠️ 警告：未开启深度思考但收到了 reasoning 内容")


if __name__ == "__main__":
    for model, reasoning, effort in TESTS:
        try:
            run_test(model, reasoning, effort)
        except Exception as e:
            print(f"  UNEXPECTED ERROR: {e}")
            import traceback
            traceback.print_exc()
    print("\n===== ALL TESTS COMPLETE =====")
