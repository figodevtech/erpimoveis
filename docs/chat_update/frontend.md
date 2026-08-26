# IMPLEMENTAÇÃO — REFINAMENTO VISUAL E ANIMAÇÕES DO CHAT INTERNO

## Projeto

```text
https://github.com/figodevtech/erpoficina
```

## Branch obrigatória

```text
feature/chat
```

Esta tarefa deve ser executada especificamente sobre essa branch.

---

# OBJETIVO

O chat interno já está funcionalmente implementado.

Esta tarefa NÃO é para desenvolver uma nova fase funcional.

O objetivo é transformar a interface atual do chat em uma experiência:

* moderna;
* elegante;
* fluida;
* bem animada;
* visualmente refinada;
* consistente com a identidade violeta atual do ERP Oficina;
* agradável tanto no desktop quanto no celular/PWA.

O resultado deve parecer uma ferramenta de comunicação nativa do ERP, e não apenas um `Sheet` shadcn contendo uma lista e algumas mensagens.

A referência conceitual deve ser:

```text
mensageiro corporativo moderno
+
identidade visual do ERP Oficina
+
microinterações suaves
+
interface compacta
```

Não criar um clone exato de:

* WhatsApp;
* Telegram;
* Messenger;
* Slack;
* Discord.

O chat deve possuir identidade própria do ERP Oficina.

---

# REGRA MAIS IMPORTANTE

## ESTA É UMA TAREFA VISUAL

Preservar integralmente:

* banco;
* migrations;
* APIs;
* autenticação;
* autorização;
* Realtime;
* Presence;
* contador não lido;
* leitura;
* paginação;
* cursor;
* idempotência;
* atualização otimista;
* retentativa;
* busca;
* contratos;
* regras de acesso;
* isolamento por instalação;
* comportamento offline/reconexão.

Não alterar regras funcionais apenas para facilitar animações.

---

# 1. LEITURA OBRIGATÓRIA ANTES DE ALTERAR

Antes de modificar qualquer arquivo, leia integralmente:

```text
docs/modulos/chat.md
```

e:

```text
docs/chat_update/fase1.md
```

Trate:

```text
docs/modulos/chat.md
```

como a documentação técnica atual e fonte de verdade do módulo.

Depois das alterações visuais, atualize esse documento conforme exigido pelo próprio arquivo.

---

# 2. ANALISE A IMPLEMENTAÇÃO ATUAL

Leia integralmente pelo menos:

```text
src/components/chat/chat-center.tsx
src/components/chat/chat-trigger.tsx
src/components/chat/chat-trigger-button.tsx
src/components/chat/chat-inbox.tsx
src/components/chat/chat-conversation-item.tsx
src/components/chat/new-conversation.tsx
src/components/chat/chat-conversation.tsx
src/components/chat/chat-timeline.tsx
src/components/chat/chat-message-bubble.tsx
src/components/chat/chat-composer.tsx
src/components/chat/chat-presence-indicator.tsx
src/components/chat/unread-badge.tsx
src/components/chat/chat-provider.tsx
src/components/chat/chat-utils.ts
src/components/chat/chat-api.ts
src/app/globals.css
```

Analise também:

```text
src/components/ui/sheet.tsx
src/components/ui/avatar.tsx
src/components/ui/button.tsx
src/components/ui/input.tsx
src/components/ui/textarea.tsx
src/components/ui/skeleton.tsx
```

Não altere componentes globais indiscriminadamente.

---

# 3. PRESERVAR A ARQUITETURA ATUAL

O chat utiliza:

```text
ChatCenter
 └─ ChatProvider
     └─ ChatPanel
         ├─ inbox
         ├─ new-conversation
         └─ conversation
```

Preservar a arquitetura de:

```ts
type ChatView =
  | { type: "inbox" }
  | { type: "new-conversation" }
  | { type: "conversation"; conversationId: string }
```

Continuar utilizando um único `Sheet`.

NÃO voltar a empilhar vários Sheets.

NÃO criar página de chat.

NÃO criar modal separado para a conversa.

---

# 4. DEPENDÊNCIA DE ANIMAÇÃO

O projeto já possui:

```text
motion
```

como dependência.

Utilize a biblioteca já instalada quando isso melhorar a implementação.

NÃO instalar:

```text
framer-motion
react-spring
gsap
anime.js
```

ou outra biblioteca de animação.

Verifique a API disponível na versão instalada do pacote `motion` e utilize a importação correta suportada pelo projeto.

---

# 5. PRINCÍPIO DAS ANIMAÇÕES

As animações devem ser:

```text
rápidas
suaves
funcionais
discretas
```

O chat deve parecer vivo, mas não infantil.

Preferir durações aproximadamente entre:

```text
140ms
e
260ms
```

Em elementos maiores pode chegar aproximadamente a:

```text
300ms
```

Evitar animações longas.

---

# 6. NÃO ANIMAR TUDO

Não transformar cada elemento em uma animação independente.

