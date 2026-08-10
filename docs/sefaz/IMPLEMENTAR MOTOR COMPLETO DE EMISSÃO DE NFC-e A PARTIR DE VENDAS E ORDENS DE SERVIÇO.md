# IMPLEMENTAR MOTOR COMPLETO DE EMISSÃO DE NFC-e A PARTIR DE VENDAS E ORDENS DE SERVIÇO

Analise profundamente este projeto antes de alterar qualquer arquivo.

O sistema JÁ POSSUI um motor funcional de emissão de NF-e modelo 55 a partir de:

1. Vendas com produtos;
2. Ordens de Serviço com produtos.

NÃO quero criar um segundo motor fiscal independente, duplicar cálculo tributário, duplicar assinatura XML, duplicar certificado digital ou reimplementar funcionalidades que já existem.

O objetivo é evoluir a arquitetura atual para suportar também:

**NFC-e – Nota Fiscal de Consumidor Eletrônica – modelo 65**

com emissão a partir de:

- Venda;
- Ordem de Serviço;
- somente os produtos/mercadorias fiscalmente elegíveis existentes nessas origens.

A implementação deve ser feita de forma profissional, segura, extensível, auditável e pronta para produção.

---

# 1. REGRA PRINCIPAL

Antes de escrever código, faça uma investigação completa do projeto.

Localize e documente:

- fluxo atual de emissão de NF-e;
- API/route/action usada para emissão;
- criação do XML;
- cálculo dos impostos;
- resolução de CFOP;
- resolução de CST/CSOSN;
- ICMS;
- PIS;
- COFINS;
- IBS/CBS/IS já existentes;
- NCM;
- CEST;
- GTIN;
- cBenef;
- cClassTrib;
- totalização;
- desconto;
- frete;
- destinatário;
- formas de pagamento;
- certificado digital;
- carregamento de PFX/P12;
- assinatura XML;
- cliente SOAP;
- seleção dos endpoints SEFAZ;
- tratamento de homologação/produção;
- numeração fiscal;
- chave de acesso;
- cálculo do dígito verificador;
- persistência de XML;
- protocolo de autorização;
- cancelamento;
- inutilização;
- DANFE;
- armazenamento dos erros/rejeições;
- integração da NF-e com Venda;
- integração da NF-e com Ordem de Serviço.

Somente depois desse levantamento, planeje a implementação.

NÃO recrie código que possa ser generalizado.

Prioridade:

```text
motor existente NF-e
        ↓
extrair componentes genéricos
        ↓
motor compartilhado NF-e/NFC-e
        ↓
perfil NF-e modelo 55
perfil NFC-e modelo 65
```

---

# 2. NÃO QUEBRAR NF-e

A implementação da NFC-e não pode causar regressão na emissão atual de NF-e.

Antes das mudanças:

- identifique testes existentes;
- identifique contratos das funções públicas;
- identifique dependências;
- identifique migrations;
- identifique enums e tabelas existentes.

Depois:

- preserve compatibilidade;
- rode testes;
- adicione testes NFC-e;
- rode build;
- rode TypeScript;
- rode lint;
- corrija erros encontrados.

Não faça uma reescrita desnecessária do módulo de NF-e.

Refatore somente o necessário para compartilhar infraestrutura.

---

# 3. MODELOS FISCAIS

O sistema passará a compreender explicitamente:

```text
55 = NF-e
65 = NFC-e
```

Evite booleanos como:

```ts
isNfce: boolean
```

quando existir uma abstração melhor:

```ts
modeloDocumentoFiscal: 55 | 65
```

ou enum equivalente.

O modelo deverá fazer parte:

- da chave lógica da numeração;
- da emissão;
- da persistência;
- do XML;
- da seleção do endpoint;
- da validação;
- do DANFE;
- do histórico fiscal.

---

# 4. ARQUITETURA DESEJADA

Analise os nomes existentes no projeto e adapte a arquitetura à base atual.

Não crie classes artificiais se o projeto utilizar funções/services.

Conceitualmente precisamos chegar próximo de:

```text
FiscalEngine
│
├── FiscalSourceAdapter
│   ├── VendaAdapter
│   └── OrdemServicoAdapter
│
├── FiscalOperationResolver
│
├── ProductFiscalResolver
│
├── TaxEngine
│   ├── ICMS
│   ├── PIS
│   ├── COFINS
│   └── IBS/CBS/IS
│
├── FiscalTotalsCalculator
│
├── FiscalPaymentResolver
│
├── FiscalNumberingService
│
├── AccessKeyService
│
├── XmlSigner
│
├── CertificateService
│
├── SefazEndpointResolver
│
├── SefazSoapClient
│
├── NFe
│   └── regras específicas modelo 55
│
└── NFCe
    ├── NfceValidator
    ├── NfceXmlBuilder
    ├── NfceQrCodeService
    ├── DanfeNfceService
    ├── NfceContingencyService
    ├── NfceCancellationService
    └── NfceInutilizationService
```

Não é obrigatório usar exatamente esses arquivos/classes.

O objetivo é separação de responsabilidades.

---

# 5. ORIGEM: VENDA

Criar emissão NFC-e a partir de uma venda existente.

A NFC-e deverá buscar diretamente da Venda:

- empresa/estabelecimento;
- cliente quando identificado;
- produtos;
- quantidades;
- valores unitários;
- descontos;
- acréscimos;
- pagamentos;
- vendedor, se relevante;
- data;
- demais informações comerciais necessárias.

Não copie dados fiscais manualmente pelo frontend.

A API recebe essencialmente:

