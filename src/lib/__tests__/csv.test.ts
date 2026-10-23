import { describe, expect, it } from "vitest";
import { horasCoberturaSemana } from "../../engine";
import {
  detectarSeparador,
  importarCobertura,
  importarQuadro,
  lerLinhas,
  lerNumeroBR,
  MODELO_COBERTURA,
  MODELO_QUADRO,
} from "../csv";

describe("números no formato brasileiro", () => {
  it.each([
    ["2.500,00", 2500],
    ["2500,5", 2500.5],
    ["2500.50", 2500.5],
    ["R$ 2.500", 2500],
    ["1.234.567,89", 1234567.89],
    ["44", 44],
    ["", Number.NaN],
    ["abc", Number.NaN],
  ])("%s → %d", (v, esperado) => {
    expect(lerNumeroBR(v)).toEqual(esperado);
  });
});

describe("leitor de CSV", () => {
  it("separador e aspas", () => {
    expect(detectarSeparador("a;b\n1;2")).toBe(";");
    expect(detectarSeparador("a,b")).toBe(",");
    expect(lerLinhas('a,"b, c","d ""e"""\r\n1,2,3', ",")).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "2", "3"],
    ]);
    expect(lerLinhas("﻿x;y", ";")).toEqual([["x", "y"]]);
  });
});

describe("cobertura.csv", () => {
  it("modelo de download importa sem erros", () => {
    const { unidades, erros } = importarCobertura(MODELO_COBERTURA);
    expect(erros).toEqual([]);
    expect(unidades.map((u) => u.nome)).toEqual(["Loja Centro", "Loja Bairro", "Posto Rodovia"]);
    const centro = unidades[0];
    expect(centro.horarios.dom).toEqual({ abre: "08:00", fecha: "22:00" });
    expect(horasCoberturaSemana(centro.cobertura, centro.horarios)).toBe((4 * 2 + 2 * 3 + 8 * 2) * 7);
    const bairro = unidades[1];
    expect(bairro.horarios.sab).toEqual({ abre: "09:00", fecha: "14:00" });
    expect(bairro.horarios.dom).toBeNull();
  });
  it("cabeçalho com acentos/maiúsculas e separador vírgula; dias por extenso", () => {
    const { unidades, erros } = importarCobertura("Unidade,Dia,Início,Fim,Pessoas\nA,Segunda-feira,08:00,10:00,1\nA,sábado,08:00,10:00,1\n\n");
    expect(erros).toEqual([]);
    expect(unidades[0].cobertura.seg).toHaveLength(1);
    expect(unidades[0].cobertura.sab).toHaveLength(1);
  });
  it("aponta linha e problema", () => {
    const { erros, unidades } = importarCobertura(
      "unidade;dia;inicio;fim;pessoas\n;xyz;8h;07:00;-1\nA;seg;10:00;10:00;1\nA;seg;10:00;12:00;2",
    );
    expect(erros[0]).toMatch(/^Linha 2: unidade vazia; dia inválido.*inicio inválido.*pessoas/);
    expect(erros[1]).toMatch(/^Linha 3: fim igual ao início/);
    expect(unidades[0].cobertura.seg).toHaveLength(1);
  });
  it("cabeçalho errado ou arquivo vazio", () => {
    expect(importarCobertura("nome;dia\nA;seg").erros[0]).toMatch(/faltam as colunas unidade, inicio, fim, pessoas/);
    expect(importarCobertura("").erros[0]).toMatch(/vazio/);
    expect(importarCobertura("unidade;dia;inicio;fim;pessoas\n").erros[0]).toMatch(/Nenhuma linha/);
  });
});

