import PDFDocument from "pdfkit";
import { NOME_CENARIO } from "../engine";
import type { IdCenario, ResultadoRede } from "../engine";
import { avisosRede, descreverPremissas, nomeCenario } from "./descricao";
import { formatarBRL, formatarData, formatarNumero } from "./formato";
import { AVISO_JURIDICO, LIMITACOES } from "./textos";

const IDS: IdCenario[] = ["contratar", "horaExtra", "reduzirHorario", "mix"];
const MARGEM = 40;
const COR_TEXTO = "#1f2933";
const COR_SUAVE = "#52606d";
const COR_LINHA = "#d9e2ec";
const COR_DESTAQUE = "#0b6e4f";

/** As fontes padrão do PDF usam WinAnsi: troca símbolos fora dessa tabela. */
function limpar(s: string): string {
  return s.replace(/−/g, "-").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/→/g, "->").replace(/Σ/g, "soma").replace(/[⌈⌉]/g, "");
}

type Doc = InstanceType<typeof PDFDocument>;

function titulo(doc: Doc, texto: string, tamanho = 13) {
  garantirEspaco(doc, 40);
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(tamanho).fillColor(COR_TEXTO).text(limpar(texto), MARGEM);
  doc.moveDown(0.3);
}

function paragrafo(doc: Doc, texto: string, cor = COR_SUAVE, tamanho = 9) {
  doc.font("Helvetica").fontSize(tamanho).fillColor(cor).text(limpar(texto), MARGEM, undefined, { width: largura(doc) });
}

const largura = (doc: Doc) => doc.page.width - 2 * MARGEM;

function garantirEspaco(doc: Doc, altura: number) {
  if (doc.y + altura > doc.page.height - MARGEM) doc.addPage();
}

function caixa(doc: Doc, titulo: string, texto: string, cor: string) {
  doc.font("Helvetica").fontSize(8.5);
  const h = doc.heightOfString(limpar(texto), { width: largura(doc) - 16 }) + 26;
  garantirEspaco(doc, h);
  const y = doc.y;
  doc.save().rect(MARGEM, y, largura(doc), h).fillAndStroke("#f5f7fa", cor).restore();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(cor).text(limpar(titulo), MARGEM + 8, y + 6, { width: largura(doc) - 16 });
  doc.font("Helvetica").fontSize(8.5).fillColor(COR_TEXTO).text(limpar(texto), MARGEM + 8, y + 19, { width: largura(doc) - 16 });
  doc.x = MARGEM;
  doc.y = y + h + 6;
}

/** Tabela simples com quebra de página. A primeira coluna é alinhada à esquerda, as demais à direita. */
function tabela(doc: Doc, cabecalho: string[], linhas: string[][], pesos: number[], destaque?: (l: number, c: number) => boolean) {
  const total = pesos.reduce((a, b) => a + b, 0);
  const larguras = pesos.map((p) => (p / total) * largura(doc));
  const alturaLinha = 16;
  const desenhar = (cols: string[], cabecalho: boolean, fundo?: string, marcar?: (c: number) => boolean) => {
    garantirEspaco(doc, alturaLinha);
    const y = doc.y;
    if (fundo) doc.save().rect(MARGEM, y, largura(doc), alturaLinha).fill(fundo).restore();
    let x = MARGEM;
    cols.forEach((t, i) => {
      const forte = cabecalho || marcar?.(i);
      doc
        .font(forte ? "Helvetica-Bold" : "Helvetica")
        .fontSize(cabecalho ? 7 : 8)
        .fillColor(marcar?.(i) ? COR_DESTAQUE : COR_TEXTO)
        .text(limpar(t), x + 4, y + 4, { width: larguras[i] - 8, align: i === 0 ? "left" : "right", lineBreak: false, ellipsis: true });
      x += larguras[i];
    });
    doc.save().moveTo(MARGEM, y + alturaLinha).lineTo(MARGEM + largura(doc), y + alturaLinha).strokeColor(COR_LINHA).lineWidth(0.5).stroke().restore();
    doc.x = MARGEM;
    doc.y = y + alturaLinha;
  };
  desenhar(cabecalho, true, "#e4ecf3");
  linhas.forEach((l, i) => desenhar(l, false, undefined, destaque ? (c) => destaque(i, c) : undefined));
  doc.moveDown(0.5);
}

