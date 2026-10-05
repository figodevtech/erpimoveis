# Missão — Correção final da NFS-e de João Pessoa na `feature/nfsjp`

Você está entrando neste projeto agora e **não deve assumir contexto prévio**. Leia este documento inteiro, inspecione o repositório e valide o estado atual antes de alterar qualquer coisa.

## Projeto

- Repositório GitHub: `figodevtech/erpoficina`
- Branch de trabalho: `feature/nfsjp`
- Base principal de comparação: `develop`
- Banco usado para validar o caso real: Supabase da **Demir Diesel**
- Stack fiscal NFS-e: Focus NFe + regras próprias do ERP

## Regra de segurança

**Não faça merge em `main`.**
**Não faça nova emissão real em produção durante a implementação.**
**Não altere registros fiscais históricos.**
**Não faça integração direta com a DSF de João Pessoa.**
**Não habilite “Ambiente da NFSe Nacional” na Focus.**

Antes de alterar o código:

1. confira o HEAD atual de `feature/nfsjp`;
2. compare com `develop`;
3. leia o fluxo completo de NFS-e;
4. procure todas as referências a João Pessoa, `NACIONAL`, `/v2/nfsen`, `E0039`, `JOAO_PESSOA_DSF_DPS`, `FOCUS_NACIONAL`, `MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO` e `JOAO_PESSOA_ENVIA_PELA_FOCUS_NACIONAL`;
5. verifique o estado atual dos testes;
6. valide no Supabase apenas por leitura o histórico real da Demir.

---

# 1. Contexto real

A Demir Diesel é emitente de João Pessoa/PB:

```text
Município IBGE: 2507507
Regime tributário: CRT 3 / Regime Normal
Inscrição Municipal: 1094653
Ambiente: PRODUCAO
Item LC 116 usado no caso real: 14.01
```

Até 30/09/2026, a emissão municipal antiga funcionava via:

```text
Focus
POST /v2/nfse
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

Em 02/10/2026, uma emissão da OS 525 foi rejeitada no emissor antigo com:

```text
L999

O Emissor atual está disponível somente para contribuintes enquadrados
no Simples Nacional ou que possuam atividade vigente vinculada aos itens
de serviço 01.03, 01.05, 01.09 ou 16.01.

Para realizar a emissão, utilize o Novo emissor ajustado ao padrão nacional.
```

Depois disso o ERP foi adaptado para gerar DPS no layout nacional e enviar por:

```text
POST /v2/nfsen
```

Uma tentativa posterior voltou com:

```text
E0039

O município emissor informado na DPS deve estar parametrizado
para utilizar os emissores públicos nacionais, conforme
parametrização do município no Sistema Nacional NFS-e.
```

Esse erro foi usado temporariamente como evidência de que João Pessoa não poderia utilizar `/v2/nfsen`.

Essa interpretação agora está **superada**.

---

# 2. Informação nova e oficial da Focus

A Focus respondeu em ticket:

> João Pessoa/PB passou por reimplementação.

E orientou explicitamente:

```text
- Este município utiliza o formato nacional da NFSe,
  mas não opera no Ambiente Nacional.

- Para emitir NFSe neste município,
  utilize o layout nacional e o endpoint v2/nfsen.

- Não habilite a opção "Ambiente da NFSe Nacional" no painel da API.

- A emissão deve ser feita pela API padrão de NFSe,
  mantendo apenas essa opção ativa no painel.
```

A documentação específica de João Pessoa foi atualizada:

```text
https://focusnfe.com.br/guides/nfse/municipios-integrados/joao-pessoa-pb/
```

A documentação geral do ambiente nacional também deve ser consultada:

```text
https://focusnfe.com.br/guides/nfse/municipios-integrados/municipios-da-nfse-nacional/#mei-e-simples-nacional
```

## Conclusão obrigatória

Para João Pessoa, após a reimplementação da Focus:

```text
Layout: DPS / formato nacional
Endpoint Focus: /v2/nfsen
Ambiente da NFSe Nacional no painel: DESABILITADO
NFSe padrão no painel: HABILITADO
Autorização efetiva: ambiente próprio municipal / DSF
```

Portanto:

```text
Formato Nacional ≠ Ambiente Nacional
```

O ERP precisa representar essa diferença corretamente.

---

# 3. Estado conhecido da branch antes desta correção

No último estado analisado da `feature/nfsjp`, existia uma estrutura semelhante a:

```ts
type AutorizadorNFSe =
  | "FOCUS_MUNICIPAL"
  | "FOCUS_NACIONAL"
  | "JOAO_PESSOA_DSF_DPS";
