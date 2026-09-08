Você está trabalhando no repositório do ERP Oficina da FIGO.

Seu objetivo é implementar um novo módulo de **Conciliação Bancária por importação de arquivos OFX**, integrado ao módulo financeiro existente.

Antes de alterar qualquer código, leia cuidadosamente o funcionamento atual do módulo financeiro, especialmente:

* tabela `transacao`;
* Fluxo de Caixa;
* Contas a Pagar;
* Contas a Receber;
* Contas Liquidadas;
* baixa de transações pendentes;
* baixa parcial;
* transferências entre contas;
* pagamentos de OS;
* pagamentos de venda;
* entradas financeiras;
* pagamento múltiplo;
* adiantamentos;
* cálculo do valor líquido efetivamente movimentado;
* regras relacionadas a `pendente`, `banco_id`, `pago_em`, `valorLiquido`, `valor_baixado` e `baixa_de_transacao_id`.

Arquivos e funções existentes importantes que devem ser analisados e reaproveitados sempre que possível:

* `src/lib/financeiro/transacao.ts`
* `valorLiquidoEfetivo()`
* `tipoEhEntradaDeCaixa()`
* `saldoEmAberto()`
* `/api/transaction/[id]/baixar`
* RPC `baixar_transacao_pendente`
* rotas atuais de criação de transação
* infraestrutura de permissões do módulo financeiro.

NÃO faça agora uma grande refatoração estrutural do financeiro.

O objetivo desta tarefa é finalizar a funcionalidade de conciliação aproveitando a arquitetura atual. Refatorações amplas ficarão para uma etapa posterior.

---

# 1. Conceito do módulo

O módulo deve permitir importar um arquivo `.ofx` de uma conta bancária e comparar os movimentos do extrato com as transações existentes no ERP.

A importação NÃO significa simplesmente criar uma nova transação para cada linha do OFX.

Para cada movimento do OFX o sistema deve decidir entre quatro situações:

1. já existe um movimento liquidado correspondente no Fluxo de Caixa;
2. existe uma Conta a Pagar ou Conta a Receber pendente que provavelmente corresponde ao movimento;
3. existem várias correspondências possíveis e é necessário o usuário escolher;
4. não existe nada correspondente e o usuário pode criar uma nova transação financeira.

Fluxo esperado:

```text
MOVIMENTO DO OFX
        |
        +--> já existe no Fluxo de Caixa?
        |       |
        |       +--> SIM -> vincular/conciliação sem criar outra transação
        |
        +--> corresponde a título pendente?
        |       |
        |       +--> SIM -> permitir liquidar o título usando o movimento do OFX
        |
        +--> várias possibilidades?
        |       |
        |       +--> usuário escolhe a correspondência
        |
        +--> nada encontrado?
                |
                +--> permitir criar nova transação liquidada
```

---

# 2. Regra financeira fundamental

No ERP um título financeiro e o movimento bancário não devem ser duplicados.

Exemplo:

Existe:

```text
Conta a Pagar
Fornecedor XYZ
Boleto
R$ 5.835,69
Pendente
```

OFX possui:

```text
04/08/2026
PAGAMENTO DE BOLETO
-5835.69
```

Ao conciliar:

* NÃO criar uma segunda despesa;
* utilizar a lógica já existente de baixa;
* o título passa de pendente para liquidado;
* `pago_em` recebe a data efetiva do extrato;
* `banco_id` recebe a conta selecionada;
* o título passa a aparecer no Fluxo de Caixa como o movimento bancário efetivamente realizado.

A infraestrutura atual de `baixar_transacao_pendente` deve ser reaproveitada.

Não recrie manualmente todas as regras existentes de baixa.

---

# 3. Exemplo real de OFX

Existe um arquivo OFX real fornecido para esta implementação.

Ele deve ser usado como amostra para testes manuais e automatizados.

Características importantes observadas nesse arquivo:

* formato OFX 1.x / OFXSGML;
* não deve ser tratado como XML estrito;
* aproximadamente 34 movimentos;
* contém créditos e débitos;
* contém PIX;
* pagamentos de boleto;
* débito de IOF;
* cobrança de juros;
* tarifas;
* pagamento de água;
* outros débitos automáticos.

