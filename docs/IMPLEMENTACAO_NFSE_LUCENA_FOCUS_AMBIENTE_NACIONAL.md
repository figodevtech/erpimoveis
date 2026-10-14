# MISSÃO PARA O CODEX — NFS-e LUCENA/PB EXCLUSIVAMENTE VIA FOCUS NFe / EMISSOR NACIONAL

> **Projeto:** `figodevtech/erpoficina`  
> **Branch-base analisada:** `main` no commit `e88d1e11626478eb862f9141483f7b12ff2bb6b1` (consultado em 13/10/2026).  
> **Data de elaboração:** 13/10/2026.  
> **Escopo:** configurar e testar o roteamento de **NFS-e de prestadores estabelecidos em Lucena/PB (IBGE `2508604`)**, optantes pelo **Simples Nacional (ME/EPP)**, para a **Focus NFe — Emissor Público Nacional**, aproveitando o fluxo `/v2/nfsen` existente.  
> **Decisão explícita do solicitante:** **SOMENTE Focus NFe nesta entrega**. **Não integrar Tinus**, não criar cliente SOAP e não integrar diretamente com a API governamental.  
> **Natureza desta missão:** implementar código, testes, documentação e, *apenas quando estritamente necessário*, migrations. **Não emitir uma nota fiscal real sem autorização explícita.**

## 1. Objetivo e definição de pronto

Permitir que a empresa prestadora cadastrada no ERP Oficina, sediada em **Lucena/PB** e enquadrada no **Simples Nacional** (CRT `1` ou `2`, respeitando as definições atuais do ERP), utilize a rota **Focus NFe / NFS-e Nacional** (`/v2/nfsen`) **quando a habilitação do CNPJ/ambiente estiver efetivamente disponível**, sem alterar as políticas atuais de João Pessoa, Cabedelo, MEI ou outros contribuintes.

**DoD (critérios mínimos de aceite):**

1. A função pura de política escolhe `NACIONAL` + `DPS_NACIONAL` + `FOCUS_NACIONAL` para **Lucena + CRT 1/2**, em competências **a partir de 01/11/2026**.
2. Em **13/10/2026 até 31/10/2026**, **não presumir** que Lucena antecipou a habilitação: permitir o caminho nacional antecipado **somente mediante confirmação verificável e ativação explícita por empresa e ambiente**; sem essa confirmação, bloquear **com mensagem explicativa**, sem enviar requisição de emissão à Focus.
3. A emissão/revisão usa o **padrão fiscal `NACIONAL` existente** da empresa; não mistura campos fiscais dos modelos municipais.
4. O envio segue `POST /v2/nfsen?ref=...` via `NFSeService.emitirNacional`, com consulta `GET /v2/nfsen/{ref}` e cancelamento `DELETE /v2/nfsen/{ref}` pelos métodos existentes.
5. Registrar o modelo e a família do transporte na nota; **consultas/cancelamentos/reenvios de notas antigas devem respeitar o modelo gravado**, não a regra fiscal atual.
6. Sem qualquer emissão de produção automatizada no desenvolvimento ou nos testes; homologação com **consentimento explícito**, empresa de teste válida e credenciais de homologação.
7. Testes de regressão de João Pessoa, Cabedelo, MEI, agrupamento de serviços, fiscal padrão, reenvio, consulta e cancelamento passam.
8. Entrega inclui código, testes, instruções de habilitação da Focus, relatório de validação e lista transparente de pontos ainda dependentes da Focus/SEFIN.

## 2. Contexto legal e operacional confirmado

- A **Resolução CGSN nº 191/2026** estabeleceu a obrigação de uso do **Emissor Nacional** para microempresas e empresas de pequeno porte optantes pelo Simples Nacional **a partir de 01/11/2026**, inclusive por API. O governo esclarece que a utilização poderá ocorrer **independentemente da opção do município**.
- Antes de 01/11/2026, municípios com emissor próprio **podem antecipar a habilitação** de empresas do Simples no Emissor Nacional, mas **não há confirmação documentada aqui de que Lucena já antecipou**.
- A Focus NFe documenta a emissão nacional em `POST https://api.focusnfe.com.br/v2/nfsen?ref=...`, com processamento possivelmente **assíncrono** e consulta posterior.
- A Focus exige **habilitação do Ambiente da NFSe Nacional no cadastro da empresa** (homologação e/ou produção, conforme o ambiente).
- A lista pública de municípios integrados da Focus **não apresentou `2508604` (Lucena/PB) em 13/10/2026**. Isso **não comprova impossibilidade futura**; **não autoriza afirmar que o CNPJ já está liberado pela Focus ou pela SEFIN**. Confirmar com o suporte/painel antes de ativar produção.
- **Layout nacional não equivale a autorizador nacional**. João Pessoa possui lógica separada no ERP (`FOCUS_FORMATO_NACIONAL_MUNICIPAL`). **Não reutilizar essa rota para Lucena**: o alvo desta mudança é precisamente `FOCUS_NACIONAL`.
- Para o **Simples**, a obrigação relacionada a **IBS/CBS** foi esclarecida pela Receita como aplicável a partir de **01/01/2027**, segundo as normas/regulamentações pertinentes. Preservar as regras vigentes do sistema, sem antecipar campos da RTC apenas por trocar o município.

