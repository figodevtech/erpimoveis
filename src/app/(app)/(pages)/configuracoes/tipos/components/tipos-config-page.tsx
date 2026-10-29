// src/app/(app)/(pages)/configuracoes/tipos/components/tipos-config-page.tsx
"use client";

import { useState } from "react";
import { permissionSetHas, tipoPermission, type TipoId } from "@/app/api/_authz/permission-constants";
import {
  PackageSearch,
  Ruler,
  Wrench,
  Factory,
  Landmark,
  Tags,
  LayoutPanelLeft,
  ChevronDown,
  ShoppingBag,
  Building2,
  Box,
  PackageMinus,
  PackagePlus,
  CreditCard,
} from "lucide-react";
import GruposProdutoSection from "./grupos-produto-section";
import UnidadesMedidaSection from "./unidades-medida-section";
import ServicosSection from "./servicos-section";
import FornecedoresSection from "./fornecedores-section";
import BancosSection from "./contas-bancarias-section";
import CategoriasTransacaoSection from "./categorias-transacao-section";
import PlanosDeContaSection from "./planos-de-conta-section";
import CategoriasVendaSection from "./categorias-venda-section";
import SetoresSection from "./setores-section";
import CentrosCustoSection from "./centros-custo-section";
import GruposUsoConsumoSection from "./grupos-usoconsumo-section";
import MotivosSaidaSection from "./motivos-saida-section";
import TiposEntradaSection from "./tipos-entrada-section";
import BandeirasSection from "./bandeiras-section";

type TabId = TipoId;

