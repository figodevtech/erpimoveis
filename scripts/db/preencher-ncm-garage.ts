/**
 * Audita e, depois de conferida a classificacao, preenche o NCM dos produtos
 * do Garage Premium.
 *
 * Uso durante a auditoria:
 *   npx tsx scripts/db/preencher-ncm-garage.ts --classificar
 *   npx tsx scripts/db/preencher-ncm-garage.ts --classificar --json
 *
 * Depois da revisao fiscal:
 *   npx tsx scripts/db/preencher-ncm-garage.ts --aplicar
 *   npx tsx scripts/db/preencher-ncm-garage.ts --aplicar --aceitar-baixa
 *
 * O segundo comando e exigido se ainda existir classificacao de baixa
 * confianca; isso evita gravar silenciosamente uma suposicao fiscal.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";
import { extrairItensFiscaisNfe } from "../../src/services/fiscal/dfeXmlParser";

const JSON_OUTPUT = process.argv.slice(2).includes("--json");
const RESUMO_GRUPOS = process.argv.slice(2).includes("--grupos");
const FONTES_NCM = process.argv.slice(2).includes("--fontes-ncm");
const CRUZAR_FONTES = process.argv.slice(2).includes("--cruzar-fontes");
const CRUZAR_BANCOS = process.argv.slice(2).includes("--cruzar-bancos");
const CRUZAR_CADASTRO = process.argv.slice(2).includes("--cruzar-cadastro");
const CRUZAR_XML = process.argv.slice(2).includes("--cruzar-xml");
const CLASSIFICAR = process.argv.slice(2).includes("--classificar");
const APLICAR = process.argv.slice(2).includes("--aplicar");
const ACEITAR_BAIXA = process.argv.slice(2).includes("--aceitar-baixa");
const SOMENTE_SEM_NCM = process.argv.slice(2).includes("--sem-ncm");
const SOMENTE_COM_NCM = process.argv.slice(2).includes("--com-ncm");
const GRUPO_ID = (() => {
  const argumento = process.argv.slice(2).find((item) => item.startsWith("--grupo="));
  if (!argumento) return null;
  const id = Number(argumento.split("=", 2)[1]);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Informe um grupo valido.");
  return id;
})();
const GRUPOS_EXCLUIDOS = (() => {
  const argumento = process.argv.slice(2).find((item) => item.startsWith("--exceto-grupos="));
  if (!argumento) return new Set<number>();
  return new Set(
    argumento.split("=", 2)[1].split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0),
  );
})();

function normalizarChave(valor: unknown) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/gi, "")
    .toUpperCase();
}

type Confianca = "alta" | "media" | "baixa";
type Classificacao = { ncm: string; regra: string; confianca: Confianca };

function resultado(ncm: string, regra: string, confianca: Confianca): Classificacao {
  return { ncm, regra, confianca };
}

function ncmCorreia(nome: string, referencia: string): Classificacao {
  if (nome.includes("DENTAD") || /(?:CT\d|HTD)/.test(referencia)) {
    return resultado("40103600", "correia sincronizadora automotiva", "media");
  }

  const comprimentoMm = Number(referencia.match(/\d{1,2}D?PK(\d{3,4})/)?.[1]);
  if (Number.isFinite(comprimentoMm) && comprimentoMm > 0) {
    const ncm = comprimentoMm <= 1800 ? "40103100" : comprimentoMm <= 2400 ? "40103300" : "40103900";
    return resultado(ncm, `correia Poly-V de ${comprimentoMm} mm`, "alta");
  }

  return resultado("40103900", "outra correia de transmissao", "baixa");
}

function classificarProduto(produto: any, historico: Map<number, string>): Classificacao {
  const id = Number(produto.id);
  const nome = normalizarChave(`${produto.titulo ?? ""} ${produto.descricao ?? ""}`);
  const referencia = normalizarChave(produto.referencia);
  const grupo = normalizarChave(produto.grupo);
  const anterior = historico.get(id);
  if (anterior) return resultado(anterior, "NCM recuperado de entrada/NF-e historica", "alta");

  // Produtos quimicos cuja composicao/finalidade nao pode ser inferida pelo grupo.
  const manuais = new Map<number, Classificacao>([
    [3, resultado("34029019", "limpador preparado para sistema de arrefecimento", "media")],
    [7, resultado("27101932", "oleo lubrificante Motul 5000 10W30 4T", "media")],
    [14, resultado("27101932", "oleo lubrificante Motul 710 2T", "media")],
    [27, resultado("38112190", "aditivo preparado para oleo lubrificante", "media")],
    [60, resultado("84149039", "partes de turbocompressor", "media")],
    [111, resultado("38249941", "kit revisao Wurth identificado em catalogo comercial", "media")],
    [112, resultado("32089039", "verniz a base de polimeros sinteticos", "media")],
    [113, resultado("33074900", "preparacao para perfumar ambiente", "alta")],
    [133, resultado("34031900", "preparacao lubrificante em spray", "media")],
    [138, resultado("63079010", "respirador de protecao PFF", "alta")],
    [142, resultado("34031900", "preparacao antirruido para freios", "media")],
    [169, resultado("84159090", "condensador de ar-condicionado automotivo", "alta")],
    [171, resultado("84099190", "corpo de borboleta para motor de ignicao por centelha", "media")],
    [168, resultado("39269090", "capa plastica para chave automotiva", "media")],
    [188, resultado("84136019", "bomba hidraulica do sistema Haldex", "media")],
    [192, resultado("87089990", "conexao automotiva sem material identificado", "baixa")],
    [206, resultado("84136019", "bomba hidraulica de direcao", "media")],
    [215, resultado("87083090", "modulo do sistema de freio ABS", "media")],
    [227, resultado("84159090", "guia/difusor do sistema de ar-condicionado", "media")],
    [234, resultado("87089483", "caixa de direcao para automovel", "alta")],
    [249, resultado("84099190", "bico injetor para motor de ignicao por centelha", "media")],
    [253, resultado("39235000", "tampa plastica de reservatorio", "media")],
    [268, resultado("82055900", "ferramenta manual para abertura de tanque", "media")],
    [274, resultado("87082999", "moldura de paralama com sensor", "media")],
    [320, resultado("85071090", "bateria auxiliar automotiva", "media")],
    [339, resultado("34039900", "oleo PAG preparado para compressor", "media")],
    [564, resultado("40103100", "correia Poly-V de 735-753 mm identificada pela referencia", "alta")],
    [572, resultado("40103200", "correia trapezoidal nao estriada de 980 mm", "alta")],
    [648, resultado("85119000", "regulador como parte de alternador", "media")],
    [655, resultado("85119000", "partes de alternador", "media")],
    [671, resultado("87089529", "cinta de contato do sistema de airbag", "media")],
    [672, resultado("87089300", "atuador de embreagem", "alta")],
    [673, resultado("85452000", "escova de carvao para motor eletrico", "alta")],
    [675, resultado("85452000", "escova de carvao para alternador", "alta")],
    [677, resultado("73269090", "contrapeso adesivo de aco", "alta")],
    [679, resultado("39173290", "tubo corrugado plastico para combustivel", "media")],
    [693, resultado("35061090", "adesivo/selante para motor", "media")],
    [709, resultado("35061090", "adesivo para para-brisa", "media")],
    [727, resultado("85452000", "escova de carvao para alternador", "alta")],
    [762, resultado("85452000", "escova de carvao para motor eletrico", "alta")],
    [763, resultado("85452000", "escova de carvao para alternador", "alta")],
    [769, resultado("85113020", "bobina de ignicao", "alta")],
    [808, resultado("85119000", "polia roda-livre como parte de alternador", "media")],
  ]);
  const manual = manuais.get(id);
  if (manual) return manual;

  if (nome.includes("FILTRO")) {
    if (nome.includes("CABINE") || nome.includes("ARCONDICIONADO") || nome.includes("ACONDICIONADO")) {
      return resultado("84213990", "filtro de cabine/ar-condicionado", "alta");
    }
    if (nome.includes("COMBUST")) return resultado("84212300", "filtro de combustivel de motor", "alta");
    if (nome.includes("OLEO") || nome.includes("CAMBIO")) {
      return resultado("84219999", "elemento/parte de filtro de oleo", "media");
    }
    if (nome.includes("AR")) return resultado("84219999", "elemento/parte de filtro de ar", "media");
  }
  if (nome.includes("SENSORPASTILHA") || nome.includes("SENSORDESGASTE") || nome.includes("SENSORPAST")) {
    return resultado("87083090", "sensor integrante do sistema de freio", "alta");
  }
  if (nome.includes("PASTILHA") || nome.includes("PASTFREIO")) {
    return resultado("87083019", "pastilha/guarnicao de freio montada", "alta");
  }
  if (nome.includes("PALHETA")) return resultado("85129000", "parte de limpador de para-brisa", "alta");
  if (nome.includes("FUSIVEL") || nome.includes("FUZIVEL")) return resultado("85361000", "fusivel eletrico", "alta");
  if (nome.includes("LAMPADA")) {
    if (nome.includes("XENON") || nome.includes("D2S")) return resultado("85394190", "lampada de descarga para veiculo", "alta");
    if (/LAMPADA(?:H\d+|HALOG)/.test(nome)) return resultado("85392110", "lampada halogena para veiculo", "alta");
    return resultado("85392910", "outra lampada incandescente para veiculo", "media");
  }
  if (nome.includes("SOLUCAOARREF") || nome.includes("ADITIVORADIADOR")) {
    return resultado("38200000", "fluido preparado para arrefecimento", "alta");
  }
  if ((nome.includes("FLUIDO") || nome.includes("OLEO")) && nome.includes("FREIO")) {
    return resultado("38190000", "fluido preparado para freio hidraulico", "alta");
  }
  if (nome.includes("BOMBADAGUA") || nome.includes("BOMBADEAGUA") ||
      nome.includes("BOMBADEARREFECIMENTO") || nome.includes("CAMARADAGUA")) {
    return resultado("84133090", "bomba de arrefecimento para motor", "alta");
  }
  if (nome.includes("RADIADOR") && !nome.includes("MANGUEIRA") &&
      !nome.includes("MANGOTE") && !nome.includes("TUBO")) {
    return resultado("87089100", "radiador e parte de radiador automotivo", "alta");
  }
  if (nome.includes("CONDENSADOR") && nome.includes("ARCONDICIONADO")) {
    return resultado("84159090", "parte de aparelho de ar-condicionado", "alta");
  }
  if (nome.includes("POLIA") || nome.includes("TENSOR")) {
    const livre = nome.includes("LIVRE") || nome.includes("ALTERNADOR");
    return resultado(livre ? "84835010" : "84835090", livre ? "polia automotiva" : "polia/tensor com rolamento", "media");
  }
  if (nome.includes("CORREIA") || nome.includes("CORREUA")) return ncmCorreia(nome, referencia);
  if (nome.includes("ORING") || nome.includes("ANELDEVEDACAO") || nome.includes("RETENTOR") ||
      nome.includes("JUNTA") || nome.includes("VEDACAO") || nome.includes("DIAFRAGMA") || nome.includes("COIFA")) {
    return resultado("40169300", "junta/vedacao de borracha vulcanizada", "media");
  }
  if (nome.includes("ROLAMENTO")) return resultado("84821090", "outro rolamento de esferas", "media");
  if (nome.includes("MANGUEIRA") || nome.includes("MANGOTE") || nome.includes("TUBOARREFECIMENTO") ||
      nome.includes("TUBODEARREFECIMENTO") || nome.includes("TUBODAGUA")) {
    if (nome.includes("FREIO")) return resultado("87083090", "mangueira flexivel do sistema de freio", "alta");
    return resultado("40093100", "tubo/mangueira de borracha reforcada sem acessorios", "media");
  }
  if (nome.includes("ABRACADEIRA")) return resultado("73269090", "outra obra de ferro ou aco", "media");
  if (nome.includes("BOMBADECOMBUST") || nome.includes("BOMBACOMBUST")) {
    return resultado("84133010", "bomba de combustivel para motor", "alta");
  }
  if (nome.includes("OLEO") || nome.includes("GRAXA")) {
    if (nome.includes("ADITIVO") || nome.includes("MILITEC")) return resultado("38112190", "aditivo para oleo lubrificante", "media");
    return resultado("27101932", "oleo lubrificante com aditivos", "media");
  }
  if (nome.includes("MOLDURA") || nome.includes("APLIQUE") || nome.includes("PARACHOQUE") || nome.includes("EMBLEMA")) {
    return resultado("87082999", "outra parte/acessorio de carroceria", "media");
  }
  if (nome.includes("SENSOR") || nome.includes("INTERRUPTOR")) {
    if (nome.includes("PRESSAO") || nome.includes("MAP") || nome.includes("PNEU")) {
      return resultado("90262090", "sensor para medida/controle de pressao", "media");
    }
    if (nome.includes("NIVEL")) return resultado("90261029", "sensor para medida/controle de nivel de liquido", "media");
    if (nome.includes("OLEO")) return resultado("85365090", "interruptor eletrico", "media");
    if (nome.includes("CAPO")) return resultado("85365090", "interruptor eletrico de capo", "media");
    return resultado("90318099", "outro sensor de medida/controle", "media");
  }
  if (nome.includes("PRESILHA") || nome.includes("TRAVA")) return resultado("39269090", "outra obra de plastico", "media");
  if (nome.includes("TAMPADERODA") || nome.includes("CALOTA")) return resultado("87087090", "parte/acessorio de roda automotiva", "alta");
  if (nome.includes("TAMPARESERVATORIO")) return resultado("39235000", "tampa de plastico", "media");
  if (nome.includes("TAMPACOMB") || nome.includes("TAMPADECOMB") || nome.includes("TAMPADOOLHAU")) {
    return resultado("87082999", "parte/acessorio de carroceria", "media");
  }
  if (nome.includes("CAPADECHAVE")) return resultado("39269090", "capa de plastico", "media");
  if (nome.includes("CHAVE")) return resultado("85269200", "aparelho de radiotelecomando", "media");
  if (nome.includes("PORCARODA")) return resultado("73181600", "porca roscada de ferro ou aco", "alta");
  if (nome.includes("ARRUELA")) {
    return resultado(nome.includes("ALUMINIO") ? "76161000" : "73182200", "arruela de metal", "media");
  }
  if (nome.includes("BUJAO") || nome.includes("TAMPAOLEO")) return resultado("83099000", "bujão/tampa de metal", "media");
  if (nome.includes("BIELETA") || nome.includes("AMORTECEDOR") || nome.includes("BUCHA") ||
      nome.includes("PIVO") || nome.includes("BOLSADEAR") || nome.includes("MOLA") || nome.includes("BATENTE")) {
    if (nome.includes("CAPO")) return resultado("87082999", "parte/acessorio de carroceria", "media");
    return resultado("87088000", "sistema de suspensao e sua parte", "media");
  }
  if (nome.includes("BARRAAXIAL") || nome.includes("BARRADIRECAO") || nome.includes("CAIXADEDIRECAO")) {
    return resultado("87089490", "parte do sistema de direcao", "alta");
  }
  if (nome.includes("DISCOFREIO") || nome.includes("CILINDRORODA") || nome.includes("SAPATADEFREIO") ||
      nome.includes("FLEXIVELDEFREIO") || nome.includes("FLEXIVELFREIO") || nome.includes("TUBOFREIO") || nome.includes("ATUADORDEFREIO") ||
      nome.includes("VALVULADEFRENAGEM")) {
    return resultado("87083090", "outra parte do sistema de freio", "alta");
  }
  if (nome.includes("LANTERNA") || nome.includes("BREAKLIGHT") || nome.includes("REFLETOR")) {
    return resultado("85122019", "aparelho de iluminacao/sinalizacao visual automotivo", "media");
  }
  if (nome.includes("ELETROVENTILADOR") || nome.includes("VENTILADORRADIADOR")) {
    return resultado("84145990", "outro ventilador", "media");
  }
  if (nome.includes("ATUADORDEPORTAS")) return resultado("83016000", "parte de fechadura para veiculo", "media");
  if (nome.includes("KITREPAROALAVANCA") || nome.includes("REPAROALAVANCA") ||
      nome.includes("ALAVANCADEMARCHA") || nome.includes("BOLAALAVANCA")) {
    return resultado("87084090", "parte de caixa de marchas", "media");
  }
  if (nome.includes("KITDOEMBREAGEM") || nome.includes("KITEMBREAGEM")) return resultado("87089300", "embreagem e sua parte", "alta");
  if (nome.includes("JUNTAHOMOCINETICA") || nome.includes("TULIPA") || nome.includes("TRIZETA")) {
    return resultado("87085099", "parte de eixo automotivo", "media");
  }
  if (nome.includes("COXIM") || nome.includes("BASEMOTOR") || nome.includes("BASECAMBIO")) {
    return resultado("40169990", "outra obra de borracha vulcanizada", "media");
  }
  if (nome.includes("FITAISOLANTE")) return resultado("39191020", "fita autoadesiva de PVC", "alta");
  if (nome.includes("TARUGORODA")) return resultado("73181500", "parafuso/prisioneiro de roda", "media");
  if (nome.includes("TUBOCOMBUSTIVEL") ||
      (nome.includes("TUBO") && nome.includes("COMBUSTIVEL"))) {
    return resultado("39173290", "tubo plastico para combustivel", "media");
  }
  if (nome.includes("VALVULATERMOSTATICA") || nome.includes("BICOVALVULAPNEU") ||
      nome.includes("BLOCODEVALVULA") || nome.includes("VALVULATORRE") || nome.includes("VALVULAARCONDICIONADO")) {
    return resultado("84818099", "outra valvula", "media");
  }
  if (nome.includes("ESGUICHO")) return resultado("84249090", "parte de aparelho para projetar liquido", "media");
  if (nome.includes("REPAROCOMPRESSOR")) return resultado("84149039", "partes de compressor", "media");
  if (nome.includes("FECHADURA")) return resultado("83016000", "parte de fechadura para veiculo", "media");
  if (nome.includes("FLANGEDEAGUA")) return resultado("84099190", "parte de motor de ignicao por centelha", "media");
  if (nome.includes("ADITIVOLIMPEZA")) return resultado("38112190", "aditivo preparado para oleo", "media");

  const porGrupo = new Map<string, Classificacao>([
    ["JUNTAMOTOR", resultado("40169300", "grupo de juntas/vedacoes", "baixa")],
    ["BOMBADAGUA", resultado("84133090", "grupo de bombas de agua", "media")],
    ["SEMIEIXO", resultado("87085099", "grupo de semieixo/transmissao", "media")],
    ["PORCADERODA", resultado("73181600", "grupo de porcas de roda", "media")],
    ["BIELETA", resultado("87088000", "grupo de suspensao", "media")],
    ["PALHETA", resultado("85129000", "grupo de palhetas", "alta")],
    ["ACESSORIO", resultado("87089990", "outro acessorio automotivo", "baixa")],
    ["RADIADOR", resultado("87089100", "grupo de radiadores", "media")],
    ["TURBINA", resultado("84149039", "grupo de partes de turbocompressor", "media")],
    ["SUSPENSAO", resultado("87088000", "grupo de suspensao", "media")],
    ["FREIO", resultado("87083090", "grupo do sistema de freio", "media")],
    ["SENSORABS", resultado("90318099", "grupo de sensores ABS", "baixa")],
    ["SENSOR", resultado("90318099", "grupo de sensores", "baixa")],
    ["QUIMICOS", resultado("38249989", "outra preparacao quimica", "baixa")],
    ["ROLAMENTO", resultado("84821090", "grupo de rolamentos", "media")],
    ["BATERIA", resultado("85071090", "grupo de baterias automotivas", "media")],
    ["RESERVATORIODEAGUA", resultado("87089990", "reservatorio automotivo", "media")],
    ["PARALELA", resultado("87089990", "outra parte/acessorio automotivo", "baixa")],
    ["PRESILHAFIXACAO", resultado("39269090", "grupo de presilhas plasticas", "media")],
    ["RETENTOR", resultado("40169300", "grupo de retentores", "media")],
    ["BOMBADECOMBUSTIVEL", resultado("84133010", "grupo de bombas de combustivel", "media")],
    ["JUNTATAMPADEVALVULA", resultado("40169300", "grupo de juntas", "media")],
    ["COIFAS", resultado("40169300", "grupo de coifas/vedacoes", "media")],
    ["ARCONDICIONADO", resultado("84159090", "parte de ar-condicionado", "baixa")],
    ["BARRAAXIAL", resultado("87089490", "grupo do sistema de direcao", "media")],
    ["TUBOMANGOTE", resultado("40093100", "grupo de tubos/mangotes", "media")],
    ["MANGOTEMANGUEIRA", resultado("40093100", "grupo de mangueiras", "media")],
    ["POLIA", resultado("84835090", "grupo de polias", "media")],
    ["ELETRICA", resultado("85119000", "outra parte eletrica automotiva", "baixa")],
    ["CHUMBO", resultado("73269090", "contrapeso automotivo de aco", "media")],
    ["AMORTECEDOR", resultado("87088000", "grupo de suspensao", "media")],
    ["CARROCERIA", resultado("87082999", "outra parte de carroceria", "media")],
    ["CALOTASTAMPASDERODA", resultado("87087090", "parte/acessorio de roda", "media")],
    ["CHAVE", resultado("85269200", "radiotelecomando automotivo", "media")],
    ["CUBODERODA", resultado("87087090", "parte/acessorio de roda", "media")],
    ["FITAISOLANTECREPE", resultado("39191020", "fita autoadesiva de PVC", "media")],
    ["TENSOR", resultado("84835090", "polia/tensor", "media")],
    ["VEDACAO", resultado("40169300", "grupo de vedacao", "media")],
    ["OLEO", resultado("27101932", "grupo de lubrificantes", "baixa")],
    ["LAMPADA", resultado("85392910", "grupo de lampadas automotivas", "baixa")],
    ["CORREIA", resultado("40103900", "grupo de correias", "baixa")],
    ["ABRACADEIRAS", resultado("73269090", "grupo de abracadeiras", "media")],
    ["ADITIVO", resultado("38112190", "grupo de aditivos", "baixa")],
    ["COXIN", resultado("40169990", "grupo de coxins", "media")],
    ["SERVICOS", resultado("87089990", "cadastro de peca em grupo incorreto", "baixa")],
    ["SELECIONE", resultado("87089990", "grupo sem classificacao cadastral", "baixa")],
  ]);
  return porGrupo.get(grupo) ?? resultado("87089990", "outra parte/acessorio automotivo", "baixa");
}

async function ncmsOficiaisVigentes() {
  const auditadosEm20260825 = new Set(`
    27101932 32089039 33074900 34029019 34029039 34031900 34039900
    35061090 38112190 38190000 38200000 38249941 38249989 39173290
    39191020 39235000 39269090 40093100 40103100 40103200 40103300 40103600
    40103900 40169300 40169990 63079010 73181500 73181600 73182200
    73269090 76161000 82055900 83016000 83099000 84099190 84133010
    84133090 84136019 84145990 84149039 84159090 84212300 84213100
    84213990 84219999 84249090 84818099 84821090 84835010 84835090
    85071090 85113020 85119000 85122019 85129000 85269200 85361000
    85365090 85392110 85392910 85394190 85432000 85452000 87082999
    87083019 87083090 87084090 87085099 87087090 87088000 87089100
    87089300 87089483 87089490 87089529 87089990 90261029 90262090
    90318099
  `.trim().split(/\s+/));

  const resposta = await fetch(
    "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json",
  );
  if (!resposta.ok) {
    console.warn(
      `Tabela oficial indisponivel (HTTP ${resposta.status}); usando codigos auditados em 25/08/2026.`,
    );
    return auditadosEm20260825;
  }
  const tabela = await resposta.json() as { Nomenclaturas?: Array<{ Codigo?: string }> };
  return new Set(
    (tabela.Nomenclaturas ?? [])
      .map((item) => String(item.Codigo ?? "").replace(/\D/g, ""))
      .filter((codigo) => codigo.length === 8),
  );
}

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!configuracao) throw new Error("O banco Garage Premium nao esta configurado.");

  const { client } = await connectDatabase(configuracao);

  try {
    if (CLASSIFICAR || APLICAR) {
      const { rows: produtos } = await client.query(`
        SELECT p.id, p.titulo, p.descricao, p.referencia, p.fabricante,
               p.ncm, p.grupo_produto_id, g.nome AS grupo
          FROM public.produto p
          LEFT JOIN public.produtogrupo g ON g.id = p.grupo_produto_id
         WHERE p.ncm IS NULL OR btrim(p.ncm) = ''
         ORDER BY p.id
      `);
      const { rows: historicos } = await client.query(`
        WITH historico AS (
          SELECT produto_id, btrim(ncm) AS ncm
            FROM public.entradaitens
           WHERE ncm ~ '^[0-9]{8}$'
          UNION ALL
          SELECT produtoid AS produto_id, btrim(ncm) AS ncm
            FROM public.nfe_item
           WHERE produtoid IS NOT NULL AND ncm ~ '^[0-9]{8}$'
        )
        SELECT produto_id, min(ncm) AS ncm
          FROM historico
         GROUP BY produto_id
        HAVING count(DISTINCT ncm) = 1
      `);
      const historico = new Map<number, string>(
        historicos.map((item) => [Number(item.produto_id), String(item.ncm)]),
      );
      const classificados = produtos.map((produto) => ({
        ...produto,
        ...classificarProduto(produto, historico),
      }));

      const oficiais = await ncmsOficiaisVigentes();
      const inexistentes = [...new Set(
        classificados.map((item) => item.ncm).filter((ncm) => !oficiais.has(ncm)),
      )];
      if (inexistentes.length > 0) {
        throw new Error(`NCM(s) ausente(s) da tabela oficial vigente: ${inexistentes.join(", ")}.`);
      }

      const porConfianca = (["alta", "media", "baixa"] as Confianca[]).map((confianca) => ({
        confianca,
        produtos: classificados.filter((item) => item.confianca === confianca).length,
      }));
      const porRegra = [...new Set(classificados.map((item) => `${item.ncm}|${item.regra}`))]
        .map((chave) => {
          const [ncm, regra] = chave.split("|", 2);
          return {
            ncm,
            regra,
            produtos: classificados.filter((item) => item.ncm === ncm && item.regra === regra).length,
          };
        })
        .sort((a, b) => b.produtos - a.produtos || a.ncm.localeCompare(b.ncm));

      console.log(`Produtos a preencher: ${classificados.length}`);
      console.table(porConfianca);
      console.table(porRegra);
      const baixa = classificados.filter((item) => item.confianca === "baixa");
      if (baixa.length > 0) {
        console.log(`Classificacoes de baixa confianca (${baixa.length}):`);
        console.table(baixa.map((item) => ({
          id: item.id,
          produto: item.titulo || item.descricao,
          referencia: item.referencia,
          fabricante: item.fabricante,
          grupo: item.grupo,
          ncm: item.ncm,
          regra: item.regra,
        })));
      }

      if (!APLICAR) {
        console.log("\nSimulacao: nada foi gravado. Use --aplicar somente depois da revisao fiscal.");
        return;
      }

      if (baixa.length > 0 && !ACEITAR_BAIXA) {
        throw new Error(
          `Existem ${baixa.length} classificacao(oes) de baixa confianca. ` +
          "Revise-as ou repita com --aceitar-baixa.",
        );
      }

      await client.query("BEGIN");
      const payload = classificados.map((item) => ({ id: Number(item.id), ncm: item.ncm }));
      const atualizacao = await client.query(
        `UPDATE public.produto p
            SET ncm = dados.ncm,
                updatedat = now()
           FROM jsonb_to_recordset($1::jsonb) AS dados(id integer, ncm text)
          WHERE p.id = dados.id
            AND (p.ncm IS NULL OR btrim(p.ncm) = '')`,
        [JSON.stringify(payload)],
      );
      if (atualizacao.rowCount !== classificados.length) {
        throw new Error(
          `Concorrencia detectada: esperado atualizar ${classificados.length}, atualizado ${atualizacao.rowCount}.`,
        );
      }

      const { rows: conferencia } = await client.query(`
        SELECT count(*)::int AS total,
               count(*) FILTER (WHERE ncm IS NULL OR btrim(ncm) = '')::int AS sem_ncm,
               count(*) FILTER (WHERE ncm !~ '^[0-9]{8}$')::int AS formato_invalido
          FROM public.produto
      `);
      console.table(conferencia);
      if (Number(conferencia[0].sem_ncm) !== 0 || Number(conferencia[0].formato_invalido) !== 0) {
        throw new Error("A conferencia final encontrou produto sem NCM ou com formato invalido.");
      }

      await client.query("COMMIT");
      console.log(`\nAplicado: ${atualizacao.rowCount} produto(s) atualizado(s).`);
      return;
    }

    if (FONTES_NCM) {
      const { rows: fontes } = await client.query(`
        SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS colunas
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('entrada', 'entradaitens', 'fiscal_dfe_documento', 'nfe_item', 'produto',
                              'usoconsumo_entrada_item', 'usoconsumo_item')
         GROUP BY table_name
         ORDER BY table_name
      `);
      console.table(fontes);
      return;
    }

    if (CRUZAR_FONTES) {
      const { rows: candidatos } = await client.query(`
        WITH historico AS (
          SELECT produto_id AS produto_id, btrim(ncm) AS ncm, 'entrada' AS fonte
            FROM public.entradaitens
           WHERE ncm ~ '^[0-9]{8}$'
          UNION ALL
          SELECT produtoid AS produto_id, btrim(ncm) AS ncm, 'nfe_saida' AS fonte
            FROM public.nfe_item
           WHERE produtoid IS NOT NULL AND ncm ~ '^[0-9]{8}$'
        ), consolidados AS (
          SELECT produto_id,
                 array_agg(DISTINCT ncm ORDER BY ncm) AS ncms,
                 array_agg(DISTINCT fonte ORDER BY fonte) AS fontes,
                 count(*) AS ocorrencias
            FROM historico
           GROUP BY produto_id
        )
        SELECT p.id,
               coalesce(nullif(btrim(p.titulo), ''), nullif(btrim(p.descricao), ''), '?') AS nome,
               p.referencia,
               g.nome AS grupo,
               c.ncms,
               c.fontes,
               c.ocorrencias
          FROM public.produto p
          JOIN consolidados c ON c.produto_id = p.id
          LEFT JOIN public.produtogrupo g ON g.id = p.grupo_produto_id
         WHERE p.ncm IS NULL OR btrim(p.ncm) = ''
         ORDER BY cardinality(c.ncms), p.id
      `);

      console.log(`Produtos sem NCM recuperaveis do historico: ${candidatos.length}`);
      console.log(
        `  candidato unico: ${candidatos.filter((item) => item.ncms.length === 1).length}`,
      );
      console.log(
        `  historico conflitante: ${candidatos.filter((item) => item.ncms.length > 1).length}`,
      );
      console.table(candidatos);
      return;
    }

    if (CRUZAR_BANCOS) {
      const { rows: produtosGarage } = await client.query(`
        SELECT id, titulo, descricao, referencia, fabricante
          FROM public.produto
         WHERE ncm IS NULL OR btrim(ncm) = ''
         ORDER BY id
      `);

      const externos: Array<{
        banco: string;
        id: number;
        titulo: string | null;
        descricao: string | null;
        referencia: string | null;
        fabricante: string | null;
        ncm: string;
      }> = [];

      for (const banco of loadDatabaseConfigs().filter((item) => item.key !== "garage")) {
        const conexao = await connectDatabase(banco);
        try {
          const { rows } = await conexao.client.query(`
            SELECT id, titulo, descricao, referencia, fabricante, btrim(ncm) AS ncm
              FROM public.produto
             WHERE ncm ~ '^[0-9]{8}$'
          `);
          externos.push(...rows.map((item) => ({ ...item, banco: banco.label })));
        } finally {
          await conexao.client.end().catch(() => undefined);
        }
      }

      const candidatos = produtosGarage.flatMap((produto) => {
        const nome = normalizarChave(produto.titulo || produto.descricao);
        const referencia = normalizarChave(produto.referencia);
        const correspondencias = externos.filter((externo) => {
          const nomeExterno = normalizarChave(externo.titulo || externo.descricao);
          const referenciaExterna = normalizarChave(externo.referencia);
          return (nome.length >= 8 && nome === nomeExterno) ||
            (referencia.length >= 6 && referencia === referenciaExterna);
        });
        if (correspondencias.length === 0) return [];

        return [{
          id: produto.id,
          nome: produto.titulo || produto.descricao,
          referencia: produto.referencia,
          ncms: [...new Set(correspondencias.map((item) => item.ncm))].sort(),
          bancos: [...new Set(correspondencias.map((item) => item.banco))].sort(),
          correspondencias: correspondencias.length,
        }];
      });

      console.log(`Produtos sem NCM encontrados em outros bancos: ${candidatos.length}`);
      console.log(`  candidato unico: ${candidatos.filter((item) => item.ncms.length === 1).length}`);
      console.log(`  conflitante: ${candidatos.filter((item) => item.ncms.length > 1).length}`);
      console.table(candidatos);
      return;
    }

    if (CRUZAR_CADASTRO) {
      const { rows: produtos } = await client.query(`
        SELECT p.id, p.titulo, p.descricao, p.referencia, p.ncm, g.nome AS grupo
          FROM public.produto p
          LEFT JOIN public.produtogrupo g ON g.id = p.grupo_produto_id
         ORDER BY p.id
      `);
      const preenchidos = produtos.filter((produto) => /^\d{8}$/.test(String(produto.ncm ?? "")));
      const candidatos = produtos
        .filter((produto) => !String(produto.ncm ?? "").trim())
        .flatMap((produto) => {
          const nome = normalizarChave(produto.titulo || produto.descricao);
          if (nome.length < 8) return [];
          const iguais = preenchidos.filter(
            (preenchido) => normalizarChave(preenchido.titulo || preenchido.descricao) === nome,
          );
          if (iguais.length === 0) return [];
          return [{
            id: produto.id,
            nome: produto.titulo || produto.descricao,
            referencia: produto.referencia,
            grupo: produto.grupo,
            ncms: [...new Set(iguais.map((item) => item.ncm))].sort(),
            exemplos: iguais.map((item) => item.id).join(", "),
          }];
        });

      console.log(`Produtos repetidos com NCM no proprio cadastro: ${candidatos.length}`);
      console.log(`  candidato unico: ${candidatos.filter((item) => item.ncms.length === 1).length}`);
      console.log(`  conflitante: ${candidatos.filter((item) => item.ncms.length > 1).length}`);
      console.table(candidatos);
      return;
    }

    if (CRUZAR_XML) {
      const { rows: linhas } = await client.query(`
        SELECT ei.id AS entrada_item_id,
               ei.produto_id,
               ei.numero_item_fiscal,
               ei.titulo AS titulo_entrada,
               p.titulo AS titulo_produto,
               p.descricao AS descricao_produto,
               p.referencia,
               e.id AS entrada_id,
               d.schema,
               d.xml
          FROM public.entradaitens ei
          JOIN public.produto p ON p.id = ei.produto_id
          JOIN public.entrada e ON e.id = ei.entrada_id
          LEFT JOIN LATERAL (
            SELECT doc.schema, doc.xml
              FROM public.fiscal_dfe_documento doc
             WHERE doc.id = e.fiscal_dfe_documento_id
                OR (nullif(btrim(e.notachave), '') IS NOT NULL
                    AND doc.chave_acesso = regexp_replace(e.notachave, '[^0-9]', '', 'g'))
             ORDER BY CASE WHEN doc.schema LIKE 'procNFe%' THEN 0 ELSE 1 END,
                      length(doc.xml) DESC NULLS LAST
             LIMIT 1
          ) d ON true
         WHERE (p.ncm IS NULL OR btrim(p.ncm) = '')
           AND nullif(btrim(d.xml), '') IS NOT NULL
         ORDER BY ei.produto_id, ei.id
      `);

      const encontrados: Array<{
        id: number;
        nome: string;
        referencia: string | null;
        ncm: string;
        fonte: string;
        entrada: number;
      }> = [];

      for (const linha of linhas) {
        const itens = extrairItensFiscaisNfe(String(linha.xml));
        const numero = Number(linha.numero_item_fiscal);
        let item = Number.isInteger(numero) && numero > 0
          ? itens.find((candidato) => candidato.nItem === numero)
          : undefined;
        let fonte = "numero_item";

        if (!item) {
          const nomes = [linha.titulo_entrada, linha.titulo_produto, linha.descricao_produto]
            .map(normalizarChave)
            .filter((nome) => nome.length >= 8);
          const iguais = itens.filter((candidato) =>
            nomes.includes(normalizarChave(candidato.descricao)),
          );
          if (iguais.length === 1) {
            item = iguais[0];
            fonte = "descricao_exata";
          }
        }

        if (item?.ncm && /^\d{8}$/.test(item.ncm)) {
          encontrados.push({
            id: Number(linha.produto_id),
            nome: linha.titulo_produto || linha.descricao_produto || "?",
            referencia: linha.referencia,
            ncm: item.ncm,
            fonte,
            entrada: Number(linha.entrada_id),
          });
        }
      }

      const consolidados = [...new Set(encontrados.map((item) => item.id))].map((id) => {
        const itens = encontrados.filter((item) => item.id === id);
        return {
          id,
          nome: itens[0].nome,
          referencia: itens[0].referencia,
          ncms: [...new Set(itens.map((item) => item.ncm))].sort(),
          fontes: [...new Set(itens.map((item) => item.fonte))].sort(),
          entradas: [...new Set(itens.map((item) => item.entrada))].sort((a, b) => a - b).join(", "),
        };
      });

      console.log(`Itens de entrada ligados a XML: ${linhas.length}`);
      console.log(`Produtos sem NCM recuperados do XML: ${consolidados.length}`);
      console.log(`  candidato unico: ${consolidados.filter((item) => item.ncms.length === 1).length}`);
      console.log(`  conflitante: ${consolidados.filter((item) => item.ncms.length > 1).length}`);
      console.table(consolidados);
      return;
    }

    const { rows: produtos } = await client.query(`
      SELECT p.id,
             coalesce(nullif(btrim(p.titulo), ''), nullif(btrim(p.descricao), ''), '?') AS nome,
             p.titulo,
             p.descricao,
             p.referencia,
             p.codigobarras,
             p.fabricante,
             p.unidade,
             p.ncm,
             p.cest,
             p.estoque,
             p.precovenda,
             p.grupo_produto_id,
             g.nome AS grupo
        FROM public.produto p
        LEFT JOIN public.produtogrupo g ON g.id = p.grupo_produto_id
       ORDER BY p.id
    `);

    const resumo = {
      total: produtos.length,
      semNcm: produtos.filter((produto) => !String(produto.ncm ?? "").trim()).length,
      formatoValido: produtos.filter((produto) => /^\d{8}$/.test(String(produto.ncm ?? ""))).length,
      formatoInvalido: produtos.filter((produto) => {
        const ncm = String(produto.ncm ?? "").trim();
        return ncm.length > 0 && !/^\d{8}$/.test(ncm);
      }).length,
    };

    if (RESUMO_GRUPOS) {
      const grupos = new Map<
        string,
        { id: number | null; grupo: string; total: number; semNcm: number; ncms: Set<string> }
      >();

      for (const produto of produtos) {
        const chave = String(produto.grupo_produto_id ?? "sem-grupo");
        const grupo = grupos.get(chave) ?? {
          id: produto.grupo_produto_id,
          grupo: produto.grupo ?? "SEM GRUPO",
          total: 0,
          semNcm: 0,
          ncms: new Set<string>(),
        };
        grupo.total += 1;
        const ncm = String(produto.ncm ?? "").trim();
        if (ncm) grupo.ncms.add(ncm);
        else grupo.semNcm += 1;
        grupos.set(chave, grupo);
      }

      console.table(
        [...grupos.values()]
          .sort((a, b) => b.semNcm - a.semNcm || a.grupo.localeCompare(b.grupo))
          .map((grupo) => ({
            id: grupo.id,
            grupo: grupo.grupo,
            total: grupo.total,
            semNcm: grupo.semNcm,
            ncmsExistentes: [...grupo.ncms].sort().join(", "),
          })),
      );
      return;
    }

    const produtosFiltrados = produtos.filter((produto) => {
      if (GRUPO_ID !== null && Number(produto.grupo_produto_id) !== GRUPO_ID) return false;
      if (GRUPOS_EXCLUIDOS.has(Number(produto.grupo_produto_id))) return false;
      if (SOMENTE_SEM_NCM && String(produto.ncm ?? "").trim()) return false;
      if (SOMENTE_COM_NCM && !String(produto.ncm ?? "").trim()) return false;
      return true;
    });

    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ resumo, produtos: produtosFiltrados }, null, 2));
      return;
    }

    console.log("Garage Premium — auditoria de NCM");
    console.table(resumo);
    console.table(
      produtosFiltrados.map((produto) => ({
        id: produto.id,
        nome: String(produto.nome).slice(0, 70),
        referencia: produto.referencia,
        fabricante: produto.fabricante,
        grupo: produto.grupo,
        ncm: produto.ncm,
      })),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
