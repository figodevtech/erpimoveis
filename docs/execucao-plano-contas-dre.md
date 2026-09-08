# Registro de execução — plano de contas dinâmico e classificação da DRE

Acompanha [o plano](plano-execucao-plano-contas-dinamico-dre.md). Cada seção
registra o que foi feito, com que evidência, e o que continua pendente.

**Entrega A concluída no repositório e publicada somente na Demonstração.** Demir,
AlphaGarage e Garage Premium continuam em `20260905110000`: publicar neles exige
o cuidado da seção 17.1 do plano, porque o comando de deploy dos clientes levaria
junto a migration `20260907100000` da Stone, que está adiada.

Os quatro bancos seguem em modo `LEGADO`: a DRE continua sendo apurada
exatamente como antes. O classificador novo está instalado e conferido na
Demonstração, e não ativado em lugar nenhum.

## Fase 0 — inventário e catálogo — concluída em 07/09/2026

### O que foi feito

| Item | Resultado |
|---|---|
| Inventário somente leitura dos quatro bancos | `npm run db:inventario:dre` — [script](../scripts/db/inventario-plano-contas-dre.ts) |
| Baseline da DRE por mês, com pendências e exclusões | 13 meses, limites UTC, no artefato do inventário |
| Conferência do histórico de migrations e da situação Stone | Demonstração em `20260907100000`; Demir, AlphaGarage e Garage Premium em `20260905110000`. Diferença intencional, confirmada |
| Catálogo materializado | [`catalogo.ts`](../src/lib/financeiro/plano-contas/catalogo.ts) — 37 classificações, 23 grupos padrão, 42 contas padrão |
| Contas ambíguas identificadas | [`sugestao.ts`](../src/lib/financeiro/plano-contas/sugestao.ts) + `npm run db:simular:plano-contas` |

Os artefatos (`artifacts/captures/dre-plano-contas/`) ficam fora do Git: carregam
nomes de conta e valores dos clientes. O inventário e a simulação gravam um hash
próprio, para que uma decisão possa citar a versão exata que a originou.

### O que o inventário encontrou

Cadastro em 07/09/2026, confirmando os números da revisão:

| Banco | Grupos | Contas | Mapeamentos ativos | Grupos ativos sem destino |
|---|---:|---:|---:|---:|
| Demonstração | 15 | 197 | 25 | 1 (“Despesas comerciais”) |
| Demir | 9 | 108 | 20 | 0 |
| AlphaGarage | 0 | 0 | 11 | 0 |
| Garage Premium | 16 | 103 | 26 | 1 (“EQUIPAMENTOS DE SEGURANÇA”) |

As seis funções de classificação têm hash idêntico nos quatro bancos. A
divergência de DRE entre oficinas é de cadastro, não de código — o que valida a
premissa do plano.

Cobertura na janela de 13 meses:

| Banco | Eventos sem destino | Valor | Natureza incompatível | Valor | Transações sem evento |
|---|---:|---:|---:|---:|---:|
| Demonstração | 4 | 2.457,60 | 4 | 866,66 | 35 |
| Demir | 6 | 17.370,00 | 0 | 0,00 | 1.095 |
| AlphaGarage | 0 | 0,00 | 0 | 0,00 | 14 |
| Garage Premium | 14 | 26.140,64 | 0 | 0,00 | 191 |

Nenhum mapeamento órfão, nenhum com rateio diferente de 100%, nenhum com
vigência e nenhuma origem com mais de um destino ativo. `PLANO_CONTA` e
`CATEGORIA_TRANSACAO` não são usados por nenhum banco: só existem mapeamentos
`PLANO_GRUPO` e `EVENTO_ORIGEM`. Isso reduz a migração da Entrega A, mas não
dispensa a validação — o banco continua aceitando os outros tipos.

### Simulação da classificação

`npm run db:simular:plano-contas` aplica o catálogo aos cadastros existentes:

| Banco | Contas | Preserva | Corrige | Pendente |
|---|---:|---:|---:|---:|
| Demonstração | 197 | 114 | 64 | 19 |
| Demir | 108 | 58 | 39 | 11 |
| AlphaGarage | 0 | 0 | 0 | 0 |
| Garage Premium | 103 | 67 | 26 | 10 |

