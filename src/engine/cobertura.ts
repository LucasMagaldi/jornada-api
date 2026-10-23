import { DIAS_SEMANA } from "./tipos";
import type { CoberturaSemanal, Faixa, Hora, HorarioSemanal, Janela } from "./tipos";

const RE_HORA = /^(\d{1,2}):(\d{2})$/;

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

/** Duração em horas da janela de funcionamento (0 se fechado ou inválida). */
export function horasJanela(janela: Janela | null): number {
  if (!janela) return 0;
  return Math.max(0, horaParaMinutos(janela.fecha) - horaParaMinutos(janela.abre)) / 60;
}

export function horasAbertasSemana(horarios: HorarioSemanal): number {
  return DIAS_SEMANA.reduce((soma, dia) => soma + horasJanela(horarios[dia]), 0);
}

/** Horas da faixa que caem dentro da janela de funcionamento (D-08). */
export function horasFaixaDentro(faixa: Faixa, janela: Janela | null): number {
  if (!janela) return 0;
  const inicio = Math.max(horaParaMinutos(faixa.inicio), horaParaMinutos(janela.abre));
  const fim = Math.min(horaParaMinutos(faixa.fim), horaParaMinutos(janela.fecha));
  return Math.max(0, fim - inicio) / 60;
}

/**
 * horas_cobertura_semana = Σ (horas abertas na faixa × pessoas mínimas na faixa).
 */
export function horasCoberturaSemana(cobertura: CoberturaSemanal, horarios: HorarioSemanal): number {
  let total = 0;
  for (const dia of DIAS_SEMANA) {
    for (const faixa of cobertura[dia] ?? []) {
      total += horasFaixaDentro(faixa, horarios[dia]) * faixa.pessoas;
    }
  }
  return total;
}

/** Avisos de consistência entre cobertura e horário (não bloqueiam o cálculo). */
export function validarCobertura(cobertura: CoberturaSemanal, horarios: HorarioSemanal): string[] {
  const avisos: string[] = [];
  for (const dia of DIAS_SEMANA) {
    const janela = horarios[dia];
    const faixas = cobertura[dia] ?? [];
    for (const f of faixas) {
      if (f.pessoas < 0 || !Number.isFinite(f.pessoas)) {
        avisos.push(`${dia}: faixa ${f.inicio}–${f.fim} com número de pessoas inválido`);
      }
      if (horaParaMinutos(f.fim) <= horaParaMinutos(f.inicio)) {
        avisos.push(`${dia}: faixa ${f.inicio}–${f.fim} tem fim antes do início`);
        continue;
      }
      const dentro = horasFaixaDentro(f, janela);
      const total = (horaParaMinutos(f.fim) - horaParaMinutos(f.inicio)) / 60;
      if (dentro < total) {
        avisos.push(`${dia}: faixa ${f.inicio}–${f.fim} fora do horário de funcionamento (desconsiderada a parte de fora)`);
      }
    }
    const ordenadas = [...faixas].sort((a, b) => horaParaMinutos(a.inicio) - horaParaMinutos(b.inicio));
    for (let i = 1; i < ordenadas.length; i++) {
      if (horaParaMinutos(ordenadas[i].inicio) < horaParaMinutos(ordenadas[i - 1].fim)) {
        avisos.push(`${dia}: faixas sobrepostas (${ordenadas[i - 1].inicio}–${ordenadas[i - 1].fim} e ${ordenadas[i].inicio}–${ordenadas[i].fim}); as pessoas são somadas`);
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
