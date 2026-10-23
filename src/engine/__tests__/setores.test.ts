import { describe, expect, it } from "vitest";
import { calcularRede, calcularUnidade, coberturaVazia, DIAS_SEMANA, setoresDaUnidade, validarCobertura } from "..";
import type { Cargo, CoberturaSemanal, Unidade } from "..";
import { horarioTodosOsDias, premissasReferencia, QUADRO_5_44H, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

/** Cobertura por setor (D-32): sobra num setor não cobre falta em outro. */
const horarios = horarioTodosOsDias("08:00", "22:00");

function cobertura(faixas: { setor?: string; pessoas: number }[]): CoberturaSemanal {
  const c = coberturaVazia();
  for (const d of DIAS_SEMANA) c[d] = faixas.map((f) => ({ inicio: "08:00", fim: "22:00", ...f }));
  return c;
}

function mercado(quadro: Cargo[], faixas: { setor?: string; pessoas: number }[] = [{ setor: "Caixa", pessoas: 2 }, { setor: "Açougue", pessoas: 1 }]): Unidade {
  return { id: "m", nome: "Mercado", horarios, cobertura: cobertura(faixas), quadro };
}

const QUADRO_MERCADO: Cargo[] = [
  { nome: "Operador de caixa", quantidade: 7, salarioBase: 2000, jornadaSemanal: 44, setor: "Caixa" },
  { nome: "Açougueiro", quantidade: 1, salarioBase: 3000, jornadaSemanal: 44, setor: "Açougue" },
];

describe("sem setores, o cálculo é o agregado de antes", () => {
  it("setor só nos cargos é ignorado", () => {
    const comSetor = QUADRO_5_44H.map((c) => ({ ...c, setor: "Caixa" }));
    const a = calcularUnidade(unidadeReferencia(QUADRO_5_44H), VERSAO_TESTE, premissasReferencia());
    const b = calcularUnidade(unidadeReferencia(comSetor), VERSAO_TESTE, premissasReferencia());
    expect(b.fases).toEqual(a.fases);
    expect(a.fases[2].setores).toHaveLength(1);
    expect(a.fases[2].setores[0].setor).toBe("");
    expect(a.fases[2].deficitFte).toBeCloseTo(196 / 35.2 - 5, 10);
  });
});

describe("mercado com caixa e açougue (fase 2, 40h, perdas 12%, margem 0)", () => {
  const r = calcularUnidade(mercado(QUADRO_MERCADO), VERSAO_TESTE, premissasReferencia({ fatorEncargos: 1.8 }));
  const f2 = r.fases[2];
  const [acougue, caixa] = f2.setores;
  const deficitAcougue = 98 / 35.2 - 1;

  it("calcula cada setor com o próprio quadro", () => {
    expect(f2.setores.map((s) => s.setor)).toEqual(["Açougue", "Caixa"]);
    expect(caixa.horasCoberturaSemana).toBe(196);
    expect(caixa.fteNecessario).toBeCloseTo(196 / 35.2, 10);
    expect(caixa.deltaFte).toBeCloseTo(196 / 35.2 - 7, 10);
    expect(acougue.horasCoberturaSemana).toBe(98);
    expect(acougue.deltaFte).toBeCloseTo(deficitAcougue, 10);
    expect(acougue.salarioMedio).toBe(3000);
  });
  it("a sobra do caixa não cobre a falta do açougue", () => {
    expect(f2.deltaFte).toBeCloseTo(294 / 35.2 - 8, 10);
    expect(f2.deficitFte).toBeCloseTo(deficitAcougue, 10);
    expect(f2.deficitFte).toBeGreaterThan(f2.deltaFte);
  });
  it("contratar usa o salário do setor que falta", () => {
    expect(f2.cenarios.contratar.custoMensal).toBeCloseTo(deficitAcougue * 3000 * 1.8, 8);
    expect(f2.cenarios.contratar.detalhes.contratacoesInteiras).toBe(2);
    expect(f2.cenarios.contratar.detalhes.sobraFte).toBeCloseTo(7 - 196 / 35.2, 10);
  });
  it("hora extra é feita por quem está no setor e respeita o limite por setor", () => {
    const he = f2.cenarios.horaExtra;
    expect(he.detalhes.horasExtrasSemanaPorColaborador).toBeCloseTo(deficitAcougue * 35.2, 8);
    expect(he.detalhes.excedeLimiteLegal).toBe(true);
    expect(he.avisos[0]).toMatch(/^Setor Açougue: Exige/);
    expect(he.custoMensal).toBeCloseTo(deficitAcougue * 35.2 * (52 / 12) * (3000 / 200) * 1.5, 6);
    expect(f2.maisBarato).toBe("contratar");
  });
  it("consolidado da rede soma os déficits por setor", () => {
    const rede = calcularRede([mercado(QUADRO_MERCADO)], VERSAO_TESTE, premissasReferencia());
    expect(rede.consolidado[2].deltaFte).toBeCloseTo(deficitAcougue, 10);
  });
});

describe("casamento de setores e avisos", () => {
  it("nome do setor sem diferença de maiúsculas e espaços", () => {
    const quadro = QUADRO_MERCADO.map((c) => ({ ...c, setor: ` ${c.setor!.toUpperCase()} ` }));
    const a = calcularUnidade(mercado(QUADRO_MERCADO), VERSAO_TESTE, premissasReferencia()).fases[2];
    const b = calcularUnidade(mercado(quadro), VERSAO_TESTE, premissasReferencia()).fases[2];
    expect(b.deficitFte).toBeCloseTo(a.deficitFte, 10);
    expect(b.setores).toHaveLength(2);
  });
  it("setor com cobertura e sem quadro: hora extra indisponível e aviso", () => {
    const r = calcularUnidade(mercado([QUADRO_MERCADO[0]]), VERSAO_TESTE, premissasReferencia());
    expect(r.fases[2].cenarios.horaExtra.disponivel).toBe(false);
    expect(r.fases[2].cenarios.horaExtra.avisos[0]).toMatch(/setor\(es\) Açougue/);
    expect(r.avisos.join()).toMatch(/Setor Açougue tem cobertura mínima, mas ninguém no quadro/);
  });
  it("cargos sem setor formam o grupo geral e não cobrem setores nomeados", () => {
    const quadro = [...QUADRO_MERCADO, { nome: "Repositor", quantidade: 3, salarioBase: 1800, jornadaSemanal: 44 }];
    const r = calcularUnidade(mercado(quadro), VERSAO_TESTE, premissasReferencia());
    expect(r.fases[2].setores.map((s) => s.setor)).toEqual(["Açougue", "Caixa", ""]);
    expect(r.fases[2].setores[2].horasCoberturaSemana).toBe(0);
    expect(r.avisos.join()).toMatch(/3 colaborador\(es\) sem setor não cobrem/);
  });
  it("faixas sem setor numa cobertura com setores viram o setor geral", () => {
    const u = mercado(QUADRO_MERCADO, [{ setor: "Caixa", pessoas: 2 }, { pessoas: 1 }]);
    expect(setoresDaUnidade(u).map((s) => s.nome)).toEqual(["Açougue", "Caixa", ""]);
    expect(calcularUnidade(u, VERSAO_TESTE, premissasReferencia()).avisos.join()).toMatch(/Setor Açougue tem quadro, mas nenhuma cobertura/);
  });
  it("faixas de setores diferentes no mesmo horário não são sobreposição", () => {
    expect(validarCobertura(mercado(QUADRO_MERCADO).cobertura, horarios)).toEqual([]);
  });
  it("horário reduzido calculado por setor", () => {
    const u = { ...mercado(QUADRO_MERCADO), horarioReduzido: horarioTodosOsDias("08:00", "20:00") };
    const red = calcularUnidade(u, VERSAO_TESTE, premissasReferencia({ fatorEncargos: 1.8 })).fases[2].cenarios.reduzirHorario;
    const deficitRed = 84 / 35.2 - 1;
    expect(red.detalhes.horasCoberturaReduzida).toBe(252);
    expect(red.detalhes.fteAContratarAposReducao).toBeCloseTo(deficitRed, 10);
    expect(red.custoMensal).toBeCloseTo(deficitRed * 3000 * 1.8, 8);
  });
});
