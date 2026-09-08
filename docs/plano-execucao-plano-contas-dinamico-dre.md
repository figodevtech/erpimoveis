# Plano de execução — plano de contas dinâmico com padrões do sistema e integração à DRE

**Data:** 07/09/2026.  
**Estado:** Entrega A concluída (Fases 0 a 4), validada nos quatro bancos com rollback e publicada na Demonstração. Clientes não publicados; nenhum banco ativado. O andamento fica em [registro de execução](execucao-plano-contas-dre.md).  
**Objetivo:** manter a criação dinâmica de contas e grupos personalizados, oferecer cadastros padrão e tornar a classificação da DRE consistente entre oficinas.  
**Base:** [revisão técnica da DRE](revisao-dre-20260907.md) e decisões da conversa com o responsável pelo projeto.

## 1. Instruções para quem executar

1. Ler este documento, a revisão da DRE e [lançamentos financeiros e comissões](lancamentos-financeiros-e-comissoes.md) antes de alterar o subsistema.
2. Conferir o estado atual do Git, as instruções locais aplicáveis e o histórico de migrações de cada banco. Os caminhos e números abaixo descrevem a revisão de 07/09/2026; verificar novamente antes de executar.
3. Preservar alterações de outros trabalhos. O workspace já contém mudanças de proteção das configurações e correções Stone não publicadas em todos os ambientes.
4. Implementar por entregas verificáveis, na ordem da seção 15. Não considerar o plano concluído apenas porque as contas padrão foram cadastradas.
5. Este documento não é um comando de implantação. Na execução futura, respeitar o escopo autorizado na sessão, apresentar resultados concretos e registrar implantação e validações por cliente.
6. Stone permanece em stand-by. Nenhuma etapa deste plano ativa, integra ou publica funcionalidades Stone.

## 2. Resultado esperado e decisões de produto

### 2.1 Modelo híbrido

O sistema terá os três elementos abaixo funcionando simultaneamente:

- **Grupos padrão:** fornecidos pelo sistema, com significado financeiro protegido e classificação padrão de resultado.
- **Contas padrão:** fornecidas pelo sistema, prontas para uso e identificadas visualmente.
- **Contas personalizadas:** criadas livremente pela oficina dentro de grupos válidos, herdando sua classificação ou recebendo uma exceção compatível e explícita.

Também será mantida a criação de **grupos personalizados**. Cada grupo novo deverá ter uma classificação padrão definida; grupos antigos sem definição continuarão visíveis na migração, identificados como pendentes.

Exemplo:

| Grupo | Conta | Origem do cadastro | Destino na DRE |
|---|---|---|---|
| Receitas de serviços | Serviços de oficina | Sistema | Receita de serviços |
| Receitas de serviços | Reparo de módulos | Oficina | Receita de serviços, herdada |
| Receitas de serviços | Programação | Oficina | Receita de serviços, herdada |
| Serviços especializados | Injeção eletrônica | Grupo e conta da oficina | Receita de serviços, definida no grupo |

A oficina não precisa conhecer códigos de linhas da DRE para criar uma conta. A tela deve explicar o efeito financeiro em linguagem simples.

### 2.2 Regras fixadas

1. Nome e código visual da conta não determinam sua classificação. A identidade de sistema será uma chave semântica permanente, diferente do ID de cada banco.
2. A estrutura de dois níveis já existente — grupo e conta — será preservada. Não criar uma árvore ilimitada de subcontas nesta entrega.
3. Contas personalizadas não serão convertidas em contas do sistema apenas por terem nome parecido.
4. Grupos padrão terão significado e classificação-base protegidos; nomes locais opcionais serão apenas apresentação. Alterações semânticas do catálogo exigirão uma nova versão.
5. Contas personalizadas poderão ser editadas e inativadas. Registros utilizados por transações ou eventos não serão apagados.
6. Conta padrão de uso manual poderá ser inativada quando não for referência obrigatória de uma integração. Referências automáticas essenciais exigirão substituição válida e atômica antes de inativar a conta anterior.
7. Contas padrão adicionais poderão ser disponibilizadas como opções, sem obrigar a oficina a visualizar centenas de contas que não utiliza.
8. Uma conta tem um destino de resultado efetivo por vigência. Rateio percentual entre linhas não faz parte desta implementação inicial; regras novas usarão 100%.
9. “Pendente de classificação” e “fora da DRE” são situações diferentes. Falta de informação nunca será convertida automaticamente em exclusão do resultado.
10. O padrão será comum; perfil fiscal, operações e detalhamento das contas continuarão específicos de cada oficina.

## 3. Escopo das entregas

### Entrega A — cadastro híbrido e classificação confiável

Inclui catálogo, grupos e contas personalizados, resolução por conta/grupo, validação de natureza, fila de pendências, explicação dos destinos, compatibilidade, simulação e migração por cliente. É a entrega principal para manter a criação dinâmica.

### Entrega B — cobertura dos ajustes e deduções existentes

Inclui integração dos ajustes financeiros já existentes, separação entre tributos sobre receita e sobre lucro, rastreabilidade, estornos e conciliação de lançamentos manuais equivalentes. Não executar retrospectiva automática.

### Entrega C — controle do histórico e reprodução dos relatórios

Inclui reclassificação assistida, vigência, fechamento e reabertura auditada de períodos e exportação fiel à apuração. Define quando o resultado está pronto para ser compartilhado.

### Fora do escopo de implementação automática

- Ativar ou publicar Stone.
- Recalcular comissões históricas ou mudar sua base e beneficiários.
- Mudar reconhecimento de receita de OS/vendas ou a etapa opcional de faturamento.
- Implantar um motor completo de apuração de DAS, IRPJ, CSLL ou demais tributos.
- Criar do zero módulos de patrimônio, depreciação ou devolução comercial.
- Alterar a política fiscal de custo das compras sem uma regra de negócio específica validada para a operação.
- Apagar contas, renumerar IDs ou fundir lançamentos financeiros existentes.