Muito importante:

`FITID` NÃO é necessariamente único no arquivo.

Foram observados, por exemplo, movimentos diferentes repetindo o mesmo `FITID`.

Portanto:

NÃO use apenas `FITID` como chave única de um movimento OFX.

---

# 4. Parser OFX

Criar uma implementação robusta capaz de ler arquivos OFX comuns utilizados por bancos brasileiros.

O parser deve aceitar pelo menos:

* OFXSGML 1.x;
* XML OFX quando aplicável.

Extrair quando disponíveis:

```text
BANKID
BRANCHID
ACCTID
ACCTTYPE
CURDEF

DTSTART
DTEND

TRNTYPE
DTPOSTED
DTUSER
DTAVAIL
TRNAMT
FITID
CHECKNUM
REFNUM
NAME
MEMO
```

Normalizar:

* datas;
* valores monetários;
* strings;
* espaços;
* acentos quando necessário para comparação;
* sinais de crédito/débito.

Todos os cálculos e comparações monetárias devem ser feitos em **centavos inteiros**.

Evitar comparações financeiras usando ponto flutuante.

Estrutura sugerida:

```text
src/lib/financeiro/ofx/
├── parser.ts
├── normalize.ts
├── fingerprint.ts
├── matcher.ts
├── payment-method.ts
├── types.ts
└── __tests__/
```

Pode ajustar os nomes se houver uma organização melhor no projeto.

---

# 5. Persistência

Criar tabelas auxiliares para registrar a importação e os movimentos do extrato.

Não poluir `transacao` com todas as informações específicas do OFX.

Sugestão:

## `ofx_importacao`

Campos sugeridos:

```text
id
banco_id
arquivo_nome
arquivo_hash

bank_id_ofx
agencia_ofx
conta_ofx
tipo_conta_ofx
moeda

periodo_inicio
periodo_fim

saldo_inicial
saldo_final

quantidade_movimentos

created_by
created_at
```

Adicionar também `empresa_id` se o modelo multiempresa atual exigir.

Siga o padrão existente do projeto para isolamento por empresa.

---

## `ofx_movimento`

Campos sugeridos:

```text
id
importacao_id

sequencia

fitid
checknum
refnum

tipo_ofx

data_postagem
data_disponivel

valor
valor_centavos

nome
memo

fingerprint

status

transacao_id
titulo_origem_id

acao_conciliacao
score_match

conciliado_em
conciliado_por

created_at
```

Pode adicionar campos necessários para auditoria ou consistência.

---

# 6. Fingerprint e proteção contra duplicidade

Criar um fingerprint determinístico para cada movimento.

NÃO depender exclusivamente de `FITID`.

O fingerprint deve considerar elementos como:

```text
conta bancária
data
valor em centavos
sentido crédito/débito
FITID
CHECKNUM
REFNUM
MEMO normalizado
NAME normalizado
ocorrência do movimento dentro do arquivo
```

Analise cuidadosamente como produzir uma chave estável.

O sistema deve impedir:

* importar exatamente o mesmo arquivo duas vezes;
* importar novamente o mesmo movimento;
* conciliar o mesmo movimento duas vezes.

Criar restrições `UNIQUE` adequadas no banco sempre que possível.

Calcular também hash do arquivo importado.

Se o mesmo arquivo for enviado novamente, retornar uma informação clara de que o arquivo já foi importado.

Não depender somente do hash do arquivo para detectar movimentos repetidos, pois bancos podem gerar arquivos diferentes contendo períodos sobrepostos.

---

# 7. Conta bancária

Ao importar o arquivo:

tentar comparar:

```text
BRANCHID
ACCTID
```

com:

```text
bancoconta.agencia
bancoconta.contanumero
```

Se houver uma correspondência clara, pré-selecionar a conta.

Mesmo assim a interface deve permitir confirmar ou trocar a conta bancária antes da análise final.

A conta selecionada é fundamental para a conciliação.

---

# 8. Matching com Fluxo de Caixa

Primeiro procurar transações JÁ LIQUIDADAS que correspondam ao movimento OFX.

