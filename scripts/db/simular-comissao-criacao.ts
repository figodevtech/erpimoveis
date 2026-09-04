/**
 * Quanto a comissao por criacao teria pago, sem gravar nada.
 *
 * A regra e nova e o numero precisa ser conferido contra a expectativa de quem
 * combinou o arranjo — antes de qualquer percentual ser preenchido em producao.
 * Rodar isto primeiro separa erro de formula de erro de expectativa, que e onde
 * este tipo de regra costuma se perder.
 *
 * SOMENTE LEITURA. Nao escreve, nao chama funcao que escreve, e nao depende de
 * a migration ter sido aplicada: a conta e refeita aqui com a mesma expressao
 * de `recalcular_comissao_criacao_os`.
 *
 * Uso:
 *   npm run db:simular:comissao-criacao -- --banco=demir --usuario=<uuid> \
 *     --de=2026-08-01 --ate=2026-08-31 --servicos=1 --produtos=0.5
 *
 *   --somente-comissionaveis   conta so servicos com gera_comissao
 *   --usuario pode ser repetido; sem ele, lista os candidatos e sai.
 */
import { connectDatabase, loadDatabaseConfigs } from "./lib";

type Argumentos = {
  banco: string;
  usuarios: string[];
  de: string;
  ate: string;
  pctServicos: number;
  pctProdutos: number;
  somenteComissionaveis: boolean;
};

type LinhaSimulada = {
  ordemservicoid: number;
  cliente: string | null;
  status: string;
  execucao_fim_em: string;
  bruto_servicos: string;
  bruto_produtos: string;
  fator: string;
  base_servicos: string;
  base_produtos: string;
};

function lerArgumentos(): Argumentos {
  const argv = process.argv.slice(2);
  const valor = (nome: string) => {
    const achado = argv.find((item) => item.startsWith(`--${nome}=`));
    return achado ? achado.slice(nome.length + 3) : "";
  };

  const numero = (nome: string, padrao: number) => {
    const bruto = valor(nome);
    if (!bruto) return padrao;
    const convertido = Number(bruto.replace(",", "."));
    if (!Number.isFinite(convertido) || convertido < 0 || convertido > 100) {
      throw new Error(`--${nome} deve ser um percentual entre 0 e 100.`);
    }
    return convertido;
  };

  return {
    banco: valor("banco") || "demir",
    usuarios: argv
      .filter((item) => item.startsWith("--usuario="))
      .map((item) => item.slice("--usuario=".length))
      .filter(Boolean),
    de: valor("de"),
    ate: valor("ate"),
    pctServicos: numero("servicos", 1),
    pctProdutos: numero("produtos", 0.5),
    somenteComissionaveis: argv.includes("--somente-comissionaveis"),
  };
}

const real = (valor: number) =>
  valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num = (valor: unknown) => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
};

/**
 * O mesmo recorte da aba Ordens da Central Pessoal e dos relatorios de comissao:
 * OS nao excluida, em PAGAMENTO ou CONCLUIDO, com a execucao encerrada, e o
 * periodo medido por `execucao_fim_em`. Usar outro eixo aqui produziria um total
 * que nao bate com nenhuma tela.
 *
 * A conta reproduz `recalcular_comissao_criacao_os`: fator de desconto da OS
 * aplicado sobre o subtotal de cada item. Repetida de proposito — o script
 * precisa rodar antes de a migration existir.
 */
const CONSULTA = `
  WITH alvo AS (
    SELECT o.id,
           o.status::text AS status,
           o.execucao_fim_em,
           c.nomerazaosocial AS cliente,
           greatest(coalesce(o.orcamentototal, 0) - coalesce(o.valor_frete, 0), 0) AS total_sem_frete
      FROM public.ordemservico o
      LEFT JOIN public.cliente c ON c.id = o.clienteid
     WHERE o.usuariocriadorid = $1
       AND o.is_deleted = false
       AND o.status::text IN ('PAGAMENTO', 'CONCLUIDO')
       AND o.execucao_fim_em IS NOT NULL
       AND ($2::timestamptz IS NULL OR o.execucao_fim_em >= $2::timestamptz)
       AND ($3::timestamptz IS NULL OR o.execucao_fim_em < $3::timestamptz)
  ),
  somas AS (
    SELECT a.*,
           coalesce((SELECT sum(coalesce(os.subtotal, 0)) FROM public.osservico os
                      WHERE os.ordemservicoid = a.id), 0) AS servicos_todos,
           coalesce((SELECT sum(coalesce(os.subtotal, 0))
                       FROM public.osservico os
                       JOIN public.servico s ON s.id = os.servicoid
                      WHERE os.ordemservicoid = a.id
                        AND coalesce(s.gera_comissao, true)), 0) AS servicos_comissionaveis,
           coalesce((SELECT sum(coalesce(op.subtotal, 0)) FROM public.osproduto op
                      WHERE op.ordemservicoid = a.id), 0)
             + coalesce((SELECT sum(coalesce(opa.subtotal, 0)) FROM public.osproduto_avulso opa
                          WHERE opa.ordemservicoid = a.id), 0) AS produtos
      FROM alvo a
  ),
  base AS (
    SELECT s.*,
           CASE WHEN $4::boolean THEN s.servicos_comissionaveis ELSE s.servicos_todos END AS servicos_na_base,
           CASE WHEN (s.servicos_todos + s.produtos) > 0
                THEN s.total_sem_frete / (s.servicos_todos + s.produtos)
                ELSE 1 END AS fator
      FROM somas s
  )
  SELECT id AS ordemservicoid,
         cliente,
         status,
         to_char(execucao_fim_em AT TIME ZONE 'America/Fortaleza', 'DD/MM/YYYY') AS execucao_fim_em,
         round(servicos_na_base, 2)::text AS bruto_servicos,
         round(produtos, 2)::text AS bruto_produtos,
         round(fator, 6)::text AS fator,
         round(servicos_na_base * fator, 2)::text AS base_servicos,
         round(produtos * fator, 2)::text AS base_produtos
    FROM base
   ORDER BY execucao_fim_em, id;
`;