```text
vendaId
+
eventuais opções fiscais permitidas
```

e o backend carrega a fonte oficial da informação.

---

# 6. ORIGEM: ORDEM DE SERVIÇO

Criar emissão NFC-e a partir de uma Ordem de Serviço existente.

Muito importante:

A NFC-e deve considerar somente mercadorias/produtos que possam ser documentados pelo modelo 65.

Se a Ordem de Serviço possuir:

```text
Produtos
+
Serviços
```

não inclua automaticamente serviços sujeitos a ISS como itens da NFC-e.

Primeiro investigue como o motor atual de NF-e originada de OS lida com isso.

A NFC-e deve replicar a regra fiscal correta utilizada para os produtos da OS.

Nunca transforme silenciosamente serviço em mercadoria.

Se a OS possuir total comercial incluindo serviços e produtos, tome cuidado para NÃO utilizar o total geral da OS como `vNF` da NFC-e quando apenas produtos estiverem sendo documentados.

O total fiscal deve ser calculado a partir dos itens efetivamente incluídos no documento fiscal.

Também não distribua pagamentos ou descontos entre serviço e produto de maneira arbitrária.

Se houver lógica existente no projeto, reutilize.

Caso não exista, implemente separação fiscal explícita e determinística.

---

# 7. PERFIL DA NFC-e

Implementar um perfil específico para modelo 65.

O XML continua utilizando:

```xml
versao="4.00"
```

Para a NFC-e:

```xml
<mod>65</mod>
```

Os demais campos devem ser resolvidos conforme a operação e documentação oficial.

Não simplesmente copie o XML da NF-e e troque:

```xml
<mod>55</mod>
```

por:

```xml
<mod>65</mod>
```

NFC-e possui regras próprias para:

- destinatário;
- consumidor final;
- presença;
- pagamento;
- DANFE;
- QR Code;
- CSC;
- contingência;
- eventos;
- identificação do consumidor;
- operação estadual.

---

# 8. CAMPOS `ide`

Criar geração e validação específica para NFC-e.

Entre os campos relevantes:

```text
cUF
cNF
natOp
mod = 65
serie
nNF
dhEmi
tpNF
idDest
cMunFG
tpImp
tpEmis
cDV
tpAmb
finNFe
indFinal
indPres
procEmi
verProc
```

Não hardcode valores que dependem do contexto.

Exemplo:

`indPres` deve ser derivado do tipo da venda/operação quando essa informação estiver disponível.

Para uma venda presencial comum será um cenário; pedidos remotos/entrega podem exigir outro indicador.

Consultar sempre o MOC e as regras atuais.

---

# 9. PARAÍBA COMO PRIMEIRA UF

A implementação inicial deve funcionar corretamente para emitente da Paraíba.

Código UF:

```text
PB = 25
```

Adicionar regras estaduais através de uma camada própria, por exemplo:

```ts
StateFiscalRules
```

ou estrutura equivalente.

Evitar:

```ts
if (uf === "PB")
```

espalhado por dezenas de arquivos.

Preferir:

```text
fiscalRules/PB
```

ou registry de regras por UF.

Isso permitirá adicionar outras UFs posteriormente.

---

# 10. IDENTIFICAÇÃO DO CONSUMIDOR – PARAÍBA

Na Paraíba existe validação estadual importante em vigor desde 04/05/2026.

NFC-e com valor TOTAL igual ou superior a:

```text
R$ 500,00
```

deve possuir identificação por CPF ou CNPJ do destinatário.

Criar validação ANTES da transmissão.

Conceitualmente:

```ts
if (
  emitente.uf === "PB" &&
  nfce.total >= 500 &&
  !destinatario.cpf &&
  !destinatario.cnpj
) {
  throw new FiscalValidationError(
    "Para NFC-e na Paraíba com valor igual ou superior a R$ 500,00, informe CPF ou CNPJ do consumidor."
  );
}
```

Não espere receber a rejeição 750 da SEFAZ para avisar o usuário.

Referência oficial:

https://www.sefaz.pb.gov.br/announcements/17555-em-vigor-dia-4-de-maio-nova-validacao-de-emissao-da-nfc-e-sem-cpf-ou-cnpj-acima-de-r-500-00

Página oficial NFC-e PB:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

---

# 11. DESTINATÁRIO OPCIONAL

Quando permitido pela legislação/regra estadual, a NFC-e pode ser emitida sem destinatário identificado.

Portanto não replique automaticamente as validações obrigatórias da NF-e 55.

Modelar corretamente:

```text
Consumidor não identificado
Consumidor identificado por CPF
Consumidor identificado por CNPJ
Estrangeiro, se aplicável
```

Se identificado, gerar o grupo `dest` conforme schema e regras de validação atuais.

Nunca gerar CPF/CNPJ fictício.

---

# 12. PRODUTOS

A tributação dos produtos deve utilizar o mesmo mecanismo fiscal já existente na NF-e.

Reaproveitar:

```text
cProd
cEAN
xProd
NCM
CEST
CFOP
uCom
qCom
vUnCom
vProd
cEANTrib
uTrib
qTrib
vUnTrib
vDesc
vFrete
vSeg
vOutro
indTot
```

e demais campos aplicáveis.

NÃO criar um cadastro fiscal paralelo exclusivo para NFC-e.

O produto já possui ou deve possuir uma configuração fiscal centralizada.

---

# 13. GTIN

Reutilizar a lógica atual do motor NF-e.

Distinguir corretamente:

```text
GTIN válido
SEM GTIN
```

Não:

```text
0
0000000000000
EAN inventado
```

Consultar regras atuais antes de alterar validações.

Portal:

https://dfe-portal.svrs.rs.gov.br/NFCe

---

# 14. CFOP

Não determinar CFOP apenas pelo modelo do documento.

Utilizar o `FiscalOperationResolver` existente.

Para a operação normal interna de varejo podem existir, conforme o caso, CFOPs como:

```text
5101
5102
5405
```

mas NÃO hardcode um único CFOP para toda NFC-e.

CFOP depende da natureza real da operação.

Se o motor atual possui resolução:

```text
produto
+ origem
+ regime
+ operação
+ UF
```

reutilize.

---

# 15. ICMS

Não criar novo cálculo de ICMS para NFC-e.

A NFC-e deve utilizar o motor tributário existente.

O perfil NFC-e deve somente informar ao motor:

```text
modelo = 65
consumidorFinal = true
UF
natureza da operação
```

e demais contexto necessário.

Continuar suportando os grupos correspondentes aos CST/CSOSN utilizados pelo sistema, por exemplo:

```text
ICMS00
ICMS10
ICMS20
ICMS30
ICMS40
ICMS51
ICMS60
ICMS70
ICMS90

ICMSSN101
ICMSSN102
ICMSSN201
ICMSSN202
ICMSSN500
ICMSSN900
```

Não gerar CST/CSOSN apenas para a nota "passar".

---

# 16. PIS E COFINS

Reutilizar integralmente a engine atual.

Não remover PIS/COFINS somente porque o projeto já possui IBS/CBS.

Resolver os grupos conforme:

- regime;
- CST;
- produto;
- operação;
- regra vigente.

---

# 17. IBS / CBS / IS – REFORMA TRIBUTÁRIA

O projeto deve estar preparado para os campos da Reforma Tributária do Consumo.

Investigue PRIMEIRO o que o motor de NF-e atual já implementou.

Se já existir:

```text
IBS
CBS
IS
CST IBS/CBS
cClassTrib
reduções
diferimento
crédito presumido
monofásico
```

NÃO duplique.

Generalize para que NF-e e NFC-e utilizem a mesma engine.

IMPORTANTE:

Estamos em agosto de 2026.

As regras RTC sofreram alterações recentes.

A documentação encontrada mais recentemente deve ser confirmada diretamente nas fontes oficiais ANTES da implementação.

A NT 2025.002 deve ser consultada na versão MAIS RECENTE disponível.

Em 01/08/2026 foi publicada no portal da NFC-e a versão:

```text
NT 2025.002 v1.51 – RTC
```

Além disso, em 31/07/2026 houve flexibilização nas regras que causariam rejeição pela ausência de IBS/CBS.

Portanto:

NÃO hardcode:

```ts
if (!ibs || !cbs) {
   rejeitar();
}
```

apenas baseado em documentação anterior.

Implementar o leiaute RTC, mas obedecer às regras de validação realmente vigentes.

Fontes:

https://dfe-portal.svrs.rs.gov.br/NFCe

https://dfe-portal.svrs.rs.gov.br/NFCe/Documentos

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

https://dfe-portal.svrs.rs.gov.br/CFF/ValidadorRtcNfe

Tabela oficial de classificação tributária:

https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria

Não inventar `cClassTrib`.

Não transformar a descrição do produto em classificação tributária.

---

# 18. MEIOS DE PAGAMENTO

A NFC-e deve possuir o grupo `pag` corretamente.

Suportar múltiplas formas de pagamento.

Exemplo:

```text
Venda total: R$ 500

R$ 200 PIX
R$ 200 cartão
R$ 100 dinheiro
```

deve gerar múltiplos `detPag`.

Não utilizar apenas:

```ts
paymentMethod: string
```

se uma transação puder possuir pagamentos múltiplos.

Criar/adaptar estrutura equivalente:

```ts
payments: [
  {
    methodId,
    tPag,
    value,
    integrationType,
    ...
  }
]
```

Reutilizar os pagamentos já registrados na Venda/OS quando possível.

A tabela de meios de pagamento sofreu atualização em 04/03/2026.

Não mantenha uma tabela antiga hardcoded sem verificar a tabela oficial vigente.

Fonte:

https://dfe-portal.svrs.rs.gov.br/NFCe/Documentos

Procurar:

```text
Tabela de Meios de Pagamento
Informe Técnico 2024.002
```

---

# 19. PIX / CARTÃO

Investigar as regras específicas da SEFAZ-PB para pagamentos eletrônicos.

A própria página da NFC-e PB possui comunicado:

```text
Validação Cartões e PIX
```

Fonte:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

Não inventar os campos.

Consultar a documentação vigente e implementar o grupo de pagamento conforme:

- tPag;
- integração;
- dados da credenciadora/adquirente quando exigidos;
- bandeira quando aplicável;
- autorização quando aplicável.

Se o sistema já possui integração financeira/cartão, reaproveitar os dados.

---

# 20. TROCO

Implementar corretamente `vTroco`.

Exemplo:

```text
vNF = 90
dinheiro recebido = 100
vTroco = 10
```

Validar fechamento.

Nunca permita:

```text
vPag < vNF
```

sem que exista outro pagamento compondo a diferença.

Utilizar Decimal/biblioteca decimal já adotada pelo projeto.

Não utilizar `float` para cálculo fiscal.

---

# 21. TOTALIZAÇÃO

A NFC-e deve ser totalizada a partir dos itens fiscais.

Não utilizar simplesmente:

```ts
vNF = venda.total
```

