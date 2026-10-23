import { describe, expect, it } from "vitest";
import { calcularUnidade, coberturaVazia, horasCoberturaSemana } from "..";
import type { CoberturaSemanal } from "..";
import { horarioTodosOsDias, premissasReferencia, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

/** Caso de referência da seção 6 do documento de contexto (critério de aceite 2). */
describe("caso de referência: 14 h/dia, 7 dias, 2 pessoas, perdas 12%", () => {
  const r = calcularUnidade(unidadeReferencia(), VERSAO_TESTE, premissasReferencia());
  const [atual, fase1, fase2] = r.fases;

  it("horas_cobertura_semana = 14 × 7 × 2 = 196", () => {
    expect(atual.horasCoberturaSemana).toBe(196);
    expect(fase2.horasCoberturaSemana).toBe(196);
  });

  it("fase atual (44h): produtivas = 38,72 e FTE ≈ 5,06", () => {
    expect(atual.horasProdutivasPorColaborador).toBeCloseTo(38.72, 10);
    expect(atual.fteNecessario).toBeCloseTo(196 / 38.72, 10);
    expect(atual.fteNecessario.toFixed(2)).toBe("5.06");
  });

  it("fase 2 (40h): produtivas = 35,20 e FTE ≈ 5,57", () => {
    expect(fase2.horasProdutivasPorColaborador).toBeCloseTo(35.2, 10);
    expect(fase2.fteNecessario).toBeCloseTo(196 / 35.2, 10);
    expect(fase2.fteNecessario.toFixed(2)).toBe("5.57");
  });

  it("fase 1 (42h): produtivas = 36,96 e FTE ≈ 5,30", () => {
    expect(fase1.horasProdutivasPorColaborador).toBeCloseTo(36.96, 10);
    expect(fase1.fteNecessario.toFixed(2)).toBe("5.30");
  });
});

describe("tabela: FTE necessário por fase, perdas e pessoas", () => {
  // [jornada, perdas, pessoas, horas de cobertura, FTE esperado (2 casas)]
  const casos: [number, number, number, number, string][] = [
    [44, 0.12, 2, 196, "5.06"],
    [42, 0.12, 2, 196, "5.30"],
    [40, 0.12, 2, 196, "5.57"],
    [42, 0, 2, 196, "4.67"],
    [42, 0.2, 2, 196, "5.83"],
    [42, 0.12, 3, 294, "7.95"],
    [42, 0.12, 1, 98, "2.65"],
    [40, 0.15, 3, 294, "8.65"],
  ];
  it.each(casos)("J=%ih, perdas=%f, %i pessoas → cobertura %i h, FTE %s", (jornada, perdas, pessoas, horas, fte) => {
    const versao = { ...VERSAO_TESTE, fases: VERSAO_TESTE.fases.filter((f) => f.jornadaSemanal === jornada) };
    const u = unidadeReferencia([], { cobertura: unidadeReferencia().cobertura });
    for (const dia of Object.keys(u.cobertura) as (keyof CoberturaSemanal)[]) u.cobertura[dia][0].pessoas = pessoas;
    const [res] = calcularUnidade(u, versao, premissasReferencia({ perdas })).fases;
    expect(res.horasCoberturaSemana).toBe(horas);
    expect(res.fteNecessario.toFixed(2)).toBe(fte);
  });
});

describe("tabela: cobertura variável por faixa", () => {
  const horarios = horarioTodosOsDias("08:00", "22:00");
  const cobertura: CoberturaSemanal = coberturaVazia();
  for (const dia of ["seg", "ter", "qua", "qui", "sex"] as const) {
    cobertura[dia] = [
      { inicio: "08:00", fim: "12:00", pessoas: 2 }, // 8
      { inicio: "12:00", fim: "14:00", pessoas: 4 }, // 8
      { inicio: "14:00", fim: "18:00", pessoas: 2 }, // 8
      { inicio: "18:00", fim: "22:00", pessoas: 3 }, // 12
    ]; // 36 h/dia × 5 = 180
  }
  cobertura.sab = [{ inicio: "08:00", fim: "22:00", pessoas: 4 }]; // 56
  cobertura.dom = [{ inicio: "10:00", fim: "16:00", pessoas: 2 }]; // 12
  const total = 180 + 56 + 12; // 248

  it("soma horas × pessoas de cada faixa", () => {
    expect(horasCoberturaSemana(cobertura, horarios)).toBe(total);
  });

  // 248 / 38,72 = 6,405 · 248 / 36,96 = 6,710 · 248 / 35,20 = 7,045
  const casos: [string, number, string][] = [
    ["atual", 44, "6.40"],
    ["fase1", 42, "6.71"],
    ["fase2", 40, "7.05"],
  ];
  it.each(casos)("fase %s (J=%i) → FTE %s", (id, _j, esperado) => {
    const r = calcularUnidade(unidadeReferencia([], { horarios, cobertura }), VERSAO_TESTE, premissasReferencia());
    const f = r.fases.find((x) => x.fase.id === id)!;
    expect(f.fteNecessario.toFixed(2)).toBe(esperado);
  });
});
