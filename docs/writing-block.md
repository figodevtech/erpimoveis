# MISSÃO — FINALIZAR O SPED FISCAL COM GERAÇÃO AUTOMÁTICA EM UM CLIQUE

## 1. CONTEXTO DO PROJETO

**Repositório:** `figodevtech/erpoficina`  
**Branch base:** `main`  
**Nova branch:** `feat/sped-fiscal-one-click`  
**Stack:** Next.js 15, React 19, TypeScript, Supabase/PostgreSQL, Tailwind CSS e Shadcn/UI.

Você é o engenheiro responsável por finalizar o módulo SPED Fiscal — EFD ICMS/IPI do ERP Oficina, transformando a implementação existente em uma funcionalidade completa, automatizada e utilizável por clientes reais.

**Esta é uma missão de implementação, não apenas de análise ou planejamento.**

Investigue o código, identifique as limitações, implemente as correções necessárias, construa os testes e entregue a funcionalidade operacional.

Não reescreva o módulo inteiro. Reutilize a arquitetura existente sempre que possível.

## 2. OBJETIVO PRINCIPAL

O usuário deve conseguir gerar o SPED Fiscal com a seguinte experiência:

1. Acessar o módulo SPED Fiscal.
2. Selecionar o mês e o ano da competência.
3. Clicar em **Gerar SPED Fiscal**.
4. Aguardar a execução automática das verificações e da geração.
5. Baixar o arquivo TXT resultante, se todos os requisitos fiscais estiverem atendidos.

O usuário NÃO deve precisar:

- Entender a estrutura interna da EFD ICMS/IPI.
- Cadastrar manualmente registros C100, C170, C190, E110 etc.
- Abrir várias abas para preparar a geração.
- Informar novamente dados que já existem no ERP.
- Executar manualmente validação, fechamento e geração como três operações separadas.
- Corrigir individualmente centenas de inconsistências que podem ser resolvidas de forma determinística pelo software.

O ERP deve fazer automaticamente todo o trabalho tecnicamente possível.

**Importante:** automação não significa inventar informações fiscais. Quando um dado obrigatório não existir ou depender de decisão contábil, o sistema deverá indicar exatamente a pendência e permitir sua resolução. Nunca gerar um arquivo FINAL incompleto como se estivesse correto.

## 3. ETAPA OBRIGATÓRIA — AUDITORIA DO MÓDULO EXISTENTE

Antes de alterar o código, examine integralmente:

- `docs/modulos/sped/PLAN.md`
- `docs/modulos/sped/ARCHITECTURE.md`
- `src/services/fiscal/sped/`
- `src/lib/sped/efd-icms-ipi/`
- `src/app/api/fiscal/sped/`
- `src/app/(app)/(pages)/(financeiro)/fiscal/sped/`
- Migrations relacionadas a `fiscal_sped_*`.
- Testes existentes.
- Módulos de emissão de NF-e, NFC-e, entradas, produtos, estoque e financeiro.

Considere que o projeto já possui:

- Estruturas de competência e versionamento.
- Geradores de diversos registros fiscais.
- Leitura de XMLs.
- Projeção fiscal de documentos.
- Apuração de ICMS e DIFAL.
- Importação da EFD anterior.
- Importação do registro 1601.
- Controle de inventário.
- Validações e diagnósticos.
- Geração de arquivos TXT.
- Armazenamento privado e histórico.

Identifique quais componentes estão operacionais, quais estão parciais e quais bloqueiam a geração automática.

Não confunda a existência de uma definição de registro com a implementação completa do seu gerador.

Consulte os leiautes, o Guia Prático e as regras oficiais vigentes para a competência, incluindo as particularidades da UF do estabelecimento.

## 4. IMPLEMENTAR O ORQUESTRADOR AUTOMÁTICO

Criar um serviço de aplicação dedicado à geração automática, reutilizando os serviços existentes.

Sugestão de nome:

`SpedAutomaticGenerationService`

A nomenclatura definitiva deve seguir as convenções do projeto.

O serviço deverá executar o fluxo:

