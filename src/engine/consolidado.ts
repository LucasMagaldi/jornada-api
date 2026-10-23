import { calcularUnidade, headcount, IDS_CENARIOS, salarioMedioPonderado } from "./calculo";
import { validarPremissas } from "./premissas";
import type {
  IdCenario,
  Premissas,
  ResultadoFase,
  ResultadoFaseConsolidado,
  ResultadoGrupo,
  ResultadoRede,
  ResultadoUnidade,
  TipoGrupo,
  Unidade,
  VersaoRegras,
} from "./tipos";

const EPS = 1e-9;

function porCenario(valor: number): Record<IdCenario, number> {
  return { contratar: valor, horaExtra: valor, reduzirHorario: valor, mix: valor };
}

/** Fases da semana típica de cada unidade. */
export const semanaTipica = (u: ResultadoUnidade): ResultadoFase[] => u.fases;
/** Fases da semana de pico; unidade sem pico informado entra com a semana típica (D-33). */
export const semanaPico = (u: ResultadoUnidade): ResultadoFase[] => u.fasesPico ?? u.fases;

/** Soma as unidades fase a fase (D-27, D-28). */
export function consolidar(
  unidades: ResultadoUnidade[],
  versao: VersaoRegras,
  fasesDa: (u: ResultadoUnidade) => ResultadoFase[] = semanaTipica,
): ResultadoFaseConsolidado[] {
  return versao.fases.map((fase, i) => {
    const c: ResultadoFaseConsolidado = {
      fase,
      horasCoberturaSemana: 0,
      fteNecessario: 0,
      fteAtualEquivalente: 0,
      deltaFte: 0,
      custos: porCenario(0),
      unidadesSemCenario: porCenario(0),
      unidadesAcimaDoLimite: porCenario(0),
      custoMelhorPorUnidade: 0,
      maisBarato: null,
    };
    for (const u of unidades) {
      const f = fasesDa(u)[i];
      c.horasCoberturaSemana += f.horasCoberturaSemana;
      c.fteNecessario += f.fteNecessario;
      c.fteAtualEquivalente += f.fteAtualEquivalente;
      // Déficit por setor já descarta sobras dentro da unidade (D-32).
      c.deltaFte += f.deficitFte;
      for (const id of IDS_CENARIOS) {
        const cen = f.cenarios[id];
        if (cen.disponivel) {
          c.custos[id] += cen.custoMensal;
        } else {
          c.custos[id] += f.cenarios.contratar.custoMensal;
          c.unidadesSemCenario[id] += 1;
        }
        if (cen.detalhes.excedeLimiteLegal === true) c.unidadesAcimaDoLimite[id] += 1;
      }
      const melhor = f.maisBarato ?? "contratar";
      c.custoMelhorPorUnidade += f.cenarios[melhor].custoMensal;
    }
    // Mais barato na rede: só cenários que existem em ao menos uma unidade e não estouram o limite legal.
    for (const id of IDS_CENARIOS) {
      const existe = unidades.some((u) => fasesDa(u)[i].cenarios[id].disponivel);
      if (!existe || c.unidadesAcimaDoLimite[id] > 0) continue;
      if (c.maisBarato === null || c.custos[id] < c.custos[c.maisBarato] - EPS) c.maisBarato = id;
    }
    return c;
  });
}

/**
 * Consolidado por bandeira e por regional (D-34). Um tipo só aparece se ao menos uma unidade o
 * informa; unidades sem o campo formam o grupo "" (exibido como "sem bandeira/regional").
 */
export function agrupar(unidades: ResultadoUnidade[], versao: VersaoRegras): ResultadoGrupo[] {
  const temPico = unidades.some((u) => u.fasesPico);
  const grupos: ResultadoGrupo[] = [];
  for (const tipo of ["bandeira", "regional"] as TipoGrupo[]) {
    if (!unidades.some((u) => u[tipo])) continue;
    const porNome = new Map<string, ResultadoUnidade[]>();
    for (const u of unidades) {
      const nome = u[tipo] ?? "";
      porNome.set(nome, [...(porNome.get(nome) ?? []), u]);
    }
    const nomes = [...porNome.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "pt-BR")));
    for (const nome of nomes) {
      const membros = porNome.get(nome)!;
      grupos.push({
        tipo,
        nome,
        unidadeIds: membros.map((u) => u.unidadeId),
        consolidado: consolidar(membros, versao),
        consolidadoPico: temPico ? consolidar(membros, versao, semanaPico) : null,
      });
    }
  }
  return grupos;
}

/**
 * Ponto de entrada do motor: calcula todas as unidades em todas as fases da versão
 * de regras informada e consolida a rede. Função pura.
 */
export function calcularRede(unidades: Unidade[], versao: VersaoRegras, premissas: Premissas): ResultadoRede {
  const erros = validarPremissas(premissas);
  if (erros.length > 0) throw new Error(erros.join(" "));

  const todoQuadro = unidades.flatMap((u) => u.quadro);
  const salarioRede = salarioMedioPonderado(todoQuadro);
  const resultados = unidades.map((u) => calcularUnidade(u, versao, premissas, salarioRede));

  const avisos: string[] = [];
  if (unidades.length === 0) avisos.push("Nenhuma unidade cadastrada.");
  if (salarioRede === null && unidades.length > 0) avisos.push("Nenhum quadro informado: custos não podem ser estimados.");

  const unidadesComPico = resultados.filter((u) => u.fasesPico).length;
  return {
    versaoRegras: versao,
    premissas,
    unidades: resultados,
    consolidado: consolidar(resultados, versao),
    pico: unidadesComPico > 0 ? { unidadesComPico, consolidado: consolidar(resultados, versao, semanaPico) } : null,
    grupos: agrupar(resultados, versao),
    headcountAtual: headcount(todoQuadro),
    avisos,
  };
}
