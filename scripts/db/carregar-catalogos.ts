/**
 * Carrega os catálogos do sistema num banco que nasceu de um dump só de
 * estrutura (Jean Car e HG, out/2026). O histórico de migrations veio junto no
 * dump, então as cargas de dados que as migrations fazem — DRE padrão, tabelas
 * da reforma tributária, tipos de entrada e saída, termos de impressão —
 * nunca rodaram ali, e o deploy não vai rodá-las de novo.
 *
 * O que é catálogo sai dos próprios bancos: a linha que existe igual — id
 * inclusive — em pelo menos dois de Demonstração, Demir e Garage Premium. O
 * que só um banco tem é personalização daquela oficina e fica de fora. Manter o
 * id é o que preserva as referências entre as tabelas carregadas.
 *
 * Plano de contas, categorias e o mapeamento da DRE não têm padrão comum: vêm
 * do Demir (ORIGEM_DO_PLANO), com as regras de reclassificação.
 *
 * Só grava em tabela vazia. Tabela já preenchida é comparada e nunca alterada.
 * Sem --aplicar, tudo roda numa transação desfeita no final: os gatilhos e as
 * constraints são exercitados de verdade, e nada fica gravado.
 *
 *   npm run db:carregar:catalogos -- jeancar             # simula
 *   npm run db:carregar:catalogos -- jeancar --aplicar   # grava
 */
import type { Client } from "pg";

import {
  DATABASE_KEYS,
  connectDatabase,
  loadDatabaseConfigs,
  type DatabaseConfig,
  type DatabaseKey,
} from "./lib";

/** Em ordem de dependência: quem é referenciado vem antes. */
const TABELAS = [
  "dre_template",
  "dre_linha",
  "classificacoes_resultado",
  "dre_implantacao",
  "fiscal_nfe_cst_ibscbs",
  "fiscal_nfe_classificacao_tributaria",
  "fiscal_nfe_saida_operacao",
  "tipos_ajuste_transacao",
  "tipos_documento_transacao",
  "tipos_entrada",
  "tipos_motivo_saida",
  "usoconsumo_grupo",
  "os_termo_impressao",
] as const;
// Fora de propósito: unidades de medida, que cada oficina cadastra (nenhuma
// linha igual entre os clientes), e o que depende da empresa cadastrada
// (nfe_config, NFS-e, SPED).

/** Os bancos que servem de referência para o catálogo. */
const REFERENCIAS: DatabaseKey[] = ["demo", "demir", "garage"];

/**
 * Plano de contas e categorias não têm padrão de fábrica. Para Jean Car e HG a
 * decisão (13/10/2026) foi começar pelo do Demir — grupos, contas e categorias
 * ativos, já classificados na DRE. O mapeamento da DRE vem junto: parte dele
 * aponta para os grupos desse plano, e a outra parte, embora igual em todo
 * banco, aponta para dre_linha por id, que não é o mesmo em todo banco.
 */
const ORIGEM_DO_PLANO: DatabaseKey = "demir";

/** Fora da comparação de conteúdo: muda de banco para banco sem mudar o dado. */
const AUDITORIA = new Set(["id", "created_at", "updated_at", "createdat", "updatedat", "created_by", "updated_by"]);

/** Cargas que já têm comando próprio; aqui só se mostra a situação. */
const COM_COMANDO_PROPRIO = [
  { tabela: "fiscal_difal_regra", comando: "npm run fiscal:difal -- --todos --aplicar" },
  { tabela: "fiscal_ncm", comando: "npm run fiscal:ncm -- <banco> --aplicar" },
  { tabela: "radio_station", comando: "npm run radios:sincronizar:todos-bancos" },
];

type Linha = Record<string, unknown>;

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes("--aplicar");
const chave = argumentos.find((arg) => !arg.startsWith("--")) as DatabaseKey | undefined;

function conteudo(linha: Linha) {
  return JSON.stringify(
    Object.fromEntries(Object.entries(linha).filter(([coluna]) => !AUDITORIA.has(coluna)).sort()),
  );
}

