# IMPLEMENTAÇÃO — REFINAMENTO VISUAL DO CHAT INTERNO — FASE 2

## Projeto

```text
https://github.com/figodevtech/erpoficina
```

## Branch

Execute esta tarefa na branch em que a segunda fase do chat foi implementada.

Antes de alterar qualquer arquivo, confirme:

```text
git status
git branch --show-current
```

Não sobrescreva alterações existentes e não trabalhe em uma branch diferente sem informar.

---

# OBJETIVO

A segunda fase do chat já está funcionalmente implementada.

Esta tarefa não é para desenvolver novas funcionalidades.

O objetivo é refinar visualmente os recursos acrescentados na fase 2:

* mensagens de voz;
* player de áudio;
* resposta citada;
* reações;
* edição;
* exclusão;
* configuração do Web Push;
* menus e ações das mensagens.

O resultado deve parecer um mensageiro corporativo moderno integrado ao ERP Oficina, com inspiração na organização visual do WhatsApp, mas sem copiá-lo integralmente.

A principal correção obrigatória é o posicionamento e a apresentação das ações de cada mensagem.

---

# REGRA MAIS IMPORTANTE

## ESTA É UMA TAREFA DE FRONTEND

Preservar integralmente:

* banco de dados;
* migrations;
* tabelas;
* constraints;
* índices;
* Storage;
* bucket privado de áudios;
* APIs;
* payloads;
* contratos;
* autenticação;
* autorização;
* Realtime;
* Presence;
* Web Push;
* service worker;
* contador não lido;
* marcação de leitura;
* paginação;
* cursor;
* preservação do scroll;
* idempotência;
* atualização otimista;
* retentativa;
* janela de 15 minutos;
* histórico de edição;
* exclusão para mim;
* exclusão para todos;
* resposta citada;
* conjunto das quatro reações;
* limites de voz;
* acesso por signed URL;
* supressão do Push;
* funcionamento offline e reconexão.

Não alterar uma regra funcional para facilitar o layout.

Não criar migrations nesta tarefa, salvo se for identificado um defeito funcional inevitável e previamente explicado. A expectativa é de nenhuma alteração no banco.

---

# 1. LEITURA OBRIGATÓRIA

Antes de modificar o código, leia integralmente:

```text
docs/modulos/chat.md
docs/chat_update/fase1.md
docs/chat_update/fase2.md
docs/chat_update/frontend.md
```

Trate:

```text
docs/modulos/chat.md
```

como a fonte de verdade do módulo.

Depois das alterações visuais, atualize esse documento para refletir o novo comportamento da interface.

Não reescreva a documentação técnica inteira. Atualize apenas as seções afetadas, especialmente:

* componentes;
* menu por mensagem;
* reações;
* responsividade;
* acessibilidade;
* identidade visual;
* animações;
* validação visual.

---

# 2. ANALISAR A IMPLEMENTAÇÃO ATUAL

Leia integralmente, no mínimo:

```text
src/components/chat/chat-message-bubble.tsx
src/components/chat/chat-message-actions.tsx
src/components/chat/chat-timeline.tsx
src/components/chat/chat-conversation.tsx
src/components/chat/chat-composer.tsx
src/components/chat/chat-audio-player.tsx
src/components/chat/chat-voice-recorder.tsx
src/components/chat/chat-push-settings.tsx
src/components/chat/chat-center.tsx
src/components/chat/chat-view-transition.tsx
src/components/chat/chat-visuals.tsx
src/components/chat/chat-utils.ts
src/lib/chat/contracts.ts
src/app/globals.css
```

Localize também:

* componentes shadcn utilizados pelos menus;
* `DropdownMenu`;
* `Popover`;
* `AlertDialog`;
* `Tooltip`;
* componentes Motion;
* testes visuais e de interação do chat;
* estilos específicos `chat-*`.

Entenda primeiro como:

* a mensagem identifica autoria;
* as ações são habilitadas;
* a reação atual é determinada;
* o menu controla edição e exclusão;
* o mobile diferencia toque, scroll e controles de áudio;
* a chave visual estável evita remontagem da bolha;
* o scroll é preservado.

