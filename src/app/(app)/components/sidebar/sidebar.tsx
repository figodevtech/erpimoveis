// src/app/(app)/components/sidebar/sidebar.tsx
"use client";

import * as React from "react";
import {
  LayoutDashboard,
  NotepadText,
  Tv,
  Package,
  Tags,
  Settings2,
  ClipboardList,
  Users,
  PanelsTopLeft,
  Type,
  Settings,
  UsersRound,
  SquareCheckBig,
  DollarSign,
  Calculator,
  ArrowDownUp,
  Landmark,
  Receipt,
  Store,
  Headset,
  History,
  Handbag,
  Boxes,
  Lock,
  Car,
  Wrench,
  CalendarDays,
  ShoppingBag,
  MapPinned,
  ScanLine,
  Repeat2,
  FileClock,
  CreditCard,
  MonitorCheck,
  ChartNoAxesCombined,
  ListChecks,
  Send,
  FileText,
  Building2,
  RadioTower,
} from "lucide-react";

import { NavMain } from "./components/nav-main";
import { NavUser } from "./components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuSkeleton,
  SidebarRail,
} from "@/components/ui/sidebar";
import { NavSettings } from "./components/nav-settings";

import { useSession } from "next-auth/react";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  user?: { nome: string; email: string };
  setOpen?: (open: boolean) => void;
  hoverHabilitado?: boolean;
  billingBlocked?: boolean;
};

const data = {
  navOptions: [
    {
      title: "Execução",
      url: "/execucao",
      icon: Wrench,
      perm: PERMS.EXECUCAO_OS,
    },
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: true,
      perm: PERMS.DASHBOARD,
    },
    {
      title: "Clientes",
      url: "/clientes",
      icon: UsersRound,
      isActive: true,
      perm: PERMS.CLIENTES,
    },
    {
      title: "Ordens de Serviço",
      url: "/ordens",
      icon: NotepadText,
      isActive: true,
      perm: PERMS.ORDENS,
    },
    {
      title: "Orçamentos",
      url: "/orcamentos",
      icon: FileText,
      perm: PERMS.ORCAMENTOS,
    },
    {
      title: "Agendamentos",
      url: "/agendamentos",
      icon: CalendarDays,
      perm: PERMS.AGENDAMENTOS,
    },
    {
      title: "Veículos",
      url: "/veiculos",
      icon: Car,
      perm: PERMS.VEICULOS,
    },
    {
      title: "Desmanche",
      url: "/desmanche",
      icon: Repeat2,
      perm: PERMS.DESMANCHE,
    },
    {
      title: "Estoque",
      url: "#",
      icon: Package,
      isActive: true,
      items: [
        {
          title: "Produtos",
          url: "/estoque",
          icon: Package,
          perm: PERMS.ESTOQUE,
        },
        {
          title: "Uso/Consumo",
          url: "/estoque/uso-consumo",
          icon: Handbag,
          perm: PERMS.USOCONSUMO,
        },
        {
          title: "Geral/Avulso",
          url: "/estoque/geral",
          icon: Boxes,
          perm: PERMS.USOCONSUMO,
        },
        {
          title: "Etiquetas",
          url: "/etiquetas",
          icon: Tags,
          perm: PERMS.USOCONSUMO,
        },
        {
          title: "Movimentação",
          url: "/estoque/movimentacao",
          icon: MapPinned,
          perm: PERMS.USOCONSUMO,
        },
        {
          title: "Consulta Etiqueta",
          url: "/etiquetas/registrar",
          icon: ScanLine,
          perm: PERMS.USOCONSUMO,
        },
        {
          title: "Histórico de estoque",
          url: "/estoque/historico",
          icon: History,
          perm: PERMS.USOCONSUMO,
        },
      ],
    },
    {
      title: "Vendas",
      url: "#",
      icon: Store,
      isActive: true,
      items: [
        {
          title: "Histórico",
          url: "/historicovendas",
          icon: History,
          perm: PERMS.VENDAS,
        },
        {
          title: "Ponto de Venda",
          url: "/pdv",
          icon: Headset,
          perm: PERMS.VENDAS,
        },
        {
          title: "Marketplace",
          url: "/marketplace",
          icon: ShoppingBag,
          perm: PERMS.VENDAS,
        },
      ],
    },
    {
      title: "Financeiro",
      url: "#",
      icon: DollarSign,
      isActive: true,
      items: [
        {
          title: "Fluxo de Caixa",
          url: "/fluxodecaixa",
          icon: ArrowDownUp,
          perm: PERMS.FINANCEIRO_FLUXO_DE_CAIXA,
        },
        {
          title: "Bancos",
          url: "/bancos",
          icon: Landmark,
          perm: PERMS.FINANCEIRO_BANCOS,
        },
        {
          title: "Fiscal",
          url: "/fiscal",
          icon: Receipt,
          perm: PERMS.FINANCEIRO_NOTAS_FISCAIS,
        },
        {
          title: "SPED Fiscal",
          url: "/fiscal/sped",
          icon: FileText,
          perm: PERMS.FISCAL_SPED,
        },
        {
          title: "Eventos de Ordens",
          url: "/eventos-financeiros",
          icon: ListChecks,
          perm: PERMS.FINANCEIRO_EVENTOS_DE_ORDENS,
        },
        {
          title: "Pagamento de Ordens",
          url: "/pagamentodeordens",
          icon: Calculator,
          perm: PERMS.FINANCEIRO_PAGAMENTO_DE_ORDENS,
        },
        {
          title: "Pagamento de Vendas",
          url: "/pagamentodevendas",
          icon: Handbag,
          perm: PERMS.FINANCEIRO_PAGAMENTO_DE_VENDAS,
        },
        {
          title: "Acompanhamento",
          url: "/acompanhamento-financeiro",
          icon: MonitorCheck,
          perm: PERMS.FINANCEIRO_ACOMPANHAMENTO,
        },
        {
          title: "DRE",
          url: "/dre",
          icon: ChartNoAxesCombined,
          perm: PERMS.FINANCEIRO_DRE,
        },
      ],
    },
    {
      title: "Acompanhamento",
      url: "/acompanhamento",
      icon: Tv,
      perm: PERMS.ACOMPANHAMENTO,
    },
    {
      title: "Central Operacional",
      url: "/central-operacional",
      icon: RadioTower,
      perm: PERMS.ACOMPANHAMENTO,
    },
    {
      title: "Relatórios",
      url: "/relatorios",
      icon: ClipboardList,
      perm: PERMS.RELATORIOS,
    },
    {
      title: "Seu Plano",
      url: "/plano",
      icon: CreditCard,
    },
  ],
  navSettings: [
    {
      title: "Configurações",
      url: "#",
      icon: Settings2,
      items: [
        {
          title: "Geral",
          url: "/configuracoes/geral",
          icon: Settings,
          perm: PERMS.CONFIG,
        },
        {
          title: "Empresa",
          url: "/configuracoes/empresa",
          icon: Building2,
          perm: PERMS.CONFIG,
        },
        {
          title: "Fiscal & Pagamentos",
          url: "/configuracoes/fiscal-pagamentos",
          icon: Receipt,
          perm: PERMS.CONFIG,
        },
        {
          title: "Tipos",
          url: "/configuracoes/tipos",
          icon: Type,
          perm: PERMS.TIPOS,
        },

        {
          title: "Perfis & Permissões",
          url: "/configuracoes/perfis",
          icon: Lock,
          perm: PERMS.CONFIG,
        },
        {
          title: "Usuários",
          url: "/usuarios",
          icon: Users,
          perm: PERMS.USUARIOS,
        },
        {
          title: "Checklist",
          url: "/configuracoes/checklist",
          icon: SquareCheckBig,
          perm: PERMS.CONFIG,
        },
        {
          title: "Telegram",
          url: "/configuracoes/telegram",
          icon: Send,
          perm: PERMS.CONFIG,
        },
        {
          title: "Auditoria",
          url: "/configuracoes/auditoria",
          icon: FileClock,
          perm: PERMS.CONFIG,
        },
        {
          title: "Site",
          url: "#",
          icon: PanelsTopLeft,
          perm: PERMS.CONFIG,
        },
      ],
    },
  ],
};