```

E havia um transport indisponível:

```ts
class JoaoPessoaDpsTransport implements NFSeTransport {
  readonly autorizador = "JOAO_PESSOA_DSF_DPS";
  readonly modeloEmissao = "DPS_JOAO_PESSOA";
  readonly disponivel = false;
}
```

Também havia:

```ts
export const JOAO_PESSOA_ENVIA_PELA_FOCUS_NACIONAL = true;
```

fazendo João Pessoa cair temporariamente em:

```ts
new FocusNacionalTransport(service)
```

que usa:

```text
POST /v2/nfsen
GET /v2/nfsen/{ref}
DELETE /v2/nfsen/{ref}
```

Essa solução funcional temporária deve ser **limpa e formalizada**.

Não mantenha comentários dizendo que:

```text
"a Focus não suporta João Pessoa"
```

ou:

```text
"integração indisponível"
```

porque isso ficou obsoleto após a resposta do ticket.

---

# 4. Objetivo da correção

Formalizar no ERP o cenário:

```text
JOÃO PESSOA
+
LAYOUT NACIONAL
+
FOCUS /v2/nfsen
+
AMBIENTE MUNICIPAL PRÓPRIO
```

sem confundir isso com:

```text
EMISSOR PÚBLICO NACIONAL
```

---

# 5. Modelagem recomendada

A política deve continuar separando:

```text
layout
autorizador/transport
```

Não volte a acoplar tudo em `NACIONAL`.

Uma opção recomendada:

```ts
type AutorizadorNFSe =
  | "FOCUS_MUNICIPAL"
  | "FOCUS_NACIONAL"
  | "FOCUS_FORMATO_NACIONAL_MUNICIPAL";
```

Para João Pessoa CRT 3 / item 14.01 / após a migração:

```ts
{
  modelo: "NACIONAL",
  layout: "DPS_NACIONAL",
  autorizador: "FOCUS_FORMATO_NACIONAL_MUNICIPAL",
  usaDps: true,
  exigeRtc: true,
  regra: "JOAO_PESSOA_FORMATO_NACIONAL_2026",
  motivo: "João Pessoa utiliza formato nacional via Focus em ambiente municipal próprio."
}
```

O nome exato pode variar, desde que a semântica fique clara.

---

# 6. Transport correto para João Pessoa

Criar ou adaptar um transport específico para o cenário:

```text
FOCUS_FORMATO_NACIONAL_MUNICIPAL
```

Ele deve usar a infraestrutura já existente da Focus Nacional:

```ts
emitir(...) {
  return service.emitirNacional(...);
}

consultar(ref) {
  return service.consultar(ref, "NACIONAL");
}

