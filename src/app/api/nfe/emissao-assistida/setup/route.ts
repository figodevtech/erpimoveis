import { NextResponse } from "next/server";

import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { getNFeAvulsaSetup } from "@/services/fiscal/nfeAvulsaService";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAny([PERMS.ORDENS, PERMS.VENDAS, PERMS.FINANCEIRO, PERMS.ESTOQUE]);
    const setup = await getNFeAvulsaSetup();

    return NextResponse.json({
      empresa: setup.empresa
        ? {
            id: setup.empresa.id,
            nome: setup.empresa.nomefantasia || setup.empresa.razaosocial,
            uf: setup.empresa.uf,
            crt: setup.empresa.regimetributario,
            ambiente: setup.empresa.ambiente,
          }
        : null,
      config: setup.config
        ? {
            serie: setup.config.serie,
            ambiente: setup.config.ambiente,
          }
        : null,
      empresaErros: setup.empresaErros,
      unidades: setup.unidades,
      regrasFiscais: setup.regrasFiscais,
      versaoRegraFiscal: setup.versaoRegraFiscal,
      classificacoesRtc: setup.classificacoesRtc,
    });
  } catch (error: any) {
    const status = error?.statusCode === 403 ? 403 : 500;
    return NextResponse.json(
      {
        error:
          status === 403
            ? "Você não tem permissão para emitir NF-e."
            : "Erro ao carregar as regras da emissão assistida.",
        detail: error?.message ?? String(error),
      },
      { status },
    );
  }
}
