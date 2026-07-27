import { TriangleAlert } from "lucide-react";
import { ProductStockReportButton } from "./product-stock-report-button";

export function ProdutosEstoqueCritico(props: { search?: string | null; chunk?: number; filename?: string }) {
  return <ProductStockReportButton {...props} status="CRITICO" icon={<TriangleAlert className="h-4 w-4" />} title="Produtos com estoque crítico" description="Itens que precisam de reposição com prioridade" tone="bg-red-500/10 text-red-600" />;
}