Não alterar essas regras.

---

# 3. PROBLEMA VISUAL ATUAL

Atualmente, o botão de ações da mensagem fica completamente exposto ao lado do balão durante todo o tempo.

Além disso, o mesmo controle concentra:

* abertura do menu de ações;
* escolha de reação;
* responder;
* editar;
* excluir.

Isso torna a timeline visualmente carregada e dá destaque permanente a controles que deveriam ser contextuais.

A nova interface deve separar claramente:

```text
BOTÃO DE AÇÕES
```

de:

```text
BOTÃO DE REAÇÃO
```

Eles não devem ser apresentados como uma única ação ou dentro da mesma superfície inicial.

---

# 4. BOTÃO DE AÇÕES DENTRO DO BALÃO

Inspirar-se no comportamento visual do WhatsApp.

O botão que abre o `DropdownMenu` deve ficar:

* dentro da área do balão;
* preferencialmente no canto superior direito;
* sobre uma pequena área de contraste;
* alinhado ao conteúdo;
* sem aumentar desnecessariamente a altura do balão;
* sem ficar permanentemente exposto no desktop.

Usar um ícone discreto como:

```text
ChevronDown
```

ou outro equivalente já usado no projeto.

## Desktop

Em dispositivos com mouse, o botão deve aparecer quando:

* o usuário passar o mouse sobre o balão;
* o balão receber foco;
* algum elemento interno estiver com foco;
* o menu estiver aberto.

Comportamento esperado:

```text
estado normal:
balão limpo, sem botão exposto

hover/focus:
botão de ações aparece dentro do canto superior do balão

menu aberto:
botão continua visível
```

Usar uma transição curta e discreta, por exemplo:

* `opacity`;
* pequeno `scale`;
* deslocamento mínimo.

Não movimentar o texto quando o botão aparecer.

Reservar internamente o espaço necessário quando houver risco de o botão cobrir:

* a primeira linha;
* horário;
* indicador “editada”;
* player;
* citação.

O botão pode usar uma pequena superfície ou gradiente de proteção correspondente à cor do balão, semelhante ao acabamento utilizado pelo WhatsApp.

Não criar um retângulo visualmente pesado.

## Mensagens próprias

Nas mensagens alinhadas à direita:

* manter o botão dentro do balão;
* respeitar o gradiente violeta;
* garantir contraste;
* não utilizar uma cor que pareça alerta ou ação principal.

## Mensagens recebidas

Nas mensagens alinhadas à esquerda:

* manter o mesmo padrão;
* adaptar a superfície ao fundo `card` ou `muted`;
* manter consistência entre os temas.

## Estado aberto

Enquanto o menu estiver aberto:

* o botão não pode desaparecer ao perder hover;
* deve refletir visualmente o estado ativo;
* o menu não pode fechar acidentalmente apenas porque o ponteiro saiu do balão.

---

# 5. DROPDOWN DE AÇÕES

O `DropdownMenu` deve continuar contendo somente ações textuais/contextuais:

```text
Responder
Editar
Excluir para mim
Excluir para todos
```

Mostrar apenas as opções permitidas para aquela mensagem, seguindo as regras existentes.

## Importante

Não colocar novamente as quatro reações dentro do `DropdownMenu`.

A escolha de reação terá um botão próprio e separado.

## Organização visual

Usar:

* ícones discretos;
* labels claros;
* espaçamento compacto;
* agrupamento coerente;
* separador antes das ações destrutivas, quando apropriado.

Sugestão:

```text
↩ Responder
✎ Editar
────────────
🗑 Excluir para mim
🗑 Excluir para todos
```

A ação:

```text
Excluir para todos
```

deve manter o `AlertDialog` de confirmação já implementado.

Ações destrutivas podem utilizar `destructive`, mas sem transformar todo o menu em vermelho.

---

# 6. BOTÃO DE REAÇÃO SEPARADO

Criar um botão de reação separado do botão de ações.

Ele deve ficar:

* fora do balão;
* ao lado da mensagem;
* visualmente discreto;
* alinhado aproximadamente ao centro ou à parte inferior do balão;
* sem competir com o conteúdo;
* oculto quando não houver interação no desktop.