As dependências fora do escopo precisam aparecer como cobertura incompleta na DRE. A presença de uma conta padrão não significa que a origem do valor já seja automática.

## 4. Situação inicial que precisa ser preservada

Em 07/09/2026, os cadastros encontrados eram:

| Banco | Grupos | Contas |
|---|---:|---:|
| Demonstração | 15 | 197 |
| Demir | 9 | 108 |
| AlphaGarage | 0 | 0 |
| Garage Premium | 16 | 103 |

A mesma DRE soma `eventos_financeiros` ativos ou convertidos por competência. OS/vendas usam a origem do evento; avulsos usam uma linha persistida, hoje resolvida pelo grupo da conta.

Pontos de partida para os testes de regressão:

- A conferência anterior fechou 197 OS e 96 vendas contra seus eventos; os números deverão ser atualizados, sem tratá-los como valores fixos de testes automatizados.
- IRPJ/CSLL aparecem em deduções da receita no Demir por herança de grupo inadequada.
- Existem receitas/despesas sem classificação e contas “não identificadas” em grupos excluídos.
- Ajustes de recebimento não possuem eventos individuais de DRE no fluxo atual.
- O banco aceita mapeamentos `PLANO_CONTA`, mas o sincronizador de avulsos atual usa somente `PLANO_GRUPO`.

## 5. Catálogo padrão inicial

Criar um catálogo versionado em arquivo do repositório, aplicado por migrações idempotentes. As chaves abaixo são propostas para a implementação; não usar os números de IDs locais como identidade entre clientes.

| Chave de classificação | Grupo padrão sugerido | Conta inicial sugerida | Destino inicial |
|---|---|---|---|
| `RECEITA_PRODUTOS` | Receitas de produtos | Venda de peças | 1.1 |
| `RECEITA_SERVICOS` | Receitas de serviços | Serviços de oficina | 1.2 |
| `RECEITA_FRETE` | Fretes e outras receitas da atividade | Frete cobrado | 1.3 |
| `RECEITA_OPERACIONAL_OUTRA` | Outras receitas da atividade | Outras receitas operacionais | 1.3 |
| `TRIBUTO_RECEITA` | Tributos sobre receita | Tributos sobre vendas e serviços | 2.1 |
| `DEVOLUCAO_COMERCIAL` | Devoluções de vendas | Devoluções comerciais | 2.2, sem geração automática nova nesta entrega |
| `CANCELAMENTO_COMERCIAL` | Cancelamentos comerciais | Cancelamentos comerciais | 2.3, condicionado à política de reversão |
| `ABATIMENTO_COMERCIAL` | Abatimentos comerciais | Abatimentos concedidos | 2.4 |
| `DESCONTO_INCONDICIONAL` | Descontos comerciais | Descontos concedidos na operação | 2.5 |
| `CUSTO_MERCADORIA` | Custo de mercadorias | Mercadorias aplicadas/vendidas | 4.1 |
| `CUSTO_PRODUTO_FABRICADO` | Custo de produção | Produtos fabricados | 4.2, disponível somente se aplicável |
| `CUSTO_SERVICO` | Custos de serviços | Custos dos serviços | 4.3 |
| `CUSTO_MATERIAL_DIRETO` | Materiais diretos | Materiais aplicados | 4.4 |
| `CUSTO_MAO_OBRA_DIRETA` | Mão de obra direta | Mão de obra direta | 4.5 |
| `CUSTO_TERCEIRO_DIRETO` | Serviços terceirizados diretos | Terceirização direta | 4.6 |
| `CUSTO_DIRETO_OUTRO` | Outros custos diretos | Outros custos diretos | 4.7 |
| `TRIBUTO_COMPRA_RESULTADO` | Tributos de compra reconhecidos no resultado | Tributos de entrada | 4.8, preservando a política atual até revisão específica |
| `RECUPERACAO_COMPRA` | Recuperações de compras | Recuperações/desonerações | 4.9, redução do custo |
| `DESPESA_COMERCIAL` | Despesas comerciais | Despesas comerciais gerais | 6.1 |
| `DESPESA_ADMINISTRATIVA` | Despesas administrativas | Despesas administrativas gerais | 6.2 |
| `DESPESA_PESSOAL` | Despesas com pessoal | Salários e encargos | 6.3 |
| `DESPESA_OCUPACAO` | Ocupação e estrutura | Aluguel e ocupação | 6.4 |
| `DESPESA_TECNOLOGIA` | Tecnologia | Sistemas e tecnologia | 6.5 |
| `DESPESA_OPERACIONAL_OUTRA` | Outras despesas operacionais | Despesas operacionais gerais | 6.6 |
| `DEPRECIACAO` | Depreciação e amortização | Depreciação registrada | 8, valor manual até existir módulo próprio |
| `RECEITA_FINANCEIRA` | Receitas financeiras | Juros e rendimentos | 10.1 |
| `DESPESA_FINANCEIRA` | Despesas financeiras | Tarifas e encargos | 10.2 |
| `OUTRO_GANHO` | Outros ganhos | Ganhos em outras operações | Nova 11.1, com sinal positivo |
| `OUTRA_PERDA` | Outras perdas | Perdas em outras operações | Nova 11.2, com sinal negativo |
| `IRPJ_RESULTADO` | IRPJ sobre o resultado | IRPJ | 13.1 |
| `CSLL_RESULTADO` | CSLL sobre o resultado | CSLL | 13.2 |
| `TRIBUTO_LUCRO_OUTRO` | Outros tributos sobre o lucro | Tributos equivalentes | 13.3 |
| `PATRIMONIAL_SOCIOS` | Sócios e patrimônio | Aportes/distribuições | Fora da DRE, conforme operação identificada |
| `PATRIMONIAL_EMPRESTIMO` | Empréstimos e financiamentos | Principal de empréstimos | Fora da DRE; juros separados |
| `PATRIMONIAL_IMOBILIZADO` | Aquisição de imobilizado | Aquisição de equipamentos | Fora da DRE na aquisição |
| `TRANSFERENCIA_INTERNA` | Transferências internas | Transferência entre contas | Fora da DRE |
| `ADIANTAMENTO` | Adiantamentos | Adiantamentos de clientes/fornecedores | Fora da DRE no adiantamento |

