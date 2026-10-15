/**
 * Semeia os tipos básicos de uma oficina num banco recém-provisionado: grupos
 * de produto, unidades de medida e cores de veículo. Não são catálogo do
 * sistema — cada oficina edita os seus em Configurações > Tipos —, só um ponto
 * de partida para o cliente não começar com as listas vazias (Jean Car, out/2026).
 *
 * Só acrescenta o que falta: grupo e cor casam pelo nome sem diferenciar
 * maiúsculas, unidade pela sigla. Nada existente é alterado. Unidades seguem o
 * enum unidade_medida, e a UN precisa ser o id 1 (ver abaixo).
 * Sem --aplicar, tudo roda numa transação desfeita no final.
 *
 *   npm run db:semear:tipos -- jeancar             # simula
 *   npm run db:semear:tipos -- jeancar --aplicar   # grava
 */
import { DATABASE_KEYS, connectDatabase, loadDatabaseConfigs, type DatabaseKey } from "./lib";

/** A mesma lista que a HG recebeu, organizada por sistema do veículo e por insumo da oficina. */
const GRUPOS_PRODUTO = [
  "MOTOR",
  "INJEÇÃO ELETRÔNICA",
  "IGNIÇÃO",
  "ARREFECIMENTO",
  "AR CONDICIONADO/CLIMATIZAÇÃO",
  "LUBRIFICANTES E FLUIDOS",
  "FILTROS",
  "TRANSMISSÃO",
  "EMBREAGEM",
  "DIFERENCIAL E EIXOS",
  "DIREÇÃO",
  "SUSPENSÃO",
  "FREIOS",
  "PNEUS E RODAS",
  "ESCAPAMENTO",
  "ELÉTRICA",
  "BATERIAS",
  "ILUMINAÇÃO/SINALIZAÇÃO",
  "SENSORES E ATUADORES",
  "INSTRUMENTOS DE MEDIÇÃO",
  "DIAGNÓSTICO E SCANNER",
  "CARROCERIA/LATARIA",
  "VIDROS/RETROVISORES",
  "INTERIOR/ACABAMENTOS",
  "JUNTAS/RETENTORES/O-RINGS",
  "CORREIAS/TENSORES",
  "CABOS E MANGUEIRAS",
  "FIXADORES/PARAFUSOS",
  "COLAS E SELANTES",
  "ADITIVOS E QUÍMICOS",
  "ESTÉTICA/LIMPEZA",
  "MATERIAIS/PINTURA",
  "ABRASIVOS/LIXAS",
  "FERRAMENTAS MANUAIS",
  "FERRAMENTAS ELÉTRICAS/PNEUMÁTICAS",
  "EQUIPAMENTOS DE OFICINA",
  "EPI/SEGURANÇA",
  "ORGANIZAÇÃO/ARMAZENAGEM",
  "ACESSÓRIOS",
  "OUTROS",
];

/**
 * produto.unidade é o enum unidade_medida: sigla fora dele aparece no cadastro
 * e quebra ao salvar o produto. Por isso as siglas vêm do enum do banco, e esta
 * lista só dá a descrição.
 */
const DESCRICAO_UNIDADE: Record<string, string> = {
  UN: "UNIDADE",
  JGO: "JOGO",
  KIT: "KIT",
  PAR: "PAR",
  CX: "CAIXA",
  PCT: "PACOTE",
};

/** As cores da tabela do RENAVAM, no masculino como os outros clientes já usam. */
const CORES_VEICULOS = [
  "AMARELO",
  "AZUL",
  "BEGE",
  "BRANCO",
  "CINZA",
  "DOURADO",
  "GRENÁ",
  "LARANJA",
  "MARROM",
  "PRATA",
  "PRETO",
  "ROSA",
  "ROXO",
  "VERDE",
  "VERMELHO",
  "FANTASIA",
];

const argumentos = process.argv.slice(2);
const aplicar = argumentos.includes("--aplicar");
const chave = argumentos.find((arg) => !arg.startsWith("--")) as DatabaseKey | undefined;

async function main() {
  if (!chave || !DATABASE_KEYS.includes(chave)) {
    throw new Error(`Informe o banco: ${DATABASE_KEYS.join(", ")}`);
  }
  const banco = loadDatabaseConfigs().find((item) => item.key === chave)!;
  const { client } = await connectDatabase(banco);
  try {
    await client.query("begin");

    const grupos = await client.query<{ nome: string }>(
      `insert into public.produtogrupo (nome)
       select g.nome from unnest($1::text[]) with ordinality g(nome, ordem)
       where not exists (select 1 from public.produtogrupo p where upper(p.nome) = upper(g.nome))
       order by g.ordem
       returning nome`,
      [GRUPOS_PRODUTO],
    );
    const siglas = (
      await client.query<{ sigla: string }>(
        `select enumlabel sigla from pg_enum where enumtypid = 'public.unidade_medida'::regtype order by enumsortorder`,
      )
    ).rows.map((linha) => linha.sigla);
    // produto.tipo_unidade_id tem default 1 e FK para unidademedida: sem a
    // linha 1, nenhum produto novo salva. Com a tabela vazia, a UN fica com ela.
    const { rows: [{ vazia }] } = await client.query<{ vazia: boolean }>(
      `select not exists (select 1 from public.unidademedida) vazia`,
    );
    if (vazia) await client.query(`alter table public.unidademedida alter column id restart with 1`);
    const unidades = await client.query<{ sigla: string }>(
      `insert into public.unidademedida (sigla, descricao)
       select u.sigla, u.descricao from unnest($1::text[], $2::text[]) with ordinality u(sigla, descricao, ordem)
       where not exists (select 1 from public.unidademedida m where upper(m.sigla) = upper(u.sigla))
       order by u.ordem
       returning sigla`,
      [siglas, siglas.map((sigla) => DESCRICAO_UNIDADE[sigla] ?? null)],
    );
    const { rows: [{ um }] } = await client.query<{ um: string | null }>(
      `select (select sigla from public.unidademedida where id = 1) um`,
    );
    if (!um) {
      console.warn("  atenção: não há unidade com id 1 — produto novo não salva (default de produto.tipo_unidade_id)");
    }
    const cores = await client.query<{ nome: string }>(
      `insert into public.cores_veiculos (nome)
       select c.nome from unnest($1::text[]) with ordinality c(nome, ordem)
       where not exists (select 1 from public.cores_veiculos v where upper(v.nome) = upper(c.nome))
       order by c.ordem
       returning nome`,
      [CORES_VEICULOS],
    );

    console.log(`${banco.label}:`);
    console.log(`  grupos de produto: ${grupos.rowCount} novos de ${GRUPOS_PRODUTO.length}`);
    console.log(`  unidades de medida: ${unidades.rowCount} novas de ${siglas.length}`);
    console.log(`  cores de veículo: ${cores.rowCount} novas de ${CORES_VEICULOS.length}`);

    await client.query(aplicar ? "commit" : "rollback");
    console.log(aplicar ? "Gravado." : "Simulação desfeita. Rode com --aplicar para gravar.");
  } catch (erro) {
    await client.query("rollback").catch(() => undefined);
    throw erro;
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
