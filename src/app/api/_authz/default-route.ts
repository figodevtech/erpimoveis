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
  { perm: PERMS.FINANCEIRO, href: "/fluxodecaixa" },
  { perm: PERMS.ACOMPANHAMENTO, href: "/acompanhamento" },
  { perm: PERMS.RELATORIOS, href: "/relatorios" },
  { perm: PERMS.CONFIG, href: "/configuracoes/geral" },
  { perm: PERMS.USUARIOS, href: "/usuarios" },
];

export function getDefaultRouteForPerms(permissoes: unknown, fallback = "/nao-autorizado") {
  return ROUTE_PRIORITY.find((route) => permissionSetHas(permissoes, route.perm))?.href ?? fallback;
}
