// ESM Playwright config for local dev + CI.
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

// Ensure Playwright test files under ../tests can resolve dev-scoped node_modules.
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
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL,
    headless: true,
    trace: process.env.CI ? "on-first-retry" : "off",
    screenshot: "off",
    video: "off",
    navigationTimeout: 20_000,
  },
  // Move transient outputs out of OneDrive to avoid EPERM/lock slowness
  outputDir: path.join(os.tmpdir(), "pw-out"),
  reporter: process.env.CI ? [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]] : "list",
  webServer: {
    command: webServerCommand,
    url: `${baseURL}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  workers: process.env.CI ? 1 : 1,
  expect: {
    timeout: 10_000,
  },
};
