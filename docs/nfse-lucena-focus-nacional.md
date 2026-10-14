# NFS-e de Lucena/PB pela Focus — Emissor Nacional

Prestador estabelecido em Lucena/PB (IBGE `2508604`), optante do Simples Nacional
(CRT 1 ou 2), emite NFS-e pela **Focus NFe no Emissor Público Nacional**
(`/v2/nfsen`). O emissor municipal de Lucena (Tinus) **não** é integrado ao ERP.

## Regra de roteamento

Decidida em `resolverPoliticaNFSe` (`src/lib/services/fiscais/nfse-politica.ts`),
pelo município e pelo regime **do prestador** (`empresa.codigomunicipio`,
`empresa.regimetributario`), nunca pelo tomador.

| Prestador / regime / competência | Resultado |
|---|---|
| Lucena, CRT 1/2, a partir de 01/11/2026 | `NACIONAL` · `DPS_NACIONAL` · `FOCUS_NACIONAL`, regra `LUCENA_SIMPLES_NACIONAL` |
| Lucena, CRT 1/2, até 31/10/2026 | mesma rota, regra `LUCENA_SIMPLES_AGUARDANDO_NACIONAL`, **bloqueada** |
| Lucena, CRT 4 (MEI) | regra MEI existente (`MEI_NACIONAL`), sem mudança |
| Lucena, CRT 3 | sem rota (fora do escopo), mesma recusa de município não configurado |
| João Pessoa, Cabedelo, demais municípios | inalterados |

A data é a Resolução CGSN nº 191/2026: ME/EPP do Simples usam o Emissor Nacional
a partir de 01/11/2026, independentemente da opção do município. A RTC (IBS/CBS)
do Simples continua exigida só a partir de 01/01/2027 (`rtcObrigatorio`).

### Bloqueio até 31/10/2026

Não há confirmação de que Lucena antecipou a habilitação do Simples no Emissor
Nacional. Sem essa confirmação, a política devolve a rota com `bloqueio`. O
transporte fica indisponível (`TransporteBloqueado`), e então:

- a revisão da OS mostra o motivo e desabilita o botão de emitir;
- `POST /api/nfse/de-os/[id]` responde 422 `TRANSPORTE_INDISPONIVEL` **antes**
  de gravar a nota ou chamar a Focus;
- a configuração já mostra o padrão `NACIONAL`, para ser preenchido antes da
  virada.

Não foi criada flag de antecipação. Se Lucena antecipar e a Focus confirmar a
habilitação do CNPJ, a liberação entra em `regraLucena`, por empresa e ambiente.

## O que foi reaproveitado

Nada novo de integração: `mapearOSParaFocusNacional`, `emitirNacional`,
`FocusNacionalTransport`, consulta `GET /v2/nfsen/{ref}`, cancelamento
`DELETE /v2/nfsen/{ref}`, o padrão `padroes_emissao.NACIONAL`, vínculos de OS,
snapshot de itens e histórico de tentativas. Nenhuma migration: o CHECK de
`nfse.modelo_emissao` já aceita `NACIONAL`.

Notas já emitidas seguem o transporte do `modelo_emissao` gravado nelas, nunca a
regra de hoje.

## Campos fiscais (padrão Nacional da empresa)

Em **Configurações › Fiscal/Pagamentos › NFS-e**, o contador da empresa preenche:

- Código de Tributação Nacional do ISS (cTribNac, 6 dígitos);
- Tributação do ISS e tipo de retenção;
- Código de Tributação Municipal (3 dígitos), **só** se Lucena exigir; não é o
  código do emissor municipal antigo;
- NBS, CST do PIS/COFINS e alíquota, quando aplicáveis. A alíquota em branco
  usa a parametrizada no Sistema Nacional;
- CRT 2: **regime de apuração do Simples** é obrigatório. Sem ele a emissão é
  recusada antes do envio. CRT 1 assume `1` (ISS no DAS), salvo outro cadastrado.

O payload leva `codigo_opcao_simples_nacional = 3`,
`codigo_municipio_emissora = 2508604` e a inscrição municipal do cadastro da empresa.

## Habilitação na Focus (manual, antes da primeira nota)

1. Painel da Focus › Minhas empresas › empresa de Lucena › **Documentos Fiscais**.
2. Habilitar **Ambiente da NFSe Nacional – Homologação** (e depois Produção). Pela
   API de empresas os campos são `habilita_nfsen_homologacao` e
   `habilita_nfsen_producao`. O ERP não altera esse cadastro sozinho.
3. Conferir que o certificado é do mesmo CNPJ do emitente.
4. Em 13/10/2026 a lista pública da Focus não mostra Lucena entre os municípios
   integrados. Confirmar com o suporte da Focus antes da primeira nota real.
5. Se a prefeitura ainda não cadastrou a inscrição municipal no Ambiente Nacional,
   a Focus orienta omitir o campo. Hoje o ERP envia a inscrição do cadastro. Se a
   recusa apontar a IM, essa é a correção a fazer.

Primeira emissão: em **homologação**, com autorização expressa. Produção só depois
de a homologação autorizar e com o primeiro documento real autorizado pelo cliente.

## Erros e estados

| Situação | Comportamento |
|---|---|
| Focus `202` | nota `PROCESSANDO`. Só vira `AUTORIZADA` pela consulta ou pelo webhook |
| Focus `4xx` / rejeição | nota `REJEITADA`, `erros` e `retorno_bruto` gravados como vieram; sem rota alternativa |
| E0039 (município não parametrizado no Nacional) | a mensagem explica que o Emissor Nacional ainda não aceitou o CNPJ de Lucena; o reenvio idêntico continua bloqueado |
| Envio sem resposta (rede caiu) | nota fica `PROCESSANDO` com `RESULTADO_INCERTO` e a **mesma referência**. A consulta decide: achou, segue o status da Focus; 404, volta a `REJEITADA` (`NAO_RECEBIDA`) e pode ser reenviada |

A Focus não documenta código de erro para "empresa não habilitada no Ambiente
Nacional". A mensagem dela chega inteira ao usuário e ao registro.

O tratamento de envio sem resposta vale para todas as NFS-e pela Focus (emissão
e reenvio), não só para Lucena.

## Também ajustado

- Cancelamento e reenvio usam a empresa e o token da **nota** (`nfse.empresaid`),
  e não a primeira empresa do banco.

## Testes

- `src/lib/services/fiscais/nfse-lucena.test.ts`: política (L1–L11, R5, modelos,
  padrão, rótulo).
- `src/services/fiscal/nfseLucena.test.ts`: rotas com banco e Focus falsos —
  bloqueio sem rede, `/v2/nfsen`, CRT 2 com e sem apuração, rejeição gravada,
  envio sem resposta (consulta acha / 404), cancelamento com o token da empresa
  da nota, nota municipal antiga em `/v2/nfse`.

## Pendências externas

| Item | Classificação |
|---|---|
| Habilitação do CNPJ no Ambiente Nacional da Focus (homologação e produção) | BLOQUEANTE para emitir |
| Confirmação da Focus de que atende Lucena no Nacional | BLOQUEANTE para produção |
| Padrão fiscal Nacional preenchido pelo contador | BLOQUEANTE para emitir |
| Antecipação de Lucena antes de 01/11/2026 | NÃO BLOQUEANTE (sem ela, emite a partir de 01/11) |
| Inscrição municipal registrada no Ambiente Nacional | a confirmar na primeira homologação |
