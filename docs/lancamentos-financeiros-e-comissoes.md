# Lançamentos financeiros e comissões — mecânica interna

> **Leia antes de alterar qualquer coisa em `eventos_financeiros`, comissão ou DRE.**
> Documento de referência técnica, escrito para ser lido por quem (ou o que) vai
> modificar este subsistema. Companheiro de [`dre-como-funciona.md`](./dre-como-funciona.md),
> que explica *o que* a DRE mostra; aqui está *como* os números chegam lá.
>
> Ordens de serviço e vendas têm apuração persistida, evento e lançamento no caixa.
> A §9 descreve a comissão de vendas e o limite da apuração retroativa.

---

## 0. Invariantes — quebrar qualquer uma destas causa erro silencioso

| # | Invariante | O que quebra se violada |
|---|---|---|
| I1 | O valor **nunca** é recalculado na leitura. Toda tela lê o snapshot gravado. | Telas divergem entre si e do que o financeiro paga. |
| I2 | `chave_origem` identifica o evento dentro da OS. Mudar o formato exige **cancelar as chaves antigas** na mesma migration. | Duplicação: o evento velho fica ativo ao lado do novo. |
| I3 | `transacaoid` e `lancamento_id` são **mutuamente exclusivos** (constraint `eventos_financeiros_vinculo_unico_check`). | Duas respostas para "quem pagou esta despesa". |
| I4 | Origem nova exige **três** mudanças: `CHECK` de `origem`, `INSERT` em `dre_mapeamento`, e revisão das listas de origem no front. | O evento existe e some da DRE sem erro. |
| I5 | O fator de desconto é **idêntico** em `recalcular_comissao_osservico` e `recalcular_comissao_criacao_os`. | As duas comissões da mesma OS discordam sobre o desconto. |
| I6 | `sincronizar_eventos_financeiros_transacao` **ignora** transação com `evento_financeiro_id`, `lancamento_id` ou `ordemservicoid`. | A DRE conta o mesmo custo duas vezes. |
| I7 | Sinal por origem é **derivado do líquido**, nunca fixo por tipo. | Despesa de frete soma como receita. |
| I8 | Evento `CONVERTIDO` ou `is_manual` **não** é reescrito pela reconciliação. | Dinheiro comprometido é alterado em silêncio. |
| I9 | O título do serviço sai de `titulo_servico_os`, e a cópia em TS (`src/lib/ordens/titulo-servico.ts`) diz o mesmo. | A OS e o financeiro voltam a nomear o mesmo serviço de dois jeitos. |

---

## 1. A regra que organiza tudo

**O valor não nasce no evento financeiro. Ele é calculado e gravado num
snapshot, e o evento é uma cópia publicada desse snapshot.**

```
cadastro / orçamento  ─►  SNAPSHOT  ─►  EVENTO FINANCEIRO  ─►  TRANSAÇÃO
      (a regra)           (o valor)      (o livro / a DRE)      (o dinheiro)
```

Cada seta é um passo separado, com gatilho próprio, e cada uma pode acontecer
sem a seguinte:

- comissão **apurada sem evento** — OS ainda em orçamento, antes de `EM_ANDAMENTO`;
- evento **sem transação** — publicado no livro, esperando o financeiro lançar.

Essa separação é o que faz a Central Pessoal, o relatório de comissão, a aba da
OS e a DRE nunca divergirem (I1).

---

## 2. Tabelas

### `eventos_financeiros` — o livro, fonte da DRE

| Coluna | Papel |
|---|---|
| `origem` | `PRODUTO`, `SERVICO`, `COMISSAO`, `AVULSO`, `DESCONTO`, `FRETE`, `ENTRADA_FISCAL`, `CONSUMO` |
| `natureza` | `RECEITA` \| `DESPESA` |
| `natureza_dre` | `RECEITA` \| `DEDUCAO` \| `CUSTO` \| `DESPESA` — lido da linha mapeada |
| `status` | `ATIVO` \| `CONVERTIDO` (virou transação) \| `CANCELADO` |
| `chave_origem` | identidade do evento dentro da OS — §4 |
| `source_type` / `source_id` | `ORDEM_SERVICO` \| `VENDA` \| `TRANSACAO` \| `ENTRADA` \| `USOCONSUMO_ENTRADA` |
| `competencia_em` | mês em que o valor conta na DRE |
| `pode_gerar_transacao` | se o financeiro pode transformá-lo em título |
| `usuarioid` | dono da comissão — **filtre por aqui, não pela chave** |
| `produtoid` / `servicoid` | item que gerou |
| `transacaoid` / `lancamento_id` | vínculo com o dinheiro (I3) |
| `is_manual` | criado ou corrigido à mão; a reconciliação não o reescreve |
| `dados_snapshot` | jsonb com o memorial de cálculo |

