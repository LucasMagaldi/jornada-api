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
import { chaveSetor, horasAbertasSemana, horasCoberturaSemana, intervaloNoDia, minutosParaHora, validarCobertura } from "./cobertura";
import { SEMANAS_POR_MES } from "./premissas";

const EPS = 1e-9;
const MIN_DIA = 24 * 60;

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

/** Interseção dia a dia de dois horários (o reduzido nunca amplia o original). Aceita virada de dia (D-35). */
export function intersecaoHorarios(a: HorarioSemanal, b: HorarioSemanal): HorarioSemanal {
  const r = {} as HorarioSemanal;
  for (const dia of DIAS_SEMANA) {
    const ja = a[dia];
    const jb = b[dia];
    if (!ja || !jb) {
      r[dia] = null;
      continue;
    }
    const [aa, af] = intervaloNoDia(ja.abre, ja.fecha);
    const [ba, bf] = intervaloNoDia(jb.abre, jb.fecha);
    const abre = Math.max(aa, ba);
    const fecha = Math.min(af, bf);
    r[dia] = fecha > abre ? { abre: minutosParaHora(abre), fecha: minutosParaHora(fecha > MIN_DIA ? fecha - MIN_DIA : fecha) } : null;
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

export interface Setor {
  chave: string;
  /** "" = geral. */
  nome: string;
  quadro: Cargo[];
}

/**
 * Setores da unidade (D-32). Se nenhuma faixa tem setor, há um único grupo com o quadro inteiro
 * (o setor dos cargos é ignorado), o que reproduz o cálculo agregado. Senão, faixas e cargos sem
 * setor formam o grupo geral ("").
 */
export function setoresDaUnidade(unidade: Pick<Unidade, "cobertura" | "quadro">): Setor[] {
  const faixas = DIAS_SEMANA.flatMap((d) => unidade.cobertura[d] ?? []);
  if (!faixas.some((f) => chaveSetor(f.setor) !== "")) return [{ chave: "", nome: "", quadro: unidade.quadro }];
  const porChave = new Map<string, Setor>();
  const garantir = (setor: string | undefined) => {
    const chave = chaveSetor(setor);
    let s = porChave.get(chave);
    if (!s) {
      s = { chave, nome: (setor ?? "").trim(), quadro: [] };
      porChave.set(chave, s);
    }
    return s;
  };
  for (const f of faixas) garantir(f.setor);
  for (const c of unidade.quadro) garantir(c.setor).quadro.push(c);
  return [...porChave.values()].sort((a, b) => (a.chave === "" ? 1 : b.chave === "" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));
}

/** Fotografia de uma unidade em uma fase, com os quatro cenários. Custos somados setor a setor (D-32). */
export function calcularFase(ctx: ContextoFase): ResultadoFase {
  const { unidade, fase, versao, premissas: p } = ctx;
  const J = fase.jornadaSemanal;
  const divisor = p.divisores[fase.id] ?? fase.divisorHora;
  const salarioUnidade = salarioMedioPonderado(unidade.quadro) ?? ctx.salarioFallback ?? 0;

  // 2. horas produtivas por colaborador
  const horasProdutivas = J * (1 - p.perdas);
  const setores = setoresDaUnidade(unidade);
  const varios = setores.length > 1;
  const prefixo = (s: Setor) => (varios ? `Setor ${s.nome || "geral"}: ` : "");

  const porSetor = setores.map((s) => {
    // 1. horas de cobertura
    const horasCobertura = horasCoberturaSemana(unidade.cobertura, unidade.horarios, varios ? s.chave : undefined);
    // 3. FTE necessário (com margem de segurança, D-10)
    const fteSemMargem = horasCobertura / horasProdutivas;
    const fteNecessario = fteSemMargem * (1 + p.margemSeguranca);
    // 4. delta
    const fteAtual = fteAtualEquivalente(s.quadro, J);
    let delta = fteNecessario - fteAtual;
    if (Math.abs(delta) < EPS) delta = 0;
    const deficit = Math.max(0, delta);
    const salario = salarioMedioPonderado(s.quadro) ?? salarioUnidade;
    return {
      s,
      horasCobertura,
      fteSemMargem,
      fteNecessario,
      fteAtual,
      delta,
      deficit,
      n: headcount(s.quadro),
      salario,
      valorHora: salario / divisor,
      // horas faltantes são produtivas (D-14)
      horasFaltantesSemana: deficit * horasProdutivas,
    };
  });
  const soma = (f: (x: (typeof porSetor)[number]) => number) => porSetor.reduce((t, x) => t + f(x), 0);

  const horasCobertura = soma((x) => x.horasCobertura);
  const fteNecessario = soma((x) => x.fteNecessario);
  const fteAtual = soma((x) => x.fteAtual);
  let deltaFte = fteNecessario - fteAtual;
  if (Math.abs(deltaFte) < EPS) deltaFte = 0;
  const deficit = soma((x) => x.deficit);
  const valorHora = salarioUnidade / divisor;
  const horasFaltantesSemana = soma((x) => x.horasFaltantesSemana);
  const horasFaltantesMes = horasFaltantesSemana * SEMANAS_POR_MES;
  const limiteSemanalPorPessoa = versao.limiteHoraExtraDiaria * fase.diasTrabalhoSemana;

  // 5. contratar
  const inteiras = (d: number) => (d > 0 ? Math.ceil(d - EPS) : 0);
  const custoContratar = soma((x) => x.deficit * x.salario * p.fatorEncargos);
  const contratar = cenario("contratar", custoContratar, {
    fteAContratar: deficit,
    contratacoesInteiras: soma((x) => inteiras(x.deficit)),
    custoContratacoesInteiras: soma((x) => inteiras(x.deficit) * x.salario * p.fatorEncargos),
    sobraFte: soma((x) => Math.max(0, -x.delta)),
    formula: varios ? "Σ por setor: déficit × salário médio do setor × fator de encargos" : "delta_FTE × salário médio × fator de encargos",
  });

  // 6. hora extra (feita por quem já está no setor)
  const fatorHe = (1 + p.adicionalHoraExtra) * (p.encargosSobreHoraExtra ? p.fatorEncargos : 1);
  /** Horas extras semanais por colaborador de cada setor e se passam do limite legal (D-16). */
  const avaliarHoraExtra = (fracao: number) =>
    porSetor.map((x) => {
      const porPessoa = x.n > 0 ? (fracao * x.horasFaltantesSemana) / x.n : 0;
      return { x, porPessoa, excede: porPessoa > limiteSemanalPorPessoa + EPS };
    });
  const he = avaliarHoraExtra(1);
  const semQuem = porSetor.filter((x) => x.deficit > 0 && x.n === 0);
  const heDisponivel = semQuem.length === 0;
  const avisosHe: string[] = [];
  if (!heDisponivel) {
    avisosHe.push(
      varios
        ? `Sem quadro atual no(s) setor(es) ${semQuem.map((x) => x.s.nome || "geral").join(", ")}: não há quem faça hora extra.`
        : "Unidade sem quadro atual: não há quem faça hora extra.",
    );
  } else {
    for (const h of he.filter((h) => h.excede)) {
      avisosHe.push(
        `${prefixo(h.x.s)}Exige ${fmt(h.porPessoa)} h extras/semana por colaborador, acima do limite de ${fmt(limiteSemanalPorPessoa)} h (${versao.limiteHoraExtraDiaria} h/dia × ${fase.diasTrabalhoSemana} dias).`,
      );
    }
  }
  const custoHoraExtra = soma((x) => x.horasFaltantesSemana * SEMANAS_POR_MES * x.valorHora * fatorHe);
  const horaExtra = cenario(
    "horaExtra",
    custoHoraExtra,
    {
      horasExtrasMes: horasFaltantesMes,
      valorHoraExtra: horasFaltantesMes > 0 ? custoHoraExtra / horasFaltantesMes : valorHora * fatorHe,
      horasExtrasSemanaPorColaborador: Math.max(0, ...he.map((h) => h.porPessoa)),
      limiteSemanalPorColaborador: limiteSemanalPorPessoa,
      excedeLimiteLegal: he.some((h) => h.excede),
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
    const red = porSetor.map((x) => {
      const horasCob = horasCoberturaSemana(unidade.cobertura, horarioRed, varios ? x.s.chave : undefined);
      const fte = (horasCob / horasProdutivas) * (1 + p.margemSeguranca);
      const deficitRed = Math.max(0, fte - x.fteAtual);
      return { horasCob, fte, deficitRed, custo: deficitRed * x.salario * p.fatorEncargos };
    });
    const somaRed = (f: (r: (typeof red)[number]) => number) => red.reduce((t, r) => t + f(r), 0);
    const custo = somaRed((r) => r.custo);
    const horasCobRed = somaRed((r) => r.horasCob);
    const horasPerdidas = horasAbertasSemana(unidade.horarios) - horasAbertasSemana(horarioRed);
    const avisos = horasPerdidas <= EPS ? ["Horário reduzido não reduz o horário atual."] : [];
    reduzirHorario = cenario(
      "reduzirHorario",
      custo,
      {
        horasCoberturaReduzida: horasCobRed,
        fteNecessarioReduzido: somaRed((r) => r.fte),
        fteAContratarAposReducao: somaRed((r) => r.deficitRed),
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
  const heMix = avaliarHoraExtra(1 - pc);
  const mixDisponivel = heDisponivel || pc >= 1 - EPS;
  const avisosMix: string[] = [];
  if (!mixDisponivel) {
    avisosMix.push(varios ? "Setor sem quadro atual: a parcela de hora extra não é viável." : "Unidade sem quadro atual: a parcela de hora extra não é viável.");
  } else {
    for (const h of heMix.filter((h) => h.excede)) {
      avisosMix.push(`${prefixo(h.x.s)}A parcela de hora extra exige ${fmt(h.porPessoa)} h/semana por colaborador, acima do limite legal.`);
    }
  }
  const mix = cenario(
    "mix",
    pc * custoContratar + (1 - pc) * horaExtra.custoMensal,
    {
      percentualContratacao: pc,
      fteAContratar: pc * deficit,
      horasExtrasMes: (1 - pc) * horasFaltantesMes,
      excedeLimiteLegal: heMix.some((h) => h.excede),
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
    fteNecessarioSemMargem: soma((x) => x.fteSemMargem),
    fteAtualEquivalente: fteAtual,
    deltaFte,
    deficitFte: deficit,
    salarioMedio: salarioUnidade,
    valorHora,
    horasFaltantesSemana,
    horasFaltantesMes,
    setores: porSetor.map((x) => ({
      setor: x.s.nome,
      horasCoberturaSemana: x.horasCobertura,
      fteNecessario: x.fteNecessario,
      fteAtualEquivalente: x.fteAtual,
      deltaFte: x.delta,
      headcount: x.n,
      salarioMedio: x.salario,
      valorHora: x.valorHora,
      horasFaltantesSemana: x.horasFaltantesSemana,
    })),
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

/** Avisos sobre setor sem quadro ou quadro sem setor (D-32). */
function avisosSetores(unidade: Pick<Unidade, "cobertura" | "quadro">): string[] {
  const setores = setoresDaUnidade(unidade);
  if (setores.length <= 1) return [];
  const avisos: string[] = [];
  for (const s of setores) {
    const temCobertura = DIAS_SEMANA.some((d) => (unidade.cobertura[d] ?? []).some((f) => chaveSetor(f.setor) === s.chave));
    if (temCobertura && headcount(s.quadro) === 0) {
      avisos.push(`Setor ${s.nome || "geral"} tem cobertura mínima, mas ninguém no quadro: todo o déficit dele é de contratação.`);
    } else if (!temCobertura && s.chave === "") {
      avisos.push(`${headcount(s.quadro)} colaborador(es) sem setor não cobrem os setores informados na cobertura.`);
    } else if (!temCobertura) {
      avisos.push(`Setor ${s.nome} tem quadro, mas nenhuma cobertura mínima: essas pessoas não cobrem outros setores.`);
    }
  }
  return avisos;
}

export function calcularUnidade(
  unidade: Unidade,
  versao: VersaoRegras,
  premissas: Premissas,
  salarioFallback: number | null = null,
): ResultadoUnidade {
  const avisos = [...validarCobertura(unidade.cobertura, unidade.horarios), ...avisosSetores(unidade)];
  if (headcount(unidade.quadro) === 0) {
    avisos.push(
      salarioFallback
        ? "Unidade sem quadro atual: custos calculados com o salário médio da rede."
        : "Unidade sem quadro atual e rede sem salários: custos zerados.",
    );
  }
  const fases = (u: Unidade) => versao.fases.map((fase) => calcularFase({ unidade: u, fase, versao, premissas, salarioFallback }));
  let fasesPico: ResultadoFase[] | null = null;
  if (unidade.pico) {
    // Semana de pico: mesmo quadro, com horário e cobertura do pico (D-33).
    const u: Unidade = { ...unidade, horarios: unidade.pico.horarios, cobertura: unidade.pico.cobertura };
    fasesPico = fases(u);
    const rotulo = unidade.pico.descricao?.trim() || "pico";
    avisos.push(...[...validarCobertura(u.cobertura, u.horarios), ...avisosSetores(u)].map((a) => `Semana de ${rotulo}: ${a}`));
  }
  return {
    unidadeId: unidade.id,
    nome: unidade.nome,
    bandeira: unidade.bandeira?.trim() || null,
    regional: unidade.regional?.trim() || null,
    headcountAtual: headcount(unidade.quadro),
    horasAbertasSemana: horasAbertasSemana(unidade.horarios),
    fases: fases(unidade),
    fasesPico,
    avisos,
  };
}

function fmt(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
