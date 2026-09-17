import { isValidCnpj, normalizeCnpj } from "@/lib/fiscal-identifiers";

export type PreviousEfdBalance = {
  saldoCredorAnterior: number;
  saldoApurado: number;
  icmsRecolher: number;
  saldoCredorTransportar: number;
};

export type ParsedPreviousEfd = {
  header: {
    layout: string;
    purpose: string;
    startDate: string;
    endDate: string;
    name: string;
    cnpj: string;
  };
  balances: {
    icmsProprio: PreviousEfdBalance;
    difalFcpByUf: Array<Record<string, string | number>>;
  };
  lineCount: number;
  declaredLineCount: number;
};

function fail(message: string): never {
  throw new Error(`EFD anterior inválida: ${message}`);
}

function fields(line: string): string[] {
  if (!line.startsWith("|") || !line.endsWith("|")) {
    fail("todas as linhas devem começar e terminar com pipe (|).");
  }
  return line.split("|").slice(1, -1);
}

function dateFromEfd(value: string, field: string): string {
  if (!/^\d{8}$/.test(value)) fail(`${field} deve usar DDMMAAAA.`);
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const year = Number(value.slice(4, 8));
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) fail(`${field} contém uma data inexistente.`);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function decimal(value: string | undefined): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (!/^-?\d+(?:,\d+)?$/.test(raw)) fail(`valor decimal fora do padrão EFD: ${raw}.`);
  const parsed = Number(raw.replace(",", "."));
  if (!Number.isFinite(parsed)) fail(`valor decimal inválido: ${raw}.`);
  return parsed;
}

export function previousCompetence(targetCompetence: string): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(targetCompetence);
  if (!match) throw new Error("Competência de destino inválida.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function expectedPeriod(targetCompetence: string) {
  const competence = previousCompetence(targetCompetence);
  const [year, month] = competence.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    competence,
    startDate: `${competence}-01`,
    endDate: `${competence}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function parsePreviousEfd(
  content: string,
  targetCompetence: string,
  expectedCompanyCnpj?: string,
): ParsedPreviousEfd {
  if (content.includes("\0")) fail("o arquivo contém bytes nulos.");
  const lines = content.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((line) => line.length > 0);
  if (lines.length < 4) fail("o arquivo não contém a estrutura mínima da EFD.");

  const parsed = lines.map(fields);
  const headerFields = parsed.find((row) => row[0] === "0000");
  if (!headerFields) fail("registro 0000 ausente.");
  const finalFields = parsed.at(-1);
  if (finalFields?.[0] !== "9999") fail("o último registro deve ser o 9999.");

  const layout = String(headerFields[1] ?? "").trim();
  const purpose = String(headerFields[2] ?? "").trim();
  const startDate = dateFromEfd(String(headerFields[3] ?? ""), "0000.DT_INI");
  const endDate = dateFromEfd(String(headerFields[4] ?? ""), "0000.DT_FIN");
  const name = String(headerFields[5] ?? "").trim();
  const cnpj = normalizeCnpj(headerFields[6]);
  if (!isValidCnpj(cnpj)) fail("0000.CNPJ não é válido.");

  const expected = expectedPeriod(targetCompetence);
  if (startDate !== expected.startDate || endDate !== expected.endDate) {
    fail(`o período deve ser ${expected.startDate} a ${expected.endDate}.`);
  }
  if (expectedCompanyCnpj && cnpj !== normalizeCnpj(expectedCompanyCnpj)) {
    fail("o CNPJ do registro 0000 não corresponde ao estabelecimento.");
  }

  const declaredLineCount = Number(finalFields[1]);
  if (!Number.isSafeInteger(declaredLineCount) || declaredLineCount !== lines.length) {
    fail(`9999.QTD_LIN declara ${finalFields[1] || "vazio"}, mas o arquivo possui ${lines.length} linhas.`);
  }

  const e110 = parsed.find((row) => row[0] === "E110");
  const icmsProprio: PreviousEfdBalance = {
    saldoCredorAnterior: decimal(e110?.[9]),
    saldoApurado: decimal(e110?.[10]),
    icmsRecolher: decimal(e110?.[12]),
    saldoCredorTransportar: decimal(e110?.[13]),
  };

  const difalFcpByUf: Array<Record<string, string | number>> = [];
  let currentUf = "";
  for (const row of parsed) {
    if (row[0] === "E300") currentUf = String(row[1] ?? "").trim().toUpperCase();
    if (row[0] === "E310") {
      if (!/^[A-Z]{2}$/.test(currentUf)) fail("E310 encontrado sem E300/UF válido.");
      difalFcpByUf.push({
        uf: currentUf,
        saldoCredorDifalTransportar: decimal(row[10]),
        saldoCredorFcpTransportar: decimal(row[20]),
      });
    }
  }

  return {
    header: { layout, purpose, startDate, endDate, name, cnpj },
    balances: { icmsProprio, difalFcpByUf },
    lineCount: lines.length,
    declaredLineCount,
  };
}
