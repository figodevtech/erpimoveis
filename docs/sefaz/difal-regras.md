# DIFAL — motor de regras fiscais versionadas

Como o ERP decide a alíquota interna da UF de destino, o FCP e o restante do
grupo `ICMSUFDest` da NF-e 4.00, e por que ele às vezes se recusa a decidir.

## O problema que este motor resolve

Até setembro de 2026 a alíquota interna vinha de um objeto TypeScript
(`ALIQUOTA_INTERNA_POR_UF`) que não conhece NCM, benefício fiscal nem vigência,
e o FCP tinha de ser digitado item a item — inclusive o zero. Na prática:

- o operador via o campo **Alíquota FCP** com um placeholder `0` em cinza,
  achava que estava preenchido, e a emissão travava sem explicar o quê;
- a tabela genérica preenchia a alíquota interna, o item passava a ter
  "alíquota informada", o bloqueio sumia e a nota saía com um número que não
  considerava a mercadoria.

Agora a fonte fiscal é a tabela `fiscal_difal_regra`, versionada por vigência,
com fonte e fundamento legal em cada linha. O que a fonte não determina continua
bloqueando — e diz exatamente o que falta.

## Arquitetura

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Dado curado | [`data/fiscal/difal/aliquotas-uf.json`](../../data/fiscal/difal/aliquotas-uf.json) | O que foi lido da fonte oficial, com a nota de curadoria de cada linha |
| Banco | [`supabase/migrations/20260922160000_fiscal_difal_regra.sql`](../../supabase/migrations/20260922160000_fiscal_difal_regra.sql) | Tabela, constraints, RLS, permissões e carga inicial |
| Casamento | [`src/lib/nfe/difalRegras.ts`](../../src/lib/nfe/difalRegras.ts) | Núcleo puro: qual regra vence, campo a campo, e quando há conflito |
| Incidência e snapshot | [`src/lib/nfe/difal.ts`](../../src/lib/nfe/difal.ts) | `deveGerarICMSUFDest`, `resolverDifalDoItem`, `issuesDifalDoItem` |
| Repositório | [`src/services/fiscal/difal/repositorioDifal.ts`](../../src/services/fiscal/difal/repositorioDifal.ts) | Lê as regras da UF (cache de 60s) |
| Resolver | [`src/services/fiscal/difal/resolverRegraDifal.ts`](../../src/services/fiscal/difal/resolverRegraDifal.ts) | Entrada única: incidência + regras + interestadual |
| API | [`src/app/api/fiscal/difal/resolver/route.ts`](../../src/app/api/fiscal/difal/resolver/route.ts) | `POST` para a tela preencher antes de montar o item |
| Sincronização | [`scripts/fiscal/sincronizar-difal.ts`](../../scripts/fiscal/sincronizar-difal.ts) | Diff entre o arquivo curado e o banco; grava só com `--aplicar` |
| Catálogo NCM | [`supabase/migrations/20260922170000_fiscal_ncm_catalogo.sql`](../../supabase/migrations/20260922170000_fiscal_ncm_catalogo.sql) + [`scripts/fiscal/importar-ncm.ts`](../../scripts/fiscal/importar-ncm.ts) | Confere se o NCM do item existe de verdade |

A UF do emitente e o CRT **nunca** vêm do navegador: a rota os lê do banco. São
eles que decidem incidência e alíquota interestadual.

## Fontes oficiais

Em ordem de precedência, e as que foram efetivamente usadas:

1. **Portal Nacional da NF-e** — [NT 2025.002-RTC v1.33 (dez/2025)](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=AklZnck3o6I%3D),
   regra NA01-20 e suas 12 exceções (rejeição 694); [NT 2015.003](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=7zB0EFSFqa0%3D),
   regras NA01-10 (rejeição 807), NA01-30 (695), NA09 (697/698), NA11 (699) e NA13 (793).
