import { DIAS_SEMANA } from "./tipos";
import type {
  Cargo,
  FaseLegal,
  HorarioSemanal,
  IdCenario,
  Premissas,
  ResultadoCenario,
  ResultadoFase,
  ResultadoUnidade,
  Unidade,
  VersaoRegras,
} from "./tipos";
import { horaParaMinutos, horasAbertasSemana, horasCoberturaSemana, minutosParaHora, validarCobertura } from "./cobertura";
import { SEMANAS_POR_MES } from "./premissas";

const EPS = 1e-9;

export const IDS_CENARIOS: IdCenario[] = ["contratar", "horaExtra", "reduzirHorario", "mix"];

export function headcount(quadro: Cargo[]): number {
  return quadro.reduce((s, c) => s + c.quantidade, 0);
}

/** Média dos salários-base ponderada pela quantidade (D-12). `null` se não há quadro. */
export function salarioMedioPonderado(quadro: Cargo[]): number | null {
  const n = headcount(quadro);
  if (n <= 0) return null;
  return quadro.reduce((s, c) => s + c.salarioBase * c.quantidade, 0) / n;
}

/** FTE atual equivalente numa fase de jornada J: Σ quantidade × min(jornada, J) / J (D-11). */
export function fteAtualEquivalente(quadro: Cargo[], jornadaFase: number): number {
  return quadro.reduce((s, c) => s + (c.quantidade * Math.min(c.jornadaSemanal, jornadaFase)) / jornadaFase, 0);
}

/** Interseção dia a dia de dois horários (o reduzido nunca amplia o original). */
export function intersecaoHorarios(a: HorarioSemanal, b: HorarioSemanal): HorarioSemanal {
  const r = {} as HorarioSemanal;
  for (const dia of DIAS_SEMANA) {
    const ja = a[dia];
    const jb = b[dia];
    if (!ja || !jb) {
      r[dia] = null;
      continue;
    }
    const abre = Math.max(horaParaMinutos(ja.abre), horaParaMinutos(jb.abre));
    const fecha = Math.min(horaParaMinutos(ja.fecha), horaParaMinutos(jb.fecha));
    r[dia] = fecha > abre ? { abre: minutosParaHora(abre), fecha: minutosParaHora(fecha) } : null;
  }
  return r;
}

function cenario(id: IdCenario, custoMensal: number, detalhes: ResultadoCenario["detalhes"], avisos: string[] = [], disponivel = true): ResultadoCenario {
  return { id, disponivel, custoMensal: disponivel ? custoMensal : 0, avisos, detalhes };
}

export interface ContextoFase {
  unidade: Unidade;
  fase: FaseLegal;
  versao: VersaoRegras;
  premissas: Premissas;
  /** Salário usado quando a unidade não tem quadro (média da rede). */
  salarioFallback: number | null;
}

