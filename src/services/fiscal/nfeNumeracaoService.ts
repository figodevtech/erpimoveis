// Controle da numeração da NF-e.
//
// Regra única para os dois motores de emissão (a partir de OS/Venda e avulsa):
// o rascunho nasce com número provisório e o número definitivo só é alocado na
// hora de transmitir. Se a SEFAZ rejeitar, ou se a nota for excluída antes de
// existir lá, o número volta para a fila e é reaproveitado na próxima emissão.

import { renumerarNFeXml } from "@/lib/nfe/renumerarNFeXml";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type NumeroDefinitivo = {
  numero: number;
  serie: number;
  chave: string | null;
  /** XML com a numeração definitiva — é ele que deve ser assinado e enviado. */
  xml: string;
  /** false quando a nota já tinha número alocado (retransmissão). */
  alocadoAgora: boolean;
};

/**
 * Número que a próxima transmissão deve receber: o menor da fila de liberados
 * ou o seguinte na sequência.
 *
 * É uma previsão, e não uma reserva — quem aloca de fato é `nfe_alocar_numero`,
 * na transmissão. Serve para a tela de emissão dizer com que número a nota deve
 * sair.
 */
export async function preverProximoNumero(config: {
  id: number | string;
  serie: number;
  ultimo_numero: number;
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("nfe_numero_liberado")
    .select("numero")
    .eq("config_id", Number(config.id))
    .eq("serie", Number(config.serie))
    .order("numero", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[nfe] falha ao ler a fila de números liberados:", error);
    return Number(config.ultimo_numero ?? 0) + 1;
  }

  return data ? Number(data.numero) : Number(config.ultimo_numero ?? 0) + 1;
}

/**
 * Garante que a NF-e tenha número definitivo antes do envio.
 *
 * Numa retransmissão (nota que já foi à SEFAZ e voltou sem desfecho) o número
 * anterior é mantido: a SEFAZ não registrou nada, mas repetir o mesmo número é
 * o comportamento correto e evita furo na sequência.
 */
export async function garantirNumeroDefinitivo(
  nfeId: number,
  xmlAtual: string,
): Promise<NumeroDefinitivo> {
  const { data: nfe, error: nfeError } = await supabaseAdmin
    .from("nfe")
    .select("id, empresaid, numero, serie, chave_acesso, numero_definitivo")
    .eq("id", nfeId)
    .maybeSingle();

  if (nfeError) throw nfeError;
  if (!nfe) throw new Error("NF-e não encontrada para alocar numeração.");

  if (nfe.numero_definitivo) {
    return {
      numero: Number(nfe.numero),
      serie: Number(nfe.serie),
      chave: nfe.chave_acesso ?? null,
      xml: xmlAtual,
      alocadoAgora: false,
    };
  }

  const { data: config, error: configError } = await supabaseAdmin
    .from("nfe_config")
    .select("id")
    .eq("empresaid", nfe.empresaid)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (configError) throw configError;
  if (!config) throw new Error("Configuração de NF-e não encontrada para a empresa da nota.");

  const { data: alocado, error: alocarError } = await supabaseAdmin.rpc("nfe_alocar_numero", {
    p_config_id: Number(config.id),
  });
  if (alocarError) throw alocarError;

  const row = Array.isArray(alocado) ? alocado[0] : alocado;
  if (!row) throw new Error("Não foi possível alocar número de NF-e.");

  const numero = Number(row.numero);
  const serie = Number(row.serie ?? nfe.serie);
  const renumerado = renumerarNFeXml(xmlAtual, numero);

  // Grava antes de transmitir: se o envio cair no meio, o número continua preso
  // a esta nota e a retransmissão repete o mesmo — nunca outro.
  const { error: updateError } = await supabaseAdmin
    .from("nfe")
    .update({
      numero,
      serie,
      chave_acesso: renumerado.chave,
      numero_definitivo: true,
      xml_assinado: renumerado.xml,
      updatedat: new Date().toISOString(),
    })
    .eq("id", nfeId);

  if (updateError) throw updateError;

  return {
    numero,
    serie,
    chave: renumerado.chave,
    xml: renumerado.xml,
    alocadoAgora: true,
  };
}

/**
 * Devolve o número para a fila de reaproveitamento.
 *
 * A função no banco só libera notas que a SEFAZ nunca registrou; autorizada,
 * denegada, cancelada ou aguardando retorno de lote seguram o número.
 */
export async function liberarNumeroNfe(nfeId: number, motivo: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("nfe_liberar_numero", {
    p_nfe_id: nfeId,
    p_motivo: motivo.slice(0, 200),
  });

  if (error) {
    console.warn("[nfe] falha ao devolver número para a fila:", error);
    return false;
  }

  return Boolean(data);
}