describe("cobertura.csv: colunas opcionais (D-32 a D-35)", () => {
  const { unidades, erros } = importarCobertura(MODELO_COBERTURA);
  const [centro, bairro, posto] = unidades;

  it("setor vai para a faixa; vazio não cria setor", () => {
    expect(erros).toEqual([]);
    expect(bairro.cobertura.seg).toEqual([
      { inicio: "09:00", fim: "19:00", pessoas: 2, setor: "Caixa" },
      { inicio: "09:00", fim: "19:00", pessoas: 1, setor: "Padaria" },
    ]);
    expect(centro.cobertura.seg[0]).not.toHaveProperty("setor");
  });
  it("linhas de pico formam a semana de pico, com horário próprio", () => {
    expect(centro.pico!.horarios.seg).toEqual({ abre: "08:00", fecha: "23:00" });
    expect(horasCoberturaSemana(centro.pico!.cobertura, centro.pico!.horarios)).toBe(15 * 3 * 7);
    expect(centro.cobertura.seg).toHaveLength(3);
    expect(bairro.pico).toBeNull();
  });
  it("bandeira e regional por unidade, informadas em qualquer linha", () => {
    expect([centro.bandeira, centro.regional]).toEqual(["Bandeira A", "Sul"]);
    expect([posto.bandeira, posto.regional]).toEqual(["Conveniência", "Sudeste"]);
  });
  it("turno que vira o dia infere horário até o dia seguinte", () => {
    expect(posto.horarios.seg).toEqual({ abre: "22:00", fecha: "06:00" });
    expect(horasCoberturaSemana(posto.cobertura, posto.horarios)).toBe(8 * 7);
  });
  it("sem as colunas, pico e grupos ficam indefinidos (não mexer no que existe)", () => {
    const [u] = importarCobertura("unidade;dia;inicio;fim;pessoas\nA;seg;08:00;12:00;1").unidades;
    expect(u).not.toHaveProperty("pico");
    expect(u).not.toHaveProperty("bandeira");
    expect(u).not.toHaveProperty("regional");
  });
  it("erros: semana inválida, bandeira conflitante, mais de 24 h no dia", () => {
    const { erros } = importarCobertura(
      "unidade;dia;inicio;fim;pessoas;semana;bandeira\nA;seg;08:00;12:00;1;natal;\nA;seg;08:00;12:00;1;;X\nA;seg;13:00;14:00;1;;Y\nB;seg;00:00;06:00;1;;\nB;seg;22:00;06:00;1;;",
    );
    expect(erros).toEqual([
      "Linha 2: semana inválida (use tipica ou pico).",
      "Linha 4: bandeira diferente da informada em outra linha da mesma unidade.",
      'Unidade "B", seg: as faixas do dia passam de 24 h; lance a madrugada no dia em que o turno começa (D-35).',
    ]);
  });
  it("00:00 a 24:00 é o dia inteiro", () => {
    const [u] = importarCobertura("unidade;dia;inicio;fim;pessoas\nA;seg;00:00;24:00;1").unidades;
    expect(u.horarios.seg).toEqual({ abre: "00:00", fecha: "24:00" });
  });
});

describe("quadro.csv", () => {
  it("setor opcional no cargo", () => {
    const { quadros, erros } = importarQuadro(MODELO_QUADRO);
    expect(erros).toEqual([]);
    expect(quadros[1].cargos[1]).toEqual({ nome: "Padeiro", quantidade: 1, salarioBase: 2400, jornadaSemanal: 44, setor: "Padaria" });
  });
  it("modelo de download importa sem erros", () => {
    const { quadros, erros } = importarQuadro(MODELO_QUADRO);
    expect(erros).toEqual([]);
    expect(quadros[0]).toEqual({
      unidade: "Loja Centro",
      cargos: [
        { nome: "Atendente", quantidade: 5, salarioBase: 2100, jornadaSemanal: 44 },
        { nome: "Caixa", quantidade: 2, salarioBase: 1950, jornadaSemanal: 44 },
      ],
    });
  });
  it("erros não expõem o valor do salário (LGPD)", () => {
    const { erros } = importarQuadro("unidade;cargo;quantidade;salario;jornada\nA;;1,5;-1234,56;50");
    expect(erros[0]).toMatch(/Linha 2: cargo vazio; quantidade .*; salário inválido; jornada/);
    expect(erros[0]).not.toContain("1234");
  });
});
