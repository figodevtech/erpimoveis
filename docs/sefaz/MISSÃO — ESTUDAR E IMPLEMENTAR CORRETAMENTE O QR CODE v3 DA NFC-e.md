# MISSÃO — ESTUDAR E IMPLEMENTAR CORRETAMENTE O QR CODE v3 DA NFC-e

Estamos desenvolvendo um **motor completo de emissão de NFC-e (modelo 65)**.

Existe atualmente um último ponto em aberto relacionado à:

**Assinatura do QR Code versão 3 em contingência offline (`tpEmis = 9`).**

A implementação NÃO pode ser feita por tentativa, aproximação, memória ou suposição.

Antes de alterar qualquer código, você deve estudar a documentação fiscal oficial indicada abaixo, entender completamente a especificação e somente depois auditar e implementar a solução.

---

# 1. FONTES OFICIAIS OBRIGATÓRIAS

Leia primeiro estas fontes.

## Portal Nacional da NF-e — Documentação Técnica

https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=6WfrpZYE4Ik%3D

Localize e estude:

**Nota Técnica 2025.001 — versão 1.03 Corrigida**

Essa Nota Técnica introduz/altera, entre outros pontos:

- QR Code versão 3 da NFC-e;
- regras de validação relacionadas;
- campos do grupo suplementar;
- regras ZX02;
- comportamento de emissão online;
- comportamento de contingência offline.

Dê atenção especial às regras:

- ZX02-324;
- ZX02-325;
- ZX02-326;
- ...
- ZX02-338;

e a todas as regras adjacentes que tenham impacto sobre:

- `qrCode`;
- `urlChave`;
- `tpEmis`;
- `tpAmb`;
- versão do QR;
- assinatura;
- destinatário;
- contingência offline.

Não analise somente a ZX02-338 isoladamente.

---

# 2. MANUAL DE PADRÕES TÉCNICOS DO DANFE NFC-e E QR CODE

Portal Nacional:

https://www.nfe.fazenda.gov.br/portal/listaHistorico.aspx?tipoConteudo=Ef+Y1blZDbU%3D

Localize:

**Manual de Padrões Técnicos do DANFE NFC-e e QR Code — Versão 6.0 — Março de 2025**

O download oficial do Portal pode aparecer através de um endereço `exibirArquivo.aspx`.

Esse Manual é parte fundamental da especificação da NT 2025.001.

Estude especialmente:

- QR Code versão 3;
- montagem da URL;
- emissão online;
- contingência offline;
- conteúdo do parâmetro `p`;
- ordem dos campos;
- separadores;
- campos vazios;
- identificação do destinatário;
- algoritmo de assinatura;
- codificação da assinatura;
- certificado utilizado na assinatura.

---

# 3. REFERÊNCIA OFICIAL DA SEFAZ/PR — QR CODE v3

Esta página oficial é extremamente importante porque demonstra explicitamente a montagem do QR Code v3:

https://sped.fazenda.pr.gov.br/NFCe/Pagina/QR-Code

Estude integralmente as seções:

**Montando a URL do QR Code 3.0 na versão ONLINE**

e principalmente:

**Montando a URL do QR Code 3.0 na versão OFFLINE**

A documentação apresenta os parâmetros da contingência offline na seguinte ordem lógica:

1. Chave de acesso da NFC-e;
2. Versão do QR Code;
3. Ambiente (`tpAmb`);
4. Dia da data de emissão;
5. Valor total da NFC-e (`vNF`);
6. Tipo de identificação do destinatário;
7. Identificação do destinatário;
8. Assinatura.

Confirme isso diretamente na documentação antes de implementar.

---

# 4. ASSINATURA DO QR CODE v3 OFFLINE

Você deve verificar documentalmente a seguinte regra.

Na contingência offline, a assinatura é calculada sobre a concatenação dos parâmetros **1 a 7**, mantendo os caracteres `|` exatamente como aparecem no conteúdo.

Estrutura conceitual:

```text
chave|3|tpAmb|DD|vNF|tp_idDest|idDest
```

NÃO inclua a assinatura no conteúdo que será assinado.