Chave do upsert: `(ordemservicoid, origem, chave_origem, natureza)`.

### Snapshots de comissão

| Tabela | PK | Paga |
|---|---|---|
| `osservico_realizador` | `(ordemservicoid, servicoid, usuarioid)` | comissão de **realização** |
| `os_comissao_criacao` | `(ordemservicoid, tipo, item_id)` | comissão de **criação** |

`os_comissao_criacao.tipo` ∈ `SERVICO` \| `PRODUTO` \| `PRODUTO_AVULSO`;
`item_id` é `servicoid`, `produtoid` ou `osproduto_avulso.id` conforme o tipo.

### `lancamento_de_eventos` — o grupo de pagamento

N despesas quitadas por P parcelas de um boleto só. `ordemservicoid` é **nulo**
quando o boleto atravessa OSs (desde `20260904120000`). As OSs envolvidas são
derivadas dos eventos que apontam para o grupo.

---

## 3. Assinaturas (verificadas no banco)

```sql
-- apuração
recalcular_comissao_osservico(p_ordemservicoid integer, p_servicoid integer)
recarimbar_comissao_osservico(p_ordemservicoid integer, p_servicoid integer DEFAULT NULL)
recalcular_comissao_criacao_os(p_ordemservicoid integer, p_forcar boolean DEFAULT false)
recarimbar_comissao_criacao_os(p_ordemservicoid integer)
trocar_criador_os(p_ordemservicoid integer, p_usuarioid uuid) RETURNS jsonb

-- publicação no livro
reconciliar_eventos_financeiros_os(p_ordemservicoid integer, p_incluir_comissoes boolean DEFAULT false)
sincronizar_eventos_financeiros_os(p_ordemservicoid integer, p_incluir_comissoes boolean DEFAULT false)
sincronizar_eventos_financeiros_venda(p_vendaid bigint)
sincronizar_eventos_financeiros_transacao(p_transacaoid bigint)

-- dinheiro
registrar_lancamento_de_eventos(p_payload jsonb) RETURNS bigint
excluir_lancamento_de_eventos(p_id bigint, p_deleted_by uuid DEFAULT NULL)

-- DRE
natureza_dre_de_evento(p_origem text, p_natureza text) RETURNS text
formatar_percentual_comissao(p_percentual numeric)
titulo_servico_os(p_descricao_cadastro text, p_descricao_item text, p_servicoid integer) RETURNS text
```

`p_forcar` em `recalcular_comissao_criacao_os` é a única saída da guarda “OS
encerrada e nunca apurada não ganha comissão depois”. Nenhum gatilho passa
`true`; só o script de apuração retroativa, com a OS nomeada.

---

## 4. `chave_origem`

| Evento | Formato |
|---|---|
| Receita/custo de produto de catálogo | `<produtoid>` |
| Receita de produto avulso | `AVULSO:<osproduto_avulso.id>` |
| Receita de serviço | `<servicoid>` |
| Comissão de realização | `<servicoid>:<usuarioid>` |
| Comissão de criação, serviço | `CRIACAO:<usuarioid>:S<servicoid>` |
| Comissão de criação, produto | `CRIACAO:<usuarioid>:P<produtoid>` |
| Comissão de criação, avulso | `CRIACAO:<usuarioid>:A<osproduto_avulso.id>` |
| Frete / Desconto | `FRETE` / `DESCONTO` |
| Lançamento manual | `MANUAL:<uuid>` |

### O título do serviço no evento

`descricao` do evento de serviço e de comissão é **nome do cadastro + texto
livre da linha**: `Servico - REPARO - RECUPERAÇÃO DO CILINDRO DA CABINE`. Quem
monta é `titulo_servico_os(servico.descricao, osservico.descricao, servicoid)`.

