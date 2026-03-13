import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const DEFAULT_PORT = 4173;

function isFinitePort(value) {
  return Number.isFinite(value) && value > 0 && value < 65536;
}

function isPortOpen({ port, host: targetHost, timeoutMs = 250 }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = net.connect({ host: targetHost, port });
    socket.once("connect", () => {
      socket.destroy();
      settle(true);
    });
    socket.once("error", () => settle(false));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      settle(false);
    });
    socket.unref();
  });
}

async function pickPort({ preferred, host: targetHost, tries = 20 }) {
  const base = isFinitePort(preferred) ? preferred : DEFAULT_PORT;
  for (let offset = 0; offset <= tries; offset += 1) {
    const candidate = base + offset;
    if (!isFinitePort(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const open = await isPortOpen({ port: candidate, host: targetHost });
    if (!open) return candidate;
  }
  return base;
}

let sharedPort = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : null;

async function resolveSharedRuntime() {
  if (!isFinitePort(sharedPort)) {
    sharedPort = await pickPort({ preferred: DEFAULT_PORT, host });
    process.env.PLAYWRIGHT_PORT = String(sharedPort);
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${sharedPort}`;
  const repoRoot = path.join(__dirname, "..");
  const pythonBin = process.env.PYTHON_EXE ?? process.env.PYTHON ?? "python";
  const devServerScript = JSON.stringify(path.join(repoRoot, "tools", "dev_server.py"));
  const webServerCommand = `${pythonBin} ${devServerScript} --root ${JSON.stringify(repoRoot)} --port ${sharedPort}`;

  const require = createRequire(import.meta.url);
  const { Module } = require("module");
  const devNodeModules = path.join(repoRoot, "node_modules");
  const existingNodePath = process.env.NODE_PATH ? String(process.env.NODE_PATH) : "";
  if (!existingNodePath.split(path.delimiter).includes(devNodeModules)) {
    process.env.NODE_PATH = existingNodePath
      ? `${devNodeModules}${path.delimiter}${existingNodePath}`
      : devNodeModules;
    Module._initPaths();
  }

  return {
    baseURL,
    outputDir: path.join(os.tmpdir(), "pw-out"),
    reporter: process.env.CI
      ? [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]]
      : "list",
    webServer: {
      command: webServerCommand,
      url: `${baseURL}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  };
}

export async function createPlaywrightConfig({
  testDir,
  timeout = 60_000,
  navigationTimeout = 20_000,
  reporter,
} = {}) {
  if (!testDir) {
    throw new Error("createPlaywrightConfig requires testDir");
  }

  const runtime = await resolveSharedRuntime();

  return {
    testDir,
    timeout,
    use: {
      baseURL: runtime.baseURL,
      headless: true,
      trace: process.env.CI ? "on-first-retry" : "off",
      screenshot: "off",
      video: "off",
      navigationTimeout,
    },
    outputDir: runtime.outputDir,
    reporter: reporter ?? runtime.reporter,
    webServer: runtime.webServer,
    workers: 1,
    expect: {
      timeout: 10_000,
    },
  };
}
