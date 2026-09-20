// Validação de XML da NF-e contra o XSD oficial, só para testes.
//
// Os schemas ficam versionados em schemas/nfe/<pacote>, baixados do Portal da
// NF-e, com o SHA-256 de cada arquivo em manifest.json. Nada é baixado em
// runtime: se um XSD for alterado, a validação recusa antes de rodar.
//
// O validador é o libxml2 compilado para WebAssembly (xmllint-wasm), que roda
// no Node puro — no CI (`npm ci`) e no prebuild da Vercel, sem Python nem
// binário nativo.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { validateXML } from 'xmllint-wasm';

/** Pacote em "versões oficiais (em uso)" no Portal da NF-e (publicado em 31/08/2026). */
export const PACOTE_XSD_VIGENTE = 'PL_010f_NT2025_002_v1.50';

const RAIZ_SCHEMAS = path.resolve(process.cwd(), 'schemas', 'nfe');

type Manifesto = { pacote: string; url: string; arquivos: Record<string, string> };

export function lerPacoteXsd(pacote = PACOTE_XSD_VIGENTE) {
  const pasta = path.join(RAIZ_SCHEMAS, pacote);
  const manifesto = JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8')) as Manifesto;
  const arquivos = Object.entries(manifesto.arquivos).map(([nome, sha256]) => {
    const conteudo = fs.readFileSync(path.join(pasta, nome));
    const hash = createHash('sha256').update(conteudo).digest('hex');
    // Git pode materializar o mesmo XML com CRLF no Windows. O manifesto usa
    // os bytes oficiais em LF; aceitamos somente essa normalização semântica e
    // continuamos recusando qualquer alteração real no schema.
    const conteudoLf = Buffer.from(conteudo.toString('utf8').replace(/\r\n/g, '\n'));
    const hashLf = createHash('sha256').update(conteudoLf).digest('hex');
    if (hash !== sha256 && hashLf !== sha256) {
      throw new Error(`XSD alterado em relação ao manifesto: ${pacote}/${nome}`);
    }
    return { fileName: nome, contents: conteudo.toString('utf8') };
  });
  return { manifesto, arquivos };
}

export async function validarNFeContraXsd(xml: string, pacote = PACOTE_XSD_VIGENTE) {
  const { arquivos } = lerPacoteXsd(pacote);
  const principal = arquivos.find((arquivo) => arquivo.fileName === 'nfe_v4.00.xsd');
  if (!principal) throw new Error(`Pacote ${pacote} sem nfe_v4.00.xsd.`);
  const resultado = await validateXML({
    xml: { fileName: 'nfe.xml', contents: xml },
    schema: principal,
    preload: arquivos.filter((arquivo) => arquivo !== principal),
  });
  return { valido: resultado.valid, erros: resultado.errors.map((erro) => erro.message) };
}

/**
 * Completa uma prévia com assinatura estruturalmente válida para o XSD.
 * Uso exclusivo em testes: não prova criptografia e nunca autoriza uma NF-e.
 */
export function comAssinaturaXsdTeste(xml: string) {
  const id = /Id="([^"]+)"/.exec(xml)?.[1];
  if (!id) throw new Error('Prévia sem Id da NF-e para a assinatura de teste.');
  const assinatura =
    '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>' +
    '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
    '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>' +
    `<Reference URI="#${id}"><Transforms>` +
    '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
    '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>' +
    '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAAAAAAAAAAAAAAAAAAAAAAAAA=</DigestValue>' +
    '</Reference></SignedInfo><SignatureValue>AAAA</SignatureValue><KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>';
  return xml.replace('</NFe>', `${assinatura}</NFe>`);
}

/**
 * Elementos de um grupo do leiauteNFe, na ordem do XSD, lidos do próprio
 * schema — e não do modelo interno do ERP.
 */
export function elementosDoGrupoNoXsd(grupo: string, pacote = PACOTE_XSD_VIGENTE): string[] {
  const { arquivos } = lerPacoteXsd(pacote);
  const leiaute = arquivos.find((arquivo) => arquivo.fileName === 'leiauteNFe_v4.00.xsd')!.contents
    .replace(/<xs:annotation>[\s\S]*?<\/xs:annotation>/g, '')
    .replace(/<xs:simpleType>[\s\S]*?<\/xs:simpleType>/g, '');
  const inicio = leiaute.indexOf(`<xs:element name="${grupo}"`);
  if (inicio < 0) throw new Error(`Grupo ${grupo} não encontrado no XSD.`);
  const tags = /<(\/?)xs:element([^>]*?)(\/?)>/g;
  tags.lastIndex = inicio;
  const nomes: string[] = [];
  let profundidade = 0;
  let tag: RegExpExecArray | null;
  while ((tag = tags.exec(leiaute))) {
    const [, fecha, atributos, vazia] = tag;
    if (fecha) {
      profundidade -= 1;
      if (profundidade === 0) break;
      continue;
    }
    const nome = /name="([^"]+)"/.exec(atributos)?.[1];
    if (profundidade > 0 && nome) nomes.push(nome);
    if (!vazia) profundidade += 1;
  }
  return nomes;
}
