# Revisão e correção dos warnings fiscais por item na emissão de NF-e

## Objetivo

Revisar e melhorar todo o sistema de **avisos fiscais exibidos em amarelo por item durante a emissão de NF-e**.

Não parar no planejamento. Inspecionar a implementação atual da branch `develop`, identificar todos os warnings, informativos e bloqueios relacionados à tributação do item, confrontar cada regra com documentação fiscal oficial vigente, implementar as correções, adicionar testes e executar as validações disponíveis.

O objetivo **não** é simplesmente reduzir a quantidade de warnings para deixar a tela mais limpa.

O objetivo é garantir que:

- um aviso só apareça quando houver fundamento fiscal real;
- situações apenas suspeitas sejam tratadas como aviso, não como afirmação de erro;
- regras facultativas por UF não sejam tratadas como obrigatórias nacionalmente;
- informativos não peçam ciência;
- bloqueios somente existam quando houver impossibilidade estrutural, regra nacional aplicável ou política estadual versionada e comprovada;
- não existam falsos positivos que acostumem o usuário a clicar em “estou ciente” sem analisar;
- frontend e backend utilizem a mesma regra fiscal;
- toda regra relevante tenha fonte, versão e vigência rastreáveis.

---

## 1. Auditar todos os warnings existentes

Primeiro localizar todos os pontos que podem gerar:

```ts
severidade = "AVISO"
requerCiencia = true
severidade = "INFO"
```

e também regras hoje apresentadas visualmente como aviso ou informação fiscal.

Analisar especialmente:

- `src/lib/nfe/issuesFiscais.ts`
- `src/lib/nfe/icms/cfopSemantica.ts`
- `src/lib/nfe/icms/politicaStRetida.ts`
- `src/lib/nfe/baseIbsCbs.ts`
- núcleo de ICMS;
- validação do item;
- emissão assistida;
- NF-e avulsa;
- backend de geração do rascunho;
- snapshot fiscal;
- componentes responsáveis pelos avisos amarelos.

Para cada warning identificado, documentar:

- `code`
- gatilho;
- severidade;
- `requerCiencia`;
- fundamento;
- fonte;
- versão da fonte;
- vigência;
- escopo nacional ou estadual;
- campos que influenciam a decisão;
- situações legítimas que **não** devem gerar o warning.

Não alterar regra fiscal com base apenas em suposição.

---

## 2. Corrigir a regra genérica `x.1xx = SEM_ST`

Existe atualmente uma inferência semelhante a:

```ts
if (/^[1256]1\d\d$/.test(codigo)) return "SEM_ST";
```

Essa conclusão é excessivamente ampla.

Não assumir que:

```text
CFOP pertencente ao grupo x.1xx = operação sem substituição tributária
```

O fato de um CFOP não pertencer à família `x.400` **não significa**, sozinho, que CST/CSOSN relacionado a ICMS-ST anteriormente recolhido seja incompatível.

### Caso oficial que deve virar regressão

Existe orientação oficial da SEFAZ-SP de 2026 em operação interestadual destinada a consumidor final não contribuinte utilizando:

```text
CFOP 6.108 + CSOSN 500
```

para mercadoria cujo ICMS havia sido recolhido anteriormente por substituição tributária.

Também existe orientação oficial, para outro contexto, utilizando:

```text
CFOP 6.108 + CST 00
```

em situação envolvendo mercadoria anteriormente sujeita a ST e nova tributação na saída.

Isso demonstra que a decisão não pode ser extraída apenas da família numérica do CFOP.

### Alteração esperada

Remover a inferência genérica:

```text
x.1xx => SEM_ST
```

Um CFOP deve ser classificado como:

```text
SUBSTITUTO
SUBSTITUIDO
ST_SEM_PAPEL
SEM_ST
NEUTRO
```

apenas quando houver informação semântica suficientemente explícita na fonte oficial ou uma exceção explicitamente documentada.

CFOP que não menciona ST nem define claramente o papel tributário deve preferencialmente ser:

```text
NEUTRO
```

e não:

```text
SEM_ST
```

---

## 3. Casos de regressão obrigatórios

