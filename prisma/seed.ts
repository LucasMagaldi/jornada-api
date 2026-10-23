/**
 * Rede de demonstração com 3 unidades fictícias.
 * Login: demo@exemplo.com / demo12345
 */
import { PrismaClient } from "@prisma/client";
import { coberturaUniforme, coberturaVazia, premissasPadrao } from "../src/engine";
import type { CoberturaSemanal, HorarioSemanal } from "../src/engine";
import { hashSenha } from "../src/lib/auth";

const db = new PrismaClient();

const todos = (abre: string, fecha: string): HorarioSemanal => {
  const j = { abre, fecha };
  return { seg: j, ter: j, qua: j, qui: j, sex: j, sab: j, dom: j };
};

async function main() {
  await db.usuario.deleteMany({ where: { email: "demo@exemplo.com" } });
  await db.rede.deleteMany({ where: { nome: "Rede Demonstração" } });

  // 1) Supermercado: 14 h/dia, 7 dias, com pico no almoço e no fim da tarde.
  const horSuper = todos("08:00", "22:00");
  const cobSuper: CoberturaSemanal = coberturaVazia();
  for (const dia of ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const) {
    cobSuper[dia] = [
      { inicio: "08:00", fim: "11:00", pessoas: 4 },
      { inicio: "11:00", fim: "14:00", pessoas: 7 },
      { inicio: "14:00", fim: "17:00", pessoas: 5 },
      { inicio: "17:00", fim: "20:00", pessoas: 8 },
      { inicio: "20:00", fim: "22:00", pessoas: 4 },
    ];
  }

  // 2) Farmácia: 07–23 todos os dias, 2 pessoas o tempo todo (o caso clássico 6x1).
  const horFarma = todos("07:00", "23:00");

  // 3) Restaurante: fecha segunda; almoço e jantar.
  const horRest: HorarioSemanal = { ...todos("11:00", "23:00"), seg: null };
  const cobRest = coberturaVazia();
  for (const dia of ["ter", "qua", "qui", "sex", "sab", "dom"] as const) {
    cobRest[dia] = [
      { inicio: "11:00", fim: "15:00", pessoas: 6 },
      { inicio: "15:00", fim: "18:00", pessoas: 2 },
      { inicio: "18:00", fim: "23:00", pessoas: dia === "sex" || dia === "sab" ? 8 : 6 },
    ];
  }

  await db.rede.create({
    data: {
      nome: "Rede Demonstração",
      premissas: premissasPadrao() as object,
      usuarios: { create: { email: "demo@exemplo.com", senhaHash: await hashSenha("demo12345") } },
      unidades: {
        create: [
          {
            nome: "Supermercado Centro",
            horarios: horSuper as object,
            horarioReduzido: todos("08:00", "21:00") as object,
            cobertura: cobSuper as object,
            cargos: {
              create: [
                { nome: "Operador de caixa", quantidade: 10, salarioBase: 1980, jornadaSemanal: 44 },
                { nome: "Repositor", quantidade: 4, salarioBase: 1850, jornadaSemanal: 44 },
                { nome: "Fiscal de loja", quantidade: 1, salarioBase: 2600, jornadaSemanal: 44 },
              ],
            },
          },
          {
            nome: "Farmácia Bairro",
            horarios: horFarma as object,
            horarioReduzido: todos("08:00", "22:00") as object,
            cobertura: coberturaUniforme(horFarma, 2) as object,
            cargos: {
              create: [
                { nome: "Balconista", quantidade: 4, salarioBase: 2100, jornadaSemanal: 44 },
                { nome: "Farmacêutico", quantidade: 2, salarioBase: 5200, jornadaSemanal: 44 },
              ],
            },
          },
          {
            nome: "Restaurante Shopping",
            horarios: horRest as object,
            cobertura: cobRest as object,
            cargos: {
              create: [
                { nome: "Garçom", quantidade: 6, salarioBase: 1900, jornadaSemanal: 44 },
                { nome: "Cozinheiro", quantidade: 3, salarioBase: 2400, jornadaSemanal: 44 },
                { nome: "Auxiliar meio período", quantidade: 2, salarioBase: 1100, jornadaSemanal: 24 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log("Seed concluído. Login: demo@exemplo.com / demo12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
