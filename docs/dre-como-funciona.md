# DRE — como funciona, em português

Este documento é para quem trabalha no financeiro ou para o contador. Ele
explica de onde vem cada número da DRE do sistema, quando esse número entra no
mês e o que precisa ser feito por uma pessoa.

Não é preciso entender nada de programação para ler.

---

## 1. Para que serve

A DRE responde uma pergunta: **a empresa deu lucro ou prejuízo no período, e por
quê?**

Ela parte do faturamento, desconta impostos, custos e despesas, e chega ao
resultado. Cada linha do relatório pode ser aberta para mostrar os lançamentos
que a formaram.

---

## 2. A regra de ouro: todo número vem de um lançamento

A DRE **não calcula nada por conta própria** e não tem números digitados
diretamente nela. Todo valor do relatório é a soma de lançamentos que já existem
no sistema.

Isso tem duas consequências práticas:

**Qualquer número pode ser rastreado.** Clicando no valor de uma linha, o sistema
mostra a lista dos lançamentos que a compõem, com a data e o documento de origem
— a ordem de serviço, a venda ou o lançamento do financeiro.

**Se algo está errado na DRE, o erro está na origem.** Não se corrige a DRE; se
corrige a OS, a venda ou o lançamento no financeiro. No instante seguinte a DRE
já mostra o valor novo.

---

## 3. Quando o valor entra no mês

Este é o ponto que mais gera dúvida, e é o que separa esta DRE do fluxo de caixa.

A DRE usa **regime de competência**: o valor entra no mês em que o fato
aconteceu, não no mês em que o dinheiro entrou ou saiu na conta.

| Situação | Entra na DRE em |
|---|---|
| OS entregue em 28 de agosto, cliente paga em 10 de setembro | **agosto** |
| Venda de balcão feita em 5 de agosto, parcelada em 3x | **agosto**, o valor inteiro |
| Conta de luz de julho, paga em 12 de agosto | **julho**, se a competência for informada |

Cada origem tem sua data de competência:

- **Ordem de serviço** — a data em que a execução foi encerrada. É o sistema que
  carimba essa data quando a OS passa para pagamento; ninguém digita.
- **Venda** — a data da venda. Venda de balcão se conclui no ato.
- **Lançamento do financeiro** — o campo *competência*, que fica ao lado da data
  tanto no cadastro quanto na edição. Deixando em branco, o sistema usa a data do
  lançamento.

Sobre esse campo, três coisas que ajudam no dia a dia:

**Informe no cadastro, não depois.** A competência é o que decide o mês do
relatório. Lançar a conta de luz de julho com data de pagamento em agosto e
deixar a competência em branco joga a despesa para agosto.

**Num gasto parcelado, a competência é uma só.** Uma compra de julho em 3x tem
três vencimentos e um único mês de competência — julho. O valor informado vale
para todas as parcelas, e a despesa inteira aparece no mês em que foi feita, em
vez de espalhada por três meses.

**Em pagamento de OS ou de venda o campo não aparece.** Ali a competência é do
documento: a OS compete ao mês em que foi entregue, a venda ao mês em que foi
feita. Se aparecesse editável, daria para colocar a receita num mês e o documento
em outro.

**Consequência importante:** OS que ainda não foi entregue **não aparece na DRE**,
mesmo que já tenha orçamento aprovado e peças reservadas. O serviço não foi
prestado, então não há receita. Ela entra no mês em que for concluída.

---

## 4. As três portas de entrada

Tudo que chega à DRE vem de um destes três lugares:

### Ordem de serviço

Quando a OS é concluída, o sistema registra automaticamente:

- a **receita** de cada serviço, pelo preço de tabela;
- a **receita** de cada peça aplicada, pelo preço de tabela;
- o **custo** de cada peça, pelo valor de custo congelado no momento da aplicação;
- a **comissão** dos realizadores;
- o **frete**, se houver;
- o **desconto** concedido, como dedução.

