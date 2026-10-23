/**
 * Tipos do motor de cálculo. Este módulo (e todo `src/engine`) é TypeScript puro:
 * sem I/O, sem dependências de banco, UI ou Node. Ver DECISOES.md, seção 1.
 */

export const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;
export type DiaSemana = (typeof DIAS_SEMANA)[number];

export const NOME_DIA: Record<DiaSemana, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

/** Horário no formato "HH:MM", de "00:00" a "24:00". */
export type Hora = string;

export interface Janela {
  abre: Hora;
  fecha: Hora;
}

/** Horário de funcionamento por dia; `null` = fechado. */
export type HorarioSemanal = Record<DiaSemana, Janela | null>;

export interface Faixa {
  inicio: Hora;
  fim: Hora;
  /** Pessoas mínimas trabalhando simultaneamente na faixa. */
  pessoas: number;
}

/** Cobertura mínima por dia da semana. */
export type CoberturaSemanal = Record<DiaSemana, Faixa[]>;

export interface Cargo {
  nome: string;
  quantidade: number;
  /** Salário-base mensal em BRL. */
  salarioBase: number;
  /** Jornada semanal contratada hoje, em horas. */
  jornadaSemanal: number;
}

export interface Unidade {
  id: string;
  nome: string;
  horarios: HorarioSemanal;
  /** Horário alternativo usado no cenário "reduzir horário". */
  horarioReduzido?: HorarioSemanal | null;
  cobertura: CoberturaSemanal;
  quadro: Cargo[];
}

// ---------------------------------------------------------------------------
// Regras legais (vêm de configuração versionada — nunca fixas no código)
// ---------------------------------------------------------------------------

export type IdFase = string;

export interface FaseLegal {
  id: IdFase;
  nome: string;
  /** Data (AAAA-MM-DD) em que a fase entra em vigor; `null` = regra vigente hoje. */
  inicio: string | null;
  jornadaSemanal: number;
  jornadaDiariaMax: number;
  diasTrabalhoSemana: number;
  divisorHora: number;
}

export interface VersaoRegras {
  id: string;
  /** Data (AAAA-MM-DD) a partir da qual esta versão das regras vale. */
  vigenteDesde: string;
  descricao: string;
  fonte?: string;
  /** Em ordem cronológica. A primeira é a fotografia "hoje". */
  fases: FaseLegal[];
  limiteHoraExtraDiaria: number;
  adicionalHoraExtraPadrao: number;
  observacoes?: string[];
}

export interface ConfigRegras {
  versoes: VersaoRegras[];
}

// ---------------------------------------------------------------------------
// Premissas editáveis pela rede
// ---------------------------------------------------------------------------

export interface Premissas {
  /** Perdas: férias, afastamentos, absenteísmo (0–1). */
  perdas: number;
  /** Multiplicador do salário para custo total do empregado (ex.: 1,8). */
  fatorEncargos: number;
  /** Adicional de hora extra (0,5 = 50%). */
  adicionalHoraExtra: number;
  /** Margem de segurança sobre o FTE necessário (0–1). */
  margemSeguranca: number;
  /** Sobrescrita do divisor de hora por fase (id da fase → divisor). */
  divisores: Record<IdFase, number>;
  /** Percentual do déficit coberto por contratação no cenário mix (0–1). */
  mixPercentualContratacao: number;
  /** Aplica o fator de encargos também sobre a hora extra (D-15). */
  encargosSobreHoraExtra: boolean;
}

// ---------------------------------------------------------------------------
// Resultados
// ---------------------------------------------------------------------------

export type IdCenario = "contratar" | "horaExtra" | "reduzirHorario" | "mix";

export const NOME_CENARIO: Record<IdCenario, string> = {
  contratar: "Contratar",
  horaExtra: "Hora extra",
  reduzirHorario: "Reduzir horário",
  mix: "Mix",
};

export interface ResultadoCenario {
  id: IdCenario;
  /** `false` quando o cenário não se aplica (ex.: sem horário reduzido informado). */
  disponivel: boolean;
  custoMensal: number;
  avisos: string[];
  /** Detalhes específicos do cenário, para a memória de cálculo. */
  detalhes: Record<string, number | string | boolean>;
}

export interface ResultadoFase {
  fase: FaseLegal;
  divisorUsado: number;
  horasCoberturaSemana: number;
  horasProdutivasPorColaborador: number;
  /** FTE já com margem de segurança. */
  fteNecessario: number;
  fteNecessarioSemMargem: number;
  fteAtualEquivalente: number;
  deltaFte: number;
  salarioMedio: number;
  valorHora: number;
  horasFaltantesSemana: number;
  horasFaltantesMes: number;
  cenarios: Record<IdCenario, ResultadoCenario>;
  /** Cenário disponível de menor custo. */
  maisBarato: IdCenario | null;
}

export interface ResultadoUnidade {
  unidadeId: string;
  nome: string;
  headcountAtual: number;
  horasAbertasSemana: number;
  fases: ResultadoFase[];
  avisos: string[];
}

export interface ResultadoFaseConsolidado {
  fase: FaseLegal;
  horasCoberturaSemana: number;
  fteNecessario: number;
  fteAtualEquivalente: number;
  /** Soma dos déficits positivos (unidades com sobra não compensam outras). */
  deltaFte: number;
  /**
   * Soma por cenário. Unidades em que o cenário não está disponível entram com o
   * custo de contratar (D-27).
   */
  custos: Record<IdCenario, number>;
  /** Quantas unidades entraram com o custo de contratar por não terem o cenário. */
  unidadesSemCenario: Record<IdCenario, number>;
  /** Quantas unidades excedem o limite legal de hora extra no cenário. */
  unidadesAcimaDoLimite: Record<IdCenario, number>;
  /** Melhor cenário escolhido unidade a unidade. */
  custoMelhorPorUnidade: number;
  maisBarato: IdCenario | null;
}

export interface ResultadoRede {
  versaoRegras: VersaoRegras;
  premissas: Premissas;
  unidades: ResultadoUnidade[];
  consolidado: ResultadoFaseConsolidado[];
  headcountAtual: number;
  avisos: string[];
}
