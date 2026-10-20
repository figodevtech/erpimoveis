/**
 * Configuração do SPED Fiscal em perguntas de quem opera o ERP.
 *
 * Cada pergunta grava os mesmos campos de `fiscal_sped_config` que a tela
 * técnica grava. O que a lei ou o cadastro já respondem é deduzido aqui, com a
 * evidência escrita pelo sistema; o que depende da operação vira pergunta em
 * linguagem comum. Módulo puro: a tela e o servidor usam as mesmas regras.
 */

export type SpedConfigCampos = Record<string, unknown>;

export type SpedFatosEmpresa = {
  uf: string | null;
  regimeTributario: string | null;
  cnae: string | null;
  /** Há recebimento por PIX, crédito ou débito no financeiro. Null: sem dados. */
  recebeCartaoOuPix: boolean | null;
  /** Há NF-e de importação (CFOP 3xxx) emitida pelo ERP. Null: sem dados. */
  importaDoExterior: boolean | null;
};

export type SpedOrigemResposta = "AUTOMATICA" | "RESPOSTA" | "CONTADOR";

export type SpedPerguntaId =
  | "industria"
  | "perfil"
  | "cartaoPix"
  | "efdContribuicoes"
  | "blocoK"
  | "creditoRevenda"
  | "csosn"
  | "inventario"
  | "ressarcimentoSt"
  | "registro1400"
  | "combustiveis"
  | "energia"
  | "usina"
  | "aereo"
  | "exportacao"
  | "formularioSeguranca"
  | "creditoAcumulado"
  | "giaf1"
  | "giaf3"
  | "giaf4";

export type SpedOpcao = { valor: string; rotulo: string };

export type SpedPergunta = {
  id: SpedPerguntaId;
  /** EMPRESA: quem opera o ERP sabe. CONTADOR: precisa perguntar ao contador. */
  quemResponde: "EMPRESA" | "CONTADOR";
  pergunta: string;
  ajuda: string;
  opcoes: SpedOpcao[];
};

export type SpedRespostaAtual = {
  valor: string;
  descricao: string;
  origem: SpedOrigemResposta | null;
  confirmadoEm: string | null;
};

export type SpedDeducao = { valor: string; descricao: string };

/** Patch no formato aceito por `updateSpedConfiguration`. */
export type SpedConfigPatch = {
  campos: Record<string, unknown>;
  evidencias: Record<string, { descricao: string; origem: SpedOrigemResposta; modo?: string }>;
  indicadores1010: Record<string, { valor: "S" | "N"; status: "CONFIRMADO"; descricao: string; origem: SpedOrigemResposta }>;
  politicas: Record<string, unknown>;
};

const SIM_NAO: SpedOpcao[] = [
  { valor: "SIM", rotulo: "Sim" },
  { valor: "NAO", rotulo: "Não" },
];

/** Correspondência usual CSOSN → CST para escriturar compras de optantes do Simples. */
export const CSOSN_PARA_CST_PADRAO: Record<string, string> = {
  "101": "90", "102": "90", "103": "40", "201": "10", "202": "10",
  "203": "30", "300": "41", "400": "40", "500": "60", "900": "90",
};

