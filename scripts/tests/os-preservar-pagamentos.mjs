/** Rota real, sem autenticação externa nem gravações em banco. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "artifacts/ofx-ui/os-preservar-pagamentos.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({
  entryPoints: [path.join(root, "src/app/api/ordens/[id]/status/route.ts")],
  bundle: true, platform: "node", format: "cjs", packages: "external",
  outfile: output, tsconfig: path.join(root, "tsconfig.json"),
  plugins: [{ name: "mocks", setup(builder) {
    builder.onResolve({ filter: /^@\// }, ({ path }) => ({ path, namespace: "mock" }));
    builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: `
      export const supabaseAdmin = globalThis.__osDb;
      export const requireOSEdit = async () => {};
      export const requireOSFinalizarSemCobranca = async () => {};
      export const buscarFaturamentoOsHabilitado = async () => true;
      export const getPaymentMethodValues = async () => ['PIX','BOLETO'];
      export const buscarServicosSemRealizador = async () => [];
      export const statusExcluiTransacoesFinanceirasOs = () => false;
      export const validarSnapshotTransacoesDaOs = () => {};
      export const buscarModoBaixaEstoqueOS = () => 'EXECUCAO';
      export const consumirEstoqueOS = () => ({ok:true});
      export const mensagemEstoqueInsuficienteOS = () => '';
      export const CODIGO_REALIZADORES_PENDENTES = 'TESTE';
      export const mensagemRealizadoresPendentes = () => '';
    ` }));
  } }],
});
let salvo;
const chamadas = [];
globalThis.__osDb = {
  from(tabela) {
    const query = new Proxy({}, { get: (_, method) => method === "then"
      ? resolve => resolve({data: tabela === "ordemservico" ? salvo : [], count: 0, error: null})
      : () => query });
    return query;
  },
  async rpc(nome, args) {
    chamadas.push({ nome, args });
    if (nome === "resumo_financeiro_os") return {data:{saldo_disponivel_lancamento:100},error:null};
    assert.equal(nome, "transicionar_faturamento_os");
    return {data:{status:"FATURAMENTO"},error:null};
  },
};
const { PUT } = createRequire(import.meta.url)(output);
async function enviar(body) {
  chamadas.length = 0;
  return PUT(new Request("http://localhost/api/ordens/1/status", {
    method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body),
  }), {params:Promise.resolve({id:"1"})});
}
for (const dados of [
  { forma_pagamento:"BOLETO", parcelas_pagamento:3, pagamentos_previstos:null },
  { forma_pagamento:null, pagamentos_previstos:[{metodo:"PIX",valor:40},{metodo:"BOLETO",valor:60,parcelas:2}] },
]) {
  salvo = {status:"PAGAMENTO",...dados};
  assert.equal((await enviar({status:"FATURAMENTO"})).status, 200);
  assert.deepEqual(chamadas, [{nome:"transicionar_faturamento_os",args:{p_os_id:1,p_status:"FATURAMENTO"}}]);
}
salvo = {status:"PAGAMENTO",forma_pagamento:null,pagamentos_previstos:null};
assert.equal((await enviar({status:"FATURAMENTO"})).status, 400, "OS sem acordo continua exigindo condições");
salvo.forma_pagamento = "PIX";
assert.equal((await enviar({status:"FATURAMENTO",pagamentosPrevistos:[]})).status, 400, "Edição explícita não deve contornar validações");
assert.equal((await enviar({status:"FATURAMENTO",pagamentosPrevistos:[{metodo:"PIX",valor:100,parcelas:null}],descricaoFinanceiro:"Novo acordo"})).status, 200);
assert.equal(chamadas.at(-1).args.p_condicoes.descricao_financeiro, "Novo acordo");
console.log("Preservação de pagamentos da OS validada: acordo legado, múltiplos métodos, OS sem acordo e edição explícita.");