Criar testes específicos.

### 3.1. CFOP 6108 + CSOSN 500

Não pode gerar automaticamente:

```text
NFE_CFOP_SEM_ST_COM_CST_DE_ST
```

apenas porque `6108` não pertence ao grupo `x.400`.

Há situação oficialmente documentada em que essa combinação é válida.

### 3.2. CFOP 6108 + CST 00

Também é combinação oficialmente documentada em outro contexto.

Não deve gerar warning genérico de ST.

### 3.3. CFOP 6102 + CST 60

Não declarar automaticamente que a combinação é errada apenas porque o CFOP pertence a `6.1xx`.

Se o ERP quiser detectar eventual inadequação tributária neste cenário, isso deverá vir de regra contextual específica envolvendo, quando aplicável:

- mercadoria;
- NCM;
- CEST;
- UF origem;
- UF destino;
- regime tributário;
- consumidor final;
- contribuinte/não contribuinte;
- ST anterior;
- ST devida na operação atual;
- protocolo;
- convênio;
- política estadual.

Não inferir isso simplesmente do número do CFOP.

---

## 4. Manter warnings semânticos com fundamento explícito

### CFOP explicitamente de substituto

Se a descrição ou nota explicativa oficial do CFOP estabelecer que o emitente atua:

```text
na condição de contribuinte substituto
```

e o CST/CSOSN escolhido não representar retenção de ST nesta operação, gerar:

```text
AVISO
requerCiencia = true
```

porque há forte divergência semântica.

Não transformar automaticamente isso em bloqueio nacional.

### CFOP explicitamente de substituído

Se a fonte oficial estabelecer explicitamente que a operação é realizada na condição de contribuinte substituído ou com imposto anteriormente retido, e o tratamento ICMS escolhido contradisser esse papel, gerar:

```text
AVISO
requerCiencia = true
```

Exemplos como o CFOP `5.405` devem continuar sendo analisados dessa forma.

---

## 5. Revisar especialmente o CFOP 6.404

Não tratar o texto resumido isoladamente.

O CFOP `6.404` possui nota explicativa específica para venda interestadual de mercadoria sujeita à ST cujo imposto já havia sido retido anteriormente, inclusive situações em que o remetente passa a atuar como substituto tributário perante a UF destinatária.

Manter exceção explícita somente se:

- houver fonte oficial identificada;
- a interpretação estiver documentada;
- houver teste;
- a regra não for extrapolada para operações diferentes.

Revisar a implementação atual de:

```ts
PAPEL_ST_CFOP_EXPLICITO
```

---

## 6. Atualizar o catálogo oficial de CFOP

O projeto ainda possui catálogo identificado como:

```text
IT-2023.002-v1.00
```

com referência de 2023.

O Portal Nacional da NF-e publicou em `04/09/2026`:

```text
Informe Técnico 2023.002 v2.10
```

com atualização da tabela de CFOP.

### Implementação

Não alterar apenas a constante de versão.

Executar:

1. obter a tabela oficial vigente;
2. atualizar o arquivo fonte usado pelo gerador;
3. regenerar `cfopCatalog.generated.ts`;
4. atualizar versão;
5. atualizar vigência;
6. atualizar hash/proveniência;
7. comparar códigos incluídos;
8. comparar códigos removidos;
9. comparar descrições alteradas;
10. executar testes da resolução de CFOP;
11. documentar o resultado.

O catálogo gerado deve continuar sendo reproduzível a partir da fonte oficial.

---

## 7. Atualizar a referência da NT 2025.002

O projeto ainda possui referências como:

```text
NT-2025.002-v1.50
```

A versão oficial publicada em `04/08/2026` é:

```text
NT 2025.002 v1.51
```

Revisar as mudanças entre as versões antes de apenas trocar a string.

Depois:

- atualizar `NFE_FISCAL_RULE_VERSION`;
- atualizar comentários;
- atualizar documentação;
- revisar regras RTC/IBS/CBS afetadas;
- revisar testes;
- assegurar que rascunhos gerados com regra anterior sejam tratados corretamente pelo mecanismo de versão fiscal existente.

