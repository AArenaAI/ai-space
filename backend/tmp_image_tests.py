#!/usr/bin/env python3
import base64, hashlib, hmac, json, os, sys, time, urllib.request, urllib.error
from pathlib import Path

BASE = "http://localhost:9091"
ROOT = Path('/workspace/aipool/backend')
ENV = ROOT / '.env'
OUT = ROOT / 'tmp_image_test_result.json'
IMG = ROOT / 'tmp_image_source.png'


def read_env(path):
    env = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def make_jwt(secret: str, user_id=3, email='belugachen@local') -> str:
    now = int(time.time())
    header = {'alg': 'HS256', 'typ': 'JWT'}
    payload = {'user_id': user_id, 'email': email, 'iat': now, 'exp': now + 7*24*3600}
    signing_input = b64url(json.dumps(header, separators=(',', ':')).encode()) + '.' + b64url(json.dumps(payload, separators=(',', ':')).encode())
    sig = hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    return signing_input + '.' + b64url(sig)


def request(method, path, token=None, payload=None, timeout=30):
    data = None
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    if payload is not None:
        data = json.dumps(payload).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode('utf-8', 'replace')
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = body
        return e.code, parsed


def create_test_image():
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception as e:
        raise RuntimeError('Pillow not available: ' + str(e))
    img = Image.new('RGB', (512, 512), (33, 150, 243))
    draw = ImageDraw.Draw(img)
    # background blocks
    draw.rectangle([0, 330, 512, 512], fill=(40, 180, 99))
    draw.ellipse([150, 95, 362, 360], fill=(250, 210, 90), outline=(40, 40, 40), width=6)
    draw.rectangle([205, 260, 307, 420], fill=(250, 210, 90), outline=(40, 40, 40), width=6)
    draw.text((115, 32), 'REMOVE TEXT', fill=(255, 255, 255))
    draw.text((155, 455), 'AI POOL TEST', fill=(255, 255, 255))
    img.save(IMG)
    return base64.b64encode(IMG.read_bytes()).decode()


def poll_image(token, image_id, max_wait=360):
    start = time.time()
    last = None
    while time.time() - start < max_wait:
        code, body = request('GET', f'/api/images/{image_id}', token=token, timeout=20)
        if code != 200:
            return {'status': 'poll_error', 'http_code': code, 'body': body, 'elapsed_sec': round(time.time()-start, 2)}
        last = body
        st = body.get('status')
        if st in ('completed', 'failed'):
            return {'status': st, 'image_url': body.get('image_url'), 'error_message': body.get('error_message'), 'elapsed_sec': round(time.time()-start, 2), 'raw': body}
        time.sleep(3)
    return {'status': 'timeout', 'elapsed_sec': round(time.time()-start, 2), 'raw': last}


def main():
    env = read_env(ENV)
    token = make_jwt(env.get('JWT_SECRET') or 'aipool-secret-key-change-in-production')
    code, health = request('GET', '/health', timeout=10)
    if code != 200:
        raise SystemExit(f'health failed: {code} {health}')
    img_b64 = create_test_image()

    tests = [
        ('生图', '/api/images/generate', {
            'prompt': 'A clean product photo of a small white robot holding a blue umbrella, studio lighting, plain background',
            'aspect_ratio': '1:1', 'resolution': '1K', 'quality': 'medium'
        }),
        ('背景移除', '/api/images/edit', {'edit_mode': 'remove-bg', 'image_data': img_b64, 'size': '1024x1024'}),
        ('背景替换', '/api/images/edit', {'edit_mode': 'replace-bg', 'prompt': 'Replace the background with a cyberpunk neon city at night', 'image_data': img_b64, 'size': '1024x1024'}),
        ('文字移除', '/api/images/edit', {'edit_mode': 'text-removal', 'prompt': 'Remove the visible text REMOVE TEXT and AI POOL TEST', 'image_data': img_b64, 'size': '1024x1024'}),
        ('画质提升', '/api/images/edit', {'edit_mode': 'upscale', 'image_data': img_b64, 'size': '1024x1024'}),
    ]
    results = []
    for name, path, payload in tests:
        submit_start = time.time()
        code, body = request('POST', path, token=token, payload=payload, timeout=30)
        submit_elapsed = round(time.time() - submit_start, 2)
        item = {'name': name, 'submit_http': code, 'submit_elapsed_sec': submit_elapsed}
        if code != 200:
            item['submit_body'] = body
            results.append(item)
            print(json.dumps(item, ensure_ascii=False), flush=True)
            continue
        image_id = body.get('id')
        item['id'] = image_id
        item['created_at'] = body.get('created_at')
        poll = poll_image(token, image_id)
        item.update({k:v for k,v in poll.items() if k != 'raw'})
        results.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    OUT.write_text(json.dumps({'base': BASE, 'results': results}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