function conteudoComId(linha: Linha) {
  return `${String(linha.id)}|${conteudo(linha)}`;
}

const semAutoria = (linha: Linha): Linha => ({
  ...linha,
  ...("created_by" in linha ? { created_by: null } : {}),
  ...("updated_by" in linha ? { updated_by: null } : {}),
});

async function lerTabela(client: Client, tabela: string, filtro = ""): Promise<Linha[]> {
  const r = await client.query<{ j: Linha }>(`select to_jsonb(t) j from public.${tabela} t ${filtro}`);
  return r.rows.map((row) => row.j);
}

async function lerReferencia(banco: DatabaseConfig) {
  const { client } = await connectDatabase(banco);
  try {
    await client.query("begin read only");
    const dados = new Map<string, Linha[]>();
    for (const tabela of TABELAS) dados.set(tabela, await lerTabela(client, tabela));
    return dados;
  } finally {
    await client.query("rollback");
    await client.end();
  }
}

/**
 * Linhas iguais, id inclusive, em pelo menos dois dos bancos de referência.
 *
 * Linha acrescentada por migration depois que os bancos já divergiam ganha um
 * id diferente em cada um (CONSUMO_EM_OS: 13, 30 e 15). Se o conteúdo é igual
 * em dois bancos mas o id não, ela entra com o id do ORIGEM_DO_PLANO.
 */
function catalogo(versoes: Linha[][], preferida: number) {
  const contar = (chaveDe: (linha: Linha) => string) => {
    const contagem = new Map<string, number>();
    for (const linhas of versoes) {
      for (const chaveLinha of new Set(linhas.map(chaveDe))) {
        contagem.set(chaveLinha, (contagem.get(chaveLinha) ?? 0) + 1);
      }
    }
    return contagem;
  };
  const porId = contar(conteudoComId);
  const porConteudo = contar(conteudo);

  const escolhidas = new Map<string, Linha>();
  for (const linhas of versoes) {
    for (const linha of linhas) {
      if ((porId.get(conteudoComId(linha)) ?? 0) >= 2) escolhidas.set(conteudo(linha), linha);
    }
  }
  const idsUsados = new Set([...escolhidas.values()].map((linha) => String(linha.id)));
  for (const linha of versoes[preferida]) {
    const chaveLinha = conteudo(linha);
    if (escolhidas.has(chaveLinha) || (porConteudo.get(chaveLinha) ?? 0) < 2) continue;
    if (idsUsados.has(String(linha.id))) {
      throw new Error(`Id ${String(linha.id)} já usado por outra linha do catálogo: ${chaveLinha}`);
    }
    escolhidas.set(chaveLinha, linha);
    idsUsados.add(String(linha.id));
  }
  return [...escolhidas.values()].sort((a, b) =>
    String(a.id ?? "").localeCompare(String(b.id ?? ""), "pt-BR", { numeric: true }),
  );
}

/** Ordena para o pai entrar antes do filho quando a tabela referencia a si mesma. */
function ordenarPorPai(linhas: Linha[], colunaPai: string) {
  const ids = new Set(linhas.map((linha) => String(linha.id)));
  const inseridos = new Set<string>();
  const ordenadas: Linha[] = [];
  let restantes = [...linhas];
  while (restantes.length) {
    const prontas = restantes.filter((linha) => {
      const pai = linha[colunaPai];
      return pai == null || !ids.has(String(pai)) || inseridos.has(String(pai));
    });
    if (!prontas.length) throw new Error(`Ciclo em ${colunaPai}.`);
    for (const linha of prontas) {
      ordenadas.push(linha);
      inseridos.add(String(linha.id));
    }
    restantes = restantes.filter((linha) => !inseridos.has(String(linha.id)));
  }
  return ordenadas;
}

/**
 * Insere as linhas como vieram. Com `manterId`, o id da origem vai junto e a
 * sequência é acertada depois; sem ele, o banco numera (linha que ninguém
 * referencia pelo id).
 */
