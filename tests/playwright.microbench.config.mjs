// Playwright config for local microbench runs (excluded from CI by default).
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : 4173;
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const devRoot = path.join(__dirname, "..", "dev");
const pythonBin = process.env.PYTHON_EXE ?? process.env.PYTHON ?? "python";
const devServerScript = JSON.stringify(path.join(devRoot, "dev_server.py"));
const webServerCommand = `${pythonBin} ${devServerScript} --root ${JSON.stringify(devRoot)} --port ${port}`;

// Ensure Playwright test files can resolve dev-scoped node_modules.
const require = createRequire(import.meta.url);
const { Module } = require("module");
const devNodeModules = path.join(devRoot, "node_modules");
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
