/** Gera SQL local; não conecta nem aplica alterações em nenhum banco. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

export const PASTA_CATALOGO_RTC = 'schemas/fiscal/IT2025.002-v1.71-2026-10-30';

type Linha = Record<string, unknown>;

function texto(valor: unknown): string {
  if (typeof valor !== 'string' || !valor.trim()) throw new Error('Texto obrigatório ausente na fonte RTC.');
  return valor.trim();
}

function numero(valor: unknown): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new Error('Número inválido na fonte RTC.');
  return valor;
}

function dataExcel(valor: unknown, opcional = false): string | null {
  if (opcional && valor == null) return null;
  const data = XLSX.SSF.parse_date_code(numero(valor));
  if (!data || data.y < 2025 || data.y > 2100) throw new Error('Data inválida na fonte RTC.');
  return `${data.y}-${String(data.m).padStart(2, '0')}-${String(data.d).padStart(2, '0')}`;
}

function indicadores(linha: Linha): Record<string, number> {
  return Object.fromEntries(Object.entries(linha).filter(([chave]) => /^(ind|tp)/.test(chave))
    .map(([chave, valor]) => {
      const n = numero(valor);
      if (chave.startsWith('ind') && n !== 0 && n !== 1) throw new Error(`Indicador inválido: ${chave}`);
      return [chave, n];
    }));
}

export function lerCatalogoRtc(pasta = PASTA_CATALOGO_RTC) {
  const manifesto = JSON.parse(fs.readFileSync(path.join(pasta, 'manifest.json'), 'utf8')) as {
    versao: string; publicadoEm: string; url: string; arquivo: string; sha256: string;
    abaClassificacoes: string; abaCst: string; quantidadeCst: number; quantidadeClassificacoes: number;
  };
  const bytes = fs.readFileSync(path.join(pasta, manifesto.arquivo));
  if (createHash('sha256').update(bytes).digest('hex') !== manifesto.sha256) {
    throw new Error('Arquivo oficial RTC diverge do SHA-256 do manifesto.');
  }
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const linhas = (aba: string) => {
    if (!wb.Sheets[aba]) throw new Error(`Aba oficial RTC ausente: ${aba}`);
    return XLSX.utils.sheet_to_json<Linha>(wb.Sheets[aba], { defval: null });
  };
  const csts = linhas(manifesto.abaCst).filter((linha) => /^\d{3}$/.test(String(linha['CST-IBS/CBS'] ?? '')))
    .map((linha) => ({ cst: texto(linha['CST-IBS/CBS']), descricao: texto(linha['Descrição CST-IBS/CBS']), indicadores: indicadores(linha) }));
  const classificacoes = linhas(manifesto.abaClassificacoes).map((linha) => {
    const codigo = String(linha.cClassTrib ?? '').padStart(6, '0');
    const cst = String(linha['CST-IBS/CBS'] ?? '').padStart(3, '0');
    if (!/^\d{6}$/.test(codigo) || !codigo.startsWith(cst) || !csts.some((registro) => registro.cst === cst)) {
      throw new Error(`CST/cClassTrib incompatível na fonte RTC: ${codigo}`);
    }
    const ind = indicadores(linha);
    if (ind.indDIR == null || ind.indNFe == null || ind.indNFCe == null) {
      throw new Error(`Indicadores de aplicabilidade ausentes em ${codigo}.`);
    }
    const reducaoIbs = numero(linha.pRedIBS);
    const reducaoCbs = numero(linha.pRedCBS);
    if ([reducaoIbs, reducaoCbs].some((valor) => valor < 0 || valor > 100)) throw new Error('Redução RTC fora de 0 a 100.');
    const inicio = dataExcel(linha.dIniVig)!;
    const fim = dataExcel(linha.dFimVig, true);
    if (fim && fim < inicio) throw new Error(`Vigência invertida em ${codigo}.`);
    return {
      codigo, cst, nome: texto(linha['Nome cClassTrib']), descricao: texto(linha['Descrição cClassTrib']),
      percentual_reducao_ibs: reducaoIbs, percentual_reducao_cbs: reducaoCbs,
      inicio_vigencia: inicio, fim_vigencia: fim, permite_nfe: ind.indNFe === 1,
      indicadores: {
        ...ind, tipoAliquota: texto(linha['Tipo de Alíquota']),
        // Aliases conservados para os consumidores do catálogo v1.60.
        indTribRegular: ind.ind_gTribRegular, indCredPresOper: ind.ind_gCredPresOper,
        indMonoPadrao: ind.ind_gMonoPadrao, indMonoReten: ind.ind_gMonoReten, indMonoRet: ind.ind_gMonoRet,
      } as Record<string, number | string>,
      atualizado_em: dataExcel(linha['DataAtualização'])!, fonte_url: texto(linha.Link),
    };
  });
  if (csts.length !== manifesto.quantidadeCst || classificacoes.length !== manifesto.quantidadeClassificacoes
      || new Set(csts.map((linha) => linha.cst)).size !== csts.length
      || new Set(classificacoes.map((linha) => linha.codigo)).size !== classificacoes.length) {
    throw new Error('Contagens ou códigos duplicados divergem do manifesto RTC.');
  }
  return { manifesto, csts, classificacoes };
}

const literal = (valor: unknown): string => {
  if (valor == null) return 'NULL';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  const texto = typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  return `'${texto.replaceAll("'", "''")}'${typeof valor === 'object' ? '::jsonb' : ''}`;
};

export function gerarMigracaoCatalogoRtc() {
  const { manifesto, csts, classificacoes } = lerCatalogoRtc();
  const inserir = (tabela: string, linhas: Linha[]) => {
    const colunas = Object.keys(linhas[0]);
    return `INSERT INTO public.${tabela} (${colunas.join(',')}) VALUES\n`
      + linhas.map((linha) => `(${colunas.map((coluna) => literal(linha[coluna])).join(',')})`).join(',\n')
      + '\nON CONFLICT DO NOTHING;\n';
  };
  return `-- Gerado por scripts/fiscal/gerar-migracao-catalogo-rtc.ts. Não editar manualmente.\n`
    + `-- Fonte oficial: ${manifesto.url}\n-- SHA-256 XLSX: ${manifesto.sha256}\n`
    + `-- Edição ${manifesto.versao}; ${csts.length} CST e ${classificacoes.length} cClassTrib.\n`
    + '-- Preserva edições anteriores, documentos, numeração, protocolos e snapshots.\nBEGIN;\n'
    + inserir('fiscal_nfe_cst_ibscbs', csts.map((linha) => ({ ...linha, versao_fonte: manifesto.versao, atualizado_em: manifesto.publicadoEm })))
    + inserir('fiscal_nfe_classificacao_tributaria', classificacoes.map((linha) => ({ ...linha, versao_fonte: manifesto.versao })))
    + 'COMMIT;\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = process.argv[2];
  if (!output || !output.endsWith('.sql')) throw new Error('Informe um caminho .sql local para gerar a migração (nenhum banco será conectado).');
  fs.writeFileSync(output, gerarMigracaoCatalogoRtc(), 'utf8');
  console.log(`Migração RTC gerada localmente: ${output}`);
}