async function inserir(client: Client, tabela: string, linhas: Linha[], manterId: boolean) {
  const colunas = await client.query<{ attname: string }>(
    `select a.attname from pg_attribute a
      where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0
        and not a.attisdropped and a.attgenerated = ''
        and ($2 or a.attname <> 'id')
      order by a.attnum`,
    [tabela, manterId],
  );
  const lista = colunas.rows.map((c) => `"${c.attname}"`).join(", ");
  for (const linha of linhas) {
    await client.query(
      `insert into public.${tabela} (${lista}) ${manterId ? "overriding system value" : ""}
       select ${lista} from jsonb_populate_record(null::public.${tabela}, $1::jsonb)`,
      [JSON.stringify(linha)],
    );
  }
  if (!manterId) return;

  // A sequência continua em 1 depois de inserir com id explícito. Tabela de
  // chave natural (código da reforma, CFOP...) não tem sequência nenhuma.
  for (const { attname } of colunas.rows) {
    const seq = await client.query<{ s: string | null }>(
      `select pg_get_serial_sequence('public.${tabela}', $1) s`,
      [attname],
    );
    const sequencia = seq.rows[0]?.s;
    if (!sequencia) continue;
    await client.query(
      `select setval($1, greatest((select max("${attname}") from public.${tabela}), 1))`,
      [sequencia],
    );
  }
}

/**
 * Catálogo genérico. Devolve as tabelas que bloqueiam a gravação (divergentes)
 * e as que já estavam no banco com o mesmo conteúdo mas outros ids — essas não
 * podem ser referenciadas pelo id da referência.
 */
async function carregarCatalogo(client: Client, referencias: Map<string, Linha[]>[]) {
  const bloqueadas = new Set<string>();
  const idsProprios = new Set<string>();
  const fks = await client.query<{ tabela: string; coluna: string; ref: string }>(
    `select cl.relname tabela, a.attname coluna, rf.relname ref
       from pg_constraint k
       join pg_class cl on cl.oid = k.conrelid
       join pg_class rf on rf.oid = k.confrelid
       join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
      where k.contype = 'f' and cl.relnamespace = 'public'::regnamespace
        and cl.relname = any($1)`,
    [TABELAS],
  );

  for (const tabela of TABELAS) {
    const minhasFks = fks.rows.filter((fk) => fk.tabela === tabela);

    // Referência a um catálogo divergente, ou carregado com outros ids,
    // deixaria o filho apontando para a linha errada.
    const paiProblema = minhasFks.find(
      (fk) => fk.ref !== tabela && (bloqueadas.has(fk.ref) || idsProprios.has(fk.ref)),
    );
    if (paiProblema) {
      bloqueadas.add(tabela);
      console.log(`- ${tabela}: NÃO CARREGADA — depende de ${paiProblema.ref}, que tem outros ids ou divergiu`);
      continue;
    }

    // Usuário, empresa e centro de custo não existem no banco novo: linha que
    // aponta para eles não é de fábrica. Autoria de registro é só rastro.
    const externas = minhasFks.filter((fk) => !TABELAS.includes(fk.ref as (typeof TABELAS)[number]));
    const fabrica = catalogo(
      referencias.map((ref) => ref.get(tabela)!),
      REFERENCIAS.indexOf(ORIGEM_DO_PLANO),
    );
    const aproveitaveis = fabrica
      .map(semAutoria)
      .filter((linha) => externas.every((fk) => linha[fk.coluna] == null));
    const descartadas = fabrica.length - aproveitaveis.length;

    const atuais = await lerTabela(client, tabela);
    if (atuais.length) {
      const comId = new Set(atuais.map(conteudoComId));
      const semId = new Set(atuais.map(conteudo));
      const faltando = aproveitaveis.filter((linha) => !semId.has(conteudo(linha))).length;
      const idsOutros = aproveitaveis.filter((linha) => !comId.has(conteudoComId(linha))).length;
      if (faltando) {
        bloqueadas.add(tabela);
        console.log(`- ${tabela}: DIVERGENTE — já tem ${atuais.length} linha(s) e faltam ${faltando} do catálogo; não alterada`);
      } else if (idsOutros) {
        idsProprios.add(tabela);
        console.log(`- ${tabela}: já carregada, mas ${idsOutros} linha(s) com outro id; não alterada`);
      } else {
        console.log(`- ${tabela}: já carregada (${atuais.length} linha(s))`);
      }
      continue;
    }

    const autoReferencia = minhasFks.find((fk) => fk.ref === tabela);
    const linhas = autoReferencia ? ordenarPorPai(aproveitaveis, autoReferencia.coluna) : aproveitaveis;
    await inserir(client, tabela, linhas, true);
    console.log(
      `- ${tabela}: ${linhas.length} linha(s) inserida(s)` +
        (descartadas ? ` (${descartadas} descartada(s): apontam para usuário, empresa ou centro de custo)` : ""),
    );
  }
  return bloqueadas;
}

