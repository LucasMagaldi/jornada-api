import { DIAS_SEMANA } from "./tipos";
import type { CoberturaSemanal, DiaSemana, Faixa, Hora, HorarioSemanal, Janela } from "./tipos";

const RE_HORA = /^(\d{1,2}):(\d{2})$/;
const MIN_DIA = 24 * 60;
const MIN_SEMANA = 7 * MIN_DIA;

/** Intervalo em minutos [início, fim). */
type Intervalo = [number, number];

/** Converte "HH:MM" em minutos desde 00:00. Aceita "24:00". */
export function horaParaMinutos(hora: Hora): number {
  const m = RE_HORA.exec(hora.trim());
  if (!m) throw new Error(`Horário inválido: "${hora}" (use HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) {
    throw new Error(`Horário inválido: "${hora}"`);
  }
  return h * 60 + min;
}

export function minutosParaHora(minutos: number): Hora {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Fim antes do início = termina no dia seguinte (D-35). */
export function viraODia(inicio: Hora, fim: Hora): boolean {
  return horaParaMinutos(fim) < horaParaMinutos(inicio);
}

/** Intervalo em minutos a partir da 00:00 do próprio dia; o fim passa de 1440 quando vira o dia (D-35). */
export function intervaloNoDia(inicio: Hora, fim: Hora): Intervalo {
  const a = horaParaMinutos(inicio);
  const b = horaParaMinutos(fim);
  return [a, b < a ? b + MIN_DIA : b];
}

/** Posiciona um intervalo do dia na semana (seg 00:00 = 0); domingo que vira o dia continua na segunda. */
function naSemana(dia: DiaSemana, [a, b]: Intervalo): Intervalo[] {
  const base = DIAS_SEMANA.indexOf(dia) * MIN_DIA;
  const ini = base + a;
  const fim = base + b;
  return fim <= MIN_SEMANA ? [[ini, fim]] : [[ini, MIN_SEMANA], [0, fim - MIN_SEMANA]];
}

function uniao(intervalos: Intervalo[]): Intervalo[] {
  const ord = intervalos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const r: Intervalo[] = [];
  for (const [a, b] of ord) {
    const ultimo = r[r.length - 1];
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else r.push([a, b]);
  }
  return r;
}

const duracao = (intervalos: Intervalo[]) => intervalos.reduce((s, [a, b]) => s + (b - a), 0);

/** Minutos de `a` que caem dentro de `b` (b já unido, sem sobreposição). */
function minutosDentro(a: Intervalo[], b: Intervalo[]): number {
  let total = 0;
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) total += Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  }
  return total;
}

/** Horas de funcionamento da semana inteira, como intervalos unidos. */
function janelasDaSemana(horarios: HorarioSemanal): Intervalo[] {
  return uniao(
    DIAS_SEMANA.flatMap((dia) => {
      const j = horarios[dia];
      return j ? naSemana(dia, intervaloNoDia(j.abre, j.fecha)) : [];
    }),
  );
}

/** Duração em horas da janela de funcionamento (0 se fechado). Pode passar da meia-noite (D-35). */
export function horasJanela(janela: Janela | null): number {
  if (!janela) return 0;
  const [a, b] = intervaloNoDia(janela.abre, janela.fecha);
  return (b - a) / 60;
}

/** Horas abertas na semana (janelas que se sobrepõem na virada do dia contam uma vez). */
export function horasAbertasSemana(horarios: HorarioSemanal): number {
  return duracao(janelasDaSemana(horarios)) / 60;
}

/** Horas da faixa que caem dentro da janela de funcionamento do mesmo dia (D-08). */
export function horasFaixaDentro(faixa: Faixa, janela: Janela | null): number {
  if (!janela) return 0;
  const [fa, fb] = intervaloNoDia(faixa.inicio, faixa.fim);
  const [ja, jb] = intervaloNoDia(janela.abre, janela.fecha);
  return Math.max(0, Math.min(fb, jb) - Math.max(fa, ja)) / 60;
}

/** Chave de comparação do setor: sem espaços nas pontas e sem diferença de maiúsculas (D-32). */
export function chaveSetor(setor: string | undefined | null): string {
  return (setor ?? "").trim().toLowerCase();
}

/**
 * horas_cobertura_semana = Σ (horas da faixa dentro do funcionamento × pessoas mínimas na faixa).
 * O recorte usa a semana inteira, então uma faixa de madrugada conta mesmo que o horário que a
 * contém tenha começado no dia anterior (D-35). `setor` restringe às faixas desse setor (D-32).
 */
export function horasCoberturaSemana(cobertura: CoberturaSemanal, horarios: HorarioSemanal, setor?: string): number {
  const janelas = janelasDaSemana(horarios);
  let minutos = 0;
  for (const dia of DIAS_SEMANA) {
    for (const faixa of cobertura[dia] ?? []) {
      if (setor !== undefined && chaveSetor(faixa.setor) !== setor) continue;
      minutos += minutosDentro(naSemana(dia, intervaloNoDia(faixa.inicio, faixa.fim)), janelas) * faixa.pessoas;
    }
  }
  return minutos / 60;
}

/** Avisos de consistência entre cobertura e horário (não bloqueiam o cálculo). */
export function validarCobertura(cobertura: CoberturaSemanal, horarios: HorarioSemanal): string[] {
  const avisos: string[] = [];
  const janelas = janelasDaSemana(horarios);
  for (const dia of DIAS_SEMANA) {
    const janela = horarios[dia];
    const faixas = cobertura[dia] ?? [];
    const rotulo = (f: Faixa) => `faixa ${f.inicio}–${f.fim}${f.setor?.trim() ? ` (${f.setor.trim()})` : ""}`;
    for (const f of faixas) {
      if (f.pessoas < 0 || !Number.isFinite(f.pessoas)) {
        avisos.push(`${dia}: ${rotulo(f)} com número de pessoas inválido`);
      }
      if (horaParaMinutos(f.fim) === horaParaMinutos(f.inicio)) {
        avisos.push(`${dia}: ${rotulo(f)} tem início igual ao fim (sem duração)`);
        continue;
      }
      const intervalos = naSemana(dia, intervaloNoDia(f.inicio, f.fim));
      if (minutosDentro(intervalos, janelas) < duracao(intervalos)) {
        avisos.push(`${dia}: ${rotulo(f)} fora do horário de funcionamento (desconsiderada a parte de fora)`);
      }
    }
    // Sobreposição só importa dentro do mesmo setor: setores diferentes são pessoas diferentes.
    const porSetor = new Map<string, Faixa[]>();
    for (const f of faixas) porSetor.set(chaveSetor(f.setor), [...(porSetor.get(chaveSetor(f.setor)) ?? []), f]);
    for (const lista of porSetor.values()) {
      const ordenadas = [...lista].sort((a, b) => horaParaMinutos(a.inicio) - horaParaMinutos(b.inicio));
      for (let i = 1; i < ordenadas.length; i++) {
        const fimAnterior = intervaloNoDia(ordenadas[i - 1].inicio, ordenadas[i - 1].fim)[1];
        if (horaParaMinutos(ordenadas[i].inicio) < fimAnterior) {
          avisos.push(`${dia}: faixas sobrepostas (${rotulo(ordenadas[i - 1])} e ${rotulo(ordenadas[i])}); as pessoas são somadas`);
        }
      }
    }
    if (janela && faixas.length === 0) {
      avisos.push(`${dia}: unidade aberta sem cobertura mínima informada`);
    }
  }
  return avisos;
}

/** Atalho "mesma cobertura todos os dias": uma faixa = horário inteiro de cada dia aberto. */
export function coberturaUniforme(horarios: HorarioSemanal, pessoas: number): CoberturaSemanal {
  const c = {} as CoberturaSemanal;
  for (const dia of DIAS_SEMANA) {
    const j = horarios[dia];
    c[dia] = j ? [{ inicio: j.abre, fim: j.fecha, pessoas }] : [];
  }
  return c;
}

/** Copia as faixas de um dia para todos os dias da semana. */
export function replicarDia(cobertura: CoberturaSemanal, origem: (typeof DIAS_SEMANA)[number]): CoberturaSemanal {
  const c = {} as CoberturaSemanal;
  for (const dia of DIAS_SEMANA) c[dia] = cobertura[origem].map((f) => ({ ...f }));
  return c;
}

export function horarioVazio(): HorarioSemanal {
  return { seg: null, ter: null, qua: null, qui: null, sex: null, sab: null, dom: null };
}

export function coberturaVazia(): CoberturaSemanal {
  return { seg: [], ter: [], qua: [], qui: [], sex: [], sab: [], dom: [] };
}
