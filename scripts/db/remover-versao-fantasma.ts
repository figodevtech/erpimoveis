/**
 * Remove um registro de migration que ficou no historico sem arquivo local.
 *
 * Uso: npm run db:remover-fantasma -- <banco> <versao>
 *
 * Existe por um acidente concreto: um arquivo aplicado e depois renomeado deixa
 * a versao antiga registrada. O CLI passa a tratar aquele numero como resolvido
 * e pula em silencio qualquer migration nova que use a mesma versao — foi assim
 * que uma funcao passou a existir apontando para uma tabela que nunca foi criada
 * (ver 20260803180000).
 *
 * So apaga a linha do historico. Nao desfaz nada do que a migration fez.
 */
import { connectDatabase, loadDatabaseConfigs, readLocalMigrations, type DatabaseKey } from "./lib";

async function main() {
  const [bancoArg, versao] = process.argv.slice(2);
  if (!bancoArg || !versao) throw new Error("Uso: -- <banco> <versao>");

  const configuracao = loadDatabaseConfigs().find((b) => b.key === (bancoArg as DatabaseKey));
  if (!configuracao) throw new Error(`Banco invalido: ${bancoArg}`);

  // Recusa apagar a versao de um arquivo que existe: seria perder o registro de
  // algo que continua fazendo parte do projeto.
  if (readLocalMigrations().some((m) => m.version === versao)) {
    throw new Error(`A versao ${versao} tem arquivo local. Nao e um registro fantasma.`);
  }

  const { client } = await connectDatabase(configuracao);
  try {
    const { rowCount } = await client.query(
      "delete from supabase_migrations.schema_migrations where version = $1",
      [versao],
    );
    console.log(
      rowCount
        ? `Removido: ${versao} de ${configuracao.label}.`
        : `Nada a remover: ${versao} nao consta em ${configuracao.label}.`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
