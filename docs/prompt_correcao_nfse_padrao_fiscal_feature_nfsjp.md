# Prompt de correção — NFS-e João Pessoa / Padrões fiscais na `feature/nfsjp`

Você vai corrigir a implementação atual da branch `feature/nfsjp` do projeto `figodevtech/erpoficina`.

## Objetivo

Corrigir a regressão de carregamento dos valores fiscais padrão na emissão de NFS-e após a migração de João Pessoa para o emissor Nacional e garantir que o padrão fiscal carregado corresponda ao modelo realmente escolhido para os serviços selecionados.

A mudança principal de João Pessoa para o padrão Nacional está conceitualmente correta, mas existem duas falhas que precisam ser resolvidas:

1. empresas que migraram de `MUNICIPAL_JOAO_PESSOA` para `NACIONAL` não possuem necessariamente um perfil `padroes_emissao.NACIONAL`, então a emissão abre com campos fiscais vazios;
2. a tela resolve o modelo usando todos os serviços da OS, mas o backend resolve novamente usando apenas os serviços selecionados. Isso pode fazer a tela carregar o padrão Nacional e o POST decidir pelo Municipal, ou vice-versa.

Não faça merge em `main`.

---

# Contexto real da Demir Diesel

No Supabase da Demir:

```text
Município: 2507507
Regime tributário: 3
Ambiente: PRODUCAO
```

O `nfse_config.padroes_emissao` ainda possui apenas:

```json
{
  "MUNICIPAL_JOAO_PESSOA": {
    "issRetido": "false",
    "codigoCnae": "452000100",
    "aliquotaIss": "5",
    "itemListaServico": "14.01",
    "naturezaOperacao": "1"
  }
}
```

Não existe hoje:

```json
"NACIONAL": { ... }
```

Depois da atualização, a política para:

```text
João Pessoa
CRT 3
item 14.01
data >= 2026-10-01
```

retorna corretamente:

```text
NACIONAL
```

Por isso a rota passou a procurar:

```ts
padroesEmissao.NACIONAL
```

Como esse objeto não existe no banco, a tela recebe:

```ts
padraoFiscal = null
```

e abre os campos fiscais vazios.

---

# Correção 1 — garantir configuração do padrão Nacional

Não criar fallback automático do tipo:

```ts
padroesEmissao.NACIONAL ?? padroesEmissao.MUNICIPAL_JOAO_PESSOA
```

Isso seria incorreto porque os campos têm significados diferentes.

Exemplos:

```text
itemListaServico
codigoCnae
naturezaOperacao
issRetido
```

são do fluxo municipal antigo.

Enquanto o Nacional utiliza:

```text
codigoTributacaoNacionalIss
codigoTributacaoMunicipalIss
codigoNbs
tributacaoIss
tipoRetencaoIss
regimeEspecialTributacao
finalidadeEmissao
consumidorFinal
indicadorDestinatario
codigoIndicadorOperacao
ibsCbsSituacaoTributaria
ibsCbsClassificacaoTributaria
```

## Comportamento desejado

Quando a política atual indicar `NACIONAL` e não existir `padroes_emissao.NACIONAL`:

- não preencher dados nacionais inventando conversões do padrão municipal;
- informar claramente na tela que o padrão Nacional ainda não foi configurado;
- disponibilizar o cadastro desse novo padrão em Configurações Fiscais;
- impedir uma emissão fiscal real caso campos obrigatórios ainda estejam sem configuração;
- preservar integralmente `MUNICIPAL_JOAO_PESSOA`, pois ele continua sendo usado no histórico e nas exceções de transição.

A tela de Configurações Fiscais já deve permitir coexistirem:

```text
NACIONAL
MUNICIPAL_JOAO_PESSOA
MUNICIPAL_CABEDELO
```

Verifique se o GET e o PUT de `/api/config/nfse` realmente preservam todas essas chaves.

Adicionar teste garantindo que salvar `NACIONAL` não apaga `MUNICIPAL_JOAO_PESSOA`, e vice-versa.

---

# Correção 2 — carregar o padrão depois da seleção real de serviços

Hoje existe uma inconsistência:

## GET inicial

`GET /api/nfse/servicos-de-os/[id]`

resolve a política usando todos os serviços da OS.

Exemplo:

```text
01.03
14.01
```

Resultado:

```text
NACIONAL
```

porque a nota possui pelo menos um item fora das exceções.

## Depois

O usuário pode selecionar apenas:

```text
01.03
```

No POST:

`POST /api/nfse/de-os/[id]`

a política é recalculada somente com os serviços selecionados.

Resultado:

```text
MUNICIPAL_JOAO_PESSOA
```

Assim, a tela pode ter carregado:

```text
padroesEmissao.NACIONAL
```

mas o backend decidir:

```text
MUNICIPAL_JOAO_PESSOA
```

Isso precisa ser corrigido.

