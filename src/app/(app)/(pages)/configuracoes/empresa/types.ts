/**
 * Cadastro da empresa emitente.
 *
 * Mora em Configurações › Empresa, e não mais numa aba de Fiscal & Pagamentos:
 * endereço, telefone e certificado não são configuração fiscal, e misturá-los
 * com série, CSC e padrão de item deixava a tela fiscal com metade dos campos
 * fora do assunto.
 *
 * A tela fiscal continua importando este tipo porque `regimetributario` e
 * `codigomunicipio` decidem o que ela mostra — mas só lê, nunca grava.
 */
export type Empresa = {
  empresaId: number;
  cnpj: string;
  razaosocial: string;
  nomefantasia?: string;
  inscricaoestadual?: string;
  inscricaomunicipal?: string;
  inscricaoestadualst?: string;
  endereco: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  codigomunicipio: string;
  cep?: string;
  uf?: string;
  codigopais?: string;
  nomepais?: string;
  telefone?: string;
  cnae?: string;
  regimetributario: "1" | "2" | "3" | "4";
  ambiente: "HOMOLOGACAO" | "PRODUCAO";
  certificadocaminho?: string;
  certificadosenha?: string;
  cschomologacao?: string;
  cscproducao?: string;
  placa_consulta_limite_mensal: number;
  placa_consulta_qtd_mes: number;
  placa_consulta_mes: string;
};

export type EmpresaFormValues = { empresa: Empresa };

export const EMPRESA_DEFAULTS: Empresa = {
  empresaId: 1,
  cnpj: "",
  razaosocial: "",
  nomefantasia: "",
  inscricaoestadual: "",
  inscricaomunicipal: "",
  inscricaoestadualst: "",
  endereco: "",
  numero: "",
  complemento: "",
  bairro: "",
  cep: "",
  uf: "PB",
  codigomunicipio: "2507507",
  codigopais: "1058",
  nomepais: "BRASIL",
  telefone: "",
  cnae: "",
  regimetributario: "1",
  ambiente: "HOMOLOGACAO",
  certificadocaminho: "",
  certificadosenha: "",
  cschomologacao: "",
  cscproducao: "",
  placa_consulta_limite_mensal: 100,
  placa_consulta_qtd_mes: 0,
  placa_consulta_mes: "",
};

/** Achata a linha do banco no formato do formulário. */
export function empresaDoServidor(e: Record<string, unknown> | null | undefined): Empresa {
  const texto = (valor: unknown, padrao = "") => (valor == null ? padrao : String(valor));
  return {
    ...EMPRESA_DEFAULTS,
    empresaId: Number(e?.id ?? 1),
    cnpj: texto(e?.cnpj),
    razaosocial: texto(e?.razaosocial),
    nomefantasia: texto(e?.nomefantasia),
    inscricaoestadual: texto(e?.inscricaoestadual),
    inscricaomunicipal: texto(e?.inscricaomunicipal),
    inscricaoestadualst: texto(e?.inscricaoestadualst),
    endereco: texto(e?.endereco),
    numero: texto(e?.numero),
    complemento: texto(e?.complemento),
    bairro: texto(e?.bairro),
    cep: texto(e?.cep),
    uf: texto(e?.uf, "PB"),
    codigomunicipio: texto(e?.codigomunicipio),
    codigopais: texto(e?.codigopais, "1058"),
    nomepais: texto(e?.nomepais, "BRASIL"),
    telefone: texto(e?.telefone),
    cnae: texto(e?.cnae),
    regimetributario: (texto(e?.regimetributario, "1") as Empresa["regimetributario"]),
    ambiente: (texto(e?.ambiente, "HOMOLOGACAO") as Empresa["ambiente"]),
    certificadocaminho: texto(e?.certificadocaminho),
    certificadosenha: texto(e?.certificadosenha),
    cschomologacao: texto(e?.cschomologacao),
    cscproducao: texto(e?.cscproducao),
    placa_consulta_limite_mensal: Number(e?.placa_consulta_limite_mensal ?? 100),
    placa_consulta_qtd_mes: Number(e?.placa_consulta_qtd_mes ?? 0),
    placa_consulta_mes: texto(e?.placa_consulta_mes),
  };
}
