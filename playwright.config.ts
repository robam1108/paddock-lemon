import { defineConfig, devices } from "@playwright/test";

// E2E 는 로컬 Supabase(supabase start + seed)에 붙어 돈다.
// CI 는 빌드한 앱(next start)을, 로컬은 개발 서버를 띄운다.
// 로컬에서는 설치된 Chrome 을 쓴다(PW_CHANNEL=chrome). CI 는 playwright 가 받은 Chromium.
const PORT = 3100;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: {
    command: CI ? `npm run start -- -p ${PORT}` : `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
