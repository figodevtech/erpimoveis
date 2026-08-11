/**
 * Remove do Demir os titulos a receber pendentes com vencimento ate 01/05/2026.
 *
 * Por seguranca, a rotina:
 * - conecta exclusivamente ao banco Demir;
 * - simula por padrao (so grava com --aplicar);
 * - exige que o retrato conferido continue com 135 titulos / R$ 507.762,93;
 * - recusa titulos operacionais ou vinculados;
 * - confere o resultado dentro da transacao antes do COMMIT.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

const APLICAR = process.argv.includes("--aplicar");
const CORTE = "2026-05-01";
const QUANTIDADE_ESPERADA = 135;
const TOTAL_ESPERADO_CENTAVOS = 50_776_293;
const QUANTIDADE_MANTIDA_ESPERADA = 266;
const TOTAL_MANTIDO_ESPERADO_CENTAVOS = 85_320_350;

type Titulo = {
  id: string;
  valor: string;
  vencimento: string | null;
  origem: string | null;
  ordemservicoid: number | null;
  vendaid: number | null;
  entrada_id: string | null;
  usoconsumo_entrada_id: string | null;
  adiantamento_id: string | null;
  eh_adiantamento: boolean | null;
};

const paraCentavos = (valor: string) => Math.round(Number(valor) * 100);
const somarCentavos = (linhas: Array<{ valor: string }>) =>
  linhas.reduce((total, linha) => total + paraCentavos(linha.valor), 0);
const emReais = (centavos: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);

const FILTRO_CANDIDATOS = `
  tipo = 'RECEITA'::public.tipos_transacao
  and pendente is true
  and coalesce(is_deleted, false) is false
  and (
    coalesce(vencimento_em, data) is null
    or (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date <= date '${CORTE}'
  )`;

async function main() {
  const configuracao = loadDatabaseConfigs().find((item) => item.key === "demir");
  if (!configuracao) throw new Error("Banco Demir nao configurado.");

  const { client } = await connectDatabase(configuracao);
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    const candidatos = await client.query<Titulo>(`
      select
        id::text,
        valor::text,
        (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date::text as vencimento,
        origem,
        ordemservicoid,
        vendaid,
        entrada_id::text,
        usoconsumo_entrada_id::text,
        adiantamento_id::text,
        eh_adiantamento
      from public.transacao
      where ${FILTRO_CANDIDATOS}
      order by coalesce(vencimento_em, data) nulls first, id
      for update
    `);

    const ids = candidatos.rows.map((titulo) => titulo.id);
    const totalCentavos = somarCentavos(candidatos.rows);

    console.log(`Banco: ${configuracao.label}`);
    console.log(`Corte: vencimento ate ${CORTE} (inclusive)`);
    console.log(`Candidatos: ${ids.length} titulo(s), ${emReais(totalCentavos)}`);

    if (ids.length !== QUANTIDADE_ESPERADA || totalCentavos !== TOTAL_ESPERADO_CENTAVOS) {
      throw new Error(
        `O banco mudou desde a auditoria. Esperado: ${QUANTIDADE_ESPERADA} titulo(s), ` +
          `${emReais(TOTAL_ESPERADO_CENTAVOS)}. Encontrado: ${ids.length}, ${emReais(totalCentavos)}.`,
      );
    }

    const inesperados = candidatos.rows.filter(
      (titulo) =>
        titulo.origem !== "ORIGEM_MIGRACAO" ||
        titulo.vencimento == null ||
        titulo.ordemservicoid != null ||
        titulo.vendaid != null ||
        titulo.entrada_id != null ||
        titulo.usoconsumo_entrada_id != null ||
        titulo.adiantamento_id != null ||
        titulo.eh_adiantamento === true,
    );
    if (inesperados.length > 0) {
      throw new Error(`Ha ${inesperados.length} titulo(s) operacional(is), vinculado(s) ou sem vencimento. Operacao recusada.`);
    }

    const dependencias = await client.query<{
      ajustes: string;
      eventos: string;
      baixas: string;
      alteracoes_valor: string;
      transacoes_dependentes: string;
    }>(
      `select
         (select count(*) from public.transacao_ajuste where transacao_id = any($1::bigint[]))::text ajustes,
         (select count(*) from public.eventos_financeiros where source_type = 'TRANSACAO' and source_id = any($1::bigint[]))::text eventos,
         (select count(*) from public.transacao_baixa_historico where transacao_id = any($1::bigint[]))::text baixas,
         (select count(*) from public.transacao_valor_historico where transacao_id = any($1::bigint[]))::text alteracoes_valor,
         (select count(*) from public.transacao where adiantamento_id = any($1::bigint[]) or estorno_transacao_id = any($1::bigint[]))::text transacoes_dependentes`,
      [ids],
    );
    const dependencia = dependencias.rows[0];
    const totalDependencias = Object.values(dependencia).reduce((total, valor) => total + Number(valor), 0);
    if (totalDependencias > 0) {
      throw new Error(`Foram encontradas dependencias dos titulos: ${JSON.stringify(dependencia)}. Operacao recusada.`);
    }

    const mantidosAntes = await client.query<{ quantidade: string; total: string }>(`
      select count(*)::text quantidade, coalesce(sum(valor), 0)::text total
      from public.transacao
      where tipo = 'RECEITA'::public.tipos_transacao
        and pendente is true
        and coalesce(is_deleted, false) is false
        and coalesce(vencimento_em, data) is not null
        and (coalesce(vencimento_em, data) at time zone 'America/Fortaleza')::date > date '${CORTE}'
    `);
    const quantidadeMantida = Number(mantidosAntes.rows[0].quantidade);
    const totalMantidoCentavos = paraCentavos(mantidosAntes.rows[0].total);
    if (
      quantidadeMantida !== QUANTIDADE_MANTIDA_ESPERADA ||
      totalMantidoCentavos !== TOTAL_MANTIDO_ESPERADO_CENTAVOS
    ) {
      throw new Error("O conjunto de titulos que seria mantido mudou desde a auditoria. Operacao recusada.");
    }

    if (!APLICAR) {
      await client.query("ROLLBACK");
      console.log("Simulacao concluida. Nenhuma alteracao foi gravada.");
      return;
    }

    const removidos = await client.query<{ id: string }>(
      `delete from public.transacao
       where id = any($1::bigint[])
         and ${FILTRO_CANDIDATOS}
       returning id::text`,
      [ids],
    );
    if (removidos.rowCount !== QUANTIDADE_ESPERADA) {
      throw new Error(`Foram removidos ${removidos.rowCount ?? 0} titulos; esperado: ${QUANTIDADE_ESPERADA}.`);
    }

    const restantesNoCorte = await client.query<{ quantidade: string }>(`
      select count(*)::text quantidade
      from public.transacao
      where ${FILTRO_CANDIDATOS}
    `);
    if (Number(restantesNoCorte.rows[0].quantidade) !== 0) {
      throw new Error("Ainda existem titulos a receber ativos dentro do corte. COMMIT recusado.");
    }

    const mantidosDepois = await client.query<{ quantidade: string; total: string }>(`
      select count(*)::text quantidade, coalesce(sum(valor), 0)::text total
      from public.transacao
      where tipo = 'RECEITA'::public.tipos_transacao
        and pendente is true
        and coalesce(is_deleted, false) is false
    `);
    if (
      Number(mantidosDepois.rows[0].quantidade) !== QUANTIDADE_MANTIDA_ESPERADA ||
      paraCentavos(mantidosDepois.rows[0].total) !== TOTAL_MANTIDO_ESPERADO_CENTAVOS
    ) {
      throw new Error("A conferencia final nao corresponde aos titulos que deveriam permanecer. COMMIT recusado.");
    }

    await client.query("COMMIT");
    console.log(`Exclusao concluida: ${removidos.rowCount} titulo(s), ${emReais(totalCentavos)}.`);
    console.log(`Mantidos: ${quantidadeMantida} titulo(s), ${emReais(totalMantidoCentavos)}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