Repare que receita e desconto são registrados separadamente. Se a OS tem
R$ 3.800 de serviço com 5% de desconto, o sistema registra R$ 3.800 de receita
**e** R$ 190 de desconto. O líquido continua R$ 3.610, mas o relatório passa a
mostrar quanto de desconto a oficina concedeu — o que some se registrarmos só o
valor final.

### Venda

Quando a venda é finalizada ou paga, o sistema registra:

- a **receita** de cada produto, pelo preço de tabela;
- o **custo** de cada produto;
- o **frete** cobrado;
- o **desconto** concedido, como dedução.

Venda em orçamento, aguardando aprovação ou recusada **não entra na DRE**. Só
entra quando vira operação concluída.

A comissão do vendedor também gera despesa pelo valor apurado em `venda_comissao`.
A integração começa nas vendas de setembro de 2026; meses anteriores são preservados.
Lançar ou pagar a comissão não cria uma segunda despesa na DRE.

### Lançamento do financeiro

É por aqui que entram aluguel, salários, energia, contador, tarifas bancárias,
impostos — tudo que não nasce de uma OS ou de uma venda.

**O que decide o destino de um lançamento do financeiro é a conta do plano de
contas escolhida nele.** Sem conta escolhida, o lançamento não entra na DRE:
o sistema prefere deixar de fora a chutar uma classificação errada, porque
número errado que parece certo é pior que número ausente.

---

## 5. O que NÃO entra na DRE, de propósito

Nem todo dinheiro que se move é resultado. O sistema ignora:

| O que | Por quê |
|---|---|
| Pagamento de OS ou de venda pelo cliente | A receita já foi registrada quando a OS foi entregue ou a venda concluída. Contar de novo dobraria o faturamento. |
| Compra de peças para o estoque | Comprar não é despesa — é trocar dinheiro por mercadoria. Vira custo quando a peça sai, na linha de custo das mercadorias. |
| Antecipação de recebíveis | É empréstimo com garantia dos títulos, não faturamento novo. |
| Aporte de sócio, retirada, empréstimo, transferência entre contas | Movimentação de patrimônio ou de caixa, não resultado. |
| Saldo trazido de sistema anterior | O fato econômico aconteceu antes de o ERP existir. |
| Compra de máquina, ferramenta, imobilizado | Vira patrimônio, e entra no resultado aos poucos, como depreciação. |

As quatro últimas dependem de o lançamento estar numa conta do plano de contas
cuja linha é **fora do resultado** — seja a linha da própria conta, seja a do
grupo dela.

---

## 6. De onde vem cada linha