/**
 * Plano de contas, categorias, mapeamento da DRE e regras de reclassificação,
 * copiados do ORIGEM_DO_PLANO. Só em banco sem nenhum deles.
 */
async function carregarPlanoDeContas(client: Client, origem: DatabaseConfig) {
  console.log(`\nPlano de contas, categorias e mapeamento da DRE (do ${origem.label}):`);
  const contagem = await client.query<Record<string, number>>(
    `select (select count(*)::int from public.planosdecontagrupos) grupos,
            (select count(*)::int from public.planosdeconta) contas,
            (select count(*)::int from public.categoriatransacao) categorias,
            (select count(*)::int from public.plano_contas_classificacao_regra) regras,
            (select count(*)::int from public.dre_mapeamento) mapeamento`,
  );
  const atual = contagem.rows[0];
  if (Object.values(atual).some((n) => n > 0)) {
    console.log(`- já existe neste banco (${JSON.stringify(atual)}); não alterado`);
    return true;
  }

  const { client: fonte } = await connectDatabase(origem);
  try {
    await fonte.query("begin read only");

    // O mapeamento aponta para dre_linha e dre_template por id, e esses ids
    // não são iguais em todo banco: a tradução é pelo código.
    const traducao = async (tabela: string, chaveNatural: string) => {
      const [deLa, daqui] = await Promise.all([
        fonte.query(`select id, ${chaveNatural} k from public.${tabela}`),
        client.query(`select id, ${chaveNatural} k from public.${tabela}`),
      ]);
      const idDaqui = new Map(daqui.rows.map((r) => [String(r.k), Number(r.id)]));
      return new Map(deLa.rows.map((r) => [Number(r.id), idDaqui.get(String(r.k))]));
    };
    const linhaPara = await traducao("dre_linha", "codigo");
    const templatePara = await traducao("dre_template", "codigo || '|' || versao");
    const classificacaoPara = await traducao("classificacoes_resultado", "codigo");
    const naoTraduzidos = [...linhaPara, ...templatePara, ...classificacaoPara].filter(([, id]) => id == null);
    if (naoTraduzidos.length) {
      console.log("- NÃO CARREGADO: este banco não tem o catálogo da DRE completo (rode a etapa acima antes)");
      return false;
    }

    const grupos = await lerTabela(fonte, "planosdecontagrupos", "where coalesce(t.ativo, true) order by t.id");
    const idsGrupos = new Set(grupos.map((g) => Number(g.id)));
    const contas = (await lerTabela(fonte, "planosdeconta", "where coalesce(t.ativo, true) order by t.id"))
      .filter((c) => idsGrupos.has(Number(c.grupo_id)));
    const idsContas = new Set(contas.map((c) => Number(c.id)));
    const categorias = await lerTabela(fonte, "categoriatransacao", "where coalesce(t.ativo, true) order by t.id");

    const traduzir = (linha: Linha, coluna: string, mapa: Map<number, number | undefined>) =>
      linha[coluna] == null ? null : mapa.get(Number(linha[coluna]));
    const mapeamento = (await lerTabela(fonte, "dre_mapeamento", "order by t.id"))
      .filter((m) => m.centro_custo_id == null)
      .filter((m) => m.origem_tipo !== "PLANO_GRUPO" || idsGrupos.has(Number(m.origem_id)))
      .map((m) => ({
        ...semAutoria(m),
        linha_id: traduzir(m, "linha_id", linhaPara),
        template_id: traduzir(m, "template_id", templatePara),
        classificacao_resultado_id: traduzir(m, "classificacao_resultado_id", classificacaoPara),
      }));
    const regras = (await lerTabela(fonte, "plano_contas_classificacao_regra", "order by t.id"))
      .filter(
        (r) =>
          (r.grupo_id == null || idsGrupos.has(Number(r.grupo_id))) &&
          (r.conta_id == null || idsContas.has(Number(r.conta_id))),
      )
      .map((r) => ({
        ...semAutoria(r),
        classificacao_id: traduzir(r, "classificacao_id", classificacaoPara),
      }));
    const classificar = (linha: Linha, coluna: string) =>
      linha[coluna] == null ? linha : { ...linha, [coluna]: traduzir(linha, coluna, classificacaoPara) };

    await inserir(client, "planosdecontagrupos", grupos.map((g) => classificar(g, "classificacao_padrao_id")), true);
    await inserir(client, "planosdeconta", contas.map((c) => classificar(c, "classificacao_especifica_id")), true);
    await inserir(client, "categoriatransacao", categorias, true);
    await inserir(client, "dre_mapeamento", mapeamento, false);
    await inserir(client, "plano_contas_classificacao_regra", regras, false);
    console.log(
      `- ${grupos.length} grupo(s), ${contas.length} conta(s), ${categorias.length} categoria(s), ` +
        `${mapeamento.length} linha(s) de mapeamento da DRE, ${regras.length} regra(s) de classificação`,
    );
    return true;
  } finally {
    await fonte.query("rollback");
    await fonte.end();
  }
}