## Solução desejada

A política usada na revisão da nota deve ser calculada com os serviços efetivamente selecionados.

Ao clicar em:

```text
Revisar nota
```

antes de mostrar os campos fiscais:

1. obter os serviços selecionados;
2. resolver novamente a política;
3. determinar o `modeloEmissao` final;
4. carregar o `padraoFiscal` correspondente ao modelo final;
5. só depois preencher `codigosFiscais`;
6. exibir o formulário fiscal correto.

Não confiar apenas no `modeloEmissao` calculado na abertura da OS.

---

# Arquitetura sugerida

Criar ou adaptar uma rota/helper para resolver:

```ts
resolverContextoEmissaoNFSe({
  empresa,
  servicosSelecionados,
  dataCompetencia
})
```

Resultado sugerido:

```ts
{
  politica,
  modeloEmissao,
  padraoFiscal
}
```

A mesma regra deve ser usada:

- no front antes de abrir a etapa de revisão;
- no POST antes da emissão;
- nos testes.

Não duplicar lógica de política em componentes React.

---

# Endpoint sugerido para revisão

Se fizer sentido arquiteturalmente, criar uma rota como:

```text
POST /api/nfse/contexto-emissao/[osId]
```

Payload:

```json
{
  "servicos": [12, 15]
}
```

Resposta:

```json
{
  "ok": true,
  "modeloEmissao": "NACIONAL",
  "politicaEmissao": {
    "exigeRtc": true,
    "motivo": "..."
  },
  "padraoFiscal": {
    "...": "..."
  }
}
```

Não é obrigatório usar esse endpoint exato.

Também pode adaptar a rota `servicos-de-os/[id]` para aceitar os ids selecionados, desde que:

- a política final seja resolvida pelos serviços realmente selecionados;
- a tela não use padrão fiscal de outro modelo.

---

# Correção 3 — UX quando o padrão Nacional não existe

Hoje a ausência do padrão resulta simplesmente em campos vazios.

Melhorar isso.

Se:

```ts
modeloEmissao === "NACIONAL"
```

e:

```ts
padraoFiscal == null
```

mostrar algo claro:

```text
O padrão fiscal da NFS-e Nacional ainda não foi configurado para esta empresa.
Preencha os códigos fiscais necessários em Configurações > Fiscal > NFS-e.
```

A interface pode continuar permitindo edição manual na emissão se isso já for suportado, mas deve deixar evidente que os valores padrão não foram cadastrados.

Não assumir ou preencher automaticamente:

- NBS;
- cIndOp;
- CST IBS/CBS;
- cClassTrib;
- cTribNac;
- cTribMun.

---

# Correção 4 — preservar o comportamento antigo dos padrões

O sistema já possuía a regra de:

```text
abrir emissão
→ identificar modelo
→ carregar valores padrão
→ preencher o formulário fiscal
```

Esse comportamento deve continuar.

O novo fluxo precisa ser:

```text
serviços selecionados
        ↓
resolver política
        ↓
determinar modelo final
        ↓
buscar padrão do modelo final
        ↓
preencher codigosFiscais
        ↓
permitir edição
```

A ordem é importante.

Não pode ser:

```text
resolver modelo usando todos os serviços
        ↓
carregar padrão
        ↓
usuário muda seleção
        ↓
backend escolhe outro modelo
```

---

# Correção 5 — ambientes

Verifique e documente o comportamento atual.

Hoje o ambiente:

```text
PRODUCAO
HOMOLOGACAO
```

muda:

- endpoint da Focus;
- token utilizado.

Mas `nfse_config.padroes_emissao` atualmente não é separado por ambiente.

Não criar separação por ambiente sem necessidade.

Se os códigos fiscais forem iguais em homologação e produção, mantenha um único padrão por modelo.

Somente implementar:

```text
PRODUCAO.NACIONAL
HOMOLOGACAO.NACIONAL
```

se houver uma necessidade real do domínio ou configuração já existente no projeto que exija isso.

Antes de fazer qualquer alteração estrutural no JSON, confirme o comportamento atual das demais configurações fiscais.

---

# Correção 6 — atualizar branch antes do merge

A branch `feature/nfsjp` está divergente da `develop`.

Antes de finalizar:

1. atualizar a feature com as alterações recentes da `develop`;
2. resolver conflitos sem perder as mudanças de NFS-e;
3. repetir todos os testes.

Não fazer merge em `main`.

---

# Arquivos a revisar

No mínimo:

```text
src/lib/services/fiscais/nfse-politica.ts

src/lib/services/fiscais/nfse-service.ts

src/app/api/nfse/servicos-de-os/[id]/route.ts

src/app/api/nfse/de-os/[id]/route.ts

src/app/api/config/nfse/route.ts

src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/emissao-nfse-dialog.tsx

src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/nfse-fiscal-form.tsx

src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types.ts

src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx

src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/page.tsx

src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/types.ts
```

