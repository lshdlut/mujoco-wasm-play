#!/usr/bin/env python3
"""
Dev HTTP server for mujoco-wasm-play.

- Serves a given root directory (default: repository dev root)
- Ensures correct MIME types for .mjs/.js/.wasm
- Adds security/cache headers:
  X-Content-Type-Options: nosniff
  Cache-Control: public, max-age=0, must-revalidate

Usage:
  # From the repo root:
  python dev/dev_server.py --root dev --port 8000
  # From the dev/ directory:
  python dev_server.py --root . --port 8000
"""
from __future__ import annotations
import argparse
import http.server
import mimetypes
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PARENT_ROOT = REPO_ROOT.parent
MOUNTS = {
    # Allow serving the repo root under a stable prefix, even when `--root` points
    # at `dev/` (or any other subdir). This keeps local dev URLs compatible with
    # GitHub Pages-style paths.
    "/mujoco-wasm-play/": REPO_ROOT,
    # If the sibling forge repo exists next to mujoco-wasm-play, mount it so the
    # viewer can fetch `/mujoco-wasm-forge/dist/<ver>/...` on localhost.
    "/mujoco-wasm-forge/": PARENT_ROOT / "mujoco-wasm-forge",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def _has_header(self, name: str) -> bool:
        prefix = (name + ":").lower().encode("latin-1")
        for line in getattr(self, "_headers_buffer", []):
            if isinstance(line, (bytes, bytearray)) and line.lower().startswith(prefix):
                return True
        return False

    def translate_path(self, path: str) -> str:  # type: ignore[override]
        cleaned = path.split('?', 1)[0].split('#', 1)[0]
        for prefix, root in MOUNTS.items():
            if cleaned == prefix.rstrip("/") or cleaned.startswith(prefix):
                rel = cleaned[len(prefix):].lstrip("/")
                target = (root / rel).resolve()
                if os.environ.get("PLAY_DEV_SERVER_DEBUG_MOUNTS") == "1":
                    try:
                        exists = target.exists()
                    except OSError:
                        exists = False
                    print(f"[dev_server] mount {cleaned} -> {target} (exists={exists})", file=sys.stderr, flush=True)
                return str(target)
        return super().translate_path(path)

    def end_headers(self) -> None:  # type: ignore[override]
        # Security/cache headers
        if not self._has_header("X-Content-Type-Options"):
            self.send_header("X-Content-Type-Options", "nosniff")
        if not self._has_header("Cache-Control"):
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
        if os.environ.get("PLAY_DEV_SERVER_DEBUG_MOUNTS") == "1":
            if "mujoco-wasm-forge" in cleaned or "dist/" in cleaned or cleaned.endswith("mujoco.js"):
                print(
                    f"[dev_server] send_head cleaned={cleaned} path={path} exists={os.path.exists(path)} force_ok={force_ok}",
                    file=sys.stderr,
                    flush=True,
                )

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
        self.end_headers()
        return f


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="directory to serve")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    os.chdir(root)
    if os.environ.get("PLAY_DEV_SERVER_DEBUG_MOUNTS") == "1":
        print(f"[dev_server] REPO_ROOT={REPO_ROOT}", file=sys.stderr, flush=True)
        print(f"[dev_server] PARENT_ROOT={PARENT_ROOT}", file=sys.stderr, flush=True)
        print(f"[dev_server] MOUNTS={MOUNTS}", file=sys.stderr, flush=True)
        print(f"[dev_server] CWD={Path.cwd()}", file=sys.stderr, flush=True)
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