“Corrige” muda o destino atual e exige decisão registrada. As correções que já
têm lançamentos estão concentradas no Demir — 31 contas — e as maiores são:

| Transações | Hoje | Proposta | Conta |
|---:|---|---|---|
| 247 | 4.3 | 4.1 | Compra de peças para revenda |
| 170 | 1.2 | 1.1 | Venda de peças |
| 98 | 4.3 | 4.4 | Materiais aplicados nos serviços |
| 96 | 4.3 | 4.6 | Serviços terceirizados |
| 52 | 6.6 | 6.5 | Sistemas e softwares |
| 8 | 2.1 | 6.2 | Taxas municipais e alvarás |
| 3 | 2.1 | 13.1 | IRPJ |
| 2 | 2.1 | 13.2 | CSLL |

IRPJ e CSLL saindo de dedução da receita para tributo sobre o lucro é a correção
que a revisão apontou. Ela muda receita líquida e margens intermediárias; o
resultado líquido final não muda, porque o valor continua sendo subtraído uma
única vez.

### Contas que permanecem pendentes, por decisão

Não foram classificadas automaticamente. Cada uma precisa de resposta de quem
conhece o lançamento:

| Banco | Transações | Conta | Por quê |
|---|---:|---|---|
| Demir | 90 | Despesas não identificadas | A conta declara que a natureza é desconhecida. Hoje está fora do resultado; nem excluir nem lançar como despesa é defensável sem identificar |
| Demir | 22 | Venda de ativo imobilizado | Hoje soma R$ 336.000,00 em receita financeira. O preço recebido não é o ganho: falta o valor contábil do bem (CPC 27, 67–71) |
| Demir | 9 | Transferência entre empresas do mesmo grupo | Entre pessoas jurídicas distintas não é transferência interna |
| Demir | 7 | Devolução | Está em “Custos diretos”: não diz se é devolução de venda ou de compra |
| Demir | 4 | Estornos e ajustes financeiros | Estorno acompanha a classificação do fato original |
| Demir | 3 | Estorno de Antecipação | Idem: depende do lançamento revertido |
| Demir | 2 | Consórcios | A parcela mistura poupança, taxa de administração e seguro |
| Demir / Garage | 1 / 2 | Outros impostos e taxas | Rótulo genérico: pode ser tributo sobre receita, taxa administrativa ou tributo sobre lucro |

Também ficam pendentes, sem lançamentos hoje: “Comissões sobre vendas” e “Taxas
de cartão sobre vendas” (hoje deduzem receita), INSS, ICMS-ST, multas e juros
tributários, parcelamentos tributários, depreciação em grupo excluído, reembolsos
e receitas não operacionais.

### Tipos de ajuste inventariados (insumo da Entrega B)

| Código | Natureza | Usos | Valor |
|---|---|---:|---:|
| JUROS | ACRESCIMO | 92 | 4.398,13 |
| TAXA_RECEBIMENTO | DESCONTO | 62 | 5.750,29 |
| MULTA | ACRESCIMO | 35 | 1.868,29 |
| TAXA_ANTECIPACAO | DESCONTO | 12 | 13.000,89 |
| OUTRO_ACRESCIMO | ACRESCIMO | 10 | 25,72 |
| IMPOSTOS | ACRESCIMO | 10 | 884,97 |
| OUTRO_DESCONTO | DESCONTO | 4 | 31.407,08 |
| DESCONTO_COMERCIAL | DESCONTO | 2 | 7,00 |
| IMPOSTOS_DESCONTO | DESCONTO | 1 | 248,16 |

Nenhum deles gera evento de DRE hoje. `OUTRO_DESCONTO`, com 4 usos e R$
31.407,08, é o que mais precisa de definição antes da Entrega B: o nome não diz
o efeito contábil.

## Fase 1 — schema e catálogo — publicada na Demonstração em 07/09/2026

Migration: [`20260908100000_classificacao_resultado_catalogo.sql`](../supabase/migrations/20260908100000_classificacao_resultado_catalogo.sql).

Cria `classificacoes_resultado`, `plano_contas_classificacao_regra`,
`eventos_financeiros_classificacao` e `dre_implantacao`; acrescenta
`classificacao_resultado_id` e a origem `CLASSIFICACAO_RESULTADO` a
`dre_mapeamento`; acrescenta `codigo_sistema`, `origem_cadastro`, classificação
e `versao_registro` a grupos e contas; semeia as 37 classificações e seus
destinos.

