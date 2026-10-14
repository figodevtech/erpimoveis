// Registros fictícios para a prévia do editor. Passam pelas mesmas funções da
// emissão, então a prévia mostra exatamente o formato que o documento terá.

import { buildPrintPaymentSummary } from "@/lib/print-payment-display";

import { contextoDaOS, contextoDaVenda, contextoDoAluguel, type EmissaoDocumento } from "./contexto";
import type { ContextoDocumento, ModuloDocumento } from "./tipos";

const LOGO_EXEMPLO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56"><rect width="180" height="56" rx="8" fill="#e2e8f0"/><text x="90" y="34" font-family="Arial" font-size="16" fill="#475569" text-anchor="middle">SUA LOGO</text></svg>',
  );

export const EMPRESA_EXEMPLO = {
  razaosocial: "Auto Center Exemplo LTDA",
  nomefantasia: "Auto Center Exemplo",
  cnpj: "12345678000195",
  inscricaoestadual: "16.123.456-7",
  inscricaomunicipal: "123456",
  telefone: "83999990000",
  endereco: "Av. Epitácio Pessoa",
  numero: "1000",
  complemento: "Loja 2",
  bairro: "Tambaú",
  uf: "PB",
  cep: "58039000",
};

const CLIENTE_EXEMPLO = {
  id: 1,
  nomerazaosocial: "Maria da Silva Souza",
  tipopessoa: "FISICA",
  cpfcnpj: "12345678909",
  inscricaoestadual: null,
  email: "maria@exemplo.com.br",
  telefone: "83988887777",
  endereco: "Rua das Trincheiras",
  endereconumero: "250",
  enderecocomplemento: "Apto 301",
  bairro: "Centro",
  cidade: "João Pessoa",
  estado: "PB",
  cep: "58011000",
};

function emissaoExemplo(nomeDocumento: string): EmissaoDocumento {
  return { nomeDocumento, emitidoPor: "Usuário de exemplo", agora: new Date(), logoUrl: LOGO_EXEMPLO };
}

export const VENDA_EXEMPLO = {
  id: 1234,
  status: "FINALIZADA",
  canal: "BALCAO",
  datavenda: "2026-10-14T13:30:00Z",
  categoria_venda: { nome: "Varejo" },
  vendedor_rel: { nome: "João Vendedor" },
  criador: { nome: "Ana Recepção" },
  cliente: CLIENTE_EXEMPLO,
  desconto_tipo: "FIXO",
  desconto_valor: 20,
  valor_frete: 30,
  acrescimo_financeiro_tipo: null,
  acrescimo_financeiro_valor: 0,
  garantia: "90 dias para defeitos de fabricação",
  descricao: "Venda de peças para manutenção preventiva",
  observacoes: "Retirada na loja",
  nfe_chave_acesso: "",
  codigo_rastreio: "",
  transportadora_rastreio: "",
  endereco_entrega_snapshot: { deliveryMethod: "RETIRADA", deliveryLabel: "Retirada na loja" },
  itens: [
    { id: 1, quantidade: 2, sub_total: 180, valor_total: 180, tipo_desconto: null, valor_desconto: 0, valor_frete: 0, produto: { id: 501, titulo: "Pastilha de freio dianteira", unidade: "JG", etiqueta: "PF-501" } },
    { id: 2, quantidade: 4, sub_total: 140, valor_total: 126, tipo_desconto: "PORCENTAGEM", valor_desconto: 10, valor_frete: 0, produto: { id: 502, titulo: "Óleo de motor 5W30 1L", unidade: "UN", etiqueta: "OL-502" } },
  ],
};

