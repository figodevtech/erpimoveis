# Conciliação bancária por importação de OFX

> **IMPORTANTE:** antes de alterar o parser, o fingerprint, o matcher, as RPCs
> ou as rotas deste módulo, leia este documento inteiro. Depois de qualquer
> mudança funcional, estrutural ou de regra, atualize este arquivo no mesmo
> conjunto de alterações.
>
> Este arquivo descreve **o que existe**. A especificação original que originou
> o módulo está ao lado, em [`modolo_importacao_ofx.md`](./modolo_importacao_ofx.md),
> e serve como histórico de intenção — onde os dois divergirem, vale este.

---

## 1. O que o módulo faz

Lê o arquivo `.ofx` do extrato de uma conta bancária e compara cada linha dele
com o financeiro do ERP, para responder uma pergunta por movimento:

> este dinheiro já está registrado no sistema, ou falta registrar?

Importar **não** é criar uma transação por linha do extrato. Para cada movimento
há quatro saídas possíveis, e a decisão é do usuário:

| Saída | O que acontece no financeiro |
|---|---|
| **Vincular** | Nada é criado. O movimento aponta para uma transação que já está no Fluxo de Caixa. |
| **Liquidar** | Um título em aberto recebe baixa (integral ou parcial) pela RPC de baixa que já existia. |
| **Criar** | Uma transação liquidada nova é inserida, com a conta e a data do extrato. |
| **Ignorar** | Nada acontece no financeiro. Fica registrado que a linha foi vista e dispensada. |

### O que o módulo NÃO faz

- Não altera nenhuma regra financeira existente (DRE, adiantamento, pagamento
  múltiplo, transferência, baixa parcial, `recebimento_por_documento`).
- Não reimplementa baixa: chama `baixar_transacao_pendente`.
- Não decide sozinho. Toda conciliação passa por confirmação humana.
- Não concilia automaticamente na análise — ler o arquivo não escreve nada.

---

## 2. Vocabulário

| Termo | Significado neste módulo |
|---|---|
| **Extrato** | O arquivo OFX inteiro: cabeçalho da conta, período, saldo e movimentos. |
| **Movimento** | Uma linha `<STMTTRN>` do extrato. É o que o banco diz que aconteceu. |
| **Título** | Uma `transacao` com `pendente = true`: conta a pagar ou a receber. |
| **Movimento de caixa** | Uma `transacao` com `pendente = false` **e** `banco_id` preenchido. É o que aparece no Fluxo. |
| **Fingerprint** | A identidade determinística de um movimento. Ver §5. |
| **Conciliar** | Ligar um movimento do extrato ao movimento de caixa que o representa. |

Cuidado com uma armadilha de vocabulário: **título e movimento de caixa nem
sempre são a mesma linha**. Numa baixa integral, o próprio título vira o
movimento de caixa. Numa baixa parcial, o título continua aberto e quem carrega
o dinheiro é uma transação **filha** (`baixa_de_transacao_id`). O módulo aponta
`transacao_id` para o dinheiro e `titulo_origem_id` para o título.

---

## 3. Mapa dos arquivos

