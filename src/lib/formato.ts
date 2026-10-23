const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dec = (casas: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const formatarBRL = (v: number) => brl.format(v);
export const formatarNumero = (v: number, casas = 2) => dec(casas).format(v);
export const formatarPct = (v: number) => `${dec(1).format(v * 100)}%`;
export const formatarData = (iso: string) => iso.split("-").reverse().join("/");