export function gerarRelatorioPdf(r: ResultadoRede, nomeRede: string, data: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: MARGEM, info: { Title: `Simulação 6x1 - ${nomeRede}` } });
  const partes: Buffer[] = [];
  doc.on("data", (b: Buffer) => partes.push(b));
  const fim = new Promise<Buffer>((ok) => doc.on("end", () => ok(Buffer.concat(partes))));

  doc.font("Helvetica-Bold").fontSize(18).fillColor(COR_TEXTO).text("Impacto do fim da escala 6x1");
  doc.font("Helvetica").fontSize(10).fillColor(COR_SUAVE)
    .text(limpar(`${nomeRede} · ${r.unidades.length} unidade(s) · ${r.headcountAtual} colaboradores · data de referência ${formatarData(data)}`));
  doc.moveDown(0.6);
  caixa(doc, "Não constitui parecer jurídico", AVISO_JURIDICO, "#b54708");

  // Consolidado
  titulo(doc, "Rede consolidada");
  const fases = r.consolidado;
  const linhasCons: string[][] = [
    ["Horas de cobertura/semana", ...fases.map((c) => formatarNumero(c.horasCoberturaSemana, 1))],
    ["FTE necessário", ...fases.map((c) => formatarNumero(c.fteNecessario))],
    ["FTE atual equivalente", ...fases.map((c) => formatarNumero(c.fteAtualEquivalente))],
    ["Déficit de FTE", ...fases.map((c) => formatarNumero(c.deltaFte))],
    ...IDS.map((id) => [`Custo mensal: ${NOME_CENARIO[id]}`, ...fases.map((c) => formatarBRL(c.custos[id]))]),
    ["Melhor cenário por unidade", ...fases.map((c) => formatarBRL(c.custoMelhorPorUnidade))],
    ["Mais barato na rede", ...fases.map((c) => nomeCenario(c.maisBarato))],
  ];
  tabela(doc, ["", ...fases.map((c) => c.fase.nome)], linhasCons, [2.2, ...fases.map(() => 1)], (l, c) => {
    const id = IDS[l - 4];
    return c > 0 && id !== undefined && fases[c - 1].maisBarato === id;
  });
  paragrafo(doc, "Custos mensais adicionais em relação ao quadro atual. No consolidado, unidades sem o cenário (ex.: sem horário reduzido informado) entram com o custo de contratar.");

  // Por unidade
  titulo(doc, "Por unidade");
  for (const u of r.unidades) {
    garantirEspaco(doc, 150);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COR_TEXTO).text(limpar(u.nome), MARGEM);
    paragrafo(doc, `${u.headcountAtual} colaboradores · ${formatarNumero(u.horasAbertasSemana, 1)} h de funcionamento/semana`);
    doc.moveDown(0.2);
    const linhas: string[][] = u.fases.map((f) => [
      f.fase.nome,
      formatarNumero(f.horasCoberturaSemana, 1),
      formatarNumero(f.fteNecessario),
      formatarNumero(f.fteAtualEquivalente),
      formatarNumero(f.deltaFte),
      formatarBRL(f.valorHora),
      ...IDS.map((id) => (f.cenarios[id].disponivel ? formatarBRL(f.cenarios[id].custoMensal) : "n/d")),
    ]);
    tabela(
      doc,
      ["Fase", "Cob. (h)", "FTE nec.", "FTE at.", "Delta", "R$/hora", "Contratar", "H. extra", "Red. horário", "Mix"],
      linhas,
      [1.45, 0.7, 0.7, 0.7, 0.6, 0.9, 1.15, 1.15, 1.15, 1.15],
      (l, c) => c >= 6 && u.fases[l].maisBarato === IDS[c - 6],
    );
    const avisos = [...u.avisos, ...u.fases.flatMap((f) => Object.values(f.cenarios).filter((c) => c.disponivel).flatMap((c) => c.avisos.map((a) => `${f.fase.nome}: ${a}`)))];
    for (const a of avisos) paragrafo(doc, `• ${a}`, "#b54708", 8);
    doc.moveDown(0.4);
  }

  // Premissas e limitações
  titulo(doc, "Premissas utilizadas");
  tabela(doc, ["Premissa", "Valor"], descreverPremissas(r.premissas, r.versaoRegras), [1.3, 2]);
  for (const o of r.versaoRegras.observacoes ?? []) paragrafo(doc, `• ${o}`, COR_SUAVE, 8);
  doc.moveDown(0.5);
  caixa(doc, "Limitações", LIMITACOES, COR_SUAVE);
  const avisosGerais = avisosRede(r).filter((a) => !a.includes(": "));
  for (const a of avisosGerais) paragrafo(doc, `• ${a}`, "#b54708", 8);
  caixa(doc, "Não constitui parecer jurídico", AVISO_JURIDICO, "#b54708");

  doc.end();
  return fim;
}
