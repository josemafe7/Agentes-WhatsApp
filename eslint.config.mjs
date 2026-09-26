import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // docs/conventions.md: never `any`; use `unknown` and validate.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated or not ours: SQL migrations, test reports, the widget bundle served as-is.
    "drizzle/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/widget.js",
  ]),
]);

export default eslintConfig;