Usar um ícone equivalente a:

```text
SmilePlus
```

ou outro símbolo apropriado.

A cor deve ser básica e discreta, utilizando tokens como:

```text
text-muted-foreground
bg-muted
bg-background
border-border
```

Não usar violeta forte como estado padrão.

## Posicionamento

Para mensagem própria, alinhada à direita:

```text
[ botão de reação ] [ balão da mensagem ]
```

Para mensagem recebida, alinhada à esquerda:

```text
[ balão da mensagem ] [ botão de reação ]
```

O botão deve ficar voltado para o centro da timeline, reduzindo o risco de encostar nas bordas do Sheet.

Não alterar o alinhamento principal dos balões.

## Desktop

O botão de reação deve aparecer quando:

* o balão estiver em hover;
* o grupo da mensagem estiver em hover;
* o botão receber foco;
* algum controle da mensagem estiver com foco;
* o seletor de reação estiver aberto.

Aplicar transição curta de:

* `opacity`;
* `scale`;
* deslocamento horizontal mínimo.

Não usar animação contínua.

## Ao clicar

Abrir um `Popover` ou superfície equivalente contendo somente:

```text
❤️
👍
😄
😢
```

Cada reação deve manter:

* label acessível;
* `aria-pressed`;
* destaque da reação do usuário atual;
* comportamento de selecionar;
* substituir reação;
* remover ao clicar novamente na própria reação.

O comportamento funcional e otimista existente não pode ser alterado.

---

# 7. COMPORTAMENTO EM CELULAR E PWA

Não depender exclusivamente de hover.

Em dispositivos touch, os controles não devem ficar permanentemente expostos ao lado de todas as mensagens.

Implementar comportamento contextual seguro.

Preferência:

1. um toque na área neutra do balão seleciona temporariamente a mensagem;
2. a mensagem selecionada revela:

   * o botão de ações dentro do balão;
   * o botão de reação ao lado;
3. tocar fora remove a seleção;
4. abrir menu ou reações mantém a seleção;
5. fechar o menu remove a seleção quando apropriado.

Também pode ser utilizado pressionar e segurar como atalho, mas não como único modo de acesso.

## Não interferir com controles internos

O toque para selecionar a mensagem não pode interceptar:

* botão reproduzir/pausar;
* barra de progresso;
* links;
* botão “Tentar novamente”;
* citação clicável;
* reações agrupadas;
* seleção e cópia de texto;
* botões do estado de falha.

Não impedir o scroll vertical da timeline.

Não usar tratamento de gesto que cause atraso perceptível ao tocar nos controles do áudio.

## Teclado e acessibilidade

O botão de ações e o botão de reação devem continuar acessíveis por teclado mesmo quando visualmente ocultos.

Usar padrões como:

```text
group-hover
group-focus-within
data-[state=open]
```

sem aplicar `display: none` quando isso remover o elemento da navegação por teclado.

O foco deve tornar o controle visível.

---

# 8. REAÇÕES JÁ APLICADAS

Preservar a exibição agrupada abaixo do balão:

```text
❤️ 2   👍 3   😄 1
```

Refinar visualmente os chips existentes.

Eles devem:

* parecer conectados ao balão;
* usar superfície compacta;
* ter borda ou sombra muito discreta;
* destacar a reação do usuário atual;
* funcionar nos temas claro e escuro;
* não aumentar excessivamente o espaço entre mensagens;
* manter contagem legível;
* preservar `aria-pressed`;
* continuar clicáveis quando esse comportamento já existir.

Não implementar interface mostrando quem reagiu.

---

# 9. RESPOSTA CITADA

Refinar a prévia de resposta dentro do balão.

A citação deve ter:

* borda lateral ou marcador violeta discreto;
* fundo com contraste suave;
* nome do remetente;
* trecho limitado;
* ícone de voz quando aplicável;
* cantos coerentes com o balão;
* indicação visual de que pode ser clicada.

O clique deve continuar:

* buscando páginas anteriores quando necessário;
* localizando a mensagem;
* preservando o scroll;
* centralizando a mensagem;
* aplicando destaque temporário.