O total fiscal deve ser reconciliado com a Venda/OS, porém calculado segundo as regras do XML.

Validar pelo menos:

```text
soma vProd
soma vDesc
soma vFrete
soma vSeg
soma vOutro
ICMS
PIS
COFINS
IBS
CBS
IS
vNF
pagamentos
troco
```

Usar a mesma política de arredondamento já adotada pelo motor NF-e e exigida pelo schema/MOC.

---

# 22. DESCONTOS

Se a Venda possui desconto geral, verificar como o motor atual da NF-e distribui esse desconto entre os itens.

Reutilizar EXATAMENTE essa infraestrutura quando correta.

Não gerar apenas um desconto comercial fora dos itens se o XML exigir `vDesc` item a item.

A soma deve fechar:

```text
Σ item.vDesc = desconto fiscal total
```

respeitando centavos e regras de arredondamento.

---

# 23. NUMERAÇÃO

NFC-e deve possuir sequência própria.

A numeração deve considerar no mínimo:

```text
empresa/estabelecimento
modelo = 65
série
ambiente quando necessário na arquitetura
```

Não compartilhar inadvertidamente o contador da NF-e modelo 55.

Não usar:

```sql
SELECT MAX(numero) + 1
```

sem proteção contra concorrência.

Utilizar transaction/lock/sequence/controle atômico de acordo com a arquitetura existente.

Impedir emissão simultânea com mesmo número.

---

# 24. IDEMPOTÊNCIA

Este ponto é obrigatório.

Se o usuário clicar duas vezes em:

```text
Emitir NFC-e
```

não podem ser geradas duas notas para a mesma operação por acidente.

Criar lock/idempotency por origem.

Exemplo conceitual:

```text
VENDA 123
+
MODELO 65
```

não pode iniciar duas autorizações paralelas.

Antes de emitir, verificar documento existente com estado:

```text
PROCESSANDO
AUTORIZADA
CONTINGENCIA
PENDENTE_TRANSMISSAO
```

Tratar retry de forma segura.

---

# 25. CHAVE DE ACESSO

Reutilizar o `AccessKeyService` existente da NF-e, generalizando modelo quando necessário.

A chave deve ser calculada automaticamente.

Não aceitar chave digitada.

Para NFC-e:

```text
mod = 65
```

deve compor corretamente a chave.

Reutilizar cálculo de `cDV`.

---

# 26. CERTIFICADO DIGITAL

Não criar uma segunda gestão de certificados.

A SEFAZ-PB informa que o certificado compatível utilizado para NF-e também pode ser utilizado para NFC-e nas condições do credenciamento.

Reutilizar:

- carregamento PFX/P12;
- senha;
- cadeia ICP-Brasil;
- assinatura;
- certificado cliente do SOAP;
- validação de expiração.

Nunca enviar certificado ou senha para o frontend.

Nunca logar:

```text
senha certificado
conteúdo privado PFX
CSC completo
```

Fonte:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

---

# 27. CSC

Adicionar configuração NFC-e por estabelecimento.

Precisamos suportar:

```text
CSC produção
ID CSC produção

CSC homologação
ID CSC homologação
```

ou estrutura equivalente conforme a configuração real.

O CSC NÃO é certificado digital.

Usá-lo exclusivamente conforme especificação oficial para geração/autenticação do QR Code.

Armazenar de maneira segura.

Mascarar na interface.

Não incluir o CSC em logs.

SEFAZ-PB:

Gerar CSC:

https://www.receita.pb.gov.br/ser/servirtual/documentos-fiscais/nfc-e/gerar-csc

Consultar CSC:

https://www.receita.pb.gov.br/ser/servirtual/documentos-fiscais/nfc-e/consultar-csc

Página principal:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

---

# 28. QR CODE NFC-e

Implementar o QR Code conforme versão vigente.

A NT 2025.001 introduziu o:

```text
QR Code versão 3
```

Não implementar tutoriais antigos de QR Code v2 sem antes comparar com a versão atual.

Criar componente dedicado:

```ts
NfceQrCodeService
```

Responsável por:

```text
chave
ambiente
CSC
idCSC
versão QR Code
URL consulta por UF
parâmetros previstos na NT
hash/assinatura prevista
```

Não espalhar geração de QR Code no renderer do DANFE.

Fontes:

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

https://dfe-portal.svrs.rs.gov.br/NFCe/Documentos

Página NFC-e PB:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

A SEFAZ-PB publicou como endereço único estadual:

http://www.sefaz.pb.gov.br/nfce

Confirmar antes de codificar se atualmente existe redirecionamento/URL HTTPS específica e qual é o formato exato exigido pelo QR Code v3.

Não assumir.

---

# 29. DANFE NFC-e

Criar DANFE-NFC-e próprio.

Não reutilizar visualmente o DANFE A4 da NF-e.

Deve obedecer às especificações atuais do:

```text
DANFE NFC-e
QR Code
```

e funcionar bem para:

- impressão térmica;
- PDF;
- visualização;
- reimpressão.

Deve apresentar dados obrigatórios do documento autorizado e QR Code.

O DANFE é representação auxiliar.

O documento fiscal oficial é o XML autorizado.

Fonte:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

https://www.nfe.fazenda.gov.br/portal/consulta.aspx/listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE%3D

---

# 30. WEB SERVICES / APIs SEFAZ

IMPORTANTE:

A integração oficial não é uma REST API JSON comum.

São Web Services fiscais utilizados pela NF-e/NFC-e.

Reutilize a infraestrutura SOAP/certificado já existente no módulo NF-e sempre que possível.

