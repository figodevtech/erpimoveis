import type { Metadata } from "next";
import { ExecucaoClient } from "./execucao-client";

export const metadata: Metadata = {
  title: "Execução | ERP Imóveis",
  description: "Limpezas de imóveis sob a sua responsabilidade.",
};

export default function ExecucaoPage() {
  return <ExecucaoClient />;
}