Regras do catálogo:

- A coluna “destino” aponta para linhas de detalhe, nunca diretamente para um subtotal, fórmula ou grupo com filhos.
- Criar 11.1/11.2 em versão nova do template e conferir os sinais de 11 e 12. Receita bruta pela alienação de um ativo não será automaticamente tratada como ganho líquido.
- Grupos patrimoniais que aceitam entradas e saídas terão operações/naturezas permitidas explícitas; pró-labore, juros e perdas não herdam a exclusão do principal.
- Não criar um grupo padrão “Ajustes e estornos” que exclua tudo. O estorno acompanha a classificação do fato original.
- “A classificar” é uma condição operacional, não uma classificação definitiva. Uma conta de importação com esse nome continua gerando pendência.
- Contas fiscais detalhadas, como DAS, ISS, ICMS, IPTU e alvarás, poderão ser oferecidas pelo catálogo, mas a classificação deverá refletir a obrigação. Não colocar todos os tributos em um único grupo.
- Contas de comissão já utilizadas continuam com o tratamento atual até uma revisão específica; não reclassificar comissão de venda ou execução apenas por conter a palavra “comissão”.

## 6. Modelo de dados proposto

Os nomes novos abaixo são a referência de implementação. Se houver estrutura equivalente quando o trabalho começar, reutilizá-la e registrar a equivalência.

### 6.1 Classificações e apresentação

Criar `classificacoes_resultado` como catálogo de significado financeiro:

- `id`, `codigo_sistema` único e imutável, `nome`, `descricao`.
- `familia`, `naturezas_permitidas`, `tratamento` (`RESULTADO` ou `PATRIMONIAL`).
- `motivo_exclusao` obrigatório apenas para tratamento patrimonial.
- `versao_catalogo`, `ativo` e metadados de auditoria.

Uma classificação não armazena a fórmula da DRE. A apresentação continua pertencendo a `dre_template`, `dre_linha` e `dre_mapeamento`.

Ampliar `dre_mapeamento` com origem `CLASSIFICACAO_RESULTADO` e coluna `classificacao_resultado_id`, com FK ao catálogo. Para essa origem, a coluna nova é obrigatória e `origem_id`/`origem_valor` ficam nulos. Para as origens legadas, a coluna nova fica nula. Manter o legado durante a transição e validar os vínculos antigos por tipo: um `origem_id` polimórfico não está protegido por uma FK genérica.

### 6.2 Grupos e contas

Adicionar a `planosdecontagrupos`:

- `codigo_sistema` nullable e único quando preenchido.
- `origem_cadastro`: `SISTEMA` ou `PERSONALIZADO`.
- `classificacao_padrao_id`, apontando para o catálogo.
- `versao_registro` para concorrência otimista.

Adicionar a `planosdeconta`:

- `codigo_sistema` nullable e único quando preenchido.
- `origem_cadastro`: `SISTEMA` ou `PERSONALIZADO`.
- `classificacao_especifica_id` nullable: ausência significa herança do grupo.
- `versao_registro` para concorrência otimista.

Preservar `id`, `grupo_id`, `codigo`, `nome`, `ativo` e vínculos existentes. O código visual não será renumerado automaticamente. Em colisões entre um padrão e um cadastro existente, vincular mediante revisão ou criar um código visual livre; nunca sobrescrever o cadastro por nome.

As classificações específicas permitidas devem ser compatíveis com a família do grupo. Mudança entre receita, despesa e patrimônio requer mudar o grupo e passar pela análise de impacto, não uma exceção escondida.

### 6.3 Vigência e classificação dos lançamentos

Criar `plano_contas_classificacao_regra`, histórico de regras por grupo/conta, com:

- entidade e ID afetados;
- classificação e origem da regra;
- intervalo de vigência, com início inclusivo e fim exclusivo;
- versão, autor e justificativa.

Os campos do cadastro representam a configuração corrente; a regra histórica é a fonte para resolver uma competência. Atualizar ambos pela mesma operação transacional. Proibir sobreposição de intervalos da mesma entidade e impedir escrita direta que deixe as duas representações divergentes.

Usar colunas `grupo_id` e `conta_id` com FKs e CHECK exigindo exatamente uma preenchida. Não criar uma tabela de histórico com IDs sem referência válida às entidades.

Criar `eventos_financeiros_classificacao`, vinculada ao evento, para armazenar suas revisões de classificação:

- classificação, regra aplicada, conta/grupo de origem;
- template/linha resolvidos;
- resultado da resolução (`CLASSIFICADO`, `EXCLUIDO`, `PENDENTE`);
- motivo, versão e data da classificação;
- referência da reclassificação, quando houver.

Uma revisão vigente por evento, protegida por índice único parcial; revisões anteriores permanecem consultáveis e podem ser referenciadas pelo fechamento. A troca da revisão vigente e a auditoria são atômicas. Evitar cascatas que apaguem revisões utilizadas por um fechamento.

Preservar `dre_linha_id` como projeção compatível enquanto houver consumidores antigos. Não manter duas classificações editáveis independentes: a revisão vigente é a fonte e o serviço/RPC canônico atualiza a projeção junto dos metadados.

Ausência de evento não dispensa controle: a fila de integridade precisa conferir também transações elegíveis que não geraram evento, especialmente as excluídas pelas regras antigas.

### 6.4 Estado de implantação por oficina

Criar `dre_implantacao`, com um registro de controle por banco, separado da flag de faturamento de OS, contendo:

- estado: `LEGADO`, `PREPARACAO` ou `ATIVO`;
- versões de catálogo, classificador e template;
- data inicial de vigência do novo modelo;
- identificação da simulação/baseline e responsável pela ativação.