Procure também todas as referências a:

```text
padraoFiscal
padroes_emissao
padroesEmissao
modeloEmissao
resolverPoliticaNFSe
modelosPossiveisNFSe
setCodigosFiscais
EMPTY_CODIGOS
MUNICIPAL_JOAO_PESSOA
NACIONAL
```

---

# Testes obrigatórios

Adicionar testes cobrindo explicitamente o carregamento de padrão.

## Teste 1 — Demir após 01/10

Entrada:

```text
município = 2507507
CRT = 3
data = 2026-10-02
item = 14.01
```

Config:

```json
{
  "NACIONAL": {
    "codigoTributacaoNacionalIss": "140101",
    "codigoNbs": "120013110",
    "tributacaoIss": "1",
    "tipoRetencaoIss": "1",
    "finalidadeEmissao": "0",
    "consumidorFinal": "0",
    "indicadorDestinatario": "0",
    "codigoIndicadorOperacao": "050101",
    "ibsCbsSituacaoTributaria": "000",
    "ibsCbsClassificacaoTributaria": "000001"
  }
}
```

Esperado:

```text
modeloEmissao = NACIONAL
padraoFiscal = padroes_emissao.NACIONAL
```

## Teste 2 — padrão Nacional inexistente

Mesma empresa e operação.

Config:

```json
{
  "MUNICIPAL_JOAO_PESSOA": { ... }
}
```

Esperado:

```text
modeloEmissao = NACIONAL
padraoFiscal = null
```

A tela deve informar que o padrão Nacional precisa ser configurado.

Não deve usar silenciosamente o padrão municipal.

## Teste 3 — exceção municipal

Entrada:

```text
João Pessoa
CRT 3
item 01.03
02/10/2026
```

Esperado:

```text
modeloEmissao = MUNICIPAL_JOAO_PESSOA
padraoFiscal = padroes_emissao.MUNICIPAL_JOAO_PESSOA
```

## Teste 4 — OS com dois tipos

OS:

```text
01.03
14.01
```

Ao abrir:

pode inicialmente identificar Nacional.

Mas se o usuário selecionar somente:

```text
01.03
```

antes de revisar, o sistema precisa recalcular e retornar:

```text
MUNICIPAL_JOAO_PESSOA
```

e carregar:

```text
padroes_emissao.MUNICIPAL_JOAO_PESSOA
```

## Teste 5 — seleção somente 14.01

Na mesma OS mista, se selecionar somente:

```text
14.01
```

esperado:

```text
NACIONAL
padraoFiscal = padroes_emissao.NACIONAL
```

## Teste 6 — salvar configurações

Partindo de:

```json
{
  "MUNICIPAL_JOAO_PESSOA": {...},
  "NACIONAL": {...}
}
```

Salvar a aba NFS-e não pode apagar nenhuma das duas chaves.

## Teste 7 — histórico

Notas antigas com:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

continuam:

- consultando pelo endpoint municipal;
- cancelando pelo endpoint municipal;
- exibindo corretamente o histórico.

## Teste 8 — emissão real não pode ocorrer sem padrão obrigatório

Se a operação for Nacional e os campos obrigatórios estiverem ausentes:

esperado:

```text
HTTP 400/422
mensagem clara
nenhuma chamada à Focus
```

---

# Não fazer

Não:

- migrar registros antigos de `MUNICIPAL_JOAO_PESSOA` para `NACIONAL`;
- copiar automaticamente CNAE municipal para cTribNac;
- copiar `itemListaServico` para cTribNac;
- usar `codigoServicoMunicipal` antigo como `cTribMun`;
- inventar NBS;
- inventar cIndOp;
- inventar CST IBS/CBS;
- inventar cClassTrib;
- alterar NF-e/NFC-e;
- fazer emissão real em produção para testar;
- remover o padrão municipal antigo;
- hardcodar dados específicos da Demir no código;
- assumir `NACIONAL = MEI`;
- assumir `NACIONAL = RTC obrigatório` em todos os regimes.

---

# Resultado esperado

Ao terminar, apresentar:

1. arquivos alterados;
2. causa raiz do padrão não ter carregado;
3. solução adotada;
4. como a política é recalculada após a seleção dos serviços;
5. como o padrão correspondente é carregado;
6. comportamento quando o padrão Nacional ainda não existe;
7. confirmação de que `MUNICIPAL_JOAO_PESSOA` foi preservado;
8. confirmação de que salvar `NACIONAL` não apaga os demais padrões;
9. testes criados;
10. resultado de lint;
11. resultado de typecheck;
12. resultado dos testes;
13. resultado do build;
14. confirmação de que nenhuma emissão real foi realizada;
15. confirmação de que a branch foi atualizada com a `develop` antes do merge.

Faça as correções na `feature/nfsjp`, mantenha o histórico fiscal compatível e não faça merge em `main`.
