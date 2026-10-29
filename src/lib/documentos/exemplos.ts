// Registros fictícios para a prévia do editor. Passam pelas mesmas funções da
// emissão, então a prévia mostra exatamente o formato que o documento terá.

import { buildPrintPaymentSummary } from "@/lib/print-payment-display";

import { contextoDaVenda, type EmissaoDocumento } from "./contexto";
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
  cidade: "João Pessoa",
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

const EXEMPLOS: Record<ModuloDocumento, (emissao: EmissaoDocumento) => ContextoDocumento> = {
  venda: (emissao) =>
    contextoDaVenda({
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
    }),
};

export function contextoDeExemplo(modulo: ModuloDocumento, nomeDocumento = "Documento"): ContextoDocumento {
  return EXEMPLOS[modulo](emissaoExemplo(nomeDocumento));
}