## Destaque da mensagem original

Refinar o destaque temporário para ser perceptível, mas não agressivo.

Utilizar:

* brilho suave;
* borda ou ring violeta temporário;
* pequena mudança de fundo;
* transição curta.

Não usar piscadas repetidas.

Respeitar `prefers-reduced-motion`.

---

# 10. MODO DE RESPOSTA E EDIÇÃO NO COMPOSER

Refinar as faixas acima do composer:

```text
Respondendo a...
Editando mensagem
```

Elas devem:

* ficar integradas ao dock;
* ter hierarquia clara;
* não parecer alertas;
* usar borda lateral ou ícone;
* mostrar o texto com truncamento;
* ter botão de fechar discreto;
* animar a entrada e saída por altura e opacidade;
* respeitar safe area;
* não provocar rolagem dupla;
* permanecer visíveis com o teclado virtual aberto.

Diferenciar visualmente:

* resposta;
* edição.

Exemplo:

```text
Resposta  → marcador violeta e ícone Reply
Edição    → marcador neutro/violeta e ícone Pencil
```

Não alterar:

* `Esc` para cancelar edição;
* limite de caracteres;
* Enter e Shift+Enter;
* conteúdo carregado;
* regras de envio.

---

# 11. MENSAGENS DE VOZ

Refinar o player para que pareça parte natural do balão.

Trabalhar:

* botão de reproduzir/pausar;
* barra de progresso;
* duração;
* horário;
* estados de carregamento;
* erro;
* retentativa;
* alinhamento;
* contraste;
* área de toque;
* tema escuro.

O player deve:

* ser compacto;
* não parecer o player nativo do navegador;
* manter apenas um áudio tocando;
* deixar clara a diferença entre reproduzir e enviar;
* preservar a barra operável por teclado;
* não conflitar com o botão de ações dentro do balão.

Reservar espaço no canto superior do balão para que o botão de ações não cubra o player.

## Gravador

Refinar os estados:

```text
Gravando
Revisando
Enviando
Falha
```

A gravação deve continuar mostrando:

* indicador;
* duração;
* parar;
* descartar;
* ouvir;
* enviar.

O estado de gravação não deve depender apenas de uma bolinha vermelha.

Respeitar movimento reduzido.

---

# 12. EXCLUSÃO E MENSAGEM EXCLUÍDA

Refinar o estado:

```text
Mensagem excluída
```

Ele deve ser discreto e claramente diferente de uma mensagem normal.

Pode utilizar:

* texto em itálico;
* ícone apropriado;
* cor secundária;
* fundo menos destacado.

Não deixar espaço vazio onde existiam:

* conteúdo;
* áudio;
* reações;
* ações inválidas.

Para mensagem excluída para todos, preservar apenas a opção permitida:

```text
Excluir para mim
```

O acesso a essa ação deve seguir o novo padrão contextual.

---

# 13. CONFIGURAÇÃO DO WEB PUSH

Refinar visualmente o painel existente:

```text
Ativar notificações do chat
```

Ele deve continuar dentro da inbox e não pode parecer um banner permanente de erro.

Criar estados visuais claros:

```text
Disponível para ativar
Ativando
Ativo neste dispositivo
Permissão negada
Indisponível
Erro
```

Usar:

* ícone;
* título;
* descrição curta;
* ação principal;
* ação para desativar quando aplicável;
* cores compatíveis com cada estado.

Não criar:

* sininho global;
* central de notificações;
* histórico;
* preferências genéricas;
* notificações de outros módulos.

Não solicitar permissão automaticamente.

Não alterar service worker, subscriptions ou VAPID nesta tarefa visual.

---

# 14. ESPAÇAMENTO DA TIMELINE

Revise a densidade da timeline depois de incluir os controles contextuais.

Garantir que:

* mensagens consecutivas do mesmo autor não fiquem excessivamente afastadas;
* reações agrupadas não criem grandes lacunas;
* mensagens de voz tenham altura proporcional;
* citação e texto mantenham hierarquia;
* horário e “editada” não disputem espaço;
* botão de ações não cubra o texto;
* botão de reação externo não aumente permanentemente a largura ocupada;
* mensagens longas continuem quebrando corretamente;
* o Sheet de 430 px continue confortável.

