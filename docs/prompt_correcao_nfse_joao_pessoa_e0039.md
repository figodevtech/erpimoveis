# CORREÇÃO CRÍTICA — NFS-e João Pessoa após E0039

Você vai corrigir a implementação atual da branch `feature/nfsjp` do repositório `figodevtech/erpoficina`.

Use também o Supabase da Demir Diesel para validar o histórico real das emissões.

NÃO faça merge em `main`.
NÃO execute nova emissão real em produção até concluir a investigação e validar o transport/autorizador correto.

---

# 1. CONTEXTO

Estamos migrando a emissão de NFS-e de João Pessoa após as mudanças iniciadas em 01/10/2026.

A Demir Diesel possui:

```text
Município IBGE: 2507507
Regime tributário: CRT 3 / Regime Normal
Inscrição Municipal: 1094653
Ambiente: PRODUCAO
Item LC 116 utilizado: 14.01
```

Até 30/09/2026 as emissões funcionavam através do emissor municipal antigo:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
Focus:
POST /v2/nfse
```

Em 02/10/2026 ocorreu a primeira rejeição relevante:

```text
L999

O Emissor atual está disponível somente para contribuintes enquadrados
no Simples Nacional ou que possuam atividade vigente vinculada aos itens
de serviço 01.03, 01.05, 01.09 ou 16.01.

Para realizar a emissão, utilize o Novo emissor ajustado ao padrão nacional.
```

Com base nisso foi implementado o envio para:

```text
modelo = NACIONAL
Focus:
POST /v2/nfsen
```

A implementação conseguiu gerar corretamente uma DPS com os novos campos.

Porém a tentativa real mais recente também foi rejeitada.

---

# 2. ÚLTIMA TENTATIVA REAL

No Supabase da Demir existe a NFS-e:

```text
id: 139
OS: 525
referencia: OS_525_SRVS_12-15_1790948910014
modelo_emissao: NACIONAL
valor: 3609.04
status: REJEITADA
```

Retorno:

```text
E0039

O município emissor informado na DPS deve estar parametrizado
para utilizar os emissores públicos nacionais, conforme
parametrização do município no Sistema Nacional NFS-e.
```

O payload enviado foi aproximadamente:

```json
{
  "codigo_municipio_emissora": 2507507,
  "codigo_municipio_prestacao": "2507507",
  "cnpj_prestador": "12260723000109",
  "inscricao_municipal_prestador": "1094653",
  "codigo_opcao_simples_nacional": 1,
  "codigo_tributacao_nacional_iss": "140101",
  "codigo_nbs": "120013110",
  "tributacao_iss": 1,
  "tipo_retencao_iss": 1,
  "finalidade_emissao": 0,
  "consumidor_final": 0,
  "indicador_destinatario": 0,
  "codigo_indicador_operacao": "050101",
  "ibs_cbs_situacao_tributaria": "000",
  "ibs_cbs_classificacao_tributaria": "000001",
  "percentual_aliquota_relativa_municipio": 5
}
```

Portanto:

## O payload fiscal não foi a causa imediata da rejeição.

O erro ocorreu porque João Pessoa não está habilitada para utilizar o Emissor Público Nacional através do endpoint da Focus `/v2/nfsen`.

---

# 3. CONCLUSÃO TÉCNICA IMPORTANTE

Existem dois conceitos diferentes:

```text
Padrão Nacional de NFS-e / DPS
```

e:

```text
Emissor Público Nacional
```

João Pessoa passou a exigir um novo emissor ajustado ao padrão nacional. Isso NÃO necessariamente significa o Emissor Público Nacional federal.

O comunicado municipal disponibilizado anteriormente indica inclusive um novo endpoint DSF:

```text
https://nfse2-jpa.dsfweb.com.br/notafiscal-adn-ws/api/adn/dps
```

Portanto o cenário provável é:

```text
João Pessoa
↓
Novo emissor municipal DSF
↓
DPS / leiaute compatível com Padrão Nacional
```

e NÃO:

```text
João Pessoa
↓
Emissor Público Nacional
↓
/v2/nfsen
```

---

# 4. NÃO FAÇA OUTRA TENTATIVA EM /v2/nfsen

Neste momento NÃO repetir:

```text
POST /v2/nfsen
```

para João Pessoa/CRT3/item 14.01.

A última tentativa comprovou que isso retorna E0039.

Antes de qualquer nova emissão real:

1. investigar oficialmente o suporte da Focus ao novo emissor de João Pessoa;
2. identificar o transport correto;
3. validar em homologação;
4. somente então permitir produção.

---

# 5. INVESTIGAÇÃO OBRIGATÓRIA ANTES DE CODIFICAR O TRANSPORT

Pesquise a documentação ATUAL da Focus NFe e do novo emissor de João Pessoa.

Descubra especificamente:

## Pergunta A

A Focus já suporta o novo emissor municipal de João Pessoa baseado em DPS?

## Pergunta B

Se suporta, qual endpoint deve ser usado?

Possibilidades incluem `/v2/nfse` com novo backend/provedor municipal ou alguma integração específica ainda não presente no ERP.

NÃO assumir que `/v2/nfsen` é o correto.

## Pergunta C

A Focus exige algum campo específico para selecionar DSF novo, ADN, DPS ou João Pessoa novo emissor?

## Pergunta D

Se a Focus AINDA NÃO oferecer suporte, investigar integração direta com:

```text
https://nfse2-jpa.dsfweb.com.br/notafiscal-adn-ws/api/adn/dps
```

e documentação correspondente.

Não implemente integração direta sem primeiro confirmar:

- autenticação;
- certificado;
- formato da DPS;
- XML/XSD;
- assinatura;
- endpoints de produção e homologação;
- consulta;
- cancelamento;
- substituição;
- códigos de resposta;
- idempotência;
- identificação/numeração da DPS.

---

# 6. PROBLEMA DE MODELAGEM ATUAL

Hoje o ERP usa:

```ts
type NFSeModeloEmissao =
  | "NACIONAL"
  | "MUNICIPAL_CABEDELO"
  | "MUNICIPAL_JOAO_PESSOA";