Instalações existentes começam em `LEGADO`. Preparar o catálogo não ativa a nova apuração. Uma instalação nova só entra em `ATIVO` depois que seed e verificações estiverem concluídos. A ativação é uma ação administrativa de implantação, não um botão cotidiano para alternar resultados de relatórios.

Em `PREPARACAO`, as propostas novas são simuladas sem substituir o cadastro/regra efetivos do legado. Não permitir que uma conta disponível no financeiro antigo dependa exclusivamente de um mapeamento que esse classificador ainda não entende. A aplicação das regras novas e a liberação de seu uso devem acompanhar a ativação transacional.

## 7. Resolução canônica da classificação

Implementar uma função de banco compartilhada para resolver a classificação. A aplicação pode antecipar mensagens, mas não terá uma segunda regra de cálculo.

Ordem de resolução:

1. Preservar a classificação histórica já gravada, salvo reclassificação explícita.
2. Para um fato novo, aplicar regra específica da operação/origem automática. Recebimento de documento não é um fato novo de receita.
3. Aplicar uma classificação manual explícita e autorizada quando a operação permitir ajuste; não permitir sobrepor a natureza de eventos automáticos protegidos.
4. Aplicar regra específica da conta válida na competência.
5. Aplicar regra herdada do grupo válida na competência.
6. Se não houver destino, registrar `PENDENTE` com motivo; não escolher “outras despesas” nem excluir por aproximação textual.

Depois de resolver o significado, determinar a linha no template correspondente. Falta de mapeamento, conflito de vigência ou mais de um destino válido são erros de integridade, não escolhas por `LIMIT 1`.

O resolvedor deve distinguir:

- natureza do movimento de caixa;
- papel na DRE, como dedução ou custo;
- sentido econômico de uma reversão;
- tratamento patrimonial.

Exemplo: desconto comercial pode ter natureza financeira `DESPESA` e papel `DEDUCAO`. Uma recuperação de compra pode usar `RECEITA` para abater custo. Esses casos explícitos não autorizam uma despesa administrativa a somar receita de serviços.

Usar a mesma resolução/projeção em `dre_somar_por_linha`, `dre_lancamentos_por_linha`, `dre_linha_da_transacao`, alertas, exportação e prévia da conta. Somar apenas o que estiver classificado, mostrando os valores pendentes separadamente e marcando o resultado como incompleto.

### Regras de gravação

- Novo lançamento manual avulso no modo ativo exige conta ativa e classificação compatível.
- Integração/importação sem classificação pode entrar somente por um fluxo explícito de pendência, com origem, responsável e motivo registrados. Isso não é uma autorização geral para as APIs ignorarem validações.
- Recebimentos e baixas de OS/venda preservam suas exceções atuais: não exigir uma conta avulsa para recriar receita já reconhecida.
- Mapeamentos `PLANO_CONTA` válidos existentes entram na migração; `CATEGORIA_TRANSACAO` será inventariado e convertido para regras explícitas ou pendências. Não anunciar suporte a uma regra ignorada pelo código.
- Regras novas de rateio diferentes de 100% serão recusadas nesta entrega. Encontrar rateio legado exige registrar o caso e tratá-lo antes da ativação, sem descartar percentuais.

## 8. Telas e experiência de uso

### 8.1 Configurações → Tipos → Planos de contas

Ampliar a tela atual em vez de criar outro cadastro concorrente:

- Manter agrupamento por grupo e busca por conta/código.
- Exibir badges “Sistema”, “Personalizada”, “Herdada” e “Pendente” quando aplicáveis.
- Mostrar o destino na DRE e explicar exclusões patrimoniais.
- Filtros: grupo, origem do cadastro, ativo/inativo e situação de classificação.
- Ações: nova conta, novo grupo, editar, inativar e consultar uso/histórico.
- Oferecer “Adicionar contas padrão” sem duplicar as já instaladas.

### 8.2 Formulário de conta

Campos básicos: nome, código opcional, grupo, descrição e situação. Ao escolher um grupo, apresentar a classificação herdada. A classificação específica fica em opção avançada, com destinos compatíveis e permissão adequada.

Ao trocar grupo/classificação, mostrar quantidade de vínculos afetados e vigência proposta. A operação comum vale para novos fatos conforme a vigência; alterações retroativas usam o fluxo de reclassificação.

Nome/código meramente visual não mudam resultado. Editar cadastro utilizado não dispara reconciliação histórica de eventos.

### 8.3 Formulário de grupo

Novo grupo personalizado exige nome, código, família e classificação padrão. O formulário explica que contas sem exceção herdarão esse destino.

Grupo padrão não permite editar sua chave ou mudar sua finalidade. Inativar um grupo com contas ativas exige inativar/mover as contas na mesma operação válida, ou a ação será recusada com explicação.

### 8.4 Lançamento financeiro

O seletor mostra contas padrão e personalizadas, com grupo e situação. Uma prévia informa “DRE: despesas administrativas”, “Fora da DRE: principal de empréstimo” ou o motivo da pendência.

Uma seleção incompatível é bloqueada antes do envio; a API repete a validação. Títulos existentes podem ser baixados sem reclassificação involuntária do principal.

### 8.5 DRE e fila de integridade

Adicionar painel com quantidade **e valor** de receitas, deduções, custos e despesas pendentes, além de exclusões que exigem revisão. Oferecer acesso a uma fila com filtros por período, origem, conta, grupo e motivo.

Cada item mostra origem, documento, competência, valor, classificação atual e ação disponível. A fila cobre grupo sem destino, conta sem regra, natureza incompatível, evento sem competência quando ela deveria existir, evento ausente e exclusão suspeita.

Não indicar “sem pendências” se alguma consulta falhar. Falhas de consulta retornam erro/estado indisponível. A DRE não pode aparentar completude com dados parciais.

## 9. Contratos de API e permissões

Preservar rotas atuais de grupos e contas, ampliando seus contratos de forma aditiva. Os nomes novos abaixo são propostas de rotas, não endpoints já existentes:

| Operação | Contrato previsto |
|---|---|
| Consultar grupos/contas | GETs atuais com origem, classificação herdada/específica/efetiva, situação e versão |
| Criar conta/grupo | POSTs atuais, validação da classificação e retorno do destino efetivo |
| Editar/inativar | PUT/PATCH atuais com versão anterior para detectar concorrência |
| Consultar catálogo | `GET /api/tipos/classificacoes-resultado` |
| Prever efeito de uma conta | `POST /api/dre/classificacao/preview`, sem gravação |
| Listar pendências | `GET /api/dre/pendencias`, paginado, com totais por motivo e natureza |
| Simular migração/reclassificação | `POST /api/dre/reclassificacoes/simular` |
| Aplicar lote revisado | `POST /api/dre/reclassificacoes/[id]/aplicar`, idempotente |
| Consultar uso de conta | GET específico ou expansão do detalhe, com quantidades agregadas |

Erros esperados: 400 para payload inválido, 401/403 para acesso, 404 para referência inexistente, 409 para versão/estado conflitante e 422 para classificação semanticamente incompatível. Omitir um campo no PATCH não apaga a classificação.

Reutilizar `configuracoes:editar` para manutenção do catálogo local e `financeiro:visualizar` para consulta da DRE. Aplicar `financeiro:editar` às correções de lançamentos. Mudança das regras estruturais ou ativação exige também a permissão de configurações. Fechar/reabrir períodos deverá ter capacidade administrativa explícita; não liberar a qualquer usuário apenas autenticado.

Conferir autorização nas próprias rotas e nas políticas/funções do banco, sem depender só de middleware ou botões. Novas funções privilegiadas devem ter `search_path` fixo e grants mínimos. Não criar acesso público a dados financeiros.

Após salvar cadastro/classificação, invalidar caches e atualizar seletores abertos. Ao retornar à aplicação, revalidar a versão. Uma tela desatualizada não poderá gravar parte do lançamento antes de descobrir um conflito.

## 10. Integração com as fontes de receita, custo e dedução

### 10.1 OS, vendas e recebimentos

- Preservar competência, receita bruta, frete, descontos, custos históricos e comissões.
- Preservar a idempotência e as regras de `ATIVO`, `CONVERTIDO` e `CANCELADO`.
- Não gerar nova receita por parcela, baixa, adiantamento ou pagamento múltiplo.
- Permitir associar uma conta padrão aos eventos para detalhamento, sem fazer a conta de recebimento substituir o significado de produto/serviço do documento.
- Evento convertido mantém sua identidade e valor comprometido. Correção de classificação não é autorização para recriar ou recalcular seu valor.

### 10.2 Ajustes financeiros existentes

Inventariar `tipos_ajuste_transacao` e classificar cada tipo considerando a natureza do título. “DESCONTO” ou “ACRESCIMO”, isoladamente, não informa o efeito no resultado.

| Ajuste | Tratamento a implementar |
|---|---|
| Taxa de recebimento/antecipação | Evento de despesa correspondente, segundo política documentada, sem reduzir novamente receita comercial |
| Juros/multa recebidos | Receita financeira separada do principal |
| Juros/multa pagos | Despesa correspondente separada da despesa-base |
| Desconto comercial da OS/venda | Preservar o evento existente de dedução; não duplicar pelo pagamento |
| Desconto financeiro concedido/obtido | Classificação específica conforme o fato; não usar automaticamente a linha de desconto incondicional |
| Retenção tributária | Distinguir compensação/crédito fiscal de despesa; deixar pendente se faltar essa regra |
| Abono de título | Analisar perda, acordo ou correção; abonar não cancela automaticamente a receita do documento |

Definir evento por ajuste com chave de origem estável, vínculo com `transacao_ajuste.id`, competência, valor, classificação e versão. Criar, alterar e remover um ajuste deve atualizar seu efeito no livro na mesma transação.

Escolher e documentar antes de codificar o evento de reconhecimento de cada tipo: obrigação incorrida, concessão do desconto, baixa ou antecipação. Data de inserção no banco não será um fallback silencioso para todos. Se faltar informação necessária, registrar pendência em vez de presumir uma competência contábil.

Em avulsos, separar o principal dos ajustes para não contar juros tanto em `transacao.valor` quanto no novo evento. Em documentos, preservar a exclusão do principal e reconhecer apenas o ajuste novo. Estornar o movimento deve reverter exatamente seu efeito anterior, inclusive depois de conversão ou baixa parcial.

Processar automaticamente apenas ajustes novos após a vigência da Entrega B. Ajustes antigos exigem inventário de possíveis contrapartidas manuais e lote de conciliação próprio. Não gerar despesas antigas em massa.

### 10.3 Tributos, devoluções e outros resultados

O plano de contas deve separar tributos sobre receita, tributos sobre lucro e despesas administrativas. Não calcular automaticamente o imposto devido nem inferir regime pelo nome “Simples Nacional”.

Em cancelamentos, conferir se o fluxo já cancela os eventos originais; não somar uma dedução adicional para o mesmo fato. Linhas sem origem operacional construída permanecem disponíveis para classificação autorizada, com indicação de ausência de automação.

Não reconhecer o preço total de venda de imobilizado como ganho financeiro. Sem valor contábil/baixa identificados, manter a apuração desse ganho como pendente de complementação.

A política atual de tributos da compra deverá ser registrada como política gerencial existente. Sua revisão fiscal/contábil é uma dependência separada, conforme as referências da revisão técnica. Não alterar custo histórico de estoque ao padronizar grupos.

## 11. Migração dos cadastros e do histórico

### 11.1 Inventário e simulação

Gerar relatório por banco com:

- catálogo local, grupos/contas ativos e inativos e quantidade de vínculos;
- mapeamentos efetivos, tipos não suportados, percentuais e vigências;
- transações/eventos sem classificação, natureza incompatível e exclusões suspeitas;
- comparação por linha de DRE, documentos e período;
- colisões de códigos/chaves e contas padrão ausentes;
- classificação proposta, justificativa e grau de certeza para cada cadastro.