async function main() {
  const args = lerArgumentos();
  const config = loadDatabaseConfigs().find((item) => item.key === args.banco);
  if (!config) {
    throw new Error(
      `Banco "${args.banco}" desconhecido. Use --banco= com uma das chaves de scripts/db/lib.ts.`,
    );
  }

  const { client } = await connectDatabase(config);
  try {
    if (args.usuarios.length === 0) {
      const { rows } = await client.query(
        `SELECT u.id, u.nome, u.email, count(o.id) AS ordens
           FROM public.usuario u
           JOIN public.ordemservico o ON o.usuariocriadorid = u.id AND o.is_deleted = false
          GROUP BY u.id, u.nome, u.email
         HAVING count(o.id) > 0
          ORDER BY count(o.id) DESC
          LIMIT 20;`,
      );
      console.log(`\n${config.label} — quem cria OS (informe um com --usuario=<id>):\n`);
      for (const linha of rows) {
        console.log(`  ${linha.id}  ${String(linha.nome).padEnd(28)} ${linha.ordens} OS`);
      }
      console.log("");
      return;
    }

    const inicio = args.de ? `${args.de}T00:00:00-03:00` : null;
    // Intervalo semiaberto: o dia final entra inteiro. Mesma regra de
    // `src/lib/meu-perfil/regras.ts`.
    const fim = args.ate
      ? new Date(new Date(`${args.ate}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
      : null;

    for (const usuarioId of args.usuarios) {
      const { rows: dono } = await client.query(
        "SELECT nome, comissao_percent FROM public.usuario WHERE id = $1",
        [usuarioId],
      );
      if (dono.length === 0) {
        console.error(`\nUsuário ${usuarioId} não existe em ${config.label}.\n`);
        continue;
      }

      const { rows } = await client.query<LinhaSimulada>(CONSULTA, [
        usuarioId,
        inicio,
        fim,
        args.somenteComissionaveis,
      ]);

      console.log(
        `\n${config.label} — ${dono[0].nome} · ${args.pctServicos}% serviços / ${args.pctProdutos}% produtos` +
          (args.somenteComissionaveis ? " · só serviços comissionáveis" : " · todos os serviços"),
      );
      console.log(
        `Período por execucao_fim_em: ${args.de || "início"} até ${args.ate || "hoje"}\n`,
      );

      if (rows.length === 0) {
        console.log("  Nenhuma OS finalizada deste criador no período.\n");
        continue;
      }

      console.log(
        "   OS        Fim         Base serviços     Base produtos       Comissão   Cliente",
      );

      let totalServicos = 0;
      let totalProdutos = 0;
      let totalComissao = 0;
      let comDesconto = 0;

      for (const linha of rows) {
        const baseServicos = num(linha.base_servicos);
        const baseProdutos = num(linha.base_produtos);
        const valorServicos = Math.round(baseServicos * args.pctServicos) / 100;
        const valorProdutos = Math.round(baseProdutos * args.pctProdutos) / 100;
        const comissao = valorServicos + valorProdutos;

        totalServicos += valorServicos;
        totalProdutos += valorProdutos;
        totalComissao += comissao;
        if (num(linha.fator) < 0.999999) comDesconto += 1;

        console.log(
          `  #${String(linha.ordemservicoid).padEnd(8)} ${linha.execucao_fim_em}  ` +
            `${real(baseServicos).padStart(15)}   ${real(baseProdutos).padStart(15)}   ` +
            `${real(comissao).padStart(12)}   ${(linha.cliente ?? "").slice(0, 30)}`,
        );
      }

      console.log(
        `\n  ${rows.length} OS · ${comDesconto} com desconto rateado na base`,
      );
      console.log(`  Serviços: ${real(totalServicos)}`);
      console.log(`  Produtos: ${real(totalProdutos)}`);
      console.log(`  TOTAL:    ${real(totalComissao)}\n`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