Criar:

```ts
SefazEndpointResolver.resolve({
  modelo,
  uf,
  ambiente,
  service
})
```

Não espalhar URLs por services diferentes.

Para obter WSDL nos serviços SVRS, acrescentar:

```text
?wsdl
```

ao endpoint.

Fonte oficial dos serviços NFC-e:

https://dfe-portal.svrs.rs.gov.br/NFCE/Servicos

---

# 31. ENDPOINTS NFC-e SVRS – PRODUÇÃO

Use o resolver de endpoints.

Os endpoints publicados atualmente pela SVRS são:

## Autorização

```text
https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx
```

WSDL:

```text
https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx?wsdl
```

## Retorno da autorização

```text
https://nfce.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx
```

## Inutilização

```text
https://nfce.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx
```

## Consulta protocolo/situação da NFC-e

```text
https://nfce.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx
```

## Status do serviço

```text
https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx
```

## Recepção de eventos

Cancelamento e demais eventos suportados:

```text
https://nfce.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx
```

Fonte:

https://dfe-portal.svrs.rs.gov.br/NFCE/Servicos

ANTES de hardcodear a utilização da SVRS para uma UF, confirmar o autorizador vigente para aquela UF.

A arquitetura deve permitir mudar o autorizador sem mudar o motor fiscal.

---

# 32. ENDPOINTS NFC-e SVRS – HOMOLOGAÇÃO

## Autorização

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx
```

## Retorno autorização

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/NfeRetAutorizacao/NFeRetAutorizacao4.asmx
```

## Inutilização

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/nfeinutilizacao/nfeinutilizacao4.asmx
```

## Consulta protocolo

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx
```

