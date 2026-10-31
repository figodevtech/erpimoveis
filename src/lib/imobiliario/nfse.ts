import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NFSeService, NFSeValidationError, conferirCodigosFiscaisNFSe, listarPendenciasNFSe, normalizarStatusNFSe, textoParaDpsNacional } from "@/lib/services/fiscais/nfse-service";
import { competenciaDoRegistroNFSe, dataDoDiaNFSe, resolverPoliticaNFSe } from "@/lib/services/fiscais/nfse-politica";
import { transportDaPolitica } from "@/lib/services/fiscais/nfse-transport";
import { atualizarRegistroNFSe, errosDeResultadoIncerto, interacaoNFSe, acrescentarInteracaoNFSe, MENSAGEM_ENVIO_SEM_RESPOSTA } from "@/lib/services/fiscais/nfse-registro";
import { temResultadoIncerto } from "@/lib/services/fiscais/nfse-registro";
import { syncNfseWithFocus } from "@/lib/services/fiscais/nfse-sync";
import { transportDoRegistro } from "@/lib/services/fiscais/nfse-transport";
import { desfechoDoEnvioNFSe } from "@/lib/services/fiscais/nfse-recusa";
import { db, internal, ImobError, one, rpc } from "./server";
import { financeAccess, scopeFromUrl, type FinanceScope } from "./finance";
import { civilDate } from "./schemas";
import { normalizeFiscalCodes, validateServiceSources, type FiscalSource } from "./nfse-source";

type Row = Record<string, any>;
const sourceId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const emissionSchema = z.object({
  acao: z.enum(["PREPARAR", "EMITIR", "REEMITIR"]).default("PREPARAR"), nfse_id: sourceId.optional(), movimento_ids: z.array(sourceId).max(200).default([]), transacao_ids: z.array(sourceId).max(200).default([]),
  codigos_fiscais: z.record(z.string(), z.unknown()).default({}), data_competencia: civilDate.optional(), discriminacao: z.string().trim().min(5).max(1000),
  tomador: z.object({ codigomunicipio: z.string().regex(/^\d{7}$/), endereco: z.string().trim().max(200).optional(), endereconumero: z.string().trim().max(30).optional(), enderecocomplemento: z.string().trim().max(200).optional(), bairro: z.string().trim().max(100).optional(), estado: z.string().trim().length(2).optional(), cep: z.string().regex(/^\d{8}$/).optional() }),
});
const scopeFields = { proprietario_id: "proprietario_id", imovel_id: "imovel_id", reserva_id: "reserva_id", locacao_id: "locacao_id", venda_id: "venda_id" } as const;

function applyScope(query: any, scope: FinanceScope, transaction = false) {
  for (const [key, value] of Object.entries(scope)) query = query.eq(transaction && ["reserva_id", "locacao_id", "venda_id"].includes(key) ? key.replace("_id", "_imovel_id") : scopeFields[key as keyof FinanceScope], value);
  return query;
}
async function fiscalCompany() {
  const result = await db.from("empresa").select("*").limit(2); if (result.error) throw result.error;
  if (result.data?.length !== 1) throw new ImobError(409, "Cadastre uma única empresa emitente antes de preparar a NFS-e.");
  const empresa = result.data[0]; const config = await db.from("nfse_config").select("token,provedor,padroes_emissao,inscricao_municipal").eq("empresa_id", empresa.id).maybeSingle(); if (config.error) throw config.error;
  return { empresa: { ...empresa, inscricaomunicipal: empresa.inscricaomunicipal ?? config.data?.inscricao_municipal }, config: config.data };
}
async function selectedSources(movimentoIds: number[], transacaoIds: number[]) {
  const sources: FiscalSource[] = [];
  if (movimentoIds.length) {
    const result = await db.from("imovel_movimento").select("id,tipo,proprietario_id,imovel_id,valor,nfse_id,descricao").in("id", movimentoIds).eq("tipo", "TAXA_ADMIN").gt("valor", 0);
    if (result.error) throw result.error;
    if (result.data.length !== new Set(movimentoIds).size) throw new ImobError(409, "Uma taxa selecionada não está disponível para emissão.");
    sources.push(...result.data.map(row => ({ ...row, id: Number(row.id), tipo: "TAXA_ADMIN" as const, valor: Number(row.valor) })));
  }
  if (transacaoIds.length) {
    const result = await db.from("transacao").select("id,proprietario_id,imovel_id,valor,valorLiquido,pendente,is_deleted,imovel_nfse_id,descricao").in("id", transacaoIds).eq("imovel_natureza", "COMISSAO").eq("pendente", false).eq("is_deleted", false);
    if (result.error) throw result.error;
    if (result.data.length !== new Set(transacaoIds).size) throw new ImobError(409, "Uma comissão selecionada não está recebida ou disponível para emissão.");
    sources.push(...result.data.map(row => ({ ...row, id: Number(row.id), tipo: "COMISSAO" as const, valor: Number(row.valorLiquido) || Number(row.valor), nfse_id: row.imovel_nfse_id })));
  }
  return sources;
}