```text
GERAR SPED FISCAL
       |
       v
Identificar estabelecimento e competência
       |
       v
Carregar configuração fiscal vigente
       |
       v
Coletar documentos fiscais e demais fontes
       |
       v
Normalizar e consolidar dados
       |
       v
Resolver automaticamente informações deriváveis
       |
       v
Construir registros da EFD
       |
       v
Apurar e conciliar valores fiscais
       |
       v
Executar validações completas
       |
       +---- Pendências bloqueantes?
       |             |
       |            SIM
       |             |
       |             v
       |       Apresentar pendências
       |       específicas e corrigíveis
       |
       +------------ NÃO
                     |
                     v
             Fechar competência
                     |
                     v
             Gerar arquivo FINAL
                     |
                     v
             Disponibilizar download
```

A geração automática deve coordenar as operações existentes de validação, fechamento e geração.

O frontend não deve precisar chamar manualmente diversas APIs em sequência.

Criar um endpoint autenticado próprio para iniciar essa operação, respeitando as permissões fiscais existentes.

Implementar tratamento de erros, concorrência, idempotência e recuperação de operações interrompidas.

Não executar trabalhos demorados em uma única requisição sujeita a timeout da Vercel. Se necessário, desenvolver processamento persistente no banco com acompanhamento de estado, sem adicionar polling excessivo.

## 5. COLETA COMPLETA DOS DADOS DO ERP

Integrar automaticamente as informações necessárias, incluindo:

**NF-e e NFC-e emitidas**

- Documentos de produção pertinentes à competência.
- XMLs autorizados.
- Situação e eventos fiscais.
- Cancelamentos.
- Devoluções.
- Produtos e tributos.
- ICMS, ICMS-ST, FCP e DIFAL, conforme aplicabilidade.
- Natureza da operação, CFOP e classificação fiscal.

**Notas fiscais de entrada**

- XMLs recebidos.
- Dados de fornecedores.
- Datas fiscais de entrada/escrituração.
- Produtos adquiridos.
- Valores tributários.
- Decisões de crédito quando legalmente necessárias.
- Referências dos documentos.

**Cadastros**

- Empresa e estabelecimento.
- Produtos.
- Clientes.
- Fornecedores.
- Unidades.
- NCM, CEST e códigos fiscais.
- Contabilista responsável.

**Outras fontes pertinentes**

- Inventário aprovado, quando exigível.
- Ajustes e apurações.
- EFD anterior ou saldos transportados válidos.
- Movimentações de pagamentos abrangidas pelo registro 1601.
- Informações complementares fiscais.

Utilize apenas fontes adequadas à escrituração.

Dados financeiros ou operacionais não devem ser transformados automaticamente em registros fiscais sem correspondência tributária comprovada.

### Requisito crítico: não perder documentos

Audite o método `sourceContext()` de `competenciaService.ts`.

Existem consultas que precisam ser verificadas quanto a paginação e limites de retorno do Supabase.

Implemente leitura completa e paginada para conjuntos grandes de documentos e itens, garantindo:

- Nenhuma NF-e elegível omitida por limite de retorno.
- Nenhuma entrada fiscal perdida.
- Nenhum item fiscal omitido.
- Nenhuma duplicidade por paginação.
- Contagens verificáveis entre fonte e projeção.
- Falha bloqueante caso não seja possível comprovar a completude da coleta.

Verifique também a seleção de competência por data de emissão, data de entrada/escrituração e demais datas aplicáveis, evitando inclusões e exclusões equivocadas.

Não presumir que todo documento pertence à competência apenas pela data de emissão.

## 6. AUTOMATIZAR O CADASTRO FISCAL DOS PRODUTOS

Atualmente o módulo pode exigir configuração canônica individual para o registro 0200.

Precisamos reduzir drasticamente esse trabalho.

Criar mecanismo de resolução automática usando os produtos e documentos já existentes.

O sistema deverá:

1. Identificar produtos utilizados nos documentos.
2. Reaproveitar códigos canônicos válidos existentes.
3. Criar associações estáveis quando a correspondência for inequívoca.
4. Preservar NCM, unidade, descrição e histórico confiável.
5. Detectar alterações cadastrais relevantes.
6. Tratar conversões de unidades.
7. Impedir duplicações ou conflitos de identidade fiscal.
8. Preservar os vínculos históricos já utilizados em competências fechadas.

Não criar códigos fiscais aleatórios ou instáveis.

Não alterar automaticamente o histórico de notas emitidas.

Quando não houver correspondência confiável, apresentar uma pendência única e objetiva de classificação.