| Linha | De onde vem |
|---|---|
| **1 RECEITA BRUTA** | soma de 1.1, 1.2 e 1.3 |
| 1.1 Receita de venda de produtos | peças aplicadas em OS + produtos vendidos em venda, pelo preço de tabela |
| 1.2 Receita de prestação de serviços | serviços da OS, pelo preço de tabela |
| 1.3 Outras receitas da atividade | frete cobrado em OS e em venda |
| **2 DEDUÇÕES DA RECEITA** | soma de 2.1 a 2.5 |
| 2.1 Impostos sobre vendas e serviços | lançamentos do financeiro em conta com linha 2.1 (Simples, ISS, ICMS, PIS, COFINS) |
| 2.2 Devoluções | lançamentos do financeiro em conta com linha 2.2 — devolução não existe como operação própria |
| 2.3 Cancelamentos | só por conta com linha 2.3 — cancelar a OS ou a venda já tira a receita |
| 2.4 Abatimentos | só por conta com linha 2.4 |
| 2.5 Descontos incondicionais | desconto concedido em OS e em venda |
| **3 RECEITA LÍQUIDA** | 1 − 2 |
| **4 CUSTOS** | soma de 4.1 a 4.7 |
| 4.1 Custo das mercadorias vendidas | custo das peças e produtos que saíram, congelado no momento da saída |
| 4.2 Custo dos produtos vendidos | *sem origem automática* — todo custo de item vai para 4.1 |
| 4.3 Custo dos serviços prestados | despesa lançada dentro da OS ligada a um serviço + contas com linha 4.3 |
| 4.4 Materiais aplicados | contas com linha 4.4 |
| 4.5 Mão de obra direta | comissões dos realizadores e vendedores |
| 4.6 Serviços terceirizados diretos | contas com linha 4.6 |
| 4.7 Outros custos diretos | contas com linha 4.7 |
| **5 LUCRO BRUTO** | 3 − 4 |
| **6 DESPESAS OPERACIONAIS** | soma de 6.1 a 6.6 — **tudo vem do financeiro**, pela conta do plano de contas |
| 6.1 Despesas comerciais | contas com linha 6.1 (propaganda, feiras, comissão de terceiros, envio ao cliente) |
| 6.2 Despesas administrativas | contas com linha 6.2 (contabilidade, jurídico, seguros, taxas) |
| 6.3 Despesas com pessoal | contas com linha 6.3 (salários, encargos, benefícios) |
| 6.4 Despesas de ocupação | contas com linha 6.4 (aluguel, energia, água, IPTU, manutenção predial) |
| 6.5 Despesas com tecnologia | contas com linha 6.5 (sistemas, internet, telefone) |
| 6.6 Outras despesas operacionais | contas com linha 6.6 — só o que não cabe nas anteriores |
| **7 EBITDA GERENCIAL** | 5 − 6 |
| **8 DEPRECIAÇÃO E AMORTIZAÇÃO** | **só lançamento manual** — o sistema não controla patrimônio |
| **9 RESULTADO OPERACIONAL** | 7 − 8 |
| **10 RESULTADO FINANCEIRO** | 10.1 − 10.2 |
| 10.1 Receitas financeiras | rendimento de aplicação, juros recebidos — pelo plano de contas |
| 10.2 Despesas financeiras | juros pagos, tarifas bancárias, deságio de antecipação — pelo plano de contas |
| **11 OUTRAS RECEITAS E DESPESAS** | 11.1 outros ganhos e 11.2 outras perdas, pelas contas com essa linha (ex.: aluguel recebido, despesa não identificada) |
| **12 RESULTADO ANTES DOS TRIBUTOS** | 9 + 10 + 11 |
| **13 TRIBUTOS SOBRE O LUCRO** | contas com linha 13.1 (IRPJ), 13.2 (CSLL) ou 13.3 |
| **14 RESULTADO LÍQUIDO** | 12 − 13 |

### Resumindo por origem

- **Vem da ordem de serviço**: 1.1, 1.2, 1.3, 2.5, 4.1, 4.3, 4.5
- **Vem da venda**: 1.1, 1.3, 2.5, 4.1
- **Vem do financeiro (linha escolhida no plano de contas)**: qualquer linha de
  detalhe — é a conta do lançamento que decide
- **Só por lançamento manual**: 8 (não há controle de patrimônio)
- **Sem origem automática**: 2.3, 2.4, 4.2 — só recebem valor se alguma conta
  apontar para elas

---

## 7. O plano de contas é o que organiza a despesa

Toda a parte de despesa da DRE (linha 6) e as deduções (2.1) e o resultado
financeiro (10) dependem de **como o plano de contas da empresa está montado**.

Em **Configurações → Tipos → Planos de conta**, cada grupo e cada conta têm uma
**linha da DRE**. A regra é:

1. se a conta tem linha própria, vale a da conta;
2. senão, vale a linha do grupo;
3. se nenhum dos dois foi escolhido, vale o destino antigo do grupo, e a tela
   mostra "Pelo grupo — nenhuma linha escolhida ainda".

Um exemplo real, do Demir:

```
Grupo "Impostos e taxas"        ->  2.1 Impostos sobre vendas e serviços
  conta "Simples Nacional"      ->  segue o grupo (2.1)
  conta "IRPJ"                  ->  13.1 IRPJ           (linha própria)
  conta "IPTU"                  ->  6.4 Ocupação        (linha própria)
Grupo "Movimentações não op."   ->  fora do resultado
  conta "Despesas não identif." ->  11.2 Outras perdas  (linha própria)
```

