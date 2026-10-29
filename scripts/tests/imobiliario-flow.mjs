// Jornada real de API. Cria fixtures isoladas e remove somente os IDs desta execução.
// Nunca envia e-mails, emite NFS-e ou utiliza a senha do administrador existente.
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { encode } from 'next-auth/jwt';
import { createClient } from '@supabase/supabase-js';
import { connectDatabase, loadDatabaseConfigs, parseSimpleEnv } from '../db/lib.ts';
import { VERSAO_PERMISSOES_TOKEN } from '../../src/app/api/_authz/permission-constants.ts';

if (!process.argv.includes('--allow-test-fixtures')) throw new Error('Use --allow-test-fixtures para executar a jornada com limpeza automática.');
const base = new URL(process.env.IMOB_TEST_URL ?? 'http://localhost:3000');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'A jornada só pode acessar o ERP local.');
const env = parseSimpleEnv('.env.local');
const supabaseUrl = env.get('NEXT_PUBLIC_SUPABASE_URL');
assert.equal(new URL(supabaseUrl).hostname, 'hchntifztkbopchpvstd.supabase.co');
const admin = createClient(supabaseUrl, env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const { client } = await connectDatabase(loadDatabaseConfigs()[0]);
const tag = `__IMOB_TEST_${randomUUID().slice(0, 8)}`;
const cache = path.resolve('node_modules/.cache/imobiliario-flow'); fs.mkdirSync(cache, { recursive: true });
const journal = path.join(cache, `${tag}.json`);
const fixtures = { tag, users: [], owners: [], properties: [], banco: null };
const persist = () => fs.writeFileSync(journal, JSON.stringify(fixtures));
const cpf = () => { let s = String(randomInt(100000000, 999999999)); for (const k of [10, 11]) { const sum = [...s].reduce((n, d, i) => n + Number(d) * (k - i), 0); s += (sum * 10 % 11) % 10; } return s; };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
let cookie = '';
async function api(route, { method = 'GET', data, token, auth = true, form } = {}) {
  const headers = { ...(auth && cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!form && data ? { 'Content-Type': 'application/json' } : {}) };
  const response = await fetch(new URL(`/api/${route}`, base), { method, headers, body: form ?? (data ? JSON.stringify(data) : undefined), redirect: 'manual' });
  const raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = { error: `Resposta não JSON (${response.status})` }; }
  return { status: response.status, body };
}
function ok(result, status = 200) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; }
const pass = (label) => console.log(`PASS: ${label}`);
async function authUser(role, metadata = {}, confirmed = true) {
  const email = `${tag.toLowerCase()}-${role}@teste.invalid`, password = `T!${randomUUID()}Aa7`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: confirmed, user_metadata: metadata });
  if (created.error) throw created.error;
  fixtures.users.push(created.data.user.id); persist();
  return { id: created.data.user.id, email, password };
}
async function signIn(user) {
  const auth = createClient(supabaseUrl, env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await auth.auth.signInWithPassword({ email: user.email, password: user.password });
  if (result.error) throw result.error;
  return result.data.session.access_token;
}

async function cleanup() {
  // Os predicados verificam o marcador antes de remover qualquer fixture persistida.
  const ids = fixtures.properties;
  if (ids.length) {
    const check = await client.query('select id,codigo from public.imovel where id=any($1::bigint[])', [ids]);
    assert.ok(check.rows.every((r) => r.codigo.startsWith(tag)), 'Recusando limpar imóvel sem marcador desta execução.');
    const files = await admin.from('imovel_arquivo').select('bucket,path').in('imovel_id', ids);
    if (files.error) throw files.error;
    for (const bucket of new Set(files.data.map((f) => f.bucket))) { const removed = await admin.storage.from(bucket).remove(files.data.filter((f) => f.bucket === bucket).map((f) => f.path)); if (removed.error) throw removed.error; }
  }
  await client.query('begin; set local lock_timeout=\'3s\'');
  try {
    if (ids.length) {
      await client.query('alter table public.imovel_movimento disable trigger imob_movimento_proteger');
      await client.query('delete from public.imovel_movimento where imovel_id=any($1::bigint[])', [ids]);
      await client.query('alter table public.imovel_movimento enable trigger imob_movimento_proteger');
      await client.query("delete from public.eventos_financeiros where source_type='IMOVEL_TAXA' and source_id in(select id from public.transacao where imovel_id=any($1::bigint[]))", [ids]);
      await client.query('delete from public.transacao where imovel_id=any($1::bigint[])', [ids]);
      for (const table of ['imovel_ocupacao', 'imovel_arquivo', 'imovel_tarifa', 'imovel_cotacao', 'imovel_visita', 'imovel_lead', 'reserva_imovel', 'locacao_imovel', 'venda_imovel']) await client.query(`delete from public.${table} where imovel_id=any($1::bigint[])`, [ids]);
      await client.query('delete from public.imovel where id=any($1::bigint[]) and codigo like $2', [ids, `${tag}%`]);
    }
    // O cadastro do site cria o cliente antes do vínculo; inclui os ainda pendentes (user_id nulo).
    const siteClients = (await client.query('select cliente_id from public.site_usuario where user_id=any($1::uuid[]) and cliente_id is not null', [fixtures.users])).rows.map((r) => r.cliente_id);
    await client.query('delete from public.site_usuario where user_id=any($1::uuid[])', [fixtures.users]);
    await client.query('delete from public.proprietario where id=any($1::bigint[]) and nomerazaosocial like $2', [fixtures.owners, `${tag}%`]);
    await client.query('delete from public.cliente where (user_id=any($1::uuid[]) or id=any($3::int[])) and email like $2', [fixtures.users, `${tag.toLowerCase()}%`, siteClients]);
    if (fixtures.banco) await client.query('delete from public.bancoconta where id=$1 and titulo=$2', [fixtures.banco, tag]);
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; }
  for (const id of fixtures.users) { const deleted = await admin.auth.admin.deleteUser(id); if (deleted.error) throw deleted.error; }
  fs.unlinkSync(journal);
}

try {
  const operator = (await client.query('select id,email,nome,perfilid,setorid from public.usuario where ativo order by createdat limit 1')).rows[0];
  assert.ok(operator);
  const permissions = (await client.query('select p.nome from public.perfilpermissao pp join public.permissao p on p.id=pp.permissaoid where pp.perfilid=$1', [operator.perfilid])).rows.map((p) => p.nome);
  const jwt = await encode({ secret: env.get('AUTH_SECRET'), salt: 'authjs.session-token', maxAge: 1800, token: { id: operator.id, email: operator.email, nome: operator.nome, perfilId: operator.perfilid, setorId: operator.setorid, ativo: true, permissoes: permissions, permissoesVersao: VERSAO_PERMISSOES_TOKEN, permissoesRefreshedAt: Date.now() } });
  cookie = `authjs.session-token=${jwt}`;
  ok(await api('proprietarios?pageSize=1')); pass('sessão ERP validada pelo banco e APIs protegidas');
  const anon = await api('site/me', { auth: false }); assert.equal(anon.status, 401);
  const owner = ok(await api('proprietarios', { method: 'POST', data: { nomerazaosocial: `${tag} Proprietário`, tipopessoa: 'FISICA', cpfcnpj: cpf(), email: `${tag.toLowerCase()}-contato@teste.invalid`, percentual_admin: 10 } }), 201).item;
  fixtures.owners.push(owner.id); persist();
  const owner2 = ok(await api('proprietarios', { method: 'POST', data: { nomerazaosocial: `${tag} Beneficiário`, tipopessoa: 'FISICA', cpfcnpj: cpf() } }), 201).item;
  fixtures.owners.push(owner2.id); persist();
  const property = ok(await api('imoveis', { method: 'POST', data: { proprietario_id: owner.id, titulo: `${tag} Imóvel`, codigo: tag, tipo: 'FLAT', descricao: 'Imóvel temporário de teste automatizado.', modalidades: ['TEMPORADA', 'LOCACAO', 'VENDA'], endereco: { logradouro: 'ENDEREÇO PRIVADO', numero: '123' }, endereco_publico: { cidade: 'Fortaleza', bairro: 'Meireles', estado: 'CE' }, capacidade: 4, diaria: 100, taxa_limpeza: 20, valor_locacao: 1000, valor_venda: 100000, percentual_admin: 10 } }), 201).item;
  fixtures.properties.push(property.id); persist();
  const form = new FormData(); form.set('tipo', 'FOTO'); form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXWQAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'fixture.png');
  ok(await api(`imoveis/${property.id}/arquivos`, { method: 'POST', form }), 201);
  ok(await api(`imoveis/${property.id}`, { method: 'PATCH', data: { publicado: true } }));
  const published = ok(await api(`public/imoveis/${property.slug}`, { auth: false }));
  assert.equal(published.modalities.length, 3); assert.equal(published.prices.nightly, 100); assert.equal(JSON.stringify(published).includes('ENDEREÇO PRIVADO'), false);
  pass('cadastro, foto, publicação e catálogo com três modalidades sem campos privados');
  const guest = await authUser('guest', { nome: `${tag} Cliente`, cpf: cpf(), telefone: '85999990000', perfilid: operator.perfilid, tipo: 'PROPRIETARIO' }, false);
  assert.equal((await client.query('select count(*)::int n from public.usuario where id=$1', [guest.id])).rows[0].n, 0);
  const pending = (await client.query('select c.status, c.origem_cadastro, c.user_id from public.site_usuario s join public.cliente c on c.id=s.cliente_id where s.user_id=$1', [guest.id])).rows[0];
  assert.deepEqual(pending, { status: 'PENDENTE', origem_cadastro: 'SITE', user_id: null }, 'cadastro do site aparece como cliente pendente antes da confirmação');
  const confirmed = await admin.auth.admin.updateUserById(guest.id, { email_confirm: true }); if (confirmed.error) throw confirmed.error;
  const token = await signIn(guest);
  const me = ok(await api('site/me/sync', { method: 'POST', token, auth: false })); assert.equal(me.role, 'guest');
  ok(await api('site/me/sync', { method: 'POST', token, auth: false }));
  assert.equal((await client.query('select count(*)::int n from public.cliente where user_id=$1', [guest.id])).rows[0].n, 1);
  assert.equal((await api('site/proprietario/dashboard', { token, auth: false })).status, 403);
  pass('confirmação e sincronização idempotente criam cliente, ignorando perfil/tipo forjados');
  const outsider = await authUser('other-guest', { nome: `${tag} Outro cliente`, cpf: cpf(), telefone: '85999990001' });
  const outsiderToken = await signIn(outsider);
  ok(await api('site/me/sync', { method: 'POST', token: outsiderToken, auth: false }));
  const ownerLogin = await authUser('owner');
  await client.query('update public.proprietario set user_id=$1 where id=$2', [ownerLogin.id, owner.id]);
  await client.query("insert into public.site_usuario(user_id,tipo,email,proprietario_id,created_by) values($1,'PROPRIETARIO',$2,$3,$4)", [ownerLogin.id, ownerLogin.email, owner.id, operator.id]);
  const ownerToken = await signIn(ownerLogin); assert.equal(ok(await api('site/me', { token: ownerToken, auth: false })).role, 'owner');
  assert.equal((await api('site/reservas', { method: 'POST', token: ownerToken, data: {}, auth: false })).status, 403);
  const start = day(90), end = day(93);
  const quote = ok(await api(`public/imoveis/${property.id}/quote?checkin=${start}&checkout=${end}&guests=2`, { auth: false })); assert.equal(quote.total, 320);
  const booking = { flatId: String(property.id), checkin: start, checkout: end, guests: 2, acceptedTerms: true, quoteId: quote.quoteId, expectedTotal: quote.total, idempotencyKey: randomUUID() };
  const competing = { ...booking, idempotencyKey: randomUUID() };
  const concurrent = await Promise.all([api('site/reservas', { method: 'POST', token, auth: false, data: booking }), api('site/reservas', { method: 'POST', token, auth: false, data: competing })]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
  const created = concurrent.find((r) => r.status === 201).body;
  const successfulPayload = concurrent[0].status === 201 ? booking : competing;
  assert.equal(ok(await api('site/reservas', { method: 'POST', token, auth: false, data: successfulPayload }), 201).id, created.id);
  assert.equal(created.status, 'CONFIRMED'); assert.equal(created.paymentStatus, 'PENDING');
  assert.equal((await client.query('select count(*)::int n from public.transacao where reserva_imovel_id=$1 and baixa_de_transacao_id is null', [created.id])).rows[0].n, 1);
  pass('duas solicitações simultâneas confirmam uma reserva; repetição não duplica cobrança');
  const nextQuote = ok(await api(`public/imoveis/${property.id}/quote?checkin=${end}&checkout=${day(95)}&guests=1`, { auth: false })); assert.equal(nextQuote.available, true);
  const customer = (await client.query('select id from public.cliente where user_id=$1', [guest.id])).rows[0].id;
  const tabs = ok(await api(`clientes/${customer}/reservas`)); assert.equal(tabs.items[0].id, Number(created.id));
  assert.equal(ok(await api('site/me/reservas', { token, auth: false })).items.length, 1);
  assert.equal(ok(await api('site/me/reservas', { token: outsiderToken, auth: false })).items.length, 0);
  const anonymousDb = createClient(supabaseUrl, env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const forbidden = await anonymousDb.from('cliente').update({ saldo_credito: 999 }).eq('id', customer); assert.ok(forbidden.error);
  const hidden = await anonymousDb.from('reserva_imovel').select('id'); assert.ok(hidden.error || hidden.data.length === 0);
  pass('períodos consecutivos, aba do cliente e bloqueio de escrita/acesso direto no Supabase');
  fixtures.banco = (await client.query('insert into public.bancoconta(titulo,created_at,updated_at,valorinicial) values($1,now(),now(),0) returning id', [tag])).rows[0].id; persist();
  const report = ok(await api(`imobiliario/financeiro?reserva_id=${created.id}`));
  ok(await api(`imobiliario/cobrancas/${report.cobrancas[0].id}/baixar`, { method: 'POST', data: { valor: 320, banco_id: fixtures.banco, metodo_pagamento: 'PIX', data: day(0) } }));
  const paid = ok(await api(`imobiliario/financeiro?proprietario_id=${owner.id}`)); assert.equal(paid.totais.recebido, 320); assert.equal(paid.totais.receita_administradora, 32); assert.equal(paid.totais.saldo_repassar, 288);
  ok(await api('imobiliario/financeiro', { method: 'POST', data: { tipo: 'DESPESA', imovel_id: property.id, proprietario_id: owner.id, valor: 20, banco_id: fixtures.banco, metodo_pagamento: 'PIX', data: day(0), descricao: 'Despesa de teste', idempotency_key: randomUUID() } }), 201);
  ok(await api('imobiliario/financeiro', { method: 'POST', data: { tipo: 'REPASSE', imovel_id: property.id, proprietario_id: owner.id, valor: 100, banco_id: fixtures.banco, metodo_pagamento: 'PIX', data: day(0), descricao: 'Repasse de teste', idempotency_key: randomUUID() } }), 201);
  const statement = ok(await api('site/proprietario/extratos', { token: ownerToken, auth: false })); assert.equal(statement.totais.saldo_repassar, 168);
  pass('baixa manual, taxa administrativa, despesa e repasse refletem no extrato do proprietário');
  ok(await api(`reservas/${created.id}/acoes`, { method: 'POST', data: { acao: 'CHECKIN' } }));
  ok(await api(`reservas/${created.id}/acoes`, { method: 'POST', data: { acao: 'CHECKOUT' } }));
  const contract = ok(await api('locacoes-imobiliarias', { method: 'POST', data: { imovel_id: property.id, cliente_id: customer, inicio: day(150), fim: day(210), valor_mensal: 1000, dia_vencimento: 5, percentual_admin: 10, idempotency_key: randomUUID() } }), 201).item;
  ok(await api(`locacoes-imobiliarias/${contract.id}/acoes`, { method: 'POST', data: { acao: 'GERAR_COBRANCAS' } }));
  const billCount = (await client.query('select count(*)::int n from public.transacao where locacao_imovel_id=$1 and baixa_de_transacao_id is null', [contract.id])).rows[0].n;
  ok(await api(`locacoes-imobiliarias/${contract.id}/acoes`, { method: 'POST', data: { acao: 'GERAR_COBRANCAS' } }));
  assert.equal((await client.query('select count(*)::int n from public.transacao where locacao_imovel_id=$1 and baixa_de_transacao_id is null', [contract.id])).rows[0].n, billCount);
  pass('check-in/check-out e geração de cobrança de locação idempotente');
  const cancellable = ok(await api('site/reservas', { method: 'POST', token, auth: false, data: { flatId: property.id, checkin: end, checkout: day(95), guests: 1, acceptedTerms: true, quoteId: nextQuote.quoteId, expectedTotal: nextQuote.total, idempotencyKey: randomUUID() } }), 201);
  ok(await api(`reservas/${cancellable.id}/acoes`, { method: 'POST', data: { acao: 'CANCELAR', motivo: 'Cancelamento manual de teste', tratamento_pendentes: 'CANCELAR_PENDENTES', tratamento_recebidos: 'MANTER' } }));
  assert.equal(ok(await api(`public/imoveis/${property.id}/quote?checkin=${end}&checkout=${day(95)}&guests=1`, { auth: false })).available, true);
  pass('cancelamento manual libera ocupação e trata cobranças pendentes');
  if (process.argv.includes('--browser-fixtures')) {
    fs.writeFileSync(path.join(cache, 'browser.json'), JSON.stringify({ guest, owner: ownerLogin, slug: property.slug, imovelId: property.id, anotherOwnerId: owner2.id, checkin: day(110), checkout: day(113), erpCookie: jwt }));
    console.log('Fixtures para browser prontas; aguardando arquivo browser.done (máximo 10 minutos).');
    const deadline = Date.now() + 600000;
    while (!fs.existsSync(path.join(cache, 'browser.done')) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.ok(fs.existsSync(path.join(cache, 'browser.done')), 'Browser não concluiu antes do limite.');
    fs.rmSync(path.join(cache, 'browser.json'), { force: true }); fs.rmSync(path.join(cache, 'browser.done'), { force: true });
  }
  const sale = ok(await api('vendas-imobiliarias', { method: 'POST', data: { imovel_id: property.id, comprador_id: customer, data_venda: day(100), valor_total: 100000, comissao_percentual: 5, idempotency_key: randomUUID(), parcelas: [{ valor: 50000, vencimento: day(100) }, { valor: 50000, vencimento: day(130) }] } }), 201).item;
  assert.equal((await api(`vendas-imobiliarias/${sale.id}/acoes`, { method: 'POST', data: { acao: 'CONCLUIR', operacoes: [] } })).status, 409);
  const active = ok(await api(`vendas-imobiliarias/${sale.id}`)).relacionamentos.operacoes;
  ok(await api(`vendas-imobiliarias/${sale.id}/acoes`, { method: 'POST', data: { acao: 'CONCLUIR', novo_proprietario_id: owner2.id, operacoes: active.map((op) => ({ tipo: op.tipo, id: op.id, decisao: 'MANTER', beneficiario_proprietario_id: owner2.id, vigencia_inicio: day(100) })) } }));
  const sold = ok(await api(`imoveis/${property.id}`)).item; assert.equal(sold.situacao_comercial, 'VENDIDO');
  assert.equal(sold.modalidades.includes('VENDA'), false);
  assert.equal((await client.query("select count(*)::int n from public.transacao where venda_imovel_id=$1 and imovel_natureza='RECEBIMENTO'", [sale.id])).rows[0].n, 2);
  assert.equal(ok(await api('site/proprietario/extratos', { token: ownerToken, auth: false })).totais.recebido, 320);
  pass('venda exige decisões, parcela recebíveis e preserva os repasses anteriores');
} finally {
  try { await cleanup(); pass('fixtures removidas, usuário e cadastros existentes preservados'); }
  finally { await client.end(); }
}