Não classifica cadastro nenhum, não altera mapeamento existente e não toca em
`eventos_financeiros.dre_linha_id`. A instalação existente nasce em `LEGADO`.

### Validação

`npm run db:test:classificacao-resultado -- <banco>` aplica a migration, reaplica,
roda [as verificações](../supabase/tests/classificacao_resultado_catalogo.sql) e
reverte. Executado em 07/09/2026 nos quatro bancos, todos com o mesmo resultado:

- migration aplicada e reaplicada sem duplicar o catálogo;
- soma de todas as linhas da DRE idêntica antes e depois — o critério de saída
  da Fase 1;
- guardas exercitadas: coerência do catálogo, mapeamento por classificação,
  sobreposição de vigência, revisão vigente única por evento, registro único de
  implantação e recusa de ativação sem vigência.

Também passaram `npm run test:negocio` (1103 testes) e `npx tsc --noEmit`.

### Publicação na Demonstração

`npm run db:deploy:demo` em 07/09/2026, com dry-run antes. Era a única migration
pendente lá — a Demonstração já estava em `20260907100000`, então nada de Stone
foi publicado junto.

Conferência depois de aplicar, em transação somente leitura:

- as quatro tabelas novas existem;
- catálogo com 32 classificações de resultado e 5 patrimoniais, cada uma com
  destino ou exclusão (`CLASSIFICACAO_RESULTADO` = 37 mapeamentos, 5 exclusões);
- linhas 11.1 (sinal +1) e 11.2 (sinal −1) sob o grupo 11;
- `dre_implantacao` em `LEGADO`, sem vigência;
- as 197 contas continuam `PERSONALIZADO`, sem chave de sistema e sem
  classificação — nenhum cadastro foi tocado;
- baseline mensal da DRE reexecutado e comparado ao capturado antes da
  publicação: **idêntico**, linha a linha, valor e contagem.

### Duas decisões técnicas divergentes da letra do plano

**1. As linhas 11.1 e 11.2 entram no template existente, não numa versão nova.**
O plano pede versão nova (seção 5). A migration `20260828100000` já resolveu o
mesmo problema com 4.8/4.9 e documentou por quê: `dre_linha` é única por
(template, código) e a árvore se monta por `parent_id`, então acrescentar linha
é dado, não código. A linha 11 hoje é um GRUPO sem filhos e sem mapeamento —
vale zero nos quatro bancos —, então dois filhos novos não mudam total nenhum
até alguém classificar algo neles. O teste de baseline comprova isso. Uma versão
nova de template exigiria correspondência explícita de linhas entre versões para
comparar períodos, complicando a Fase 6 sem resolver problema real.

**2. As deduções comerciais compartilham um grupo padrão.** O plano sugere um
grupo por linha (devoluções, cancelamentos, abatimentos, descontos). O catálogo
usa um grupo `GRP_DEDUCAO_COMERCIAL` com classificação padrão de desconto e
contas de exceção para as demais — todas na mesma família `DEDUCAO`, como a
regra de compatibilidade exige. Quatro grupos com uma conta cada aumentariam a
tela sem aumentar a precisão.

## Fase 2 — resolvedor canônico — publicada na Demonstração em 07/09/2026

Migration: [`20260908110000_resolvedor_classificacao_dre.sql`](../supabase/migrations/20260908110000_resolvedor_classificacao_dre.sql).

### O que ela cria

| Função | Papel |
|---|---|
| `dre_classificacao_do_cadastro(conta, grupo, competência)` | Precedência: regra da conta, regra do grupo, exceção da conta, padrão do grupo |
| `dre_destino_da_classificacao(template, classificação)` | Linha ou exclusão. Mais de um destino ativo é erro, não `LIMIT 1` |
| `dre_resolver_evento(evento, template)` | Origem automática → conta → grupo → `PENDENTE` com motivo |
| `dre_gravar_classificacao_evento(...)` | Grava a revisão vigente e a projeção `dre_linha_id` na mesma operação |
| `dre_congelar_classificacao_legado(template, lote)` | Congela em dado a resolução que a DRE já usa, em lotes retomáveis |
| `dre_linha_do_evento(evento, template, estado, vigência)` | **Uma** resolução para soma, detalhamento e badge |
| `dre_modo_apuracao()` | Estado e vigência; aborta se não houver configuração |
| `dre_previa_da_conta(conta, natureza, competência)` | Explica o destino sem gravar |

