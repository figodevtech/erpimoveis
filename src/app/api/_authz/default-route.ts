import { PERMS, permissionSetHas } from "./permission-constants";

const ROUTE_PRIORITY: Array<{ perm: string; href: string }> = [
  { perm: PERMS.DASHBOARD, href: "/dashboard" },
  { perm: PERMS.EXECUCAO_OS, href: "/execucao" },
  { perm: PERMS.ORDENS, href: "/ordens" },
  { perm: PERMS.AGENDAMENTOS, href: "/agendamentos" },
  { perm: PERMS.CLIENTES, href: "/clientes" },
  { perm: PERMS.VEICULOS, href: "/veiculos" },
  { perm: PERMS.DESMANCHE, href: "/desmanche" },
  { perm: PERMS.ESTOQUE, href: "/estoque" },
  { perm: PERMS.USOCONSUMO, href: "/estoque/uso-consumo" },
  { perm: PERMS.VENDAS, href: "/historicovendas" },
  // `financeiro:visualizar` sozinha nao abre tela nenhuma: cada tela tem a sua.
  { perm: PERMS.FINANCEIRO_FLUXO_DE_CAIXA, href: "/fluxodecaixa" },
  { perm: PERMS.FINANCEIRO_PAGAMENTO_DE_ORDENS, href: "/pagamentodeordens" },
  { perm: PERMS.FINANCEIRO_PAGAMENTO_DE_VENDAS, href: "/pagamentodevendas" },
  { perm: PERMS.FINANCEIRO_BANCOS, href: "/bancos" },
  { perm: PERMS.FINANCEIRO_EVENTOS_DE_ORDENS, href: "/eventos-financeiros" },
  { perm: PERMS.FINANCEIRO_DRE, href: "/dre" },
  { perm: PERMS.FINANCEIRO_NOTAS_FISCAIS, href: "/fiscal" },
  { perm: PERMS.ACOMPANHAMENTO, href: "/acompanhamento" },
  { perm: PERMS.RELATORIOS, href: "/relatorios" },
  { perm: PERMS.CONFIG, href: "/configuracoes/geral" },
  { perm: PERMS.TIPOS, href: "/configuracoes/tipos" },
  { perm: PERMS.USUARIOS, href: "/usuarios" },
];

export function getDefaultRouteForPerms(permissoes: unknown, fallback = "/nao-autorizado") {
  return ROUTE_PRIORITY.find((route) => permissionSetHas(permissoes, route.perm))?.href ?? fallback;
}