Priorizar:

1. abertura do painel;
2. troca de visualização;
3. entrada de mensagens novas;
4. hover/press das conversas;
5. botão de envio;
6. badge não lido;
7. botão “Novas mensagens”;
8. estados de loading;
9. presença online;
10. pequenos feedbacks de interação.

Não criar movimento contínuo desnecessário.

---

# 7. PREFERS-REDUCED-MOTION

Respeitar obrigatoriamente:

```css
prefers-reduced-motion
```

Quando o usuário solicitar redução de movimento:

* remover deslocamentos;
* remover springs;
* reduzir fades;
* evitar pulses;
* manter apenas mudanças visuais essenciais.

Se a biblioteca `motion` disponibilizar hook equivalente a:

```text
useReducedMotion
```

utilize-o quando apropriado.

---

# 8. PERFORMANCE DAS ANIMAÇÕES

Priorizar animação de:

```text
transform
opacity
```

Evitar animações contínuas de propriedades caras como:

```text
width
height
left
top
filter blur pesado
box-shadow muito grande
```

especialmente em listas longas.

---

# 9. CUIDADO CRÍTICO COM A TIMELINE

A timeline atual possui lógica sensível de:

```text
scrollHeight
scrollTop
clientHeight
```

e preservação de posição ao carregar mensagens antigas.

NÃO quebrar isso.

As animações não podem modificar de forma imprevisível a altura das mensagens enquanto:

```text
loadOlder()
```

preserva o scroll.

Não aplicar animação de layout global sobre toda a timeline se isso interferir em:

* paginação pelo topo;
* posição de leitura;
* divisor de não lidas;
* scroll automático;
* detecção de proximidade do final.

---

# 10. NÃO ANIMAR HISTÓRICO ANTIGO COMO NOVO

Ao abrir uma conversa contendo 30 mensagens, NÃO fazer 30 mensagens surgirem uma por uma.

Isso seria visualmente cansativo e poderia interferir no scroll.

Mensagens carregadas inicialmente devem aparecer praticamente de imediato.

Mensagens carregadas ao rolar para cima também NÃO devem utilizar animação de entrada de mensagem nova.

Somente mensagens efetivamente acrescentadas ao final depois da inicialização podem receber animação de chegada.

---

# 11. IDENTIDADE VISUAL DO CHAT

Utilizar os tokens já existentes no ERP:

```text
--background
--foreground
--card
--card-foreground
--primary
--primary-foreground
--secondary
--muted
--muted-foreground
--accent
--border
--ring
```

A identidade principal deve continuar sendo violeta.

Evitar espalhar hexadecimais diretamente pelos componentes.

---

# 12. CONCEITO VISUAL DO PAINEL

Hoje o chat é essencialmente:

```text
Sheet branco
+
borders
+
lista
```

Transformar o painel em uma superfície mais sofisticada.

Estrutura conceitual:

```text
╭──────────────────────────────────────╮
│ Conversas                       ✕    │
│ Mensagens internas da equipe         │
│                                      │
│ ╭──────────────────────────────────╮ │
│ │ 🔍 Buscar conversas             │ │
│ ╰──────────────────────────────────╯ │
│                                      │
│  avatar  João Silva            15:31 │
│          Financeiro                  │
│          Você: consegue verificar? 2 │
│                                      │
│  avatar  Maria Santos          14:52 │
│          Administrativo              │
│          Documento enviado           │
│                                      │
╰──────────────────────────────────────╯
```

---

# 13. SHEET PRINCIPAL

Preservar:

```text
desktop: até aproximadamente 430px
mobile: largura total
height: 100dvh
```

Não alterar o contrato de responsividade já documentado.

Melhorar:

* fundo;
* sombra;
* profundidade;
* header;
* separação visual das áreas.

No desktop, a borda esquerda pode possuir sombra suave para criar profundidade.

Evitar border pesada.

---

# 14. BACKGROUND DO CHAT

Criar um background muito sutil.

Pode utilizar combinação semelhante a:

```text
background
+
radial-gradient primary/5
+
muted muito leve
```

Especialmente na timeline.

Não utilizar imagem.

Não utilizar pattern chamativo.

Não copiar o fundo do WhatsApp.

---

# 15. HEADER DA INBOX

O cabeçalho deve parecer mais sofisticado.

Manter:

```text
Conversas
Mensagens internas da equipe
Nova conversa
```

Mas melhorar a hierarquia.

Título:

```text
16–18px
font-semibold
tracking-tight
```

Descrição:

```text
11–12px
muted-foreground
```

---

# 16. BOTÃO NOVA CONVERSA

O botão atual pode ficar mais compacto e refinado.

Preferir algo como:

```text
[ + Nova conversa ]
```

ou manter o ícone atual.

Pode possuir:

* rounded-xl;
* sombra muito sutil;
* microinteração no hover;
* microinteração no press.

Exemplo visual:

```text
hover:
translateY(-1px)

active:
scale(0.97)
```

Não exagerar.

---

# 17. CAMPO DE BUSCA

Melhorar o campo de busca da inbox.

Desejado:

```text
╭───────────────────────────────╮
│ 🔍 Buscar conversas           │
╰───────────────────────────────╯
```

Características:

* altura 38–42px;
* rounded-xl;
* background levemente diferente;
* border muito sutil;
* ring bonito no foco;
* ícone discreto;
* transição de foco.

Pode usar:

```text
focus-within:ring-primary/20
```

ou padrão equivalente.

---

# 18. LISTA DE CONVERSAS

Eliminar aparência excessiva de:

```text
linha
linha
linha
linha
```

causada por `border-b` em todos os itens.

Preferir uma lista visualmente mais moderna.

Pode utilizar:

```text
padding horizontal pequeno
gap pequeno
```

e cada item possuir:

```text
rounded-xl
ou
rounded-2xl
```

sem transformar a lista em dezenas de cards pesados.

---

# 19. ITEM DE CONVERSA

Estrutura desejada:

```text
╭─────────────────────────────────────╮
│ ● JS   João Silva             15:31 │
│        Financeiro                   │
│        Você: verifica pra mim?   2  │
╰─────────────────────────────────────╯
```

Onde:

```text
● = presença
JS = avatar/iniciais
2 = não lidas
```

---

# 20. HOVER DA CONVERSA

No desktop:

```text
background → accent muito leve
translateX → aproximadamente 2px
```

ou:

```text
scale 1.005
```

Não alterar largura.

Não gerar layout shift.

Active/press:

```text
scale ~0.99
```

---

# 21. CONVERSA COM NÃO LIDAS

Quando:

```text
unreadCount > 0
```

dar destaque visual discreto.

Pode usar:

```text
background primary/5
```

Nome:

```text
font-semibold
```

Preview:

```text
foreground mais forte
```

Evitar deixar toda a linha violeta.

---

# 22. AVATARES

Como atualmente a maioria utiliza iniciais, melhorar muito o `AvatarFallback`.

Utilizar combinação consistente de:

```text
bg-primary/10
text-primary
font-semibold
```

ou uma variação derivada do tema.

Pode adicionar:

```text
ring-1
ring-primary/10
```

Não gerar cores aleatórias difíceis de manter.

---

# 23. PRESENÇA ONLINE

Preservar exatamente a lógica atual:

```text
online
offline
```

Não criar:

```text
ausente
digitando
visto por último
```

O indicador online pode receber um pulse muito sutil.

Exemplo:

```text
ponto verde sólido
+
anel verde com opacity baixa expandindo lentamente
```

Mas:

* somente online;
* extremamente discreto;
* respeitar reduced motion.

Offline permanece estático.

---

# 24. NÃO TRANSFORMAR PRESENÇA EM NOTIFICAÇÃO

O pulse de presença deve representar apenas:

```text
online agora
```

Não deve chamar atenção como alerta.

Não utilizar pulse agressivo.

---

# 25. BADGE NÃO LIDO

Modernizar o `UnreadBadge`.

Manter:

```text
0 → oculto
1..99 → número
>99 → 99+
```

Quando surgir ou aumentar, pode executar uma animação única:

```text
scale 0.75 → 1.1 → 1
opacity 0 → 1
```

aproximadamente em:

```text
180–240ms
```

NÃO manter o badge pulsando infinitamente.

---

# 26. TRIGGER GLOBAL DO CHAT

O botão do header deve continuar visualmente compatível com os outros botões do header.

Pode receber microinteração no:

```text
hover
active
```

Quando uma nova contagem aparecer, o badge pode fazer o pop descrito anteriormente.

NÃO:

* tocar som;
* fazer toast;
* balançar continuamente;
* piscar;
* criar animação chamativa.

A única sinalização global continua sendo o badge.

---

# 27. TRANSIÇÃO ENTRE AS TRÊS VIEWS

Este é um dos pontos mais importantes desta tarefa.

Hoje:

```text
inbox
new-conversation
conversation
```

trocam diretamente.

Criar uma transição visual suave.

Fluxo:

```text
INBOX
   →
CONVERSA
```

A conversa pode entrar levemente pela direita.

Ao voltar:

```text
CONVERSA
   →
INBOX
```

a inbox pode entrar levemente pela esquerda.

---

# 28. ANIMAÇÃO DAS VIEWS

Utilizar algo aproximadamente:

```text
opacity: 0 → 1
x: 12px/20px → 0
```

Duração:

```text
180–240ms
```

Pode utilizar spring suave se ficar elegante.

Não utilizar deslocamento de centenas de pixels.

O usuário já sabe que está dentro do mesmo painel.

---

# 29. DIREÇÃO DA NAVEGAÇÃO

Se possível, distinguir:

```text
inbox → conversation
```

como avanço

e:

```text
conversation → inbox
```

como retorno.

O mesmo para:

```text
inbox → new conversation
new conversation → inbox
```

Isso melhora muito a percepção espacial do chat.

---

# 30. NÃO ALTERAR O ESTADO FUNCIONAL PARA ISSO

Não modificar a arquitetura de dados somente para controlar animação.

Se necessário, criar um estado local puramente visual equivalente a:

```text
navigationDirection
```

Mas não alterar contratos públicos do provider sem necessidade.

---

# 31. NOVA CONVERSA

A tela de seleção de usuário deve utilizar a mesma linguagem da inbox.

Melhorar:

* header;
* botão voltar;
* busca;
* usuários;
* avatar;
* presença;
* loading;
* seleção.

---

# 32. ITEM DE USUÁRIO

Não utilizar `border-b` pesado.

Usar estilo equivalente aos itens de conversa.

Ao clicar:

```text
background accent
```

e, enquanto estiver abrindo:

* reduzir levemente opacity do item;
* manter spinner;
* impedir múltiplos cliques como já ocorre.

Não alterar a lógica de `selectingId`.

---

# 33. HEADER DA CONVERSA

Refinar muito o cabeçalho da conversa.

Estrutura:

```text
←  avatar  João Silva                  ✕
           ● Online · Financeiro
```

Manter:

* voltar;
* avatar;
* nome;
* presença;
* setor;
* fechar Sheet existente.

---

# 34. ESTILO DO HEADER DA CONVERSA

Pode utilizar:

```text
background card/80
backdrop-blur
border-bottom sutil
```

ou superfície equivalente.

Deve parecer conectado à timeline.

Não criar um header visualmente pesado.

---

# 35. BOTÃO VOLTAR

Dar feedback adequado:

```text
hover bg-accent
active scale 0.95
```

Manter:

```text
aria-label
```

e área de toque suficiente.

---

# 36. TIMELINE

A timeline deve receber o maior refinamento visual.

Hoje ela funciona corretamente.

Não alterar sua lógica de scroll.

Melhorar:

* background;
* espaçamento;
* agrupamento visual;
* bolhas;
* separadores;
* loading;
* botão novas mensagens.

---

# 37. BACKGROUND DA TIMELINE

Usar uma superfície muito leve.

Exemplo conceitual light:

```text
background → mistura de background + muted + primary 1–3%
```

Dark:

```text
card escuro
+
primary extremamente sutil
```

Sem imagem e sem pattern.

---

# 38. ESPAÇAMENTO ENTRE MENSAGENS

Manter o chat compacto.

Algo aproximadamente:

```text
4–8px
```

entre mensagens.

Separadores de data podem criar mais espaço.

Evitar:

```text
16–24px entre cada mensagem
```

---

# 39. BOLHA DA PRÓPRIA MENSAGEM

A mensagem do usuário deve continuar à direita.

Melhorar de:

```text
bg-primary
```

para uma superfície mais refinada.

Pode utilizar gradiente extremamente sutil entre tons do próprio primary.

Exemplo conceitual:

```text
primary
→ primary ligeiramente mais escuro
```

Não usar azul desconectado da identidade do ERP.

---

# 40. BOLHA RECEBIDA

Mensagem recebida:

```text
card
ou
card + muted muito leve
```

Border:

```text
muito sutil
```

Sombra:

```text
mínima
```

Deve contrastar corretamente com a timeline.

---

# 41. FORMATO DA BOLHA

Utilizar cantos aproximadamente:

```text
18px
```

Própria:

```text
canto inferior direito ~5–7px
```

Recebida:

```text
canto inferior esquerdo ~5–7px
```

Essa diferença deve ser sutil.

---

# 42. LARGURA DAS MENSAGENS

Preservar aproximadamente:

```text
max-width: 80–82%
```

No desktop pode reduzir ligeiramente se melhorar a leitura.

Não permitir bolhas ocupando 100% da largura.

---

# 43. TIPOGRAFIA DAS MENSAGENS

Texto:

```text
13–14px
line-height confortável
```

Horário:

```text
9–10px
opacity reduzida
```

Manter:

```text
select-text
whitespace-pre-wrap
break-words
```

---

# 44. ENTRADA DE NOVA MENSAGEM

Somente mensagens novas adicionadas ao final após a timeline estar inicializada devem receber animação.

Própria:

```text
opacity 0 → 1
translateY 6px → 0
scale .98 → 1
```

Recebida pode usar o mesmo padrão.

Duração aproximadamente:

```text
180–220ms
```

Não fazer bounce exagerado.

---

# 45. MENSAGEM OTIMISTA

A mensagem `sending` deve aparecer imediatamente.

Pode receber:

```text
opacity ~0.85
```

e spinner discreto junto ao horário.

Quando mudar para:

```text
sent
```

fazer apenas transição sutil de opacity.

Não gerar nova animação completa que pareça outra mensagem.

---

# 46. MENSAGEM COM FALHA

Preservar:

```text
failed
retryable
Tentar novamente
```