As 11 origens automáticas de evento passaram a ter chave do catálogo, cada uma
apontando para a mesma linha que já usava. A migração aborta se alguma
divergisse.

`dre_somar_por_linha`, `dre_lancamentos_por_linha` e `dre_linha_da_transacao`
deixaram de repetir a expressão de resolução e passaram a chamar
`dre_linha_do_evento`. Eram três cópias da mesma regra; quando cópias divergem,
o drill-down deixa de fechar com o total e não há como saber qual está certo.

### Dois defeitos que a validação nos clientes encontrou

**1. Ativar com o congelamento incompleto derrubava o total sem avisar.** No
Demir, congelar só o primeiro lote e ativar em seguida levou o período de
R$ 2.700.822,32 para R$ 1.323.768,53 — sem erro na tela. Em `ATIVO`, um evento
elegível sem revisão vigente não resolve para linha nenhuma e desaparece da
soma.

A correção não foi ajustar o teste. Um gatilho em `dre_implantacao` passa a
recusar `ATIVO` enquanto existir evento elegível a partir da vigência sem
classificação vigente, dizendo quantos faltam. Congelar tudo deixou de ser
disciplina de quem implanta e virou condição verificada pelo banco.

**2. A verificação de idempotência do congelamento estava errada.** No Garage,
com mais de 500 eventos, o segundo lote processava legitimamente o resto e o
teste acusava repetição. O teste agora roda o congelamento até zerar, confere
que nenhum evento elegível sobrou e que nenhum evento tem duas revisões
vigentes.

### Validação

`npm run db:test:resolvedor-dre -- <banco>`, nos quatro bancos, em transação
revertida. Aplica as duas migrations da Entrega A — os clientes ainda não têm a
da Fase 1 — e verifica:

- em `LEGADO`, a DRE não muda: soma linha a linha idêntica, com valor e
  contagem, sobre todo o histórico;
- o detalhamento fecha com a soma, linha a linha, depois de unificar a
  resolução;
- precedência: exceção da conta vence o grupo; regra vigente vence o cadastro;
  vigência com fim exclusivo não cobre o dia do fim;
- natureza incompatível vira `PENDENTE` com motivo, nunca linha — despesa em
  conta de receita não soma receita;
- conta patrimonial vira `EXCLUIDO` com motivo, diferente de pendência;
- origem automática vence o cadastro: receber não reclassifica a receita da OS;
- gravar a revisão atualiza a projeção `dre_linha_id` na mesma operação, e
  regravar preserva a anterior encadeada;
- congelamento retomável, sem repetir, sem alterar valor nem competência;
- **com tudo congelado, ativar com vigência no meio do mês não muda o total**,
  nem do mês nem do histórico inteiro — no Demir, sobre R$ 2,7 milhões reais;
- sem registro de implantação a soma aborta, em vez de assumir legado.

Também passaram `npm run test:negocio` (1103 testes), `npx tsc --noEmit` e
`eslint`.

### O que a Fase 2 deixa em aberto

- **Concorrência entre sessões não foi exercitada.** As guardas existem — lock
  consultivo por entidade na regra de vigência, `FOR UPDATE` no evento ao gravar
  a revisão, `versao_registro` no cadastro —, mas provar o comportamento com duas
  sessões exige fixtures comprometidas em banco compartilhado. Fica para a Fase
  3, junto com os caminhos de escrita.
- **`ATIVO` ainda não é seguro para uso.** Um evento criado depois da ativação
  só entra na soma quando alguma operação gravar sua revisão; isso é a
  integração de gravação da Fase 3. O gatilho impede ativar com histórico
  incompleto, não com escrita futura desintegrada. Os quatro bancos seguem em
  `LEGADO`.

## Fase 3 — cadastro e operações diárias — publicada na Demonstração em 07/09/2026

Migration: [`20260908120000_cadastro_classificacao_atomico.sql`](../supabase/migrations/20260908120000_cadastro_classificacao_atomico.sql).

### Gravação atômica