2. **Portal Nacional do DIFAL (SVRS/ENCAT)** — [tabela de alíquotas](https://dfe-portal.svrs.rs.gov.br/Difal/aliquotas)
   e [base legal](https://dfe-portal.svrs.rs.gov.br/Difal/BaseLegal).
3. **Legislação federal** — [Resolução do Senado nº 13/2012](https://legis.senado.leg.br/norma/586999) (alíquota de 4%),
   [LC 190/2022](https://planalto.gov.br/ccivil_03/leis/lcp/lcp190.htm), EC 87/2015.
4. **Legislação estadual** citada pelo portal, por UF.

Blog, portal contábil e tabela comercial não são fonte. Se o valor não está numa
das quatro, ele não entra como regra ativa.

## Prioridade entre regras

Da mais específica para a menos:

```
EXCECAO (70)  >  BENEFICIO (60)  >  NCM_CEST (50)  >  CEST (40)
              >  NCM (30)        >  NCM_PREFIXO (20, prefixo mais longo vence)
              >  GERAL (10)
```

Dois detalhes que mudam o resultado na prática:

**A resolução é por campo.** Uma regra de NCM que só preenche `aliquota_fcp`
resolve o FCP e deixa a alíquota interna com a regra geral da UF. Cada campo
guarda a sua própria origem — é o que a tela mostra e o que a auditoria lê.

**Empate com valores diferentes é conflito, não sorteio.** Se duas regras
empatam em tipo, comprimento de prefixo e `prioridade` e discordam do valor, o
motor não escolhe: devolve `NFE_DIFAL_REGRA_CONFLITANTE` e a emissão para. Para
desempatar de propósito, use a coluna `prioridade` (maior vence).

## Vigência

`vigencia_inicio` e `vigencia_fim` são **inclusivos** e a regra é escolhida pela
**data do documento**, não pela mais recente:

| Emissão | Regra escolhida no PI |
| --- | --- |
| 31/03/2025 | 21% (08/03/2023 a 31/03/2025) |
| 01/04/2025 | 22,5% (a partir de 01/04/2025) |

Alteração de alíquota **nunca** sobrescreve a linha antiga: fecha a vigência
dela e insere outra. É isso que permite reemitir e auditar uma nota de 2024 com
a regra de 2024.

## `null` não é `0`

A regra mais importante do motor, e a que mais custa se for quebrada:

| Valor em `aliquota_fcp` | Significado | Efeito na emissão |
| --- | --- | --- |
| `NULL` | A fonte não determina o FCP desta regra | **Bloqueia**: `NFE_DIFAL_FCP_NAO_DETERMINADO` |
| `0` | A fonte determina que não há FCP | Preenche `0` e libera |
| `2` | A fonte determina FCP de 2% | Preenche `2` e libera |

Isso vale para `aliquota_icms_interna` e `reducao_base` também.

Ao mexer no caminho do dado, cuidado com dois padrões:

- `valor || null` — seguro para **string** (`"0"` é truthy), perigoso para
  **número** (`0 || null` vira `null`). As telas trabalham com texto, por isso o
  padrão atual está correto; se alguém converter para número antes, quebra.
- `Number(valor)` sobre `null` devolve `0`. O repositório usa `decimalOuNulo`
  justamente para `numeric` NULL do Postgres não virar zero.

O teste `19.` em [`difalRegras.test.ts`](../../src/lib/nfe/difalRegras.test.ts)
trava esse encadeamento.

## Incidência do grupo (NA01-20)

`deveGerarICMSUFDest` exige: saída (`tpNF=1`), interestadual (`idDest=2`),
consumidor final (`indFinal=1`), não contribuinte (`indIEDest=9`), item fora do
ISSQN. E dispensa, pelas exceções da NT 2025.002-RTC v1.33:

| Exceção | Situação |
| --- | --- |
| 5 | NF-e de entrada (`tpNF=0`) |
| 7 | UF do local de entrega igual à do emitente |
| 9 | CFOP 6.552, 6.922 e 6.929 |
| 10 | Isentas/imunes/não tributadas: CST 40 e 41, CSOSN 103, 300 e 400 |
| 11 | `finNFe` 2 (complementar), 3 (ajuste), 5 (crédito) e 6 (débito) |
| 12 | Emitente do Simples Nacional ou MEI (**CRT 1 ou 4**) |

Mais a NA01-10: **NFC-e (modelo 65) não leva o grupo** — rejeição 807.

As exceções 4 e 8 (CFOP de retorno e de remessa, indicadores `indRetor`/
`indRemes`) entram por `FINAIS_CFOP_SEM_DIFAL`, que lista os finais correntes em
vez de carregar a tabela CFOP inteira.

> CST 60 **não** dispensa o DIFAL por si só. A exceção 10 cobre isenção, imunidade
> e não tributação, não substituição tributária.

## Cadastrar uma regra nova

Pelo arquivo curado (caminho recomendado, porque fica versionado no git):

1. acrescente a entrada em `data/fiscal/difal/aliquotas-uf.json`, com
   `fundamentoLegal`, `dataFonte` e `notaCuradoria` dizendo de onde veio;
2. `npm run fiscal:difal -- demir` mostra o diff, sem gravar nada;
3. `npm run fiscal:difal -- demir --aplicar` grava.

O script nunca apaga: linha que existe no banco e não no arquivo é preservada
(pode ter sido cadastrada direto pelo contador).

Para fechar uma vigência e abrir outra, edite a linha antiga com `vigenciaFim` e
acrescente a nova — não altere a alíquota da linha antiga.

## Investigar um bloqueio

Cada pendência tem código próprio. O que cada um quer dizer:

| Código | Causa | O que fazer |
| --- | --- | --- |
| `NFE_DIFAL_FCP_NAO_DETERMINADO` | Nenhuma regra vigente determina o FCP | Cadastrar a regra com `aliquota_fcp` (inclusive `0`), ou informar no item |
| `NFE_DIFAL_ALIQUOTA_INTERNA_NAO_DETERMINADA` | Nem regra nem tabela de referência têm a UF | Cadastrar a regra geral da UF |
| `NFE_DIFAL_ALIQUOTA_INTERNA_SEM_REGRA` | Valor veio da tabela genérica `ALIQUOTA_INTERNA_POR_UF` | Cadastrar a regra da UF; o fallback não autoriza emissão |
| `NFE_DIFAL_REGRA_CONFLITANTE` | Duas regras de mesma especificidade discordam | Ajustar vigência ou `prioridade` de uma delas |
| `NFE_DIFAL_NCM_INVALIDO` | NCM do item não tem 8 dígitos | Corrigir o cadastro do produto |
| `NFE_DIFAL_NCM_INEXISTENTE` | NCM tem 8 dígitos mas não existe na NCM oficial | Corrigir o cadastro do produto |
| `NFE_DIFAL_CONTEXTO_INCOMPLETO` | Falta UF de destino ou data de emissão | Completar o destinatário |

Para ver o que o motor enxergou, chame a rota direto:

```bash
curl -X POST http://localhost:3000/api/fiscal/difal/resolver \
  -H 'Content-Type: application/json' \
  -d '{"ufDestino":"PI","dataEmissao":"2026-09-22","modelo":55,
       "itens":[{"id":"1","ncm":"87089990","origemMercadoria":"0","cfop":"6108","cst":"00"}]}'
```

## Precedência dos valores

Para cada campo, nesta ordem:

1. **Override manual explícito** (`overrideDifalManual`) — proveniência `MANUAL`;
2. **Regra fiscal versionada** — proveniência `REGRA_*`, com regraId, vigência,
   fonte e fundamento;
3. **Valor que veio no item sem marca de manual** — proveniência `ITEM`;
4. **Tabela de referência** `ALIQUOTA_INTERNA_POR_UF` — `TABELA_REFERENCIA`, bloqueia;
5. nada — bloqueia.

A regra vem **antes** do valor do item de propósito. A tela resolve o DIFAL no
carregamento e devolve os mesmos números no payload; se o valor do item
vencesse, o servidor gravaria "22,5 veio do ITEM" para um número que veio da
regra do PI, e o snapshot perderia justamente o que responde "por que esta nota
usou 22,5%?". Pior: o navegador passaria a ditar alíquota sem deixar rastro.

Por isso toda tela que deixa digitar num campo de DIFAL marca o campo em
`difalCamposManuais` — vale para a emissão assistida e para a NF-e avulsa.

## Override manual

Quem edita um campo do DIFAL na tela marca aquele campo em
`difalCamposManuais`. O efeito:

- o valor digitado vence a regra automática;
- a proveniência gravada na nota vira `MANUAL`;
- o selo da seção deixa de dizer "Determinado automaticamente" e passa a
  "Ajustado manualmente";
- o valor escolhido entra no snapshot e vai para o XML.

Valor que veio do cadastro fiscal do próprio produto (sem edição na tela) tem
proveniência `ITEM` e também vence a regra: quem cadastrou aquele produto está
descrevendo aquela mercadoria.

## Base do FCP e os valores na tela

O campo **Base do FCP** continua em branco de propósito: vazio significa "mesma
base do DIFAL", e preenchê-lo com um número o congelaria — mudar o desconto do
item depois deixaria a base do FCP defasada.

Para a pessoa não ficar sem os números, a seção mostra um resumo calculado
(base do DIFAL, valor do DIFAL, base do FCP, valor do FCP, partilha e diferença
de alíquota), em reais, ao lado dos campos editáveis.

A base do resumo é a mesma do motor: `composicaoBase.baseIcmsProprio`, vinda de
`calcularIcmsDoItem`. Ela já aplica a regra do frete — modFrete 0 e 3 integram
por lei, nos demais vale a escolha do usuário. Repetir a fórmula na interface
faria o número exibido divergir do imposto assim que a nota tivesse frete.

## Reprodutibilidade histórica

`resolverDifalDoItem` grava em `difalDecisao` o valor de cada campo, a regra que
respondeu (id, descrição, vigência, fonte, fundamento), o contexto fiscal do
momento e as pendências. **Mudar uma regra em `fiscal_difal_regra` não altera
nenhuma NF-e já decidida** — o builder serializa o snapshot e nunca reconsulta
as regras.

A tela refaz a resolução sozinha quando muda algo que altera a decisão: UF de
destino, `indFinal`, `indIEDest`, CRT, modelo e, por item, NCM, CEST, CFOP,
CST/CSOSN e origem da mercadoria. É o `assinaturaDifalDe` que detecta a
mudança; `aplicarResolucaoDifal` aplica a resposta preservando os campos
marcados como manuais. Item que exige DIFAL e fica sem resposta tem os campos
automáticos **limpos**, não mantidos — guardar os 22,5% do PI numa nota que
passou a ir para o RJ é pior que o campo vazio, porque o vazio bloqueia.

O que dispara nova resolução é mudança de contexto (UF de destino, NCM, CEST,
CRT, modelo, finalidade). `validarDifalCanonicoDoItem` compara o contexto
gravado com o atual e recusa emitir com um snapshot decidido noutro contexto
(`NFE_DIFAL_CANONICO_DESATUALIZADO`).

Snapshots gravados antes deste motor não têm `crt` nem `modelo`; a comparação
trata a ausência como "não sei", não como divergência, para não invalidar
rascunho correto.

## Catálogo de NCM

`normalizarNcm` confere o formato; a existência do código é conferida contra
`public.fiscal_ncm`, carregada do Portal Único Siscomex.

Sem isso, um código de oito dígitos que não existe na NCM passaria batido — é o
caso do "MÓDULO VOLVO 6792" da venda #180, cadastrado com `22346792`, em que os
quatro últimos dígitos são o número da peça. Com regra geral da UF o resultado
não muda; no dia em que houver regra por NCM, o código inexistente não casa com
nenhuma, cai na geral e tributa errado sem avisar.

A conferência acontece **nas duas pontas**, e a de baixo não confia na de cima:

```
fiscal_ncm
   ↓
/api/fiscal/difal/resolver  → NCM_INEXISTENTE → bloqueio na tela
   ↓
salvarNFeAvulsaDraft consulta fiscal_ncm de novo
   ↓                   (conferirNcmsConhecidos, uma consulta por nota)
prepararItemFiscal → resolverDifalDoItem({ ncmConhecido })
   ↓
NFE_DIFAL_NCM_INEXISTENTE → bloqueio no servidor
```

O payload pode vir de qualquer cliente, então o bloqueio do servidor independe
de a tela ter deixado algum campo vazio: mesmo com as alíquotas todas
preenchidas, um NCM inexistente barra a geração do rascunho. A tela repassa a
pendência que recebeu para `toNFeItem`, de modo que a validação local acuse a
mesma coisa e o item não fique "pronto" na lista.

A tabela nasce **vazia** e é carregada por `npm run fiscal:ncm -- <banco> --aplicar`.
Enquanto estiver vazia — ou se a consulta falhar, por exemplo com a migration
ainda pendente — a checagem de existência se desliga e vale só o formato, com um
aviso no log do servidor. Uma camada a mais não pode virar indisponibilidade.

Para atualizar quando sair nova Resolução Gecex:

```bash
curl -sSL https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
# regravar data/fiscal/ncm/ncm-siscomex.json no mesmo formato
npm run fiscal:ncm -- demir              # diff
npm run fiscal:ncm -- demir --aplicar    # grava
```

Código que sai da NCM recebe `vigencia_fim` em vez de ser apagado: nota antiga
referencia o NCM que valia na época.

## Estado da carga inicial

28 regras carregadas, **16 ativas**. Uma regra inativa fica no banco para
histórico e auditoria, mas não resolve nada — a emissão para e pede confirmação.

**Resolvem tudo automaticamente (interna + FCP):** PI, RJ, GO, RR.

**Resolvem a interna, mas o FCP continua bloqueando:** AC, AP, BA, DF, ES, MG,
MS, MT, RS, SC, SP — o portal simplesmente não publica o FCP da regra geral
dessas UFs, e "célula vazia" não é o mesmo que "não há FCP".

**Inativas, exigindo decisão humana:** AL, AM, CE, MA, PA, PB, PE, PR, RN, RO,
SE, TO. Os motivos estão em `nota_curadoria`, linha a linha, e são de três
tipos: o portal está desatualizado em relação à referência histórica do ERP
(CE, MA, PA, PE, PR, RN, TO); a própria linha do portal se contradiz (AL, RO,
PB); ou o portal não publica regra geral para mercadorias (AM).

Não copiamos os valores antigos do `ALIQUOTA_INTERNA_POR_UF` por cima: onde as
duas fontes divergem, a divergência está registrada e bloqueia, em vez de a
emissão escolher sozinha.

> Achado da conferência: o `ALIQUOTA_INTERNA_POR_UF` guardava 20% para o RJ, que
> é a soma de 18% de ICMS com 2% de FECP. No DIFAL os dois são campos distintos
> (`pICMSUFDest` e `pFCPUFDest`), então somá-los produzia ICMS a maior e FCP
> zerado. A regra do RJ entrou separada: 18 e 2.

## Limitações conhecidas

- **`ALIQUOTA_INTERNA_POR_UF` ainda existe** como fallback técnico, marcado como
  `TABELA_REFERENCIA` e sempre bloqueando. Some quando as 27 UFs tiverem regra
  ativa conferida.
- **Regras por NCM/CEST não foram carregadas.** O portal descreve a maior parte
  das faixas específicas em texto legal ("determinadas mercadorias conforme
  artigo X") sem NCM determinístico. Transformar esse texto em cálculo seria
  heurística; ficou de fora de propósito.
- **`tpOperGov=2`** (exceção 11) não é modelado no ERP.
- **NA13-10** calcula `vFCPUFDest` sobre `vBCUFDest`. O motor usa
  `vBCFCPUFDest` quando o usuário informa base de FCP própria; com os dois
  iguais (o padrão) o resultado é idêntico.

## Testes

```bash
npx tsx --test src/lib/nfe/difalRegras.test.ts   # 59 casos do motor
npx tsx --test src/lib/nfe/difal.test.ts         # 30 casos de cálculo e incidência
npm run db:test:difal -- demir                   # migration, constraints e RLS, em rollback
npm run test:negocio                             # suíte completa
```
