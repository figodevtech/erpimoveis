/**
 * Carga dos titulos em aberto do DATASYSTEM no banco do Demir.
 *
 * Uso:
 *   npm run migracao:demir:financeiro -- --pagar               -> simulacao (termina em ROLLBACK)
 *   npm run migracao:demir:financeiro -- --de-para             -> so as tabelas de conversao
 *   npm run migracao:demir:financeiro -- --duplicados          -> relacao de cadastros em duplicidade (so le)
 *   npm run migracao:demir:financeiro -- --pagar --aplicar     -> grava (COMMIT)
 *   npm run migracao:demir:financeiro -- --pagar --refazer --aplicar -> apaga essa carga e regrava
 *
 * --pagar e --receber escolhem o arquivo. Sem nenhum dos dois, faz os dois.
 * Cada arquivo tem trava propria: rodar --receber depois nao mexe no que ja
 * entrou por --pagar.
 *
 * O QUE ENTRA
 * Os dois CSVs exportados do DATASYSTEM sao saldo em aberto, nao historico
 * liquidado: nenhuma linha tem data de baixa nem valor recebido/pago. Por isso
 * cada titulo vira uma `transacao` com pendente = true e vencimento_em, que e
 * como o ERP representa contas a pagar e a receber.
 *
 * O QUE NAO ENTRA
 * Nenhum desses titulos entra na DRE. Eles carregam origem = 'ORIGEM_MIGRACAO' e
 * a migracao 20260805200000_dre_ignorar_saldo_de_abertura ensina o motor de
 * eventos a ignorar essa origem. O plano de contas continua preenchido, porque
 * as telas do financeiro usam ele.
 *
 * O carimbo e generico para todo cliente que migra de outro sistema; qual foi a
 * carga fica em descricao_pagamento, no formato "DATASYSTEM PAGAR #4929".
 *
 * REVERSAO
 *   DELETE FROM public.transacao WHERE origem = 'ORIGEM_MIGRACAO';
 * ou, para desfazer so um dos arquivos, filtrando tambem por
 *   descricao_pagamento LIKE 'DATASYSTEM PAGAR #%'.
 * Os clientes criados ficam com created_by nulo e status ATIVO; a lista deles e
 * impressa no relatorio para o caso de precisar remover tambem.
 */
import fs from "node:fs";
import path from "node:path";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const flags = new Set(process.argv.slice(2));
const APLICAR = flags.has("--aplicar");
const REFAZER = flags.has("--refazer");

// Carimbo unico para qualquer carga de sistema anterior, de qualquer cliente.
// E ele que a migracao do DRE procura para manter a carga fora do resultado.
const ORIGEM = "ORIGEM_MIGRACAO";

// Sem --pagar nem --receber, faz os dois.
const SO_PAGAR = flags.has("--pagar");
const SO_RECEBER = flags.has("--receber");
const FAZ_PAGAR = SO_PAGAR || !SO_RECEBER;
const FAZ_RECEBER = SO_RECEBER || !SO_PAGAR;

// Identifica a carga dentro da origem generica, para trava e reversao por arquivo.
const marcador = (fonte: "RECEBER" | "PAGAR") => `DATASYSTEM ${fonte} #`;

/**
 * Carga complementar: grava so o que ainda nao existe, em vez de recusar ou
 * apagar tudo.
 *
 * A trava original e por arquivo inteiro — encontrou linha da carga, ou aborta
 * ou (com --refazer) apaga as 600 e regrava. Isso servia quando o CSV era o
 * retrato completo. Deixou de servir quando o DATASYSTEM passou a exportar o
 * complemento: o rabo vencido que ficou fora da primeira exportacao. Regravar
 * levaria junto as baixas que a operadora ja fez no ERP.
 *
 * Aqui a comparacao e titulo a titulo, pelo marcador, que e unico. Rodar duas
 * vezes o mesmo arquivo nao duplica nada.
 */
const SOMENTE_NOVOS = flags.has("--somente-novos");

/**
 * Entra sem plano de conta e sem centro de custo.
 *
 * Nao mexe nas tabelas de conversao — elas continuam valendo para as cargas que
 * as usam. Quando a classificacao vai ser feita no ERP, titulo a titulo, chutar
 * um plano na carga so cria trabalho de correcao.
 */
const SEM_CLASSIFICACAO = flags.has("--sem-classificacao");

/**
 * Aponta o CSV direto, para exportacoes que nao seguem o nome antigo.
 * Exige --pagar ou --receber: com os dois, nao daria para saber qual arquivo e.
 */
const ARQUIVO =
  [...flags].find((flag) => flag.startsWith("--arquivo="))?.slice("--arquivo=".length) ?? null;

/** O que identifica um titulo dentro da carga; e a chave da comparacao. */
const marcadorDoTitulo = (titulo: { fonte: "RECEBER" | "PAGAR"; registro: string; parcelaTexto: string }) =>
  `${marcador(titulo.fonte)}${titulo.registro}${titulo.parcelaTexto ? ` parcela ${titulo.parcelaTexto}` : ""}`;

// --simular-regra aplica a migracao do DRE dentro da propria transacao de teste,
// so para medir o efeito dela antes de aplica-la de verdade. Como a transacao
// termina em ROLLBACK, nem a regra nem a carga sobrevivem. Recusado junto com
// --aplicar: alteracao de regra so entra pelo processo de migration.
const SIMULAR_REGRA = flags.has("--simular-regra");
const MIGRACAO_REGRA = "supabase/migrations/20260805200000_dre_ignorar_saldo_de_abertura.sql";

// ---------------------------------------------------------------------------
// Conversao de plano de contas
//
// Os dois sistemas usam a mesma forma de codigo com significados diferentes:
// no DATASYSTEM "1.1" e RECEITA COM VENDAS, no ERP e Mao de obra mecanica. Por
// isso a conversao e pelo rotulo inteiro, nunca pelo codigo.
//
// O valor a direita e o `codigo` em public.planosdeconta. `null` deixa o titulo
// sem plano: aparece no financeiro, nao entra em relatorio por conta.
// ---------------------------------------------------------------------------

type Conversao = { para: string | null; conferir?: string };

const PLANO_PAGAR: Record<string, Conversao> = {
  "2.47 - EMPRESTIMO BANCARIO": { para: "9.4" }, // Pagamento de emprestimos
  "2.31 - DESPESAS COM COMPRA DE PRODUTOS": { para: "2.1" }, // Compra de pecas para revenda
  "2.15 - DESPESAS BANCÁRIAS": {
    para: "6.1", // Tarifas bancarias
    conferir:
      "10 titulos somando R$ 175.000 - valor alto demais para tarifa. Se for desconto de duplicata na HR FACTORING, o certo e 6.5 (Antecipacao de recebiveis).",
  },
  "2.2 - ENCARGOS SOCIAIS": { para: "3.5" }, // Encargos trabalhistas
  "2.22 - SERVIÇOS TERCEIRIZADOS": { para: "2.5" }, // Servicos terceirizados
  "2.5 - PESSOAL": { para: "3.1" }, // Salarios
  "2.18 - ASSESSORIAS": {
    para: "4.13", // Contabilidade
    conferir:
      "13 titulos, R$ 35.000. Se a assessoria for juridica e nao contabil, o certo e 4.14.",
  },
  "2.11 - VALE TRANSPORTE - PIX": { para: "3.6" }, // Beneficios
  "2.17 - VEÍCULOS": {
    para: "4.9", // Combustiveis e deslocamentos
    conferir:
      "5 titulos, R$ 24.750. Se for financiamento ou compra de veiculo da empresa, o certo e 8.6.",
  },
  "2.33 - SOFTWARE/TI": { para: "4.12" }, // Sistemas e softwares
  "2.27 - DESPESAS GERAIS/OUTROS": { para: "4.17" }, // Despesas diversas da oficina
  "2.7 - MATERIAL DE EXPEDIENTE E CONSUMO": { para: "4.6" }, // Materiais de escritorio
  "2.25 - AQUISIÇÃO DE BENS/ATIVO FIXO": {
    para: "8.4", // Computadores e equipamentos
    conferir: "6 titulos, R$ 9.702. O rotulo nao diz que bem e; pode ser 8.2, 8.3 ou 8.5.",
  },
  "2.6 - SEGUROS": { para: "4.10" }, // Seguros
  "2.32 - INVESTIMENTOS": {
    para: null,
    conferir:
      "5 titulos, R$ 8.055. 'Investimentos' pode ser imobilizado (grupo 8) ou aplicacao financeira (grupo 7). Deixei sem plano ate voce dizer qual.",
  },
  "2.48 - DEVOLUÇÃO": { para: "9.8" }, // Estornos e ajustes financeiros
  "2.41 - ICMS FRONTEIRA": { para: "5.2" }, // ICMS
  "2.3 - BENEFÍCIOS": { para: "3.6" }, // Beneficios
  "2.51 - RETIRADA/TRANSF": { para: "9.2" }, // Retirada de socios
  "2.1 - REMUNERAÇÃO": { para: "3.1" }, // Salarios
  "2.45 - IMOBILIZADO": {
    para: "8.5", // Moveis e instalacoes
    conferir: "5 titulos, R$ 4.706. Mesmo problema de 2.25: o rotulo nao diz o bem.",
  },
  "2.40 - IPTU": { para: "5.5" }, // Taxas municipais e alvaras
  "2.14 - CONCESSIONÁRIAS": {
    para: "4.2", // Energia eletrica
    conferir:
      "17 titulos, R$ 2.881. 'Concessionarias' costuma misturar energia, agua e telefone (4.2, 4.3, 4.4).",
  },
  "2.57 - DESP. COLABORADORES": { para: "3.6" }, // Beneficios
};