Qualquer linha pode ser escolhida para qualquer conta. O que o sistema protege é
a **natureza**: numa conta com linha de receita, lançamento de despesa não entra
em linha nenhuma e aparece na fila de pendências.

**Mudar a linha corrige todo o histórico.** Ao salvar, os lançamentos já feitos
naquela conta são refeitos e a DRE dos meses anteriores muda junto. Para quando
a regra mudou de verdade — uma troca de regime tributário, por exemplo —, a
tela deixa escolher "só a partir de uma data", e os meses anteriores ficam como
estavam.

Duas coisas importantes disso:

**O detalhe da DRE nunca é melhor que o detalhe do plano de contas.** Se aluguel,
material de escritório e propaganda estiverem todos numa conta só, a DRE não
consegue separá-los.

**A linha segue a conta, não o lançamento.** Uma parcela de dívida lançada na
conta "Simples Nacional" vai para 2.1 como se fosse o DAS do mês. Lançamento na
conta errada se corrige no lançamento.

Conta ou grupo sem linha nenhuma aparecem na fila de pendências da DRE, com a
quantidade — nada some do relatório sem aviso.

---

## 8. Como conferir um número

1. Abra a DRE e escolha o período.
2. Clique no valor da linha que quer conferir.
3. No topo, **De onde vem o valor** reparte a linha por origem — ordens de
   serviço, vendas, entradas de nota e cada plano de conta dos lançamentos do
   financeiro —, com valor e percentual. Clicar numa origem mostra só os
   lançamentos dela.
4. Abaixo vêm os lançamentos, com busca, filtro entre "do sistema" e "avulsos",
   e ordem por valor ou data. Clicar no documento (OS, venda, entrada ou
   lançamento) abre o documento.
5. No rodapé aparece o total, com a confirmação de que ele bate com o valor da
   linha.

**Lançamento no plano de conta errado?** Nos avulsos, o nome do plano de conta é
clicável. Ele abre a troca de linha: escolhida a nova linha, **todos** os
lançamentos daquele plano, em qualquer mês, vão junto, e a DRE é refeita na
hora. Mover exige a permissão de editar configurações.

Clicar numa linha de grupo (como "CUSTOS") traz também as linhas filhas. Linhas
de fórmula — receita líquida, lucro bruto, EBITDA — não abrem, porque são
cálculo, não lançamento.

---

## 9. O que depende de uma pessoa

O sistema não resolve sozinho:

**Classificar os lançamentos do financeiro.** Lançamento sem conta do plano de
contas não entra na DRE. Se o relatório parece baixo em despesa, é o primeiro
lugar para olhar.

**Cadastrar o custo dos produtos.** Produto vendido sem custo cadastrado entra
com custo zero, e a margem daquele item aparece como 100% — que é falso. O
sistema marca esses casos, mas não inventa um custo.

**Lançar depreciação e os tributos sobre o lucro.** As linhas 8 e 13 só aceitam
lançamento manual. Sem elas, o resultado líquido fica otimista.

**Revisar o mapeamento com o contador.** A ligação entre os grupos do plano de
contas e as linhas da DRE é decisão contábil. O sistema sugere automaticamente,
mas a sugestão precisa de revisão antes de o relatório ser tratado como oficial.

**Conferir o regime tributário.** Numa empresa do Simples, os tributos estão
dentro do DAS e pertencem às deduções (2.1), não à linha 13.

---

## 10. Limitações que você precisa conhecer

**Três linhas só recebem valor por conta do plano.** 2.3 Cancelamentos, 2.4
Abatimentos e 4.2 não têm origem automática: aparecem zeradas até alguma conta
apontar para elas. Devolução de venda também não existe como operação — a 2.2
vem das contas com essa linha.