Nunca procure título pendente antes de verificar se o movimento já está registrado no Fluxo de Caixa.

Critérios mínimos:

```text
mesma conta bancária
mesmo sentido financeiro
mesmo valor efetivamente movimentado
data do movimento
```

Sentido:

```text
OFX crédito
-> RECEITA ou DEPOSITO

OFX débito
-> DESPESA ou SAQUE
```

Utilizar as funções de domínio já existentes sempre que possível.

Especialmente:

```text
tipoEhEntradaDeCaixa()
valorLiquidoEfetivo()
```

Muito importante:

O valor do extrato bancário corresponde ao dinheiro efetivamente movimentado.

Portanto NÃO compare automaticamente com `transacao.valor`.

Exemplo:

```text
Venda bruta           R$ 1.000,00
Taxa cartão              R$ 30,00
valorLiquido             R$ 970,00

OFX                     +R$ 970,00
```

Esse deve ser considerado match.

---

# 9. Matching com Contas a Pagar e Contas a Receber

Depois de procurar movimentos já liquidados, procurar títulos pendentes.

Débito OFX:

```text
priorizar Contas a Pagar / DESPESA pendente
```

Crédito OFX:

```text
priorizar Contas a Receber / RECEITA pendente
```

Não exigir data exatamente igual.

O título pode vencer em uma data e ser pago antes ou depois.

Criar um sistema de score.

Sugestão inicial:

```text
valor exatamente igual                    +60
data exatamente igual                     +30
diferença de até 1 dia                     +25
diferença de até 3 dias                    +15
diferença de até 7 dias                     +5
forma de pagamento compatível              +10
descrição/nome/memo semelhante             +10
```

Esse score pode ser ajustado depois dos testes.

Não use tolerância monetária por padrão.

R$ 1.000,00 deve ser comparado com R$ 1.000,00 em centavos exatos.

---

# 10. Classificação do resultado

Cada movimento deve sair da análise com um estado.

Utilizar algo semelhante a:

```text
PENDENTE
MATCH_EXATO
MATCH_PROVAVEL
AMBIGUO
SEM_CORRESPONDENCIA
CONCILIADO
IMPORTADO
IGNORADO
```

A IA pode adaptar os nomes ao padrão do projeto.

Exemplos:

## Match exato

Existe exatamente uma transação:

```text
Banco Caixa
03/08/2026
DESPESA
R$ 4.118,00
```

OFX:

```text
03/08/2026
DEBIT
-4118.00
```

Retornar:

```text
MATCH_EXATO
score: 100
```

---

## Match provável

Conta a pagar:

```text
R$ 5.835,69
vencimento 05/08
```

OFX:

```text
04/08
PAGAMENTO DE BOLETO
-5835.69
```

Retornar como sugestão de título pendente.

Não liquidar automaticamente.

---

## Ambíguo

OFX:

```text
PIX
-1000
```

Existem três títulos pendentes de R$ 1.000.

Retornar:

```text
AMBIGUO
```

Mostrar as opções para o usuário.

---

# 11. Baixa parcial

O ERP já suporta baixa parcial.

A conciliação deve suportar:

```text
Conta a Receber
R$ 5.000

OFX:
+R$ 2.000
```

Se o usuário selecionar esse título:

oferecer:

```text
Baixar parcialmente R$ 2.000?
```

Usar o fluxo existente de baixa parcial da RPC `baixar_transacao_pendente`.

Não recriar uma lógica paralela de baixa.

Após a operação:

* manter título pendente pelo saldo restante;
* criar/usar corretamente a transação filha existente na arquitetura;
* vincular `ofx_movimento.transacao_id` ao movimento de caixa efetivamente criado pela baixa;
* `titulo_origem_id` deve apontar para o título original.

---

# 12. Criar nova transação

Quando não houver correspondência, permitir:

```text
Importar como nova transação
```

Exemplo:

```text
03/08
DEBITO DE IOF
-31.57
```

Poderá gerar:

```text
descricao: DEBITO DE IOF
valor: 31.57
tipo: DESPESA
pendente: false
data: 03/08/2026
banco_id: banco selecionado
```

