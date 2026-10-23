import { describe, expect, it } from "vitest";
import { calcularRede, calcularUnidade, coberturaUniforme } from "../../engine";
import { horarioTodosOsDias, premissasReferencia, QUADRO_5_44H, unidadeReferencia, VERSAO_TESTE } from "../../engine/__tests__/fixtures";
import { descreverDiagnostico, SETOR_DEMAIS, unidadeDoDiagnostico } from "../diagnostico";
import type { EntradaDiagnostico } from "../diagnostico";

/** Diagnóstico rápido (D-36): o formulário simples vira uma unidade comum do motor. */
const j = (abre: string, fecha: string) => ({ abre, fecha });
const REFERENCIA: EntradaDiagnostico = {
  unidades: 1,
  semana: j("08:00", "22:00"),
  sabado: j("08:00", "22:00"),
  domingo: j("08:00", "22:00"),
  pessoas: 2,
  colaboradores: 5,
  salarioMedio: 2000,
  jornadaAtual: 44,
};

describe("unidade do diagnóstico", () => {
  it("o caso de referência dá o mesmo resultado da unidade cadastrada (196 h, 5,06 e 5,57 FTE)", () => {
    const u = unidadeDoDiagnostico(REFERENCIA);
    expect(u.horarios).toEqual(horarioTodosOsDias("08:00", "22:00"));
    expect(u.cobertura).toEqual(coberturaUniforme(u.horarios, 2));
    const r = calcularUnidade(u, VERSAO_TESTE, premissasReferencia());
    expect(r.fases[0].horasCoberturaSemana).toBeCloseTo(196, 10);
    expect(r.fases[0].fteNecessario).toBeCloseTo(5.06, 2);
    expect(r.fases[2].fteNecessario).toBeCloseTo(5.57, 2);
    const ref = calcularUnidade(unidadeReferencia([{ ...QUADRO_5_44H[0], nome: "Equipe" }]), VERSAO_TESTE, premissasReferencia());
    expect(r.fases).toEqual(ref.fases);
    expect(u.pico).toBeNull();
  });

  it("dia fechado não tem faixa; domingo que vira o dia é aceito (D-35)", () => {
    const u = unidadeDoDiagnostico({ ...REFERENCIA, sabado: null, domingo: j("18:00", "02:00") });
    expect(u.cobertura.sab).toEqual([]);
    expect(u.cobertura.dom).toEqual([{ inicio: "18:00", fim: "02:00", pessoas: 2 }]);
    expect(calcularUnidade(u, VERSAO_TESTE, premissasReferencia()).fases[0].horasCoberturaSemana).toBeCloseTo((14 * 5 + 8) * 2, 10);
  });

  it("setor obrigatório: sobra da equipe não cobre falta do setor (D-32)", () => {
    const u = unidadeDoDiagnostico({ ...REFERENCIA, colaboradores: 7, setor: { nome: "Farmacêutico", pessoas: 1, colaboradores: 2, salarioMedio: 5000 } });
    expect(u.quadro.map((c) => c.setor)).toEqual([SETOR_DEMAIS, "Farmacêutico"]);
    expect(u.cobertura.seg.map((f) => [f.setor, f.pessoas])).toEqual([[SETOR_DEMAIS, 2], ["Farmacêutico", 1]]);
    const f2 = calcularUnidade(u, VERSAO_TESTE, premissasReferencia()).fases[2];
    // equipe: 196/35,2 − 7 (sobra); farmacêutico: 98/35,2 − 2 (falta)
    expect(f2.deltaFte).toBeCloseTo(294 / 35.2 - 9, 10);
    expect(f2.deficitFte).toBeCloseTo(98 / 35.2 - 2, 10);
    expect(f2.deltaFte).toBeLessThan(0);
  });

  it("setor sem gente no quadro e grupo sem cobertura ficam de fora", () => {
    const u = unidadeDoDiagnostico({ ...REFERENCIA, pessoas: 0, colaboradores: 0, setor: { nome: "Caixa", pessoas: 1, colaboradores: 3, salarioMedio: 2000 } });
    expect(u.quadro).toHaveLength(1);
    expect(u.cobertura.ter).toEqual([{ inicio: "08:00", fim: "22:00", pessoas: 1, setor: "Caixa" }]);
  });

  it("semana de pico usa um horário para todos os dias e o mesmo quadro (D-33)", () => {
    const e = { ...REFERENCIA, sabado: null, setor: { nome: "Açougue", pessoas: 1, colaboradores: 3, salarioMedio: 2500 }, pico: { janela: j("07:00", "23:00"), pessoas: 4 } };
    const u = unidadeDoDiagnostico(e);
    expect(u.pico?.descricao).toBe("Semana de pico");
    expect(u.pico?.horarios.sab).toEqual(j("07:00", "23:00"));
    expect(u.pico?.cobertura.sab.map((f) => f.pessoas)).toEqual([4, 1]);
    const r = calcularRede([u], VERSAO_TESTE, premissasReferencia());
    expect(r.unidades[0].fasesPico?.[0].horasCoberturaSemana).toBeCloseTo(16 * 7 * 5, 10);
    expect(unidadeDoDiagnostico({ ...e, pico: { ...e.pico, descricao: "Natal" } }).pico?.descricao).toBe("Natal");
  });

  it("descreve as premissas do diagnóstico", () => {
    expect(descreverDiagnostico({ ...REFERENCIA, unidades: 12 })[0][1]).toContain("× 12");
    expect(descreverDiagnostico({ ...REFERENCIA, setor: { nome: "Cozinha", pessoas: 2, colaboradores: 5, salarioMedio: 2200 } }).map((l) => l[0])).toContain("Setor obrigatório");
  });
});