const PLANO_RECEBER: Record<string, Conversao> = {
  // 308 titulos, R$ 1,2 milhao. No DATASYSTEM era uma conta so; no ERP a receita
  // e separada entre mao de obra (1.1), servicos de reparo (1.15, 1.16) e venda
  // de pecas (1.9). A carteira mistura os tres - os historicos falam de reparo de
  // modulo, programacao e venda de modulo usado - e nao ha no CSV nada que separe
  // um do outro. Decisao do dono do produto em 2026-08-05: nao chutar. Os titulos
  // entram sem plano, e a classificacao correta e feita no ERP, titulo a titulo,
  // por quem sabe o que foi vendido.
  "1.1 - RECEITA COM VENDAS": { para: null },
  "1.2 - RECEITA COM DEVOLUÇÃO DE VENDAS": { para: "9.8" }, // Estornos e ajustes
};

// ---------------------------------------------------------------------------
// Conversao de centro de resultado -> nome em public.centrosdecusto
// ---------------------------------------------------------------------------

const CENTRO: Record<string, Conversao> = {
  "1 - OFICINA": { para: "OFICINA" },
  OFICINA: { para: "OFICINA" },
  "2 - SALA DE REPAROS/MODULO": { para: "SALA DE REPARO DE MÓDULOS E PAINÉIS" },
  "SALA PROGRAMAÇÃO": { para: "SALA DE PROGRAMAÇÃO" },
  "9 - ESTOQUE SALA MODULO": { para: "ESTOQUE" },
  "5 - VENDAS": { para: "VENDAS" },
  VENDAS: { para: "VENDAS" },
  GERAL: { para: "GERAL" },
  FINANCEIRO: { para: "FINANCEIRO" },
  "COMPRA MERC REVENDA": { para: "COMPRAS" },
  "MAT USO/CONSUMO VENDAS": {
    para: "ESTOQUE",
    conferir: "32 titulos. Material de uso e consumo pode ser COMPRAS em vez de ESTOQUE.",
  },
  "SERV TERCEIRIZADO/REPAROS": {
    para: null,
    conferir:
      "31 titulos. O ERP tem dois centros de terceirizado (ERLON e NETO) e o CSV nao diz qual.",
  },
  "DESP PESSOA FISICA": {
    para: null,
    conferir:
      "15 titulos. 'Despesa pessoa fisica' e natureza do favorecido, nao setor; nenhum centro do ERP corresponde.",
  },
};

// ---------------------------------------------------------------------------
// Conversao de banco -> titulo em public.bancoconta
// ---------------------------------------------------------------------------

const BANCO: Record<string, Conversao> = {
  "BANCO DO BRASIL": { para: "BANCO DO BRASIL" },
  ITAU: { para: "ITAU" },
  SANTANDER: { para: "SANTANDER" },
  "HR FACTORING": { para: "HR FACTORING" },
  "BANCO INTER": { para: "INTER" },
  "EDMIR SANTANDER": {
    para: "PESSOA FISICA",
    conferir: "1 titulo. Conta pessoal do socio; se for a conta Santander da empresa, troque para SANTANDER.",
  },
};

// Forma de pagamento -> enum metodo_pagamento.
// CHEQUE nao existe no enum do ERP, entao fica nulo.
const METODO: Record<string, string | null> = {
  "BOLETO BANCARIO": "BOLETO",
  "BOLETO ANTECIPADO": "BOLETO",
  BOLETO: "BOLETO",
  PIX: "PIX",
  "CARTAO CREDITO": "CREDITO",
  TRANSFERENCIA: "TRANSFERENCIA",
  "DEPOSITO BANCARIO": "TRANSFERENCIA",
  "CHEQUE A VISTA": null,
  RECIBO: null,
  DUPLICATA: null,
};

// ---------------------------------------------------------------------------
// Leitura dos CSVs
// ---------------------------------------------------------------------------

type Linha = Record<string, string>;

function lerCsv(arquivo: string): Linha[] {
  // O DATASYSTEM exporta em Windows-1252, separado por ponto e virgula.
  const texto = fs.readFileSync(arquivo, "latin1").replace(/\r/g, "");
  const linhas = texto.split("\n").filter((linha) => linha.trim().length);
  // Alguns exports marcam a coluna ordenada com "> " na frente ("> Vencimento").
  // Como as colunas sao lidas pelo nome, o prefixo faria `linha["Vencimento"]`
  // vir vazio e os titulos entrarem sem vencimento, sem erro nenhum.
  const cabecalho = linhas[0].split(";").map((coluna) => coluna.replace(/^[\s>]+/, "").trim());

  return linhas.slice(1).map((linha) => {
    const celulas = linha.split(";");
    const registro: Linha = {};
    cabecalho.forEach((coluna, indice) => {
      registro[coluna] = (celulas[indice] ?? "").trim();
    });
    return registro;
  });
}

function acharCsv(prefixo: string) {
  const pasta = path.join(projectRoot, "docs", "migracao_demir");
  const encontrado = fs
    .readdirSync(pasta)
    .find((arquivo) => arquivo.startsWith(prefixo) && arquivo.endsWith(".csv"));
  if (!encontrado) {
    throw new Error(`Nao encontrei o CSV "${prefixo}..." em docs/migracao_demir.`);
  }
  return path.join(pasta, encontrado);
}

/** O arquivo de uma fonte: o de --arquivo, quando dado, ou o do nome de sempre. */
function arquivoDaFonte(fonte: "RECEBER" | "PAGAR") {
  if (!ARQUIVO) {
    return acharCsv(fonte === "PAGAR" ? "CONTAS A PAGAR" : "CONTAS A RECEBER");
  }
  if (FAZ_PAGAR && FAZ_RECEBER) {
    throw new Error("--arquivo aponta um CSV so: use junto com --pagar ou --receber.");
  }
  const caminho = path.isAbsolute(ARQUIVO) ? ARQUIVO : path.join(projectRoot, ARQUIVO);
  if (!fs.existsSync(caminho)) {
    throw new Error(`Nao encontrei o CSV informado em --arquivo: ${caminho}`);
  }
  return caminho;
}

const dinheiro = (texto: string) => {
  if (!texto) return 0;
  const valor = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(valor) ? valor : 0;
};

const dataIso = (texto: string) => {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto ?? "");
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : null;
};

/**
 * Meia-noite no horario do Brasil, nao em UTC.
 *
 * A sessao do banco roda em UTC e as telas formatam em America/Fortaleza
 * (UTC-3). Gravar "2024-12-23" vira 2024-12-23 00:00+00, que no Brasil e
 * 2024-12-22 21:00 — e a tela mostra o dia anterior. As transacoes que ja
 * existiam no Demir gravam 03:00 UTC, exatamente meia-noite daqui; o sufixo
 * -03:00 reproduz essa convencao.
 */
const meiaNoiteBr = (iso: string | null) => (iso ? `${iso}T00:00:00-03:00` : null);

const soDigitos = (texto: string) => (texto ?? "").replace(/\D/g, "");

// "21/32" = parcela 21 de 32. "1/0" e "1/1" sao parcela unica.
function lerParcela(texto: string) {
  const partes = /^(\d+)\/(\d+)$/.exec(texto ?? "");
  if (!partes) return { numero: 1, total: 1 };
  const numero = Math.max(Number(partes[1]) || 1, 1);
  const total = Math.max(Number(partes[2]) || 1, 1);
  // Quando o total vem menor que o proprio numero da parcela, o dado da origem
  // esta inconsistente (acontece em lancamento digitado como 1/1, 2/2, 3/3).
  // Tratar como parcela unica e melhor que inventar um acordo.
  return total < numero ? { numero: 1, total: 1 } : { numero, total };
}

