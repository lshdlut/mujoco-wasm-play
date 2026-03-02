// Playwright config for local microbench runs (excluded from CI by default).
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

function isPortOpen({ port, host, timeoutMs = 250 }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = net.connect({ host, port });
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

async function pickPort({ preferred, host, tries = 20 }) {
  const base = isFinitePort(preferred) ? preferred : DEFAULT_PORT;
  for (let offset = 0; offset <= tries; offset += 1) {
    const candidate = base + offset;
    if (!isFinitePort(candidate)) continue;
    // eslint-disable-next-line no-await-in-loop
    const open = await isPortOpen({ port: candidate, host });
    if (!open) return candidate;
  }
  return base;
}

let port = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : null;
if (!isFinitePort(port)) {
  port = await pickPort({ preferred: DEFAULT_PORT, host });
  process.env.PLAYWRIGHT_PORT = String(port);
}
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const repoRoot = path.join(__dirname, "..");
const pythonBin = process.env.PYTHON_EXE ?? process.env.PYTHON ?? "python";
const devServerScript = JSON.stringify(path.join(repoRoot, "tools", "dev_server.py"));
const webServerCommand = `${pythonBin} ${devServerScript} --root ${JSON.stringify(repoRoot)} --port ${port}`;

// Ensure Playwright test files can resolve dev-scoped node_modules.
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

export default {
  testDir: "./microbench",
  timeout: 600_000,
  use: {
    baseURL,
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    navigationTimeout: 120_000,
  },
  outputDir: path.join(os.tmpdir(), "pw-out"),
  reporter: "list",
  webServer: {
    command: webServerCommand,
    url: `${baseURL}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  workers: 1,
  expect: {
    timeout: 10_000,
  },
};
