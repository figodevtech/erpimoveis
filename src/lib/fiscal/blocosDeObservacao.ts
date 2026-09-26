// Blocos de texto que o emissor injeta no campo de observação da nota.
//
// A tela oferece um botão por bloco e concatena o texto no que já estiver
// digitado — quem emite apaga o que não quiser, em vez de escolher campo a
// campo. Por isso cada campo vira `rótulo valor` separado por `; `: dá para
// remover um pedaço sem desmontar a frase.
//
// O infCpl da NF-e troca quebras de linha por espaço na montagem do XML, então
// o bloco também precisa ler bem em linha única.

import { formatCpfCnpj, formatFiscalCep } from "@/lib/nfe/recipientNormalization";
import { normalizeCpfOrCnpj } from "@/lib/fiscal-identifiers";

export type AlvoTipoFiscal = "VEICULO" | "PECA" | "EQUIPAMENTO";

export type AlvoFiscal = {
  tipo: AlvoTipoFiscal;
  veiculo?: {
    tipo?: string | null;
    placa?: string | null;
    marca?: string | null;
    modelo?: string | null;
    versao?: string | null;
    ano?: number | string | null;
    ano_modelo?: number | string | null;
    cor?: string | null;
    combustivel?: string | null;
    transmissao?: string | null;
    chassi?: string | null;
    kmatual?: number | string | null;
  } | null;
  peca?: {
    titulo?: string | null;
    descricao?: string | null;
    fabricante?: string | null;
    modelo?: string | null;
    lacre?: string | null;
  } | null;
  equipamento?: {
    nome?: string | null;
    patrimonio?: string | null;
    ano?: number | string | null;
    horimetro?: number | string | null;
  } | null;
};

export type ClienteFiscalObservacao = {
  nomerazaosocial?: string | null;
  cpfcnpj?: string | null;
  inscricaoestadual?: string | null;
  inscricaomunicipal?: string | null;
  endereco?: string | null;
  endereconumero?: string | null;
  enderecocomplemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  telefone?: string | null;
  email?: string | null;
};

export type BlocoDeObservacao = {
  /** Rótulo do botão na tela. */
  rotulo: string;
  texto: string;
};

export type NotaFiscalReferenciaObservacao = {
  chaveAcesso?: string | null;
  numeroNota?: string | null;
  serieNota?: string | null;
  dataEmissao?: string | null;
  fornecedor?: string | null;
};

function dataDeEmissaoDaNota(value: string | null | undefined): string {
  const entrada = texto(value);
  const dataCivil = entrada.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dataCivil) return `${dataCivil[3]}/${dataCivil[2]}/${dataCivil[1]}`;
  const instante = new Date(entrada);
  return entrada && !Number.isNaN(instante.getTime())
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(instante)
    : "";
}

/** O vínculo com a entrada é verificado pela tela; a chave identifica a NF-e aqui. */
export function blocoDaNotaFiscalReferencia(nota: NotaFiscalReferenciaObservacao | null | undefined): string {
  const chave = texto(nota?.chaveAcesso).replace(/\D/g, "");
  if (chave.length !== 44) return "";
  return montarBloco("NF-e de referência", "", juntarCampos([
    ["nº", texto(nota?.numeroNota)],
    ["série", texto(nota?.serieNota)],
    ["emissão", dataDeEmissaoDaNota(nota?.dataEmissao)],
    ["fornecedor", texto(nota?.fornecedor)],
    ["chave", chave],
  ]));
}

export function blocoDasNotasFiscaisReferencia(
  notas: Array<NotaFiscalReferenciaObservacao | null | undefined>,
): BlocoDeObservacao | null {
  const chaves = new Set<string>();
  const textos: string[] = [];
  for (const nota of notas) {
    const chave = texto(nota?.chaveAcesso).replace(/\D/g, "");
    if (chaves.has(chave)) continue;
    const bloco = blocoDaNotaFiscalReferencia(nota);
    if (!bloco) continue;
    chaves.add(chave);
    textos.push(bloco);
  }
  return textos.length ? { rotulo: "Dados da NF-e de referência", texto: textos.join("\n") } : null;
}

const ROTULO_DO_ALVO: Record<AlvoTipoFiscal, string> = {
  VEICULO: "Dados do veículo",
  PECA: "Dados da peça",
  EQUIPAMENTO: "Dados do equipamento",
};

const TITULO_DO_ALVO: Record<AlvoTipoFiscal, string> = {
  VEICULO: "Veículo",
  PECA: "Peça",
  EQUIPAMENTO: "Equipamento",
};

export function rotuloDoBotaoAlvo(tipo: AlvoTipoFiscal) {
  return ROTULO_DO_ALVO[tipo];
}