export const SPED_PERGUNTAS: readonly SpedPergunta[] = [
  {
    id: "industria",
    quemResponde: "EMPRESA",
    pergunta: "A empresa fabrica, monta ou transforma produtos, ou importa mercadorias direto do exterior?",
    ajuda: "Oficinas, lojas e prestadores de serviço respondem Não. Define se a empresa é tratada como indústria e se paga IPI.",
    opcoes: SIM_NAO,
  },
  {
    id: "cartaoPix",
    quemResponde: "EMPRESA",
    pergunta: "A empresa recebe pagamentos por cartão de crédito, débito ou PIX?",
    ajuda: "Quem recebe assim informa no SPED o total recebido por banco ou maquininha (registro 1601). O arquivo vem do banco ou da operadora.",
    opcoes: SIM_NAO,
  },
  {
    id: "combustiveis",
    quemResponde: "EMPRESA",
    pergunta: "A empresa é posto ou distribuidora de combustíveis?",
    ajuda: "Vender óleo lubrificante não conta. Vale só para quem revende gasolina, etanol, diesel ou GNV.",
    opcoes: SIM_NAO,
  },
  {
    id: "energia",
    quemResponde: "EMPRESA",
    pergunta: "A empresa gera, transmite ou distribui energia elétrica?",
    ajuda: "Consumir energia não conta.",
    opcoes: SIM_NAO,
  },
  {
    id: "usina",
    quemResponde: "EMPRESA",
    pergunta: "A empresa é usina de açúcar ou álcool?",
    ajuda: "",
    opcoes: SIM_NAO,
  },
  {
    id: "aereo",
    quemResponde: "EMPRESA",
    pergunta: "A empresa faz transporte aéreo de passageiros ou de carga?",
    ajuda: "",
    opcoes: SIM_NAO,
  },
  {
    id: "perfil",
    quemResponde: "CONTADOR",
    pergunta: "Qual é o perfil do SPED Fiscal da empresa?",
    ajuda: "Quem define é a SEFAZ. O contador sabe, e o perfil aparece no último SPED entregue (primeira linha, penúltimo campo).",
    opcoes: [
      { valor: "A", rotulo: "Perfil A" },
      { valor: "B", rotulo: "Perfil B" },
      { valor: "C", rotulo: "Perfil C" },
    ],
  },
  {
    id: "efdContribuicoes",
    quemResponde: "CONTADOR",
    pergunta: "A empresa entrega a EFD-Contribuições (PIS/COFINS)?",
    ajuda: "Empresas do Lucro Presumido e do Lucro Real entregam; as do Simples Nacional, não.",
    opcoes: SIM_NAO,
  },
  {
    id: "blocoK",
    quemResponde: "CONTADOR",
    pergunta: "A empresa precisa informar o controle de produção e estoque (Bloco K)?",
    ajuda: "Exigido de indústrias e atacadistas fora do Simples Nacional.",
    opcoes: SIM_NAO,
  },
  {
    id: "creditoRevenda",
    quemResponde: "CONTADOR",
    pergunta: "O ICMS das compras para revenda gera crédito?",
    ajuda: "No Simples Nacional, não. No regime normal (Lucro Presumido ou Real), sim.",
    opcoes: SIM_NAO,
  },
  {
    id: "csosn",
    quemResponde: "CONTADOR",
    pergunta: "Como escriturar compras de fornecedores do Simples Nacional?",
    ajuda: "A nota desses fornecedores traz CSOSN e o SPED exige CST. O ERP usa a correspondência usual; o contador pode trocá-la nos ajustes técnicos.",
    opcoes: [{ valor: "PADRAO", rotulo: "Correspondência usual CSOSN → CST" }],
  },
  {
    id: "inventario",
    quemResponde: "CONTADOR",
    pergunta: "Quando o inventário de estoque entra no SPED?",
    ajuda: "A lei pede o estoque de 31 de dezembro no SPED de fevereiro do ano seguinte.",
    opcoes: [{ valor: "AUTOMATICO", rotulo: "No SPED de fevereiro, com o estoque de 31/12" }],
  },
  {
    id: "ressarcimentoSt",
    quemResponde: "CONTADOR",
    pergunta: "A empresa pede de volta à SEFAZ o ICMS-ST de mercadorias vendidas para outro estado?",
    ajuda: "É um pedido opcional (ressarcimento). O ERP ainda não gera esses registros: com Sim, o arquivo final fica bloqueado.",
    opcoes: SIM_NAO,
  },
  {
    id: "registro1400",
    quemResponde: "CONTADOR",
    pergunta: "A empresa precisa informar o valor adicionado por município (registro 1400)?",
    ajuda: "Só alguns estados pedem, e só para certas operações, como compra de produtor rural ou serviço de transporte. Oficinas e lojas de peças normalmente não têm.",
    opcoes: SIM_NAO,
  },
  {
    id: "creditoAcumulado",
    quemResponde: "CONTADOR",
    pergunta: "A empresa tem crédito acumulado de ICMS controlado pela SEFAZ (para transferir ou usar com autorização)?",
    ajuda: "É um controle especial, comum em exportadoras. Quem só compra e vende no mercado interno normalmente não tem.",
    opcoes: SIM_NAO,
  },
  {
    id: "exportacao",
    quemResponde: "EMPRESA",
    pergunta: "A empresa vende para fora do país?",
    ajuda: "As notas de exportação (CFOP 7xxx) são reconhecidas sozinhas em cada mês.",
    opcoes: SIM_NAO,
  },
  {
    id: "formularioSeguranca",
    quemResponde: "EMPRESA",
    pergunta: "A empresa emite nota em formulário de segurança (FS-DA)?",
    ajuda: "O ERP não emite nesse formato.",
    opcoes: SIM_NAO,
  },
  {
    id: "giaf1",
    quemResponde: "CONTADOR",
    pergunta: "A empresa está obrigada à GIAF 1 (Pernambuco)?",
    ajuda: "Obrigação exclusiva de Pernambuco.",
    opcoes: SIM_NAO,
  },
  {
    id: "giaf3",
    quemResponde: "CONTADOR",
    pergunta: "A empresa está obrigada à GIAF 3 (Pernambuco)?",
    ajuda: "Obrigação exclusiva de Pernambuco.",
    opcoes: SIM_NAO,
  },
  {
    id: "giaf4",
    quemResponde: "CONTADOR",
    pergunta: "A empresa está obrigada à GIAF 4 (Pernambuco)?",
    ajuda: "Obrigação exclusiva de Pernambuco.",
    opcoes: SIM_NAO,
  },
];