### Domínio — puro, sem React e sem Supabase

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/financeiro/ofx/types.ts` | Formas do extrato lido e `ErroDeOfx`. |
| `src/lib/financeiro/ofx/normalize.ts` | Texto, data, dinheiro em centavos, similaridade. |
| `src/lib/financeiro/ofx/parser.ts` | Lê OFXSGML 1.x e OFX 2.x (XML). Deduz saldo inicial. |
| `src/lib/financeiro/ofx/fingerprint.ts` | Identidade do movimento e hash do arquivo. |
| `src/lib/financeiro/ofx/payment-method.ts` | Sugestão de forma de pagamento pelo texto. |
| `src/lib/financeiro/ofx/matcher.ts` | **A regra de negócio da comparação.** Score e classificação. |
| `src/lib/financeiro/ofx/fixtures.ts` | Extrato de amostra usado pelos testes. |

Tudo aqui é testável sem banco. **Ao mudar regra de comparação, mude aqui** — não
nas rotas nem nos componentes.

### Servidor

| Arquivo | Responsabilidade |
|---|---|
| `src/app/api/financeiro/conciliacao/ofx/_lib/analise.ts` | Lê o upload, carrega candidatos do banco, chama o matcher. |
| `src/app/api/financeiro/conciliacao/ofx/_lib/conciliar.ts` | Valida a forma da decisão e chama a RPC; traduz erro do Postgres. |
| `.../preview/route.ts` | `POST` análise. Não escreve nada. |
| `.../importar/route.ts` | `POST` grava o extrato e aplica as decisões. |
| `.../route.ts` | `GET` histórico de importações. |
| `.../[id]/route.ts` | `GET` uma importação e seus movimentos. |
| `.../[id]/conciliar/route.ts` | `POST` resolve movimentos que ficaram em aberto. |

### Interface

Fica dentro do Fluxo de Caixa, em
`src/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/conciliacao-ofx/`:

| Arquivo | Responsabilidade |
|---|---|
| `conciliacao-ofx-dialog.tsx` | O assistente: abas Importar / Importações, etapa 1 e etapa 2. |
| `movimento-dialog.tsx` | A escolha da correspondência de uma linha. |
| `historico-importacoes.tsx` | Lista de importações e o detalhe de cada uma. |
| `types.ts` | Formas trocadas com as rotas, cores das situações, rótulos das ações. |

O ponto de entrada é o item **"Conciliação bancária (OFX)"** no dropdown de
**Ações** de `financialTable.tsx`, sob a permissão de criação.

### Banco

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/20260908140000_conciliacao_bancaria_ofx.sql` | Tabelas, função de líquido e as duas RPCs. |
| `supabase/tests/conciliacao_bancaria_ofx.sql` | 17 verificações contra um banco real, com `ROLLBACK`. |

---

## 4. O fluxo ponta a ponta

```text
usuário escolhe a conta e o arquivo
        │
        ▼
POST /preview ──────────────────────────────► NÃO ESCREVE NADA
        │  parse → fingerprint → carrega candidatos → matcher
        ▼
tela mostra cada linha classificada + sugestão
        │
        │  usuário revisa, troca correspondências, marca o que vai conciliar
        ▼
POST /importar ─────────────────────────────► AQUI ESCREVE
        │
        ├─ registrar_importacao_ofx()   uma transação para o arquivo inteiro
        │     grava ofx_importacao + ofx_movimento (pula os repetidos)
        │
        └─ conciliar_movimento_ofx()    uma transação POR MOVIMENTO
              VINCULAR / LIQUIDAR / CRIAR / IGNORAR
        │
        ▼
movimentos não marcados ficam com status PENDENTE
        │
        ▼
aba Importações → abrir → "Resolver N em aberto"
        │
        ▼
POST /[id]/conciliar   mesma RPC, uma decisão por movimento
```

### Por que duas etapas separadas

Porque **a leitura do extrato não pode alterar o financeiro**. Se a análise já
gravasse, abrir um arquivo por engano — ou só para conferir — deixaria rastro no
caixa. A separação também é o que permite trocar a conta bancária escolhida e
reanalisar sem consequência.

O arquivo é enviado **duas vezes**: uma no preview e outra na confirmação. É
proposital. O servidor reprocessa o arquivo em vez de confiar nos movimentos que
a tela devolveu, então valor, data e fingerprint sempre saem do que o banco
emissor escreveu, nunca de um corpo de requisição que poderia ter sido alterado
no caminho. A tela só manda as **decisões**, referenciadas por fingerprint.

---

## 5. Fingerprint e proteção contra duplicidade

