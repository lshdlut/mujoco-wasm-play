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

from playwright.async_api import async_playwright, Browser, Page


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


async def run_probe(python_exe: str, port: int, timeout: float, ver: str) -> None:
    proc = launch_dev_server(python_exe, port)
    root = resolve_repo_root()
    try:
        print(f"[worker-debug] dev_server :{port} starting", flush=True)
        await wait_for_server(port)
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(headless=True)
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
                if "local_tools/viewer_demo/physics.worker.mjs" in url or "dist/3.3.7" in url:
                    logs.responses.append(f"[response] {status} {url} [{ctype}]")

            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("response", lambda resp: asyncio.create_task(on_response(resp)))

            url = f"http://localhost:{port}/local_tools/viewer_demo/index.html?ver={ver}&nofallback=1&debug=1"
            goto_timeout = max(5.0, min(30.0, timeout + 10.0))
            try:
                print(f"[worker-debug] goto {url}", flush=True)
                await asyncio.wait_for(page.goto(url, wait_until="load"), timeout=goto_timeout)
            except asyncio.TimeoutError:
                logs.errors.append(f"[timeout] page.goto exceeded {goto_timeout}s")
            await page.wait_for_timeout(int(timeout * 1000))
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
    args = parser.parse_args()

    asyncio.run(run_probe(args.python, args.port, args.wait, args.ver))


if __name__ == "__main__":
    main()
