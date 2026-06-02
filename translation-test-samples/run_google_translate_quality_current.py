import json
import re
import socket
import statistics
import time
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path('/home/ubuntu/workspace/ai-space')
SAMPLES = ROOT / 'translation-test-samples/translation_samples_1000.jsonl'
OUT_JSONL = ROOT / 'translation-test-samples/google_translate_quality_current.jsonl'
OUT_SUMMARY = ROOT / 'translation-test-samples/google_translate_quality_current_summary.json'
OUT_REPORT = ROOT / 'translation-test-samples/google-translate-quality-report.md'
API = 'http://127.0.0.1:9091/api'
MODEL = 'google-cloud-translate-v3'
REQUESTED_MODEL = 'general/translation-llm'

PRIMARY_TEST_IDS = [
    'TR-0051', 'TR-0058', 'TR-0001', 'TR-0008', 'TR-0101', 'TR-0108', 'TR-0151', 'TR-0208', 'TR-0908', 'TR-0958',
]

LANG_CODE = {
    '自动检测': 'auto',
    '中文': 'zh', '简体中文': 'zh', '繁体中文': 'zh-TW',
    '英语': 'en', '英文': 'en',
    '日语': 'ja', '日文': 'ja',
    '韩语': 'ko', '韩文': 'ko',
    '法语': 'fr', '德语': 'de', '西班牙语': 'es', '葡萄牙语': 'pt', '意大利语': 'it',
    '俄语': 'ru', '阿拉伯语': 'ar', '印地语': 'hi', '印尼语': 'id', '越南语': 'vi',
    '泰语': 'th', '马来语': 'ms', '菲律宾语': 'fil', '土耳其语': 'tr', '荷兰语': 'nl',
}

ASCII_WRAPPER_PAIRS = [('"', '"'), ("'", "'"), ('(', ')'), ('[', ']'), ('{', '}'), ('`', '`')]
LOCALIZED_WRAPPER_PAIRS = [('「', '」'), ('『', '』'), ('“', '”'), ('‘', '’'), ('（', '）'), ('［', '］'), ('｛', '｝')]

def unique_matches(value, pattern, flags=0):
    seen = []
    for match in re.findall(pattern, value, flags):
        token = match if isinstance(match, str) else match[0]
        if token not in seen:
            seen.append(token)
    return seen

def replace_by_index(translated, translated_pattern, source_tokens, flags=0):
    translated_tokens = re.findall(translated_pattern, translated, flags)
    if not source_tokens or len(translated_tokens) != len(source_tokens):
        return translated
    idx = 0
    def repl(_match):
        nonlocal idx
        token = source_tokens[idx]
        idx += 1
        return token
    return re.sub(translated_pattern, repl, translated, flags=flags)

def strip_trailing_token_punctuation(token):
    return re.sub(r'[.,!?。！？、，;；:：]+$', '', token)

def preserve_fenced_code_blocks(src, dst):
    pattern = r'```[\s\S]*?```'
    return replace_by_index(dst, pattern, re.findall(pattern, src))

def preserve_html_tags(src, dst):
    pattern = r'<\/?[A-Za-z][^>\n]*>'
    return replace_by_index(dst, pattern, re.findall(pattern, src))

def preserve_markdown_link_targets(src, dst):
    pattern = r'\[[^\]\n]+\]\(([^)\s]+)\)'
    source_targets = re.findall(pattern, src)
    translated_matches = list(re.finditer(pattern, dst))
    if not source_targets or len(translated_matches) != len(source_targets):
        return dst
    idx = 0
    def repl(match):
        nonlocal idx
        target = source_targets[idx]
        idx += 1
        return re.sub(r'\([^)]*\)$', f'({target})', match.group(0))
    return re.sub(pattern, repl, dst)

def preserve_inline_code(src, dst):
    pattern = r'`[^`\n]+`'
    return replace_by_index(dst, pattern, re.findall(pattern, src))

