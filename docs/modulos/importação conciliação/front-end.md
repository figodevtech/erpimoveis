Você está trabalhando no módulo de **Conciliação Bancária por OFX** já implementado no ERP Oficina da FIGO.

A funcionalidade já está funcionando corretamente.

Seu objetivo agora é **melhorar significativamente o front-end, a experiência do usuário, a clareza visual e a eficiência operacional do módulo**, sem alterar o comportamento financeiro existente.

Esta é uma tarefa de **UI/UX e organização do front-end**.

Não faça uma grande refatoração do backend.

Não mude regras financeiras, migrations, RPCs ou lógica de conciliação que já estejam funcionando, exceto quando uma pequena alteração de API for estritamente necessária para melhorar a experiência da interface.

---

# 1. Antes de alterar qualquer coisa

Leia completamente a implementação atual da Conciliação Bancária.

Identifique:

* página principal;
* componentes;
* dialogs;
* sheets;
* tabela de movimentos OFX;
* etapa de upload;
* preview;
* seleção de banco;
* matching;
* seleção manual de transação;
* criação de nova transação;
* conciliação;
* histórico;
* estados de loading;
* erros;
* feedback após conciliação.

Leia também componentes semelhantes existentes no ERP para manter consistência visual.

Principalmente:

* Fluxo de Caixa;
* Contas a Pagar;
* Contas a Receber;
* tabelas financeiras;
* dialogs financeiros;
* filtros;
* cards;
* sidebar/header;
* padrões Shadcn usados no projeto.

Não invente uma identidade visual nova para apenas este módulo.

A Conciliação Bancária deve parecer uma extensão natural do ERP.

---

# 2. Objetivo de UX

O usuário típico é administrativo/financeiro.

Ele precisa conseguir responder rapidamente:

> O que o banco tem que ainda não está conciliado no sistema?

A interface deve priorizar:

1. leitura rápida;
2. identificação de problemas;
3. comparação banco × ERP;
4. resolução em poucos cliques;
5. confiança antes de confirmar;
6. prevenção de erro financeiro.

Evite uma interface excessivamente técnica.

Termos como:

```text
FITID
fingerprint
score_match
TRNTYPE
```

não devem ocupar a interface principal.

Essas informações podem existir em detalhes técnicos quando necessário.

---

# 3. Estrutura geral da página

Transformar a página de Conciliação Bancária em uma experiência semelhante a uma central financeira.

Estrutura sugerida:

```text
Conciliação Bancária

[ Conta bancária ▼ ]        [ Importar OFX ]

Última conciliação: 31/08/2026
Saldo no ERP: R$ ...
Saldo do extrato: R$ ...
Diferença: R$ ...

--------------------------------------------------

[ Todos ]
[ Pendentes ]
[ Encontrados ]
[ Prováveis ]
[ Sem correspondência ]
[ Conciliados ]

--------------------------------------------------

Tabela dos movimentos
```

A página não deve parecer apenas um formulário de upload.

Após haver uma importação, o foco deve passar a ser a **resolução da conciliação**.

---

# 4. Cabeçalho da página

Criar um cabeçalho claro.

Exemplo:

```text
Conciliação Bancária

Compare o extrato bancário com os lançamentos financeiros do ERP.
```

À direita:

```text
[ Histórico ]   [ Importar OFX ]
```

Evite textos longos.

---

# 5. Cards de resumo

Após a importação, mostrar cards compactos no topo.

Sugestão:

```text
Movimentos
34

Encontrados
18

Precisam de revisão
10

Não encontrados
6
```

E, quando houver informação suficiente:

```text
Entradas
R$ 25.400,00

Saídas
R$ 18.620,00

Diferença pendente
R$ 3.421,00
```

Não criar uma quantidade exagerada de cards.

Utilizar no máximo os indicadores que realmente ajudam na conciliação.

Os cards devem funcionar como filtros quando fizer sentido.

Exemplo:

clicar em:

```text
Não encontrados
6
```

filtra automaticamente a tabela.

---

# 6. Progresso da conciliação

