import { describe, expect, it } from "vitest";
import { calcularRede, normalizarPremissas, premissasPadrao, validarPremissas } from "..";
import { horarioTodosOsDias, premissasReferencia, QUADRO_5_44H, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

describe("rede consolidada", () => {
  const unidades = [
    unidadeReferencia(QUADRO_5_44H, { id: "a", nome: "A" }),
    unidadeReferencia(QUADRO_5_44H, { id: "b", nome: "B", horarioReduzido: horarioTodosOsDias("09:00", "21:00") }),
    unidadeReferencia([{ nome: "X", quantidade: 8, salarioBase: 3000, jornadaSemanal: 44 }], { id: "c", nome: "C (sobra)" }),
  ];
  const r = calcularRede(unidades, VERSAO_TESTE, premissasReferencia());
  const f2 = r.consolidado[2];
  const porUnidade = r.unidades.map((u) => u.fases[2]);

  it("soma horas e FTE; delta só soma déficits (sobra não compensa outra unidade)", () => {
    expect(f2.horasCoberturaSemana).toBe(196 * 3);
    expect(f2.fteNecessario).toBeCloseTo(3 * (196 / 35.2), 10);
    expect(f2.fteAtualEquivalente).toBe(18);
    expect(f2.deltaFte).toBeCloseTo(2 * (196 / 35.2 - 5), 10);
    expect(r.headcountAtual).toBe(18);
  });
  it("reduzir horário: unidade sem horário reduzido entra com custo de contratar (D-27)", () => {
    const esperado = porUnidade[0].cenarios.contratar.custoMensal + 0 + 0;
    expect(f2.custos.reduzirHorario).toBeCloseTo(esperado, 8);
    expect(f2.unidadesSemCenario.reduzirHorario).toBe(2);
  });
  it("melhor por unidade ≤ qualquer cenário único", () => {
    for (const c of Object.values(f2.custos)) expect(f2.custoMelhorPorUnidade).toBeLessThanOrEqual(c + 1e-9);
    expect(f2.maisBarato).toBe("reduzirHorario");
  });
  it("três fotografias no consolidado", () => {
    expect(r.consolidado.map((c) => c.fase.id)).toEqual(["atual", "fase1", "fase2"]);
  });
  it("cenário que estoura limite legal não é o mais barato da rede", () => {
    const r2 = calcularRede(
      [unidadeReferencia([{ nome: "A", quantidade: 1, salarioBase: 2000, jornadaSemanal: 44 }])],
      VERSAO_TESTE,
      premissasReferencia({ fatorEncargos: 5 }),
    );
    expect(r2.consolidado[2].unidadesAcimaDoLimite.horaExtra).toBe(1);
    expect(r2.consolidado[2].maisBarato).toBe("contratar");
  });
  it("unidade sem quadro usa salário médio da rede; hora extra cai para contratar", () => {
    const r3 = calcularRede(
      [unidadeReferencia(QUADRO_5_44H, { id: "a" }), unidadeReferencia([], { id: "b" })],
      VERSAO_TESTE,
      premissasReferencia(),
    );
    expect(r3.unidades[1].fases[2].salarioMedio).toBe(2000);
    expect(r3.consolidado[2].unidadesSemCenario.horaExtra).toBe(1);
  });
  it("rede vazia e rede sem quadro geram avisos", () => {
    expect(calcularRede([], VERSAO_TESTE, premissasReferencia()).avisos[0]).toMatch(/Nenhuma unidade/);
    expect(calcularRede([unidadeReferencia([])], VERSAO_TESTE, premissasReferencia()).avisos[0]).toMatch(/Nenhum quadro/);
  });
  it("premissas inválidas são rejeitadas", () => {
    expect(() => calcularRede(unidades, VERSAO_TESTE, premissasReferencia({ perdas: 1.5 }))).toThrow(/Perdas/);
  });
  it("critério 3: alterar premissa recalcula com a mesma versão de regras", () => {
    const outra = calcularRede(unidades, VERSAO_TESTE, premissasReferencia({ perdas: 0.2 }));
    expect(outra.consolidado[2].fteNecessario).toBeGreaterThan(f2.fteNecessario);
    expect(outra.versaoRegras).toBe(r.versaoRegras);
  });
});

describe("premissas", () => {
  it("padrões", () => {
    const p = premissasPadrao(VERSAO_TESTE);
    expect(p).toMatchObject({ perdas: 0.12, fatorEncargos: 1.8, adicionalHoraExtra: 0.5, margemSeguranca: 0.05, mixPercentualContratacao: 0.5 });
    expect(premissasPadrao().adicionalHoraExtra).toBe(0.5);
    expect(validarPremissas(p)).toEqual([]);
  });
  it("normaliza parciais e nulos", () => {
    expect(normalizarPremissas({ perdas: 0.2 }, VERSAO_TESTE).perdas).toBe(0.2);
    expect(normalizarPremissas(null).fatorEncargos).toBe(1.8);
    expect(normalizarPremissas({ divisores: { fase2: 190 } }).divisores).toEqual({ fase2: 190 });
  });
  it.each([
    [{ perdas: -0.1 }, /Perdas/],
    [{ fatorEncargos: 0.5 }, /encargos/],
    [{ adicionalHoraExtra: 9 }, /Adicional/],
    [{ margemSeguranca: 2 }, /Margem/],
    [{ mixPercentualContratacao: -1 }, /mix/],
    [{ divisores: { fase1: 0 } }, /Divisor/],
    [{ perdas: Number.NaN }, /Perdas/],
  ])("rejeita %o", (over, erro) => {
    expect(validarPremissas({ ...premissasPadrao(), ...over }).join(" ")).toMatch(erro);
  });
});
