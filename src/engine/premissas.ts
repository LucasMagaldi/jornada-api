import type { Premissas, VersaoRegras } from "./tipos";

/** Semanas por mês usadas para converter horas semanais em mensais (52 / 12). */
export const SEMANAS_POR_MES = 52 / 12;

/** Premissas padrão (DECISOES.md D-10, D-15, D-18, D-19, D-20). */
export function premissasPadrao(versao?: VersaoRegras): Premissas {
  return {
    perdas: 0.12,
    fatorEncargos: 1.8,
    adicionalHoraExtra: versao?.adicionalHoraExtraPadrao ?? 0.5,
    margemSeguranca: 0.05,
    divisores: {},
    mixPercentualContratacao: 0.5,
    encargosSobreHoraExtra: false,
  };
}

/** Completa premissas parciais (ex.: vindas do banco) com os padrões. */
export function normalizarPremissas(parcial: Partial<Premissas> | null | undefined, versao?: VersaoRegras): Premissas {
  const padrao = premissasPadrao(versao);
  const p = { ...padrao, ...(parcial ?? {}) };
  p.divisores = { ...(parcial?.divisores ?? {}) };
  return p;
}

/** Retorna a lista de erros (vazia se válidas). */
export function validarPremissas(p: Premissas): string[] {
  const erros: string[] = [];
  const faixa = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  if (!faixa(p.perdas, 0, 0.9)) erros.push("Perdas devem estar entre 0% e 90%.");
  if (!faixa(p.fatorEncargos, 1, 5)) erros.push("Fator de encargos deve estar entre 1 e 5.");
  if (!faixa(p.adicionalHoraExtra, 0, 5)) erros.push("Adicional de hora extra deve estar entre 0% e 500%.");
  if (!faixa(p.margemSeguranca, 0, 1)) erros.push("Margem de segurança deve estar entre 0% e 100%.");
  if (!faixa(p.mixPercentualContratacao, 0, 1)) erros.push("Percentual do mix deve estar entre 0% e 100%.");
  for (const [fase, d] of Object.entries(p.divisores)) {
    if (!faixa(d, 1, 1000)) erros.push(`Divisor da fase ${fase} inválido.`);
  }
  return erros;
}
