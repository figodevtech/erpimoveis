import { CircleAlert } from "lucide-react";
import { ProductStockReportButton } from "./product-stock-report-button";

export function ProdutosEstoqueBaixo(props: { search?: string | null; chunk?: number; filename?: string }) {
  return <ProductStockReportButton {...props} status="BAIXO" icon={<CircleAlert className="h-4 w-4" />} title="Produtos com estoque baixo" description="Itens que atingiram o nível de atenção para reposição" tone="bg-amber-500/10 text-amber-600" />;
}