O texto livre existe porque serviços guarda-chuva (`REPARO`, `SERVIÇOS
DIVERSOS`) não dizem nada sozinhos — e o nome do cadastro existe porque o texto
livre não identifica a linha do orçamento. Mostrar só um dos dois foi o que fez
a OS e o financeiro parecerem falar de serviços diferentes (`20260913120000`).

O título **não** entra na `chave_origem`: renomear o serviço ou corrigir o texto
livre reescreve a descrição na próxima reconciliação e não duplica evento (I2).

### Ciclo de `reconciliar_eventos_financeiros_os`

1. Monta `pg_temp.eventos_os_desejados` — o conjunto que *deveria* existir agora.
2. **Recusa** (`RAISE EXCEPTION`) se algum evento `CONVERTIDO` divergir do desejado.
3. `INSERT … ON CONFLICT DO UPDATE`, com `WHERE status <> 'CONVERTIDO' AND NOT is_manual` (I8).
4. **Cancela** o que está no banco e não está no desejado.

O passo 4 é a razão de I2: chave nova sem cancelar a velha deixa as duas ativas.

---

## 5. Os três tipos de comissão

| | Realização | Criação | Venda |
|---|---|---|---|
| Quem recebe | quem executou o serviço | quem abriu a OS | o vendedor |
| Coluna no cadastro | `usuario.comissao_percent` | `usuario.comissao_criacao_servico_percent` + `..._produto_percent` | `usuario.comissao_venda_percent` |
| Incide sobre | cada serviço | cada serviço **e** cada produto | itens da venda |
| Snapshot | `osservico_realizador` | `os_comissao_criacao` | `venda_comissao` |
| Vira evento | sim | sim | sim, para vendas desde setembro de 2026 |
| Congela | sim | sim | taxa e beneficiário no reconhecimento da receita |
| Granularidade do evento | 1 por (serviço, realizador) | 1 por item | 1 por venda (taxa única) |

Realização e criação **somam**: quem abre a OS e também executa um serviço dela
recebe pelas duas.

### Base líquida

```
fator = greatest(orcamentototal − valor_frete, 0) / Σ subtotais(osproduto + osproduto_avulso + osservico)
base  = subtotal_do_item × fator
```

Decidido em `20260802140000`. O frete sai da base; o desconto da OS é rateado
entre os itens **antes** do percentual. A realização ainda divide por `N`
realizadores e usa o **maior percentual do grupo** (`20260901160000`), guardando
a taxa individual em `comissao_percent_aplicada`.

> **I5**: a expressão do fator está escrita duas vezes. Ao mexer numa, mexa na
> outra. Extraí-la para uma função compartilhada é a melhoria óbvia e ainda não
> feita.

### Congelamento

Enquanto `ordemservico.execucao_fim_em IS NULL`, o percentual é relido do
cadastro a cada recálculo. Ao encerrar, o gatilho recarimba uma última vez e o
valor vira histórico.

### Casos em que não há comissão

| Situação | Resultado |
|---|---|
| `servico.gera_comissao = false` | evento publicado com **R$ 0,00** e `pode_gerar_transacao = false` — a linha zerada existe para o relatório se explicar (`20260903180000`) |
| Serviço **sem realizador** | **nenhum evento** — não há sobre o que iterar |
| OS `SEM_COBRANCA` | receita, desconto e comissão são **canceladas** (`20260904150000`); o custo do produto sobrevive |
| OS `CANCELADO` | todos os eventos `ATIVO` viram `CANCELADO` |
| Criador sem percentual | nenhuma linha em `os_comissao_criacao`, nenhum evento |

---

## 6. Mapa de gatilhos (extraído do banco)

