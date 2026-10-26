// Linhas do banco -> contexto dos documentos, com cada valor já formatado.
// Funções puras: a emissão passa o que leu do banco, a prévia do editor passa
// os exemplos de `exemplos.ts`, e o teste confere que toda chave do catálogo
// sai daqui.

import { calculateFinancialSurcharge, calculateFinancialTotal } from "@/lib/financial-surcharge";
import { agruparItensHistoricos, mapearItemHistorico } from "@/lib/ordens/itens-historicos";
import { resolveOrdemCustomer } from "@/lib/ordens/customer-snapshot";
import { resolveOrdemVehicle } from "@/lib/ordens/vehicle-snapshot";
import type { PrintPaymentSummary } from "@/lib/print-payment-display";
import { paraHtmlDoEditor } from "@/lib/texto-rico";
import {
  ROTULO_STATUS_ALUGUEL,
  ROTULO_TIPO_ITEM_ALUGUEL,
  duracaoContratada,
  statusExibicao,
  type StatusAluguel,
  type TipoItemAluguel,
} from "@/lib/alugueis/status";

import {
  ano,
  arredondar,
  cep,
  data,
  dataHora,
  dataPorExtenso,
  documento,
  juntar,
  moeda,
  numero,
  quantidade,
  rotuloDeEnum,
  telefone,
  texto,
  valorPorExtenso,
} from "./formatacao";
import { escaparHtml } from "./motor";
import type { ContextoDocumento } from "./tipos";

type Linha = Record<string, any>;

/** O PostgREST devolve relação 1:1 como objeto ou como lista de um. */
function um<T = Linha>(valor: unknown): T | null {
  if (Array.isArray(valor)) return (valor[0] ?? null) as T | null;
  return (valor ?? null) as T | null;
}

function lista(valor: unknown): Linha[] {
  return Array.isArray(valor) ? valor : [];
}

/* --------------------------------- comuns --------------------------------- */

export type EmissaoDocumento = {
  nomeDocumento: string;
  emitidoPor: string | null;
  agora: Date;
  /** URL pública da logo da empresa; a prévia do editor usa um data URL de exemplo. */
  logoUrl: string | null;
};

function contextoEmpresa(empresa: Linha | null, logoUrl: string | null) {
  const razao = texto(empresa?.razaosocial);
  const numeroEndereco = texto(empresa?.numero);
  const codigoPostal = cep(empresa?.cep);
  return {
    nome: texto(empresa?.nomefantasia) || razao,
    razao_social: razao,
    cnpj: documento(empresa?.cnpj),
    inscricao_estadual: texto(empresa?.inscricaoestadual),
    inscricao_municipal: texto(empresa?.inscricaomunicipal),
    telefone: telefone(empresa?.telefone),
    endereco: juntar(
      [
        juntar([empresa?.endereco, numeroEndereco ? `nº ${numeroEndereco}` : null, empresa?.complemento]),
        empresa?.bairro,
        juntar([empresa?.cidade, empresa?.uf], "/"),
        codigoPostal ? `CEP ${codigoPostal}` : null,
      ],
      " · ",
    ),
    bairro: texto(empresa?.bairro),
    cidade: texto(empresa?.cidade),
    uf: texto(empresa?.uf),
    cep: codigoPostal,
    logo: logoUrl ? `<img class="doc-logo" src="${escaparHtml(logoUrl)}" alt="" style="max-height:64px;max-width:220px;object-fit:contain" />` : "",
    logo_url: logoUrl ?? "",
  };
}

function contextoEmissao(emissao: EmissaoDocumento) {
  return {
    nome: emissao.nomeDocumento,
    data_emissao: data(emissao.agora),
    data_emissao_extenso: dataPorExtenso(emissao.agora),
    hora_emissao: dataHora(emissao.agora),
    emitido_por: texto(emissao.emitidoPor),
  };
}

/**
 * Marcadores do número da folha. Fora da paginação (ou antes dela) valem 1; a
 * folha A4 troca o texto de cada um pelo número da folha em que ele caiu.
 */
