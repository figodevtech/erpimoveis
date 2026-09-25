# TAREFA — Corrigir tratamento do `indIEDest` e prevenir Rejeição 805 da NF-e

Projeto: `figodevtech/erpoficina`  
Branch de trabalho: partir da `develop` mais recente.

Não assumir que o estado local está atualizado.

Antes de alterar qualquer coisa:

1. buscar o head atual da `develop`;
2. inspecionar a implementação existente;
3. preservar as regras fiscais já implementadas;
4. não duplicar motores fiscais;
5. consultar as referências oficiais listadas no final deste documento;
6. implementar, testar e validar a correção completa.

> Importante: a regra E16a-30 sofreu atualizações ao longo do tempo. Não copiar a lista de UFs de uma versão antiga do MOC sem confrontá-la com a documentação oficial mais recente publicada no Portal Nacional da NF-e.

> **Atualização de 25/09/2026:** a NT 2025.001 v1.03 ampliou a E16a-30 para operações internas e interestaduais (`idDest=1` ou `2`). A implantação em produção para operações internas foi adiada até 13/10/2025. As passagens históricas deste documento que restringiam a regra a `idDest=2` foram corrigidas abaixo. [Fonte oficial vigente](https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=NvuzQGYd6E8%3D).

---

## Contexto real que motivou a correção

No ambiente de produção da Demir Diesel ocorreu a seguinte rejeição:

- `nfe.id = 203`
- modelo = `55 / NFE`
- série = `3`
- número utilizado na tentativa = `168`
- origem = `OS #440`
- UF emitente = `PB`
- UF destinatário = `AL`
- operação interestadual
- `idDest = 2`
- destinatário enviado com `indIEDest = 2`

Retorno da SEFAZ:

```text
cStat = 805

Rejeição: A SEFAZ do destinatário não permite
Contribuinte Isento de Inscrição Estadual
```

O XML efetivamente transmitido continha:

```xml
<idDest>2</idDest>

<dest>
    ...
    <UF>AL</UF>
    <indIEDest>2</indIEDest>
</dest>
```

Os itens utilizavam `CST 60`, porém não havia `vICMSST` nem `vICMSSTRet` informado nos grupos ICMS.

Posteriormente o cadastro do cliente foi corrigido para:

```text
ind_ie_dest = 9
```

mas a NF-e rejeitada preservou corretamente o snapshot antigo:

```text
dados_avulsos.destinatario.indicadorIe = "2"

destinatario_snapshot.indIEDest = 2
```

Portanto alterar o cadastro do cliente não deve silenciosamente reescrever uma NF-e já criada.

O problema a corrigir é: o ERP aceita estruturalmente `indIEDest=2` e envia a NF-e para a SEFAZ mesmo quando já é possível determinar localmente que a regra `E16a-30` produzirá rejeição `805`.

---

## 1. Regra oficial E16a-30

Implementar a Regra de Validação `E16a-30`.

Fonte oficial: Portal Nacional da NF-e, documento oficial atualizado de Regras de Validação / Identificação do Destinatário.

Condição principal:

```text
modelo = 55
+
indIEDest = 2
+
idDest = 1 ou 2
+
UF destinatária configurada como não permitindo
Contribuinte Isento de Inscrição Estadual
```

A documentação oficial atual lista:

```text
AL
AM
BA
CE
DF
ES
GO
MG
MS
MT
PB
PE
RJ
RN
RS
SE
SP
```

Resultado:

```text
cStat = 805
Rejeição: A SEFAZ do destinatário não permite
Contribuinte Isento de Inscrição Estadual
```

A aplicação depende da configuração da UF destinatária. Portanto a lista precisa ter:

- fonte;
- versão/revisão;
- data da última conferência;
- possibilidade de atualização futura.

---

## 2. Implementar todas as exceções da E16a-30

A validação **não deve bloquear** quando pelo menos uma das exceções oficiais abaixo se aplicar.

### Exceção 1 — ICMS-ST destacado

A regra não se aplica quando houver destaque de:

```text
vICMSST
```

em pelo menos um item da NF-e.

Não confundir CST relacionado a ST com existência real de `vICMSST`.

CST 10, 30, 60 ou qualquer outro código isoladamente não deve ser tratado como prova da exceção.

### Exceção 2 — ICMS-ST retido anteriormente

