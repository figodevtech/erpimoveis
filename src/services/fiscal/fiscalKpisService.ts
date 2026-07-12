import { buscarKpisDfeRecebidasGeral } from "@/services/fiscal/dfeRecebidasService";
import { buscarKpisNotasEmitidasProprias } from "@/services/fiscal/notasEmitidasService";

export async function buscarFiscalKpisGerais() {
  const [proprias, terceiros] = await Promise.all([
    buscarKpisNotasEmitidasProprias(),
    buscarKpisDfeRecebidasGeral(),
  ]);

  return {
    total: proprias.emitidasPorNos + terceiros.emitidasTerceiros,
    emitidasPorNos: proprias.emitidasPorNos,
    emitidasTerceiros: terceiros.emitidasTerceiros,
    autorizadas: proprias.autorizadas + terceiros.autorizadas,
    canceladas: proprias.canceladas + terceiros.canceladas,
    rejeitadas: proprias.rejeitadas + terceiros.rejeitadas,
    valorTotal: proprias.valorEmitidasPorNos + terceiros.valorEmitidasTerceiros,
    valorEmitidasPorNos: proprias.valorEmitidasPorNos,
    valorEmitidasTerceiros: terceiros.valorEmitidasTerceiros,
  };
}
