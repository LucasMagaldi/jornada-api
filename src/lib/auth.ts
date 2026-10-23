import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "./db";

export const COOKIE_SESSAO = "sessao";
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000;

export const hashSenha = (senha: string) => bcrypt.hash(senha, 10);
export const verificarSenha = (senha: string, hash: string) => bcrypt.compare(senha, hash);

/** Só o hash do token fica no banco; o token em claro vai apenas no cookie. */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function criarSessao(db: Db, usuarioId: string): Promise<{ token: string; expiraEm: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + DURACAO_SESSAO_MS);
  await db.sessao.create({ data: { token: hashToken(token), usuarioId, expiraEm } });
  return { token, expiraEm };
}

export async function buscarUsuarioDaSessao(db: Db, token: string | undefined) {
  if (!token) return null;
  const sessao = await db.sessao.findUnique({ where: { token: hashToken(token) }, include: { usuario: true } });
  if (!sessao || sessao.expiraEm < new Date()) return null;
  return sessao.usuario;
}

export async function encerrarSessao(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.sessao.deleteMany({ where: { token: hashToken(token) } });
}
