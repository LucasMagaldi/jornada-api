# DECISÕES

Registro das decisões de arquitetura e das premissas assumidas por falta de informação.
Cada item tem um identificador para ser citado no código e em revisões.

> A plataforma não emite parecer jurídico. Toda regra legal aqui é premissa a validar com o jurídico do cliente.

---

## 1. Estrutura

O produto está em dois repositórios:

- **jornada-api** (este): motor de cálculo, API HTTP, banco, importação CSV e exportação PDF/CSV.
- **jornada-ui**: interface web (Next.js) que chama a API por um proxy `/api/*`.

```
jornada-api/
├── config/
│   └── regras-legais.json      # regras legais versionadas por vigência (D-03)
├── prisma/
│   ├── schema.prisma           # modelo de dados (seção 2)
│   ├── migrations/
│   └── seed.ts                 # rede de demonstração com 3 unidades
├── src/
│   ├── engine/                 # MOTOR DE CÁLCULO — TypeScript puro, sem I/O
│   │   ├── tipos.ts            # tipos de entrada e saída
│   │   ├── regras.ts           # validação e resolução das regras por vigência
│   │   ├── cobertura.ts        # horas de cobertura (com recorte pelo horário)
│   │   ├── premissas.ts        # premissas padrão e validação
│   │   ├── calculo.ts          # fotografia por unidade/fase e 4 cenários
│   │   ├── consolidado.ts      # soma da rede (ponto de entrada: calcularRede)
│   │   └── __tests__/          # Vitest (caso de referência, tabelas, cenários)
│   ├── lib/                    # aplicação: CSV, auth, repositório, relatórios
│   ├── http/app.ts             # rotas Fastify (+ teste de integração)
│   └── server.ts
└── DECISOES.md
```

O motor (`src/engine`) não importa nada de fora da própria pasta, nem usa `process`, `console` ou
`fetch`. Isso é verificado por teste (`isolamento.test.ts`).

## 2. Modelo de dados (Postgres via Prisma)

| Tabela       | Campos principais | Observação |
|--------------|-------------------|------------|
| `Rede`       | id, nome, premissas (JSON), criadoEm | 1 conta = 1 rede (multi-tenant básico) |
| `Usuario`    | id, email (único), senhaHash, redeId | e-mail + senha (bcrypt) |
| `Sessao`     | id, token (único), usuarioId, expiraEm | cookie httpOnly, 30 dias |
| `Unidade`    | id, redeId, nome, bandeira, regional, horarios (JSON), horarioReduzido (JSON, opcional), cobertura (JSON), pico (JSON, opcional) | nome único por rede |
| `Cargo`      | id, unidadeId, nome, setor (opcional), quantidade, salarioBase (Decimal), jornadaSemanal | "quadro atual" |

Formato dos JSON (os mesmos tipos do motor, `src/engine/tipos.ts`):

- `horarios`: `{ seg: { abre: "08:00", fecha: "22:00" } | null, ter: ..., dom: ... }`
- `cobertura`: `{ seg: [ { inicio: "08:00", fim: "12:00", pessoas: 2, setor: "Caixa" }, ... ], ... }` (`setor` opcional, D-32)
- `pico`: `{ descricao: "Natal", horarios: {...}, cobertura: {...} }` ou `null` (D-33)
- `premissas`: ver `Premissas` em `tipos.ts`.

Toda tabela filha usa `onDelete: Cascade` a partir da `Rede`, para que a exclusão a pedido (LGPD)
apague tudo com uma operação.

## 3. Decisões e premissas

**D-01 — Stack.** API: Node 20+, TypeScript, Fastify 4, Prisma 5 + Postgres, Zod, Vitest, PDF no servidor
com `pdfkit` (fontes padrão, sem navegador headless). UI: Next.js 14 (App Router), CSS próprio, sem
framework de UI. Sem microserviços nem filas: são só um backend e um frontend.

**D-02 — Recálculo sem salvar.** `POST /simulacao` recebe premissas não salvas e devolve o resultado
completo; a UI chama a cada alteração (com 250 ms de espera). As regras legais e os dados não são
recarregados pelo usuário (critério de aceite 3). "Salvar" persiste (`PUT /premissas`); as exportações
usam as premissas salvas, e a UI bloqueia a exportação enquanto houver alteração não salva.

