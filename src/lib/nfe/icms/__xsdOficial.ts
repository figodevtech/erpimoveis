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
    if (hash !== sha256) throw new Error(`XSD alterado em relação ao manifesto: ${pacote}/${nome}`);
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
