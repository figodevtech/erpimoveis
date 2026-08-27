# IMPLEMENTAÇÃO — CENTRAL OPERACIONAL EM TEMPO REAL — ERP OFICINA

## PROJETO

https://github.com/figodevtech/erpoficina

---

# OBJETIVO

Criar uma nova tela full-screen denominada:

CENTRAL OPERACIONAL

A tela deve funcionar como uma central visual de acompanhamento do ERP em tempo real, inspirada conceitualmente em dashboards de "command center" onde diferentes áreas da empresa são representadas como nós conectados a um núcleo central.

A experiência deve transmitir que o ERP está "vivo":

- eventos reais acontecendo;
- módulos reagindo visualmente;
- valores mudando;
- partículas percorrendo conexões;
- novos eventos entrando em um feed;
- alertas surgindo;
- indicadores sendo atualizados;
- tudo sincronizado com dados reais do ERP.

A referência visual é:

dark command center
+
rede de módulos conectados
+
glows discretos
+
fluxos luminosos
+
event feed lateral
+
microanimações
+
dados reais em tempo real

IMPORTANTE:

Não copiar literalmente outro sistema ou dashboard.

Criar uma identidade própria coerente com o ERP Oficina.

---

# PRINCÍPIO FUNDAMENTAL

Esta tela NÃO deve ser uma animação decorativa.

Toda animação importante deve representar algum acontecimento real do ERP.

Exemplos:

- venda confirmada;
- pagamento recebido;
- OS aberta;
- OS iniciada;
- OS finalizada;
- produto movimentado;
- estoque baixo;
- NF-e autorizada;
- NF-e rejeitada;
- NFS-e autorizada;
- conta paga;
- nova conta a pagar;
- recebimento PIX;
- movimentação financeira.

Não criar partículas aleatórias simulando atividade inexistente.

Pode haver animações ambientais discretas em estado idle, mas os pulsos e fluxos principais devem corresponder a eventos reais.

---

# 1. SEGURANÇA ANTES DE ALTERAR

Antes de modificar qualquer arquivo:

git status
git branch --show-current

Não sobrescrever alterações existentes.

Não trocar de branch sem informar.

Não executar reset destrutivo.

Não remover código existente para facilitar a implementação.

---

# 2. NÃO SUBSTITUIR TELAS EXISTENTES

Preservar integralmente:

/dashboard

/acompanhamento

/acompanhamento-financeiro

A nova Central Operacional é uma experiência adicional.

Criar preferencialmente:

src/app/(app)/(full)/central-operacional

rota:

/central-operacional

A Central deve utilizar o modelo full-screen já empregado pelas telas de acompanhamento.

Ela não deve ficar limitada pelo layout normal com sidebar/header tradicional enquanto estiver em modo operacional.

Adicionar uma forma apropriada de acessar a Central Operacional pelo ERP, respeitando:

- sidebar atual;
- permissões;
- padrão visual;
- estrutura existente.

Não quebrar acesso às telas atuais.

---

# 3. LEITURA OBRIGATÓRIA

Antes de implementar, mapear a arquitetura real do projeto.

Ler integralmente, no mínimo:

package.json

src/app/globals.css

src/app/(app)/(pages)/ClientAppShell.tsx

src/app/(app)/(pages)/dashboard/page.tsx

src/hooks/use-realtime-tabelas.ts

