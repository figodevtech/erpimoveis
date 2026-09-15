Você atuará como arquiteto e desenvolvedor sênior responsável por iniciar a implementação do módulo **SPED Fiscal — EFD ICMS/IPI** no sistema `erpoficina`.

## OBJETIVO

Implementar no ERP uma camada de:

**escrituração fiscal mensal → diagnóstico → fechamento → geração do arquivo EFD ICMS/IPI TXT**

integrada ao módulo Fiscal já existente.

O objetivo NÃO é criar outro subsistema fiscal paralelo.

O SPED deverá utilizar a infraestrutura de documentos fiscais, produtos, entradas, estoque, empresas, participantes, XMLs e auditoria que já existe no sistema.

O primeiro marco de homologação será:

> selecionar uma competência real da Demir Diesel, gerar um arquivo EFD ICMS/IPI correspondente aos dados reais do período e conseguir importá-lo no PVA oficial com consistência fiscal.

## CONTEXTO TÉCNICO ATUAL

Repositório:

`figodevtech/erpoficina`

Stack:

- Next.js 15;
- React 19;
- TypeScript;
- Supabase/PostgreSQL;
- Vercel;
- Node.js 24;
- Tailwind;
- shadcn/ui.

Existe atualmente um módulo Fiscal em:

`/fiscal`

O sistema já possui:

- NF-e próprias;
- NF-e/NFC-e;
- XML autorizado;
- documentos fiscais recebidos via Distribuição DF-e;
- entradas fiscais;
- produtos;
- clientes;
- fornecedores;
- estoque;
- configurações fiscais;
- auditoria;
- permissões;
- motor fiscal de NF-e.

Algumas estruturas importantes existentes:

- `nfe`;
- `nfe_item`;
- `nfe.xml_autorizado`;
- `nfe_item.tributacao_snapshot`;
- `fiscal_dfe_documento`;
- `fiscal_dfe_documento.xml`;
- `fiscal_dfe_item_apropriacao`;
- `entrada`;
- `entradaitens`;
- `entrada.fiscal_dfe_documento_id`;
- `produto`;
- `empresa`;
- `cliente`;
- `fornecedor`;
- `estoque_movimento`;
- `unidademedida`.

A permissão atualmente usada pelo módulo fiscal é:

`financeiro:notas_fiscais`

NÃO presuma que esses nomes ou campos continuam exatamente assim.

Inspecione o repositório e o schema real antes de implementar.

## ESTADO QUE JÁ FOI LEVANTADO

Em uma análise anterior do ambiente da Demir Diesel havia aproximadamente:

- 92 NF-e autorizadas;
- todas as autorizadas com XML autorizado;
- 14 canceladas com XML original armazenado;
- 333 documentos DF-e recebidos;
- todos os DF-e com XML;
- 79 entradas fiscais confirmadas;
- 78 vinculadas diretamente ao DF-e.

Também foi constatado que muitos cadastros antigos de produtos ainda não possuem classificação fiscal completa.

Isso NÃO significa que devemos completar artificialmente documentos históricos utilizando o cadastro atual.

## PRINCÍPIO ARQUITETURAL OBRIGATÓRIO

Não adote:

`produto atual → SPED histórico`

como fonte fiscal primária.

Para documentos já ocorridos, prefira:

NF-e emitida
→ XML autorizado / snapshot fiscal
→ escrituração

e:

NF-e recebida
→ procNFe/XML armazenado
→ entrada fiscal apropriada
→ escrituração

O cadastro de produto pode participar de informações cadastrais e classificações atuais, mas uma alteração futura no produto NÃO pode alterar silenciosamente uma competência fiscal passada.

Toda decisão importante deve preservar **reprodutibilidade histórica**.

## DOCUMENTAÇÃO FISCAL

Antes de implementar registros:

1. confira a documentação oficial atual da EFD ICMS/IPI;
2. identifique o leiaute da competência;
3. confira o Guia Prático;
4. confira a Nota Técnica do leiaute;
5. confira tabelas de códigos;
6. confira regras específicas da SEFAZ-PB;
7. confira a versão atual do PVA.