Nomes podem sugerir candidatos, nunca aprovar sozinhos uma migração semântica. Guardar a proposta em artefato durável com ID/hash da simulação e contagens, sem dados pessoais desnecessários.

### 11.2 Associação sem perda de identidade

1. Instalar catálogo e estrutura aditiva sem mudar resultados.
2. Vincular grupos homogêneos já existentes à classificação correspondente.
3. Em grupos mistos, classificar contas individualmente primeiro. Exemplo: “Impostos e taxas” pode manter seu ID enquanto suas contas ganham regras específicas distintas.
4. Oferecer reorganização visual posterior, sem exigir mudança imediata de todos os grupos da oficina.
5. Criar grupos/contas padrão que faltem, respeitando colisões e escolhas locais.
6. AlphaGarage recebe a base inicial, preservando todos os recebimentos e eventos existentes.
7. Manter ambíguos em revisão. Não mover “Despesas não identificadas” para despesa definitiva nem manter sua exclusão como se estivesse validada.

### 11.3 Preservação do passado e ativação

Antes da ativação, capturar uma baseline reproduzível de linhas, regras e classificações legadas. Para eventos sem `dre_linha_id`, congelar a resolução vigente por metadados/snapshot, sem alterar valores. Inventariar também itens excluídos e pendentes, para não perder sua situação original.

Usar processamento limitado e retomável para essa captura de metadados. Antes da troca efetiva, conferir alterações concorrentes desde o início da captura e completar o delta sob coordenação transacional. Só então marcar a implantação ativa.

A data de início do novo modelo não reclassifica competências anteriores. Leituras de períodos que cruzem essa data devem combinar o legado preservado e o modelo novo, sem perda ou duplicação. Comparações entre templates usam identidades semânticas e uma correspondência explícita das linhas; não presumir que IDs sejam iguais.

Editar nome/grupo ou reexecutar o sincronizador não pode sobrescrever a classificação histórica preservada. Uma correção de valor continua seguindo a regra original do fato, salvo reclassificação solicitada explicitamente.

### 11.4 Reclassificação assistida

Criar lote com documentos/eventos identificados, classificação anterior/proposta, vigência, justificativa, autor, versões esperadas e totais antes/depois.

Aplicar somente se a simulação ainda corresponder ao estado atual. Transação alterada após a prévia invalida a aplicação daquela unidade. Impedir execução duplicada por chave idempotente e registrar o resultado de cada unidade de trabalho.

Reclassificar não movimenta caixa, não baixa títulos, não altera estoque ou comissão e não muda valores dos eventos. Se for necessário corrigir o próprio fato econômico, usar o fluxo financeiro correspondente.

Em lotes grandes, usar unidades transacionais documentadas e progresso retomável. Não apresentar “concluído” se houver unidades pendentes ou com erro.

## 12. Concorrência e integridade transacional

- Definir ordem única de locks para ativação/classificação, regra de conta/grupo, documento/título e evento. Conferir a ordem existente do financeiro para evitar inversão e deadlock.
- Mudança de regras e ativação exigem coordenação com geração de eventos, ajustes e importações em andamento.
- Usar comparação de `versao_registro` na própria escrita. Ler a versão e depois atualizar sem condição não resolve concorrência.
- Validar conta ativa, permissão, vigência e natureza dentro da mesma operação que grava o fato e sua classificação.
- Evitar uma sequência de chamadas REST independentes para gravar conta, regra e auditoria. Usar RPC/transação quando esses efeitos precisarem ser indivisíveis.
- Geração de eventos mantém chaves únicas. Não alterar formatos de `chave_origem` sem política explícita para os registros anteriores.
- Configuração de implantação omitida não muda o modo. Falha ao consultar essa configuração não equivale a modo legado.
- Banco ainda não migrado pode manter o fluxo antigo; o novo modo deverá exigir schema compatível e retornar mensagem clara antes de qualquer escrita parcial.

## 13. Períodos, reprodução e exportação

Na Entrega C, criar fechamento com período, versão do classificador/template, total por linha, eventos ou snapshot suficiente para reprodução, autor e data.

Definir limites de período no fuso da empresa. Como a API atual usa UTC, essa correção precisa de teste de fronteiras e prévia de impacto; não alterar datas silenciosamente junto de uma reclassificação de contas.

Fechamento deve recusar pendências materiais não resolvidas e falhas de fonte. Avisos de linhas sem origem automática exigem indicação de que não se aplicam ou informação complementar; zero não prova ausência da obrigação.

Proteções precisam alcançar os caminhos que alteram documentos/eventos de período fechado. Operações apenas de caixa em competência posterior não devem ser bloqueadas por engano. Reabertura exige permissão administrativa, justificativa e nova versão do fechamento, preservando a anterior.

Exportação PDF/Excel deve usar os mesmos dados, filtros, sinais e versões da tela. Incluir período, situação da apuração, pendências e identificação da versão, além de receitas, deduções, custos, despesas e resultado.

## 14. Arquivos e pontos de integração

| Área | Referências atuais / trabalho previsto |
|---|---|
| Cadastro | `src/app/(app)/(pages)/configuracoes/tipos/components/planos-de-conta-section.tsx` |
| APIs de grupos | `src/app/api/tipos/grupos-planos-de-conta/route.ts` e `[id]/route.ts` |
| APIs de contas | `src/app/api/tipos/planos-de-conta/route.ts` e `[id]/route.ts` |
| Seletor financeiro | `src/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-planos-de-conta.ts` e `components/plano-conta-combobox.tsx` |
| DRE | `src/app/api/dre/route.ts`, `_calculo.ts`, `_arvore.ts`, `drilldown/route.ts` e tela `dre/dre-client.tsx` |
| Badge | `src/app/(app)/(pages)/(financeiro)/fluxodecaixa/components/transactionDialog/dre-badge.tsx` |
| Gravações financeiras | Rotas de `transaction`, pagamentos múltiplos, importações e RPCs de baixa/ajustes |
| SQL | Novas migrações para schema, catálogo, classificador, integrações e fechamento; não editar migrações publicadas |
| Novos módulos | Catálogo versionado, contratos de classificação, simulação e testes em `src/lib/financeiro/` ou subdiretório dedicado |
| Evidências | Scripts de inventário/simulação em `scripts/db/`, testes SQL em `supabase/tests/`, documentação em `docs/` |

