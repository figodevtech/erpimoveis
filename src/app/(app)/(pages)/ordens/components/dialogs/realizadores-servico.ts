export type RealizadorLite = {
  id: string;
  nome: string | null;
};

export type VinculosRealizadores = {
  realizadores?: RealizadorLite[] | null;
  idusuariorealizador?: string | null;
  realizador?: RealizadorLite | null;
};

type UsuarioNomeado = {
  id: string;
  nome: string | null;
};

function textoNaoVazio(value: unknown): string | null {
  if (value == null) return null;
  const texto = String(value).trim();
  return texto || null;
}

function adicionarRealizador(
  mapa: Map<string, RealizadorLite>,
  idBruto: unknown,
  nomeBruto: unknown,
) {
  const id = textoNaoVazio(idBruto);
  if (!id) return;

  const nome = textoNaoVazio(nomeBruto);
  const existente = mapa.get(id);
  if (!existente) {
    mapa.set(id, { id, nome });
  } else if (!existente.nome && nome) {
    mapa.set(id, { id, nome });
  }
}

/** Usa o vinculo N:N como fonte principal e recorre ao formato singular legado. */
export function normalizarRealizadores(item: VinculosRealizadores): RealizadorLite[] {
  const normalizados = new Map<string, RealizadorLite>();

  for (const realizador of item.realizadores ?? []) {
    adicionarRealizador(normalizados, realizador?.id, realizador?.nome);
  }

  if (normalizados.size > 0) return [...normalizados.values()];

  adicionarRealizador(
    normalizados,
    item.realizador?.id ?? item.idusuariorealizador,
    item.realizador?.nome,
  );
  return [...normalizados.values()];
}

export function normalizarIdsRealizadores(ids: readonly string[]): string[] {
  const normalizados = new Map<string, string>();
  for (const idBruto of ids) {
    const id = textoNaoVazio(idBruto);
    if (id && !normalizados.has(id)) normalizados.set(id, id);
  }
  return [...normalizados.values()];
}

export function resolverNomeRealizador(
  realizador: RealizadorLite,
  usuariosAtivos: readonly UsuarioNomeado[],
): string {
  const nomeDoVinculo = textoNaoVazio(realizador.nome);
  if (nomeDoVinculo) return nomeDoVinculo;

  const nomeDoUsuario = textoNaoVazio(
    usuariosAtivos.find((usuario) => usuario.id === realizador.id)?.nome,
  );
  return nomeDoUsuario ?? "Usuário não identificado";
}

export function descreverRealizadores(
  realizadores: readonly RealizadorLite[],
  usuariosAtivos: readonly UsuarioNomeado[],
): { rotulo: "Realizador" | "Realizadores"; texto: string; nomes: string[] } {
  const nomes = realizadores.map((realizador) =>
    resolverNomeRealizador(realizador, usuariosAtivos),
  );

  return {
    rotulo: realizadores.length > 1 ? "Realizadores" : "Realizador",
    texto: nomes.length > 0 ? nomes.join(", ") : "Sem realizador",
    nomes,
  };
}
