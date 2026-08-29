import {
  Boxes,
  ClipboardList,
  HandCoins,
  Landmark,
  ReceiptText,
  ShoppingCart,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import type { OperationalModule } from "./contracts";

export type OperationalModuleTone = "amber" | "violet" | "emerald" | "mint" | "coral" | "blue" | "cyan";

export type OperationalModulePresentation = {
  label: string;
  compactLabel: string;
  icon: LucideIcon;
  tone: OperationalModuleTone;
};

export const OPERATIONAL_MODULE_PRESENTATION: Readonly<Record<OperationalModule, OperationalModulePresentation>> = {
  VENDAS: { label: "VENDAS", compactLabel: "VENDAS", icon: ShoppingCart, tone: "amber" },
  ORDENS: { label: "ORDENS DE SERVIÇO", compactLabel: "ORDENS", icon: ClipboardList, tone: "violet" },
  FINANCEIRO: { label: "FLUXO DE CAIXA", compactLabel: "FLUXO DE CAIXA", icon: WalletCards, tone: "emerald" },
  CONTAS_RECEBER: { label: "CONTAS A RECEBER", compactLabel: "CONTAS A RECEBER", icon: HandCoins, tone: "mint" },
  CONTAS_PAGAR: { label: "CONTAS A PAGAR", compactLabel: "CONTAS A PAGAR", icon: Landmark, tone: "coral" },
  ESTOQUE: { label: "ESTOQUE", compactLabel: "ESTOQUE", icon: Boxes, tone: "blue" },
  FISCAL: { label: "FISCAL", compactLabel: "FISCAL", icon: ReceiptText, tone: "cyan" },
};

export function operationalPresentationFor(module: OperationalModule): OperationalModulePresentation {
  return OPERATIONAL_MODULE_PRESENTATION[module];
}