`plano_contas_salvar_grupo` e `plano_contas_salvar_conta` gravam o cadastro, a
classificação e a regra de vigência numa transação só, com concorrência
otimista por `versao_registro`. Em chamadas REST separadas, uma falha no meio
deixaria o cadastro dizendo uma coisa e o histórico outra — e é o histórico que
resolve uma competência passada.

Duas famílias de erro têm SQLSTATE próprio, para a rota não adivinhar pela
mensagem: `PT409` (alguém salvou antes) e `PT422` (classificação
semanticamente incompatível).

O que as RPCs recusam: versão desatualizada; exceção de conta em família
diferente da do grupo; inativar grupo com conta ativa; mudar a finalidade de um
grupo ou conta do sistema; vigência nova começando antes de uma regra já
registrada. Renomear não abre regra nenhuma — nome é apresentação.

### Bloqueio de gravação

Um gatilho em `transacao` recusa lançamento cuja natureza a classificação da
conta não aceita. Vale **apenas em `ATIVO`**: em `LEGADO` os cadastros ainda não
foram migrados, e bloquear agora recusaria lançamento que o financeiro faz todo
dia sem melhorar número nenhum. `SAQUE` e `DEPOSITO` são tesouraria e não têm
natureza de resultado a conferir.

### Um defeito que a validação encontrou

A guarda de escrita lia `dre_implantacao` direto. Num banco sem o registro, a
leitura devolvia `NULL`, a guarda concluía "não é ATIVO" e deixava passar —
falta de configuração virava decisão, exatamente o que a seção 12 do plano
proíbe. Passou a usar `dre_modo_apuracao()`, que aborta.

O defeito apareceu porque os arquivos de verificação compartilham a transação e
o teste da Fase 2 termina apagando o registro para provar que a soma aborta. Ele
agora restaura o registro antes de sair.

### Telas e rotas

| Rota | O que mudou |
|---|---|
| `GET /api/tipos/planos-de-conta` | Aditiva: origem do cadastro, classificação herdada ou de exceção, destino na DRE, versão do registro, contagem de lançamentos |
| `POST`/`PUT`/`PATCH` de contas e grupos | Passam pelas RPCs; exigem `configuracoes:editar`; devolvem 409 e 422 com a mensagem do banco |
| `DELETE` de conta | Recusa conta com lançamentos. A FK é `ON DELETE SET NULL`: apagar uma conta usada não dava erro, deixava os lançamentos órfãos e sem aviso |
| `GET /api/tipos/classificacoes-resultado` | Catálogo, com o destino de cada chave |
| `POST /api/dre/classificacao/preview` | Explica o destino sem gravar, pela mesma resolução da soma |

A resolução exibida vem de `plano_contas_visao`, que usa
`dre_classificacao_do_cadastro` — a mesma função da soma. Montar a explicação na
aplicação criaria uma segunda regra, e a tela poderia prometer uma linha que a
DRE não usa.

Na tela de Configurações → Tipos: badges de Sistema, Herdada e Exceção; o
destino na DRE em cada conta e em cada grupo; motivo quando fica fora; filtros
por classificação, origem e status; classificação padrão no formulário de grupo
e exceção no de conta, com as opções restritas à família do grupo; campo "vale a
partir de" explicando que competências anteriores mantêm o destino atual. Um
409 recarrega a lista em vez de gravar por cima do que a outra pessoa decidiu.

No seletor do financeiro: o destino aparece sob a conta selecionada e em cada
opção; com a natureza do lançamento informada, a conta incompatível fica
desabilitada com o motivo. A rota e o banco repetem a validação, porque esta
tela não é a única forma de gravar.

### Banco sem as migrations

As rotas passaram a reconhecer `42883`, `PGRST202` e `42P01` e responder 503 com
"publique o schema antes de usar esta tela", em vez de um 500 genérico. **O
código desta fase exige as migrations das Fases 1 a 3 publicadas**; sem elas a
tela de planos de conta não funciona.

### Validação

`npm run db:test:resolvedor-dre -- <banco>` nos quatro bancos, com rollback,
agora incluindo a Fase 3. Além do que a Fase 2 já cobria:

- criar grupo e conta pela oficina, com classificação e regra abertas juntas;
- conta sem exceção não abre regra própria e herda o grupo;
- exceção de outra família recusada;
- renomear não abre regra e avança a versão;
- gravar com versão antiga recusado;
- trocar a classificação do grupo fecha a regra anterior com fim exclusivo e a
  competência anterior continua no destino antigo;
