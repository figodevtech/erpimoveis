# NFS-e de Lucena/PB pela Focus — Ambiente Nacional

Prestador estabelecido em Lucena/PB (IBGE `2508604`), optante do Simples Nacional
(CRT 1 ou 2), emite NFS-e pela **Focus NFe no Ambiente Nacional**
(`POST /v2/nfsen?ref=...`). O emissor municipal de Lucena (Tinus) **não** é
integrado ao ERP, e não há troca automática de provedor.

> Estado: **liberado para tentativas.** Nada está homologado nem autorizado em
> produção: até haver uma nota real autorizada, a habilitação do CNPJ no
> Ambiente Nacional continua sem confirmação.

## Regra de roteamento

Decidida em `resolverPoliticaNFSe` (`src/lib/services/fiscais/nfse-politica.ts`)
pelo município e pelo regime **do prestador** (`empresa.codigomunicipio`,
`empresa.regimetributario`), nunca pelo tomador.

| Prestador / regime | Resultado |
|---|---|
| Lucena, CRT 1/2, qualquer data | `NACIONAL` · `DPS_NACIONAL` · `FOCUS_NACIONAL`, regra `LUCENA_SIMPLES_NACIONAL` |
| Lucena, CRT 4 (MEI) | regra MEI existente (`MEI_NACIONAL`) |
| Lucena, CRT 3 | sem rota (fora do escopo) |
| João Pessoa, Cabedelo, demais municípios | inalterados |

