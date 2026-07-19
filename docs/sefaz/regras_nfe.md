---
title: Regras de emissão de NF-e e NFC-e por CRT
file: regras_nfe.md
version: 1.0.0
updated_at: 2026-07-19
scope:
  - NF-e modelo 55
  - NFC-e modelo 65
  - CRT 1, 2, 3 e 4
  - ICMS, ICMS-ST, FCP, DIFAL, PIS, COFINS, IPI, II, IBS, CBS e IS
status: implementation-spec
---

# REGRAS NF-e/NFC-e POR CRT

> Especificação funcional e técnica para implementação de um emissor de NF-e modelo 55 e NFC-e modelo 65.
>
> Este arquivo deve ser lido pelo Codex como **regra de implementação**, não como tabela fiscal pronta para qualquer produto. O sistema precisa combinar CRT, data de emissão, modelo, finalidade, CFOP, NCM, CEST, origem, UFs, perfil do destinatário, benefício fiscal e legislação vigente.

## 1. Objetivo

Implementar um motor de emissão que:

1. selecione o grupo tributário correto para cada CRT;
2. exiba apenas os campos aplicáveis ao cenário;
3. exija campos obrigatórios;
4. proíba tags incompatíveis;
5. calcule valores derivados;
6. valide cruzamentos antes de gerar o XML;
7. suporte regras com vigência;
8. suporte a Reforma Tributária do Consumo sem substituir as regras atuais de ICMS, PIS, COFINS e IPI durante a transição;
9. gere XML conforme o XSD e as regras de validação vigentes;
10. registre a versão da regra usada em cada emissão.

## 2. Limites desta especificação

Este arquivo define a estrutura geral do motor fiscal. Ele não deve ser usado para concluir automaticamente que um NCM possui determinada tributação.

Não inferir somente pelo CRT:

- CFOP;
- NCM;
- CEST;
- incidência de ICMS-ST;
- alíquota interna ou interestadual;
- FCP;
- benefício fiscal;
- CST/CSOSN definitivo;
- CST de PIS/COFINS;
- incidência de IPI;
- CST IBS/CBS;
- `cClassTrib`;
- incidência de Imposto Seletivo.

Essas informações dependem da operação e das tabelas fiscais vigentes.

## 3. Estados de obrigatoriedade

O frontend, a API e o validador devem trabalhar com estes estados:

| Estado | Significado |
|---|---|
| `REQUIRED` | O usuário ou o motor deve informar. Sem o campo, a operação é inválida. |
| `CONDITIONAL` | Obrigatório somente quando a condição fiscal ou técnica for verdadeira. |
| `OPTIONAL` | Pode ser informado, sem ser necessário no cenário atual. |
| `FORBIDDEN` | Não mostrar como editável e não gerar a tag no XML. |
| `DERIVED` | Calculado pelo sistema; não deve depender de digitação livre. |
| `EXTERNAL_TABLE` | Selecionado a partir de tabela oficial versionada. |

### 3.1 Regra para tags vazias

Não gerar tags vazias para campos não aplicáveis.

Errado:

```xml
<pICMS></pICMS>
```

Errado:

```xml
<pICMS>0</pICMS>
```

quando o grupo tributário não admite `pICMS`.

Correto: não gerar a tag.

### 3.2 Zero não substitui ausência

Valor zero somente deve ser transmitido quando:

- o campo existir no grupo XML selecionado;
- o XSD aceitar zero;
- a regra de validação permitir zero;
- o cenário fiscal justificar zero.

Não usar `0`, `0.00` ou string vazia para contornar a obrigatoriedade.

## 4. Hierarquia das regras

Em caso de conflito, aplicar nesta ordem:

1. legislação vigente;
2. leiaute/XSD vigente do documento;
3. regras de validação nacionais da NF-e/NFC-e;
4. regras da UF autorizadora, origem e destino;
5. tabelas oficiais por vigência;
6. contrato da API/provedor de emissão;
7. regras deste arquivo;
8. valores padrão da interface.

Nunca permitir que um valor padrão do frontend substitua uma regra fiscal.

## 5. Códigos de Regime Tributário

| CRT | Descrição | Grupo comum de ICMS |
|---:|---|---|
| `1` | Simples Nacional | CSOSN |
| `2` | Simples Nacional com excesso de sublimite | CST do ICMS |
| `3` | Regime Normal | CST do ICMS |
| `4` | Simples Nacional - Microempreendedor Individual | CSOSN restrito ao MEI |

## 6. Regra principal de escolha entre CSOSN e CST do ICMS

```text
SE a operação usar grupo específico de ICMS monofásico de combustíveis:
    usar o grupo técnico exigido pelo leiaute vigente
    não aplicar cegamente a regra genérica CSOSN x CST
SENÃO SE CRT for 1:
    exigir CSOSN
    proibir CST do ICMS
SENÃO SE CRT for 4:
    exigir CSOSN permitido ao MEI
    proibir CST do ICMS comum
SENÃO SE CRT for 2 ou 3:
    exigir CST do ICMS
    proibir CSOSN
```

### 6.1 Regra de interface

A tela não deve exibir simultaneamente `CSOSN` e `CST ICMS` como campos obrigatórios.

| CRT | CSOSN | CST ICMS |
|---:|---|---|
| 1 | `REQUIRED` | `FORBIDDEN` |
| 2 | `FORBIDDEN` | `REQUIRED` |
| 3 | `FORBIDDEN` | `REQUIRED` |
| 4 | `REQUIRED` | `FORBIDDEN` |

Exceções técnicas, como grupos de combustíveis monofásicos, devem ser resolvidas por uma regra específica anterior à regra genérica.

## 7. Ordem obrigatória de decisão do motor fiscal

O motor deve decidir nesta ordem:

1. data e hora de emissão;
2. ambiente: homologação ou produção;
3. modelo: 55 ou 65;
4. finalidade da NF-e;
5. tipo de operação: entrada ou saída;
6. emitente e CRT;
7. UF de origem e destino;
8. destinatário: contribuinte, não contribuinte ou isento;
9. consumidor final;
10. presença do comprador;
11. natureza da operação;
12. cadastro fiscal do produto;
13. NCM e eventual EX TIPI;
14. CEST, quando aplicável;
15. origem da mercadoria;
16. CFOP;
17. incidência de ICMS próprio;
18. incidência de ICMS-ST;
19. incidência de FCP/FCP-ST;
20. DIFAL;
21. desoneração ou benefício;
22. CSOSN ou CST do ICMS;
23. PIS;
24. COFINS;
25. IPI;
26. II e dados de importação;
27. IBS/CBS conforme data, regime e classificação;
28. Imposto Seletivo;
29. grupos setoriais;
30. cálculo;
31. totalização;
32. geração do XML;
33. validação no XSD;
34. validações fiscais internas;
35. assinatura e transmissão.

## 8. Campos gerais da NF-e/NFC-e

Esta seção descreve os campos centrais do emissor. A lista integral de tags deve ser obtida do XSD vigente.

## 8.1 Identificação do documento (`ide`)