async function main() {
  const configs = loadDatabaseConfigs();
  const destinos = DATABASE_KEYS.filter((k) => !REFERENCIAS.includes(k));
  if (!chave || !destinos.includes(chave)) {
    throw new Error(`Informe o banco de destino: ${destinos.join(", ")}.`);
  }
  const destino = configs.find((banco) => banco.key === chave)!;

  console.log("Lendo os catálogos de Demonstração, Demir e Garage Premium...");
  const referencias = await Promise.all(
    REFERENCIAS.map((key) => lerReferencia(configs.find((banco) => banco.key === key)!)),
  );

  const { client } = await connectDatabase(destino);
  try {
    await client.query("begin");
    console.log(`\n${destino.label} — ${aplicar ? "GRAVANDO" : "simulação (transação desfeita no final)"}\n`);

    const bloqueadas = await carregarCatalogo(client, referencias);
    const planoOk = await carregarPlanoDeContas(client, configs.find((banco) => banco.key === ORIGEM_DO_PLANO)!);
    if (!planoOk) bloqueadas.add("planosdeconta");

    console.log("\nCargas com comando próprio:");
    for (const { tabela, comando } of COM_COMANDO_PROPRIO) {
      const r = await client.query<{ n: number }>(`select count(*)::int n from public.${tabela}`);
      console.log(`- ${tabela}: ${r.rows[0].n} linha(s)${r.rows[0].n ? "" : ` — rode ${comando}`}`);
    }

    // Dependem do cadastro da empresa, que é feito pela própria oficina.
    const empresa = await client.query<{ n: number }>(`select count(*)::int n from public.empresa`);
    const nfeConfig = await client.query<{ n: number }>(`select count(*)::int n from public.nfe_config`);
    console.log(
      `\nEmpresa cadastrada: ${empresa.rows[0].n ? "sim" : "NÃO"} · nfe_config: ${nfeConfig.rows[0].n} linha(s)`,
    );

    if (aplicar && bloqueadas.size) {
      await client.query("rollback");
      console.log(`\nNada gravado: pendente em ${[...bloqueadas].join(", ")}. Resolva antes de aplicar.`);
      process.exitCode = 1;
      return;
    }
    await client.query(aplicar ? "commit" : "rollback");
    console.log(aplicar ? "\nGravado." : "\nSimulação: nada gravado. Rode com --aplicar para gravar.");
  } catch (erro) {
    await client.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
});
