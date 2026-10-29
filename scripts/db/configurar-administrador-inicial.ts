import { pathToFileURL } from "node:url";
import type { Client } from "pg";
import { PERMS, TIPO_PERMISSIONS } from "../../src/app/api/_authz/permission-constants";
import { connectDatabase, loadDatabaseConfigs } from "./lib";

/** Dentro da transação do chamador; nunca altera senha, Auth ou is_root. */
export async function configurarAdministradorInicial(client: Client, email: string) {
  await client.query("select pg_advisory_xact_lock(87099, 2)");
  // Impede a criação concorrente de outro usuário durante o bootstrap.
  await client.query("lock table auth.users, public.usuario in share row exclusive mode");
  const users = (await client.query<{ id: string; email: string }>(
    "select id, email from auth.users order by created_at",
  )).rows;
  if (users.length !== 1 || users[0].email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error("O bootstrap exige um único usuário no Auth, com o e-mail informado.");
  }
  const user = users[0];
  const appUsers = (await client.query<{ id: string; ativo: boolean; email: string }>(
    "select id, ativo, email from public.usuario",
  )).rows;
  if (appUsers.length !== 1 || appUsers[0].id !== user.id || !appUsers[0].ativo
      || appUsers[0].email.toLowerCase() !== email.toLowerCase()) {
    throw new Error("O único usuário deve existir e estar ativo no ERP, com o mesmo ID e e-mail do Auth.");
  }

  const expected = [...new Set([...Object.values(PERMS), ...TIPO_PERMISSIONS])];
  const permissions = (await client.query<{ id: number; nome: string }>(
    "select id, nome from public.permissao",
  )).rows;
  const missing = expected.filter((nome) => !permissions.some((p) => p.nome === nome));
  if (missing.length) throw new Error(`Permissões ausentes no banco: ${missing.join(", ")}`);
  // Também recusa um catálogo ainda não ajustado, sem conceder acessos legados.
  if (permissions.some((p) => !expected.includes(p.nome as typeof expected[number]))) {
    throw new Error("O catálogo contém permissões fora do código atual. Revise e aplique a migration de adaptação.");
  }

  const profiles = (await client.query<{ id: number }>(
    "select id from public.perfil where lower(btrim(nome)) = 'administrador' for update",
  )).rows;
  if (profiles.length > 1) throw new Error("Existe mais de um perfil Administrador.");
  const profileId = profiles[0]?.id ?? (await client.query<{ id: number }>(
    `insert into public.perfil(nome, descricao, created_by, updated_by)
     values ('Administrador', 'Acesso a todos os módulos atuais do ERP Imóveis', $1, $1)
     returning id`, [user.id],
  )).rows[0].id;

  await client.query(
    `insert into public.perfilpermissao(perfilid, permissaoid, created_by, updated_by)
     select $1, id, $2, $2 from public.permissao
     on conflict (perfilid, permissaoid) do nothing`, [profileId, user.id],
  );
  await client.query(
    `update public.usuario set perfilid = $1, updated_by = $2, updatedat = now()
     where id = $2 and perfilid is distinct from $1`, [profileId, user.id],
  );
  const result = (await client.query<{ total: number; linked: number }>(
    `select (select count(*)::int from public.permissao) total,
            (select count(*)::int from public.perfilpermissao where perfilid = $1) linked`,
    [profileId],
  )).rows[0];
  if (result.total !== expected.length || result.linked !== expected.length) {
    throw new Error("A conferência encontrou divergência nas permissões do administrador.");
  }
  return { email: user.email, perfilId: profileId, permissoes: result.linked };
}

async function main() {
  const args = process.argv.slice(2);
  const emailIndex = args.indexOf("--email");
  const email = emailIndex >= 0 ? args[emailIndex + 1]?.trim() : "";
  if (!email || !email.includes("@")) throw new Error("Informe --email com o e-mail do único usuário.");
  const apply = args.includes("--aplicar");
  const database = loadDatabaseConfigs()[0];
  const { client } = await connectDatabase(database);
  try {
    await client.query("begin; set local lock_timeout = '3s'; set local statement_timeout = '30s'");
    const result = await configurarAdministradorInicial(client, email);
    await client.query(apply ? "commit" : "rollback");
    console.log(JSON.stringify({ banco: database.label, modo: apply ? "aplicado" : "simulação revertida", ...result }));
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Falha ao configurar administrador.");
    process.exitCode = 1;
  });
}