function contextoPagina() {
  return {
    atual: '<span data-documento-pagina="atual">1</span>',
    total: '<span data-documento-pagina="total">1</span>',
  };
}

export type ClienteDocumento = {
  nome?: unknown;
  documento?: unknown;
  tipopessoa?: unknown;
  inscricaoestadual?: unknown;
  email?: unknown;
  telefone?: unknown;
  endereco?: unknown;
  endereconumero?: unknown;
  enderecocomplemento?: unknown;
  bairro?: unknown;
  cidade?: unknown;
  estado?: unknown;
  cep?: unknown;
};

/** Sem tipo no cadastro, conta o documento: 14 dígitos é CNPJ. */
function ehPessoaJuridica(cliente: ClienteDocumento | null) {
  const tipo = texto(cliente?.tipopessoa).toUpperCase();
  const digitos = texto(cliente?.documento).replace(/\D/g, "");
  return tipo ? tipo === "JURIDICA" || tipo === "PJ" : digitos.length === 14;
}

/** Os trechos `{{#se_pessoa_juridica}}` / `{{#se_pessoa_fisica}}`; sem cliente, só `{{#se_sem_cliente}}`. */
function condicoesDoCliente(cliente: ClienteDocumento | null) {
  const juridica = Boolean(cliente) && ehPessoaJuridica(cliente);
  return { se_pessoa_juridica: juridica, se_pessoa_fisica: Boolean(cliente) && !juridica, se_sem_cliente: !cliente };
}

function contextoCliente(cliente: ClienteDocumento | null) {
  const tipo = texto(cliente?.tipopessoa).toUpperCase();
  const digitos = texto(cliente?.documento).replace(/\D/g, "");
  const juridica = ehPessoaJuridica(cliente);
  const numeroEndereco = texto(cliente?.endereconumero);
  const codigoPostal = cep(cliente?.cep);
  return {
    nome: texto(cliente?.nome),
    documento: documento(cliente?.documento),
    tipo_pessoa: cliente && (tipo || digitos) ? (juridica ? "Pessoa jurídica" : "Pessoa física") : "",
    inscricao_estadual: texto(cliente?.inscricaoestadual),
    email: texto(cliente?.email),
    telefone: telefone(cliente?.telefone),
    endereco_completo: juntar([
      juntar([cliente?.endereco, numeroEndereco ? `nº ${numeroEndereco}` : null, cliente?.enderecocomplemento]),
      cliente?.bairro,
      juntar([cliente?.cidade, cliente?.estado], "/"),
      codigoPostal ? `CEP ${codigoPostal}` : null,
    ], " · "),
    logradouro: texto(cliente?.endereco),
    numero: numeroEndereco,
    complemento: texto(cliente?.enderecocomplemento),
    bairro: texto(cliente?.bairro),
    cidade: texto(cliente?.cidade),
    uf: texto(cliente?.estado),
    cep: codigoPostal,
  };
}

/** Cliente do cadastro (`cliente`), no formato que os documentos esperam. */
export function clienteDoCadastro(cliente: Linha | null): ClienteDocumento | null {
  if (!cliente) return null;
  return {
    ...cliente,
    nome: cliente.nomerazaosocial ?? cliente.nome,
    documento: cliente.cpfcnpj ?? cliente.documento,
  };
}

type Coluna = { titulo: string; direita?: boolean };

