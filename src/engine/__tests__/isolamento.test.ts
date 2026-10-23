import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** O motor não pode depender de banco, HTTP, Node ou código de aplicação. */
describe("isolamento do motor", () => {
  const dir = path.resolve(__dirname, "..");
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".ts"));
  it.each(arquivos)("%s só importa módulos do próprio motor", (arquivo) => {
    const fonte = readFileSync(path.join(dir, arquivo), "utf8");
    const imports = [...fonte.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const imp of imports) expect(imp).toMatch(/^\.\/[a-z]+$/);
    expect(fonte).not.toMatch(/console\.|process\.|require\(|fetch\(/);
  });
});