Conferir `propagar_nome_plano_de_conta` e demais triggers de cadastro: atualizar o texto exibido não pode reclassificar eventos por efeito indireto. Conferir também relatórios financeiros e exportações que agrupam pelo nome/código do plano.

## 15. Fases de execução e critérios de saída

### Fase 0 — inventário e especificação final do catálogo

- [x] Atualizar o inventário somente leitura nos quatro bancos.
- [x] Registrar baseline de DRE por período, inclusive pendências/exclusões.
- [x] Conferir dependências do histórico de migrações e situação Stone.
- [x] Materializar o catálogo da seção 5, naturezas permitidas e contas essenciais/opcionais.
- [x] Identificar contas ambíguas e políticas financeiras que exigem definição específica.

**Saída:** mapa de migração por cliente e contratos definidos, sem mudança de dados financeiros.

### Fase 1 — schema e catálogo, sem ativação

- [x] Criar migrações aditivas, constraints, índices, RLS/grants e auditoria.
- [x] Semear catálogo idempotente por chave semântica.
- [x] Introduzir estado de implantação e manter clientes existentes em legado.
- [x] Criar histórico de regras e persistência/projeção única de classificação.
- [x] Publicado na Demonstração em 07/09/2026.

**Saída:** instalar/reexecutar não duplica cadastros, não muda valores e não altera a DRE atual.

### Fase 2 — resolvedor e testes de banco

- [x] Implementar precedência por origem, conta, grupo e vigência.
- [x] Validar natureza, destino, exclusões e conflitos.
- [x] Integrar soma, detalhamento e badge à mesma resolução.
- [x] Implementar snapshot legado e preservação da classificação histórica.
- [x] Validar rollback; concorrência entre sessões fica para a Fase 3, com os caminhos de escrita.

**Saída:** duas oficinas com contas de nomes diferentes e a mesma classificação produzem a mesma DRE para fatos equivalentes.

### Fase 3 — cadastro e operações diárias

- [x] Atualizar APIs e telas de grupos/contas, com criação dinâmica preservada.
- [x] Exibir padrão/personalizada, herança, exceção e destino.
- [x] Atualizar seletores financeiros e permissões; a lista recarrega no conflito de versão.
- [x] Bloquear novas gravações incompatíveis no servidor e banco (banco só em modo ativo).

**Saída:** usuário cria uma conta personalizada, lança uma operação e encontra o mesmo valor no destino explicado pela tela.

### Fase 4 — pendências, simulação e migração da Entrega A

- [x] Criar fila com valores, origem e ações de resolução.
- [x] Implementar simulação persistida e aplicação idempotente por unidades.
- [x] Mapear cadastros sem sobrescrever IDs/nome/histórico.
- [x] Validar demonstração, corte de vigência e comparação de períodos mistos.
- [ ] Ativação individual dos clientes: bloqueada até a Entrega A ser publicada neles e a gravação de eventos ser integrada ao resolvedor.

**Saída:** cadastro híbrido utilizável e migração auditável, com pendências visíveis. Isso conclui a Entrega A, não as lacunas das Entregas B/C.

### Fase 5 — ajustes e deduções da Entrega B

- [ ] Definir matriz de tipo de ajuste × natureza do título × competência × destino.
- [ ] Criar eventos por ajuste, separando principal e encargos.
- [ ] Implementar alterações, estornos, baixa parcial e idempotência.
- [ ] Separar tributos sobre receita e sobre lucro no cadastro e no resolvedor.
- [ ] Inventariar contrapartidas antigas; não criar retroativos sem conciliação.
- [ ] Exibir fontes ainda não automatizadas, como devoluções ou apuração fiscal.

**Saída:** novos ajustes cobertos chegam à DRE uma única vez, com competência e destino explicáveis.

### Fase 6 — histórico e relatórios da Entrega C

- [ ] Implementar reclassificação assistida e proteção de períodos fechados.
- [ ] Implementar fechamento/reabertura versionados e trilha de auditoria.
- [ ] Unificar período/fuso e validar impactos de fronteira.
- [ ] Exportar PDF/Excel com equivalência à tela.

**Saída:** uma apuração fechada pode ser reproduzida mesmo após mudanças de contas ou regras futuras.

### Fase 7 — implantação e documentação final

- [ ] Executar a matriz da seção 16 e registrar resultados.
- [ ] Publicar primeiro na demonstração e conferir visualmente os fluxos.
- [ ] Implantar schema compatível nos clientes sem ativação automática indevida.
- [ ] Ativar individualmente os clientes com migração conferida, registrando versão e vigência.
- [ ] Atualizar manuais e registrar pendências externas, se houver.

## 16. Matriz de testes obrigatória