def preserve_urls_and_emails(src, dst):
    url_pattern = r'https?:\/\/[^\s)\]}>"\'`。！？、，；：]+'
    email_pattern = r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b'
    translated_email_pattern = r'\b[A-Z0-9._%+-]+[@＠][A-Z0-9.-]+\.[A-Z]{2,}\b'
    urls = [strip_trailing_token_punctuation(x) for x in unique_matches(src, url_pattern)]
    urls = [x for x in urls if x]
    with_urls = replace_by_index(dst, url_pattern, urls)
    return replace_by_index(with_urls, translated_email_pattern, unique_matches(src, email_pattern, re.I), flags=re.I)

def preserve_placeholders(src, dst):
    source_pattern = r'\{\{[^{}\n]+\}\}|\{[A-Za-z_][A-Za-z0-9_]*\}|%\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|\b[A-Z][A-Z0-9]*_[A-Z0-9_]*\b'
    translated_pattern = r'\{\{[^{}\n]+\}\}|\{[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*\}|%\{[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*\}|\$[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*|\b[A-Z][A-Z0-9＿_]*[＿_][A-Z0-9＿_]*\b'
    return replace_by_index(dst, translated_pattern, unique_matches(src, source_pattern))

def preserve_outer_ascii_wrapper(src, dst):
    source_trimmed = src.strip()
    result = dst.strip()
    for open_ch, close_ch in ASCII_WRAPPER_PAIRS:
        if not source_trimmed.startswith(open_ch) or not source_trimmed.endswith(close_ch) or len(source_trimmed) < len(open_ch) + len(close_ch):
            continue
        if result.startswith(open_ch) and result.endswith(close_ch):
            return result
        for local_open, local_close in LOCALIZED_WRAPPER_PAIRS:
            if result.startswith(local_open) and result.endswith(local_close):
                inner = result[len(local_open):len(result)-len(local_close)].strip()
                return f'{open_ch}{inner}{close_ch}'
        return f'{open_ch}{result}{close_ch}'
    return dst

def preserve_boundary_whitespace(src, dst):
    leading_match = re.match(r'^\s*', src)
    trailing_match = re.search(r'\s*$', src)
    leading = leading_match.group(0) if leading_match else ''
    trailing = trailing_match.group(0) if trailing_match else ''
    return leading + dst.strip() + trailing

def post_process_translation_format(src, dst):
    result = dst
    result = preserve_fenced_code_blocks(src, result)
    result = preserve_html_tags(src, result)
    result = preserve_markdown_link_targets(src, result)
    result = preserve_inline_code(src, result)
    result = preserve_urls_and_emails(src, result)
    result = preserve_placeholders(src, result)
    result = preserve_outer_ascii_wrapper(src, result)
    return preserve_boundary_whitespace(src, result)

