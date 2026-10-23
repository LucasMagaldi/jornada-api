import type { ConfigRegras, FaseLegal, VersaoRegras } from "./tipos";

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

export class ErroRegras extends Error {
  constructor(mensagem: string) {
    super(`Configuração de regras legais inválida: ${mensagem}`);
    this.name = "ErroRegras";
  }
}

function positivo(valor: unknown, campo: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    throw new ErroRegras(`${campo} deve ser um número positivo`);
  }
  return valor;
}

function validarFase(f: FaseLegal, onde: string): void {
  if (!f.id || !f.nome) throw new ErroRegras(`${onde}: fase sem id ou nome`);
  if (f.inicio !== null && !RE_DATA.test(f.inicio)) {
    throw new ErroRegras(`${onde}: inicio deve ser AAAA-MM-DD ou null`);
  }
  positivo(f.jornadaSemanal, `${onde}.jornadaSemanal`);
  positivo(f.jornadaDiariaMax, `${onde}.jornadaDiariaMax`);
  positivo(f.divisorHora, `${onde}.divisorHora`);
  const dias = positivo(f.diasTrabalhoSemana, `${onde}.diasTrabalhoSemana`);
  if (dias > 7) throw new ErroRegras(`${onde}.diasTrabalhoSemana deve ser ≤ 7`);
}

/** Valida a estrutura da configuração. Lança `ErroRegras` com a primeira inconsistência. */
export function validarConfigRegras(config: ConfigRegras): ConfigRegras {
  if (!config || !Array.isArray(config.versoes) || config.versoes.length === 0) {
    throw new ErroRegras("é preciso ao menos uma versão em `versoes`");
  }
  const ids = new Set<string>();
  for (const v of config.versoes) {
    const onde = `versão ${v.id ?? "?"}`;
    if (!v.id) throw new ErroRegras("versão sem id");
    if (ids.has(v.id)) throw new ErroRegras(`id de versão duplicado: ${v.id}`);
    ids.add(v.id);
    if (!RE_DATA.test(v.vigenteDesde)) throw new ErroRegras(`${onde}: vigenteDesde deve ser AAAA-MM-DD`);
    if (!Array.isArray(v.fases) || v.fases.length === 0) throw new ErroRegras(`${onde}: sem fases`);
    const idsFase = new Set<string>();
    v.fases.forEach((f, i) => {
      validarFase(f, `${onde}.fases[${i}]`);
      if (idsFase.has(f.id)) throw new ErroRegras(`${onde}: fase duplicada ${f.id}`);
      idsFase.add(f.id);
    });
    for (let i = 1; i < v.fases.length; i++) {
      const anterior = v.fases[i - 1].inicio;
      const atual = v.fases[i].inicio;
      if (atual === null) throw new ErroRegras(`${onde}: só a primeira fase pode ter inicio null`);
      if (anterior !== null && atual <= anterior) {
        throw new ErroRegras(`${onde}: fases fora de ordem cronológica`);
      }
    }
    positivo(v.limiteHoraExtraDiaria, `${onde}.limiteHoraExtraDiaria`);
    if (typeof v.adicionalHoraExtraPadrao !== "number" || v.adicionalHoraExtraPadrao < 0) {
      throw new ErroRegras(`${onde}.adicionalHoraExtraPadrao deve ser ≥ 0`);
    }
  }
  return config;
}

/**
 * Seleciona a versão vigente na data de referência (AAAA-MM-DD): a de maior
 * `vigenteDesde` que seja ≤ data. Se a data for anterior a todas, usa a mais antiga.
 */
export function resolverVersao(config: ConfigRegras, dataReferencia: string): VersaoRegras {
  validarConfigRegras(config);
  if (!RE_DATA.test(dataReferencia)) throw new ErroRegras("data de referência deve ser AAAA-MM-DD");
  const ordenadas = [...config.versoes].sort((a, b) => a.vigenteDesde.localeCompare(b.vigenteDesde));
  let escolhida = ordenadas[0];
  for (const v of ordenadas) {
    if (v.vigenteDesde <= dataReferencia) escolhida = v;
  }
  return escolhida;
}

/** Fase em vigor numa data, dentro de uma versão (útil para destacar "a fase atual"). */
export function faseEmVigor(versao: VersaoRegras, data: string): FaseLegal {
  let atual = versao.fases[0];
  for (const f of versao.fases) {
    if (f.inicio === null || f.inicio <= data) atual = f;
  }
  return atual;
}