export default function TiposConfigPage({ permissoes, abaInicial }: { permissoes: string[]; abaInicial?: string }) {
  // Aba vinda da URL (?aba=bancos); id desconhecido cai na primeira aba visível.
  const [activeTab, setActiveTab] = useState<TabId>((abaInicial as TabId) || "grupos");
  const [mobileOpen, setMobileOpen] = useState(false);

  const tabs: Array<{
    id: TabId;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    title: string;
    subtitle: string;
  }> = [
    {
      id: "grupos",
      icon: PackageSearch,
      title: "Grupos de Produtos",
      subtitle: "Organize por área do carro",
    },
    {
      id: "grupos_usoconsumo",
      icon: Box,
      title: "Grupos de Uso/Consumo",
      subtitle: "Organize materiais internos",
    },
    {
      id: "unidades",
      icon: Ruler,
      title: "Unidades de Medida",
      subtitle: "UN, JGO, KIT...",
    },
    {
      id: "servicos",
      icon: Wrench,
      title: "Serviços",
      subtitle: "Mão de obra / diagnósticos",
    },
    {
      id: "fornecedores",
      icon: Factory,
      title: "Fornecedores",
      subtitle: "Cadastro de fornecedores",
    },
    {
      id: "setores",
      icon: LayoutPanelLeft,
      title: "Setores",
      subtitle: "Áreas internas da empresa",
    },
    {
      id: "bancos",
      icon: Landmark,
      title: "Contas bancárias",
      subtitle: "Contas / bancos",
    },
    {
      id: "categorias",
      icon: Tags,
      title: "Categorias de transação",
      subtitle: "Organize o financeiro",
    },
    {
      id: "bandeiras",
      icon: CreditCard,
      title: "Bandeiras de cartão",
      subtitle: "Taxa da maquineta por parcela",
    },
    {
      id: "planos_conta",
      icon: LayoutPanelLeft,
      title: "Planos de conta",
      subtitle: "Organize o plano de contas",
    },
    {
      id: "centros_custo",
      icon: Building2,
      title: "Centros de custo",
      subtitle: "Destino interno das transações",
    },
    {
      id: "categorias_venda",
      icon: ShoppingBag,
      title: "Categorias de venda",
      subtitle: "Organize as vendas",
    },
    {
      id: "tipos_entrada",
      icon: PackagePlus,
      title: "Motivos de entradas",
      subtitle: "Exibidos no registro de entrada",
    },
    {
      id: "motivos_saida",
      icon: PackageMinus,
      title: "Motivos de saídas",
      subtitle: "Exibidos na baixa de estoque",
    },
  ];

  const visibleTabs = tabs.filter((tab) => permissionSetHas(permissoes, tipoPermission(tab.id, "visualizar")));
  const selectedTab = visibleTabs.some((tab) => tab.id === activeTab) ? activeTab : visibleTabs[0]?.id;

  function handleSelect(tab: TabId) {
    if (!visibleTabs.some((item) => item.id === tab)) return;
    setActiveTab(tab);
    setMobileOpen(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Mobile accordion nav */}
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="w-full rounded-md border bg-card px-3 py-3 flex items-center justify-between shadow-sm transition-colors"
          >
            <div className="flex flex-col text-left">
              <span className="text-sm font-semibold">
                {tabs.find((t) => t.id === selectedTab)?.title ?? "Selecione uma seção"}
              </span>
              <span className="text-xs text-muted-foreground">{tabs.find((t) => t.id === selectedTab)?.subtitle}</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileOpen ? "rotate-180" : "rotate-0"}`} />
          </button>
          {/* max-height em vh (e nao em px fixo): a lista cresce a cada cadastro novo
              e passava a ser cortada sem rolagem quando ultrapassava a altura fixa. */}
          <div
            className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
              mobileOpen ? "max-h-[75vh] mt-2" : "max-h-0"
            }`}
          >
            <div className="flex max-h-[70vh] w-full flex-col overflow-hidden rounded-md border bg-card">
              <div className="shrink-0 bg-muted/60 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide">
                Cadastros
              </div>
              <nav className="flex flex-col overflow-y-auto overscroll-contain">
                {visibleTabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    active={selectedTab === tab.id}
                    icon={tab.icon}
                    title={tab.title}
                    subtitle={tab.subtitle}
                    onClick={() => handleSelect(tab.id)}
                  />
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Lateral de tabs desktop */}
        <div className="hidden lg:block w-full lg:w-64 border rounded-md overflow-hidden bg-card">
          <div className="bg-muted/60 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide">Cadastros</div>
          <nav className="flex flex-col">
            {visibleTabs.map((tab) => (
              <TabButton
                key={tab.id}
                active={selectedTab === tab.id}
                icon={tab.icon}
                title={tab.title}
                subtitle={tab.subtitle}
                onClick={() => handleSelect(tab.id)}
              />
            ))}
          </nav>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          {!selectedTab && <p className="text-sm text-muted-foreground">Nenhum tipo disponível para este perfil.</p>}
          {selectedTab === "grupos" && <GruposProdutoSection />}
          {selectedTab === "grupos_usoconsumo" && <GruposUsoConsumoSection />}
          {selectedTab === "unidades" && <UnidadesMedidaSection />}
          {selectedTab === "servicos" && <ServicosSection />}
          {selectedTab === "fornecedores" && <FornecedoresSection permissoes={permissoes} />}
          {selectedTab === "setores" && <SetoresSection />}
          {selectedTab === "bancos" && <BancosSection />}
          {selectedTab === "categorias" && <CategoriasTransacaoSection />}
          {selectedTab === "bandeiras" && <BandeirasSection />}
          {selectedTab === "planos_conta" && <PlanosDeContaSection />}
          {selectedTab === "centros_custo" && <CentrosCustoSection />}
          {selectedTab === "categorias_venda" && <CategoriasVendaSection />}
          {selectedTab === "tipos_entrada" && <TiposEntradaSection />}
          {selectedTab === "motivos_saida" && <MotivosSaidaSection />}
        </div>
      </div>
    </div>
  );
}

type TabButtonProps = {
  active: boolean;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  subtitle?: string;
  onClick: () => void;
};

function TabButton({ active, icon: Icon, title, subtitle, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-3 px-3 py-3 text-left transition-colors border-l-2 ${
        active
          ? "bg-primary/10 text-foreground border-primary"
          : "bg-card text-muted-foreground border-transparent hover:bg-muted/70"
      }`}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-md border ${
          active ? "bg-primary/10 border-primary/40" : "bg-background"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        {subtitle && <span className="text-xs text-muted-foreground truncate">{subtitle}</span>}
      </div>
    </button>
  );
}
