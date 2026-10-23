/**
 * Importação de CSV (D-22). Puro: recebe texto e devolve estruturas do motor + erros.
 * Mensagens de erro citam linha e coluna, nunca o valor (salário é dado sensível, D-24).
 */
import { coberturaVazia, DIAS_SEMANA, horaParaMinutos, horarioVazio, intervaloNoDia, minutosParaHora } from "../engine";
import type { Cargo, CoberturaSemanal, DiaSemana, HorarioSemanal, SemanaPico } from "../engine";

export const CABECALHO_COBERTURA = ["unidade", "dia", "inicio", "fim", "pessoas"] as const;
export const CABECALHO_QUADRO = ["unidade", "cargo", "quantidade", "salario", "jornada"] as const;

/** Colunas opcionais: setor (D-32), semana (D-33), bandeira e regional (D-34). */
export const MODELO_COBERTURA = `unidade;dia;inicio;fim;pessoas;setor;semana;bandeira;regional
Loja Centro;todos;08:00;12:00;2;;;Bandeira A;Sul
Loja Centro;todos;12:00;14:00;3;;;;
Loja Centro;todos;14:00;22:00;2;;;;
Loja Centro;todos;08:00;23:00;3;;pico;;
Loja Bairro;uteis;09:00;19:00;2;Caixa;;Bandeira A;Sul
Loja Bairro;uteis;09:00;19:00;1;Padaria;;;
Loja Bairro;sab;09:00;14:00;2;Caixa;;;
Loja Bairro;sab;09:00;14:00;1;Padaria;;;
Posto Rodovia;todos;22:00;06:00;1;;;Conveniência;Sudeste
`;

/** Coluna opcional: setor (D-32). */
export const MODELO_QUADRO = `unidade;cargo;quantidade;salario;jornada;setor
Loja Centro;Atendente;5;2.100,00;44;
Loja Centro;Caixa;2;1.950,00;44;
Loja Bairro;Operador de caixa;3;2.000,00;44;Caixa
Loja Bairro;Padeiro;1;2.400,00;44;Padaria
Posto Rodovia;Atendente;2;2.100,00;44;
`;

const ATALHOS_DIA: Record<string, DiaSemana[]> = {
  todos: [...DIAS_SEMANA],
  uteis: ["seg", "ter", "qua", "qui", "sex"],
  fds: ["sab", "dom"],
};

const ALIASES_DIA: Record<string, DiaSemana> = {
  segunda: "seg", terca: "ter", quarta: "qua", quinta: "qui", sexta: "sex", sabado: "sab", domingo: "dom",
};