| Campo lógico | Status | Regra |
|---|---|---|
| UF do emitente | `REQUIRED` | Derivar da UF do estabelecimento emitente. |
| Código numérico | `DERIVED` | Gerado pelo sistema para compor a chave. |
| Natureza da operação | `REQUIRED` | Descrição coerente com a operação e o CFOP. |
| Modelo | `REQUIRED` | `55` para NF-e ou `65` para NFC-e. |
| Série | `REQUIRED` | Controlada por estabelecimento, modelo e ambiente. |
| Número da nota | `REQUIRED/DERIVED` | Sequencial sem duplicidade na série. |
| Data/hora de emissão | `REQUIRED` | Com fuso horário. |
| Data/hora de saída/entrada | `CONDITIONAL` | Conforme operação e leiaute. |
| Tipo da NF | `REQUIRED` | Entrada ou saída. |
| Destino da operação | `DERIVED` | Interna, interestadual ou exterior. |
| Município do fato gerador | `REQUIRED` | Código IBGE válido. |
| Tipo de impressão | `REQUIRED` | Conforme modelo e DANFE. |
| Tipo de emissão | `REQUIRED` | Normal ou contingência permitida. |
| Ambiente | `REQUIRED` | Homologação ou produção. |
| Finalidade | `REQUIRED` | Normal, complementar, ajuste ou devolução. |
| Consumidor final | `REQUIRED` | Determinado pelo cenário. |
| Indicador de presença | `REQUIRED/CONDITIONAL` | Conforme operação, modelo e canal. |
| Processo de emissão | `REQUIRED` | Identificar aplicativo emissor. |
| Versão do processo | `REQUIRED` | Versão do sistema que gerou o XML. |
| Referências de documentos | `CONDITIONAL` | Obrigatórias em devolução, complementar, ajuste e outros cenários. |

## 8.2 Emitente (`emit`)

| Campo | Status | Regra |
|---|---|---|
| CNPJ/CPF | `REQUIRED` | Conforme cadastro e permissão do documento. |
| Razão social | `REQUIRED` | Cadastro fiscal oficial. |
| Nome fantasia | `OPTIONAL` | Quando existente. |
| Endereço completo | `REQUIRED` | Logradouro, número, bairro, município, UF, CEP e país. |
| IE | `REQUIRED/CONDITIONAL` | Conforme contribuinte e cadastro estadual. |
| IEST | `CONDITIONAL` | Quando houver inscrição como substituto na UF de destino. |
| IM | `CONDITIONAL` | Quando o documento incluir hipótese que exija IM. |
| CNAE | `CONDITIONAL` | Conforme operação e leiaute. |
| CRT | `REQUIRED` | `1`, `2`, `3` ou `4`. |

O CRT deve vir do cadastro do estabelecimento e não pode ser escolhido livremente a cada nota sem controle de vigência.

## 8.3 Destinatário (`dest`)

| Campo | Status | Regra |
|---|---|---|
| CNPJ/CPF/ID estrangeiro | `REQUIRED/CONDITIONAL` | Conforme identificação e modelo. |
| Nome/razão social | `REQUIRED/CONDITIONAL` | Em homologação, respeitar textos exigidos pelo ambiente. |
| Endereço | `REQUIRED/CONDITIONAL` | Depende do modelo e cenário. |
| Indicador da IE | `REQUIRED` | Contribuinte, isento ou não contribuinte. |
| IE | `CONDITIONAL` | Exigir quando o indicador e a legislação exigirem. |
| SUFRAMA | `CONDITIONAL` | Operações alcançadas. |
| IM | `CONDITIONAL` | Quando aplicável. |
| E-mail | `OPTIONAL` | Uso operacional, respeitando privacidade. |

### 8.3.1 Regras de consistência do destinatário

- Não informar IE como texto `ISENTO` em campo numérico quando o leiaute usar indicador específico.
- Não permitir IE quando o indicador disser não contribuinte, salvo exceção técnica vigente.
- Operação interestadual para consumidor final pode exigir DIFAL, conforme hipótese legal.
- NFC-e pode permitir consumidor não identificado em determinadas operações, mas o sistema deve aplicar limites, regras estaduais e regras de pagamento.

## 8.4 Produto (`det/prod`)

| Campo | Status | Regra |
|---|---|---|
| Código interno (`cProd`) | `REQUIRED` | Único ou rastreável no sistema. |
| GTIN comercial (`cEAN`) | `REQUIRED` | Informar GTIN válido ou literal permitida pelo leiaute para produto sem GTIN. |
| Descrição (`xProd`) | `REQUIRED` | Descrição real do item; em homologação, observar textos padronizados quando exigidos. |
| NCM | `REQUIRED` | Código vigente e compatível com o produto. |
| EX TIPI | `CONDITIONAL` | Quando houver exceção tarifária aplicável. |
| CEST | `CONDITIONAL` | Quando o produto/operação estiver sujeito à regra que exige CEST. |
| Indicador de escala relevante | `CONDITIONAL` | Conforme NCM/CEST e legislação. |
| CNPJ do fabricante | `CONDITIONAL` | Exigido em cenário de escala não relevante e demais hipóteses. |
| Código de benefício (`cBenef`) | `CONDITIONAL` | Conforme UF e tratamento fiscal. |
| CFOP | `REQUIRED` | Compatível com operação, origem/destino e finalidade. |
| Unidade comercial | `REQUIRED` | Unidade válida. |
| Quantidade comercial | `REQUIRED` | Maior que zero, salvo hipótese técnica admitida. |
| Valor unitário comercial | `REQUIRED` | Precisão conforme leiaute. |
| Valor do produto | `DERIVED` | Quantidade x valor unitário, com regras de arredondamento. |
| GTIN tributável | `REQUIRED` | GTIN válido ou literal permitida. |
| Unidade tributável | `REQUIRED` | Pode diferir da comercial. |
| Quantidade tributável | `REQUIRED` | Coerente com conversão de unidade. |
| Valor unitário tributável | `REQUIRED/DERIVED` | Coerente com a unidade tributável. |
| Frete do item | `CONDITIONAL` | Rateado quando compuser a operação. |
| Seguro do item | `CONDITIONAL` | Rateado quando houver. |
| Desconto do item | `CONDITIONAL` | Não pode gerar total negativo. |
| Outras despesas | `CONDITIONAL` | Somente despesas integrantes da operação. |
| Compõe total (`indTot`) | `REQUIRED` | Normalmente sim; exceções devem ser explícitas. |
| Pedido e item do pedido | `OPTIONAL/CONDITIONAL` | Exigidos por integração ou contrato. |
| Número FCI | `CONDITIONAL` | Mercadoria importada nas hipóteses legais. |

### 8.4.1 Regra do total do produto

```text
vProd = qCom × vUnCom
```

O sistema deve manter precisão interna superior à precisão exibida e arredondar somente nos pontos previstos pelo leiaute.

### 8.4.2 CEST

CEST não é obrigatório para todo produto.

Exigir CEST somente quando:

- a mercadoria estiver abrangida por tabela/convênio aplicável;
- a operação ou a regra de validação exigir;
- a UF exigir para o cenário.

Não preencher CEST fictício apenas para completar a tela.

## 8.5 Totais

Todos os totais devem ser derivados dos itens.

Nunca aceitar edição livre dos totais sem uma finalidade fiscal específica.

Validar, no mínimo:

- base de ICMS;
- valor de ICMS;
- ICMS desonerado;
- FCP;
- base e valor de ICMS-ST;
- FCP-ST;
- FCP retido anteriormente;
- produtos;
- frete;
- seguro;
- desconto;
- II;
- IPI;
- IPI devolvido;
- PIS;
- COFINS;
- outras despesas;
- total da NF-e;
- IBS;
- CBS;
- créditos, diferimentos e demais totais da Reforma Tributária;
- Imposto Seletivo, quando aplicável.

## 8.6 Transporte

| Campo | Status | Regra |
|---|---|---|
| Modalidade do frete | `REQUIRED` | Informar inclusive quando não houver transporte. |
| Transportador | `CONDITIONAL` | Quando identificado. |
| Retenção de ICMS do transporte | `CONDITIONAL` | Conforme operação. |
| Veículo e reboque | `CONDITIONAL` | Quando aplicável. |
| Volumes | `CONDITIONAL` | Quantidade, espécie, marca, numeração e peso quando informados. |
| Lacres | `CONDITIONAL` | Quando houver. |