| Tabela | Gatilho | Função |
|---|---|---|
| `ordemservico` | `trg_gerar_eventos_financeiros_os` | `tg_gerar_eventos_financeiros_os` |
| `ordemservico` | `trg_reconciliar_eventos_ao_finalizar_os` | `tg_reconciliar_eventos_ao_finalizar_os` |
| `ordemservico` | `trg_os_execucao_set_times` | `fn_os_execucao_set_times` |
| `ordemservico` | `trg_recalc_comissao_os_total` | `tg_recalc_comissao_os_total` |
| `ordemservico` | `trg_comissao_criacao_os_total` | `tg_recalc_comissao_criacao_os_total` |
| `ordemservico` | `trg_congelar_comissao_ao_encerrar_execucao` | `tg_congelar_comissao_ao_encerrar_execucao` |
| `ordemservico` | `trg_congelar_comissao_criacao` | `tg_congelar_comissao_criacao` |
| `ordemservico` | `trg_carimbar_competencia_eventos_os` | `tg_carimbar_competencia_eventos_os` |
| `osservico` | `trg_recalc_osservico_subtotal` | `tg_recalc_comissao_osservico_on_subtotal` |
| `osservico` | `trg_comissao_criacao_osservico` | `tg_recalc_comissao_criacao_por_item` |
| `osproduto` | `trg_comissao_criacao_osproduto` | `tg_recalc_comissao_criacao_por_item` |
| `osproduto_avulso` | `trg_comissao_criacao_osproduto_avulso` | `tg_recalc_comissao_criacao_por_item` |
| `osservico_realizador` | `trg_set_or_percent_before_ins` | `tg_set_comissao_percent_aplicada` |
| `osservico_realizador` | `trg_recalc_comissao_realizadores` | `tg_recalc_comissao_realizadores` |
| `osservico_realizador` | `trg_recalc_or_ins` / `trg_recalc_or_del` | `tg_recalc_comissao_osservico_realizador` |
| `transacao` | `trg_validar_transacao_evento_financeiro` | `tg_vincular_transacao_evento_financeiro` |
| `transacao` | `trg_confirmar_transacao_evento_financeiro` | `tg_confirmar_transacao_evento_financeiro` |
| `transacao` | `trg_eventos_financeiros_transacao` | `tg_eventos_financeiros_transacao` |
| `venda` | `trg_eventos_financeiros_venda` | `tg_eventos_financeiros_venda` |
| `vendaproduto` | `trg_eventos_financeiros_vendaproduto` | `tg_eventos_financeiros_vendaproduto` |

> **Redundância conhecida:** `trg_recalc_or_ins`/`trg_recalc_or_del` (do baseline)
> coexistem com `trg_recalc_comissao_realizadores` (`20260901160000`). O
> recálculo roda duas vezes em INSERT/DELETE de realizador. É idempotente, mas é
> lixo a limpar.

**`trg_congelar_comissao_*` é `AFTER UPDATE` sem lista de colunas, de propósito:**
`execucao_fim_em` é escrito por um `BEFORE` quando o `UPDATE` menciona apenas
`status`, e a cláusula `OF` olha o `SET` do comando, não o que o `BEFORE` mudou.

---

## 7. Do evento ao dinheiro

Dois caminhos, exclusivos entre si (I3):

- **Vínculo direto (1:1)**, usado por receita — `transacao.evento_financeiro_id`
  ↔ `eventos_financeiros.transacaoid`; um gatilho marca `CONVERTIDO`.
- **Vínculo por grupo (N:P)**, usado por despesa e comissão —
  `POST /api/lancamento-de-eventos` → `registrar_lancamento_de_eventos`, que numa
  transação só cria o grupo, insere as P parcelas e converte as N despesas.

O cliente manda a **seleção** e a divisão em parcelas; **o valor quem decide é o
servidor**, relendo as despesas na fonte.

Evento **lançável**:

```sql
status = 'ATIVO' AND pode_gerar_transacao
  AND transacaoid IS NULL AND lancamento_id IS NULL
```

`pode_gerar_transacao = false` marca o evento puramente econômico — custo de
produto, desconto — que existe para a DRE e nunca vira título. A fila disso é a
tela `/eventos-financeiros`.

---

## 8. DRE

`natureza_dre_de_evento(origem, natureza)` lê `dre_mapeamento` com
`origem_tipo = 'EVENTO_ORIGEM'` e `origem_valor = '<ORIGEM>:<NATUREZA>'`.

