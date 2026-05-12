#!/usr/bin/env python3
"""
简易 HTTP 服务器，服务前端静态文件并把 /api/* 代理到后端。
替代 python3 -m http.server，解决直接暴露端口时 API 请求找不到后端的问题。
"""
import http.server
import urllib.request
import os
import sys
import json

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:9091")
FRONTEND_DIR = os.environ.get("FRONTEND_DIR", os.path.dirname(os.path.abspath(__file__)))

class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def do_PROXY(self, method):
        """代理 /api/* 请求到后端"""
        path = self.path
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else None

        url = f"{BACKEND_URL}{path}"
        req = urllib.request.Request(url, data=body, method=method)

        # 复制请求头
        for key, val in self.headers.items():
            if key.lower() not in ("host", "connection", "accept-encoding"):
                req.add_header(key, val)

        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                self.send_response(resp.status)
                # 复制响应头（排除 transfer-encoding/chunked，我们要统一发送）
                for key, val in resp.headers.items():
                    if key.lower() not in ("transfer-encoding", "content-encoding", "content-length"):
                        self.send_header(key, val)
                # SSE 流式响应：逐块转发
                if resp.headers.get("Content-Type", "").startswith("text/event-stream"):
                    self.end_headers()
                    while True:
                        chunk = resp.read(4096)
                        if not chunk:
                            break
                        try:
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        except BrokenPipeError:
                            break
                else:
                    data = resp.read()
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(e.read())
        except urllib.error.URLError as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"后端连接失败: {e.reason}"}).encode())
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.do_PROXY("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            return self.do_PROXY("POST")
        return super().do_POST()

    def do_PUT(self):
        if self.path.startswith("/api/"):
            return self.do_PROXY("PUT")
        return super().do_PUT()

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            return self.do_PROXY("DELETE")
        return super().do_DELETE()

    def do_OPTIONS(self):
        if self.path.startswith("/api/"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.end_headers()
        else:
            self.send_response(204)
            self.end_headers()

    def log_message(self, format, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {self.address_string()} - {format % args}\n")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9090"))
    server = http.server.HTTPServer(("0.0.0.0", port), ProxyHandler)
    print(f"🚀 前端服务 (带 API 代理) 运行在 http://0.0.0.0:{port}")
    print(f"📡 API 代理指向: {BACKEND_URL}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 服务关闭")
        server.server_close()