Melhorar a apresentação.

A bolha com falha pode usar:

```text
border-destructive/30
background-destructive/5
```

Erro embaixo mais compacto.

A ação:

```text
Tentar novamente
```

deve parecer clicável sem dominar a interface.

---

# 47. NÃO IMPLEMENTAR CHECKS

Ainda continua fora do escopo:

```text
✓
✓✓
check azul
entregue
visualizado
```

Não adicionar.

O estado `sent` serve internamente, não como recibo visual de leitura/entrega.

---

# 48. SEPARADORES DE DATA

Modernizar:

```text
──────── Hoje ────────
```

para algo mais leve.

Exemplo:

```text
        ╭ Hoje ╮
```

ou pill discreta:

```text
bg-muted/60
rounded-full
px-2.5
py-1
```

Pode manter pequenas linhas laterais se visualmente melhor.

---

# 49. DIVISOR DE NÃO LIDAS

Dar um destaque um pouco maior que o separador de data.

Exemplo:

```text
──────── 3 mensagens não lidas ────────
```

com:

```text
primary
primary/40
```

Não utilizar vermelho.

---

# 50. CARREGAMENTO DE MENSAGENS ANTERIORES

Substituir aparência extremamente simples do spinner por algo mais integrado.

Pode manter o spinner, porém dentro de:

```text
pill discreta
```

ou pequena área de loading.

Não alterar o comportamento do carregamento.

---

# 51. "INÍCIO DA CONVERSA"

Modernizar o texto:

```text
Início da conversa
```

para um pequeno label discreto.

Pode usar ícone pequeno de mensagem se fizer sentido.

Não adicionar data de criação ou informação que não exista.

---

# 52. EMPTY STATE DA CONVERSA

Quando nenhuma mensagem existir, melhorar:

```text
Envie a primeira mensagem desta conversa.
```

Visual:

```text
ícone MessagesSquare
+
Comece a conversa
+
Envie a primeira mensagem para João.
```

Utilizar somente informações que já existem em memória.

Não adicionar funcionalidade.

---

# 53. BOTÃO "NOVAS MENSAGENS"

O botão flutuante atual deve ficar mais elegante.

Formato:

```text
╭─────────────────────╮
│ ↓ Novas mensagens   │
╰─────────────────────╯
```

Características:

* rounded-full;
* sombra;
* primary ou card com primary;
* backdrop blur opcional.

Entrada:

```text
opacity 0 → 1
y 8px → 0
scale .95 → 1
```

Saída equivalente.

---

# 54. COMPOSER — GRANDE REFINAMENTO

Hoje o composer visualmente parece:

```text
border-top
textarea
button
contador
```

Transformá-lo em um dock de mensagem.

Conceito:

```text
╭─────────────────────────────────────╮
│ Digite uma mensagem...          ➤   │
╰─────────────────────────────────────╯
                         24 / 5000
```

---

# 55. CONTAINER DO COMPOSER

Manter o composer fixo na área inferior do flex layout.

Preservar:

```text
safe-area-inset-bottom
```

Criar uma área com:

```text
background card/80
backdrop-blur
border-top extremamente sutil
```

ou equivalente.

---

# 56. CAIXA DO COMPOSER

Agrupar visualmente textarea e enviar dentro de uma superfície única.

Exemplo:

```text
rounded-2xl
border
bg-muted/30 ou card
shadow-sm
```

Textarea pode ficar praticamente borderless dentro da superfície.

Mas manter:

* foco acessível;
* label;
* maxLength;
* resize atual;
* Enter;
* Shift+Enter.

---

# 57. BOTÃO ENVIAR

O botão deve parecer parte natural do composer.

Formato preferencial:

```text
circular
ou
rounded-xl
```

Estado habilitado:

```text
bg-primary
text-primary-foreground
```

Hover:

```text
scale 1.03
```

Press:

```text
scale .94
```

---

# 58. TRANSIÇÃO DO BOTÃO ENVIAR

Quando vazio:

* opacity menor;
* disabled.

Quando o usuário começa a digitar uma mensagem válida:

```text
scale .9 → 1
opacity .6 → 1
```

de forma discreta.

Não gerar animação em toda tecla.

Animar somente a mudança:

```text
disabled ↔ enabled
```

---

# 59. ESTADO SENDING DO BOTÃO

Preservar o spinner atual.

Pode fazer uma transição entre:

```text
Send
→
Loader
```

por fade/scale pequeno.

Não bloquear o composer além do comportamento funcional existente.

---

# 60. CONTADOR DE CARACTERES

Manter disponível.

Visualmente deve ser extremamente discreto.

Pode permanecer no canto inferior direito.

Quando se aproximar do limite, pode mudar para uma cor de atenção.

Isso é apenas apresentação.

Não alterar o limite de:

```text
5000
```

---

# 61. ALERTA DE REALTIME DESCONECTADO

Hoje já existe aviso.

Preservar exatamente a semântica.