- vigência retroativa por cima de regra existente recusada;
- inativar grupo com contas ativas recusado; grupo do sistema não muda de
  finalidade, mas continua podendo ser renomeado;
- em `LEGADO` a gravação incompatível passa; em `ATIVO` é recusada, e receita na
  mesma conta continua passando;
- a visão da tela devolve o mesmo destino que a soma, com origem da herança,
  motivo da exclusão e contagem de lançamentos.

Também passaram `npm run test:negocio` (1112 testes), `npx tsc --noEmit`,
`eslint` e `npm run build`.

## Fase 4 — pendências, simulação e migração — publicada na Demonstração em 07/09/2026

Migration: [`20260908130000_pendencias_e_migracao_classificacao.sql`](../supabase/migrations/20260908130000_pendencias_e_migracao_classificacao.sql).

### Fila de integridade

`dre_pendencias(de, ate)` devolve, por motivo, **quantidade e valor**. "12
lançamentos sem classificação" não diz se o problema vale R$ 300 ou R$ 300.000,
e a decisão de resolver agora ou depois depende disso.

Sete motivos, separados por escopo: `GRUPO_SEM_DESTINO` e `CONTA_SEM_REGRA` são
de cadastro e não dependem do período; `EVENTO_SEM_LINHA`,
`NATUREZA_INCOMPATIVEL`, `TRANSACAO_SEM_EVENTO` e `EXCLUSAO_NAO_REVISADA` são do
período; `EVENTO_SEM_COMPETENCIA` é geral, porque um lançamento sem competência
não aparece na DRE de mês nenhum.

`dre_pendencias_itens(motivo, …)` abre cada motivo, paginado. Motivo
desconhecido **aborta** em vez de devolver lista vazia: zero de um motivo
inexistente faria a tela dizer "sem pendências".

Na tela da DRE, o aviso passou a mostrar o valor sem classificação e uma tabela
por motivo. E `alertas` agora distingue `null` de `0`: antes, `count ?? 0`
transformava falha de consulta em "nenhuma pendência" — parecia completude e era
ignorância.

### Lote de migração

`plano_contas_lote` guarda a proposta antes de aplicar, com a versão de cada
cadastro no momento da simulação. `plano_contas_aplicar_lote` aplica **por
unidade**:

- item já aplicado é pulado — reexecutar não repete;
- cadastro alterado desde a simulação vira `CONFLITO` e **não** é sobrescrito;
- unidade que falha vira `ERRO` com o motivo e não derruba as outras — sem isso,
  um cadastro estranho impediria a migração inteira e ninguém saberia qual era;
- o lote só fica `APLICADO` quando não sobra unidade pendente.

`plano_contas_instalar_padrao` instala grupos e contas do catálogo, idempotente
por `codigo_sistema`. Colisão de código visual resolve com um código livre;
colisão de **nome** vira aviso para revisão humana, nunca vínculo automático.

O catálogo vem do repositório como JSON, de
[`catalogo.ts`](../src/lib/financeiro/plano-contas/catalogo.ts). Repetir a lista
no SQL criaria duas fontes que divergiriam na primeira revisão.

### Migração executada na Demonstração

`npm run db:migrar:plano-contas -- demo` (simulação, sem `--aplicar`):

| | |
|---|---:|
| Cadastros analisados | 212 |
| Certeza alta, no lote | 178 |
| Precisam de decisão | 34 |
| Dessas, já com lançamentos | 1 |

O único caso com lançamentos é o grupo "Receitas" (39 lançamentos, hoje na linha
1.2). A sugestão por nome do grupo é de certeza média — confirmar que todas as
contas dele são serviço é decisão de quem conhece o cadastro, não de uma regra
de palavra-chave. Foi exatamente esse tipo de regra que levou IRPJ e CSLL para
dedução da receita.

O lote 1 ficou gravado como `SIMULADO`. **Nenhum cadastro foi classificado.**

### Fila real da Demonstração, agosto/2026

