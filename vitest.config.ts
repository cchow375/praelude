import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Dedicated Vitest config so the Tauri-tuned vite.config.ts stays untouched.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.ts"],
    // Raises Testing Library's `waitFor` ceiling so a busy machine cannot fail
    // the suite on timing alone — see the reasoning in the file itself.
    setupFiles: ["./src/testSetup.ts"],
    // Shell-surface integration tests mount the full practice workspace. Give
    // them the same modest busy-machine allowance as their waitFor assertions
    // so a healthy full-suite run does not fail at Vitest's shorter default.
    testTimeout: 12_000,
  },
});