Somente depois de gerar a assinatura, ela será acrescentada como oitavo parâmetro:

```text
chave|3|tpAmb|DD|vNF|tp_idDest|idDest|assinatura
```

A documentação oficial determina assinatura:

```text
RSA SHA-1
```

com resultado:

```text
Base64
```

utilizando:

**o mesmo certificado digital utilizado para assinar a NFC-e.**

Confirme essa informação na fonte oficial antes de implementar.

---

# 5. NÃO CONFUNDIR QR CODE v2 COM QR CODE v3

Este é um requisito extremamente importante.

O sistema possui ou possuía implementação do QR Code versão 2.

NÃO reutilize automaticamente a estratégia da versão 2.

No QR Code v2 existiam conceitos como:

- CSC;
- idCSC;
- hash;
- DigestValue em determinadas situações.

No QR Code v3, a estrutura mudou.

Analise a especificação atual antes de decidir o que pode ou não ser reaproveitado.

Não mantenha CSC, `idCSC`, `DigestValue` ou SHA-1 de parâmetros simplesmente porque faziam parte da versão anterior.

Cada campo utilizado deve possuir justificativa na especificação da **versão 3**.

---

# 6. CASOS DE DESTINATÁRIO

Analise cuidadosamente os parâmetros:

```text
tp_idDest
idDest
```

A documentação estabelece tipos de identificação, incluindo:

```text
1 = CNPJ
2 = CPF
3 = idEstrangeiro
```

Analise separadamente:

### CNPJ

Estrutura conceitual:

```text
...|1|CNPJ
```

### CPF

```text
...|2|CPF
```

### Consumidor não identificado

Os campos devem continuar existindo na concatenação através dos separadores.

Exemplo conceitual:

```text
chave|3|tpAmb|DD|vNF||
```

Não remova os separadores dos campos vazios.

### Estrangeiro

Verifique no Manual exatamente como `tp_idDest` e `idDest` devem ser representados.

Não suponha comportamento.

---

# 7. DIA DA EMISSÃO

O parâmetro correspondente ao dia deve possuir exatamente dois dígitos.

Exemplo:

```text
01
09
10
31
```

Ele deriva do dia existente em `dhEmi`.

ATENÇÃO:

Não converta `dhEmi` para UTC antes de extrair o dia.

Por exemplo:

```text
2026-08-10T00:30:00-03:00
```

deve continuar correspondendo ao dia fiscal informado no documento.

Evite implementações que façam:

```ts
new Date(dhEmi)
```

e posteriormente usem o timezone do servidor/runtime para determinar o dia.

Prefira extrair o componente diretamente da representação fiscal já validada de `dhEmi`, caso isso seja compatível com a arquitetura atual.

---

# 8. vNF

O valor utilizado no QR Code deve corresponder ao campo:

```text
W16 / vNF
```

da NFC-e.

Não recalcular independentemente o total exclusivamente para gerar o QR Code.

Utilize a mesma representação fiscal utilizada para construir o XML.

Analise cuidadosamente:

- casas decimais;
- ponto como separador decimal;
- ausência de separador de milhar;
- ausência de símbolos monetários;
- ausência de sinais indevidos.

Evite transformar:

```text
150.00
```

em:

```text
150
```

se isso modificar a representação exigida pela especificação e consequentemente os bytes assinados.

---

# 9. ASSINATURA DIGITAL

Analise a implementação atual de assinatura XML da NFC-e.

Identifique como o certificado A1/A3 ou abstração correspondente disponibiliza acesso à operação de assinatura.

Para o QR Code v3 offline precisamos assinar a string de parâmetros segundo a especificação.

Não confundir isso com a XMLDSig da própria NFC-e.

São operações relacionadas ao mesmo certificado, mas possuem conteúdos assinados diferentes.

Confirme:

```text
dados = UTF-8 da concatenação dos parâmetros 1..7
algoritmo = RSA com SHA-1
resultado = assinatura binária
representação = Base64
```

Verifique se alguma normalização, quebra de linha, BOM, encoding diferente, URL encoding antecipado ou transformação de texto está sendo aplicada.

