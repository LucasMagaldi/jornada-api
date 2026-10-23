import { calcularUnidade, headcount, IDS_CENARIOS, salarioMedioPonderado } from "./calculo";
import { validarPremissas } from "./premissas";
import type {
  IdCenario,
  Premissas,
  ResultadoFaseConsolidado,
  ResultadoRede,
  ResultadoUnidade,
  Unidade,
  VersaoRegras,
} from "./tipos";

const EPS = 1e-9;

function porCenario(valor: number): Record<IdCenario, number> {
  return { contratar: valor, horaExtra: valor, reduzirHorario: valor, mix: valor };
}

/** Soma as unidades fase a fase (D-27). */
export function consolidar(unidades: ResultadoUnidade[], versao: VersaoRegras): ResultadoFaseConsolidado[] {
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
      const f = u.fases[i];
      c.horasCoberturaSemana += f.horasCoberturaSemana;
      c.fteNecessario += f.fteNecessario;
      c.fteAtualEquivalente += f.fteAtualEquivalente;
      c.deltaFte += Math.max(0, f.deltaFte);
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
      const existe = unidades.some((u) => u.fases[i].cenarios[id].disponivel);
      if (!existe || c.unidadesAcimaDoLimite[id] > 0) continue;
      if (c.maisBarato === null || c.custos[id] < c.custos[c.maisBarato] - EPS) c.maisBarato = id;
    }
    return c;
  });
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

  return {
    versaoRegras: versao,
    premissas,
    unidades: resultados,
    consolidado: consolidar(resultados, versao),
    headcountAtual: headcount(todoQuadro),
    avisos,
  };
}