Adicionar um indicador visual de progresso.

Exemplo:

```text
26 de 34 movimentos resolvidos

████████████████░░░░ 76%
```

Ou uma barra do Shadcn.

Estados considerados resolvidos:

* conciliado;
* importado como nova transação;
* ignorado.

Isso dá ao usuário a sensação clara de:

> "quanto falta para fechar este extrato?"

---

# 7. Upload de OFX

Melhorar a experiência de upload.

Permitir:

* selecionar arquivo;
* drag and drop;
* mostrar nome;
* tamanho;
* banco identificado;
* agência;
* conta;
* período.

Exemplo:

```text
┌───────────────────────────────────────┐
│                                       │
│   Arraste seu arquivo OFX aqui        │
│                                       │
│   ou                                  │
│                                       │
│   [ Selecionar arquivo ]              │
│                                       │
│   Formatos aceitos: .ofx              │
│                                       │
└───────────────────────────────────────┘
```

Depois:

```text
CX AGOSTO 2026.ofx

Caixa Econômica Federal
Agência 1234
Conta 00012345-6

01/08/2026 → 31/08/2026

34 movimentações encontradas
```

Se a conta do OFX corresponder claramente a uma conta cadastrada:

```text
Conta identificada automaticamente:
Caixa Conta Corrente
```

Permitir alterar.

---

# 8. Não misturar upload com conciliação

A primeira etapa deve ser simples:

```text
1. Arquivo
2. Conferência
3. Conciliação
```

Não necessariamente implementar um Stepper visual pesado.

Mas deixar claro que:

* carregar o arquivo não altera o financeiro;
* primeiro será feita uma análise;
* depois o usuário confirma.

Pode utilizar algo discreto como:

```text
Arquivo  →  Análise  →  Conciliação
```

---

# 9. Tabela principal

Esta é a área mais importante do módulo.

O usuário deve conseguir entender cada linha rapidamente.

Sugestão de colunas:

```text
[ ] Data
    Movimento
    Valor
    Situação
    Correspondência
    Ação
```

Evite muitas colunas técnicas.

---

# 10. Data

Mostrar:

```text
04 ago.
```

ou:

```text
04/08/2026
```

conforme o padrão do ERP.

Se existir data diferente entre:

* lançamento bancário;
* vencimento;
* pagamento;

mostrar isso dentro do detalhamento, e não necessariamente criar três colunas.

---

# 11. Descrição do movimento

Não mostrar apenas o MEMO bruto do OFX sem tratamento.

Exemplo original:

```text
PAGAMENTO DE BOLETO 104998764432192
```

Pode ser apresentado como:

```text
Pagamento de boleto

104998764432192
```

Ou:

```text
PIX enviado
João da Silva
```

Manter o texto original acessível em:

```text
Ver detalhes
```

Nunca descartar o texto original.

---

# 12. Entrada e saída

O valor deve ser o elemento visual mais fácil de identificar.

Exemplos:

```text
+ R$ 1.250,00
```

```text
- R$ 5.835,69
```

Usar cores compatíveis com o restante do sistema.

Não depender exclusivamente de verde/vermelho para acessibilidade.

Pode complementar com:

```text
Entrada
Saída
```

ou ícones discretos.

---

# 13. Status visual

Criar badges consistentes.

Sugestão:

```text
Conciliado
Encontrado
Provável
Ambíguo
Não encontrado
Ignorado
```

Não mostrar nomes técnicos como:

```text
MATCH_EXATO
MATCH_PROVAVEL
SEM_CORRESPONDENCIA
```

Esses continuam internos.

A UI traduz para linguagem humana.

---

# 14. Match exato

Quando existir uma correspondência forte:

```text
Encontrado
```

Mostrar algo como:

```text
Despesa — Fornecedor XYZ
R$ 5.835,69
04/08/2026
```

E uma indicação discreta:

```text
Correspondência exata
```

O usuário deve conseguir entender imediatamente por que o sistema encontrou aquele lançamento.

---

# 15. Match provável

Exemplo:

```text
Provável correspondência

Boleto — Energia elétrica
Vencimento: 05/08/2026
R$ 5.835,69

Extrato:
04/08/2026
R$ 5.835,69
```

Mostrar uma explicação curta:

```text
Mesmo valor • 1 dia de diferença
```

Isso é muito melhor do que exibir simplesmente:

```text
Score: 85
```

O score pode aparecer apenas em debug ou detalhes.

---

# 16. Ambiguidade

Quando houver várias opções:

Não escolher silenciosamente.

Mostrar:

```text
3 correspondências possíveis
```

Botão:

```text
[ Escolher ]
```

Ao abrir:

```text
Escolha a transação correspondente

Movimento bancário
PIX enviado
03/08/2026
R$ 1.000,00
```

E cards/listas:

```text
○ Fornecedor A
  Conta a pagar
  R$ 1.000,00
  Vencimento: 03/08

○ Fornecedor B
  Conta a pagar
  R$ 1.000,00
  Vencimento: 04/08

○ Despesa administrativa
  R$ 1.000,00
  02/08
```

A ação principal:

```text
[ Confirmar correspondência ]
```

---

# 17. Comparação lado a lado

Para correspondências prováveis ou ambíguas, criar uma visualização muito clara:

```text
EXTRATO                    ERP

04/08/2026                 05/08/2026
R$ 5.835,69                R$ 5.835,69
Pagamento boleto           Energia elétrica

                            Conta a pagar
                            Fornecedor XYZ
```

Essa comparação deve ser utilizada dentro de Dialog/Sheet.

Não precisa ocupar a tabela inteira.

---

# 18. Não encontrado

Quando não houver correspondência:

```text
Não encontrado
```

Ações:

```text
[ Criar transação ]
[ Procurar manualmente ]
[ Ignorar ]
```

`Criar transação` pode ser a ação destacada somente quando isso fizer sentido.

Não criar automaticamente.

---

# 19. Criar nova transação

O Dialog de criação deve aproveitar o máximo possível do formulário financeiro existente.

Pré-preencher:

```text
Data
Valor
Tipo
Banco
Descrição
Método sugerido
```

Exemplo:

```text
Descrição
Débito de IOF

Tipo
Despesa

Valor
R$ 31,57

Data
03/08/2026

Banco
Caixa Conta Corrente

Método
Débito automático
```

Usuário complementa:

```text
Categoria
Plano de contas
Centro de custo
Fornecedor
```

Evite abrir uma tela completamente diferente da experiência atual do Fluxo de Caixa.

---

# 20. Ações rápidas

Permitir selecionar várias linhas.

Exemplo:

```text
☑ 8 movimentos selecionados

[ Conciliar selecionados ]
[ Ignorar ]
```

Mas cuidado:

Não permitir conciliação em lote silenciosa de movimentos ambíguos.

Somente movimentos com decisão completamente definida podem entrar na operação em lote.

Se existirem linhas incompletas:

```text
3 movimentos ainda precisam de revisão.
```

---

# 21. Seleção automática inteligente

Se houver vários matches exatos:

permitir:

```text
[ Selecionar todos os encontrados ]
```

Isso agiliza muito o trabalho.

Exemplo:

```text
18 correspondências exatas encontradas

[ Selecionar os 18 ]
```

Ainda assim o usuário confirma antes da alteração financeira.

---

# 22. Filtros

Adicionar filtros úteis.

```text
Situação
[ Todas ▼ ]

Tipo
[ Entradas e saídas ▼ ]

Período
[ ... ]

Valor
[ ... ]

Busca
[ Buscar descrição, fornecedor... ]
```

Não criar filtros demais inicialmente.

Os mais importantes são:

* situação;
* entrada/saída;
* pesquisa.

---

# 23. Busca

A busca deve localizar:

* MEMO;
* NAME;
* descrição;
* cliente;
* fornecedor;
* número da OS;
* venda;
* valor quando possível.

Placeholder:

```text
Buscar no extrato ou no ERP...
```

---

# 24. Tabs

