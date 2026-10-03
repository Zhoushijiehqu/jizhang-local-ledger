#!/usr/bin/env python3
"""
记账 · 本地静态服务器（零依赖，用 macOS 自带的 python3）

用途：把 web/dist 里的构建产物用正确 MIME 提供出去，供浏览器打开本地应用。
特点：
  - 显式声明 .wasm 等 MIME（避免浏览器以错误类型加载 WebAssembly）
  - 关闭缓存（本地应用，改了代码刷新就生效）
  - 端口被占用时自动退避
数据仍在浏览器本地（IndexedDB），本服务只负责"送页面"，不接触任何账本数据。
"""
import http.server
import os
import socket
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".map": "application/json",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in MIME:
            return MIME[ext]
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默；日志由启动器统一收集


def free_port(start: int, tries: int = 20) -> int:
    for p in range(start, start + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start


def main():
    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        print(f"[记账] 未找到构建产物：{ROOT}/index.html", file=sys.stderr)
        print("[记账] 请先在 web 目录执行：npm run build", file=sys.stderr)
        sys.exit(1)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else free_port(8787)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"[记账] 已启动：http://127.0.0.1:{port}  （仅监听本机，Ctrl+C 停止）", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[记账] 已停止", flush=True)


if __name__ == "__main__":
    main()
