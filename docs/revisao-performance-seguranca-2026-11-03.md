# Revisão inicial de performance e segurança — 03/11/2026

Atualização: a rodada seguinte de conferência e otimização dos módulos internos está em [revisao-modulos-performance-2026-11-03.md](revisao-modulos-performance-2026-11-03.md). Ela inclui alterações de código e resultados posteriores aos testes desta revisão inicial. O agrupamento de galerias em memória foi otimizado; o volume de fotos consultado permanece pendente.

## Escopo e limites

Revisão do código local do ERP imobiliário e da cópia irmã `../site-cespedesliving`, com foco nas APIs imobiliárias, autorização, publicação, arquivos, consultas financeiras e catálogo público. Esta é uma primeira rodada, não uma certificação de toda a aplicação: existem 469 arquivos em `src/app/api`, incluindo módulos herdados.

Não foram acessados bancos de produção, enviados e-mails, criadas reservas ou aplicadas migrations. Credenciais não foram reproduzidas. As conclusões abaixo são baseadas no código; latência, planos SQL, RLS efetivamente aplicado e comportamento com perfis reais ainda precisam de validação em ambiente de teste.

## Achados prioritários

### 1. Alta — respostas de reservas não aplicam uniformemente a proteção financeira

Evidência: `src/lib/imobiliario/internal-api.ts:83` define `stripPrivateFinance`, removendo `percentual_admin`, `cotacao_snapshot` e `beneficiario_futuro_id` para usuários sem `reservas:financeiro`. Essa proteção é aplicada em `customerReservations`, mas não na listagem principal (`:402`), no detalhe (`:526–536`) nem nos relacionamentos de proprietário/imóvel (`:412–415`, `:505–509`). A consulta de lista e `one` selecionam todas as colunas, usando o cliente administrativo.

Impacto: um usuário com `reservas:visualizar`, sem acesso financeiro, pode receber os campos protegidos por outros caminhos de consulta. A aba financeira escondida na interface não limita o JSON recebido. O snapshot da cotação também contém percentual de administração.

Correção proposta: definir uma projeção de reserva por permissão e reutilizá-la em listas, detalhes, relacionamentos e respostas de mutações. Preservar valores operacionais que sejam necessários à reserva; não remover indiscriminadamente todo valor monetário. Testar a mesma matriz de permissões em todos esses caminhos, inclusive objetos enriquecidos.

### 2. Alta — extrato lê todo o histórico e outras seções são truncadas

Evidência: `src/lib/imobiliario/finance.ts:43–58` percorre todos os movimentos em páginas sequenciais de 1.000 e aplica o período em JavaScript. `:60` limita transações a 1.000 sem paginação; `:66` faz o mesmo com lançamentos. A resposta não informa truncamento. As cobranças/transações não recebem o filtro de período usado nos movimentos.

Impacto: o custo cresce com todo o histórico, mesmo para uma consulta curta. Um registro pendente antigo pode desaparecer depois das primeiras 1.000 transações. Seções do mesmo extrato podem representar períodos diferentes.

Correção proposta: calcular saldo global e totais com agregações SQL separadas; filtrar e paginar o detalhe no banco. Definir explicitamente se cobranças pendentes são globais ou do período e refletir isso no contrato da API. Não aplicar simplesmente o filtro de período ao cálculo de saldo atual, pois isso mudaria o resultado financeiro.

### 3. Média — busca pública percorre dados globais antes de paginar os imóveis

Evidência: `src/lib/imobiliario/site-api.ts:62–99`, `:130–165` e `:224–250`. Destinos e comodidades percorrem o catálogo; a busca por datas carrega ocupações e tarifas do período para todos os imóveis e monta uma lista de exclusão na URL da consulta. Proprietários inativos também são consultados separadamente.

Impacto: consultas e bytes transferidos crescem com dados que não serão exibidos. A lista de exclusão pode produzir URLs muito grandes. Em busca com comodidades, a agregação do catálogo pode ser repetida.

Correção proposta: executar disponibilidade com `NOT EXISTS`/joins no banco e filtros de publicação/proprietário na mesma consulta; agregar destinos e comodidades no banco. Avaliar cache curto exclusivamente para metadados públicos, com invalidação após alterações. Cotação e confirmação continuam consultando a disponibilidade transacional atual.

### 4. Média — proteção pública contra abuso é parcial e por instância

Evidência: `src/lib/imobiliario/site-api.ts:12–37` usa um `Map` local. As chamadas em `:170`, `:180` e `:226` cobrem cotação, agenda e busca por datas, mas não toda leitura onerosa do catálogo, destinos e comodidades.

Impacto: o limite reinicia em novas instâncias e não é compartilhado entre elas. Requisições podem multiplicar o custo no banco. O tamanho de 5.000 do mapa é um gatilho para limpar entradas expiradas, não um limite rígido de memória.

Correção proposta: controle compartilhado ou limitação na borda, com tratamento consistente de IP do proxy e cobertura dos endpoints de custo elevado. Manter o segredo de encaminhamento do site apenas no servidor. A limitação é complementar às regras transacionais.

### 5. Atualizado após o pull — integração implementada; limite remanescente nos favoritos

A versão do site atualizada pelo usuário, commit `0b296d4`, substitui o diagnóstico da cópia anterior. O adaptador usa `/public/imoveis` e `/site/reservas`, envia o token do cliente e tem `api` como padrão. O portal usa `requireProfile`, e a sessão verifica usuário/e-mail confirmado. Os métodos antigos `demoAccess`/`dashboard` no adaptador não representam o fluxo real do portal.