A regra não se aplica quando houver:

```text
vICMSSTRet
```

em pelo menos um item da NF-e.

`CST 60` sozinho não satisfaz essa exceção.

O caso real da NF-e 203 demonstra isso:

```text
CST 60
+
vICMSSTRet ausente
=
continua sujeito à rejeição 805
```

Nunca inventar `vICMSSTRet` apenas para fazer a nota passar.

### Exceção 3 — data histórica

Em produção, a regra não se aplica para NF-e com data de emissão anterior a:

```text
01/07/2016
```

Usar data fiscal civil, não comparação em UTC que possa alterar o dia da operação.

### Exceção 4 — operações isentas/imunes/não tributadas

A regra não se aplica para:

```text
CST 40
CST 41

CSOSN 103
CSOSN 300
CSOSN 400
```

Não ampliar essa lista por analogia.

---

## 3. Centralizar a regra

Inspecionar primeiro:

```text
src/lib/nfe/indIEDest.ts
```

e o restante do núcleo de validação fiscal.

Hoje esse módulo já centraliza:

```text
IND_IE_DEST_CONTRIBUINTE = 1
IND_IE_DEST_ISENTO = 2
IND_IE_DEST_NAO_CONTRIBUINTE = 9
```

e possui tratamento específico para rejeição 306.

Evoluir essa estrutura ou criar módulo fiscal específico caso isso resulte em arquitetura mais limpa.

Não colocar a regra somente em componente React.

Ela precisa ser reutilizada por:

- emissão assistida;
- NF-e avulsa;
- backend;
- preparação fiscal;
- geração do XML;
- validação antes da transmissão;
- testes;
- tratamento visual da rejeição.

Exemplo conceitual:

```ts
avaliarRegraE16a30({
  modelo,
  idDest,
  ufDestino,
  indIEDest,
  ambiente,
  dataEmissao,
  itens
})
```

Retorno possível:

```ts
{
  aplica: true,
  bloqueia: true,
  code: "NFE_IND_IE_DEST_ISENTO_UF_NAO_PERMITE",
  regra: "E16a-30",
  cStat: "805",
  excecaoAplicada: null,
  fonte: {...}
}
```

ou:

```ts
{
  aplica: true,
  bloqueia: false,
  excecaoAplicada: "vICMSSTRet"
}
```

Reutilizar o padrão de Issues Fiscais existente.

---

## 4. Severidade

Quando todas as condições da `E16a-30` estiverem satisfeitas e nenhuma exceção oficial se aplicar:

```text
BLOQUEIO
```

Não:

```text
AVISO
INFO
"Estou ciente"
```

A ciência do usuário não pode contornar uma condição em que o ERP já consegue determinar que a SEFAZ aplicará a rejeição.

Mensagem sugerida:

```text
Alagoas não permite destinatário classificado como
"2 - Contribuinte isento de inscrição estadual"
nesta operação.

Confira a situação fiscal do destinatário.

• Contribuinte do ICMS:
  utilize indicador 1 e informe uma IE ativa.

• Não contribuinte do ICMS:
  utilize indicador 9.

Regra E16a-30 — Rejeição 805 da NF-e.
```

Não mandar automaticamente selecionar 9. O destinatário também pode ser contribuinte com IE ativa e, portanto, indicador 1.

---

## 5. Não corrigir o dado fiscal automaticamente

Nunca fazer:

```ts
if (ufNaoAceitaIsento) {
  indIEDest = 9;
}
```

Isso seria uma alteração tributária automática sem fundamento suficiente.

O ERP deve detectar a incompatibilidade e exigir que o operador classifique corretamente o destinatário.

Possibilidades:

```text
1 - Contribuinte do ICMS
→ IE ativa obrigatória.

9 - Não contribuinte do ICMS
→ IE não enviada.
```

A situação fiscal real determina a escolha.

---

## 6. Caso de regressão — NF-e 203

Criar fixture/teste reproduzindo:

```text
modelo = 55
ufEmitente = PB
ufDestino = AL
idDest = 2
indIEDest = 2
data atual
CST = 60
vICMSST ausente
vICMSSTRet ausente
```

Resultado obrigatório:

```text
severity = BLOQUEIO
regra = E16a-30
cStat = 805
```

`CST 60` sozinho não pode liberar essa nota.