Para competências de 2026, a referência levantada anteriormente é o leiaute 020.

Entretanto, NÃO hardcode a premissa “ano = 2026 significa sempre esta documentação”.

Crie arquitetura versionável.

## REGRA DE VERSIONAMENTO

Quero uma arquitetura semelhante a:

`src/lib/sped/efd-icms-ipi/`

com separação por leiaute:

`layouts/v020/`

e futuramente:

`layouts/v021/`

O motor deve conseguir determinar a versão aplicável à competência.

Regras de 2027 não devem contaminar 2026 e vice-versa.

## NÃO COMECE ALTERANDO O BANCO

Primeiro faça um levantamento completo.

Inspecione:

### GitHub

- módulo Fiscal;
- APIs fiscais;
- serviços;
- motor NF-e;
- parser XML;
- regras tributárias;
- permissões;
- migrations;
- testes;
- estoque;
- entradas;
- produtos;
- empresa;
- clientes;
- fornecedores;
- auditoria.

### Supabase

Inspecione schema, constraints, indexes, enums, RLS, funções, views e dados relevantes.

Mapeie no mínimo:

- `empresa`;
- `produto`;
- `cliente`;
- `fornecedor`;
- `unidademedida`;
- `nfe`;
- `nfe_item`;
- `fiscal_dfe_documento`;
- `fiscal_dfe_item_apropriacao`;
- `entrada`;
- `entradaitens`;
- `estoque_movimento`.

### Vercel

Confirme:

- projeto correto;
- runtime;
- versão do Node;
- deploy de produção;
- branch/commit correspondente;
- limitações relevantes de Functions;
- se geração do TXT pode ser feita de forma segura em Route Handler Node.js.

NÃO altere produção durante a fase de levantamento.

## FASE 0 — INVENTÁRIO DE DADOS

Antes de escrever o gerador, crie uma matriz:

| Informação EFD | Registro/campo | Fonte atual ERP | Confiabilidade | Falta dado? | Estratégia |
|---|---|---|---|---|---|

Exemplos:

- CNPJ;
- IE;
- razão social;
- município;
- perfil EFD;
- IND_ATIV;
- contabilista;
- CRC;
- participantes;
- código do item;
- descrição;
- NCM;
- unidade;
- tipo do item;
- CEST;
- data de emissão;
- data de entrada;
- chave;
- modelo;
- série;
- número;
- COD_SIT;
- IND_OPER;
- IND_EMIT;
- CFOP;
- CST;
- bases;
- alíquotas;
- ICMS;
- FCP;
- ST;
- DIFAL;
- ajustes;
- inventário.

Identifique claramente:

- disponível;
- derivável;
- disponível no XML;
- disponível somente no cadastro atual;
- inexistente;
- precisa de configuração;
- precisa de snapshot.

## PONTO CRÍTICO — DATAS

Verifique se hoje conseguimos representar separadamente:

- data de emissão;
- data de entrada/saída fiscal;
- data de criação do registro no ERP.

NÃO utilize `created_at` como data fiscal apenas porque é conveniente.

Se o sistema não possuir uma data fiscal necessária, proponha uma solução explícita.

## NOVAS ESTRUTURAS

Após o levantamento, avalie a necessidade de estruturas semelhantes a:

- `fiscal_sped_config`;
- `fiscal_sped_contabilista`;
- `fiscal_sped_competencia`;
- `fiscal_sped_inconsistencia`;
- `fiscal_sped_ajuste_apuracao`;
- `fiscal_sped_arquivo`;
- `fiscal_inventario_fechamento`;
- `fiscal_inventario_item`.

Os nomes NÃO são obrigatórios.

Primeiro entenda as convenções atuais do projeto.

Evite duplicação.

## COMPETÊNCIA

A unidade central do módulo deve ser a **competência fiscal**.

Exemplo:

`08/2026`

Estados possíveis poderão incluir algo semelhante a:

- ABERTA;
- EM_VALIDACAO;
- COM_ERROS;
- APTA;
- FECHADA;
- RETIFICADA.

Defina a máquina de estados cuidadosamente.

Uma competência fechada deve ser reproduzível.

Se ela for reaberta:

- registrar usuário;
- data;
- motivo;
- versão anterior;
- versão nova.

Nunca sobrescreva silenciosamente o histórico fiscal.

## SNAPSHOT

No fechamento da competência, congele os dados necessários à reprodução da EFD.

Não dependa do estado futuro das tabelas operacionais.

Precisamos conseguir responder futuramente:

> Por que o arquivo de agosto/2026 continha exatamente este valor?

Cada valor relevante deve possuir rastreabilidade.

Quando possível, registre:

- fonte;
- tabela;
- id;
- documento;
- XML;
- regra utilizada;
- versão do leiaute;
- versão do motor.

## GERADOR

O gerador deve ser determinístico.

Proponha algo semelhante a:

`src/lib/sped/efd-icms-ipi/types.ts`

`src/lib/sped/efd-icms-ipi/serializer.ts`

`src/lib/sped/efd-icms-ipi/validator.ts`

`src/lib/sped/efd-icms-ipi/layouts/v020/...`

E serviços de integração em algo semelhante a:

`src/services/fiscal/sped/`

Separe:

**regra pura do SPED**

de

**consulta ao Supabase**

e de

**interface/API**.

Não coloque regra fiscal dentro de componentes React.

## SERIALIZADOR

Crie um serializador genérico para registros EFD.

Ele deverá cuidar de:

- `|`;
- ordem dos campos;
- campo vazio;
- números;
- casas decimais;
- datas;
- strings;
- caracteres inválidos;
- quebra de linha;
- ordem dos registros;
- contadores do Bloco 9.

Não monte o TXT com concatenações espalhadas pelo código.

## PRIMEIRO ESCOPO DE REGISTROS

Comece pelo núcleo necessário ao cenário real.

### Bloco 0

Avalie e implemente inicialmente os aplicáveis entre:

- 0000;
- 0005;
- 0100;
- 0150;
- 0190;
- 0200;
- 0205;
- 0220;
- encerramentos correspondentes.

### Bloco C

Prioridade máxima:

- C001;
- C100;
- C170 quando aplicável;
- C190;
- registros complementares necessários ao cenário real;
- C990.

NÃO gere C170 indiscriminadamente.

A obrigatoriedade depende da operação e das regras do Guia.

Implemente regras conforme a documentação vigente.

### Bloco E

Implemente depois que o Bloco C estiver reconciliado:

- E001;
- E100;
- E110;
- E111;
- filhos necessários;
- encerramento.

Não implemente:

`E110 = soma dos C190`

como regra simplificada.

Modele:

- débitos;
- créditos;
- estornos;
- ajustes;
- saldo anterior;
- deduções;
- imposto a recolher.

### Bloco H

Prepare arquitetura de snapshot de inventário.

Implemente H005/H010 quando aplicável à competência e à obrigação do estabelecimento.

### Bloco 1

Implemente somente registros comprovadamente necessários.

### Bloco 9

Implemente corretamente:

- 9001;
- 9900;
- 9990;
- 9999.

Os contadores deverão ser calculados pelo próprio gerador.

## ICMS / ST / FCP / DIFAL

Mapeie separadamente:

- ICMS próprio;
- ICMS-ST;
- FCP;
- FCP-ST;
- DIFAL;
- desoneração;
- diferimento;
- créditos;
- ajustes.

Não reduza toda a tributação a:

`base × alíquota`.

Utilize os valores efetivamente escrituráveis presentes no documento/snapshot e as regras do Guia.

## C190

Crie testes extensivos para o agrupamento do C190.

A chave de agrupamento deverá seguir rigorosamente a documentação vigente.

Não escolha campos de agrupamento por intuição.

Precisamos testar documentos contendo múltiplos:

- CST;
- CFOP;
- alíquotas;
- situações tributárias.

Os totais devem reconciliar com a escrituração.

## REFORMA TRIBUTÁRIA

O ERP já possui estruturas de IBS/CBS.

NÃO misture automaticamente esses valores na EFD ICMS/IPI.

Consulte o Guia vigente para determinar como os novos tributos devem ser tratados.

O XML pode conter IBS/CBS/IS enquanto o registro de ICMS da EFD não os incorpora da mesma maneira.

