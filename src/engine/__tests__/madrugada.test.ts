import { describe, expect, it } from "vitest";
import {
  calcularUnidade,
  coberturaUniforme,
  coberturaVazia,
  horarioVazio,
  horasAbertasSemana,
  horasCoberturaSemana,
  horasFaixaDentro,
  horasJanela,
  intersecaoHorarios,
  intervaloNoDia,
  validarCobertura,
  viraODia,
} from "..";
import { horarioTodosOsDias, premissasReferencia, VERSAO_TESTE } from "./fixtures";

/** Turnos que viram o dia (D-35): fim menor que o início termina no dia seguinte. */
describe("intervalos que viram o dia", () => {
  it("fim antes do início = dia seguinte", () => {
    expect(viraODia("22:00", "06:00")).toBe(true);
    expect(viraODia("08:00", "22:00")).toBe(false);
    expect(viraODia("00:00", "24:00")).toBe(false);
    expect(intervaloNoDia("22:00", "06:00")).toEqual([1320, 1800]);
  });
  it("duração da janela e da faixa", () => {
    expect(horasJanela({ abre: "22:00", fecha: "06:00" })).toBe(8);
    expect(horasJanela({ abre: "11:00", fecha: "01:00" })).toBe(14);
    expect(horasFaixaDentro({ inicio: "22:00", fim: "06:00", pessoas: 1 }, { abre: "18:00", fecha: "06:00" })).toBe(8);
    expect(horasFaixaDentro({ inicio: "23:00", fim: "03:00", pessoas: 1 }, { abre: "11:00", fecha: "01:00" })).toBe(2);
  });
});

describe("horas de cobertura na semana", () => {
  it("restaurante 11h–01h, 7 dias, 2 pessoas = 196 h e FTE 5,06 com 44h (mesmo do caso de referência)", () => {
    const horarios = horarioTodosOsDias("11:00", "01:00");
    const u = { id: "r", nome: "Restaurante", horarios, cobertura: coberturaUniforme(horarios, 2), quadro: [] };
    expect(horasCoberturaSemana(u.cobertura, horarios)).toBe(196);
    expect(horasAbertasSemana(horarios)).toBe(98);
    const [atual] = calcularUnidade(u, VERSAO_TESTE, premissasReferencia()).fases;
    expect(atual.fteNecessario.toFixed(2)).toBe("5.06");
  });
  it("domingo que vira o dia continua na segunda", () => {
    const horarios = { ...horarioVazio(), dom: { abre: "22:00", fecha: "06:00" } };
    const c = coberturaVazia();
    c.dom = [{ inicio: "22:00", fim: "06:00", pessoas: 1 }];
    expect(horasCoberturaSemana(c, horarios)).toBe(8);
    expect(validarCobertura(c, horarios)).toEqual([]);
  });
  it("faixa de madrugada lançada no dia seguinte conta dentro do turno que começou na véspera", () => {
    const horarios = { ...horarioVazio(), sex: { abre: "22:00", fecha: "06:00" } };
    const c = coberturaVazia();
    c.sab = [{ inicio: "00:00", fim: "06:00", pessoas: 2 }];
    expect(horasCoberturaSemana(c, horarios)).toBe(12);
    expect(validarCobertura(c, horarios).join()).not.toMatch(/fora do horário/);
  });
  it("janelas que se sobrepõem na virada contam uma vez", () => {
    const horarios = { ...horarioVazio(), sex: { abre: "18:00", fecha: "06:00" }, sab: { abre: "00:00", fecha: "10:00" } };
    expect(horasAbertasSemana(horarios)).toBe(16);
  });
  it("parte da faixa fora do horário é cortada e gera aviso", () => {
    const horarios = { ...horarioVazio(), seg: { abre: "18:00", fecha: "02:00" } };
    const c = coberturaVazia();
    c.seg = [{ inicio: "20:00", fim: "04:00", pessoas: 1 }];
    expect(horasCoberturaSemana(c, horarios)).toBe(6);
    expect(validarCobertura(c, horarios).join()).toMatch(/fora do horário/);
  });
  it("sobreposição de faixas que viram o dia no mesmo setor", () => {
    const horarios = { ...horarioVazio(), seg: { abre: "18:00", fecha: "06:00" } };
    const c = coberturaVazia();
    c.seg = [
      { inicio: "18:00", fim: "02:00", pessoas: 1 },
      { inicio: "23:00", fim: "06:00", pessoas: 1 },
    ];
    expect(validarCobertura(c, horarios).join()).toMatch(/sobrepostas/);
  });
});

describe("horário reduzido com virada de dia", () => {
  it("interseção mantém a madrugada ou corta para o mesmo dia", () => {
    const a = { ...horarioVazio(), seg: { abre: "18:00", fecha: "06:00" }, ter: { abre: "08:00", fecha: "22:00" } };
    expect(intersecaoHorarios(a, { ...horarioVazio(), seg: { abre: "20:00", fecha: "02:00" } }).seg).toEqual({ abre: "20:00", fecha: "02:00" });
    expect(intersecaoHorarios(a, { ...horarioVazio(), seg: { abre: "08:00", fecha: "23:00" } }).seg).toEqual({ abre: "18:00", fecha: "23:00" });
    expect(intersecaoHorarios(a, { ...horarioVazio(), seg: { abre: "18:00", fecha: "24:00" } }).seg).toEqual({ abre: "18:00", fecha: "24:00" });
    expect(intersecaoHorarios(a, { ...horarioVazio(), ter: { abre: "20:00", fecha: "02:00" } }).ter).toEqual({ abre: "20:00", fecha: "22:00" });
  });
  it("fechar à meia-noite em vez de 01h tira 7 h de atendimento por semana", () => {
    const horarios = horarioTodosOsDias("11:00", "01:00");
    const u = {
      id: "r",
      nome: "Restaurante",
      horarios,
      horarioReduzido: horarioTodosOsDias("11:00", "24:00"),
      cobertura: coberturaUniforme(horarios, 2),
      quadro: [{ nome: "Garçom", quantidade: 5, salarioBase: 2000, jornadaSemanal: 44 }],
    };
    const f2 = calcularUnidade(u, VERSAO_TESTE, premissasReferencia()).fases[2];
    expect(f2.cenarios.reduzirHorario.detalhes.horasAtendimentoPerdidasSemana).toBe(7);
    expect(f2.cenarios.reduzirHorario.detalhes.horasCoberturaReduzida).toBe(182);
  });
});