---

## 7. Testes das exceções

Criar pelo menos:

```text
CASO A
AL + idDest=2 + indIEDest=2 + sem exceções
=> BLOQUEIO / E16a-30 / 805

CASO B
AL + idDest=2 + indIEDest=2 + vICMSST
=> não bloqueia pela E16a-30

CASO C
AL + idDest=2 + indIEDest=2 + vICMSSTRet
=> não bloqueia pela E16a-30

CASO D
AL + idDest=2 + indIEDest=2 + CST 60 + vICMSSTRet ausente
=> BLOQUEIO

CASO E
CST 40
=> não bloqueia

CASO F
CST 41
=> não bloqueia

CASO G
CSOSN 103
=> não bloqueia

CASO H
CSOSN 300
=> não bloqueia

CASO I
CSOSN 400
=> não bloqueia

CASO J
UF fora da configuração atual da E16a-30
=> não inventar bloqueio

CASO K
idDest = 3
=> E16a-30 não se aplica

CASO K2
idDest = 1, UF configurada, sem exceção
=> E16a-30 bloqueia com cStat 805

CASO L
modelo 65
=> E16a-30 não se aplica

CASO M
data de emissão anterior a 01/07/2016 em produção
=> exceção histórica aplicada
```

---

## 8. Lista de UFs e proveniência

Não espalhar pelo código:

```ts
["AL", "AM", ...]
```

Criar fonte única/versionada.

Exemplo:

```ts
REGRA_E16A30 = {
  code: "E16a-30",
  cStat: "805",
  modelo: 55,
  ufs: [
    "AL", "AM", "BA", "CE", "DF", "ES", "GO", "MG",
    "MS", "MT", "PB", "PE", "RJ", "RN", "RS", "SE", "SP"
  ],
  source: {
    titulo: "...",
    url: "...",
    revisadaEm: "...",
    jurisdicao: "NACIONAL"
  }
}
```

Não precisa ter exatamente esse formato.

Usar a infraestrutura fiscal já existente quando possível.

---

## 9. Validar antes de assinar e transmitir

A barreira principal precisa existir no **backend**.

Não depender apenas do React.

Mesmo com request manual ou payload adulterado:

```text
UF = AL
idDest = 2
indIEDest = 2
sem exceção
```

deve ser bloqueado.

Inspecionar:

```text
src/services/fiscal/nfeAvulsaService.ts
src/services/fiscal/nfeSaidaService.ts
src/lib/nfe/buildNFe.ts
```

e o núcleo shared utilizado pelos fluxos.

Não repetir a mesma regra nos três arquivos.

---

## 10. Tratamento visual da rejeição 805

Hoje existe tratamento específico para rejeição 306.

Implementar equivalente para 805.

Algo como:

```ts
CSTAT_IND_IE_DEST_ISENTO_NAO_PERMITIDO = "805"

ehRejeicaoIndIeDestIsentoNaoPermitido(...)

MENSAGEM_REJEICAO_805
```

Na listagem:

```text
Esta UF não aceitou o destinatário como
"Contribuinte isento de IE".

Confira a situação fiscal antes de reenviar.
```

Se houver cliente vinculado:

```text
[ Revisar dados fiscais do destinatário ]
```

Reutilizar o fluxo existente utilizado para rejeição 306.

---

## 11. Reenviar sem alterar

Para `cStat 805`, reenviar o mesmo conteúdo normalmente apenas repete a rejeição.

No caso de 805:

- "Corrigir dados" deve ser ação principal;
- "Reenviar sem alterar" deve ser desabilitado, escondido ou exigir confirmação explícita.

Não aplicar isso automaticamente a todas as rejeições.

Classificar apenas rejeições conhecidas como erro de conteúdo fiscal.

---

## 12. Snapshot da nota vs cadastro atual

Preservar a decisão arquitetural atual:

uma NF-e criada deve reabrir com os dados salvos na própria nota.

Não substituir silenciosamente:

```text
destinatario_snapshot.indIEDest
```

pelo cadastro atual do cliente.

Porém, em correção de nota rejeitada, comparar com o cadastro atual.

Exemplo real:

```text
NF-e rejeitada:
2 - Contribuinte isento

Cadastro atual:
9 - Não contribuinte
```

Mostrar:

```text
Os dados fiscais do cadastro mudaram desde esta tentativa.

[ Usar classificação atual do cadastro ]
```

Somente após ação explícita atualizar o rascunho.

Ao aplicar:

- atualizar `indIEDest`;
- ajustar IE de maneira coerente;
- recalcular `indFinal`;
- recalcular DIFAL;
- recalcular ICMS;
- recalcular warnings;
- invalidar fingerprints antigos;
- recalcular demais decisões dependentes.

---

## 13. Indicador 9 e rejeição 696

Não corrigir 805 criando potencial rejeição 696.

A regra `E16a-40` determina que, em saída não exterior:

```text
indIEDest = 9
```

deve ser coerente com:

```text
indFinal = 1
```

quando aplicável.

Reutilizar a lógica já existente:

```text
destinoMercadoria
indFinalDoDestino
motor DIFAL
validação fiscal atual
```

Não criar segunda implementação.

---

## 14. IE e indicador

Preservar:

```text
indIEDest = 1
→ IE obrigatória.

indIEDest = 2
→ não enviar IE.

indIEDest = 9
→ não enviar IE.
```

O XML atual já centraliza essa decisão.

Não duplicar.

---

## 15. Consulta de CNPJ / IE

Consulta pública de CNPJ pode continuar sendo auxílio.

Não usá-la como autoridade automática para definir 1/2/9.

Ausência de IE numa API externa não autoriza:

```text
indIEDest = 9
```

automaticamente.

A classificação final precisa permanecer explícita.

---

## 16. Fonte nas Issues Fiscais

A issue deve carregar algo semelhante a:

```ts
{
  code,
  severity: "BLOQUEIO",
  message,
  source: {
    regra: "E16a-30",
    cStat: "805",
    titulo: "...",
    url: "...",
    jurisdicao: "NACIONAL",
    revisadaEm: "..."
  }
}
```

A interface deve conseguir explicar:

```text
Por que o ERP bloqueou?
```

e apontar para a fonte oficial.

---

## 17. Evolução da E16a-30 e da E16a-35

`E16a-30`:

```text
idDest = 1 ou 2
operação interna ou interestadual
modelo 55
aplicação obrigatória
cStat 805
```

`E16a-35` na documentação anterior:

```text
idDest = 1
operação interna
modelo 55
aplicação facultativa conforme configuração da UF
```

Não implementar:

```ts
if (indIEDest === 2 && ufNaLista) bloqueia;
```

Essa condição isolada continua incorreta porque ignora modelo, `idDest` e exceções. A NT 2025.001 v1.03 incorporou as operações internas à E16a-30. O adiamento em produção até 13/10/2025 já terminou.

Nesta tarefa, implementar corretamente `E16a-30`.

Se `E16a-35` já existir, verificar que não conflita.

---

## 18. Fluxo da NF-e rejeitada

Validar:

```text
NF-e 203 rejeitada
indIEDest=2
        ↓
Corrigir dados
        ↓
snapshot continua 2
        ↓
cadastro atual pode estar 9
        ↓
usuário escolhe explicitamente usar cadastro atual
        ↓
rascunho muda para 9
        ↓
motor fiscal recalcula contexto
        ↓
salva a MESMA nfe.id
        ↓
não cria segunda NF-e
        ↓
nova autorização
```

Preservar o reaproveitamento de rascunho rejeitado.

---

## 19. Não alterar produção diretamente

Não executar `UPDATE` diretamente na NF-e 203 durante esta tarefa.

Não executar `UPDATE` no cliente.

A NF-e 203 é fixture/caso de regressão.

A correção deve funcionar pelo fluxo normal do ERP.

---

## 20. Testes obrigatórios

Cobrir:

- normalização 1/2/9;
- indicador 1 sem IE bloqueia;
- indicador 2 não envia IE;
- indicador 9 não envia IE;
- AL + interestadual + 2 => E16a-30;
- CST 60 sozinho não satisfaz exceção;
- `vICMSST` satisfaz exceção;
- `vICMSSTRet` satisfaz exceção;
- CST 40;
- CST 41;
- CSOSN 103;
- CSOSN 300;
- CSOSN 400;
- data histórica;
- `idDest=1` em UF configurada passa pela E16a-30;
- `idDest=3` não passa pela E16a-30;
- modelo 65 não passa pela E16a-30;
- UF não configurada não recebe regra inventada;
- frontend reconhece cStat 805;
- backend bloqueia payload manual inválido;
- cadastro atual não sobrescreve snapshot silenciosamente;
- "usar cadastro atual" é ação explícita;
- mudança 2→9 recalcula o contexto;
- 2→9 mantém `indFinal` coerente e evita rejeição 696.