Crie testes específicos para isso.

## PARTICIPANTES

Construa a geração do 0150 sem depender cegamente do cadastro atual.

Para participantes de documentos fiscais históricos, determine a fonte mais confiável entre:

- snapshot;
- XML;
- cadastro.

Evite que uma alteração futura de endereço, município, IE ou nome mude uma escrituração fechada.

## PRODUTOS

O código interno do item deve ser estável dentro da escrituração.

Mapeie:

- produto cadastrado;
- item avulso;
- item vindo de documento recebido;
- produtos antigos;
- alterações de descrição;
- alterações de NCM;
- unidade;
- CEST;
- tipo do item.

Não altere automaticamente dados históricos para “corrigir” o SPED.

Quando faltar informação obrigatória, gere uma **inconsistência fiscal**.

## MOTOR DE DIAGNÓSTICO

Antes de gerar um arquivo final, execute uma validação.

Classifique problemas em pelo menos:

- ERRO_BLOQUEANTE;
- ADVERTENCIA;
- INFORMACAO.

Exemplos:

- empresa sem configuração SPED;
- contabilista ausente;
- participante sem município;
- item sem NCM;
- unidade inválida;
- documento sem XML;
- chave inválida;
- documento duplicado;
- CFOP incompatível;
- CST ausente;
- C190 inconsistente;
- apuração divergente;
- inventário obrigatório não fechado.

Cada inconsistência deve possuir contexto suficiente para a UI abrir o registro que originou o problema.

## UI

Adicionar ao módulo Fiscal uma área de:

**SPED Fiscal**

Preferencialmente:

`/fiscal/sped`

A página inicial deverá listar competências.

Exemplo visual:

SPED Fiscal

Competência      Status      Documentos      Erros      Arquivo

08/2026          ABERTA      79              3          —
07/2026          FECHADA     65              0          TXT

Ao abrir uma competência, exibir abas ou seções semelhantes a:

- Visão geral;
- Documentos;
- Participantes;
- Itens;
- Apuração;
- Inventário;
- Inconsistências;
- Arquivos;
- Auditoria.

A experiência deve ser de **fechamento fiscal**, e não apenas de “download de TXT”.

## APIs

Planeje contratos semelhantes a:

- configuração SPED;
- contabilista;
- competências;
- diagnóstico;
- validação;
- ajustes;
- fechamento;
- reabertura;
- geração;
- download.

Siga as convenções reais existentes do projeto.

Não crie API redundante quando um serviço interno for suficiente.

## PERMISSÕES

Analise se:

`financeiro:notas_fiscais`

é suficiente.

Talvez seja interessante separar no futuro:

- visualizar SPED;
- editar configuração;
- realizar ajustes;
- fechar competência;
- reabrir;
- gerar arquivo.

Mas não crie um conjunto excessivo sem avaliar o padrão atual de permissões do ERP.

## AUDITORIA

Todas as ações críticas devem ser auditáveis:

- alteração de configuração;
- ajuste manual;
- fechamento;
- reabertura;
- geração;
- substituição/retificação.

Aproveite o mecanismo de auditoria que já existe no ERP.

## ARQUIVOS

Ao gerar o TXT, armazene metadados como:

- competência;
- versão do leiaute;
- data;
- usuário;
- quantidade de registros;
- SHA-256;
- versão sequencial;
- finalidade;
- hash do contexto de geração.

Não sobrescreva a versão anterior.

## PVA

Nosso validador NÃO substitui o PVA oficial.

O primeiro ciclo deve ser:

ERP
→ gerar TXT
→ importar no PVA
→ analisar erros
→ corrigir motor
→ repetir.

Mantenha fixtures de competências que já passaram pelo PVA para prevenir regressões.

## TESTES

O módulo fiscal deve possuir forte cobertura automatizada.

Crie testes unitários para:

- formatação;
- datas;
- decimais;
- C100;
- C170;
- C190;
- E110;
- participantes;
- produtos;
- Bloco 9;
- contadores;
- caracteres;
- cancelamentos;
- devoluções;
- notas extemporâneas;
- ST;
- FCP;
- DIFAL;
- reforma tributária.