## 8.7 Cobrança e pagamento

| Grupo | Status | Regra |
|---|---|---|
| Fatura | `CONDITIONAL` | Quando houver cobrança representada por fatura. |
| Duplicatas | `CONDITIONAL` | Parcelas coerentes com a fatura e vencimentos. |
| Forma de pagamento | `REQUIRED` | Conforme modelo e operação. |
| Valor do pagamento | `REQUIRED/CONDITIONAL` | Deve fechar com o total ou regras de troco. |
| Tipo de integração do cartão | `CONDITIONAL` | Quando pagamento por cartão exigir. |
| CNPJ da credenciadora | `CONDITIONAL` | Conforme integração. |
| Bandeira e autorização | `CONDITIONAL` | Conforme pagamento. |
| Troco | `CONDITIONAL` | Quando o valor recebido for maior que o total. |

## 8.8 Informações adicionais

Usar para:

- fundamento legal;
- benefício fiscal;
- motivo de desoneração;
- dados de pedido/contrato;
- informações exigidas pela UF;
- mensagens do Simples Nacional;
- observações setoriais.

Não usar `infAdic` como substituto para tags estruturadas existentes.

# PARTE II — REGRAS POR CRT

## 9. CRT 1 — Simples Nacional

### 9.1 Regra geral

Para CRT 1:

- `CSOSN`: `REQUIRED`;
- `CST ICMS`: `FORBIDDEN`;
- origem da mercadoria: `REQUIRED`;
- grupo ICMS: determinado pelo CSOSN;
- alíquota comum de ICMS: não deve ser exibida para CSOSN que não calculam ICMS próprio;
- PIS e COFINS: não podem ser definidos apenas pelo CRT;
- IPI: condicional à operação e ao perfil do estabelecimento;
- IBS/CBS: seguir a seção da Reforma Tributária e a vigência.

### 9.2 CSOSN aceitos para CRT 1

- `101`;
- `102`;
- `103`;
- `201`;
- `202`;
- `203`;
- `300`;
- `400`;
- `500`;
- `900`.

### 9.3 Regras por CSOSN

#### CSOSN 101 — Tributada pelo Simples com permissão de crédito

Campos:

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `101` |
| percentual de crédito do Simples (`pCredSN`) | `REQUIRED` |
| valor do crédito (`vCredICMSSN`) | `DERIVED/REQUIRED` |
| base normal de ICMS | `FORBIDDEN` |
| alíquota normal de ICMS | `FORBIDDEN` |
| valor normal de ICMS | `FORBIDDEN` |

O percentual de crédito do Simples não é a alíquota comum de ICMS.

#### CSOSN 102 — Tributada pelo Simples sem permissão de crédito

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `102` |
| base de ICMS próprio | `FORBIDDEN` |
| alíquota de ICMS próprio | `FORBIDDEN` |
| valor de ICMS próprio | `FORBIDDEN` |
| crédito do Simples | `FORBIDDEN` |
| ST | `FORBIDDEN` no grupo 102 |

Este é um cenário comum de venda de mercadoria adquirida de terceiros no Simples, mas nunca deve ser escolhido automaticamente sem análise fiscal.

#### CSOSN 103 — Isenção no Simples por faixa de receita

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `103` |
| base/alíquota/valor de ICMS | `FORBIDDEN` |
| fundamento/benefício | `CONDITIONAL` |
| `cBenef` | `CONDITIONAL` conforme UF |

#### CSOSN 201 — Simples com crédito e ICMS-ST

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `201` |
| modalidade da base ST | `REQUIRED` |
| MVA | `CONDITIONAL` |
| redução da base ST | `CONDITIONAL` |
| base ST | `REQUIRED/DERIVED` |
| alíquota ST | `REQUIRED` |
| valor ICMS-ST | `REQUIRED/DERIVED` |
| percentual de crédito SN | `REQUIRED` |
| valor de crédito SN | `DERIVED/REQUIRED` |
| FCP-ST | `CONDITIONAL` |

#### CSOSN 202 — Simples sem crédito e com ICMS-ST

Mesmas regras de ST do CSOSN 201, porém:

- `pCredSN`: `FORBIDDEN`;
- `vCredICMSSN`: `FORBIDDEN`.

#### CSOSN 203 — Isenção por faixa e com ICMS-ST

Campos de ST conforme a operação e:

- sem crédito do Simples;
- benefício/fundamento condicional;
- `cBenef` condicional conforme UF.

#### CSOSN 300 — Imune

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `300` |
| base/alíquota/valor de ICMS | `FORBIDDEN` |
| fundamento legal | `CONDITIONAL` |
| `cBenef` | `CONDITIONAL` |

#### CSOSN 400 — Não tributada pelo Simples

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `400` |
| base/alíquota/valor de ICMS | `FORBIDDEN` |
| justificativa/fundamento | `CONDITIONAL` |
| `cBenef` | `CONDITIONAL` |

#### CSOSN 500 — ICMS-ST ou antecipação recolhida anteriormente

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CSOSN | `REQUIRED`, valor `500` |
| base de ST retida | `CONDITIONAL` |
| alíquota suportada pelo consumidor final | `CONDITIONAL` |
| ICMS substituto | `CONDITIONAL` |
| valor ST retido | `CONDITIONAL` |
| FCP retido anteriormente | `CONDITIONAL` |
| tributação efetiva | `CONDITIONAL` conforme UF/operação |
| ICMS próprio normal | `FORBIDDEN` |

Não confundir venda de peça usada com CSOSN 500. O código depende de ST recolhida anteriormente, não do estado físico do produto.

#### CSOSN 900 — Outros

O CSOSN 900 é condicional e não significa “preencher tudo”.

O motor deve habilitar somente os subgrupos necessários:

- ICMS próprio;
- redução de base;
- ICMS-ST;
- FCP;
- crédito do Simples;
- desoneração.

Cada subgrupo deve ter sua própria condição. Tags não aplicáveis continuam proibidas.

### 9.4 Regra de alíquota de ICMS na tela para CRT 1

| CSOSN | Campo `% ICMS próprio` |
|---|---|
| 101 | `FORBIDDEN` como alíquota normal; usar crédito SN |
| 102 | `FORBIDDEN` |
| 103 | `FORBIDDEN` |
| 201 | `FORBIDDEN` como ICMS próprio; alíquota ST é separada |
| 202 | `FORBIDDEN` como ICMS próprio; alíquota ST é separada |
| 203 | `FORBIDDEN` como ICMS próprio; alíquota ST é separada |
| 300 | `FORBIDDEN` |
| 400 | `FORBIDDEN` |
| 500 | `FORBIDDEN` como ICMS próprio; campos retidos são separados |
| 900 | `CONDITIONAL` |

## 10. CRT 2 — Simples Nacional com excesso de sublimite

### 10.1 Regra geral

O CRT 2 continua relacionado ao Simples Nacional, mas o ICMS é tratado fora do recolhimento unificado por causa do excesso do sublimite.

Para CRT 2:

- `CSOSN`: `FORBIDDEN`;
- `CST ICMS`: `REQUIRED`;
- grupos de ICMS: iguais aos grupos técnicos do regime normal;
- base, alíquota e valor de ICMS: exigidos conforme CST;
- ST, FCP, DIFAL e desoneração: condicionais;
- PIS/COFINS: não copiar automaticamente as regras de Lucro Presumido ou Lucro Real;
- IBS/CBS: tratar de acordo com a opção e vigência da legislação, sem inferir somente pelo CRT.