`FITID` **não serve como chave**. Nos extratos observados, movimentos diferentes
compartilham o mesmo `FITID` (por exemplo, duas linhas do mesmo dia com valores
distintos). Usá-lo sozinho descartaria movimento de verdade.

A chave base é tudo que o banco disse sobre a linha:

```text
conta (BANKID/BRANCHID/ACCTID) | data | valor em centavos COM SINAL
| TRNTYPE | FITID | CHECKNUM | REFNUM | NAME | MEMO
```

Todos normalizados (sem acento, caixa alta, espaços colapsados) — assim o mesmo
arquivo relido em outra codificação não vira movimento novo.

O fingerprint é `sha256(chaveBase + "|#" + ocorrência)`, onde **ocorrência** é
quantas vezes aquela chave base já apareceu no arquivo. É isso que preserva duas
tarifas idênticas de R$ 2,90 no mesmo dia como **dois fatos**, e não uma linha
repetida.

### As três travas

| Trava | Onde | Impede |
|---|---|---|
| `UNIQUE (banco_id, arquivo_hash)` | `ofx_importacao` | Importar o mesmo arquivo duas vezes na mesma conta. |
| `UNIQUE (banco_id, fingerprint)` | `ofx_movimento` | O mesmo movimento entrar de novo por outro arquivo com período sobreposto. |
| `UNIQUE (transacao_id) WHERE NOT NULL` | `ofx_movimento` | Duas linhas do extrato apontarem para a mesma transação. |

O hash do arquivo **não basta sozinho**: o banco gera arquivos diferentes com
períodos sobrepostos, e os dois passariam como arquivos novos. Por isso o
fingerprint por movimento é a trava que de fato importa. Quando um extrato novo
traz linhas já conhecidas, elas não são regravadas — a importação as conta em
`quantidade_repetidos` e a tela diz quantas já existiam.

### Limitação conhecida

Se um segundo arquivo trouxer **mais repetições idênticas** da mesma chave base
(o banco corrigiu o extrato), a repetição extra recebe fingerprint novo e entra
como movimento a analisar. É o lado seguro do erro: aparece para o usuário
decidir, em vez de sumir calado.

---

## 6. Parser OFX

Não usa parser de XML, e isso é decisão, não atalho: o OFX 1.x — que é o que os
bancos brasileiros exportam — **não é XML válido** (tags de folha sem
fechamento), e qualquer parser estrito recusaria o arquivo inteiro por causa de
um `<MEMO>` sem `</MEMO>`.

A regra que resolve os dois dialetos com o mesmo código:

- tag seguida de **texto** → é folha, não entra na pilha;
- tag seguida de **espaço em branco** → é container, entra na pilha;
- `</TAG>` que não acha par na pilha → é fechamento de folha (só o 2.x escreve), ignorado.

### Detalhes que importam

| Assunto | Regra |
|---|---|
| **Encoding** | Tenta UTF-8 estrito; falhando, lê como Windows-1252. O cabeçalho `CHARSET:1252` é só desempate — há banco que declara uma coisa e escreve outra. Errar aqui embaralha o MEMO, que entra no fingerprint. |
| **Data** | Os 8 primeiros dígitos de `DTPOSTED` **já são** o dia local. Não converter para UTF/UTC e voltar — é o caminho que faz o movimento andar um dia e quebra toda a conciliação por data. |
| **Dinheiro** | Sempre centavos inteiros, convertidos por **texto**, nunca por `Number()`. O último separador é o decimal; os anteriores são milhar. Acerta `-1234.56`, `-1.234,56` e `-1234,56`. |
| **Sinal** | Positivo entra na conta, negativo sai. O sinal de `TRNAMT` é a **única** fonte de sentido — `TRNTYPE` varia demais entre bancos (DEBIT, FEE, XFER, PIX). |
| **Saldo inicial** | O OFX 1.x quase nunca envia. É deduzido: `LEDGERBAL` menos a soma dos movimentos. |
| **Linha defeituosa** | Movimento sem data ou sem valor é descartado em silêncio; o resto do extrato continua servindo, e a linha a menos aparece na contagem. |
| **Arquivo inválido** | Recusado com `ErroDeOfx`, que a rota transforma em HTTP 400 com a frase pronta. Extrato fora de BRL também é recusado. |