def request_json(path, payload, timeout=60):
    req = urllib.request.Request(API + path, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8', 'replace'))

def lang_code(label):
    return LANG_CODE.get(label, label)

def translate(row, timeout=60):
    payload = {
        'text': row['source_text'],
        'source_language': lang_code(row['source_language']),
        'target_language': lang_code(row['target_language']),
        'mime_type': 'text/plain',
    }
    return request_json('/translate', payload, timeout=timeout)

def norm(text):
    return ''.join(str(text).strip().split())

def punct_shape(text):
    chars = '「」『』“”"\'（）()[]【】、。！？!?，,；;：:…—-'
    return ''.join(ch for ch in str(text) if ch in chars)

def outer_ascii_preserved(row, out):
    src = row['source_text'].strip()
    dst = out.strip()
    if len(src) >= 2 and src[0] in ('"', "'") and src[-1] == src[0]:
        return len(dst) >= 2 and dst[0] == src[0] and dst[-1] == src[-1]
    return True

def score(row, out):
    exact = norm(out) == norm(row['expected_translation'])
    acceptable = exact or any(norm(out) == norm(item) for item in row.get('acceptable_translations', []))
    punct_ok = True
    if row.get('strict_preserve_punctuation'):
        punct_ok = punct_shape(row['source_text']) == punct_shape(out)
    return exact, acceptable, punct_ok, outer_ascii_preserved(row, out)

def pct(a, b):
    return f'{(a / b * 100):.1f}%' if b else '0.0%'

rows_all = [json.loads(line) for line in SAMPLES.open(encoding='utf-8')]
row_by_id = {row['id']: row for row in rows_all}
ROWS = [row_by_id[test_id] for test_id in PRIMARY_TEST_IDS]
selected_ids = {row['id'] for row in ROWS}
for row in rows_all:
    if row['id'] in selected_ids:
        continue
    if row.get('variant') != 'plain':
        continue
    ROWS.append(row)
    selected_ids.add(row['id'])
    if len(ROWS) >= 30:
        break

OUT_JSONL.write_text('', encoding='utf-8')
print(json.dumps({'model': MODEL, 'samples': len(ROWS), 'endpoint': API + '/translate'}, ensure_ascii=False), flush=True)

results = []
for i, row in enumerate(ROWS, 1):
    rec = {'model': MODEL, **row}
    start = time.time()
    try:
        data = None
        last_exc = None
        for attempt in range(1, 4):
            try:
                data = translate(row)
                last_exc = None
                break
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, socket.timeout, ConnectionResetError, ConnectionError) as exc:
                last_exc = exc
                time.sleep(attempt * 1.5)
        if last_exc is not None:
            raise last_exc
        if data is None:
            raise RuntimeError('translate returned no data')
        raw_out = (data.get('translated_text') or '').strip()
        final_out = post_process_translation_format(row['source_text'], raw_out).strip()
        rec['latency_sec'] = round(time.time() - start, 3)
        rec['meta'] = {k: v for k, v in data.items() if k != 'translated_text'}
        rec['raw_model_output'] = raw_out
        rec['model_output'] = final_out
        rec['postprocessed_changed'] = raw_out != final_out
        if not final_out:
            rec['error'] = 'empty_output'
            print(f'[{i}/{len(ROWS)}] {row["id"]} ERROR empty_output', flush=True)
        else:
            exact, acc, punct, ascii_outer = score(row, final_out)
            raw_exact, raw_acc, raw_punct, raw_ascii_outer = score(row, raw_out)
            rec.update({
                'exact_match': exact,
                'acceptable_match': acc,
                'punctuation_ok': punct,
                'ascii_outer_ok': ascii_outer,
                'raw_exact_match': raw_exact,
                'raw_acceptable_match': raw_acc,
                'raw_punctuation_ok': raw_punct,
                'raw_ascii_outer_ok': raw_ascii_outer,
            })
            print(f'[{i}/{len(ROWS)}] {row["id"]} {row["language_direction"]} exact={exact} acc={acc} punct={punct} ascii={ascii_outer} changed={rec["postprocessed_changed"]} {rec["latency_sec"]}s out={final_out[:100]!r}', flush=True)
    except urllib.error.HTTPError as exc:
        rec['error'] = 'HTTP ' + str(exc.code)
        rec['error_body'] = exc.read().decode('utf-8', 'replace')[:1200]
        rec['latency_sec'] = round(time.time() - start, 3)
        print(f'[{i}/{len(ROWS)}] {row["id"]} ERROR {rec["error"]} {rec.get("error_body", "")[:160]}', flush=True)
    except (TimeoutError, socket.timeout) as exc:
        rec['error'] = 'timeout: ' + repr(exc)
        rec['latency_sec'] = round(time.time() - start, 3)
        print(f'[{i}/{len(ROWS)}] {row["id"]} ERROR {rec["error"]}', flush=True)
    except Exception as exc:
        rec['error'] = repr(exc)
        rec['latency_sec'] = round(time.time() - start, 3)
        print(f'[{i}/{len(ROWS)}] {row["id"]} ERROR {rec["error"]}', flush=True)
    results.append(rec)
    with OUT_JSONL.open('a', encoding='utf-8') as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + '\n')