/** Safe metadata only; no provider credentials reach the browser. */
export async function invoiceCandidates(url: URL) {
  await internal("financeiro:notas_fiscais"); const scope = scopeFromUrl(url); await financeAccess(scope);
  const { empresa, config } = await fiscalCompany(); const items: Row[] = [];
  for (const kind of ["TAXA_ADMIN", "COMISSAO"] as const) {
    for (let offset = 0; ; offset += 1000) {
      let query = kind === "TAXA_ADMIN" ? db.from("imovel_movimento").select("id,imovel_id,proprietario_id,valor,descricao,data_movimento,nfse_id").eq("tipo", "TAXA_ADMIN").gt("valor", 0) : db.from("transacao").select("id,imovel_id,proprietario_id,valor,valorLiquido,descricao,pago_em,imovel_nfse_id").eq("imovel_natureza", "COMISSAO").eq("pendente", false).eq("is_deleted", false);
      query = applyScope(query, scope, kind === "COMISSAO"); const result = await query.order("id").range(offset, offset + 999); if (result.error) throw result.error;
      items.push(...result.data.map((row: Row) => ({ ...row, tipo: kind, valor: kind === "COMISSAO" ? Number(row.valorLiquido) || Number(row.valor) : Number(row.valor), nfse_id: row.nfse_id ?? row.imovel_nfse_id })));
      if (result.data.length < 1000) break;
    }
  }
  const ownerIds = [...new Set(items.map(row => row.proprietario_id))]; const owners: Row[] = [];
  if (ownerIds.length) { const result = await db.from("proprietario").select("id,nomerazaosocial,tipopessoa,cpfcnpj,email,telefone,endereco,endereconumero,enderecocomplemento,bairro,cidade,estado,cep").in("id", ownerIds); if (result.error) throw result.error; owners.push(...result.data); }
  const day = dataDoDiaNFSe(new Date(), empresa.timezone_iana); const policy = resolverPoliticaNFSe({ codigoMunicipio: empresa.codigomunicipio, regimeTributario: empresa.regimetributario, dataCompetencia: day });
  const defaults = normalizeFiscalCodes(policy ? config?.padroes_emissao?.[policy.modelo] : {});
  const noteIds = [...new Set(items.map(row => row.nfse_id).filter(Boolean))]; let notes: Row[] = [];
  if (noteIds.length) { const result = await db.from("nfse").select("id,status,referencia,numero,erros").in("id", noteIds); if (result.error) throw result.error; notes = result.data; }
  return { items: items.map(item => ({ ...item, nfse_status: notes.find(note => note.id === item.nfse_id)?.status, proprietario: owners.find(owner => owner.id === item.proprietario_id) })), empresa: { id: empresa.id, nome: empresa.razaosocial ?? empresa.nomefantasia, ambiente: empresa.ambiente }, modelo: policy?.modelo ?? null, data_competencia: day, codigos_fiscais: defaults };
}