function userHasPerm(user: any, perm?: string) {
  if (!perm) return true;
  return permissionSetHas(user?.permissoes, perm);
}

function filterByPermission(items: any[], user: any) {
  return items
    .map((item) => {
      if (Array.isArray(item.items)) {
        const subItems = item.items.filter((sub: any) => userHasPerm(user, sub.perm));
        return subItems.length ? { ...item, items: subItems } : null;
      }

      return userHasPerm(user, item.perm) ? item : null;
    })
    .filter(Boolean);
}

function SidebarModulesLoading() {
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Módulos</SidebarGroupLabel>
        <SidebarMenu>
          {Array.from({ length: 8 }).map((_, index) => (
            <SidebarMenuSkeleton key={index} showIcon />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <SidebarGroup>
        <SidebarGroupLabel>Ajustes</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenu>
      </SidebarGroup>
    </>
  );
}

export function AppSidebar({ user, setOpen, hoverHabilitado, billingBlocked = false, ...props }: AppSidebarProps) {
  const { data: session, status } = useSession();

  // Se tiver sessão, usa usuário da sessão; senão, usa o user vindo por props (do layout)
  const effectiveUser = React.useMemo(
    () =>
      (session?.user as any) ??
      (user
        ? {
            nome: user.nome,
            email: user.email,
          }
        : null),
    [session?.user, user]
  );
  const isSessionLoading = status === "loading" && !effectiveUser;

  const navOptions = React.useMemo(
    () => billingBlocked
      ? data.navOptions.filter((item) => item.url === "/plano")
      : filterByPermission(data.navOptions, effectiveUser),
    [billingBlocked, effectiveUser]
  );
  const navSettings = React.useMemo(
    () => billingBlocked ? [] : filterByPermission(data.navSettings, effectiveUser),
    [billingBlocked, effectiveUser]
  );

  return (
    <Sidebar onMouseOver={()=>{
      if(!hoverHabilitado) return;
      setOpen?.(true)}} collapsible="icon" {...props}>
      <SidebarContent>
        {isSessionLoading ? (
          <SidebarModulesLoading />
        ) : (
          <>
            <NavMain items={navOptions} />
            <NavSettings items={navSettings} />
          </>
        )}
      </SidebarContent>
      <SidebarFooter>
        {effectiveUser && (
          <NavUser
            user={{
              nome: effectiveUser.nome || "",
              email: effectiveUser.email || "",
            }}
            billingBlocked={billingBlocked}
          />
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
