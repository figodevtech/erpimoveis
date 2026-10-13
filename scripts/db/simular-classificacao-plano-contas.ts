/**
 * Fase 0, passo final: aplica o catálogo e o motor de sugestão ao inventário
 * lido dos três bancos e produz o mapa de migração por cliente.
 *
 * Uso:
 *   npm run db:inventario:dre       # gera/atualiza o inventário
 *   npm run db:simular:plano-contas # lê o inventário e simula
 *
 * Não toca em banco nenhum: lê os JSON de `artifacts/captures/dre-plano-contas/`
 * produzidos pelo inventário. Simulação é papel, não escrita.
 *
 * O relatório separa três coisas que costumam ser confundidas:
 *   - PRESERVA  — a proposta leva ao mesmo destino de hoje;
 *   - CORRIGE   — leva a destino diferente, com certeza alta (é o conserto);
 *   - REVISAR   — certeza insuficiente ou mudança de destino sem certeza alta.
 *
 * Nada aqui aprova migração. Uma conta com transações que muda de destino
 * precisa de decisão registrada antes de qualquer aplicação.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { classificacaoPorCodigo } from "../../src/lib/financeiro/plano-contas/catalogo";
import {
  sugerirClassificacaoConta,
  sugerirClassificacaoGrupo,
  type Certeza,
} from "../../src/lib/financeiro/plano-contas/sugestao";
import { DATABASE_KEYS, projectRoot } from "./lib";

const BANCOS = DATABASE_KEYS;

type Grupo = {
  id: number;
  codigo: string | null;
  nome: string;
  ativo: boolean;
  contas: number;
  transacoes: number;
  mapeamentos: number;
  exclui: boolean | null;
  linha_codigo: string | null;
};

type Conta = {
  id: number;
  codigo: string | null;
  nome: string;
  ativo: boolean;
  grupo_id: number;
  grupo_nome: string;
  transacoes: number;
};

type Situacao = "PRESERVA" | "CORRIGE" | "REVISAR" | "PENDENTE";

type LinhaProposta = {
  contaId: number;
  conta: string;
  grupo: string;
  transacoes: number;
  destinoAtual: string;
  classificacao: string | null;
  destinoProposto: string;
  certeza: Certeza;
  situacao: Situacao;
  justificativa: string;
};

/** Como a conta é classificada hoje: pelo mapeamento do grupo dela. */
function destinoAtual(grupo: Grupo | undefined) {
  if (!grupo) return "SEM GRUPO";
  if (!grupo.mapeamentos) return "SEM DESTINO";
  if (grupo.exclui) return "FORA DA DRE";
  return grupo.linha_codigo ?? "SEM DESTINO";
}

/** Para onde a proposta leva: linha de detalhe, exclusão explícita ou pendência. */
function destinoProposto(codigo: string | null) {
  if (!codigo) return "PENDENTE";
  const classificacao = classificacaoPorCodigo(codigo);
  if (!classificacao) return "PENDENTE";
  return classificacao.tratamento === "PATRIMONIAL" ? "FORA DA DRE" : (classificacao.linhaCodigo ?? "PENDENTE");
}

function situacaoDe(atual: string, proposto: string, certeza: Certeza): Situacao {
  if (proposto === "PENDENTE") return "PENDENTE";
  if (atual === proposto) return certeza === "ALTA" ? "PRESERVA" : "REVISAR";
  return certeza === "ALTA" ? "CORRIGE" : "REVISAR";
}

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