Permitir ao usuário definir:

* descrição;
* categoria;
* plano de conta;
* centro de custo;
* método de pagamento;
* fornecedor/cliente se aplicável.

Não obrigar relação com cliente/fornecedor quando não fizer sentido.

---

# 13. Sugestão de método de pagamento

Criar apenas sugestões.

Nunca inventar ou persistir método inválido.

Utilizar os métodos realmente existentes no enum/configuração atual do banco.

Mapeamentos iniciais possíveis:

```text
DEB PIX
PIX
PIX ENVIADO
PIX RECEBIDO
CRED PIX
-> PIX

PAGAMENTO DE BOLETO
BOLETO
-> BOLETO

TED
-> TED

DOC
-> DOC

TRANSFERENCIA
-> TRANSFERENCIA

DEBITO DE IOF
COBRANCA DE JUROS
TARIFA
DEBITO AUTOMATICO
PAGAMENTO AGUA
-> sugerir DEBITO AUTOMATICO se esse método estiver disponível
```

Se não houver método seguro:

```text
metodoSugerido = null
```

e exigir escolha do usuário somente no momento em que for necessário criar ou baixar uma transação.

Não transformar tarifas bancárias em cartão de débito apenas porque são débitos.

---

# 14. Interface

Adicionar uma área no módulo Financeiro:

```text
Conciliação Bancária
```

Criar uma experiência em etapas.

## Etapa 1 — Importação

```text
Conta bancária
[ Caixa Conta Corrente ▼ ]

Arquivo
[ Selecionar arquivo OFX ]

[ Analisar extrato ]
```

Mostrar depois:

```text
Conta encontrada
Período
Saldo inicial
Saldo final
Quantidade de movimentos
Total de créditos
Total de débitos
```

---

## Etapa 2 — Análise

Tabela semelhante a:

```text
[ ] Data
    Descrição do extrato
    Entrada/Saída
    Valor
    Situação
    Correspondência encontrada
    Score
    Ação
```

Estados visualmente claros:

```text
verde   -> encontrado / match forte
amarelo -> provável
laranja -> ambíguo
vermelho/cinza -> não encontrado
azul -> já conciliado
```

Não precisa seguir exatamente essas cores se o design system possuir padrões melhores.

Utilizar Shadcn/UI e o padrão visual atual do ERP.

---

# 15. Seleção de correspondência

Ao clicar em uma linha ambígua ou provável:

abrir Dialog/Sheet mostrando:

```text
Movimento bancário

03/08/2026
PIX
-R$ 1.000,00
Descrição original do OFX
```

e abaixo:

```text
Possíveis correspondências
```

Mostrar:

* descrição da transação;
* valor;
* vencimento;
* cliente/fornecedor;
* origem;
* OS/venda quando existir;
* score;
* diferença de dias.

Permitir:

```text
[ Usar esta transação ]
```

ou:

```text
[ Criar nova transação ]
```

ou:

```text
[ Ignorar movimento ]
```

---

# 16. Preview antes de gravar

A leitura/análise do OFX NÃO deve alterar o financeiro.

Criar separação clara entre:

```text
PREVIEW / ANÁLISE

e

CONFIRMAÇÃO / CONCILIAÇÃO
```

A primeira chamada deve apenas:

* ler;
* normalizar;
* comparar;
* retornar sugestões.

Somente a confirmação do usuário deve alterar:

* `transacao`;
* títulos;
* tabelas de OFX;
* status de conciliação.

---

# 17. APIs

Sugestão:

```text
POST /api/financeiro/conciliacao/ofx/preview
POST /api/financeiro/conciliacao/ofx/importar
GET  /api/financeiro/conciliacao/ofx
GET  /api/financeiro/conciliacao/ofx/[id]
```

Se fizer mais sentido na arquitetura atual, os nomes podem ser adaptados.

Todos os endpoints devem usar as permissões financeiras já existentes.

Para leitura:

usar permissão equivalente a Financeiro acesso.

Para conciliar/criar/baixar:

usar permissão equivalente a Financeiro edição/criação conforme a operação.