---

## 7. Escolha da conta bancária

O módulo compara `BRANCHID`/`ACCTID` do arquivo com
`bancoconta.agencia`/`bancoconta.contanumero`, **só pelos dígitos** (agência e
conta são escritas com traço, ponto e zero à esquerda).

A sugestão só é feita quando há **uma** resposta: chutar levaria alguém a
conciliar o extrato de uma conta contra os movimentos de outra. A interface
sempre deixa confirmar ou trocar, e quando a conta escolhida diverge do arquivo
mostra um aviso — **aviso, não bloqueio**: conta migrada ou agência renumerada
são casos legítimos, e quem decide é quem opera.

---

## 8. Matching — a regra central

### A ordem é regra de negócio

```text
1º  o movimento já está no Fluxo de Caixa?   → vincular, nada é criado
2º  existe título em aberto que corresponda? → oferecer a baixa
3º  nada?                                    → oferecer transação nova
```

**Nunca procure título pendente antes de olhar o Fluxo.** Inverter a ordem cria
exatamente a duplicidade que o módulo existe para impedir: o mesmo dinheiro
contado como baixa de um título e como lançamento que já estava lá.

### Etapa 1 — Fluxo de Caixa

Um candidato precisa de **todos**:

- mesma conta bancária da importação;
- mesmo sentido (`tipoEhEntradaDeCaixa`);
- **`valorLiquidoEfetivo` igual em centavos exatos**.

Não há limite de diferença entre as datas do extrato e da transação.

> **A comparação é contra o LÍQUIDO, nunca contra `transacao.valor`.** Venda de
> R$ 1.000 no cartão com R$ 30 de taxa aparece no extrato como R$ 970. Comparar
> com o bruto faria toda venda com taxa parecer movimento novo, e o usuário
> criaria a receita em dobro.

Score: mesmo dia = 100, um dia = 92, dois dias ou mais = 85. A data apenas ordena as sugestões.

Título abonado, quitado com crédito do cliente ou antecipado sem repasse fica
`pendente = false` com `banco_id` nulo — justamente porque nenhum dinheiro entrou
em conta nenhuma. Exigir o banco da importação já os exclui.

Um candidato → `MATCH_EXATO`. Mais de um → `AMBIGUO`.

### Etapa 2 — Títulos em aberto

Só roda quando a etapa 1 não achou nada. Data **não precisa bater** — título
vence num dia e é pago em outro, e é isso que o score mede. Valor, sim, em
centavos exatos, sem tolerância.

| Ingrediente | Pontos |
|---|---|
| Valor igual ao saldo em aberto | +60 |
| Valor **menor** que o saldo (candidato a baixa parcial) | +30 |
| Data igual ao vencimento | +30 |
| Até 1 dia | +25 |
| Até 3 dias | +15 |
| Até 7 dias | +5 |
| Forma de pagamento compatível | +10 |
| Descrição semelhante (Dice ≥ 0,5 / ≥ 0,25) | +10 / +5 |

Não há limite de dias entre o vencimento e o pagamento ou recebimento. A proximidade da data influencia apenas a pontuação; títulos antigos continuam disponíveis na busca manual. Valor **maior** que o saldo não é candidato.

### Classificação final

| Situação | Quando | Ação sugerida |
|---|---|---|
| `MATCH_EXATO` | Um movimento do Fluxo bate. | `VINCULAR` |
| `MATCH_PROVAVEL` | Um título com score ≥ 60, sem empate. | `LIQUIDAR` ou `BAIXA_PARCIAL` |
| `AMBIGUO` | Vários do Fluxo, ou títulos empatados dentro de 5 pontos. | nenhuma — o usuário escolhe |
| `SEM_CORRESPONDENCIA` | Nada. | `CRIAR` |
| `REVISAO_MANUAL` | Os únicos candidatos são de antecipação ou pagamento múltiplo. | nenhuma |

