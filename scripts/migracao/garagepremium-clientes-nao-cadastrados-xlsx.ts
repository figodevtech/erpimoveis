/**
 * Audita os clientes das OS concluidas que ainda nao existem no Garage Premium.
 *
 * O script e somente leitura no banco. Ele gera uma planilha com uma linha por
 * cliente da origem e outra com as OS afetadas, distinguindo os campos aceitos
 * pela API dos dados considerados seguros para cadastro automatico.
 *
 * Uso:
 *   npm run migracao:garage:clientes-nao-cadastrados-xlsx
 */
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const ARQUIVO_SAIDA = path.join(DIRETORIO, "CLIENTES_NAO_CADASTRADOS_ANALISE.xlsx");
const ARQUIVO_PENDENTES = path.join(DIRETORIO, "OS_NAO_MIGRADAS_REGRAS_ATUAIS.xlsx");
const PREFIXO = "LEGADO_OS_EXPORTACAO:";

type Linha = unknown[];

type ClienteBanco = {
  id: number;
  cpfcnpj: string | null;
  nomerazaosocial: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  tipopessoa: string | null;
  is_deleted: boolean | null;
};

function texto(valor: unknown) {
  return valor == null ? "" : String(valor).trim();
}

function digitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function documento(valor: unknown) {
  const valorDigitos = digitos(valor);
  if (!valorDigitos) return "";
  return valorDigitos.length <= 11
    ? valorDigitos.padStart(11, "0")
    : valorDigitos.padStart(14, "0");
}