ok = [row for row in results if 'error' not in row]
strict = [row for row in ok if row.get('strict_preserve_punctuation')]
latencies = [row['latency_sec'] for row in ok if isinstance(row.get('latency_sec'), (int, float))]
summary = {
    'model': MODEL,
    'requested_model': REQUESTED_MODEL,
    'actual_models': sorted({row.get('meta', {}).get('model', '') for row in ok if row.get('meta', {}).get('model')}),
    'endpoint': API + '/translate',
    'total_selected': len(ROWS),
    'completed': len(ok),
    'errors': len(results) - len(ok),
    'exact_matches': sum(row.get('exact_match', False) for row in ok),
    'acceptable_matches': sum(row.get('acceptable_match', False) for row in ok),
    'punctuation_ok': sum(row.get('punctuation_ok', False) for row in ok),
    'ascii_outer_ok': sum(row.get('ascii_outer_ok', False) for row in ok),
    'raw_punctuation_ok': sum(row.get('raw_punctuation_ok', False) for row in ok),
    'raw_ascii_outer_ok': sum(row.get('raw_ascii_outer_ok', False) for row in ok),
    'postprocessed_changed': sum(row.get('postprocessed_changed', False) for row in ok),
    'exact_rate': round(sum(row.get('exact_match', False) for row in ok) / len(ok), 4) if ok else 0,
    'acceptable_rate': round(sum(row.get('acceptable_match', False) for row in ok) / len(ok), 4) if ok else 0,
    'punctuation_ok_rate': round(sum(row.get('punctuation_ok', False) for row in ok) / len(ok), 4) if ok else 0,
    'ascii_outer_ok_rate': round(sum(row.get('ascii_outer_ok', False) for row in ok) / len(ok), 4) if ok else 0,
    'strict_count': len(strict),
    'strict_punctuation_ok_rate': round(sum(row.get('punctuation_ok', False) for row in strict) / len(strict), 4) if strict else 0,
    'raw_strict_punctuation_ok_rate': round(sum(row.get('raw_punctuation_ok', False) for row in strict) / len(strict), 4) if strict else 0,
    'latency_avg_sec': round(statistics.mean(latencies), 3) if latencies else 0,
    'latency_p50_sec': round(statistics.median(latencies), 3) if latencies else 0,
    'latency_max_sec': round(max(latencies), 3) if latencies else 0,
    'by_category': {},
    'by_direction': {},
    'output_jsonl': str(OUT_JSONL),
}
for category in sorted(set(row['category'] for row in ok)):
    items = [row for row in ok if row['category'] == category]
    summary['by_category'][category] = {
        'n': len(items),
        'exact': sum(row.get('exact_match', False) for row in items),
        'acceptable': sum(row.get('acceptable_match', False) for row in items),
        'punctuation_ok': sum(row.get('punctuation_ok', False) for row in items),
    }
for direction in sorted(set(row['language_direction'] for row in ok)):
    items = [row for row in ok if row['language_direction'] == direction]
    summary['by_direction'][direction] = {
        'n': len(items),
        'exact': sum(row.get('exact_match', False) for row in items),
        'acceptable': sum(row.get('acceptable_match', False) for row in items),
        'punctuation_ok': sum(row.get('punctuation_ok', False) for row in items),
        'ascii_outer_ok': sum(row.get('ascii_outer_ok', False) for row in items),
    }
OUT_SUMMARY.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

