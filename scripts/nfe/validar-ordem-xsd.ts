/**
 * Confere a ordem e a presença dos elementos de um XML de NF-e contra o XSD.
 *
 * NÃO substitui validação XSD completa (não checa tipos, faixas nem padrões).
 * Cobre o que provocou as rejeições 225 desta base: elemento fora da posição da
 * `xs:sequence` e filho obrigatório ausente.
 *
 * LIMITAÇÃO CONHECIDA — falsos positivos por colisão de nome. O casamento é pelo
 * nome do elemento, sem considerar o caminho até ele. Nomes que se repetem com
 * definições diferentes (`gIBSUF` aparece no item e no total, com filhos
 * distintos) são cobrados pela definição errada. Trate a saída como triagem:
 * confira cada apontamento contra o XSD antes de agir.
 *
 *   npx tsx scripts/nfe/validar-ordem-xsd.ts <arquivo.xml> [pasta-dos-xsd]
 *
 * Os XSD ficam fora do repositório. Baixe o pacote da versão em uso, por exemplo:
 *   https://github.com/nfephp-org/sped-nfe/tree/master/schemes/PL_010_V1.30
 */
import fs from "node:fs";
import path from "node:path";

type Sequencia = { pai: string; filhos: Array<{ nome: string; opcional: boolean }> };

/** Extrai as sequências nomeadas de um XSD, por profundidade de tags. */
function extrairSequencias(xsd: string): Sequencia[] {
  const texto = xsd.replace(/\r/g, "");
  const sequencias: Sequencia[] = [];
  const aberturas = [...texto.matchAll(/<xs:(?:element|complexType)\s[^>]*name="([^"]+)"/g)];

  for (const abertura of aberturas) {
    const pai = abertura[1];
    const inicio = abertura.index ?? 0;
    const re = /<(\/?)(xs:[a-zA-Z]+)([^>]*?)(\/?)>/g;
    re.lastIndex = inicio;

    let profundidade = 0;
    let m: RegExpExecArray | null;
    const filhos: Sequencia["filhos"] = [];

    while ((m = re.exec(texto))) {
      const fechando = m[1] === "/";
      const tag = m[2];
      const attrs = m[3];
      const autoFecha = m[4] === "/";

      if (!fechando) {
        // Profundidade 3 é o nível dos filhos diretos da sequence do elemento.
        if (profundidade === 3 && tag === "xs:element") {
          const nome = /name="([^"]+)"/.exec(attrs)?.[1];
          if (nome) filhos.push({ nome, opcional: /minOccurs="0"/.test(attrs) });
        }
        if (!autoFecha) profundidade += 1;
      } else {
        profundidade -= 1;
        if (profundidade <= 0) break;
      }
    }

    if (filhos.length) sequencias.push({ pai, filhos });
  }

  return sequencias;
}

/** Lista os filhos diretos de cada ocorrência de `pai` no XML. */
function filhosNoXml(xml: string, pai: string): string[][] {
  const ocorrencias: string[][] = [];
  const abre = new RegExp(`<${pai}(?:\\s[^>]*)?>`, "g");
  let m: RegExpExecArray | null;

  while ((m = abre.exec(xml))) {
    const re = /<(\/?)([A-Za-z][\w.]*)(?:\s[^>]*?)?(\/?)>/g;
    re.lastIndex = m.index + m[0].length;
    let profundidade = 0;
    let t: RegExpExecArray | null;
    const filhos: string[] = [];

    while ((t = re.exec(xml))) {
      const fechando = t[1] === "/";
      const nome = t[2];
      const autoFecha = t[3] === "/";
      if (fechando) {
        if (profundidade === 0) break;
        profundidade -= 1;
        continue;
      }
      if (profundidade === 0) filhos.push(nome);
      if (!autoFecha) profundidade += 1;
    }
    ocorrencias.push(filhos);
  }

  return ocorrencias;
}

function validar(xml: string, sequencias: Sequencia[]) {
  const problemas: string[] = [];

  for (const { pai, filhos } of sequencias) {
    const esperados = filhos.map((f) => f.nome);
    const obrigatorios = filhos.filter((f) => !f.opcional).map((f) => f.nome);

    for (const [indice, presentes] of filhosNoXml(xml, pai).entries()) {
      if (!presentes.length) continue;
      const rotulo = `${pai}${indice > 0 ? `[${indice + 1}]` : ""}`;

      // Ordem: os filhos conhecidos devem aparecer na sequência do XSD.
      const conhecidos = presentes.filter((n) => esperados.includes(n));
      const posicoes = conhecidos.map((n) => esperados.indexOf(n));
      for (let i = 1; i < posicoes.length; i += 1) {
        if (posicoes[i] < posicoes[i - 1]) {
          problemas.push(
            `${rotulo}: <${conhecidos[i]}> aparece depois de <${conhecidos[i - 1]}>, `
              + `mas o XSD exige a ordem ${esperados.join(" > ")}`,
          );
          break;
        }
      }

      // Obrigatórios ausentes — só cobra quando o grupo foi emitido.
      for (const nome of obrigatorios) {
        if (!presentes.includes(nome)) {
          problemas.push(`${rotulo}: falta o elemento obrigatório <${nome}>`);
        }
      }
    }
  }

  return problemas;
}

function main() {
  const [arquivoXml, pastaXsd] = process.argv.slice(2);
  if (!arquivoXml) {
    console.error("Uso: npx tsx scripts/nfe/validar-ordem-xsd.ts <arquivo.xml> [pasta-dos-xsd]");
    process.exit(2);
  }

  const pasta = pastaXsd ?? process.env.NFE_XSD_DIR;
  if (!pasta || !fs.existsSync(pasta)) {
    console.error(
      "Informe a pasta com os XSD (argumento 2 ou NFE_XSD_DIR).\n"
        + "Baixe o pacote da versão em uso, ex.: PL_010_V1.30 do repositório sped-nfe.",
    );
    process.exit(2);
  }

  const xml = fs.readFileSync(arquivoXml, "utf8");
  const sequencias = fs
    .readdirSync(pasta)
    .filter((f) => f.endsWith(".xsd"))
    .flatMap((f) => extrairSequencias(fs.readFileSync(path.join(pasta, f), "utf8")));

  const problemas = validar(xml, sequencias);
  if (!problemas.length) {
    console.log(`OK — ordem e obrigatoriedade conferem (${sequencias.length} sequências checadas).`);
    console.log("Atenção: não valida tipos, faixas nem padrões. Use um validador XSD completo antes de produção.");
    return;
  }

  console.error(`${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}

main();
