import assert from 'node:assert/strict';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

// Exerce a biblioteca instalada sem banco, senhas reais ou rede.
const secret = 'segredo-sintetico-exclusivo-deste-teste-auth';
const origin = 'http://localhost:3001';
const cookies = new Map();
const app = NextAuth({
  secret, trustHost: true, session: { strategy: 'jwt', maxAge: 3600 },
  providers: [Credentials({ authorize: async (c) => c.identifier === 'sintetico' && c.password === 'senha-teste'
    ? { id: 'synthetic-user', name: 'Teste', permissoes: ['clientes.visualizar'] } : null })],
  callbacks: {
    jwt({ token, user }) { if (user) { token.id = user.id; token.permissoes = user.permissoes; } return token; },
    session({ session, token }) { session.user.id = token.id; session.user.permissoes = token.permissoes; return session; },
  },
  logger: { error() {}, warn() {}, debug() {} },
});
async function request(path, data, jar = cookies) {
  const req = new NextRequest(`${origin}/api/auth/${path}`, {
    method: data ? 'POST' : 'GET',
    headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(data ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(data ? { body: new URLSearchParams(data) } : {}),
  });
  const res = await app.handlers[data ? 'POST' : 'GET'](req);
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(header)) jar.delete(name); else jar.set(name, value);
  }
  return res;
}
const csrf = async () => (await (await request('csrf')).json()).csrfToken;
assert.equal(await (await request('session')).json(), null);
console.log('PASS: sessao ausente nao produz usuario');
let response = await request('callback/credentials', { identifier: 'sintetico', password: 'incorreta', csrfToken: await csrf() });
assert.match(response.headers.get('location') ?? '', /CredentialsSignin/);
assert.equal(await (await request('session')).json(), null);
console.log('PASS: senha incorreta nao cria sessao');
response = await request('callback/credentials', { identifier: 'sintetico', password: 'senha-teste', csrfToken: await csrf() });
assert.equal(response.status, 302);
let session = await (await request('session')).json();
assert.equal(session.user.id, 'synthetic-user');
assert.deepEqual(session.user.permissoes, ['clientes.visualizar']);
assert.equal(session.user.permissoes.includes('fiscal.emitir'), false);
console.log('PASS: login Credentials preserva id e permissoes no JWT/sessao');
const cookieName = 'authjs.session-token';
const badJar = new Map(cookies); badJar.set(cookieName, 'token-invalido');
assert.equal(await (await request('session', null, badJar)).json(), null);
const expiredJar = new Map(cookies);
expiredJar.set(cookieName, await encode({ secret, salt: cookieName, token: { sub: 'synthetic-user' }, maxAge: -120 }));
assert.equal(await (await request('session', null, expiredJar)).json(), null);
console.log('PASS: tokens adulterados e expirados nao autenticam');
response = await request('signout', { csrfToken: await csrf() });
assert.equal(response.status, 302);
assert.equal(await (await request('session')).json(), null);
console.log('PASS: logout encerra sessao');

const broken = NextAuth({ secret, trustHost: true, providers: [],
  session: { strategy: 'database' }, logger: { error() {}, warn() {}, debug() {} } });
const guarded = broken.auth((req) => Response.json({ authorized: Boolean(req.auth?.user?.id) }));
const failure = await guarded(new NextRequest(`${origin}/area-protegida`), {});
assert.deepEqual(await failure.json(), { authorized: false });
console.log('PASS: erro de configuracao nao fornece usuario ao guard de acesso');