### 10.2 Erro que o sistema deve bloquear

```text
CRT = 2 e CSOSN preenchido
```

Resultado: erro interno antes de gerar o XML.

### 10.3 Configuração da tela

A tela de CRT 2 deve usar os mesmos componentes de ICMS do CRT 3, mas deve manter a configuração federal da empresa separada para PIS, COFINS, IPI e IBS/CBS.

## 11. CRT 3 — Regime Normal

### 11.1 Regra geral

Para CRT 3:

- `CST ICMS`: `REQUIRED`;
- `CSOSN`: `FORBIDDEN`;
- base, redução, alíquota e valor: conforme CST;
- ICMS-ST: conforme produto e operação;
- FCP: conforme produto, UF e operação;
- DIFAL: conforme destinatário e operação;
- PIS/COFINS: conforme regime e natureza da receita;
- IPI: quando o estabelecimento/operação estiver sujeito;
- IBS/CBS: obrigatório conforme cronograma e classificação vigente;
- IS: condicional ao produto/operação.

### 11.2 Origem + CST

A origem da mercadoria e o CST devem ser armazenados em campos separados.

Exemplo lógico:

```json
{
  "origem": "0",
  "cstIcms": "00"
}
```

O sistema pode exibir a combinação `000`, mas não deve perder os componentes separados.

## 12. CRT 4 — Microempreendedor Individual

### 12.1 Regra geral

Para CRT 4:

- `CSOSN`: `REQUIRED`;
- `CST ICMS` comum: `FORBIDDEN`;
- origem: `REQUIRED`;
- crédito do Simples: `FORBIDDEN`;
- CSOSN aceitos para o MEI: `102`, `300`, `400` e `900`;
- não oferecer `101`, `103`, `201`, `202`, `203` ou `500` como opção genérica;
- PIS/COFINS: não escolher CST 07 apenas por ser MEI;
- IBS/CBS: seguir o cronograma específico do Simples/MEI.

### 12.2 Matriz do CSOSN do MEI

| CSOSN | Uso geral | Campos de ICMS |
|---|---|---|
| `102` | Tributada pelo Simples sem crédito | origem + CSOSN; sem base/alíquota/valor de ICMS próprio |
| `300` | Imune | origem + CSOSN; fundamento condicional |
| `400` | Não tributada | origem + CSOSN; fundamento condicional |
| `900` | Outras operações permitidas | somente campos compatíveis com o cenário e com a validação vigente |

### 12.3 Regras proibidas no MEI

Bloquear:

- `pCredSN`;
- `vCredICMSSN`;
- CSOSN 101;
- CSOSN 201;
- CST de ICMS comum, salvo grupo técnico específico previsto pelo leiaute para operação especial;
- CSOSN 500 como seleção genérica.

## 13. Exceção: ICMS monofásico de combustíveis

O leiaute atual possui grupos próprios para tributação monofásica de combustíveis, com códigos como:

- `02` — tributação monofásica própria;
- `15` — monofásica própria com responsabilidade pela retenção;
- `53` — monofásica com diferimento;
- `61` — monofásica cobrada anteriormente.

Regras:

1. detectar produto combustível pelo cadastro fiscal e código ANP;
2. selecionar o grupo específico antes da regra genérica de CRT;
3. usar quantidade tributada e alíquota `ad rem` quando o grupo exigir;
4. não usar alíquota percentual comum no lugar de alíquota por unidade;
5. validar valores próprios, retidos e diferidos separadamente;
6. não permitir CSOSN e grupo monofásico incompatíveis no mesmo item.

# PARTE III — CST DO ICMS PARA CRT 2 E 3

## 14. CST 00 — Tributada integralmente

| Campo | Status |
|---|---|
| origem | `REQUIRED` |
| CST | `REQUIRED`, valor `00` |
| modalidade da base | `REQUIRED` |
| base de cálculo | `REQUIRED/DERIVED` |
| alíquota ICMS | `REQUIRED` |
| valor ICMS | `REQUIRED/DERIVED` |
| FCP próprio | `CONDITIONAL` |

## 15. CST 10 — Tributada com ICMS-ST

Exigir:

- campos do ICMS próprio;
- modalidade da base ST;
- MVA e redução ST quando aplicáveis;
- base ST;
- alíquota ST;
- valor ST;
- FCP e FCP-ST quando aplicáveis.

## 16. CST 20 — Redução de base

Exigir:

- modalidade da base;
- percentual de redução;
- base reduzida;
- alíquota;
- valor do ICMS;
- desoneração e FCP quando aplicáveis.

## 17. CST 30 — Isenta/não tributada com ICMS-ST

- ICMS próprio não é calculado normalmente;
- grupo de ST é exigido quando houver responsabilidade;
- desoneração e FCP-ST são condicionais.

## 18. CST 40, 41 e 50

| CST | Tratamento | Base/alíquota/valor ICMS próprio |
|---|---|---|
| 40 | Isenta | `FORBIDDEN`, salvo campos estruturados de desoneração |
| 41 | Não tributada | `FORBIDDEN`, salvo campos estruturados de desoneração |
| 50 | Suspensão | `FORBIDDEN`, com fundamento legal condicional |

Quando a regra exigir, informar:

- valor desonerado;
- motivo da desoneração;
- código de benefício;
- fundamento legal em informações adicionais.

## 19. CST 51 — Diferimento

Campos possíveis:

- modalidade da base;
- base;
- alíquota da operação;
- valor do ICMS da operação;
- percentual de diferimento;
- valor diferido;
- valor efetivamente devido;
- FCP, quando aplicável.

Não confundir valor da operação com valor recolhido.

## 20. CST 60 — ICMS-ST cobrado anteriormente

Campos condicionais:

- base ST retida;
- alíquota suportada pelo consumidor final;
- ICMS substituto;
- ICMS-ST retido;
- FCP retido;
- base/alíquota/valor efetivos, quando exigidos.

## 21. CST 70 — Redução de base com ICMS-ST

Combina:

- redução da base do ICMS próprio;
- cálculo do ICMS próprio;
- cálculo da ST;
- FCP próprio e FCP-ST, quando aplicáveis.

## 22. CST 90 — Outras

CST 90 não significa “preencher todos os campos”.

Habilitar somente os blocos aplicáveis:

- ICMS próprio;
- redução;
- ST;
- FCP;
- desoneração;
- diferimento, quando admitido pelo grupo vigente.

## 23. Outros CST atuais de ICMS

O motor deve suportar os códigos publicados na tabela vigente, inclusive grupos de:

- monofásico de combustíveis;
- ST antecedente;
- ST concomitante;
- diferimento com ST;
- redução com ST antecedente/concomitante.

Exemplos existentes no leiaute atual incluem `02`, `12`, `13`, `15`, `52`, `53`, `61`, `72` e `74`.

Não hardcode a lista apenas no frontend. Manter tabela versionada e validação pelo XSD.

# PARTE IV — ICMS COMPLEMENTAR

## 24. Origem da mercadoria

Origem é obrigatória nos grupos de ICMS.

Armazenar como tabela oficial versionada.

A origem influencia:

- composição visual do código completo;
- alíquotas interestaduais;
- conteúdo de importação;
- FCI;
- validações de ICMS.

Não inferir origem pelo país do fornecedor atual sem rastrear a mercadoria.

## 25. ICMS-ST

Habilitar ICMS-ST somente quando:

- o produto estiver sujeito ao regime na operação;
- a UF de origem/destino e protocolo/convênio/regra interna o exigirem;
- o emitente tiver responsabilidade pelo recolhimento ou precisar informar retenção anterior.