Melhorar visualmente para um banner compacto.

Exemplo:

```text
⚠ Conexão em tempo real interrompida
```

Pode usar:

```text
amber background sutil
rounded ou full-width compacto
```

Não criar toast.

---

# 62. RECONEXÃO

Não criar notificação de sucesso.

Quando a conexão voltar, o banner simplesmente desaparece com:

```text
fade
+
height transition segura
```

Se animação de height gerar risco, utilizar apenas opacity.

---

# 63. ESTADOS DE ERRO

Melhorar visualmente:

* carregar conversas;
* carregar usuários;
* carregar mensagens;
* leitura;
* envio.

Criar consistência.

Exemplo:

```text
ícone
mensagem curta
botão tentar novamente
```

Não usar grandes caixas vermelhas.

---

# 64. SKELETON DA INBOX

O skeleton atual funciona.

Melhorar para refletir a nova aparência dos itens.

Se os itens forem rounded:

```text
avatar circular
nome
preview
horário
```

deve ser representado no skeleton.

Pode utilizar shimmer muito sutil se já houver suporte.

---

# 65. SKELETON DE USUÁRIOS

Seguir o mesmo padrão visual.

Não criar skeleton diferente sem necessidade.

---

# 66. EMPTY STATE DA INBOX

Modernizar:

```text
Nenhuma conversa ainda.
Inicie uma conversa com outro usuário do sistema.
```

Pode incluir:

```text
MessagesSquare
```

dentro de uma cápsula violeta muito clara.

Abaixo:

```text
Nenhuma conversa ainda
```

e descrição.

Opcionalmente, o botão já existente de nova conversa pode continuar no header.

Não criar CTA duplicada caso deixe a tela poluída.

---

# 67. EMPTY STATE DA BUSCA

Modernizar discretamente:

```text
Nenhuma conversa encontrada.
```

Pode adicionar:

```text
SearchX
```

se já disponível no Lucide.

Não adicionar filtros.

---

# 68. LIGHT MODE

O chat deve combinar com o tema atual:

```text
background lilás muito suave
cards brancos
primary violeta
accent lilás
```

Evitar interface toda branca sem profundidade.

---

# 69. DARK MODE

No dark:

* não usar preto puro;
* diferenciar timeline, headers e composer;
* bordas white/5 a white/10;
* primary violeta;
* bubbles recebidas mais claras que o canvas;
* boa legibilidade do muted.

---

# 70. GLASS / BLUR

Pode utilizar:

```text
backdrop-blur
```

em:

* headers;
* composer;
* botão flutuante;

mas de forma leve.

NÃO transformar todo o chat em glassmorphism.

---

# 71. SHADOWS

Usar sombra principalmente para:

* Sheet no desktop;
* botão novas mensagens;
* composer surface;
* alguns estados hover.

Não colocar shadow grande em cada mensagem.

---

# 72. MOBILE

Preservar:

```text
width: 100%
height: 100dvh
```

No mobile:

* header compacto;
* textarea continua visível com teclado;
* safe area;
* áreas de toque >= 40px;
* sem scroll horizontal;
* sem rolagem dupla.

---

# 73. PWA / IPHONE

Não remover:

```css
env(safe-area-inset-bottom)
```

do composer.

Verificar também se header não fica colado em áreas inseguras.

---

# 74. TECLADO VIRTUAL

Não implementar hacks globais de viewport sem necessidade.

Preservar a estratégia atual baseada no flex layout + `100dvh`.

Validar:

* Android;
* Safari iOS/PWA;
* textarea expandida.

---

# 75. RESPONSIVIDADE

Validar pelo menos:

```text
375px
390px
430px
768px
1366px
1920px
```

---

# 76. NÃO CRIAR RECURSOS DE CHAT NOVOS

Continua proibido adicionar:

```text
digitando...
online há X minutos
último acesso
grupos
anexos
emoji picker
reação
resposta
editar
apagar
encaminhar
áudio
voz
imagem
vídeo
arquivo
GIF
sticker
menção
mensagem fixada
pesquisa dentro das mensagens
check de entrega
check de leitura
visto
```

Mesmo que pareçam melhorar a UX.

Esta tarefa é visual.

---

# 77. NÃO CRIAR NOTIFICAÇÕES

Continua proibido:

* toast de mensagem;
* som;
* browser notification;
* push;
* e-mail;
* Telegram;
* pop-up.

A única indicação global continua sendo:

```text
UnreadBadge
```

no trigger.

---

# 78. NÃO ALTERAR O BANCO

NÃO criar migration.

NÃO alterar:

```text
chat_conversa
chat_participante
chat_mensagem
```

NÃO alterar funções SQL.

NÃO alterar triggers.

NÃO alterar RLS.

---

# 79. NÃO ALTERAR APIs

Evitar qualquer alteração em:

```text
src/app/api/chat/**
```

Uma tarefa visual não deve exigir alteração no backend.

