import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Vite 8 resolves the tsconfig "@/*" alias natively.
    tsconfigPaths: true,
    alias: {
      // 'server-only' throws outside Next.js' react-server condition: tests load an empty module instead.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "*.test.ts"],
    // Playwright specs live in e2e/ and must not be collected by Vitest.
    exclude: [...configDefaults.exclude, "e2e/**", ".next/**"],
    // Migrates one template database per run; each test file gets its own empty copy (docs/testing.md).
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Tests run real Better Auth (scrypt password hashing) against real libSQL files: under a full parallel run
    // a test with 30+ sign-ins takes longer than Vitest's 5 s default without anything being wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
