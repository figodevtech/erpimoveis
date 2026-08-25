import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolverNomeMunicipioIbge } from "@/lib/ibge/municipio";

/**
 * Dados do DANFSe montados a partir do que ficou gravado na emissao.
 *
 * A fonte e o proprio registro da NFS-e: `itens` guarda o snapshot dos servicos
 * como foram enviados, e `payload_enviado` guarda o JSON exato que a Focus
 * recebeu — aliquota, item da lista, CNAE, discriminacao e endereco do tomador.
 * Reler o cadastro de cliente ou de servico hoje produziria um documento
 * diferente do que a prefeitura autorizou; por isso o cadastro so entra no que
 * o envio nao carrega (razao social e endereco do prestador).
 */

export type DanfseItem = {
  descricao: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
};

export type DanfsePessoa = {
  nome: string;
  documento: string;
  inscricaoMunicipal: string;
  endereco: string;
  municipio: string;
  telefone: string;
  email: string;
};

export type DanfseViewData = {
  id: number;
  numero: string;
  codigoVerificacao: string;
  referencia: string;
  status: string;
  isAutorizada: boolean;
  isCancelada: boolean;
  modeloEmissao: string;
  municipioLabel: string;
  homologacao: boolean;
  ordemServicoId: number | null;
  dataEmissao: string | null;
  prestador: DanfsePessoa;
  tomador: DanfsePessoa;
  itens: DanfseItem[];
  valorServicos: number;
  aliquotaIss: number | null;
  valorIss: number | null;
  issRetido: boolean;
  itemListaServico: string;
  codigoCnae: string;
  naturezaOperacao: string;
  discriminacao: string;
  informacoesComplementares: string;
  urlConsulta: string;
};

type Registro = Record<string, unknown>;

const NATUREZA_OPERACAO: Record<string, string> = {
  "1": "1 - Tributacao no municipio",
  "2": "2 - Tributacao fora do municipio",
  "3": "3 - Isencao",
  "4": "4 - Imune",
  "5": "5 - Exigibilidade suspensa por decisao judicial",
  "6": "6 - Exigibilidade suspensa por procedimento administrativo",
};

const MUNICIPIO_LABEL: Record<string, string> = {
  MUNICIPAL: "Joao Pessoa",
  MUNICIPAL_JOAO_PESSOA: "Joao Pessoa",
  MUNICIPAL_CABEDELO: "Cabedelo",
  NACIONAL: "NFS-e Nacional",
};

function texto(value: unknown) {
  return String(value ?? "").trim();
}

function numero(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function objeto(value: unknown): Registro {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Registro) : {};
}

function formatarDocumento(value: unknown) {
  const digitos = texto(value).replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (digitos.length === 14) return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return digitos;
}

function formatarCep(value: unknown) {
  const digitos = texto(value).replace(/\D/g, "");
  return digitos.length === 8 ? digitos.replace(/(\d{5})(\d{3})/, "$1-$2") : digitos;
}

function formatarTelefone(value: unknown) {
  const digitos = texto(value).replace(/\D/g, "");
  if (digitos.length === 11) return digitos.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (digitos.length === 10) return digitos.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return digitos;
}

function juntar(partes: unknown[], separador = ", ") {
  return partes.map(texto).filter(Boolean).join(separador);
}

/**
 * Nome do municipio pelo codigo IBGE. Best-effort de proposito: o DANFSe nao
 * pode deixar de sair porque a API do IBGE esta fora do ar — sem o nome fica o
 * codigo, que ainda identifica o municipio.
 */
async function nomeMunicipio(codigo: unknown, uf?: unknown) {
  const codigoLimpo = texto(codigo).replace(/\D/g, "");
  if (codigoLimpo.length !== 7) return "";
  try {
    return await resolverNomeMunicipioIbge(codigoLimpo, texto(uf) || undefined);
  } catch {
    return codigoLimpo;
  }
}

function montarItens(nfse: Registro, valorServicos: number): DanfseItem[] {
  const brutos = Array.isArray(nfse.itens) ? (nfse.itens as Registro[]) : [];
  const itens = brutos.map((item) => {
    const quantidade = numero(item.quantidade) || 1;
    const valorTotal = numero(item.valor);
    return {
      descricao: texto(item.descricao) || "Servico",
      quantidade,
      valorUnitario: quantidade > 0 ? valorTotal / quantidade : valorTotal,
      valorTotal,
    };
  });

  // Nota emitida antes de o snapshot de itens existir: sem ele o total ainda
  // precisa virar uma linha, senao o documento sai com a tabela vazia.
  if (!itens.length && valorServicos > 0) {
    return [{
      descricao: "Servicos prestados",
      quantidade: 1,
      valorUnitario: valorServicos,
      valorTotal: valorServicos,
    }];
  }
  return itens;
}