**Não há fechamento de período.** A DRE de um mês passado pode mudar se alguém
corrigir uma OS antiga, lançar uma despesa com competência retroativa ou mudar a
linha de uma conta — que, por padrão, corrige todo o histórico. Isso é bom para
corrigir erros e ruim para um relatório já entregue ao contador. O travamento de
período está previsto e ainda não foi construído.

**Não há exportação.** O relatório é visto na tela; não há PDF nem planilha.

**A comissão é calculada sobre o valor líquido.** Mesmo com a receita mostrada
pelo valor de tabela, a comissão continua sendo calculada sobre o que o cliente
efetivamente pagou. Mudar a forma de exibir a receita não muda quanto alguém
recebe.

---

## 11. Como os totais são calculados

Vale entender, porque explica o formato do relatório.

As linhas de **grupo** (1, 2, 4, 6, 10, 13) somam as linhas filhas. As linhas de
**fórmula** combinam os grupos:

```
3   RECEITA LIQUIDA              = 1 - 2
5   LUCRO BRUTO                  = 3 - 4
7   EBITDA GERENCIAL             = 5 - 6
9   RESULTADO OPERACIONAL        = 7 - 8
12  RESULTADO ANTES DOS TRIBUTOS = 9 + 10 + 11
14  RESULTADO LIQUIDO            = 12 - 13
```

Repare que deduções, custos e despesas aparecem no relatório como **números
positivos** — é a fórmula que os subtrai. Isso é proposital: o contador lê
"R$ 132.167,80 de deduções", não "menos R$ 132.167,80".

A exceção é a linha 10, Resultado financeiro. Ela é a única que junta uma receita
(10.1) e uma despesa (10.2) dentro do mesmo grupo, então carrega o resultado
líquido dos dois e pode aparecer negativa:

```
10.1  Receitas financeiras       R$     0,12
10.2  Despesas financeiras       R$ 2.223,68
10    RESULTADO FINANCEIRO       R$ -2.223,56
```

Se as despesas financeiras superam as receitas — o normal numa oficina que paga
tarifas e antecipa recebíveis —, essa linha é negativa e **reduz** o resultado
antes dos tributos.

> Correção aplicada em 17/08/2026: até essa data a linha 10 somava a despesa em
> vez de subtraí-la, e o resultado líquido aparecia maior pelo dobro das
> despesas financeiras. No Demir eram R$ 4.447,36 de lucro a mais. Se você
> guardou algum relatório tirado antes dessa data, ele tem esse erro.

## 12. Imprimir a DRE

O botão **Imprimir DRE**, no topo da tela, abre a folha A4 do período escolhido
numa aba nova. Ali estão **Baixar PDF** e **Imprimir**.

A impressão mais nítida é pelo **Imprimir** — inclusive para gerar arquivo, com
"Salvar como PDF" no destino: o texto sai vetorial, nítido em qualquer ampliação.
O **Baixar PDF** gera a folha como imagem em alta resolução (cerca de 290 dpi),
boa para enviar, mas não tão fina quanto o texto vetorial.

A folha não refaz conta nenhuma: ela lê a mesma apuração da tela
(`apurarDre`), então os valores, o período anterior e os percentuais são
idênticos. O que muda é a apresentação:

- sai a demonstração **inteira**, mesmo que algum grupo esteja recolhido na tela;
- tudo cabe em **uma folha**. O modelo padrão (44 linhas) sobra com folga; se o
  conteúdo crescer, a fonte e o espaçamento das linhas diminuem sozinhos até
  caber, até cerca de três quartos do tamanho normal;
- só um modelo grande demais para isso vai para uma segunda folha — e aí título
  de grupo não fica sozinho no pé da folha, resultado não abre a folha seguinte
  longe da linha de cima, e a segunda folha repete empresa e período;
- a folha tem "Documento gerado pelo ERP em …" e "Página X de Y".

As pendências da tarja amarela não saem no papel. Antes de entregar uma DRE,
confira a tela.