---

## 8. Manter o warning de base manual IBS/CBS

O warning:

```text
NFE_IBSCBS_BASE_MANUAL
```

deve permanecer.

Quando:

```text
base informada manualmente != base calculada pela composição fiscal
```

deve continuar sendo:

```text
AVISO
requerCiencia = true
```

e não bloqueio, enquanto a regra UB16-10 continuar marcada oficialmente como implementação futura ou pendente de orientação normativa.

### Mensagem recomendada

Preferir mensagem semelhante a:

> A base informada difere da composição prevista pela regra UB16-10. A regra de validação encontra-se indicada como implementação futura na documentação vigente. Confira a base antes da emissão.

Pode mencionar a futura rejeição `1104` como referência, sem dizer que ela necessariamente está ativa no momento.

---

## 9. CST 60 / CSOSN 500 — ST retida e ICMS efetivo

Preservar o conceito de que as regras:

```text
N12-81
N12-82
N12a-50
N12a-60
```

têm implementação facultativa a critério da UF.

Não criar regra nacional:

```text
CST 60 => campos sempre obrigatórios
```

ou:

```text
CSOSN 500 => campos sempre obrigatórios
```

### Sem política estadual cadastrada e comprovada

```text
INFO
requerCiencia = false
não bloqueia
```

### Com política estadual comprovadamente obrigatória e vigente

```text
BLOQUEIO
requerCiencia = false
```

somente para o contexto coberto por aquela política.

### Política estadual deve possuir

- UF;
- operação/contexto relevante;
- início da vigência;
- fim da vigência, quando houver;
- fonte;
- URL da fonte;
- regra afetada;
- data da última revisão.

Nunca estimar:

- `vBCSTRet`
- `pST`
- `vICMSSubstituto`
- `vICMSSTRet`
- `pRedBCEfet`
- `vBCEfet`
- `pICMSEfet`
- `vICMSEfet`

Esses valores devem vir de documentação fiscal comprovável quando necessários.

---

## 10. Paraíba

Considerar a orientação oficial da SEFAZ-PB que tornou facultativo o preenchimento dos dados de ICMS-ST anteriormente retido previstos pela NT 2018.005 e informou que as demais validações opcionais da NT não seriam inicialmente aplicadas no Estado.

Não transformar essa orientação em regra eterna.

Se houver fonte posterior alterando o entendimento da PB, a política mais recente e vigente deve prevalecer.

Toda política estadual deve ser versionada por data.

---

## 11. Separar visualmente aviso de informativo

A interface deve ter semântica clara.

### BLOQUEIO

```text
vermelho
impede emissão
```

### AVISO

```text
amarelo
exige análise e ciência
```

### INFO

```text
azul/cinza
não exige ciência
não impede emissão
```

Não mostrar `INFO` com aparência que faça o operador acreditar que precisa corrigir alguma coisa.

Isso é especialmente importante para:

```text
NFE_ST_RETIDA_POLITICA_UF
NFE_ICMS_EFETIVO_POLITICA_UF
```

quando não existir política estadual obrigatória.

---

## 12. Corrigir a ciência dos warnings

Atualmente a ciência é essencialmente persistida pelo código do warning.

Isso é insuficiente.

Exemplo:

```text
usuário confirma warning
↓
muda um dado fiscal relevante
↓
mesmo código continua confirmado
```

A ciência deve estar vinculada à situação efetivamente analisada.

### Implementar fingerprint estável

Conceito:

```text
issueConfirmation =
code
+ fingerprint dos dados que produziram o warning
+ versão da regra
```

### Exemplo CFOP/ST

Incluir no fingerprint:

- `code`
- CFOP;
- CST/CSOSN;
- `stAtivada`;
- CRT;
- contexto relevante;
- versão da regra.

### Exemplo IBS/CBS

Incluir:

- `code`
- base manual;
- base calculada;
- componentes da composição;
- data fiscal;
- versão da NT/regra.

Se qualquer elemento fiscal relevante mudar, a ciência antiga deixa de valer.

Não depender apenas de limpar ciência quando CFOP, CST ou CSOSN mudam.

