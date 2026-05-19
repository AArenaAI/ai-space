#!/usr/bin/env python3
import base64, hashlib, hmac, json, time, urllib.request, urllib.error
from pathlib import Path
BASE = "http://localhost:9091"
ROOT = Path('/workspace/aipool/backend')
ENV = ROOT/'.env'
OUT = ROOT/'tmp_image_edit_test_result.json'
IMG = ROOT/'tmp_image_source.png'

def read_env(path):
    env={}
    for line in path.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1); env[k.strip()]=v.strip().strip('"').strip("'")
    return env

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(secret):
    now=int(time.time())
    h={'alg':'HS256','typ':'JWT'}; p={'user_id':3,'email':'belugachen@local','iat':now,'exp':now+604800}
    s=b64url(json.dumps(h,separators=(',',':')).encode())+'.'+b64url(json.dumps(p,separators=(',',':')).encode())
    return s+'.'+b64url(hmac.new(secret.encode(),s.encode(),hashlib.sha256).digest())

def req(method,path,token=None,payload=None,timeout=30):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    data=json.dumps(payload).encode() if payload is not None else None
    r=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(r,timeout=timeout) as resp:
            body=resp.read().decode('utf-8','replace')
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        body=e.read().decode('utf-8','replace')
        try: body=json.loads(body)
        except Exception: pass
        return e.code, body

def ensure_img():
    if IMG.exists(): return base64.b64encode(IMG.read_bytes()).decode()
    from PIL import Image, ImageDraw
    im=Image.new('RGB',(512,512),(33,150,243)); d=ImageDraw.Draw(im)
    d.rectangle([0,330,512,512],fill=(40,180,99)); d.ellipse([150,95,362,360],fill=(250,210,90),outline=(40,40,40),width=6)
    d.rectangle([205,260,307,420],fill=(250,210,90),outline=(40,40,40),width=6)
    d.text((115,32),'REMOVE TEXT',fill=(255,255,255)); d.text((155,455),'AI POOL TEST',fill=(255,255,255))
    im.save(IMG); return base64.b64encode(IMG.read_bytes()).decode()

def poll(token,id,max_wait=420):
    st=time.time(); last=None
    while time.time()-st<max_wait:
        c,b=req('GET',f'/api/images/{id}',token=token,timeout=20)
        if c!=200: return {'status':'poll_error','http_code':c,'body':b,'elapsed_sec':round(time.time()-st,2)}
        last=b; s=b.get('status')
        if s in ('completed','failed'):
            return {'status':s,'image_url':b.get('image_url'),'error_message':b.get('error_message'),'elapsed_sec':round(time.time()-st,2)}
        time.sleep(3)
    return {'status':'timeout','elapsed_sec':round(time.time()-st,2),'raw':last}

def main():
    token=jwt(read_env(ENV).get('JWT_SECRET') or 'aipool-secret-key-change-in-production')
    img=ensure_img()
    tests=[
      ('背景移除', {'edit_mode':'remove-bg','image_data':img,'size':'1024x1024'}),
      ('背景替换', {'edit_mode':'replace-bg','prompt':'Replace the background with a cyberpunk neon city at night','image_data':img,'size':'1024x1024'}),
      ('文字移除', {'edit_mode':'text-removal','prompt':'Remove the visible text REMOVE TEXT and AI POOL TEST','image_data':img,'size':'1024x1024'}),
      ('画质提升', {'edit_mode':'upscale','image_data':img,'size':'1024x1024'}),
    ]
    results=[]
    for name,payload in tests:
        t=time.time(); c,b=req('POST','/api/images/edit',token=token,payload=payload,timeout=30)
        item={'name':name,'submit_http':c,'submit_elapsed_sec':round(time.time()-t,2)}
        if c==200:
            item['id']=b.get('id'); item['created_at']=b.get('created_at'); item.update(poll(token,item['id']))
        else:
            item['submit_body']=b
        results.append(item); print(json.dumps(item,ensure_ascii=False),flush=True)
    OUT.write_text(json.dumps({'results':results},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