function texto(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numero(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(parsed);
}

function telefone(value: unknown) {
  const digitos = texto(value).replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3");
  // Fora dos dois formatos brasileiros, o número cru é melhor que um rótulo de
  // erro no meio da nota fiscal.
  return digitos;
}

function juntarCampos(pares: Array<[string, string]>) {
  return pares
    .filter(([, valor]) => valor !== "")
    .map(([rotulo, valor]) => `${rotulo} ${valor}`)
    .join("; ");
}

function montarBloco(titulo: string, cabecalho: string, campos: string) {
  const corpo = [cabecalho, campos].filter(Boolean).join("; ");
  return corpo ? `${titulo}: ${corpo}` : "";
}

export function blocoDoAlvo(alvo: AlvoFiscal | null | undefined): string {
  if (!alvo) return "";
  const titulo = TITULO_DO_ALVO[alvo.tipo];

  if (alvo.tipo === "VEICULO") {
    const veiculo = alvo.veiculo;
    if (!veiculo) return "";
    // Ano e ano-modelo viram um campo só quando são iguais: "2020/2021" é a
    // forma como a placa e o documento do carro trazem.
    const ano = texto(veiculo.ano);
    const anoModelo = texto(veiculo.ano_modelo);
    const anos = anoModelo && anoModelo !== ano ? [ano, anoModelo].filter(Boolean).join("/") : ano;
    return montarBloco(
      titulo,
      [texto(veiculo.marca), texto(veiculo.modelo), texto(veiculo.versao)].filter(Boolean).join(" "),
      juntarCampos([
        ["placa", texto(veiculo.placa).toUpperCase()],
        ["ano", anos],
        ["cor", texto(veiculo.cor)],
        ["tipo", texto(veiculo.tipo)],
        ["combustível", texto(veiculo.combustivel)],
        ["transmissão", texto(veiculo.transmissao)],
        ["chassi", texto(veiculo.chassi).toUpperCase()],
        ["KM", numero(veiculo.kmatual)],
      ]),
    );
  }

  if (alvo.tipo === "PECA") {
    const peca = alvo.peca;
    if (!peca) return "";
    return montarBloco(
      titulo,
      texto(peca.titulo),
      juntarCampos([
        ["fabricante", texto(peca.fabricante)],
        ["modelo", texto(peca.modelo)],
        ["lacre", texto(peca.lacre)],
        ["descrição", texto(peca.descricao)],
      ]),
    );
  }

  const equipamento = alvo.equipamento;
  if (!equipamento) return "";
  return montarBloco(
    titulo,
    texto(equipamento.nome),
    juntarCampos([
      ["patrimônio", texto(equipamento.patrimonio)],
      ["ano", texto(equipamento.ano)],
      ["horímetro", numero(equipamento.horimetro)],
    ]),
  );
}

export function blocoDoCliente(cliente: ClienteFiscalObservacao | null | undefined): string {
  if (!cliente) return "";
  const documento = normalizeCpfOrCnpj(cliente.cpfcnpj);
  const endereco = [
    [texto(cliente.endereco), texto(cliente.endereconumero)].filter(Boolean).join(", "),
    texto(cliente.enderecocomplemento),
    texto(cliente.bairro),
    [texto(cliente.cidade), texto(cliente.estado)].filter(Boolean).join("/"),
    cliente.cep ? `CEP ${formatFiscalCep(cliente.cep)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return montarBloco(
    "Cliente",
    texto(cliente.nomerazaosocial),
    juntarCampos([
      [documento.length > 11 ? "CNPJ" : "CPF", documento ? formatCpfCnpj(documento) : ""],
      ["IE", texto(cliente.inscricaoestadual)],
      ["IM", texto(cliente.inscricaomunicipal)],
      ["endereço", endereco],
      ["fone", telefone(cliente.telefone)],
      ["e-mail", texto(cliente.email)],
    ]),
  );
}

/**
 * Blocos que a tela deve oferecer. Um bloco sem dado nenhum não vira botão —
 * é assim que a venda, que não tem alvo, mostra só o do cliente.
 */
export function blocosDeObservacao(
  alvo: AlvoFiscal | null | undefined,
  cliente: ClienteFiscalObservacao | null | undefined,
): BlocoDeObservacao[] {
  const blocos: BlocoDeObservacao[] = [];
  const doAlvo = blocoDoAlvo(alvo);
  if (alvo && doAlvo) blocos.push({ rotulo: rotuloDoBotaoAlvo(alvo.tipo), texto: doAlvo });
  const doCliente = blocoDoCliente(cliente);
  if (doCliente) blocos.push({ rotulo: "Dados do cliente", texto: doCliente });
  return blocos;
}

/**
 * Acrescenta o bloco ao que já está no campo, em linha nova. Devolve `truncado`
 * quando o limite foi ultrapassado, mas preserva o texto integral: a tela avisa
 * e bloqueia a emissão até o operador decidir o que remover.
 */
export function concatenarBloco(atual: string, bloco: string, limite: number) {
  const base = atual.trimEnd();
  if (!bloco) return { texto: base, truncado: false };
  const junto = base ? `${base}\n${bloco}` : bloco;
  return { texto: junto, truncado: junto.length > limite };
}