Considerar também, conforme o warning:

- NCM;
- CEST;
- origem;
- ST ativada;
- base;
- frete;
- desconto;
- UF;
- `indFinal`;
- `indIEDest`;
- data fiscal;
- regra aplicada.

O backend deve recalcular o fingerprint.

Não confiar no fingerprint enviado pelo navegador.

Confirmações antigas que possuam apenas `code`, sem fingerprint confiável, não devem liberar silenciosamente um novo warning produzido em outro contexto.

---

## 13. Uma única regra para frontend e backend

Não duplicar regra fiscal em componente React.

O motor/shared module deve determinar:

- código;
- mensagem;
- severidade;
- `requerCiencia`;
- fonte;
- fingerprint;
- contexto considerado.

O frontend apenas apresenta.

O backend recalcula e valida antes de salvar ou autorizar.

Manipular o payload do navegador não pode permitir ignorar warning que exige ciência nem bloqueio.

---

## 14. Proveniência do warning

Evoluir a estrutura da issue, se necessário, para algo semelhante a:

```ts
{
  code,
  severity,
  requiresAcknowledgement,
  field,
  message,

  source: {
    title,
    version,
    url,
    effectiveFrom,
    jurisdiction
  },

  fingerprint
}
```

Não é obrigatório utilizar exatamente esse type.

O importante é permitir responder:

> Por que o ERP está avisando isso?

e:

> Qual documento oficial sustenta esse aviso?

---

## 15. Não criar IA classificadora de impostos

Não solucionar essa revisão criando heurísticas de IA ou pesquisa Google durante a emissão.

O runtime fiscal deve trabalhar com:

- regras determinísticas;
- fontes versionadas;
- tabelas locais;
- políticas estaduais revisadas;
- datas de vigência.

Internet pode ser usada para manutenção e auditoria das fontes, não para decidir uma NF-e em tempo real.

---

## 16. Testes obrigatórios

Cobrir pelo menos:

1. CFOP `5405` + tratamento de ST anterior coerente;
2. CFOP `5405` + CST incompatível gera AVISO;
3. CFOP explicitamente de substituto + CST sem retenção gera AVISO;
4. CFOP `6404` nos contextos oficialmente documentados;
5. `6108 + CSOSN 500` não recebe falso `SEM_ST`;
6. `6108 + CST 00` não recebe falso `SEM_ST`;
7. `6102 + CST 60` não recebe warning apenas porque pertence a `6.1xx`;
8. CFOP neutro não produz suposição sobre ST;
9. CST 60 `indFinal=0` sem política estadual => INFO;
10. CST 60 `indFinal=1` sem política estadual => INFO;
11. CSOSN 500 equivalente;
12. política estadual vigente obrigatória => BLOQUEIO;
13. política expirada não bloqueia;
14. política futura não bloqueia hoje;
15. base IBS/CBS automática correta não gera aviso;
16. base IBS/CBS manual divergente gera AVISO;
17. ciência do warning vale com o mesmo fingerprint;
18. alterar CFOP invalida fingerprint;
19. alterar CST/CSOSN invalida fingerprint;
20. alterar `icmsReterSt` invalida warning relacionado;
21. alterar base/frete/desconto invalida ciência de base IBS/CBS;
22. manipular confirmação no frontend não engana backend;
23. INFO nunca entra em `avisosFiscaisConfirmados`;
24. atualização do catálogo CFOP não quebrou direção/geografia/CFOP da NFC-e.

---

## 17. Validação final

Ao terminar:

- executar testes relevantes;
- executar typecheck;
- executar lint nos arquivos alterados;
- executar build se viável;
- revisar warnings exibidos na emissão assistida;
- revisar NF-e avulsa;
- revisar comportamento do backend;
- revisar snapshot fiscal;
- verificar se INFO não exige ciência;
- verificar se warnings não permanecem confirmados depois de mudança relevante;
- confirmar que o catálogo CFOP realmente corresponde à nova fonte oficial.

Não afirmar que testes passaram sem efetivamente executá-los.

---

## 18. Relatório final esperado

