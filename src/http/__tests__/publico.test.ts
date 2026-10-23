/** Rotas públicas da página de apresentação (D-36, D-37). Não usam banco, então rodam sempre. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../../lib/db";
import { criarApp } from "../app";

const ENTRADA = {
  unidades: 10,
  semana: { abre: "08:00", fecha: "22:00" },
  sabado: { abre: "08:00", fecha: "22:00" },
  domingo: { abre: "08:00", fecha: "22:00" },
  pessoas: 2,
  colaboradores: 5,
  salarioMedio: 2000,
};

describe("rotas públicas", () => {
  let app: Awaited<ReturnType<typeof criarApp>>;
  beforeAll(async () => {
    app = await criarApp({ db: {} as Db });
  });
  afterAll(async () => {
    await app?.close();
  });

  it("regras vigentes saem do arquivo de configuração", async () => {
    const r = await app.inject({ method: "GET", url: "/publico/regras" });
    expect(r.statusCode).toBe(200);
    expect(r.json().vigente.fases.map((f: { jornadaSemanal: number }) => f.jornadaSemanal)).toEqual([44, 42, 40]);
  });

  it("diagnóstico calcula sem login, com premissas e jornada padrão", async () => {
    const r = await app.inject({ method: "POST", url: "/publico/diagnostico", payload: { ...ENTRADA, premissas: { margemSeguranca: 0 } } });
    expect(r.statusCode).toBe(200);
    const corpo = r.json();
    expect(corpo.unidades).toBe(10);
    const fases = corpo.resultado.unidades[0].fases;
    expect(fases[0].fteNecessario).toBeCloseTo(5.06, 2);
    expect(fases[2].fteNecessario).toBeCloseTo(5.57, 2);
    expect(corpo.premissasDescritas[0][0]).toBe("Diagnóstico rápido");
    expect(corpo.premissasDescritas.map((l: string[]) => l[0])).toContain("Margem de segurança");
  });

  it("valida a entrada", async () => {
    const post = (payload: object) => app.inject({ method: "POST", url: "/publico/diagnostico", payload });
    expect((await post({ ...ENTRADA, pessoas: 0 })).statusCode).toBe(400);
    expect((await post({ ...ENTRADA, semana: { abre: "08:00", fecha: "08:00" } })).statusCode).toBe(400);
    expect((await post({ ...ENTRADA, setor: { nome: "demais funções", pessoas: 1, colaboradores: 1, salarioMedio: 3000 } })).statusCode).toBe(400);
    const premissas = await post({ ...ENTRADA, premissas: { perdas: 2 } });
    expect(premissas.statusCode).toBe(400);
    expect(premissas.json().erro).toBe("Premissas inválidas");
    const grande = await post({ ...ENTRADA, lixo: "x".repeat(20_000) });
    expect(grande.statusCode).toBe(413);
  });
});
