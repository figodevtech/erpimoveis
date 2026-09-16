Quero que você atue como um especialista em **fiscal brasileiro, EFD ICMS/IPI e desenvolvimento de sistemas ERP**.

Seu objetivo neste primeiro momento NÃO é desenvolver código.

Quero que você faça um estudo completo sobre o **SPED Fiscal — EFD ICMS/IPI**, para que possamos posteriormente implementar um gerador de SPED Fiscal dentro de um ERP.

## 1. Primeiro explique o que é o SPED

Comece diferenciando claramente:

- SPED — Sistema Público de Escrituração Digital;
- EFD ICMS/IPI, popularmente chamada de SPED Fiscal;
- EFD Contribuições;
- NF-e;
- NFC-e;
- NFS-e;
- obrigações acessórias estaduais.

Explique o que é a **EFD ICMS/IPI**, sua finalidade, quem normalmente está obrigado, periodicidade, geração do arquivo, validação, assinatura e transmissão.

Não confunda SPED Fiscal com emissão de NF-e.

Explique o fluxo:

ERP
→ documentos fiscais
→ escrituração fiscal
→ arquivo TXT EFD ICMS/IPI
→ PVA
→ validação
→ assinatura digital
→ transmissão.

## 2. Trabalhe sempre com documentação oficial atual

Antes de tirar qualquer conclusão, consulte obrigatoriamente as fontes oficiais relacionadas ao assunto.

Priorize:

1. Portal Nacional do SPED;
2. Receita Federal;
3. Guia Prático da EFD ICMS/IPI;
4. Nota Técnica correspondente ao leiaute vigente;
5. Ato COTEPE;
6. Ajuste SINIEF 02/2009 e alterações;
7. Tabelas de Códigos da EFD;
8. Programa Validador e Assinador — PVA;
9. legislação e orientações da SEFAZ do estado do contribuinte;
10. no nosso caso inicial, SEFAZ da Paraíba.

Não trate blogs, fóruns ou respostas de terceiros como fonte normativa quando existir documentação oficial.

Sempre informe a versão e a data da documentação consultada.

## 3. Considere inicialmente o cenário de 2026

Verifique qual é o leiaute efetivamente aplicável à competência de 2026.

Na data deste prompt, nossa referência é:

- EFD ICMS/IPI;
- leiaute 020 para competências de 2026;
- Guia Prático EFD ICMS/IPI versão 3.2.4.

Mas NÃO assuma que isso continua verdadeiro no futuro.

Sempre confira a documentação oficial antes de responder ou implementar alguma regra.

Também verifique se já existe documentação publicada para o próximo leiaute e mantenha separadas:

- regra vigente;
- regra futura;
- regra já revogada.

## 4. Explique a estrutura de um arquivo SPED

Explique como funciona o formato TXT e registros delimitados por `|`.

Exemplo conceitual:

|0000|...|
|0005|...|
|0100|...|
|0150|...|
|0190|...|
|0200|...|
|C100|...|
|C170|...|
|C190|...|
|E100|...|
|E110|...|
|9900|...|
|9999|...|

Explique:

- abertura e encerramento;
- hierarquia pai/filho;
- obrigatoriedade;
- ocorrência 1:1 e 1:N;
- registros obrigatórios, condicionais e facultativos;
- contadores de registros;
- regras de totalização.

## 5. Estude principalmente os blocos relevantes para um ERP de oficina/comércio

Analise em profundidade:

### Bloco 0 — Abertura, identificação e referências

Principalmente:

- 0000;
- 0005;
- 0100;
- 0150;
- 0190;
- 0200;
- 0205;
- 0220;
- demais registros necessários ao nosso cenário.

Explique de onde cada informação normalmente vem no ERP.

### Bloco C — Documentos fiscais de mercadorias

Dê atenção especial a:

- C001;
- C100;
- C110;
- C113;
- C170;
- C176 quando aplicável;
- C190;
- C191;
- C195;
- C197;
- documentos modelo 55;
- documentos modelo 65;
- entradas;
- saídas;
- devoluções;
- cancelamentos;
- documentos complementares;
- documentos extemporâneos;
- substituição tributária;
- DIFAL;
- FCP.

Explique com bastante cuidado quando um filho do C100 deve ou não ser informado.

NÃO assuma, por exemplo, que todo C100 obrigatoriamente possuirá C170.

Verifique as regras específicas para:

- documentos emitidos pelo próprio declarante;
- documentos recebidos de terceiros;
- NF-e modelo 55;
- NFC-e modelo 65.

### Bloco E — Apuração

Estude:

- E001;
- E100;
- E110;
- E111;
- E112;
- E113;
- registros relativos a ICMS-ST quando aplicáveis;
- débitos;
- créditos;
- estornos;
- ajustes;
- saldo credor anterior;
- imposto a recolher.

Explique como o resultado dos documentos fiscais chega até a apuração.

Não trate o E110 como uma simples soma de notas.

### Bloco H — Inventário

Estude:

- H001;
- H005;
- H010;
- registros complementares quando aplicáveis.

Explique:

- quando o inventário é exigido;
- qual data deve representar;
- quantidade;
- unidade;
- valor unitário;
- valor total;
- propriedade/posse;
- estoque próprio;
- estoque de terceiros;
- estoque em terceiros.

