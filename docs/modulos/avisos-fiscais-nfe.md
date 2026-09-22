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

## Ciência vinculada à situação

A ciência é gravada como `code@fingerprint` (`chaveCiencia` em
`src/lib/nfe/issuesFiscais.ts`). O fingerprint é um hash estável dos dados que
produziram o aviso mais a versão da regra. Se um desses dados muda, a chave muda
e o aviso volta a pedir ciência — sem depender de a tela limpar a lista.

- O servidor recalcula o fingerprint a partir do payload e só aceita a chave que
  ele mesmo calcularia. Chave de outra situação, ou só o código (formato antigo),
  não libera nada.
- `INFO` e `BLOQUEIO` nunca geram chave (`confirmarAvisosFiscais` e
  `montarDecisaoIcms` filtram).
- O snapshot (`tributacao_snapshot.icmsDecisao.avisosConfirmados`) guarda
  `code`, `message`, `fingerprint` e `fontes`; `decisao_fiscal.icms[].avisosConfirmados`
  guarda `code@fingerprint`.
- Rascunhos gerados antes desta revisão têm `versao_regra_fiscal` antiga e são
  gerados de novo antes da autorização (`rascunhoPrecisaSerRegerado`); a ciência
  antiga, sem fingerprint, é pedida outra vez.
- Trocar CFOP, CST ou CSOSN continua limpando a lista na tela
  (`aplicarAlteracoesComCienciaFiscal`), só por clareza visual.

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

Políticas cadastradas (`POLITICAS_ST_RETIDA` em `icms/politicaStRetida.ts`):

| UF | Regra | Desde | Obrigatória | Fonte | Revisada em |
|---|---|---|---|---|---|
| PB | ST_RETIDA (N12-81, N12a-50) | 08/04/2019 | não | [SEFAZ-PB, comunicado sobre a NT 2018.005](https://www.sefaz.pb.gov.br/announcements/7581-validacao-do-icms-de-substituicao-tributaria-dos-documentos-eletronicos-nf-e-e-nfc-e-precisa-ser-realizada-ate-29-de-abril) | 22/09/2026 |
| PB | ICMS_EFETIVO (N12-82, N12a-60) | 08/04/2019 | não | mesmo comunicado ("demais validações opcionais… não serão aplicadas, inicialmente") | 22/09/2026 |

Nova orientação de uma UF entra como outra linha, com `inicio` posterior: a mais
recente vigente na data de emissão prevalece. A de PB não é eterna — revise-a
quando houver comunicado novo.

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
- Na NF-e avulsa, a ciência é dada na lista "avisos fiscais a confirmar", com o
  fingerprint devolvido pelo servidor.

### `NFE_IBSCBS_BASE_INVALIDA` — BLOQUEIO

Frete com modFrete 9, modalidade inválida ou base negativa. Estrutural, fora do
escopo de ciência.

## Fontes e versões vigentes

| Fonte | Versão | Publicação | Onde |
|---|---|---|---|
| Tabela CFOP (IT 2023.002) | v2.10 | 04/09/2026 | `cfopCatalog.generated.ts` |
| NT 2025.002-RTC | v1.51 | 04/08/2026 | `NFE_FISCAL_RULE_VERSION`, `baseIbsCbs.ts` |
| Schemas PL_010f | NT 2025.002 v1.50 | 31/08/2026 | `icms/__xsdOficial.ts` (sem pacote novo para a v1.51) |

### Regenerar o catálogo CFOP

Baixe a "Tabela de CFOP" vigente no
[Portal Nacional da NF-e](https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D)
e rode:

```sh
node scripts/nfe/generate-cfop-catalog.mjs \
  --xlsx "IT_2023_002_v2_10_Tabela_CFOP_Descrição.xlsx" \
  --versao IT-2023.002-v2.10 --publicacao 2026-09-04
```

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