Não alterar a lógica de agrupamento, paginação ou leitura.

---

# 15. ANIMAÇÕES

A dependência `motion` já existe. Reutilize-a quando trouxer benefício real.

Usar animações curtas e discretas para:

* revelar botão de ações;
* revelar botão de reação;
* abrir seletor de reações;
* adicionar ou trocar uma reação;
* entrar e sair do modo de resposta;
* entrar e sair do modo de edição;
* estados do gravador;
* destaque da mensagem citada;
* abrir menus e confirmações.

Evitar:

* animação de layout em toda a lista;
* deslocamento do scroll;
* reanimação de mensagens antigas;
* animação contínua;
* bounce exagerado;
* brilho constante;
* efeitos chamativos;
* reanimar a bolha após reconciliação otimista;
* alterar a chave estável da mensagem.

Manter a estratégia existente:

```text
senderId + clientMessageId
```

para a chave visual quando ela já for usada.

Respeitar:

```text
prefers-reduced-motion
```

Nesse modo:

* remover deslocamentos desnecessários;
* remover escalas;
* reduzir durações;
* manter toda funcionalidade disponível.

---

# 16. TOKENS E IDENTIDADE VISUAL

Reutilizar os tokens do tema atual:

```text
primary
accent
card
muted
background
foreground
border
destructive
muted-foreground
```

Não introduzir uma nova paleta.

Preservar:

* identidade violeta do ERP;
* tema claro;
* tema escuro;
* gradiente discreto das mensagens próprias;
* mensagens recebidas em `card` ou `muted`;
* superfícies `chat-*` já existentes.

O chat deve manter identidade própria e não virar uma cópia literal do WhatsApp.

A inspiração no WhatsApp deve se limitar principalmente a:

* ações contextuais;
* botão dentro do balão;
* reação separada;
* limpeza visual da timeline.

---

# 17. ACESSIBILIDADE

Validar:

* botão de ações com `aria-label="Ações da mensagem"`;
* botão separado com `aria-label="Adicionar reação"`;
* reações com nomes acessíveis;
* `aria-pressed` na reação atual;
* menu acionável pelo teclado;
* foco tornando controles ocultos visíveis;
* `Esc` fechando menu ou seletor;
* retorno de foco ao gatilho correto;
* exclusão para todos mantendo `AlertDialog`;
* área mínima de toque;
* estados não representados somente por cor;
* player operável por teclado;
* foco visível nos dois temas;
* seleção touch com alternativa acessível;
* leitor de tela não anunciando controles duplicados.

Não ocultar controles acessíveis usando somente uma estratégia que também os remova da árvore de acessibilidade.

---

# 18. TESTES

Atualize ou crie testes para os comportamentos visuais e interativos.

Cobrir pelo menos:

## Botão de ações

* não fica visualmente exposto no estado normal do desktop;
* aparece em hover;
* aparece em `focus-within`;
* permanece visível enquanto o menu está aberto;
* fica dentro do balão;
* menu contém somente as ações permitidas;
* reação não aparece dentro do dropdown;
* mensagem excluída mostra apenas a ação válida.

## Botão de reação

* é separado do botão de ações;
* abre somente as quatro reações;
* mantém a reação atual destacada;
* selecionar outra substitui;
* selecionar novamente remove;
* permanece acessível por teclado;
* posiciona-se corretamente em mensagens próprias e recebidas.

## Touch

* tocar na mensagem revela os controles;
* tocar fora fecha;
* abrir menu mantém controles;
* tocar no player não aciona indevidamente a seleção;
* rolar a timeline não abre ações;
* tocar na citação continua navegando;
* retentativa continua funcionando.

## Regressão

Preservar testes de:

* envio;
* voz;
* player;
* resposta;
* busca da mensagem citada;
* edição;
* exclusão;
* reações;
* Realtime;
* não lidas;
* leitura;
* paginação;
* scroll;
* retentativa;
* Push;
* Presence.

---