cancelar(ref, justificativa) {
  return service.cancelar(ref, justificativa, "NACIONAL");
}
```

Ou seja, deve chamar:

```text
POST   /v2/nfsen
GET    /v2/nfsen/{ref}
DELETE /v2/nfsen/{ref}
```

Mas **não deve ser semanticamente tratado como Emissor Público Nacional**.

---

# 7. Remover o transport obsoleto de João Pessoa

Revisar se ainda faz sentido manter:

```text
JoaoPessoaDpsTransport
MOTIVO_JOAO_PESSOA_SEM_INTEGRACAO
NFSeTransporteIndisponivelError
JOAO_PESSOA_ENVIA_PELA_FOCUS_NACIONAL
```

Se esses elementos só existem para o bloqueio temporário anterior, remova-os ou simplifique-os.

Não deixe feature flag temporária hardcoded como solução final.

Não mantenha mensagens dizendo:

```text
"Focus não suporta"
"sem integração"
"emita pelo portal da prefeitura"
```

---

# 8. E0039 agora é histórico, não regra permanente

O E0039 aconteceu antes da reimplementação confirmada pela Focus.

Portanto:

```text
E0039
```

deve continuar:

- reconhecido no histórico;
- registrado em `erros`;
- preservado em `tentativas`;
- mostrado em notas antigas;
- útil para diagnóstico.

Mas NÃO deve mais ser usado para concluir automaticamente que:

```text
João Pessoa não pode usar /v2/nfsen
```

ou bloquear novas emissões corretas.

Revisar especialmente:

```text
motivoParaNaoReenviar()
detectarMunicipioForaDoEmissorNacional()
reenvioExigeNovoModelo()
```

## Nota 139

A nota histórica 139 da Demir deve permanecer intacta.

Ela pode continuar sendo tratada como uma tentativa histórica rejeitada.

Não altere seu registro.

Se o reenvio exato da nota antiga ainda for bloqueado por segurança, isso é aceitável, desde que uma **nova emissão pela tela atual** possa usar a configuração reimplementada da Focus.

---

# 9. Atualizar mensagens de UI

Remover ou alterar textos como:

```text
João Pessoa · DPS nacional (sem integração)
```

ou:

```text
João Pessoa adotou a DPS do padrão nacional no emissor próprio da prefeitura,
que ainda não tem integração no ERP nem na Focus NFe.
```

Substituir por algo correto, por exemplo:

```text
João Pessoa · Formato Nacional via Focus
```

ou:

```text
João Pessoa utiliza NFS-e no formato nacional via Focus,
em ambiente municipal próprio.
```

Não usar “Emissor Público Nacional” para este cenário.

---

# 10. Payload nacional

O ERP já possui um mapper:

```ts
mapearOSParaFocusNacional(...)
```

Preserve-o.

Ele já deve suportar, no mínimo:

```text
codigo_municipio_emissora
cnpj_prestador
inscricao_municipal_prestador
codigo_opcao_simples_nacional
regime_tributario_simples_nacional
regime_especial_tributacao

dados do tomador

codigo_municipio_prestacao
codigo_tributacao_nacional_iss
codigo_tributacao_municipal_iss
codigo_nbs

descricao_servico
informacoes_complementares
valor_servico

tributacao_iss
tipo_retencao_iss
percentual_aliquota_relativa_municipio

