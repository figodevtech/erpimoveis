// Banco em memória para os testes de integração da emissão.
//
// Imita só o que os serviços fiscais usam do cliente do Supabase: filtros
// simples, ordenação, limite, insert/update/delete e rpc. O `select` não
// projeta colunas nem resolve joins — as linhas semeadas já trazem os objetos
// aninhados (`produto`, `itens`) no formato que a consulta real devolveria.

import { mock } from "node:test";

import { supabaseAdmin } from "@/lib/supabaseAdmin";

type Linha = Record<string, any>;
type Filtro = (linha: Linha) => boolean;

function igual(a: unknown, b: unknown) {
  if (a === null || a === undefined) return b === null || b === undefined;
  return String(a) === String(b);
}

class ConsultaFalsa {
  private filtros: Filtro[] = [];
  private ordem: Array<{ coluna: string; ascendente: boolean }> = [];
  private limite: number | null = null;
  private modo: "lista" | "um" | "talvez" = "lista";
  private operacao: "select" | "insert" | "update" | "delete" = "select";
  private payload: Linha | Linha[] | null = null;
  private retornarLinhas = false;

  constructor(
    private readonly banco: BancoFalso,
    private readonly tabela: string,
  ) {}

  select() {
    if (this.operacao !== "select") this.retornarLinhas = true;
    return this;
  }
  insert(payload: Linha | Linha[]) {
    this.operacao = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Linha) {
    this.operacao = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.operacao = "delete";
    return this;
  }
  eq(coluna: string, valor: unknown) {
    this.filtros.push((linha) => igual(linha[coluna], valor));
    return this;
  }
  neq(coluna: string, valor: unknown) {
    this.filtros.push((linha) => !igual(linha[coluna], valor));
    return this;
  }
  in(coluna: string, valores: unknown[]) {
    this.filtros.push((linha) => valores.some((valor) => igual(linha[coluna], valor)));
    return this;
  }
  /** Coluna array com algum elemento em comum (`&&` do Postgres). */
  overlaps(coluna: string, valores: unknown[]) {
    this.filtros.push((linha) =>
      Array.isArray(linha[coluna]) && linha[coluna].some((item: unknown) => valores.some((valor) => igual(item, valor))),
    );
    return this;
  }
  is(coluna: string, valor: unknown) {
    return this.eq(coluna, valor);
  }
  lte(coluna: string, valor: unknown) {
    this.filtros.push((linha) => String(linha[coluna] ?? "") <= String(valor));
    return this;
  }
  gte(coluna: string, valor: unknown) {
    this.filtros.push((linha) => String(linha[coluna] ?? "") >= String(valor));
    return this;
  }
  like() {
    return this;
  }
  /** Filtros `or` (vigência) não são interpretados: a semente já vem vigente. */
  or() {
    return this;
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordem.push({ coluna, ascendente: opcoes?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  returns() {
    return this;
  }
  single() {
    this.modo = "um";
    return this;
  }
  maybeSingle() {
    this.modo = "talvez";
    return this;
  }

  private executar(): { data: any; error: any } {
    const linhas = this.banco.tabela(this.tabela);
    const alvo = () => linhas.filter((linha) => this.filtros.every((filtro) => filtro(linha)));

    if (this.operacao === "insert") {
      const novas = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((linha) => ({
        id: this.banco.proximoId(this.tabela),
        ...structuredClone(linha),
      }));
      linhas.push(...novas);
      this.banco.registrar(this.tabela, "insert", novas);
      return this.formatar(this.retornarLinhas ? novas : null);
    }
    if (this.operacao === "update") {
      const afetadas = alvo();
      for (const linha of afetadas) Object.assign(linha, structuredClone(this.payload));
      this.banco.registrar(this.tabela, "update", afetadas);
      return this.formatar(this.retornarLinhas ? afetadas : null);
    }
    if (this.operacao === "delete") {
      const removidas = alvo();
      this.banco.substituir(this.tabela, linhas.filter((linha) => !removidas.includes(linha)));
      return { data: null, error: null };
    }

    let resultado = alvo();
    for (const { coluna, ascendente } of [...this.ordem].reverse()) {
      resultado = [...resultado].sort((a, b) => {
        const x = a[coluna];
        const y = b[coluna];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (ascendente ? 1 : -1);
      });
    }
    if (this.limite !== null) resultado = resultado.slice(0, this.limite);
    return this.formatar(structuredClone(resultado));
  }

  private formatar(linhas: Linha[] | null) {
    if (linhas === null) return { data: null, error: null };
    if (this.modo === "lista") return { data: linhas, error: null };
    if (this.modo === "um" && linhas.length !== 1) {
      return { data: null, error: { message: `esperava 1 linha em ${this.tabela}, veio ${linhas.length}` } };
    }
    return { data: linhas[0] ?? null, error: null };
  }

  then<T>(resolve: (valor: { data: any; error: any }) => T, reject?: (erro: unknown) => T) {
    try {
      return Promise.resolve(resolve(this.executar()));
    } catch (erro) {
      return reject ? Promise.resolve(reject(erro)) : Promise.reject(erro);
    }
  }
}

export class BancoFalso {
  private readonly dados = new Map<string, Linha[]>();
  private readonly ids = new Map<string, number>();
  readonly escritas: Array<{ tabela: string; operacao: string; linhas: Linha[] }> = [];
  readonly chamadasRpc: Array<{ nome: string; args: any }> = [];

  constructor(
    semente: Record<string, Linha[]>,
    private readonly rpcs: Record<string, (args: any) => { data?: any; error?: any }> = {},
  ) {
    for (const [tabela, linhas] of Object.entries(semente)) this.dados.set(tabela, structuredClone(linhas));
  }

  tabela(nome: string) {
    if (!this.dados.has(nome)) this.dados.set(nome, []);
    return this.dados.get(nome)!;
  }

  substituir(nome: string, linhas: Linha[]) {
    this.dados.set(nome, linhas);
  }

  proximoId(nome: string) {
    const maior = Math.max(1000, ...this.tabela(nome).map((linha) => Number(linha.id) || 0), this.ids.get(nome) ?? 0);
    this.ids.set(nome, maior + 1);
    return maior + 1;
  }

  registrar(tabela: string, operacao: string, linhas: Linha[]) {
    this.escritas.push({ tabela, operacao, linhas: structuredClone(linhas) });
  }

  instalar() {
    mock.method(supabaseAdmin, "from", (tabela: string) => new ConsultaFalsa(this, tabela));
    mock.method(supabaseAdmin, "rpc", async (nome: string, args: unknown) => {
      this.chamadasRpc.push({ nome, args: structuredClone(args) });
      const handler = this.rpcs[nome];
      const resultado = handler ? handler(args) : {};
      return { data: resultado.data ?? null, error: resultado.error ?? null };
    });
    return this;
  }
}

/** O IBGE responde o nome do município sem sair para a rede. */
export function instalarIbgeFalso(municipios: Record<string, string>) {
  mock.method(globalThis, "fetch", async (url: string | URL) => {
    const codigo = String(url).split("/").pop() ?? "";
    const nome = municipios[codigo];
    return {
      ok: Boolean(nome),
      json: async () => ({ id: Number(codigo), nome }),
    } as Response;
  });
}
