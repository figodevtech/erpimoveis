export type CaptureModule = {
  name: string;
  path: string;
  slug: string;
};

/** Rotas navegáveis expostas atualmente pelo menu principal do ERP. */
export const CAPTURE_MODULES: CaptureModule[] = [
  { name: "Execução", path: "/execucao", slug: "execucao" },
  { name: "Dashboard", path: "/dashboard", slug: "dashboard" },
  { name: "Clientes", path: "/clientes", slug: "clientes" },
  { name: "Ordens de Serviço", path: "/ordens", slug: "ordens" },
  { name: "Agendamentos", path: "/agendamentos", slug: "agendamentos" },
  { name: "Veículos", path: "/veiculos", slug: "veiculos" },
  { name: "Desmanche", path: "/desmanche", slug: "desmanche" },
  { name: "Estoque - Produtos", path: "/estoque", slug: "estoque-produtos" },
  { name: "Estoque - Uso e Consumo", path: "/estoque/uso-consumo", slug: "estoque-uso-consumo" },
  { name: "Etiquetas", path: "/etiquetas", slug: "etiquetas" },
  { name: "Estoque - Movimentação", path: "/estoque/movimentacao", slug: "estoque-movimentacao" },
  { name: "Consulta de Etiqueta", path: "/etiquetas/registrar", slug: "consulta-etiqueta" },
  { name: "Histórico de Estoque", path: "/estoque/historico", slug: "estoque-historico" },
  { name: "Histórico de Vendas", path: "/historicovendas", slug: "vendas-historico" },
  { name: "Ponto de Venda", path: "/pdv", slug: "pdv" },
  { name: "Marketplace", path: "/marketplace", slug: "marketplace" },
  { name: "Fluxo de Caixa", path: "/fluxodecaixa", slug: "fluxo-de-caixa" },
  { name: "Bancos", path: "/bancos", slug: "bancos" },
  { name: "Fiscal", path: "/fiscal", slug: "fiscal" },
  { name: "Pagamento de Ordens", path: "/pagamentodeordens", slug: "pagamento-ordens" },
  { name: "Pagamento de Vendas", path: "/pagamentodevendas", slug: "pagamento-vendas" },
  { name: "Acompanhamento Financeiro", path: "/acompanhamento-financeiro", slug: "acompanhamento-financeiro" },
  { name: "DRE", path: "/dre", slug: "dre" },
  { name: "Acompanhamento", path: "/acompanhamento", slug: "acompanhamento" },
  { name: "Relatórios", path: "/relatorios", slug: "relatorios" },
  { name: "Plano", path: "/plano", slug: "plano" },
  { name: "Configurações Gerais", path: "/configuracoes/geral", slug: "configuracoes-geral" },
  { name: "Dados da Empresa", path: "/configuracoes/empresa", slug: "configuracoes-empresa" },
  { name: "Configurações Fiscais", path: "/configuracoes/fiscal-pagamentos", slug: "configuracoes-fiscal" },
  { name: "Configurações de Tipos", path: "/configuracoes/tipos", slug: "configuracoes-tipos" },
  { name: "Perfis e Permissões", path: "/configuracoes/perfis", slug: "perfis-permissoes" },
  { name: "Usuários", path: "/usuarios", slug: "usuarios" },
  { name: "Configuração de Checklist", path: "/configuracoes/checklist", slug: "configuracoes-checklist" },
  { name: "Auditoria", path: "/configuracoes/auditoria", slug: "auditoria" },
];