/** Tabela pronta, com estilo embutido para sair legível em qualquer modelo. */
function tabela(colunas: Coluna[], linhas: string[][]) {
  if (linhas.length === 0) return "";
  const borda = "border:1px solid #cbd5e1;padding:4px 6px";
  const cabecalho = colunas
    .map((c) => `<th style="${borda};background:#f1f5f9;text-align:${c.direita ? "right" : "left"}">${escaparHtml(c.titulo)}</th>`)
    .join("");
  const corpo = linhas
    .map(
      (linha) =>
        `<tr>${linha
          .map((celula, i) => `<td style="${borda};text-align:${colunas[i]?.direita ? "right" : "left"}">${escaparHtml(celula)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table class="doc-tabela" style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}</tbody></table>`;
}

function pagamentos(resumo: PrintPaymentSummary | null) {
  const linhas = (resumo?.entries ?? []).map((p) =>
    juntar([p.label, p.valor != null ? moeda(p.valor) : null, p.parcelas ? `em ${p.parcelas}x` : null], " "),
  );
  return {
    linha: linhas.join("; "),
    html: linhas.length ? `<ul class="doc-pagamentos">${linhas.map((l) => `<li>${escaparHtml(l)}</li>`).join("")}</ul>` : "",
  };
}

type TipoDesconto = "FIXO" | "PORCENTAGEM" | null;

function tipoDesconto(valor: unknown): TipoDesconto {
  return valor === "FIXO" || valor === "PORCENTAGEM" ? valor : null;
}

function descontoAplicado(base: number, tipoValor: unknown, descontoValor: unknown) {
  const tipo = tipoDesconto(tipoValor);
  const baseSegura = Math.max(0, base);
  const desconto = Math.max(0, numero(descontoValor));
  if (!tipo || baseSegura <= 0 || desconto <= 0) return 0;
  if (tipo === "PORCENTAGEM") return arredondar(baseSegura * (Math.min(desconto, 100) / 100));
  return arredondar(Math.min(desconto, baseSegura));
}

/* ---------------------------------- venda --------------------------------- */

export type EntradaVenda = {
  venda: Linha;
  empresa: Linha | null;
  pagamentos: PrintPaymentSummary | null;
  emissao: EmissaoDocumento;
};

export function contextoDaVenda({ venda, empresa, pagamentos: resumo, emissao }: EntradaVenda): ContextoDocumento {
  const linhasItens = lista(venda.itens).slice().sort((a, b) => numero(a.id) - numero(b.id));

  const itens = linhasItens.map((item, i) => {
    const produto = um(item.produto);
    const qtd = numero(item.quantidade);
    const bruto = Math.max(0, numero(item.sub_total));
    return {
      numero: String(i + 1),
      codigo: texto(produto?.etiqueta) || texto(produto?.codigobarras) || texto(produto?.id),
      descricao: texto(produto?.titulo) || texto(produto?.descricao) || "Produto",
      unidade: texto(produto?.unidade),
      quantidade: quantidade(qtd),
      valor_unitario: moeda(qtd > 0 ? bruto / qtd : bruto),
      desconto: moeda(descontoAplicado(bruto, item.tipo_desconto, item.valor_desconto)),
      total: moeda(item.valor_total),
    };
  });

  // As mesmas contas do diálogo da venda.
  const subtotal = arredondar(linhasItens.reduce((s, item) => s + Math.max(0, numero(item.sub_total)), 0));
  const descontoItens = arredondar(
    linhasItens.reduce((s, item) => s + descontoAplicado(Math.max(0, numero(item.sub_total)), item.tipo_desconto, item.valor_desconto), 0),
  );
  const freteItens = arredondar(linhasItens.reduce((s, item) => s + Math.max(0, numero(item.valor_frete)), 0));
  const baseDescontoGeral = Math.max(0, arredondar(subtotal - descontoItens));
  const descontoGeral = descontoAplicado(baseDescontoGeral, venda.desconto_tipo, venda.desconto_valor);
  const frete = arredondar(freteItens + Math.max(0, numero(venda.valor_frete)));
  const totalComercial = arredondar(baseDescontoGeral - descontoGeral + frete);
  const acrescimo = calculateFinancialSurcharge(totalComercial, venda.acrescimo_financeiro_tipo, venda.acrescimo_financeiro_valor);
  const total = calculateFinancialTotal(totalComercial, venda.acrescimo_financeiro_tipo, venda.acrescimo_financeiro_valor);

  const entrega = (venda.endereco_entrega_snapshot ?? {}) as Linha;
  const enderecoEntrega =
    juntar([
      juntar([entrega.logradouro, entrega.numero ? `nº ${entrega.numero}` : null, entrega.complemento]),
      entrega.bairro,
      juntar([entrega.cidade, entrega.estado], "/"),
      cep(entrega.cep) ? `CEP ${cep(entrega.cep)}` : null,
    ], " · ") || texto(entrega.pickupAddress);
  const formas = pagamentos(resumo);
  const cliente = clienteDoCadastro(um(venda.cliente));
  const descontoTotal = arredondar(descontoItens + descontoGeral);

  return {
    empresa: contextoEmpresa(empresa, emissao.logoUrl),
    documento: contextoEmissao(emissao),
    pagina: contextoPagina(),
    cliente: contextoCliente(cliente),
    ...condicoesDoCliente(cliente),
    se_desconto: descontoTotal > 0,
    se_frete: frete > 0,
    se_acrescimo: acrescimo > 0,
    venda: {
      numero: texto(venda.id),
      data: data(venda.datavenda ?? venda.createdat),
      data_hora: dataHora(venda.datavenda ?? venda.createdat),
      ano: ano(venda.datavenda ?? venda.createdat),
      ano_curto: ano(venda.datavenda ?? venda.createdat).slice(-2),
      status: rotuloDeEnum(venda.status),
      canal: rotuloDeEnum(venda.canal),
      categoria: texto(um(venda.categoria_venda)?.nome),
      vendedor: texto(um(venda.vendedor_rel)?.nome),
      criado_por: texto(um(venda.criador)?.nome),
      quantidade_itens: String(itens.length),
      subtotal: moeda(subtotal),
      desconto: moeda(descontoTotal),
      frete: moeda(frete),
      acrescimo: moeda(acrescimo),
      total: moeda(total),
      total_extenso: valorPorExtenso(total),
      forma_pagamento: formas.linha,
      pagamentos: formas.html,
      garantia: texto(venda.garantia),
      descricao: texto(venda.descricao),
      observacoes: texto(venda.observacoes),
      nfe_chave: texto(venda.nfe_chave_acesso),
      itens_tabela: tabela(
        [
          { titulo: "#" },
          { titulo: "Descrição" },
          { titulo: "Qtd.", direita: true },
          { titulo: "Unitário", direita: true },
          { titulo: "Desconto", direita: true },
          { titulo: "Total", direita: true },
        ],
        itens.map((i) => [i.numero, i.descricao, juntar([i.quantidade, i.unidade], " "), i.valor_unitario, i.desconto, i.total]),
      ),
    },
    entrega: {
      metodo: texto(entrega.deliveryLabel) || rotuloDeEnum(entrega.deliveryMethod),
      endereco: enderecoEntrega,
      rastreio: texto(venda.codigo_rastreio),
      transportadora: texto(venda.transportadora_rastreio),
    },
    itens,
  };
}

/* ----------------------------------- OS ----------------------------------- */

export type EntradaOS = {
  os: Linha;
  /** `osservico_realizador` da OS: quem executou cada serviço. */
  realizadores: Linha[];
  empresa: Linha | null;
  pagamentos: PrintPaymentSummary | null;
  emissao: EmissaoDocumento;
};

const ROTULO_ALVO: Record<string, string> = { VEICULO: "Veículo", PECA: "Peça", EQUIPAMENTO: "Máquina/Equipamento" };

export function contextoDaOS({ os, realizadores, empresa, pagamentos: resumo, emissao }: EntradaOS): ContextoDocumento {
  const nomesPorServico = new Map<number, string[]>();
  for (const r of realizadores) {
    const nome = texto(um(r.usuario)?.nome);
    if (!nome) continue;
    const id = numero(r.servicoid);
    nomesPorServico.set(id, [...(nomesPorServico.get(id) ?? []), nome]);
  }

  const historicos = agruparItensHistoricos(lista(os.itensHistoricos).map(mapearItemHistorico).sort((a, b) => a.linhaOrigem - b.linhaOrigem));

  const linhaItem = (desc: string, codigo: string, qtdValor: unknown, unit: unknown, tipoDesc: unknown, valorDesconto: unknown, subtotal: unknown) => {
    const qtd = numero(qtdValor);
    return {
      codigo,
      descricao: desc,
      quantidade: quantidade(qtd),
      valor_unitario: moeda(unit),
      desconto: moeda(descontoAplicado(qtd * numero(unit), tipoDesc, valorDesconto)),
      total: moeda(subtotal),
    };
  };

  const pecas = [
    ...lista(os.produtos).map((p) => {
      const produto = um(p.produto);
      return {
        ...linhaItem(texto(produto?.titulo) || texto(produto?.descricao) || "Peça", texto(produto?.etiqueta) || texto(produto?.id), p.quantidade, p.precounitario, p.desconto_tipo, p.desconto, p.subtotal),
        unidade: texto(produto?.unidade),
      };
    }),
    ...lista(os.produtosAvulsos).map((p) => ({
      ...linhaItem(texto(p.titulo) || "Produto avulso", "", p.quantidade, p.precounitario, p.desconto_tipo, p.desconto, p.subtotal),
      unidade: "",
    })),
    ...historicos.produtos.map((h) => ({
      ...linhaItem(h.descricao, h.codigoLegado ?? "", h.quantidade, h.precoUnitario, null, 0, h.subtotal),
      unidade: h.unidade ?? "",
    })),
  ].map((item, i) => ({ numero: String(i + 1), ...item }));

  const servicos = [
    ...lista(os.servicos).map((s) => {
      const servico = um(s.servico);
      const titulo = texto(servico?.descricao) || "Serviço";
      const detalhe = texto(s.descricao);
      const descricao = detalhe && detalhe.toLocaleLowerCase("pt-BR") !== titulo.toLocaleLowerCase("pt-BR") ? `${titulo} — ${detalhe}` : titulo;
      return {
        ...linhaItem(descricao, texto(servico?.codigo), s.quantidade, s.precounitario, s.desconto_tipo, s.desconto, s.subtotal),
        realizadores: (nomesPorServico.get(numero(s.servicoid)) ?? []).join(", "),
      };
    }),
    ...historicos.servicos.map((h) => ({
      ...linhaItem(h.descricao, h.codigoLegado ?? "", h.quantidade, h.precoUnitario, null, 0, h.subtotal),
      realizadores: "",
    })),
  ].map((item, i) => ({ numero: String(i + 1), ...item }));

  // As mesmas contas da impressão da OS.
  const totalPecas = arredondar(
    lista(os.produtos).reduce((s, p) => s + numero(p.subtotal), 0) +
      lista(os.produtosAvulsos).reduce((s, p) => s + numero(p.subtotal), 0) +
      historicos.totalProdutos,
  );
  const totalServicos = arredondar(lista(os.servicos).reduce((s, x) => s + numero(x.subtotal), 0) + historicos.totalServicos);
  const subtotal = arredondar(totalPecas + totalServicos);
  const desconto = descontoAplicado(subtotal, os.desconto_tipo, os.desconto);
  const frete = arredondar(Math.max(0, numero(os.valor_frete)));
  const total = arredondar(Math.max(0, subtotal - desconto) + frete);

  const veiculoBruto = um(os.veiculo);
  const veiculoOS = resolveOrdemVehicle(veiculoBruto as any, os.veiculo_snapshot);
  const km = veiculoOS?.kmatual;
  const veiculo = {
    placa: texto(veiculoOS?.placa) || texto(veiculoOS?.placa_formatada),
    marca: texto(veiculoOS?.marca),
    modelo: texto(veiculoOS?.modelo),
    ano: juntar([veiculoOS?.ano, veiculoOS?.ano_modelo && veiculoOS.ano_modelo !== veiculoOS.ano ? veiculoOS.ano_modelo : null], "/"),
    cor: texto(veiculoOS?.cor),
    km: km != null && texto(km) ? `${numero(km).toLocaleString("pt-BR")} km` : "",
    chassi: texto(veiculoOS?.chassi),
    renavam: texto(veiculoOS?.renavam) || texto(veiculoBruto?.renavam),
    combustivel: texto(veiculoOS?.combustivel) || texto(veiculoBruto?.combustivel),
  };
  const pecaOS = um(os.peca);
  const peca = { titulo: texto(pecaOS?.titulo), descricao: texto(pecaOS?.descricao), lacre: texto(pecaOS?.lacre) };
  const equipamento = {
    nome: texto(os.equipamento_nome),
    patrimonio: texto(os.equipamento_patrimonio),
    ano: texto(os.equipamento_ano),
    horimetro: texto(os.equipamento_horimetro) ? `${numero(os.equipamento_horimetro).toLocaleString("pt-BR")} h` : "",
  };
  const tipoAlvo = texto(os.alvo_tipo).toUpperCase();
  const alvoDescricao =
    tipoAlvo === "PECA"
      ? juntar([peca.titulo, peca.lacre ? `lacre ${peca.lacre}` : null], " · ")
      : tipoAlvo === "EQUIPAMENTO"
        ? juntar([equipamento.nome, equipamento.patrimonio ? `patrimônio ${equipamento.patrimonio}` : null, equipamento.ano, equipamento.horimetro], " · ")
        : juntar([juntar([veiculo.marca, veiculo.modelo, veiculo.ano], " "), veiculo.placa ? `placa ${veiculo.placa}` : null, veiculo.km], " · ");
  const formas = pagamentos(resumo);
  const colunasItem: Coluna[] = [
    { titulo: "#" },
    { titulo: "Descrição" },
    { titulo: "Qtd.", direita: true },
    { titulo: "Unitário", direita: true },
    { titulo: "Desconto", direita: true },
    { titulo: "Total", direita: true },
  ];

  const cliente = clienteDoCadastro(resolveOrdemCustomer(um(os.cliente) as any, os.cliente_snapshot));

  return {
    empresa: contextoEmpresa(empresa, emissao.logoUrl),
    documento: contextoEmissao(emissao),
    pagina: contextoPagina(),
    cliente: contextoCliente(cliente),
    ...condicoesDoCliente(cliente),
    os: {
      numero: texto(os.id),
      status: rotuloDeEnum(os.status),
      setor: texto(um(os.setor)?.nome),
      alvo: ROTULO_ALVO[tipoAlvo] ?? "Veículo",
      alvo_descricao: alvoDescricao,
      data_entrada: data(os.dataentrada),
      previsao_saida: data(os.datasaidaprevista),
      // Conclusão é o carimbo da execução; cancelar ou reiniciar o apaga.
      data_conclusao: data(os.execucao_fim_em),
      data_saida: data(os.datasaida),
      criado_por: texto(um(os.criador)?.nome),
      descricao: texto(os.descricao) || texto(os.defeitorelatado),
      observacoes: texto(os.observacoes),
      garantia: texto(os.garantia),
      total_pecas: moeda(totalPecas),
      total_servicos: moeda(totalServicos),
      subtotal: moeda(subtotal),
      desconto: moeda(desconto),
      frete: moeda(frete),
      total: moeda(total),
      total_extenso: valorPorExtenso(total),
      forma_pagamento: formas.linha,
      pagamentos: formas.html,
      pecas_tabela: tabela(colunasItem, pecas.map((i) => [i.numero, i.descricao, juntar([i.quantidade, i.unidade], " "), i.valor_unitario, i.desconto, i.total])),
      servicos_tabela: tabela(colunasItem, servicos.map((i) => [i.numero, i.descricao, i.quantidade, i.valor_unitario, i.desconto, i.total])),
    },
    veiculo,
    peca,
    equipamento,
    pecas,
    servicos,
  };
}

/* --------------------------------- aluguel -------------------------------- */

export type EntradaAluguel = {
  aluguel: Linha;
  empresa: Linha | null;
  emissao: EmissaoDocumento;
};

export function contextoDoAluguel({ aluguel, empresa, emissao }: EntradaAluguel): ContextoDocumento {
  const cadastro = um(aluguel.cliente);
  const destinatario = um(aluguel.destinatario);
  // Cliente avulso fica inline no aluguel; nunca vira vínculo com o cadastro.
  const cliente: ClienteDocumento | null = cadastro
    ? clienteDoCadastro(cadastro)
    : texto(aluguel.cliente_nome)
      ? {
          nome: aluguel.cliente_nome,
          documento: aluguel.cliente_documento,
          telefone: aluguel.cliente_telefone,
          email: aluguel.cliente_email,
        }
      : destinatario
        ? { nome: destinatario.nome || destinatario.email, email: destinatario.email }
        : null;

  const itens = lista(aluguel.itens)
    .slice()
    .sort((a, b) => numero(a.id) - numero(b.id))
    .map((item, i) => {
      const qtd = numero(item.quantidade);
      return {
        numero: String(i + 1),
        tipo: ROTULO_TIPO_ITEM_ALUGUEL[texto(item.tipo) as TipoItemAluguel] ?? rotuloDeEnum(item.tipo),
        descricao: texto(item.descricao),
        identificacao: texto(item.identificacao),
        quantidade: quantidade(qtd),
        quantidade_devolvida: quantidade(item.quantidade_devolvida),
        valor_unitario: moeda(item.valor),
        total: moeda(arredondar(qtd * numero(item.valor))),
        devolvido_em: data(item.devolvido_em),
      };
    });

  const datas = {
    status: (texto(aluguel.status) || "ATIVO") as StatusAluguel,
    data_inicio: texto(aluguel.data_inicio),
    data_limite: texto(aluguel.data_limite) || null,
    pausado_em: aluguel.pausado_em ?? null,
    encerrado_em: aluguel.encerrado_em ?? null,
  };
  const dias = datas.data_inicio ? duracaoContratada(datas) : null;
  const total = numero(aluguel.valor_total);

  return {
    empresa: contextoEmpresa(empresa, emissao.logoUrl),
    documento: contextoEmissao(emissao),
    pagina: contextoPagina(),
    cliente: contextoCliente(cliente),
    ...condicoesDoCliente(cliente),
    aluguel: {
      numero: texto(aluguel.id),
      status: datas.data_inicio ? ROTULO_STATUS_ALUGUEL[statusExibicao(datas, isoDoDia(emissao.agora))] : rotuloDeEnum(aluguel.status),
      data_inicio: data(aluguel.data_inicio),
      data_limite: datas.data_limite ? data(datas.data_limite) : "Sem data limite",
      duracao: dias == null ? "Prazo indeterminado" : `${dias} ${dias === 1 ? "dia" : "dias"}`,
      encerrado_em: data(aluguel.encerrado_em),
      criado_por: texto(um(aluguel.criador)?.nome),
      destinatario: texto(destinatario?.nome) || texto(destinatario?.email),
      valor_total: moeda(total),
      valor_total_extenso: valorPorExtenso(total),
      // Texto rico do editor; observação antiga, em texto puro, vira parágrafos.
      observacao: paraHtmlDoEditor(texto(aluguel.observacao)),
      itens_tabela: tabela(
        [
          { titulo: "#" },
          { titulo: "Item" },
          { titulo: "Identificação" },
          { titulo: "Qtd.", direita: true },
          { titulo: "Unitário", direita: true },
          { titulo: "Total", direita: true },
        ],
        itens.map((i) => [i.numero, i.descricao, i.identificacao, i.quantidade, i.valor_unitario, i.total]),
      ),
    },
    itens,
  };
}

/** AAAA-MM-DD do instante no fuso da operação (o "hoje" do status do aluguel). */
function isoDoDia(instante: Date) {
  const [d, m, a] = data(instante).split("/");
  return `${a}-${m}-${d}`;
}