const INDICADOR_1010: Partial<Record<SpedPerguntaId, string>> = {
  combustiveis: "IND_COMB",
  energia: "IND_EE",
  usina: "IND_USINA",
  aereo: "IND_AER",
  exportacao: "IND_EXP",
  formularioSeguranca: "IND_FORM",
  creditoAcumulado: "IND_CCRF",
  giaf1: "IND_GIAF1",
  giaf3: "IND_GIAF3",
  giaf4: "IND_GIAF4",
};

/** Pergunta → [campo do valor, campo do status, chave da evidência]. */
const GATE_SIMPLES: Partial<Record<SpedPerguntaId, [string, string, string]>> = {
  cartaoPix: ["registro_1601_aplicavel", "registro_1601_status", "1601"],
  efdContribuicoes: ["entrega_efd_contribuicoes", "entrega_efd_contribuicoes_status", "efd-contribuicoes"],
  blocoK: ["bloco_k_obrigatorio", "bloco_k_status", "bloco-k"],
  ressarcimentoSt: ["c176_c179_aplicavel", "c176_c179_status", "c176-c179"],
  registro1400: ["registro_1400_aplicavel", "registro_1400_status", "1400"],
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function digits(value: unknown): string {
  return text(value).replace(/\D/g, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function origemDe(value: unknown): SpedOrigemResposta | null {
  const origem = text(value);
  return origem === "AUTOMATICA" || origem === "RESPOSTA" || origem === "CONTADOR" ? origem : null;
}

function evidenciaDe(campos: SpedConfigCampos, chave: string): Omit<SpedRespostaAtual, "valor"> {
  const raw = record(campos.evidencias)[chave];
  const detalhe = record(raw);
  return {
    descricao: typeof raw === "string" ? raw : text(detalhe.descricao),
    origem: origemDe(detalhe.origem),
    confirmadoEm: text(detalhe.confirmadoEm) || null,
  };
}

/** Pernambuco tem perguntas próprias (GIAF); as demais valem para todas as UFs. */
export function perguntaVisivel(id: SpedPerguntaId, fatos: Pick<SpedFatosEmpresa, "uf">): boolean {
  if (id === "giaf1" || id === "giaf3" || id === "giaf4") return text(fatos.uf).toUpperCase() === "PE";
  return true;
}

export function respostaAtual(id: SpedPerguntaId, campos: SpedConfigCampos): SpedRespostaAtual | null {
  const indicador = INDICADOR_1010[id];
  if (indicador) {
    const item = record(record(record(campos.evidencias).indicadores_1010)[indicador]);
    const valor = text(item.valor).toUpperCase();
    if (text(item.status) !== "CONFIRMADO" || (valor !== "S" && valor !== "N")) return null;
    return {
      valor: valor === "S" ? "SIM" : "NAO",
      descricao: text(item.descricao),
      origem: origemDe(item.origem),
      confirmadoEm: text(item.confirmadoEm) || null,
    };
  }

  const gate = GATE_SIMPLES[id];
  if (gate) {
    const [valorCampo, statusCampo, chave] = gate;
    const status = text(campos[statusCampo]);
    if (status === "NAO_APLICAVEL") return { valor: "NAO", ...evidenciaDe(campos, chave) };
    if (status !== "CONFIRMADO" || typeof campos[valorCampo] !== "boolean") return null;
    return { valor: campos[valorCampo] ? "SIM" : "NAO", ...evidenciaDe(campos, chave) };
  }

  if (id === "industria") {
    const atividade = text(campos.indicador_atividade);
    if (text(campos.indicador_atividade_status) !== "CONFIRMADO" || !["0", "1"].includes(atividade)) return null;
    if (text(campos.contribuinte_ipi_status) === "PENDENTE" || !text(campos.contribuinte_ipi_status)) return null;
    return { valor: atividade === "0" ? "SIM" : "NAO", ...evidenciaDe(campos, "atividade") };
  }
  if (id === "perfil") {
    const perfil = text(campos.perfil_efd);
    if (text(campos.perfil_efd_status) !== "CONFIRMADO" || !perfil) return null;
    return { valor: perfil, ...evidenciaDe(campos, "perfil") };
  }
  if (id === "inventario") {
    if (text(campos.inventario_status) === "PENDENTE" || !text(campos.inventario_status)) return null;
    const evidencia = evidenciaDe(campos, "inventario");
    const automatico = text(record(record(campos.evidencias).inventario).modo) === "AUTOMATICO";
    return { valor: automatico ? "AUTOMATICO" : "MANUAL", ...evidencia };
  }
  if (id === "creditoRevenda") {
    const politica = record(record(campos.evidencias).politica_credito_revenda);
    if (text(politica.status) !== "CONFIRMADO" || typeof politica.aplicavel !== "boolean") return null;
    return {
      valor: politica.aplicavel ? "SIM" : "NAO",
      descricao: text(politica.descricao),
      origem: origemDe(politica.origem),
      confirmadoEm: text(politica.confirmadoEm) || null,
    };
  }
  if (id === "csosn") {
    const politica = record(record(campos.evidencias).politica_csosn_entrada);
    if (text(politica.status) !== "CONFIRMADO") return null;
    const mapa = record(politica.mapa);
    const padrao = Object.entries(CSOSN_PARA_CST_PADRAO).every(([csosn, cst]) => text(mapa[csosn]) === cst);
    return {
      valor: padrao ? "PADRAO" : "PERSONALIZADO",
      descricao: text(politica.descricao),
      origem: origemDe(politica.origem),
      confirmadoEm: text(politica.confirmadoEm) || null,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Dedução                                                             */
/* ------------------------------------------------------------------ */

const REGIME: Record<string, string> = {
  "1": "Simples Nacional",
  "2": "Simples Nacional com excesso de sublimite",
  "3": "regime normal (Lucro Presumido ou Real)",
  "4": "MEI",
};

function regimeDe(fatos: SpedFatosEmpresa): { codigo: string; nome: string } | null {
  const codigo = text(fatos.regimeTributario);
  return REGIME[codigo] ? { codigo, nome: REGIME[codigo] } : null;
}

function simplesNacional(codigo: string): boolean {
  return codigo === "1" || codigo === "2" || codigo === "4";
}

export function formatarCnae(cnae: string): string {
  const d = digits(cnae);
  return d.length === 7 ? `${d.slice(0, 4)}-${d.slice(4, 5)}/${d.slice(5)}` : cnae;
}

function cnaeDe(fatos: SpedFatosEmpresa): { digitos: string; divisao: number; rotulo: string } | null {
  const d = digits(fatos.cnae);
  if (d.length < 4) return null;
  return { digitos: d, divisao: Number(d.slice(0, 2)), rotulo: `CNAE ${formatarCnae(d)}` };
}

/** Seções B (extrativa, divisões 05–09) e C (transformação, 10–33) da CNAE. */
function cnaeIndustrial(divisao: number): boolean {
  return divisao >= 5 && divisao <= 33;
}

function cnaeComeca(cnae: { digitos: string }, prefixos: readonly string[]): boolean {
  return prefixos.some((prefixo) => cnae.digitos.startsWith(prefixo));
}

const CNAE_POR_PERGUNTA: Partial<Record<SpedPerguntaId, { prefixos: string[]; atividade: string }>> = {
  combustiveis: { prefixos: ["4731", "4681", "192"], atividade: "comércio ou produção de combustíveis" },
  energia: { prefixos: ["351"], atividade: "geração, transmissão ou distribuição de energia elétrica" },
  usina: { prefixos: ["1071", "1931"], atividade: "usina de açúcar ou álcool" },
  aereo: { prefixos: ["511", "512"], atividade: "transporte aéreo" },
};

/** Resposta que o cadastro ou a lei já dão. Null: precisa perguntar. */
export function deduzirResposta(id: SpedPerguntaId, fatos: SpedFatosEmpresa): SpedDeducao | null {
  const regime = regimeDe(fatos);
  const cnae = cnaeDe(fatos);
  const uf = text(fatos.uf).toUpperCase();

  switch (id) {
    case "industria": {
      if (cnae && cnaeIndustrial(cnae.divisao)) {
        return { valor: "SIM", descricao: `Atividade principal industrial no cadastro da empresa (${cnae.rotulo}).` };
      }
      if (fatos.importaDoExterior) {
        return { valor: "SIM", descricao: "Há NF-e de importação emitida pelo ERP: importador é equiparado a industrial." };
      }
      if (cnae && fatos.importaDoExterior === false) {
        return { valor: "NAO", descricao: `Atividade principal fora da indústria (${cnae.rotulo}) e nenhuma NF-e de importação emitida pelo ERP.` };
      }
      return null;
    }
    case "perfil": {
      // SEFAZ-PB e SEFAZ-PE: perfil B é o padrão; A só para energia elétrica e comunicação.
      if (uf !== "PB" && uf !== "PE") return null;
      if (!cnae) return null;
      const perfilA = cnaeComeca(cnae, ["351", "60", "61"]);
      return perfilA
        ? { valor: "A", descricao: `Em ${uf}, empresas de energia elétrica e comunicação usam o perfil A (${cnae.rotulo}).` }
        : { valor: "B", descricao: `Em ${uf}, o perfil B é o padrão da SEFAZ; o A fica para energia elétrica e comunicação (${cnae.rotulo}).` };
    }
    case "cartaoPix": {
      if (fatos.recebeCartaoOuPix === true) {
        return { valor: "SIM", descricao: "O financeiro do ERP tem recebimentos por PIX, crédito ou débito." };
      }
      return null;
    }
    case "efdContribuicoes": {
      if (!regime) return null;
      return regime.codigo === "3"
        ? { valor: "SIM", descricao: `Regime tributário no cadastro da empresa: ${regime.nome}, que entrega a EFD-Contribuições.` }
        : { valor: "NAO", descricao: `Regime tributário no cadastro da empresa: ${regime.nome}, dispensado da EFD-Contribuições.` };
    }
    case "blocoK": {
      if (!regime) return null;
      if (simplesNacional(regime.codigo)) {
        return { valor: "NAO", descricao: `${regime.nome} é dispensado do Bloco K.` };
      }
      if (!cnae) return null;
      if (cnaeIndustrial(cnae.divisao) || cnae.divisao === 46) {
        return { valor: "SIM", descricao: `Indústria ou atacadista no regime normal (${cnae.rotulo}) deve apresentar o Bloco K.` };
      }
      return { valor: "NAO", descricao: `Atividade fora da indústria e do atacado (${cnae.rotulo}): o Bloco K não se aplica.` };
    }
    case "creditoRevenda": {
      if (!regime) return null;
      return simplesNacional(regime.codigo) && regime.codigo !== "2"
        ? { valor: "NAO", descricao: `${regime.nome}: o ICMS é recolhido no DAS e as compras não geram crédito (LC 123/2006, art. 23).` }
        : { valor: "SIM", descricao: `${regime.nome}: o ICMS é não cumulativo e o imposto destacado nas compras para revenda gera crédito (LC 87/1996, art. 20).` };
    }
    case "csosn":
      return { valor: "PADRAO", descricao: "Correspondência usual CSOSN → CST aplicada pelo ERP." };
    case "inventario":
      return { valor: "AUTOMATICO", descricao: "Inventário de 31/12 no SPED de fevereiro do ano seguinte, como manda a legislação; nos demais meses, sem inventário." };
    case "ressarcimentoSt":
      return { valor: "NAO", descricao: "Padrão do ERP: sem pedido de ressarcimento de ICMS-ST. Quando houver venda que permita o pedido, o ERP avisa na competência." };
    case "exportacao":
      return { valor: "NAO", descricao: "Sem exportação declarada; notas de exportação (CFOP 7xxx) mudam a resposta sozinhas no mês em que aparecem." };
    case "formularioSeguranca":
      return { valor: "NAO", descricao: "O ERP emite NF-e eletrônica e não usa formulário de segurança (FS-DA)." };
    case "creditoAcumulado": {
      if (regime && simplesNacional(regime.codigo) && regime.codigo !== "2") {
        return { valor: "NAO", descricao: `${regime.nome} não apropria créditos de ICMS.` };
      }
      return null;
    }
    case "combustiveis":
    case "energia":
    case "usina":
    case "aereo": {
      if (!cnae) return null;
      const regra = CNAE_POR_PERGUNTA[id]!;
      return cnaeComeca(cnae, regra.prefixos)
        ? { valor: "SIM", descricao: `Atividade principal de ${regra.atividade} (${cnae.rotulo}).` }
        : { valor: "NAO", descricao: `Atividade principal sem ${regra.atividade} (${cnae.rotulo}).` };
    }
    case "giaf1":
    case "giaf3":
    case "giaf4":
      return uf && uf !== "PE"
        ? { valor: "NAO", descricao: `Obrigação exclusiva de Pernambuco; a empresa está em ${uf}.` }
        : null;
    case "registro1400":
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Gravação                                                            */
/* ------------------------------------------------------------------ */

export function patchVazio(): SpedConfigPatch {
  return { campos: {}, evidencias: {}, indicadores1010: {}, politicas: {} };
}

export function patchDaResposta(
  id: SpedPerguntaId,
  valor: string,
  descricao: string,
  origem: SpedOrigemResposta,
): SpedConfigPatch {
  const patch = patchVazio();
  const sim = valor === "SIM";
  const indicador = INDICADOR_1010[id];
  if (indicador) {
    patch.indicadores1010[indicador] = { valor: sim ? "S" : "N", status: "CONFIRMADO", descricao, origem };
    return patch;
  }
  const gate = GATE_SIMPLES[id];
  if (gate) {
    const [valorCampo, statusCampo, chave] = gate;
    patch.campos[valorCampo] = sim;
    patch.campos[statusCampo] = "CONFIRMADO";
    patch.evidencias[chave] = { descricao, origem };
    return patch;
  }
  switch (id) {
    case "industria":
      patch.campos.indicador_atividade = sim ? "0" : "1";
      patch.campos.indicador_atividade_status = "CONFIRMADO";
      patch.campos.contribuinte_ipi = sim;
      patch.campos.contribuinte_ipi_status = "CONFIRMADO";
      patch.evidencias.atividade = { descricao, origem };
      patch.evidencias.ipi = { descricao, origem };
      return patch;
    case "perfil":
      patch.campos.perfil_efd = valor;
      patch.campos.perfil_efd_status = "CONFIRMADO";
      patch.evidencias.perfil = { descricao, origem };
      return patch;
    case "inventario":
      // O valor guardado vale para os meses comuns; fevereiro é decidido na competência.
      patch.campos.inventario_aplicavel = false;
      patch.campos.inventario_status = "CONFIRMADO";
      patch.campos.inventario_fechamento_id = null;
      patch.evidencias.inventario = { descricao, origem, modo: "AUTOMATICO" };
      return patch;
    case "creditoRevenda":
      patch.politicas.creditoRevenda = { aplicavel: sim, descricao, origem };
      return patch;
    case "csosn":
      patch.politicas.csosnEntrada = { mapa: { ...CSOSN_PARA_CST_PADRAO }, descricao, origem };
      return patch;
    default:
      return patch;
  }
}

export function juntarPatches(patches: readonly SpedConfigPatch[]): SpedConfigPatch {
  const total = patchVazio();
  for (const patch of patches) {
    Object.assign(total.campos, patch.campos);
    Object.assign(total.evidencias, patch.evidencias);
    Object.assign(total.indicadores1010, patch.indicadores1010);
    Object.assign(total.politicas, patch.politicas);
  }
  return total;
}

export function patchVazioDe(patch: SpedConfigPatch): boolean {
  return !Object.keys(patch.campos).length
    && !Object.keys(patch.evidencias).length
    && !Object.keys(patch.indicadores1010).length
    && !Object.keys(patch.politicas).length;
}

/** Corpo do PUT /api/fiscal/sped/configuracao. */
export function corpoDoPatch(patch: SpedConfigPatch): Record<string, unknown> {
  const corpo: Record<string, unknown> = { ...patch.campos };
  const evidencias: Record<string, unknown> = { ...patch.evidencias };
  if (Object.keys(patch.indicadores1010).length) evidencias.indicadores_1010 = patch.indicadores1010;
  if (Object.keys(evidencias).length) corpo.evidencias = evidencias;
  if (Object.keys(patch.politicas).length) corpo.politicas = patch.politicas;
  return corpo;
}

/**
 * Tudo o que está pendente e pode ser deduzido. Respostas já dadas, por
 * pessoa ou pelo próprio ERP, nunca são trocadas aqui.
 */
export function planejarDeducao(campos: SpedConfigCampos, fatos: SpedFatosEmpresa): { patch: SpedConfigPatch; perguntas: SpedPerguntaId[] } {
  const patches: SpedConfigPatch[] = [];
  const perguntas: SpedPerguntaId[] = [];
  for (const pergunta of SPED_PERGUNTAS) {
    if (respostaAtual(pergunta.id, campos)) continue;
    const deducao = deduzirResposta(pergunta.id, fatos);
    if (!deducao) continue;
    patches.push(patchDaResposta(pergunta.id, deducao.valor, deducao.descricao, "AUTOMATICA"));
    perguntas.push(pergunta.id);
  }
  return { patch: juntarPatches(patches), perguntas };
}

/**
 * Inventário obrigatório nesta competência. No modo automático, o SPED de
 * fevereiro leva o estoque de 31/12 (motivo 01); nos demais meses, nada.
 */
export function inventarioAplicavelNaCompetencia(campos: SpedConfigCampos | null | undefined, competencia: string): boolean {
  const config = campos ?? {};
  const automatico = text(record(record(config.evidencias).inventario).modo) === "AUTOMATICO"
    && text(config.inventario_status) === "CONFIRMADO";
  if (automatico) return /^\d{4}-02$/.test(text(competencia).slice(0, 7));
  return config.inventario_aplicavel === true;
}
