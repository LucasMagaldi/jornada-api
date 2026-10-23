import { criarApp } from "./http/app";
import { prisma } from "./lib/db";
import { carregarConfigRegras } from "./lib/regras-loader";

async function main() {
  // Falha cedo se a configuração legal estiver inválida.
  carregarConfigRegras();
  const app = await criarApp({
    db: prisma,
    logger: true,
    origemUi: process.env.UI_ORIGIN,
    cookieSeguro: process.env.COOKIE_SECURE === "true",
  });
  const port = Number(process.env.PORT ?? 3333);
  await app.listen({ port, host: "0.0.0.0" });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