Campos comuns:

- modalidade de determinação da base;
- MVA;
- redução;
- base ST;
- alíquota ST;
- valor ST;
- base e valor FCP-ST;
- base e valor retidos anteriormente.

## 26. FCP

FCP possui grupos diferentes:

- FCP do ICMS próprio;
- FCP-ST;
- FCP retido anteriormente;
- FCP da UF de destino.

Não reutilizar um único campo `% FCP` para todos os grupos sem identificar o tipo.

Campos:

- base;
- alíquota;
- valor.

## 27. DIFAL para UF de destino

DIFAL não deve ser representado pelo campo comum `% ICMS`.

O grupo próprio pode exigir:

- base da UF de destino;
- base do FCP destino;
- percentual FCP;
- alíquota interna de destino;
- alíquota interestadual;
- percentual de partilha quando vigente;
- valor FCP destino;
- valor ICMS destino;
- valor ICMS remetente, quando aplicável.

Condição depende de:

- operação interestadual;
- consumidor final;
- condição de contribuinte;
- legislação vigente;
- tipo de produto/operação.

## 28. Desoneração e benefício fiscal

Campos condicionais:

- `cBenef`;
- valor do ICMS desonerado;
- motivo da desoneração;
- dedução ou não do valor desonerado no preço, quando prevista;
- fundamento legal.

Não definir `cBenef` apenas por CST. A tabela e a obrigatoriedade variam por UF e vigência.

# PARTE V — PIS E COFINS

## 29. Regra geral

PIS e COFINS têm tabelas próprias. Não reutilizar:

- CST do ICMS;
- CSOSN;
- CST IBS/CBS.

O CRT isoladamente não determina o CST de PIS e COFINS.

### 29.1 Bloqueios obrigatórios

O sistema deve bloquear estas suposições:

```text
CRT 1 => PIS 07 e COFINS 07
CRT 4 => PIS 07 e COFINS 07
sem alíquota => isento
```

CST 07 significa operação isenta, não “empresa do Simples”.

## 30. Grupos de cálculo de PIS/COFINS

### 30.1 Tributação percentual

Quando o CST exigir cálculo por percentual:

- CST: `REQUIRED`;
- base: `REQUIRED/DERIVED`;
- alíquota: `REQUIRED`;
- valor: `REQUIRED/DERIVED`.

### 30.2 Tributação por quantidade

Quando a regra for por unidade:

- quantidade da base: `REQUIRED`;
- alíquota por unidade: `REQUIRED`;
- valor: `DERIVED/REQUIRED`;
- base percentual: `FORBIDDEN`.

### 30.3 Grupo não tributado

Para CST de operação não tributada:

- informar o CST;
- não criar base e alíquota fictícias iguais a zero se o grupo não aceitar esses campos.

### 30.4 Outras operações

Códigos como `49` e `99` não devem ser padrões universais.

Quando utilizados, selecionar a forma de cálculo realmente aplicável:

- percentual; ou
- quantidade.

## 31. Regimes e tratamentos a considerar

O cadastro fiscal deve suportar:

- cumulativo;
- não cumulativo;
- Simples Nacional;
- monofásico;
- alíquota zero;
- isenção;
- suspensão;
- substituição tributária;
- receita não tributada;
- exportação;
- outros tratamentos.

## 32. PIS-ST e COFINS-ST

Somente habilitar quando houver retenção/substituição prevista.

Campos podem incluir:

- base;
- alíquota percentual;
- quantidade;
- alíquota por unidade;
- valor.

# PARTE VI — IPI, II E GRUPOS ESPECIAIS

## 33. IPI

IPI é condicional.

Habilitar quando:

- emitente for industrial ou equiparado;
- emitente for importador nas hipóteses aplicáveis;
- a operação exigir destaque ou informação;
- devolução exigir grupo de IPI devolvido.

Campos gerais:

- CNPJ do produtor, quando aplicável;
- código do selo e quantidade, quando aplicável;
- código de enquadramento (`cEnq`);
- CST do IPI;
- grupo tributado ou não tributado;
- base e alíquota; ou
- quantidade e alíquota específica;
- valor do IPI.

Para operação de saída, não selecionar automaticamente CST de entrada.

## 34. Imposto de Importação

Habilitar em importação direta e demais hipóteses previstas.

Campos:

- base de cálculo;
- despesas aduaneiras;
- valor do II;
- IOF;
- DI/DUIMP e adições, conforme leiaute e processo.

## 35. Devolução de IPI

Quando aplicável:

- percentual devolvido;
- valor devolvido;
- totalização específica.

Não somar como IPI normal sem observar a regra de total da devolução.

## 36. Grupos setoriais

Habilitar por cadastro e NCM, não por CRT:

- rastreabilidade/lotes;
- medicamentos;
- combustíveis;
- veículos novos;
- armas, quando aplicável ao contribuinte autorizado;
- papel imune;
- exportação;
- importação;
- produtos agropecuários;
- informações de crédito presumido;
- demais grupos publicados no leiaute.

# PARTE VII — REFORMA TRIBUTÁRIA DO CONSUMO

## 37. Regra central

A Reforma Tributária não cria um novo CRT para substituir os códigos 1, 2, 3 e 4.

O sistema deve manter duas camadas durante a transição:

```text
camada atual:
    ICMS
    ICMS-ST
    FCP
    DIFAL
    PIS
    COFINS
    IPI

camada RTC:
    IBS
    CBS
    Imposto Seletivo
```

Não apagar a camada atual antes do fim do cronograma legal.

## 38. Cronograma operacional de 2026

### 38.1 Empresas do regime regular

Em 2026:

- documentos fiscais eletrônicos devem suportar destaque de IBS e CBS;
- alíquotas-teste gerais são 0,1% de IBS e 0,9% de CBS, salvo classificação ou regime específico;
- o cumprimento das obrigações acessórias pode dispensar o recolhimento no ano-teste;
- a partir de 03/08/2026, a orientação operacional oficial prevê rejeição de documentos do regime regular sem o preenchimento correto dos campos de IBS/CBS.

O sistema deve usar data de emissão para ativar regras.

```text
até o marco operacional:
    permitir fase adaptativa conforme NT e regras ativas

a partir do marco operacional:
    exigir IBS/CBS para regime regular quando aplicável
```

Não usar apenas a data de implantação do software. Usar a data/hora da emissão e a vigência publicada.

### 38.2 CRT 1, CRT 2 e CRT 4 em 2026

Como optantes do Simples Nacional, devem seguir o tratamento transitório específico do Simples.

O motor não deve copiar automaticamente a obrigatoriedade do regime regular para esses CRTs sem verificar:

- vigência;
- opção do contribuinte;
- regra específica do Simples;
- NT vigente;
- classificação da operação.

### 38.3 A partir de 2027

O sistema deve possuir atributo separado para a opção de apuração de IBS/CBS do optante do Simples.

Exemplo:

```ts
type IbsCbsOption =
  | "SIMPLES"
  | "REGULAR"
  | "NOT_APPLICABLE";
```

Não inferir essa opção somente pelo CRT.

## 39. Campos centrais de IBS/CBS por item

Os nomes finais e ocorrências devem seguir o XSD e a NT vigente. O modelo lógico precisa suportar:

| Campo/grupo | Status geral | Regra |
|---|---|---|
| CST IBS/CBS | `EXTERNAL_TABLE/REQUIRED` | Código próprio; não reutilizar CST ICMS. |
| `cClassTrib` | `EXTERNAL_TABLE/REQUIRED` | Compatível com CST, documento, operação e vigência. |
| Base de cálculo | `CONDITIONAL/DERIVED` | Quando a classificação exigir base ad valorem. |
| IBS da UF | `CONDITIONAL/DERIVED` | Alíquota, redução, diferimento e valor. |
| IBS do município | `CONDITIONAL/DERIVED` | Alíquota, redução, diferimento e valor. |
| Total do IBS | `DERIVED` | Soma das parcelas aplicáveis. |
| CBS | `CONDITIONAL/DERIVED` | Alíquota, redução, diferimento e valor. |
| Tributação regular associada | `CONDITIONAL` | Quando a classificação exigir grupo adicional. |
| Crédito presumido | `CONDITIONAL` | Somente se permitido pela tabela. |
| Monofásico | `CONDITIONAL` | Base específica, alíquota e valores próprios/retidos/diferidos. |
| Transferência/ajuste de crédito | `CONDITIONAL` | Somente nas finalidades autorizadas. |
| Totais RTC | `DERIVED` | Somatórios por documento. |

## 40. Regra do `cClassTrib`

`cClassTrib` deve comandar a interface e o cálculo.

O sistema deve armazenar, por código:

- código;
- descrição;
- CST compatível;
- início de vigência;
- fim de vigência;
- documentos permitidos;
- indicador de tributação;
- indicador de redução;
- indicador de diferimento;
- indicador de alíquota zero;
- indicador de imunidade/isenção;
- indicador de monofásico;
- indicador de crédito presumido;
- indicador de tributação regular;
- grupos adicionais permitidos;
- fonte e versão da tabela.

### 40.1 Regra proibida

Não implementar assim:

```ts
if (cstIbsCbs === "000") {
  requireAllFields();
}
```

Implementar assim:

```ts
const rule = lookupClassTrib({
  cst: cstIbsCbs,
  cClassTrib,
  issueDate,
  documentModel,
});

applyRequiredFields(rule.requiredFields);
applyForbiddenFields(rule.forbiddenFields);
applyCalculation(rule.calculationMode);
```

## 41. IBS estadual e municipal

O modelo de dados deve separar:

```ts
ibs: {
  state: {
    rate?: Decimal;
    reductionRate?: Decimal;
    effectiveRate?: Decimal;
    deferralRate?: Decimal;
    deferredValue?: Decimal;
    value?: Decimal;
  };
  municipality: {
    rate?: Decimal;
    reductionRate?: Decimal;
    effectiveRate?: Decimal;
    deferralRate?: Decimal;
    deferredValue?: Decimal;
    value?: Decimal;
  };
  total?: Decimal;
}
```

Não usar um único campo `pIBS` para as parcelas estadual e municipal.

## 42. CBS

Modelo mínimo:

```ts
cbs: {
  rate?: Decimal;
  reductionRate?: Decimal;
  effectiveRate?: Decimal;
  deferralRate?: Decimal;
  deferredValue?: Decimal;
  value?: Decimal;
}
```

Campos efetivamente gerados dependem do grupo do XSD e do `cClassTrib`.

## 43. Imposto Seletivo

O IS é condicional ao produto e à operação, não ao CRT.

O motor deve suportar:

- CST do IS;
- classificação do IS;
- base percentual;
- quantidade tributável;
- alíquota percentual;
- alíquota específica;
- valor do IS;
- totalização.

Não habilitar IS em todos os produtos.

## 44. Compatibilidade entre tributação atual e RTC

Uma mesma nota pode precisar apresentar simultaneamente:

- ICMS/CSOSN;
- PIS;
- COFINS;
- IPI;
- IBS;
- CBS;
- IS.

O motor não deve tratar IBS/CBS como substitutos imediatos de ICMS/PIS/COFINS durante a transição.

# PARTE VIII — MATRIZ DE CAMPOS DA TELA DO ITEM

## 45. Campos comuns a todos os CRTs

| Campo da tela | CRT 1 | CRT 2 | CRT 3 | CRT 4 |
|---|---|---|---|---|
| Descrição | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| Código interno | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| NCM | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| CFOP | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| Unidade | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| Quantidade | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| Valor unitário | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| Total do item | `DERIVED` | `DERIVED` | `DERIVED` | `DERIVED` |
| CEST | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` |
| Origem | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| GTIN | `REQUIRED` | `REQUIRED` | `REQUIRED` | `REQUIRED` |
| `cBenef` | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` |

## 46. Campos de ICMS por CRT

| Campo | CRT 1 | CRT 2 | CRT 3 | CRT 4 |
|---|---|---|---|---|
| CSOSN | `REQUIRED` | `FORBIDDEN` | `FORBIDDEN` | `REQUIRED` restrito |
| CST ICMS | `FORBIDDEN` | `REQUIRED` | `REQUIRED` | `FORBIDDEN` |
| `% ICMS próprio` | por CSOSN | por CST | por CST | normalmente `FORBIDDEN` |
| Base ICMS | por CSOSN | por CST | por CST | normalmente `FORBIDDEN` |
| Valor ICMS | por CSOSN | por CST | por CST | normalmente `FORBIDDEN` |
| Crédito SN | 101/201 | `FORBIDDEN` | `FORBIDDEN` | `FORBIDDEN` |
| ICMS-ST | 201/202/203/500/900 | por CST | por CST | somente cenário permitido |
| FCP | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` |
| DIFAL | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` | `CONDITIONAL` |

## 47. Campos PIS/COFINS

Para todos os CRTs, a tela deve ter:

- CST PIS;
- modo de cálculo PIS;
- base/alíquota/valor ou quantidade/alíquota específica;
- CST COFINS;
- modo de cálculo COFINS;
- base/alíquota/valor ou quantidade/alíquota específica.

A interface deve esconder campos incompatíveis com o grupo selecionado.

## 48. Campos RTC

A tela deve ser ativada por vigência e regime, com:

- CST IBS/CBS;
- `cClassTrib`;
- base RTC;
- IBS UF;
- IBS município;
- CBS;
- reduções;
- diferimentos;
- crédito presumido;
- monofásico;
- tributação regular;
- IS.

Não exibir todos de uma vez. A combinação CST + `cClassTrib` decide os campos.

# PARTE IX — VALIDAÇÕES CRUZADAS

## 49. Validações mínimas antes de gerar o XML

### 49.1 CRT e ICMS

```text
CRT 1 + CST ICMS comum => erro
CRT 2 + CSOSN => erro
CRT 3 + CSOSN => erro
CRT 4 + CST ICMS comum => erro
CRT 4 + CSOSN fora de 102/300/400/900 => erro
```

Considerar exceções técnicas do leiaute para grupos especiais antes da regra genérica.

### 49.2 CFOP

Validar:

- entrada x saída;
- interna x interestadual x exterior;
- finalidade;
- destinatário;
- mercadoria própria x adquirida de terceiros;
- devolução e referência.

### 49.3 NCM/CEST

Validar:

- formato;
- vigência;
- CEST permitido/exigido;
- grupos setoriais;
- incidência potencial de IS/monofásico.

### 49.4 Totais

Validar:

- soma de itens;
- rateio de frete, seguro, desconto e outras despesas;
- total dos tributos;
- pagamento;
- troco;
- total da nota;
- totais RTC.

### 49.5 PIS/COFINS

```text
CST não tributado + base/alíquota indevidas => erro
modo percentual sem base/alíquota => erro
modo quantidade sem quantidade/alíquota unitária => erro
CST 07 escolhido apenas por CRT => alerta fiscal
```

### 49.6 Reforma Tributária

