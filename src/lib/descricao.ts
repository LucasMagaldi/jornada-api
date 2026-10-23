import { NOME_CENARIO, SEMANAS_POR_MES } from "../engine";
import type { IdCenario, Premissas, ResultadoRede, VersaoRegras } from "../engine";
import { formatarData, formatarNumero, formatarPct } from "./formato";

/** Premissas em forma de lista legível — acompanham todo número exibido ou exportado. */
export function descreverPremissas(p: Premissas, versao: VersaoRegras): [string, string][] {
  const linhas: [string, string][] = [
    ["Regras legais", `${versao.id} (vigente desde ${formatarData(versao.vigenteDesde)})`],
    ...versao.fases.map((f): [string, string] => [
      f.nome,
      `${formatarNumero(f.jornadaSemanal, 0)} h/semana, ${f.diasTrabalhoSemana} dias, divisor ${p.divisores[f.id] ?? f.divisorHora}${
        p.divisores[f.id] ? " (sobrescrito)" : ""
      }${f.inicio ? `, a partir de ${formatarData(f.inicio)}` : ""}`,
    ]),
    ["Perdas (férias, afastamentos, absenteísmo)", formatarPct(p.perdas)],
    ["Fator de encargos sobre o salário", formatarNumero(p.fatorEncargos)],
    ["Adicional de hora extra", formatarPct(p.adicionalHoraExtra)],
    ["Encargos sobre hora extra", p.encargosSobreHoraExtra ? "Sim" : "Não"],
    ["Margem de segurança", formatarPct(p.margemSeguranca)],
    ["Mix: parcela por contratação", formatarPct(p.mixPercentualContratacao)],
    ["Limite legal de hora extra", `${formatarNumero(versao.limiteHoraExtraDiaria, 0)} h/dia`],
    ["Semanas por mês", formatarNumero(SEMANAS_POR_MES, 3)],
    ["Salário de referência", "Média dos salários-base ponderada pela quantidade, por unidade"],
  ];
  return linhas;
}

export function nomeCenario(id: IdCenario | null): string {
  return id ? NOME_CENARIO[id] : "—";
}

export function avisosRede(r: ResultadoRede): string[] {
  return [...r.avisos, ...r.unidades.flatMap((u) => u.avisos.map((a) => `${u.nome}: ${a}`))];
}
