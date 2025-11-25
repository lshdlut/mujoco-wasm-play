from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright


def main() -> None:
  url = (
      "http://127.0.0.1:4173/index.html"
      "?model=RKOB_simplified_upper_with_marker_CAMS.xml"
      "&mode=worker&debug=1&skydebug=cube"
  )
  repo_root = Path(__file__).resolve().parents[2]
  out_dir = repo_root / "local_temp"
  out_dir.mkdir(parents=True, exist_ok=True)

  dev_dir = repo_root / "dev"
  server = subprocess.Popen(
      [sys.executable, "dev_server.py", "--root", ".", "--port", "4173"],
      cwd=str(dev_dir),
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
  )

  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 900, "height": 1600})

    def on_console(msg):
      try:
        print("[page-console]", msg.type, msg.text)
      except Exception:
        pass

    page.on("console", on_console)
    page.goto(url)
    page.wait_for_function(
        """() => {
          const w = window;
          const stats = w?.__viewerRenderer?.getStats?.() || {};
          const ctx = w?.__renderCtx;
          return stats.drawn > 0 && ctx?.renderer && ctx?.camera;
        }""",
        timeout=30000,
    )

    info = page.evaluate(
        """() => {
          const store = window.__viewerStore;
          const ctx = window.__renderCtx;
          const state = store?.get?.();
          const scene = ctx?.sceneWorld || ctx?.scene || null;
          const bg = scene?.background;
          const dbg = Array.isArray(ctx?._skyDebug) ? ctx._skyDebug : [];
          const lastMode = dbg.length ? dbg[dbg.length - 1] : null;
          const tex = state?.rendering?.assets?.textures;
          const sampleFromTexture = () => {
            if (!tex?.data || !tex.width || !tex.height || !tex.nchannel || !tex.type) return null;
            const idx = (tex.type[0] ?? 0) === 2 ? 0 : -1;
            if (idx !== 0) return null;
            const width = tex.width[0] ?? 0;
            const height = tex.height[0] ?? 0;
            const nchan = tex.nchannel[0] ?? 0;
            const data = tex.data;
            if (!(width > 0 && height > 0 && nchan > 0)) return null;
            const stride = width * nchan;
            const first = Array.from(data.slice(0, Math.min(3, nchan))).map((v) => Number(v));
            const last = Array.from(
              data.slice(Math.max(0, data.length - nchan), data.length)
            ).map((v) => Number(v));
            const midIdx = Math.max(
              0,
              Math.min(data.length - nchan, Math.floor(height * stride * 0.5)),
            );
            const mid = Array.from(
              data.slice(midIdx, midIdx + Math.min(3, nchan))
            ).map((v) => Number(v));
            return { width, height, nchan, first, mid, last };
          };
          return {
            sceneFlags: state?.rendering?.sceneFlags,
            visualSourceMode: state?.visualSourceMode,
            textures: tex
              ? {
                  count: tex.count ?? null,
                  type: tex.type?.slice?.(0, 6) ?? null,
                  width: tex.width?.slice?.(0, 6) ?? null,
                  height: tex.height?.slice?.(0, 6) ?? null,
                  nchannel: tex.nchannel?.slice?.(0, 6) ?? null,
                  adr: tex.adr?.slice?.(0, 6) ?? null,
                  dataLen: tex.data?.length ?? 0,
                  sample: sampleFromTexture(),
                }
              : null,
            skyMode: lastMode?.mode || lastMode,
            bgType: !bg
              ? "none"
              : bg.isCubeTexture
                ? "cube"
                : bg.isTexture
                  ? "texture"
                  : bg.isColor
                    ? "color"
                    : "other",
            skyDebugTail: dbg.slice(-6),
          };
        }"""
    )

    print("[sky-debug/info]", json.dumps(info, indent=2))

    tex = page.evaluate(
        """() => {
          const store = window.__viewerStore;
          const state = store?.get?.();
          const tex = state?.rendering?.assets?.textures;
          if (!tex || !tex.data || !tex.width || !tex.height || !tex.nchannel || !tex.type || !tex.adr) {
            return null;
          }
          const count = tex.type.length | 0;
          let idx = -1;
          for (let i = 0; i < count; i += 1) {
            if ((tex.type[i] | 0) === 2) { idx = i; break; }
          }
          if (idx < 0) return null;
          const width = tex.width[idx] | 0;
          const height = tex.height[idx] | 0;
          const nchan = tex.nchannel[idx] | 0;
          const adr = tex.adr[idx] | 0;
          if (!(width > 0 && height > 0 && nchan > 0)) return null;
          const texSize = width * height * nchan;
          const nextAdr = idx + 1 < count ? (tex.adr[idx + 1] | 0) : adr + texSize;
          const start = Math.max(0, adr);
          const end = Math.min(tex.data.length, nextAdr);
          if (end - start < texSize) {
            return { error: 'slice-too-small', have: end - start, need: texSize };
          }
          const data = Array.from(tex.data.slice(start, start + texSize));
          return { width, height, nchan, data };
        }"""
    )

    if isinstance(tex, dict) and "data" in tex and not tex.get("error"):
      width = int(tex["width"])
      height = int(tex["height"])
      nchan = int(tex["nchan"])
      buf = bytes(int(v) & 0xFF for v in tex["data"])
      mode = "RGB" if nchan >= 3 else "L"
      img = Image.frombytes(mode, (width, height), buf)
      out_path = out_dir / "rkob_skybox_strip.png"
      img.save(out_path)
      print("[sky-debug/image]", str(out_path))
    else:
      print("[sky-debug/image] no-skybox-data", tex)

    browser.close()

  server.terminate()


if __name__ == "__main__":
  main()