Se encontrar necessidade aparentemente funcional, pare e preserve o comportamento existente.

---

# 80. NÃO ALTERAR REALTIME

NÃO modificar:

* tópicos;
* Broadcast;
* Presence;
* autenticação do Realtime;
* channels;
* reconnect;
* revalidation.

As animações devem reagir ao estado já existente.

---

# 81. NÃO ALTERAR A LEITURA

Preservar integralmente:

```text
80px do fim
visibilityState
debounce de 300ms
last_read_message_id
```

Nenhuma animação pode fazer uma mensagem ser considerada lida antes da lógica atual.

---

# 82. NÃO ALTERAR PAGINAÇÃO

Preservar:

```text
30 mensagens
cursor created_at + id
carregar ao topo
preservar scroll
hasMore
```

---

# 83. NÃO ALTERAR RETENTATIVA

Preservar:

```text
client_message_id
sending
sent
failed
retryable
```

Apenas melhorar a apresentação desses estados.

---

# 84. COMPONENTIZAÇÃO VISUAL

Se ajudar a evitar repetição, é permitido criar componentes puramente visuais como:

```text
ChatPanelHeader
ChatEmptyState
ChatSearchField
ChatViewTransition
ChatStatusBanner
```

ou equivalentes.

Não criar abstrações apenas por criar.

---

# 85. CSS ESPECÍFICO DO CHAT

Pode criar classes reutilizáveis específicas em:

```text
globals.css
```

como:

```text
chat-panel
chat-surface
chat-timeline
chat-composer-surface
```

se realmente trouxerem consistência.

Não poluir o global com dezenas de classes.

Preferir Tailwind quando a classe não for reutilizada.

---

# 86. NÃO ALTERAR COMPONENTES UI GLOBAIS SEM NECESSIDADE

Evitar mudar radicalmente:

```text
Button
Input
Textarea
Sheet
Avatar
```

pois afetam todo o ERP.

Estilize o chat localmente.

---

# 87. ESTILO GERAL DESEJADO

Quero:

```text
limpo
compacto
premium
violeta
fluido
moderno
profissional
leve
```

---

# 88. NÃO QUERO

Evitar:

```text
neon
glassmorphism exagerado
gradientes fortes
bubbles gigantes
sombras pesadas
bounce em tudo
animações lentas
efeitos gamer
interface infantil
cópia do WhatsApp
cópia do Discord
```

---

# 89. EXPERIÊNCIA DESEJADA

Ao clicar no chat:

```text
header
   ↓

painel entra suavemente

Conversas
├ João
├ Maria
└ Pedro
```

Ao clicar em João:

```text
Inbox
   desliza/fade discretamente

        ↓

Conversa com João
```

Enviar:

```text
digita
↓
botão fica ativo suavemente
↓
Enter
↓
bolha aparece imediatamente
↓
sending discreto
↓
sent estabiliza
```

Receber:

```text
evento Realtime
↓
mensagem é reconciliada
↓
nova bolha entra suavemente
```

Sem nenhuma dessas animações modificar a regra funcional.

---

# 90. TESTES VISUAIS OBRIGATÓRIOS

Validar:

### Inbox

* abrir;
* fechar;
* pesquisar;
* hover;
* item não lido;
* badge;
* empty;
* loading;
* erro.

### Nova conversa

* abrir;
* voltar;
* pesquisar;
* selecionar;
* loading;
* erro;
* offline/online.

### Conversa

* entrar;
* voltar;
* enviar;
* receber;
* sending;
* failed;
* retry;
* divisor de data;
* divisor de não lidas;
* novas mensagens abaixo;
* mensagens antigas.

---

# 91. TESTE CRÍTICO DE SCROLL

Criar ou usar uma conversa com mais de:

```text
30 mensagens
```

Validar:

1. abrir conversa;
2. posição inicial correta;
3. subir ao topo;
4. carregar página anterior;
5. posição não pula;
6. animações não mudam a posição;
7. rolar para baixo;
8. nova mensagem chega;
9. comportamento "Novas mensagens" continua correto;
10. leitura continua correta.

---

# 92. VALIDAÇÃO EM TEMPO REAL

Com dois usuários:

```text
A
B
```

testar:

```text
A envia
B recebe
B responde
A recebe
```

Observar se:

* animações acontecem uma única vez;
* mensagem não pisca;
* mensagem otimista não anima novamente ao reconciliar;
* não há duplicação;
* scroll não pula.

---

# 93. REDUCED MOTION

Testar também com preferência de redução de movimento do sistema.

O chat deve continuar totalmente utilizável.

---

# 94. TESTES AUTOMATIZADOS

Preservar os testes existentes.

Executar:

```text
npm run test:chat
```

Se mudanças de markup quebrarem testes legítimos de frontend, atualizar os testes mantendo o contrato funcional.

Não remover teste só para passar.

---

# 95. VALIDAÇÃO FINAL

Executar:

```text
npm run test:chat
npm run lint
npm run build
```