**D-03 — Regras legais em arquivo versionado.** `config/regras-legais.json` contém uma lista de
versões, cada uma com `vigenteDesde`. Vale a versão de maior `vigenteDesde` ≤ data de referência
(hoje, por padrão). O arquivo é lido a cada requisição (sem cache e sem `import`), então alterar datas,
jornadas ou divisores muda o cálculo sem mudança de código nem rebuild (critério de aceite 4).
Escolhemos arquivo em vez de tabela porque mudanças de regra precisam de revisão (PR) e histórico (git).

**D-04 — Datas das fases.** EC promulgada em 16/10/2026. Fase 1 = +60 dias = **15/12/2026**.
Fase 2 = +12 meses após a fase 1 = **15/12/2027**. Contagem de prazo (inclusão do dia inicial)
é premissa a validar.

**D-05 — "Hoje".** A fotografia "hoje" usa 44 h semanais, 6 dias de trabalho, divisor 220.

**D-06 — Divisores.** 220 (44h), 210 (42h), 200 (40h), como no documento de contexto. Ficam na
configuração legal e podem ser sobrescritos nas premissas da rede. Sinalizados na interface como
premissa a validar com o jurídico.

**D-07 — Cobertura agregada, não por cargo.** *Substituída pela D-32.* A cobertura mínima é de "pessoas",
sem distinguir cargo, e todo o quadro da unidade conta para cobri-la. Continua valendo quando a cobertura
não informa setores.

**D-08 — Horário de funcionamento recorta a cobertura.** Horas de cobertura =
Σ (interseção da faixa com o horário de funcionamento do dia) × pessoas. Faixas fora do horário não
contam (e geram aviso). O cenário "reduzir horário" usa exatamente o mesmo cálculo com o horário reduzido.

**D-09 — Sem virada de dia.** *Substituída pela D-35.* Horários iam de 00:00 a 24:00 no mesmo dia, e
operações que atravessavam a meia-noite eram informadas como duas faixas.

**D-10 — Margem de segurança.** Aplicada multiplicando o FTE necessário: `FTE × (1 + margem)`.
Padrão 5%. O caso de referência da seção 6 usa margem 0.

**D-11 — FTE atual equivalente.** Em cada fase de jornada J:
`Σ quantidade × min(jornada_atual, J) / J`. Quem hoje faz 44h passa a fazer no máximo J (sem redução
salarial); quem faz menos que J mantém a jornada.

**D-12 — Salário de referência.** Média dos salários-base ponderada pela quantidade de cada cargo da
unidade. É usada tanto para contratar quanto para o valor-hora. Unidade sem quadro usa a média
ponderada da rede (aviso exibido); se a rede inteira não tem quadro, custo = 0 com aviso.

**D-13 — Custo de contratar.** `delta_FTE × salário_médio × fator_encargos` (mensal), exatamente como
na especificação (FTE fracionado). Também exibimos `contratações inteiras = ⌈delta_FTE⌉` e o custo
correspondente, porque na prática não se contrata fração de pessoa (pode-se contratar meio período,
por isso o fracionado é o número principal). Delta ≤ 0 → custo 0 (sobra de quadro exibida).

**D-14 — Horas faltantes para hora extra.** Horas extras são horas efetivamente trabalhadas, logo
produtivas: `horas_faltantes_semana = delta_FTE × J × (1 − perdas)`.
`horas_faltantes_mes = horas_faltantes_semana × 52/12`.

**D-15 — Encargos sobre hora extra.** A fórmula da especificação não aplica encargos sobre a hora
extra. Mantivemos a fórmula como padrão e criamos a premissa `encargosSobreHoraExtra` (padrão:
desligada) porque, na prática, INSS/FGTS incidem sobre hora extra e isso muda a comparação.

**D-16 — Limite de hora extra.** A configuração legal tem `limiteHoraExtraDiaria` (padrão 2h).
Se as horas extras semanais necessárias por colaborador excederem `limite × dias de trabalho da fase`,
o cenário é marcado como "acima do limite legal": continua visível, mas não é indicado como o mais barato.

**D-17 — Reduzir horário.** Se a unidade tiver horário reduzido informado, recalcula-se a cobertura;
o déficit remanescente (se houver) é coberto por contratação. Exibimos economia versus contratar e a
perda de horas de atendimento (horas de porta aberta) e de horas de cobertura. Sem horário reduzido
informado, o cenário aparece como "não informado".

**D-18 — Mix.** `custo = p × custo_contratar + (1 − p) × custo_hora_extra`, com `p` premissa da rede
(padrão 50%).

**D-19 — Fator de encargos padrão 1,8.** (salário + ~80% de encargos e provisões). Valor genérico,
editável; cada empresa deve informar o seu.