finalidade_emissao
consumidor_final
indicador_destinatario
codigo_indicador_operacao
ibs_cbs_situacao_tributaria
ibs_cbs_classificacao_tributaria
```

Não refatore sem necessidade.

---

# 11. Campo novo a revisar: PIS/COFINS

Na documentação atualizada de João Pessoa, o exemplo de payload nacional inclui:

```json
"situacao_tributaria_pis_cofins": "00"
```

No estado anterior do ERP esse campo não estava modelado.

## Tarefa

Confirmar na documentação atual da Focus:

```text
- nome exato do campo;
- tipo;
- tamanho;
- obrigatoriedade;
- valores permitidos;
- comportamento para Regime Normal;
- comportamento para Simples/MEI.
```

Se aplicável ao novo João Pessoa, adicionar suporte completo:

```text
NFSeNacionalEmitirParams
NFSeCodigosFiscais
CodigosFiscaisForm
configuração padrão da NFS-e
API de config
formulário
validação
mapper
testes
```

Não hardcodar:

```text
"00"
```

apenas porque aparece no exemplo da Focus.

O valor deve ser configurável conforme regra fiscal aplicável à empresa.

---

# 12. Código de Tributação Municipal

O ERP já possui:

```text
codigo_tributacao_municipal_iss
```

e a documentação atualizada de João Pessoa mostra esse campo em exemplo.

Preserve-o.

Não hardcodar o valor do exemplo da Focus.

Exemplo:

```json
"codigo_tributacao_municipal_iss": "007"
```

não significa que `007` seja o código correto para a Demir.

O ERP deve:

- permitir configurar;
- enviar quando preenchido;
- validar somente se a documentação exigir;
- nunca reaproveitar automaticamente o código do emissor municipal antigo.

---

# 13. Padrão fiscal da Demir

No banco já existe configuração semelhante a:

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

Preservar ambos.

Não apagar o padrão municipal histórico.

Não migrar registros antigos.

---

# 14. Política de João Pessoa

Manter a lógica de transição já implementada.

Para João Pessoa (`2507507`), a política continua considerando:

```text
data
regime tributário
item de serviço
```

Os itens de exceção temporária do emissor municipal legado continuam:

```text
01.03
01.05
01.09
16.01
```

Não remover essa regra sem confirmação documental.

Para o caso da Demir:

```text
CRT 3
14.01
data >= 2026-10-01
```

esperado:

```text
modelo = NACIONAL
layout = DPS_NACIONAL
autorizador = FOCUS_FORMATO_NACIONAL_MUNICIPAL
endpoint = /v2/nfsen
```

---

# 15. Simples Nacional

Preservar a distinção atual entre:

```text
Regime Normal
Simples Nacional
MEI
```

Não assumir:

```text
NACIONAL = MEI
```

Não assumir:

```text
NACIONAL = Ambiente Nacional
```

O cenário de João Pessoa CRT 3 usa formato nacional em ambiente próprio.

Já MEI/Simples podem seguir regras próprias do Emissor Nacional conforme cronograma.

---

# 16. Consulta e cancelamento

Para uma nova nota de João Pessoa emitida após a reimplementação:

```text
modelo/layout = NACIONAL
transport = FOCUS_FORMATO_NACIONAL_MUNICIPAL
```

Consulta e cancelamento devem continuar usando:

```text
/v2/nfsen/{referencia}
```

Notas históricas municipais:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

devem continuar usando:

```text
/v2/nfse/{referencia}
```

Não alterar o histórico.

---

# 17. Registro `modelo_emissao`

Hoje existe uma possível ambiguidade:

```text
politica.modelo = NACIONAL
```

e o registro também usa:

```text
modelo_emissao = NACIONAL
```

Isso é aceitável se emissão, consulta e cancelamento conseguirem determinar corretamente a família `/v2/nfsen`.

Não crie migration apenas para renomear esse campo agora.

Se necessário, documente no código que:

```text
modelo_emissao = NACIONAL
```

significa família de endpoint/layout nacional, não necessariamente Emissor Público Nacional.

---

# 18. Observabilidade

Preservar todo o trabalho já feito em:

```text
tentativas
retorno_bruto
payload_enviado
erros
```

Cada interação externa deve continuar sendo registrada:

```text
EMISSAO
CONSULTA
REENVIO
CANCELAMENTO
```

Não registrar token da Focus.

---

# 19. Testes obrigatórios

Atualizar os testes antigos que ainda simulam E0039 como comportamento atual.

## Teste A — Demir após reimplementação

Entrada:

```text
João Pessoa
IBGE 2507507
CRT 3
item 14.01
data >= 2026-10-01
```

Esperado:

```text
layout = DPS_NACIONAL
autorizador = FOCUS_FORMATO_NACIONAL_MUNICIPAL
transport.disponivel = true
```

## Teste B — endpoint

A emissão deve gerar chamada:

```text
POST /v2/nfsen?ref=...
```

Não `/v2/nfse`.

## Teste C — autorização simulada

Simular:

```json
{
  "status": "processando_autorizacao"
}
```

e depois consulta com:

```json
{
  "status": "autorizado"
}
```

Esperado:

```text
PROCESSANDO → AUTORIZADA
```

sem E0039.

## Teste D — histórico E0039

A nota 139 histórica continua:

```text
REJEITADA
E0039
```

sem alteração.

## Teste E — municipal antigo

Nota antiga:

```text
modelo_emissao = MUNICIPAL_JOAO_PESSOA
```

continua consultando/cancelando por:

```text
/v2/nfse
```

## Teste F — novo João Pessoa

Nova emissão:

```text
modelo_emissao = NACIONAL
```

consulta/cancela por:

```text
/v2/nfsen
```

## Teste G — padrão fiscal

`padroes_emissao.NACIONAL` deve continuar sendo carregado para João Pessoa novo.

## Teste H — situação PIS/COFINS

Se a documentação confirmar o campo:

```text
situacao_tributaria_pis_cofins
```

testar:

- persistência no padrão;
- carregamento automático;
- envio no payload;
- validação;
- ausência de hardcode.

## Teste I — exceção municipal

```text
João Pessoa
CRT 3
item 01.03
durante a janela de exceção
```

deve continuar no emissor municipal legado conforme a política vigente.

---

# 20. Arquivos a revisar

No mínimo:

```text
src/lib/services/fiscais/nfse-politica.ts

