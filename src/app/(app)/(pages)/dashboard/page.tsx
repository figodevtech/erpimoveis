import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";

import OpcoesAbas from "./components/tabs";
import ConteudoGeral from "./components/dashboard-ordemservico/page";
import ConteudoUsuarios from "./components/dashboard-clientes/components/dashboard-clientes";
import ConteudoFinanceiro from "./components/dashboard-financeiro/page";
import ConteudoResumoDiario from "./components/dashboard-resumo-diario/page";
import ConteudoRendimentos from "./components/dashboard-rendimentos/page";
import ConteudoEstoque from "./components/dashboard-estoque/page";

export default function PaginaDashboard() {
  return (
    <div className="dashboard-canvas w-full p-1 sm:p-2 lg:p-3">
      <div className="relative z-10 flex gap-4">
        <Tabs defaultValue="geral" className="w-full space-y-1 sm:space-y-2">
          <TabsList className="dashboard-tabs-list mx-auto h-auto w-fit max-w-full justify-center gap-1 overflow-x-auto rounded-2xl border-0 bg-card/80 p-1.5 shadow-lg shadow-slate-900/5 backdrop-blur-xl sm:mx-0">
            <OpcoesAbas />
          </TabsList>

          <TabsContent value="geral" className="mt-0">
            <ConteudoGeral />
          </TabsContent>

          <TabsContent value="usuarios" className="mt-0">
            <ConteudoUsuarios />
          </TabsContent>

          <TabsContent value="financeiro" className="mt-0">
            <ConteudoFinanceiro />
          </TabsContent>

          <TabsContent value="estoque" className="mt-0">
            <ConteudoEstoque />
          </TabsContent>

          <TabsContent value="resumo-diario" className="mt-0">
            <ConteudoResumoDiario />
          </TabsContent>

          <TabsContent value="rendimentos" className="mt-0">
            <ConteudoRendimentos />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