**D-20 — Perdas padrão 12%.** Igual ao caso de referência.

**D-21 — Premissas por rede, não por unidade.** No MVP as premissas valem para toda a rede. Bandeira e
regional (D-34) só agrupam o resultado; premissas por grupo ficam para depois.

**D-22 — CSV.** Dois modelos: `cobertura.csv` (unidade;dia;inicio;fim;pessoas) e `quadro.csv`
(unidade;cargo;quantidade;salario;jornada). Separador `;` ou `,` (detectado pelo cabeçalho), números
no formato brasileiro (`2.500,00`) ou com ponto. `dia` aceita `seg..dom`, `todos` (atalho "mesma
cobertura todos os dias") e `uteis` (seg–sex). O horário de funcionamento do dia é inferido como
[menor início, maior fim] das faixas do dia. Unidades são criadas pelo nome; importar uma unidade
existente substitui a cobertura/quadro dela (não mescla). Colunas opcionais (D-32 a D-35): `setor` nos
dois arquivos; `semana` (`tipica` ou `pico`), `bandeira` e `regional` no `cobertura.csv`. A semana de pico
e os grupos só são substituídos quando a coluna existe no arquivo. Fim menor que o início vira o dia (D-35).

**D-23 — Moeda e arredondamento.** O motor trabalha com números sem arredondar; a interface e as
exportações arredondam (BRL com 2 casas, FTE com 2 casas).

**D-24 — Privacidade.** Não há log de salários (nenhum `console.log` de dados de quadro; erros de
importação citam linha e coluna, não o valor). Botão "Excluir conta e dados" remove a rede inteira.

**D-25 — Autenticação.** Cadastro aberto (e-mail + senha ≥ 8 caracteres) cria a rede e o usuário.
Sem recuperação de senha, papéis ou convites no MVP.

**D-26 — Dois repositórios.** O cliente criou `jornada-api` e `jornada-ui`. A UI fala com a API por
um *rewrite* do Next.js (`/api/*` → `API_URL`), de modo que o cookie de sessão é do mesmo domínio
(httpOnly, `SameSite=Lax`) e não há CORS em produção. A API também aceita `Authorization: Bearer`.

**D-27 — Consolidado de cenário indisponível.** No consolidado, uma unidade sem o cenário (ex.: sem
horário reduzido informado, ou sem quadro para fazer hora extra) entra com o custo de contratar dela,
e a interface mostra quantas unidades estão nessa situação. O "mais barato da rede" ignora cenários em
que alguma unidade excede o limite legal de hora extra. Também exibimos o "melhor por unidade"
(cada unidade no seu cenário mais barato), que é o piso de custo.

**D-28 — Delta consolidado.** O déficit da rede soma só os déficits positivos: sobra de quadro numa
unidade não cobre falta em outra (pessoas não se deslocam entre unidades no MVP).

**D-29 — Tipos compartilhados.** `jornada-ui/src/lib/tipos.ts` é cópia de `src/engine/tipos.ts`. Não
publicamos pacote compartilhado no MVP; ao mudar um, mude o outro.

**D-30 — "Hoje" na fotografia.** O delta de "hoje" compara a necessidade com 44h contra o quadro atual;
se a rede já está subdimensionada, isso aparece como custo já em "hoje". O impacto da mudança legal é a
diferença entre as fases.

**D-31 — Campo de horário na UI.** O `<input type="time">` não aceita 24:00; o valor 24:00 vindo do CSV é
mantido até ser editado, quando passa a 23:59.

**D-32 — Cobertura por setor.** Faixas de cobertura e cargos do quadro têm um `setor` opcional (texto
livre, comparado sem diferença de maiúsculas e espaços nas pontas). Quando nenhuma faixa da unidade
informa setor, o cálculo é o agregado da D-07 e o setor dos cargos é ignorado; o caso de referência não
muda. Quando alguma faixa informa, cada setor é calculado com as próprias faixas e os próprios cargos:
FTE necessário, FTE atual e delta por setor. Faixas e cargos sem setor formam o setor geral. A **sobra de
um setor não cobre a falta de outro** dentro da unidade (açougueiro não cobre caixa), como a D-28 faz
entre unidades: `deficitFte = Σ max(0, delta_setor)` é o que gera custo, e `deltaFte` continua sendo o
saldo da unidade inteira. Custos por setor: contratar e hora extra usam o salário médio ponderado do
setor (D-12 aplicada ao setor; setor sem quadro usa o da unidade e, sem quadro na unidade, o da rede).
O limite de hora extra é avaliado por setor, dividindo as horas faltantes do setor pelas pessoas do
setor. Se um setor com déficit não tem ninguém, o cenário de hora extra fica indisponível na unidade
(entra com contratar no consolidado, D-27). Setor com cobertura e sem quadro, setor com quadro e sem
cobertura e cargos sem setor numa cobertura com setores geram aviso. Premissa: pessoas não trocam de
setor; polivalência fica fora.

**D-33 — Semana de pico.** Cada unidade pode ter uma semana de pico (Natal, Páscoa, feriados) com
descrição, horário e cobertura próprios. O motor calcula as mesmas fases com esse horário e essa
cobertura e o **mesmo quadro**, em `fasesPico`. O consolidado de pico da rede (e de cada grupo) usa a
semana de pico de quem a informou e a semana típica das demais. Os custos do pico são mensais como os
demais, isto é, quanto custaria se a operação ficasse no pico o mês inteiro; servem para comparar
alternativas e mostrar onde a hora extra estoura o limite legal, não para orçar o período. Escolhemos uma
semana de pico, e não um calendário de sazonalidade, por ser o mínimo que responde "aguento o Natal?".

**D-34 — Agrupamento por bandeira e regional.** A unidade tem `bandeira` e `regional` opcionais (texto
livre, sem espaços nas pontas). O resultado traz um consolidado por grupo de cada tipo informado, com
as mesmas regras do consolidado da rede (D-27, D-28); unidades sem o campo formam o grupo "sem
bandeira"/"sem regional". Os grupos de um tipo somam a rede. Só dois níveis fixos, sem hierarquia.

**D-35 — Turnos que viram o dia.** Numa janela de funcionamento ou numa faixa de cobertura, fim menor
que o início significa que termina no dia seguinte (ex.: sexta 22:00–06:00). Início igual ao fim não é
aceito (24 h = 00:00–24:00). A faixa pertence ao dia em que começa. As horas de cobertura são o recorte
da faixa pelo funcionamento na **semana inteira** (domingo que vira o dia continua na segunda), então uma
faixa lançada no sábado 00:00–06:00 também conta dentro do turno que abriu na sexta 22:00. Janelas que se
sobrepõem na virada contam uma vez nas horas abertas. No CSV, o horário inferido de um dia vai do
menor início ao maior fim; se isso passar de 24 h, a importação acusa erro.

**D-36 — Diagnóstico rápido.** A página pública tem um diagnóstico de cerca de 3 minutos, sem CSV e sem
conta, em `POST /publico/diagnostico`. O formulário é montado como **uma unidade comum do motor**
(`src/lib/diagnostico.ts`), então o cálculo e as regras legais são os mesmos do simulador completo, sem
uma segunda fórmula. Premissas do formulário: mesmo horário de segunda a sexta; sábado e domingo à parte
(podem fechar ou virar o dia, D-35); as pessoas informadas trabalham ao mesmo tempo durante todo o
horário, sem picos dentro do dia; um salário médio e uma jornada para todos. Há um setor obrigatório
opcional (farmacêutico, açougue, cozinha) e, quando ele é informado, o resto da equipe vira o setor
"Demais funções" e vale a D-32. A semana de pico opcional usa um horário para todos os dias e outra
quantidade de pessoas para a equipe geral; o setor obrigatório mantém a sua. A rede é a unidade típica
× N unidades: como unidades iguais não compensam entre si (D-28), o total é exato para esse caso. O
cenário "reduzir horário" fica indisponível. As premissas são as padrão (D-10 a D-20), e a página pode
alterar perdas, encargos, adicional e margem. Nada é gravado e não há captura de contato: a rota não usa
banco e o corpo não vai para o log (D-24). O corpo é limitado a 16 KB. Não há limite de taxa porque o
cálculo é barato; se houver abuso, a saída é `@fastify/rate-limit`.

**D-37 — Página pública na raiz da UI.** `/` passou a ser a apresentação do produto (antes redirecionava
para `/painel`), e quem já tem conta usa "Entrar". As datas e jornadas da linha do tempo vêm de
`GET /publico/regras` (regra 3). Enquanto a API não responde, por exemplo quando o plano grátis acorda
o serviço, a linha do tempo não mostra números. O contato do piloto vem de `NEXT_PUBLIC_CONTATO_EMAIL`.
Sem essa variável, o botão leva ao cadastro. A página não divulga preço.
