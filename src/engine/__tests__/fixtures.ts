import { coberturaUniforme, premissasPadrao } from "..";
import type { Cargo, HorarioSemanal, Premissas, Unidade, VersaoRegras } from "..";

/**
 * Versão de regras fixa para os testes (não depende do arquivo de configuração,
 * para que o caso de referência continue estável mesmo se a configuração mudar).
 */
export const VERSAO_TESTE: VersaoRegras = {
  id: "teste",
  vigenteDesde: "2026-10-16",
  descricao: "Regras de teste",
  fases: [
    { id: "atual", nome: "Hoje", inicio: null, jornadaSemanal: 44, jornadaDiariaMax: 8, diasTrabalhoSemana: 6, divisorHora: 220 },
    { id: "fase1", nome: "Fase 1", inicio: "2026-12-15", jornadaSemanal: 42, jornadaDiariaMax: 8.4, diasTrabalhoSemana: 5, divisorHora: 210 },
    { id: "fase2", nome: "Fase 2", inicio: "2027-12-15", jornadaSemanal: 40, jornadaDiariaMax: 8, diasTrabalhoSemana: 5, divisorHora: 200 },
  ],
  limiteHoraExtraDiaria: 2,
  adicionalHoraExtraPadrao: 0.5,
};

export function horarioTodosOsDias(abre: string, fecha: string): HorarioSemanal {
  const j = { abre, fecha };
  return { seg: j, ter: j, qua: j, qui: j, sex: j, sab: j, dom: j };
}

/** Unidade do caso de referência: 14 h/dia (08–22), 7 dias, 2 pessoas em todas as faixas. */
export function unidadeReferencia(quadro: Cargo[] = [], extra: Partial<Unidade> = {}): Unidade {
  const horarios = horarioTodosOsDias("08:00", "22:00");
  return {
    id: "u1",
    nome: "Referência",
    horarios,
    cobertura: coberturaUniforme(horarios, 2),
    quadro,
    ...extra,
  };
}

/** Premissas do caso de referência: perdas 12%, sem margem. */
export function premissasReferencia(over: Partial<Premissas> = {}): Premissas {
  return { ...premissasPadrao(VERSAO_TESTE), perdas: 0.12, margemSeguranca: 0, ...over };
}

export const QUADRO_5_44H: Cargo[] = [{ nome: "Atendente", quantidade: 5, salarioBase: 2000, jornadaSemanal: 44 }];