function compacto(valor: unknown) {
  return texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function email(valor: unknown) {
  return texto(valor).toLowerCase();
}

function emailValido(valor: string) {
  return !valor || /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(valor);
}

function telefone(valor: unknown) {
  const numero = digitos(valor);
  return numero.length >= 10 && numero.length <= 13 ? numero : "";
}

function todosIguais(valor: string) {
  return /^(\d)\1+$/.test(valor);
}

function cpfValido(valor: string) {
  if (!/^\d{11}$/.test(valor) || todosIguais(valor)) return false;
  for (let posicao = 9; posicao <= 10; posicao += 1) {
    let soma = 0;
    for (let indice = 0; indice < posicao; indice += 1) {
      soma += Number(valor[indice]) * (posicao + 1 - indice);
    }
    const resto = (soma * 10) % 11;
    const verificador = resto === 10 ? 0 : resto;
    if (verificador !== Number(valor[posicao])) return false;
  }
  return true;
}

function cnpjValido(valor: string) {
  if (!/^\d{14}$/.test(valor) || todosIguais(valor)) return false;
  const calcular = (base: string, pesos: number[]) => {
    const soma = base
      .split("")
      .reduce((total, numero, indice) => total + Number(numero) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(valor.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcular(`${valor.slice(0, 12)}${primeiro}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return valor.endsWith(`${primeiro}${segundo}`);
}

function distintos(valores: string[]) {
  return [...new Set(valores.filter(Boolean))];
}

function dataFonte(valor: unknown) {
  if (typeof valor !== "number") return texto(valor);
  const partes = XLSX.SSF.parse_date_code(valor);
  if (!partes) return texto(valor);
  return `${String(partes.d).padStart(2, "0")}/${String(partes.m).padStart(2, "0")}/${partes.y}`;
}

function ajustarPlanilha(aba: XLSX.WorkSheet, larguras: number[]) {
  aba["!cols"] = larguras.map((wch) => ({ wch }));
  if (aba["!ref"]) aba["!autofilter"] = { ref: aba["!ref"] };
  aba["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
}

function contar<T>(valores: T[], predicado: (valor: T) => boolean) {
  return valores.filter(predicado).length;
}

async function main() {
  const nomeFonte = fs
    .readdirSync(DIRETORIO)
    .find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
  if (!nomeFonte) throw new Error("Planilha de exportacao das OS nao encontrada.");

  const workbookFonte = XLSX.read(fs.readFileSync(path.join(DIRETORIO, nomeFonte)));
  const nomeAbaFonte = workbookFonte.SheetNames[0];
  if (!nomeAbaFonte) throw new Error("A planilha de origem nao possui abas.");
  const matriz = XLSX.utils.sheet_to_json<Linha>(workbookFonte.Sheets[nomeAbaFonte], {
    header: 1,
    defval: null,
    raw: true,
  });

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  const { client } = await connectDatabase(configuracao);

  try {
    const [ordensRes, clientesRes] = await Promise.all([
      client.query<{ migracao_referencia: string }>(
        `select migracao_referencia
           from public.ordemservico
          where migracao_referencia like $1`,
        [`${PREFIXO}%`],
      ),
      client.query<ClienteBanco>(
        `select id, cpfcnpj, nomerazaosocial, email, telefone, cidade, estado,
                tipopessoa::text, is_deleted
           from public.cliente`,
      ),
    ]);

    const migradas = new Set(
      ordensRes.rows.map((ordem) => Number(ordem.migracao_referencia.split(":").at(-1))),
    );
    const clientesAtivos = clientesRes.rows.filter((cliente) => !cliente.is_deleted);
    const documentosAtivos = new Set(clientesAtivos.map((cliente) => documento(cliente.cpfcnpj)).filter(Boolean));

    const concluidasPendentes = matriz.slice(1).filter(
      (linha) =>
        compacto(linha[13]) === "CONCLUIDOCOMEXITO" &&
        !migradas.has(Number(linha[0])),
    );
    const linhasSemCliente = concluidasPendentes.filter((linha) => {
      const doc = documento(linha[15]);
      return !doc || !documentosAtivos.has(doc);
    });

    const bloqueiosPorRegistro = new Map<number, string[]>();
    const detalhePendentePorRegistro = new Map<number, Record<string, unknown>>();
    if (fs.existsSync(ARQUIVO_PENDENTES)) {
      const workbookPendentes = XLSX.read(fs.readFileSync(ARQUIVO_PENDENTES));
      const abaDetalhes = workbookPendentes.Sheets.OS_PENDENTES ?? workbookPendentes.Sheets.DETALHES;
      if (abaDetalhes) {
        const detalhes = XLSX.utils.sheet_to_json<Record<string, unknown>>(abaDetalhes, { defval: "" });
        for (const detalhe of detalhes) {
          detalhePendentePorRegistro.set(Number(detalhe["Registro legado"]), detalhe);
          bloqueiosPorRegistro.set(
            Number(detalhe["Registro legado"]),
            texto(detalhe.Bloqueios).split("; ").filter(Boolean),
          );
        }
      }
    }

    const grupos = new Map<string, Linha[]>();
    for (const linha of linhasSemCliente) {
      const doc = documento(linha[15]);
      const chave = doc ? `DOC:${doc}` : `SEM_DOC:${compacto(linha[1])}`;
      const grupo = grupos.get(chave) ?? [];
      grupo.push(linha);
      grupos.set(chave, grupo);
    }

    const nomesPorDocumentoFonte = new Map<string, Set<string>>();
    const documentosPorNomeFonte = new Map<string, Set<string>>();
    const documentosPorEmailFonte = new Map<string, Set<string>>();
    for (const [chave, linhas] of grupos) {
      const doc = chave.startsWith("DOC:") ? chave.slice(4) : "";
      for (const nome of distintos(linhas.map((linha) => compacto(linha[1])))) {
        const docs = documentosPorNomeFonte.get(nome) ?? new Set<string>();
        docs.add(doc || chave);
        documentosPorNomeFonte.set(nome, docs);
        const nomes = nomesPorDocumentoFonte.get(doc || chave) ?? new Set<string>();
        nomes.add(nome);
        nomesPorDocumentoFonte.set(doc || chave, nomes);
      }
      for (const valorEmail of distintos(linhas.map((linha) => email(linha[22]))).filter(emailValido)) {
        const docs = documentosPorEmailFonte.get(valorEmail) ?? new Set<string>();
        docs.add(doc || chave);
        documentosPorEmailFonte.set(valorEmail, docs);
      }
    }

    const analiseClientes = [...grupos.entries()].map(([chave, linhas]) => {
      const doc = chave.startsWith("DOC:") ? chave.slice(4) : "";
      const tipo = doc.length === 11 ? "FISICA" : doc.length === 14 ? "JURIDICA" : "INDEFINIDA";
      const documentoValido = tipo === "FISICA" ? cpfValido(doc) : tipo === "JURIDICA" ? cnpjValido(doc) : false;
      const nomesOriginais = distintos(linhas.map((linha) => texto(linha[1])));
      const nomesNormalizados = distintos(linhas.map((linha) => compacto(linha[1])));
      const telefonesOriginais = distintos(linhas.map((linha) => texto(linha[3])));
      const telefonesValidos = distintos(linhas.map((linha) => telefone(linha[3])));
      const emailsOriginais = distintos(linhas.map((linha) => email(linha[22])));
      const emailsValidos = emailsOriginais.filter(emailValido);
      const nomePrincipal = nomesOriginais[0] ?? "";
      const nomeNormalizado = compacto(nomePrincipal);

      const conflitoNomeBanco = clientesAtivos.filter(
        (cliente) => compacto(cliente.nomerazaosocial) === nomeNormalizado && documento(cliente.cpfcnpj) !== doc,
      );
      const conflitoEmailBanco = clientesAtivos.filter(
        (cliente) => emailsValidos.includes(email(cliente.email)) && documento(cliente.cpfcnpj) !== doc,
      );
      const clienteNomeExato = conflitoNomeBanco.length === 1 ? conflitoNomeBanco[0] : null;
      const telefoneConfereBanco = Boolean(
        clienteNomeExato &&
        telefone(clienteNomeExato.telefone) &&
        telefonesValidos.includes(telefone(clienteNomeExato.telefone)),
      );
      const emailConfereBanco = Boolean(
        clienteNomeExato &&
        email(clienteNomeExato.email) &&
        emailsValidos.includes(email(clienteNomeExato.email)),
      );
      const nomesEmMaisDeUmDocumento = nomesNormalizados.some(
        (nome) => (documentosPorNomeFonte.get(nome)?.size ?? 0) > 1,
      );
      const emailsEmMaisDeUmDocumento = emailsValidos.some(
        (valorEmail) => (documentosPorEmailFonte.get(valorEmail)?.size ?? 0) > 1,
      );

      const motivos: string[] = [];
      if (!doc) motivos.push("SEM_CPF_CNPJ");
      else if (!documentoValido) motivos.push("CPF_CNPJ_INVALIDO");
      if (!nomePrincipal) motivos.push("SEM_NOME");
      if (nomesNormalizados.length > 1) motivos.push("NOMES_DIVERGENTES_NO_MESMO_DOCUMENTO");
      if (nomesEmMaisDeUmDocumento) motivos.push("MESMO_NOME_EM_DOCUMENTOS_DIFERENTES_NA_ORIGEM");
      if (conflitoNomeBanco.length) motivos.push("NOME_JA_USADO_NO_GARAGE_PREMIUM");
      if (conflitoEmailBanco.length) motivos.push("EMAIL_JA_USADO_NO_GARAGE_PREMIUM");
      if (emailsEmMaisDeUmDocumento) motivos.push("EMAIL_EM_DOCUMENTOS_DIFERENTES_NA_ORIGEM");
      if (emailsOriginais.some((valorEmail) => !emailValido(valorEmail))) motivos.push("EMAIL_INVALIDO_OMITIR");
      if (tipo === "JURIDICA" && telefonesValidos.length === 0) motivos.push("SEM_TELEFONE_VALIDO");
      if (tipo === "JURIDICA") motivos.push("SEM_CIDADE_ESTADO_NA_EXPORTACAO");

      // A exportacao nao tem cidade/estado; portanto nenhuma pessoa juridica
      // atende integralmente aos campos obrigatorios da API atual.
      const minimoApi = Boolean(doc && nomePrincipal && tipo === "FISICA");
      const impeditivosSeguros = motivos.filter(
        (motivo) => motivo !== "EMAIL_INVALIDO_OMITIR",
      );
      const cadastroAutomaticoSeguro = minimoApi && documentoValido && impeditivosSeguros.length === 0;
      const registros = linhas.map((linha) => Number(linha[0]));
      const osComVeiculoDoClienteExistente = registros.filter((registro) => {
        if (!clienteNomeExato) return false;
        const detalhe = detalhePendentePorRegistro.get(registro);
        return compacto(detalhe?.["Proprietário atual GP"]) === compacto(clienteNomeExato.nomerazaosocial);
      });
      const osSemVeiculoAtual = registros.filter((registro) => {
        const detalhe = detalhePendentePorRegistro.get(registro);
        return !texto(detalhe?.["Proprietário atual GP"]);
      });
      const confirmacaoSecundariaClienteExistente = Boolean(
        clienteNomeExato &&
        (osComVeiculoDoClienteExistente.length > 0 || telefoneConfereBanco || emailConfereBanco),
      );
      const osSemOutrosBloqueios = registros.filter((registro) => {
        const outros = (bloqueiosPorRegistro.get(registro) ?? []).filter(
          (bloqueio) => bloqueio !== "CLIENTE_NAO_CADASTRADO",
        );
        return outros.length === 0;
      });

      let classificacao = "REVISAO_MANUAL";
      let acao = "Revisar as divergencias antes de criar o cliente.";
      if (clienteNomeExato && confirmacaoSecundariaClienteExistente) {
        classificacao = "VINCULAR_CLIENTE_EXISTENTE";
        acao = "Nao criar cliente: vincular ao cadastro existente, confirmado pelo veiculo, telefone ou e-mail.";
      } else if (clienteNomeExato) {
        classificacao = "VALIDAR_CLIENTE_EXISTENTE";
        acao = "Nao criar duplicado: validar o cadastro de mesmo nome com documento, telefone ou outro comprovante.";
      } else if (cadastroAutomaticoSeguro) {
        classificacao = "APTO_CADASTRO_AUTOMATICO";
        acao = "Criar como pessoa fisica com nome e CPF; incluir apenas telefone/e-mail validos e nao conflitantes.";
      } else if (tipo === "JURIDICA" && documentoValido && nomePrincipal) {
        classificacao = "COMPLEMENTAR_CADASTRO_JURIDICO";
        acao = "Complementar telefone, cidade e estado; depois criar o cliente sem inventar endereco.";
      } else if (!doc || !documentoValido) {
        classificacao = "SEM_DOCUMENTO_VALIDO";
        acao = "Localizar CPF/CNPJ correto ou manter as OS fora da migracao.";
      }

      return {
        "Chave da origem": chave,
        "Classificacao": classificacao,
        "Cadastro automatico seguro": cadastroAutomaticoSeguro ? "SIM" : "NAO",
        "Atende minimo da API": minimoApi ? "SIM" : "NAO",
        "Tipo de pessoa": tipo,
        "CPF/CNPJ": doc,
        "CPF/CNPJ valido": documentoValido ? "SIM" : "NAO",
        "Nome/Razao social sugerido": nomePrincipal,
        "Nomes encontrados": nomesOriginais.join(" | "),
        "Telefones encontrados": telefonesOriginais.join(" | "),
        "Telefones aproveitaveis": telefonesValidos.join(" | "),
        "E-mails encontrados": emailsOriginais.join(" | "),
        "E-mails aproveitaveis": emailsValidos.join(" | "),
        "Cidade na exportacao": "",
        "Estado na exportacao": "",
        "Motivos / alertas": motivos.join("; "),
        "Conflito de nome no GP": conflitoNomeBanco.map((cliente) => `${cliente.id} - ${cliente.nomerazaosocial} - ${documento(cliente.cpfcnpj)}`).join(" | "),
        "Conflito de e-mail no GP": conflitoEmailBanco.map((cliente) => `${cliente.id} - ${cliente.nomerazaosocial} - ${documento(cliente.cpfcnpj)}`).join(" | "),
        "Telefone confere com GP": telefoneConfereBanco ? "SIM" : "NAO",
        "E-mail confere com GP": emailConfereBanco ? "SIM" : "NAO",
        "OS com veiculo do cliente existente": osComVeiculoDoClienteExistente.length,
        "OS sem veiculo atual para confirmar": osSemVeiculoAtual.length,
        "Quantidade de OS": linhas.length,
        "OS liberadas apenas criando cliente": osSemOutrosBloqueios.length,
        "Registros legados": registros.sort((a, b) => a - b).join(", "),
        "Placas": distintos(linhas.map((linha) => compacto(linha[26]))).join(" | "),
        "Acao sugerida": acao,
      };
    }).sort((a, b) => {
      const classe = String(a.Classificacao).localeCompare(String(b.Classificacao));
      return classe || String(a["Nome/Razao social sugerido"]).localeCompare(String(b["Nome/Razao social sugerido"]));
    });

    const analisePorChave = new Map(analiseClientes.map((item) => [String(item["Chave da origem"]), item]));
    const detalhesOs = linhasSemCliente.map((linha) => {
      const doc = documento(linha[15]);
      const chave = doc ? `DOC:${doc}` : `SEM_DOC:${compacto(linha[1])}`;
      const analise = analisePorChave.get(chave)!;
      const registro = Number(linha[0]);
      const outrosBloqueios = (bloqueiosPorRegistro.get(registro) ?? []).filter(
        (bloqueio) => bloqueio !== "CLIENTE_NAO_CADASTRADO",
      );
      return {
        "Registro legado": registro,
        "Data da OS": dataFonte(linha[4]),
        "Cliente na origem": texto(linha[1]),
        "CPF/CNPJ": doc,
        "Tipo": analise["Tipo de pessoa"],
        "Cadastro automatico seguro": analise["Cadastro automatico seguro"],
        "Classificacao do cliente": analise.Classificacao,
        "Outros bloqueios da OS": outrosBloqueios.join("; "),
        "Liberada resolvendo o cliente": outrosBloqueios.length === 0 ? "SIM" : "NAO",
        "Liberada pela acao sugerida agora":
          outrosBloqueios.length === 0 &&
          ["APTO_CADASTRO_AUTOMATICO", "VINCULAR_CLIENTE_EXISTENTE"].includes(String(analise.Classificacao))
            ? "SIM"
            : "NAO",
        "Telefone": texto(linha[3]),
        "E-mail": email(linha[22]),
        "Placa": compacto(linha[26]),
        "Modelo": texto(linha[24]),
      };
    }).sort((a, b) => Number(a["Registro legado"]) - Number(b["Registro legado"]));

    const aptos = analiseClientes.filter((item) => item["Cadastro automatico seguro"] === "SIM");
    const juridicos = analiseClientes.filter((item) => item["Tipo de pessoa"] === "JURIDICA");
    const invalidos = analiseClientes.filter((item) =>
      String(item["Motivos / alertas"]).includes("SEM_CPF_CNPJ") ||
      String(item["Motivos / alertas"]).includes("CPF_CNPJ_INVALIDO"),
    );
    const revisao = analiseClientes.filter((item) => item.Classificacao === "REVISAO_MANUAL");
    const vincularExistente = analiseClientes.filter((item) => item.Classificacao === "VINCULAR_CLIENTE_EXISTENTE");
    const validarExistente = analiseClientes.filter((item) => item.Classificacao === "VALIDAR_CLIENTE_EXISTENTE");
    const osImediatas = detalhesOs.filter((item) => item["Liberada pela acao sugerida agora"] === "SIM");
    const resumo = [
      { "Indicador": "OS concluidas sem cliente cadastrado", "Quantidade": linhasSemCliente.length, "Observacao": "Quantidade de ordens ainda pendentes no momento da auditoria." },
      { "Indicador": "Clientes unicos na origem", "Quantidade": analiseClientes.length, "Observacao": "Agrupados por CPF/CNPJ; sem documento, agrupados pelo nome." },
      { "Indicador": "Clientes aptos para cadastro automatico seguro", "Quantidade": aptos.length, "Observacao": "Pessoa fisica, CPF valido, nome consistente e sem conflito identificado." },
      { "Indicador": "OS desses clientes aptos", "Quantidade": aptos.reduce((total, item) => total + Number(item["Quantidade de OS"]), 0), "Observacao": "Ainda podem existir outros bloqueios proprios da OS." },
      { "Indicador": "OS que ficariam liberadas so com o cadastro seguro", "Quantidade": aptos.reduce((total, item) => total + Number(item["OS liberadas apenas criando cliente"]), 0), "Observacao": "Nao possuem outro bloqueio no relatorio atual." },
      { "Indicador": "Clientes ja existentes com segunda confirmacao", "Quantidade": vincularExistente.length, "Observacao": "Mesmo nome e confirmacao por veiculo, telefone ou e-mail; nao criar duplicado." },
      { "Indicador": "OS desses clientes ja confirmados", "Quantidade": vincularExistente.reduce((total, item) => total + Number(item["Quantidade de OS"]), 0), "Observacao": "A confirmacao pode valer somente para parte das placas; conferir a aba CLIENTES." },
      { "Indicador": "Clientes de mesmo nome ainda sem segunda confirmacao", "Quantidade": validarExistente.length, "Observacao": "Precisam de documento, telefone ou comprovacao antes de vincular." },
      { "Indicador": "OS de baixo risco liberadas agora", "Quantidade": osImediatas.length, "Observacao": "Soma das OS vinculaveis a cliente existente confirmado e das aptas apos criar 3 pessoas fisicas." },
      { "Indicador": "Pessoas juridicas", "Quantidade": juridicos.length, "Observacao": "A exportacao nao possui cidade/estado, obrigatorios na API atual." },
      { "Indicador": "Clientes sem CPF/CNPJ valido", "Quantidade": invalidos.length, "Observacao": "Exigem documento correto antes do cadastro." },
      { "Indicador": "Clientes com conflito para revisao", "Quantidade": revisao.length, "Observacao": "Nome/e-mail repetido ou dados divergentes." },
      { "Indicador": "Regra recomendada", "Quantidade": "", "Observacao": "Criar automaticamente apenas os aptos; complementar juridicos; revisar conflitos e documentos invalidos." },
    ];

    const workbook = XLSX.utils.book_new();
    const abaResumo = XLSX.utils.json_to_sheet(resumo);
    const abaClientes = XLSX.utils.json_to_sheet(analiseClientes);
    const abaAptos = XLSX.utils.json_to_sheet(aptos);
    const abaJuridicos = XLSX.utils.json_to_sheet(juridicos);
    const abaExistentes = XLSX.utils.json_to_sheet(vincularExistente);
    const abaValidarExistentes = XLSX.utils.json_to_sheet(validarExistente);
    const abaRevisao = XLSX.utils.json_to_sheet([...invalidos, ...revisao]);
    const abaOs = XLSX.utils.json_to_sheet(detalhesOs);
    ajustarPlanilha(abaResumo, [50, 14, 90]);
    ajustarPlanilha(abaClientes, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaAptos, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaJuridicos, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaExistentes, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaValidarExistentes, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaRevisao, [24, 34, 16, 18, 16, 18, 16, 36, 48, 34, 30, 34, 30, 18, 18, 60, 60, 60, 16, 20, 40, 35, 80]);
    ajustarPlanilha(abaOs, [18, 14, 38, 18, 14, 18, 34, 55, 22, 22, 32, 14, 30]);
    XLSX.utils.book_append_sheet(workbook, abaResumo, "RESUMO");
    XLSX.utils.book_append_sheet(workbook, abaClientes, "CLIENTES");
    XLSX.utils.book_append_sheet(workbook, abaAptos, "APTOS_AUTOMATICO");
    XLSX.utils.book_append_sheet(workbook, abaJuridicos, "JURIDICOS_COMPLEMENTAR");
    XLSX.utils.book_append_sheet(workbook, abaExistentes, "EXISTENTES_CONFIRMADOS");
    XLSX.utils.book_append_sheet(workbook, abaValidarExistentes, "EXISTENTES_VALIDAR");
    XLSX.utils.book_append_sheet(workbook, abaRevisao, "REVISAO");
    XLSX.utils.book_append_sheet(workbook, abaOs, "OS_SEM_CLIENTE");
    XLSX.writeFile(workbook, ARQUIVO_SAIDA);

    console.log(JSON.stringify({
      arquivo: ARQUIVO_SAIDA,
      osSemCliente: linhasSemCliente.length,
      clientesUnicos: analiseClientes.length,
      aptosCadastroAutomatico: aptos.length,
      osDosAptos: aptos.reduce((total, item) => total + Number(item["Quantidade de OS"]), 0),
      osLiberadasApenasCriandoCliente: aptos.reduce((total, item) => total + Number(item["OS liberadas apenas criando cliente"]), 0),
      juridicos: juridicos.length,
      semDocumentoValido: invalidos.length,
      revisaoManual: revisao.length,
      vincularClienteExistente: vincularExistente.length,
      osDeClientesExistentesConfirmados: vincularExistente.reduce((total, item) => total + Number(item["Quantidade de OS"]), 0),
      validarClienteExistente: validarExistente.length,
      osBaixoRiscoLiberadasAgora: osImediatas.length,
      minimoApi: contar(analiseClientes, (item) => item["Atende minimo da API"] === "SIM"),
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