## Status serviço

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx
```

## Recepção eventos

```text
https://nfce-homologacao.svrs.rs.gov.br/ws/recepcaoevento/recepcaoevento4.asmx
```

Fonte:

https://dfe-portal.svrs.rs.gov.br/NFCE/Servicos

---

# 33. NÃO HARDCODEAR SVRS GLOBALMENTE

Apesar de a primeira implementação ser voltada à Paraíba, construa:

```ts
resolveNfceAuthorizer(uf)
```

ou equivalente.

Exemplo conceitual:

```ts
resolveEndpoint({
  uf: "PB",
  model: 65,
  environment: "production",
  service: "authorization"
});
```

Assim outras UFs poderão utilizar outros autorizadores.

Mantenha tabela/configuração central.

---

# 34. TRANSMISSÃO

Fluxo esperado:

```text
Venda/OS
↓
carregar origem
↓
resolver produtos fiscais
↓
validar elegibilidade NFC-e
↓
resolver destinatário
↓
resolver impostos
↓
resolver pagamentos
↓
calcular totais
↓
reservar numeração
↓
gerar chave
↓
montar XML
↓
validar XSD
↓
assinar XML
↓
transmitir
↓
processar retorno
↓
persistir
↓
gerar QR Code
↓
gerar DANFE-NFC-e
```

Não gerar DANFE definitivo antes da autorização, exceto fluxo específico de contingência.

---

# 35. RESPOSTA DA SEFAZ

Criar parser centralizado.

Persistir no mínimo:

```text
cStat
xMotivo
chNFe
nProt
dhRecbto
XML enviado
XML retornado
XML autorizado/procNFe
```

Não tratar toda resposta HTTP 200 como autorização.

HTTP 200 significa apenas que houve comunicação HTTP.

Quem define o resultado fiscal é:

```text
cStat
```

e o conteúdo da resposta SEFAZ.

---

# 36. STATUS INTERNOS

Reutilizar status fiscais existentes quando possível.

Caso a estrutura atual seja insuficiente, suportar algo equivalente a:

```text
RASCUNHO
PROCESSANDO
AUTORIZADA
REJEITADA
CONTINGENCIA
PENDENTE_TRANSMISSAO
CANCELADA
INUTILIZADA
ERRO
```

Não utilizar somente:

```ts
emitida: boolean
```

---

# 37. REJEIÇÃO

Uma NFC-e rejeitada não é uma NFC-e cancelada.

Registrar:

```text
status = REJEITADA
cStat
xMotivo
XML enviado
data da tentativa
```

Mostrar a rejeição ao usuário de maneira compreensível.

Exemplo:

```text
Rejeição 750:
NFC-e com valor igual ou superior a R$ 500,00 exige CPF/CNPJ do consumidor na Paraíba.
```

Quando possível, crie mensagens amigáveis sem perder:

```text
cStat original
xMotivo original
```

---

# 38. AUTORIZAÇÃO

Quando a SEFAZ retornar autorização válida:

```text
status = AUTORIZADA
```

Persistir de forma atômica:

```text
chave
protocolo
data autorização
XML autorizado
cStat
xMotivo
modelo
série
número
origem
```

Depois disponibilizar:

```text
DANFE
XML
impressão
consulta
cancelamento
```

---

# 39. CONTINGÊNCIA OFFLINE

Implementar corretamente a contingência NFC-e.

Para Paraíba:

```text
tpEmis = 9
```

A página oficial informa que a contingência aceita é:

```text
contingência offline
```

e que, restabelecida a conexão, o documento deve ser transmitido ao autorizador no prazo máximo previsto atualmente de 24 horas.

Fonte:

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

Criar:

```ts
NfceContingencyService
```

Fluxo:

```text
falha real de comunicação/indisponibilidade elegível
↓
emitir contingência
↓
tpEmis = 9
↓
gerar documento conforme manual
↓
salvar como PENDENTE_TRANSMISSAO
↓
permitir DANFE contingência
↓
retransmitir posteriormente
↓
conciliar retorno
```

NÃO criar uma segunda NFC-e quando a conexão voltar.

Retransmitir o documento correspondente à contingência conforme especificação.

---

# 40. NÃO ENTRAR EM CONTINGÊNCIA PARA REJEIÇÃO FISCAL

Muito importante.

Se a SEFAZ respondeu:

```text
Rejeição XXX
```

isso NÃO é motivo para contingência.

Contingência deve ser usada somente nas hipóteses técnicas admitidas.

Exemplo incorreto:

```text
SEFAZ rejeitou CFOP
→ emitir offline
```

PROIBIDO.

A rejeição deve ser corrigida.

---

# 41. CANCELAMENTO

Implementar cancelamento por evento.

Não alterar/deletar documento autorizado.

Fluxo:

```text
NFC-e autorizada
↓
usuário solicita cancelamento
↓
validar condições/prazo
↓
montar evento
↓
assinar
↓
RecepcaoEvento
↓
processar retorno
↓
salvar protocolo/evento
↓
status CANCELADA
```

Guardar:

```text
XML evento enviado
XML evento retornado
protocolo
cStat
xMotivo
justificativa
data
usuário responsável
```

Utilizar o endpoint:

```text
RecepcaoEvento
```

e a especificação atual.

---

# 42. INUTILIZAÇÃO

Criar suporte a inutilização da numeração NFC-e.

Não confundir:

```text
cancelamento
```

com:

```text
inutilização
```

A inutilização trata números que não foram utilizados.

Implementar:

```text
modelo
série
ano
número inicial
número final
justificativa
protocolo
status
```

Utilizar:

```text
NFeInutilizacao
```

do autorizador correspondente.

---

# 43. CONSULTA DE SITUAÇÃO

Criar serviço para consultar NFC-e pela chave.

Utilizar:

```text
NFeConsultaProtocolo
```

Isso deve permitir conciliar casos como:

```text
timeout após envio
```

onde o ERP não sabe se a SEFAZ autorizou ou não.

Nunca emitir nova nota automaticamente apenas porque houve timeout.

Primeiro consulte a situação da chave.

---

# 44. STATUS DO AUTORIZADOR

Criar serviço:

```text
getNfceSefazStatus()
```

utilizando:

```text
NFeStatusServico
```

Esse serviço pode ser utilizado:

- no diagnóstico;
- antes de contingência;
- em tela administrativa;
- em health check fiscal.

Não bloquear toda emissão apenas porque um health check isolado falhou.

---

# 45. TIMEOUT E RESULTADO INCERTO

Esta é uma regra crítica.

Cenário:

```text
ERP envia NFC-e
SEFAZ processa
conexão cai antes da resposta
```

O ERP NÃO pode assumir:

```text
não autorizada
```

e emitir outra.

Marcar estado equivalente a:

```text
RESULTADO_INCERTO
```

ou utilizar o estado já existente no sistema.

Depois:

```text
consultar chave
↓
se autorizada → reconciliar
se não encontrada → seguir estratégia segura prevista pelo MOC
```

Implementar idempotência.

---

# 46. XML

Validar XML contra os schemas oficiais antes de transmitir.

Não manter manualmente um XSD antigo se o projeto possuir mecanismo melhor.

Criar estratégia para atualização controlada dos schemas.

Fontes:

https://dfe-portal.svrs.rs.gov.br/NFCe/Documentos

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

Considerar também:

```text
NT 2026.004
CNPJ alfanumérico
```

Não assumir em novas abstrações que CNPJ sempre poderá ser convertido para `number`.

Identificadores fiscais devem ser tratados como `string`.

---

# 47. CNPJ ALFANUMÉRICO

Consultar:

```text
NT 2026.004
```

Fonte:

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

Revisar tipos internos.

Evitar:

```ts
cnpj: number
```

Preferir:

```ts
cnpj: string
```

Não remover caracteres válidos com regex projetada exclusivamente para o CNPJ numérico histórico sem analisar a nova especificação.

---

# 48. PERSISTÊNCIA

Antes de criar tabela nova, examine o banco.

Se já existir estrutura genérica de documento fiscal para NF-e, evolua-a para suportar:

```text
modelo 55
modelo 65
```

Preferível algo próximo de:

```text
fiscal_document

id
company_id
model
series
number
access_key
environment
status

source_type
source_id

xml_original
xml_signed
xml_authorized

protocol
cstat
status_message

issued_at
authorized_at
cancelled_at

created_by
created_at
updated_at
```

Não copie esse schema cegamente.

Adapte ao banco atual.

Criar migrations seguras.

---

# 49. CONFIGURAÇÃO NFC-e

Criar/adaptar configuração fiscal por estabelecimento:

```text
NFC-e habilitada
ambiente
série
próximo número
CSC
id CSC
versão QR Code
versão do processo
UF
```

Segredos devem ficar protegidos.

CSC deve ser mascarado.

Exemplo UI:

```text
CSC: *************A4F2
```

---

# 50. API INTERNA

Adapte aos padrões atuais do projeto.

Conceitualmente podemos ter:

```text
POST /api/nfce/vendas/:vendaId/emitir

POST /api/nfce/ordens-servico/:ordemServicoId/emitir

GET /api/nfce/:id

GET /api/nfce/:id/xml

GET /api/nfce/:id/danfe

POST /api/nfce/:id/cancelar

POST /api/nfce/:id/retransmitir

POST /api/nfce/inutilizacoes

