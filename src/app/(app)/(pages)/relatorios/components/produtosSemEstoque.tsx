import { CircleOff } from "lucide-react";
import { ProductStockReportButton } from "./product-stock-report-button";

export function ProdutosSemEstoque(props: { search?: string | null; chunk?: number; filename?: string }) {
  return <ProductStockReportButton {...props} status="SEM_ESTOQUE" icon={<CircleOff className="h-4 w-4" />} title="Produtos sem estoque" description="Itens indisponíveis que precisam de reposição" tone="bg-violet-500/10 text-violet-600" />;
}
