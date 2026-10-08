import { connectDatabase, loadDatabaseConfigs, type DatabaseConfig } from "./lib";

export async function createAdministrator(database: DatabaseConfig, apply: boolean) {
  if (database.key === "demo") throw new Error("Use um banco de cliente como destino.");
  const source = loadDatabaseConfigs().find((item) => item.key === "demo")!;
  if (database.projectRef === source.projectRef) throw new Error("Origem e destino iguais.");
  const origin = await connectDatabase(source);
  let permissions: { id: number; nome: string; descricao: string | null }[];
  try {
    permissions = (await origin.client.query("select id,nome,descricao from public.permissao order by id")).rows;
    if (!permissions.length) throw new Error("Catalogo de permissoes da origem esta vazio.");
  } finally { await origin.client.end(); }
  const { client } = await connectDatabase(database);
  try {
    if (!apply) {
      const current = (await client.query("select nome from public.permissao")).rows;
      const total = new Set([...current.map((row) => row.nome), ...permissions.map((row) => row.nome)]).size;
      console.log(`${database.label}: conferiria/criaria o perfil Administrador e vincularia ${total} permissoes. Use --aplicar.`);
      return;
    }
    await client.query("BEGIN");
    await client.query("select pg_advisory_xact_lock(87099,1)");
    const count = (await client.query("select count(*)::int total from public.permissao")).rows[0].total;
    if (count === 0) {
      await client.query(`insert into public.permissao(id,nome,descricao) overriding system value
        select id,nome,descricao from jsonb_to_recordset($1::jsonb) p(id integer,nome text,descricao text)`, [JSON.stringify(permissions)]);
      await client.query("select setval(pg_get_serial_sequence('public.permissao','id'),(select max(id) from public.permissao),true)");
    } else {
      await client.query(`insert into public.permissao(nome,descricao)
        select p.nome,p.descricao from jsonb_to_recordset($1::jsonb) p(nome text,descricao text)
        where not exists(select 1 from public.permissao existing where existing.nome=p.nome)`, [JSON.stringify(permissions)]);
    }
    const profiles = (await client.query("select id from public.perfil where lower(btrim(nome))='administrador' order by id for update")).rows;
    if (profiles.length > 1) throw new Error("Existe mais de um perfil Administrador. Resolva a duplicidade antes.");
    const profileId = profiles[0]?.id ?? (await client.query("insert into public.perfil(nome,descricao) values('Administrador','Acesso a todas as permissoes do sistema') returning id")).rows[0].id;
    await client.query(`insert into public.perfilpermissao(perfilid,permissaoid)
      select $1,id from public.permissao on conflict(perfilid,permissaoid) do nothing`, [profileId]);
    const verification = (await client.query(`select
      (select count(*)::int from public.permissao) total,
      (select count(*)::int from public.perfilpermissao where perfilid=$1) linked,
      (select count(*)::int from public.permissao p where not exists(select 1 from public.perfilpermissao pp where pp.perfilid=$1 and pp.permissaoid=p.id)) missing`, [profileId])).rows[0];
    if (verification.missing || verification.total !== verification.linked) throw new Error("Validacao do perfil encontrou permissoes ausentes.");
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(`${database.label}: ${apply ? "perfil Administrador conferido/criado" : "criaria/conferiria o perfil Administrador"}, ${verification.total} permissoes, nenhuma faltando.`);
    if (!apply) console.log("Simulacao revertida. Use --aplicar para gravar.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await client.end(); }
}