function simular(banco: string) {
  const arquivo = path.join(
    projectRoot,
    "artifacts",
    "captures",
    "dre-plano-contas",
    `inventario-${banco}.json`,
  );
  if (!fs.existsSync(arquivo)) {
    throw new Error(
      `Inventário de ${banco} não encontrado. Rode "npm run db:inventario:dre" antes de simular.`,
    );
  }

  const inventario = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Record<string, unknown>;
  for (const chave of ["grupos", "contas"]) {
    if (!Array.isArray(inventario[chave])) {
      // Consulta que falhou virou objeto de erro. Simular em cima disso
      // produziria um mapa que parece completo e não é.
      throw new Error(`Inventário de ${banco} não tem "${chave}" utilizável: ${JSON.stringify(inventario[chave])}`);
    }
  }

  const grupos = inventario.grupos as Grupo[];
  const contas = inventario.contas as Conta[];
  const porId = new Map(grupos.map((g) => [g.id, g]));

  const linhas: LinhaProposta[] = contas.map((conta) => {
    const grupo = porId.get(conta.grupo_id);
    const sugestao = sugerirClassificacaoConta({ contaNome: conta.nome, grupoNome: conta.grupo_nome });
    const atual = destinoAtual(grupo);
    const proposto = destinoProposto(sugestao.classificacao);
    return {
      contaId: conta.id,
      conta: conta.nome,
      grupo: conta.grupo_nome,
      transacoes: Number(conta.transacoes ?? 0),
      destinoAtual: atual,
      classificacao: sugestao.classificacao,
      destinoProposto: proposto,
      certeza: sugestao.certeza,
      situacao: situacaoDe(atual, proposto, sugestao.certeza),
      justificativa: sugestao.justificativa,
    };
  });

  const propostasDeGrupo = grupos.map((grupo) => {
    const sugestao = sugerirClassificacaoGrupo(grupo.nome);
    return {
      grupoId: grupo.id,
      grupo: grupo.nome,
      contas: Number(grupo.contas ?? 0),
      transacoes: Number(grupo.transacoes ?? 0),
      destinoAtual: destinoAtual(grupo),
      classificacao: sugestao.classificacao,
      destinoProposto: destinoProposto(sugestao.classificacao),
      certeza: sugestao.certeza,
      justificativa: sugestao.justificativa,
    };
  });

  return { banco, label: String(inventario.label ?? banco), linhas, grupos: propostasDeGrupo };
}