Informar:

1. todos os warnings encontrados;
2. quais estavam corretos;
3. quais estavam excessivos ou incorretos;
4. quais regras foram alteradas;
5. versão anterior e nova do catálogo CFOP;
6. alterações decorrentes da NT 2025.002 v1.51;
7. arquivos criados;
8. arquivos modificados;
9. testes adicionados;
10. comandos efetivamente executados;
11. resultado observado de testes/typecheck/lint/build;
12. fontes oficiais utilizadas;
13. possíveis pontos ainda dependentes de legislação específica por UF.

Não afirmar que uma regra fiscal está correta apenas porque os testes existentes passam.

Os testes atuais podem simplesmente estar reproduzindo uma premissa fiscal errada.

Priorizar a fonte normativa ou oficial vigente.

Não parar no planejamento. Executar a implementação.

---

# Referências oficiais

## Portal Nacional da NF-e — Informe Técnico 2023.002 / tabela CFOP

Informe Técnico 2023.002 v2.10, publicado em 04/09/2026, com atualização da tabela de CFOP:

https://www.nfe.fazenda.gov.br/PORTAl/informe.aspx?ehCTG=false

Portal de conteúdos/tabelas da NF-e:

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D

---

## Portal Nacional da NF-e — NT 2025.002

Lista oficial de Notas Técnicas da NF-e/NFC-e, incluindo a NT 2025.002 v1.51:

https://hom.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D

---

## MOC 7.0 — Leiaute e Regras de Validação

Manual de Orientação do Contribuinte — NF-e/NFC-e:

https://www.nfe.fazenda.gov.br/PORTAl/exibirArquivo.aspx?conteudo=J%2BI%2Bv4eN00E%3D

Revisar especialmente as regras:

- N12-81
- N12-82
- N12a-50
- N12a-60

e a indicação de implementação facultativa por UF.

---

## NT 2018.005

Nota Técnica com regras relacionadas ao ICMS-ST anteriormente retido e ICMS efetivo:

https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=URRwWd0zp2U%3D

---

## SEFAZ-PB — ICMS-ST anteriormente retido

Comunicado da Paraíba sobre a não obrigatoriedade das validações da NT 2018.005:

https://www.sefaz.pb.gov.br/announcements/7581-validacao-do-icms-de-substituicao-tributaria-dos-documentos-eletronicos-nf-e-e-nfc-e-precisa-ser-realizada-ate-29-de-abril

---

## SEFAZ-SP — CFOP 6.108 + CSOSN 500

Resposta à Consulta Tributária 33951/2026:

https://legislacao.fazenda.sp.gov.br/Paginas/RC33951_2026.aspx

Usar como regressão contra a falsa premissa:

```text
6.1xx = sem ST
```

---

## SEFAZ-SP — CFOP 6.108 + CST 00

Resposta à Consulta Tributária 27923/2023:

https://legislacao.fazenda.sp.gov.br/Paginas/RC27923_2023.aspx

---

## SEFAZ-SP — CFOP 6.404

Resposta à Consulta sobre utilização do CFOP 6.404:

https://legislacao.fazenda.sp.gov.br/Paginas/RC3837_2014.aspx

Também revisar as notas explicativas oficiais do CFOP aplicáveis.

---

## SEFAZ-PB — tabela/descrições de CFOP

Portal de legislação da SEFAZ-PB:

https://www.sefaz.pb.gov.br/

Não utilizar cópia antiga local como fonte final quando houver tabela nacional mais recente.

---

## Lei Complementar 214/2025

Base legal material do IBS e CBS, especialmente art. 12:

https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm

---

# Princípio de segurança fiscal

A correção desta tarefa **não é transformar avisos em silêncio**.

Por exemplo:

```text
6102 + CST 60
```

não deve deixar de ser analisado para sempre.

A correção é remover a conclusão incorreta:

```text
6.1xx = sem ST
```

Se futuramente houver dados suficientes e uma regra contextual oficial mostrar que determinada combinação está incoerente, o ERP pode voltar a alertar — mas usando contexto, fonte, vigência e fundamento adequados.
