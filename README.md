# jornada-api

API e motor de cálculo do **Simulador de impacto do fim da escala 6x1**. Para cada unidade de uma rede,
calcula quantas pessoas a mais são necessárias em cada fase da nova jornada (hoje 44h → 42h → 40h),
quanto isso custa por mês e qual alternativa sai mais barata: contratar, hora extra, reduzir horário
ou um mix.

> Não constitui parecer jurídico. Datas, jornadas e divisores são premissas configuráveis.

Interface web: [jornada-ui](https://github.com/LucasMagaldi/jornada-ui). Decisões e premissas: [DECISOES.md](DECISOES.md).

## Como rodar

Requisitos: Node 20+ e Postgres 14+.

```bash
cp .env.example .env            # ajuste DATABASE_URL
npm install
npx prisma migrate deploy       # cria as tabelas
npm run db:seed                 # rede demo: demo@exemplo.com / demo12345
npm run dev                     # http://localhost:3333
```

## Testes

```bash
npm run test:engine             # só o motor (sem banco)
npm run test:coverage           # motor + CSV com cobertura
DATABASE_URL_TEST=postgresql://.../jornada_test npm test   # inclui integração da API (o banco é recriado)
```

O caso de referência da seção 6 está em `src/engine/__tests__/referencia.test.ts`
(196 h de cobertura; FTE 5,06 com 44h e 5,57 com 40h), com tabelas para 42h e para cobertura variável por faixa.

## Motor de cálculo (`src/engine`)

TypeScript puro, sem I/O, auditável. Ponto de entrada:

```ts
import { calcularRede, resolverVersao, normalizarPremissas } from "./src/engine";
const versao = resolverVersao(config, "2026-12-20");
const resultado = calcularRede(unidades, versao, normalizarPremissas({ perdas: 0.12 }, versao));
```

Para cada unidade e fase de jornada `J`:

1. `horas_cobertura_semana = Σ (horas da faixa dentro do horário × pessoas mínimas)`
2. `horas_produtivas = J × (1 − perdas)`
3. `FTE_necessario = horas_cobertura ÷ horas_produtivas × (1 + margem)`
4. `delta_FTE = FTE_necessario − Σ quantidade × min(jornada, J) ÷ J`
5. Contratar: `delta × salário médio × fator de encargos`
6. Hora extra: `horas faltantes/mês × (salário ÷ divisor da fase) × (1 + adicional)`
7. Reduzir horário: refaz o cálculo com o horário reduzido; o déficit que sobra é contratado
8. Mix: `p × contratar + (1 − p) × hora extra`

## Regras legais (`config/regras-legais.json`)

Lista de versões com `vigenteDesde`. Vale a versão de maior vigência ≤ data de referência. O arquivo
é lido a cada requisição: mudar datas, jornadas, divisores ou limite de hora extra altera o cálculo sem
mudar código nem reiniciar. Outro caminho pode ser indicado em `REGRAS_LEGAIS_PATH`.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/cadastro`, `/auth/login`, `/auth/logout` | sessão por cookie httpOnly (ou `Bearer`) |
| GET | `/auth/eu` | usuário e rede |
| DELETE | `/conta` | exclui a rede e todos os dados (LGPD) |
| GET | `/regras?data=` | versão das regras vigente |
| GET/PUT | `/premissas` | premissas da rede |
| GET/POST | `/unidades`, GET/PUT/DELETE `/unidades/:id` | unidades, cobertura, horário reduzido, quadro |
| POST | `/importacao` | CSV de cobertura e/ou quadro (tudo ou nada; `simular: true` só valida) |
| GET | `/modelos/cobertura.csv`, `/modelos/quadro.csv` | modelos para download |
| GET | `/simulacao?data=` | resultado com as premissas salvas |
| POST | `/simulacao` | resultado com premissas informadas (sem salvar) |
| GET | `/relatorio.pdf`, `/relatorio.csv` | relatório por unidade e consolidado, com premissas, limitações e aviso |

## Privacidade

Corpos de requisição não vão para o log, cookies e `authorization` são mascarados, e erros de importação
citam linha e coluna, nunca valores de salário. `DELETE /conta` apaga tudo em cascata.

## Limitação

O cálculo é de dimensionamento agregado. Ele não gera escala nominal e não considera restrições de
distribuição (domingos, descanso mínimo entre jornadas, folgas consecutivas), então pode subestimar o
quadro em operações com picos concentrados. A margem de segurança configurável existe para mitigar isso.
