# Avisos fiscais por item na emissão de NF-e

Catálogo das issues fiscais **não estruturais** que aparecem por item na emissão
assistida (OS, venda, entrada, saída de estoque) e na NF-e avulsa. Revisado em
22/09/2026. Bloqueios estruturais (CST inválido, CFOP inexistente ou de direção
errada, campo obrigatório do grupo, DIFAL) ficam fora desta lista.

## Semântica

| Severidade | Cor | Ciência | Emissão |
|---|---|---|---|
| `BLOQUEIO` | vermelho | não se aplica | impede |
| `AVISO` + `requerCiencia` | amarelo | exigida | libera depois da ciência |
| `INFO` | azul (badge `FiscalInformationBadge`) | nunca | não impede |

- Uma única regra decide código, mensagem, severidade, ciência, fontes e
  fingerprint: os módulos em `src/lib/nfe` (`icms/cfopSemantica.ts`,
  `icms/politicaStRetida.ts`, `baseIbsCbs.ts`). A tela
  (`emissao-assistida-model.ts`) e o servidor (`prepararItemFiscal` em
  `nfeAvulsaService.ts`) chamam as mesmas funções; os componentes só exibem.
- Toda issue de aviso carrega `fontes` (título, versão, URL, vigência,
  jurisdição). A tela mostra em "Fundamento do aviso"
  (`components/fiscal/fontes-do-aviso-fiscal.tsx`).

## Ciência vinculada à situação e registrada pelo servidor

Duas coisas diferentes são provadas, por mecanismos diferentes:

1. **A ciência é da situação atual.** Cada regra que pede ciência monta um
   fingerprint com os dados que produziram o aviso e a versão da regra
   (`fingerprintFiscal`, `chaveCiencia` em `src/lib/nfe/issuesFiscais.ts`). Se
   um desses dados muda, a chave `code@fingerprint` muda e o aviso volta a pedir
   ciência.
2. **Alguém clicou em "estou ciente".** O fingerprint não prova isso: o
   algoritmo é determinístico e roda no navegador, então um cliente manipulado
   calcularia a chave. Por isso a prova é uma linha em `nfe_ciencia_aviso`,
   gravada pelo servidor quando recebe o clique.

Fluxo:

```text
tela marca "estou ciente" (estado local: avisosFiscaisConfirmados)
  ↓ ao gerar/salvar
POST /api/fiscal/nfe/ciencias  { alvo, payload, cienciaEscopo, pedidos }
  ↓ mesma permissão da rota de emissão do alvo
serviço de emissão em modo registro (opcoes.registrarCiencia)
  → recalcula os avisos com o mesmo motor
  → grava só pedidos que casam com aviso pendente: usuário, escopo, item,
    code, fingerprint, dados, mensagem e fontes do servidor, versão da regra
  → para antes de gravar qualquer coisa da NF-e
  ↓
POST/PATCH da emissão com o mesmo cienciaEscopo
  → libera só avisos com ciência em nfe_ciencia_aviso (escopo ou nfe_id)
  → liga as ciências da sessão à NF-e salva (nfe_id)
```

- `avisosFiscaisConfirmados` no payload é **estado da tela**. O servidor não o
  lê para liberar nada (`prepararItemFiscal` usa `contexto.ciencias`).
- `cienciaEscopo` é um UUID por sessão de emissão (abertura do diálogo, página
  da avulsa). Ciência de outra sessão não vale; ao reabrir uma nota salva, valem
  as ciências já ligadas ao `nfe_id` dela.
- O item é identificado pelo `sourceItemId` da origem (`os:`, `venda:`,
  `entrada:`, `saida:`) ou por `#<índice>` na avulsa.
- Pedido que não casa com um aviso pendente do item (fingerprint de outra
  situação, item inexistente, INFO, BLOQUEIO) é recusado e não grava nada.
- Se o motor para antes dos avisos (bloqueio, dado incompleto), o registro
  devolve os mesmos erros e não grava ciência.
- `nfe_ciencia_aviso` é trilha de auditoria: gatilho impede UPDATE (exceto ligar
  ou desligar `nfe_id`) e DELETE; `service_role` não tem DELETE nem TRUNCATE.
- O snapshot (`tributacao_snapshot.icmsDecisao.avisosConfirmados`) guarda
  `code`, `message`, `fingerprint`, `fontes` e `ciencia` (id da linha, usuário,
  data). `decisao_fiscal.icms[].avisosConfirmados` guarda `code@fingerprint`.
- Rascunhos gerados antes desta revisão têm `versao_regra_fiscal` antiga e são
  gerados de novo antes da autorização (`rascunhoPrecisaSerRegerado`); a ciência
  é pedida outra vez.
- Trocar CFOP, CST ou CSOSN continua limpando a lista na tela
  (`aplicarAlteracoesComCienciaFiscal`), só por clareza visual.

Consultar quem confirmou o quê numa nota:

```sql
SELECT c.item_numero, c.code, c.mensagem, c.dados, c.versao_regra,
       u.nome AS confirmado_por, c.confirmado_em
  FROM nfe_ciencia_aviso c
  JOIN usuario u ON u.id = c.usuario_id
 WHERE c.nfe_id = :nfe_id
 ORDER BY c.item_numero, c.confirmado_em;
```

## Catálogo

### `NFE_CFOP_ST_SUBSTITUTO_SEM_RETENCAO` — AVISO, com ciência

- **Gatilho:** o texto oficial do CFOP diz que o emitente vende "na condição de
  contribuinte substituto" (5401, 5403, 6401, 6403) ou, pela nota explicativa,
  "na condição de substituto tributário" (6404), e o CST/CSOSN não retém ICMS-ST
  nesta operação (ex.: CST 00, 60; CSOSN 102, 500; CST 90/CSOSN 900 com a ST
  desligada).
- **Fonte:** título oficial do CFOP, Tabela CFOP do Portal Nacional da NF-e, IT
  2023.002 v2.10 (04/09/2026), nacional. 6404: nota explicativa oficial na mesma
  tabela; SEFAZ-SP RC 3837/2014 e RC 21691/2020 (6404 com nova retenção, CST 10).
- **Fingerprint:** code, CFOP, regime (CRT), código CST/CSOSN, papel do CFOP,
  papel do ICMS (inclui ST ativada nos grupos opcionais), `VERSAO_REGRA_CFOP_ST`.
- **Não gera:** 6404 com CST 10/30/70, CSOSN 201/202/203 ou CST 90/CSOSN 900
  com ST ativada.
- **Por que não é bloqueio:** divergência entre texto e grupo não prova
  proibição nacional. Não foi localizada fonte oficial para 6404 + CST 60; a
  combinação segue com aviso, não com bloqueio.

### `NFE_CFOP_ST_SUBSTITUIDO_SEM_ST_ANTERIOR` — AVISO, com ciência

- **Gatilho:** CFOP "na condição de contribuinte substituído" (5405) com
  CST/CSOSN que não informa ICMS-ST cobrado anteriormente (tudo que não é CST 60
  ou CSOSN 500).
- **Fonte:** título oficial do CFOP 5.405, IT 2023.002 v2.10, nacional.
- **Fingerprint:** igual ao anterior.
- **Não gera:** 5405 + CST 60, 5405 + CSOSN 500.

### `NFE_CFOP_SEM_ST_COM_CST_DE_ST` — AVISO, com ciência (hoje inalcançável)

- A regra antiga inferia "sem ST" de todo CFOP x.1xx (`/^[1256]1\d\d$/`). Foi
  removida: nenhum CFOP da tabela oficial afirma operação sem ST, e a SEFAZ-SP
  documenta 6108 + CSOSN 500 (RC 33951/2026) e 6108 + CST 00 (RC 27923/2023).
- CFOP que não fala de ST é `NEUTRO` e não gera aviso de ST. Um CFOP só volta a
  ser `SEM_ST` por exceção explícita em `PAPEL_ST_CFOP_EXPLICITO`, com fonte e
  teste. Uma checagem futura de 6102 + CST 60 tem de ser contextual (NCM, CEST,
  UFs, protocolo, destinatário), nunca pelo número do CFOP.

### `NFE_ST_RETIDA_POLITICA_UF` — INFO ou BLOQUEIO

- **Gatilho:** CST 60 ou CSOSN 500 com `indFinal=0` e algum de `vBCSTRet`,
  `pST`, `vICMSSubstituto`, `vICMSSTRet` ausente.
- **Fonte:** MOC 7.0 / NT 2018.005, N12-81 e N12a-50, de aplicação facultativa
  pela UF.
- **Severidade:** `INFO` sem política estadual obrigatória vigente na data de
  emissão; `BLOQUEIO` só com política obrigatória cadastrada e vigente para a UF
  do emitente (e destino, se a política restringir).
- **Nunca** estima os valores: vêm do documento de aquisição.

### `NFE_ICMS_EFETIVO_POLITICA_UF` — INFO ou BLOQUEIO

- **Gatilho:** CST 60 ou CSOSN 500 com `indFinal=1` e algum de `pRedBCEfet`,
  `vBCEfet`, `pICMSEfet`, `vICMSEfet` ausente.
- **Fonte:** MOC 7.0 / NT 2018.005, N12-82 e N12a-60, facultativas pela UF.
- Mesma regra de severidade do anterior.

Manifestações estaduais cadastradas (`POLITICAS_ST_RETIDA` em
`icms/politicaStRetida.ts`):