**Referências primárias verificadas em 13/10/2026:**

1. Receita Federal — Simples Nacional: obrigatoriedade NFS-e Nacional em 01/11/2026:  
   https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026
2. Portal Nacional — Municípios podem antecipar habilitação do Simples (28/09/2026):  
   https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-no-painel-administrativo-municipal-permite-antecipar-a-adocao-do-emissor-nacional-para-optantes-pelo-simples-nacional
3. Focus — Guia do **Ambiente Nacional** e habilitação na empresa:  
   https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/
4. Focus — Municípios integrados (lista pode evoluir):  
   https://focusnfe.com.br/guides/nfse/municipios-integrados/
5. Portal Federal — Documentação de produção:  
   https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual
6. Portal Federal — Documentação de homologação:  
   https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita

**Não usar a documentação municipal da Tinus como base deste desenvolvimento.** O portal https://www.tinus.com.br/csp/LUCENA/portal/index.csp é apenas contexto do emissor municipal anterior; **não deve ser usado como API de emissão nesta fase**.

## 3. Diagnóstico real do repositório (antes de editar, reler na branch atual)

Repositório: https://github.com/figodevtech/erpoficina

No commit da análise, encontrei:

| Arquivo | Situação e intervenção esperada |
|---|---|
| `src/lib/services/fiscais/nfse-politica.ts` | Contém `resolverPoliticaNFSe`, `INICIO_NACIONAL_SIMPLES = "2026-11-01"`, regras de João Pessoa/Cabedelo e MEI, `modelosPossiveisNFSe`, `resolverContextoEmissaoNFSe`. **Lucena ainda não é tratada**. |
| `src/lib/services/fiscais/nfse-transport.ts` | Já possui `FocusNacionalTransport` para `/v2/nfsen` e funções `transportDaPolitica` e `transportDoRegistro`. **Reaproveitar**, sem criar transporte novo. |
| `src/lib/services/fiscais/nfse-service.ts` | Já dispõe de `emitirNacional`, `mapearOSParaFocusNacional`, `opcaoSimplesNacionalDoPrestador`, consulta/cancelamento da família `NACIONAL`, validação de campos. **Reusar e corrigir apenas problemas comprovados**. |
| `src/app/api/nfse/de-os/[id]/route.ts` | Resolve política/padrão, prepara payload nacional, reserva NFS-e e vínculo antes de enviar; registra retornos e erros. **Preservar atomicidade, duplicidade e histórico**. |
| `src/app/api/nfse/contexto-emissao/[id]/route.ts` | Fornece à revisão a política/padrão que a emissão usará. **Exibir eventual bloqueio de habilitação**. |
| `src/app/api/config/nfse/route.ts` | Carrega/salva `nfse_config`, padrões e credenciais. **Avaliar flag por empresa/ambiente e segurança**. |
| `src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx` | Já desenha o cadastro fiscal do modelo `NACIONAL`. **Expor Lucena sem duplicar formulários**. |
| `src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/nfse-tab.tsx` | Campos e instruções gerais de NFS-e. **Exibir orientação contextual e aviso de habilitação**. |
| `src/lib/fiscal/padroesEmissaoNfse.ts` | Lista chaves `NACIONAL`, `MUNICIPAL_CABEDELO`, `MUNICIPAL_JOAO_PESSOA` e mescla preservando padrões existentes. **NÃO criar `MUNICIPAL_LUCENA`**. |
| `src/lib/services/fiscais/nfse-sync.ts` | Sincroniza consulta via Focus, preserva links e status. Deve permanecer compatível. |
| `src/app/api/nfse/[id]/reemitir/route.ts` | Reenvia com dados do registro existente e verifica mudança de política. Não alterar automaticamente um documento antigo para outra rota. |
| `src/app/api/nfse/cancelar/[id]/route.ts` | Cancela usando transporte derivado do registro. Preservar comportamento; verificar resolução do `empresaid`. |
| `src/app/api/nfse/[id]/xml/route.ts` e `src/app/api/nfse/[id]/anexar/route.ts` | Baixa XML e anexa DANFSe; não introduzir dependência municipal para Lucena. |
| `supabase/migrations/20260729220000_complete_nfse_emission_models.sql` | CHECK de `nfse.modelo_emissao` já permite `NACIONAL`; **provavelmente sem migration para adicionar modelo**. |
| `supabase/migrations/20260729230000_add_nfse_config_padroes_emissao.sql` | `nfse_config.padroes_emissao` é JSONB, com chave `NACIONAL`. |
| `src/lib/services/fiscais/nfse-politica.test.ts` | Testes de transições, modelos e emissor de JP/Cabedelo. Ampliar com Lucena. |
| `src/services/fiscal/nfsePadraoEmissao.test.ts` | Testes de contexto, padrão fiscal e manutenção de dados existentes. Ampliar com Lucena. |
| `src/services/fiscal/nfseTransporte.test.ts` e `src/services/fiscal/nfseReenvio.test.ts` | Testes de família de endpoint e reenvio; ampliar regressão. |

