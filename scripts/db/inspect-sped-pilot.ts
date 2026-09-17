import { supabaseAdmin } from "../../src/lib/supabaseAdmin";

async function inspect() {
  console.log("=== INSPEÇÃO PILOTO SPED FISCAL (DEMIR DIESEL) ===");

  const [
    empresaRes,
    configRes,
    compRes,
    contabRes,
    nfeCountRes,
    entradaComDataRes,
    entradaSemDataRes,
    convsRes,
    correlsRes,
    dfeCountRes,
  ] = await Promise.all([
    supabaseAdmin.from("empresa").select("id, razaosocial, nomefantasia, cnpj, inscricaoestadual, codigomunicipio, uf").eq("id", 1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_config").select("*").eq("empresa_id", 1).maybeSingle(),
    supabaseAdmin.from("fiscal_sped_competencia").select("*, versoes:fiscal_sped_versao(*)").eq("empresa_id", 1),
    supabaseAdmin.from("fiscal_sped_contabilista").select("*").eq("empresa_id", 1),
    supabaseAdmin.from("nfe").select("id, chave_acesso, status, dataemissao", { count: "exact" }).eq("empresaid", 1).eq("is_deleted", false).gte("dataemissao", "2026-08-01T00:00:00").lte("dataemissao", "2026-08-31T23:59:59"),
    supabaseAdmin.from("entrada").select("id, data_entrada_fiscal, fiscal_dfe_documento_id", { count: "exact" }).eq("fiscal", true).gte("data_entrada_fiscal", "2026-08-01").lte("data_entrada_fiscal", "2026-08-31"),
    supabaseAdmin.from("entrada").select("id", { count: "exact" }).eq("fiscal", true).is("data_entrada_fiscal", null),
    supabaseAdmin.from("fiscal_sped_unidade_conversao").select("*").eq("empresa_id", 1),
    supabaseAdmin.from("fiscal_sped_item_correlacao").select("*").eq("empresa_id", 1),
    supabaseAdmin.from("fiscal_dfe_documento").select("id", { count: "exact", head: true }).eq("empresa_id", 1),
  ]);

  console.log("\n1. Empresa:", empresaRes.data);
  console.log("\n2. Config SPED:", configRes.data);
  console.log("\n3. Contabilista cadastrado:", contabRes.data);
  console.log("\n4. Competências cadastradas:", compRes.data);
  console.log("\n5. Documentos em 08/2026:");
  console.log(`   - NF-e emitidas: ${nfeCountRes.count}`);
  console.log(`   - Entradas fiscais com data civil em 08/2026: ${entradaComDataRes.count}`);
  console.log(`   - Entradas fiscais SEM data civil confirmada: ${entradaSemDataRes.count}`);
  console.log(`   - Total de DF-e recebidos: ${dfeCountRes.count}`);
  console.log("\n6. Cadastros complementares:");
  console.log(`   - Conversões de unidade (0220): ${convsRes.data?.length ?? 0}`);
  console.log(`   - Correlações de item (0221): ${correlsRes.data?.length ?? 0}`);
}

inspect().catch((err) => {
  console.error("Erro na inspeção:", err);
  process.exit(1);
});
