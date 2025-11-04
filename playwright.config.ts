import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = process.env.PLAYWRIGHT_PORT ? Number(process.env.PLAYWRIGHT_PORT) : 4173;
const host = process.env.PLAYWRIGHT_HOST ?? "127.0.0.1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://${host}:${port}`;

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
    command: `npx serve . -l ${port} --no-clipboard`,
    url: `${baseURL}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  workers: process.env.CI ? 1 : 1,
  expect: {
    timeout: 10_000,
  },
});
