import { createPlaywrightConfig } from "./playwright.shared.mjs";

export default await createPlaywrightConfig({
  testDir: "./e2e/contracts",
});