export async function emitServiceInvoice(input: unknown) {
  const actor = await internal("financeiro:notas_fiscais"); const body = emissionSchema.parse(input);
  const sources = await selectedSources(body.movimento_ids, body.transacao_ids); let source: ReturnType<typeof validateServiceSources>;
  try { source = validateServiceSources(sources); } catch (error) { throw new ImobError(400, (error as Error).message); }
  for (const propertyId of new Set(sources.map(row => row.imovel_id))) await financeAccess({ imovel_id: propertyId });
  const { empresa, config } = await fiscalCompany(); const tomador: Row = { ...await one("proprietario", source.proprietarioId), ...body.tomador };
  // A correction keeps the rejected attempt's competência: retrying in November must not move an October service to another authorizer.
  const original = body.nfse_id ? await invoiceWithAccess(body.nfse_id) : null; let competencia: string;
  try { competencia = original ? competenciaDoRegistroNFSe(original.data_competencia ? { data_competencia: original.data_competencia } : original.payload_enviado, original.dataemissao, empresa.timezone_iana) : body.data_competencia ?? dataDoDiaNFSe(new Date(), empresa.timezone_iana); }
  catch (error) { throw new ImobError(409, (error as Error).message); }
  const requestedCodes = normalizeFiscalCodes(body.codigos_fiscais);
  const policy = resolverPoliticaNFSe({ codigoMunicipio: empresa.codigomunicipio, regimeTributario: empresa.regimetributario, dataCompetencia: competencia, itensListaServico: [requestedCodes.item_lista_servico] });
  if (!policy) throw new ImobError(409, "A integração NFS-e não está configurada para o município e regime da empresa.");
  const codes = { ...normalizeFiscalCodes(config?.padroes_emissao?.[policy.modelo]), ...requestedCodes };
  const items = [{ servicoid: 1, quantidade: 1, valor: source.total, servico: { descricao: body.discriminacao } }];
  const pending = listarPendenciasNFSe({ cliente: tomador }, empresa, items, policy.modelo).map(row => row.mensagem);
  const codeIssue = conferirCodigosFiscaisNFSe(policy, codes); if (codeIssue) pending.push(codeIssue);
  const preview = { valor_total: source.total, proprietario: { id: tomador.id, nome: tomador.nomerazaosocial, documento: tomador.cpfcnpj }, empresa: { id: empresa.id, nome: empresa.razaosocial, ambiente: empresa.ambiente }, modelo: policy.modelo, discriminacao: body.discriminacao, data_competencia: competencia, fontes: sources, pendencias: pending };
  if (body.acao === "PREPARAR") return { preview };
  if (pending.length) throw new ImobError(422, `Complete os dados da NFS-e: ${pending.join("; ")}.`, { pendencias: pending });
  const envToken = empresa.ambiente === "PRODUCAO" ? process.env.FOCUS_NFE_API_TOKEN : process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO;
  if (!config?.token?.trim() && !envToken?.trim()) throw new ImobError(409, "Configure o token NFS-e do ambiente da empresa antes de emitir.");
  const service = new NFSeService(); service.configurarAmbiente(empresa.ambiente, config?.token, empresa.timezone_iana);
  const mapperInput = { id: sources[0].id, cliente: tomador };
  let payload: Row;
  try { payload = policy.modelo === "NACIONAL" ? service.mapearOSParaFocusNacional(mapperInput, empresa, items, codes, { politica: policy, dataCompetencia: competencia }) : policy.modelo === "MUNICIPAL_CABEDELO" ? service.mapearOSParaFocusCabedelo(mapperInput, empresa, items, codes) : service.mapearOSParaFocus(mapperInput, empresa, items, codes); }
  catch (error) { if (error instanceof NFSeValidationError) throw new ImobError(422, error.message); throw error; }
  payload.referencia = `IMOB_${randomUUID()}`;
  if (policy.modelo === "NACIONAL") payload.descricao_servico = textoParaDpsNacional(body.discriminacao, "manter"); else payload.servico.discriminacao = body.discriminacao;
  // Focus registration and layout are checked before any note, source link or attempt is reserved.
  const transport = transportDaPolitica(policy, service);
  try { await transport.preparar(payload); } catch (error) { if (error instanceof NFSeValidationError) throw new ImobError(422, error.message); throw error; }
  if (body.acao === "REEMITIR") {
    if (!body.nfse_id || !original || sources.some(source => source.nfse_id !== body.nfse_id)) throw new ImobError(409, "Selecione somente as fontes da NFS-e rejeitada.");
    const checked = await syncNfseWithFocus(original as any); const current = await one("nfse", body.nfse_id);
    if (!checked.ok) throw new ImobError(409, "A consulta ao provedor não confirmou a rejeição. Resolva a autorização existente antes de corrigir o documento.");
    if (current.status !== "REJEITADA" || current.numero || current.url_xml) throw new ImobError(409, "A consulta não confirmou rejeição sem nota autorizada. Resolva a autorização existente antes de corrigir o documento.");
  }
  // In reissue mode the RPC re-checks the rejection under lock, keeps every original source and archives the previous attempt.
  const reserved: Row = await rpc("imob_reservar_nfse", { p_movimento_ids: body.movimento_ids, p_transacao_ids: body.transacao_ids, p_empresa_id: empresa.id, p_payload: payload, p_modelo: policy.modelo, p_referencia: payload.referencia, p_actor: actor.id, p_reemitir: body.acao === "REEMITIR", p_autorizador: policy.autorizador, p_data_competencia: competencia });
  if (reserved.already_exists) return { item: reserved, existing: true, message: "A origem já possui uma NFS-e registrada. Consulte a nota antes de reenviar." };
  const history = body.acao === "REEMITIR" ? (await one("nfse", reserved.id)).tentativas : [];
  try {
    const result = await transport.emitir(payload); const outcome = desfechoDoEnvioNFSe(result);
    const status = outcome === "ACEITO" ? normalizarStatusNFSe(result.status) : outcome === "REJEITADO" ? "REJEITADA" : "PROCESSANDO";
    const errors = outcome === "INCERTO" ? errosDeResultadoIncerto(result.message ?? "Sem confirmação do provedor") : outcome === "REJEITADO" ? result.erros : null;
    const updateError = await atualizarRegistroNFSe(reserved.id, { status, erros: errors, updatedat: new Date().toISOString() }, { payload_enviado: result.payload, retorno_bruto: result.retornoBruto, tentativas: acrescentarInteracaoNFSe(history, interacaoNFSe("EMISSAO", reserved.referencia, result.retornoBruto, result.payload)) });
    if (updateError) throw new ImobError(502, "O provedor recebeu o envio, mas o retorno não foi salvo. Consulte a NFS-e antes de qualquer nova emissão.", { nfse_id: reserved.id, referencia: reserved.referencia });
    return { item: { ...reserved, status }, message: outcome === "INCERTO" ? MENSAGEM_ENVIO_SEM_RESPOSTA : outcome === "REJEITADO" ? result.message ?? "O provedor rejeitou a NFS-e." : "NFS-e enviada ao provedor.", erros: errors };
  } catch (error) {
    if (error instanceof ImobError) throw error;
    await atualizarRegistroNFSe(reserved.id, { status: "PROCESSANDO", erros: errosDeResultadoIncerto((error as Error).message), updatedat: new Date().toISOString() }, { payload_enviado: payload });
    throw new ImobError(502, MENSAGEM_ENVIO_SEM_RESPOSTA, { nfse_id: reserved.id, referencia: reserved.referencia });
  }
}

