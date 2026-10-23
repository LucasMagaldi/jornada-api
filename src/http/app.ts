import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { Prisma } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  calcularRede,
  DIAS_SEMANA,
  horaParaMinutos,
  horasAbertasSemana,
  normalizarPremissas,
  premissasPadrao,
  validarPremissas,
} from "../engine";
import type { Premissas } from "../engine";
import { buscarUsuarioDaSessao, COOKIE_SESSAO, criarSessao, DURACAO_SESSAO_MS, encerrarSessao, hashSenha, verificarSenha } from "../lib/auth";
import { importarCobertura, importarQuadro, MODELO_COBERTURA, MODELO_QUADRO } from "../lib/csv";
import type { Db } from "../lib/db";
import { descreverPremissas } from "../lib/descricao";
import { carregarConfigRegras, hojeISO, versaoVigente } from "../lib/regras-loader";
import { gerarRelatorioCsv } from "../lib/relatorio-csv";
import { gerarRelatorioPdf } from "../lib/relatorio-pdf";
import { cargosParaDb, carregarPremissas, carregarUnidades, json, paraMotor } from "../lib/repositorio";
import { AVISO_JURIDICO, LIMITACOES } from "../lib/textos";

// ---------------------------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------------------------

const zHora = z.string().refine((h) => {
  try {
    horaParaMinutos(h);
    return true;
  } catch {
    return false;
  }
}, "Horário inválido (HH:MM)");

const zJanela = z
  .object({ abre: zHora, fecha: zHora })
  .refine((j) => horaParaMinutos(j.fecha) > horaParaMinutos(j.abre), "Fechamento deve ser depois da abertura")
  .nullable();
const zHorario = z.object(Object.fromEntries(DIAS_SEMANA.map((d) => [d, zJanela])) as Record<(typeof DIAS_SEMANA)[number], typeof zJanela>);
const zFaixa = z
  .object({ inicio: zHora, fim: zHora, pessoas: z.number().int().min(0).max(1000) })
  .refine((f) => horaParaMinutos(f.fim) > horaParaMinutos(f.inicio), "Fim da faixa deve ser depois do início");
const zCobertura = z.object(Object.fromEntries(DIAS_SEMANA.map((d) => [d, z.array(zFaixa).max(48)])) as Record<(typeof DIAS_SEMANA)[number], z.ZodArray<typeof zFaixa>>);
const zCargo = z.object({
  nome: z.string().trim().min(1).max(100),
  quantidade: z.number().int().min(0).max(100000),
  salarioBase: z.number().positive().max(1_000_000),
  jornadaSemanal: z.number().positive().max(44),
});
const zUnidade = z.object({
  nome: z.string().trim().min(1).max(120),
  horarios: zHorario,
  horarioReduzido: zHorario.nullable().optional(),
  cobertura: zCobertura,
  quadro: z.array(zCargo).max(200),
});
const zPremissas = z
  .object({
    perdas: z.number(),
    fatorEncargos: z.number(),
    adicionalHoraExtra: z.number(),
    margemSeguranca: z.number(),
    divisores: z.record(z.number()),
    mixPercentualContratacao: z.number(),
    encargosSobreHoraExtra: z.boolean(),
  })
  .partial();
const zData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const zCredenciais = z.object({ email: z.string().trim().toLowerCase().email().max(200), senha: z.string().min(8).max(200) });

class ErroHttp extends Error {
  constructor(public status: number, mensagem: string, public detalhes?: unknown) {
    super(mensagem);
  }
}