### Transferências entre contas

Uma transferência gera duas pernas (`SAQUE` na origem, `DEPOSITO` no destino), e
o OFX de cada banco traz uma delas. As duas são movimento de conta de verdade e
**devem** conciliar como `MATCH_EXATO` — `tipoEhEntradaDeCaixa` já trata
`DEPOSITO` como entrada e `SAQUE` como saída. Nunca transformar transferência
própria em receita ou despesa.

### Uma transação responde por um movimento só

Antes de comparar, o servidor remove da lista de candidatos as transações que já
respondem por algum movimento conciliado, independentemente do período. Sem isso, dois débitos
iguais no mesmo dia receberiam a **mesma** sugestão, e o segundo só descobriria o
conflito na hora de gravar.

---

## 9. Sugestão de forma de pagamento

É **sugestão**, nunca decisão. A função só devolve um método que exista no enum
`metodo_pagamento` daquele banco, e devolve `null` sempre que o texto não
permitir afirmar nada — cabendo ao usuário escolher.

| Texto do extrato | Sugestão |
|---|---|
| `PIX`, `DEB PIX`, `CRED PIX` | `PIX` |
| `PAGAMENTO DE BOLETO`, `BOLETO` | `BOLETO` |
| `TED` / `DOC` | `TED` / `DOC` |
| `TRANSFERENCIA` | `TRANSFERENCIA` |
| `TARIFA`, `IOF`, `JUROS`, `PAGAMENTO AGUA`, `DEBITO AUTOMATICO` | `DEBITO AUTOMATICO` |

> **A regra que não se pode quebrar:** tarifa, IOF e juros são débitos, mas não
> são cartão de débito. Traduzir "é débito no extrato" para `DEBITO` encheria o
> financeiro de despesas com forma de pagamento errada — e forma de pagamento é o
> que a DRE e os relatórios usam para agrupar. Se o método sugerido não existir
> naquele banco, a resposta é `null`, e não um método parecido.

---

## 10. Modelo de dados

Nenhuma coluna de `transacao` foi alterada. **Não há `empresa_id`**: cada empresa
tem seu próprio banco de dados — `transacao` também não tem a coluna — e o
isolamento vem do `banco_id → bancoconta`.

### `ofx_importacao`

Um arquivo importado para uma conta.

`id`, `banco_id`, `arquivo_nome`, `arquivo_hash`, `bank_id_ofx`, `agencia_ofx`,
`conta_ofx`, `tipo_conta_ofx`, `moeda`, `periodo_inicio`, `periodo_fim`,
`saldo_inicial`, `saldo_final`, `quantidade_movimentos` (linhas no arquivo),
`quantidade_importados` (gravadas), `quantidade_repetidos` (já existiam),
`created_by`, `created_at`.

### `ofx_movimento`

Uma linha do extrato.

`id`, `importacao_id`, `banco_id`, `sequencia`, `fitid`, `checknum`, `refnum`,
`tipo_ofx`, `data_postagem`, `data_disponivel`, `valor`, `valor_centavos`,
`nome`, `memo`, `fingerprint`, `status`, `situacao_analise`, `score_match`,
`acao_conciliacao`, `observacao`, `transacao_id`, `titulo_origem_id`,
`conciliado_em`, `conciliado_por`, `created_at`.