failures = [row for row in ok if not row.get('acceptable_match') or not row.get('punctuation_ok')]
changed = [row for row in ok if row.get('postprocessed_changed')]
report = []
report.append('# Google Cloud Translation 质量报告（当前 `/api/translate`）')
report.append('')
report.append(f'测试入口：`POST /api/translate`，后端 provider：`{MODEL}`，请求模型：`{REQUESTED_MODEL}`。')
if summary.get('actual_models'):
    report.append('实际返回模型：' + ', '.join(f'`{m}`' for m in summary['actual_models']))
report.append('样本：沿用上一轮 Gemini 翻译质量报告的 30 条代表样本与同一套 exact/acceptable/strict punctuation 评分口径。')
report.append('')
report.append('## 总体指标')
report.append('')
report.append(f'- 完成：{summary["completed"]}/{summary["total_selected"]}，错误：{summary["errors"]}')
report.append(f'- Exact match：{summary["exact_matches"]}/{summary["completed"]} = {pct(summary["exact_matches"], summary["completed"])}')
report.append(f'- Acceptable match：{summary["acceptable_matches"]}/{summary["completed"]} = {pct(summary["acceptable_matches"], summary["completed"])}')
report.append(f'- Punctuation OK（全部样本）：{summary["punctuation_ok"]}/{summary["completed"]} = {pct(summary["punctuation_ok"], summary["completed"])}')
report.append(f'- Strict punctuation OK（严格标点样本）：{pct(sum(row.get("punctuation_ok", False) for row in strict), len(strict))}')
report.append(f'- ASCII outer wrapper OK：{summary["ascii_outer_ok"]}/{summary["completed"]} = {pct(summary["ascii_outer_ok"], summary["completed"])}')
report.append(f'- 平均延迟：{summary["latency_avg_sec"]:.3f}s，P50：{summary["latency_p50_sec"]:.3f}s，最大：{summary["latency_max_sec"]:.3f}s')
report.append(f'- 后处理改变：{summary["postprocessed_changed"]}/{summary["completed"]}')
report.append('')
report.append('## 按类别统计')
report.append('')
report.append('|类别|样本数|Exact|Acceptable|Punctuation OK|')
report.append('|---|---:|---:|---:|---:|')
for cat, data in summary['by_category'].items():
    report.append(f'|{cat}|{data["n"]}|{data["exact"]}|{data["acceptable"]}|{data["punctuation_ok"]}|')
report.append('')
report.append('## 代表性未命中/风险样例')
report.append('')
report.append('|ID|方向|类别|原文|期望/可接受|实际|问题|')
report.append('|---|---|---|---|---|---|---|')
for row in failures[:12]:
    expected = row['expected_translation']
    alts = row.get('acceptable_translations') or []
    exp = expected + (' / ' + ' / '.join(alts[:2]) if alts else '')
    issues = []
    if not row.get('acceptable_match'):
        issues.append('未命中fixture')
    if not row.get('punctuation_ok'):
        issues.append('严格标点不一致')
    report.append(f'|{row["id"]}|{row["language_direction"]}|{row["category"]}|{row["source_text"]}|{exp}|{row.get("model_output", "")}|{"；".join(issues)}|')
report.append('')
report.append('## 后处理改变样例')
report.append('')
if changed:
    report.append('|ID|原始输出|后处理后|')
    report.append('|---|---|---|')
    for row in changed:
        report.append(f'|{row["id"]}|{row["raw_model_output"]}|{row["model_output"]}|')
else:
    report.append('本轮没有样本被 deterministic format guard 改写。')
report.append('')
report.append('## 产物')
report.append('')
report.append(f'- 原始逐条结果：`{OUT_JSONL.relative_to(ROOT)}`')
report.append(f'- 汇总 JSON：`{OUT_SUMMARY.relative_to(ROOT)}`')
report.append(f'- 本报告：`{OUT_REPORT.relative_to(ROOT)}`')
OUT_REPORT.write_text('\n'.join(report) + '\n', encoding='utf-8')
print('SUMMARY ' + json.dumps(summary, ensure_ascii=False), flush=True)
print('REPORT ' + str(OUT_REPORT), flush=True)
