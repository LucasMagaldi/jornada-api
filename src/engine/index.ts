/**
 * Motor de cálculo do simulador. TypeScript puro, sem efeitos colaterais.
 * Fórmulas: seção 6 do documento de contexto; decisões: DECISOES.md.
 */
export * from "./tipos";
export * from "./regras";
export * from "./cobertura";
export * from "./premissas";
export * from "./calculo";
export { agrupar, calcularRede, consolidar, semanaPico, semanaTipica } from "./consolidado";