| Coluna | Valores | Observação |
|---|---|---|
| `status` | `PENDENTE`, `CONCILIADO`, `IGNORADO` | O estado durável. |
| `situacao_analise` | as cinco de §8 | **Histórico** do que a importação viu na hora. |
| `acao_conciliacao` | `VINCULAR`, `LIQUIDAR`, `BAIXA_PARCIAL`, `CRIAR`, `IGNORAR` | A decisão que valeu. |
| `transacao_id` | | O **dinheiro**. Numa baixa parcial é a transação filha. |
| `titulo_origem_id` | | O **título** baixado, quando houve baixa. |

Um `CHECK` garante que `status = 'CONCILIADO'` exige `transacao_id` preenchido —
movimento conciliado sem dinheiro do outro lado seria conciliação de nada.
`IGNORADO` é o estado que registra "vi e não é para lançar".

### `transacao_valor_liquido_efetivo(transacao) → numeric`

Espelho SQL de `valorLiquidoEfetivo()` do TypeScript. Existe para a RPC poder
conferir, antes de vincular, que o dinheiro do extrato é o mesmo da transação.
**Se um dos dois lados mudar, mude o outro** — sem essa conferência no banco,
uma chamada direta à RPC passaria por cima da validação.

---

## 11. As RPCs

### `registrar_importacao_ofx(banco, nome, hash, cabecalho jsonb, movimentos jsonb, created_by) → jsonb`

Grava o arquivo inteiro de uma vez: ou entram o cabeçalho e todos os movimentos
novos, ou não entra nada. Importação pela metade deixaria o usuário com um
extrato truncado que parece completo.

Movimento cujo fingerprint já existe na conta é pulado com `ON CONFLICT DO
NOTHING` e contado como repetido — sem abortar a transação.

Retorna `{ importacao_id, quantidade_movimentos, quantidade_importados,
quantidade_repetidos, movimentos: [{ fingerprint, movimento_id, repetido }] }`.

Recusa com `23505` quando o arquivo já foi importado naquela conta.

### `conciliar_movimento_ofx(movimento, acao, transacao, valor, metodo, plano, centro, nova jsonb, usuario, observacao) → jsonb`

**É aqui que a atomicidade importa.** Dar baixa num título e falhar ao marcar o
movimento como conciliado deixaria a próxima importação livre para dar a mesma
baixa outra vez. Como toda função plpgsql roda numa transação, o caminho inteiro
— baixa, criação, vínculo e a marcação — cai junto ou grava junto.

O `SELECT ... FOR UPDATE` no movimento serializa duas telas na mesma linha: a
segunda espera, lê `status = 'CONCILIADO'` e recusa.

```text
BEGIN
  SELECT movimento FOR UPDATE
  se status <> PENDENTE → recusa

  IGNORAR   → marca e retorna

  VINCULAR  → transação tem que estar liquidada, na conta da importação,
              no mesmo sentido e com o líquido igual ao extrato

  LIQUIDAR  → título tem que estar aberto e no mesmo sentido
              o valor da baixa tem que ser EXATAMENTE o do extrato
              chama baixar_transacao_pendente()
              parcial? → transacao_id = baixa_id (a filha)
              integral? → transacao_id = o próprio título
              titulo_origem_id = o título

  CRIAR     → insere transação liquidada, sentido vindo do extrato

  marca CONCILIADO (o índice único de transacao_id recusa aqui,
                    derrubando a baixa junto, se aquela transação
                    já responde por outro movimento)
COMMIT
```

#### A conferência de valor na baixa

Sem ela, a conciliação aceitaria baixar R$ 5.000 com um movimento de R$ 2.000 e
marcar a linha como resolvida — o extrato "fecharia" com R$ 3.000 que nunca
passaram pela conta.

#### O sentido do extrato manda

Em `CRIAR`, o usuário escolhe apenas **entre os dois tipos daquele sentido**
(crédito → `RECEITA` ou `DEPOSITO`; débito → `DESPESA` ou `SAQUE`). Tipo livre
permitiria transformar um débito em receita e inverter o resultado da empresa a
partir de um extrato.

#### Códigos de erro