Os bytes assinados precisam corresponder exatamente ao conteúdo especificado.

---

# 10. URL ENCODING

Analise cuidadosamente em qual momento deve ocorrer URL encoding.

Existe diferença entre:

1. conteúdo lógico do parâmetro `p`;
2. string utilizada para gerar a assinatura;
3. assinatura Base64;
4. URL final colocada em `qrCode`;
5. representação XML da URL.

Base64 pode conter caracteres como:

```text
+
/
=
```

Não altere esses caracteres antes da geração da assinatura.

Determine através da documentação e do comportamento esperado em XML/URL onde é necessário aplicar escaping ou URL encoding.

Também diferencie:

```text
&
```

da sua representação XML:

```text
&amp;
```

quando aplicável.

A string XML e a URL lógica não devem ser confundidas.

---

# 11. REJEIÇÃO 583

Investigue especificamente a:

**Rejeição 583**

e sua relação com as regras de validação do QR Code.

Verifique no documento oficial a condição exata da rejeição.

Não tente simplesmente "fazer a rejeição desaparecer".

Precisamos garantir que a implementação seja semanticamente idêntica ao cálculo realizado pela SEFAZ.

---

# 12. AUDITORIA DO CÓDIGO EXISTENTE

Antes de escrever código novo:

1. localize todo código relacionado a NFC-e;
2. localize geração de `infNFeSupl`;
3. localize geração de `qrCode`;
4. localize `urlChave`;
5. localize versão 2 do QR Code;
6. localize versão 3;
7. localize contingência offline;
8. localize `tpEmis`;
9. localize CSC;
10. localize `idCSC`;
11. localize funções de SHA-1;
12. localize funções de RSA;
13. localize assinatura XML;
14. localize carregamento do certificado;
15. localize cálculo de `vNF`;
16. localize construção da chave de acesso;
17. localize tratamento de `dhEmi`.

Mapeie o fluxo completo:

```text
dados da venda
      ↓
modelo fiscal
      ↓
XML NFC-e
      ↓
chave de acesso
      ↓
assinatura XML
      ↓
QR Code
      ↓
infNFeSupl
      ↓
XML final
      ↓
DANFE
```

Verifique se a ordem real da aplicação exige alguma mudança.

---

# 13. NÃO QUEBRAR O QR CODE ONLINE

O QR Code v3 ONLINE possui estrutura diferente da contingência offline.

Não permita que a implementação offline altere acidentalmente o comportamento online.

Crie fluxos claramente separados, por exemplo:

```text
QR v3 ONLINE
QR v3 OFFLINE
```

ou abstração equivalente.

A seleção deve estar baseada nas regras fiscais reais, especialmente em:

```text
tpEmis
```

---

# 14. NÃO REGREDIR QR CODE v2 SEM NECESSIDADE

Se o sistema ainda precisa oferecer compatibilidade temporária com QR Code v2, não remova essa implementação sem analisar o impacto.

Porém:

**QR v2 não pode ser usado como fallback silencioso para uma NFC-e que deva utilizar QR v3.**

Se determinada vigência/UF/ambiente exige versão 3, cumpra a regra oficial.

---

# 15. TESTES OBRIGATÓRIOS

Depois da implementação, crie testes unitários para pelo menos:

### ONLINE

- QR v3 produção;
- QR v3 homologação.

### OFFLINE

- CNPJ;
- CPF;
- consumidor não identificado;
- estrangeiro;
- produção;
- homologação;
- valor com centavos;
- valor inteiro representado fiscalmente;
- valor elevado permitido;
- dia `01`;
- dia `09`;
- dia `10`;
- dia `31`;
- emissão perto da meia-noite;
- timezone `-03:00`.

### ASSINATURA

Teste:

- conteúdo exato antes da assinatura;
- quantidade correta de `|`;
- campos vazios;
- assinatura RSA-SHA1;
- resultado Base64;
- certificado correto;
- encoding UTF-8;
- inexistência de CR/LF acidental;
- inexistência de espaços acidentais.

---

# 16. TESTE CRIPTOGRÁFICO DETERMINÍSTICO

Crie um teste utilizando:

- chave RSA de teste;
- payload conhecido;
- assinatura esperada.

O objetivo é garantir que uma mudança futura de biblioteca ou implementação não altere silenciosamente a assinatura.

O teste deve validar:

```text
payload
↓
bytes UTF-8
↓
SHA-1
↓
RSA
↓
Base64
```

Não use certificado real de produção nos testes automatizados.

---

# 17. VALIDAÇÕES DEFENSIVAS

Antes de gerar o QR offline, valide:

```text
chave.length === 44
versaoQr === 3
tpAmb ∈ {1,2}
DD possui exatamente 2 dígitos
vNF válido
tp_idDest válido ou vazio
idDest coerente
certificado/chave privada disponível
```

Se alguma pré-condição fiscal não estiver satisfeita, lance erro explícito.

Não gere um QR Code potencialmente inválido.

---

# 18. OBSERVABILIDADE

Como uma falha aqui pode acontecer depois que o DANFE já foi entregue ao consumidor, os erros precisam ser diagnosticáveis.

Adicione logs estruturados seguros contendo informações como:

```text
qrVersion
tpEmis
tpAmb
dia
tipoDestinatario
algoritmoAssinatura
```

Não grave:

- chave privada;
- senha do certificado;
- conteúdo PKCS#12;
- segredo criptográfico.

Tenha cuidado também com CPF/CNPJ em logs.

---

# 19. CRITÉRIO DE FONTE

Ordem de autoridade:

1. Portal Nacional da NF-e / ENCAT;
2. Nota Técnica vigente;
3. Manual oficial DANFE NFC-e/QR-Code;
4. MOC/regras oficiais;
5. documentação oficial das SEFAZ;
6. somente depois bibliotecas ou implementações de terceiros.

GitHub, Stack Overflow, blogs, fóruns e bibliotecas NÃO devem substituir a especificação oficial.

Caso uma biblioteca contradiga a documentação oficial:

**a documentação oficial prevalece.**

---

# 20. NÃO INVENTAR

Se encontrar uma ambiguidade:

1. mostre exatamente qual é;
2. indique qual documento deveria resolvê-la;
3. cite seção/regra/página;
4. não implemente por suposição.

Não quero código que "provavelmente funciona".

Estamos construindo um **motor fiscal**, portanto cada comportamento precisa ser justificável pela especificação.

---

# 21. RESULTADO ESPERADO

Depois de estudar as fontes e o projeto, entregue:

## A. Diagnóstico

Explique como o projeto implementa atualmente:

```text
QR v2 online
QR v2 offline
QR v3 online
QR v3 offline
```

Informe o que está:

```text
CORRETO
INCORRETO
INCOMPLETO
AUSENTE
```

---

## B. Especificação confirmada

Documente exatamente:

```text
payload QR v3 online
payload QR v3 offline
payload assinado
algoritmo
encoding
Base64
tratamento do destinatário
tratamento de vNF
tratamento de dhEmi
URL final
```

Cite para cada conclusão a fonte oficial correspondente.

---

## C. Implementação

Implemente todas as alterações necessárias.

Não faça apenas um exemplo isolado.

Integre corretamente ao motor existente.

---

## D. Testes

Adicione testes automatizados suficientes para impedir regressões.

---

## E. Relatório final

Ao finalizar, apresente:

```text
Arquivos alterados
Funções criadas
Funções removidas
Regras fiscais implementadas
Testes adicionados
Casos limites tratados
Documentação oficial utilizada
Pendências restantes
```

---

# 22. REQUISITO FINAL

O objetivo é chegar ao ponto em que possamos afirmar tecnicamente:

> A NFC-e modelo 65 em `tpEmis=9`, utilizando QR Code versão 3, gera o parâmetro `p`, sua assinatura digital e o `infNFeSupl` de acordo com a NT 2025.001 e com o Manual de Padrões Técnicos do DANFE NFC-e e QR Code v6.0, sem depender da implementação legada do QR Code v2.

Não finalize a tarefa até ter auditado o fluxo completo.

Não chute regras fiscais.

Não altere comportamento fiscal sem fonte documental.