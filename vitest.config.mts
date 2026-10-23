import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/engine/**/*.ts", "src/lib/csv.ts", "src/lib/diagnostico.ts"],
      exclude: ["src/**/__tests__/**", "src/engine/index.ts", "src/engine/tipos.ts"],
      thresholds: { lines: 95, functions: 95, branches: 90 },
    },
  },
});