GET /api/nfce/status-servico
```

Não crie exatamente essas URLs se o projeto possuir outro padrão.

Siga a arquitetura existente.

---

# 51. FRONTEND – VENDA

Na tela/detalhes da Venda, adicionar ação:

```text
Emitir NFC-e
```

somente quando elegível.

Após emissão mostrar:

```text
NFC-e nº
série
status
chave
protocolo
data
ambiente
```

Ações:

```text
Visualizar DANFE
Imprimir
Baixar XML
Consultar situação
Cancelar
```

conforme status.

---

# 52. FRONTEND – ORDEM DE SERVIÇO

Adicionar também:

```text
Emitir NFC-e
```

nas Ordens de Serviço que possuam produtos elegíveis.

Antes da emissão mostrar claramente quais produtos entrarão na NFC-e.

Não incluir serviços silenciosamente.

Exemplo:

```text
NFC-e desta OS

Produtos:
- Módulo X
- Peça Y

Serviços não incluídos:
- Diagnóstico
- Mão de obra
```

A mensagem deve seguir a realidade dos dados da OS.

---

# 53. MODAL DE EMISSÃO

Reaproveitar o dialog atual de NF-e quando fizer sentido.

Criar perfil NFC-e mais simples.

Mostrar somente campos que realmente podem ser alterados pelo usuário.

Não permitir editar manualmente:

```text
modelo
chave
cDV
cUF
nNF reservado
tpEmis interno
```

Campos como identificação do consumidor podem ser preenchidos quando permitido/necessário.

---

# 54. HOMOLOGAÇÃO

Toda implementação deverá funcionar primeiro em homologação.

`tpAmb` deve refletir corretamente:

```text
1 = produção
2 = homologação
```

Não misturar:

```text
CSC produção
```

com:

```text
CSC homologação
```

Não transmitir documento de teste para produção.

---

# 55. TESTES AUTOMATIZADOS

Criar testes para, no mínimo:

```text
NFC-e de Venda
NFC-e de OS
OS com produto + serviço
numeração modelo 65 independente da 55
CPF opcional quando permitido
PB >= 500 sem CPF/CNPJ → erro
PB >= 500 com CPF → permitido
múltiplos pagamentos
troco
desconto
ICMS
PIS
COFINS
IBS/CBS quando aplicável
XML modelo 65
chave contendo modelo correto
assinatura
parser autorização
parser rejeição
timeout
consulta situação
cancelamento
contingência
retransmissão
inutilização
duplo clique/idempotência
```

Adicionar fixtures XML sempre que útil.

---

# 56. TESTE DE CONFORMIDADE

Além dos unit tests, validar XMLs de homologação utilizando recursos oficiais.

Validador/Conformidade Fácil:

https://dfe-portal.svrs.rs.gov.br/Cff/ValidadorRtcNfe

Portal NFC-e:

https://dfe-portal.svrs.rs.gov.br/NFCe

Serviços:

https://dfe-portal.svrs.rs.gov.br/NFCE/Servicos

---

# 57. LOGS

Criar logs técnicos suficientes para diagnóstico.

Registrar:

```text
fiscalDocumentId
sourceType
sourceId
modelo
série
número
chave
ambiente
serviço SEFAZ
tempo
cStat
xMotivo
```

Nunca registrar:

```text
senha PFX
chave privada
CSC completo
dados secretos
```

Cuidado também com CPF/CNPJ em logs externos.

---

# 58. AUDITORIA

Registrar quem:

```text
emitiu
cancelou
retransmitiu
inutilizou
```

e quando.

Documentos fiscais não devem desaparecer.

Evitar DELETE físico.

---

# 59. SEGURANÇA

Todas as operações fiscais devem ocorrer no backend.

Frontend nunca recebe:

```text
PFX
senha certificado
CSC integral
chave privada
```

Aplicar autorização/permissão seguindo o sistema existente.

Não confiar em:

```text
valor
impostos
produtos
CPF
total
```

enviados pelo frontend sem reconciliar com o banco.

---

# 60. FONTES OFICIAIS OBRIGATÓRIAS

ANTES de finalizar a implementação, consulte estas fontes pela web.

## Portal Nacional NF-e/NFC-e – MOC

https://www.nfe.fazenda.gov.br/portal/consulta.aspx/listaConteudo.aspx?tipoConteudo=ndIjl+iEFdE%3D

Procurar:

```text
Manual de Orientação ao Contribuinte – MOC 7.0
Anexo I – Leiaute e Regras de Validação
Manual DANFE NFC-e / QR Code
Contingência
```

## Notas Técnicas nacionais

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

Verificar principalmente:

```text
NT 2025.001
QR Code NFC-e versão 3

NT 2025.002
Reforma Tributária IBS/CBS/IS

NT 2026.004
CNPJ alfanumérico