async function invoiceWithAccess(id: number) {
  await internal("financeiro:notas_fiscais");
  const origins = await db.from("imovel_nfse_origem").select("imovel_id").eq("nfse_id", id); if (origins.error) throw origins.error;
  if (!origins.data.length) throw new ImobError(404, "NFS-e imobiliária não encontrada.");
  for (const propertyId of new Set(origins.data.map(row => row.imovel_id))) await financeAccess({ imovel_id: propertyId });
  return one("nfse", id);
}

/** Uncertain sends retain exactly the same provider reference and payload. */
export async function serviceInvoiceAction(input: unknown) {
  const body = z.object({ acao: z.enum(["CONSULTAR", "REENVIAR"]), nfse_id: sourceId }).parse(input);
  const note = await invoiceWithAccess(body.nfse_id);
  if (body.acao === "CONSULTAR") {
    const result = await syncNfseWithFocus(note as any); const item = await one("nfse", note.id);
    return { item: { id: item.id, status: item.status, referencia: item.referencia, numero: item.numero, url_pdf: item.url_pdf, url_xml: item.url_xml }, message: result.ok ? "Consulta concluída." : result.message, erros: item.erros };
  }
  if (note.status !== "PROCESSANDO" || !temResultadoIncerto(note.erros)) throw new ImobError(409, "O reenvio com a mesma referência é usado apenas quando o envio ficou sem confirmação. Consulte a nota para conhecer seu resultado.");
  if (!note.payload_enviado || !note.referencia) throw new ImobError(409, "A nota não possui o envio original para uma retomada segura.");
  const { empresa, config } = await fiscalCompany();
  if (Number(empresa.id) !== Number(note.empresaid)) throw new ImobError(409, "A empresa emitente da nota não corresponde à empresa configurada.");
  const service = new NFSeService(); service.configurarAmbiente(empresa.ambiente, config?.token, empresa.timezone_iana); const transport = transportDoRegistro(note.modelo_emissao, service);
  try {
    const result = await transport.emitir(note.payload_enviado); let outcome = desfechoDoEnvioNFSe(result);
    // A repeated municipal reference is not enough to establish a final rejection.
    if (outcome === "REJEITADO" && note.modelo_emissao !== "NACIONAL") outcome = "INCERTO";
    const status = outcome === "ACEITO" ? normalizarStatusNFSe(result.status) : outcome === "REJEITADO" ? "REJEITADA" : "PROCESSANDO";
    const errors = outcome === "INCERTO" ? errosDeResultadoIncerto(result.message ?? "Sem resposta conclusiva") : outcome === "REJEITADO" ? result.erros : null;
    const updateError = await atualizarRegistroNFSe(note.id, { status, erros: errors, updatedat: new Date().toISOString() }, { retorno_bruto: result.retornoBruto, tentativas: acrescentarInteracaoNFSe(note.tentativas ?? [], interacaoNFSe("REENVIO", note.referencia, result.retornoBruto, note.payload_enviado)) });
    if (updateError) throw new ImobError(502, "O provedor recebeu o reenvio, mas o retorno não foi salvo. Consulte a nota.", { nfse_id: note.id });
    return { item: { id: note.id, referencia: note.referencia, status }, erros: errors, message: outcome === "INCERTO" ? MENSAGEM_ENVIO_SEM_RESPOSTA : "Reenvio registrado com a mesma referência. Consulte a autorização." };
  } catch (error) { if (error instanceof ImobError) throw error; throw new ImobError(502, MENSAGEM_ENVIO_SEM_RESPOSTA, { nfse_id: note.id, referencia: note.referencia }); }
}