src/app/(app)/(full)/acompanhamento/page.tsx
src/app/(app)/(full)/acompanhamento/layout.tsx
src/app/(app)/(full)/acompanhamento/components/board.tsx
src/app/(app)/(full)/acompanhamento/ui/painel.tsx
src/app/(app)/(full)/acompanhamento/ui/os-tile.tsx
src/app/(app)/(full)/acompanhamento/lib/*

src/app/(app)/(full)/acompanhamento-financeiro/page.tsx
src/app/(app)/(full)/acompanhamento-financeiro/layout.tsx
src/app/(app)/(full)/acompanhamento-financeiro/ui/painel-financeiro.tsx
src/app/(app)/(full)/acompanhamento-financeiro/ui/cobranca-tile.tsx
src/app/(app)/(full)/acompanhamento-financeiro/lib/*

Também localizar e analisar:

- sidebar;
- permissões;
- configuração de rotas;
- Supabase;
- APIs de vendas;
- APIs de OS;
- financeiro;
- transações;
- fluxo de caixa;
- contas a pagar;
- estoque;
- movimentações;
- NF-e;
- NFS-e;
- chat Realtime;
- autenticação Realtime privada;
- JWT/token Realtime;
- migrations;
- modelos/tabelas relevantes.

Pesquisar particularmente:

src/lib/chat/realtime-token.ts

e toda a infraestrutura associada ao Realtime privado do chat.

O objetivo é reutilizar os conceitos seguros existentes em vez de liberar tabelas diretamente para anon.

---

# 4. IMPORTANTE SOBRE O REALTIME ATUAL

Não assumir que:

useRealtimeTabelas()

é Realtime verdadeiro.

Analisar sua implementação.

Atualmente ele funciona como atualização periódica/polling para evitar abrir SELECT anônimo nas tabelas.

Isso é aceitável nas telas existentes.

Para a Central Operacional, entretanto, precisamos de uma experiência próxima de tempo real.

Objetivo desejado:

ação no ERP
→ backend conclui operação
→ evento operacional seguro
→ Central recebe evento
→ interface reage imediatamente

Não liberar:

SELECT amplo para anon

apenas para habilitar Supabase Realtime.

Não enfraquecer RLS.

Não expor tabelas privadas no navegador.

---

# 5. ARQUITETURA DE EVENTOS OPERACIONAIS

Criar uma arquitetura centralizada para eventos da Central Operacional.

Não espalhar lógica visual dentro das APIs.

Criar uma abstração semelhante a:

emitirEventoOperacional(...)

ou equivalente coerente com os padrões do projeto.

Exemplo conceitual:

{
  id: "...",
  tipo: "PAGAMENTO_RECEBIDO",
  modulo: "FINANCEIRO",
  entidade: "ORDEM_SERVICO",
  entidadeId: 1845,
  titulo: "Pagamento recebido · OS #1845",
  descricao: "PIX",
  valor: 850,
  criadoEm: "...",
  metadata: {}
}

Criar contratos tipados.

Não utilizar `any` para o domínio principal.

---

# 6. EVENTO OPERACIONAL NÃO É FONTE DE VERDADE

REGRA CRÍTICA:

A Central Operacional é uma visualização.

Ela NÃO deve passar a controlar:

- estoque;
- financeiro;
- vendas;
- OS;
- fiscal;
- contas;
- pagamentos.

As tabelas e regras atualmente existentes continuam sendo as fontes de verdade.

O sistema de eventos serve para:

- sinalizar mudanças;
- alimentar o feed;
- disparar animações;
- reconstruir atividade recente;
- sincronizar visualmente a central.

Nunca alterar regra funcional para atender o dashboard.

---

# 7. PERSISTÊNCIA DO FEED

Preferencialmente permitir que os últimos eventos sejam recuperados ao abrir/recarregar a tela.

Analisar a arquitetura antes de decidir o mecanismo.

Se for necessário criar persistência específica de eventos:

criar migration adequada.

Exemplo conceitual:

evento_operacional

campos possíveis:

id
tipo
modulo
entidade_tipo
entidade_id
titulo
descricao
valor
metadata
created_at

A tabela NÃO deve duplicar estado dos módulos.

Ela funciona como event log visual.

Aplicar:

- índices necessários;
- retenção razoável;
- isolamento por instalação/tenant;
- segurança;
- autorização.

Não criar tabela global misturando empresas.

Se o projeto já possuir mecanismo de auditoria/eventos equivalente, reutilizá-lo em vez de criar estrutura duplicada.

---

# 8. REALTIME PRIVADO

Construir um canal privado da Central Operacional.

Reaproveitar, quando tecnicamente apropriado, a estratégia segura utilizada pelo chat:

- autenticação privada;
- JWT/token;
- renovação;
- reconexão;
- não depender de liberar tabela para anon.

Criar algo conceitualmente equivalente a:

private:operational:<tenant>

ou nomenclatura apropriada.

Não permitir que uma instalação receba eventos de outra instalação.

Tratar:

- conexão;
- reconexão;
- token expirado;
- aba voltando do background;
- perda temporária de internet;
- duplicidade;
- eventos fora de ordem;
- retries.

---

# 9. RECONCILIAÇÃO

Realtime não deve ser o único mecanismo de consistência.

Além dos eventos instantâneos, a Central deve periodicamente buscar um snapshot agregado das informações.

Exemplo:

a cada 30–60 segundos

ou ao:

- reconectar;
- recuperar foco;
- restaurar conexão.

Esse snapshot serve para corrigir eventuais eventos perdidos.

Não utilizar polling agressivo.

Objetivo:

Realtime
+
reconciliação eventual

---

# 10. EVENTOS MÍNIMOS DA PRIMEIRA VERSÃO

Mapear os fluxos reais antes de instrumentar.

Implementar, quando existentes no ERP:

## ORDENS DE SERVIÇO

OS_CRIADA
OS_INICIO_EXECUCAO
OS_FINALIZADA
OS_CANCELADA
OS_AGUARDANDO_PAGAMENTO

## VENDAS

VENDA_CRIADA
VENDA_CONFIRMADA
VENDA_CANCELADA

## FINANCEIRO

PAGAMENTO_RECEBIDO
TRANSACAO_CRIADA
TRANSACAO_PAGA
PIX_RECEBIDO

## ESTOQUE

ESTOQUE_ENTRADA
ESTOQUE_SAIDA
ESTOQUE_BAIXO

## FISCAL

NFE_EMISSAO_INICIADA
NFE_AUTORIZADA
NFE_REJEITADA

NFSE_EMISSAO_INICIADA
NFSE_AUTORIZADA
NFSE_REJEITADA

## CONTAS A PAGAR

CONTA_CRIADA
CONTA_PAGA
CONTA_VENCIDA

Não inventar eventos que o ERP não consegue determinar de maneira confiável.

---

# 11. EVITAR EVENTOS DUPLICADOS

Mapear cuidadosamente os fluxos.

Uma única venda não pode gerar cinco eventos `VENDA_CONFIRMADA` devido a:

- retry;
- render;
- atualização otimista;
- callback duplicado;
- webhooks repetidos.

Quando necessário, adicionar estratégia de:

event key

ou

idempotency key

Exemplo conceitual:

VENDA_CONFIRMADA:4816

Não alterar a idempotência dos módulos existentes.

---

# 12. SNAPSHOT DA CENTRAL

Criar uma API agregadora específica para o dashboard.

Exemplo conceitual:

GET /api/central-operacional/snapshot

Ela deve retornar apenas dados necessários para a Central.

Não fazer o frontend executar dezenas de requests independentes em loop.

Exemplo conceitual:

{
  meta: {
    atualizadoEm,
    status
  },

  geral: {
    usuariosAtivos,
    operacoesHoje,
    osAtivas
  },

  vendas: {...},
  ordens: {...},
  financeiro: {...},
  estoque: {...},
  fiscal: {...},
  contasPagar: {...},

  eventosRecentes: [...]
}

Evitar N+1.

Evitar carregar milhares de registros para contar no browser.

Fazer agregações no servidor.

---

# 13. LAYOUT PRINCIPAL

A tela deve ocupar aproximadamente:

100dvh
100% width

A composição desktop deve seguir:

┌────────────────────────────────────────────────────────────────────────────┐
│ HEADER OPERACIONAL                                                        │
├─────────────────────────────────────────────────┬──────────────────────────┤
│                                                 │                          │
│                                                 │ FLUXO DE EVENTOS         │
│              MAPA OPERACIONAL                   │                          │
│                                                 │ lista em tempo real      │
│                                                 │                          │
│                                                 │                          │
├─────────────────────────────────────────────────┴──────────────────────────┤
│ TICKER / LINHA DE ATENÇÕES                                                │
└────────────────────────────────────────────────────────────────────────────┘

O mapa operacional deve ser o elemento visual dominante.

---

# 14. HEADER

Criar header compacto.

Exemplo:

CENTRAL OPERACIONAL · FLUXO EM TEMPO REAL

USUÁRIOS ATIVOS
08

OPERAÇÕES HOJE
153

OS ATIVAS
12

PRECISÃO / STATUS
SINCRONIZADO

13:17:51

● AO VIVO

Adicionar controles discretos:

[ tela cheia ]

[ ocultar valores ]

[ pausar animações ]

[ sair ]

Não criar header enorme.

---

# 15. NÚCLEO CENTRAL

Elemento principal:

ERP OFICINA
NÚCLEO OPERACIONAL
● ORQUESTRANDO

O núcleo deve:

- ficar centralizado;
- possuir destaque visual;
- ter brilho suave;
- ter anéis concêntricos discretos;
- pulsar levemente;
- funcionar como origem/destino visual das conexões.

Não exagerar em neon.

O resultado deve parecer software corporativo premium, não interface cyberpunk de jogo.

---

# 16. NÓS

Criar inicialmente seis nós:

VENDAS
ORDENS DE SERVIÇO
FINANCEIRO
CONTAS A PAGAR
ESTOQUE
FISCAL

Distribuir radialmente ao redor do núcleo.

Exemplo aproximado:

                     VENDAS
                       │
                       │
        FISCAL ─────── NÚCLEO ─────── FINANCEIRO
                    ╱    │    ╲
                   ╱     │     ╲
             ESTOQUE    OS     CONTAS A PAGAR

A posição pode ser adaptada para melhor composição visual.

---

# 17. INFORMAÇÕES DOS NÓS

Cada nó deve mostrar:

ícone
nome
estado operacional
indicador principal

Exemplos:

VENDAS
● PROCESSANDO
R$ 64.014,25

FINANCEIRO
● CONCILIANDO
R$ 181.980,09

ORDENS
● EXECUTANDO
12 OS

ESTOQUE
● MOVIMENTANDO
31 mov. hoje

FISCAL
● OPERACIONAL
3 NF-e hoje

CONTAS A PAGAR
● PROGRAMANDO
R$ 29.750,78

Usar informações reais.

---

# 18. STATUS DINÂMICOS

Não manter todos os módulos permanentemente dizendo "PROCESSANDO".

Estados devem reagir à situação real.

Exemplos:

VENDAS

● OPERACIONAL
● PROCESSANDO

FINANCEIRO

● OPERACIONAL
● CONCILIANDO
● RECEBENDO

ESTOQUE

● OPERACIONAL
● MOVIMENTANDO
● ATENÇÃO

FISCAL

● OPERACIONAL
● EMITINDO
● ATENÇÃO

ORDENS

● OPERACIONAL
● EXECUTANDO

Após um evento temporário, retornar ao estado estável.

---

# 19. CONEXÕES VISUAIS

Utilizar preferencialmente:

SVG

para desenhar as conexões entre núcleo e nós.

Não utilizar linhas DOM posicionadas manualmente se SVG simplificar responsividade.

As linhas devem ser:

- finas;
- discretas;
- parcialmente transparentes;
- compatíveis com dark/light se necessário.

---

# 20. PACOTES LUMINOSOS

Quando um evento acontecer, animar um pequeno pacote/partícula através da conexão correspondente.

Exemplo:

venda confirmada:

VENDAS
  ↓
NÚCLEO

pagamento recebido:

FINANCEIRO
  ↓
NÚCLEO

movimentação de estoque:

NÚCLEO
  ↓
ESTOQUE

Em eventos relacionados, permitir sequência visual:

VENDAS
→ NÚCLEO
→ FINANCEIRO

ou:

ORDENS
→ NÚCLEO
→ ESTOQUE

Não afirmar causalidade que o ERP não consegue determinar.

---

# 21. MOTION

O projeto já possui `motion`.

Utilizá-lo para:

- entrada do feed;
- atualização de números;
- pulso dos módulos;
- glow transitório;
- pequenas transições;
- mudança de estado.

Evitar instalar outra biblioteca de animação.

NÃO utilizar Three.js/WebGL nesta primeira versão.

Preferir:

React
+
Motion
+
SVG
+
CSS

---

# 22. IDLE

Quando nenhum evento estiver acontecendo:

- núcleo respira lentamente;
- anéis possuem movimento quase imperceptível;
- fundo pode possuir textura/partículas muito discretas;
- status AO VIVO continua ativo.

Não criar movimentação excessiva.

---

# 23. FUNDO

Criar fundo escuro elegante.

Algo conceitualmente próximo de:

slate/neutral muito escuro
+
gradientes radiais discretos
+
grid técnico quase invisível
+
pontos ocasionais

Não utilizar imagem pesada como background.

Evitar aparência genérica de template gamer.

---

# 24. CORES

Usar as cores como linguagem semântica.

Sugestão:

NÚCLEO
violeta/ciano do ERP

FINANCEIRO / RECEBIMENTOS
verde

VENDAS
âmbar

CONTAS A PAGAR / ERROS
vermelho ou coral

FISCAL
ciano

ESTOQUE
azul

ORDENS
violeta

Manter coerência com o tema existente.

Não criar dezenas de cores.

---

# 25. GLOW

Glows devem existir principalmente:

- ao redor dos nós;
- nas bordas;
- no núcleo;
- durante eventos.

Utilizar blur moderado.

Não deixar textos borrados.

Texto sempre deve permanecer nítido.

---

# 26. FLUXO DE EVENTOS

Na coluna direita:

FLUXO DE EVENTOS

mostrar contador:

38 hoje

Exemplo:

Pagamento PIX · OS #1845
A RECEBER · AGORA
+ R$ 850,00

Venda #493 confirmada
VENDAS · HÁ 4S
+ R$ 3.280,00

OS #1849 iniciou execução
ORDENS · HÁ 8S

NF-e #382 autorizada
FISCAL · HÁ 11S

Estoque atualizado · Pastilha
ESTOQUE · HÁ 15S
- 2 un.

---

# 27. ENTRADA DO FEED

Novos eventos entram pelo topo.

Utilizar animação semelhante a:

opacity 0 → 1
translateY -8 → 0

Itens existentes descem suavemente.

Não desmontar todo o feed ao chegar um evento.

Usar keys estáveis.

Limitar visualmente algo como:

8–12 eventos

dependendo da altura disponível.

Manter histórico maior apenas na memória/consulta, se necessário.

---

# 28. EVENTOS CLICÁVEIS

Quando a entidade tiver uma rota conhecida, tornar o evento clicável.

Exemplos:

OS → abrir OS
Venda → abrir venda
NF-e → abrir documento correspondente

Não criar links quebrados.

Quando não existir destino confiável:

não tornar clicável.

---

# 29. TICKER INFERIOR

Criar uma linha inferior de atenções.

Exemplo:

⚠ Estoque baixo · Pastilha dianteira — 2 un.
◆
OS #1850 · 2h43 em execução
◆
R$ 850 recebido agora
◆
NF-e #382 autorizada
◆
3 contas vencem hoje

Movimentação horizontal lenta.

Não transformar em marquee agressivo.

Pausar no hover, se apropriado.

---

# 30. ALERTAS CRÍTICOS

Quando ocorrer situação importante, elevar a prioridade visual.

Exemplos:

NF-e rejeitada
estoque zerado
conta vencida relevante
erro operacional

Possível comportamento:

FISCAL

● ATENÇÃO
NF-e #384 rejeitada

com:

- pulso vermelho;
- evento destacado;
- ticker destacando situação.

O alerta não deve desaparecer visualmente antes de o problema ser reconhecível.

Mas também não criar alarmes infinitos sem critério.

---

# 31. CONTADORES ANIMADOS

Quando valores mudarem:

R$ 18.200
→
R$ 19.050

animar suavemente a mudança.

Não fazer números piscarem.

Não contar caractere por caractere.

Priorizar legibilidade.

---

# 32. TEMPOS

Exibir:

agora
há 4s
há 27s
há 2min

Atualizar os tempos localmente sem consultar servidor por segundo.

Um único tick compartilhado é suficiente.

Não criar interval por componente.

---

# 33. MODO TV

A tela deve funcionar muito bem em:

1920x1080

e telas maiores.

Criar botão:

Tela cheia

utilizando Fullscreen API quando disponível.

No modo TV:

- maximizar mapa operacional;
- manter feed;
- esconder controles secundários;
- preservar saída de tela cheia.

---

# 34. OCULTAR VALORES

Adicionar:

Ocultar valores

Persistir preferência no navegador.

Quando ativo:

R$ ••••••

ou equivalente.

Não remover os indicadores completamente.

O comportamento pode aproveitar o conceito existente no acompanhamento financeiro.

---

# 35. PRIVACIDADE

Não mostrar CPF/CNPJ.

Não mostrar informações sensíveis desnecessárias.

Evitar mostrar telefone/endereço.

Nomes de clientes no feed devem ser usados somente se realmente agregarem valor.

Preferencialmente:

OS #1850

em vez de expor dados pessoais em uma TV.

---

# 36. RESPONSIVIDADE

Desktop é prioridade, mas a tela precisa funcionar no tablet.

Desktop grande:

mapa + feed lateral.

Tablet:

mapa central reduzido + feed lateral/abaixo.

Mobile:

não tentar simplesmente comprimir o grafo inteiro.

Pode adaptar para:

header
núcleo
cards dos módulos em grid
feed
ticker

Preservar o conceito sem tornar ilegível.

---

# 37. REDUCED MOTION

Respeitar:

prefers-reduced-motion

Nesse modo:

- remover partículas contínuas;
- remover grandes deslocamentos;
- manter apenas mudanças discretas de opacity;
- manter toda informação acessível.

---

# 38. PERFORMANCE

Meta:

manter animações próximas de 60 FPS em desktop moderno.

Não rerenderizar a tela inteira quando chega um evento.

Separar componentes.

Utilizar:

memo
useMemo
useCallback

somente onde trouxerem benefício real.

Não criar centenas de elementos animados.

Limitar quantidade simultânea de partículas.

---

# 39. ARQUITETURA DE COMPONENTES

Organizar a Central em componentes pequenos.

Estrutura sugerida:

src/app/(app)/(full)/central-operacional/
  page.tsx
  layout.tsx
  components/
    central-operacional.tsx
    operational-header.tsx
    operational-map.tsx
    operational-core.tsx
    operational-node.tsx
    operational-connections.tsx
    operational-particle.tsx
    event-feed.tsx
    event-feed-item.tsx
    operational-ticker.tsx
    operational-alert.tsx
    tv-controls.tsx
  hooks/
    use-operational-realtime.ts
    use-operational-state.ts
  lib/
    api.ts
    contracts.ts
    event-mapping.ts
    formatters.ts

Adaptar à convenção real do projeto.

Não criar arquivos gigantes de 1000+ linhas.

---

# 40. EVENT QUEUE

Não iniciar 20 animações ao mesmo tempo se vários eventos chegarem juntos.

Criar uma pequena fila visual.

Exemplo:

evento 1
0ms

evento 2
150ms

evento 3
300ms

evento 4
450ms

Os dados podem atualizar imediatamente.

Somente as animações são escalonadas.

---

# 41. EVENTOS SIMULTÂNEOS

Se cinco pagamentos forem processados ao mesmo tempo:

o valor do financeiro deve refletir o snapshot correto.

Não incrementar dinheiro ingenuamente no browser utilizando apenas:

valorAtual + evento.valor

pois isso pode gerar divergência.

Eventos comandam animações.

Snapshot/API comandam estado agregado confiável.

---

# 42. SOM

NÃO reproduzir som para todo evento.

Por padrão:

sem sons.

Se decidir manter recurso de alerta sonoro:

- deve ser opcional;
- desligado inicialmente;
- somente para eventos críticos;
- respeitar restrições do navegador.

Não reutilizar automaticamente a campainha das telas de acompanhamento.

---

# 43. ESTADO OFFLINE

Quando a conexão for perdida:

não fingir que está AO VIVO.

Alterar:

● AO VIVO

para algo como:

○ RECONECTANDO

ou:

○ OFFLINE

Não apagar snapshot anterior imediatamente.

Mostrar:

última sincronização: 10:42:31

Ao reconectar:

buscar snapshot completo
→ reconciliar estado
→ retomar canal realtime.

---

# 44. STATUS DE SINCRONIZAÇÃO

Implementar estados:

CONNECTING
LIVE
RECONNECTING
OFFLINE

Representação visual discreta no header.

Exemplo:

● AO VIVO

ou:

● RECONECTANDO

---

# 45. PERMISSÕES

A Central Operacional pode exibir:

- valores financeiros;
- fiscal;
- estoque;
- vendas.

Portanto não assumir que todo usuário pode visualizar tudo.

Mapear o sistema atual de permissões.

Respeitar permissões existentes.

Se o usuário não puder acessar financeiro:

não enviar dados financeiros apenas para escondê-los com CSS.

O servidor precisa respeitar a permissão.

O mesmo vale para:

fiscal
vendas
estoque
OS.

A Central deve adaptar os módulos disponíveis de acordo com o usuário.

---

# 46. MULTI-TENANT

Obrigatório preservar isolamento por instalação/empresa.

Nenhuma API, evento ou canal Realtime pode misturar:

empresa A
e
empresa B.

Validar tenant no servidor.

---

# 47. NÃO ALTERAR REGRAS FUNCIONAIS

Preservar integralmente:

- autenticação;
- autorização;
- vendas;
- financeiro;
- estoque;
- fiscal;
- OS;
- pagamentos;
- idempotência;
- migrations existentes;
- contratos atuais;
- webhooks;
- Telegram;
- push;
- chat;
- PWA;
- offline/reconexão;
- auditoria;
- regras multi-tenant.

Instrumentar os fluxos.

Não reescrevê-los desnecessariamente.

---

# 48. FALLBACK

Se a infraestrutura Realtime estiver indisponível:

Central ainda deve funcionar utilizando snapshot periódico.

Mas apresentar corretamente:

RECONECTANDO

e não:

AO VIVO.

---

# 49. ACESSIBILIDADE

Garantir:

aria-label nos controles;
contraste;
focus visible;
navegação por teclado;
tooltips apropriados;
informações não dependentes exclusivamente de cor.

Não usar somente:

verde = bom
vermelho = erro

sem texto correspondente.

---

# 50. DOCUMENTAÇÃO

Criar documentação específica.

Sugestão:

docs/modulos/central-operacional.md

Documentar:

- objetivo;
- rota;
- arquitetura;
- componentes;
- eventos;
- snapshot;
- realtime;
- autenticação do canal;
- reconexão;
- segurança;
- permissões;
- multi-tenancy;
- modos de tela;
- ocultação de valores;
- performance;
- fallback;
- como adicionar novos eventos;
- como adicionar novos módulos.

---

# 51. TESTES

Adicionar testes para partes críticas.

No mínimo:

## contratos

serialização/validação de evento.

## idempotência

não duplicar evento quando houver retry.

## event mapping

tipo do evento → módulo correto.

## permissões

usuário sem financeiro não recebe dados financeiros.

## tenant

eventos não cruzam instalações.

## snapshot

retorno correto dos agregados.

## realtime state

LIVE
OFFLINE
RECONNECTING.

## UI

novo evento entra no feed sem desmontar os anteriores.

## ocultar valores

valor não fica visível quando habilitado.

---

# 52. VALIDAÇÃO VISUAL

Testar pelo menos:

1920x1080
1440x900
1366x768
tablet
mobile

Verificar:

- textos cortados;
- nós sobrepostos;
- feed;
- ticker;
- fullscreen;
- zoom do navegador;
- dark mode;
- reduced motion.

Se o projeto possuir Playwright/capturas visuais, utilizar a estrutura existente.

---

# 53. EXPERIÊNCIA FINAL ESPERADA

Ao abrir:

/central-operacional

o usuário deve ver:

CENTRAL OPERACIONAL · FLUXO EM TEMPO REAL

● AO VIVO

No centro:

ERP OFICINA
NÚCLEO OPERACIONAL
● ORQUESTRANDO

Ao redor:

Vendas
Financeiro
Ordens
Estoque
Fiscal
Contas a Pagar

Na direita:

FLUXO DE EVENTOS

Embaixo:

linha de atenções.

---

# 54. EXEMPLO DE EXPERIÊNCIA REAL

Imagine que o usuário confirme uma venda.

O sistema realiza normalmente a operação existente.

Quando a operação for concluída:

1. Central recebe:

VENDA_CONFIRMADA

2. Nó VENDAS muda temporariamente para:

● PROCESSANDO

3. Vendas pulsa.

4. Uma pequena partícula sai de:

VENDAS

e percorre a conexão até:

NÚCLEO OPERACIONAL

5. Feed recebe no topo:

Venda #4816 confirmada
VENDAS · AGORA
+ R$ 2.628,45

6. Indicadores são atualizados.

7. Após alguns segundos:

VENDAS

retorna para:

● OPERACIONAL

Se depois for registrado pagamento:

FINANCEIRO pulsa separadamente.

Não simular os dois como um único evento se forem operações distintas.

---

# 55. EXEMPLO FISCAL

Quando iniciar emissão:

FISCAL
● EMITINDO

Se autorizada:

✓ NF-e #382 autorizada

nó recebe pulso ciano/verde.

Se rejeitada:

FISCAL
● ATENÇÃO

evento vermelho:

NF-e #382 rejeitada
FISCAL · AGORA

A rejeição real deve ser mostrada sem inventar mensagem técnica inexistente.

---

# 56. ESTILO

Palavras-chave:

premium
corporativo
tecnológico
minimalista
sofisticado
vivo
escuro
profissional
informativo

Evitar:

cyberpunk exagerado
gamer
neon excessivo
glassmorphism exagerado
gradientes excessivos
animações inúteis
textos pequenos demais
efeitos que prejudiquem leitura

---

# 57. NÃO INSTALAR DEPENDÊNCIAS SEM NECESSIDADE

O projeto já possui:

motion
lucide-react
Tailwind
React
Next.js

Usar a stack existente.

Somente instalar nova dependência se houver justificativa técnica concreta.

Não adicionar Three.js apenas para criar partículas.

---

# 58. CRITÉRIOS DE ACEITE

A tarefa somente está concluída quando:

[ ] `/central-operacional` existe.

[ ] Tela possui experiência full-screen.

[ ] Dashboard antigo permanece intacto.

[ ] Acompanhamento de OS permanece intacto.

[ ] Acompanhamento financeiro permanece intacto.

[ ] Existe núcleo central.

[ ] Existem pelo menos seis módulos representados.

[ ] Nós possuem indicadores reais.

[ ] Conexões são responsivas.

[ ] Eventos reais geram animações.

[ ] Feed recebe eventos dinamicamente.

[ ] Feed possui dados reais.

[ ] Existe ticker inferior.

[ ] Valores podem ser ocultados.

[ ] Existe fullscreen/Modo TV.

[ ] Existe indicação AO VIVO / RECONECTANDO / OFFLINE.

[ ] Realtime não exige liberar SELECT anon nas tabelas.

[ ] Existe reconciliação por snapshot.

[ ] Realtime respeita autenticação.

[ ] Realtime respeita tenant.

[ ] Dados respeitam permissões.

[ ] Eventos são idempotentes.

[ ] Eventos não alteram fonte de verdade.

[ ] Offline não é apresentado como AO VIVO.

[ ] Reconexão funciona.

[ ] `prefers-reduced-motion` é respeitado.

[ ] Layout funciona em 1920x1080.

[ ] Layout funciona em 1366x768.

[ ] Layout possui adaptação mobile.

[ ] Não existem erros TypeScript.

[ ] Lint relevante passa.

[ ] Build passa.

[ ] Testes novos passam.

[ ] Documentação foi criada/atualizada.

---

# 59. VALIDAÇÃO FINAL OBRIGATÓRIA

Antes de finalizar:

executar os testes relevantes.

Executar:

npm run lint

quando possível.

Executar:

npm run build

quando o ambiente permitir.

Não considerar concluído apenas porque a página renderiza.

Validar:

- funcionamento real;
- segurança;
- eventos;
- reconexão;
- responsividade;
- animações;
- performance.

---

# 60. ENTREGA

Ao finalizar, apresentar resumo objetivo contendo:

1. arquivos criados;
2. arquivos alterados;
3. migrations criadas, se houver;
4. eventos instrumentados;
5. arquitetura Realtime adotada;
6. estratégia de autenticação;
7. estratégia multi-tenant;
8. estratégia de idempotência;
9. API de snapshot;
10. componentes visuais criados;
11. testes executados;
12. resultado de lint;
13. resultado de build;
14. pontos que eventualmente ficaram para uma fase seguinte.

Não declarar que algo foi testado se não foi realmente executado.

Não mascarar warnings ou falhas.

---

# RESULTADO ESPERADO

A Central Operacional deve responder visualmente à pergunta:

"O que está acontecendo na minha empresa agora?"

O resultado final deve fazer o ERP parecer um sistema vivo, mostrando o fluxo real entre:

Vendas
Ordens
Financeiro
Estoque
Fiscal
Contas a Pagar

com dados reais, eventos reais, animações suaves e infraestrutura segura de tempo real.

O objetivo NÃO é apenas criar um dashboard bonito.

O objetivo é criar uma verdadeira:

CENTRAL OPERACIONAL DO ERP OFICINA.