e quaisquer NTs mais recentes que afetem modelo 65
```

## Portal oficial NFC-e SVRS

https://dfe-portal.svrs.rs.gov.br/NFCe

## Documentação NFC-e SVRS

https://dfe-portal.svrs.rs.gov.br/NFCe/Documentos

## APIs/Web Services NFC-e

https://dfe-portal.svrs.rs.gov.br/NFCE/Servicos

## SEFAZ Paraíba NFC-e

https://portal.sefaz.pb.gov.br/info/notas-fiscais/nfc-e

## Regra CPF/CNPJ R$ 500 Paraíba

https://www.sefaz.pb.gov.br/announcements/17555-em-vigor-dia-4-de-maio-nova-validacao-de-emissao-da-nfc-e-sem-cpf-ou-cnpj-acima-de-r-500-00

## Consulta / QR Code PB

http://www.sefaz.pb.gov.br/nfce

## CONFAZ

https://www.confaz.fazenda.gov.br/

Pesquisar:

```text
Ajuste SINIEF 19/2016
```

e alterações posteriores vigentes.

## Conformidade Fácil NF-e/NFC-e RTC

https://dfe-portal.svrs.rs.gov.br/Cff/ValidadorRtcNfe

## Classificação tributária RTC

https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria

---

# 61. REGRA DE PESQUISA

Não utilize blogs como fonte principal para regra fiscal.

Prioridade obrigatória:

```text
1. Portal Nacional NF-e
2. ENCAT / SVRS
3. CONFAZ
4. Receita Federal / CGIBS
5. SEFAZ da UF
```

Se houver divergência entre uma documentação antiga e uma publicação nova:

1. compare as datas;
2. identifique a versão;
3. verifique vigência;
4. implemente a regra atual.

Estamos em:

```text
09/08/2026
```

Portanto pesquise alterações publicadas até esta data antes de concluir.

---

# 62. NÃO CONFUNDIR API DE EMISSÃO COM API DE CONSULTA PÚBLICA

A autorização deve ser feita pelos Web Services fiscais adequados.

Não tente emitir NFC-e através de:

```text
URL do QR Code
consulta pública
site SER Virtual
```

São finalidades diferentes.

Emissão/autorização:

```text
NFeAutorizacao
```

Consulta fiscal:

```text
NFeConsultaProtocolo
```

Eventos:

```text
RecepcaoEvento
```

Status:

```text
NFeStatusServico
```

Inutilização:

```text
NFeInutilizacao
```

---

# 63. NÃO USAR API TERCEIRA

O projeto já possui motor próprio de NF-e.

Portanto NÃO integrar:

```text
Focus NFe
Nuvem Fiscal
TecnoSpeed SaaS
PlugNotas
ou outro gateway pago
```

a menos que o projeto já utilize explicitamente um deles.

A intenção é reutilizar o motor existente e integrar diretamente com os Web Services fiscais oficiais.

---

# 64. CRITÉRIO DE ACEITAÇÃO

A tarefa somente estará concluída quando for possível:

```text
VENDA
→ Emitir NFC-e
→ gerar XML modelo 65
→ validar
→ assinar
→ transmitir em homologação
→ receber resposta SEFAZ
→ persistir
→ gerar QR Code
→ gerar DANFE NFC-e
```

e também:

```text
ORDEM DE SERVIÇO
→ identificar produtos
→ excluir serviços não elegíveis
→ Emitir NFC-e
→ gerar XML modelo 65
→ transmitir
→ autorizar
→ persistir
→ DANFE
```

Além disso deverão funcionar:

```text
consulta
cancelamento
contingência offline
retransmissão
inutilização
tratamento de rejeição
tratamento de timeout
idempotência
homologação/produção
```

---

# 65. PROCEDIMENTO DE IMPLEMENTAÇÃO

Execute nesta ordem:

### ETAPA 1 — investigação

Analise o projeto inteiro relacionado à NF-e.

Não altere arquivos ainda.

Produza internamente o mapa do fluxo atual.

### ETAPA 2 — plano

Liste:

```text
arquivos existentes reutilizados
arquivos alterados
arquivos novos
migrations necessárias
refatorações
riscos de regressão
```

### ETAPA 3 — refatoração compartilhada

Extraia somente o necessário para NF-e e NFC-e compartilharem:

```text
certificado
assinatura
impostos
chave
numeração
SOAP
persistência
parsing
```

### ETAPA 4 — NFC-e

Implemente:

```text
validator
XML
endpoints
CSC
QR Code
DANFE
pagamento
regras PB
```

### ETAPA 5 — Venda

Conecte ao fluxo de Venda.

### ETAPA 6 — OS

Conecte ao fluxo de Ordem de Serviço.

### ETAPA 7 — eventos

Implemente:

```text
consulta
cancelamento
inutilização
```

### ETAPA 8 — contingência

Implemente offline e retransmissão segura.

### ETAPA 9 — frontend

Implemente os controles e status.

### ETAPA 10 — testes

Rode:

```text
test
typecheck
lint
build
```

Corrija tudo.

---

# 66. ENTREGA FINAL

Ao terminar, forneça um relatório contendo:

```text
1. Como o motor NF-e funcionava antes
2. O que foi generalizado
3. Como ficou o motor NFC-e
4. Arquivos criados
5. Arquivos alterados
6. Migrations
7. Endpoints internos criados
8. Web Services SEFAZ utilizados
9. Regras específicas da Paraíba
10. Implementação de CSC
11. Implementação do QR Code
12. Implementação do DANFE
13. Contingência
14. Cancelamento
15. Inutilização
16. RTC IBS/CBS/IS
17. Testes executados
18. Resultado do build
19. Pendências, se realmente existirem
```

Também mostre qualquer decisão fiscal na qual a implementação tenha dependido de uma Nota Técnica específica.

Não esconda suposições.

Se uma regra fiscal estiver incerta:

```text
PARE naquela regra,
consulte a documentação oficial,
e só então implemente.
```

A prioridade é:

```text
CORREÇÃO FISCAL
+
REUTILIZAÇÃO DO MOTOR EXISTENTE
+
NENHUMA REGRESSÃO NA NF-e
+
IDEMPOTÊNCIA
+
AUDITORIA
+
SEGURANÇA
```

Implemente o motor completo, não apenas uma prova de conceito.