# 19. VALIDAÇÃO VISUAL MANUAL

Validar pelo menos nos seguintes tamanhos:

```text
Desktop: 1440 × 900
Desktop compacto: 1024 × 768
Tablet: 768 × 1024
Celular: 390 × 844
Celular pequeno: 360 × 640
```

Validar nos temas:

```text
Claro
Escuro
```

Validar mensagens:

1. texto curto próprio;
2. texto curto recebido;
3. texto longo;
4. texto com várias linhas;
5. mensagem com citação;
6. mensagem editada;
7. mensagem excluída;
8. voz curta;
9. voz longa;
10. mensagem com uma reação;
11. mensagem com várias reações;
12. mensagem enviando;
13. mensagem com falha;
14. sequência de mensagens do mesmo autor;
15. primeira e última mensagem da timeline.

Validar interações:

1. hover no balão;
2. saída do hover;
3. foco por teclado;
4. menu aberto;
5. seletor de reações aberto;
6. toque no celular;
7. toque fora;
8. scroll;
9. player em reprodução;
10. teclado virtual aberto;
11. modo resposta;
12. modo edição;
13. modo gravação;
14. `prefers-reduced-motion`.

Se o projeto possuir Playwright ou fluxo de screenshots, gerar capturas para comparação.

---

# 20. CRITÉRIOS DE ACEITE

A tarefa estará concluída quando:

* o botão de ações estiver dentro do balão;
* ele não ficar permanentemente exposto no desktop;
* aparecer em hover, foco ou estado aberto;
* continuar acessível no celular;
* o botão de reação estiver separado;
* o botão de reação ficar ao lado da mensagem;
* mensagens próprias e recebidas posicionarem corretamente o botão;
* o dropdown não exibir a barra de reações;
* o seletor separado tiver somente ❤️, 👍, 😄 e 😢;
* os chips de reações aplicadas estiverem visualmente refinados;
* resposta citada estiver refinada;
* modo de resposta e edição estiver integrado ao composer;
* mensagens de voz e gravador estiverem refinados;
* mensagens excluídas tiverem estado visual coerente;
* painel do Web Push estiver refinado;
* o comportamento touch não depender de hover;
* teclado e leitor de tela continuarem funcionando;
* temas claro e escuro estiverem corretos;
* movimento reduzido for respeitado;
* paginação e scroll não forem alterados;
* nenhuma regra funcional ou contrato tiver sido quebrado;
* `docs/modulos/chat.md` tiver sido atualizado;
* testes, lint e build tiverem sido executados.

---

# 21. DOCUMENTAÇÃO

Atualize:

```text
docs/modulos/chat.md
```

A seção atual informa que o menu é um botão permanentemente ao lado do balão. Essa descrição ficará desatualizada.

Substitua-a pelo comportamento real implementado:

* botão de ações dentro do balão;
* visível por hover, foco, seleção touch ou menu aberto;
* botão de reação separado ao lado;
* seletor limitado às quatro reações;
* comportamento no desktop;
* comportamento touch;
* acessibilidade por teclado;
* movimento reduzido.

Se esta especificação for salva em arquivo, utilizar um caminho como:

```text
docs/chat_update/frontend-fase2.md
```

Adicionar referência a ela em:

```text
docs/modulos/chat.md
```

Não registrar como implementado algo que não tenha sido concluído.

---

# 22. ENTREGA

Ao finalizar, apresentar:

1. resumo das melhorias visuais;
2. arquivos criados;
3. arquivos alterados;
4. comportamento final do botão de ações;
5. comportamento final do botão de reação;
6. comportamento no desktop;
7. comportamento no celular/PWA;
8. melhorias em resposta citada;
9. melhorias em reações;
10. melhorias em edição e exclusão;
11. melhorias em voz;
12. melhorias no painel de Web Push;
13. testes executados;
14. resultado do lint;
15. resultado do build;
16. capturas ou validações visuais realizadas;
17. limitações encontradas;
18. confirmação da atualização de `docs/modulos/chat.md`.

Não pare apenas na análise ou no planejamento.

Implemente, teste, valide visualmente e documente o refinamento completo.