export async function carregarDadosDanfse(nfseId: number): Promise<DanfseViewData | null> {
  const { data: nfse, error } = await supabaseAdmin
    .from("nfse")
    .select("*")
    .eq("id", nfseId)
    .maybeSingle();

  if (error) throw error;
  if (!nfse) return null;

  const registro = nfse as Registro;
  const payload = objeto(registro.payload_enviado);
  const servico = objeto(payload.servico);
  const tomadorPayload = objeto(payload.tomador);
  const enderecoTomador = objeto(tomadorPayload.endereco);

  const [empresaResposta, clienteResposta] = await Promise.all([
    registro.empresaid
      ? supabaseAdmin.from("empresa").select("*").eq("id", registro.empresaid).maybeSingle()
      : supabaseAdmin.from("empresa").select("*").order("id", { ascending: true }).limit(1).maybeSingle(),
    registro.clienteid
      ? supabaseAdmin.from("cliente").select("*").eq("id", registro.clienteid).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const empresa = objeto(empresaResposta?.data);
  const cliente = objeto((clienteResposta as { data?: unknown } | null)?.data);

  const [municipioPrestador, municipioTomador] = await Promise.all([
    nomeMunicipio(empresa.codigomunicipio, empresa.uf),
    nomeMunicipio(
      enderecoTomador.codigo_municipio ?? cliente.codigomunicipio,
      enderecoTomador.uf ?? cliente.estado,
    ),
  ]);

  const status = texto(registro.status).toUpperCase();
  const valorServicos = numero(servico.valor_servicos) || numero(registro.valor_total);
  const aliquota = servico.aliquota === undefined || servico.aliquota === null
    ? null
    : numero(servico.aliquota);
  // A Focus recebe a aliquota em percentual nos modelos municipais: 5 = 5%.
  const valorIss = aliquota == null ? null : Math.round(valorServicos * (aliquota / 100) * 100) / 100;
  const modeloEmissao = texto(registro.modelo_emissao).toUpperCase() || "MUNICIPAL";

  return {
    id: Number(registro.id),
    numero: texto(registro.numero),
    codigoVerificacao: texto(registro.codigo_verificacao) || texto(registro.protocolo),
    referencia: texto(registro.referencia),
    status,
    isAutorizada: status === "AUTORIZADA" || status === "AUTORIZADO" || status === "EMITIDA",
    isCancelada: status === "CANCELADA" || status === "CANCELADO",
    modeloEmissao,
    municipioLabel: MUNICIPIO_LABEL[modeloEmissao] ?? municipioPrestador,
    homologacao: texto(empresa.ambiente).toUpperCase() !== "PRODUCAO",
    ordemServicoId: registro.ordemservicoid ? Number(registro.ordemservicoid) : null,
    dataEmissao: texto(registro.dataemissao) || texto(registro.createdat) || null,
    prestador: {
      nome: texto(empresa.razaosocial) || texto(empresa.nomefantasia),
      documento: formatarDocumento(empresa.cnpj),
      inscricaoMunicipal: texto(empresa.inscricaomunicipal),
      endereco: juntar([
        juntar([empresa.endereco, empresa.numero], ", "),
        empresa.complemento,
        empresa.bairro,
        formatarCep(empresa.cep),
      ]),
      municipio: juntar([municipioPrestador, texto(empresa.uf).toUpperCase()], " / "),
      telefone: formatarTelefone(empresa.telefone),
      email: texto(empresa.email),
    },
    tomador: {
      nome: texto(tomadorPayload.razao_social) || texto(cliente.nomerazaosocial),
      documento: formatarDocumento(tomadorPayload.cnpj ?? tomadorPayload.cpf ?? cliente.cpfcnpj),
      inscricaoMunicipal: texto(cliente.inscricaomunicipal),
      endereco: juntar([
        juntar([
          enderecoTomador.logradouro ?? cliente.endereco,
          enderecoTomador.numero ?? cliente.endereconumero,
        ], ", "),
        enderecoTomador.complemento ?? cliente.enderecocomplemento,
        enderecoTomador.bairro ?? cliente.bairro,
        formatarCep(enderecoTomador.cep ?? cliente.cep),
      ]),
      municipio: juntar([municipioTomador, texto(enderecoTomador.uf ?? cliente.estado).toUpperCase()], " / "),
      telefone: formatarTelefone(tomadorPayload.telefone ?? cliente.telefone),
      email: texto(tomadorPayload.email) || texto(cliente.email),
    },
    itens: montarItens(registro, valorServicos),
    valorServicos,
    aliquotaIss: aliquota,
    valorIss,
    issRetido: Boolean(servico.iss_retido),
    itemListaServico: texto(servico.item_lista_servico),
    codigoCnae: texto(servico.codigo_cnae),
    naturezaOperacao: NATUREZA_OPERACAO[texto(payload.natureza_operacao)] ?? texto(payload.natureza_operacao),
    discriminacao: texto(servico.discriminacao),
    informacoesComplementares: texto(registro.informacoes_complementares),
    urlConsulta: texto(registro.url_consulta),
  };
}
