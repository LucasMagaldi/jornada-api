import { describe, expect, it } from "vitest";
import { calcularUnidade, escolherMaisBarato, SEMANAS_POR_MES } from "..";
import type { ResultadoFase } from "..";
import { horarioTodosOsDias, premissasReferencia, QUADRO_5_44H, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

/**
 * Unidade de referência (196 h de cobertura) com 5 atendentes de 44h a R$ 2.000.
 * Fator de encargos 1,8; adicional 50%; perdas 12%; margem 0.
 */
function calcular(over = {}, unidadeExtra = {}) {
  const u = unidadeReferencia(QUADRO_5_44H, unidadeExtra);
  return calcularUnidade(u, VERSAO_TESTE, premissasReferencia({ fatorEncargos: 1.8, ...over }));
}
const fase = (r: ReturnType<typeof calcular>, id: string): ResultadoFase => r.fases.find((f) => f.fase.id === id)!;

describe("três fotografias", () => {
  const r = calcular();
  it("FTE atual equivalente: 5 pessoas de 44h valem 5 FTE em todas as fases (jornada cai junto)", () => {
    expect(r.fases.map((f) => f.fteAtualEquivalente)).toEqual([5, 5, 5]);
  });
  it("delta cresce a cada fase", () => {
    const [a, f1, f2] = r.fases.map((f) => f.deltaFte);
    expect(a).toBeCloseTo(196 / 38.72 - 5, 10);
    expect(f1).toBeCloseTo(196 / 36.96 - 5, 10);
    expect(f2).toBeCloseTo(196 / 35.2 - 5, 10);
    expect(a).toBeLessThan(f1);
    expect(f1).toBeLessThan(f2);
  });
  it("valor-hora sobe entre fases porque o salário se mantém (220 → 210 → 200)", () => {
    expect(r.fases.map((f) => f.valorHora)).toEqual([2000 / 220, 2000 / 210, 2000 / 200]);
    expect(r.fases.map((f) => f.divisorUsado)).toEqual([220, 210, 200]);
  });
  it("colaborador de 30h conta 30/J FTE; de 44h conta no máximo 1", () => {
    const r2 = calcularUnidade(
      unidadeReferencia([
        { nome: "Meio período", quantidade: 2, salarioBase: 1500, jornadaSemanal: 30 },
        { nome: "Integral", quantidade: 1, salarioBase: 2500, jornadaSemanal: 44 },
      ]),
      VERSAO_TESTE,
      premissasReferencia(),
    );
    expect(fase(r2, "fase2").fteAtualEquivalente).toBeCloseTo(2 * 30 / 40 + 1, 10);
    expect(fase(r2, "atual").fteAtualEquivalente).toBeCloseTo(2 * 30 / 44 + 1, 10);
    expect(fase(r2, "fase2").salarioMedio).toBeCloseTo((2 * 1500 + 2500) / 3, 10);
  });
});

describe("cenário contratar", () => {
  const f2 = fase(calcular(), "fase2");
  it("custo = delta_FTE × salário médio × fator de encargos", () => {
    expect(f2.cenarios.contratar.custoMensal).toBeCloseTo((196 / 35.2 - 5) * 2000 * 1.8, 8);
    expect(f2.cenarios.contratar.custoMensal.toFixed(2)).toBe("2045.45");
  });
  it("informa contratações inteiras", () => {
    expect(f2.cenarios.contratar.detalhes.contratacoesInteiras).toBe(1);
    expect(f2.cenarios.contratar.detalhes.custoContratacoesInteiras).toBe(3600);
  });
  it("sobra de quadro → custo zero e sobra informada", () => {
    const r = calcularUnidade(
      unidadeReferencia([{ nome: "A", quantidade: 8, salarioBase: 2000, jornadaSemanal: 44 }]),
      VERSAO_TESTE,
      premissasReferencia(),
    );
    const c = fase(r, "fase2").cenarios.contratar;
    expect(c.custoMensal).toBe(0);
    expect(c.detalhes.contratacoesInteiras).toBe(0);
    expect(c.detalhes.sobraFte).toBeCloseTo(8 - 196 / 35.2, 10);
    expect(fase(r, "fase2").cenarios.horaExtra.custoMensal).toBe(0);
  });
});

describe("cenário hora extra", () => {
  it("fase 2: 20 h/semana faltantes × 52/12 × R$ 10 × 1,5", () => {
    const f2 = fase(calcular(), "fase2");
    expect(f2.horasFaltantesSemana).toBeCloseTo(20, 10);
    expect(f2.horasFaltantesMes).toBeCloseTo(20 * SEMANAS_POR_MES, 10);
    expect(f2.cenarios.horaExtra.custoMensal).toBeCloseTo(20 * (52 / 12) * 10 * 1.5, 8);
    expect(f2.cenarios.horaExtra.custoMensal.toFixed(2)).toBe("1300.00");
    expect(f2.cenarios.horaExtra.detalhes.horasExtrasSemanaPorColaborador).toBeCloseTo(4, 10);
    expect(f2.cenarios.horaExtra.detalhes.excedeLimiteLegal).toBe(false);
  });
  it("fase 1: valor-hora 2000/210 e 11,2 h/semana faltantes", () => {
    const f1 = fase(calcular(), "fase1");
    expect(f1.horasFaltantesSemana).toBeCloseTo(11.2, 10);
    expect(f1.cenarios.horaExtra.custoMensal).toBeCloseTo(11.2 * (52 / 12) * (2000 / 210) * 1.5, 8);
  });
  it("adicional editável (CCT) altera o custo", () => {
    const f2 = fase(calcular({ adicionalHoraExtra: 1 }), "fase2");
    expect(f2.cenarios.horaExtra.custoMensal).toBeCloseTo(20 * (52 / 12) * 10 * 2, 8);
  });
  it("divisor sobrescrito nas premissas altera o valor-hora", () => {
    const f2 = fase(calcular({ divisores: { fase2: 180 } }), "fase2");
    expect(f2.divisorUsado).toBe(180);
    expect(f2.valorHora).toBeCloseTo(2000 / 180, 10);
  });
  it("com encargos sobre hora extra (D-15)", () => {
    const f2 = fase(calcular({ encargosSobreHoraExtra: true }), "fase2");
    expect(f2.cenarios.horaExtra.custoMensal).toBeCloseTo(1300 * 1.8, 6);
  });
  it("acima do limite legal: marca, avisa e não é escolhido como mais barato", () => {
    // 1 pessoa para 196 h de cobertura: horas extras por pessoa explodem
    const r = calcularUnidade(
      unidadeReferencia([{ nome: "A", quantidade: 1, salarioBase: 2000, jornadaSemanal: 44 }]),
      VERSAO_TESTE,
      premissasReferencia({ fatorEncargos: 5 }),
    );
    const f2 = fase(r, "fase2");
    expect(f2.cenarios.horaExtra.detalhes.excedeLimiteLegal).toBe(true);
    expect(f2.cenarios.horaExtra.avisos[0]).toMatch(/acima do limite/);
    expect(f2.cenarios.horaExtra.custoMensal).toBeLessThan(f2.cenarios.contratar.custoMensal);
    expect(f2.maisBarato).toBe("contratar");
  });
  it("unidade sem quadro: hora extra indisponível, custo pela média da rede", () => {
    const r = calcularUnidade(unidadeReferencia([]), VERSAO_TESTE, premissasReferencia(), 2000);
    const f2 = fase(r, "fase2");
    expect(f2.cenarios.horaExtra.disponivel).toBe(false);
    expect(f2.cenarios.mix.disponivel).toBe(false);
    expect(f2.cenarios.contratar.custoMensal).toBeCloseTo((196 / 35.2) * 2000 * 1.8, 6);
    expect(r.avisos.some((a) => a.includes("salário médio da rede"))).toBe(true);
  });
  it("unidade sem quadro e rede sem salário: custos zerados com aviso", () => {
    const r = calcularUnidade(unidadeReferencia([]), VERSAO_TESTE, premissasReferencia());
    expect(fase(r, "fase2").cenarios.contratar.custoMensal).toBe(0);
    expect(r.avisos.some((a) => a.includes("custos zerados"))).toBe(true);
  });
});

describe("cenário reduzir horário", () => {
  it("sem horário reduzido → indisponível", () => {
    const c = fase(calcular(), "fase2").cenarios.reduzirHorario;
    expect(c.disponivel).toBe(false);
    expect(c.custoMensal).toBe(0);
  });
  it("09–21 em vez de 08–22: cobertura 168 h, FTE 4,77 < 5 → custo zero", () => {
    const f2 = fase(calcular({}, { horarioReduzido: horarioTodosOsDias("09:00", "21:00") }), "fase2");
    const c = f2.cenarios.reduzirHorario;
    expect(c.disponivel).toBe(true);
    expect(c.detalhes.horasCoberturaReduzida).toBe(168);
    expect(c.detalhes.fteNecessarioReduzido).toBeCloseTo(168 / 35.2, 10);
    expect(c.custoMensal).toBe(0);
    expect(c.detalhes.horasAtendimentoPerdidasSemana).toBe(14);
    expect(c.detalhes.horasCoberturaPerdidasSemana).toBe(28);
    expect(c.detalhes.economiaVsContratar).toBeCloseTo(f2.cenarios.contratar.custoMensal, 8);
    expect(f2.maisBarato).toBe("reduzirHorario");
  });
  it("redução parcial: déficit remanescente é contratado", () => {
    // 08–21: 13 h × 7 × 2 = 182 h → FTE 5,17 → déficit 0,17
    const c = fase(calcular({}, { horarioReduzido: horarioTodosOsDias("08:00", "21:00") }), "fase2").cenarios.reduzirHorario;
    expect(c.custoMensal).toBeCloseTo((182 / 35.2 - 5) * 2000 * 1.8, 8);
  });
  it("horário reduzido nunca amplia o original (interseção) e avisa quando não reduz", () => {
    const c = fase(calcular({}, { horarioReduzido: horarioTodosOsDias("06:00", "23:00") }), "fase2").cenarios.reduzirHorario;
    expect(c.detalhes.horasCoberturaReduzida).toBe(196);
    expect(c.avisos[0]).toMatch(/não reduz/);
  });
  it("fechar um dia inteiro", () => {
    const red = { ...horarioTodosOsDias("08:00", "22:00"), dom: null };
    const c = fase(calcular({}, { horarioReduzido: red }), "fase2").cenarios.reduzirHorario;
    expect(c.detalhes.horasCoberturaReduzida).toBe(168);
    expect(c.detalhes.horasAtendimentoPerdidasSemana).toBe(14);
  });
});

describe("cenário mix", () => {
  it("50% contratação + 50% hora extra", () => {
    const f2 = fase(calcular(), "fase2");
    const esperado = 0.5 * f2.cenarios.contratar.custoMensal + 0.5 * f2.cenarios.horaExtra.custoMensal;
    expect(f2.cenarios.mix.custoMensal).toBeCloseTo(esperado, 8);
    expect(f2.cenarios.mix.detalhes.horasExtrasMes).toBeCloseTo(0.5 * f2.horasFaltantesMes, 8);
  });
  it("100% contratação = contratar; 0% = hora extra", () => {
    const f100 = fase(calcular({ mixPercentualContratacao: 1 }), "fase2");
    expect(f100.cenarios.mix.custoMensal).toBeCloseTo(f100.cenarios.contratar.custoMensal, 8);
    const f0 = fase(calcular({ mixPercentualContratacao: 0 }), "fase2");
    expect(f0.cenarios.mix.custoMensal).toBeCloseTo(f0.cenarios.horaExtra.custoMensal, 8);
  });
  it("100% contratação continua disponível mesmo sem quadro", () => {
    const r = calcularUnidade(unidadeReferencia([]), VERSAO_TESTE, premissasReferencia({ mixPercentualContratacao: 1 }), 2000);
    expect(fase(r, "fase2").cenarios.mix.disponivel).toBe(true);
  });
  it("parcela de hora extra acima do limite gera aviso", () => {
    const r = calcularUnidade(
      unidadeReferencia([{ nome: "A", quantidade: 1, salarioBase: 2000, jornadaSemanal: 44 }]),
      VERSAO_TESTE,
      premissasReferencia({ mixPercentualContratacao: 0.2 }),
    );
    expect(fase(r, "fase2").cenarios.mix.avisos[0]).toMatch(/limite legal/);
  });
});

describe("margem de segurança e mais barato", () => {
  it("margem multiplica o FTE necessário", () => {
    const f2 = fase(calcular({ margemSeguranca: 0.1 }), "fase2");
    expect(f2.fteNecessarioSemMargem).toBeCloseTo(196 / 35.2, 10);
    expect(f2.fteNecessario).toBeCloseTo((196 / 35.2) * 1.1, 10);
  });
  it("hora extra é a mais barata no caso base da fase 2", () => {
    expect(fase(calcular(), "fase2").maisBarato).toBe("horaExtra");
  });
  it("sem nenhum cenário elegível → null; empate → ordem padrão", () => {
    const base = fase(calcular(), "fase2").cenarios;
    const indisp = Object.fromEntries(Object.entries(base).map(([k, c]) => [k, { ...c, disponivel: false }])) as typeof base;
    expect(escolherMaisBarato(indisp)).toBeNull();
    const zero = Object.fromEntries(Object.entries(base).map(([k, c]) => [k, { ...c, custoMensal: 0 }])) as typeof base;
    expect(escolherMaisBarato(zero)).toBe("contratar");
  });
});