Implementar correções em lote quando apropriado.

O objetivo é que produtos corretamente cadastrados no ERP não precisem ser recadastrados manualmente apenas para gerar o SPED.

## 7. FINALIZAR O MOTOR DOS REGISTROS FISCAIS

Revisar e completar os blocos e registros necessários à EFD ICMS/IPI.

Priorizar:

**Bloco 0**

Identificação do contribuinte, contabilista, participantes, produtos, unidades, alterações históricas, conversões e demais registros aplicáveis.

**Bloco C**

Documentos fiscais de mercadorias, seus itens, totalizações, cancelamentos, devoluções, ICMS-ST e registros condicionais.

**Bloco E**

Apuração correta do ICMS próprio, DIFAL, FCP, ajustes e informações de recolhimento.

**Bloco H**

Inventário, quando exigido para a competência.

**Bloco K**

Registros de produção e estoque exigíveis conforme estabelecimento, perfil e legislação. Não presumir dispensa nem gerar movimentos artificiais.

**Bloco 1**

Informações complementares, incluindo registros 1010, 1400 e 1601 quando aplicáveis.

**Bloco 9**

Totalizadores e encerramento do arquivo.

Também verificar a necessidade dos demais blocos da EFD, incluindo casos em que não exista movimento.

### Registros condicionais

Auditar especificamente:

- C176/C179.
- 1400.
- 1601.
- 0205.
- Documentos denegados e situações especiais.
- Registros relacionados a ajustes fiscais.
- Operações de devolução e ressarcimento.
- Regras específicas de UF, regime e perfil.

Não implementar todos os registros indiscriminadamente; implementar as regras necessárias para identificar e tratar corretamente sua aplicabilidade.

### Correção da detecção de ICMS-ST

Revisar `conditionalEvidence()` em `competenciaService.ts`.

A presença de CFOP interestadual não deve ser tomada isoladamente como comprovação da obrigatoriedade de C176/C179.

Utilizar evidências fiscais efetivas e critérios fundamentados no leiaute e na legislação.

Evitar bloqueios falsos sem reduzir a segurança tributária.

### Notas canceladas

Revisar `documentProjection.ts`, especialmente a construção do C100 com `COD_SIT = 02`, e conferir o preenchimento dos campos contra o Guia Prático vigente.

Garantir que campos proibidos ou não aplicáveis sejam omitidos corretamente.

## 8. APURAÇÃO AUTOMÁTICA E CONCILIAÇÃO

Utilizar os dados fiscais reais para preparar a apuração.

Verificar:

- Débitos de ICMS.
- Créditos admitidos.
- Estornos.
- Ajustes.
- Saldos anteriores.
- ICMS a recolher.
- DIFAL e FCP.
- Recolhimentos e documentos de arrecadação aplicáveis.

Criar verificações de consistência entre documentos fiscais, totalizadores e apuração.

Não inventar créditos, guias, pagamentos ou saldos.

Quando a apuração depender de informação externa, apresentar uma pendência clara.

A geração deve funcionar automaticamente quando todos os dados necessários estiverem presentes ou já houver decisões fiscais válidas cadastradas.

## 9. CONFIGURAÇÃO FISCAL INTELIGENTE

Implementar um cadastro fiscal inicial simples por estabelecimento.

Preencher automaticamente os campos que possam ser derivados com segurança dos dados do ERP.

Reutilizar as informações confirmadas nos meses posteriores.

As configurações deverão possuir vigência histórica.

Se houver mudança de regime tributário, contador, perfil fiscal ou exigências legais, aplicar as novas configurações apenas aos períodos apropriados.

Não solicitar repetidamente informações já confirmadas.

Não marcar automaticamente como `NAO_APLICAVEL` uma obrigação que dependa de avaliação fiscal sem evidência suficiente.

**Regra fundamental:** configuração inicial mínima, geração mensal automática.

## 10. NOVA EXPERIÊNCIA VISUAL

Refatorar a experiência principal em:

`/fiscal/sped`

Preservar o design system do ERP Oficina.

A página principal deve ser simples.

### Cabeçalho

**SPED Fiscal**

Descrição: Gere a escrituração fiscal da sua empresa automaticamente a partir dos documentos registrados no sistema.

### Seleção