// ---------------------------------------------------------------------------
// Titulos
// ---------------------------------------------------------------------------

type Titulo = {
  fonte: "RECEBER" | "PAGAR";
  registro: string;
  tipo: "RECEITA" | "DESPESA";
  /** Sem o sufixo de parcela; vira `descricao` depois do agrupamento. */
  descricaoBase: string;
  descricao: string;
  valor: number;
  emissao: string | null;
  vencimento: string | null;
  metodo: string | null;
  parcelaTexto: string;
  parcelaNumero: number;
  parcelas: number;
  /** Pedido no contas a receber, Nº Doc no contas a pagar. Usado so para acordo. */
  documento: string;
  /**
   * Carimbo de criacao compartilhado pelas parcelas do mesmo acordo. O ERP nao
   * tem coluna que agrupe parcelamento avulso: /api/transaction/[id]/contexto
   * junta as linhas por created_at exato somado a descricao terminada em
   * " - Parcela N/M". Repetir esse par e o que faz as parcelas migradas
   * aparecerem amarradas na tela, como as criadas pelo proprio ERP.
   */
  createdAt: string | null;
  planoCodigo: string | null;
  centroNome: string | null;
  bancoTitulo: string | null;
  nomePagador: string;
  documentoPagador: string;
};

const naoConvertidos = new Map<string, number>();

function converter(mapa: Record<string, Conversao>, chave: string, rotulo: string) {
  const limpa = (chave ?? "").trim();
  if (!limpa) return null;
  const encontrado = mapa[limpa];
  if (encontrado === undefined) {
    const marcador = `${rotulo}: ${limpa}`;
    naoConvertidos.set(marcador, (naoConvertidos.get(marcador) ?? 0) + 1);
    return null;
  }
  return encontrado.para;
}

/**
 * Conserta o acordo digitado como 1/1, 2/2, 3/3.
 *
 * Alguns lancamentos do DATASYSTEM tem cada parcela registrada como se fosse um
 * acordo de uma parcela so — o caso do pedido 3807 do SILVIO ROMERO, tres
 * titulos de R$ 6.000 com emissao igual e vencimento mensal. Lidos ao pe da
 * letra viram tres avulsos.
 *
 * A correcao so vale quando o conjunto e inequivoco: mesmo sacado, mesma
 * emissao, mesmo pedido/documento, todos com numero igual ao total, e os numeros
 * formando 1..K sem repetir. Dois titulos "1/1" do mesmo dia nao formam sequencia
 * e continuam avulsos, que e o caso dos 178 titulos de parcela unica legitimos.
 */
function corrigirParcelaRepetida(titulos: Titulo[]) {
  const candidatos = new Map<string, Titulo[]>();

  for (const titulo of titulos) {
    if (titulo.parcelaNumero !== titulo.parcelas) continue;
    const chave = [titulo.fonte, titulo.nomePagador.trim(), titulo.emissao, titulo.documento].join("|");
    const atual = candidatos.get(chave) ?? [];
    atual.push(titulo);
    candidatos.set(chave, atual);
  }

  let acordos = 0;
  let linhas = 0;

  for (const grupo of candidatos.values()) {
    if (grupo.length < 2) continue;

    const numeros = grupo.map((titulo) => titulo.parcelaNumero).sort((a, b) => a - b);
    const sequencia =
      new Set(numeros).size === numeros.length &&
      numeros[0] === 1 &&
      numeros[numeros.length - 1] === numeros.length;
    if (!sequencia) continue;

    // O total verdadeiro e a quantidade de parcelas do acordo; o numero de cada
    // uma ja estava certo.
    for (const titulo of grupo) titulo.parcelas = grupo.length;
    acordos += 1;
    linhas += grupo.length;
  }

  return { acordos, linhas };
}

/**
 * Amarra as parcelas de um mesmo acordo.
 *
 * O que identifica um acordo no DATASYSTEM: mesmo favorecido, mesma data de
 * emissao e mesmo total de parcelas. Conferido no arquivo — as parcelas de um
 * acordo saem com emissao identica, registros consecutivos, valor igual e
 * vencimento mensal (ex.: registros 8591..8598, emissao 30/01/2025, 13/30 a
 * 20/30). Quando o numero da parcela se repete dentro da chave, sao dois
 * acordos diferentes que colidiram, e o grupo e cortado ali.
 *
 * ATENCAO: os grupos sao incompletos de proposito. A exportacao so traz o que
 * esta em aberto, entao um emprestimo de 30 parcelas com 12 ja pagas entra com
 * 18. O numero da parcela na descricao preserva essa informacao — 13/30 continua
 * dizendo que existiram 12 antes, mesmo que elas nao estejam aqui.
 */
function amarrarParcelas(titulos: Titulo[], instante: number) {
  const corrigidas = corrigirParcelaRepetida(titulos);
  const grupos = new Map<string, Titulo[]>();

  for (const titulo of titulos) {
    if (titulo.parcelas < 2) continue;
    const chave = [titulo.fonte, titulo.nomePagador.trim(), titulo.emissao, titulo.parcelas].join("|");
    const atual = grupos.get(chave) ?? [];
    atual.push(titulo);
    grupos.set(chave, atual);
  }

  let indice = 0;
  let totalAcordos = 0;
  let linhasAmarradas = 0;

  for (const linhas of grupos.values()) {
    linhas.sort((a, b) => Number(a.registro) - Number(b.registro));

    // Corta em acordos distintos quando o numero da parcela reaparece.
    let atual: Titulo[] = [];
    const acordos: Titulo[][] = [atual];
    const vistos = new Set<number>();
    for (const titulo of linhas) {
      if (vistos.has(titulo.parcelaNumero)) {
        vistos.clear();
        atual = [];
        acordos.push(atual);
      }
      vistos.add(titulo.parcelaNumero);
      atual.push(titulo);
    }

    for (const acordo of acordos) {
      if (acordo.length < 2) continue;
      totalAcordos += 1;
      linhasAmarradas += acordo.length;

      // A descricao base tem que ser identica nas linhas do acordo: e por ela
      // que o ERP encontra as irmas. Vale a da primeira parcela.
      const base = acordo[0].descricaoBase;

      // created_at distinto por acordo. Dentro de uma transacao now() e o mesmo
      // para todas as linhas, entao sem deslocar cada acordo eles se misturariam.
      const carimbo = new Date(instante + indice).toISOString();
      indice += 1;

      for (const titulo of acordo) {
        titulo.descricaoBase = base;
        titulo.createdAt = carimbo;
      }
    }
  }

  // Parcela que ficou sozinha precisa de carimbo proprio. Sem isso ela herda o
  // now() da transacao, que e igual para todas as linhas, e duas parcelas soltas
  // de descricao parecida acabariam exibidas como se fossem o mesmo acordo.
  for (const titulo of titulos) {
    if (titulo.parcelas > 1 && titulo.createdAt === null) {
      titulo.createdAt = new Date(instante + indice).toISOString();
      indice += 1;
    }
  }

  // Sufixo em toda linha parcelada, agrupada ou nao: e o formato que o ERP le.
  for (const titulo of titulos) {
    titulo.descricao =
      titulo.parcelas > 1
        ? `${titulo.descricaoBase} - Parcela ${titulo.parcelaNumero}/${titulo.parcelas}`
        : titulo.descricaoBase;
  }

  return { acordos: totalAcordos, linhasAmarradas, corrigidas };
}

function lerReceber(): Titulo[] {
  return lerCsv(arquivoDaFonte("RECEBER")).map((linha) => {
    const historico = linha["Histórico"] || "";
    const cliente = linha["Razão Social"] || linha["Cliente"] || "SEM IDENTIFICACAO";
    const parcela = lerParcela(linha["Parcela"]);
    return {
      fonte: "RECEBER" as const,
      registro: linha["Registro"],
      tipo: "RECEITA" as const,
      // O historico e o campo livre onde o Demir descreve o servico; quando ele
      // esta vazio (78 de 333), a nota identifica o titulo.
      descricaoBase:
        historico ||
        (linha["Nota"] && linha["Nota"] !== "0"
          ? `Nota ${linha["Nota"]} - ${cliente}`
          : `Titulo ${linha["Registro"]} - ${cliente}`),
      descricao: "",
      valor: dinheiro(linha["Valor Líquido"]),
      emissao: dataIso(linha["Data Emissão"]),
      vencimento: dataIso(linha["Vencimento"]),
      metodo: METODO[linha["Pagamento"]] ?? null,
      parcelaTexto: linha["Parcela"] || "",
      parcelaNumero: parcela.numero,
      parcelas: parcela.total,
      documento: linha["Pedido"] || "",
      createdAt: null,
      planoCodigo: SEM_CLASSIFICACAO
        ? null
        : converter(PLANO_RECEBER, linha["Plano Conta"], "Plano Conta (receber)"),
      centroNome: SEM_CLASSIFICACAO
        ? null
        : converter(CENTRO, linha["Centro Resultado"], "Centro Resultado (receber)"),
      bancoTitulo: converter(BANCO, linha["Conta Boleto"], "Conta Boleto"),
      nomePagador: cliente,
      documentoPagador: soDigitos(linha["CNPJ/CPF"]) || "NÃO INFORMADO",
    };
  });
}

