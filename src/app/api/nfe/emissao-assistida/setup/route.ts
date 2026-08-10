import { NextResponse, type NextRequest } from "next/server";

import { PERMS, requireAny } from "@/app/api/_authz/perms";
import { exigirModelo, MODELO_NFE } from "@/lib/nfe/modeloDocumento";
import { getNFeAvulsaSetup } from "@/services/fiscal/nfeAvulsaService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAny([PERMS.ORDENS, PERMS.VENDAS, PERMS.FINANCEIRO, PERMS.ESTOQUE]);

    // Sem `?modelo=`, responde a NF-e — é o que todos os chamadores anteriores
    // esperam. A tela de NFC-e informa 65 e recebe a série, o número e o
    // ambiente do modelo dela.
    const modeloParam = req.nextUrl.searchParams.get("modelo");
    const modelo = modeloParam ? exigirModelo(modeloParam) : MODELO_NFE;

    const setup = await getNFeAvulsaSetup(modelo);

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
            // Com que número a nota deve sair. O definitivo é alocado no envio.
            proximoNumero: setup.proximoNumero,
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
