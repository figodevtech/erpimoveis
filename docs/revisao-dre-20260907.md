# Revisão da DRE e padronização do plano de contas

Data: 07/09/2026. Escopo: análise do código e consultas em transações `READ ONLY`
nos bancos Demonstração, Demir, AlphaGarage e Garage Premium. Nenhum cadastro,
lançamento, configuração ou função foi alterado nesta revisão. Stone permanece
fora desta proposta.

## Conclusão

O sistema já tem um motor de DRE e um template comuns aos clientes. A receita de
OS e vendas é classificada automaticamente pela origem dos eventos. Entretanto,
a classificação das transações avulsas depende de grupos locais do plano de
contas, e algumas movimentações financeiras ainda não têm representação própria
no resultado. Por isso, hoje a mesma aplicação pode produzir DREs com cobertura
e classificações diferentes em cada oficina.

A recomendação é criar um catálogo padrão de contas e uma classificação de
resultado obrigatória e estável, preservando contas personalizadas vinculadas a
esse padrão. Copiar nomes e códigos entre bancos, sozinho, não resolve.

## 1. De onde vêm as receitas

A tela chama `/api/dre`; o cálculo usa `dre_somar_por_linha`, que soma
`eventos_financeiros` com status `ATIVO` ou `CONVERTIDO` e competência dentro do
período. Primeiro vale `dre_linha_id` gravado no evento; na ausência dele,
procura-se o mapeamento da combinação `origem:natureza`.

| Fonte | Reconhecimento atual | Destino na DRE | Depende do plano local? |
|---|---|---|---|
| Produtos de OS, inclusive avulsos | Encerramento da execução, pela competência dos eventos | 1.1 Receita de produtos | Não, usa `PRODUTO:RECEITA` |
| Serviços de OS | Encerramento da execução | 1.2 Receita de serviços | Não, usa `SERVICO:RECEITA` |
| Produtos de vendas | `datavenda`, quando o status reconhece receita | 1.1 Receita de produtos | Não |
| Frete cobrado de OS/vendas | Competência do documento | 1.3 Outras receitas da atividade | Não, usa `FRETE:RECEITA` |
| Receita avulsa do financeiro | `competencia_em`, com fallback em `data` | Destino do grupo da conta escolhida | Sim |
| Rendimentos, juros e outras entradas avulsas | Mesmo caminho das transações | Em geral 10.1, conforme o grupo | Sim; a classificação pode ser inadequada |
| Recuperações/desonerações em compras | Competência da entrada fiscal | 4.9, reduzindo o custo | Não são faturamento, embora o evento use natureza `RECEITA` |

Os status de venda reconhecidos pela função atual são `PAGAMENTO`, `FINALIZADA`,
`PAGO` e `AUTORIZADO`. Na OS, a nova etapa opcional de faturamento não deve mudar
a competência já reconhecida no encerramento da execução.

Receber uma parcela não cria uma segunda receita da OS/venda. A sincronização
das transações ignora recebimentos vinculados a documentos, pagamentos múltiplos,
adiantamentos, transferências e outras fontes que já têm tratamento próprio.
Esse comportamento deve ser preservado.

**A suposição sobre contas padrão é parcialmente correta:** há destinos padrão
na DRE para receitas automáticas, mas isso não significa que todo recebimento
tenha uma conta padrão preenchida em `transacao`. AlphaGarage não tem nenhuma
conta cadastrada e tem receitas de OS na DRE. Garage também tem recebimentos de
OS sem conta e receitas corretamente classificadas pelos eventos.

Na conferência da identidade bruto + frete − desconto = total do documento,
fecharam **197 OS com execução encerrada e eventos** e **96 vendas com status
reconhecido**, considerando o histórico disponível dos quatro bancos. Uma
consulta adicional não encontrou OS não excluída com execução encerrada e sem
evento ativo/convertido de receita. Isso valida esses vínculos; não valida a
correção de todos os demais componentes do lucro.

## 2. Deduções da receita