A listagem principal usa `getFlatsPage` em `src/services/flats.ts`, preservando a paginação e o total. Portanto, a observação anterior de que o catálogo principal ficaria restrito aos primeiros 20 imóveis não se aplica à versão atual.

Limitação remanescente de prioridade média: `src/app/favoritos/page.tsx` recebe `getFlats()`, que usa `listFlats` sem paginação e descarta o total. Um favorito fora dos primeiros 20 resultados pode não ser encontrado pelo componente, embora o imóvel siga publicado. Validar com mais de 20 imóveis e consultar favoritos por IDs/slugs públicos com limite de lote, em vez de presumir que a primeira página contém o catálogo inteiro.

A integração está confirmada no código, não em uma execução com banco e usuários reais. Ainda falta validar cadastro/login, cotação, confirmação e isolamento de dados ponta a ponta.

### 6. Média — listagem de imóveis carrega galeria completa

Evidência: `src/lib/imobiliario/data.ts:41–59` busca todas as fotos dos imóveis da página, monta a galeria completa e filtra o conjunto novamente para cada imóvel. `next.config.ts:181` desativa globalmente a otimização de imagens no ERP. A geração de upload já converte as fotos públicas para WebP, portanto não se trata de ausência total de tratamento de imagem.

Impacto: páginas de cards recebem URLs e dados da galeria completa, mesmo quando usam apenas a capa. O custo aumenta com fotos por imóvel. Consultas sem paginação explícita de arquivos também devem ser verificadas contra o limite de linhas configurado no Supabase.

Correção proposta: separar projeção de card e detalhe; consultar capa por imóvel na lista e carregar galeria no detalhe, agrupando resultados por ID em vez de filtrar repetidamente. Medir bytes e dimensões antes de alterar a estratégia global de imagens.

### 7. Média — portal do proprietário multiplica as mesmas consultas

Evidência: `../site-cespedesliving/src/app/painel-proprietario/page.tsx` dispara dashboard, imóveis e extratos em paralelo. No ERP, `siteApi` consulta todos os imóveis do proprietário antes de distinguir as três rotas e chama `financeReport` tanto no dashboard como nos extratos.

Impacto: uma abertura de página consulta a lista de imóveis três vezes e percorre o histórico financeiro duas vezes, além das consultas de identidade/conta feitas por cada endpoint. Paralelizar as chamadas reduz espera serial, mas mantém o trabalho duplicado no banco.

Correção proposta: oferecer uma resposta consolidada do portal ou separar totais agregados de detalhes paginados. Compartilhar dados apenas dentro da requisição e do proprietário autenticado; não criar cache global de informações privadas. Medir número de consultas e latência com histórico crescente.

## Proteções presentes no código

- Autorização interna consulta usuário ativo e permissões no servidor, além do middleware.
- APIs privadas do site validam token com `auth.getUser`, conta ativa e vínculos para acesso a arquivos. Documentos usam URLs assinadas.
- Projeções públicas de imóveis e reservas selecionam os campos expostos, sem retornar diretamente o registro administrativo.
- A migration do domínio habilita RLS e revoga acesso de `anon`/`authenticated` às tabelas e funções imobiliárias; é necessário confirmar sua aplicação no ambiente real.
- O fluxo de reserva usa cotação, idempotência e regras de ocupação no banco. Sua resistência concorrente não foi testada nesta rodada.
- APIs/páginas autenticadas têm exclusões de cache no service worker; há cabeçalhos de segurança configurados no ERP.
- Arquivos `.env` reais não apareceram entre os arquivos rastreados consultados; isso não equivale a uma varredura de todo o histórico Git.

## Validação executada

- 15 testes passaram: schemas imobiliários, mensagens de validação e origem/emissão NFS-e com dependências simuladas.
- 22 testes passaram: segurança de login, segredo de webhook, prontidão da sessão e token de realtime.
- Após o pull, os 26 testes do site passaram (4 arquivos: adaptador de API, validação de autenticação, comodidades e datas/preços). Foi necessário executar fora da restrição de leitura que impedia o esbuild de inicializar. Uma tentativa intermediária com `configLoader=runner` falhou por `__dirname` indisponível; a configuração normal passou sem alterar o projeto.
- Não foram executados build completo, teste de carga, medição de navegador, auditoria atual de dependências ou ensaio com dados/perfis reais. Não há números de latência para afirmar melhoria ou conformidade de performance.
- Nenhuma regra de negócio ou configuração de produção foi alterada por esta revisão.

## Ordem de trabalho

1. Corrigir e testar projeções por permissão nas reservas.
2. Corrigir contrato/paginação do financeiro e testar saldo, filtros e volume acima de 1.000 registros.
3. Versão integrada localizada após o pull (`0b296d4`); validar os contratos ponta a ponta, incluindo favoritos fora da primeira página e isolamento entre proprietários.
4. Medir catálogo/calendário/financeiro em homologação; então otimizar SQL, agregações, imagens e controle de abuso.
5. Revisar o fluxo operacional completo: imóvel/publicação → cotação → reserva → recebimento → check-in/out → despesas/repasse → demonstrativo do proprietário.

Referência de autorização: [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html), validação de permissões em cada requisição e proteção no servidor.
