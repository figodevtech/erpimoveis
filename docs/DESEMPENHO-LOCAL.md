# Desempenho no desenvolvimento local

## Executar

Use Node.js 24 e `npm run dev`. O desenvolvimento usa Turbopack, estavel no
Next.js 15; a build de producao continua usando Webpack e o plugin PWA.
No PowerShell com scripts bloqueados, use `npm.cmd run dev`.
Para investigar incompatibilidades com o compilador, use `npm run dev:webpack`.
Pare o servidor anterior antes de trocar de modo.

O Tailwind procura classes somente em `src`, relativo a `src/app/globals.css`.
Se componentes do ERP forem movidos para fora de `src`, registre suas pastas
com `@source` nesse CSS. Os sites independentes tem suas proprias configuracoes.
Os limites de memoria e CPU da build foram mantidos somente para producao.

## Medicao em 26/10/2026

Windows, Node 24.18.0, Next.js 15.5.14, porta 3100. Uma execucao de cada
configuracao, com diretorios de build novos e separados; tempos sujeitos a
variacao de disco, rede e caches do sistema. Requisicoes HTTP sem autenticacao.

| Medida | Antes | Depois |
| --- | ---: | ---: |
| Servidor pronto | 3,8 s | 3,4 s |
| Compilacao de /login (log Next.js) | 10,2 s | 6,3 s |
| Primeira resposta de /login | 13,54 s | 7,37 s |
| Segunda resposta de /login | 0,48 s | 0,57 s |

A primeira resposta ficou aproximadamente 46% mais rapida nesta amostra.
Nao houve melhora na segunda resposta. Ambos retornaram HTTP 200.
Com os ajustes, `/api/auth/session` retornou 200 e `/ordens` retornou 307
para autenticacao. Nao foi validada a navegacao autenticada ou a build completa.

O scanner do Tailwind encontrou 5.139 arquivos e 56.130 candidatos a classes
na raiz, contra 2.196 arquivos e 32.086 candidatos em `src`. A raiz incluia
regras de agentes, SQL, documentacao, scripts e outros sites.
O Webpack registrou `Unable to snapshot resolve dependencies`, impedindo
salvar seu cache. A causa especifica dessa falha nao foi determinada.

## Gargalo adicional observado

As consultas de imagens e logo do login ao Supabase falharam com `ECONNRESET`
nas duas configuracoes, neste ambiente. Isso nao comprova falha na rede do
usuario. O login aguarda essas consultas no servidor e, quando existe imagem,
ainda verifica a URL por HEAD/GET sem timeout explicito. Portanto, problemas
de rede podem atrasar a pagina mesmo com a compilacao resolvida.

Se telas continuarem lentas depois de compiladas, compare o tempo de
compilacao nos logs com a duracao das APIs na aba Network do navegador,
principalmente `/api/config` (que bloqueia a montagem inicial do shell),
as APIs da tela e as consultas ao Supabase. Isso separa o custo do compilador
do custo de rede/banco sem desabilitar autenticacao ou permissoes.

## Referencias

- https://nextjs.org/docs/15/app/api-reference/turbopack
- https://tailwindcss.com/docs/detecting-classes-in-source-files

## Navegacao entre modulos

Se o deploy e rapido e apenas o localhost e lento ao abrir telas novas, a
compilacao sob demanda e uma suspeita principal. No desenvolvimento, cada
rota pode precisar ser compilada na primeira visita. Em producao esse trabalho
ja ocorreu durante a build. Compare a primeira e a segunda visita e os logs
`Compiling` / `Compiled` antes de atribuir a demora ao banco.

Foram separados os seguintes carregamentos:

- Radio e biblioteca HLS: carregados apenas quando a preferencia habilita o player.
- Chat: telas internas carregadas ao acessar o painel, mantendo provider,
  conexao em tempo real e indicador de mensagens ativos.
- Dashboard: cada aba carrega seu modulo quando montada pelo TabsContent.
- Ordens: formularios de criar/editar/orcamento, detalhes da OS, pagamento e
  emissao fiscal carregados no primeiro uso. Os dialogos permanecem montados
  depois disso para preservar estado e animacoes de fechamento.

Analise estatica dos imports locais de runtime, excluindo imports de tipos,
pacotes externos e caminhos de `import()` dinamico:

| Entrada | Modulos locais antes | Modulos locais depois |
| --- | ---: | ---: |
| Shell compartilhado | 64 | 46 |
| Central do chat | 43 | 22 |
| Dashboard | 349 | 5 |
| Gerenciador de Ordens | 357 | 72 |

Esses numeros nao representam tamanho do bundle, tempo medido de navegacao
ou a quantidade final de modulos carregados: a aba inicial do dashboard e
carregada imediatamente ao montar, por exemplo. Medem somente as dependencias
estaticas que deixaram de ser exigidas diretamente pelas entradas.
O primeiro uso de uma funcao adiada pode mostrar `Carregando formulario...`
enquanto baixa/compila seu modulo.

Validacao: ESLint dos componentes alterados, testes existentes de Ordens e
Chat, e verificacao TypeScript dos arquivos alterados e suas dependencias.
A navegacao autenticada no navegador ainda nao foi medida.

Para comparar com o comportamento do deploy no proprio computador, execute
`npm run build` e depois `npm start`, com o servidor de desenvolvimento parado.
Esse modo serve para uso/teste local da versao otimizada; alteracoes de codigo
exigem outra build. Durante a programacao, continue usando `npm run dev`.

Referencia para os carregamentos adiados:
https://nextjs.org/docs/app/guides/lazy-loading
