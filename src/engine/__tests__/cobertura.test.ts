import { describe, expect, it } from "vitest";
import {
  coberturaUniforme,
  coberturaVazia,
  horaParaMinutos,
  horarioVazio,
  horasAbertasSemana,
  horasCoberturaSemana,
  horasFaixaDentro,
  horasJanela,
  intersecaoHorarios,
  minutosParaHora,
  replicarDia,
  validarCobertura,
} from "..";
import { horarioTodosOsDias } from "./fixtures";

describe("horários", () => {
  it("converte HH:MM", () => {
    expect(horaParaMinutos("08:30")).toBe(510);
    expect(horaParaMinutos("24:00")).toBe(1440);
    expect(horaParaMinutos("7:05")).toBe(425);
    expect(minutosParaHora(510)).toBe("08:30");
  });
  it.each(["24:30", "25:00", "08:60", "8h", ""])("rejeita %s", (h) => {
    expect(() => horaParaMinutos(h)).toThrow(/Horário inválido/);
  });
  it("horas abertas", () => {
    expect(horasJanela(null)).toBe(0);
    expect(horasJanela({ abre: "08:00", fecha: "22:30" })).toBe(14.5);
    expect(horasAbertasSemana(horarioTodosOsDias("08:00", "22:00"))).toBe(98);
    expect(horasAbertasSemana(horarioVazio())).toBe(0);
  });
});

describe("recorte da faixa pelo horário de funcionamento (D-08)", () => {
  const janela = { abre: "08:00", fecha: "22:00" };
  it.each([
    ["dentro", "10:00", "12:00", 2],
    ["começa antes", "06:00", "10:00", 2],
    ["termina depois", "20:00", "24:00", 2],
    ["fora", "22:00", "24:00", 0],
  ])("%s", (_n, inicio, fim, horas) => {
    expect(horasFaixaDentro({ inicio, fim, pessoas: 1 }, janela)).toBe(horas);
  });
  it("dia fechado não conta", () => {
    expect(horasFaixaDentro({ inicio: "10:00", fim: "12:00", pessoas: 3 }, null)).toBe(0);
    const c = coberturaUniforme(horarioTodosOsDias("08:00", "22:00"), 2);
    expect(horasCoberturaSemana(c, { ...horarioTodosOsDias("08:00", "22:00"), dom: null })).toBe(168);
  });
});

describe("avisos de cobertura", () => {
  const horarios = { ...horarioVazio(), seg: { abre: "08:00", fecha: "18:00" }, ter: { abre: "08:00", fecha: "18:00" } };
  it("detecta faixa fora do horário, sobreposição, faixa sem duração, pessoas inválidas e dia sem cobertura", () => {
    const c = coberturaVazia();
    c.seg = [
      { inicio: "07:00", fim: "10:00", pessoas: 2 },
      { inicio: "09:00", fim: "12:00", pessoas: 1 },
      { inicio: "13:00", fim: "13:00", pessoas: 1 },
      { inicio: "15:00", fim: "16:00", pessoas: -1 },
    ];
    const avisos = validarCobertura(c, horarios).join("\n");
    expect(avisos).toMatch(/fora do horário/);
    expect(avisos).toMatch(/sobrepostas/);
    expect(avisos).toMatch(/início igual ao fim/);
    expect(avisos).toMatch(/pessoas inválido/);
    expect(avisos).toMatch(/ter: unidade aberta sem cobertura/);
  });
  it("cobertura limpa não gera avisos", () => {
    expect(validarCobertura(coberturaUniforme(horarios, 2), horarios)).toEqual([]);
  });
});

describe("atalhos", () => {
  it("mesma cobertura todos os dias", () => {
    const h = { ...horarioTodosOsDias("09:00", "19:00"), dom: null };
    const c = coberturaUniforme(h, 3);
    expect(c.seg).toEqual([{ inicio: "09:00", fim: "19:00", pessoas: 3 }]);
    expect(c.dom).toEqual([]);
  });
  it("replicar um dia para a semana (cópia profunda)", () => {
    const c = coberturaVazia();
    c.qua = [{ inicio: "10:00", fim: "14:00", pessoas: 4 }];
    const r = replicarDia(c, "qua");
    expect(r.dom).toEqual(c.qua);
    r.dom[0].pessoas = 9;
    expect(r.seg[0].pessoas).toBe(4);
  });
  it("interseção de horários", () => {
    const a = { ...horarioTodosOsDias("08:00", "22:00"), sab: null };
    const b = { ...horarioTodosOsDias("10:00", "23:00"), seg: { abre: "22:00", fecha: "23:00" } };
    const r = intersecaoHorarios(a, b);
    expect(r.ter).toEqual({ abre: "10:00", fecha: "22:00" });
    expect(r.sab).toBeNull();
    expect(r.seg).toBeNull();
  });
});
