import type { ResultadoFase, ResultadoFaseConsolidado, ResultadoRede } from "../engine";
import { avisosRede, descreverPremissas, nomeCenario, nomeGrupo } from "./descricao";
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
      "mais_barato", "deficit_fte", "semana", "bandeira", "regional",
    ]),
  );
  const linhaFase = (u: (typeof r.unidades)[number], f: ResultadoFase, semana: string) =>
    linha([
      u.nome, f.fase.nome, num(f.fase.jornadaSemanal, 0), num(f.horasCoberturaSemana), num(f.fteNecessario), num(f.fteAtualEquivalente),
      num(f.deltaFte), num(f.salarioMedio), num(f.valorHora), num(f.horasFaltantesMes),
      ...Object.values(f.cenarios).map((c) => (c.disponivel ? num(c.custoMensal) : "n/d")),
      nomeCenario(f.maisBarato), num(f.deficitFte), semana, u.bandeira ?? "", u.regional ?? "",
    ]);
  const linhaConsolidado = (rotulo: string, c: ResultadoFaseConsolidado, semana: string) =>
    linha([
      rotulo, c.fase.nome, num(c.fase.jornadaSemanal, 0), num(c.horasCoberturaSemana), num(c.fteNecessario),
      num(c.fteAtualEquivalente), num(c.deltaFte), "", "", "",
      ...Object.values(c.custos).map((v) => num(v)),
      nomeCenario(c.maisBarato), num(c.deltaFte), semana, "", "",
    ]);
  for (const u of r.unidades) {
    for (const f of u.fases) out.push(linhaFase(u, f, "tipica"));
    for (const f of u.fasesPico ?? []) out.push(linhaFase(u, f, "pico"));
  }
  for (const c of r.consolidado) out.push(linhaConsolidado("REDE (consolidado)", c, "tipica"));
  for (const c of r.pico?.consolidado ?? []) out.push(linhaConsolidado("REDE (consolidado)", c, "pico"));
  for (const g of r.grupos) {
    const rotulo = `${g.tipo === "bandeira" ? "BANDEIRA" : "REGIONAL"}: ${nomeGrupo(g.tipo, g.nome)} (consolidado)`;
    for (const c of g.consolidado) out.push(linhaConsolidado(rotulo, c, "tipica"));
    for (const c of g.consolidadoPico ?? []) out.push(linhaConsolidado(rotulo, c, "pico"));
  }
  const comSetores = r.unidades.filter((u) => u.fases[0].setores.length > 1 || (u.fasesPico?.[0].setores.length ?? 0) > 1);
  if (comSetores.length > 0) {
    out.push("");
    out.push(linha(["SETORES (D-32)"]));
    out.push(linha(["unidade", "fase", "semana", "setor", "horas_cobertura_semana", "fte_necessario", "fte_atual_equivalente", "delta_fte", "colaboradores", "salario_medio"]));
    for (const u of comSetores) {
      for (const [fases, semana] of [[u.fases, "tipica"], [u.fasesPico ?? [], "pico"]] as const) {
        for (const f of fases) {
          for (const s of f.setores) {
            out.push(linha([u.nome, f.fase.nome, semana, s.setor || "geral", num(s.horasCoberturaSemana), num(s.fteNecessario), num(s.fteAtualEquivalente), num(s.deltaFte), s.headcount, num(s.salarioMedio)]));
          }
        }
      }
    }
  }
  out.push("");
  out.push(linha(["PREMISSAS"]));
  for (const [k, v] of descreverPremissas(r.premissas, r.versaoRegras)) out.push(linha([k, v]));
  out.push("");
  out.push(linha(["LIMITAÇÕES", LIMITACOES]));
  out.push(linha(["NOTA", "No consolidado, unidades sem o cenário (ex.: sem horário reduzido) entram com o custo de contratar."]));
  out.push(linha(["NOTA", "delta_fte é o saldo da unidade; deficit_fte soma só os déficits por setor e é o que gera custo. No pico, unidades sem semana de pico entram com a semana típica."]));
  for (const a of avisosRede(r)) out.push(linha(["AVISO", a]));
  return "﻿" + out.join("\r\n") + "\r\n";
}
