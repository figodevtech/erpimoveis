/**
 * Gera uma planilha de auditoria das OS concluidas do legado que ainda nao
 * foram migradas para o Garage Premium. O script e somente leitura no banco.
 *
 * Uso:
 *   npm run migracao:garage:os-pendentes-xlsx
 */
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const ARQUIVO_SAIDA = path.join(DIRETORIO, "OS_NAO_MIGRADAS_REGRAS_ATUAIS.xlsx");
const PREFIXO = "LEGADO_OS_EXPORTACAO:";

const LEGENDA: Record<string, { descricao: string; tratamento: string }> = {
  CLIENTE_NAO_CADASTRADO: {
    descricao: "O CPF/CNPJ da origem nao foi encontrado no Garage Premium.",
    tratamento: "Regra substituida: OS historica pode usar cliente_snapshot sem criar cadastro.",
  },
  CLIENTE_NAO_CADASTRADO_USAR_SNAPSHOT: {
    descricao: "O CPF/CNPJ da origem nao foi encontrado no Garage Premium.",
    tratamento: "Regra aprovada: clienteid nulo e dados da origem preservados em cliente_snapshot.",
  },
  NOME_CLIENTE_DIVERGENTE: {
    descricao: "O CPF/CNPJ existe, mas o nome da origem nao confere com o cadastro.",
    tratamento: "Validar manualmente se se trata da mesma pessoa ou empresa.",
  },
  CLIENTE_AMBIGUO_NO_BANCO: {
    descricao: "Mais de um cadastro atende ao mesmo documento e nome.",
    tratamento: "Escolher e corrigir o cadastro antes da migracao.",
  },
  FLAG_CANCELADO: {
    descricao: "A origem marca a OS como cancelada, apesar do status concluido.",
    tratamento: "Migrar somente com autorizacao explicita para ignorar a flag.",
  },
  FLAG_NAO_SALVO: {
    descricao: "A origem nao marca o registro como salvo.",
    tratamento: "Migrar somente com autorizacao explicita para ignorar a flag.",
  },
  SEM_PLACA: {
    descricao: "A OS nao possui placa informada.",
    tratamento: "Identificar o veiculo ou autorizar historico sem placa.",
  },
  PLACA_INVALIDA: {
    descricao: "A placa nao segue o formato brasileiro antigo ou Mercosul.",
    tratamento: "Corrigir ou confirmar manualmente a placa.",
  },
  PLACA_DUPLICADA_NO_BANCO: {
    descricao: "Ha mais de um veiculo atual com a mesma placa.",
    tratamento: "Resolver a duplicidade cadastral antes de vincular a OS.",
  },
  DUPLICIDADE_NATURAL: {
    descricao: "Existem linhas com cliente, placa, data, solicitacao e observacao iguais.",
    tratamento: "Confirmar se sao OS distintas ou registros duplicados.",
  },
  TITULAR_VEICULO_DIVERGENTE: {
    descricao: "O cliente da OS difere do proprietario atual do veiculo da mesma placa.",
    tratamento: "Confirmar troca de titularidade ou preservar como historico sem vinculo.",
  },
  MODELO_DIVERGENTE: {
    descricao: "O modelo informado na origem difere do veiculo atual da mesma placa.",
    tratamento: "Confirmar a placa; se correta, preservar o cadastro atual.",
  },
  MODELO_DIVERGENTE_USAR_CADASTRO: {
    descricao: "O modelo informado na origem difere do veiculo atual da mesma placa.",
    tratamento: "Regra aprovada: migrar usando integralmente os dados do veiculo cadastrado.",
  },
  ANO_DIVERGENTE: {
    descricao: "O ano de fabricacao da origem difere do cadastro atual.",
    tratamento: "Confirmar a placa; se correta, preservar o cadastro atual.",
  },
  ANO_DIVERGENTE_USAR_CADASTRO: {
    descricao: "O ano de fabricacao da origem difere do cadastro atual.",
    tratamento: "Regra aprovada: migrar preservando o ano do cadastro atual.",
  },
  ANO_MODELO_DIVERGENTE: {
    descricao: "O ano-modelo da origem difere do cadastro atual.",
    tratamento: "Confirmar a placa; se correta, preservar o cadastro atual.",
  },
  ANO_MODELO_DIVERGENTE_USAR_CADASTRO: {
    descricao: "O ano-modelo da origem difere do cadastro atual.",
    tratamento: "Regra aprovada: migrar preservando o ano-modelo do cadastro atual.",
  },
  MARCAS_MULTIPLAS_NA_FONTE: {
    descricao: "A mesma placa aparece com mais de uma marca entre as OS pendentes.",
    tratamento: "Definir qual informacao historica deve prevalecer.",
  },
  MODELOS_MULTIPLOS_NA_FONTE: {
    descricao: "A mesma placa aparece com mais de um modelo entre as OS pendentes.",
    tratamento: "Definir qual informacao historica deve prevalecer.",
  },
  CHASSIS_MULTIPLOS_NA_FONTE: {
    descricao: "A mesma placa aparece com mais de um chassi entre as OS pendentes.",
    tratamento: "Confirmar a placa e preservar o cadastro atual quando existir.",
  },
  ANOS_MULTIPLOS_NA_FONTE: {
    descricao: "A mesma placa aparece com mais de um ano de fabricacao.",
    tratamento: "Definir qual informacao historica deve prevalecer.",
  },
  ANOS_MODELO_MULTIPLOS_NA_FONTE: {
    descricao: "A mesma placa aparece com mais de um ano-modelo.",
    tratamento: "Definir qual informacao historica deve prevalecer.",
  },
  TITULARES_MULTIPLOS_NA_FONTE: {
    descricao: "A mesma placa aparece ligada a clientes diferentes no historico.",
    tratamento: "Permitido como troca de titularidade; cada OS permanece com seu cliente.",
  },
  CHASSI_EM_OUTRA_PLACA_NA_FONTE_APROVADO: {
    descricao: "O mesmo chassi aparece em outra placa na planilha legada.",
    tratamento: "Regra aprovada: usar a placa e nao alterar cadastros atuais.",
  },
  CHASSI_EM_OUTRA_PLACA_NO_BANCO_APROVADO: {
    descricao: "O chassi da origem esta cadastrado atualmente em outra placa.",
    tratamento: "Regra aprovada: nao vincular pelo chassi nem alterar o veiculo atual.",
  },
  CHASSI_DIVERGENTE_USAR_CADASTRO: {
    descricao: "A placa existe, mas o chassi legado difere do cadastro atual.",
    tratamento: "Usar o chassi atual do Garage Premium e preservar o cadastro.",
  },
  CHASSI_FONTE_AUSENTE: {
    descricao: "A origem nao informa chassi.",
    tratamento: "Usar o cadastro atual quando houver veiculo com a mesma placa.",
  },
  SEM_VEICULO_MESMA_PLACA_USAR_SNAPSHOT: {
    descricao: "Nao existe veiculo cadastrado com a mesma placa.",
    tratamento: "Regra aprovada: vincular ao cliente e usar somente snapshot historico.",
  },
};

