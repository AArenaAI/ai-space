#!/usr/bin/env python3
import urllib.request, json, time, struct, zlib, random, string, sys

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

# Login
login_req = urllib.request.Request(
    'http://localhost:9091/api/auth/login',
    data=json.dumps({'email':'debug3@test.com','password':'test123'}).encode(),
    headers={'Content-Type':'application/json'}, method='POST'
)
token = json.loads(urllib.request.urlopen(login_req, timeout=10).read())['token']

# Upload a 100x100 image
img_data = create_png(100, 100)
boundary = '----' + ''.join(random.choices(string.ascii_letters+string.digits, k=30))
body = b'\r\n'.join([
    f'--{boundary}'.encode(),
    b'Content-Disposition: form-data; name="file"; filename="test.png"',
    b'Content-Type: image/png', b'', img_data,
    f'--{boundary}--'.encode(),
])
req = urllib.request.Request(
    'http://localhost:9091/api/files/upload',
    data=body,
    headers={'Authorization': f'Bearer {token}', 'Content-Type': f'multipart/form-data; boundary={boundary}'},
    method='POST'
)
pid = json.loads(urllib.request.urlopen(req, timeout=10).read()).get('public_id')
print(f'Uploaded: public_id={pid}')
sys.stdout.flush()

# Test edit via public nginx - multiple trials to see timing pattern
for trial in range(2):
    start = time.time()
    edit_req = urllib.request.Request(
        'https://mideastsim.clawdbotgame.com/api/images/edit',
        data=json.dumps({'image_url':pid,'edit_mode':'upscale'}).encode(),
        headers={'Content-Type':'application/json','Authorization':f'Bearer {token}'},
        method='POST'
    )
    try:
        resp = urllib.request.urlopen(edit_req, timeout=300)
        elapsed = time.time() - start
        print(f'Trial {trial+1}: Success @{elapsed:.1f}s')
    except Exception as e:
        elapsed = time.time() - start
        code = e.code if hasattr(e, 'code') else type(e).__name__
        print(f'Trial {trial+1}: Fail @{elapsed:.1f}s code={code}')
        if hasattr(e, 'read'):
            print(f'  Body: {e.read().decode()[:200]}')
        break
    sys.stdout.flush()
