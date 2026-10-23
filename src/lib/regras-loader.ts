import { readFileSync } from "node:fs";
import path from "node:path";
import { resolverVersao, validarConfigRegras } from "../engine";
import type { ConfigRegras, VersaoRegras } from "../engine";

/**
 * Lê as regras legais do arquivo a cada chamada (sem cache e sem import), para que
 * mudar datas, jornadas ou divisores no arquivo altere o cálculo sem deploy (D-03).
 */
export function carregarConfigRegras(): ConfigRegras {
  const arquivo = process.env.REGRAS_LEGAIS_PATH ?? path.resolve(process.cwd(), "config/regras-legais.json");
  return validarConfigRegras(JSON.parse(readFileSync(arquivo, "utf8")) as ConfigRegras);
}

/** Data de hoje (AAAA-MM-DD) no fuso de Brasília. */
export function hojeISO(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function versaoVigente(data: string = hojeISO()): VersaoRegras {
  return resolverVersao(carregarConfigRegras(), data);
}
