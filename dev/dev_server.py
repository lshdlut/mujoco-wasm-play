#!/usr/bin/env python3
"""
Dev HTTP server for mujoco-wasm-play.

- Serves a given root directory (default: repository dev root)
- Ensures correct MIME types for .mjs/.js/.wasm
- Adds security/cache headers:
  X-Content-Type-Options: nosniff
  Cache-Control: public, max-age=0, must-revalidate

Usage:
  python scripts/dev_server.py --root . --port 8080
"""
from __future__ import annotations
import argparse
import http.server
import mimetypes
import os
from functools import partial


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:  # type: ignore[override]
        # Security/cache headers
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=0, must-revalidate")
        # Avoid Expires header; base class doesn't add it
        super().end_headers()

    def guess_type(self, path: str) -> str:  # type: ignore[override]
        # Strip query/hash so extension detection works for URLs like foo.mjs?cb=123
        p = path.split('?', 1)[0].split('#', 1)[0]
        _base, ext = os.path.splitext(p)
        ext = ext.lower()
        if ext in (".mjs", ".js"):
            return "text/javascript; charset=utf-8"
        if ext == ".wasm":
            return "application/wasm"
        ctype = mimetypes.types_map.get(ext)
        if ctype is None:
            return "application/octet-stream"
        # ensure utf-8 for text types
        if ctype.startswith("text/") and "charset=" not in ctype:
            ctype += "; charset=utf-8"
        return ctype

    # For ESM and WASM, always return 200 with entity to avoid 304 without a usable body
    def send_head(self):  # type: ignore[override]
        # Normalize and translate path (strip query/hash)
        raw = self.path
        cleaned = raw.split('?', 1)[0].split('#', 1)[0]
        path = self.translate_path(cleaned)
        _base, ext = os.path.splitext(path)
        ext = ext.lower()
        force_ok = ext in ('.mjs', '.js', '.wasm')

        if not force_ok:
            return super().send_head()

        # Directory handling (delegate to default index behavior)
        if os.path.isdir(path):
            for index in ("index.html", "index.htm"):
                index_path = os.path.join(path, index)
                if os.path.exists(index_path):
                    path = index_path
                    break

        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None

        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404, "File not found")
            return None

        ctype = self.guess_type(path)
        fs = os.fstat(f.fileno())
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(fs.st_size))
        # Disable conditional caching to avoid 304 for worker/esm/wasm
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        return f


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="directory to serve")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    os.chdir(root)
    httpd = http.server.ThreadingHTTPServer(("", args.port), Handler)
    print(f"Serving {root} on http://localhost:{args.port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()