Não inventar um sistema paralelo de autenticação.

---

# 18. Atomicidade

Essa parte é obrigatória.

A conciliação final de cada movimento OFX precisa ser atômica.

Não permitir:

```text
baixar título
+
falhar ao marcar OFX conciliado
```

porque uma nova importação poderia repetir a baixa.

Criar uma RPC, função SQL ou outra operação transacional apropriada.

Conceitualmente:

```text
conciliar_movimento_ofx()

BEGIN

SELECT movimento OFX FOR UPDATE

verificar se não foi conciliado

CASE ação

    VINCULAR_EXISTENTE:
        validar transação
        associar

    LIQUIDAR_TITULO:
        executar baixa existente
        identificar movimento efetivo de caixa
        associar

    BAIXA_PARCIAL:
        executar baixa parcial
        identificar transação filha
        associar

    CRIAR_TRANSACAO:
        criar transação liquidada
        associar

marcar movimento como conciliado

COMMIT
```

Se qualquer etapa falhar:

```text
ROLLBACK
```

Nunca deixar operação pela metade.

---

# 19. Não alterar regras financeiras existentes

São regras não negociáveis:

* não duplicar receitas ou despesas;
* não alterar a semântica atual do DRE;
* não transformar uma baixa em novo fato econômico;
* não quebrar OS;
* não quebrar vendas;
* não quebrar pagamento múltiplo;
* não quebrar transferências;
* não quebrar adiantamentos;
* não alterar a lógica existente de `valorLiquidoEfetivo`;
* não alterar o modelo de baixa parcial sem necessidade;
* não alterar `recebimento_por_documento`;
* não fazer migration destrutiva;
* não modificar migrations antigas já aplicadas;
* criar apenas novas migrations incrementais;
* utilizar centavos inteiros em comparações financeiras;
* respeitar `empresa_id` e isolamento de dados existente;
* respeitar soft delete quando existir;
* preservar auditoria de usuário.

---

# 20. Transferências entre contas

Tenha atenção especial a transferências.

Uma transferência entre contas próprias gera dois movimentos no ERP:

```text
SAQUE na conta origem
DEPOSITO na conta destino
```

O OFX de cada banco poderá conter uma das pernas.

O matcher deve ser capaz de conciliar cada movimento com sua respectiva transação existente.

Não transformar transferência própria em receita/despesa.

---

# 21. Transações antecipadas

O sistema possui regras específicas para títulos antecipados.

Não tente inferir ou reinventar o comportamento.

Se encontrar um caso relacionado a `adiantamento_id`, leia:

* funções de `src/lib/financeiro/transacao.ts`;
* RPC atual de baixa;
* migrations atuais relacionadas a adiantamento/antecipação.

Na primeira versão, se não for possível produzir uma correspondência segura:

marcar o movimento como:

```text
REVISÃO MANUAL
```

em vez de tentar tomar uma decisão arriscada.

---

# 22. Histórico e auditoria

Depois de conciliada, a origem bancária deve ser consultável.

Queremos poder responder:

```text
De onde veio esta movimentação?
```

Algo como:

```text
Importação OFX
Caixa Econômica
Arquivo: CX AGOSTO...
Data da importação
Movimento original
FITID
MEMO
Usuário que conciliou
```

Não necessariamente mostrar tudo diretamente no Fluxo de Caixa, mas manter a informação acessível.

---

# 23. Histórico de importações

Criar tela/listagem:

```text
Conciliações bancárias
```

Mostrar:

```text
Conta
Arquivo
Período
Movimentos
Conciliados
Pendentes
Ignorados
Data da importação
Usuário
```

Ao abrir uma importação:

mostrar todos os movimentos e seus estados.

---

# 24. Testes obrigatórios

Criar testes para pelo menos:

### Parser

* OFXSGML;
* valores positivos;
* valores negativos;
* datas OFX com timezone;
* `MEMO`;
* `FITID`;
* `FITID` duplicado;
* tags ausentes;
* encoding.

### Fingerprint

* mesma linha gera mesmo fingerprint;
* movimentos diferentes não devem colidir facilmente;
* mesmo `FITID` com valores/datas diferentes deve gerar fingerprint diferente.