| Origem : natureza | Linha |
|---|---|
| `PRODUTO:RECEITA` | 1.1 |
| `SERVICO:RECEITA` | 1.2 |
| `FRETE:RECEITA` | 1.3 |
| `DESCONTO:DESPESA` | 2.5 |
| `PRODUTO:DESPESA` | 4.1 |
| `SERVICO:DESPESA` | 4.3 |
| `CONSUMO:DESPESA` | 4.4 |
| `COMISSAO:DESPESA` | 4.5 |
| `ENTRADA_FISCAL:DESPESA` / `:RECEITA` | 4.8 / 4.9 |
| `FRETE:DESPESA` | 4.6 |

**Por isso a comissão de criação reusou a origem `COMISSAO`** em vez de criar
`COMISSAO_CRIACAO`: economicamente é comissão, cai na mesma linha 4.5, e herdou
o mapeamento, a proibição de exclusão e o override manual que já existiam. O que
a distingue é o prefixo da chave.

**Competência:** `competencia_em` recebe `ordemservico.execucao_fim_em` — o mês
em que o trabalho terminou. Alterar evento de competência fechada é permitido; a
API devolve aviso dizendo qual período foi recalculado.

O mapeamento de `FRETE:DESPESA` foi incluído pela migração
`20260903190000_exclusao_evento_manual_e_despesa_frete.sql`.

---

## 9. Comissão de vendas — implementada

Migração `20260904180000_comissao_de_vendas.sql`.

- `venda_comissao` guarda beneficiário, base líquida, percentual, valor e congelamento.
- O beneficiário é `venda.vendedor`, com fallback para `created_by` quando não há vendedor.
- A taxa é relida do cadastro até o reconhecimento da receita. No fechamento, taxa e beneficiário ficam congelados.
- A base é `greatest(valortotal - valor_frete - sum(vendaproduto.valor_frete), 0)`. O total já contém os descontos; ambos os fretes ficam fora.
- Há uma linha por venda porque todos os produtos usam a mesma taxa. Taxas por produto exigirão outra evolução.
- A reconciliação usa a chave estável `COMISSAO_VENDA`, na mesma transação da venda, e publica `COMISSAO:DESPESA` na DRE. Comissão zerada não gera título.
- Orçamento e cancelamento retiram o evento ativo. Comissão convertida precisa ter seu lançamento desfeito antes de alterar o valor, cancelar ou excluir a venda.
- O financeiro pode reunir comissões de vendas e despesas de OS no mesmo pagamento parcelado. Grupos que incluem vendas não recebem `ordemservicoid`.
- Parcela paga impede excluir o grupo. O vínculo `lancamento_id` evita duplicar a despesa na DRE.
- A view `eventos_financeiros_fila` reúne OS válidas e comissões de vendas, com filtros por documento e totais paginados.
- Relatório por setor, rentabilidade e Central Pessoal leem o snapshot. A edição manual na fila continua restrita aos eventos de OS.

### Histórico autorizado

A integração retroativa começa em **1º de setembro de 2026, às 00:00, UTC−3**, pela competência `datavenda`. Meses anteriores recebem `integrada=false`: snapshot com a base e a taxa do relatório antigo, sem publicar despesas novas. Alterações de cadastro não recalculam esse histórico.

### Validação

`supabase/tests/comissao_de_vendas.sql` verifica beneficiário, fretes, desconto, congelamento, idempotência, fila, parcelas, comissão comprometida, baixa, exclusão e cancelamento. Executar na demonstração, com rollback.

---

## 10. Armadilhas já pagas

- **`somarEventosDaOs` é assimétrico de propósito:** `receita`/`despesa` somam
  todas as origens; os quatro subtotais contam só `PRODUTO` e `SERVICO`
  estritos. Comissão, frete, desconto e consumo entram no lucro e em nenhum dos
  quatro — quem monta cards precisa de `deducoesDaOs` para a conta fechar.
- **Produto avulso não tem `produtoid`.** Classificar comissão por essa coluna o
  joga em serviços; o vínculo dele mora na `chave_origem` (`:A<id>` ↔ `AVULSO:<id>`).
- **`execucao_fim_em` só é carimbado na entrada em `PAGAMENTO`**
  (`fn_os_execucao_set_times`). OS que vai direto para `CONCLUIDO` ou
  `SEM_COBRANCA` fica sem a data e **some de todo relatório no eixo “conclusão”**,
  inclusive os de comissão e a Central Pessoal.
