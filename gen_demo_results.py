#!/usr/bin/env python3
"""Upload a test image and run all 4 edit modes to get real result images"""
import urllib.request, json, time, struct, zlib, random, string, os, sys

BASE = 'http://localhost:9091'

# Test image (a colorful 400x300 PNG)
def create_png(w, h):
    raw = b''
    for y in range(h):
        raw += b'\x00'  # filter byte
        for x in range(w):
            r = (x * 255) // w
            g = (y * 255) // h
            b_val = 128 + (x + y) % 64
            raw += bytes([r, g, b_val])
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

# Login
login_req = urllib.request.Request(
    f'{BASE}/api/auth/login',
    data=json.dumps({'email':'debug3@test.com','password':'test123'}).encode(),
    headers={'Content-Type':'application/json'}, method='POST'
)
token = json.loads(urllib.request.urlopen(login_req, timeout=10).read())['token']
print(f'Token obtained', flush=True)

# Upload
img_data = create_png(400, 300)
boundary = '----' + ''.join(random.choices(string.ascii_letters+string.digits, k=30))
body = b'\r\n'.join([
    f'--{boundary}'.encode(),
    b'Content-Disposition: form-data; name="file"; filename="demo.png"',
    b'Content-Type: image/png', b'', img_data,
    f'--{boundary}--'.encode(),
])
req = urllib.request.Request(
    f'{BASE}/api/files/upload',
    data=body, headers={'Authorization': f'Bearer {token}', 'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST'
)
pid = json.loads(urllib.request.urlopen(req, timeout=10).read()).get('public_id')
print(f'Uploaded: public_id={pid}', flush=True)

# Run all 4 modes
modes = [
    ('remove-bg', {"image_url": pid, "edit_mode": "remove-bg"}),
    ('replace-bg', {"image_url": pid, "edit_mode": "replace-bg", "prompt": "a sunny beach with palm trees"}),
    ('text-removal', {"image_url": pid, "edit_mode": "text-removal", "prompt": "remove any text overlay from the image"}),
    ('upscale', {"image_url": pid, "edit_mode": "upscale"}),
]

results = {}
for name, payload in modes:
    start = time.time()
    try:
        req2 = urllib.request.Request(
            f'{BASE}/api/images/edit',
            data=json.dumps(payload).encode(),
            headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
            method='POST'
        )
        resp = urllib.request.urlopen(req2, timeout=300)
        t = time.time() - start
        data = json.loads(resp.read())
        img_url = data.get('image_url', '')
        results[name] = {'url': BASE + '/api/images/file/' + img_url if img_url else '', 'time': f'{t:.0f}s'}
        print(f'{name}: {t:.0f}s -> {img_url}', flush=True)
    except Exception as e:
        t = time.time() - start
        err_body = ''
        if hasattr(e,'read'):
            try: err_body = e.read().decode()[:200]
            except: pass
        results[name] = {'error': f'{type(e).__name__}: {err_body}', 'time': f'{t:.0f}s'}
        print(f'{name}: FAIL @{t:.0f}s - {err_body}', flush=True)

# Output as JSON for the next step
print('\n=== RESULTS ===', flush=True)
print(json.dumps(results, indent=2), flush=True)