/** Remove acentos, espaços e caixa. */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Divide o texto em linhas de campos. Suporta aspas e "" como escape. */
export function lerLinhas(texto: string, separador: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let aspas = false;
  const t = texto.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') {
        aspas = false;
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === separador) {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else {
      campo += ch;
    }
  }
  if (campo !== "" || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

/** Detecta ";" ou "," pelo cabeçalho. */
export function detectarSeparador(texto: string): string {
  const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
  return primeira.includes(";") ? ";" : ",";
}

/** Aceita "2.500,00", "2500,5", "2500.50", "R$ 2.500" e "2.500" (milhar). */
export function lerNumeroBR(valor: string): number {
  let v = valor.replace(/R\$/gi, "").replace(/\s/g, "");
  if (v === "") return Number.NaN;
  if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN;
}

interface Tabela {
  /** Colunas do cabeçalho, normalizadas. */
  colunas: string[];
  linhas: { numero: number; campos: Record<string, string> }[];
  erros: string[];
}

function lerTabela(texto: string, esperado: readonly string[]): Tabela {
  const erros: string[] = [];
  const brutas = lerLinhas(texto, detectarSeparador(texto));
  if (brutas.length === 0) return { colunas: [], linhas: [], erros: ["Arquivo vazio."] };
  const cabecalho = brutas[0].map(normalizar);
  const faltando = esperado.filter((c) => !cabecalho.includes(c));
  if (faltando.length > 0) {
    return { colunas: cabecalho, linhas: [], erros: [`Cabeçalho inválido: faltam as colunas ${faltando.join(", ")}. Esperado: ${esperado.join(";")}`] };
  }
  const linhas: Tabela["linhas"] = [];
  brutas.slice(1).forEach((campos, i) => {
    if (campos.every((c) => c.trim() === "")) return;
    const reg: Record<string, string> = {};
    cabecalho.forEach((col, j) => (reg[col] = (campos[j] ?? "").trim()));
    linhas.push({ numero: i + 2, campos: reg });
  });
  if (linhas.length === 0) erros.push("Nenhuma linha de dados.");
  return { colunas: cabecalho, linhas, erros };
}

function lerDias(valor: string): DiaSemana[] | null {
  const n = normalizar(valor).replace(/-feira$/, "");
  if (ATALHOS_DIA[n]) return ATALHOS_DIA[n];
  if ((DIAS_SEMANA as readonly string[]).includes(n)) return [n as DiaSemana];
  if (ALIASES_DIA[n]) return [ALIASES_DIA[n]];
  return null;
}

function horaValida(h: string): boolean {
  try {
    horaParaMinutos(h);
    return true;
  } catch {
    return false;
  }
}

export interface UnidadeImportada {
  nome: string;
  horarios: HorarioSemanal;
  cobertura: CoberturaSemanal;
  /** `undefined` = arquivo sem a coluna `semana` (não mexer no pico); `null` = nenhuma linha de pico. */
  pico?: SemanaPico | null;
  /** `undefined` = arquivo sem a coluna; `null` = coluna vazia para a unidade. */
  bandeira?: string | null;
  regional?: string | null;
}

const MIN_DIA = 24 * 60;

/**
 * Horário de cada dia = [menor início, maior fim] das faixas do dia; o fim pode passar da
 * meia-noite (D-35). Dias em que isso passa de 24 h voltam em `diasInvalidos`.
 */
function inferirHorarios(cobertura: CoberturaSemanal): { horarios: HorarioSemanal; diasInvalidos: DiaSemana[] } {
  const horarios = horarioVazio();
  const diasInvalidos: DiaSemana[] = [];
  for (const dia of DIAS_SEMANA) {
    const faixas = cobertura[dia];
    if (faixas.length === 0) continue;
    faixas.sort((a, b) => horaParaMinutos(a.inicio) - horaParaMinutos(b.inicio));
    const intervalos = faixas.map((f) => intervaloNoDia(f.inicio, f.fim));
    const abre = Math.min(...intervalos.map(([a]) => a));
    const fecha = Math.max(...intervalos.map(([, b]) => b));
    // 24 h só cabe como 00:00–24:00; 06:00–06:00 seria lido como janela vazia.
    if (fecha - abre > MIN_DIA || (fecha - abre === MIN_DIA && abre > 0)) {
      diasInvalidos.push(dia);
      continue;
    }
    horarios[dia] = { abre: minutosParaHora(abre), fecha: minutosParaHora(fecha > MIN_DIA ? fecha - MIN_DIA : fecha) };
  }
  return { horarios, diasInvalidos };
}

interface Acumulado {
  nome: string;
  cobertura: CoberturaSemanal;
  pico: CoberturaSemanal;
  temPico: boolean;
  bandeira: string;
  regional: string;
}

/**
 * cobertura.csv → unidades com cobertura e horário de funcionamento inferido. Colunas opcionais:
 * `setor` (D-32), `semana` = tipica | pico (D-33), `bandeira` e `regional` (D-34).
 */
export function importarCobertura(texto: string): { unidades: UnidadeImportada[]; erros: string[] } {
  const { colunas, linhas, erros } = lerTabela(texto, CABECALHO_COBERTURA);
  const porNome = new Map<string, Acumulado>();
  for (const { numero, campos } of linhas) {
    const nome = campos.unidade;
    const dias = lerDias(campos.dia);
    const pessoas = lerNumeroBR(campos.pessoas);
    const semana = normalizar(campos.semana ?? "");
    const errosLinha: string[] = [];
    if (!nome) errosLinha.push("unidade vazia");
    if (!dias) errosLinha.push("dia inválido (use seg..dom, todos, uteis ou fds)");
    if (!horaValida(campos.inicio)) errosLinha.push("inicio inválido (HH:MM)");
    if (!horaValida(campos.fim)) errosLinha.push("fim inválido (HH:MM)");
    else if (horaValida(campos.inicio) && horaParaMinutos(campos.fim) === horaParaMinutos(campos.inicio)) {
      errosLinha.push("fim igual ao início (24 h = 00:00 a 24:00; fim antes do início vira o dia, D-35)");
    }
    if (!Number.isInteger(pessoas) || pessoas < 0) errosLinha.push("pessoas deve ser inteiro ≥ 0");
    if (!["", "tipica", "pico"].includes(semana)) errosLinha.push("semana inválida (use tipica ou pico)");
    if (errosLinha.length > 0) {
      erros.push(`Linha ${numero}: ${errosLinha.join("; ")}.`);
      continue;
    }
    let u = porNome.get(nome);
    if (!u) {
      u = { nome, cobertura: coberturaVazia(), pico: coberturaVazia(), temPico: false, bandeira: "", regional: "" };
      porNome.set(nome, u);
    }
    for (const grupo of ["bandeira", "regional"] as const) {
      const valor = (campos[grupo] ?? "").trim();
      if (!valor) continue;
      if (u[grupo] && u[grupo] !== valor) erros.push(`Linha ${numero}: ${grupo} diferente da informada em outra linha da mesma unidade.`);
      else u[grupo] = valor;
    }
    if (semana === "pico") u.temPico = true;
    const destino = semana === "pico" ? u.pico : u.cobertura;
    const setor = (campos.setor ?? "").trim();
    for (const dia of dias!) {
      destino[dia].push({ inicio: campos.inicio, fim: campos.fim, pessoas, ...(setor ? { setor } : {}) });
    }
  }
  const unidades: UnidadeImportada[] = [];
  for (const u of porNome.values()) {
    const tipica = inferirHorarios(u.cobertura);
    const pico = inferirHorarios(u.pico);
    for (const [dias, rotulo] of [[tipica.diasInvalidos, ""], [pico.diasInvalidos, " (pico)"]] as const) {
      for (const dia of dias) {
        erros.push(`Unidade "${u.nome}", ${dia}${rotulo}: as faixas do dia passam de 24 h; lance a madrugada no dia em que o turno começa (D-35).`);
      }
    }
    const importada: UnidadeImportada = { nome: u.nome, horarios: tipica.horarios, cobertura: u.cobertura };
    if (colunas.includes("semana")) importada.pico = u.temPico ? { horarios: pico.horarios, cobertura: u.pico } : null;
    if (colunas.includes("bandeira")) importada.bandeira = u.bandeira || null;
    if (colunas.includes("regional")) importada.regional = u.regional || null;
    unidades.push(importada);
  }
  return { unidades, erros };
}

export interface QuadroImportado {
  unidade: string;
  cargos: Cargo[];
}

/** quadro.csv → cargos agrupados por unidade. Coluna opcional `setor` (D-32). */
export function importarQuadro(texto: string): { quadros: QuadroImportado[]; erros: string[] } {
  const { linhas, erros } = lerTabela(texto, CABECALHO_QUADRO);
  const porNome = new Map<string, Cargo[]>();
  for (const { numero, campos } of linhas) {
    const quantidade = lerNumeroBR(campos.quantidade);
    const salario = lerNumeroBR(campos.salario);
    const jornada = lerNumeroBR(campos.jornada);
    const errosLinha: string[] = [];
    if (!campos.unidade) errosLinha.push("unidade vazia");
    if (!campos.cargo) errosLinha.push("cargo vazio");
    if (!Number.isInteger(quantidade) || quantidade < 0) errosLinha.push("quantidade deve ser inteiro ≥ 0");
    if (!(salario > 0)) errosLinha.push("salário inválido");
    if (!(jornada > 0 && jornada <= 44)) errosLinha.push("jornada deve estar entre 0 e 44 horas");
    if (errosLinha.length > 0) {
      erros.push(`Linha ${numero}: ${errosLinha.join("; ")}.`);
      continue;
    }
    const lista = porNome.get(campos.unidade) ?? [];
    const setor = (campos.setor ?? "").trim();
    lista.push({ nome: campos.cargo, quantidade, salarioBase: salario, jornadaSemanal: jornada, ...(setor ? { setor } : {}) });
    porNome.set(campos.unidade, lista);
  }
  return { quadros: [...porNome.entries()].map(([unidade, cargos]) => ({ unidade, cargos })), erros };
}
