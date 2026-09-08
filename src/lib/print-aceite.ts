export type AceiteAlvo = "VEICULO" | "PECA" | "EQUIPAMENTO";

export type TermoAceite = {
  titulo: string;
  intro: string;
  itens: string[];
};

/** Prazo de retirada após a comunicação da OS e diárias cobradas depois dele. */
const PRAZO_RETIRADA = "72 (setenta e duas) horas";
const DIARIA_VEICULO_PESADO = "R$ 50,00";
const DIARIA_VEICULO_LEVE = "R$ 20,00";

/** Status de OS em que a assinatura vale como aprovação do orçamento. */
const OS_STATUS_ORCAMENTO = new Set([
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
  "EM_ANDAMENTO",
]);

/** Status de OS em que a assinatura vale como aceite da entrega/saída. */
const OS_STATUS_ENTREGA = new Set(["PAGAMENTO", "FATURAMENTO", "SEM_COBRANCA", "CONCLUIDO"]);

/** Status de venda em que a assinatura vale como aprovação do orçamento. */
const VENDA_STATUS_ORCAMENTO = new Set([
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
]);

/** Status de venda em que a assinatura vale como aceite do recebimento. */
const VENDA_STATUS_ENTREGA = new Set([
  "ABERTA",
  "PENDENTE",
  "AUTORIZADO",
  "PAGAMENTO",
  "PAGO",
  "FINALIZADA",
]);

function normalizeStatus(status?: string | null) {
  return String(status ?? "")
    .trim()
    .toUpperCase();
}

function alvoLabels(alvo: AceiteAlvo) {
  if (alvo === "PECA") {
    return {
      artigo: "a",
      nome: "peça/componente",
      posse: "a peça/componente",
      acao: "retirada",
      verificacao: "Conferi a peça/componente",
    };
  }
  if (alvo === "EQUIPAMENTO") {
    return {
      artigo: "a",
      nome: "máquina/equipamento",
      posse: "a máquina/equipamento",
      acao: "retirada",
      verificacao: "Testei a máquina/equipamento",
    };
  }
  return {
    artigo: "o",
    nome: "veículo",
    posse: "meu veículo",
    acao: "saída",
    verificacao: "Testei o veículo",
  };
}

/** Cláusula de prazo de retirada: só cita valores de diária quando o alvo é veículo. */
function clausulaPrazoRetirada(alvo: AceiteAlvo) {
  const { nome } = alvoLabels(alvo);
  const base =
    `Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de ` +
    `${PRAZO_RETIRADA} para retirar ${alvo === "VEICULO" ? "o veículo" : `a ${nome}`} da oficina. ` +
    `Após esse período, poderá ser cobrada diária pela utilização do espaço`;

  return alvo === "VEICULO"
    ? `${base}, no valor de ${DIARIA_VEICULO_PESADO} para veículos pesados e ${DIARIA_VEICULO_LEVE} para veículos leves.`
    : `${base}, conforme os valores praticados pela empresa.`;
}

/**
 * Dizeres de aceite exibidos abaixo das assinaturas na impressão da OS.
 * Retorna null quando o documento não comporta aceite (ex.: OS cancelada).
 */
export function getTermoAceiteOS(
  status?: string | null,
  alvo: AceiteAlvo = "VEICULO",
): TermoAceite | null {
  const s = normalizeStatus(status);
  const { artigo, nome, posse, acao, verificacao } = alvoLabels(alvo);

  if (OS_STATUS_ORCAMENTO.has(s)) {
    return {
      titulo: "Termo de aceite do orçamento",
      intro: "Declaro estar ciente de que:",
      itens: [
        `Li e concordo com os serviços, peças e valores descritos nesta Ordem de Serviço, autorizando a ` +
          `execução dos serviços n${artigo} ${nome} acima identificad${artigo}.`,
        `Serviços ou peças adicionais identificados durante a execução serão comunicados previamente e ` +
          `dependerão de nova autorização.`,
        `O prazo de conclusão pode variar conforme a disponibilidade das peças, e os valores apresentados ` +
          `podem sofrer alteração caso a aprovação não ocorra na data de emissão deste documento.`,
        clausulaPrazoRetirada(alvo),
      ],
    };
  }

  if (OS_STATUS_ENTREGA.has(s)) {
    return {
      titulo: `Termo de aceite e ${acao} d${artigo} ${nome}`,
      intro: "Declaro estar ciente de que:",
      itens: [
        `${verificacao} e confirmo que o problema informado foi devidamente resolvido, tendo conferido os ` +
          `serviços executados e as peças aplicadas.`,
        `Estou retirando ${posse} da oficina nas mesmas condições de conservação em que ` +
          `${alvo === "VEICULO" ? "o" : "a"} entreguei, ressalvadas as alterações decorrentes dos serviços executados.`,
        `Estou de acordo com todas as observações, informações e condições de garantia constantes nesta ` +
          `Ordem de Serviço, nada mais tendo a reclamar quanto aos itens aqui relacionados.`,
        clausulaPrazoRetirada(alvo),
      ],
    };
  }

  return null;
}

/**
 * Dizeres de aceite exibidos abaixo das assinaturas na impressão de vendas.
 * Retorna null quando o documento não comporta aceite (ex.: venda cancelada).
 */
export function getTermoAceiteVenda(status?: string | null): TermoAceite | null {
  const s = normalizeStatus(status);

  if (VENDA_STATUS_ORCAMENTO.has(s)) {
    return {
      titulo: "Termo de aceite do orçamento",
      intro: "Declaro estar ciente de que:",
      itens: [
        `Li e concordo com os produtos, quantidades e valores descritos neste orçamento.`,
        `Este documento não representa faturamento nem reserva de estoque.`,
        `A confirmação do pedido está sujeita à disponibilidade dos itens e aos valores vigentes na data da aprovação.`,
      ],
    };
  }

  if (VENDA_STATUS_ENTREGA.has(s)) {
    return {
      titulo: "Termo de aceite e recebimento",
      intro: "Declaro estar ciente de que:",
      itens: [
        `Recebi os produtos relacionados neste documento e conferi as quantidades e as condições dos itens.`,
        `Estou de acordo com todas as observações e informações constantes neste documento.`,
        `Estou ciente das condições de garantia, troca e devolução praticadas pela empresa e previstas na ` +
          `legislação vigente, nada mais tendo a reclamar quanto aos itens aqui relacionados.`,
      ],
    };
  }

  return null;
}
