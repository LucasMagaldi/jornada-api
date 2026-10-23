/**
 * Rede de demonstração com 3 unidades fictícias, com bandeira/regional, setores, semana de pico
 * e turno que vira o dia (D-32 a D-35).
 * Login: demo@exemplo.com / demo12345
 */
import { PrismaClient } from "@prisma/client";
import { coberturaUniforme, coberturaVazia, premissasPadrao } from "../src/engine";
import type { CoberturaSemanal, Faixa, HorarioSemanal } from "../src/engine";
import { hashSenha } from "../src/lib/auth";

const db = new PrismaClient();

const todos = (abre: string, fecha: string): HorarioSemanal => {
  const j = { abre, fecha };
  return { seg: j, ter: j, qua: j, qui: j, sex: j, sab: j, dom: j };
};

async function main() {
  await db.usuario.deleteMany({ where: { email: "demo@exemplo.com" } });
  await db.rede.deleteMany({ where: { nome: "Rede Demonstração" } });

  // Faixas de um setor a partir de [início, fim, pessoas].
  const setor = (nome: string, faixas: [string, string, number][]): Faixa[] => faixas.map(([inicio, fim, pessoas]) => ({ inicio, fim, pessoas, setor: nome }));

  // 1) Supermercado: 14 h/dia, 7 dias, com pico no almoço e no fim da tarde; caixa, reposição e açougue.
  const horSuper = todos("08:00", "22:00");
  const cobSuper: CoberturaSemanal = coberturaVazia();
  // Natal: abre até 23h e reforça todos os setores.
  const horSuperPico = todos("08:00", "23:00");
  const cobSuperPico: CoberturaSemanal = coberturaVazia();
  for (const dia of ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const) {
    cobSuper[dia] = [
      ...setor("Caixa", [["08:00", "11:00", 2], ["11:00", "14:00", 4], ["14:00", "17:00", 3], ["17:00", "20:00", 5], ["20:00", "22:00", 2]]),
      ...setor("Reposição", [["08:00", "11:00", 1], ["11:00", "14:00", 2], ["14:00", "17:00", 1], ["17:00", "20:00", 2], ["20:00", "22:00", 1]]),
      ...setor("Açougue", [["08:00", "22:00", 1]]),
    ];
    cobSuperPico[dia] = [
      ...setor("Caixa", [["08:00", "11:00", 3], ["11:00", "14:00", 6], ["14:00", "17:00", 5], ["17:00", "20:00", 7], ["20:00", "23:00", 3]]),
      ...setor("Reposição", [["08:00", "11:00", 2], ["11:00", "14:00", 3], ["14:00", "17:00", 2], ["17:00", "20:00", 3], ["20:00", "23:00", 2]]),
      ...setor("Açougue", [["08:00", "11:00", 1], ["11:00", "20:00", 2], ["20:00", "23:00", 1]]),
    ];
  }

  // 2) Farmácia: 07–23 todos os dias, 2 pessoas o tempo todo (o caso clássico 6x1).
  const horFarma = todos("07:00", "23:00");

  // 3) Restaurante: fecha segunda; almoço e jantar; sexta e sábado até 01h (vira o dia); cozinha e salão.
  const horRest: HorarioSemanal = { ...todos("11:00", "23:00"), seg: null, sex: { abre: "11:00", fecha: "01:00" }, sab: { abre: "11:00", fecha: "01:00" } };
  const cobRest = coberturaVazia();
  for (const dia of ["ter", "qua", "qui", "sex", "sab", "dom"] as const) {
    const fds = dia === "sex" || dia === "sab";
    const fecha = fds ? "01:00" : "23:00";
    cobRest[dia] = [
      ...setor("Salão", [["11:00", "15:00", 4], ["15:00", "18:00", 1], ["18:00", fecha, fds ? 5 : 4]]),
      ...setor("Cozinha", [["11:00", "15:00", 2], ["15:00", "18:00", 1], ["18:00", fecha, fds ? 3 : 2]]),
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
            bandeira: "Supermercado",
            regional: "Curitiba",
            horarios: horSuper as object,
            horarioReduzido: todos("08:00", "21:00") as object,
            cobertura: cobSuper as object,
            pico: { descricao: "Natal", horarios: horSuperPico, cobertura: cobSuperPico } as object,
            cargos: {
              create: [
                { nome: "Operador de caixa", setor: "Caixa", quantidade: 10, salarioBase: 1980, jornadaSemanal: 44 },
                { nome: "Fiscal de loja", setor: "Caixa", quantidade: 1, salarioBase: 2600, jornadaSemanal: 44 },
                { nome: "Repositor", setor: "Reposição", quantidade: 6, salarioBase: 1850, jornadaSemanal: 44 },
                { nome: "Açougueiro", setor: "Açougue", quantidade: 2, salarioBase: 2700, jornadaSemanal: 44 },
              ],
            },
          },
          {
            nome: "Farmácia Bairro",
            bandeira: "Farmácia",
            regional: "Curitiba",
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
            bandeira: "Restaurante",
            regional: "Ponta Grossa",
            horarios: horRest as object,
            cobertura: cobRest as object,
            cargos: {
              create: [
                { nome: "Garçom", setor: "Salão", quantidade: 6, salarioBase: 1900, jornadaSemanal: 44 },
                { nome: "Cozinheiro", setor: "Cozinha", quantidade: 3, salarioBase: 2400, jornadaSemanal: 44 },
                { nome: "Auxiliar meio período", setor: "Cozinha", quantidade: 2, salarioBase: 1100, jornadaSemanal: 24 },
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