src/lib/services/fiscais/nfse-transport.ts

src/lib/services/fiscais/nfse-service.ts

src/lib/services/fiscais/nfse-registro.ts

src/lib/services/fiscais/nfse-sync.ts

src/app/api/nfse/de-os/[id]/route.ts

src/app/api/nfse/contexto-emissao/[id]/route.ts

src/app/api/nfse/[id]/reemitir/route.ts

src/app/api/nfse/cancelar/[id]/route.ts

src/app/api/nfse/servicos-de-os/[id]/route.ts

src/app/api/config/nfse/route.ts

src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/

src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/emissao-nota-dialog.tsx

src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/components/padrao-nfse-fields.tsx

src/app/(app)/(pages)/configuracoes/fiscal-pagamentos/types.ts

src/services/fiscal/nfseTransporte.test.ts

src/lib/services/fiscais/nfse-politica.test.ts

src/lib/services/fiscais/nfse-service.test.ts
```

Procure outros arquivos afetados.

---

# 21. Não fazer

Não:

- criar integração direta com DSF;
- usar o endpoint municipal antigo `/v2/nfse` para o novo João Pessoa;
- habilitar Ambiente da NFSe Nacional;
- apagar suporte a `/v2/nfsen`;
- remover histórico E0039;
- alterar a nota 139;
- hardcodar `codigo_tributacao_municipal_iss`;
- hardcodar `situacao_tributaria_pis_cofins = "00"`;
- hardcodar dados da Demir;
- alterar NF-e/NFC-e;
- executar emissão real durante os testes;
- fazer merge em `main`.

---

# 22. Validação final

Ao terminar:

1. execute testes de NFS-e;
2. execute typecheck;
3. execute lint;
4. execute build;
5. verifique migrations pendentes;
6. confirme que a branch continua baseada na `develop`;
7. não faça emissão real.

---

# 23. Entrega esperada

Ao final, produza um relatório com:

1. HEAD analisado da `feature/nfsjp`;
2. arquivos alterados;
3. arquitetura final de `layout` x `autorizador`;
4. como João Pessoa ficou representada;
5. endpoint usado para emissão;
6. endpoint usado para consulta;
7. endpoint usado para cancelamento;
8. quais textos/flags antigos foram removidos;
9. como o E0039 histórico passou a ser tratado;
10. se `situacao_tributaria_pis_cofins` foi implementado ou não, com justificativa documental;
11. como ficou `codigo_tributacao_municipal_iss`;
12. testes atualizados;
13. resultado de test/typecheck/lint/build;
14. payload simulado da OS 525;
15. confirmação de que nenhuma chamada real foi feita;
16. confirmação de que nenhuma nota histórica foi alterada.

## Critério principal de aceite

Para:

```text
João Pessoa
IBGE 2507507
CRT 3
item 14.01
após reimplementação da Focus
```

o ERP deve resolver para:

```text
layout DPS Nacional
+
Focus
+
endpoint /v2/nfsen
+
Ambiente Nacional DESABILITADO no painel
+
ambiente municipal próprio de João Pessoa
```

e não deve mais exibir ou codificar a ideia de que João Pessoa está “sem integração”.
