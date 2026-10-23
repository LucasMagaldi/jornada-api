import { NOME_CENARIO, SEMANAS_POR_MES } from "../engine";
import type { IdCenario, Premissas, ResultadoRede, TipoGrupo, VersaoRegras } from "../engine";
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
    ["Salário de referência", "Média dos salários-base ponderada pela quantidade, por unidade (por setor quando há setores)"],
    ["Cobertura por setor", "Quando a cobertura informa setores, cada setor é coberto só pelo próprio quadro: sobra num setor não cobre falta em outro (D-32)"],
    ["Semana de pico", "Mesmo quadro com o horário e a cobertura do pico; custos mensais como se o pico durasse o mês inteiro (D-33)"],
    ["Turnos que viram o dia", "Fim antes do início termina no dia seguinte (D-35)"],
  ];
  return linhas;
}

export function nomeCenario(id: IdCenario | null): string {
  return id ? NOME_CENARIO[id] : "—";
}

/** Rótulo de um grupo (D-34); "" = unidades sem o campo. */
export function nomeGrupo(tipo: TipoGrupo, nome: string): string {
  return nome || (tipo === "bandeira" ? "Sem bandeira" : "Sem regional");
}

export function avisosRede(r: ResultadoRede): string[] {
  return [...r.avisos, ...r.unidades.flatMap((u) => u.avisos.map((a) => `${u.nome}: ${a}`))];
}