- **A exigência de realizador vale só na transição para `EM_ANDAMENTO`.**
  Serviço acrescentado depois passa sem realizador, e a comissão não existe —
  nem zerada.
- **Comissão é a única despesa automática que aceita correção à mão**
  (`comissao_ajustada_a_mao`); a correção marca `is_manual` e a reconciliação
  para de reescrever a linha (I8).
- **Evento `COMISSAO` nunca pode ser excluído** — `exclusao-evento-financeiro.ts`
  e `excluir_evento_financeiro_manual_os`.
- **Ordem de exibição:** a receita abre o bloco, as despesas vêm sob ela, a
  comissão fecha — igual em produto e em serviço (`ordemNoGrupo`). Produto já foi
  ao contrário; foi alinhado quando a comissão passou a incidir sobre produto.
- **Nunca troque o criador com UPDATE em `usuariocriadorid`.** Nenhum gatilho
  olha a coluna, e o snapshot carimba o dono na primeira apuração: a comissão
  ficaria com quem saiu, e OS encerrada e nunca apurada ficaria sem comissão. A
  troca é `trocar_criador_os` (`20260917100000`), chamada pelo card "Criado por"
  dos detalhes da OS com a permissão `ordens:alterar_criador`. Ela reapura pela
  taxa de quem entrou — a regra da venda (`20260909125000`) —, republica os
  eventos quando a OS já os tem e recusa OS cancelada e comissão de criação já
  lançada ou corrigida à mão.
- **Comissão de criação não sai ao iniciar a OS.** `sincronizar_eventos_financeiros_os`
  (gatilho de `EM_ANDAMENTO`) publica só a de realização; a de criação entra pela
  reconciliação — orçamento salvo em execução, realizador atribuído ou `PAGAMENTO`.
- **Reiniciar a OS desfaz a conclusão, não os eventos** (`20260916180000`).
  Voltar a qualquer status anterior à execução apaga `execucao_fim_em`, e a
  competência dos eventos sai junto — a DRE para de somá-los. Eles continuam
  `ATIVO`, comissão inclusive: cancelar abriria um buraco, porque voltar a
  `EM_ANDAMENTO` publica com `sincronizar_eventos_financeiros_os`, que não
  reativa evento cancelado. Consequência aceita: a comissão da OS reiniciada
  segue lançável na fila, que não filtra pelo status da OS.

---

## 11. Mapa dos arquivos

| Caminho | O quê |
|---|---|
| `supabase/migrations/20260802*` | DRE: template, linhas, mapeamento, competência |
| `…/20260802190000_dre_eventos_de_venda.sql` | eventos da venda |
| `…/20260825140000_boleto_de_despesas_da_os.sql` | `lancamento_de_eventos` |
| `…/20260901160000`, `…/20260903160000` | maior percentual, congelamento |
| `…/20260903180000` | comissão zerada consta no histórico |
| `…/20260904120000` | lançamento multi-OS |
| `…/20260904130000`, `140000`, `150000` | comissão de criação (base, `p_forcar`, por item) |
| `…/20260917100000_trocar_criador_os.sql` | troca do criador com a comissão de criação |
| `src/app/api/ordens/[id]/criador/route.ts` | prévia e troca do criador (`ordens:alterar_criador`) |
| `src/lib/ordens/eventos-financeiros.ts` | leitura, ordenação, somas — **fonte única** |
| `src/lib/ordens/comissoes-de-servico.ts` | relatórios de comissão |
| `src/lib/meu-perfil/regras.ts` | recorte de período e status (compartilhado) |
| `src/app/api/ordens/[id]/eventos-financeiros/_lib/servico.ts` | regra das rotas de evento |
| `src/app/api/lancamento-de-eventos/route.ts` | lançar despesas no financeiro |
| `src/components/financeiro/eventos-financeiros/` | painel compartilhado OS ↔ financeiro |
| `scripts/db/simular-comissao-criacao.ts` | simulação somente leitura |
| `scripts/migracao/demir-comissao-criacao-retroativa.ts` | apuração retroativa, com `--aplicar` |
| `scripts/migracao/demir-trocar-criador-os.ts` | troca o criador de várias OS via `trocar_criador_os`, com antes e depois e `--aplicar` |
| `supabase/tests/comissao_*.sql` | testes das regras de comissão |