E, se necessário de acordo com o documento técnico:

```text
npm run db:status
```

Como a tarefa não altera banco, NÃO aplicar migration nova.

Os testes de Realtime não precisam ser reinventados, mas nenhuma alteração visual pode quebrar os contratos existentes.

---

# 96. DOCUMENTAÇÃO

Depois da implementação, atualizar:

```text
docs/modulos/chat.md
```

Adicionar uma seção equivalente a:

```text
## Identidade visual e animações
```

documentando:

* layout do Sheet;
* superfícies;
* inbox;
* timeline;
* composer;
* bolhas;
* animações das views;
* animações de mensagens;
* reduced motion;
* cuidados com scroll;
* componentes puramente visuais criados.

---

# 97. HISTÓRICO DA DOCUMENTAÇÃO

Adicionar no histórico resumido algo equivalente a:

```text
2026-08-25 — Refinamento visual:
nova identidade visual do painel, inbox, timeline, composer e mensagens;
microinterações e transições com Motion;
suporte a prefers-reduced-motion;
sem alterações de banco, APIs, Realtime ou regras funcionais.
```

Documente o que realmente for implementado.

---

# 98. NÃO DOCUMENTAR PLANEJADO COMO IMPLEMENTADO

Se alguma animação proposta neste documento não for implementada:

NÃO dizer na documentação que ela existe.

A documentação deve continuar representando o código real.

---

# 99. CRITÉRIOS DE ACEITE VISUAL

A tarefa será considerada concluída quando:

* [ ] o Sheet parecer parte nativa da identidade do ERP;
* [ ] a inbox não parecer apenas uma lista shadcn padrão;
* [ ] os itens de conversa possuírem boa hierarquia;
* [ ] conversas não lidas forem facilmente identificáveis;
* [ ] avatares/iniciais estiverem visualmente refinados;
* [ ] presença estiver elegante;
* [ ] a transição inbox → conversa for fluida;
* [ ] voltar para inbox também possuir transição apropriada;
* [ ] nova conversa possuir a mesma linguagem visual;
* [ ] timeline possuir background próprio e sutil;
* [ ] bolhas estiverem visualmente refinadas;
* [ ] mensagens novas possuírem animação discreta;
* [ ] mensagens históricas não animarem em massa;
* [ ] composer parecer um componente integrado e moderno;
* [ ] botão enviar possuir microinteração;
* [ ] badge possuir animação de entrada sem pulse constante;
* [ ] botão de novas mensagens possuir transição;
* [ ] loading/empty/error estiverem refinados;
* [ ] light mode estiver correto;
* [ ] dark mode estiver correto;
* [ ] mobile/PWA estiver correto;
* [ ] reduced motion estiver correto.

---

# 100. CRITÉRIOS DE ACEITE FUNCIONAL

Depois da alteração:

* [ ] contador global continua correto;
* [ ] inbox continua carregando;
* [ ] busca continua funcionando;
* [ ] criação de conversa continua idempotente;
* [ ] envio continua otimista;
* [ ] Realtime continua funcionando;
* [ ] Presence continua funcionando;
* [ ] paginação continua funcionando;
* [ ] scroll anterior continua preservado;
* [ ] não lidas continuam corretas;
* [ ] leitura continua sendo registrada no momento correto;
* [ ] falha continua permitindo retentativa;
* [ ] retentativa não duplica mensagem;
* [ ] usuário somente execução continua acessando chat;
* [ ] nenhuma API foi aberta;
* [ ] nenhuma permissão foi alterada.

---

# 101. RELATÓRIO FINAL

Ao terminar, apresente:

## Arquivos alterados

```text
arquivo
→ alteração visual realizada
```

## Componentes criados

Somente se houver.

## Animações implementadas

Liste:

```text
Sheet
Views
Inbox
Mensagens
Badge
Composer
etc.
```

## Garantias funcionais

Confirme que permaneceram inalterados:

```text
APIs
Banco
Realtime
Presence
Paginação
Leitura
Idempotência
Retentativa
```

## Testes

Informe os comandos realmente executados e resultados.

## Documentação

Confirme atualização de:

```text
docs/modulos/chat.md
```

---

# RESULTADO ESPERADO

Quero que o chat passe de algo visualmente semelhante a:

```text
Sheet padrão
+
lista
+
textarea
+
bolhas simples
```

para:

```text
Central de conversas nativa do ERP Oficina
+
identidade violeta
+
excelente hierarquia visual
+
microinterações
+
transições suaves
+
mensagens agradáveis de ler
+
composer premium
+
mobile muito bem acabado
```

Sem adicionar absolutamente nenhuma nova funcionalidade de chat.

A implementação deve melhorar drasticamente a percepção visual e a fluidez do módulo, enquanto toda a arquitetura funcional e de segurança da Fase 1 permanece intacta.

Faça a implementação de ponta a ponta. Não entregue apenas recomendações ou mockups.