function lerPagar(): Titulo[] {
  return lerCsv(arquivoDaFonte("PAGAR")).map((linha) => {
    const favorecido = linha["Fornecedor/Favorecido/Transportador"] || "SEM IDENTIFICACAO";
    const historico = linha["Histórico"] || linha["Obs"] || "";
    const parcela = lerParcela(linha["Parcela"]);
    return {
      fonte: "PAGAR" as const,
      registro: linha["Registro"],
      tipo: "DESPESA" as const,
      descricaoBase:
        historico ||
        (linha["Nº Doc"]
          ? `Doc ${linha["Nº Doc"]} - ${favorecido}`
          : `Titulo ${linha["Registro"]} - ${favorecido}`),
      descricao: "",
      valor: dinheiro(linha["Valor Líquido"]),
      emissao: dataIso(linha["Data Emissão"]),
      vencimento: dataIso(linha["Vencimento"]),
      metodo: METODO[linha["Tipo Documento"]] ?? null,
      parcelaTexto: linha["Parcela"] || "",
      parcelaNumero: parcela.numero,
      parcelas: parcela.total,
      documento: linha["Nº Doc"] || "",
      createdAt: null,
      planoCodigo: SEM_CLASSIFICACAO
        ? null
        : converter(PLANO_PAGAR, linha["Plano de Contas"], "Plano de Contas (pagar)"),
      centroNome: SEM_CLASSIFICACAO
        ? null
        : converter(CENTRO, linha["Centro Resultado"], "Centro Resultado (pagar)"),
      // O contas a pagar nao traz banco: a coluna Conta vem vazia nas 609 linhas.
      bancoTitulo: null,
      nomePagador: favorecido,
      // O CSV de pagar nao traz documento do favorecido.
      documentoPagador: "NÃO INFORMADO",
    };
  });
}

// ---------------------------------------------------------------------------
// Relatorio do de-para
// ---------------------------------------------------------------------------