export const OS_EXEMPLO = {
  id: 525,
  status: "CONCLUIDO",
  alvo_tipo: "VEICULO",
  setor: { nome: "Mecânica" },
  criador: { nome: "Ana Recepção" },
  dataentrada: "2026-10-10T12:00:00Z",
  datasaidaprevista: "2026-10-13T20:00:00Z",
  execucao_fim_em: "2026-10-13T18:00:00Z",
  datasaida: "2026-10-14T12:00:00Z",
  descricao: "Barulho ao frear e revisão dos 40 mil km",
  observacoes: "Cliente pediu para guardar as peças trocadas",
  garantia: "90 dias para peças e serviços",
  desconto_tipo: "FIXO",
  desconto: 50,
  valor_frete: 0,
  cliente: CLIENTE_EXEMPLO,
  cliente_snapshot: null,
  veiculo: { id: 9, placa: "QFX1A23", marca: "Volkswagen", modelo: "Gol 1.6", ano: 2019, ano_modelo: 2020, cor: "Prata", kmatual: 40210, chassi: "9BWAB45U0KT000001" },
  veiculo_snapshot: null,
  peca: null,
  equipamento_nome: null,
  produtos: [
    { quantidade: 1, precounitario: 180, subtotal: 180, desconto_tipo: null, desconto: 0, produto: { id: 501, titulo: "Pastilha de freio dianteira", unidade: "JG", etiqueta: "PF-501" } },
  ],
  produtosAvulsos: [{ titulo: "Fluido de freio DOT 4", quantidade: 1, precounitario: 45, subtotal: 45, desconto_tipo: null, desconto: 0 }],
  servicos: [
    { servicoid: 11, quantidade: 1, precounitario: 120, subtotal: 120, desconto_tipo: null, desconto: 0, descricao: "", servico: { codigo: "S-11", descricao: "Troca de pastilhas" } },
    { servicoid: 12, quantidade: 1, precounitario: 250, subtotal: 250, desconto_tipo: null, desconto: 0, descricao: "", servico: { codigo: "S-12", descricao: "Revisão 40 mil km" } },
  ],
  itensHistoricos: [],
};

const REALIZADORES_EXEMPLO = [
  { servicoid: 11, usuario: { nome: "Carlos Mecânico" } },
  { servicoid: 12, usuario: { nome: "Carlos Mecânico" } },
  { servicoid: 12, usuario: { nome: "Pedro Auxiliar" } },
];

export const ALUGUEL_EXEMPLO = {
  id: 42,
  status: "ATIVO",
  data_inicio: "2026-10-14",
  data_limite: "2026-10-21",
  encerrado_em: null,
  pausado_em: null,
  valor_total: 350,
  observacao: "<p>Equipamento entregue <strong>limpo e testado</strong>.</p>",
  cliente: CLIENTE_EXEMPLO,
  destinatario: null,
  criador: { nome: "Ana Recepção" },
  itens: [
    { id: 1, tipo: "PRODUTO", descricao: "Macaco hidráulico 2t", identificacao: "Série MH-0091", quantidade: 1, quantidade_devolvida: 0, valor: 150, devolvido_em: null },
    { id: 2, tipo: "AVULSO", descricao: "Cavalete de apoio", identificacao: "", quantidade: 2, quantidade_devolvida: 0, valor: 100, devolvido_em: null },
  ],
};

export function contextoDeExemplo(modulo: ModuloDocumento, nomeDocumento = "Documento"): ContextoDocumento {
  const emissao = emissaoExemplo(nomeDocumento);
  if (modulo === "venda") {
    return contextoDaVenda({
      venda: VENDA_EXEMPLO,
      empresa: EMPRESA_EXEMPLO,
      pagamentos: buildPrintPaymentSummary({
        type: "VENDA",
        status: VENDA_EXEMPLO.status,
        recordedPayments: [
          { metodo: "PIX", valor: 166 },
          { metodo: "CREDITO", valor: 150 },
        ],
      }),
      emissao,
    });
  }
  if (modulo === "os") {
    return contextoDaOS({
      os: OS_EXEMPLO,
      realizadores: REALIZADORES_EXEMPLO,
      empresa: EMPRESA_EXEMPLO,
      pagamentos: buildPrintPaymentSummary({
        type: "OS",
        status: OS_EXEMPLO.status,
        recordedPayments: [{ metodo: "PIX", valor: 545 }],
      }),
      emissao,
    });
  }
  return contextoDoAluguel({ aluguel: ALUGUEL_EXEMPLO, empresa: EMPRESA_EXEMPLO, emissao });
}