| UF | Regra | Status | Publicada | Obrigatória | Fonte | Conferida pelo ERP |
|---|---|---|---|---|---|---|
| PB | ST_RETIDA (N12-81, N12a-50) | `VIGENTE` | 08/04/2019 | não | [SEFAZ-PB, comunicado sobre a NT 2018.005](https://www.sefaz.pb.gov.br/announcements/7581-validacao-do-icms-de-substituicao-tributaria-dos-documentos-eletronicos-nf-e-e-nfc-e-precisa-ser-realizada-ate-29-de-abril) ("tornou-se facultativo") | 22/09/2026 |
| PB | ICMS_EFETIVO (N12-82, N12a-60) | `HISTORICA` | 08/04/2019 | não | mesmo comunicado ("demais validações opcionais… não serão aplicadas, **inicialmente**") | 22/09/2026 |

- `VIGENTE` pode decidir a severidade; `HISTORICA` só é citada. Sem regra
  obrigatória vigente comprovada, o aviso é INFO de qualquer forma.
- A mensagem cita o **órgão e a data da manifestação** ("Existe comunicado da
  SEFAZ-PB de 08/04/2019…"; para a histórica, "…informou que essa validação não
  seria aplicada, inicialmente"), seguida de "Não há política estadual
  obrigatória mais recente cadastrada no ERP". A data da conferência
  (`revisadaEm`) é metadado interno e nunca aparece como data da política.
- Nova orientação de uma UF entra como outra linha, com `inicio` posterior: a
  mais recente vigente na data de emissão prevalece.

### `NFE_IBSCBS_BASE_MANUAL` — AVISO, com ciência

- **Gatilho:** base do IBS/CBS digitada à mão diferente (mais de R$ 0,009) da
  composição da UB16-10.
- **Fonte:** NT 2025.002-RTC v1.51, UB16-10 (nota: "Implementação Futura,
  aguardando orientação normativa"; rejeição 1104 quando ativada); LC 214/2025,
  art. 12.
- **Fingerprint:** code, base informada, base calculada, todos os componentes
  (vProd, vFrete, vDesc, vPIS, vCOFINS, vICMS, DIFAL, FCP…), modFrete, data
  fiscal, `VERSAO_BASE_IBS_CBS`.
- **Não gera:** base automática; base digitada igual à composição.
- Vira BLOQUEIO só quando a NT tirar a UB16-10 de "implementação futura".
- Na NF-e avulsa, a caixa de ciência fica na lista "avisos fiscais a confirmar",
  com o fingerprint devolvido pelo servidor; o registro acontece ao salvar.
- Sem `dataEmissao` no contexto, a data fiscal é o dia civil do emitente
  (`dataCivilDeHoje`), não o dia em UTC.

### `NFE_IBSCBS_BASE_INVALIDA` — BLOQUEIO

Frete com modFrete 9, modalidade inválida ou base negativa. Estrutural, fora do
escopo de ciência.

## Fontes e versões vigentes

| Fonte | Versão | Publicação | Onde |
|---|---|---|---|
| Tabela CFOP (IT 2023.002) | v2.10 | 04/09/2026 | `cfopCatalog.generated.ts`; arquivo oficial em `docs/fiscal/fontes/cfop/` |
| NT 2025.002-RTC | v1.51 | 04/08/2026 | `NFE_FISCAL_RULE_VERSION`, `baseIbsCbs.ts` |
| Schemas PL_010f | NT 2025.002 v1.50 | 31/08/2026 | `icms/__xsdOficial.ts` (sem pacote novo para a v1.51) |

### Regenerar o catálogo CFOP

A planilha oficial usada está versionada em `docs/fiscal/fontes/cfop/`, com
`SHA256.txt` e `origem.md` (link exato, data do download, nome original). Não
baixe de novo pelo link genérico do Portal para regenerar: ele pode trazer outra
versão. Para uma tabela nova, adicione o arquivo ao lado, com hash e origem.

```sh
sha256sum -c docs/fiscal/fontes/cfop/SHA256.txt
node scripts/nfe/generate-cfop-catalog.mjs \
  --xlsx docs/fiscal/fontes/cfop/IT_2023_002_v2_10_Tabela_CFOP_Descricao.xlsx \
  --versao IT-2023.002-v2.10 --publicacao 2026-09-04
```

`cfopOperation.test.ts` confere o hash e refaz a geração, comparando com o
catálogo versionado.

A partir da v2.10 o título do CFOP vem da própria tabela oficial (coluna "Título
do CFOP"). O gerador para se os textos de ST de 5401/5403/6401/6403/5405 ou a
nota explicativa do 6404 mudarem — nesse caso revise `cfopSemantica.ts` antes.

Resultado da troca v1.00 → v2.10: 619 registros nas duas; nenhum código incluído
ou removido; nenhuma vigência ou indicador alterado; novo indicador
`indExcIBSCBS` (desde a v2.00); seis títulos corrigidos (1255, 1905, 5605, 5659,
6112, 6659), todos de redação.

### NT 2025.002 v1.50 → v1.51

A v1.51 muda o cronograma da UB12-10 (Imposto Seletivo) e altera regras que o ERP
não implementa (ZFM I08-140/I08-144, monofásico, devolução VC02). O texto da
UB16-10 é idêntico e continua "implementação futura". Nenhuma regra do ERP
mudou; a troca de versão força a regeração dos rascunhos antigos.