---

## 21. Validação final

Executar efetivamente:

```bash
npm run test:negocio
```

e também:

- testes específicos de `indIEDest`;
- testes da E16a-30;
- typecheck;
- lint dos arquivos alterados;
- build, se viável.

Não afirmar que passou algo que não foi executado.

---

## 22. Relatório final

Informar:

1. causa da rejeição 805;
2. regra implementada;
3. UFs da fonte atual;
4. exceções implementadas;
5. arquivos alterados;
6. integração backend;
7. integração frontend;
8. tratamento da NF-e rejeitada;
9. comportamento snapshot x cadastro atual;
10. testes criados;
11. comandos executados;
12. resultados;
13. fonte oficial usada e data de revisão;
14. eventuais limitações.

---

# Referências oficiais — obrigatório consultar

## 1. Regra E16a-30 / Rejeição 805

Portal Nacional da Nota Fiscal Eletrônica.

NT 2025.001 v1.03 — alteração vigente da E16a-30.

Consultar:

```text
E. Identificação do Destinatário
Regra E16a-30
Modelo 55
cStat 805
```

URL:

https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=NvuzQGYd6E8%3D

Usar esta referência como autoridade principal para:

- lista atual de UFs;
- aplicação da rejeição 805;
- exceções vigentes.

A versão atual lista:

```text
AL, AM, BA, CE, DF, ES, GO, MG, MS, MT,
PB, PE, RJ, RN, RS, SE e SP
```

---

## 2. Nota Técnica 2020.004 — referência histórica

Portal Nacional da NF-e.

Consultar especificamente:

```text
E. Identificação do Destinatário
E16a-30
E16a-35
```

URL:

https://hom.nfe.fazenda.gov.br/PORTAL/exibirArquivo.aspx?conteudo=CE5WTGkz5Rc%3D

A NT documenta, entre outros pontos:

- `indIEDest=2`;
- `idDest=2`;
- cStat 805;
- `vICMSST`;
- `vICMSSTRet`;
- data histórica de 01/07/2016;
- CST 40/41;
- CSOSN 103/300/400.

Não utilizar a NT histórica para substituir uma configuração mais recente de UFs publicada pelo Portal.

---

## 3. MOC 7.0 — Anexo I

Manual de Orientação do Contribuinte.

Anexo I — Leiaute e Regras de Validação da NF-e e NFC-e.

URL:

https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=J+I+v4eN00E%3D

Consultar especialmente:

```text
E16a-10
E16a-20
E16a-30
E16a-35
E16a-40
E17-10
E17-20
E17-30
```

O MOC é útil para compreender a relação entre:

- `indIEDest`;
- modelo;
- `idDest`;
- IE;
- `indFinal`.

A lista de UFs de uma edição antiga do MOC não deve prevalecer sobre documentação posterior do Portal.

---

## 4. Aviso oficial do Portal sobre E16a-30

O Portal Nacional publicou em 01/10/2025 correção documental da NT 2025.001 v1.03, inclusive corrigindo a identificação textual da regra de `16a-30` para `E16a-30`.

URL:

https://www.nfe.fazenda.gov.br/portal/informe.aspx?Informe=zOhiRJjtQHs%3D&ehCTG=false

Usar a nomenclatura:

```text
E16a-30
```

---

# Princípio de segurança fiscal

O objetivo não é fazer a nota "passar" mudando tributação automaticamente.

O objetivo é:

```text
detectar antecipadamente uma combinação que a SEFAZ rejeitará
+
orientar o usuário para informar a situação fiscal verdadeira
```

Nunca:

- converter `2` para `9` automaticamente;
- inventar IE;
- inventar `vICMSST`;
- inventar `vICMSSTRet`;
- considerar CST 60 sozinho como prova de ST retido;
- consultar Google durante a emissão;
- confiar apenas na validação frontend.

A decisão de runtime deve ser:

```text
determinística
+
versionada
+
auditável
+
baseada em fonte oficial
```
