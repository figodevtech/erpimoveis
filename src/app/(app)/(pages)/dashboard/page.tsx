import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";

import OpcoesAbas from "./components/tabs";
import ConteudoGeral from "./components/dashboard-ordemservico/page";
import ConteudoUsuarios from "./components/dashboard-clientes/components/dashboard-clientes";
import ConteudoFinanceiro from "./components/dashboard-financeiro/page";
import ConteudoResumoDiario from "./components/dashboard-resumo-diario/page";
import ConteudoRendimentos from "./components/dashboard-rendimentos/page";

export default function PaginaDashboard() {
  return (
    <div className="w-full">
      <div className="flex gap-4">
        <Tabs defaultValue="geral" className="w-full">
          <TabsList className="bg-none gap-2">
            <OpcoesAbas />
          </TabsList>

          <Separator />

          <TabsContent value="geral">
            <ConteudoGeral />
          </TabsContent>

          <TabsContent value="usuarios">
            <ConteudoUsuarios />
          </TabsContent>

          <TabsContent value="financeiro">
            <ConteudoFinanceiro />
          </TabsContent>

          <TabsContent value="resumo-diario">
            <ConteudoResumoDiario />
          </TabsContent>

          <TabsContent value="rendimentos">
            <ConteudoRendimentos />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