Crie também testes golden-file:

entrada conhecida
→ geração
→ TXT esperado.

Qualquer alteração de regra deve mostrar explicitamente a diferença no arquivo esperado.

## VERCEL

Faça a geração no servidor.

Use Node.js Runtime.

Não coloque processamento fiscal sensível exclusivamente no browser.

Avalie duração e memória da Function, mas NÃO faça otimização prematura.

Se a geração do período puder ser feita de forma determinística e rápida, um Route Handler é suficiente.

Caso o volume futuro exija processamento maior, deixe a arquitetura preparada para desacoplamento.

## SEGURANÇA

- nunca exponha `service_role` ao frontend;
- não exponha XML fiscal completo sem autorização;
- preserve RLS;
- APIs devem validar autenticação e permissão;
- arquivos SPED devem ter controle de acesso;
- não registre certificado/senha/XML sensível em logs;
- não altere RLS apenas para fazer uma chamada funcionar.

## PROCESSO DE DESENVOLVIMENTO

Não implemente tudo de uma vez.

Execute nesta ordem:

### Etapa 1 — Descoberta

Entregue:

- arquitetura atual;
- schema;
- fontes dos dados;
- gaps;
- riscos;
- matriz EFD ↔ ERP.

### Etapa 2 — Design

Entregue:

- modelo das novas tabelas;
- máquina de estados;
- contratos TypeScript;
- arquitetura de serviços;
- arquitetura de registros;
- plano de migrations;
- plano de testes.

### Etapa 3 — Fundação

Implemente:

- configuração;
- contabilista;
- competência;
- motor de registros;
- serializador;
- validador básico.

### Etapa 4 — Bloco 0

Implementar e testar.

### Etapa 5 — Bloco C

Implementar documentos reais e reconciliar XML ↔ SPED.

### Etapa 6 — Bloco E

Implementar apuração.

### Etapa 7 — Bloco 9

Fechar arquivo válido estruturalmente.

### Etapa 8 — UI e diagnóstico

Construir workflow de fechamento.

### Etapa 9 — PVA

Gerar um mês real e homologar.

### Etapa 10 — Complementos

Inventário, regras especiais da PB e demais registros.

## SOCIATIC GATE / DECISÕES BLOQUEANTES

Antes de implementar uma decisão fiscal cuja resposta não esteja comprovada na documentação oficial ou no sistema, pare e apresente:

- questão;
- impacto;
- opções;
- fonte oficial;
- recomendação técnica.

Perguntas puramente cosméticas ou facilmente reversíveis NÃO devem bloquear o desenvolvimento.

## REGRAS ABSOLUTAS

1. Não inventar regra fiscal.
2. Não inferir valor fiscal desconhecido apenas para “fazer o PVA passar”.
3. Não usar cadastro atual para reescrever documento histórico.
4. Não alterar XML autorizado.
5. Não misturar IBS/CBS com ICMS sem regra oficial.
6. Não hardcode regra exclusiva da Demir como regra global.
7. Não hardcode regra da Paraíba como regra nacional.
8. Não fazer migration destrutiva sem necessidade.
9. Não alterar produção para experimentar.
10. Não declarar que um arquivo está fiscalmente correto apenas porque o TypeScript compilou.

## PRIMEIRA TAREFA AGORA

Comece SOMENTE pela **Etapa 1 — Descoberta**.

Acesse GitHub, Supabase e Vercel.

Não faça alterações.

Entregue:

1. resumo da arquitetura fiscal atual;
2. tabelas e campos relevantes;
3. fluxo das NF-e emitidas;
4. fluxo das NF-e recebidas;
5. fluxo das entradas;
6. origem dos valores tributários;
7. qualidade dos dados;
8. gaps para SPED;
9. matriz registro/campo EFD ↔ fonte ERP;
10. proposta inicial de arquitetura;
11. riscos;
12. decisões que precisam de validação contábil/fiscal;
13. plano detalhado para a Etapa 2.

Inclua evidências concretas do repositório e do banco.

Não faça commit, migration, deploy ou alteração de dados nesta primeira tarefa.