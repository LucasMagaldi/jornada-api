import type { ResultadoRede } from "../engine";
import { avisosRede, descreverPremissas, nomeCenario } from "./descricao";
import { formatarData } from "./formato";
import { AVISO_JURIDICO, LIMITACOES } from "./textos";

const SEP = ";";
const num = (v: number, casas = 2) => v.toFixed(casas).replace(".", ",");
function celula(v: string | number): string {
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const linha = (cols: (string | number)[]) => cols.map(celula).join(SEP);

/** CSV para Excel em português (separador ";", decimal ","). */
export function gerarRelatorioCsv(r: ResultadoRede, nomeRede: string, data: string): string {
  const out: string[] = [];
  out.push(linha(["Simulador de impacto do fim da escala 6x1", nomeRede, `Data de referência: ${formatarData(data)}`]));
  out.push(linha(["AVISO", AVISO_JURIDICO]));
  out.push("");
  out.push(
    linha([
      "unidade", "fase", "jornada_semanal", "horas_cobertura_semana", "fte_necessario", "fte_atual_equivalente", "delta_fte",
      "salario_medio", "valor_hora", "horas_faltantes_mes",
      "custo_mensal_contratar", "custo_mensal_hora_extra", "custo_mensal_reduzir_horario", "custo_mensal_mix",
      "mais_barato",
    ]),
  );
  for (const u of r.unidades) {
    for (const f of u.fases) {
      out.push(
        linha([
          u.nome, f.fase.nome, num(f.fase.jornadaSemanal, 0), num(f.horasCoberturaSemana), num(f.fteNecessario), num(f.fteAtualEquivalente),
          num(f.deltaFte), num(f.salarioMedio), num(f.valorHora), num(f.horasFaltantesMes),
          ...Object.values(f.cenarios).map((c) => (c.disponivel ? num(c.custoMensal) : "n/d")),
          nomeCenario(f.maisBarato),
        ]),
      );
    }
  }
  for (const c of r.consolidado) {
    out.push(
      linha([
        "REDE (consolidado)", c.fase.nome, num(c.fase.jornadaSemanal, 0), num(c.horasCoberturaSemana), num(c.fteNecessario),
        num(c.fteAtualEquivalente), num(c.deltaFte), "", "", "",
        ...Object.values(c.custos).map((v) => num(v)),
        nomeCenario(c.maisBarato),
      ]),
    );
  }
  out.push("");
  out.push(linha(["PREMISSAS"]));
  for (const [k, v] of descreverPremissas(r.premissas, r.versaoRegras)) out.push(linha([k, v]));
  out.push("");
  out.push(linha(["LIMITAÇÕES", LIMITACOES]));
  out.push(linha(["NOTA", "No consolidado, unidades sem o cenário (ex.: sem horário reduzido) entram com o custo de contratar."]));
  for (const a of avisosRede(r)) out.push(linha(["AVISO", a]));
  return "﻿" + out.join("\r\n") + "\r\n";
}
