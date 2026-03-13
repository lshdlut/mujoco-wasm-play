import { createPlaywrightConfig } from "./playwright.shared.mjs";

export default await createPlaywrightConfig({
  testDir: "./perf",
  timeout: 600_000,
  navigationTimeout: 120_000,
  reporter: "list",
});