function relatorio(simulacoes: ReturnType<typeof simular>[]) {
  const partes: string[] = [];
  partes.push("# Simulação da migração de classificação — Entrega A\n");
  partes.push(`Gerada em ${new Date().toISOString()}. Nenhum banco foi alterado.\n`);
  partes.push(
    "PRESERVA = mesmo destino de hoje, com certeza alta. CORRIGE = destino diferente, com certeza alta. " +
      "REVISAR = certeza insuficiente para aplicar sozinha. PENDENTE = sem classificação proposta, por decisão.\n",
  );

  partes.push("\n## Resumo por banco\n");
  partes.push("| Banco | Contas | Preserva | Corrige | Revisar | Pendente | Contas com transações a revisar |");
  partes.push("|---|---:|---:|---:|---:|---:|---:|");
  for (const s of simulacoes) {
    const conta = (situacao: Situacao) => s.linhas.filter((l) => l.situacao === situacao).length;
    const comUso = s.linhas.filter(
      (l) => l.transacoes > 0 && (l.situacao === "REVISAR" || l.situacao === "PENDENTE"),
    ).length;
    partes.push(
      `| ${s.label} | ${s.linhas.length} | ${conta("PRESERVA")} | ${conta("CORRIGE")} | ${conta("REVISAR")} | ${conta("PENDENTE")} | ${comUso} |`,
    );
  }

  partes.push("\n## Correções propostas com certeza alta\n");
  partes.push("Mudam o destino atual. Cada uma precisa de decisão registrada antes de aplicar.\n");
  for (const s of simulacoes) {
    const corrige = s.linhas.filter((l) => l.situacao === "CORRIGE").sort((a, b) => b.transacoes - a.transacoes);
    partes.push(`\n### ${s.label} — ${corrige.length} conta(s)\n`);
    if (!corrige.length) {
      partes.push("Nenhuma.");
      continue;
    }
    partes.push("| Conta | Grupo | Transações | Hoje | Proposta | Classificação |");
    partes.push("|---|---|---:|---|---|---|");
    for (const l of corrige) {
      partes.push(
        `| ${l.conta} | ${l.grupo} | ${l.transacoes} | ${l.destinoAtual} | ${l.destinoProposto} | ${l.classificacao} |`,
      );
    }
  }

  partes.push("\n## Contas que exigem revisão e já têm lançamentos\n");
  partes.push("Ordenadas por uso. São as decisões que mudam números publicados.\n");
  for (const s of simulacoes) {
    const revisar = s.linhas
      .filter((l) => (l.situacao === "REVISAR" || l.situacao === "PENDENTE") && l.transacoes > 0)
      .sort((a, b) => b.transacoes - a.transacoes);
    partes.push(`\n### ${s.label} — ${revisar.length} conta(s)\n`);
    if (!revisar.length) {
      partes.push("Nenhuma.");
      continue;
    }
    partes.push("| Conta | Grupo | Transações | Hoje | Proposta | Certeza | Por quê |");
    partes.push("|---|---|---:|---|---|---|---|");
    for (const l of revisar) {
      partes.push(
        `| ${l.conta} | ${l.grupo} | ${l.transacoes} | ${l.destinoAtual} | ${l.destinoProposto} | ${l.certeza} | ${l.justificativa} |`,
      );
    }
  }

  partes.push("\n## Grupos: classificação padrão proposta\n");
  for (const s of simulacoes) {
    partes.push(`\n### ${s.label}\n`);
    if (!s.grupos.length) {
      partes.push("Sem grupos cadastrados.");
      continue;
    }
    partes.push("| Grupo | Contas | Hoje | Proposta | Certeza | Observação |");
    partes.push("|---|---:|---|---|---|---|");
    for (const g of s.grupos) {
      partes.push(
        `| ${g.grupo} | ${g.contas} | ${g.destinoAtual} | ${g.destinoProposto} | ${g.certeza} | ${g.justificativa} |`,
      );
    }
  }

  return `${partes.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2).filter((a) => (BANCOS as readonly string[]).includes(a));
  const bancos = args.length ? args : [...BANCOS];

  const simulacoes = bancos.map(simular);
  const destino = path.join(projectRoot, "artifacts", "captures", "dre-plano-contas");
  fs.mkdirSync(destino, { recursive: true });

  fs.writeFileSync(
    path.join(destino, "simulacao.json"),
    `${JSON.stringify(simulacoes, null, 2)}\n`,
    "utf8",
  );

  const markdown = relatorio(simulacoes);
  fs.writeFileSync(path.join(destino, "simulacao.md"), markdown, "utf8");

  const hash = crypto.createHash("sha256").update(JSON.stringify(simulacoes)).digest("hex");
  fs.writeFileSync(
    path.join(destino, "simulacao.hash"),
    `${hash}  ${new Date().toISOString()}\n`,
    "utf8",
  );

  // Totais no terminal; o detalhe fica no arquivo.
  for (const s of simulacoes) {
    const conta = (situacao: Situacao) => s.linhas.filter((l) => l.situacao === situacao).length;
    const usoRevisar = s.linhas
      .filter((l) => (l.situacao === "REVISAR" || l.situacao === "PENDENTE") && l.transacoes > 0)
      .reduce((total, l) => total + l.transacoes, 0);
    console.log(
      `${s.label.padEnd(16)} contas=${String(s.linhas.length).padStart(3)}  preserva=${String(conta("PRESERVA")).padStart(3)}  corrige=${String(conta("CORRIGE")).padStart(3)}  revisar=${String(conta("REVISAR")).padStart(3)}  pendente=${String(conta("PENDENTE")).padStart(3)}  transações a decidir=${moeda(usoRevisar).replace(",00", "")}`,
    );
  }
  console.log(`\nRelatório: artifacts/captures/dre-plano-contas/simulacao.md`);
  console.log(`Hash da simulação: ${hash.slice(0, 16)}`);
}

main();
