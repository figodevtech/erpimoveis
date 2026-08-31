/**
 * Audita placas sem veiculo cadastrado e identifica quais possuem os dados
 * minimos para criar o veiculo e vincular OS historicas. Somente leitura.
 *
 * Uso:
 *   npm run migracao:garage:veiculos-candidatos-xlsx
 */
import fs from "node:fs";
import path from "node:path";

import * as XLSX from "xlsx";

import { connectDatabase, loadDatabaseConfigs, projectRoot } from "../db/lib";

const DIRETORIO = path.join(projectRoot, "docs", "migracao_garagepremium");
const ARQUIVO_SAIDA = path.join(DIRETORIO, "VEICULOS_CANDIDATOS_PARA_VINCULAR_OS_ATUALIZADO.xlsx");
const PREFIXO = "LEGADO_OS_EXPORTACAO:";

type Linha = unknown[];
type ClienteBanco = { id: number; cpfcnpj: string; nomerazaosocial: string };
type VeiculoBanco = { id: number; clienteid: number | null; placa: string; placa_formatada: string; chassi: string | null; tipo: string };
type OrdemMigrada = {
  id: number;
  clienteid: number;
  migracao_referencia: string;
  dataentrada: Date | string;
  veiculo_snapshot: Record<string, unknown> | null;
  cliente_nome: string;
  cliente_documento: string;
};
type ItemHistorico = {
  origem: "MIGRADA" | "PENDENTE";
  osId: number | null;
  registro: number;
  data: string;
  dataOrdenacao: number;
  clienteId: number | null;
  clienteNome: string;
  clienteDocumento: string;
  clienteConfirmado: boolean;
  placa: string;
  marca: string;
  modelo: string;
  ano: number | null;
  anoModelo: number | null;
  chassi: string;
  cor: string;
  combustivel: string;
  km: number | null;
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

function numero(valor: unknown) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function ano(valor: unknown) {
  const n = numero(valor);
  return n != null && n >= 1900 && n <= 2100 ? n : null;
}

function dataFonte(valor: unknown) {
  if (typeof valor !== "number") return { exibicao: texto(valor), ordem: 0 };
  const partes = XLSX.SSF.parse_date_code(valor);
  if (!partes) return { exibicao: texto(valor), ordem: 0 };
  const iso = `${partes.y}-${String(partes.m).padStart(2, "0")}-${String(partes.d).padStart(2, "0")}`;
  return {
    exibicao: `${String(partes.d).padStart(2, "0")}/${String(partes.m).padStart(2, "0")}/${partes.y}`,
    ordem: new Date(`${iso}T00:00:00-03:00`).getTime(),
  };
}

function dataBanco(valor: Date | string) {
  const data = new Date(valor);
  return {
    exibicao: new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(data),
    ordem: data.getTime(),
  };
}

function adicionar<K, V>(mapa: Map<K, V[]>, chave: K, valor: V) {
  const valores = mapa.get(chave) ?? [];
  valores.push(valor);
  mapa.set(chave, valores);
}

function valoresUnicos<T>(valores: T[]) {
  return [...new Set(valores.filter((valor) => valor !== null && valor !== ""))];
}

function valorRepresentativo(itens: ItemHistorico[], campo: keyof ItemHistorico) {
  return itens
    .slice()
    .sort((a, b) => b.dataOrdenacao - a.dataOrdenacao)
    .map((item) => item[campo])
    .find((valor) => valor !== null && valor !== "") ?? "";
}

function ajustar(aba: XLSX.WorkSheet, larguras: number[]) {
  aba["!cols"] = larguras.map((wch) => ({ wch }));
  if (aba["!ref"]) aba["!autofilter"] = { ref: aba["!ref"] };
  aba["!freeze"] = { xSplit: 0, ySplit: 1, topLeftCell: "A2", activePane: "bottomLeft" };
}

async function main() {
  const fonte = fs.readdirSync(DIRETORIO).find((nome) => nome.startsWith("EXPORT") && nome.endsWith("OS.xlsx"));
  if (!fonte) throw new Error("Planilha de exportacao das OS nao encontrada.");
  const workbookFonte = XLSX.read(fs.readFileSync(path.join(DIRETORIO, fonte)));
  const abaFonte = workbookFonte.SheetNames[0];
  if (!abaFonte) throw new Error("A planilha de origem nao possui abas.");
  const concluidas = XLSX.utils
    .sheet_to_json<Linha>(workbookFonte.Sheets[abaFonte], { header: 1, defval: null, raw: true })
    .slice(1)
    .filter((linha) => compacto(linha[13]) === "CONCLUIDOCOMEXITO");

  const configuracao = loadDatabaseConfigs().find((banco) => banco.key === "garage");
  if (!configuracao) throw new Error("Banco Garage Premium nao configurado.");
  const { client } = await connectDatabase(configuracao);

  try {
    const ordensMigradasRes = await client.query<OrdemMigrada>(
      `select os.id, os.clienteid, os.migracao_referencia, os.dataentrada,
              os.veiculo_snapshot, c.nomerazaosocial cliente_nome,
              c.cpfcnpj cliente_documento
         from public.ordemservico os
         join public.cliente c on c.id = os.clienteid
        where os.migracao_referencia like $1
          and os.veiculoid is null`,
      [`${PREFIXO}%`],
    );
    const referenciasMigradasRes = await client.query<{ migracao_referencia: string }>(
      "select migracao_referencia from public.ordemservico where migracao_referencia like $1",
      [`${PREFIXO}%`],
    );
    const clientesRes = await client.query<ClienteBanco>(
      "select id, cpfcnpj, nomerazaosocial from public.cliente where coalesce(is_deleted, false) = false",
    );
    const veiculosRes = await client.query<VeiculoBanco>(
      "select id, clienteid, placa, placa_formatada, chassi, tipo::text from public.veiculo",
    );
    const tiposRes = await client.query<{ tipo: string; quantidade: number }>(
      "select tipo::text, count(*)::int quantidade from public.veiculo group by tipo order by quantidade desc",
    );

    const referenciasMigradas = new Set(
      referenciasMigradasRes.rows.map((ordem) => Number(ordem.migracao_referencia.split(":").at(-1))),
    );
    const clientesPorDocumento = new Map<string, ClienteBanco[]>();
    const veiculosPorPlaca = new Map<string, VeiculoBanco[]>();
    const veiculosPorCanonica = new Map<string, VeiculoBanco[]>();
    const veiculosPorChassi = new Map<string, VeiculoBanco[]>();
    for (const cliente of clientesRes.rows) {
      const chave = documento(cliente.cpfcnpj);
      if (chave) adicionar(clientesPorDocumento, chave, cliente);
    }
    for (const veiculo of veiculosRes.rows) {
      const placa = compacto(veiculo.placa);
      const chassi = compacto(veiculo.chassi);
      if (placa) adicionar(veiculosPorPlaca, placa, veiculo);
      if (veiculo.placa_formatada) adicionar(veiculosPorCanonica, veiculo.placa_formatada, veiculo);
      if (chassi) adicionar(veiculosPorChassi, chassi, veiculo);
    }

    const itens: ItemHistorico[] = [];
    for (const ordem of ordensMigradasRes.rows) {
      const snapshot = ordem.veiculo_snapshot ?? {};
      const placa = compacto(snapshot.placa);
      if (!placa || veiculosPorPlaca.has(placa)) continue;
      const data = dataBanco(ordem.dataentrada);
      itens.push({
        origem: "MIGRADA",
        osId: ordem.id,
        registro: Number(ordem.migracao_referencia.split(":").at(-1)),
        data: data.exibicao,
        dataOrdenacao: data.ordem,
        clienteId: ordem.clienteid,
        clienteNome: ordem.cliente_nome,
        clienteDocumento: documento(ordem.cliente_documento),
        clienteConfirmado: true,
        placa,
        marca: texto(snapshot.marca),
        modelo: texto(snapshot.modelo),
        ano: ano(snapshot.ano_fabricacao),
        anoModelo: ano(snapshot.ano_modelo),
        chassi: compacto(snapshot.chassi),
        cor: texto(snapshot.cor),
        combustivel: texto(snapshot.combustivel),
        km: numero(snapshot.km),
      });
    }

    for (const linha of concluidas.filter((item) => !referenciasMigradas.has(Number(item[0])))) {
      const placa = compacto(linha[26]);
      if (!placa || veiculosPorPlaca.has(placa)) continue;
      const clientes = (clientesPorDocumento.get(documento(linha[15])) ?? []).filter(
        (cliente) => compacto(cliente.nomerazaosocial) === compacto(linha[1]),
      );
      const cliente = clientes.length === 1 ? clientes[0] : null;
      const data = dataFonte(linha[4]);
      itens.push({
        origem: "PENDENTE",
        osId: null,
        registro: Number(linha[0]),
        data: data.exibicao,
        dataOrdenacao: data.ordem,
        clienteId: cliente?.id ?? null,
        clienteNome: cliente?.nomerazaosocial ?? texto(linha[1]),
        clienteDocumento: documento(linha[15]),
        clienteConfirmado: Boolean(cliente),
        placa,
        marca: texto(linha[23]),
        modelo: texto(linha[24]),
        ano: ano(linha[25]),
        anoModelo: ano(linha[59]),
        chassi: compacto(linha[35]),
        cor: texto(linha[34]),
        combustivel: texto(linha[36]),
        km: numero(linha[30]),
      });
    }

    const itensPorPlaca = new Map<string, ItemHistorico[]>();
    const placasHistoricoPorChassi = new Map<string, string[]>();
    for (const item of itens) {
      adicionar(itensPorPlaca, item.placa, item);
      if (item.chassi) adicionar(placasHistoricoPorChassi, item.chassi, item.placa);
    }

    const candidatosBrutos = [...itensPorPlaca.entries()]
      .map(([placa, grupo]) => {
        const migradas = grupo.filter((item) => item.origem === "MIGRADA");
        const pendentes = grupo.filter((item) => item.origem === "PENDENTE");
        const clientesConfirmados = new Map<number, ItemHistorico>();
        for (const item of grupo) {
          if (item.clienteId != null) clientesConfirmados.set(item.clienteId, item);
        }
        const clientesNaoConfirmados = pendentes.filter((item) => !item.clienteConfirmado);
        const marcas = valoresUnicos(grupo.map((item) => compacto(item.marca)));
        const modelos = valoresUnicos(grupo.map((item) => compacto(item.modelo)));
        const chassis = valoresUnicos(grupo.map((item) => item.chassi));
        const anos = valoresUnicos(grupo.map((item) => item.ano));
        const anosModelo = valoresUnicos(grupo.map((item) => item.anoModelo));
        const chassiUnico = chassis.length === 1 ? chassis[0] : "";
        const placasDoChassiNoBanco = chassiUnico
          ? valoresUnicos((veiculosPorChassi.get(chassiUnico) ?? []).map((veiculo) => compacto(veiculo.placa)))
          : [];
        const outrasPlacasDoChassiNoHistorico = chassiUnico
          ? valoresUnicos(placasHistoricoPorChassi.get(chassiUnico) ?? []).filter((item) => item !== placa)
          : [];
        const problemas: string[] = [];
        if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa)) problemas.push("PLACA_INVALIDA");
        if (clientesConfirmados.size === 0) problemas.push("SEM_CLIENTE_CONFIRMADO");
        if (clientesConfirmados.size > 1) problemas.push("MULTIPLOS_CLIENTES_PARA_PLACA");
        if (clientesNaoConfirmados.length) problemas.push("OS_PENDENTE_COM_CLIENTE_NAO_CONFIRMADO");
        if (marcas.length === 0) problemas.push("MARCA_AUSENTE");
        if (marcas.length > 1) problemas.push("MARCAS_DIVERGENTES");
        if (modelos.length === 0) problemas.push("MODELO_AUSENTE");
        if (modelos.length > 1) problemas.push("MODELOS_DIVERGENTES");
        if (chassis.length > 1) problemas.push("CHASSIS_DIVERGENTES");
        if (anos.length > 1) problemas.push("ANOS_DIVERGENTES");
        if (anosModelo.length > 1) problemas.push("ANOS_MODELO_DIVERGENTES");
        if (outrasPlacasDoChassiNoHistorico.length) problemas.push("CHASSI_REUTILIZADO_EM_OUTRA_PLACA");

        const clienteUnico = clientesConfirmados.size === 1 ? [...clientesConfirmados.values()][0] : null;
        const dadosMinimos =
          /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placa) &&
          clientesConfirmados.size === 1 &&
          marcas.length === 1 &&
          modelos.length === 1;
        const aptoVinculo = dadosMinimos && migradas.length > 0;
        const situacao = aptoVinculo
          ? "APTO PARA CADASTRAR E VINCULAR"
          : dadosMinimos
            ? "APTO PARA CADASTRAR; SEM OS MIGRADA"
            : "REVISAR ANTES DO CADASTRO";
        const chassiProposto =
          chassiUnico && placasDoChassiNoBanco.length === 0 && outrasPlacasDoChassiNoHistorico.length === 0
            ? chassiUnico
            : "";
        const observacaoChassi = placasDoChassiNoBanco.length
          ? `Chassi ja usado no banco pelas placas ${placasDoChassiNoBanco.join(", ")}; cadastrar sem chassi.`
          : outrasPlacasDoChassiNoHistorico.length
            ? `Chassi aparece em outras placas do historico (${outrasPlacasDoChassiNoHistorico.join(", ")}); cadastrar sem chassi.`
          : chassis.length > 1
            ? "Mais de um chassi no historico; cadastrar sem chassi ate revisao."
            : !chassiUnico
              ? "Chassi ausente; campo opcional."
              : "Chassi unico disponivel.";

        return {
          "Situação": situacao,
          "Placa": placa,
          "Cliente proposto ID": clienteUnico?.clienteId ?? "",
          "Cliente proposto": clienteUnico?.clienteNome ?? "",
          "CPF/CNPJ cliente": clienteUnico?.clienteDocumento ?? "",
          "Clientes encontrados": [...clientesConfirmados.values()]
            .map((item) => `#${item.clienteId} ${item.clienteNome}`)
            .join(" | "),
          "Quantidade de clientes": clientesConfirmados.size,
          "OS migradas para vincular": migradas.length,
          "IDs das OS migradas": migradas.map((item) => item.osId).sort((a, b) => Number(a) - Number(b)).join(", "),
          "Registros legados migrados": migradas.map((item) => item.registro).sort((a, b) => a - b).join(", "),
          "OS ainda pendentes": pendentes.length,
          "Registros legados pendentes": pendentes.map((item) => item.registro).sort((a, b) => a - b).join(", "),
          "Marca proposta": marcas.length === 1 ? texto(valorRepresentativo(grupo, "marca")) : "",
          "Modelo proposto": modelos.length === 1 ? texto(valorRepresentativo(grupo, "modelo")) : "",
          "Tipo proposto": "CARROS (INFERIDO)",
          "Ano proposto": anos.length === 1 ? anos[0] : "",
          "Ano-modelo proposto": anosModelo.length === 1 ? anosModelo[0] : "",
          "Chassi proposto": chassiProposto,
          "Cor proposta": valoresUnicos(grupo.map((item) => compacto(item.cor))).length === 1 ? texto(valorRepresentativo(grupo, "cor")) : "",
          "Combustível proposto": valoresUnicos(grupo.map((item) => compacto(item.combustivel))).length === 1 ? texto(valorRepresentativo(grupo, "combustivel")) : "",
          "KM mais recente": numero(valorRepresentativo(grupo, "km")) ?? "",
          "Dados mínimos completos": dadosMinimos ? "SIM" : "NÃO",
          "Problemas para revisar": valoresUnicos(problemas).join("; "),
          "Observação sobre chassi": observacaoChassi,
          "Marcas encontradas": marcas.join(" | "),
          "Modelos encontrados": modelos.join(" | "),
          "Chassis encontrados": chassis.join(" | "),
          "Anos encontrados": anos.join(" | "),
          "Anos-modelo encontrados": anosModelo.join(" | "),
          "OS pendentes com cliente não confirmado": clientesNaoConfirmados.length,
        };
      })
      .sort((a, b) => a.Situação.localeCompare(b.Situação) || a.Placa.localeCompare(b.Placa));

    const placasCandidatas = candidatosBrutos.map((item) => item.Placa);
    const canonicasRes = await client.query<{ placa: string; canonica: string }>(
      `select placa, public.to_mercosul_equivalente(placa) canonica
         from unnest($1::text[]) placa`,
      [placasCandidatas],
    );
    const canonicaPorPlaca = new Map(canonicasRes.rows.map((item) => [item.placa, item.canonica]));
    const placasPorCanonica = new Map<string, string[]>();
    for (const item of candidatosBrutos) {
      const canonica = canonicaPorPlaca.get(item.Placa);
      if (canonica) adicionar(placasPorCanonica, canonica, item.Placa);
    }
    const candidatos = candidatosBrutos
      .filter((item) => {
        const canonica = canonicaPorPlaca.get(item.Placa);
        return !canonica || !veiculosPorCanonica.has(canonica);
      })
      .map((item) => {
        const canonica = canonicaPorPlaca.get(item.Placa);
        const equivalentes = canonica ? valoresUnicos(placasPorCanonica.get(canonica) ?? []) : [];
        if (equivalentes.length <= 1) return item;
        const problema = "PLACAS_ANTIGA_MERCOSUL_EQUIVALENTES";
        return {
          ...item,
          "Situação": "REVISAR ANTES DO CADASTRO",
          "Problemas para revisar": [item["Problemas para revisar"], problema].filter(Boolean).join("; "),
          "Observação sobre chassi": `${item["Observação sobre chassi"]} Placas equivalentes: ${equivalentes.join(", ")}.`,
        };
      })
      .sort((a, b) => a.Situação.localeCompare(b.Situação) || a.Placa.localeCompare(b.Placa));

    const detalhes = itens
      .map((item) => ({
        "Origem": item.origem,
        "OS ID": item.osId ?? "",
        "Registro legado": item.registro,
        "Data": item.data,
        "Cliente confirmado": item.clienteConfirmado ? "SIM" : "NÃO",
        "Cliente ID": item.clienteId ?? "",
        "Cliente": item.clienteNome,
        "CPF/CNPJ": item.clienteDocumento,
        "Placa": item.placa,
        "Marca": item.marca,
        "Modelo": item.modelo,
        "Ano": item.ano ?? "",
        "Ano-modelo": item.anoModelo ?? "",
        "Chassi": item.chassi,
        "Cor": item.cor,
        "Combustível": item.combustivel,
        "KM": item.km ?? "",
      }))
      .sort((a, b) => a.Placa.localeCompare(b.Placa) || Number(a["Registro legado"]) - Number(b["Registro legado"]));

    const aptos = candidatos.filter((item) => item.Situação === "APTO PARA CADASTRAR E VINCULAR");
    const aptosSemMigrada = candidatos.filter((item) => item.Situação === "APTO PARA CADASTRAR; SEM OS MIGRADA");
    const revisar = candidatos.filter((item) => item.Situação === "REVISAR ANTES DO CADASTRO");
    const aptosPorCliente = new Map<number, typeof aptos>();
    for (const candidato of aptos) {
      const clienteId = Number(candidato["Cliente proposto ID"]);
      if (Number.isInteger(clienteId) && clienteId > 0) adicionar(aptosPorCliente, clienteId, candidato);
    }
    const clientesAptos = [...aptosPorCliente.entries()]
      .map(([clienteId, veiculos]) => ({
        "Cliente ID": clienteId,
        "Cliente": veiculos[0]["Cliente proposto"],
        "CPF/CNPJ": veiculos[0]["CPF/CNPJ cliente"],
        "Veículos aptos para cadastrar": veiculos.length,
        "Placas": veiculos.map((item) => item.Placa).sort().join(", "),
        "OS migradas para vincular": veiculos.reduce((soma, item) => soma + Number(item["OS migradas para vincular"]), 0),
        "OS ainda pendentes relacionadas": veiculos.reduce((soma, item) => soma + Number(item["OS ainda pendentes"]), 0),
      }))
      .sort((a, b) => b["Veículos aptos para cadastrar"] - a["Veículos aptos para cadastrar"] || a.Cliente.localeCompare(b.Cliente));
    const resumo = [
      { "Indicador": "Placas sem veículo analisadas", "Valor": candidatos.length, "Observação": "Agrupadas por placa entre OS migradas sem vínculo e OS pendentes" },
      { "Indicador": "Placas aptas para cadastrar e vincular", "Valor": aptos.length, "Observação": "Cliente único, placa válida, marca e modelo únicos" },
      { "Indicador": "Clientes com veículos aptos", "Valor": clientesAptos.length, "Observação": "Listados individualmente na aba CLIENTES_APTOS" },
      { "Indicador": "OS migradas que podem ser vinculadas", "Valor": aptos.reduce((soma, item) => soma + Number(item["OS migradas para vincular"]), 0), "Observação": "Após criação transacional dos veículos" },
      { "Indicador": "Veículos aptos sem OS já migrada", "Valor": aptosSemMigrada.length, "Observação": "Podem ajudar numa futura migração das OS pendentes" },
      { "Indicador": "Placas que exigem revisão", "Valor": revisar.length, "Observação": "Cliente, marca, modelo ou placa insuficiente/ambígua" },
      { "Indicador": "Tipo obrigatório proposto", "Valor": "CARROS", "Observação": "Inferência; a origem não fornece o tipo" },
      { "Indicador": "Tipos já cadastrados no Garage Premium", "Valor": tiposRes.rows.map((item) => `${item.tipo}: ${item.quantidade}`).join(" | "), "Observação": "Apenas apoio para validar a inferência do tipo" },
      { "Indicador": "Campos mínimos do sistema", "Valor": "cliente + placa + marca + modelo + tipo", "Observação": "Ano, chassi, cor, combustível e KM são opcionais" },
    ];

    const workbook = XLSX.utils.book_new();
    const abaResumo = XLSX.utils.json_to_sheet(resumo);
    ajustar(abaResumo, [38, 55, 78]);
    XLSX.utils.book_append_sheet(workbook, abaResumo, "RESUMO");
    const abaAptos = XLSX.utils.json_to_sheet(aptos);
    ajustar(abaAptos, [34, 15, 18, 36, 20, 70, 18, 20, 55, 55, 18, 55, 22, 26, 22, 16, 20, 28, 20, 24, 18, 24, 55, 60, 45, 45, 45, 22, 22, 20]);
    XLSX.utils.book_append_sheet(workbook, abaAptos, "APTOS_CADASTRO_VINCULO");
    const abaClientes = XLSX.utils.json_to_sheet(clientesAptos);
    ajustar(abaClientes, [14, 42, 20, 28, 90, 26, 30]);
    XLSX.utils.book_append_sheet(workbook, abaClientes, "CLIENTES_APTOS");
    const abaSemMigrada = XLSX.utils.json_to_sheet(aptosSemMigrada);
    ajustar(abaSemMigrada, [34, 15, 18, 36, 20, 70, 18, 20, 55, 55, 18, 55, 22, 26, 22, 16, 20, 28, 20, 24, 18, 24, 55, 60, 45, 45, 45, 22, 22, 20]);
    XLSX.utils.book_append_sheet(workbook, abaSemMigrada, "APTOS_SOMENTE_PENDENTES");
    const abaRevisar = XLSX.utils.json_to_sheet(revisar);
    ajustar(abaRevisar, [34, 15, 18, 36, 20, 70, 18, 20, 55, 55, 18, 55, 22, 26, 22, 16, 20, 28, 20, 24, 18, 24, 55, 60, 45, 45, 45, 22, 22, 20]);
    XLSX.utils.book_append_sheet(workbook, abaRevisar, "REVISAR");
    const abaDetalhes = XLSX.utils.json_to_sheet(detalhes);
    ajustar(abaDetalhes, [14, 12, 16, 14, 20, 14, 38, 20, 15, 24, 28, 12, 14, 26, 18, 20, 14]);
    XLSX.utils.book_append_sheet(workbook, abaDetalhes, "OS_SEM_VEICULO");

    XLSX.writeFile(workbook, ARQUIVO_SAIDA, { compression: true });
    const verificacao = XLSX.readFile(ARQUIVO_SAIDA);
    if (XLSX.utils.sheet_to_json(verificacao.Sheets.OS_SEM_VEICULO).length !== detalhes.length) {
      throw new Error("A planilha gravada nao preservou todos os detalhes.");
    }
    console.log(`Planilha criada: ${ARQUIVO_SAIDA}`);
    console.log(`Placas analisadas: ${candidatos.length}.`);
    console.log(`Aptas para cadastro e vinculo: ${aptos.length}.`);
    console.log(`Clientes com veiculos aptos: ${clientesAptos.length}.`);
    console.log(`OS migradas que podem ser vinculadas: ${aptos.reduce((soma, item) => soma + Number(item["OS migradas para vincular"]), 0)}.`);
    console.log(`Aptas somente para futuras OS pendentes: ${aptosSemMigrada.length}.`);
    console.log(`Placas que exigem revisao: ${revisar.length}.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
