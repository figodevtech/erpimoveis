import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import axios from 'axios';
import forge from 'node-forge';
import { XMLParser } from 'fast-xml-parser';

// Servidores somente no loopback; dados, certificados e senhas sinteticos.
const server = http.createServer(async (req, res) => {
  if (req.url === '/slow') return; // Cancelado pelo cliente; sem timer pendente.
  if (req.url === '/error') { res.writeHead(422, { 'content-type': 'application/json' }); return res.end('{"error":"INVALIDO"}'); }
  let body = ''; for await (const chunk of req) body += chunk;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ method: req.method, url: req.url, body, type: req.headers['content-type'] }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const query = await axios.get(`${base}/query`, { params: { search: 'ação & teste' }, proxy: false });
  assert.equal(new URL(query.data.url, base).searchParams.get('search'), 'ação & teste');
  const json = await axios.post(`${base}/json`, { total: 12.34, codigo: '001' }, { proxy: false });
  assert.deepEqual(JSON.parse(json.data.body), { total: 12.34, codigo: '001' });
  console.log('PASS: Axios preserva parametros, JSON e zeros iniciais');
  await assert.rejects(axios.get(`${base}/error`, { proxy: false }), (e) => axios.isAxiosError(e) && e.response.status === 422 && e.response.data.error === 'INVALIDO');
  const controller = new AbortController();
  const request = axios.get(`${base}/slow`, { signal: controller.signal, proxy: false });
  controller.abort();
  await assert.rejects(request, (e) => axios.isCancel(e));
  await assert.rejects(axios.get(`${base}/slow`, { timeout: 50, proxy: false }), (e) => axios.isAxiosError(e) && e.code === 'ECONNABORTED');
  console.log('PASS: Axios preserva erro HTTP, cancelamento e timeout');
  const form = new FormData(); form.append('file', new Blob(['conteudo sintetico'], { type: 'text/plain' }), 'teste.txt');
  const upload = await axios.post(`${base}/upload`, form, { proxy: false });
  assert.match(upload.data.type, /^multipart\/form-data; boundary=/);
  assert.match(upload.data.body, /filename="teste.txt"/);
  assert.match(upload.data.body, /conteudo sintetico/);
  console.log('PASS: upload multipart entrega arquivo e conteudo');
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }

const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = forge.pki.privateKeyFromPem(pair.privateKey);
const cert = forge.pki.createCertificate(); cert.publicKey = forge.pki.publicKeyFromPem(pair.publicKey);
cert.serialNumber = '02'; cert.validity.notBefore = new Date('2026-01-01'); cert.validity.notAfter = new Date('2030-01-01');
cert.setSubject([{ name: 'commonName', value: 'localhost' }]); cert.setIssuer(cert.subject.attributes);
cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
cert.sign(key, forge.md.sha256.create());
const certPem = forge.pki.certificateToPem(cert);
const password = 'senha-sintetica';
const pfx = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: '3des' })).getBytes(), 'binary');
const tls = https.createServer({ key: pair.privateKey, cert: certPem, ca: certPem, requestCert: true, rejectUnauthorized: true }, async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk;
  if (!req.socket.authorized || !body.includes('consStatServ')) { res.writeHead(400); return res.end(); }
  res.setHeader('content-type', 'application/soap+xml');
  res.end('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><retConsStatServ><cStat>107</cStat><xMotivo>Teste local</xMotivo></retConsStatServ></soap:Body></soap:Envelope>');
});
tls.listen(0, '127.0.0.1'); await once(tls, 'listening');
const agent = new https.Agent({ pfx, passphrase: password, ca: certPem, rejectUnauthorized: true });
try {
  const response = await axios.post(`https://127.0.0.1:${tls.address().port}`, '<consStatServ>teste sintetico</consStatServ>', {
    httpsAgent: agent, proxy: false, timeout: 5000, headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
  });
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(response.data);
  assert.equal(parsed['soap:Envelope']['soap:Body'].retConsStatServ.cStat, 107);
  console.log('PASS: Axios com PFX e TLS mutuo recebe SOAP legivel pelo XMLParser');
} finally { agent.destroy(); tls.closeAllConnections(); await new Promise((resolve) => tls.close(resolve)); }

const parsed = new XMLParser({ ignoreAttributes: false, numberParseOptions: { hex: true, leadingZeros: false } }).parse('<NFe xmlns="urn:teste"><CNPJ>07965809004275</CNPJ><total>12.34</total><det nItem="1"/><det nItem="2"/></NFe>');
assert.equal(parsed.NFe.CNPJ, '07965809004275'); assert.equal(parsed.NFe.total, 12.34);
assert.equal(parsed.NFe.det.length, 2); assert.equal(parsed.NFe.det[0]['@_nItem'], '1');
console.log('PASS: XMLParser preserva CNPJ, decimais, atributos, namespace e itens repetidos');