| Motivo | Escopo | Itens | Valor |
|---|---|---:|---:|
| GRUPO_SEM_DESTINO | cadastro | 1 | — |
| CONTA_SEM_REGRA | cadastro | 197 | — |
| EVENTO_SEM_COMPETENCIA | geral | 8 | R$ 1.694,00 |
| NATUREZA_INCOMPATIVEL | período | 3 | R$ 766,66 |
| TRANSACAO_SEM_EVENTO | período | 20 | R$ 13.776,38 |

Os 3 lançamentos de R$ 766,66 em natureza incompatível são exatamente os que a
revisão de 07/09/2026 tinha encontrado à mão. `CONTA_SEM_REGRA` = 197 é o
esperado: o lote está simulado, não aplicado.

### Validação

`npm run db:test:resolvedor-dre -- <banco>` nos quatro bancos, com rollback,
cobrindo as quatro fases. Da Fase 4:

- grupo e conta sem classificação aparecem na fila, com escopo de cadastro,
  antes de existir lançamento;
- lançamento sem destino aparece com **valor**, não só com contagem;
- evento sem competência aparece em escopo geral;
- motivo desconhecido aborta;
- aplicar o lote classifica o cadastro e **não muda a DRE do passado**, porque a
  vigência começa depois;
- reaplicar não repete; versão desatualizada vira conflito sem sobrescrever;
  uma unidade com erro não derruba as outras;
- instalar o catálogo cria grupo e conta como `SISTEMA`, reinstalar não duplica,
  e nome já existente vira aviso.

Também passaram `npm run test:negocio` (1115 testes), `npx tsc --noEmit`,
`eslint` e `npm run build`.

### Um defeito que a publicação expôs

Depois de publicar, o runner de validação passou a falhar na Demonstração com
`dre_mapeamento_classificacao_coerencia_check is violated by some row`. Ele
reaplicava as quatro migrations em sequência; a da Fase 1 recria a restrição de
coerência na forma estrita, e a da Fase 2 já havia preenchido
`classificacao_resultado_id` nas origens automáticas de evento — a restrição
estrita passava a ser violada pelas próprias linhas que a Fase 2 gravou.

Num deploy real isso não acontece: cada migration roda uma vez. O erro era do
runner, que precisava respeitar a mesma regra. Ele passou a consultar
`supabase_migrations.schema_migrations` e aplicar só o que estiver pendente. Nos
clientes aplica as quatro; na Demonstração, nenhuma, e roda apenas as
verificações contra o schema publicado.

Editar a migration da Fase 1 seria a outra saída, e é a errada: ela já está
publicada, e a seção 17.1 do plano proíbe mexer em migration publicada.

### Publicação

`npm run db:deploy:demo` publicou `20260908110000`, `20260908120000` e
`20260908130000` na Demonstração. Conferência depois: baseline mensal da DRE
reexecutado e **idêntico**, linha a linha, ao capturado antes.

Os clientes continuam em `20260905110000`. `npm run db:deploy:clients` aplicaria
junto a `20260907100000` da Stone, que está adiada — confirmado pela conferência
de pendentes: os três clientes têm a migration Stone na fila.

## Pendente

- Publicar a Fase 1 nos clientes. **Cuidado da seção 17.1 do plano:** `npm run
  db:deploy` e `db:deploy:clients` aplicam todas as migrations pendentes; nos
  clientes isso publicaria junto a `20260907100000` da Stone, que está adiada.
- Publicar a Entrega A nos clientes, com o conjunto de migrations revisado da
  seção 17.1 — sem levar junto a Stone. O código depende delas: sem as
  migrations, a tela de planos de conta responde 503.
- Decidir as 34 propostas de certeza média ou baixa da Demonstração e aplicar o
  lote 1.
- Entrega B (Fase 5) e Entrega C (Fases 6 e 7).
- Decisões de negócio das contas pendentes listadas acima.

## Registro por entrega

| Entrega | Revisão/PR | Migrações | Validações | Demonstração | Clientes | Pendências |
|---|---|---|---|---|---|---|
| A — cadastro e classificação | — | `20260908100000` a `20260908130000` | Fases 0 a 4 validadas nos 4 bancos com rollback; DRE conferida antes e depois de cada publicação | Publicada 07/09/2026 | Não publicada (Stone adiada) | Lote 1 simulado, aguardando decisão |
| B — ajustes e deduções | — | — | Tipos de ajuste inventariados | — | — | Não iniciada |
| C — histórico e relatórios | — | — | — | — | — | Não iniciada |
