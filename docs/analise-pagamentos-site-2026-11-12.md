# Reservas, pagamentos e comissões da Cespedes

Análise de 12/11/2026 dos projetos `erpimoveis`, `site-cespedesliving` e da configuração da empresa na central.

## Decisões informadas

- O site atende reservas de temporada e aluguéis.
- O hóspede poderá escolher sinal ou pagamento integral na reserva.
- A comissão da Figo é configurada pelo proprietário da central, com ativação opcional e percentual.
- Comissão de corretor, administração e repasses aos proprietários são registrados no ERP.
- O fluxo pretendido retira a comissão da Figo na transação do Asaas. Depois do recebimento na conta da Cespedes, proprietário e corretor são pagos pelo fluxo administrado no ERP. A distribuição interna dos custos ainda depende de planejamento.

## Dependências

Consulta ao registro npm com `npm outdated --json` e auditoria com `npm audit --json` e `npm audit --omit=dev --json`. A verificação preservou os manifests e os arquivos de lock.

| Projeto | Dependência | Versão encontrada | Referência disponível no npm |
| --- | --- | --- | --- |
| ERP | Next.js | 15.5.28 | 16.4.6, migração de versão principal |
| ERP | React / React DOM | 19.2.9 | 19.3.1 |
| ERP | Supabase JS | 2.57.0 | 2.119.0 |
| ERP | Sharp | 0.35.5 | 0.35.5 |
| ERP | fast-xml-parser | 5.11.2 | 5.12.0 |
| ERP | node-forge | 1.4.1 | 1.4.3 |
| Site | Next.js | 16.4.3 | 16.4.6 |
| Site | Supabase JS | 2.118.0 no manifest | 2.119.0 |
| Site | Sharp | 0.34.5 | 0.35.5 |
| Site | Vitest | 3.2.7 | 5.1.0, migração de versão principal |

O ERP também tem atualizações disponíveis para Radix UI, React Query, Tiptap, Tailwind, ferramentas de teste e outras bibliotecas. O site tem atualizações de Tailwind, Playwright e Prettier. Algumas versões estão fixadas no manifest, por isso `npm update` isoladamente não atualiza todas elas. O NextAuth do ERP usa `5.0.0-beta.32`, enquanto a tag `latest` aponta para a linha 4. Essa diferença exige avaliação da linha beta usada na autenticação.

A auditoria das dependências de produção do ERP apontou 9 pacotes afetados, sendo 6 moderados e 3 baixos, incluindo a cadeia PWA/Workbox, `node-forge` e `fast-xml-parser`. No site, apontou um pacote de produção com severidade alta, o Sharp. A auditoria completa do site apontou 11 pacotes afetados, incluindo 2 críticos na cadeia Vitest/Tinypool de desenvolvimento. Esses totais incluem pacotes afetados indiretamente pela mesma causa.

A atualização prioritária é Sharp no site e a correção da cadeia de testes. No ERP, a atualização de Supabase deve validar autenticação, consultas e Realtime. Migrações de Next.js, Vitest e outras versões principais precisam de seus testes de compatibilidade. A análise de pagamentos usa a arquitetura atual dos projetos.

## Fluxo encontrado

O site calcula a cotação pelo ERP e exige sessão de cliente para criar a reserva. A criação envia cotação, total esperado e chave de idempotência para `imob_salvar_reserva`. O pagamento atual é combinado com o atendimento. Os textos do checkout, confirmação e perguntas frequentes refletem esse comportamento.

O ERP já possui taxa de administração por proprietário e imóvel, percentual na locação e na reserva, financeiro por operação e extrato do proprietário. Existem lançamentos para custo da imobiliária, despesa do proprietário e repasse. A migração `20261112120000` condiciona a quitação do repasse ao valor efetivamente pago. A receita de hospedagem é reconhecida no check-out pela regra atual.

A venda de imóvel possui percentual e valor de comissão, mas não foi localizado um fluxo específico de corretor com identificação do beneficiário, base de cálculo, apropriação e pagamento da comissão. A comissão de venda existente precisa ser distinguida da comissão devida ao corretor.

## Provedor de pagamento

