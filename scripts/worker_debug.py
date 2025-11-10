import argparse
import asyncio
import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from dataclasses import dataclass, field
from typing import List, Optional

import urllib.error
import urllib.request

from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeoutError


def resolve_repo_root() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def launch_dev_server(python_exe: str, port: int) -> subprocess.Popen:
    root = resolve_repo_root()
    cmd = [
        python_exe,
        os.path.join(root, "scripts", "dev_server.py"),
        "--root",
        root,
        "--port",
        str(port),
    ]
    creationflags = 0
    if os.name == "nt":
        creationflags = 0x00000200  # CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen(
        cmd,
        cwd=root,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        creationflags=creationflags,
    )
    return proc


async def wait_for_server(port: int, timeout: float = 10.0) -> None:
    url = f"http://localhost:{port}/"
    start = time.time()
    while True:
        try:
            with urllib.request.urlopen(url) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, ConnectionRefusedError):
            pass
        await asyncio.sleep(0.2)
        if time.time() - start > timeout:
            raise TimeoutError(f"Server on port {port} did not respond within {timeout} seconds")


@dataclass
class LogBundle:
    console: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    responses: List[str] = field(default_factory=list)


async def gather_page_state(page: Page) -> dict:
    js = """
    () => {
        const overlay = document.getElementById('overlay');
        const hud = overlay ? overlay.textContent : null;
        const stats = {
            overlay: hud,
            hasWorker: !!window.worker,
            simTime: typeof window.simTime !== 'undefined' ? window.simTime : null,
            ngeomVar: typeof window.ngeom !== 'undefined' ? window.ngeom : null
        };
        return stats;
    }
    """
    return await page.evaluate(js)


def _safe_terminate(proc: subprocess.Popen, timeout_sec: float = 3.0) -> None:
    try:
        if proc.poll() is None:
            with suppress(Exception):
                proc.terminate()
            t0 = time.time()
            while proc.poll() is None and (time.time() - t0) < timeout_sec:
                time.sleep(0.1)
        if proc.poll() is None:
            with suppress(Exception):
                proc.kill()
    except Exception:
        pass