**01/11/2026** é a data em que o Emissor Nacional se torna obrigatório para ME/EPP
do Simples (Resolução CGSN nº 191/2026). Ela **não** é condição técnica: antes
dessa data a tentativa também é enviada. Nesse período a revisão mostra um aviso
informativo ("a emissão antecipada depende da habilitação do prestador no
Ambiente Nacional...") que **não** trava o botão. Uma tentativa antecipada pode
ser recusada pelo autorizador. Quem decide é a Focus/Sefin, e a recusa chega
inteira ao usuário.

A RTC (IBS/CBS) do Simples continua exigida só a partir de 01/01/2027
(`rtcObrigatorio`).

## Configuração

### Padrão fiscal (contador da empresa)

Em **Configurações › Fiscal/Pagamentos › NFS-e**, padrão **Nacional**:

- Código de Tributação Nacional do ISS (cTribNac, 6 dígitos);
- Tributação do ISS e tipo de retenção;
- Código de Tributação Municipal (3 dígitos), **só** se Lucena exigir. Não é o
  código do emissor municipal antigo;
- NBS, CST do PIS/COFINS e alíquota, quando aplicáveis. A alíquota em branco usa
  a parametrizada no Sistema Nacional;
- **CRT 2: regime de apuração do Simples obrigatório.** Sem ele a emissão é
  recusada antes do envio. CRT 1 assume `1` (ISS no DAS), salvo outro valor
  cadastrado.

### Ambiente (homologação primeiro)

O ambiente vem de `empresa.ambiente` (`HOMOLOGACAO` ou `PRODUCAO`) e aparece no
cabeçalho da emissão. Cada ambiente usa a URL e o token próprios:

| Ambiente | URL | Token |
|---|---|---|
| Homologação | `https://homologacao.focusnfe.com.br` | `FOCUS_NFE_API_TOKEN_HOMOLOGACAO` ou o token da configuração |
| Produção | `https://api.focusnfe.com.br` | `FOCUS_NFE_API_TOKEN` ou o token da configuração |

### Habilitação na Focus (manual)

1. Painel da Focus › Minhas empresas › empresa de Lucena › **Documentos Fiscais**.
2. Habilitar **Ambiente da NFSe Nacional – Homologação** e, depois,
   **Produção**. Pela API de empresas, os campos são `habilita_nfsen_homologacao`
   e `habilita_nfsen_producao`. O ERP não altera esse cadastro sozinho.
3. Conferir que o certificado é do mesmo CNPJ do emitente.
4. Em 13/10/2026 a lista pública da Focus não mostrava Lucena entre os municípios
   integrados. Confirmar com o suporte da Focus.
5. Se a prefeitura não cadastrou a inscrição municipal no Ambiente Nacional, a
   Focus orienta omitir o campo. Hoje o ERP envia a IM do cadastro. Se a recusa
   apontar a IM, essa é a correção.

**Como confirmar a habilitação:** emitir uma nota em homologação com autorização
expressa e ler o desfecho. Um 202 significa só "recebida para processamento". A
habilitação está confirmada quando a consulta devolver a nota **autorizada**.

## Interpretar uma recusa

Quando a Focus recusa (HTTP 4xx), a nota fica `REJEITADA` e a tela mostra o
retorno como veio:

```text
Não foi possível autorizar a NFS-e.
Provedor: Focus NFe
Município: Lucena/PB
Ambiente: Homologação
HTTP: 422
Referência: OS_700_SRVS_1_...

Código: E0039
Mensagem: <texto original da Focus>

Observação: <complemento do município, só para E0039/L999>
```

- Cada erro sai com código, mensagem e correção; vários erros saem numerados.
- 401 em text/html: aparece o corpo cru ("HTTP Basic: Access denied") e a
  orientação de conferir o token **do ambiente**. Isso não é rejeição fiscal.
- O complemento do E0039 é específico de Lucena e entra **depois** do retorno,
  sem substituí-lo. O de João Pessoa segue o dela.
- `nfse.erros` e `nfse.retorno_bruto` guardam a resposta completa, e
  `nfse.tentativas` guarda cada chamada. Nenhum token é gravado: ele vai no
  cabeçalho, nunca no corpo ou na URL.
- Não existe fallback: uma recusa em `/v2/nfsen` nunca vira tentativa em
  `/v2/nfse` ou em outro provedor.

Para investigar: ler `retorno_bruto.http_status` e `erros` da nota e repetir a
emissão só depois de corrigir o que a mensagem aponta. Reenviar sem alterar após
um E0039 continua bloqueado, porque repetiria a recusa.

## Evitar duplicidade após falha de comunicação

A Focus documenta que um `POST /v2/nfsen` com referência já usada volta 422 com
**"Já existe um DPS com esta referência."** A referência é única por token, e é
nisso que a recuperação se apoia.

| Situação | Estado da nota |
|---|---|
| Rede caiu, timeout ou HTTP 5xx no envio | `PROCESSANDO` + `RESULTADO_INCERTO`, **mesma referência** |
| Consulta devolve 404 | continua incerta. Um 404 isolado não prova que o envio não chegou |
| Consulta acha a referência | segue o status da Focus e a marca sai |
| "Reenviar com a mesma referência" → 202 | o envio não tinha chegado: agora processa |
| "Reenviar com a mesma referência" → "Já existe um DPS com esta referência" | já tinha chegado: segue `PROCESSANDO`, e a consulta traz o desfecho |
| "Reenviar com a mesma referência" → 5xx / sem rede | continua incerta |
| "Reenviar com a mesma referência" → outro 4xx | `REJEITADA`. O mesmo payload teria sido recusado na primeira vez |

- O ERP nunca cria referência nova para uma nota incerta. O botão
  "Reenviar com a mesma referência" só aparece nela.
- A nota incerta segue contando como ativa: seus serviços não entram em outra
  emissão enquanto ela não se resolver. Duas emissões simultâneas da mesma
  seleção já são barradas pelo índice único de `nfse_os_servico_vinculo`, gravado
  antes do envio.
- No municipal (`/v2/nfse`) a recusa de referência repetida não é documentada.
  Lá, uma recusa 4xx do reenvio com a mesma referência mantém a nota incerta, e
  a conciliação é manual: consultar a referência no painel da Focus.

## Empresa e token

Consulta, cancelamento e reenvio usam a empresa gravada na nota
(`nfse.empresaid`), com o token e o ambiente dela. Uma nota antiga sem
`empresaid` só usa a empresa do banco quando existe exatamente uma; com mais de
uma, a operação é recusada em vez de adivinhar o token.

## Testes

- `src/lib/services/fiscais/nfse-lucena.test.ts` — política: Lucena antes e
  depois de novembro, CRT 2/3/4, João Pessoa, Cabedelo, RTC 2027, E0039 por
  município.
- `src/lib/services/fiscais/nfse-recusa.test.ts` — desfecho por HTTP, referência
  repetida e texto da recusa.
- `src/services/fiscal/nfseLucena.test.ts` — rotas com banco e Focus falsos:
  emissão em 13/10 e em 02/11, homologação × produção, HTTP 400/401/403/404/422/500,
  várias rejeições, falha de rede, 404 após incerto, reenvio com a mesma
  referência (já recebido, não recebido, cai de novo), token por empresa e
  empresa ambígua.

## Pendências externas

| Item | Classificação |
|---|---|
| Habilitação do CNPJ no Ambiente Nacional da Focus (homologação e produção) | BLOQUEANTE para autorizar |
| Confirmação da Focus de que atende Lucena no Nacional | BLOQUEANTE para produção |
| Padrão fiscal Nacional preenchido pelo contador | BLOQUEANTE para emitir |
| Inscrição municipal registrada no Ambiente Nacional | a confirmar na primeira homologação |
| Confirmação antes de emitir em produção | não existe hoje na tela da NFS-e |