```

Essa abstração ficou insuficiente.

Ela mistura layout fiscal com autorizador/transport.

Hoje `NACIONAL` significa ao mesmo tempo:

```text
layout DPS Nacional
+
Focus /v2/nfsen
+
Emissor Público Nacional
```

Isso não funciona para João Pessoa.

---

# 7. REFATORAÇÃO OBRIGATÓRIA

Separar pelo menos modelo/layout de autorizador/transport.

Sugestão conceitual:

```ts
type LayoutNFSe =
  | "MUNICIPAL_LEGADO"
  | "DPS_NACIONAL";

type AutorizadorNFSe =
  | "FOCUS_MUNICIPAL"
  | "FOCUS_NACIONAL"
  | "JOAO_PESSOA_DSF_DPS";
```

A política poderia retornar algo equivalente a:

```ts
{
  layout: "DPS_NACIONAL",
  autorizador: "JOAO_PESSOA_DSF_DPS",
  exigeRtc: true,
  regra: "JOAO_PESSOA_DPS_2026",
  motivo: "Novo emissor municipal de João Pessoa ajustado ao padrão nacional"
}
```

O nome exato pode ser diferente.

O importante é NÃO continuar assumindo:

```ts
layout === "DPS_NACIONAL"
```

implica:

```ts
endpoint === "/v2/nfsen"
```

---

# 8. COMPATIBILIDADE

Manter funcionando:

## João Pessoa antigo

```text
MUNICIPAL_JOAO_PESSOA
→ emissor legado
→ Focus /v2/nfse
```

para histórico, consulta, cancelamento, exceções temporárias e documentos antigos.

## Emissor Público Nacional verdadeiro

Continuar usando `/v2/nfsen` quando o município/contribuinte realmente estiver habilitado para o Emissor Público Nacional.

## João Pessoa novo

Criar um terceiro transport lógico:

```text
JOAO_PESSOA_DPS
```

ou equivalente.

---

# 9. NÃO DESCARTAR O TRABALHO JÁ IMPLEMENTADO

Preservar:

- `resolverPoliticaNFSe`;
- regras por data;
- regras por item de serviço;
- regras por CRT;
- `contexto-emissao`;
- recálculo após seleção dos serviços;
- coexistência de padrões fiscais;
- `padroes_emissao.NACIONAL`;
- carregamento de padrão;
- tratamento de padrão ausente;
- `codigo_opcao_simples_nacional` conforme CRT;
- RTC separado do modelo;
- `cTribNac`;
- NBS;
- `cIndOp`;
- CST IBS/CBS;
- `cClassTrib`;
- histórico municipal;
- consulta/cancelamento por modelo histórico.

A correção desta etapa deve ser incremental.

---

# 10. PADRÃO FISCAL DA DEMIR

O banco já possui:

```json
{
  "NACIONAL": {
    "codigoNbs": "120013110",
    "aliquotaIss": "5",
    "tributacaoIss": "1",
    "consumidorFinal": "0",
    "tipoRetencaoIss": "1",
    "finalidadeEmissao": "0",
    "indicadorDestinatario": "0",
    "codigoIndicadorOperacao": "050101",
    "ibsCbsSituacaoTributaria": "000",
    "regimeEspecialTributacao": "0",
    "codigoTributacaoNacionalIss": "140101",
    "ibsCbsClassificacaoTributaria": "000001"
  },
  "MUNICIPAL_JOAO_PESSOA": {
    "issRetido": "false",
    "codigoCnae": "452000100",
    "aliquotaIss": "5",
    "itemListaServico": "14.01",
    "naturezaOperacao": "1"
  }
}
```

Não apagar nem sobrescrever esses perfis.

Pode ser necessário renomear conceitualmente o padrão `NACIONAL` futuramente para algo como `DPS_NACIONAL`, mas faça isso somente se conseguir manter compatibilidade com os dados existentes.

Evite migrations destrutivas.

---

# 11. DETECTAR E0039

Adicionar tratamento específico para:

```text
E0039
```

e/ou mensagem:

```text
O município emissor informado na DPS deve estar parametrizado
para utilizar os emissores públicos nacionais
```

Não tratar como erro fiscal dos códigos.

Mensagem amigável:

```text
João Pessoa não está habilitada para emissão através do Emissor Público Nacional.
Esta operação deve utilizar o novo emissor municipal compatível com a DPS.
```

Preservar também a mensagem original.

---

# 12. OBSERVABILIDADE

A nota 139 mostrou outro problema.

Hoje `retorno_bruto` acabou contendo principalmente a consulta GET posterior e `tentativas` está vazio.

Corrigir para registrar cada interação externa em `tentativas`.

Exemplo:

```json
[
  {
    "tipo": "EMISSAO",
    "metodo": "POST",
    "url": "...",
    "payload": {},
    "http_status": 202,
    "resposta": {},
    "timestamp": "..."
  },
  {
    "tipo": "CONSULTA",
    "metodo": "GET",
    "url": "...",
    "http_status": 200,
    "resposta": {},
    "timestamp": "..."
  }
]
```

Nunca apagar a tentativa anterior ao consultar novamente.

`retorno_bruto` pode continuar representando o retorno mais recente, mas `tentativas` deve preservar o histórico completo.

NÃO registrar token/API key.

---

# 13. IMPLEMENTAR TRANSPORT ABSTRATO

Criar uma abstração de transport.

Exemplo conceitual:

```ts
interface NFSeTransport {
  emitir(...): Promise<ResultadoNFSe>;
  consultar(...): Promise<ResultadoNFSe>;
  cancelar(...): Promise<ResultadoNFSe>;
}
```

Implementações possíveis:

```text
FocusMunicipalTransport
FocusNacionalTransport
JoaoPessoaDpsTransport
```

A política fiscal decide qual transport usar.

O mapper decide qual layout/payload gerar.

Esses dois conceitos não devem ficar acoplados.

---

# 14. DECISÃO SOBRE FOCUS x DSF DIRETO

## Se a Focus suportar oficialmente o novo João Pessoa

Preferir continuar utilizando a Focus.

Motivos:

- autenticação já existente;
- observabilidade;
- polling;
- consulta;
- cancelamento;
- menos manutenção fiscal;
- menos manipulação direta de certificados/XML.

Implementar o transport adequado segundo a documentação real da Focus.

## Se a Focus NÃO suportar

Criar `JoaoPessoaDpsTransport`.

Mas somente depois de validar documentação oficial.

Não implementar XML/DPS baseado em adivinhação.

---

# 15. TESTES

Criar teste reproduzindo exatamente a tentativa 139.

## Caso 1 — não usar Emissor Público Nacional

Entrada:

```text
João Pessoa
CRT 3
14.01
02/10/2026
```

Esperado:

```text
layout = DPS_NACIONAL
```

Mas NÃO necessariamente:

```text
autorizador = FOCUS_NACIONAL
```

O teste deve garantir que João Pessoa não seja automaticamente enviada ao `/v2/nfsen`.

## Caso 2 — município realmente habilitado no Nacional

Para um município/configuração realmente suportado:

```text
layout = DPS_NACIONAL
autorizador = FOCUS_NACIONAL
```

Esperado:

```text
/v2/nfsen
```

## Caso 3 — João Pessoa legado

Nota histórica:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

Esperado:

```text
consulta/cancelamento
→ transport municipal antigo
```

## Caso 4 — E0039

Simular:

```json
{
  "codigo": "E0039",
  "mensagem": "O município emissor informado na DPS..."
}
```

Esperado:

- status `REJEITADA`;
- erro original salvo;
- mensagem amigável;
- nenhuma tentativa automática repetindo `/v2/nfsen`.

## Caso 5 — observabilidade

Simular:

```text
POST
GET
GET
```

Esperado:

```text
tentativas.length = 3
```

em ordem cronológica.

---

# 16. AUDITAR A NOTA 139

Use a nota:

```text
nfse.id = 139
```

como fixture de diagnóstico.

Compare:

```text
payload_enviado
erros
retorno_bruto
tentativas
```

Não alterar o registro.
Não reenviar automaticamente.

---

# 17. ARQUIVOS PRINCIPAIS

Revisar principalmente:

```text
src/lib/services/fiscais/nfse-politica.ts
src/lib/services/fiscais/nfse-service.ts
src/lib/fiscal/padroesEmissaoNfse.ts
src/app/api/nfse/de-os/[id]/route.ts
src/app/api/nfse/contexto-emissao/[id]/route.ts
src/app/api/nfse/servicos-de-os/[id]/route.ts
src/app/api/nfse/[id]/reemitir/route.ts
src/lib/services/fiscais/nfse-registro.ts
```

e qualquer código relacionado a:

```text
emitirNacional
/v2/nfsen
/v2/nfse
modelo_emissao
familiaDoModeloNFSe
resolverPoliticaNFSe
consultar
cancelar
tentativas
retorno_bruto
```

---

# 18. NÃO FAZER

Não:

- repetir emissão real da OS 525;
- continuar usando `/v2/nfsen` para João Pessoa sem comprovação;
- remover o suporte ao `/v2/nfsen`;
- assumir que padrão Nacional significa Emissor Público Nacional;
- alterar registros antigos;
- apagar a nota 139;
- alterar NF-e/NFC-e;
- inventar endpoint DSF;
- inventar autenticação;
- inventar XML;
- inventar códigos fiscais;
- colocar lógica exclusiva da Demir hardcoded;
- sobrescrever padrões fiscais;
- fazer merge em `main`.

---

# 19. RESULTADO ESPERADO

Ao final quero um relatório contendo:

1. causa exata do E0039;
2. documentação utilizada para identificar o transport correto;
3. confirmação se a Focus suporta ou não o novo emissor João Pessoa;
4. endpoint correto, se documentado;
5. arquitetura escolhida;
6. arquivos alterados;
7. separação implementada entre layout e autorizador;
8. transport utilizado por João Pessoa;
9. como ficaram emissão, consulta e cancelamento;
10. tratamento específico do E0039;
11. observabilidade com `tentativas`;
12. testes adicionados;
13. resultado dos testes;
14. resultado do typecheck;
15. resultado do lint;
16. resultado do build;
17. payload SIMULADO para a OS 525;
18. destino/endpoint que seria utilizado;
19. confirmação de que nenhuma emissão real foi executada.

IMPORTANTE:

Pare antes da primeira emissão real.

Quero revisar:

```text
transport
endpoint
payload/XML
```

antes de liberar produção.
