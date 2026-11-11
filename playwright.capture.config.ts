import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

// 시연 자료(스크린샷 · 경주 GIF)를 docs/media 에 다시 만든다. 테스트가 아니다.
//   PW_CHANNEL=chrome npx playwright test -c playwright.capture.config.ts
export default defineConfig({
  ...base,
  testDir: "tests/capture",
  retries: 0,
  reporter: "list",
  use: { ...base.use, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 },
});
