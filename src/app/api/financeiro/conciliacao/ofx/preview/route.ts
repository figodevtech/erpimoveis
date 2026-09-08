export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { requireFinanceirosAccess } from "@/app/api/_authz/perms";
import { centavosParaReais } from "@/lib/financeiro/ofx/normalize";
import { ErroDeOfx } from "@/lib/financeiro/ofx/types";
import {
  analisarExtrato,
  buscarImportacaoPorHash,
  carregarContas,
  lerArquivoEnviado,
  resumoDoExtrato,
  sugerirConta,
} from "../_lib/analise";

/**
 * Análise do extrato — a etapa que NÃO escreve nada.
 *
 * Lê o arquivo, compara com o Fluxo de Caixa e com os títulos em aberto, e
 * devolve o que encontrou. Nenhuma transação é criada, baixada ou vinculada
 * aqui, e nem sequer o extrato é gravado: quem escreve é `/importar`, depois de
 * o usuário revisar. Por isso a permissão exigida é a de leitura.
 */
export async function POST(req: Request) {
  try {
    await requireFinanceirosAccess();

    const formData = await req.formData();
    const arquivo = await lerArquivoEnviado(formData);

    const contas = await carregarContas();
    const contaSugerida = sugerirConta(arquivo.extrato, contas);

    const bancoIdBruto = Number(formData.get("bancoId"));
    const bancoId =
      Number.isSafeInteger(bancoIdBruto) && bancoIdBruto > 0
        ? bancoIdBruto
        : (contaSugerida?.id ?? 0);

    if (!bancoId) {
      return NextResponse.json(
        {
          error:
            "Escolha a conta bancária deste extrato: não foi possível identificá-la pela agência e conta do arquivo.",
        },
        { status: 400 },
      );
    }

    const conta = contas.find((item) => item.id === bancoId) ?? null;
    if (!conta) {
      return NextResponse.json({ error: "Conta bancária não encontrada." }, { status: 404 });
    }

    const [movimentos, arquivoJaImportado] = await Promise.all([
      analisarExtrato(arquivo, bancoId),
      buscarImportacaoPorHash(bancoId, arquivo.hash),
    ]);

    const { cabecalho } = arquivo.extrato;

    return NextResponse.json({
      data: {
        arquivo: {
          nome: arquivo.nome,
          hash: arquivo.hash,
          jaImportado: arquivoJaImportado,
        },
        conta,
        contaSugerida,
        /*
         * Aviso, não bloqueio: a conta escolhida à mão pode ser a certa mesmo
         * quando os números do arquivo não batem — conta migrada, agência
         * renumerada. Quem decide é quem opera.
         */
        divergenciaDeConta:
          contaSugerida != null && contaSugerida.id !== bancoId
            ? `A agência e a conta do arquivo apontam para "${contaSugerida.titulo}".`
            : null,
        cabecalho: {
          ...cabecalho,
          saldoInicial:
            arquivo.saldoInicialCentavos == null
              ? null
              : centavosParaReais(arquivo.saldoInicialCentavos),
          saldoFinal:
            cabecalho.saldoFinalCentavos == null
              ? null
              : centavosParaReais(cabecalho.saldoFinalCentavos),
        },
        resumo: resumoDoExtrato(movimentos),
        movimentos,
      },
    });
  } catch (error: any) {
    if (error instanceof ErroDeOfx) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const statusCode = Number(error?.statusCode ?? 500);
    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json({ error: error.message }, { status: statusCode });
    }

    console.error("POST /api/financeiro/conciliacao/ofx/preview", error);
    return NextResponse.json(
      { error: "Não foi possível analisar o extrato." },
      { status: 500 },
    );
  }
}
