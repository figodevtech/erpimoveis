// Os dizeres que vigoravam antes do cadastro, agora como ponto de partida.
//
// Enquanto a tabela `os_termo_impressao` estiver vazia — instalacao nova, ou
// oficina que nunca mexeu na redacao — a impressao usa esta lista, e a tela de
// Configuracoes Gerais a mostra como "Padrao". O primeiro salvamento grava
// tudo no banco e a partir dai o texto e do cliente.
//
// Os textos sao copia literal do que `getTermoAceiteOS` produzia em
// `src/lib/print-aceite.ts` — `termos-impressao.test.ts` compara os dois, item
// por item, justamente para provar que nada mudou no papel.

import type { TermoImpressao } from "./termos-impressao";

/** Status em que a assinatura vale como aprovacao do orcamento. */
const STATUS_ORCAMENTO = [
  "AGUARDANDO_CHECKLIST",
  "ORCAMENTO",
  "APROVACAO_ORCAMENTO",
  "ORCAMENTO_APROVADO",
  "ORCAMENTO_RECUSADO",
  "EM_ANDAMENTO",
] as const;

/** Status em que a assinatura vale como aceite da entrega/saida. */
const STATUS_ENTREGA = ["PAGAMENTO", "FATURAMENTO", "SEM_COBRANCA", "CONCLUIDO"] as const;

const ITEM_SERVICOS_ADICIONAIS =
  "Serviços ou peças adicionais identificados durante a execução serão comunicados previamente e " +
  "dependerão de nova autorização.";

const ITEM_PRAZO_CONCLUSAO =
  "O prazo de conclusão pode variar conforme a disponibilidade das peças, e os valores apresentados " +
  "podem sofrer alteração caso a aprovação não ocorra na data de emissão deste documento.";

const ITEM_GARANTIA =
  "Estou de acordo com todas as observações, informações e condições de garantia constantes nesta " +
  "Ordem de Serviço, nada mais tendo a reclamar quanto aos itens aqui relacionados.";

/** So o veiculo cita valores de diaria; peca e maquina remetem ao que a empresa pratica. */
const ITEM_RETIRADA_VEICULO =
  "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de " +
  "72 (setenta e duas) horas para retirar o veículo da oficina. " +
  "Após esse período, poderá ser cobrada diária pela utilização do espaço, no valor de R$ 50,00 " +
  "para veículos pesados e R$ 20,00 para veículos leves.";

const ITEM_RETIRADA_OUTROS =
  "Após a comunicação da criação, atualização ou conclusão da Ordem de Serviço, tenho o prazo de " +
  "72 (setenta e duas) horas para retirar a {{alvo}} da oficina. " +
  "Após esse período, poderá ser cobrada diária pela utilização do espaço, conforme os valores " +
  "praticados pela empresa.";

const INTRO_PADRAO = "Declaro estar ciente de que:";

/**
 * Cinco blocos, e nao seis: peca e maquina dividem o texto do orcamento (mesmo
 * genero, basta `{{alvo}}`), mas divergem na entrega — "Conferi a
 * peca/componente" contra "Testei a maquina/equipamento".
 *
 * Os `id` sao negativos para nunca colidirem com os da tabela: enquanto a lista
 * vem daqui, ela ainda nao foi gravada.
 */
export const TERMOS_OS_PADRAO: TermoImpressao[] = [
  {
    id: -1,
    titulo: "Termo de aceite do orçamento",
    intro: INTRO_PADRAO,
    itens: [
      "Li e concordo com os serviços, peças e valores descritos nesta Ordem de Serviço, autorizando a " +
        "execução dos serviços no veículo acima identificado.",
      ITEM_SERVICOS_ADICIONAIS,
      ITEM_PRAZO_CONCLUSAO,
      ITEM_RETIRADA_VEICULO,
    ],
    status: [...STATUS_ORCAMENTO],
    alvos: ["VEICULO"],
    ordem: 10,
  },
  {
    id: -2,
    titulo: "Termo de aceite do orçamento",
    intro: INTRO_PADRAO,
    itens: [
      "Li e concordo com os serviços, peças e valores descritos nesta Ordem de Serviço, autorizando a " +
        "execução dos serviços na {{alvo}} acima identificada.",
      ITEM_SERVICOS_ADICIONAIS,
      ITEM_PRAZO_CONCLUSAO,
      ITEM_RETIRADA_OUTROS,
    ],
    status: [...STATUS_ORCAMENTO],
    alvos: ["PECA", "EQUIPAMENTO"],
    ordem: 20,
  },
  {
    id: -3,
    titulo: "Termo de aceite e saída do veículo",
    intro: INTRO_PADRAO,
    itens: [
      "Testei o veículo e confirmo que o problema informado foi devidamente resolvido, tendo conferido os " +
        "serviços executados e as peças aplicadas.",
      "Estou retirando meu veículo da oficina nas mesmas condições de conservação em que " +
        "o entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
      ITEM_GARANTIA,
      ITEM_RETIRADA_VEICULO,
    ],
    status: [...STATUS_ENTREGA],
    alvos: ["VEICULO"],
    ordem: 30,
  },
  {
    id: -4,
    titulo: "Termo de aceite e retirada da peça/componente",
    intro: INTRO_PADRAO,
    itens: [
      "Conferi a peça/componente e confirmo que o problema informado foi devidamente resolvido, tendo conferido os " +
        "serviços executados e as peças aplicadas.",
      "Estou retirando a peça/componente da oficina nas mesmas condições de conservação em que " +
        "a entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
      ITEM_GARANTIA,
      ITEM_RETIRADA_OUTROS,
    ],
    status: [...STATUS_ENTREGA],
    alvos: ["PECA"],
    ordem: 40,
  },
  {
    id: -5,
    titulo: "Termo de aceite e retirada da máquina/equipamento",
    intro: INTRO_PADRAO,
    itens: [
      "Testei a máquina/equipamento e confirmo que o problema informado foi devidamente resolvido, tendo conferido os " +
        "serviços executados e as peças aplicadas.",
      "Estou retirando a máquina/equipamento da oficina nas mesmas condições de conservação em que " +
        "a entreguei, ressalvadas as alterações decorrentes dos serviços executados.",
      ITEM_GARANTIA,
      ITEM_RETIRADA_OUTROS,
    ],
    status: [...STATUS_ENTREGA],
    alvos: ["EQUIPAMENTO"],
    ordem: 50,
  },
];
