# MISSÃO CODEX — Integração NFS-e Lucena/PB (TINUS 2.03) no ERP Oficina da FIGO

> **Data da investigação:** 13/10/2026  
> **Repositório:** [`figodevtech/erpoficina`](https://github.com/figodevtech/erpoficina), branch de referência `main`  
> **HEAD verificado na análise:** `e88d1e11626478eb862f9141483f7b12ff2bb6b1` — **confira se houve novos commits antes de editar**.  
> **Objetivo:** permitir aos **clientes com estabelecimento prestador em Lucena/PB (IBGE 2508604)** emitir, consultar, baixar e, somente se homologado, cancelar NFS-e pela rota municipal **TINUS**, sem alterar as rotas e o histórico da Focus de outros clientes. Empresa-alvo: **Simples Nacional (CRT 1 ou 2; confirmar no cadastro)**.  
> **Entregáveis:** código + migration(s) + testes + documentação operacional + resumo de evidências; **não emitir notas fiscais reais sem aprovação expressa**.

## 0. Regras de execução obrigatórias para a IA

1. **Leia o repositório real**, especialmente os arquivos mapeados abaixo, e a documentação/anexos fornecidos. Não trate os trechos deste plano como substitutos da versão atual do código.
2. Crie branch `feat/nfse-lucena-tinus` a partir de `main` atualizada. Não faça push na `main`, não mexa nos projetos Supabase de clientes reais e não faça deploy automaticamente.
3. **Não invente WSDL, URL de serviço, operação SOAP, cabeçalho/soapAction, credencial ou aprovação do contribuinte.** Descubra e confirme esses dados no serviço/portal da Tinus e com o fornecedor antes de ativar produção. Se não for possível, implemente até o limite testável com mocks e mantenha produção bloqueada com diagnóstico claro.
4. **Não confunda** (a) *layout de NFS-e nacional*, (b) *Emissor Público Nacional* e (c) *webservice municipal Tinus*. A Tinus 2.03 aqui documentada recebe **RPS ABRASF/SOAP/XML** e não o JSON REST `/v2/nfsen` da Focus.
5. Isolamento por empresa/CNPJ, idempotência, status, série e numeração fiscal **não são opcionais**. No caso de timeout/desconhecido, consulte antes de reemitir.
6. Nenhuma nota existente da Focus pode mudar silenciosamente de provedor por causa da política atual de Lucena, de mudança de data ou de alteração de configuração da empresa.
7. **Não copie as informações fiscais de João Pessoa ou Cabedelo** para Lucena: códigos, alíquotas, natureza, retenção e regime de apuração pertencem ao cadastro/contador do prestador de Lucena.
8. Se houver divergência entre PDF, XSD, exemplo XML e comportamento do webservice, registre evidência e aplique **XSD oficial + confirmação do fornecedor**. Não “corrija” arbitrariamente o leiaute.
9. A migração potencial de ME/EPP optante pelo Simples Nacional ao Emissor Nacional prevista para **01/11/2026** é assunto **distinto**. Reconfirme a regulamentação e a habilitação do CNPJ antes de estabelecer uma virada de roteamento; não suponha que a Tinus será aceita indefinidamente nem altere a regra de todos os municípios.

## 1. Fontes oficiais e materiais obrigatórios (links clicáveis)

| Fonte | Consulta e finalidade |
|---|---|
| Repositório privado | https://github.com/figodevtech/erpoficina |
| Prefeitura/Tinus Lucena — portal | https://www.tinus.com.br/csp/LUCENA/portal/index.csp (acesso pode exigir sessão; no portal procurar **NFS-e Nota Nacional / Manuais / Leiautes / WebService**) |
| Documentação de suporte do padrão TINUS (TecnoSpeed) | https://atendimento.tecnospeed.com.br/hc/pt-br/articles/360008654153-Documenta%C3%A7%C3%A3o-T%C3%A9cnica-Padr%C3%A3o-TINUS |
| Documentação técnica oficial NFS-e | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica |
| Leiautes NFS-e 2026 (produção) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual |
| Monitoramento de adesão/implantação dos municípios | https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes |
| Consulta da disponibilidade nacional por município | https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/ |
| API Focus — NFSe municipal | https://doc.focusnfe.com.br/reference/nfse |
| API Focus — NFSe Nacional | https://doc.focusnfe.com.br/reference/nfse-nacional |
| API Focus — dados dos municípios | https://doc.focusnfe.com.br/reference/municipios |
| Esquema nacional RTC citado no **manual Tinus** (validar se há edição nova) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/pl_nfse_nt04_rtcv101-esquemas.zip/view |
| Leiaute nacional RTC citado no **manual Tinus** (validar se há edição nova) | https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexovi-leiautesrn_rtc_ibscbs-v1-01-02.xlsx/view |

**Anexos obrigatórios fornecidos com esta missão** — o Codex **precisa receber estes arquivos** (o PDF e o RAR do chat original não fazem parte do GitHub automaticamente):

- `20261013215810697776000.pdf` — **Manual de Integração TINUS 203**, revisão **23/10/2025**, **48 páginas**.
- `20261013215802190128000.rar` — pacote original de esquemas e exemplo, contendo:
  - `WSNFSE203.IBSCBS.Service.xsd` (schema `http://www.abrasf.org.br/nfse.xsd`);
  - `xmldsig.xsd` (XML Digital Signature);
  - `EnviarLoteRpsEnvioExemplo.xml` (**modelo ilustrativo com placeholders; NÃO é XML válido de envio em produção**).

**Importante:** os arquivos de exemplo e os schemas devem ser usados como fixtures e documentação de desenvolvimento, não como evidência de que um CNPJ possui liberação de produção. O PDF não informa WSDL/URLs de Lucena diretamente. NÃO use parâmetros de sessão copiados de links do portal.

### 1.1. Evidências específicas do manual/anexos

- Manual p. **4–6**: RPS e NFS-e; informa que instâncias do objeto NFS-e observam definições da Autoridade Nacional/ADN. **Isso não transforma o canal de envio da Tinus em API REST nacional.**
- Manual p. **7–13**: fluxos de lote de RPS, envio síncrono, geração, consulta, cancelamento e substituição.
- Manual p. **14–20**: comunicação **HTTPS + SOAP Document/Literal wrapped + XML**, WSDL e certificados ICP-Brasil; assinar RPS isolado e, em seguida, lote. Namespace indicado: `http://www.abrasf.org.br/nfse.xsd`.
- Manual p. **21–22**: lote de RPS é tratado assincronamente; outras operações podem ser síncronas.
- Manual p. **36–41** (numeração impressa; conferir páginas do PDF): operações como `RecepcionarLoteRps`, `RecepcionarLoteRpsSincrono`, `GerarNfse`, `CancelarNfse`, `ConsultarLoteRps`, `ConsultarNfseRps`; **confirme os nomes efetivos no WSDL** e a disponibilidade municipal.
- **XSD (`tcInfDeclaracaoPrestacaoServico`)**: `OptanteSimplesNacional` e `IncentivoFiscal` são requeridos; `regApTribSN` também consta como **obrigatório no XSD**, após `IncentivoFiscal` e antes de `IBSCBS`. Tipo `tsRegimeApuracaoSimpNac`, aceitando `1`, `2` ou `3`.
- **Divergência real**: `EnviarLoteRpsEnvioExemplo.xml` tem `<OptanteSimplesNacional>` e `<IncentivoFiscal>`, mas **não contém `<regApTribSN>`**. O exemplo também emprega valores `X`, `XX`, datas fictícias e trechos de assinatura ilustrativos. **Jamais enviar este XML literalmente.**
- **XSD**: `Competencia` em `tcInfDeclaracaoPrestacaoServico` é `xs:date`, não datetime. Confira formato de `DataEmissao` no tipo do RPS e não replique o placeholder do exemplo onde contradiga o schema.
- **XSD**: `<IBSCBS>` aparece em estruturas distintas, com contextos distintos; sua obrigatoriedade não pode ser decidida simplesmente pela ocorrência da string. Analisar pai, versão, data e regra tributária.
- **XSD**: o tipo `tcDadosServico` traz `ValorServicos`, `IssRetido`, `ItemListaServico`, `Discriminacao`, `CodigoMunicipio` e `ExigibilidadeISS`, além de campos opcionais; usar ordem exata do `xs:sequence`.
- **XSD**: `tcLoteRps` requer `NumeroLote`, `CpfCnpj`, `QuantidadeRps`, `ListaRps`, atributo `versao`, e admite `InscricaoMunicipal`.
- A documentação **TecnoSpeed** informa procedimento usual de habilitação por CNPJ, necessidade de homologação, acompanhamento de lotes e possível janela de processamento de aproximadamente 30 minutos. Trata-se de **orientação sobre o padrão Tinus, não garantia de configuração idêntica em Lucena**.
- A mesma página da TecnoSpeed contém observações sobre cancelamento **potencialmente desatualizadas/contraditórias**; não presumir cancelamento operacional sem ensaio ou confirmação da Tinus.
- A assinatura ilustrativa do XML utiliza identificadores de algoritmos antigos como `rsa-sha1`; não adotar como política de segurança sem verificar o contrato WSDL, as exigências atuais do provedor e a viabilidade de assinar com algoritmos modernos. **Nunca degradar silenciosamente a assinatura.**

## 2. Diagnóstico do ERP Oficina na `main` verificada

Os caminhos abaixo **foram encontrados no GitHub** na revisão indicada no cabeçalho.

| Local no repositório | Estado atual verificado e modificação requerida |
|---|---|
| [`src/lib/services/fiscais/nfse-politica.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/services/fiscais/nfse-politica.ts) | `NFSeModeloEmissao` admite `NACIONAL`, `MUNICIPAL_CABEDELO`, `MUNICIPAL_JOAO_PESSOA`; `AutorizadorNFSe` só conhece a Focus. `resolverPoliticaNFSe()` retorna `null` para municípios fora dessas regras (exceto MEI nacional). Adicionar Lucena de forma isolada e configurável, sem confundir layout com autorizador. |
| [`src/lib/services/fiscais/nfse-transport.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/services/fiscais/nfse-transport.ts) | Contrato `NFSeTransport` com `emitir`, `consultar`, `cancelar`. Implementações atuais: `FocusMunicipalTransport`, `FocusNacionalTransport`, `FocusFormatoNacionalMunicipalTransport`. `transportDaPolitica()` e `transportDoRegistro()` **não conhecem Tinus**. Refatorar contrato com compatibilidade para o provedor e registro histórico. |
| [`src/lib/services/fiscais/nfse-service.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/services/fiscais/nfse-service.ts) | `NFSeService` concentra mapeadores **JSON Focus** (`mapearOSParaFocus`, `mapearOSParaFocusCabedelo`, `mapearOSParaFocusNacional`) e comunicação com Focus. Criar `TinusNfseClient` e mapeador **XML próprio**, reutilizando só a base de dados e regras comuns. |
| [`src/app/api/nfse/de-os/[id]/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/de-os/%5Bid%5D/route.ts) | Reserva a linha `nfse`, valida/associa serviços via `vincular_nfse_os` **antes** do envio, decide `politica`, mapeia JSON Focus e persiste status/payload. **Manter a proteção de serviços duplicados**; inserir escolha explícita do mapeador/provider e reserva atômica de RPS/lote Tinus. |
| [`src/app/api/nfse/contexto-emissao/[id]/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/contexto-emissao/%5Bid%5D/route.ts) | Revisão da OS chama a política e carrega o padrão do **modelo exato**. Integrar modelo/padrão de Lucena e status de disponibilidade do provider. A tela e a rota de envio devem decidir **a mesma coisa** para os mesmos serviços/data/empresa. |
| [`src/lib/services/fiscais/nfse-sync.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/services/fiscais/nfse-sync.ts) | `syncNfseWithFocus()` assume Focus, seleciona token Focus e chama `transportDoRegistro(modelo_emissao, service)`. Transformar em sincronizador agnóstico (`syncNfse` ou wrapper compatível) e escolher credenciais pelo **registro da nota**. |
| [`src/app/api/nfse/consultar/[id]/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/consultar/%5Bid%5D/route.ts) | Depende de `syncNfseWithFocus`; deverá consultar lote/RPS Tinus quando o registro indicar Tinus. |
| [`src/app/api/nfse/cancelar/[id]/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/cancelar/%5Bid%5D/route.ts) | `empresa` lida com `.limit(1)` e cancelamento pressupõe Focus. **Corrigir para empresa do registro e autorização de acesso**; permitir cancelamento Tinus só depois de comprovado. |
| [`src/app/api/nfse/[id]/reemitir/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/%5Bid%5D/reemitir/route.ts) | Reenvia `payload_enviado` como JSON, gera `referencia` nova e evita mudar autorizador. Criar estratégia específica: **RPS não deve ser renumerado automaticamente após timeout**; consultar lote/RPS antes de outra tentativa. |
| [`src/lib/services/fiscais/nfse-registro.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/services/fiscais/nfse-registro.ts) | Salva `payload_enviado`, `retorno_bruto`, `tentativas` e interações. Adaptar representação segura de XML e mascarar dados sensíveis; manter diagnóstico de todas as operações. |
| [`src/app/api/nfse/[id]/xml/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/%5Bid%5D/xml/route.ts) | Busca XML em URL retornada pela Focus, com fallback para `syncNfseWithFocus`. Para Tinus, buscar XML autorizado via serviço/armazenamento **privado**, sem forjar `url_xml` pública. |
| [`src/app/api/nfse/[id]/anexar/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/%5Bid%5D/anexar/route.ts) | Baixa PDF oficial ou gera DANFSe interno. Tornar sincronização genérica e priorizar PDF oficial Tinus, somente se confirmado/obtido; manter fallback marcado conforme regra atual. |
| [`src/app/api/config/nfse/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/config/nfse/route.ts) | `nfse_config` já tem `provedor`, `inscricao_municipal`, `serie_rps`, `token`, `certificado_a1_base64`, `senha_certificado`, `padroes_emissao`. GET atualmente **retorna certificado e senha** à interface. Não multiplicar esta exposição: melhorar fluxo de segredos, com indicador `configurado` em vez de retornar material secreto. |
| [`src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/nfse-tab.tsx`](https://github.com/figodevtech/erpoficina/blob/main/src/app/%28app%29/%28pages%29/configuracoes/fiscal-pagamentos/components/nfse-tab.tsx) | Tela contém `provedor` texto livre, série, certificado/senha e editor dos padrões. Adicionar opção específica `Tinus (Lucena)` e diagnóstico de habilitação para o CNPJ; não mostrar senha/certificado. |
| [`src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx`](https://github.com/figodevtech/erpoficina/blob/main/src/app/%28app%29/%28pages%29/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx) | Renderiza padrões disponíveis via `modelosPossiveisNFSe` e campos municipais/nacionais. Adicionar `MUNICIPAL_LUCENA_TINUS` ou chave similar consistente, incluindo `regApTribSN`, ISS/retido, item LC116, CNAE opcional, NBS/RTC condicionais. |
| [`src/lib/fiscal/padroesEmissaoNfse.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/lib/fiscal/padroesEmissaoNfse.ts) | Whitelist `MODELOS_PADRAO_NFSE` com 3 modelos. Incluir Lucena e preservar merge por modelo — salvar novo padrão **nunca apaga os existentes**. |
| [`src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/%28app%29/%28pages%29/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types.ts) | Tipos da UI espelham modelo/layout/autorizador; sincronizar tipos, labels e validações com a nova rota. |
| [`supabase/migrations/20260729220000_complete_nfse_emission_models.sql`](https://github.com/figodevtech/erpoficina/blob/main/supabase/migrations/20260729220000_complete_nfse_emission_models.sql) | Constraint `nfse_modelo_emissao_check` hoje aceita 4 valores: `MUNICIPAL`, `MUNICIPAL_JOAO_PESSOA`, `MUNICIPAL_CABEDELO`, `NACIONAL`. Criar migration **nova, incremental** para novo modelo e identificação do fornecedor, sem editar migration aplicada. |
| [`supabase/migrations/20260729230000_add_nfse_config_padroes_emissao.sql`](https://github.com/figodevtech/erpoficina/blob/main/supabase/migrations/20260729230000_add_nfse_config_padroes_emissao.sql) | `padroes_emissao jsonb` persiste os padrões separados. Preservar formato, migrar/adicionar chave de Lucena. |
| [`supabase/migrations/20260901230000_nfse_tentativas_reenvio.sql`](https://github.com/figodevtech/erpoficina/blob/main/supabase/migrations/20260901230000_nfse_tentativas_reenvio.sql) | Auditoria, tentativas e notificações já existem; reaproveitar, sem zerar histórico em reprocessamentos. |
| [`src/app/api/nfse/por-os/[id]/route.ts`](https://github.com/figodevtech/erpoficina/blob/main/src/app/api/nfse/por-os/%5Bid%5D/route.ts) | A listagem seleciona `modelo_emissao` e filtra vínculo de OS: expor provedor/status/protocolo de modo seguro e não quebrar notas agrupadas. |

**Testes regressivos reais encontrados:** `src/lib/services/fiscais/nfse-politica.test.ts`, `src/services/fiscal/nfsePadraoEmissao.test.ts`, `src/services/fiscal/nfseTransporte.test.ts`, `src/services/fiscal/nfseReenvio.test.ts`, `src/services/fiscal/nfseSelecaoAgrupada.test.ts`, `src/services/fiscal/nfseDocumentos.test.ts`, `src/lib/services/fiscais/nfse-service.test.ts`.

## 3. Arquitetura-alvo de roteamento

**Regra-chave:** o município de emissão vem do **estabelecimento prestador** (`empresa.codigomunicipio`), **NÃO** da cidade do tomador, da OS ou do usuário. Validar CNPJ e estabelecimento com `empresa.id`/escopo do tenant.

```text
POST /api/nfse/contexto-emissao/[osId]
  -> carregar empresa + seleção de serviços + configuração
  -> resolverPoliticaNFSe({município, regime, data, itens, capacidade do provedor})
      Lucena 2508604 + configuração TINUS validada + período municipal aplicável
        -> modelo MUNICIPAL_LUCENA_TINUS
        -> layout ABRASF_TINUS_203
        -> autorizador TINUS_MUNICIPAL
      Lucena + Emissor Público Nacional confirmado / CNPJ habilitado
        -> modelo NACIONAL + autorizador FOCUS_NACIONAL
      demais municípios
        -> comportamento existente sem mudanças
  -> exibir padrão fiscal correspondente e capacidade do transporte

POST /api/nfse/de-os/[id]
  -> REPETIR resolução acima com a mesma seleção
  -> validar cadastro + credenciais + numeração
  -> reservar nota e vínculo OS/serviços ANTES da chamada externa
  -> mapear domínio -> documento fiscal do provedor
  -> assinar XML RPS/lote, validar XSD, SOAP HTTPS (Tinus)
  -> persistir provider/modelo/referência/RPS/lote/status/resposta
  -> em processamento: consultar até autorização/rejeição (com limites)

CONSULTA / CANCELAMENTO / XML / REENVIO / ANEXO
  -> SEMPRE ler provedor + modelo + identificadores GRAVADOS NO REGISTRO
  -> resolver transporte histórico, nunca resolver pelo município/data atuais
```

### 3.1. Decisão sugerida (ajuste aos tipos reais)

```ts
const IBGE_LUCENA = '2508604';
// Adicionar aos tipos, sem remover valores antigos:
type AutorizadorNFSe =
  | 'FOCUS_MUNICIPAL'
  | 'FOCUS_NACIONAL'
  | 'FOCUS_FORMATO_NACIONAL_MUNICIPAL'
  | 'TINUS_MUNICIPAL';
type LayoutNFSe = 'MUNICIPAL_LEGADO' | 'DPS_NACIONAL' | 'ABRASF_TINUS_203';
type NFSeModeloEmissao =
  | 'NACIONAL' | 'MUNICIPAL_JOAO_PESSOA'
  | 'MUNICIPAL_CABEDELO' | 'MUNICIPAL_LUCENA_TINUS';

// Este é pseudocódigo de política, NÃO implementação completa.
// Não habilitar com base apenas no município.
if (municipio === IBGE_LUCENA && comprovadaMigracaoNacional && cnpjHabilitadoNaFocus)
  return politicaNacionalConfirmada;
if (municipio === IBGE_LUCENA && config.tinus?.habilitado && periodoMunicipalPermitido)
  return politicaTinusMunicipal;
if (municipio === IBGE_LUCENA)
  return bloqueioComPendenciasDeHabilitacao; // fail closed
```

**Decisão importante:** `resolverPoliticaNFSe` hoje é função **pura**, com data passada como argumento. Evite fazer HTTP, buscar o banco ou usar `Date.now()` dentro dela; acrescente ao parâmetro um objeto **estático** de capacidades/flags ou introduza um `resolverRotaNFSe` que recebe a política e a configuração, preservando determinismo e testes. Onde o chamador atual não passa capacidades, adote fallback seguro, não Tinus “disponível = true” por padrão.

### 3.2. Identidade de provider no documento, além do modelo

Proposta de migration incremental, revisar RLS/índices/dados existentes antes da execução:

- Em `nfse`: `provedor_emissao text` (`FOCUS` / `TINUS_LUCENA`), **default de compatibilidade `FOCUS` para registros antigos**; `ambiente_emissao`; `rps_serie`, `rps_numero`, `rps_tipo`, `numero_lote`, `protocolo_lote`; `payload_formato` (`FOCUS_JSON`/`TINUS_XML`), `xml_envio_storage_path` (privado), `xml_retorno_storage_path` (privado) e `identificador_externo` quando aplicável. Ajustar nomes conforme padrão real da base, sem duplicar atributos existentes.
- `nfse.modelo_emissao`: incluir `MUNICIPAL_LUCENA_TINUS` na constraint; **não converter notas antigas** por heurística de município.
- Em `nfse_config`: configuração explícita **por empresa e por provedor**, com status de credenciamento, flag operacional e URLs de ambiente validadas. Aproveitar `provedor`, `serie_rps` e certificado se adequado, mas não misturar token Focus com senha/certificado Tinus.
- Criar tabela ou função atômica de **sequências RPS/lote por `(empresa_id, provedor, ambiente, série)`** com índice único e RPC transacional (concorrência, retries, rollover). Nunca gerar número RPS com timestamp e nunca reutilizar indevidamente um RPS já processado.
- Preservar `nfse_os_servico_vinculo` e seus índices únicos; manter invariantes de impedimento de faturar duas vezes a mesma seleção de serviços.
- RLS/tenant: cada nota, certificado e sequência acessível apenas no estabelecimento certo; backend com `supabaseAdmin` **ainda deve verificar autorização e pertinência antes de ler ou mutar**.
- Armazenar o **XML assinado** e o retorno em storage privado criptografado; no `payload_enviado`/`retorno_bruto`, guardar metadados ou documento sanitizado, nunca senha de certificado, token, chave privada, certificados com segredos nem envelope de autenticação.
- Separar referências: `nfse.referencia` é correlação interna do ERP/Focus; `RPS` e `NumeroLote` são IDs fiscais com regras próprias. Criar chaves únicas e índices para impedir emissão duplicada.
- Tratar estados adicionais do fluxo Tinus: `AGUARDANDO_LOTE`, `PROCESSANDO`, `AUTORIZADA`, `REJEITADA`, `CANCELAMENTO_PENDENTE`, `CANCELADA`, `RESULTADO_DESCONHECIDO`. Se for necessário preservar `status` legado, mapear estados internos sem falsear `AUTORIZADA`.

**Crítica de segurança já presente no código:** `GET /api/config/nfse` serializa `certificado_a1_base64` e `senha_certificado`; para a implementação Tinus, substituir exibição por `certificadoConfigurado`/`temCredenciais` e endpoint autenticado de atualização de segredo. Não exibir certificado, senha ou token em GET/JSON/log, não carregar PFX no browser.

## 4. Cliente Tinus SOAP + assinatura XML

Implementar um módulo isolado, por exemplo:

```text
src/lib/services/fiscais/tinus/
  tinus-types.ts
  tinus-config.ts
  tinus-schema.ts
  tinus-xml.ts
  tinus-assinatura.ts
  tinus-soap-client.ts
  tinus-resposta.ts
  tinus-transport.ts
  __fixtures__/              # somente exemplos inofensivos e sanitizados
  *.test.ts
```

**Contrato desejado:** `TinusMunicipalTransport implements NFSeTransport`, com resultado normalizado do ERP, mas campos adicionais para `lote`, `RPS`, `protocolo`, `numeroNfse`, `codigoVerificacao`, `xmlAssinado`, erro municipal. Quando uma operação municipal não estiver liberada, retorne **indisponível explicitamente**, não finja sucesso.

### 4.1. Pré-condições e sequência de emissão

1. Verificar `empresa.codigomunicipio === '2508604'`, regime CRT 1/2, CNPJ, inscrição municipal sem máscara, ambiente, flags/credenciamento e certificado do **mesmo prestador autorizado**.
2. Conferir WSDL homologação/produção (URL real, endpoint, operação, cabeçalho, SOAPAction, namespaces, versão SOAP, TLS/mTLS e retorno) **junto à Tinus**. Usar URLs em configuração server-side permitidas/allowlist, não URL livre enviada pelo cliente HTTP (evitar SSRF).
3. Mapear dados da OS e serviços para modelo tipado RPS/Tinus 2.03: prestador, tomador PF/PJ, município prestação/incidência, serviços selecionados (inclusive OS agrupada), tributos, retenções, códigos e regime SN. RPS e nota fiscal não são equivalentes; preservar `identificaçãoRps` e valor total.
4. Gerar documento XML estritamente conforme `WSNFSE203.IBSCBS.Service.xsd`, com namespace e ordem `xs:sequence` corretos; validar valores, `xml:escape`, formato de datas e decimais. Não usar regex para serializar XML.
5. Incluir `OptanteSimplesNacional=1` para prestador optante e `regApTribSN` conforme **cadastro confirmado**: `1` federais+ISS dentro do DAS; `2` federais pelo SN e ISS fora; `3` federais/ISS fora do SN. No regime CRT 2 **não inventar** código; exigir confirmação fiscal do contribuinte/contador. Não copiar `regime_tributario_simples_nacional` do mapeador JSON nacional sem verificar equivalência formal.
6. Verificar `IncentivoFiscal`, `ExigibilidadeISS`, `IssRetido`, `ResponsavelRetencao` e base/aliquota: regras distintas. `CodigoCnae` no XSD é opcional; a TecnoSpeed observa que, se informado, pode ser necessário `CodigoTributacaoMunicipio` com mesmo valor — confirmar regra de Lucena antes de impor.
7. Grupo `IBSCBS`: respeitar XSD e regras temporais aplicáveis; não presumir que `exigeRtc=false` do mapeador Focus autoriza preenchimento incompleto da Tinus; não enviar um grupo incompleto.
8. Assinar o **RPS** pelo seu `Id` e, em seguida, montar e assinar o **lote**, conforme manual (p.20); usar XMLDSig/C14N e certificado ICP-Brasil com cadeia validada, anti-XXE, sem `getInsecure()` ou bypass de TLS. Testar assinaturas localmente contra fixtures e confirmar algoritmos permitidos. **Exemplo usa RSA-SHA1**, logo buscar orientação atual Tinus antes de usá-lo.
9. Validar XML antes da rede, inclusive schema importado `xmldsig.xsd`; checar se os esquemas originais são mutuamente consistentes (imports e URIs). Testes locais devem falhar para `regApTribSN` ausente, ordem errada, datas inválidas e assinatura inválida.
10. Enviar SOAP Document/Literal ao endpoint municipal real, com timeout, AbortController, retry **somente em operações seguras**. Nunca assumir que timeout significa rejeição: pode ter sido autorizado no município.
11. Persistir resultado e respectivos identificadores. Se lote assíncrono, status fica `PROCESSANDO`/pendente e o worker/consulta faz polling com limites e backoff; evitar polling a cada abertura de tela e custos de Vercel.
12. Quando a Tinus devolver número NFS-e/código de verificação, associar à linha correta pela chave `(empresa, ambiente, série, RPS/lote)` e registrar autorização **uma única vez**. Anexar documentos oficiais sem reemitir.

### 4.2. SOAP e XML: nada de placeholders de exemplo

Os nomes de operações são citados no manual (confirmar no WSDL):

| Ação | Operação citada no manual | Uso no ERP |
|---|---|---|
| Lote assíncrono | `RecepcionarLoteRps` | `emitir`, depois consultar lote |
| Lote síncrono | `RecepcionarLoteRpsSincrono` | Apenas se Lucena disponibilizar em homologação |
| Emissão unitária | `GerarNfse` | Opcional, mediante contrato confirmado |
| Consultar lote | `ConsultarLoteRps` | Resolver protocolo/lote em processamento |
| Consultar RPS | `ConsultarNfseRps` | Evitar duplicidades e recuperar autorizado por RPS |
| Cancelar NFS-e | `CancelarNfse` | Só se webservice efetivamente implementar e CNPJ tiver permissão |
| Substituir NFS-e | `SubstituirNfse` | Não implantar sem teste/confirmacão; reservar para fase posterior |

**Exemplo mínimo didático de localização de tags** (não é payload completo, nem XML pronto para assinatura; ordem depende do elemento pai definido pelo XSD):

```xml
<OptanteSimplesNacional>1</OptanteSimplesNacional>
<IncentivoFiscal>2</IncentivoFiscal>
<regApTribSN>1</regApTribSN>
```

**Não hardcode o `1` de `regApTribSN` para todos os contribuintes.** Também não declare sucesso com HTTP 200: parsear o SOAP Body, identificar Fault, mensagens de retorno, número/protocolo, autorização efetiva e estados intermediários.

### 4.3. Certificado/criptografia

- `runtime = 'nodejs'` para XMLDSig/mTLS; avaliar adequação do ambiente Vercel/Node 24 e bibliotecas de assinatura e PKCS#12. Se requisito inviável no runtime atual, documentar alternativa de microserviço especializado, **sem implantar serviço inseguro**.
- Decriptar o PFX apenas em memória no servidor; proibir logs e respostas com base64, PEM privado, senha e corpo SOAP com segredos.
- Validar validade, CNPJ/cadeia/uso do certificado e vencimento. Mensagem de certificado vencido deve bloquear emissão antes de consumir RPS.
- Configurar acesso ao storage privado, expiração/rotação e política de eliminação das chaves; ter rastreabilidade de alterações cadastrais sem registrar segredos.

## 5. Configuração e experiência do cliente de Lucena

Em **Configurações → Fiscal/Pagamentos → NFS-e**, para empresa de Lucena:

- Mostrar **Rota atual: Tinus municipal / NFS-e Nacional / não habilitada**, com uma explicação curta do estado. Não expor selector manual que force emissão em integração inadequada ao município.
- Adicionar checklist operacional: **CNPJ, IM, certificado A1, validade, série de RPS, próximo número, regime SN e apuração `regApTribSN`, lista de serviço/tributação, endpoint homologado, CNPJ autorizado pela Tinus, habilitado em produção**.
- Manter padrão `MUNICIPAL_LUCENA_TINUS` isolado do padrão `NACIONAL`, de João Pessoa e de Cabedelo.
- Se uma operação de NFS-e não estiver pronta, mostrar **motivo exato** e bloquear botão de emissão; evitar botões que chamem `/v2/nfse` da Focus por engano.
- Na tela de revisão da OS, mostrar serviços selecionados, total, modelo, provedor, regime e apuração, indicadores de documentos; permitir consultar recibo/lote e status em notas pendentes.
- Tratar dados do tomador PF/PJ e emitir nota somente para serviços prestados; não afetar NF-e/NFC-e/SPED, financeiro ou outras configurações tributárias.
- Exibir se o PDF é **oficial da prefeitura** ou **DANFSe interno gerado pelo ERP**, e preservar acesso ao XML autorizado em conta com permissão.

## 6. Segurança de acesso e correções obrigatórias nas rotas

Como o sistema já contém chamadas `supabaseAdmin` em rotas de NFS-e, auditar **todas** as rotas `GET/POST/PUT` citadas para garantir:

- Sessão e permissão fiscal/empresa ativa; verificar que nota, OS, cliente, configuração e usuário pertencem ao mesmo tenant/empresa antes de operações externas.
- Eliminar em cancelamento o uso de `empresa.limit(1)`; usar **`nfse.empresaid`** e testar que empresa B nunca consulta/cancela documento da empresa A por adivinhar ID.
- Remover respostas de segredos da config. Se alterar contratos de frontend, testes que assegurem que GET não revela PFX/senha/token.
- Nunca buscar `url_xml`/PDF arbitrária sem allowlist, proteção de SSRF, tamanho máximo, timeout e verificação de tipo de arquivo; preferir storage privado para documentos municipais.
- Não enviar dados pessoais de CPF/CNPJ, endereço e e-mail para logs externos sem necessidade; redigir retornos SOAP (inclusive erros de assinatura), preservar auditoria mínima exigida.
- Em webhook/retorno assíncrono, validar autenticidade da origem, correlacionar exclusivamente por provedor/CNPJ/RPS/lote e prevenir replay.

## 7. Consulta, idempotência, cancelamento, reenvio, migração

**Fluxos obrigatórios:**

1. **Envio incerto/timeout:** preservar o mesmo número de RPS e lote, registrar `RESULTADO_DESCONHECIDO`/pendente, consultar `ConsultarLoteRps` ou `ConsultarNfseRps`; não emitir segundo RPS automaticamente.
2. **Consulta:** a escolha do transporte usa `nfse.provedor_emissao` gravado; nota antiga sem campo é Focus. Normalizar status e código/URL sem apagar informações oficiais já conhecidas.
3. **Reenvio de rejeitada:** verificar se foi *rejeição fiscal definitiva* ou apenas comunicação incerta; só permitir novo RPS quando a Tinus confirmar ausência de conversão e a regra municipal o exigir. Nunca copiar JSON da Focus para o SOAP Tinus. Se passou a ser NFS-e Nacional, iniciar **nova emissão controlada**, não reinterpretar nota histórica.
4. **Cancelamento:** o manual descreve serviço, mas a disponibilidade municipal deve ser testada. Enquanto não comprovada, exibir orientação manual e não marcar `CANCELADA` localmente. Se a prefeitura aceitar solicitação pendente, registrar `CANCELAMENTO_PENDENTE` até retorno final.
5. **Documentos:** baixar XML autorizado real, validar existência e conteúdo; obter PDF oficial quando portal disponibilizar; fallback de PDF local não substitui XML autorizado. Manter anexos por OS, inclusive OS agrupadas.
6. **Migração futura:** em 01/11/2026 ou quando comprovado o cronograma/cadastro da empresa, rota **de novas notas** pode passar ao Emissor Nacional (Focus) **por empresa, ambiente e vigência**; documentos Tinus anteriores continuam consultáveis no mesmo provedor com suas chaves originais.
7. **Monitor fiscal:** logar decisão com município, `empresa.id`, modelo, autorizador, regra e ambiente — **não** com senha/segredo — para explicar por que cada nota foi para determinada rota.

## 8. Plano de implementação em fases / critérios de aceite

### Fase A — Investigação e definição de contrato (obrigatória)

- [ ] `git status`, ler branch atual e anotar SHA; buscar uso de política, transport, sync, cadastros, notificações, RLS e migrations antes de alterar.
- [ ] Receber PDF, XSD e exemplo XML, registrar versão/hash; verificar cadeia de imports e validações.
- [ ] Obter e validar **WSDL Lucena de homologação e produção**, exemplos de **solicitação E resposta**, versão SOAP, exigência de certificado, limites, códigos de erro e operações ativas.
- [ ] Confirmar com Tinus a política de assinatura XMLDSig e algoritmos aceitos; testar assinatura com certificado de homologação.
- [ ] Confirmar liberação do CNPJ, série/numeração inicial, IM, `regApTribSN`, regime ISS, natureza/incidência e disponibilidade do canal municipal em outubro/novembro 2026.
- [ ] Se WSDL/credenciamento ausentes, **parar no estágio mock/homologação e documentar impedimentos**. Não mascarar como integração produtiva pronta.

### Fase B — Modelo e seleção de rota

- [ ] Migration incremental/aditiva, sem editar migrations aplicadas; `modelo_emissao` + `provedor_emissao` + campos RPS/protocolo + configuração por empresa.
- [ ] Política determinística Lucena, modelos possíveis, labels, formulário, mapeamento e compatibilidade histórica.
- [ ] Selector de transporte por provider histórico e config de credenciais por estabelecimento.
- [ ] Concorrência/idempotência na reserva RPS/lote; impedir duplicidade de OS/serviços antes de comunicação externa.

### Fase C — SOAP + XML + assinatura

- [ ] Gerador XML tipado, parser seguro, xsd validation, assinatura RPS e lote, client SOAP + timeouts e resposta normalizada.
- [ ] `regApTribSN` obrigatório e configurável para o Simples; demais campos tratados com regras da prefeitura.
- [ ] Homologação com **XML enviado, retorno SOAP, lote, RPS e número/protocolo de NFS-e** verificáveis; nada de gerar nota real neste estágio.

### Fase D — Ciclo de vida completo

- [ ] Integrar emitir/consultar/reemitir/cancelar/XML/PDF/anexar e listagem de OS; não quebrar integração antiga.
- [ ] Auditar RBAC/tenant e acesso aos documentos/segredos.
- [ ] Status pendente e retry seguro contra timeout, duplicidade e janela de processamento.

### Fase E — Testes e entrega

**Testes novos mínimos:**

1. Lucena CRT 1 com Tinus habilitada → `TINUS_MUNICIPAL`/`MUNICIPAL_LUCENA_TINUS`, XML RPS assinado; nenhuma chamada Focus.
2. Lucena CRT 1 sem WSDL/CNPJ liberado → bloqueio com mensagem, **zero chamadas externas**.
3. Lucena CRT 2 sem regime apuração explícito → bloqueio; com `2` ou `3` válido → XML conforme regra confirmada.
4. `regApTribSN` ausente/fora de ordem; `Competencia` datetime em vez de date; assinatura inválida → rejeitados na validação local.
5. Lote recebido sem nota final → `PROCESSANDO`; consulta posterior → `AUTORIZADA` com número real.
6. Timeout após POST → consulta primeiro, não consumir outro número e não duplicar documento.
7. Emissão simultânea de 2 OS → RPS diferentes e persistidos atomicamente.
8. Histórico Tinus consulta/cancela **pela Tinus** mesmo quando empresa passa a usar Focus nacional.
9. Notas históricas `MUNICIPAL` sem `provedor_emissao` → continuam na Focus `/v2/nfse`; `NACIONAL` → `/v2/nfsen` conforme lógica anterior.
10. João Pessoa CRT 3 14.01 e exceções 01.03/01.05/01.09/16.01, Cabedelo e MEI → resultados atuais **idênticos**.
11. Salvar padrão Tinus → não apaga `padroes_emissao.NACIONAL`, `MUNICIPAL_CABEDELO`, `MUNICIPAL_JOAO_PESSOA`.
12. Empresa A **não pode** consultar/cancelar nota/certificado/RPS da empresa B.
13. PDF autorizado anexado por OS, XML oficial recuperável, falhas de documento nunca provocam reemissão.
14. Cancelamento Tinus sem serviço confirmado → indisponível, não altera status; com confirmação → final real.
15. Migração de novas notas ao nacional (feature flag/habilitação confirmada) **não** reencaminha antigas.

**Comandos existentes encontrados em `package.json`:**

```bash
npm run test:negocio
npm run test:fiscal
npm run test:nfse:ui
npm run lint
npm run build
# Somar testes novos src/lib/services/fiscais/tinus/*.test.ts e testes dos routes.
```

O projeto usa Node **24.x** e `prebuild` executa `test:negocio`. Verificar compatibilidade das bibliotecas nativas de XML/mTLS com runtime Vercel antes de declarar pronto.

**Definition of Done:** migration validada em banco de desenvolvimento; testes de legado verdes; SOAP homologação comprovado; rota Lucena com configurações e documentação operacional; segredos protegidos; resultado incerto recuperável; nenhum dado de cliente produtivo tocado; checklist de implantação e rollback claros. **Produção Tinus só após anuência explícita do cliente e liberação documentada do fornecedor.**

## 9. Solicitação à Tinus / Receita de Lucena — informações pendentes

Antes de liberar a produção, o responsável deve obter por escrito:

1. WSDLs/URLs completos de **Lucena** em homologação e produção, operação SOAP e versão do leiaute aceito (`2.03` ou nova).
2. CNPJ e inscrição municipal habilitados para integração; procedimento de credenciamento em homologação/produção e certificado A1/transport mTLS.
3. Identificação da série e sequência inicial dos RPS/lotes, tipo RPS aceito, janela assíncrona, consulta por protocolo/RPS.
4. Valores municipais: item LC116, `CodigoTributacaoMunicipio`, CNAE, alíquota, retenção/exigibilidade do ISS e regime de apuração Simples `regApTribSN`.
5. Algoritmos/transformações XMLDSig e canonicalization aceitos hoje, assinatura por RPS/lote, necessidade de assinatura SOAP.
6. Download/validação de XML e PDF oficiais, URL pública de consulta e disponibilidade de cancelamento/substituição.
7. **Cronograma de Lucena para optantes do Simples Nacional** em novembro de 2026 e se emissão municipal ainda será aceita na transição.

**Contato citado pela documentação de suporte TINUS:** `integracaonfse@tinus.com.br` e `contato@tinus.com.br` (verificar canal atual e departamento responsável por Lucena). Procedimento usual descrito: emitir RPS em homologação, enviar CNPJ, número do lote e XMLs de comunicação e aguardar autorização de produção. Não mandar certificado privado, senha nem token por e-mail.

## 10. Instrução de entrega e relatório final do Codex

Ao terminar, responder com:

- **SHA/branch e arquivos efetivamente alterados**, incluindo migrations e novos testes.
- Matriz **antes → depois** das rotas para Lucena, João Pessoa, Cabedelo e demais municípios.
- Evidências de validação de XSD, assinatura, SOAP e teste de homologação **sem revelar dados reais sensíveis**.
- Evidências de idempotência RPS/lote, multi-tenant, rollback e testes executados; informar resultados e falhas.
- Relação **objetiva de pendências externas** (WSDL, habilitação CNPJ, assinatura, credenciamento, cronograma nacional), com classificação `BLOQUEANTE`/`NÃO BLOQUEANTE`.
- **Nunca afirmar “pronto para produção” sem ter homologação/credenciamento e aprovação do usuário.**
- Commit(s) na branch de feature e PR para revisão, sem merge/deploy de produção sem autorização expressa.

---

**Fonte primária desta missão:** Manual TINUS 203 (23/10/2025), XSDs e exemplo XML anexados. **Base de código verificada:** `figodevtech/erpoficina`, `main` em `e88d1e11626478eb862f9141483f7b12ff2bb6b1`. **Referências externas** são complementares; divergência deve ser documentada e escalada à Tinus antes de emissão real.
