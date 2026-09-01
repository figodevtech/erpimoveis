/**
 * Migra os itens dos orcamentos do Garage Premium como snapshots historicos.
 *
 * Uso:
 *   npm run migracao:garage:orcamentos-historicos
 *   npm run migracao:garage:orcamentos-historicos -- --aplicar
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";
import {
  arredondarMoeda,
  classificarItem,
  descricaoHistorica,
  texto,
  type MotivoClassificacao,
  type TipoItemHistorico,
} from "./garagepremium-orcamentos-lib";

const APLICAR = process.argv.includes("--aplicar");
const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const ORIGEM = "GARAGE_PREMIUM_ORCAMENTOS";
const PREFIXO_OS = "LEGADO_OS_EXPORTACAO:";
const HASH_OS = "1526E77348871B041ED3B8D1FC6F954C1EDDFCC535188C51AADA7CA1E6E51903";
const HASH_ORCAMENTOS = "096F01610D29AA7718981CC577B7D7909475081505D0D90BF9097FCE66C0CCE8";
const TOTAL_OS = 2_308;
const TOTAL_OS_COM_ITENS = 2_304;
const TOTAL_ITENS = 15_429;
const TOTAL_PRODUTOS = 12_167;
const TOTAL_SERVICOS = 3_262;
const TOTAL_PRODUTOS_VALOR = 6_264_636.86;
const TOTAL_SERVICOS_VALOR = 1_476_675.4;
const TOTAL_BRUTO = 7_741_312.26;
const TOTAL_DESCONTOS = 520_448.94;
const TOTAL_LIQUIDO = 7_220_863.32;
const REGISTRO_ACEITE = 4_611;

type Linha = unknown[];
type OrdemMigrada = {
  id: number;
  registro: number;
  migracao_referencia: string;
};
type ItemHistorico = {
  ordemservicoid: number;
  registro: number;
  linha_origem: number;
  tipo: TipoItemHistorico;
  motivo: MotivoClassificacao;
  codigo_legado: string;
  descricao: string;
  unidade: string | null;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
};
type TotalOrdem = {
  id: number;
  registro: number;
  produtos: number;
  servicos: number;
  subtotal: number;
  desconto: number;
  total: number;
  itens: number;
};

function hashArquivo(arquivo: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex").toUpperCase();
}

function nomeNormalizado(nome: string) {
  return nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function localizarArquivo(nome: string) {
  const esperado = nomeNormalizado(nome);
  const encontrado = fs.readdirSync(DIRETORIO).find((item) => nomeNormalizado(item) === esperado);
  if (!encontrado) throw new Error(`Arquivo nao encontrado: ${nome}.`);
  return path.join(DIRETORIO, encontrado);
}

function lerMatriz(arquivo: string): Linha[] {
  const workbook = XLSX.read(fs.readFileSync(arquivo), { type: "buffer", cellDates: true });
  const aba = workbook.SheetNames[0];
  if (!aba) throw new Error(`Planilha sem abas: ${path.basename(arquivo)}.`);
  return XLSX.utils.sheet_to_json<Linha>(workbook.Sheets[aba], {
    header: 1,
    defval: null,
    raw: true,
  });
}

function numero(valor: unknown, campo: string, linha: number) {
  const resultado = Number(valor);
  if (!Number.isFinite(resultado)) throw new Error(`${campo} invalido na linha ${linha}.`);
  return resultado;
}

function quaseIgual(a: number, b: number) {
  return Math.abs(arredondarMoeda(a) - arredondarMoeda(b)) < 0.005;
}

function conferirValor(rotulo: string, atual: number, esperado: number) {
  if (!quaseIgual(atual, esperado)) {
    throw new Error(`${rotulo}: esperado ${esperado.toFixed(2)}, encontrado ${atual.toFixed(2)}.`);
  }
}

function criarRelatorio(itens: ItemHistorico[], totais: TotalOrdem[]) {
  const resumo = [
    { Indicador: "OS migradas", Valor: TOTAL_OS },
    { Indicador: "OS com itens", Valor: totais.filter((item) => item.itens > 0).length },
    { Indicador: "OS sem itens", Valor: totais.filter((item) => item.itens === 0).length },
    { Indicador: "Itens", Valor: itens.length },
    { Indicador: "Produtos", Valor: itens.filter((item) => item.tipo === "PRODUTO").length },
    { Indicador: "Servicos", Valor: itens.filter((item) => item.tipo === "SERVICO").length },
    { Indicador: "Total bruto", Valor: totais.reduce((soma, item) => soma + item.subtotal, 0) },
    { Indicador: "Descontos", Valor: totais.reduce((soma, item) => soma + item.desconto, 0) },
    { Indicador: "Total liquido", Valor: totais.reduce((soma, item) => soma + item.total, 0) },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(resumo), "Resumo");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      totais.map((item) => ({
        Registro: item.registro,
        "ID da OS": item.id,
        Itens: item.itens,
        Produtos: item.produtos,
        Servicos: item.servicos,
        Subtotal: item.subtotal,
        Desconto: item.desconto,
        Total: item.total,
      })),
    ),
    "OS",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      itens.map((item) => ({
        Registro: item.registro,
        "ID da OS": item.ordemservicoid,
        "Linha origem": item.linha_origem,
        Tipo: item.tipo,
        "Motivo classificacao": item.motivo,
        "Codigo legado": item.codigo_legado,
        Descricao: item.descricao,
        Unidade: item.unidade,
        Quantidade: item.quantidade,
        "Preco unitario": item.preco_unitario,
        Subtotal: item.subtotal,
      })),
    ),
    "Itens",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Prioridade", "Regra"],
      [1, "Codigo 65 e sempre SERVICO."],
      [2, "Atividade inequivoca na descricao e SERVICO."],
      [3, "Material ou descricao ambigua permanece PRODUTO."],
      [4, "Subtotal da linha = Preco x Quantidade, arredondado em centavos."],
      [5, "Desconto geral = campo Descontar da EXPORTACAO OS.xlsx."],
    ]),
    "Regras",
  );
  const saida = path.join(DIRETORIO, "ORCAMENTOS_MIGRACAO_AUDITORIA.xlsx");
  fs.writeFileSync(saida, XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  return saida;
}

async function efeitosHistoricos(client: Awaited<ReturnType<typeof connectDatabase>>["client"]) {
  const resultado = await client.query(
    `select
       (select count(*)::int from public.produto) produtos_catalogo,
       (select count(*)::int from public.servico) servicos_catalogo,
       (select coalesce(sum(estoque), 0)::numeric from public.produto) estoque_total,
       (select count(*)::int from public.osproduto p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia is not null) osprodutos,
       (select count(*)::int from public.osproduto_avulso p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia is not null) osprodutos_avulsos,
       (select count(*)::int from public.osservico s join public.ordemservico o on o.id=s.ordemservicoid where o.migracao_referencia is not null) osservicos,
       (select count(*)::int from public.osservico_realizador r join public.ordemservico o on o.id=r.ordemservicoid where o.migracao_referencia is not null) realizadores,
       (select count(*)::int from public.osproduto_baixa b join public.ordemservico o on o.id=b.ordemservicoid where o.migracao_referencia is not null) baixas,
       (select count(*)::int from public.transacao t join public.ordemservico o on o.id=t.ordemservicoid where o.migracao_referencia is not null) transacoes,
       (select count(*)::int from public.pagamento p join public.ordemservico o on o.id=p.ordemservicoid where o.migracao_referencia is not null) pagamentos,
       (select count(*)::int from public.eventos_financeiros e join public.ordemservico o on o.id=e.ordemservicoid where o.migracao_referencia is not null) eventos,
       (select count(*)::int from public.os_notificacao_evento n join public.ordemservico o on o.id=n.ordemservico_id where o.migracao_referencia is not null) notificacoes`,
  );
  return resultado.rows[0] as Record<string, string | number>;
}

function validarSemEfeitos(efeitos: Record<string, string | number>) {
  for (const campo of [
    "osprodutos",
    "osprodutos_avulsos",
    "osservicos",
    "realizadores",
    "baixas",
    "transacoes",
    "pagamentos",
    "eventos",
    "notificacoes",
  ]) {
    if (Number(efeitos[campo]) !== 0) throw new Error(`Efeito operacional encontrado em ${campo}: ${efeitos[campo]}.`);
  }
}

async function auditar(
  client: Awaited<ReturnType<typeof connectDatabase>>["client"],
  itens: ItemHistorico[],
  totais: TotalOrdem[],
) {
  const resumo = await client.query<{
    itens: number;
    produtos: number;
    servicos: number;
    produtos_valor: string;
    servicos_valor: string;
  }>(
    `select count(*)::int itens,
            count(*) filter (where tipo='PRODUTO')::int produtos,
            count(*) filter (where tipo='SERVICO')::int servicos,
            coalesce(sum(subtotal) filter (where tipo='PRODUTO'), 0)::numeric produtos_valor,
            coalesce(sum(subtotal) filter (where tipo='SERVICO'), 0)::numeric servicos_valor
       from public.ositem_historico
      where origem=$1`,
    [ORIGEM],
  );
  const r = resumo.rows[0];
  if (r.itens !== TOTAL_ITENS || r.produtos !== TOTAL_PRODUTOS || r.servicos !== TOTAL_SERVICOS) {
    throw new Error(`Contagens divergentes no banco: ${JSON.stringify(r)}.`);
  }
  conferirValor("Produtos no banco", Number(r.produtos_valor), TOTAL_PRODUTOS_VALOR);
  conferirValor("Servicos no banco", Number(r.servicos_valor), TOTAL_SERVICOS_VALOR);

  const linhasBanco = await client.query<{
    ordemservicoid: number;
    linha_origem: number;
    tipo: TipoItemHistorico;
    codigo_legado: string;
    descricao: string;
    unidade: string | null;
    quantidade: string;
    preco_unitario: string;
    subtotal: string;
  }>(
    `select ordemservicoid, linha_origem, tipo, codigo_legado, descricao, unidade,
            quantidade, preco_unitario, subtotal
       from public.ositem_historico where origem=$1
      order by ordemservicoid, linha_origem`,
    [ORIGEM],
  );
  const esperados = new Map(itens.map((item) => [`${item.ordemservicoid}:${item.linha_origem}`, item]));
  for (const linha of linhasBanco.rows) {
    const esperada = esperados.get(`${linha.ordemservicoid}:${linha.linha_origem}`);
    if (
      !esperada ||
      linha.tipo !== esperada.tipo ||
      linha.codigo_legado !== esperada.codigo_legado ||
      linha.descricao !== esperada.descricao ||
      (linha.unidade ?? null) !== esperada.unidade ||
      Number(linha.quantidade) !== esperada.quantidade ||
      Number(linha.preco_unitario) !== esperada.preco_unitario ||
      !quaseIgual(Number(linha.subtotal), esperada.subtotal)
    ) {
      throw new Error(`Item divergente no banco: OS ${linha.ordemservicoid}, linha ${linha.linha_origem}.`);
    }
  }

  const totaisBanco = await client.query<{
    id: number;
    subtotal: string;
    desconto: string;
    desconto_tipo: string | null;
    orcamentototal: string;
  }>(
    `select id, subtotal, desconto, desconto_tipo::text, orcamentototal
       from public.ordemservico
      where id=any($1::int[])`,
    [totais.map((item) => item.id)],
  );
  const totaisEsperados = new Map(totais.map((item) => [item.id, item]));
  for (const ordem of totaisBanco.rows) {
    const esperada = totaisEsperados.get(ordem.id);
    if (
      !esperada ||
      !quaseIgual(Number(ordem.subtotal), esperada.subtotal) ||
      !quaseIgual(Number(ordem.desconto), esperada.desconto) ||
      !quaseIgual(Number(ordem.orcamentototal), esperada.total) ||
      ordem.desconto_tipo !== (esperada.desconto > 0 ? "FIXO" : null)
    ) {
      throw new Error(`Totais divergentes na OS ${ordem.id}.`);
    }
  }
  validarSemEfeitos(await efeitosHistoricos(client));
}

async function main() {
  const arquivoOs = localizarArquivo("EXPORTACAO OS.xlsx");
  const arquivoOrcamentos = localizarArquivo("orcamentos.xlsx");
  if (hashArquivo(arquivoOs) !== HASH_OS) throw new Error("A EXPORTACAO OS.xlsx foi alterada.");
  if (hashArquivo(arquivoOrcamentos) !== HASH_ORCAMENTOS) throw new Error("A orcamentos.xlsx foi alterada.");

  const matrizOs = lerMatriz(arquivoOs);
  const matrizOrcamentos = lerMatriz(arquivoOrcamentos);
  const linhasOs = new Map<number, Linha>();
  for (const linha of matrizOs.slice(1)) {
    const registro = Number(linha[0]);
    if (Number.isInteger(registro)) linhasOs.set(registro, linha);
  }

  const configuracao = loadDatabaseConfigs().find((item) => item.key === "garage");
  if (!configuracao) throw new Error("Garage Premium nao configurado.");
  const { client } = await connectDatabase(configuracao);
  await client.query("BEGIN");
  try {
    const ordensQuery = await client.query<{
      id: number;
      migracao_referencia: string;
      status: string;
    }>(
      `select id, migracao_referencia, status::text status
         from public.ordemservico
        where migracao_referencia like $1
        order by id`,
      [`${PREFIXO_OS}%`],
    );
    if (ordensQuery.rowCount !== TOTAL_OS) {
      throw new Error(`Esperadas ${TOTAL_OS} OS migradas; encontradas ${ordensQuery.rowCount}.`);
    }
    const ordens: OrdemMigrada[] = ordensQuery.rows.map((ordem) => {
      const registro = Number(ordem.migracao_referencia.slice(PREFIXO_OS.length));
      if (!Number.isInteger(registro) || ordem.status !== "CONCLUIDO") {
        throw new Error(`OS migrada invalida: ${ordem.id}.`);
      }
      return { id: ordem.id, registro, migracao_referencia: ordem.migracao_referencia };
    });
    const ordemPorRegistro = new Map(ordens.map((ordem) => [ordem.registro, ordem]));

    const itens: ItemHistorico[] = [];
    for (let indice = 1; indice < matrizOrcamentos.length; indice += 1) {
      const linha = matrizOrcamentos[indice];
      const registro = Number(linha[0]);
      const ordem = ordemPorRegistro.get(registro);
      if (!ordem) continue;
      const linhaOrigem = indice + 1;
      const codigo = texto(linha[3]);
      if (!codigo) throw new Error(`Codigo ausente na linha ${linhaOrigem}.`);
      const quantidade = numero(linha[6], "Quantidade", linhaOrigem);
      const preco = numero(linha[5], "Preco", linhaOrigem);
      if (quantidade <= 0 || !Number.isInteger(quantidade) || preco < 0) {
        throw new Error(`Quantidade ou preco invalido na linha ${linhaOrigem}.`);
      }
      const classificacao = classificarItem(codigo, linha[4]);
      itens.push({
        ordemservicoid: ordem.id,
        registro,
        linha_origem: linhaOrigem,
        tipo: classificacao.tipo,
        motivo: classificacao.motivo,
        codigo_legado: codigo,
        descricao: descricaoHistorica(linha[4], codigo),
        unidade: texto(linha[7]) || null,
        quantidade,
        preco_unitario: preco,
        subtotal: arredondarMoeda(preco * quantidade),
      });
    }

    const itensPorOrdem = new Map<number, ItemHistorico[]>();
    for (const item of itens) itensPorOrdem.set(item.ordemservicoid, [...(itensPorOrdem.get(item.ordemservicoid) ?? []), item]);
    const totais: TotalOrdem[] = ordens.map((ordem) => {
      const linhas = itensPorOrdem.get(ordem.id) ?? [];
      const origemOs = linhasOs.get(ordem.registro);
      if (!origemOs) throw new Error(`Registro ${ordem.registro} ausente na EXPORTACAO OS.xlsx.`);
      const produtos = arredondarMoeda(linhas.filter((item) => item.tipo === "PRODUTO").reduce((soma, item) => soma + item.subtotal, 0));
      const servicos = arredondarMoeda(linhas.filter((item) => item.tipo === "SERVICO").reduce((soma, item) => soma + item.subtotal, 0));
      const subtotal = arredondarMoeda(produtos + servicos);
      const desconto = arredondarMoeda(numero(origemOs[11] ?? 0, "Descontar", ordem.registro));
      if (desconto < 0 || desconto > subtotal) throw new Error(`Desconto invalido no registro ${ordem.registro}.`);
      return {
        id: ordem.id,
        registro: ordem.registro,
        produtos,
        servicos,
        subtotal,
        desconto,
        total: arredondarMoeda(subtotal - desconto),
        itens: linhas.length,
      };
    });

    const produtos = itens.filter((item) => item.tipo === "PRODUTO");
    const servicos = itens.filter((item) => item.tipo === "SERVICO");
    if (
      itens.length !== TOTAL_ITENS ||
      produtos.length !== TOTAL_PRODUTOS ||
      servicos.length !== TOTAL_SERVICOS ||
      totais.filter((item) => item.itens > 0).length !== TOTAL_OS_COM_ITENS
    ) {
      throw new Error("As contagens calculadas nao correspondem ao plano aprovado.");
    }
    conferirValor("Produtos", produtos.reduce((soma, item) => soma + item.subtotal, 0), TOTAL_PRODUTOS_VALOR);
    conferirValor("Servicos", servicos.reduce((soma, item) => soma + item.subtotal, 0), TOTAL_SERVICOS_VALOR);
    conferirValor("Bruto", totais.reduce((soma, item) => soma + item.subtotal, 0), TOTAL_BRUTO);
    conferirValor("Descontos", totais.reduce((soma, item) => soma + item.desconto, 0), TOTAL_DESCONTOS);
    conferirValor("Liquido", totais.reduce((soma, item) => soma + item.total, 0), TOTAL_LIQUIDO);

    const aceite = totais.find((item) => item.registro === REGISTRO_ACEITE);
    if (
      !aceite ||
      aceite.itens !== 8 ||
      !quaseIgual(aceite.produtos, 2_060) ||
      !quaseIgual(aceite.servicos, 820) ||
      !quaseIgual(aceite.subtotal, 2_880) ||
      !quaseIgual(aceite.desconto, 439) ||
      !quaseIgual(aceite.total, 2_441)
    ) {
      throw new Error("A OS 4611 nao corresponde ao caso de aceite aprovado.");
    }

    const relatorio = criarRelatorio(itens, totais);
    const existentes = await client.query<{ quantidade: number }>(
      "select count(*)::int quantidade from public.ositem_historico where origem=$1",
      [ORIGEM],
    );
    if (existentes.rows[0].quantidade === TOTAL_ITENS) {
      await auditar(client, itens, totais);
      console.log(`Carga ja aplicada e auditada: ${TOTAL_ITENS} itens em ${TOTAL_OS_COM_ITENS} OS.`);
      console.log(`Relatorio: ${relatorio}`);
      await client.query("ROLLBACK");
      return;
    }
    if (existentes.rows[0].quantidade !== 0) {
      throw new Error(`Carga parcial encontrada: ${existentes.rows[0].quantidade} de ${TOTAL_ITENS} itens.`);
    }

    const efeitosAntes = await efeitosHistoricos(client);
    validarSemEfeitos(efeitosAntes);
    const totaisAtuais = await client.query<{ quantidade: number }>(
      `select count(*) filter (
         where coalesce(subtotal,0)<>0 or coalesce(orcamentototal,0)<>0
            or coalesce(desconto,0)<>0 or desconto_tipo is not null
       )::int quantidade
         from public.ordemservico where migracao_referencia like $1`,
      [`${PREFIXO_OS}%`],
    );
    if (totaisAtuais.rows[0].quantidade !== 0) throw new Error("Existem OS migradas com totais preenchidos antes da carga.");

    console.log(`${APLICAR ? "APLICACAO" : "SIMULACAO"} - orcamentos historicos`);
    console.log(`${TOTAL_ITENS} itens validados: ${TOTAL_PRODUTOS} produtos e ${TOTAL_SERVICOS} servicos.`);
    console.log(`${TOTAL_OS_COM_ITENS} OS com itens; ${TOTAL_OS - TOTAL_OS_COM_ITENS} permanecem sem orcamento.`);
    console.log(`Relatorio: ${relatorio}`);
    if (!APLICAR) {
      console.log("Simulacao concluida sem INSERT ou UPDATE.");
      await client.query("ROLLBACK");
      return;
    }

    await client.query("select set_config('app.permitir_alterar_os_migrada', 'on', true)");
    const tamanhoLote = 1_000;
    for (let inicio = 0; inicio < itens.length; inicio += tamanhoLote) {
      const lote = itens.slice(inicio, inicio + tamanhoLote);
      const insercao = await client.query(
        `insert into public.ositem_historico (
           ordemservicoid, origem, linha_origem, tipo, codigo_legado, descricao,
           unidade, quantidade, preco_unitario, subtotal
         )
         select x.ordemservicoid, $2, x.linha_origem, x.tipo, x.codigo_legado,
                x.descricao, x.unidade, x.quantidade, x.preco_unitario, x.subtotal
           from jsonb_to_recordset($1::jsonb) as x(
             ordemservicoid integer, linha_origem integer, tipo text,
             codigo_legado text, descricao text, unidade text,
             quantidade numeric, preco_unitario numeric, subtotal numeric
           )`,
        [JSON.stringify(lote), ORIGEM],
      );
      if (insercao.rowCount !== lote.length) throw new Error(`Lote de itens incompleto no indice ${inicio}.`);
    }

    for (let inicio = 0; inicio < totais.length; inicio += tamanhoLote) {
      const lote = totais.slice(inicio, inicio + tamanhoLote);
      const atualizacao = await client.query(
        `update public.ordemservico os
            set subtotal=x.subtotal,
                desconto_tipo=case when x.desconto>0 then 'FIXO'::public.enum_tipo_desconto_venda else null end,
                desconto=x.desconto,
                orcamentototal=x.total
           from jsonb_to_recordset($1::jsonb) as x(
             id integer, subtotal numeric, desconto numeric, total numeric
           )
          where os.id=x.id and os.migracao_referencia is not null`,
        [JSON.stringify(lote)],
      );
      if (atualizacao.rowCount !== lote.length) throw new Error(`Lote de OS incompleto no indice ${inicio}.`);
    }

    await auditar(client, itens, totais);
    const efeitosDepois = await efeitosHistoricos(client);
    for (const campo of ["produtos_catalogo", "servicos_catalogo", "estoque_total"] as const) {
      if (String(efeitosAntes[campo]) !== String(efeitosDepois[campo])) {
        throw new Error(`A carga alterou ${campo}.`);
      }
    }
    await client.query("COMMIT");
    console.log(`Carga confirmada: ${TOTAL_ITENS} itens historicos em ${TOTAL_OS_COM_ITENS} OS.`);
    console.log(`Total liquido historico: R$ ${TOTAL_LIQUIDO.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`);
    console.log("Catalogo, estoque, financeiro, comissoes e notificacoes preservados.");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
