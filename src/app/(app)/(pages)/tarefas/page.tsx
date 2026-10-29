import type { Metadata } from "next";
import { TarefasClient } from "./tarefas-client";

export const metadata: Metadata = {
  title: "Minhas tarefas | ERP Imóveis",
  description: "Gerencie suas tarefas, anotações e lembretes pessoais.",
};

export default function TarefasPage() {
  return <TarefasClient />;
}
