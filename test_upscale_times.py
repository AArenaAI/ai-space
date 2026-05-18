#!/usr/bin/env python3
"""Test upscale via public nginx 3 times to check timing"""
import urllib.request, json, time, struct, zlib, random, string

def create_png(w, h):
    raw = b''
    for y in range(h):
        raw += b'\x00' + b'\x00\x00\xff' * w
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

login_req = urllib.request.Request(
    'http://localhost:9091/api/auth/login',
    data=json.dumps({'email':'debug3@test.com','password':'test123'}).encode(),
    headers={'Content-Type':'application/json'}, method='POST'
)
token = json.loads(urllib.request.urlopen(login_req, timeout=10).read())['token']

img_data = create_png(200, 200)
boundary = '----' + ''.join(random.choices(string.ascii_letters+string.digits, k=30))
body = b'\r\n'.join([
    f'--{boundary}'.encode(),
    b'Content-Disposition: form-data; name="file"; filename="t.png"',
    b'Content-Type: image/png', b'', img_data,
    f'--{boundary}--'.encode(),
])
req = urllib.request.Request(
    'http://localhost:9091/api/files/upload',
    data=body, headers={'Authorization': f'Bearer {token}', 'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST'
)
pid = json.loads(urllib.request.urlopen(req, timeout=10).read()).get('public_id')
print(f'pid={pid}', flush=True)

times = []
for i in range(3):
    start = time.time()
    try:
        req2 = urllib.request.Request(
            'https://mideastsim.clawdbotgame.com/api/images/edit',
            data=json.dumps({'image_url':pid,'edit_mode':'upscale'}).encode(),
            headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
            method='POST'
        )
        resp = urllib.request.urlopen(req2, timeout=120)
        t = time.time() - start
        times.append(t)
        print(f'#{i+1}: {t:.1f}s OK', flush=True)
    except Exception as e:
        t = time.time() - start
        code = e.code if hasattr(e,'code') else '?'
        print(f'#{i+1}: {t:.1f}s FAIL code={code}', flush=True)
        if hasattr(e,'read'): print(f'  {e.read().decode()[:200]}', flush=True)
        break
if times:
    print(f'Avg: {sum(times)/len(times):.1f}s, Max: {max(times):.1f}s', flush=True)