| Linha | Como funciona hoje | Avaliação |
|---|---|---|
| 2.1 Impostos sobre vendas e serviços | Transações classificadas em grupos como “Impostos e taxas”, “Tributos e taxas” e “Deduções de receita” | O grupo é amplo demais; mistura finalidades |
| 2.2 Devoluções | Existe no template, sem mapeamento automático encontrado | Falta um fluxo de resultado próprio |
| 2.3 Cancelamentos | Existe no template; o cancelamento do documento cancela eventos | Não há apresentação automática nessa linha; não adicionar dedução sem revisar a reversão existente |
| 2.4 Abatimentos | Existe no template, sem mapeamento automático encontrado | Falta distinguir do desconto comercial e da perda financeira |
| 2.5 Descontos incondicionais | Eventos `DESCONTO` de OS e vendas | Automático, separado da receita bruta |

Não foi encontrada apuração automática geral dos tributos sobre a receita a
partir das notas emitidas. A linha 2.1 depende dos lançamentos financeiros
classificados. Campos fiscais de NF-e/NFS-e não devem ser confundidos com um
livro completo de obrigações tributárias da DRE.

Como referência de apresentação, o art. 187 separa deduções das vendas, despesas
operacionais/financeiras e imposto sobre o resultado. Portanto, uma regra
“todo imposto vai para dedução da receita” não serve como padrão. O tratamento
de DAS, tributos próprios, retenções e créditos precisa considerar a operação e
o perfil tributário da oficina. [Lei 6.404, art. 187](https://www.planalto.gov.br/ccivil_03/leis/l6404consol.htm#art187).

### Evidência no Demir — competência agosto/2026

Na linha 2.1 estão **R$ 943.565,20**, dos quais **R$ 23.777,85** vêm de contas
denominadas IRPJ (R$ 16.162,76) e CSLL (R$ 7.615,09). A estrutura já possui o
grupo 13 para tributos sobre o lucro, mas o mapeamento por grupo leva essas
contas à dedução da receita.

O mesmo grupo também contém IPTU e taxas municipais/alvarás. A existência dessas
contas nesse grupo é um problema de classificação potencial; os valores de
agosto acima são especificamente dos eventos efetivamente encontrados na DRE.

Esses números descrevem o cadastro e a competência atualmente gravados, não uma
validação do imposto devido ou do documento fiscal. O volume de lançamentos de
Simples Nacional em agosto também exige conferência das obrigações e de suas
competências antes de ser usado para avaliar desempenho. Mudar IRPJ/CSLL de
grupo corrige receita líquida e margens intermediárias, mas, mantendo os mesmos
valores uma única vez, não muda o resultado líquido final.

### Ajustes financeiros são outro fluxo

`transacao_ajuste` recalcula `valor`, `valor_acrescimos`, `valor_descontos` e
`valorLiquido` do título. Não gera um evento de DRE por ajuste. A sincronização
avulsa usa `transacao.valor`, sem decompor principal, juros e descontos; títulos
de OS/venda ficam fora dessa sincronização para evitar duplicar receita.

Assim, uma taxa descontada do recebimento não vira automaticamente uma despesa
financeira identificável. No cadastro atual, por exemplo:

- Demir: taxas de recebimento vinculadas a vendas de R$ 2.156,24 e a OS de
  R$ 745,19, no histórico consultado.
- Garage: taxa de recebimento de OS de R$ 213,00 e taxa de antecipação de
  R$ 730,00.

Esses são valores dos ajustes, não um total certificado de despesas ausentes:
é necessário conciliar eventuais lançamentos manuais equivalentes antes de
gerar eventos retroativos. Juros, multas, taxas, descontos comerciais,
retenções e perdão de dívida precisam de destinos próprios; um único campo
“desconto” não identifica o efeito contábil de todos eles.

## 3. Diferenças entre os clientes

| Banco | Grupos cadastrados | Contas cadastradas | Observação |
|---|---:|---:|---|
| Demonstração | 15 | 197 | “Despesas comerciais” sem mapeamento de grupo |
| Demir | 9 | 108 | Grupos amplos misturam várias linhas da DRE |
| AlphaGarage | 0 | 0 | Receita automática funciona; falta base para classificar avulsos |
| Garage Premium | 16 | 103 | “EQUIPAMENTOS DE SEGURANÇA” sem destino; ainda sem contas vinculadas |

As duas funções centrais de soma e sincronização avulsa têm definições idênticas
nos quatro bancos. A divergência acima é dos cadastros e mapeamentos.

Outros achados concretos, com competência em **agosto/2026**:

- **Demir:** cinco receitas de R$ 16.570,00 e uma despesa de R$ 800,00 têm evento
  sem linha; não entram nos totais.
- **Garage:** dez despesas de R$ 22.918,75 têm evento sem linha; não entram nos
  totais. A falta de conta dessas transações é independente do grupo novo ainda
  sem contas.
- **Demir:** 90 transações na conta “Despesas não identificadas”, somando
  R$ 146.999,20, estão num grupo explicitamente excluído do resultado. Não são
  tratadas como pendências comuns. Não é correto presumir que todas devam entrar
  como despesas: primeiro é necessário identificar sua natureza.
- **Demir:** a conta “Venda de ativo imobilizado” leva R$ 336.000,00 para
  “Receitas financeiras”. A classificação não distingue recebimento pela venda
  de um bem e ganho/perda na baixa. O ganho depende também do valor contábil do
  ativo, que não foi apurado nesta revisão. [CPC 27, itens 67–71](https://conteudo.cvm.gov.br/export/sites/cvm/menu/regulados/normascontabeis/cpc/CPC_27_rev_12.pdf).
- **Demonstração:** três eventos de transações de natureza `DESPESA`, totalizando
  R$ 766,66, estão na linha de receita de serviços. É evidência de que a natureza
  da transação não é validada contra o destino da conta; não representa uma
  ocorrência confirmada nos demais clientes.

## 4. Limitações da classificação atual

1. O cadastro permite criar e editar grupos/contas sem indicar seu destino na
   DRE. Não há gatilho de criação de mapeamento para novos grupos.
2. O mapeamento inicial foi sugerido por palavras no nome dos grupos, durante a
   migração. “Receitas” vai para serviços; “Impostos” vai para 2.1. Renomear ou
   criar uma conta não lhe atribui uma identidade de negócio estável.
3. `sincronizar_eventos_financeiros_transacao` lê apenas `PLANO_GRUPO`. O banco
   aceita `PLANO_CONTA` e `CATEGORIA_TRANSACAO`, mas essa função não os utiliza.
4. Para avulsos, a resolução também não aplica template, vigência e percentual
   de rateio do mapeamento; usa o primeiro grupo ativo encontrado.
5. O destino é persistido no evento. Trocar o grupo de uma conta ou alterar o
   mapeamento não tem uma política explícita de reclassificação dos eventos
   antigos. Uma alteração posterior na transação pode resolver a linha de novo.
6. A DRE apresenta alertas, mas não oferece uma fila completa para resolver as
   pendências. As consultas dos alertas também convertem ausência de resultado
   em zero sem tratar individualmente os erros de consulta.
7. Não há fechamento de período implementado no fluxo inspecionado. Ter uma
   tabela de versões de template não basta para congelar uma apuração.

### Particularidade fiscal que impede um padrão universal cego

A política atual de entrada coloca certos tributos, como ICMS-ST e imposto de
importação, diretamente no resultado do mês da nota. Está documentada no código
como uma decisão gerencial anterior. O contexto fiscal recebido pela função
ainda não determina essas regras por regime/CST.

Essa política não pode ser generalizada automaticamente como regra contábil:
o CPC 16 inclui tributos não recuperáveis e custos atribuíveis à aquisição no
custo do estoque. A decisão entre custo, crédito recuperável e resultado precisa
ser revisada por operação e perfil do adquirente. Esta revisão não alterou a
política existente. [CPC 16, itens 10–11](https://conteudo.cvm.gov.br/export/sites/cvm/menu/regulados/normascontabeis/cpc/CPC_16_R1_rev_13.pdf).

## 5. Padrão recomendado

Preservar a estrutura comum da DRE e acrescentar um catálogo de contas do
sistema, com chaves de significado estável. IDs locais e nomes exibidos não
devem determinar a classificação.

| Família padrão | Exemplos | Destino proposto |
|---|---|---|
| Receita operacional | Produtos, serviços, frete cobrado | 1.1, 1.2, 1.3 |
| Deduções comerciais | Descontos, devoluções, abatimentos | Linhas específicas do grupo 2 |
| Tributos sobre receita | Conforme obrigação e perfil fiscal | 2.1, com detalhamento |
| Custos | CMV, terceiros, realização dos serviços | Linhas específicas do grupo 4 |
| Despesas operacionais | Pessoal, administração, comercial, estrutura | Linhas específicas do grupo 6 |
| Resultado financeiro | Juros, tarifas, antecipação | 10.1/10.2 conforme a natureza |
| Outros resultados | Ganho/perda na alienação de ativos | Destino próprio, considerando a baixa do ativo |
| Tributos sobre lucro | IRPJ e CSLL quando apurados separadamente | Grupo 13 |
| Movimentações patrimoniais | Aporte, principal de empréstimo, transferência | Fora da DRE, com motivo explícito |
| A classificar | Natureza ainda desconhecida | Pendência visível; nunca exclusão definitiva automática |

Cada conta padrão deve ter chave estável, natureza permitida, destino de DRE ou
motivo de exclusão e origem prevista. Contas personalizadas continuam possíveis,
mas precisam apontar para uma classificação padrão válida. A oficina pode criar
“Reparo de módulos” e “Programação” como contas distintas e ambas alimentarem
receita de serviços.

Uma precedência proposta é: classificação explícita e auditada do lançamento,
regra específica da conta, classificação padrão herdada e, na ausência delas,
pendência. A resolução deve ser única para gravação, soma, detalhamento e badge
da transação, respeitando competência, vigência e versão do relatório.

O que deve variar por cliente é o cadastro complementar, o perfil fiscal e a
operação real. O significado de receita, dedução, custo, despesa e movimentação
patrimonial deve permanecer comum.

## 6. Ordem de implementação proposta

1. **Classificação e integridade:** implementar o catálogo padrão e o mapeamento
   por conta; validar natureza; criar fila com valores sem destino e exclusões
   suspeitas. Separar impostos sobre receita de tributos sobre lucro.
2. **Cobertura dos eventos:** dar tratamento explícito a taxas, juros, descontos
   financeiros, perdas e devoluções. Confrontar ajustes com despesas já lançadas
   antes de qualquer processamento retroativo. Rever política de tributos de
   compra e apuração fiscal com as regras aplicáveis a cada oficina.
3. **Migração e controle dos períodos:** mapear as contas existentes sem apagar
   IDs ou histórico, apresentar comparação antes/depois por cliente, definir a
   vigência e o tratamento do passado, e depois implantar fechamento e exportação.

Critérios de aceite: nenhuma receita/despesa sem destino some sem indicar seu
valor; nenhum recebimento duplica receita do documento; imposto sobre lucro não
reduz receita operacional; ajustes de recebimento têm rastreabilidade; contas
personalizadas mantêm o mesmo significado entre clientes; detalhamento fecha
com o total; reclassificação histórica é explícita e auditável.

## 7. Referências técnicas e limites da conferência

- [`/api/dre/_calculo.ts`](../src/app/api/dre/_calculo.ts): template, RPC e árvore.
- [`/api/dre/route.ts`](../src/app/api/dre/route.ts): períodos e alertas.
- [`/api/tipos/planos-de-conta/route.ts`](../src/app/api/tipos/planos-de-conta/route.ts): cadastro sem classificação de DRE.
- [`20260802180000`](../supabase/migrations/20260802180000_dre_template_linha_mapeamento.sql): template e sugestão por nomes.
- [`20260828170000`](../supabase/migrations/20260828170000_transferencia_saque_deposito.sql): sincronização avulsa atual, conferida com a função publicada.
- [`20260806140000`](../supabase/migrations/20260806140000_acrescimos_e_descontos_transacao.sql): ajustes do título, conferidos com as funções publicadas.
- [`tratamento-custo.ts`](../src/lib/nfe/tratamento-custo.ts): política gerencial de tributos de entrada.

Os valores mensais usam agosto/2026 e os limites UTC utilizados atualmente pela
API da DRE. Os totais de cadastros e os exemplos de ajustes financeiros usam o
histórico disponível na consulta. Reconciliação de competências fiscais,
originais dos documentos, autenticidade de lançamentos e eventual contrapartida
manual de cada taxa não fizeram parte desta conferência.

As identidades de receita foram verificadas com consultas SELECT derivadas do
script existente de conferência. O script completo utiliza tabelas temporárias
e não foi executado até o fim em `READ ONLY`; nenhuma escrita foi liberada para
contornar essa restrição. Evidências agregadas e definições consultadas estão
em `artifacts/captures/dre-review/`, diretório local ignorado pelo Git.
