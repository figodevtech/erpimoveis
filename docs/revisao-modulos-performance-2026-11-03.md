# Módulos e performance do ERP Imóveis — 03/11/2026

Atualização posterior: sessão autenticada fornecida pelo usuário e medição concluída em duas rodadas. Consulte [medicao-navegacao-2026-11-03.md](medicao-navegacao-2026-11-03.md). A limitação de ausência de sessão descrita na execução inicial abaixo foi resolvida; continuam pendentes os testes de gravação e as consultas financeiras.

## Resultado desta rodada

Conferidos os cinco módulos imobiliários e aplicadas correções locais de carregamento e consultas duplicadas. O código comum de performance foi comparado com o ERP Oficina disponível neste workspace; não houve acesso ao conteúdo de outro chat.

| Módulo | Página/API/menu presentes | Verificação e ajuste |
| --- | --- | --- |
| Proprietários | Sim | Contadores aguardam sessão/permissão; troca de tamanho da página dispara uma única busca; callback de consulta estável. |
| Imóveis | Sim | Mesmos ajustes de contadores/paginação; enriquecimento das relações e capas usa índices em memória. |
| Reservas | Sim | Removida consulta duplicada na troca de aba; troca de tamanho da página usa uma única busca; mudança de visualização cancela busca da lista em andamento; calendário carregado sob demanda. |
| Locações imobiliárias | Sim | Página usa o componente compartilhado, permissões e endpoint próprios; calendário deixou de ser importado diretamente no componente compartilhado. |
| Vendas imobiliárias | Sim | Mesma conferência estrutural de locações; relações usam o enriquecimento otimizado. |

Página/API/menu presentes significa conferência estrutural no código, não execução de todas as operações com banco real. As permissões específicas dos módulos existem no catálogo e no encaminhamento do middleware; não foram alterados perfis nem concessões no banco.

## Comparação com ERP Oficina

Estes arquivos estavam idênticos nas duas bases na comparação realizada:

- `src/lib/config-request.ts` — compartilhamento de configuração.
- `src/lib/shared-lookup.ts` e `src/lib/ttl-cache.ts` — deduplicação/cache com prazo.
- `src/app/api/_authz/user-access.ts` — carregamento conjunto de usuário/perfil/permissões.
- `src/app/(app)/layout.tsx` e componente de navegação `nav-main.tsx`.
- `next.config.ts` — configuração comum de build, PWA e cabeçalhos.

Essas otimizações já foram herdadas. Os ajustes desta rodada se concentram nas telas e serviços próprios do segmento imobiliário.

## Mudanças aplicadas

1. Os contadores de imóveis, proprietários e reservas só iniciam automaticamente quando a sessão está pronta e o usuário pode visualizar o módulo. Isso evita chamadas antes da autorização estar disponível; a autorização do servidor permanece obrigatória.
2. Tamanho da página: antes, o handler fazia uma busca e a atualização do limite disparava outra pelo efeito. Agora, a atualização do estado provoca uma única consulta pelo efeito.
3. Abas de reservas: o handler e o efeito faziam a mesma consulta. Agora, apenas o efeito busca após a mudança do filtro.
4. Callbacks de busca recebem os parâmetros explicitamente, sem depender de valores antigos do estado. As dependências dos efeitos foram ajustadas sem fazer a navegação de página reiniciar na página 1.
5. O calendário usa importação dinâmica na tabela ativa e no componente compartilhado. O indicador de carregamento tem `role="status"`. A leitura do calendário continua completa para o mês, sem limitar artificialmente a primeira página de reservas.
6. `data.ts` associa imóveis, clientes, proprietários e capas por `Map`, evitando buscas lineares repetidas a cada registro e geração repetida da URL da mesma capa. Galerias são agrupadas em uma passagem, mantendo a ordem e os filtros de privacidade existentes. Não foram alterados contratos públicos nem removidas fotos das respostas.
7. A ferramenta `perf:navigation` agora mede por padrão imóveis, proprietários, reservas, locações e vendas imobiliárias, além dos módulos comuns. Foram removidas das rotas padrão ordens, veículos e agendamentos da oficina.

## Validação

- Antes das alterações: 2.764 testes de negócio passaram; TypeScript sem erros.
- Depois das alterações: 2.767 testes de negócio passaram, incluindo três novos testes de enriquecimento/galeria: associação correta entre registros, preservação da capa, ausência de anexos privados, comportamento com relações ausentes e propagação de falha do banco.
- Os quatro testes da ferramenta de navegação passaram com navegador e servidor sintético, incluindo espera por API lenta, navegação SPA, validação da sessão e restrição da origem local.
- TypeScript completo passou após as alterações de aplicação; a posterior renomeação de uma variável local do teste não altera seu contrato.
- ESLint dos oito arquivos de código alterados passou com `--max-warnings=0`.
- `git diff --check` passou.
- Checklist React: dependências dos hooks, consultas condicionais, cancelamento, ausência de cache global de dados do usuário e carregamento sob demanda revisados.

Os testes do medidor não equivalem a medições reais do ERP. Não havia sessão autenticada de performance salva em `playwright/.auth` nesta cópia. Não foram registrados números de redução de latência nem executadas gravações de teste no banco.

## Medição real preparada

No diretório `erpimoveis`, com o ERP rodando em localhost:

```powershell
npm.cmd run perf:login
npm.cmd run perf:navigation -- --rounds=2 --budget=5000
```

O primeiro comando abre o navegador para login e salva a sessão apenas localmente. O segundo usa as rotas imobiliárias atualizadas. Se a aplicação usar outra porta, passar `--url=http://localhost:PORTA` em ambos. Usar uma conta de homologação com acesso às rotas avaliadas; os scripts rejeitam destinos externos.

## Pendências que impedem declarar todo o ERP validado

- Autorizações financeiras de reservas ainda precisam da projeção uniforme por permissão descrita na revisão inicial.
- Extratos continuam percorrendo o histórico e possuem seções limitadas a 1.000 registros. Corrigir preservando os conceitos de saldo atual e saldo do período.
- Contadores ainda fazem várias contagens exatas no banco. Medir antes de substituir por agregação SQL e confirmar tratamento de erros.
- A consulta de fotos ainda busca o conjunto de fotos dos imóveis da página: a otimização em memória não reduz o volume retornado pelo banco. Avaliar projeção específica de capa e paginação.
- Busca pública de disponibilidade e portal do proprietário têm os custos descritos no relatório inicial, fora desta rodada focada nos módulos internos.
- Validar com usuários de permissões distintas e dados de homologação os fluxos de criação/edição, reserva, cancelamento, check-in/out, recebimentos e repasses. Os testes unitários não certificam RLS aplicado nem concorrência no ambiente real.

Nenhuma migration, perfil de acesso, credencial ou configuração de produção foi alterada nesta rodada.
