/**
 * Teste de integração da API contra um Postgres real.
 * Roda só se DATABASE_URL_TEST estiver definida (o banco é recriado do zero).
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarApp } from "../app";

const URL = process.env.DATABASE_URL_TEST;

const COBERTURA = `unidade;dia;inicio;fim;pessoas
Loja A;todos;08:00;22:00;2
Loja B;uteis;09:00;18:00;3
Loja B;sab;09:00;13:00;2
Loja C;todos;10:00;14:00;4
Loja C;todos;14:00;22:00;2
`;
const QUADRO = `unidade;cargo;quantidade;salario;jornada
Loja A;Atendente;5;2.000,00;44
Loja B;Atendente;4;2.200,00;44
Loja C;Atendente;5;1.900,00;44
Loja C;Meio período;2;1.000,00;24
`;

describe.skipIf(!URL)("API (integração)", () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof criarApp>>;
  let token = "";
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    execSync("npx prisma db push --force-reset --skip-generate", { env: { ...process.env, DATABASE_URL: URL }, stdio: "ignore" });
    db = new PrismaClient({ datasources: { db: { url: URL } } });
    app = await criarApp({ db });
  }, 60_000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
  });

  it("cadastro cria rede e sessão; rotas privadas exigem login", async () => {
    expect((await app.inject({ method: "GET", url: "/unidades" })).statusCode).toBe(401);
    const r = await app.inject({ method: "POST", url: "/auth/cadastro", payload: { nomeRede: "Rede Teste", email: "Gestor@Teste.com", senha: "senha-forte" } });
    expect(r.statusCode).toBe(201);
    expect(r.cookies.find((c) => c.name === "sessao")?.httpOnly).toBe(true);
    token = r.json().token;
    expect((await app.inject({ method: "GET", url: "/auth/eu", headers: auth() })).json().rede.nome).toBe("Rede Teste");
    const dup = await app.inject({ method: "POST", url: "/auth/cadastro", payload: { nomeRede: "X", email: "gestor@teste.com", senha: "senha-forte" } });
    expect(dup.statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "gestor@teste.com", senha: "errada123" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "gestor@teste.com", senha: "senha-forte" } })).statusCode).toBe(200);
  });

  it("importação com erro não grava nada", async () => {
    const r = await app.inject({
      method: "POST", url: "/importacao", headers: auth(),
      payload: { cobertura: COBERTURA, quadro: QUADRO + "Loja Z;Caixa;1;1500;44\n" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().detalhes[0]).toMatch(/Loja Z/);
    expect((await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json()).toEqual([]);
  });

  it("critério 1: 3 unidades via CSV → relatório consolidado", async () => {
    const simulado = await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { cobertura: COBERTURA, quadro: QUADRO, simular: true } });
    expect(simulado.json().resumo.unidadesNovas).toEqual(["Loja A", "Loja B", "Loja C"]);
    expect((await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json()).toEqual([]);

    const r = await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { cobertura: COBERTURA, quadro: QUADRO } });
    expect(r.statusCode).toBe(200);
    const unidades = (await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json();
    expect(unidades.map((u: { nome: string }) => u.nome)).toEqual(["Loja A", "Loja B", "Loja C"]);

    const sim = (await app.inject({ method: "GET", url: "/simulacao?data=2026-10-23", headers: auth() })).json();
    expect(sim.resultado.unidades).toHaveLength(3);
    expect(sim.resultado.consolidado.map((c: { fase: { jornadaSemanal: number } }) => c.fase.jornadaSemanal)).toEqual([44, 42, 40]);
    const lojaA = sim.resultado.unidades[0];
    expect(lojaA.fases[0].horasCoberturaSemana).toBe(196);
    // margem padrão de 5%: 196 / 38,72 × 1,05
    expect(lojaA.fases[0].fteNecessario).toBeCloseTo((196 / 38.72) * 1.05, 8);
    expect(sim.premissasDescritas.length).toBeGreaterThan(5);
  });

  it("reimportar uma unidade substitui o quadro dela", async () => {
    await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { quadro: "unidade;cargo;quantidade;salario;jornada\nLoja A;Atendente;6;2000;44\n" } });
    const lista = (await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json();
    expect(lista.find((u: { nome: string }) => u.nome === "Loja A").headcount).toBe(6);
  });

  it("importação com setor, semana de pico, bandeira e regional", async () => {
    const cobertura = `unidade;dia;inicio;fim;pessoas;setor;semana;bandeira;regional
Mercado;todos;08:00;22:00;2;Caixa;;Premium;Sul
Mercado;todos;08:00;22:00;1;Açougue;;;
Mercado;todos;08:00;23:00;3;Caixa;pico;;
Mercado;todos;08:00;23:00;1;Açougue;pico;;
`;
    const quadro = `unidade;cargo;quantidade;salario;jornada;setor
Mercado;Operador de caixa;7;2.000,00;44;Caixa
Mercado;Açougueiro;1;3.000,00;44;Açougue
`;
    const r = await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { cobertura, quadro } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resumo.unidadesComPico).toEqual(["Mercado"]);
    const sim = (await app.inject({ method: "GET", url: "/simulacao?data=2026-10-23", headers: auth() })).json().resultado;
    const mercado = sim.unidades.find((u: { nome: string }) => u.nome === "Mercado");
    expect(mercado.bandeira).toBe("Premium");
    expect(mercado.fases[2].setores.map((s: { setor: string }) => s.setor)).toEqual(["Açougue", "Caixa"]);
    expect(mercado.fases[2].deficitFte).toBeGreaterThan(mercado.fases[2].deltaFte);
    expect(mercado.fasesPico[2].horasCoberturaSemana).toBe(15 * 7 * 4);
    expect(sim.pico.unidadesComPico).toBe(1);
    expect(sim.grupos.map((g: { tipo: string; nome: string }) => `${g.tipo}:${g.nome}`)).toEqual(["bandeira:Premium", "bandeira:", "regional:Sul", "regional:"]);

    // descrição do pico é mantida ao reimportar; sem a coluna semana, o pico não muda
    const u = (await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json().find((x: { nome: string }) => x.nome === "Mercado");
    const completa = (await app.inject({ method: "GET", url: `/unidades/${u.id}`, headers: auth() })).json();
    await app.inject({ method: "PUT", url: `/unidades/${u.id}`, headers: auth(), payload: { ...completa, pico: { ...completa.pico, descricao: "Natal" } } });
    await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { cobertura } });
    expect((await app.inject({ method: "GET", url: `/unidades/${u.id}`, headers: auth() })).json().pico.descricao).toBe("Natal");
    await app.inject({ method: "POST", url: "/importacao", headers: auth(), payload: { cobertura: "unidade;dia;inicio;fim;pessoas\nMercado;todos;08:00;22:00;3\n" } });
    const depois = (await app.inject({ method: "GET", url: `/unidades/${u.id}`, headers: auth() })).json();
    expect(depois.pico.descricao).toBe("Natal");
    expect(depois.bandeira).toBe("Premium");

    const csv = (await app.inject({ method: "GET", url: "/relatorio.csv", headers: auth() })).body;
    expect(csv).toContain("SETORES (D-32)");
    expect(csv).toContain("BANDEIRA: Premium (consolidado)");
    expect(csv).toContain(";pico;");
    const pdf = await app.inject({ method: "GET", url: "/relatorio.pdf", headers: auth() });
    expect(pdf.statusCode).toBe(200);
    await app.inject({ method: "DELETE", url: `/unidades/${u.id}`, headers: auth() });
  });

  it("critério 3: premissas alteradas recalculam sem salvar; PUT persiste", async () => {
    const base = (await app.inject({ method: "GET", url: "/simulacao", headers: auth() })).json().resultado.consolidado[2];
    const outra = (await app.inject({ method: "POST", url: "/simulacao", headers: auth(), payload: { premissas: { perdas: 0.25, adicionalHoraExtra: 1 } } })).json().resultado.consolidado[2];
    expect(outra.fteNecessario).toBeGreaterThan(base.fteNecessario);
    expect(outra.custos.horaExtra).toBeGreaterThan(base.custos.horaExtra);
    const invalida = await app.inject({ method: "POST", url: "/simulacao", headers: auth(), payload: { premissas: { perdas: 2 } } });
    expect(invalida.statusCode).toBe(400);
    const put = await app.inject({ method: "PUT", url: "/premissas", headers: auth(), payload: { perdas: 0.15, divisores: { fase2: 190 } } });
    expect(put.json().premissas.perdas).toBe(0.15);
    const salvas = (await app.inject({ method: "GET", url: "/simulacao", headers: auth() })).json().resultado;
    expect(salvas.premissas.perdas).toBe(0.15);
    expect(salvas.unidades[0].fases[2].divisorUsado).toBe(190);
  });

  it("critério 5: CSV e PDF trazem premissas, limitações e aviso jurídico", async () => {
    const csv = await app.inject({ method: "GET", url: "/relatorio.csv", headers: auth() });
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body).toContain("não constitui parecer jurídico");
    expect(csv.body).toContain("PREMISSAS");
    expect(csv.body).toContain("LIMITAÇÕES");
    expect(csv.body).toContain("REDE (consolidado)");
    const pdf = await app.inject({ method: "GET", url: "/relatorio.pdf", headers: auth() });
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.rawPayload.length).toBeGreaterThan(3000);
  });

  it("CRUD de unidade com validação", async () => {
    const vazio = { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] };
    const fechado = { seg: null, ter: null, qua: null, qui: null, sex: null, sab: null, dom: null };
    const nova = {
      nome: "Loja D",
      horarios: { ...fechado, seg: { abre: "08:00", fecha: "18:00" } },
      cobertura: { ...vazio, seg: [{ inicio: "08:00", fim: "18:00", pessoas: 2 }] },
      quadro: [{ nome: "Atendente", quantidade: 1, salarioBase: 2000, jornadaSemanal: 44 }],
    };
    const criada = await app.inject({ method: "POST", url: "/unidades", headers: auth(), payload: nova });
    expect(criada.statusCode).toBe(201);
    const id = criada.json().id;
    const ruim = await app.inject({ method: "PUT", url: `/unidades/${id}`, headers: auth(), payload: { ...nova, horarios: { ...fechado, seg: { abre: "08:00", fecha: "08:00" } } } });
    expect(ruim.statusCode).toBe(400);
    // D-32 a D-35: setor, pico, grupos e turno que vira o dia
    const completa = {
      ...nova,
      bandeira: " Premium ",
      regional: "Sul",
      horarios: { ...fechado, seg: { abre: "18:00", fecha: "02:00" } },
      cobertura: { ...vazio, seg: [{ inicio: "18:00", fim: "02:00", pessoas: 2, setor: "Cozinha" }, { inicio: "18:00", fim: "02:00", pessoas: 1, setor: "" }] },
      quadro: [{ ...nova.quadro[0], setor: "Cozinha" }],
      pico: { descricao: "Natal", horarios: { ...fechado, seg: { abre: "18:00", fecha: "03:00" } }, cobertura: { ...vazio, seg: [{ inicio: "18:00", fim: "03:00", pessoas: 3 }] } },
    };
    const salva = (await app.inject({ method: "PUT", url: `/unidades/${id}`, headers: auth(), payload: completa })).json();
    expect(salva.bandeira).toBe("Premium");
    expect(salva.cobertura.seg).toEqual([{ inicio: "18:00", fim: "02:00", pessoas: 2, setor: "Cozinha" }, { inicio: "18:00", fim: "02:00", pessoas: 1 }]);
    expect(salva.quadro[0].setor).toBe("Cozinha");
    expect(salva.pico.descricao).toBe("Natal");
    const resumo = (await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json().find((u: { id: string }) => u.id === id);
    expect(resumo).toMatchObject({ temPico: true, bandeira: "Premium", regional: "Sul", horasAbertasSemana: 8 });
    const semPico = (await app.inject({ method: "PUT", url: `/unidades/${id}`, headers: auth(), payload: { ...completa, pico: null, bandeira: "" } })).json();
    expect(semPico.pico).toBeNull();
    expect(semPico.bandeira).toBeNull();
    const red = await app.inject({ method: "PUT", url: `/unidades/${id}`, headers: auth(), payload: { ...nova, horarioReduzido: { ...fechado, seg: { abre: "09:00", fecha: "17:00" } } } });
    expect(red.json().horarioReduzido.seg.abre).toBe("09:00");
    const semRed = await app.inject({ method: "PUT", url: `/unidades/${id}`, headers: auth(), payload: { ...nova, horarioReduzido: null } });
    expect(semRed.json().horarioReduzido).toBeNull();
    expect((await app.inject({ method: "POST", url: "/unidades", headers: auth(), payload: nova })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/unidades/${id}`, headers: auth() })).statusCode).toBe(200);
  });

  it("multi-tenant: outra rede não enxerga as unidades", async () => {
    const outra = await app.inject({ method: "POST", url: "/auth/cadastro", payload: { nomeRede: "Outra", email: "outro@teste.com", senha: "senha-forte" } });
    const t2 = outra.json().token;
    const minhas = (await app.inject({ method: "GET", url: "/unidades", headers: auth() })).json();
    expect((await app.inject({ method: "GET", url: "/unidades", headers: { authorization: `Bearer ${t2}` } })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/unidades/${minhas[0].id}`, headers: { authorization: `Bearer ${t2}` } })).statusCode).toBe(404);
  });

  it("LGPD: excluir conta apaga tudo da rede", async () => {
    const r = await app.inject({ method: "DELETE", url: "/conta", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(await db.unidade.count({ where: { rede: { nome: "Rede Teste" } } })).toBe(0);
    expect(await db.cargo.count({ where: { unidade: { rede: { nome: "Rede Teste" } } } })).toBe(0);
    expect((await app.inject({ method: "GET", url: "/auth/eu", headers: auth() })).statusCode).toBe(401);
  });
});
