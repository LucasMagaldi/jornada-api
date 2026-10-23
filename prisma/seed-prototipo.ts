/**
 * Rede fictícia com os dados do protótipo do Figma (UI-figma/src/App.tsx).
 * Login: marina@horizonte.com.br / horizonte123
 */
import { PrismaClient } from "@prisma/client";
import { coberturaUniforme, coberturaVazia, premissasPadrao } from "../src/engine";
import type { CoberturaSemanal, HorarioSemanal, Premissas } from "../src/engine";
import { hashSenha } from "../src/lib/auth";

const db = new PrismaClient();

const EMAIL = "marina@horizonte.com.br";
const REDE = "Rede Horizonte";
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;

const todos = (abre: string, fecha: string): HorarioSemanal => {
  const j = { abre, fecha };
  return { seg: j, ter: j, qua: j, qui: j, sex: j, sab: j, dom: j };
};

async function main() {
  await db.usuario.deleteMany({ where: { email: EMAIL } });
  await db.rede.deleteMany({ where: { nome: REDE } });

  // Premissas do painel do protótipo: perdas 12%, encargos 1,68, HE 50%, margem 5%, mix 60%, encargos sobre HE.
  const premissas: Premissas = {
    ...premissasPadrao(),
    perdas: 0.12,
    fatorEncargos: 1.68,
    adicionalHoraExtra: 0.5,
    margemSeguranca: 0.05,
    mixPercentualContratacao: 0.6,
    encargosSobreHoraExtra: true,
  };

  // 1) Loja Centro: o caso de referência (14 h/dia × 7 dias × 2 pessoas = 196 h).
  const horCentro = todos("08:00", "22:00");

  // 2) Loja Norte: 12 h/dia, pico no meio do dia e no sábado; sem horário reduzido.
  const horNorte = todos("08:00", "20:00");
  const cobNorte: CoberturaSemanal = coberturaVazia();
  for (const dia of DIAS) {
    const pico = dia === "sab" ? 5 : 4;
    cobNorte[dia] = [
      { inicio: "08:00", fim: "12:00", pessoas: 3 },
      { inicio: "12:00", fim: "16:00", pessoas: pico },
      { inicio: "16:00", fim: "20:00", pessoas: 3 },
    ];
  }

  // 3) Restaurante Sul: 09–24 todos os dias, almoço e jantar.
  const horSul = todos("09:00", "24:00");
  const cobSul: CoberturaSemanal = coberturaVazia();
  for (const dia of DIAS) {
    const jantar = dia === "sex" || dia === "sab" ? 6 : 5;
    cobSul[dia] = [
      { inicio: "09:00", fim: "12:00", pessoas: 2 },
      { inicio: "12:00", fim: "15:00", pessoas: 6 },
      { inicio: "15:00", fim: "18:00", pessoas: 2 },
      { inicio: "18:00", fim: "24:00", pessoas: jantar },
    ];
  }

  await db.rede.create({
    data: {
      nome: REDE,
      premissas: premissas as object,
      usuarios: { create: { email: EMAIL, senhaHash: await hashSenha("horizonte123") } },
      unidades: {
        create: [
          {
            nome: "Loja Centro",
            horarios: horCentro as object,
            horarioReduzido: todos("09:00", "21:00") as object,
            cobertura: coberturaUniforme(horCentro, 2) as object,
            cargos: { create: [{ nome: "Atendente", quantidade: 5, salarioBase: 2100, jornadaSemanal: 44 }] },
          },
          {
            nome: "Loja Norte",
            horarios: horNorte as object,
            cobertura: cobNorte as object,
            cargos: {
              create: [
                { nome: "Vendedor", quantidade: 6, salarioBase: 2200, jornadaSemanal: 44 },
                { nome: "Operador de caixa", quantidade: 2, salarioBase: 1950, jornadaSemanal: 44 },
              ],
            },
          },
          {
            nome: "Restaurante Sul",
            horarios: horSul as object,
            horarioReduzido: todos("10:00", "23:00") as object,
            cobertura: cobSul as object,
            cargos: {
              create: [
                { nome: "Garçom", quantidade: 6, salarioBase: 1900, jornadaSemanal: 44 },
                { nome: "Cozinheiro", quantidade: 3, salarioBase: 2500, jornadaSemanal: 44 },
                { nome: "Auxiliar de cozinha", quantidade: 2, salarioBase: 1800, jornadaSemanal: 44 },
                { nome: "Gerente", quantidade: 1, salarioBase: 3800, jornadaSemanal: 44 },
              ],
            },
          },
        ],
      },
    },
  });
  console.log(`Seed do protótipo concluído. Login: ${EMAIL} / horizonte123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