- Competência: mês/ano.
- Estabelecimento: usar automaticamente o estabelecimento autorizado no contexto, quando houver apenas um.

### Ação principal

Botão destacado:

**Gerar SPED Fiscal**

### Durante a execução

Exibir progresso real por etapas, por exemplo:

- Buscando documentos fiscais.
- Processando produtos e participantes.
- Calculando apuração.
- Montando registros.
- Validando informações.
- Finalizando o arquivo.

Não utilizar progresso fictício baseado em temporizadores.

### Resultado bem-sucedido

Apresentar:

**SPED Fiscal gerado com sucesso**

- Competência.
- Empresa.
- Quantidade de documentos processados.
- Quantidade de registros gerados.
- Data da geração.
- Versão do leiaute.
- Status da geração.

Botão principal:

**Baixar SPED Fiscal (.txt)**

### Resultado com pendências

Exibir:

**Precisamos resolver algumas informações antes de gerar o arquivo final.**

Agrupar por categorias:

- Cadastro.
- Documentos fiscais.
- Tributação.
- Apuração.
- Configuração contábil.

Cada pendência deverá apresentar:

- Descrição compreensível.
- Registro ou documento afetado.
- Motivo do bloqueio.
- Ação de correção.
- Link para a tela correspondente, quando disponível.

Oferecer o botão **Corrigir pendências** e permitir **Gerar prévia para conferência** quando tecnicamente seguro, identificando-a claramente como não final.

Não permitir que pendências bloqueantes sejam simplesmente ignoradas.

### Área avançada

Manter configurações, diagnósticos técnicos, histórico, auditoria e operações de retificação em uma área secundária.

O usuário comum não deve ser obrigado a navegar por todas essas seções.

## 11. PRESERVAR SEGURANÇA E AUDITORIA

A implementação deve manter:

- Permissões `fiscal:sped` e `fiscal:sped_gerenciar`, conforme política existente.
- Isolamento entre empresas/estabelecimentos.
- Operações administrativas somente no backend.
- Storage privado.
- Versionamento de competências.
- Snapshots fiscais imutáveis após fechamento.
- Histórico de geração.
- SHA-256 dos arquivos.
- Registro de usuário responsável.
- Reabertura e retificação controladas.
- Proteção contra gerações simultâneas.
- Idempotência nas operações.

Clique duplo no botão ou repetição de requisição não pode gerar competências conflitantes ou corromper arquivos.

Não alterar dados de produção de clientes durante testes.

Não executar migrations diretamente em bancos de produção sem autorização. Criar as migrations versionadas e validar sua aplicação de forma segura.

## 12. REVISAR O CONTROLE DE COMPETÊNCIAS E LEIAUTES

Atualmente `src/lib/sped/efd-icms-ipi/layout.ts` possui resolução restrita ao ano de 2026.

Revisar esse comportamento e implementar resolução versionada baseada na competência e na vigência oficial do leiaute.

Não reutilizar cegamente o leiaute 020 em exercícios posteriores.

Manter compatibilidade com competências históricas existentes.

A geração deve utilizar o leiaute correto para cada competência.

## 13. TESTES OBRIGATÓRIOS

Criar testes automatizados para:

1. Geração automática com informações completas.
2. Empresa sem movimento fiscal.
3. Competência com centenas e milhares de documentos.
4. Paginação superior ao limite padrão do Supabase.
5. NF-e autorizada.
6. NF-e cancelada.
7. NF-e denegada e situações especiais.
8. NFC-e.
9. Entradas fiscais.
10. Devoluções.
11. ICMS-ST.
12. DIFAL/FCP.
13. Produtos sem configuração canônica anterior.
14. Produtos com códigos repetidos ou divergentes.
15. Competência com pendências fiscais.
16. Competência apta para fechamento.
17. Geração repetida do mesmo arquivo.
18. Duas gerações simultâneas.
19. Interrupção do processamento e retomada.
20. Reabertura e retificação de competência.
21. Proteção entre empresas.
22. Arquivo com totalizadores e codificação corretos.
23. Proibição de gerar FINAL com bloqueios.
24. Reconciliação da quantidade de documentos entre banco e SPED.
25. Dados históricos e leiautes diferentes.

Executar os testes existentes:

```bash
npm run test:negocio
npx tsc --noEmit
npm run build
```

Executar também os testes específicos do SPED e de banco disponíveis no repositório.

