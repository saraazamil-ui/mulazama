import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx,mjs}"],
    setupFiles: ["./src/test-setup.ts"],
    restoreMocks: true,
  },
  server: { host: "127.0.0.1" },
});