### Matching

* débito encontra DESPESA;
* crédito encontra RECEITA;
* débito não encontra RECEITA;
* crédito não encontra DESPESA;
* match exato;
* match provável;
* match ambíguo;
* diferença de data;
* valor diferente;
* banco diferente;
* valor líquido diferente de bruto.

Exemplo obrigatório:

```text
transacao.valor = 1000
transacao.valorLiquido = 970
OFX = 970
```

deve produzir match correto.

### Conciliação

* vincular transação existente;
* liquidar título;
* baixa parcial;
* criar nova transação;
* ignorar movimento;
* impedir conciliação dupla;
* reimportação do mesmo arquivo;
* período OFX sobreposto;
* transação já conciliada.

---

# 25. Implementação incremental

Faça a implementação em etapas claras.

Sugestão:

### Etapa 1

Migration e modelos OFX.

### Etapa 2

Parser + normalização + fingerprint + testes.

### Etapa 3

API preview e matcher.

### Etapa 4

Interface de importação/análise.

### Etapa 5

RPC atômica de conciliação.

### Etapa 6

Baixa de título e baixa parcial.

### Etapa 7

Criação de nova transação.

### Etapa 8

Histórico de importações.

### Etapa 9

Testes finais e revisão.

Evite alterar dezenas de arquivos de uma vez sem validar cada etapa.

---

# 26. Antes de implementar

Primeiro faça uma inspeção do repositório e responda internamente:

1. como o Fluxo de Caixa decide quais transações aparecem;
2. como `pendente` separa títulos de movimentos realizados;
3. como a baixa comum funciona;
4. como a baixa parcial funciona;
5. como identificar o movimento de caixa criado por uma baixa parcial;
6. como `valorLiquidoEfetivo()` deve ser usado;
7. como as contas bancárias são consultadas;
8. quais permissões financeiras existem;
9. como funciona multiempresa;
10. como migrations e testes SQL são estruturados.

Depois implemente utilizando os mecanismos existentes.

Não crie uma segunda arquitetura financeira paralela.

---

# 27. Resultado esperado

Ao final deve ser possível realizar este fluxo:

```text
Financeiro
    ↓
Conciliação Bancária
    ↓
Selecionar Caixa
    ↓
Importar arquivo OFX
    ↓
ERP lê 34 movimentos
    ↓
compara com Fluxo de Caixa
    ↓
compara com A Pagar / A Receber
    ↓
mostra:
    18 encontrados
     8 prováveis
     2 ambíguos
     6 novos
    ↓
usuário revisa
    ↓
seleciona movimentos
    ↓
Confirmar conciliação
    ↓
movimentos existentes são vinculados
títulos são baixados
novos movimentos são criados
ignorados ficam registrados
    ↓
arquivo passa a constar no histórico
```

A experiência deve permitir que o usuário importe novamente um extrato com período sobreposto sem criar duplicidade.

---

# 28. Qualidade do código

Priorize:

* TypeScript tipado;
* funções pequenas;
* regras de comparação fora de componentes React;
* testes de funções puras;
* dinheiro em centavos;
* reutilização das regras financeiras existentes;
* mensagens de erro em português;
* UI compatível com o restante do ERP;
* tratamento correto de concorrência;
* operações financeiras atômicas;
* nenhum `any` novo sem justificativa;
* comentários apenas onde a regra de negócio não for óbvia.

Não faça abstrações genéricas desnecessárias.

Estamos implementando uma funcionalidade real primeiro. A grande reorganização estrutural do financeiro será feita depois.

Ao terminar:

1. liste todos os arquivos criados;
2. liste todos os arquivos alterados;
3. explique as migrations;
4. explique como a detecção de duplicidade funciona;
5. explique o algoritmo de matching;
6. explique como a baixa de título foi integrada;
7. explique como a atomicidade foi garantida;
8. informe quais testes foram criados e executados;
9. informe eventuais casos financeiros que ficaram deliberadamente para revisão manual;
10. não considere a tarefa concluída se TypeScript, lint, testes relevantes ou migrations estiverem falhando.
