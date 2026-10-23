import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { calcularRede, ErroRegras, faseEmVigor, resolverVersao, validarConfigRegras } from "..";
import type { ConfigRegras, VersaoRegras } from "..";
import { premissasReferencia, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("arquivo config/regras-legais.json", () => {
  const config = JSON.parse(readFileSync(path.resolve(__dirname, "../../../config/regras-legais.json"), "utf8")) as ConfigRegras;
  it("é válido e tem 44h → 42h → 40h", () => {
    validarConfigRegras(config);
    const v = resolverVersao(config, "2026-10-23");
    expect(v.fases.map((f) => f.jornadaSemanal)).toEqual([44, 42, 40]);
    expect(v.fases.map((f) => f.divisorHora)).toEqual([220, 210, 200]);
    expect(v.fases[1].inicio).toBe("2026-12-15");
    expect(v.fases[2].inicio).toBe("2027-12-15");
  });
});

describe("resolução por vigência", () => {
  const v2: VersaoRegras = { ...clone(VERSAO_TESTE), id: "v2", vigenteDesde: "2027-06-01" };
  v2.fases[2].jornadaSemanal = 38;
  const config: ConfigRegras = { versoes: [v2, VERSAO_TESTE] };

  it("escolhe a versão de maior vigência ≤ data", () => {
    expect(resolverVersao(config, "2026-11-01").id).toBe("teste");
    expect(resolverVersao(config, "2027-06-01").id).toBe("v2");
    expect(resolverVersao(config, "2030-01-01").id).toBe("v2");
  });
  it("data anterior a todas → a mais antiga", () => {
    expect(resolverVersao(config, "2020-01-01").id).toBe("teste");
  });
  it("critério 4: mudar jornada ou data na configuração muda o cálculo sem mudar código", () => {
    const antes = calcularRede([unidadeReferencia()], resolverVersao(config, "2026-11-01"), premissasReferencia());
    const depois = calcularRede([unidadeReferencia()], resolverVersao(config, "2027-07-01"), premissasReferencia());
    expect(antes.consolidado[2].fteNecessario).toBeCloseTo(196 / 35.2, 10);
    expect(depois.consolidado[2].fteNecessario).toBeCloseTo(196 / (38 * 0.88), 10);
  });
  it("faseEmVigor por data", () => {
    expect(faseEmVigor(VERSAO_TESTE, "2026-10-23").id).toBe("atual");
    expect(faseEmVigor(VERSAO_TESTE, "2026-12-15").id).toBe("fase1");
    expect(faseEmVigor(VERSAO_TESTE, "2028-01-01").id).toBe("fase2");
  });
  it("data de referência inválida", () => {
    expect(() => resolverVersao(config, "23/10/2026")).toThrow(ErroRegras);
  });
});

describe("validação da configuração", () => {
  const casos: [string, (c: ConfigRegras) => void, RegExp][] = [
    ["sem versões", (c) => (c.versoes = []), /ao menos uma versão/],
    ["id duplicado", (c) => c.versoes.push(clone(c.versoes[0])), /duplicado/],
    ["sem id", (c) => (c.versoes[0].id = ""), /sem id/],
    ["vigência inválida", (c) => (c.versoes[0].vigenteDesde = "2026/10/16"), /vigenteDesde/],
    ["sem fases", (c) => (c.versoes[0].fases = []), /sem fases/],
    ["fase sem nome", (c) => (c.versoes[0].fases[0].nome = ""), /sem id ou nome/],
    ["jornada zero", (c) => (c.versoes[0].fases[1].jornadaSemanal = 0), /jornadaSemanal/],
    ["divisor negativo", (c) => (c.versoes[0].fases[1].divisorHora = -1), /divisorHora/],
    ["8 dias", (c) => (c.versoes[0].fases[1].diasTrabalhoSemana = 8), /≤ 7/],
    ["inicio inválido", (c) => (c.versoes[0].fases[1].inicio = "amanhã"), /inicio/],
    ["fase duplicada", (c) => (c.versoes[0].fases[2].id = "fase1"), /fase duplicada/],
    ["fora de ordem", (c) => (c.versoes[0].fases[2].inicio = "2026-01-01"), /ordem/],
    ["null fora da primeira", (c) => (c.versoes[0].fases[2].inicio = null), /só a primeira/],
    ["limite hora extra", (c) => (c.versoes[0].limiteHoraExtraDiaria = 0), /limiteHoraExtraDiaria/],
    ["adicional negativo", (c) => (c.versoes[0].adicionalHoraExtraPadrao = -0.1), /adicionalHoraExtraPadrao/],
  ];
  it.each(casos)("%s", (_nome, estragar, erro) => {
    const c: ConfigRegras = { versoes: [clone(VERSAO_TESTE)] };
    estragar(c);
    expect(() => validarConfigRegras(c)).toThrow(erro);
  });
  it("config nula", () => {
    expect(() => validarConfigRegras(null as unknown as ConfigRegras)).toThrow(ErroRegras);
  });
});
