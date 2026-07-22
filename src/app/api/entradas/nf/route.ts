// app/api/entradas/nf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    // Lê o conteúdo do arquivo
    const arrayBuffer = await file.arrayBuffer();
    const xml = Buffer.from(arrayBuffer).toString("utf-8");

    // Converte XML → JS Object
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });

    const json = parser.parse(xml);

    // A NF-e geralmente vem como NFe ou nfeProc
    // Estruturas mais comuns:
    // - json.nfeProc.NFe.infNFe
    // - json.NFe.infNFe
    let infNFe: any;

    if (json.nfeProc?.NFe?.infNFe) {
      infNFe = json.nfeProc.NFe.infNFe;
    } else if (json.NFe?.infNFe) {
      infNFe = json.NFe.infNFe;
    } else {
      return NextResponse.json(
        { error: "Estrutura de NF-e não reconhecida" },
        { status: 400 }
      );
    }

    // Agora extraímos as principais variáveis/“campos”
    const ide = infNFe.ide || {};
    const emit = infNFe.emit || {};
    const dest = infNFe.dest || {};
    const total = infNFe.total?.ICMSTot || {};
    const items = Array.isArray(infNFe.det) ? infNFe.det : [infNFe.det];

    const result = {
      // Chave de acesso
      chaveAcesso:
        infNFe["@_Id"]?.replace("NFe", "") ||
        String(json.nfeProc?.protNFe?.infProt?.chNFe ?? "") ||
        null,

      // Dados básicos
      numeroNota: ide.nNF || null,
      serie: ide.serie || null,
      dataEmissao: ide.dhEmi || ide.dEmi || null,
      tipoOperacao: ide.tpNF, // 0=Entrada, 1=Saída

      // Emitente
      emitente: {
        cnpj: emit.CNPJ || null,
        nome: emit.xNome || null,
        nomeFantasia: emit.xFant || null,
        ie: emit.IE || null,
        endereco: {
          logradouro: emit.enderEmit?.xLgr || null,
          numero: emit.enderEmit?.nro || null,
          codigoMunicipio: emit.enderEmit?.cMun || null,
          bairro: emit.enderEmit?.xBairro || null,
          municipio: emit.enderEmit?.xMun || null,
          uf: emit.enderEmit?.UF || null,
          cep: emit.enderEmit?.CEP || null,
        },
      },

      // Destinatário
      destinatario: {
        cnpj: dest.CNPJ || null,
        cpf: dest.CPF || null,
        nome: dest.xNome || null,
        ie: dest.IE || null,
        endereco: {
          logradouro: dest.enderDest?.xLgr || null,
          numero: dest.enderDest?.nro || null,
          bairro: dest.enderDest?.xBairro || null,
          municipio: dest.enderDest?.xMun || null,
          uf: dest.enderDest?.UF || null,
          cep: dest.enderDest?.CEP || null,
        },
      },

      // Totais
      totais: {
        valorProdutos: total.vProd || null,
        valorNota: total.vNF || null,
        valorFrete: total.vFrete || null,
        valorDesconto: total.vDesc || null,
        valorICMS: total.vICMS || null,
        valorIPI: total.vIPI || null,
      },

      // Itens da nota
      itens: items
        .filter(Boolean)
        .map((item: any) => {
          const prod = item.prod || {};
          const imposto = item.imposto || {};

          return {
            numeroItem: item["@_nItem"] || null,
            codigo: prod.cProd || null,
            ean: prod.cEAN || null,
            descricao: prod.xProd || null,
            ncm: prod.NCM || null,
            cfop: prod.CFOP || null,
            unidade: prod.uCom || null,
            quantidade: prod.qCom || null,
            valorUnitario: prod.vUnCom || null,
            valorTotal: prod.vProd || null,
            valorDesconto: prod.vDesc || 0,
            valorFrete: prod.vFrete || 0,
            valorSeguro: prod.vSeg || 0,
            outrasDespesas: prod.vOutro || 0,
            valorIpi: imposto.IPI?.IPITrib?.vIPI || imposto.IPI?.IPINT?.vIPI || 0,
            icms: imposto.ICMS || null,
          };
        }),
    };

    return NextResponse.json({ raw: json, parsed: result });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json(
      { error: "Erro ao processar a nota", detail: err?.message },
      { status: 500 }
    );
  }
}