Se já houver muitos movimentos, utilizar tabs ou filtros rápidos:

```text
Todos 34
Pendentes 10
Encontrados 18
Não encontrados 6
Conciliados 24
```

Não renderizar uma navegação pesada.

Pode usar Shadcn Tabs ou botões de filtro.

---

# 25. Detalhes do movimento

Ao clicar na linha ou em:

```text
Ver detalhes
```

abrir um Sheet lateral.

Estrutura:

```text
Movimento bancário

Pagamento de boleto

-R$ 5.835,69

04/08/2026
Caixa Conta Corrente

--------------------------------

Correspondência ERP

Fornecedor XYZ
Conta a pagar

R$ 5.835,69
Vencimento 05/08/2026

--------------------------------

Por que encontramos?

✓ Mesmo valor
✓ Mesma direção financeira
✓ Conta compatível
✓ 1 dia de diferença

--------------------------------

Dados do arquivo

FITID
CHECKNUM
MEMO original
Arquivo
Importação
```

Essa é a área adequada para informações técnicas.

---

# 26. Feedback visual depois de conciliar

Ao conciliar uma linha:

evitar apenas:

```text
toast("Sucesso")
```

Atualizar visualmente a linha.

Exemplo:

```text
✓ Conciliado
```

E mostrar:

```text
Conciliado com:
Conta a pagar #1821
```

Pode animar discretamente a mudança.

Sem efeitos exagerados.

---

# 27. Confirmação final

Antes de executar várias conciliações:

mostrar um resumo.

```text
Confirmar conciliação

18 movimentos serão vinculados a transações existentes.
5 títulos serão liquidados.
2 novas transações serão criadas.
1 movimento será ignorado.

Total de entradas:
R$ ...

Total de saídas:
R$ ...

[ Cancelar ]
[ Confirmar conciliação ]
```

Essa confirmação é importante porque estamos alterando o financeiro.

---

# 28. Resultado da operação

Depois:

```text
Conciliação concluída

26 movimentos processados

18 vinculados
5 títulos liquidados
2 transações criadas
1 ignorado
```

Ações:

```text
[ Continuar conciliando ]
[ Ver Fluxo de Caixa ]
```

Não necessariamente redirecionar automaticamente.

---

# 29. Erro parcial

Se a API já suporta resposta parcial, apresentar corretamente.

Exemplo:

```text
24 movimentos conciliados

2 movimentos não puderam ser processados.
```

Mostrar individualmente o motivo.

Não esconder toda a operação atrás de:

```text
Erro ao processar.
```

Se a operação for completamente atômica, informar claramente que nada foi aplicado.

Respeitar o comportamento real do backend.

---

# 30. Histórico

Melhorar a página de histórico.

Tabela:

```text
Arquivo
Conta
Período
Movimentos
Resolvidos
Pendentes
Importado em
Usuário
```

Exemplo:

```text
CX AGOSTO 2026.ofx

Caixa Conta Corrente
01/08 → 31/08

34 movimentos
34 resolvidos

08/09/2026
Lucas
```

Status:

```text
Concluída
Em andamento
```

---

# 31. Importação já existente

Se o usuário enviar novamente o mesmo arquivo:

não mostrar apenas erro técnico.

Mostrar:

```text
Este arquivo já foi importado.

Caixa Conta Corrente
01/08/2026 → 31/08/2026
34 movimentos

Importado em 08/09/2026

[ Abrir conciliação ]
```

Isso transforma um erro em uma navegação útil.

---

# 32. Período sobreposto

Se o arquivo for diferente, mas possuir período sobreposto:

não bloquear necessariamente.

Exemplo:

```text
Este extrato possui movimentos de um período que já foi parcialmente importado.

O sistema encontrou:
21 movimentos já conhecidos
13 movimentos novos

Você pode continuar normalmente.
```

Isso reforça confiança no mecanismo anti-duplicidade.

---

# 33. Loading states

Criar estados de carregamento específicos.

Evitar spinner genérico em tela inteira.

Exemplo durante análise:

```text
Analisando extrato...

✓ Arquivo lido
✓ 34 movimentos identificados
✓ Conta identificada
• Comparando com o Fluxo de Caixa
• Procurando títulos em aberto
```

Não precisa ser uma simulação falsa.

Só mostrar etapas realmente executadas ou usar texto simples se o backend não informar progresso.

---

# 34. Skeletons

Para carregamento de histórico/tabela, usar Skeleton do design system.

Evitar layout pulando durante carregamento.

---

# 35. Empty states

Criar bons estados vazios.

Sem importações:

```text
Nenhuma conciliação bancária realizada

Importe um arquivo OFX para comparar seu extrato bancário com o financeiro do ERP.

[ Importar OFX ]
```

Sem pendências:

```text
Tudo conciliado ✓

Todos os movimentos deste extrato já foram resolvidos.
```

Filtro sem resultado:

```text
Nenhum movimento encontrado com estes filtros.
```

---

# 36. Responsividade

Desktop é prioridade por ser uma ferramenta financeira operacional.

Mesmo assim:

* não quebrar em tablet;
* Dialogs devem adaptar para Sheet no mobile se já houver esse padrão;
* tabela pode virar cards em telas estreitas;
* botões não podem ficar fora da tela.

Não comprometer a experiência desktop para tentar transformar tudo em mobile-first.

---

# 37. Hierarquia de ações

Definir claramente:

Ação primária:

```text
Conciliar
```

Secundárias:

```text
Escolher correspondência
Criar transação
```

Terciária/perigosa:

```text
Ignorar
```

Evite seis botões com o mesmo peso visual na mesma linha.

Utilizar dropdown de ações quando necessário.

---

# 38. Ícones

Usar somente o pacote de ícones já adotado no projeto.

Provavelmente Lucide.

Sugestões:

```text
Upload
FileText
Landmark
ArrowDownLeft
ArrowUpRight
CircleCheck
CircleAlert
Search
Link
Unlink
History
```

Não adicionar biblioteca nova apenas por causa deste módulo.

---

# 39. Tooltips

Usar tooltips apenas quando o significado do ícone não for evidente.

Não transformar toda a UI em uma coleção de tooltips.

---

# 40. Acessibilidade

Garantir:

* navegação via teclado;
* labels em inputs;
* aria-label em ícones isolados;
* foco correto em Dialog;
* contraste adequado;
* status não identificado apenas por cor;
* checkboxes utilizáveis via teclado.

---

# 41. Performance

O arquivo pode conter centenas ou milhares de movimentos.

Evitar:

* cálculos pesados dentro de cada render;
* `.filter().map().find()` repetidos por linha;
* componentes enormes;
* requests individuais para cada movimento;
* N+1 requests.

Se a tabela puder crescer muito, considerar paginação ou virtualização somente se necessário.

Não adicionar complexidade prematuramente para 30 linhas.

---

# 42. Estado da tela

Organizar bem o estado.

Evitar componente principal com dezenas de:

```text
useState()
```

Se necessário:

* separar componentes;
* usar hooks locais;
* usar `useMemo` apenas quando fizer sentido;
* manter servidor como fonte de verdade após operações.

Não introduzir Redux/Zustand apenas para este módulo se o projeto não utiliza isso.

---

# 43. Componentização sugerida

Avalie uma estrutura semelhante:

```text
components/
├── reconciliation-header.tsx
├── reconciliation-summary.tsx
├── reconciliation-progress.tsx
├── ofx-upload.tsx
├── reconciliation-filters.tsx
├── reconciliation-table.tsx
├── reconciliation-row.tsx
├── match-badge.tsx
├── match-details-sheet.tsx
├── match-selector-dialog.tsx
├── create-transaction-dialog.tsx
├── reconciliation-confirm-dialog.tsx
├── reconciliation-result-dialog.tsx
└── import-history-table.tsx
```

Não siga isso cegamente.

Se os componentes atuais já estiverem bem divididos, preserve o que funciona.

Não criar componente para cada `div`.

---

# 44. Evitar duplicação visual

Se o ERP já possui componentes para:

