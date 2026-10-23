import type { Cargo as CargoDb, Prisma, Unidade as UnidadeDb } from "@prisma/client";
import { normalizarPremissas } from "../engine";
import type { Cargo, CoberturaSemanal, HorarioSemanal, Premissas, Unidade, VersaoRegras } from "../engine";
import type { Db } from "./db";

type UnidadeComCargos = UnidadeDb & { cargos: CargoDb[] };

/** Converte o registro do banco para o tipo do motor (Decimal → number). */
export function paraMotor(u: UnidadeComCargos): Unidade {
  return {
    id: u.id,
    nome: u.nome,
    horarios: u.horarios as unknown as HorarioSemanal,
    horarioReduzido: (u.horarioReduzido as unknown as HorarioSemanal | null) ?? null,
    cobertura: u.cobertura as unknown as CoberturaSemanal,
    quadro: u.cargos.map((c) => ({
      nome: c.nome,
      quantidade: c.quantidade,
      salarioBase: Number(c.salarioBase),
      jornadaSemanal: Number(c.jornadaSemanal),
    })),
  };
}

export async function carregarUnidades(db: Db, redeId: string): Promise<Unidade[]> {
  const unidades = await db.unidade.findMany({
    where: { redeId },
    include: { cargos: { orderBy: { nome: "asc" } } },
    orderBy: { nome: "asc" },
  });
  return unidades.map(paraMotor);
}

export async function carregarPremissas(db: Db, redeId: string, versao: VersaoRegras): Promise<Premissas> {
  const rede = await db.rede.findUniqueOrThrow({ where: { id: redeId }, select: { premissas: true } });
  return normalizarPremissas(rede.premissas as Partial<Premissas>, versao);
}

export function cargosParaDb(quadro: Cargo[]): Prisma.CargoCreateWithoutUnidadeInput[] {
  return quadro.map((c) => ({
    nome: c.nome,
    quantidade: c.quantidade,
    salarioBase: c.salarioBase,
    jornadaSemanal: c.jornadaSemanal,
  }));
}

export const json = (v: unknown) => v as Prisma.InputJsonValue;
