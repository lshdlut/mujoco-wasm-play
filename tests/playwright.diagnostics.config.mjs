import { createPlaywrightConfig } from "./playwright.shared.mjs";

export default await createPlaywrightConfig({
  testDir: "./diagnostics",
  timeout: 120_000,
  navigationTimeout: 30_000,
  reporter: "list",
});