function imprimirDePara() {
  const bloco = (titulo: string, mapa: Record<string, Conversao>) => {
    console.log(`\n${titulo}`);
    console.log("-".repeat(titulo.length));
    for (const [de, { para, conferir }] of Object.entries(mapa)) {
      console.log(`  ${de}`);
      console.log(`      -> ${para ?? "(sem conversao - fica em branco)"}`);
      if (conferir) console.log(`      !! ${conferir}`);
    }
  };

  bloco("PLANO DE CONTAS - CONTAS A PAGAR", PLANO_PAGAR);
  bloco("PLANO DE CONTAS - CONTAS A RECEBER", PLANO_RECEBER);
  bloco("CENTRO DE RESULTADO", CENTRO);
  bloco("BANCO", BANCO);

  const pendentes = [
    ...Object.entries(PLANO_PAGAR),
    ...Object.entries(PLANO_RECEBER),
    ...Object.entries(CENTRO),
    ...Object.entries(BANCO),
  ].filter(([, conversao]) => conversao.conferir);

  console.log(`\n\n${pendentes.length} conversoes pedem sua confirmacao:`);
  pendentes.forEach(([de, conversao]) =>
    console.log(`  - ${de} -> ${conversao.para ?? "(em branco)"}`),
  );
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

/**
 * Gera as duas relacoes de conferencia em docs/migracao_demir, para revisao antes
 * da carga: quem vai ser cobrado (clientes) e quem vai ser pago (fornecedores),
 * cada um com o que ja existe no Demir e o que ainda nao.
 */
async function gerarRelacoes() {
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco do Demir nao configurado.");
  const { client } = await connectDatabase(configuracao);

  try {
    const pasta = path.join(projectRoot, "docs", "migracao_demir");

    // -- Fornecedores (contas a pagar) -------------------------------------
    const cadastrados = new Map<string, string>();
    for (const linha of (
      await client.query<{ nome: string; doc: string }>(
        "select nomerazaosocial nome, coalesce(cpfcnpj,'') doc from public.fornecedor where ativo is not false",
      )
    ).rows) {
      cadastrados.set(linha.nome.trim().toUpperCase(), linha.doc);
    }

    type Resumo = { titulos: number; total: number; proximo: string; categorias: Set<string> };
    const fornecedores = new Map<string, Resumo>();

    // A categoria do DATASYSTEM e o que separa fornecedor de verdade (compra de
    // mercadoria, servico) de emprestimo, imposto e despesa de pessoal, que estao
    // no mesmo arquivo e nao devem virar cadastro de fornecedor.
    const categoriaPorRegistro = new Map<string, string>();
    for (const linha of lerCsv(acharCsv("CONTAS A PAGAR"))) {
      categoriaPorRegistro.set(linha["Registro"], linha["Categoria"] || "(sem categoria)");
    }

    for (const titulo of lerPagar()) {
      const chave = titulo.nomePagador.trim();
      const atual =
        fornecedores.get(chave) ??
        { titulos: 0, total: 0, proximo: "9999-99-99", categorias: new Set<string>() };
      atual.titulos += 1;
      atual.total += titulo.valor;
      atual.categorias.add(categoriaPorRegistro.get(titulo.registro) ?? "(sem categoria)");
      if (titulo.vencimento && titulo.vencimento < atual.proximo) atual.proximo = titulo.vencimento;
      fornecedores.set(chave, atual);
    }

    // Só quem aparece como FORNECEDOR ou SERV TERCEIRIZADO e candidato a cadastro;
    // o resto e obrigacao financeira, tributaria ou de pessoal.
    const ehFornecedor = (categorias: Set<string>) =>
      [...categorias].some((c) => c === "FORNECEDOR" || c === "SERV TERCEIRIZADO" || c === "FRETE");

    const linhasFornecedor = [...fornecedores.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([nome, resumo]) =>
        [
          `"${nome.replace(/"/g, '""')}"`,
          resumo.titulos,
          resumo.total.toFixed(2).replace(".", ","),
          resumo.proximo === "9999-99-99" ? "" : resumo.proximo,
          `"${[...resumo.categorias].join(", ")}"`,
          !ehFornecedor(resumo.categorias)
            ? "NAO E FORNECEDOR"
            : cadastrados.has(nome.toUpperCase())
              ? "JA CADASTRADO"
              : "FALTA CADASTRAR",
          cadastrados.get(nome.toUpperCase()) ?? "",
        ].join(";"),
      );

    fs.writeFileSync(
      path.join(pasta, "relacao-fornecedores.csv"),
      [
        "Favorecido;Titulos;Total;VencimentoMaisProximo;Categorias;Situacao;CNPJ",
        ...linhasFornecedor,
      ].join("\n"),
      "latin1",
    );

    // -- Clientes (contas a receber) ---------------------------------------
    const clientes = new Map<string, number>();
    for (const linha of (
      await client.query<{ doc: string; id: number }>(
        `select regexp_replace(coalesce(cpfcnpj,''), '\\D', '', 'g') doc, id
           from public.cliente where is_deleted = false and cpfcnpj is not null`,
      )
    ).rows) {
      if (linha.doc) clientes.set(linha.doc, linha.id);
    }

    type ResumoCliente = { nome: string; titulos: number; total: number; proximo: string };
    const porCliente = new Map<string, ResumoCliente>();
    for (const titulo of lerReceber()) {
      const doc = titulo.documentoPagador;
      const atual: ResumoCliente =
        porCliente.get(doc) ?? { nome: titulo.nomePagador, titulos: 0, total: 0, proximo: "9999-99-99" };
      atual.titulos += 1;
      atual.total += titulo.valor;
      if (titulo.vencimento && titulo.vencimento < atual.proximo) atual.proximo = titulo.vencimento;
      porCliente.set(doc, atual);
    }

    const linhasCliente = [...porCliente.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([doc, resumo]) =>
        [
          doc,
          `"${resumo.nome.replace(/"/g, '""')}"`,
          doc.length > 11 ? "JURIDICA" : "FISICA",
          resumo.titulos,
          resumo.total.toFixed(2).replace(".", ","),
          resumo.proximo === "9999-99-99" ? "" : resumo.proximo,
          // Sem documento nao da para criar cadastro nem casar com quem existe:
          // o titulo entra identificado so pelo nome, em nomepagador.
          doc === "NÃO INFORMADO"
            ? "SEM DOCUMENTO - FICA SEM CLIENTE"
            : clientes.has(doc)
              ? "JA CADASTRADO"
              : "SERA CRIADO",
        ].join(";"),
      );

    fs.writeFileSync(
      path.join(pasta, "relacao-clientes.csv"),
      ["CpfCnpj;Nome;TipoPessoa;Titulos;Total;VencimentoMaisProximo;Situacao", ...linhasCliente].join("\n"),
      "latin1",
    );

    const faltaFornecedor = linhasFornecedor.filter((l) => l.includes("FALTA CADASTRAR")).length;
    const criarCliente = linhasCliente.filter((l) => l.includes("SERA CRIADO")).length;

    console.log("Relacoes geradas em docs/migracao_demir:\n");
    console.log(`  relacao-fornecedores.csv  ${fornecedores.size} favorecidos, ${faltaFornecedor} sem cadastro no ERP`);
    console.log(`  relacao-clientes.csv      ${porCliente.size} clientes, ${criarCliente} a criar`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Nome comparavel entre os dois sistemas.
 *
 * Tira acento, pontuacao e sufixo societario, porque e neles que a mesma
 * empresa se escreve de dez jeitos: "EDVAN SERVICOS MECANICOS LTDA",
 * "Edvan Servicos Mecanicos ltda." e "EDVAN SERVICOS MECANICOS" sao a mesma
 * pessoa e nenhum casamento exato as junta.
 */
const SUFIXOS = /\b(LTDA|ME|EPP|EIRELI|SA|MEI|MICROEMPRESA|MATRIZ|FILIAL)\b/g;

function nomeComparavel(texto: string) {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(SUFIXOS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Telefone que diz alguma coisa: os da carga entraram como texto fixo. */
function telefoneComparavel(texto: string | null) {
  const digitos = soDigitos(texto ?? "");
  return digitos.length >= 8 ? digitos : "";
}

/**
 * Relacao de possiveis cadastros em duplicidade, para conferencia humana.
 *
 * POR QUE ISSO EXISTE
 * A carga vincula titulo a cliente so por CPF/CNPJ exato, e o banco tem UNIQUE
 * em `cpfcnpj` e em `nomerazaosocial` — duas linhas com o mesmo documento, ou o
 * mesmo nome exato, sao impossiveis. Sobra um caso: a MESMA pessoa cadastrada
 * duas vezes com documentos diferentes ou grafia diferente. O cadastro antigo,
 * salvo pelo apelido e as vezes sem CNPJ, nao casou por documento, e a carga
 * criou um segundo cadastro com a razao social. A divida foi para o novo; o
 * antigo, que e o que a oficina conhece, aparece zerado.
 *
 * A pista mais forte e o apelido: o CSV do DATASYSTEM traz "Cliente" (nome
 * fantasia) e "Razao Social" em colunas separadas, e a carga usou so a segunda.
 * Em 69 casos os dois diferem — e o apelido e justamente o nome pelo qual a
 * oficina cadastrou a pessoa aqui.
 *
 * SO LE. Nao altera cadastro, nao move titulo, nao apaga nada: quem decide
 * fundir dois cadastros e uma pessoa olhando o dinheiro de cada lado.
 */
async function gerarDuplicados() {
  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco do Demir nao configurado.");
  const { client } = await connectDatabase(configuracao);

  try {
    // Apelido por documento, direto do CSV: e o que a carga descartou.
    const apelido = new Map<string, string>();
    for (const linha of lerCsv(acharCsv("CONTAS A RECEBER"))) {
      const doc = soDigitos(linha["CNPJ/CPF"]);
      const nome = (linha["Cliente"] || "").trim();
      const razao = (linha["Razão Social"] || "").trim();
      if (doc && nome && nomeComparavel(nome) !== nomeComparavel(razao)) {
        apelido.set(doc, nome);
      }
    }

    type Cadastro = {
      id: number;
      documento: string;
      nome: string;
      telefone: string | null;
      cidade: string | null;
      temOs: boolean;
      temVenda: boolean;
      titulosMigrados: number;
      totalMigrado: number;
    };

    const cadastros = (
      await client.query<Cadastro>(
        `select c.id,
                regexp_replace(coalesce(c.cpfcnpj,''), '\\D', '', 'g') documento,
                c.nomerazaosocial nome,
                c.telefone,
                c.cidade,
                exists (select 1 from public.ordemservico o where o.clienteid = c.id) "temOs",
                exists (select 1 from public.venda v where v.clienteid = c.id) "temVenda",
                (select count(*) from public.transacao t
                  where t.cliente_id = c.id and t.origem = $1
                    and coalesce(t.is_deleted, false) = false) "titulosMigrados",
                (select coalesce(sum(t.valor), 0) from public.transacao t
                  where t.cliente_id = c.id and t.origem = $1 and t.pendente
                    and coalesce(t.is_deleted, false) = false) "totalMigrado"
           from public.cliente c
          where c.is_deleted = false`,
        [ORIGEM],
      )
    ).rows.map((linha) => ({
      ...linha,
      titulosMigrados: Number(linha.titulosMigrados),
      totalMigrado: Number(linha.totalMigrado),
    }));

    // Nasceu da carga: so tem titulo migrado, nenhuma OS e nenhuma venda.
    const daCarga = cadastros.filter(
      (cadastro) => cadastro.titulosMigrados > 0 && !cadastro.temOs && !cadastro.temVenda,
    );
    const idsDaCarga = new Set(daCarga.map((cadastro) => cadastro.id));
    const demais = cadastros.filter((cadastro) => !idsDaCarga.has(cadastro.id));

    type Par = {
      novo: Cadastro;
      antigo: Cadastro;
      motivos: string[];
      forca: number;
    };
    const pares: Par[] = [];

    for (const novo of daCarga) {
      const nomeNovo = nomeComparavel(novo.nome);
      const apelidoDele = apelido.get(novo.documento) ?? "";
      const apelidoNovo = nomeComparavel(apelidoDele);
      const telefoneNovo = telefoneComparavel(novo.telefone);
      const inicioNovo = nomeNovo.split(" ").slice(0, 2).join(" ");

      for (const antigo of demais) {
        const nomeAntigo = nomeComparavel(antigo.nome);
        const motivos: string[] = [];
        let forca = 0;

        /*
         * Mesma raiz de CNPJ e a mesma empresa em outro estabelecimento —
         * matriz e filial. NAO e duplicata: sao inscricoes distintas, cada uma
         * com sua divida, e fundir as duas seria o erro. Aparece aqui porque a
         * semelhanca de nome ia trazer o par de qualquer forma, e sem esse
         * rotulo alguem poderia fundir por engano.
         *
         * O "2" no fim de um dos nomes costuma ser marca disso: o UNIQUE em
         * nomerazaosocial recusa o nome repetido e quem cadastrou desempatou
         * no numero.
         */
        const raizNovo = novo.documento.length === 14 ? novo.documento.slice(0, 8) : "";
        const raizAntigo = antigo.documento.length === 14 ? antigo.documento.slice(0, 8) : "";
        const filial = Boolean(raizNovo) && raizNovo === raizAntigo;

        if (filial) {
          pares.push({
            novo,
            antigo,
            motivos: ["mesma raiz de CNPJ: matriz e filial, NAO fundir"],
            forca: -1,
          });
          continue;
        }

        if (nomeAntigo && nomeAntigo === nomeNovo) {
          motivos.push("mesmo nome; so pontuacao ou sufixo difere");
          forca += 100;
        }
        if (apelidoNovo && nomeAntigo === apelidoNovo) {
          motivos.push("cadastro antigo tem o apelido do DATASYSTEM: " + apelidoDele);
          forca += 90;
        }
        if (telefoneNovo && telefoneNovo === telefoneComparavel(antigo.telefone)) {
          motivos.push("mesmo telefone");
          forca += 60;
        }
        if (!motivos.length && inicioNovo.length >= 6 && nomeAntigo.startsWith(inicioNovo)) {
          motivos.push("comeca igual: " + inicioNovo);
          forca += 25;
          const cidadeNova = (novo.cidade ?? "").trim().toUpperCase();
          const cidadeAntiga = (antigo.cidade ?? "").trim().toUpperCase();
          if (cidadeNova && cidadeNova === cidadeAntiga) {
            motivos.push("mesma cidade");
            forca += 15;
          }
        }

        if (motivos.length) pares.push({ novo, antigo, motivos, forca });
      }
    }

    pares.sort((a, b) => b.forca - a.forca || b.novo.totalMigrado - a.novo.totalMigrado);

    const aspas = (texto: string) => '"' + (texto ?? "").replace(/"/g, '""') + '"';
    const dinheiroBr = (valor: number) => valor.toFixed(2).replace(".", ",");
    const confianca = (forca: number) =>
      forca < 0
        ? "FILIAL"
        : forca >= 90
          ? "PROVAVEL"
          : forca >= 60
            ? "POSSIVEL"
            : "FRACO";

    const linhas = pares.map((par) =>
      [
        confianca(par.forca),
        par.novo.id,
        aspas(par.novo.nome),
        par.novo.documento,
        par.novo.titulosMigrados,
        dinheiroBr(par.novo.totalMigrado),
        par.antigo.id,
        aspas(par.antigo.nome),
        par.antigo.documento,
        par.antigo.temOs ? "SIM" : "",
        par.antigo.temVenda ? "SIM" : "",
        aspas(par.motivos.join("; ")),
      ].join(";"),
    );

    const pasta = path.join(projectRoot, "docs", "migracao_demir");
    fs.writeFileSync(
      path.join(pasta, "duplicados-clientes.csv"),
      [
        "Confianca;NovoId;NovoNome;NovoDocumento;TitulosMigrados;TotalEmAberto;" +
          "AntigoId;AntigoNome;AntigoDocumento;AntigoTemOS;AntigoTemVenda;Motivos",
        ...linhas,
      ].join("\n"),
      "latin1",
    );

    const provaveis = pares.filter((par) => par.forca >= 90).length;
    const possiveis = pares.filter((par) => par.forca >= 60 && par.forca < 90).length;
    const filiais = pares.filter((par) => par.forca < 0).length;
    const fracos = pares.length - provaveis - possiveis - filiais;
    const emRisco = [...new Set(pares.filter((par) => par.forca >= 60).map((par) => par.novo))]
      .reduce((total, cadastro) => total + cadastro.totalMigrado, 0);

    console.log(`Cadastros que nasceram da carga: ${daCarga.length}`);
    console.log(`Pares candidatos: ${pares.length}`);
    console.log(`  PROVAVEL: ${provaveis}`);
    console.log(`  POSSIVEL: ${possiveis}`);
    console.log(`  FRACO:    ${fracos}`);
    console.log(`  FILIAL:   ${filiais} (mesma raiz de CNPJ; nao sao duplicata)`);
    console.log(
      `Divida em aberto nos candidatos PROVAVEL/POSSIVEL: R$ ${emRisco.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    );
    console.log("\nRelacao gravada em docs/migracao_demir/duplicados-clientes.csv");
    console.log("Nada foi alterado no banco: este modo so le.");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  if (flags.has("--de-para")) {
    lerReceber();
    lerPagar();
    imprimirDePara();
    return;
  }

  if (flags.has("--relacao")) {
    await gerarRelacoes();
    return;
  }

  if (flags.has("--duplicados")) {
    await gerarDuplicados();
    return;
  }

  const titulos = [
    ...(FAZ_RECEBER ? lerReceber() : []),
    ...(FAZ_PAGAR ? lerPagar() : []),
  ];
  const fontes: Array<"RECEBER" | "PAGAR"> = [
    ...(FAZ_RECEBER ? (["RECEBER"] as const) : []),
    ...(FAZ_PAGAR ? (["PAGAR"] as const) : []),
  ];
  console.log(`Arquivos desta carga: ${fontes.join(" + ")}\n`);

  // Os totais desta chamada valem para o arquivo inteiro. A conferencia usa os
  // do lote de fato gravado, calculados depois de saber o que ja existia.
  const { corrigidas } = amarrarParcelas(titulos, Date.now());
  const somaReceber = titulos
    .filter((t) => t.fonte === "RECEBER")
    .reduce((total, t) => total + t.valor, 0);
  const somaPagar = titulos
    .filter((t) => t.fonte === "PAGAR")
    .reduce((total, t) => total + t.valor, 0);

  console.log(`Lidos ${titulos.length} titulos do DATASYSTEM.`);
  console.log(`  a receber: ${titulos.filter((t) => t.fonte === "RECEBER").length} | R$ ${somaReceber.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`  a pagar:   ${titulos.filter((t) => t.fonte === "PAGAR").length} | R$ ${somaPagar.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);

  if (naoConvertidos.size) {
    console.log("\nValores do CSV sem conversao definida (entram em branco):");
    [...naoConvertidos.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([chave, n]) => console.log(`  ${String(n).padStart(4)}x  ${chave}`));
  }

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "demir");
  if (!configuracao) throw new Error("Banco do Demir nao configurado.");

  const { client } = await connectDatabase(configuracao);
  let confirmado = false;

  try {
    await client.query("BEGIN");

    if (SIMULAR_REGRA) {
      if (APLICAR) {
        throw new Error(
          "--simular-regra nao pode ser usado com --aplicar: a regra so entra pelo processo de migration.",
        );
      }
      const sql = fs.readFileSync(path.join(projectRoot, MIGRACAO_REGRA), "utf8");
      // Fora o BEGIN/COMMIT do arquivo: quem controla a transacao aqui e o script.
      await client.query(sql.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, ""));
      console.log("Regra do DRE aplicada apenas dentro desta transacao de teste.\n");
    }

    let removidas = 0;

    /*
     * Carga complementar: em vez de recusar ou apagar, separa o que ja existe.
     *
     * A comparacao e pelo marcador de cada titulo, que carrega registro e
     * parcela e por isso e unico. O que ja esta gravado fica como esta — com as
     * baixas, os ajustes e o que mais a operadora tenha feito nele.
     */
    let titulosNovos = titulos;
    let jaExistiam = 0;

    if (SOMENTE_NOVOS) {
      const padroesFonte = fontes.map((fonte) => `${marcador(fonte)}%`);
      const gravados = new Set(
        (
          await client.query<{ chave: string }>(
            `select descricao_pagamento chave
               from public.transacao
              where origem = $1 and descricao_pagamento like any($2)`,
            [ORIGEM, padroesFonte],
          )
        ).rows.map((linha) => linha.chave),
      );

      titulosNovos = titulos.filter((titulo) => !gravados.has(marcadorDoTitulo(titulo)));
      jaExistiam = titulos.length - titulosNovos.length;

      console.log(
        `\nCarga complementar: ${titulosNovos.length} novos, ${jaExistiam} ja no banco (mantidos como estao).`,
      );

      if (titulosNovos.length === 0) {
        console.log("Nada a gravar.");
        await client.query("ROLLBACK");
        confirmado = true;
        return;
      }
    }

    // Trava por arquivo: so olha as linhas desta carga, para que carregar um
    // arquivo depois nao esbarre no outro nem o apague.
    for (const fonte of SOMENTE_NOVOS ? [] : fontes) {
      const jaCarregado = await client.query<{ n: string }>(
        "select count(*) n from public.transacao where origem = $1 and descricao_pagamento like $2",
        [ORIGEM, `${marcador(fonte)}%`],
      );
      const existentes = Number(jaCarregado.rows[0].n);
      if (!existentes) continue;

      if (!REFAZER) {
        throw new Error(
          `Ja existem ${existentes} transacoes de ${marcador(fonte).trim()}. Use --refazer para apagar e regravar.`,
        );
      }
      await client.query(
        "delete from public.transacao where origem = $1 and descricao_pagamento like $2",
        [ORIGEM, `${marcador(fonte)}%`],
      );
      console.log(`Carga anterior de ${fonte} removida: ${existentes} transacoes.`);
      removidas += existentes;
    }

    // Apagar nao devolve os ids consumidos: sem recuar a sequencia, a proxima
    // carga comecaria centenas de numeros a frente e deixaria um buraco
    // permanente na numeracao que o usuario ve na tela.
    if (removidas > 0) {
      const sequencia = await client.query<{ nome: string | null }>(
        "select pg_get_serial_sequence('public.transacao', 'id') nome",
      );
      const nome = sequencia.rows[0]?.nome;
      if (!nome) {
        throw new Error("Nao encontrei a sequencia de public.transacao.id para reposicionar.");
      }
      const posicao = await client.query<{ proximo: string }>(
        `select setval($1, coalesce((select max(id) from public.transacao), 0) + 1, false) proximo`,
        [nome],
      );
      console.log(`Sequencia de id reposicionada: proximo id sera ${posicao.rows[0].proximo}.`);
    }

    // Cadastros de apoio, resolvidos por codigo/nome para nao depender de id.
    const planos = new Map<string, number>();
    for (const linha of (
      await client.query<{ codigo: string; id: number }>(
        "select codigo, id from public.planosdeconta where codigo is not null",
      )
    ).rows) {
      planos.set(linha.codigo, linha.id);
    }

    const centros = new Map<string, number>();
    for (const linha of (
      await client.query<{ nome: string; id: number }>(
        "select nome, id from public.centrosdecusto",
      )
    ).rows) {
      centros.set(linha.nome, linha.id);
    }

    const bancos = new Map<string, number>();
    for (const linha of (
      await client.query<{ titulo: string; id: number }>(
        "select titulo, id from public.bancoconta",
      )
    ).rows) {
      bancos.set(linha.titulo, linha.id);
    }

    const categoria = await client.query<{ id: number }>(
      "select id from public.categoriatransacao where nome = 'NÃO RELACIONADO' limit 1",
    );
    const categoriaId = categoria.rows[0]?.id ?? null;

    // -- Clientes ----------------------------------------------------------
    // Vinculo por CPF/CNPJ normalizado. Quem nao existir e criado com o minimo
    // que o CSV oferece: documento, razao social e cidade/UF.
    const clientes = new Map<string, number>();
    for (const linha of (
      await client.query<{ doc: string; id: number }>(
        `select regexp_replace(coalesce(cpfcnpj,''), '\\D', '', 'g') doc, id
           from public.cliente
          where is_deleted = false and cpfcnpj is not null`,
      )
    ).rows) {
      if (linha.doc) clientes.set(linha.doc, linha.id);
    }

    const cidadeUf = new Map<string, { cidade: string; uf: string }>();
    for (const linha of lerCsv(acharCsv("CONTAS A RECEBER"))) {
      const doc = soDigitos(linha["CNPJ/CPF"]);
      const partes = (linha["Cidade"] || "").split(" - ");
      if (doc && !cidadeUf.has(doc)) {
        cidadeUf.set(doc, {
          cidade: (partes[0] || "").trim(),
          uf: (partes[1] || "").trim(),
        });
      }
    }

    const criados: string[] = [];
    for (const titulo of titulosNovos) {
      const doc = titulo.documentoPagador;
      if (titulo.fonte !== "RECEBER") continue;
      if (doc === "NÃO INFORMADO" || clientes.has(doc)) continue;

      const local = cidadeUf.get(doc) ?? { cidade: "", uf: "" };
      const juridica = doc.length > 11;

      // O ERP exige cidade, estado e telefone de pessoa juridica (tres CHECKs em
      // public.cliente). O CSV traz cidade e UF, mas nao tem telefone em coluna
      // nenhuma. Preencher com o mesmo token que registrar_entrada_confirmada ja
      // usa para documento ausente mantem o cadastro valido e deixa o buraco
      // visivel na tela, para a oficina completar. Pessoa fisica nao tem essa
      // exigencia, entao fica em branco de verdade.
      const faltando = juridica ? "NÃO INFORMADO" : null;

      const inserido = await client.query<{ id: number }>(
        `insert into public.cliente
           (tipopessoa, cpfcnpj, nomerazaosocial, cidade, estado, telefone, status)
         values ($1, $2, $3, coalesce(nullif($4,''), $7), coalesce(nullif($5,''), $7), $6, 'ATIVO')
         returning id`,
        [
          juridica ? "JURIDICA" : "FISICA",
          doc,
          titulo.nomePagador,
          local.cidade,
          local.uf,
          faltando,
          faltando,
        ],
      );
      clientes.set(doc, inserido.rows[0].id);
      criados.push(`${doc} - ${titulo.nomePagador}`);
    }

    /*
     * -- Parcelas irmas ja carregadas --------------------------------------
     *
     * `amarrarParcelas` so enxerga o arquivo. Numa carga complementar as irmas
     * costumam ter vindo antes: a 20/21 chega agora, a 21/21 esta no banco desde
     * a primeira carga. Sem isto o emprestimo apareceria como 20 avulsa mais um
     * acordo de uma parcela.
     *
     * O ERP agrupa por `created_at` exato somado a descricao terminada em
     * " - Parcela N/M" (ver /api/transaction/[id]/contexto). Entao herdar os dois
     * da irma e o que amarra. A irma e achada pelo favorecido, pela emissao e
     * pelo total de parcelas — o mesmo trio que identifica um acordo no CSV.
     */
    let herdadas = 0;
    if (SOMENTE_NOVOS) {
      for (const titulo of titulosNovos) {
        if (titulo.parcelas < 2 || !titulo.emissao) continue;

        const irma = await client.query<{ created_at: string; base: string }>(
          `select created_at::text,
                  regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '') base
             from public.transacao
            where origem = $1
              and nomepagador = $2
              and (competencia_em at time zone 'America/Fortaleza')::date = $3::date
              and descricao ~ ($4 || '$')
            order by created_at
            limit 1`,
          [
            ORIGEM,
            titulo.nomePagador.slice(0, 200),
            titulo.emissao,
            ` - Parcela [0-9]+/${titulo.parcelas}`,
          ],
        );

        const encontrada = irma.rows[0];
        if (!encontrada) continue;

        titulo.createdAt = encontrada.created_at;
        titulo.descricaoBase = encontrada.base;
        titulo.descricao = `${encontrada.base} - Parcela ${titulo.parcelaNumero}/${titulo.parcelas}`;
        herdadas += 1;
      }

      if (herdadas) {
        console.log(`${herdadas} parcela(s) amarrada(s) a irmas ja carregadas.`);
      }
    }

    // -- Transacoes --------------------------------------------------------
    let gravadas = 0;
    for (const titulo of titulosNovos) {
      const planoId = titulo.planoCodigo ? planos.get(titulo.planoCodigo) ?? null : null;
      const centroId = titulo.centroNome ? centros.get(titulo.centroNome) ?? null : null;
      const bancoId = titulo.bancoTitulo ? bancos.get(titulo.bancoTitulo) ?? null : null;
      const clienteId =
        titulo.fonte === "RECEBER" ? clientes.get(titulo.documentoPagador) ?? null : null;

      await client.query(
        `insert into public.transacao
           (descricao, valor, "valorLiquido", data, competencia_em, vencimento_em,
            metodopagamento, categoria_id, tipo, cliente_id, banco_id,
            nomepagador, cpfcnpjpagador, pendente, parcelas,
            plano_de_conta_id, centro_custo_id, origem, descricao_pagamento,
            created_at)
         values
           ($1, $2, $2, $3, $4, $5,
            $6::public.metodo_pagamento, $7, $8::public.tipos_transacao, $9, $10,
            $11, $12, true, $13,
            $14, $15, $16, $17,
            coalesce($18::timestamptz, now()))`,
        [
          titulo.descricao.slice(0, 500),
          titulo.valor,
          // `data` e a data que a tela do financeiro exibe, e o proprio ERP grava
          // nela o vencimento da parcela ao criar um parcelamento. Para um titulo
          // em aberto e o vencimento que interessa, nao a emissao.
          meiaNoiteBr(titulo.vencimento ?? titulo.emissao),
          // A competencia continua sendo a emissao: e quando o fato aconteceu.
          meiaNoiteBr(titulo.emissao),
          meiaNoiteBr(titulo.vencimento),
          titulo.metodo,
          categoriaId,
          titulo.tipo,
          clienteId,
          bancoId,
          titulo.nomePagador.slice(0, 200),
          titulo.documentoPagador,
          titulo.parcelas,
          planoId,
          centroId,
          ORIGEM,
          `${marcador(titulo.fonte)}${titulo.registro}${titulo.parcelaTexto ? ` parcela ${titulo.parcelaTexto}` : ""}`,
          titulo.createdAt,
        ],
      );
      gravadas += 1;
    }

    // -- Conferencia -------------------------------------------------------
    // A conferencia olha so o que esta carga gravou; cargas anteriores de outro
    // arquivo nao podem entrar nas somas.
    /*
     * A conferencia tem que olhar so o que esta execucao gravou.
     *
     * Com o padrao amplo (`DATASYSTEM PAGAR #%`) as somas viriam da carga
     * inteira — 608 titulos anteriores incluidos — e nao fechariam com o
     * arquivo, reprovando uma carga correta. Os marcadores exatos recortam o
     * lote; sem curinga, o `like any` compara por igualdade.
     */
    const padroes = SOMENTE_NOVOS
      ? titulosNovos.map((titulo) => marcadorDoTitulo(titulo))
      : fontes.map((fonte) => `${marcador(fonte)}%`);

    // Somas e agrupamentos do lote, para bater com o que o banco devolve acima.
    const somaReceberCarga = titulosNovos
      .filter((t) => t.fonte === "RECEBER")
      .reduce((total, t) => total + t.valor, 0);
    const somaPagarCarga = titulosNovos
      .filter((t) => t.fonte === "PAGAR")
      .reduce((total, t) => total + t.valor, 0);

    // Parcelas amarradas dentro do lote: o `grupos` acima conta o que o ERP
    // enxerga no recorte, e e com isso que a barreira compara.
    const gruposDoLote = new Map<string, number>();
    for (const titulo of titulosNovos) {
      if (titulo.parcelas < 2) continue;
      const chave = `${titulo.createdAt ?? ""}|${titulo.descricaoBase}`;
      gruposDoLote.set(chave, (gruposDoLote.get(chave) ?? 0) + 1);
    }
    const acordosDoLote = [...gruposDoLote.values()].filter((n) => n > 1);
    const amarradasDoLote = acordosDoLote.reduce((total, n) => total + n, 0);
    const parceladasDoLote = titulosNovos.filter((titulo) => titulo.parcelas > 1).length;

    const conferencia = await client.query<{
      tipo: string;
      n: string;
      total: string;
      sem_plano: string;
      sem_centro: string;
      sem_cliente: string;
    }>(
      `select tipo::text,
              count(*) n,
              sum(valor) total,
              count(*) filter (where plano_de_conta_id is null) sem_plano,
              count(*) filter (where centro_custo_id is null) sem_centro,
              count(*) filter (where cliente_id is null) sem_cliente
         from public.transacao
        where origem = $1 and descricao_pagamento like any($2)
        group by tipo`,
      [ORIGEM, padroes],
    );

    const eventos = await client.query<{
      n: string;
      total: string;
      de: string;
      ate: string;
    }>(
      `select count(*) n,
              coalesce(sum(e.valor), 0) total,
              coalesce(min(e.competencia_em)::date::text, '-') de,
              coalesce(max(e.competencia_em)::date::text, '-') ate
         from public.eventos_financeiros e
         join public.transacao t on t.id = e.source_id
        where e.source_type = 'TRANSACAO' and e.status = 'ATIVO'
          and t.origem = $1 and t.descricao_pagamento like any($2)`,
      [ORIGEM, padroes],
    );

    // Reproduz a regra do ERP (created_at igual + descricao terminada em
    // " - Parcela N/M") para conferir que os acordos ficaram mesmo amarrados.
    const grupos = await client.query<{ acordos: string; linhas: string }>(
      `select count(*) acordos, coalesce(sum(n), 0) linhas
         from (
           select count(*) n
             from public.transacao
            where origem = $1 and descricao_pagamento like any($2)
              and descricao ~ ' - Parcela [0-9]+/[0-9]+$'
            group by created_at, regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '')
           having count(*) > 1
         ) g`,
      [ORIGEM, padroes],
    );

    console.log(`\n${"=".repeat(64)}`);
    console.log("CONFERENCIA");
    console.log("=".repeat(64));
    console.log(`Clientes criados: ${criados.length}`);
    console.log(`Transacoes gravadas: ${gravadas}`);
    console.log(
      `Parcelas: ${parceladasDoLote} titulos fazem parte de acordo | ` +
        `${amarradasDoLote} amarrados em ${acordosDoLote.length} acordos | ` +
        `${parceladasDoLote - amarradasDoLote} sozinhos (unica parcela em aberto)`,
    );
    console.log(
      `  conferido no banco: ${grupos.rows[0].acordos} acordos, ${grupos.rows[0].linhas} linhas agrupadas`,
    );
    console.log(
      `  digitados como 1/1, 2/2, 3/3 e remontados: ${corrigidas.acordos} acordos, ${corrigidas.linhas} parcelas`,
    );

    const maiores = await client.query<{
      base: string;
      n: string;
      total: string;
      faixa: string;
    }>(
      `select regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '') base,
              count(*) n,
              sum(valor) total,
              min(substring(descricao from ' - Parcela ([0-9]+)/')::int) || ' a ' ||
                max(substring(descricao from ' - Parcela ([0-9]+)/')::int) || ' de ' ||
                max(substring(descricao from '/([0-9]+)$')) faixa
         from public.transacao
        where origem = $1 and descricao_pagamento like any($2)
          and descricao ~ ' - Parcela [0-9]+/[0-9]+$'
        group by created_at, regexp_replace(descricao, ' - Parcela [0-9]+/[0-9]+$', '')
       having count(*) > 1
        order by count(*) desc
        limit 5`,
      [ORIGEM, padroes],
    );

    console.log("\n  5 maiores acordos:");
    for (const linha of maiores.rows) {
      console.log(
        `    ${String(linha.n).padStart(3)} parcelas | ` +
          `R$ ${Number(linha.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 }).padStart(12)} | ` +
          `${linha.faixa.padEnd(18)} | ${linha.base.slice(0, 46)}`,
      );
    }
    for (const linha of conferencia.rows) {
      console.log(
        `  ${linha.tipo.padEnd(8)} ${String(linha.n).padStart(4)} titulos | ` +
          `R$ ${Number(linha.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 }).padStart(14)} | ` +
          `sem plano: ${linha.sem_plano} | sem centro: ${linha.sem_centro} | sem cliente: ${linha.sem_cliente}`,
      );
    }
    // As telas formatam em America/Fortaleza. Se a data gravada cair em outro dia
    // ao ser convertida, o usuario ve um dia a menos — que foi o erro da primeira
    // carga. Confere contra o vencimento que veio do CSV.
    const esperado = new Map<string, string>();
    for (const titulo of titulosNovos) {
      if (titulo.vencimento) esperado.set(marcadorDoTitulo(titulo), titulo.vencimento);
    }

    const datas = await client.query<{ chave: string; dia: string }>(
      `select descricao_pagamento chave,
              (data at time zone 'America/Fortaleza')::date::text dia
         from public.transacao
        where origem = $1 and descricao_pagamento like any($2)`,
      [ORIGEM, padroes],
    );

    const diasErrados = datas.rows.filter(
      (linha) => esperado.has(linha.chave) && esperado.get(linha.chave) !== linha.dia,
    );

    const dre = eventos.rows[0];
    console.log(
      `Datas conferidas no fuso da tela: ${datas.rows.length - diasErrados.length} de ${datas.rows.length} no dia certo`,
    );
    console.log(`Eventos de DRE gerados: ${dre.n} (tem que ser 0)`);
    if (Number(dre.n) > 0) {
      console.log(
        `  impacto que teriam no resultado: R$ ${Number(dre.total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      );
      console.log(`  espalhados nas competencias de ${dre.de} ate ${dre.ate}`);
    }

    // Barreiras: qualquer uma reprovada desfaz tudo.
    const problemas: string[] = [];
    if (gravadas !== titulosNovos.length) {
      problemas.push(`gravadas ${gravadas} de ${titulosNovos.length} linhas`);
    }
    if (Number(eventos.rows[0].n) !== 0) {
      problemas.push(`${eventos.rows[0].n} eventos de DRE gerados; deveriam ser 0`);
    }
    if (diasErrados.length) {
      const amostra = diasErrados
        .slice(0, 3)
        .map((linha) => `${linha.chave} mostra ${linha.dia}, esperado ${esperado.get(linha.chave)}`)
        .join("; ");
      problemas.push(`${diasErrados.length} titulos com data em dia errado (${amostra})`);
    }
    // O que o script amarrou tem que ser exatamente o que o ERP vai enxergar.
    if (Number(grupos.rows[0].linhas) !== amarradasDoLote) {
      problemas.push(
        `amarrei ${amarradasDoLote} parcelas, mas a regra do ERP encontra ${grupos.rows[0].linhas}`,
      );
    }
    for (const linha of conferencia.rows) {
      const esperado = linha.tipo === "RECEITA" ? somaReceberCarga : somaPagarCarga;
      const diferenca = Math.abs(Number(linha.total) - esperado);
      if (diferenca > 0.01) {
        problemas.push(
          `soma de ${linha.tipo} ficou R$ ${Number(linha.total).toFixed(2)}, esperado R$ ${esperado.toFixed(2)}`,
        );
      }
    }

    if (problemas.length) {
      throw new Error(`Conferencia reprovada: ${problemas.join("; ")}.`);
    }

    if (criados.length) {
      console.log(`\nClientes criados (${criados.length}):`);
      criados.forEach((cliente) => console.log(`  ${cliente}`));
    }

    if (APLICAR) {
      await client.query("COMMIT");
      confirmado = true;
      console.log("\nCarga aplicada no banco do Demir.");
    } else {
      await client.query("ROLLBACK");
      console.log("\nSimulacao: nada foi gravado. Rode com --aplicar para valer.");
    }
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw erro;
  } finally {
    if (!confirmado) await client.query("ROLLBACK").catch(() => undefined);
    await client.end().catch(() => undefined);
  }
}

main().catch((erro) => {
  console.error(`\n${erro instanceof Error ? erro.message : erro}`);
  process.exitCode = 1;
});
