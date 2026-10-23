import { DIAS_SEMANA } from "../engine";
import type { Cargo, CoberturaSemanal, Faixa, HorarioSemanal, Janela, Unidade } from "../engine";
import { formatarNumero } from "./formato";

/**
 * Diagnóstico rápido da página pública (D-36): poucas perguntas viram uma unidade do motor,
 * que é calculada como qualquer outra. Puro e testado; a validação fica em app.ts.
 */
export interface EntradaDiagnostico {
  /** Quantas unidades iguais a esta a rede tem; o resultado da rede é o da unidade × N. */
  unidades: number;
  /** Mesmo horário de segunda a sexta. */
  semana: Janela;
  sabado: Janela | null;
  domingo: Janela | null;
  /** Pessoas trabalhando ao mesmo tempo, durante todo o horário aberto. */
  pessoas: number;
  colaboradores: number;
  salarioMedio: number;
  /** Jornada semanal contratada hoje. */
  jornadaAtual: number;
  /** Setor que não pode ficar descoberto e que o resto da equipe não substitui (D-32). */
  setor?: { nome: string; pessoas: number; colaboradores: number; salarioMedio: number } | null;
  /** Semana de pico: um horário para todos os dias e outra cobertura da equipe geral (D-33). */
  pico?: { descricao?: string; janela: Janela; pessoas: number } | null;
}

/** Nome do setor do resto da equipe quando há setor obrigatório. */
export const SETOR_DEMAIS = "Demais funções";

function horarioDe(semana: Janela, sabado: Janela | null, domingo: Janela | null): HorarioSemanal {
  return { seg: semana, ter: semana, qua: semana, qui: semana, sex: semana, sab: sabado, dom: domingo };
}

/** Uma faixa por dia aberto, do início ao fim do funcionamento, para cada grupo com gente. */
function coberturaDe(horarios: HorarioSemanal, grupos: { pessoas: number; setor?: string }[]): CoberturaSemanal {
  const com = grupos.filter((g) => g.pessoas > 0);
  return Object.fromEntries(
    DIAS_SEMANA.map((d) => {
      const j = horarios[d];
      const faixas: Faixa[] = j ? com.map((g) => ({ inicio: j.abre, fim: j.fecha, pessoas: g.pessoas, ...(g.setor ? { setor: g.setor } : {}) })) : [];
      return [d, faixas];
    }),
  ) as CoberturaSemanal;
}

export function unidadeDoDiagnostico(e: EntradaDiagnostico): Unidade {
  const horarios = horarioDe(e.semana, e.sabado, e.domingo);
  const geral = e.setor ? SETOR_DEMAIS : undefined;
  const grupos = (pessoasGeral: number) => [
    { pessoas: pessoasGeral, setor: geral },
    ...(e.setor ? [{ pessoas: e.setor.pessoas, setor: e.setor.nome }] : []),
  ];
  const quadro: Cargo[] = [
    { nome: "Equipe", quantidade: e.colaboradores, salarioBase: e.salarioMedio, jornadaSemanal: e.jornadaAtual, ...(geral ? { setor: geral } : {}) },
    ...(e.setor
      ? [{ nome: e.setor.nome, quantidade: e.setor.colaboradores, salarioBase: e.setor.salarioMedio, jornadaSemanal: e.jornadaAtual, setor: e.setor.nome }]
      : []),
  ].filter((c) => c.quantidade > 0);

  let pico: Unidade["pico"] = null;
  if (e.pico) {
    const j = e.pico.janela;
    const horariosPico = horarioDe(j, j, j);
    pico = { descricao: e.pico.descricao || "Semana de pico", horarios: horariosPico, cobertura: coberturaDe(horariosPico, grupos(e.pico.pessoas)) };
  }

  return { id: "diagnostico", nome: "Unidade típica", horarios, cobertura: coberturaDe(horarios, grupos(e.pessoas)), quadro, pico };
}

/** Premissas próprias do diagnóstico, para acompanhar os números (regra 4). */
export function descreverDiagnostico(e: EntradaDiagnostico): [string, string][] {
  return [
    ["Diagnóstico rápido", `${e.unidades} unidade(s) iguais; o total da rede é a unidade típica × ${e.unidades}`],
    ["Cobertura", "As pessoas informadas trabalham ao mesmo tempo durante todo o horário aberto, sem picos dentro do dia"],
    ["Quadro", `Salário médio único por grupo e jornada de ${formatarNumero(e.jornadaAtual, 0)} h/semana para todos`],
    ...(e.setor ? [["Setor obrigatório", `${e.setor.nome}: só o próprio quadro cobre o setor (D-32)`] as [string, string]] : []),
    ["Reduzir horário", "Não calculado no diagnóstico rápido; disponível no simulador completo"],
  ];
}
