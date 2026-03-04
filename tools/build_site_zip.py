#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import sys
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

ALLOWLIST = [
    "index.html",
    "favicon.ico",
    "site_config.js",
    "pthreads",
    "app",
    "assets",
    "backend",
    "bridge",
    "core",
    "environment",
    "model",
    "plugins",
    "renderer",
    "spec",
    "ui",
    "worker",
]


def iter_files(rel_path: str) -> list[Path]:
    root = (REPO_ROOT / rel_path).resolve()
    if not root.exists():
        raise FileNotFoundError(f"Missing allowlisted path: {rel_path}")
    if root.is_file():
        return [root]
    files: list[Path] = []
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        # Avoid accidental inclusion of local OS/editor noise.
        if p.name in {".DS_Store", "Thumbs.db"}:
            continue
        files.append(p)
    return files


def to_rel(path: Path) -> str:
    rel = path.resolve().relative_to(REPO_ROOT.resolve())
    return str(rel).replace(os.sep, "/")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a static site.zip for mujoco-wasm-play (without forge dist).")
    ap.add_argument("--out", default=str(REPO_ROOT / "release_assets" / "site.zip"), help="output zip path")
    args = ap.parse_args()

    out_path = Path(args.out).expanduser()
    if not out_path.is_absolute():
        out_path = (REPO_ROOT / out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    files: list[Path] = []
    for entry in ALLOWLIST:
        files.extend(iter_files(entry))
    files = sorted({p.resolve() for p in files}, key=lambda p: to_rel(p))

    if not files:
        raise RuntimeError("No files selected for packaging (unexpected).")

    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in files:
            arc = to_rel(p)
            zf.write(p, arcname=arc)

    tmp_path.replace(out_path)
    print(f"Built {out_path} ({len(files)} files)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

