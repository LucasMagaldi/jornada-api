import { describe, expect, it } from "vitest";
import { calcularRede, coberturaUniforme, IDS_CENARIOS } from "..";
import type { SemanaPico, Unidade } from "..";
import { horarioTodosOsDias, premissasReferencia, QUADRO_5_44H, unidadeReferencia, VERSAO_TESTE } from "./fixtures";

const NATAL: SemanaPico = (() => {
  const horarios = horarioTodosOsDias("08:00", "23:00");
  return { descricao: "Natal", horarios, cobertura: coberturaUniforme(horarios, 3) };
})();

describe("semana de pico (D-33)", () => {
  const unidades: Unidade[] = [
    unidadeReferencia(QUADRO_5_44H, { id: "a", nome: "A", pico: NATAL }),
    unidadeReferencia(QUADRO_5_44H, { id: "b", nome: "B" }),
  ];
  const r = calcularRede(unidades, VERSAO_TESTE, premissasReferencia());

  it("calcula as fases com horário e cobertura do pico e o mesmo quadro", () => {
    const pico = r.unidades[0].fasesPico!;
    expect(pico).toHaveLength(3);
    expect(pico[2].horasCoberturaSemana).toBe(15 * 7 * 3);
    expect(pico[2].fteAtualEquivalente).toBe(5);
    expect(pico[2].deficitFte).toBeCloseTo(315 / 35.2 - 5, 10);
    expect(r.unidades[1].fasesPico).toBeNull();
  });
  it("consolidado de pico usa a semana típica de quem não informou pico", () => {
    expect(r.pico!.unidadesComPico).toBe(1);
    expect(r.pico!.consolidado[2].horasCoberturaSemana).toBe(315 + 196);
    expect(r.pico!.consolidado[2].deltaFte).toBeCloseTo(315 / 35.2 - 5 + (196 / 35.2 - 5), 10);
    expect(r.consolidado[2].horasCoberturaSemana).toBe(392);
  });
  it("o pico expõe o estouro do limite de hora extra que a semana típica esconde", () => {
    expect(r.unidades[0].fases[2].cenarios.horaExtra.detalhes.excedeLimiteLegal).toBe(false);
    expect(r.unidades[0].fasesPico![2].cenarios.horaExtra.detalhes.excedeLimiteLegal).toBe(true);
  });
  it("sem pico em nenhuma unidade, não há consolidado de pico", () => {
    expect(calcularRede([unidadeReferencia(QUADRO_5_44H)], VERSAO_TESTE, premissasReferencia()).pico).toBeNull();
  });
  it("avisos do pico vêm identificados", () => {
    const pico = { ...NATAL, cobertura: { ...NATAL.cobertura, seg: [] } };
    const r2 = calcularRede([unidadeReferencia(QUADRO_5_44H, { pico })], VERSAO_TESTE, premissasReferencia());
    expect(r2.unidades[0].avisos).toContain("Semana de Natal: seg: unidade aberta sem cobertura mínima informada");
  });
});

describe("agrupamento por bandeira e regional (D-34)", () => {
  const unidades: Unidade[] = [
    unidadeReferencia(QUADRO_5_44H, { id: "a", nome: "A", bandeira: "Premium", regional: "Sul", pico: NATAL }),
    unidadeReferencia(QUADRO_5_44H, { id: "b", nome: "B", bandeira: " Premium ", regional: "Sul" }),
    unidadeReferencia([{ nome: "X", quantidade: 8, salarioBase: 3000, jornadaSemanal: 44 }], { id: "c", nome: "C", regional: "Sudeste" }),
  ];
  const r = calcularRede(unidades, VERSAO_TESTE, premissasReferencia());

  it("um grupo por valor, sem diferença de espaços; sem valor vai para o grupo vazio, por último", () => {
    expect(r.grupos.map((g) => [g.tipo, g.nome, g.unidadeIds])).toEqual([
      ["bandeira", "Premium", ["a", "b"]],
      ["bandeira", "", ["c"]],
      ["regional", "Sudeste", ["c"]],
      ["regional", "Sul", ["a", "b"]],
    ]);
  });
  it("os grupos de um tipo somam a rede", () => {
    for (const tipo of ["bandeira", "regional"]) {
      const grupos = r.grupos.filter((g) => g.tipo === tipo);
      for (const id of IDS_CENARIOS) {
        const soma = grupos.reduce((s, g) => s + g.consolidado[2].custos[id], 0);
        expect(soma).toBeCloseTo(r.consolidado[2].custos[id], 8);
      }
      expect(grupos.reduce((s, g) => s + g.consolidado[2].deltaFte, 0)).toBeCloseTo(r.consolidado[2].deltaFte, 10);
    }
  });
  it("sobra de uma unidade não compensa outra dentro do grupo", () => {
    const sul = r.grupos.find((g) => g.nome === "Sul")!;
    expect(sul.consolidado[2].deltaFte).toBeCloseTo(2 * (196 / 35.2 - 5), 10);
  });
  it("grupos também têm consolidado de pico quando alguma unidade tem pico", () => {
    const premium = r.grupos.find((g) => g.nome === "Premium")!;
    expect(premium.consolidadoPico![2].horasCoberturaSemana).toBe(315 + 196);
  });
  it("sem bandeira nem regional, não há grupos", () => {
    expect(calcularRede([unidadeReferencia(QUADRO_5_44H)], VERSAO_TESTE, premissasReferencia()).grupos).toEqual([]);
    expect(calcularRede([unidadeReferencia(QUADRO_5_44H)], VERSAO_TESTE, premissasReferencia()).unidades[0].bandeira).toBeNull();
  });
});