/** Fotografia de uma unidade em uma fase, com os quatro cenários. */
export function calcularFase(ctx: ContextoFase): ResultadoFase {
  const { unidade, fase, versao, premissas: p } = ctx;
  const J = fase.jornadaSemanal;

  // 1. horas de cobertura
  const horasCobertura = horasCoberturaSemana(unidade.cobertura, unidade.horarios);
  // 2. horas produtivas por colaborador
  const horasProdutivas = J * (1 - p.perdas);
  // 3. FTE necessário (com margem de segurança, D-10)
  const fteSemMargem = horasCobertura / horasProdutivas;
  const fteNecessario = fteSemMargem * (1 + p.margemSeguranca);
  // 4. delta
  const fteAtual = fteAtualEquivalente(unidade.quadro, J);
  let deltaFte = fteNecessario - fteAtual;
  if (Math.abs(deltaFte) < EPS) deltaFte = 0;
  const deficit = Math.max(0, deltaFte);

  const salarioMedio = salarioMedioPonderado(unidade.quadro) ?? ctx.salarioFallback ?? 0;
  const divisor = p.divisores[fase.id] ?? fase.divisorHora;
  const valorHora = salarioMedio / divisor;

  // horas faltantes são produtivas (D-14)
  const horasFaltantesSemana = deficit * horasProdutivas;
  const horasFaltantesMes = horasFaltantesSemana * SEMANAS_POR_MES;

  const n = headcount(unidade.quadro);
  const limiteSemanalPorPessoa = versao.limiteHoraExtraDiaria * fase.diasTrabalhoSemana;

  // 5. contratar
  const custoContratar = deficit * salarioMedio * p.fatorEncargos;
  const contratacoesInteiras = deficit > 0 ? Math.ceil(deficit - EPS) : 0;
  const contratar = cenario("contratar", custoContratar, {
    fteAContratar: deficit,
    contratacoesInteiras,
    custoContratacoesInteiras: contratacoesInteiras * salarioMedio * p.fatorEncargos,
    sobraFte: Math.max(0, -deltaFte),
    formula: "delta_FTE × salário médio × fator de encargos",
  });

  // 6. hora extra
  const custoHoraExtraUnit = valorHora * (1 + p.adicionalHoraExtra) * (p.encargosSobreHoraExtra ? p.fatorEncargos : 1);
  const avaliarHoraExtra = (horasSemana: number) => {
    const porPessoa = n > 0 ? horasSemana / n : 0;
    return { porPessoa, excede: porPessoa > limiteSemanalPorPessoa + EPS };
  };
  const he = avaliarHoraExtra(horasFaltantesSemana);
  const avisosHe: string[] = [];
  let heDisponivel = true;
  if (deficit > 0 && n === 0) {
    heDisponivel = false;
    avisosHe.push("Unidade sem quadro atual: não há quem faça hora extra.");
  } else if (he.excede) {
    avisosHe.push(
      `Exige ${fmt(he.porPessoa)} h extras/semana por colaborador, acima do limite de ${fmt(limiteSemanalPorPessoa)} h (${versao.limiteHoraExtraDiaria} h/dia × ${fase.diasTrabalhoSemana} dias).`,
    );
  }
  const horaExtra = cenario(
    "horaExtra",
    horasFaltantesMes * custoHoraExtraUnit,
    {
      horasExtrasMes: horasFaltantesMes,
      valorHoraExtra: custoHoraExtraUnit,
      horasExtrasSemanaPorColaborador: he.porPessoa,
      limiteSemanalPorColaborador: limiteSemanalPorPessoa,
      excedeLimiteLegal: he.excede,
      formula: p.encargosSobreHoraExtra
        ? "horas faltantes/mês × valor-hora × (1 + adicional) × fator de encargos"
        : "horas faltantes/mês × valor-hora × (1 + adicional)",
    },
    avisosHe,
    heDisponivel,
  );

  // 7. reduzir horário
  let reduzirHorario: ResultadoCenario;
  if (unidade.horarioReduzido) {
    const horarioRed = intersecaoHorarios(unidade.horarios, unidade.horarioReduzido);
    const horasCobRed = horasCoberturaSemana(unidade.cobertura, horarioRed);
    const fteRed = (horasCobRed / horasProdutivas) * (1 + p.margemSeguranca);
    const deficitRed = Math.max(0, fteRed - fteAtual);
    const custo = deficitRed * salarioMedio * p.fatorEncargos;
    const horasPerdidas = horasAbertasSemana(unidade.horarios) - horasAbertasSemana(horarioRed);
    const avisos = horasPerdidas <= EPS ? ["Horário reduzido não reduz o horário atual."] : [];
    reduzirHorario = cenario(
      "reduzirHorario",
      custo,
      {
        horasCoberturaReduzida: horasCobRed,
        fteNecessarioReduzido: fteRed,
        fteAContratarAposReducao: deficitRed,
        horasAtendimentoPerdidasSemana: horasPerdidas,
        horasCoberturaPerdidasSemana: horasCobertura - horasCobRed,
        economiaVsContratar: custoContratar - custo,
        formula: "déficit remanescente após reduzir horário × salário médio × fator de encargos",
      },
      avisos,
    );
  } else {
    reduzirHorario = cenario("reduzirHorario", 0, {}, ["Horário reduzido não informado para esta unidade."], false);
  }

  // 8. mix
  const pc = p.mixPercentualContratacao;
  const heMix = avaliarHoraExtra((1 - pc) * horasFaltantesSemana);
  const mixDisponivel = heDisponivel || pc >= 1 - EPS;
  const avisosMix: string[] = [];
  if (!mixDisponivel) avisosMix.push("Unidade sem quadro atual: a parcela de hora extra não é viável.");
  else if (heMix.excede) avisosMix.push(`A parcela de hora extra exige ${fmt(heMix.porPessoa)} h/semana por colaborador, acima do limite legal.`);
  const mix = cenario(
    "mix",
    pc * custoContratar + (1 - pc) * horaExtra.custoMensal,
    {
      percentualContratacao: pc,
      fteAContratar: pc * deficit,
      horasExtrasMes: (1 - pc) * horasFaltantesMes,
      excedeLimiteLegal: heMix.excede,
      formula: "% contratação × custo contratar + (1 − %) × custo hora extra",
    },
    avisosMix,
    mixDisponivel,
  );

  const cenarios = { contratar, horaExtra, reduzirHorario, mix };
  return {
    fase,
    divisorUsado: divisor,
    horasCoberturaSemana: horasCobertura,
    horasProdutivasPorColaborador: horasProdutivas,
    fteNecessario,
    fteNecessarioSemMargem: fteSemMargem,
    fteAtualEquivalente: fteAtual,
    deltaFte,
    salarioMedio,
    valorHora,
    horasFaltantesSemana,
    horasFaltantesMes,
    cenarios,
    maisBarato: escolherMaisBarato(cenarios),
  };
}

/** Cenário de menor custo entre os disponíveis e dentro do limite legal (D-16). Empate → ordem de IDS_CENARIOS. */
export function escolherMaisBarato(cenarios: Record<IdCenario, ResultadoCenario>): IdCenario | null {
  let melhor: IdCenario | null = null;
  for (const id of IDS_CENARIOS) {
    const c = cenarios[id];
    if (!elegivel(c)) continue;
    if (melhor === null || c.custoMensal < cenarios[melhor].custoMensal - EPS) melhor = id;
  }
  return melhor;
}

export function elegivel(c: ResultadoCenario): boolean {
  return c.disponivel && c.detalhes.excedeLimiteLegal !== true;
}

export function calcularUnidade(
  unidade: Unidade,
  versao: VersaoRegras,
  premissas: Premissas,
  salarioFallback: number | null = null,
): ResultadoUnidade {
  const avisos = validarCobertura(unidade.cobertura, unidade.horarios);
  if (headcount(unidade.quadro) === 0) {
    avisos.push(
      salarioFallback
        ? "Unidade sem quadro atual: custos calculados com o salário médio da rede."
        : "Unidade sem quadro atual e rede sem salários: custos zerados.",
    );
  }
  return {
    unidadeId: unidade.id,
    nome: unidade.nome,
    headcountAtual: headcount(unidade.quadro),
    horasAbertasSemana: horasAbertasSemana(unidade.horarios),
    fases: versao.fases.map((fase) => calcularFase({ unidade, fase, versao, premissas, salarioFallback })),
    avisos,
  };
}

function fmt(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
