# Prompt de Implementação — Migração NFS-e João Pessoa para Padrão Nacional

Você vai executar uma atualização fiscal crítica no projeto `erpoficina`.

Use:
- GitHub: repositório `figodevtech/erpoficina`
- Branch de trabalho: `develop`
- Supabase: projeto `Demir Diesel`

## IMPORTANTE

Antes de alterar qualquer código:

1. Analise o fluxo completo atual de emissão de NFS-e.
2. Consulte no Supabase o histórico real da tabela `nfse`, `empresa`, `nfse_config`, `servico` e `osservico`.
3. Preserve compatibilidade com notas antigas.
4. Não invente códigos fiscais, NBS, CST, cClassTrib ou cIndOp.
5. Se algum código fiscal obrigatório não puder ser determinado com segurança, deixe o sistema exigir configuração explícita em vez de assumir um valor.
6. Não altere NF-e/NFC-e.
7. Não faça alterações destrutivas em dados fiscais já emitidos.
8. Execute testes antes de considerar concluído.

---

# CONTEXTO REAL DO PROBLEMA

A Demir Diesel está em João Pessoa:

- Município IBGE: `2507507`
- Regime tributário atual: `CRT 3 / Regime Normal`
- Serviço usado nas emissões: item da lista `14.01`
- O fluxo antigo usa `MUNICIPAL_JOAO_PESSOA`
- Provedor: Focus NFe
- Até 30/09/2026 as notas eram autorizadas normalmente por `/v2/nfse`

No dia 02/10/2026 a emissão da OS 525 foi rejeitada.

Referência:

`OS_525_SRVS_12-15_1790941465587`

Erro:

```text
L999
O Emissor atual está disponível somente para contribuintes enquadrados
no Simples Nacional ou que possuam atividade vigente vinculada aos itens
de serviço 01.03, 01.05, 01.09 ou 16.01.

Para realizar a emissão, utilize o Novo emissor ajustado ao padrão nacional.
```

No Supabase é possível confirmar:

### 30/09/2026

- emissões `MUNICIPAL_JOAO_PESSOA`
- item `14.01`
- CRT 3
- autorizadas normalmente

### 02/10/2026

- mesma estrutura
- item `14.01`
- CRT 3
- `MUNICIPAL_JOAO_PESSOA`
- rejeitada pelo L999 acima

Portanto esta não é apenas uma ausência de campo no emissor antigo.

Para a Demir / item 14.01 / Regime Normal, o fluxo deve passar para o novo emissor ajustado ao padrão Nacional.

O ERP já possui suporte parcial para isso através de:

`NFSeService.emitirNacional()`

que chama:

`POST /v2/nfsen`

---

# PROBLEMA ARQUITETURAL ATUAL

Hoje existe lógica semelhante a:

```ts
if (String(empresa?.regimetributario ?? "") === "4")
  return "NACIONAL";

if (codigoMunicipio === "2503209")
  return "MUNICIPAL_CABEDELO";

if (codigoMunicipio === "2507507")
  return "MUNICIPAL_JOAO_PESSOA";
```

Isso não é mais suficiente.

Não substituir simplesmente por:

```ts
if (municipio === "2507507")
  return "NACIONAL";
```

porque existem regras de transição por:

- município
- data/competência
- regime tributário
- item de serviço

O próprio retorno de João Pessoa informa exceções do emissor antigo:

- `01.03`
- `01.05`
- `01.09`
- `16.01`

Portanto crie uma política fiscal centralizada.

---

# IMPLEMENTAÇÃO DESEJADA

## 1. Criar resolver de política da NFS-e

Criar algo equivalente a:

```ts
resolverPoliticaNFSe({
  codigoMunicipio,
  regimeTributario,
  dataCompetencia,
  itemListaServico
})
```

Não precisa usar exatamente esse nome, mas a regra deve ficar centralizada.

Retorno sugerido:

```ts
type PoliticaNFSe = {
  modelo: NFSeModeloEmissao;
  exigeRtc: boolean;
  usaDps: boolean;
  motivo: string;
};
```

Pode acrescentar outros campos se fizer sentido.

A data deve ser explícita e testável.

Não espalhar `new Date()` e comparações de datas em componentes diferentes.

---

## 2. Regra João Pessoa a partir de 01/10/2026

Para João Pessoa (`2507507`):

A partir de `01/10/2026`, operações que não estejam nas exceções do emissor legado devem seguir o novo padrão Nacional.

No caso atual da Demir:

```text
Município = 2507507
CRT = 3
Item = 14.01
Competência >= 2026-10-01
```

Resultado:

```text
modelo = NACIONAL
usaDps = true
```

Os itens:

```text
01.03
01.05
01.09
16.01
```

devem ser tratados como exceções de transição conforme a regra vigente.

Não hardcode uma interpretação além do necessário.

Deixe a regra isolada e documentada para ser facilmente removida quando João Pessoa concluir a migração.

---

## 3. Não confundir modelo Nacional com MEI

