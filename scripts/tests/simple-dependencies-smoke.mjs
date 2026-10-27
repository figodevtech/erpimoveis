import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { chromium } from '@playwright/test';
import { assinarNFeXml } from '../../src/lib/nfe/assinatura.ts';
import { assinarEventoNFeXml, assinarInutilizacaoXml } from '../../src/lib/nfe/assinaturaEvento.ts';
import { TAGS_TEXTO_RICO } from '../../src/lib/texto-rico.ts';

// Somente material sintetico em memoria: nenhum certificado ou dado do ERP.
const require = createRequire(import.meta.url);
const keys = generateKeyPairSync('rsa', { modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const privateKey = forge.pki.privateKeyFromPem(keys.privateKey);
const cert = forge.pki.createCertificate();
cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
cert.serialNumber = '01';
cert.validity.notBefore = new Date('2026-01-01');
cert.validity.notAfter = new Date('2030-01-01');
cert.setSubject([{ name: 'commonName', value: 'Teste sintetico offline' }]);
cert.setIssuer(cert.subject.attributes);
cert.sign(privateKey, forge.md.sha256.create());
const password = 'senha-sintetica-de-teste';
const pfx = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], password, { algorithm: '3des' });
const der = forge.asn1.toDer(pfx).getBytes();
const parsed = forge.asn1.fromDer(der);
assert.throws(() => forge.pkcs12.pkcs12FromAsn1(parsed, 'incorreta'));
const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), password);
const key = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
const extractedCert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag][0].cert;
const keyPem = forge.pki.privateKeyToPem(key);
const certPem = forge.pki.certificateToPem(extractedCert);
assert.equal(key.n.toString(), extractedCert.publicKey.n.toString());
console.log('PASS: PFX sintetico aceita senha correta, rejeita incorreta e preserva chave/certificado');

const ns = 'http://www.portalfiscal.inf.br/nfe';
const cases = [
  [assinarNFeXml, `<NFe xmlns="${ns}"><infNFe Id="NFe123"><ide><nNF>1</nNF></ide></infNFe></NFe>`],
  [assinarEventoNFeXml, `<envEvento xmlns="${ns}"><evento><infEvento Id="ID123"><xJust>Teste sintetico</xJust></infEvento></evento></envEvento>`],
  [assinarInutilizacaoXml, `<inutNFe xmlns="${ns}"><infInut Id="ID456"><xJust>Teste sintetico</xJust></infInut></inutNFe>`],
];
for (const [sign, xml] of cases) {
  const signed = sign(xml, keyPem, certPem);
  const doc = new DOMParser().parseFromString(signed, 'text/xml');
  const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  assert.ok(signature);
  const verifier = new SignedXml({ publicCert: certPem, getCertFromKeyInfo: () => null });
  verifier.loadSignature(signature);
  assert.equal(verifier.checkSignature(signed), true);
  assert.equal(verifier.checkSignature(signed.replace(/Teste sintetico|<nNF>1<\/nNF>/, 'conteudo alterado')), false);
  console.log(`PASS: ${sign.name} gera assinatura verificavel e detecta adulteracao`);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ path: require.resolve('dompurify/dist/purify.min.js') });
  const result = await page.evaluate((tags) => {
    const html = '<p><strong>Teste</strong></p><ul><li>Item</li></ul><img src=x onerror="alert(1)"><script>alert(1)</script>';
    const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: tags, ALLOWED_ATTR: [] });
    const doc = DOMPurify.sanitize('<html><head><style>td{color:red}</style></head><body><table><tr><td>Teste</td></tr></table><img src="data:image/png;base64,AA==" onerror="alert(1)"><script>alert(1)</script></body></html>', {
      WHOLE_DOCUMENT: true, ADD_TAGS: ['style', 'title'],
      FORBID_TAGS: ['script', 'iframe', 'frame', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'base', 'link', 'meta'],
      FORBID_ATTR: ['srcset', 'formaction', 'action'], ALLOW_DATA_ATTR: true,
    });
    return { clean, doc };
  }, [...TAGS_TEXTO_RICO]);
  assert.match(result.clean, /<strong>Teste<\/strong>/);
  assert.match(result.clean, /<li>Item<\/li>/);
  assert.doesNotMatch(result.clean, /script|onerror|<img/);
  assert.match(result.doc, /<style>td\{color:red\}<\/style>/);
  assert.match(result.doc, /<td>Teste<\/td>/);
  assert.doesNotMatch(result.doc, /<script|onerror/);
  console.log('PASS: DOMPurify preserva formatacao/documento e remove scripts e eventos');
} finally { await browser.close(); }