async def run_probe(
    python_exe: str,
    port: int,
    timeout: float,
    ver: str,
    mode: str,
    model: Optional[str],
    snapshot_debug: bool,
    capture: str,
) -> None:
    proc = launch_dev_server(python_exe, port)
    root = resolve_repo_root()
    try:
        print(f"[worker-debug] dev_server :{port} starting", flush=True)
        await wait_for_server(port)
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--enable-webgl",
                    "--ignore-gpu-blocklist",
                    "--disable-gpu-sandbox",
                    "--enable-unsafe-swiftshader",
                    "--use-angle=swiftshader",
                    "--use-gl=swiftshader",
                ],
            )
            context = await browser.new_context()
            page = await context.new_page()
            logs = LogBundle()

            def on_console(msg):
                logs.console.append(f"[console/{msg.type}] {msg.text}")

            def on_page_error(exc):
                logs.errors.append(f"[pageerror] {exc}")

            async def on_response(resp):
                url = resp.url
                status = resp.status
                ctype = resp.headers.get("content-type", "")
                if "physics.worker.mjs" in url or "dist/3.3.7" in url:
                    logs.responses.append(f"[response] {status} {url} [{ctype}]")

            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("response", lambda resp: asyncio.create_task(on_response(resp)))

            # Build the main Simulate-like UI entry URL.
            safe_mode = "worker" if mode == "worker" else "direct"
            url = f"http://localhost:{port}/index.html?ver={ver}&mode={safe_mode}&debug=1&ver={ver}"
            if model:
                url += f"&model={model}"
            if snapshot_debug:
                url += "&snapshot=1"
            # Enable snapshot mode in page context when requested
            if snapshot_debug:
                await context.add_init_script("() => { try { window.__snapshot = 1; } catch {} }")

            goto_timeout = max(5.0, min(30.0, timeout + 10.0))
            try:
                print(f"[worker-debug] goto {url}", flush=True)
                await asyncio.wait_for(page.goto(url, wait_until="load"), timeout=goto_timeout)
            except asyncio.TimeoutError:
                logs.errors.append(f"[timeout] page.goto exceeded {goto_timeout}s")
            frame_wait = int(max(10, timeout * 2) * 1000)
            try:
                await page.wait_for_function(
                    "() => (window.__viewerCanvasDataUrlLength && window.__viewerCanvasDataUrlLength > 1000) || (window.__frameCounter && window.__frameCounter > 30) || (window.__drawnCount && window.__drawnCount > 0)",
                    timeout=frame_wait,
                )
            except PlaywrightTimeoutError as exc:
                print(f"[timeout] frame readiness exceeded {frame_wait}ms: {exc}")
                await page.wait_for_timeout(int(timeout * 1000))

            # Capture mode: export | canvas | page (default: page)
            capture = (capture or "page").lower()
            try:
                if capture == "export":
                    export_path = os.path.join(root, f"final_{safe_mode}.png")
                    # Ensure readiness then export via engine API
                    await page.wait_for_function(
                        "() => (window.__frameCounter && window.__frameCounter > 10)",
                        timeout=frame_wait,
                    )
                    data_url = await page.evaluate("() => (window.exportExactPNG ? window.exportExactPNG() : (window.exportPNG ? window.exportPNG() : null))")
                    if isinstance(data_url, str) and data_url.startswith("data:image/png;base64,"):
                        import base64
                        b64 = data_url.split(",", 1)[1]
                        with open(export_path, "wb") as f:
                            f.write(base64.b64decode(b64))
                        print(f"[final] exported {export_path}")
                        # Sample pixels from exported image in page to avoid local deps
                        picks = await page.evaluate(
                            """
                            (uri) => {
                              try {
                                return new Promise((resolve) => {
                                  const img = new Image();
                                  img.onload = () => {
                                    const c = document.createElement('canvas');
                                    c.width = img.width; c.height = img.height;
                                    const g = c.getContext('2d');
                                    g.drawImage(img, 0, 0);
                                    const coords = [
                                      [Math.floor(c.width/2), Math.floor(c.height/2)],
                                      [Math.floor(c.width*0.25), Math.floor(c.height*0.25)],
                                      [Math.floor(c.width*0.75), Math.floor(c.height*0.25)],
                                      [Math.floor(c.width*0.25), Math.floor(c.height*0.75)],
                                      [Math.floor(c.width*0.75), Math.floor(c.height*0.75)],
                                    ];
                                    const out = coords.map(([x,y]) => Array.from(g.getImageData(x,y,1,1).data));
                                    resolve(out);
                                  };
                                  img.onerror = () => resolve(null);
                                  img.src = uri;
                                });
                              } catch { return null; }
                            }
                            """,
                            data_url,
                        )
                        print("[pixels]", picks)
                        def _is_visible(px):
                            return isinstance(px, list) and len(px) == 4 and px[3] != 0 and not (px[0] < 5 and px[1] < 5 and px[2] < 5) and not (px[0] > 250 and px[1] > 250 and px[2] > 250)
                        has_color = any(_is_visible(px) for px in (picks or []))
                        print(f"[result] has_color={has_color}")
                    else:
                        raise RuntimeError("exportViewerFrame returned empty/invalid data URL")
                elif capture == "canvas":
                    canvas = await page.query_selector("[data-testid='viewer-canvas']")
                    canvas_path = os.path.join(root, f"canvas_{safe_mode}.png")
                    if canvas:
                        await canvas.screenshot(path=canvas_path)
                        print(f"[canvas] saved {canvas_path}")
                    else:
                        raise RuntimeError("viewer canvas not found")
                else:  # page
                    el = await page.query_selector("[data-testid='viewer-canvas']")
                    bb = await el.bounding_box() if el else None
                    page_path = os.path.join(root, f"page_{safe_mode}.png")
                    if bb:
                        clip = {"x": bb["x"], "y": bb["y"], "width": bb["width"], "height": bb["height"]}
                        await page.screenshot(path=page_path, clip=clip)
                    else:
                        await page.screenshot(path=page_path, full_page=False)
                    print(f"[page] saved {page_path}")
            except Exception as exc:
                print(f"[capture] failed: {exc}")

            # Sample pixels to verify non-white/non-transparent output
            try:
                pixels = await page.evaluate(
                    """
                    () => {
                        const source = document.querySelector("[data-testid='viewer-canvas']");
                        if (!source) return null;
                        const tmp = document.createElement('canvas');
                        tmp.width = source.width || source.clientWidth || 0;
                        tmp.height = source.height || source.clientHeight || 0;
                        const ctx2d = tmp.getContext('2d');
                        if (!ctx2d) return null;
                        ctx2d.drawImage(source, 0, 0);
                        const picks = [];
                        const coords = [
                          [Math.floor(tmp.width/2), Math.floor(tmp.height/2)],
                          [Math.floor(tmp.width*0.25), Math.floor(tmp.height*0.25)],
                          [Math.floor(tmp.width*0.75), Math.floor(tmp.height*0.25)],
                          [Math.floor(tmp.width*0.25), Math.floor(tmp.height*0.75)],
                          [Math.floor(tmp.width*0.75), Math.floor(tmp.height*0.75)],
                        ];
                        for (const [x,y] of coords) {
                          const data = ctx2d.getImageData(Math.max(0,x), Math.max(0,y), 1, 1).data;
                          picks.push(Array.from(data));
                        }
                        return picks;
                    }
                    """
                )
                print("[pixels]", pixels)
                def _is_visible(px):
                    if not (isinstance(px, list) and len(px) == 4):
                        return False
                    r,g,b,a = px
                    if a == 0:
                        return False
                    # treat near-black and near-white as not visible signal
                    if r < 5 and g < 5 and b < 5:
                        return False
                    if r > 250 and g > 250 and b > 250:
                        return False
                    return True
                has_color = any(_is_visible(px) for px in (pixels or []))
                print(f"[result] has_color={has_color}")
            except Exception as exc:
                print(f"[pixel] failed: {exc}")

            state = await gather_page_state(page)

            print("=== Console ===")
            for line in logs.console:
                print(line)
            print("=== Errors ===")
            for line in logs.errors:
                print(line)
            print("=== Responses ===")
            for line in logs.responses:
                print(line)
            print("=== Page State ===")
            print(state)

            await browser.close()
    finally:
        _safe_terminate(proc)


def main():
    parser = argparse.ArgumentParser(description="Debug worker loading via Playwright")
    parser.add_argument("--python", default=sys.executable, help="Python executable for dev server")
    parser.add_argument("--port", type=int, default=8094)
    parser.add_argument("--wait", type=float, default=2.0, help="Extra wait time after navigation (seconds)")
    parser.add_argument("--ver", default="3.3.7")
    parser.add_argument("--mode", choices=["direct", "worker"], default="direct")
    parser.add_argument("--model", default="", help="Model filename to load (relative to repo root)")
    parser.add_argument("--snapshot-debug", action="store_true", help="Append snapshot=1 to URL")
    parser.add_argument("--capture", choices=["page", "canvas", "export"], default="page", help="Capture mode: page clip, canvas screenshot, or GL export")
    args = parser.parse_args()

    asyncio.run(
        run_probe(
            args.python,
            args.port,
            args.wait,
            args.ver,
            args.mode,
            args.model or None,
            args.snapshot_debug,
            args.capture,
        )
    )


if __name__ == "__main__":
    main()
