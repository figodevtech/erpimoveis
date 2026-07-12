// src/lib/nfe/statusNfe.ts

export const StatusNfe = {
  RASCUNHO: 'RASCUNHO',
  AUTORIZADA: 'AUTORIZADA',
  CANCELADA: 'CANCELADA',
  REJEITADA: 'REJEITADA',
  DENEGADA: 'DENEGADA',
  ENVIADA: 'ENVIADA',
} as const;

export type StatusNfe = (typeof StatusNfe)[keyof typeof StatusNfe];

export const NFE_STATUS_CODE_LABELS: Record<string, string> = {
  "1": "Uso autorizado",
  "2": "Uso denegado",
  "3": "NF-e cancelada",
  "100": "Uso autorizado",
  "101": "Cancelamento homologado",
  "102": "Inutilização homologada",
  "103": "Lote recebido",
  "104": "Lote processado",
  "105": "Lote em processamento",
  "106": "Lote não localizado",
  "107": "Serviço em operação",
  "108": "Serviço paralisado momentaneamente",
  "109": "Serviço paralisado sem previsão",
  "110": "Uso denegado",
  "128": "Lote de evento processado",
  "135": "Evento registrado e vinculado",
  "136": "Evento registrado, mas não vinculado",
  "137": "Nenhum documento localizado",
  "138": "Documento localizado",
  "139": "Pedido de download processado",
  "150": "Uso autorizado fora do prazo",
  "151": "Cancelamento homologado fora do prazo",
  "155": "Cancelamento homologado fora do prazo",
  "204": "Duplicidade de NF-e",
  "205": "NF-e denegada",
  "206": "NF-e já inutilizada",
  "212": "Data de emissão posterior à data de recebimento",
  "215": "Falha no schema XML",
  "217": "NF-e não consta na base de dados da SEFAZ",
  "225": "Falha no schema XML do lote de NF-e",
  "228": "Data de emissão muito atrasada",
  "232": "IE do destinatário não informada",
  "234": "IE do destinatário não vinculada ao CNPJ",
  "241": "Número já utilizado em faixa de inutilização",
  "242": "Faixa de numeração já inutilizada",
  "301": "Uso denegado: irregularidade fiscal do emitente",
  "302": "Uso denegado: irregularidade fiscal do destinatário",
  "303": "Uso denegado: destinatário não habilitado na UF",
  "539": "Duplicidade de NF-e com diferença na chave",
  "573": "Duplicidade de evento",
  "578": "Data do evento maior que a data de processamento",
  "596": "Evento apresentado após o prazo permitido",
  "656": "Consumo indevido",
  "999": "Erro não catalogado",
};

function isNumericStatus(value: string) {
  return /^\d+$/.test(value);
}

export function traduzCodigoStatusNfe(status: string | number | null | undefined): string {
  const code = String(status ?? "").trim();
  if (!code) return "";

  const label = NFE_STATUS_CODE_LABELS[code];
  if (label) return label;

  if (!isNumericStatus(code)) return code;

  const numeric = Number(code);
  if (numeric >= 200 && numeric < 300) return `Rejeição SEFAZ ${code}`;
  if (numeric >= 300 && numeric < 400) return `Uso denegado SEFAZ ${code}`;
  if (numeric >= 500 && numeric < 1000) return `Rejeição SEFAZ ${code}`;

  return `Status SEFAZ ${code}`;
}

export function traduzStatusNfe(status: StatusNfe | string): string {
  const normalized = String(status ?? "").trim();

  if (isNumericStatus(normalized)) {
    return traduzCodigoStatusNfe(normalized);
  }

  switch (normalized.toUpperCase()) {
    case 'RASCUNHO':
      return 'Rascunho';
    case 'AUTORIZADA':
    case 'AUTORIZADO':
    case 'EMITIDA':
      return 'Autorizada';
    case 'CANCELADA':
    case 'CANCELADO':
      return 'Cancelada';
    case 'REJEITADA':
      return 'Rejeitada';
    case 'DENEGADA':
    case 'DENEGADO':
      return 'Denegada';
    case 'ENVIADA':
      return 'Enviada / Aguardando retorno';
    case 'RESUMO_NFE':
      return 'Resumo da NF-e';
    case 'PROC_NFE':
      return 'NF-e completa';
    default:
      return normalized;
  }
}