Hoje existem vários pontos que tratam:

```text
NACIONAL = MEI
```

Isso deve acabar.

Remover textos como:

`NFS-e Nacional (MEI)`

e:

`NFS-e Nacional · MEI`

Substituir por:

`NFS-e Nacional`

O regime tributário deve ser tratado separadamente.

---

## 4. Corrigir NFSeNacionalEmitirParams

Hoje existe algo incorreto como:

```ts
codigo_opcao_simples_nacional: 2;
```

fixo.

Isso precisa deixar de ser literal.

Resolver conforme o regime tributário da empresa.

Exemplo conceitual:

```text
CRT 3 / Regime Normal
→ não pode ser enviado como MEI

CRT 4
→ MEI

CRT 1 / CRT 2
→ Simples Nacional ME/EPP conforme regras próprias
```

Revisar na documentação atual da Focus os valores corretos de:

- `codigo_opcao_simples_nacional`
- `regime_tributario_simples_nacional`
- `regime_especial_tributacao`

antes de implementar.

Não inventar código.

---

## 5. Revisar `mapearOSParaFocusNacional()`

A Demir passará a utilizar esse mapper.

Auditar integralmente o payload do endpoint:

`POST /v2/nfsen`

Verificar pelo menos:

- `data_competencia`
- `codigo_municipio_emissora`
- `cnpj_prestador`
- `inscricao_municipal_prestador`
- `codigo_opcao_simples_nacional`
- `regime_tributario_simples_nacional`
- `regime_especial_tributacao`
- dados do tomador
- `codigo_municipio_prestacao`
- `codigo_tributacao_nacional_iss`
- `codigo_tributacao_municipal_iss`
- `codigo_nbs`
- `descricao_servico`
- `valor_servico`
- `tributacao_iss`
- `tipo_retencao_iss`
- `percentual_aliquota_relativa_municipio`
- `finalidade_emissao`
- `consumidor_final`
- `indicador_destinatario`
- `codigo_indicador_operacao`
- `ibs_cbs_situacao_tributaria`
- `ibs_cbs_classificacao_tributaria`

Também conferir na documentação atual da Focus se precisam ser suportados:

- `serie_dps`
- `numero_dps`
- `emitente_dps`

Não implementar automaticamente esses campos sem confirmar o contrato atual da API.

---

## 6. Não tornar IBS/CBS sinônimo de NACIONAL

Hoje partes do código fazem:

```ts
if (modelo === "NACIONAL") {
   exigir CST;
   exigir cClassTrib;
   ...
}
```

Refatorar.

Deve existir diferença entre:

```text
modeloEmissao
regimeTributario
rtcObrigatorio
```

A obrigatoriedade dos dados RTC deve vir da política fiscal.

Isso também é necessário para suportar corretamente as próximas viradas do Simples Nacional.

---

## 7. Preparar as próximas datas

A arquitetura deve suportar sem nova refatoração grande:

### 01/11/2026

Empresas ME/EPP do Simples que precisarem utilizar o padrão Nacional.

Não pressupor:

`NACIONAL = IBS/CBS obrigatório`.

### 01/01/2027

Aplicação das regras RTC correspondentes ao Simples Nacional.

Criar testes de política para essas datas, mas antes de consolidar os valores fiscais verificar as regras/documentação oficial vigente.

---

## 8. Configuração fiscal da Demir

Hoje o Supabase possui somente algo semelhante a:

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

Precisamos permitir configurar:

```text
padroes_emissao.NACIONAL
```

para empresa de João Pessoa que tenha migrado.

Não copie cegamente os valores municipais para os campos nacionais.

A interface deve permitir configurar corretamente:

- Código de Tributação Nacional
- Código municipal, quando aplicável
- NBS
- tributação ISS
- retenção ISS
- alíquota
- finalidade
- consumidor final
- destinatário
- cIndOp
- CST IBS/CBS
- cClassTrib

Não preencher automaticamente NBS/cIndOp/CST/cClassTrib sem fonte válida.

---

## 9. Serviço 14.01 da Demir

A OS 525 possui:

- TESTE COMPUTADORIZADO
- MÃO DE OBRA PARTE ELÉTRICA

Os dois serviços estão cadastrados com item:

`14.01`

e código de serviço municipal relacionado ao CNAE atual.

Usar esse caso como cenário de teste.

Não alterar o cadastro desses serviços automaticamente sem necessidade.

---

## 10. Tratamento do L999 de migração

Adicionar detecção específica da mensagem:

`Para realizar a emissão, utilize o Novo emissor ajustado ao padrão nacional`

Quando recebida:

- não fazer retry automático infinito;
- não tratar simplesmente como erro genérico L999;
- informar claramente que o modelo de emissão utilizado está desatualizado;
- registrar erro completo em `erros`, `retorno_bruto` e `tentativas`, mantendo a observabilidade atual.

Exemplo de mensagem amigável:

`João Pessoa exige o novo emissor no padrão Nacional para esta operação.`