**Links permanentes de referência no commit analisado:**

- [Política NFSe](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/src/lib/services/fiscais/nfse-politica.ts)
- [Transporte NFSe](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/src/lib/services/fiscais/nfse-transport.ts)
- [NFSeService](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/src/lib/services/fiscais/nfse-service.ts)
- [Emissão de OS](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/src/app/api/nfse/de-os/%5Bid%5D/route.ts)
- [Configuração NFS-e](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/src/app/api/config/nfse/route.ts)
- [Documentação atual de João Pessoa/Focus no repo](https://github.com/figodevtech/erpoficina/blob/e88d1e11626478eb862f9141483f7b12ff2bb6b1/docs/documentacao_nfse_joao_pessoa_focusnfe.md)

**Obrigação do Codex:** atualizar o diagnóstico contra a HEAD efetivamente checada antes de modificar. Os caminhos acima são pontos de partida, não ordem para editar indiscriminadamente.

## 4. Escopo rigoroso — o que fazer / não fazer

### Fazer

- Adicionar resolução de **Lucena/PB `2508604`** à política de emissão **somente para empresa PRESTADORA** localizada no município e com CRT `1` ou `2`.
- Reutilizar modelo `NACIONAL`, layout `DPS_NACIONAL`, autorizador `FOCUS_NACIONAL`, integração `/v2/nfsen`.
- Respeitar data de competência fiscal e fuso `America/Fortaleza` ou fuso configurado da empresa.
- Permitir **habilitação antecipada restrita e auditável** antes de 01/11/2026, mediante indicação confirmada pela Focus/SEFIN e ação administrativa autorizada. É aceitável simplificar para **bloqueio total de emissão antes de 01/11/2026** caso não exista evidência de antecipação/habilitação; nesse caso, documentar o procedimento manual de checagem e não criar uma flag sem necessidade.
- A partir de 01/11/2026, resolver automaticamente a política nacional para Lucena CRT 1/2, mas **continuar validando a configuração da empresa na Focus e tratar erro de habilitação sem emissão alternativa silenciosa**.
- Manter o histórico de cada nota pelo transporte salvo na emissão.

### Não fazer

- **Não implementar Tinus**, SOAP, ABRASF, webservice municipal, arquivo RPS municipal, certificado XMLDSIG próprio nem API direta do governo nesta fase.
- **Não modificar João Pessoa** para `FOCUS_NACIONAL` indiscriminadamente. Seu tratamento de exceção e `FOCUS_FORMATO_NACIONAL_MUNICIPAL` devem permanecer.
- **Não mudar a rota de Cabedelo** nem demais municípios.
- **Não hardcodar** token, inscrição municipal, CNPJ, alíquota, cTribNac, número/série DPS ou credenciais.
- **Não testar com emissão real em produção** nem com uma OS real sem ordem explícita do proprietário e confirmação do cliente.
- **Não assumir** que a adesão à NFS-e Nacional ou a publicação de uma NFS-e no layout nacional provam autorização pela **API da SEFIN**.
- **Não introduzir** fallback automático para `/v2/nfse`, Tinus ou API federal se `/v2/nfsen` rejeitar Lucena. Erro de habilitação deve ser retornado e registrado.
- **Não criar migração desnecessária** alterando CHECK de `modelo_emissao`, pois `NACIONAL` já consta da constraint analisada.

## 5. Política de roteamento — requisitos funcionais precisos

### 5.1. Identificação do prestador

Use `empresa.codigomunicipio` (normalizado para 7 dígitos) e `empresa.regimetributario` — não o endereço de prestação nem o município do **tomador**. Não usar `cliente.codigomunicipio` como chave de roteamento.

### 5.2. Tabela de decisão

| Prestador / regime / competência | Resultado esperado |
|---|---|
| Lucena `2508604`, CRT 1 ou 2, competência `2026-11-01` em diante | `modelo: NACIONAL`, `layout: DPS_NACIONAL`, `autorizador: FOCUS_NACIONAL`, `usaDps: true`, `exigeRtc` definido por `rtcObrigatorio(...)` |
| Lucena CRT 1 ou 2, até `2026-10-31`, sem habilitação antecipada comprovada | **Bloqueado antes da chamada de emissão**, com motivo indicando início em novembro ou habilitação antecipada necessária |
| Lucena CRT 1 ou 2, até `2026-10-31`, com habilitação antecipada documental e ativação segura | Mesmo modelo nacional; testes em homologação são permitidos com aprovação, produção somente com autorização explícita |
| Lucena CRT 4 (MEI), qualquer competência coberta pelas regras atuais | **Manter lógica MEI nacional que já existe** |
| Lucena CRT 3, qualquer competência | **Fora do escopo**; não escolher emissor novo automaticamente; preservar comportamento/falha controlada atual |
| João Pessoa, regras de transição e exceções | Inalterado |
| Cabedelo, qualquer regime | Inalterado |
| Qualquer outro município | Inalterado |

**Nota de implementação importante:** `resolverPoliticaNFSe` hoje recebe apenas município, regime, data e itens. Para habilitação antecipada, evitar misturar IO de banco dentro da função pura. Preferir (a) passar um estado **verificado, específico da empresa** na entrada da política, ou (b) resolver o modelo nacional e retornar bloqueio no contexto/serviço sem disponibilizar o envio até confirmação. Escolher uma abordagem simples, coerente com os testes existentes e sem estados contraditórios entre **contexto de revisão** e **rota de emissão**.

### 5.3. Exemplo de comportamento (pseudocódigo — NÃO copiar sem adaptar)

```ts
const IBGE_LUCENA = "2508604";

if (municipio === IBGE_LUCENA && (regime === "1" || regime === "2")) {
  if (competencia >= "2026-11-01" || antecipacaoNacionalConfirmadaParaEsteCnpjEAmbiente) {
    return nacional(regime, competencia, "LUCENA_SIMPLES_FOCUS_NACIONAL", "Lucena/PB pelo Emissor Nacional via Focus");
  }
  // Antes da liberação antecipada: NÃO escolher FOCUS_MUNICIPAL nem enviar à Focus.
  // Retorne política bloqueada / mensagem de habilitação conforme design existente.
}
```

**Cuidado:** `nacional(...)` atualmente é um helper interno e `politica` talvez não admita `bloqueado`. Implementar bloqueio na camada correta; não estender tipos sem necessidade. **Sempre devolver a mesma decisão ao formulário e à emissão**.

## 6. Habilitação Focus — requisito externo real (não automatizar emissão como teste de disponibilidade)

### 6.1. Painel

Acessar (manualmente, com acesso autorizado):

- https://app-v2.focusnfe.com.br/minhas_empresas
- Empresa emitente específica → **Documentos Fiscais** → opções **Ambiente da NFSe Nacional – Homologação** e **Ambiente da NFSe Nacional – Produção**.
- Validar **CNPJ exato** do emitente e as opções de habilitação. **Não confundir uma configuração marcada no painel com confirmação da SEFIN**; registrar evidência e eventuais mensagens/recusas da Focus.
- Verificar certificado necessário e a correspondência exata entre certificado e CNPJ do emitente conforme orientação da Focus. Não usar certificado de matriz para filial indevidamente.
- Alternativa pela API de Empresas: os campos documentados são `habilita_nfsen_homologacao` e `habilita_nfsen_producao`. **Não alterar o cadastro na Focus em produção sem autorização**.

Docs da Focus:

- https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/
- https://doc.focusnfe.com.br/reference/atualizar_empresa

### 6.2. Estado verificável por empresa (se houver bloqueio até habilitação)

Propor uma configuração **por empresa/ambiente**, não global, por exemplo:

- `habilitacao_emissor_nacional_lucena`: booleano *opcional* e/ou metadados estruturados;
- `ambiente`: homologação / produção;
- `confirmado_em`, `origem_confirmacao`, `confirmado_por` (dados mínimos para auditoria);
- padrão **false** antes da data legal, salvo confirmação expressa;
- evitar armazenar token Focus ou PFX no campo de metadados.

**Escolha minimalista preferida:** se não há necessidade comercial de emitir antes de novembro, **não criar coluna nem tela extra para antecipação agora**: bloquear Lucena CRT 1/2 até 31/10, preparar operação para novembro e homologar quando habilitado. Se a antecipação for necessária, adicionar migration pequena, reversível e testada; não inventar dados de confirmação.

### 6.3. Diagnóstico sem emissão fiscal real

Não utilizar `POST /v2/nfsen` com dados de produção somente para descobrir se habilitou. Usar leitura/configuração do cadastro, suporte Focus e, posteriormente, emissão **controlada em homologação**, com empresa de teste e permissão expressa. Um `202` da Focus **não equivale a NFS-e autorizada**: pode significar apenas "recebida para processamento".

## 7. Mapeamento fiscal e validações

Reusar `NFSeService.mapearOSParaFocusNacional(...)` e a validação atual. Verificar os pontos abaixo antes da primeira emissão de teste:

1. **CNPJ e município prestador:** `cnpj_prestador` do cadastro da empresa; `codigo_municipio_emissora = 2508604`. **Confirmar se o modelo espera número ou string**; seguir contrato da Focus e padronização interna.
2. **Simples:** para ME/EPP, `codigo_opcao_simples_nacional = 3` e regime de apuração apropriado (`regime_tributario_simples_nacional`), de acordo com o cadastro da empresa e as opções documentadas. **CRT `2` não recebe apuração presumida**: preservar validação explícita do projeto.
3. **Serviço:** `codigo_tributacao_nacional_iss` (`cTribNac` de 6 dígitos), classificação tributária nacional correta para o serviço, `descricao_servico`, `valor_servico`, `codigo_nbs` quando aplicável, `codigo_municipio_prestacao` **conforme local efetivo**, que não necessariamente é Lucena.
4. **Tributação ISS:** `tributacao_iss`, `tipo_retencao_iss`, `percentual_aliquota_relativa_municipio` somente quando cabível. **Não inventar alíquota municipal, ISS retido ou CST**.
5. **Inscrição municipal:** `inscricao_municipal_prestador` só quando aplicável e reconhecida no cadastro nacional; a Focus orienta omissão em municípios que ainda não registraram IM no Ambiente Nacional. Expor bloqueio e ação orientada em vez de forçar zeros/falsos.
6. **Código de tributação municipal:** `codigo_tributacao_municipal_iss` pode ser exigido por parametrização municipal. Só enviar código de 3 dígitos quando correto, **não reaproveitar o código municipal antigo Tinus**.
7. **Tomador:** documento CPF/CNPJ, razão social e endereço validados sem reaproveitar município do tomador como emissor.
8. **Competência, fuso e data de emissão:** manter o mesmo dia para política, validação e payload, sem recalcular para outro dia no meio do processamento; tratar timezone `America/Fortaleza`/empresa.
9. **IBS/CBS:** manter política `rtcObrigatorio(regime, competencia)` e exigências de 2027; não forçar RTC em 2026 somente por `modelo === NACIONAL`.
10. **Numeração:** identificar comportamento atual de `serie_dps`/`numero_dps` e numeração gerenciada pela Focus; **não inventar série ou próximo número**, não transportar RPS municipal Tinus. Se a Focus exigir DPS explícita, criar/configurar sequência individual por empresa e ambiente, com trava contra duplicidade, depois de validar documentação e suporte.
11. **Reenvio:** referência exclusiva (`ref`) e idempotência; consultar antes de repetir depois de timeout. Nunca emitir duas notas na dúvida sobre o primeiro resultado.
12. **Vínculos de OS e seleção de serviços:** preservar `nfse_os_servico_vinculo`, snapshot dos itens, bloqueio de duplicidade e nota agrupada.

Referências para os campos:

- https://doc.focusnfe.com.br/reference/emitir_dps_nacional
- https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html
- https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual

**Não copiar cegamente o JSON de exemplo da Focus**: ele utiliza códigos e empresas fictícios; somente sua estrutura é exemplar.

## 8. API Focus — transporte a reutilizar

**Emissão:** `POST https://api.focusnfe.com.br/v2/nfsen?ref={referencia}`  
Docs: https://doc.focusnfe.com.br/reference/emitir_dps_nacional

**Consulta:** `GET https://api.focusnfe.com.br/v2/nfsen/{referencia}`  
Docs: https://doc.focusnfe.com.br/reference/consultar_nfse_nacional

**Cancelamento:** `DELETE https://api.focusnfe.com.br/v2/nfsen/{referencia}`  
Docs: https://doc.focusnfe.com.br/reference/cancelar_nfse_nacional

Reutilizar o gerenciamento de ambiente/token, normalização dos status, persistência de `payload_enviado` e `retorno_bruto`, diagnósticos, consulta/sincronização, links de XML e DANFSe já presentes no ERP. Respeitar exigência do código de cancelamento/justificativa documentada pela Focus, sem presumir que a justificativa municipal antiga é sempre exigida.

**Regra de ouro:** emissão da Focus pode ser assíncrona. **Só registrar `AUTORIZADA` após confirmação do autorizador**. Um HTTP `202` indica aceitação para processamento, não autorização da NFS-e.

### Matriz de erros obrigatórios

| Cenário | Tratamento |
|---|---|
| Focus retorna erro de município/CNPJ não habilitado no Ambiente Nacional | Mensagem amigável **"Emissor Nacional ainda não habilitado para este CNPJ de Lucena"**, guardando resposta original; sem fallback. |
| Focus retorna `401`/erro token | Orientar conferir credenciais e ambiente, não mascarar como rejeição fiscal. |
| Focus retorna `400`/`422` de campo inválido | Exibir validações específicas, sem substituir códigos fiscais automaticamente. |
| Focus retorna `202` | Persistir `PROCESSANDO` (ou equivalente já existente), consultar/webhook depois. |
| Timeout de rede após envio | Estado **incerto**; consultar referência primeiro, impedir duplicação. |
| Status rejeitado | Salvar erros, permitir correção por nova emissão/reenvio apenas conforme política vigente, sem perder histórico. |
| Nota autorizada antes da mudança de regra | Continuar consulta/cancelamento pelo transporte persistido na nota. |

## 9. Ajustes por camada (sequência sugerida)

### Etapa A — levantamento e testes da situação atual

1. `git checkout main && git pull` (respeitar alterações locais e orientações de workflow do projeto).
2. Criar branch **`feat/nfse-lucena-focus-nacional`** a partir da HEAD atual.
3. Ler `docs/documentacao_nfse_joao_pessoa_focusnfe.md`, `docs/manual_tecnico_nfse.md` e os testes existentes.
4. Inspecionar **todos** os caminhos que inferem modelo, autorizador, regime ou disponibilidade; pesquisar `resolverPoliticaNFSe`, `modelosPossiveisNFSe`, `transportDaPolitica`, `transportDoRegistro`, `NACIONAL`, `2507507`, `2503209`, `INICIO_NACIONAL_SIMPLES`.
5. Documentar comportamento **antes** das alterações e rodar testes focados.

### Etapa B — resolver de política (alteração principal)

Em `nfse-politica.ts`:

- Introduzir `IBGE_LUCENA = "2508604"`.
- Tratar apenas CRT 1/2 de Lucena, após o branch MEI já existente; preservar função `rtcObrigatorio`.
- Retornar política `NACIONAL/DPS_NACIONAL/FOCUS_NACIONAL` a partir de 01/11/2026.
- Antes da data, não habilitar silenciosamente a emissão sem evidência; implementar o bloqueio seguro escolhido na seção 5.
- Garantir que `modelosPossiveisNFSe` e `rotuloPoliticaNFSe` incluam Lucena corretamente.
- Não duplicar toda a política nacional para Lucena; usar o helper atual com código de regra específico e mensagem legível.

### Etapa C — contexto e tela de configuração

- Garantir que `POST /api/nfse/contexto-emissao/[id]` e a rota real de emissão usem a **mesma regra de elegibilidade**.
- Retornar modelo `NACIONAL` e padrão fiscal `padroes_emissao.NACIONAL` **quando elegível**, e erro/bloqueio explicativo quando não.
- Em **Configurações → Fiscal/Pagamentos → NFS-e**, mostrar **"Lucena/PB — NFS-e Nacional via Focus"**, as pendências de campos nacionais e instruções sobre habilitação no painel Focus.
- Não apresentar campos da Tinus nem campos municipais antigos para este cenário.
- Preservar merge de `padroes_emissao` e notas anteriores.
- Em formulário, mostrar "Emissão nacional ainda depende de habilitação do CNPJ na Focus/SEFIN" quando não comprovada.
- Corrigir apenas se necessário a exposição de certificado/senha/token: segredos devem permanecer no servidor, com UI de valor configurado mascarado; jamais quebrar outros clientes ao corrigir.

### Etapa D — emissão, retorno e ciclo de vida

- Em `de-os`, selecionar automaticamente `mapearOSParaFocusNacional` para Lucena com regra habilitada; nada de novo cliente HTTP.
- `transportDaPolitica` deverá usar `FocusNacionalTransport` já implementado.
- Registrar modelo `NACIONAL` em `nfse.modelo_emissao` e conservar todos os vínculos de OS.
- Confirmar se `transportDoRegistro` resolve nota antiga pela **família gravada**, sem depender da política atual.
- Preservar reenvio, consulta, cancelamento, XML e anexação; atualizar textos rígidos "João Pessoa"/"Focus" apenas onde o contexto exigir, sem quebrar telas.
- Se houver múltiplas empresas/bancos, sempre resolver por `empresaid` da nota/empresa atual; proibir misturar tokens/CNPJs entre clientes.
- Se o sistema usa webhooks da Focus, confirmar cobertura `nfsen` e correspondência de referência, sem criar worker de polling pesado.

### Etapa E — banco de dados e release

- Verificar no **schema atual** o CHECK de `nfse.modelo_emissao`: `NACIONAL` já permitido; **não acrescentar `MUNICIPAL_LUCENA`**.
- Usar `padroes_emissao.NACIONAL` existente, sem criar cópia para Lucena.
- Migration apenas se de fato precisar guardar **habilitação antecipada específica por empresa/ambiente**. Migration deve ser idempotente, pequena, documentada e aplicada somente após aprovação. Caso contrário, **nenhuma migration**.
- Validar projetos/bancos de cada cliente antes de executar qualquer alteração. Não aplicar no banco Demir ou outros bancos só porque o projeto Git é único.
- Não alterar tokens/certificados em `nfse_config` automaticamente.

## 10. Testes exigidos (sem uso de certificados ou CNPJs reais)

Criar/ajustar testes no mínimo para estes casos:

| Caso | Entrada | Verificação |
|---|---|---|
| L1 | Lucena, CRT 1, 31/10/2026, sem antecipação | Bloqueio; zero chamadas `POST /v2/nfsen` |
| L2 | Lucena, CRT 1, 01/11/2026 | Política `NACIONAL/DPS_NACIONAL/FOCUS_NACIONAL` |
| L3 | Lucena, CRT 2, 01/11/2026, sem apuração definida | Bloqueio fiscal apropriado, sem assumir regime de apuração |
| L4 | Lucena, CRT 2, 01/11/2026, apuração válida | Rota nacional e dados Simples coerentes |
| L5 | Lucena, CRT 1, data pré-novembro, antecipação confirmada **se implementada** | Rota nacional somente para o CNPJ/ambiente habilitado |
| L6 | Lucena, CRT 1, 31/12/2026 | `exigeRtc` conforme regra 2026 (não por ser Nacional) |
| L7 | Lucena, CRT 1, 01/01/2027 | RTC conforme política vigente do ERP |
| L8 | Lucena, CRT 3 | Não selecionar rota nacional desta missão |
| L9 | Lucena, CRT 4 | MEI continua na regra nacional existente |
| L10 | Prestador João Pessoa, tomador Lucena | Continua regra de João Pessoa |
| L11 | Prestador Lucena, tomador João Pessoa | Continua regra de Lucena |
| R1 | João Pessoa regime normal, 02/10/2026, item 14.01 | `FOCUS_FORMATO_NACIONAL_MUNICIPAL`, sem regressão |
| R2 | João Pessoa Simples até 31/10/2026 | Preservar emissor municipal, quando aplicável |
| R3 | João Pessoa com item 01.03 | Preservar exceção atual |
| R4 | Cabedelo | Rota municipal já existente, sem mudança |
| R5 | Município sem regra | Mantém erro/ausência de política existente |
| T1 | Lucena elegível | `POST /v2/nfsen?ref=...`, **nunca** `/v2/nfse` |
| T2 | Focus `202` | Nota em processamento, nunca autorizada automaticamente |
| T3 | Focus `422` por CNPJ não habilitado | Mensagem de habilitação, diagnóstico completo e sem fallback |
| T4 | Timeout / resposta incerta | Consulta prévia pela mesma referência antes de repetir envio |
| T5 | Consulta/cancelamento de Lucena | `GET`/`DELETE /v2/nfsen/{ref}` |
| T6 | Nota municipal antiga de outro município | Consulta/cancelamento continuam na família gravada |
| T7 | Edição de padrão fiscal `NACIONAL` | Preserva padrões `MUNICIPAL_*` existentes |
| T8 | Serviços agrupados em várias OS | Um documento com vínculos/snapshot corretos, sem duplicação |
| T9 | Credenciais empresa A e empresa B | Nenhum token, CNPJ, ambiente ou config vazam entre empresas |
| T10 | Homologação vs. produção | Um ambiente não usa token/habilitação do outro |

**Executar, conforme a configuração e disponibilidade do repositório:**

```bash
npm run test:negocio
npm run test:fiscal
npm run test:nfse:ui
npx tsc --noEmit
npm run lint
npm run build
```

Se um comando falhar por causa preexistente, registrar o erro e distinguir da regressão desta branch. Evitar `npm run build` com variáveis de produção que disparem efeitos colaterais; conferir scripts antes.

## 11. Validação manual obrigatória com Focus — separada do desenvolvimento

**Estado antes do teste:** avaliar se a Focus permite cadastrar/habilitar `2508604` e o CNPJ no Emissor Nacional. O fato de a lista pública não mostrar Lucena em 13/10/2026 impõe confirmação operacional, não é motivo para reescrever a API do governo.

Checklist:

- [ ] Empresa de Lucena identificada pelo **CNPJ completo e correto** (não colocar no relatório público).
- [ ] Natureza de regime ME/EPP (`CRT 1/2`) confirmada com dados fiscais do cliente.
- [ ] Painel Focus mostra a empresa e status de **Ambiente da NFSe Nacional** pertinente.
- [ ] Habilitação anterior a 01/11/2026, se desejada, foi confirmada por município/SEFIN **e** pela Focus para esse CNPJ.
- [ ] Token **de homologação** confirmado, sem exposição no log, teste ou frontend.
- [ ] Padrão fiscal `NACIONAL` preenchido com códigos válidos e revisados pelo responsável fiscal.
- [ ] Cenário sintético controlado autorizado em **homologação**.
- [ ] `POST /v2/nfsen?ref=...` retorna somente aceitação ou erro prévio, sem ser tratado como autorização automática.
- [ ] Consulta posterior mostra processamento/autorização/rejeição real do teste.
- [ ] XML/DANFSe são tratados pelo mecanismo atual do ERP.
- [ ] Emissão em produção permanece desabilitada até liberação do CNPJ e autorização expressa para o primeiro documento real.

**Se o provedor bloquear:** fornecer **código HTTP, código de erro, mensagem da Focus (sem dados pessoais ou token), ref de teste, ambiente e diagnóstico**. Concluir a implementação como **"preparada, ainda não habilitada para emitir"**, sem fallback e sem declarar sucesso.

## 12. Critérios de segurança e integridade fiscal

1. **Nenhuma chamada `POST` de produção** nos testes automatizados; mocks de rede obrigatórios.
2. Token Focus exclusivamente server-side; revisar API e UI para não retornar token/certificado/senha em claro sem necessidade, respeitando compatibilidade.
3. Não armazenar token em URL, `payload_enviado`, logs, erros ou telemetria.
4. Conferir autorização/empresa nas rotas já existentes; evitar uso de `empresa.limit(1)` se isso puder pegar o emitente errado ao operar uma nota com `empresaid` explícito.
5. Não considerar sucesso HTTP como autorização fiscal.
6. Preservar `referencia` e controlar retries em estado incerto para não gerar dupla emissão.
7. Persistir status e erros do autorizador, inclusive quando o município/CNPJ não estiver habilitado.
8. Não apagar histórico de NFS-e emitidas/rejeitadas, protocolos ou vínculos.
9. A alteração não pode aumentar polling para todas as notas/empresas. Preferir webhook existente ou consultas sob demanda.
10. Não aplicar `git push`, merge para `main`, deployments nem alterações em bancos de clientes automaticamente sem autorização na etapa correspondente.

## 13. Entregáveis e como informar resultado

Entregar na branch separada:

- Código com a política Lucena → Focus Nacional e bloqueio pré-novembro seguro.
- Reaproveitamento das camadas de emissão, consulta e cancelamento existentes.
- Testes relevantes acima, com mocks e casos de regressão.
- Documento `docs/nfse-lucena-focus-nacional.md` contendo decisões, fontes, fluxos, campos fiscais, configuração Focus e condições de produção.
- Relatório conciso no PR/commit final com **arquivos alterados, testes executados, resultados, migrations (se houver), limitações de habilitação e como ativar por CNPJ**.
- Evidência de que **João Pessoa e Cabedelo não foram redirecionados**.

### Sequência de execução solicitada ao Codex

1. Auditar a HEAD atual e comparar com o diagnóstico deste documento.
2. Implementar alteração **mínima e isolada** da política e respectiva camada de elegibilidade.
3. Aproveitar a Focus NFe existente; **não criar uma segunda integração nacional**.
4. Adequar contexto da revisão, aviso de configuração e mensagens de erro.
5. Implementar testes e rodar toda a bateria aplicável.
6. Revisar diff com atenção a JP/Cabedelo, histórico e isolamento por empresa.
7. **Criar commit na branch de implementação** com mensagem como `feat(nfse): preparar Lucena Simples para Focus Nacional`.
8. Documentar como verificar habilitação na Focus e eventuais bloqueios externos.
9. **Não realizar merge/deploy/produção** sem solicitação posterior.

---

## 14. Índice de documentação de consulta para a IA

**Focus NFe — prioritárias**

- Guia oficial do Ambiente Nacional: https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/
- Emissão DPS Nacional: https://doc.focusnfe.com.br/reference/emitir_dps_nacional
- Consulta NFS-e Nacional: https://doc.focusnfe.com.br/reference/consultar_nfse_nacional
- Cancelamento NFS-e Nacional: https://doc.focusnfe.com.br/reference/cancelar_nfse_nacional
- Atualização de empresa / habilitação NFS-e Nacional: https://doc.focusnfe.com.br/reference/atualizar_empresa
- Campos de emissão da DPS (Focus): https://campos.focusnfe.com.br/nfse_nacional/EmissaoDPSXml.html
- Municípios integrados: https://focusnfe.com.br/guides/nfse/municipios-integrados/
- Painel de empresas: https://app-v2.focusnfe.com.br/minhas_empresas
- Índice de docs para agentes, se disponível: https://doc.focusnfe.com.br/llms.txt

**Governo Federal — normativa / leiaute**

- Receita Federal — data da mudança: https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026
- Portal Nacional — antecipação da habilitação: https://www.gov.br/nfse/pt-br/noticias/nova-funcionalidade-no-painel-administrativo-municipal-permite-antecipar-a-adocao-do-emissor-nacional-para-optantes-pelo-simples-nacional
- Documentação atual de produção, manuais e leiautes: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual
- Esquemas de homologação: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita
- Endpoints públicos de referência: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao

**Código ERP Oficina**

- Repositório: https://github.com/figodevtech/erpoficina
- Política e modelos: `src/lib/services/fiscais/nfse-politica.ts`
- Transporte Focus: `src/lib/services/fiscais/nfse-transport.ts`
- Serviço de emissão: `src/lib/services/fiscais/nfse-service.ts`
- Emissão por OS: `src/app/api/nfse/de-os/[id]/route.ts`
- Padrões fiscais: `src/lib/fiscal/padroesEmissaoNfse.ts`
- Configuração fiscal: `src/app/api/config/nfse/route.ts`
- Documento atual de JP/Focus: `docs/documentacao_nfse_joao_pessoa_focusnfe.md`

**Nota ao executor:** visite as URLs oficiais antes de implementar e confira versões de 2026. Se alguma URL mudar, use o índice oficial e registre a nova URL. Não invente códigos tributários, séries DPS, habilitação municipal, comportamento de API, resposta do autorizador nem confirmação de emissão.

---

## COMANDO FINAL AO CODEX

> Execute a implementação **somente pela Focus NFe no Ambiente Nacional** para prestadores de Lucena/PB (`2508604`) optantes pelo Simples Nacional (CRT 1/2), aproveitando o que já existe no ERP Oficina. Crie a alteração isolada e compatível com os emissores existentes; proteja a transição de **01/11/2026**, habilitação por CNPJ/ambiente e o fluxo de autorização assíncrona. Teste extensivamente, faça commit em branch separada e documente o que foi validado. **Não utilize Tinus, não desenvolva API federal direta, não emita em produção, não faça merge e não altere bancos reais sem autorização.**