A recomendação inicial é Asaas, pela combinação de checkout hospedado com Pix e cartão, recorrência para aluguéis e split para a Figo. O checkout hospedado evita que os projetos precisem implementar a coleta dos dados do cartão. A conta responsável pela cobrança deve ser a da Cespedes. A carteira da Figo entra como recebedora quando a comissão estiver ativada. O split percentual do Asaas utiliza o valor líquido após as tarifas. Contas novas podem precisar da habilitação de split. [Checkout Asaas](https://docs.asaas.com/docs/checkout-asaas), [Split Asaas](https://docs.asaas.com/docs/split-de-pagamentos)

Mercado Pago também oferece checkout hospedado e split entre vendedor e plataforma, com conexão OAuth do vendedor. É uma alternativa quando a operação preferir o ecossistema Mercado Pago. [Integração de split](https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)

Stripe tem checkout e recursos de plataforma, mas a página brasileira de preços informa Pix somente por convite. Para uma operação com Pix como meio importante, isso acrescenta uma dependência de liberação da conta. [Preços Stripe Brasil](https://stripe.com/br/pricing)

As taxas devem ser comparadas com as condições da conta da Cespedes, considerando parcelamento, prazo de recebimento, estornos e eventual antecipação. A tabela pública do Asaas distingue valores promocionais e padrão. [Preços Asaas](https://www.asaas.com/precos-e-taxas)

## Implementação necessária para cobrar pelo site

1. Criar uma tentativa de pagamento no ERP com reserva, tipo `SINAL` ou `INTEGRAL`, valor em centavos, vencimento, chave de idempotência e revisão da comissão da central. Calcular o sinal no servidor e manter o saldo restante explícito.
2. Criar bloqueio temporário das datas de temporada, com expiração e proteção transacional contra sobreposição. A reserva pendente de pagamento e o estado financeiro precisam aparecer de forma coerente no ERP e na conta do hóspede.
3. Criar o checkout Asaas no servidor com o valor aprovado pelo ERP, o identificador da operação e o split da Figo quando habilitado. Registrar o identificador do checkout, os pagamentos resultantes e a distribuição aplicada.
4. Tratar falhas ambíguas e novas tentativas. Recuperar a cobrança anterior antes de criar outra quando a resposta do gateway se perder.
5. Receber webhooks autenticados, deduplicar eventos e validar na API do gateway valor, cobrança, conta e vínculo com a reserva. A URL de retorno serve para navegação do cliente. A confirmação financeira depende do estado verificado do pagamento.
6. Registrar recebimento bruto, tarifa do gateway, comissão da Figo e valor líquido na conciliação, usando as rotinas financeiras existentes. Pagamento parcial deve baixar apenas o valor recebido e manter o restante a receber.
7. Tratar expiração, pagamento tardio, cancelamento, reembolso parcial ou integral e chargeback. Um pagamento tardio exige verificar novamente a disponibilidade antes de confirmar a estadia.
8. Para aluguel mensal, gerar a cobrança da competência vinculada ao contrato. A geração de cobranças recorrentes Pix ou boleto exige pagamento pelo cliente. A automatização do débito deve seguir a modalidade contratada com o provedor. [Recorrência Asaas](https://docs.asaas.com/docs/subscriptions-faq)
9. Exibir no site as opções de sinal e integral, resumo de valores, prazo do saldo, link para pagamento, situação financeira e histórico. Atualizar as mensagens atuais de pagamento combinado com o atendimento quando a operação online estiver habilitada.

## Configuração da comissão da Figo

A central passa a oferecer a aba `Site de Imóveis` para empresas com o sistema em implantação, teste ou ativo. Ela permite salvar domínio, nome do site, ativação da comissão, percentual de até quatro casas decimais e Wallet ID da Figo. Habilitar exige percentual positivo e carteira recebedora. Desativar preserva o percentual cadastrado para uma futura reativação.

A consulta servidor a servidor fica em `/api/v1/property-website/payment-config`, autenticada com as credenciais de instalação já usadas pelo ERP. A base publicada é `NET_VALUE`. Cada pagamento futuro deverá guardar sua própria configuração aplicada, para que a edição de percentual preserve a conciliação das cobranças existentes.

Esses controles publicam a configuração para a futura integração. A cobrança e o split efetivo dependem da implementação do checkout e da confirmação do provedor. As configurações de corretor e proprietário permanecem sob as regras do ERP descritas acima.

## Próximas definições operacionais

- Percentual do sinal, prazo para pagamento e vencimento do saldo, configuráveis pela Cespedes.
- Quem assume a tarifa do gateway e a comissão da Figo, para calcular corretamente o saldo do proprietário.
- Base da taxa de administração, tratamento da limpeza e condições de repasse.
- Cadastro do corretor, percentual ou valor fixo, operação vinculada, quando a comissão é devida e quem assume esse custo.
- Conta Asaas da Cespedes, habilitação dos meios de pagamento, habilitação do split e Wallet ID da Figo.
- Credenciais de sandbox e produção no ERP, segredo de webhook e URLs de retorno. O site continua usando a API autenticada do ERP para os pagamentos.

## Exemplo para revisar a conciliação

Em um pagamento hipotético de R$ 1.000,00, com tarifa hipotética de R$ 30,00, o líquido disponível no gateway seria R$ 970,00. Se a comissão da Figo estivesse configurada em 2%, o split percentual sobre esse líquido seria R$ 19,40 e restariam R$ 950,60 na conta da Cespedes. Esses números são apenas uma simulação, sem percentual ou tarifa contratados.

O ERP precisa manter os R$ 1.000,00 pagos pelo hóspede, os R$ 30,00 de tarifa e os R$ 19,40 da Figo identificáveis. O pagamento ao proprietário e ao corretor será calculado conforme as regras acordadas no ERP. O valor líquido no banco, isoladamente, não define quanto é devido a cada beneficiário. A regra de responsabilidade pelos custos deve ser definida antes de automatizar essa distribuição.

## Verificação antes da liberação

Validar em sandbox sinal e integral, Pix e cartão, confirmação duplicada, eventos fora de ordem, estorno, comissão ligada e desligada, expiração, concorrência pela mesma data e conciliação com o extrato do proprietário. Conferir que o pagamento do hóspede, a receita reconhecida no check-out e o repasse pago ao proprietário seguem as regras financeiras próprias de cada etapa.