function validar<T>(schema: z.ZodType<T>, dados: unknown): T {
  const r = schema.safeParse(dados);
  if (!r.success) {
    throw new ErroHttp(400, "Dados inválidos", r.error.issues.map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`));
  }
  return r.data;
}

// ---------------------------------------------------------------------------

declare module "fastify" {
  interface FastifyRequest {
    usuario: { id: string; email: string; redeId: string } | null;
  }
}

export interface OpcoesApp {
  db: Db;
  logger?: boolean;
  origemUi?: string;
  cookieSeguro?: boolean;
}

export async function criarApp({ db, logger = false, origemUi, cookieSeguro = false }: OpcoesApp) {
  const app = Fastify({
    // Não registrar corpo das requisições: há salários (LGPD, D-24).
    logger: logger ? { redact: ["req.headers.cookie", "req.headers.authorization"] } : false,
    bodyLimit: 5 * 1024 * 1024,
  });
  await app.register(cookie);
  if (origemUi) await app.register(cors, { origin: origemUi, credentials: true });

  app.decorateRequest("usuario", null);

  app.setErrorHandler((erro, _req, reply) => {
    if (erro instanceof ErroHttp) return reply.status(erro.status).send({ erro: erro.message, detalhes: erro.detalhes });
    if ((erro as { statusCode?: number }).statusCode && (erro as { statusCode: number }).statusCode < 500) {
      return reply.status((erro as { statusCode: number }).statusCode).send({ erro: erro.message });
    }
    app.log.error({ err: { message: erro.message, stack: erro.stack } }, "erro interno");
    return reply.status(500).send({ erro: "Erro interno" });
  });

  const tokenDa = (req: FastifyRequest) => {
    const auth = req.headers.authorization;
    return auth?.startsWith("Bearer ") ? auth.slice(7) : req.cookies[COOKIE_SESSAO];
  };

  async function exigirLogin(req: FastifyRequest) {
    const u = await buscarUsuarioDaSessao(db, tokenDa(req));
    if (!u) throw new ErroHttp(401, "Não autenticado");
    req.usuario = { id: u.id, email: u.email, redeId: u.redeId };
  }
  const redeId = (req: FastifyRequest) => req.usuario!.redeId;

  async function abrirSessao(reply: FastifyReply, usuarioId: string) {
    const { token, expiraEm } = await criarSessao(db, usuarioId);
    reply.setCookie(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: cookieSeguro,
      path: "/",
      expires: expiraEm,
      maxAge: DURACAO_SESSAO_MS / 1000,
    });
    return token;
  }

  async function unidadeDaRede(req: FastifyRequest, id: string) {
    const u = await db.unidade.findFirst({ where: { id, redeId: redeId(req) }, include: { cargos: { orderBy: { nome: "asc" } } } });
    if (!u) throw new ErroHttp(404, "Unidade não encontrada");
    return u;
  }

  async function simular(req: FastifyRequest, data?: string, premissasOverride?: Partial<Premissas>) {
    const dataRef = data ?? hojeISO();
    const versao = versaoVigente(dataRef);
    const premissas = premissasOverride ? normalizarPremissas(premissasOverride, versao) : await carregarPremissas(db, redeId(req), versao);
    const erros = validarPremissas(premissas);
    if (erros.length) throw new ErroHttp(400, "Premissas inválidas", erros);
    const unidades = await carregarUnidades(db, redeId(req));
    const rede = await db.rede.findUniqueOrThrow({ where: { id: redeId(req) } });
    return { resultado: calcularRede(unidades, versao, premissas), rede, dataRef };
  }

  // ---- saúde e públicos ----------------------------------------------------
  app.get("/saude", async () => ({ ok: true }));
  app.get("/textos", async () => ({ avisoJuridico: AVISO_JURIDICO, limitacoes: LIMITACOES }));
  app.get("/modelos/cobertura.csv", async (_req, reply) =>
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="modelo-cobertura.csv"').send(MODELO_COBERTURA),
  );
  app.get("/modelos/quadro.csv", async (_req, reply) =>
    reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="modelo-quadro.csv"').send(MODELO_QUADRO),
  );

  // ---- autenticação --------------------------------------------------------
  app.post("/auth/cadastro", async (req, reply) => {
    const dados = validar(zCredenciais.extend({ nomeRede: z.string().trim().min(1).max(120) }), req.body);
    if (await db.usuario.findUnique({ where: { email: dados.email } })) throw new ErroHttp(409, "E-mail já cadastrado");
    const rede = await db.rede.create({
      data: { nome: dados.nomeRede, usuarios: { create: { email: dados.email, senhaHash: await hashSenha(dados.senha) } } },
      include: { usuarios: true },
    });
    const token = await abrirSessao(reply, rede.usuarios[0].id);
    return reply.status(201).send({ usuario: { email: dados.email }, rede: { id: rede.id, nome: rede.nome }, token });
  });

  app.post("/auth/login", async (req, reply) => {
    const dados = validar(zCredenciais, req.body);
    const u = await db.usuario.findUnique({ where: { email: dados.email }, include: { rede: true } });
    if (!u || !(await verificarSenha(dados.senha, u.senhaHash))) throw new ErroHttp(401, "E-mail ou senha inválidos");
    const token = await abrirSessao(reply, u.id);
    return { usuario: { email: u.email }, rede: { id: u.rede.id, nome: u.rede.nome }, token };
  });

  app.post("/auth/logout", async (req, reply) => {
    await encerrarSessao(db, tokenDa(req));
    reply.clearCookie(COOKIE_SESSAO, { path: "/" });
    return { ok: true };
  });

  // ---- rotas autenticadas --------------------------------------------------
  app.register(async (priv) => {
    priv.addHook("preHandler", exigirLogin);

    priv.get("/auth/eu", async (req) => {
      const rede = await db.rede.findUniqueOrThrow({ where: { id: redeId(req) } });
      return { usuario: { email: req.usuario!.email }, rede: { id: rede.id, nome: rede.nome } };
    });

    /** Exclusão a pedido (LGPD): apaga rede, usuários, sessões, unidades e quadro. */
    priv.delete("/conta", async (req, reply) => {
      await db.rede.delete({ where: { id: redeId(req) } });
      reply.clearCookie(COOKIE_SESSAO, { path: "/" });
      return { ok: true };
    });

    priv.get("/regras", async (req) => {
      const { data } = validar(z.object({ data: zData }), req.query);
      const dataRef = data ?? hojeISO();
      const config = carregarConfigRegras();
      return { dataReferencia: dataRef, vigente: versaoVigente(dataRef), versoes: config.versoes.map((v) => ({ id: v.id, vigenteDesde: v.vigenteDesde, descricao: v.descricao })) };
    });

    priv.get("/premissas", async (req) => {
      const versao = versaoVigente();
      return { premissas: await carregarPremissas(db, redeId(req), versao), padrao: premissasPadrao(versao) };
    });

    priv.put("/premissas", async (req) => {
      const parcial = validar(zPremissas, req.body);
      const versao = versaoVigente();
      const premissas = normalizarPremissas(parcial, versao);
      const erros = validarPremissas(premissas);
      if (erros.length) throw new ErroHttp(400, "Premissas inválidas", erros);
      await db.rede.update({ where: { id: redeId(req) }, data: { premissas: json(premissas) } });
      return { premissas };
    });

    // Unidades
    priv.get("/unidades", async (req) => {
      const unidades = await carregarUnidades(db, redeId(req));
      return unidades.map((u) => ({
        id: u.id,
        nome: u.nome,
        headcount: u.quadro.reduce((s, c) => s + c.quantidade, 0),
        horasAbertasSemana: horasAbertasSemana(u.horarios),
        temHorarioReduzido: !!u.horarioReduzido,
      }));
    });

    priv.get<{ Params: { id: string } }>("/unidades/:id", async (req) => paraMotor(await unidadeDaRede(req, req.params.id)));

    priv.post("/unidades", async (req, reply) => {
      const u = validar(zUnidade, req.body);
      if (await db.unidade.findFirst({ where: { redeId: redeId(req), nome: u.nome } })) throw new ErroHttp(409, "Já existe unidade com esse nome");
      const criada = await db.unidade.create({
        data: {
          redeId: redeId(req),
          nome: u.nome,
          horarios: json(u.horarios),
          horarioReduzido: u.horarioReduzido ? json(u.horarioReduzido) : undefined,
          cobertura: json(u.cobertura),
          cargos: { create: cargosParaDb(u.quadro) },
        },
        include: { cargos: true },
      });
      return reply.status(201).send(paraMotor(criada));
    });

    priv.put<{ Params: { id: string } }>("/unidades/:id", async (req) => {
      await unidadeDaRede(req, req.params.id);
      const u = validar(zUnidade, req.body);
      const mesmoNome = await db.unidade.findFirst({ where: { redeId: redeId(req), nome: u.nome, NOT: { id: req.params.id } } });
      if (mesmoNome) throw new ErroHttp(409, "Já existe unidade com esse nome");
      const [, atualizada] = await db.$transaction([
        db.cargo.deleteMany({ where: { unidadeId: req.params.id } }),
        db.unidade.update({
          where: { id: req.params.id },
          data: {
            nome: u.nome,
            horarios: json(u.horarios),
            horarioReduzido: u.horarioReduzido ? json(u.horarioReduzido) : Prisma.DbNull,
            cobertura: json(u.cobertura),
            cargos: { create: cargosParaDb(u.quadro) },
          },
          include: { cargos: true },
        }),
      ]);
      return paraMotor(atualizada);
    });

    priv.delete<{ Params: { id: string } }>("/unidades/:id", async (req) => {
      await unidadeDaRede(req, req.params.id);
      await db.unidade.delete({ where: { id: req.params.id } });
      return { ok: true };
    });

    // Importação CSV: tudo ou nada.
    priv.post("/importacao", async (req) => {
      const dados = validar(
        z.object({ cobertura: z.string().max(2_000_000).optional(), quadro: z.string().max(2_000_000).optional(), simular: z.boolean().optional() }),
        req.body,
      );
      if (!dados.cobertura && !dados.quadro) throw new ErroHttp(400, "Envie ao menos um arquivo (cobertura ou quadro)");
      const cob = dados.cobertura ? importarCobertura(dados.cobertura) : { unidades: [], erros: [] };
      const qua = dados.quadro ? importarQuadro(dados.quadro) : { quadros: [], erros: [] };
      const erros = [...cob.erros.map((e) => `cobertura.csv — ${e}`), ...qua.erros.map((e) => `quadro.csv — ${e}`)];

      const existentes = await db.unidade.findMany({ where: { redeId: redeId(req) }, select: { id: true, nome: true } });
      const nomesExistentes = new Set(existentes.map((u) => u.nome));
      const nomesCobertura = new Set(cob.unidades.map((u) => u.nome));
      for (const q of qua.quadros) {
        if (!nomesCobertura.has(q.unidade) && !nomesExistentes.has(q.unidade)) {
          erros.push(`quadro.csv — unidade "${q.unidade}" não existe; inclua-a no cobertura.csv ou cadastre-a antes.`);
        }
      }
      const resumo = {
        unidadesNovas: cob.unidades.filter((u) => !nomesExistentes.has(u.nome)).map((u) => u.nome),
        unidadesAtualizadas: [...new Set([...cob.unidades.map((u) => u.nome), ...qua.quadros.map((q) => q.unidade)])].filter((n) => nomesExistentes.has(n)),
        linhasQuadro: qua.quadros.reduce((s, q) => s + q.cargos.length, 0),
      };
      if (erros.length) throw new ErroHttp(422, "O arquivo tem erros; nada foi importado", erros);
      if (dados.simular) return { ok: true, simulado: true, resumo };

      await db.$transaction(async (tx) => {
        const ids = new Map(existentes.map((u) => [u.nome, u.id]));
        for (const u of cob.unidades) {
          const id = ids.get(u.nome);
          if (id) {
            await tx.unidade.update({ where: { id }, data: { horarios: json(u.horarios), cobertura: json(u.cobertura) } });
          } else {
            const criada = await tx.unidade.create({ data: { redeId: redeId(req), nome: u.nome, horarios: json(u.horarios), cobertura: json(u.cobertura) } });
            ids.set(u.nome, criada.id);
          }
        }
        for (const q of qua.quadros) {
          const id = ids.get(q.unidade)!;
          await tx.cargo.deleteMany({ where: { unidadeId: id } });
          await tx.cargo.createMany({ data: cargosParaDb(q.cargos).map((c) => ({ ...c, unidadeId: id })) });
        }
      });
      return { ok: true, simulado: false, resumo };
    });

    // Simulação: GET usa premissas salvas; POST recalcula com premissas não salvas (critério 3).
    priv.get("/simulacao", async (req) => {
      const { data } = validar(z.object({ data: zData }), req.query);
      const { resultado, dataRef } = await simular(req, data);
      return { dataReferencia: dataRef, resultado, premissasDescritas: descreverPremissas(resultado.premissas, resultado.versaoRegras) };
    });

    priv.post("/simulacao", async (req) => {
      const { data, premissas } = validar(z.object({ data: zData, premissas: zPremissas }), req.body);
      const { resultado, dataRef } = await simular(req, data, premissas);
      return { dataReferencia: dataRef, resultado, premissasDescritas: descreverPremissas(resultado.premissas, resultado.versaoRegras) };
    });

    priv.get("/relatorio.csv", async (req, reply) => {
      const { data } = validar(z.object({ data: zData }), req.query);
      const { resultado, rede, dataRef } = await simular(req, data);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="simulacao-6x1-${dataRef}.csv"`)
        .send(gerarRelatorioCsv(resultado, rede.nome, dataRef));
    });

    priv.get("/relatorio.pdf", async (req, reply) => {
      const { data } = validar(z.object({ data: zData }), req.query);
      const { resultado, rede, dataRef } = await simular(req, data);
      const pdf = await gerarRelatorioPdf(resultado, rede.nome, dataRef);
      return reply
        .header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="simulacao-6x1-${dataRef}.pdf"`)
        .send(pdf);
    });
  });

  return app;
}