type Linha = unknown[];
type ClienteBanco = {
  id: number;
  cpfcnpj: string;
  nomerazaosocial: string;
};
type VeiculoBanco = {
  id: number;
  clienteid: number;
  placa: string;
  chassi: string | null;
  marca: string | null;
  modelo: string | null;
  ano: number | null;
  ano_modelo: number | null;
  cor: string | null;
  combustivel: string | null;
  proprietario_nome: string;
  proprietario_documento: string;
};

function texto(valor: unknown) {
  return valor == null ? "" : String(valor).trim();
}

function compacto(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function documento(valor: unknown) {
  const digitos = texto(valor).replace(/\D/g, "");
  if (!digitos) return "";
  return digitos.length <= 11 ? digitos.padStart(11, "0") : digitos.padStart(14, "0");
}

function inteiro(valor: unknown) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

function ano(valor: unknown) {
  const numero = inteiro(valor);
  return numero != null && numero >= 1900 && numero <= 2100 ? numero : null;
}

function dataFonte(valor: unknown) {
  if (typeof valor !== "number") return texto(valor);
  const partes = XLSX.SSF.parse_date_code(valor);
  if (!partes) return texto(valor);
  return `${String(partes.d).padStart(2, "0")}/${String(partes.m).padStart(2, "0")}/${partes.y}`;
}

function adicionar<K, V>(mapa: Map<K, V[]>, chave: K, valor: V) {
  const valores = mapa.get(chave) ?? [];
  valores.push(valor);
  mapa.set(chave, valores);
}

function distintos<T>(valores: T[]) {
  return [...new Set(valores.filter((valor) => valor !== null && valor !== ""))];
}

function assinaturaNatural(linha: Linha) {
  return [
    documento(linha[15]),
    compacto(linha[26]),
    texto(linha[4]),
    compacto(linha[28]),
    compacto(linha[29]),
  ].join("|");
}

function ajustarPlanilha(aba: XLSX.WorkSheet, larguras: number[]) {
  aba["!cols"] = larguras.map((wch) => ({ wch }));
  if (aba["!ref"]) aba["!autofilter"] = { ref: aba["!ref"] };
  aba["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
}

async function main() {
  const nomeFonte = fs
    .readdirSync(DIRETORIO)
    .find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
  if (!nomeFonte) throw new Error("Planilha de exportacao das OS nao encontrada.");

  const workbookFonte = XLSX.read(fs.readFileSync(path.join(DIRETORIO, nomeFonte)));
  const abaFonte = workbookFonte.SheetNames[0];
  if (!abaFonte) throw new Error("A planilha de origem nao possui abas.");
  const matriz = XLSX.utils.sheet_to_json<Linha>(workbookFonte.Sheets[abaFonte], {
    header: 1,
    defval: null,
    raw: true,
  });
  const concluidas = matriz
    .slice(1)
    .filter((linha) => compacto(linha[13]) === "CONCLUIDOCOMEXITO");

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  const { client } = await connectDatabase(configuracao);

  try {
    const ordensRes = await client.query<{ migracao_referencia: string }>(
      `select migracao_referencia
         from public.ordemservico
        where migracao_referencia like $1`,
      [`${PREFIXO}%`],
    );
    const clientesRes = await client.query<ClienteBanco>(
      `select id, cpfcnpj, nomerazaosocial
         from public.cliente
        where coalesce(is_deleted, false) = false`,
    );
    const veiculosRes = await client.query<VeiculoBanco>(
      `select v.id, v.clienteid, v.placa, v.chassi, v.marca, v.modelo,
              v.ano, v.ano_modelo, v.cor, v.combustivel,
              c.nomerazaosocial proprietario_nome,
              c.cpfcnpj proprietario_documento
         from public.veiculo v
         join public.cliente c on c.id = v.clienteid`,
    );

    const migradas = new Set(
      ordensRes.rows.map((ordem) => Number(ordem.migracao_referencia.split(":").at(-1))),
    );
    const pendentes = concluidas.filter((linha) => !migradas.has(Number(linha[0])));

    const clientesPorDocumento = new Map<string, ClienteBanco[]>();
    const veiculosPorPlaca = new Map<string, VeiculoBanco[]>();
    const veiculosPorChassi = new Map<string, VeiculoBanco[]>();
    for (const cliente of clientesRes.rows) {
      const chave = documento(cliente.cpfcnpj);
      if (chave) adicionar(clientesPorDocumento, chave, cliente);
    }
    for (const veiculo of veiculosRes.rows) {
      const placa = compacto(veiculo.placa);
      const chassi = compacto(veiculo.chassi);
      if (placa) adicionar(veiculosPorPlaca, placa, veiculo);
      if (chassi) adicionar(veiculosPorChassi, chassi, veiculo);
    }

    const linhasPorPlaca = new Map<string, Linha[]>();
    const placasPorChassi = new Map<string, string[]>();
    const quantidadePorAssinatura = new Map<string, number>();
    for (const linha of pendentes) {
      const placa = compacto(linha[26]);
      const chassi = compacto(linha[35]);
      if (placa) adicionar(linhasPorPlaca, placa, linha);
      if (placa && chassi) adicionar(placasPorChassi, chassi, placa);
      const assinatura = assinaturaNatural(linha);
      quantidadePorAssinatura.set(assinatura, (quantidadePorAssinatura.get(assinatura) ?? 0) + 1);
    }

    const detalhes = pendentes
      .map((linha) => {
        const registro = Number(linha[0]);
        const placa = compacto(linha[26]);
        const chassi = compacto(linha[35]);
        const documentoFonte = documento(linha[15]);
        const clientesDocumento = clientesPorDocumento.get(documentoFonte) ?? [];
        const clientesNomeExato = clientesDocumento.filter(
          (cliente) => compacto(cliente.nomerazaosocial) === compacto(linha[1]),
        );
        const cliente = clientesNomeExato.length === 1 ? clientesNomeExato[0] : null;
        const veiculosPlaca = veiculosPorPlaca.get(placa) ?? [];
        const veiculo = veiculosPlaca.length === 1 ? veiculosPlaca[0] : null;
        const veiculosChassi = chassi ? veiculosPorChassi.get(chassi) ?? [] : [];
        const grupoPlaca = linhasPorPlaca.get(placa) ?? [];

        const bloqueios: string[] = [];
        const alertas: string[] = [];
        if (Number(linha[18]) !== 0) bloqueios.push("FLAG_CANCELADO");
        if (Number(linha[57]) !== -1) bloqueios.push("FLAG_NAO_SALVO");
        if (!placa) bloqueios.push("SEM_PLACA");
        else if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) bloqueios.push("PLACA_INVALIDA");

        let matchCliente = "EXATO";
        if (!documentoFonte || clientesDocumento.length === 0) {
          matchCliente = "NAO_CADASTRADO";
          alertas.push("CLIENTE_NAO_CADASTRADO_USAR_SNAPSHOT");
        } else if (clientesNomeExato.length === 0) {
          matchCliente = "NOME_DIVERGENTE";
          bloqueios.push("NOME_CLIENTE_DIVERGENTE");
        } else if (clientesNomeExato.length > 1) {
          matchCliente = "AMBIGUO";
          bloqueios.push("CLIENTE_AMBIGUO_NO_BANCO");
        }

        if ((quantidadePorAssinatura.get(assinaturaNatural(linha)) ?? 0) > 1) {
          bloqueios.push("DUPLICIDADE_NATURAL");
        }
        if (placa && distintos(grupoPlaca.map((item) => documento(item[15]))).length > 1) {
          alertas.push("TITULARES_MULTIPLOS_NA_FONTE");
        }
        if (placa && distintos(grupoPlaca.map((item) => compacto(item[23]))).length > 1) {
          bloqueios.push("MARCAS_MULTIPLAS_NA_FONTE");
        }
        if (placa && distintos(grupoPlaca.map((item) => compacto(item[24]))).length > 1) {
          bloqueios.push("MODELOS_MULTIPLOS_NA_FONTE");
        }
        if (placa && distintos(grupoPlaca.map((item) => compacto(item[35]))).length > 1) {
          bloqueios.push("CHASSIS_MULTIPLOS_NA_FONTE");
        }
        if (placa && distintos(grupoPlaca.map((item) => ano(item[25]))).length > 1) {
          bloqueios.push("ANOS_MULTIPLOS_NA_FONTE");
        }
        if (placa && distintos(grupoPlaca.map((item) => ano(item[59]))).length > 1) {
          bloqueios.push("ANOS_MODELO_MULTIPLOS_NA_FONTE");
        }
        if (chassi && new Set(placasPorChassi.get(chassi) ?? []).size > 1) {
          alertas.push("CHASSI_EM_OUTRA_PLACA_NA_FONTE_APROVADO");
        }
        const placasBancoMesmoChassi = distintos(
          veiculosChassi.map((item) => compacto(item.placa)).filter((item) => item !== placa),
        );
        if (placasBancoMesmoChassi.length) {
          alertas.push("CHASSI_EM_OUTRA_PLACA_NO_BANCO_APROVADO");
        }

        if (veiculosPlaca.length > 1) {
          bloqueios.push("PLACA_DUPLICADA_NO_BANCO");
        } else if (!veiculo) {
          alertas.push("SEM_VEICULO_MESMA_PLACA_USAR_SNAPSHOT");
        } else {
          if (cliente && veiculo.clienteid !== cliente.id) {
            bloqueios.push("TITULAR_VEICULO_DIVERGENTE");
          }
          if (!chassi) alertas.push("CHASSI_FONTE_AUSENTE");
          else if (compacto(veiculo.chassi) !== chassi) alertas.push("CHASSI_DIVERGENTE_USAR_CADASTRO");
          if (ano(linha[25]) != null && veiculo.ano !== ano(linha[25])) alertas.push("ANO_DIVERGENTE_USAR_CADASTRO");
          if (ano(linha[59]) != null && veiculo.ano_modelo !== ano(linha[59])) alertas.push("ANO_MODELO_DIVERGENTE_USAR_CADASTRO");
          if (compacto(linha[24]) && compacto(veiculo.modelo) !== compacto(linha[24])) {
            alertas.push("MODELO_DIVERGENTE_USAR_CADASTRO");
          }
        }

        const bloqueiosUnicos = distintos(bloqueios);
        const alertasUnicos = distintos(alertas);
        const situacao = bloqueiosUnicos.length === 0 ? "APTA PELAS REGRAS ATUAIS" : "BLOQUEADA";
        const acao = bloqueiosUnicos.length === 0
          ? veiculo
            ? "Migrar vinculada ao veiculo pela placa; preservar integralmente o cadastro atual."
            : "Migrar vinculada ao cliente, sem criar veiculo; manter snapshot historico da OS."
          : "Revisar os bloqueios antes de autorizar a migracao.";

        return {
          "Registro legado": registro,
          "Data da OS": dataFonte(linha[4]),
          "Situação para análise": situacao,
          "Bloqueios": bloqueiosUnicos.join("; "),
          "Alertas / regras aprovadas": alertasUnicos.join("; "),
          "Ação sugerida": acao,
          "Cliente na origem": texto(linha[1]),
          "CPF/CNPJ na origem": documentoFonte,
          "Match do cliente": matchCliente,
          "Cliente GP ID": cliente?.id ?? "",
          "Cliente GP": cliente?.nomerazaosocial ?? clientesDocumento.map((item) => item.nomerazaosocial).join(" | "),
          "Placa na origem": placa,
          "Chassi na origem": chassi,
          "Marca na origem": texto(linha[23]),
          "Modelo na origem": texto(linha[24]),
          "Ano fabricação origem": ano(linha[25]) ?? "",
          "Ano modelo origem": ano(linha[59]) ?? "",
          "KM na origem": inteiro(linha[30]) ?? "",
          "Veículo mesma placa": veiculo ? "SIM" : "NÃO",
          "Veículo GP ID": veiculo?.id ?? "",
          "Proprietário atual GP": veiculo?.proprietario_nome ?? "",
          "CPF/CNPJ proprietário GP": veiculo ? documento(veiculo.proprietario_documento) : "",
          "Chassi atual GP": veiculo ? compacto(veiculo.chassi) : "",
          "Marca atual GP": veiculo?.marca ?? "",
          "Modelo atual GP": veiculo?.modelo ?? "",
          "Ano fabricação GP": veiculo?.ano ?? "",
          "Ano modelo GP": veiculo?.ano_modelo ?? "",
          "Chassi encontrado em outras placas GP": placasBancoMesmoChassi.join(" | "),
          "Outras placas com mesmo chassi na origem": distintos(placasPorChassi.get(chassi) ?? [])
            .filter((item) => item !== placa)
            .join(" | "),
          "Cancelado (origem)": inteiro(linha[18]) ?? texto(linha[18]),
          "RegistroSalvo (origem)": inteiro(linha[57]) ?? texto(linha[57]),
          "Solicitação do cliente": texto(linha[28]),
          "Observações gerais": texto(linha[29]),
          "Observação da OS": texto(linha[5]),
          "Vendedor": texto(linha[6]),
          "Referência de migração": `${PREFIXO}${registro}`,
        };
      })
      .sort((a, b) => Number(a["Registro legado"]) - Number(b["Registro legado"]));

    const contagemCategorias = new Map<string, { tipo: string; registros: Set<number>; placas: Set<string> }>();
    function contar(tipo: string, categorias: string, registro: number, placa: string) {
      for (const categoria of categorias.split("; ").filter(Boolean)) {
        const chave = `${tipo}|${categoria}`;
        const atual = contagemCategorias.get(chave) ?? { tipo, registros: new Set(), placas: new Set() };
        atual.registros.add(registro);
        if (placa) atual.placas.add(placa);
        contagemCategorias.set(chave, atual);
      }
    }
    for (const detalhe of detalhes) {
      contar("BLOQUEIO", detalhe.Bloqueios, detalhe["Registro legado"], detalhe["Placa na origem"]);
      contar("ALERTA", detalhe["Alertas / regras aprovadas"], detalhe["Registro legado"], detalhe["Placa na origem"]);
    }

    const aptas = detalhes.filter((item) => item["Situação para análise"] === "APTA PELAS REGRAS ATUAIS");
    const resumoIntroducao = [
      { "Indicador": "Arquivo gerado em", "Valor": new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }), "Observação": "Auditoria somente leitura do Garage Premium" },
      { "Indicador": "OS concluídas com êxito na origem", "Valor": concluidas.length, "Observação": "Total da planilha original" },
      { "Indicador": "OS já migradas", "Valor": concluidas.length - pendentes.length, "Observação": "Identificadas pela referência LEGADO_OS_EXPORTACAO" },
      { "Indicador": "OS ainda não migradas", "Valor": pendentes.length, "Observação": "Uma OS pode possuir vários bloqueios" },
      { "Indicador": "Aptas pelas regras atuais", "Valor": aptas.length, "Observação": "Não migrar automaticamente sem nova confirmação" },
      { "Indicador": "Ainda bloqueadas", "Valor": pendentes.length - aptas.length, "Observação": "Exigem revisão dos motivos indicados" },
      { "Indicador": "Regra de chassi", "Valor": "APROVADA", "Observação": "Placa é a chave; cadastro atual não deve ser alterado" },
    ];
    const resumoCategorias = [...contagemCategorias.entries()]
      .map(([chave, valor]) => ({
        "Tipo": valor.tipo,
        "Categoria": chave.split("|")[1],
        "Quantidade de OS": valor.registros.size,
        "Quantidade de placas": valor.placas.size,
        "Observação": LEGENDA[chave.split("|")[1]]?.descricao ?? "As categorias se sobrepõem.",
      }))
      .sort((a, b) => a.Tipo.localeCompare(b.Tipo) || b["Quantidade de OS"] - a["Quantidade de OS"]);

    const workbookSaida = XLSX.utils.book_new();
    const abaResumo = XLSX.utils.json_to_sheet(resumoIntroducao);
    XLSX.utils.sheet_add_json(abaResumo, resumoCategorias, { origin: "A10" });
    ajustarPlanilha(abaResumo, [34, 28, 72, 18, 20]);
    XLSX.utils.book_append_sheet(workbookSaida, abaResumo, "RESUMO");

    const abaLegenda = XLSX.utils.json_to_sheet(
      Object.entries(LEGENDA).map(([codigo, item]) => ({
        "Código": codigo,
        "Descrição": item.descricao,
        "Tratamento sugerido": item.tratamento,
      })),
    );
    ajustarPlanilha(abaLegenda, [46, 72, 78]);
    XLSX.utils.book_append_sheet(workbookSaida, abaLegenda, "LEGENDA");

    const abaPendentes = XLSX.utils.json_to_sheet(detalhes);
    ajustarPlanilha(abaPendentes, [16, 14, 26, 46, 56, 65, 34, 20, 22, 14, 34, 15, 24, 20, 25, 20, 18, 14, 19, 14, 34, 24, 24, 20, 24, 18, 16, 32, 38, 18, 22, 55, 55, 55, 24, 31]);
    XLSX.utils.book_append_sheet(workbookSaida, abaPendentes, "OS_PENDENTES");

    const colunasEssenciais = (item: typeof detalhes[number]) => ({
      "Registro legado": item["Registro legado"],
      "Data da OS": item["Data da OS"],
      "Situação": item["Situação para análise"],
      "Cliente na origem": item["Cliente na origem"],
      "CPF/CNPJ": item["CPF/CNPJ na origem"],
      "Placa": item["Placa na origem"],
      "Chassi": item["Chassi na origem"],
      "Bloqueios": item.Bloqueios,
      "Alertas": item["Alertas / regras aprovadas"],
      "Ação sugerida": item["Ação sugerida"],
    });
    const grupos = [
      ["APTAS_REVISAR", detalhes.filter((item) => item["Situação para análise"] === "APTA PELAS REGRAS ATUAIS")],
      ["PROBLEMAS_CLIENTE", detalhes.filter((item) => /CLIENTE|NOME_CLIENTE/.test(`${item.Bloqueios}; ${item["Alertas / regras aprovadas"]}`))],
      ["FLAGS_ORIGEM", detalhes.filter((item) => /FLAG_/.test(item.Bloqueios))],
      ["PROBLEMAS_PLACA", detalhes.filter((item) => /PLACA/.test(item.Bloqueios))],
      ["DIVERGENCIAS_VEICULO", detalhes.filter((item) => /CHASSI|ANO|MODELO|MARCA|TITULAR_VEICULO/.test(item.Bloqueios))],
      ["DUPLICIDADES", detalhes.filter((item) => /DUPLICIDADE/.test(item.Bloqueios))],
    ] as const;
    for (const [nome, itens] of grupos) {
      const aba = XLSX.utils.json_to_sheet(itens.map(colunasEssenciais));
      ajustarPlanilha(aba, [16, 14, 26, 34, 20, 15, 24, 55, 55, 65]);
      XLSX.utils.book_append_sheet(workbookSaida, aba, nome);
    }

    XLSX.writeFile(workbookSaida, ARQUIVO_SAIDA, { compression: true });
    const verificacao = XLSX.readFile(ARQUIVO_SAIDA);
    const linhasVerificadas = XLSX.utils.sheet_to_json(verificacao.Sheets.OS_PENDENTES).length;
    if (linhasVerificadas !== pendentes.length) {
      throw new Error(`A planilha gravada possui ${linhasVerificadas} linhas; esperado: ${pendentes.length}.`);
    }

    console.log(`Planilha criada: ${ARQUIVO_SAIDA}`);
    console.log(`Pendentes detalhadas: ${pendentes.length}.`);
    console.log(`Aptas pelas regras atuais: ${aptas.length}.`);
    console.log(`Ainda bloqueadas: ${pendentes.length - aptas.length}.`);
    console.log(`Abas: ${verificacao.SheetNames.join(", ")}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