Mas não esconda o retorno original da Focus.

---

## 11. Compatibilidade com histórico

Notas antigas precisam continuar mostrando:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

e continuar permitindo:

- visualização
- download de PDF
- download XML
- consulta
- histórico
- cancelamento quando permitido

Não migrar registros históricos para `NACIONAL`.

`modelo_emissao` é parte do snapshot fiscal da emissão.

---

## 12. Consulta e cancelamento

Garantir que:

```text
NACIONAL
→ /v2/nfsen/{referencia}
```

e:

```text
MUNICIPAL
→ /v2/nfse/{referencia}
```

continuem corretos.

Auditar:

- emitir
- consultar
- cancelar
- reemitir

Especialmente:

`src/app/api/nfse/[id]/reemitir/route.ts`

Uma nota que nasceu como Nacional deve ser reenviada como Nacional.

Uma nota antiga municipal não deve mudar automaticamente de modelo ao reemitir sem uma decisão explícita e segura.

---

## 13. Arquivos que obrigatoriamente devem ser revisados

Comece por:

`src/lib/services/fiscais/nfse-service.ts`

`src/app/api/nfse/de-os/[id]/route.ts`

`src/app/api/nfse/servicos-de-os/[id]/route.ts`

`src/app/api/nfse/[id]/reemitir/route.ts`

`src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/emissao-nfse-dialog.tsx`

`src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/nfse-fiscal-form.tsx`

`src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types.ts`

`src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx`

`src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog.tsx`

`src/app/api/config/nfse/route.ts`

e os testes relacionados à NFS-e.

Procure outras referências a:

- `MUNICIPAL_JOAO_PESSOA`
- `NACIONAL`
- `MEI`
- `codigo_opcao_simples_nacional`
- `regime_tributario_simples_nacional`
- `modelo_emissao`
- `identificarModeloEmissao`

Não dependa somente dessa lista.

---

## 14. Testes obrigatórios

Adicionar testes unitários da política.

No mínimo:

### Caso A

```text
João Pessoa
CRT 3
14.01
30/09/2026
```

Esperado:

`MUNICIPAL_JOAO_PESSOA`

### Caso B

```text
João Pessoa
CRT 3
14.01
01/10/2026
```

Esperado:

`NACIONAL`

### Caso C

```text
João Pessoa
CRT 3
14.01
02/10/2026
```

Esperado:

`NACIONAL`

### Caso D

Testar as exceções de transição:

```text
01.03
01.05
01.09
16.01
```

conforme regra vigente.

### Caso E

CRT 4 continua funcionando no Nacional.

### Caso F

Empresa CRT 3 nunca pode gerar payload Nacional marcando-a como MEI.

### Caso G

Notas antigas `MUNICIPAL_JOAO_PESSOA` continuam consultáveis.

### Caso H

OS 525 deve chegar ao mapper Nacional.

Não executar emissão real em produção durante testes automatizados.

---

## 15. Homologação

Depois da implementação:

1. Execute lint.
2. Execute typecheck.
3. Execute testes NFS-e.
4. Execute build.
5. Verifique migrations pendentes.
6. Não altere produção ainda.
7. Monte o payload que seria enviado para a OS 525.
8. Apresente esse payload sanitizado para revisão.
9. Compare com a documentação atual da Focus para `/v2/nfsen`.
10. Informe qualquer campo fiscal ainda sem configuração.

Somente depois disso considerar emissão em homologação.

---

# RESTRIÇÕES

Não:

- alterar NF-e/NFC-e;
- mudar registros históricos;
- criar NBS fictício;
- criar cIndOp fictício;
- criar CST/cClassTrib fictício;
- colocar valores fiscais da Demir hardcoded no código;
- assumir que `NACIONAL = MEI`;
- assumir que `NACIONAL = IBS/CBS obrigatório`;
- mandar todas as atividades de João Pessoa para o Nacional ignorando as exceções;
- remover o fluxo municipal antigo, pois ele é necessário para histórico e transição;
- alterar o schema desnecessariamente;
- executar SQL destrutivo;
- emitir nota real em produção como teste.

---

# RESULTADO ESPERADO

Ao final, quero:

1. Lista dos arquivos alterados.
2. Explicação resumida da nova política.
3. Diff das principais regras.
4. Testes criados.
5. Resultado de lint/typecheck/test/build.
6. Payload Nacional simulado para a OS 525.
7. Lista de campos fiscais que ainda precisam ser configurados pela empresa.
8. Qualquer ponto da documentação Focus/João Pessoa que ainda esteja ambíguo.
9. Confirmação de que nenhuma emissão antiga foi modificada.
10. Confirmação de que a Demir, CRT 3 + item 14.01 após 01/10/2026, deixa de chamar `/v2/nfse` e passa a chamar `/v2/nfsen`.

Faça a implementação completa na `develop`, mas NÃO faça merge em `main` e NÃO execute emissão fiscal real em produção sem aprovação.