```text
regime regular após vigência obrigatória + sem IBS/CBS => erro
CST IBS/CBS incompatível com cClassTrib => erro
cClassTrib fora da vigência => erro
grupo de crédito presumido sem autorização da tabela => erro
grupo monofásico sem classificação compatível => erro
```

## 50. Alertas que não devem autorizar emissão automática

Gerar alerta bloqueante ou exigir confirmação fiscal quando:

- NCM alterado recentemente;
- CEST vazio em produto marcado como sujeito a ST;
- CFOP incompatível com UF;
- CST/CSOSN 900 ou 90 usado sem justificativa;
- alíquota digitada manualmente divergir da regra;
- benefício sem `cBenef` quando a UF exigir;
- item de produção usar valor simbólico de teste;
- produção com descrição genérica como `PRODUTO TESTE`;
- `cClassTrib` não atualizado;
- regra fiscal sem vigência ou fonte.

# PARTE X — ARQUITETURA PARA IMPLEMENTAÇÃO

## 51. Entidades recomendadas

### 51.1 Estabelecimento

```ts
interface TaxEstablishment {
  id: string;
  cnpj: string;
  stateRegistration?: string;
  municipalRegistration?: string;
  state: string;
  cityCode: string;
  crt: 1 | 2 | 3 | 4;
  pisCofinsRegime: string;
  ipiProfile: string;
  ibsCbsOptions: Array<{
    validFrom: string;
    validTo?: string;
    option: "SIMPLES" | "REGULAR" | "NOT_APPLICABLE";
  }>;
}
```

### 51.2 Produto fiscal

```ts
interface ProductTaxProfile {
  productId: string;
  ncm: string;
  cest?: string;
  exTipi?: string;
  origin: string;
  gtin?: string;
  taxUnit: string;
  scaleRelevant?: boolean;
  manufacturerCnpj?: string;
  fci?: string;
  anpCode?: string;
  subjectToSt: boolean;
  subjectToFcp: boolean;
  subjectToMonophase: boolean;
  subjectToSelectiveTax: boolean;
  benefitCodes: Array<{
    state: string;
    code: string;
    validFrom: string;
    validTo?: string;
  }>;
}
```

### 51.3 Regra fiscal versionada

```ts
interface TaxRule {
  id: string;
  version: string;
  validFrom: string;
  validTo?: string;
  documentModels: Array<55 | 65>;
  crt: Array<1 | 2 | 3 | 4>;
  operationType: "IN" | "OUT";
  originStates?: string[];
  destinationStates?: string[];
  finalConsumer?: boolean;
  recipientTaxpayerType?: string[];
  cfop?: string[];
  ncm?: string[];
  cest?: string[];
  icmsRule: unknown;
  pisRule: unknown;
  cofinsRule: unknown;
  ipiRule?: unknown;
  rtcRule?: unknown;
  legalBasis: string[];
  sourceVersion: string;
}
```

## 52. Motor de visibilidade de campos

```ts
type FieldState =
  | "REQUIRED"
  | "CONDITIONAL"
  | "OPTIONAL"
  | "FORBIDDEN"
  | "DERIVED";

interface FieldRule {
  field: string;
  state: FieldState;
  reason: string;
  condition?: string;
}
```

A API deve retornar ao frontend a lista de campos e estados. Evitar duplicar regras fiscais no componente React.

## 53. Pseudocódigo principal

```ts
function buildItemTaxContext(input: InvoiceItemInput): ItemTaxContext {
  const context = identifyOperationContext(input);
  const product = loadProductTaxProfile(input.productId, context.issueDate);
  const rule = findTaxRule(context, product);

  const icms = resolveIcmsGroup({
    crt: context.crt,
    product,
    operation: context,
    rule,
  });

  validateIcmsGroupAgainstCrt(icms, context.crt);

  const pis = resolvePis(rule, context, product);
  const cofins = resolveCofins(rule, context, product);
  const ipi = resolveIpi(rule, context, product);
  const importTax = resolveImportTax(rule, context, product);
  const destinationTax = resolveDestinationTax(rule, context, product);
  const rtc = resolveIbsCbsAndIs(rule, context, product);

  const calculated = calculateTaxes({
    item: input,
    icms,
    pis,
    cofins,
    ipi,
    importTax,
    destinationTax,
    rtc,
  });

  validateRequiredAndForbiddenFields(calculated);
  validateCrossRules(calculated, context, product);

  return calculated;
}
```

## 54. Seleção do grupo ICMS

```ts
function resolveIcmsFamily(crt: 1 | 2 | 3 | 4, product: ProductTaxProfile) {
  if (product.subjectToMonophase && product.anpCode) {
    return "MONOPHASE_FUEL";
  }

  if (crt === 1 || crt === 4) {
    return "CSOSN";
  }

  return "CST";
}
```

Esta função somente escolhe a família. Outra regra escolhe o código específico.

## 55. Geração do XML

A geração deve:

1. criar apenas um grupo de ICMS por item;
2. não gerar tags proibidas;
3. gerar valores derivados com precisão correta;
4. ordenar tags conforme o XSD;
5. remover `undefined`, `null` e strings vazias;
6. validar o XML no XSD antes da assinatura;
7. validar regras internas antes da transmissão;
8. armazenar o XML enviado e o autorizado.

# PARTE XI — EXEMPLOS DE CENÁRIOS

## 56. Exemplo CRT 1 com CSOSN 102

Cenário ilustrativo:

- venda interna;
- mercadoria adquirida de terceiros;
- sem ST;
- sem crédito do Simples.

```yaml
crt: 1
cfop: "5102"
icms:
  origin: "0"
  csosn: "102"
  cst: null
  base: null
  rate: null
  value: null
```

## 57. Exemplo CRT 2 com CST 00

```yaml
crt: 2
icms:
  origin: "0"
  cst: "00"
  csosn: null
  baseMethod: "3"
  base: 100.00
  rate: 20.00
  value: 20.00
```

Alíquota meramente ilustrativa. A regra real depende da UF e operação.

## 58. Exemplo CRT 3 com CST 60

```yaml
crt: 3
icms:
  origin: "0"
  cst: "60"
  retainedSt:
    base: 80.00
    value: 14.40
```

Os campos exatos dependem da informação disponível, da UF e das regras vigentes.

## 59. Exemplo CRT 4 com CSOSN 102

```yaml
crt: 4
icms:
  origin: "0"
  csosn: "102"
  cst: null
  creditRate: null
  creditValue: null
```

## 60. Exemplo de IBS/CBS no regime regular

```yaml
rtc:
  cstIbsCbs: "CODIGO_DA_TABELA_VIGENTE"
  cClassTrib: "CLASSIFICACAO_VIGENTE"
  base: 100.00
  ibs:
    state:
      rate: 0.10
      value: 0.10
    municipality:
      rate: 0.00
      value: 0.00
    total: 0.10
  cbs:
    rate: 0.90
    value: 0.90
```

Este exemplo demonstra a separação lógica. As alíquotas e tags devem seguir o `cClassTrib`, a NT e o XSD vigentes.

# PARTE XII — TESTES AUTOMATIZADOS

## 61. Casos mínimos de teste

Criar testes para:

1. CRT 1 + CSOSN 102 válido;
2. CRT 1 + CST 00 inválido;
3. CRT 1 + CSOSN 101 com crédito;
4. CRT 1 + CSOSN 201 com ST e crédito;
5. CRT 2 + CST 00 válido;
6. CRT 2 + CSOSN inválido;
7. CRT 3 + CST 20 com redução;
8. CRT 3 + CST 60 com ST retida;
9. CRT 3 + CST 40 com desoneração;
10. CRT 4 + CSOSN 102 válido;
11. CRT 4 + CSOSN 101 inválido;
12. CRT 4 + crédito SN inválido;
13. CEST obrigatório ausente;
14. CEST não aplicável omitido;
15. PIS não tributado com alíquota indevida;
16. PIS percentual sem base;
17. COFINS por quantidade sem quantidade;
18. DIFAL em cenário aplicável;
19. DIFAL indevido em operação interna;
20. IBS/CBS obrigatório ausente após vigência;
21. CST IBS/CBS incompatível com `cClassTrib`;
22. `cClassTrib` vencido;
23. IS em produto não sujeito;
24. XML com tag proibida;
25. totais divergentes;
26. nota de devolução sem referência;
27. NFC-e com pagamento inconsistente;
28. combustível monofásico usando alíquota percentual indevida.

## 62. Propriedades dos testes

Cada teste deve validar:

- estado dos campos no frontend;
- payload aceito pela API;
- payload rejeitado pela API;
- grupo XML gerado;
- ausência de tags proibidas;
- cálculos;
- totalização;
- mensagem de erro compreensível;
- versão da regra registrada.

# PARTE XIII — MENSAGENS DE ERRO

## 63. Padrão de erro

```ts
interface TaxValidationError {
  code: string;
  field?: string;
  itemNumber?: number;
  message: string;
  ruleVersion: string;
  legalReference?: string;
}
```

Exemplos:

```text
NFE_CRT1_CST_FORBIDDEN:
O CST do ICMS não pode ser informado para CRT 1. Selecione um CSOSN compatível com a operação.
```

```text
NFE_CRT4_CSOSN_NOT_ALLOWED:
O CSOSN selecionado não é permitido para emitente MEI (CRT 4).
```

```text
NFE_IBSCBS_CLASS_MISMATCH:
O cClassTrib não é compatível com o CST IBS/CBS na data de emissão.
```

# PARTE XIV — VERSIONAMENTO E ATUALIZAÇÃO

## 64. Regra de vigência

Toda regra fiscal deve conter:

- `validFrom`;
- `validTo`, quando houver;
- versão da fonte;
- data da importação;
- usuário/processo que atualizou;
- checksum do arquivo oficial, quando possível.

## 65. Tabelas que não devem ficar fixas no código

Manter externas e versionadas:

- NCM;
- CEST;
- CFOP;
- origem;
- CST ICMS;
- CSOSN;
- CST PIS;
- CST COFINS;
- CST IPI;
- `cBenef` por UF;
- códigos ANP;
- CST IBS/CBS;
- `cClassTrib`;
- crédito presumido IBS/CBS;
- CST/classificação do IS;
- alíquotas e reduções por vigência.

## 66. Auditoria

Armazenar por emissão:

- entradas usadas na decisão;
- CRT;
- regra fiscal selecionada;
- versão das tabelas;
- cálculos intermediários;
- XML antes da assinatura;
- XML transmitido;
- XML autorizado;
- protocolo;
- rejeições e tentativas;
- usuário ou processo responsável.

# PARTE XV — CHECKLIST ANTES DA TRANSMISSÃO

## 67. Checklist geral

- [ ] Modelo e série corretos.
- [ ] Número não utilizado.
- [ ] Emitente autorizado no ambiente.
- [ ] CRT vigente do estabelecimento.
- [ ] Destinatário consistente com indicador de IE.
- [ ] CFOP coerente com entrada/saída e UFs.
- [ ] NCM válido na data.
- [ ] CEST informado somente quando aplicável.
- [ ] Origem informada.
- [ ] CSOSN ou CST selecionado, nunca ambos.
- [ ] CSOSN compatível com CRT.
- [ ] CST compatível com o grupo de ICMS.
- [ ] Base, alíquota e valor somente nos grupos que admitem.
- [ ] ST/FCP/DIFAL calculados quando aplicáveis.
- [ ] PIS e COFINS com grupo correto.
- [ ] IPI e II avaliados.
- [ ] RTC avaliada pela data e regime.
- [ ] `cClassTrib` vigente e compatível.
- [ ] IS avaliado.
- [ ] Grupos setoriais avaliados.
- [ ] Totais fecham.
- [ ] Pagamentos fecham.
- [ ] Referências presentes em devolução/complementar/ajuste.
- [ ] Sem tags vazias.
- [ ] Sem tags proibidas.
- [ ] XML válido no XSD.
- [ ] Certificado válido.
- [ ] Ambiente correto.

# PARTE XVI — INSTRUÇÕES DIRETAS PARA O CODEX

## 68. O que implementar

1. Não coloque a lógica fiscal apenas no componente visual.
2. Crie um motor de regras no backend/domínio.
3. Retorne ao frontend os campos permitidos, obrigatórios, derivados e proibidos.
4. Mantenha CSOSN e CST em estruturas diferentes.
5. Não envie tags vazias.
6. Não use zero como substituto para campo ausente.
7. Não presuma CST PIS/COFINS pelo CRT.
8. Não presuma tributação por NCM sem tabela/regra com vigência.
9. Não hardcode `cClassTrib`.
10. Não trate CRT 2 como CRT 1 no ICMS.
11. Não trate MEI como CRT 1 genérico.
12. Aplique exceção de combustíveis antes da regra genérica.
13. Calcule totais no backend.
14. Valide o XML localmente antes de transmitir.
15. Registre a versão da regra em cada emissão.
16. Crie testes de matriz por CRT, CST/CSOSN e vigência.

## 69. O que não implementar

Não implementar regras como:

```ts
const cstPis = crt === 1 ? "49" : "01";
const cstCofins = crt === 1 ? "49" : "01";
const icmsRate = crt === 1 ? 0 : 20;
const cest = product.cest ?? "0000000";
```

Essas regras são fiscalmente inseguras.

# PARTE XVII — FONTES OFICIAIS

Consultar e versionar as fontes abaixo antes de mudanças em produção:

1. Portal Nacional da NF-e/NFC-e — notas técnicas, MOC, schemas e informes:
   - https://www.nfe.fazenda.gov.br/

2. Nota Técnica 2024.001 — CRT 4/MEI:
   - https://www.nfe.fazenda.gov.br/PORTal/exibirArquivo.aspx?conteudo=6luq3tpmg08%3D

3. Página da Nota Técnica 2025.002 — Reforma Tributária na NF-e/NFC-e:
   - https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D

4. Informe Técnico 2025.002 — tabelas de CST IBS/CBS, `cClassTrib` e crédito presumido:
   - https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=jxTMMQeEVM8%3D

5. Receita Federal — Orientações da Reforma Tributária para 2026:
   - https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026

6. Receita Federal — visão geral da Reforma Tributária do Consumo:
   - https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda

7. CGIBS — marco operacional de 03/08/2026:
   - https://www.cgibs.gov.br/novo-marco-da-reforma-tributaria-inicia-em-03-de-agosto-com-preenchimento-obrigatorio-dos-campos-relativos-ao-ibs-e-a-cbs

8. Lei Complementar nº 214/2025, texto compilado:
   - https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214compilado.htm

9. Lei Complementar nº 227/2026:
   - https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm

## 70. Controle do documento

- Versão: `1.0.0`
- Data de fechamento: `2026-07-19`
- Escopo: regras gerais de NF-e/NFC-e por CRT e adequação à RTC.
- Próxima etapa recomendada: transformar as regras declarativas deste Markdown em arquivos JSON versionados e schemas de validação.

> Aviso técnico: alterações em Notas Técnicas, schemas, tabelas ou datas de ativação podem tornar partes deste arquivo desatualizadas. Antes de publicar uma nova versão do emissor, compare este documento com as fontes oficiais e execute testes em homologação.
