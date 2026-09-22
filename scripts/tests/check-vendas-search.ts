import { createClient } from "@supabase/supabase-js";
import { planoBuscaVendas } from "../../src/lib/vendas/busca";
import assert from "node:assert/strict";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
async function main() {
for (const termo of ["11.337.394/0001-94", "11337394000194", "oleo", "123", "R$ 1.234,56", "Maria Aparecida da Silva", "cancel"]) {
  const plano = planoBuscaVendas(termo);
  let query = db.from("venda").select(["id", ...plano.select].join(","), { count: "exact" }).limit(1);
  for (const filtro of plano.filtros) query = query.or(filtro.expressao, { referencedTable: filtro.relacao });
  query = query.or(plano.or.join(","));
  const { error } = await query;
  if (error) throw new Error(`${error.code}: ${error.message}`);
  console.log(`Consulta válida: ${termo}`);
}
const { data: amostras, error } = await db.from("venda").select("id, cliente:cliente(cpfcnpj)").limit(50);
if (error) throw error;
const amostra = (amostras as any[])?.find((venda) => [11, 14].includes(String(venda.cliente?.cpfcnpj ?? "").replace(/\D/g, "").length));
assert.ok(amostra, "Nenhuma venda com documento disponível para validar");
const digitos = String(amostra.cliente.cpfcnpj).replace(/\D/g, "");
const mascara = digitos.length === 11 ? digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
for (const [label, termo, cliente] of [["CPF/CNPJ sem máscara", digitos, ""], ["CPF/CNPJ com máscara", mascara, ""], ["Filtro de cliente", "", mascara], ["Sem correspondência", "zzzxq918273", ""]]) {
  const plano = planoBuscaVendas(termo, cliente);
  let query = db.from("venda").select(["id", ...plano.select].join(",")).eq("id", amostra.id);
  for (const filtro of plano.filtros) query = query.or(filtro.expressao, { referencedTable: filtro.relacao });
  if (plano.or.length) query = query.or(plano.or.join(","));
  for (const obrigatoria of plano.obrigatorias) query = query.or(obrigatoria);
  const { data, error } = await query;
  if (error) throw new Error(`${error.code}: ${error.message}`);
  assert.equal(data.length, label === "Sem correspondência" ? 0 : 1, label);
  console.log(`Resultado conferido: ${label}`);
}
}
void main();
