import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : 4173;
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;
const nodeExec = JSON.stringify(process.execPath);
const serveScript = JSON.stringify(path.join(__dirname, "node_modules", "serve", "build", "main.js"));
const webServerCommand = `${nodeExec} ${serveScript} . -l ${port} --no-clipboard`;

export default defineConfig({
  testDir: "./scripts/e2e",
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
});