| Área | Cenários e resultado esperado |
|---|---|
| Cadastro | Conta padrão, personalizada, grupo personalizado, conta sem código, colisão de nome/código; nenhuma duplicação ou perda de vínculo |
| Herança | Nova conta herda grupo; exceção compatível prevalece; nome não muda classificação |
| Proteções | Não excluir registro utilizado; não inativar referência automática sem substituição; não alterar chave de sistema |
| Natureza | Despesa em conta de receita recusada; dedução/custo válidos aceitos; patrimônio com operação explícita |
| Vigência | Início/fim, ausência de regra, sobreposição recusada, mudança futura e evento retroativo |
| Histórico | Troca de grupo/nome não muda relatório antigo; reclassificação exige lote e mantém caixa/valores |
| Legado | Modo legado permanece equivalente; banco sem schema não entra no novo modo; campos omitidos preservados |
| Receitas automáticas | Produtos, serviços, frete, descontos e OS com faturamento ligado/desligado mantêm resultado e competência |
| Recebimentos | Parcelas, adiantamento, múltiplos e baixa parcial não duplicam receita |
| Ajustes | Taxas, juros, multas, descontos, estorno e repetição produzem efeito único e rastreável; principal não duplicado |
| Tributação | IRPJ/CSLL separados quando aplicável; imposto administrativo fora de deduções; caso fiscal desconhecido pendente |
| Pendências | Conta/grupo sem destino, evento ausente e exclusão suspeita exibidos com valores; falha de consulta não vira zero |
| Concorrência | Duas edições do cadastro, mudança de regra durante gravação e reclassificação de dado alterado; sem estado parcial |
| Permissões | Leitura, cadastro, reclassificação, ativação e fechamento testados na API/RPC; acesso direto não contorna proteção |
| Relatórios | Soma, árvore, grupos de sinais mistos, drill-down, badge e exportação concordam |
| Períodos | Competência anterior/atual, intervalo que cruza vigência, limite de mês no fuso, fechado e reaberto |
| Migração | Seed repetido, interrupção e retomada, aplicação duplicada, conflito de códigos e reversão de lote |

Usar fixtures determinísticas para regras e valores, sem depender das quantidades reais de OS/clientes. Testes SQL de escrita devem ocorrer primeiro na demonstração, com dados controlados e rollback, considerando limites de transações/DDL.

Executar testes de negócio afetados e a suíte exigida pelo projeto, TypeScript, build e conferência visual. Não refazer suítes já aprovadas sem mudança ou dúvida que justifique; registrar comando, resultado e revisão testada.

## 17. Implantação, compatibilidade e reversão

### 17.1 Atenção ao histórico de migrações Stone

Em 07/09/2026, a migração `20260907100000_corrigir_confirmacao_e_estorno_stone.sql` estava aplicada somente à demonstração. O script geral de deploy aplica todas as pendentes. Não executar esse script cegamente para implantar a DRE, pois isso também publicaria uma alteração Stone adiada pelo responsável.

Antes de qualquer implantação da DRE, preparar um conjunto de migrações revisado que preserve a migração publicada na demonstração e mantenha a Stone fora da implantação dos clientes. O conjunto deve ter manifesto explícito de versões, checksums e dependências da DRE, com dry-run que mostre exatamente o que será executado em cada banco. Nenhuma migração da DRE pode depender dos campos/funções Stone adiados.

Se for necessário adaptar o procedimento de seleção de migrações, produzir e testar essa adaptação explicitamente, incluindo retomada após falha e registro do histórico real de execução. A conferência final deve separar a diferença Stone intencional de qualquer divergência inesperada da DRE. Não apagar arquivos publicados, marcar migração como aplicada sem executar, usar `--include-all` por conveniência ou aceitar divergência de schema sem registrá-la. Consultar [o estado documentado dos bancos](database-migrations.md).

### 17.2 Sequência de publicação

1. Schema aditivo e catálogo em ambiente de demonstração.
2. Código compatível com schema antigo/novo, sem ativar o novo classificador.
3. Simulação, testes SQL, testes de aplicação e conferência visual.
4. Schema dos clientes no escopo correto e código compatível.
5. Migração de cadastros e snapshot legado, com comparação por cliente.
6. Ativação individual com vigência registrada e versões conferidas.
7. Conferência de amostras reais após implantação, com monitoração de erros, pendências e divergências de totais.

### 17.3 Reversão

Antes da ativação, é possível voltar a aplicação compatível anterior, mantendo colunas/tabelas aditivas. Não fazer downgrade destrutivo de schema com dados novos.

Depois de gerar fatos pelo novo classificador, desligar um campo não é uma reversão segura: poderia ocultar eventos ou reclassificá-los pelo legado. Priorizar correção progressiva e, se necessário, suspender mudanças de classificação enquanto o financeiro usa regras válidas já publicadas.

Lotes de reclassificação terão operação inversa baseada no histórico, com verificação de que os fatos não mudaram desde a aplicação. Reversão não apaga eventos ou auditoria nem invalida uma apuração fechada sem reabertura explícita.

## 18. Critérios finais de aceite

- [ ] É possível criar contas e grupos personalizados com classificação válida e previsível.
- [ ] Há contas/grupos padrão prontos para uso, protegidos sem eliminar a flexibilidade local.
- [ ] A mesma classificação significa a mesma coisa em todos os bancos, independentemente de nomes e IDs.
- [ ] Nenhuma receita/despesa fica fora dos totais sem situação e valor de pendência/exclusão explicados.
- [ ] Natureza incompatível não produz uma DRE aparentemente válida.
- [ ] Recebimentos não duplicam receitas e ajustes cobertos têm representação própria, sem duplicidade.
- [ ] Mudanças de cadastro não reescrevem silenciosamente períodos anteriores.
- [ ] Contas antigas, vínculos, valores, comissões, estoque e caixa são preservados na migração de classificação.
- [ ] Permissões, concorrência, rollback e retomada foram validados.
- [ ] DRE, detalhamento e exportação usam a mesma apuração e versão.
- [ ] Cada implantação informa o que foi publicado, ativado e ainda está pendente; Stone segue em stand-by.

## 19. Registro a preencher durante a execução

| Entrega | Revisão/PR | Migrações | Validações | Demonstração | Clientes | Pendências |
|---|---|---|---|---|---|---|
| A — cadastro e classificação | — | — | — | — | — | Não iniciada |
| B — ajustes e deduções | — | — | — | — | — | Não iniciada |
| C — histórico e relatórios | — | — | — | — | — | Não iniciada |

Para cada fase, registrar decisões adicionais, evidência de comparação e limitações. A conclusão da Entrega A pode ser publicada separadamente, mas deve comunicar que apuração fiscal completa e outras fontes não implementadas continuam fora da cobertura automática.
