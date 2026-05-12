#!/usr/bin/env python3
"""
Simple static file server + API proxy for AI Space frontend.
Serves frontend/dist/ static files and proxies /api/* to Go backend.
"""
import http.server
import urllib.request
import urllib.error
import os
import sys
import json

BACKEND_URL = "http://localhost:9091"
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def _proxy(self, method):
        url = BACKEND_URL + self.path
        body = None
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            body = self.rfile.read(content_length)

        try:
            req = urllib.request.Request(url, data=body, method=method)
            # Forward auth headers
            auth = self.headers.get("Authorization")
            if auth:
                req.add_header("Authorization", auth)
            req.add_header("Content-Type", self.headers.get("Content-Type", "application/json"))

            with urllib.request.urlopen(req) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self._proxy("PUT")
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self._proxy("DELETE")
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9090
    server = http.server.HTTPServer(("0.0.0.0", port), ProxyHandler)
    print(f"🚀 Serving {FRONTEND_DIR} + API proxy on port {port}")
    server.serve_forever()