| Código | Significado | HTTP |
|---|---|---|
| `22023` | Regra de negócio recusada (sentido, valor, ação inválida). | 400 |
| `23505` | Já resolvido, arquivo repetido, ou transação já conciliada. | 409 |
| `P0002` | Movimento, importação, título ou conta não encontrada. | 404 |
| `23503` | Plano, centro de custo ou cadastro inexistente. | 422 |

---

## 12. As APIs

Todas usam a infraestrutura de permissões financeiras que já existia. Não há
autenticação paralela.

| Método e rota | Permissão | Entrada | Escreve? |
|---|---|---|---|
| `POST /api/financeiro/conciliacao/ofx/preview` | `financeiro:visualizar` | `multipart`: `arquivo`, `bancoId` | **Não** |
| `POST /api/financeiro/conciliacao/ofx/importar` | `financeiro:criar` (+ `financeiro:editar` se houver `VINCULAR`/`LIQUIDAR`) | `multipart`: `arquivo`, `bancoId`, `decisoes` (JSON) | Sim |
| `GET /api/financeiro/conciliacao/ofx` | `financeiro:visualizar` | `page`, `limit`, `bancoId` | Não |
| `GET /api/financeiro/conciliacao/ofx/[id]` | `financeiro:visualizar` | — | Não |
| `POST /api/financeiro/conciliacao/ofx/[id]/conciliar` | `financeiro:criar` (+ `financeiro:editar` conforme a ação) | `{ decisoes: [...] }` | Sim |

### Forma de uma decisão

```jsonc
{
  "fingerprint": "sha256…",      // identifica a linha no arquivo reprocessado
  "movimentoId": 123,            // usado quando o movimento já está gravado
  "acao": "VINCULAR | LIQUIDAR | CRIAR | IGNORAR",
  "transacaoId": 456,            // obrigatório em VINCULAR e LIQUIDAR
  "valor": 2000.00,              // só na baixa parcial; ausente = saldo inteiro
  "metodopagamento": "PIX",      // obrigatório em LIQUIDAR e em CRIAR
  "planoContaId": null,
  "centroCustoId": null,
  "nova": { "descricao": "…", "tipo": "DESPESA" },  // só em CRIAR
  "observacao": null
}
```

### Tolerância a falhas na importação

A gravação do extrato é atômica; cada decisão é atômica **por conta própria**.
Uma baixa que falhe deixa o movimento dela em aberto na importação, para o
usuário resolver depois — o que é melhor do que descartar as trinta que deram
certo. A resposta traz `falhas`, com o motivo de cada uma.

### Reanálise ao reabrir uma importação

`GET /[id]` **recalcula** as sugestões dos movimentos ainda em aberto, em vez de
lê-las do banco. É proposital: entre a importação e a volta do usuário, títulos
foram baixados, criados e excluídos. Mostrar a sugestão congelada de ontem
levaria alguém a liquidar um título que já foi pago por outro caminho.

---

## 13. A interface

**Etapa 1 — Importação.** Conta bancária + arquivo + "Analisar extrato". A tela
diz, ali mesmo, que a análise não altera nada.

**Etapa 2 — Análise.** Cabeçalho com conta, período, saldo inicial e final,
quantidade de movimentos, créditos, débitos e a contagem por situação. Abaixo, a
tabela: data, descrição do extrato, valor, situação (com cor), correspondência
encontrada com score, e o botão de ação.

Cores das situações (em `types.ts`, num lugar só): verde = já no fluxo, âmbar =
provável, laranja = ambíguo, cinza = não encontrado, violeta = revisão manual,
azul = já conciliado.

**Marcação inicial.** Só o que a análise conseguiu afirmar sozinha nasce marcado.
`MATCH_EXATO` vem marcado; `MATCH_PROVAVEL` vem com a decisão montada mas **só é
marcado se houver forma de pagamento sugerida**. Ambíguo, revisão manual e não
encontrado ficam sem decisão de propósito — são justamente os casos em que uma
escolha automática erraria.

