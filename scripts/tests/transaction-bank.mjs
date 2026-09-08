/** Executa as rotas reais com autenticação e persistência simuladas. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "artifacts/ofx-ui/transaction-bank.cjs");
await mkdir(path.dirname(output), { recursive: true });
await build({
  stdin: {
    contents: `export { POST as avulsa } from '@/app/api/transaction/route';
      export { POST as os } from '@/app/api/transaction/os/route';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  outfile: output,
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [
    {
      name: "dependencias-simuladas",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(server-only|@\/lib\/supabaseAdmin|@\/lib\/auth|@\/app\/api\/_authz\/perms)$/,
          },
          ({ path }) => ({ path, namespace: "mock" }),
        );
        build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents:
            path === "server-only"
              ? ""
              : path.endsWith("supabaseAdmin")
                ? "export const supabaseAdmin = globalThis.__bancoTesteDb;"
                : path.endsWith("auth")
                  ? "export const auth = async () => ({user: {id: 'teste'}});"
                  : "export const requireFinanceiroCreate = async () => {}; export const requireFinanceirosAccess = async () => {};",
          loader: "js",
        }));
      },
    },
  ],
});

const escritas = [];
globalThis.__bancoTesteDb = {
  from(tabela) {
    let inseridas = null;
    let consulta;
    consulta = new Proxy(
      {},
      {
        get(_, metodo) {
          if (metodo === "then")
            return (resolve) => resolve({ data: inseridas, error: null });
          if (metodo === "insert")
            return (linhas) => {
              assert.equal(
                tabela,
                "transacao",
                "Escrita inesperada fora da transação",
              );
              inseridas = linhas.map((linha, index) => ({
                ...linha,
                id: index + 1,
              }));
              escritas.push(...inseridas);
              return consulta;
            };
          return () => consulta;
        },
      },
    );
    return consulta;
  },
};
const rotas = createRequire(import.meta.url)(output);
const base = {
  descricao: "Teste de banco obrigatório",
  valor: 100,
  tipo: "RECEITA",
  data: "2026-09-08T12:00:00-03:00",
  metodopagamento: "PIX",
  nomepagador: "Teste",
  cpfcnpjpagador: "12345678000199",
};
for (const [nome, post] of Object.entries(rotas)) {
  for (const pendente of [undefined, false]) {
    for (const banco_id of [undefined, null, "", 0, -1, "inválido"]) {
      const antes = escritas.length;
      const response = await post(
        new Request("http://teste/api/transaction", {
          method: "POST",
          body: JSON.stringify({
            newTransaction: { ...base, pendente, banco_id },
          }),
        }),
      );
      assert.equal(
        response.status,
        400,
        `${nome}: liquidada sem banco válido deve ser recusada`,
      );
      assert.match((await response.json()).error, /banco|conta bancária/i);
      assert.equal(
        escritas.length,
        antes,
        "Não deve gravar antes de validar banco",
      );
    }
  }
  for (const estado of [
    { pendente: true, banco_id: null },
    { pendente: false, banco_id: 1 },
  ]) {
    const response = await post(
      new Request("http://teste/api/transaction", {
        method: "POST",
        body: JSON.stringify({ newTransaction: { ...base, ...estado } }),
      }),
    );
    const body = await response.json();
    assert.equal(response.status, 201, `${nome}: ${JSON.stringify(body)}`);
    assert.equal(escritas.at(-1).pendente, estado.pendente);
    assert.equal(escritas.at(-1).banco_id, estado.banco_id);
  }
}
console.log(
  "Rotas de cadastro validadas: liquidada sem banco recusada antes da escrita; pendente sem banco e liquidada com banco aceitas.",
);