### Bloco K

Explique quando o Bloco K se aplica e se um ERP voltado inicialmente para oficina/comércio precisa implementá-lo imediatamente ou pode tratá-lo como uma etapa posterior.

Não conclua apenas pelo ramo da empresa; consulte a regra aplicável.

### Bloco 1

Identifique os registros aplicáveis ao nosso cenário e os que dependem de regras estaduais.

### Bloco 9

Explique:

- 9001;
- 9900;
- 9990;
- 9999;
- contagem e encerramento do arquivo.

## 6. Cadastro de itens

Analise quais dados são necessários para o registro 0200 e registros relacionados.

Por exemplo:

- código interno;
- descrição;
- código de barras;
- unidade;
- tipo do item;
- NCM;
- EX TIPI;
- gênero;
- CEST;
- alterações históricas;
- conversões de unidade.

Explique a diferença entre:

**cadastro atual do produto**

e

**informação fiscal histórica existente no documento fiscal**.

Uma alteração futura de NCM, descrição, CST, CFOP ou unidade não pode reescrever silenciosamente uma escrituração passada.

## 7. Participantes

Estude o registro 0150 e explique como tratar:

- clientes;
- fornecedores;
- transportadoras;
- pessoas físicas;
- pessoas jurídicas;
- CPF/CNPJ;
- IE;
- município;
- país;
- endereço;
- participantes do exterior.

Explique também quais informações precisam ser congeladas ou historicamente reproduzíveis.

## 8. Documentos fiscais eletrônicos como fonte

Analise a possibilidade de utilizar:

- XML autorizado de NF-e emitida;
- `procNFe` recebido;
- XML obtido pela Distribuição DF-e;
- eventos de cancelamento;
- informações armazenadas no ERP.

Explique por que, para dados históricos da operação, o XML autorizado tende a ser fonte mais confiável que o estado atual do cadastro do produto.

Mas identifique também tudo aquilo que o SPED exige e que NÃO existe necessariamente dentro do XML da NF-e.

## 9. Reforma Tributária

Estude especificamente o impacto de:

- IBS;
- CBS;
- Imposto Seletivo;
- transição da Reforma Tributária do Consumo.

Verifique no Guia Prático vigente como os novos tributos afetam a EFD ICMS/IPI.

Não coloque automaticamente IBS/CBS/IS nos registros de apuração de ICMS/IPI.

Diferencie:

- informação existente no XML da NF-e;
- informação que efetivamente deve compor a EFD ICMS/IPI.

## 10. Regras estaduais da Paraíba

Como o primeiro estabelecimento utilizado para homologação está na Paraíba, consulte especificamente a **SEFAZ-PB**.

Levante:

- obrigatoriedade da EFD;
- registros dispensados ou adicionais;
- perfil do contribuinte;
- códigos de ajustes;
- ICMS;
- ICMS-ST;
- DIFAL;
- FCP;
- inventário;
- Bloco K;
- registro 1601;
- orientações específicas para regime Normal;
- eventuais regras relevantes para Simples Nacional;
- prazo de entrega;
- retificação.

Não hardcode uma regra estadual antes de identificar a fonte normativa.

## 11. PVA

Explique o papel do **Programa Validador e Assinador da EFD ICMS/IPI**.

Verifique a versão atual disponível oficialmente.

Explique a diferença entre:

- nosso próprio validador;
- regras do leiaute;
- regras do PVA;
- advertência;
- erro;
- assinatura;
- transmissão.

Nosso ERP pode possuir um pré-validador, mas o PVA oficial deve continuar sendo usado como referência de homologação.

## 12. Arquitetura de software

Ao final do estudo, proponha uma arquitetura conceitual para um gerador de SPED que possua:

- regras versionadas por leiaute;
- registros tipados;
- serializador TXT;
- motor de validações;
- origem/rastreabilidade de cada valor;
- fechamento por competência;
- snapshot dos dados;
- histórico de arquivos;
- SHA-256 do arquivo gerado;
- reabertura controlada;
- auditoria;
- testes automatizados;
- fixtures com XMLs fiscais;
- testes contra arquivos aceitos pelo PVA.

Considere que uma competência já fechada precisa ser reproduzível no futuro mesmo que cadastros do ERP tenham sido alterados.

## 13. Resultado esperado

Entregue um documento técnico estruturado contendo:

1. o que é SPED;
2. o que é EFD ICMS/IPI;
3. legislação/base normativa;
4. leiaute atualmente aplicável;
5. estrutura do arquivo;
6. blocos e registros relevantes;
7. origem de cada informação;
8. regras de entradas;
9. regras de saídas;
10. apuração;
11. inventário;
12. regras estaduais da Paraíba;
13. reforma tributária;
14. validação/PVA;
15. riscos;
16. campos que um ERP precisa armazenar;
17. arquitetura recomendada;
18. exemplos de registros;
19. checklist para implementação;
20. links e referências oficiais utilizadas.

Para qualquer conclusão fiscal importante, informe a fonte normativa correspondente.

Se houver dúvida entre duas interpretações, NÃO invente uma regra. Mostre a dúvida, as fontes encontradas e marque o assunto para validação com contador/especialista fiscal.