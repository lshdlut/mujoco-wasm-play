#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import subprocess
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


def validate_checkout_eol(files: list[Path]) -> None:
    # The existing Git attributes prescribe LF, but a clean Windows checkout can
    # retain older CRLF bytes. Refuse those inputs rather than rewriting assets.
    selected = {to_rel(p) for p in files}
    result = subprocess.run(
        ["git", "--literal-pathspecs", "ls-files", "--eol", "-z", "--", *sorted(selected)], cwd=REPO_ROOT,
        check=True, stdout=subprocess.PIPE,
    )
    mismatches = []
    for record in result.stdout.decode("utf-8").split("\0"):
        metadata, _, name = record.partition("\t")
        if name in selected and "i/lf" in metadata and (
            "w/crlf" in metadata or "w/mixed" in metadata
        ):
            mismatches.append(name)
    if mismatches:
        raise RuntimeError(
            "Packaging requires the canonical LF checkout prescribed by .gitattributes. "
            "Use a fresh checkout or deliberately normalize these files before packaging: "
            + ", ".join(sorted(mismatches))
        )


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a static site.zip for mujoco-wasm-play (without forge dist).")
    ap.add_argument("--out", default=os.environ.get("MJ_WASM_PLAY_RELEASE_ZIP", r"C:\dev\mujoco-wasm-play\release_assets\site.zip"), help="output zip path")
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

    validate_checkout_eol(files)

    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in files:
            arc = to_rel(p)
            # Fixed metadata makes releases reproducible from committed bytes,
            # regardless of checkout time or the runner's operating system.
            info = zipfile.ZipInfo(arc, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            zf.writestr(info, p.read_bytes(), compresslevel=9)

    tmp_path.replace(out_path)
    print(f"Built {out_path} ({len(files)} files)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
