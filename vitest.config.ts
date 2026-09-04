import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));

// PLAN 5.4: environment node, alias @ / @seed, tests/unit only,
// automatic JSX runtime for the T13 renderer tests. No resolve.conditions
// and no server-only alias on purpose (unit tests only import pure modules).
// vitest 4 bundles Vite 8 (rolldown/oxc): the `esbuild` option is ignored
// there, so the automatic JSX runtime is configured through `oxc.jsx`
// (tsconfig keeps `jsx: preserve` for Next, which oxc would otherwise honor).
export default defineConfig({
  resolve: {
    alias: {
      "@seed": `${root}supabase/seed`,
      "@": root,
    },
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
  },
});