**Dialog de correspondência.** Mostra o movimento bancário, a lista de candidatos
com descrição, valor, vencimento, contraparte, OS/venda, score e diferença de
dias; e as três saídas: usar esta transação, criar nova, ignorar.

**Aba Importações.** Conta, arquivo, período, movimentos, conciliados, em aberto,
data e usuário. Abrindo uma, veem-se todos os movimentos com FITID e MEMO ao lado
da transação que cada um virou — é onde se responde *"de onde veio esta
movimentação?"*. Havendo pendências, um botão leva de volta à tabela de decisão.

---

## 14. Invariantes — não quebrar

1. Analisar **não** escreve. Só a confirmação altera `transacao`, títulos ou as tabelas OFX.
2. Fluxo de Caixa é consultado **antes** dos títulos.
3. A comparação de valores é sempre em **centavos inteiros**, sem tolerância.
4. Comparar com `valorLiquidoEfetivo`, nunca com `transacao.valor`.
5. A baixa é feita por `baixar_transacao_pendente`. Não recriar a lógica.
6. O valor da baixa é **exatamente** o do extrato.
7. Numa baixa parcial, `transacao_id` aponta para a **filha**; `titulo_origem_id`, para o título.
8. Uma transação responde por **um** movimento do extrato.
9. Movimento já resolvido não é conciliado de novo.
10. Migration nova e incremental; nunca alterar as já aplicadas.
11. Mensagens de erro em português.

---

## 15. Deliberadamente em revisão manual

Título com `adiantamento_id`, `eh_adiantamento` ou `pagamento_multiplo_id`
**nunca** recebe sugestão de baixa. São liquidados em conjunto, por regras
próprias que a conciliação não deve reinventar; quando são a única
correspondência possível, o movimento vai para `REVISAO_MANUAL` com a explicação,
em vez de receber uma sugestão que poderia ser aceita sem pensar.

Também ficam de fora: extrato fora de BRL (recusado na leitura) e movimento sem
data ou sem valor (descartado, com o resto do extrato preservado).

---

## 16. Como testar

```powershell
# 49 testes de unidade do parser, fingerprint, matcher e sugestão de método
npx tsx --test src/lib/financeiro/ofx/*.test.ts

# a suíte inteira do projeto (roda também no prebuild)
npm run test:negocio

# 17 verificações contra um banco real; termina em ROLLBACK, nada é gravado
npm run db:test:sql -- supabase/tests/conciliacao_bancaria_ofx.sql
```

O teste SQL exige que a migration já esteja aplicada no banco alvo. Para validar
migration e teste juntos **antes** de aplicar, concatene os dois num arquivo
temporário — a migration sem o `BEGIN;`/`COMMIT;` dela, dentro da transação do
teste, que termina em `ROLLBACK`.

Os testes de unidade cobrem, entre outros: OFXSGML e XML, valores positivos e
negativos, datas com fuso, `FITID` duplicado, tags ausentes, encoding
Windows-1252, colisão de fingerprint, reimportação com período maior, débito
achando despesa, crédito achando receita, débito **não** achando receita, match
exato, provável, ambíguo, diferença de data, valor diferente, banco diferente, e
o caso obrigatório `valor = 1000 / valorLiquido = 970 / OFX = 970`.

---

## 17. Estado do deploy

A migration `20260908140000_conciliacao_bancaria_ofx.sql` **ainda não foi aplicada
em nenhum banco**. Foi validada por dry-run com rollback na Demonstração.

Atenção antes de publicar: `docs/database-migrations.md` registra que Demir,
AlphaGarage e Garage Premium estão intencionalmente parados na `20260905110000`
por causa do stand-by da Stone. Rodar `npm run db:deploy` arrastaria a
`20260907100000` junto. Confirme a estratégia antes de aplicar nos clientes.
