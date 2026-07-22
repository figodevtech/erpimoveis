// src/app/(app)/(pages)/configuracoes/tipos/components/tipos-config-page.tsx
"use client";

import { useState } from "react";
import {
  PackageSearch,
  Ruler,
  Wrench,
  Factory,
  Landmark,
  Tags,
  LayoutPanelLeft,
  Palette,
  ChevronDown,
  ShoppingBag,
  Building2,
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
import CoresVeiculosSection from "./cores-veiculos-section";
import CentrosCustoSection from "./centros-custo-section";

type TabId =
  | "grupos"
  | "unidades"
  | "servicos"
  | "fornecedores"
  | "setores"
  | "bancos"
  | "categorias"
  | "planos_conta"
  | "centros_custo"
  | "categorias_venda"
  | "cores_veiculos";

export default function TiposConfigPage() {
  const [activeTab, setActiveTab] = useState<TabId>("grupos");
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
      id: "cores_veiculos",
      icon: Palette,
      title: "Cores de veículo",
      subtitle: "Cores para o cadastro",
    },
  ];

  function handleSelect(tab: TabId) {
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
                {tabs.find((t) => t.id === activeTab)?.title ?? "Selecione uma seção"}
              </span>
              <span className="text-xs text-muted-foreground">{tabs.find((t) => t.id === activeTab)?.subtitle}</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileOpen ? "rotate-180" : "rotate-0"}`} />
          </button>
          <div
            className={`overflow-hidden transition-[max-height] duration-300 ease-in-out ${
              mobileOpen ? "max-h-[620px] mt-2" : "max-h-0"
            }`}
          >
            <div className="w-full border rounded-md overflow-hidden bg-card">
              <div className="bg-muted/60 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide">
                Cadastros
              </div>
              <nav className="flex flex-col">
                {tabs.map((tab) => (
                  <TabButton
                    key={tab.id}
                    active={activeTab === tab.id}
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
            {tabs.map((tab) => (
              <TabButton
                key={tab.id}
                active={activeTab === tab.id}
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
          {activeTab === "grupos" && <GruposProdutoSection />}
          {activeTab === "unidades" && <UnidadesMedidaSection />}
          {activeTab === "servicos" && <ServicosSection />}
          {activeTab === "fornecedores" && <FornecedoresSection />}
          {activeTab === "setores" && <SetoresSection />}
          {activeTab === "bancos" && <BancosSection />}
          {activeTab === "categorias" && <CategoriasTransacaoSection />}
          {activeTab === "planos_conta" && <PlanosDeContaSection />}
          {activeTab === "centros_custo" && <CentrosCustoSection />}
          {activeTab === "categorias_venda" && <CategoriasVendaSection />}
          {activeTab === "cores_veiculos" && <CoresVeiculosSection />}
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
      className={`flex items-center gap-3 px-3 py-3 text-left transition-colors border-l-2 ${
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
