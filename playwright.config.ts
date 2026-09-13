import { defineConfig } from "@playwright/test";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:3000/login", reuseExistingServer: true, timeout: 120_000 },
  reporter: [["list"]],
});