Não afirmar que o arquivo foi homologado no PVA apenas por passar nos testes internos.

Preparar um TXT real de homologação, com dados devidamente autorizados, e documentar como realizar o teste no PVA oficial.

Registrar os erros reais do PVA quando esse teste for efetivamente executado.

## 14. CRITÉRIOS DE ACEITE

A missão estará concluída tecnicamente quando:

- [ ] O usuário conseguir iniciar a geração em um clique.
- [ ] O backend orquestrar todo o processamento.
- [ ] Dados fiscais existentes forem utilizados automaticamente.
- [ ] Nenhum documento elegível for perdido.
- [ ] Produtos corretamente cadastrados não exigirem recadastro manual desnecessário.
- [ ] Configurações fiscais forem reutilizadas entre competências.
- [ ] O sistema gerar o TXT final automaticamente quando estiver apto.
- [ ] O download estiver disponível na interface.
- [ ] Pendências bloqueantes tiverem apresentação clara e ações objetivas.
- [ ] O sistema nunca ocultar ausência de dados fiscais obrigatórios.
- [ ] Os cálculos e registros estiverem cobertos por testes.
- [ ] A geração respeitar permissões e isolamento dos estabelecimentos.
- [ ] Nenhuma funcionalidade fiscal existente sofrer regressão.
- [ ] O fluxo de retificação e o histórico continuarem íntegros.
- [ ] O processo de homologação no PVA estiver documentado, com seu resultado identificado corretamente como pendente ou aprovado.

**Aceitação fiscal de produção:** exige adicionalmente validação no PVA oficial e conciliação da competência por responsável contábil. Não declarar essa etapa concluída sem evidência.

## 15. ORGANIZAÇÃO DA EXECUÇÃO

Execute o trabalho na branch:

`feat/sped-fiscal-one-click`

Ordem recomendada:

**Fase 1 — Auditoria e correções estruturais**

Investigar o módulo existente e corrigir falhas de seleção de documentos, paginação, registros e validações.

**Fase 2 — Automação fiscal**

Implementar o orquestrador, resolução automática dos dados e reaproveitamento de configurações.

**Fase 3 — Interface simplificada**

Criar o fluxo de geração em um clique, acompanhamento real e painel inteligente de pendências.

**Fase 4 — Testes e estabilização**

Executar testes automatizados, corrigir regressões e preparar homologação.

**Fase 5 — Documentação e entrega**

Criar:

`docs/modulos/sped/IMPLEMENTACAO_ONE_CLICK.md`

Documentar:

- Arquitetura final.
- Arquivos modificados.
- Novos serviços e endpoints.
- Migrations criadas.
- Fluxo completo.
- Regras de resolução automática.
- Casos que continuam exigindo confirmação fiscal.
- Testes executados e resultados.
- Limitações remanescentes.
- Procedimento de homologação no PVA.

## 16. REGRAS FINAIS PARA O CODEX

1. Não pare após gerar um plano.
2. Implemente efetivamente as funcionalidades.
3. Preserve o que já funciona.
4. Não faça refatorações desnecessárias fora do escopo.
5. Priorize correção fiscal, integridade e rastreabilidade.
6. Use exclusivamente dados confiáveis para decisões automáticas.
7. Não esconda erros ou gere um SPED aparentemente válido com documentos faltantes.
8. Não misture regras de NF-e, NFS-e e EFD ICMS/IPI.
9. Não implemente transmissão ao SPED sem uma integração oficial adequada e autorização específica.
10. Não altere diretamente a `main`.
11. Faça commits organizados e envie a branch ao remoto se houver permissão.
12. Não faça merge automaticamente.
13. Ao terminar, apresente os commits, o resumo das funcionalidades e as evidências dos testes.

# RESULTADO ESPERADO

Quero transformar o módulo SPED Fiscal do ERP Oficina em um gerador profissional e altamente automatizado.

Para uma empresa corretamente configurada, com documentos fiscais e informações obrigatórias completas, a experiência final deve ser:

**Selecionar competência → Gerar SPED Fiscal → Baixar TXT.**

Todo o processamento intermediário deverá acontecer automaticamente, no backend, com integridade, rastreabilidade e segurança fiscal.

**Comece agora pela inspeção do repositório e avance diretamente para a implementação.**