* moeda;
* data;
* badges;
* cliente;
* fornecedor;
* transaction dialog;
* banco;
* plano de contas;
* centro de custo;

reutilize.

Não criar versões exclusivas apenas para OFX sem necessidade.

---

# 45. Fluxo ideal

O fluxo final deve parecer aproximadamente assim:

```text
Financeiro
   ↓
Conciliação Bancária

Caixa Conta Corrente
Última conciliação: 31/07/2026

[ Importar OFX ]
   ↓
arrasta arquivo
   ↓
Conta identificada
Caixa Conta Corrente

Período:
01/08 → 31/08

34 movimentos
[ Analisar ]
   ↓
Dashboard:

34 movimentos
18 encontrados
10 precisam de revisão
6 novos

76% resolvido
   ↓
Tabela

✓ PIX recebido        +1.250   Encontrado
! Boleto              -5.835   Provável
! PIX                 -1.000   3 opções
- IOF                    -31   Não encontrado
   ↓
Usuário resolve pendências
   ↓
[ Selecionar encontrados ]
   ↓
[ Conciliar 26 movimentos ]
   ↓
Resumo da operação
   ↓
Confirmar
   ↓
✓ Conciliação concluída
```

---

# 46. Não fazer

Não faça:

* redesign completo do ERP;
* alteração do tema global;
* nova biblioteca de UI;
* nova biblioteca de estado;
* mudança de RPC sem necessidade;
* alteração de regras financeiras;
* remoção de proteção de duplicidade;
* conciliação automática de match ambíguo;
* criação automática de transação sem confirmação;
* esconder informações importantes apenas para deixar a tela "bonita";
* dashboard exagerado;
* dezenas de gráficos;
* animações chamativas;
* gradients aleatórios;
* glassmorphism;
* interface estilo fintech consumer se não combinar com o ERP.

Estamos fazendo uma ferramenta administrativa profissional.

---

# 47. Direção visual

O visual desejado é:

* profissional;
* limpo;
* moderno;
* denso o suficiente para trabalho financeiro;
* fácil de escanear;
* consistente;
* com boa hierarquia;
* sem excesso de espaço vazio;
* sem excesso de bordas.

Inspiração conceitual:

```text
ERP moderno
+
internet banking empresarial
+
ferramenta de reconciliação contábil
```

Mas mantendo a identidade atual do sistema.

---

# 48. Critério principal de sucesso

Uma pessoa do financeiro deve conseguir abrir a conciliação e, em menos de alguns segundos, entender:

```text
O que já bateu?
O que precisa da minha atenção?
O que não existe no ERP?
Quanto falta para terminar?
```

E deve conseguir resolver os casos mais comuns sem abrir vários dialogs desnecessários.

---

# 49. Implementação

Primeiro analise a UI atual.

Depois faça as mudanças.

Não pare apenas em sugestões ou mockups.

Implemente de fato os componentes e interações.

Após cada conjunto relevante de alterações:

* rode TypeScript;
* rode lint relacionado;
* rode testes existentes relevantes;
* verifique erros de console;
* verifique estados de loading;
* verifique estados vazios;
* verifique responsividade.

Preserve todas as funcionalidades existentes.

---

# 50. Ao finalizar

Entregue um relatório objetivo contendo:

1. quais problemas de UX foram encontrados;
2. quais componentes foram alterados;
3. quais componentes foram criados;
4. quais fluxos foram simplificados;
5. quais informações técnicas foram removidas da interface principal;
6. quais novos estados visuais foram adicionados;
7. como funciona a seleção em lote;
8. como matches prováveis e ambíguos são apresentados;
9. como ficou a experiência de criar nova transação;
10. como ficou o histórico;
11. quais testes/verificações foram executados;
12. se algum comportamento existente precisou ser preservado mesmo não sendo o ideal visualmente.

Não considere a tarefa concluída apenas porque a tela ficou mais bonita.

A melhoria deve ser perceptível principalmente em **clareza, velocidade de operação e redução do risco de conciliar a transação errada**.
