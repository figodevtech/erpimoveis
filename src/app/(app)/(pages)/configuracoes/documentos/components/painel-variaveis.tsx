"use client";

import { useMemo, useState } from "react";
import { Copy, FileStack, Plus, Repeat, Search, X } from "lucide-react";

import { CATALOGOS, TRECHOS_DA_FOLHA, trechoDaLista } from "@/lib/documentos/catalogo";
import type { ListaDocumento, ModuloDocumento, VariavelDocumento } from "@/lib/documentos/tipos";
import { toast } from "@/lib/toast";

type Props = {
  modulo: ModuloDocumento;
  onInserir: (trecho: string) => void;
  desabilitado?: boolean;
};

function casa(busca: string, ...textos: string[]) {
  if (!busca) return true;
  const alvo = busca.toLocaleLowerCase("pt-BR");
  return textos.some((t) => t.toLocaleLowerCase("pt-BR").includes(alvo));
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${texto} copiado.`);
  } catch {
    toast.error("Não foi possível copiar.");
  }
}

function LinhaVariavel({
  chave,
  variavel,
  onInserir,
  desabilitado,
}: {
  chave: string;
  variavel: VariavelDocumento;
  onInserir: (t: string) => void;
  desabilitado?: boolean;
}) {
  const marcador = `{{${chave}}}`;
  return (
    <li className="group relative">
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => onInserir(marcador)}
        className="flex w-full items-start gap-2 rounded-md py-1.5 pl-2 pr-9 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none enabled:hover:cursor-pointer disabled:cursor-default"
        title={desabilitado ? undefined : "Inserir no cursor"}
      >
        <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <code className="truncate font-mono text-[11.5px] font-medium text-foreground">{chave}</code>
            {variavel.tipo === "html" ? (
              <span className="shrink-0 rounded-sm bg-sky-100 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                bloco
              </span>
            ) : null}
          </span>
          <span className="block text-[11.5px] leading-snug text-muted-foreground">{variavel.rotulo}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => void copiar(marcador)}
        aria-label={`Copiar ${marcador}`}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/** As variáveis do módulo; clicar insere no cursor do editor. */
export function PainelVariaveis({ modulo, onInserir, desabilitado }: Props) {
  const [busca, setBusca] = useState("");
  const catalogo = CATALOGOS[modulo];

  const grupos = useMemo(
    () =>
      catalogo.grupos
        .map((g) => ({ ...g, variaveis: g.variaveis.filter((v) => casa(busca, v.chave, v.rotulo, g.rotulo)) }))
        .filter((g) => g.variaveis.length > 0),
    [catalogo, busca],
  );
  const listas = useMemo(
    () =>
      catalogo.listas
        .map((l) => ({ lista: l, campos: l.campos.filter((c) => casa(busca, `${l.item}.${c.chave}`, c.rotulo, l.rotulo, l.chave)) }))
        .filter((l) => l.campos.length > 0),
    [catalogo, busca],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar variável"
            aria-label="Buscar variável"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
          />
          {busca ? (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {desabilitado
            ? "Somente leitura: as variáveis ficam aqui para consulta."
            : "Clique para inserir no cursor. Sem valor no registro, a variável sai em branco."}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!busca && !desabilitado ? (
          <section aria-label="Estrutura da folha">
            <h4 className="sticky top-0 z-10 border-b bg-card/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
              Estrutura da folha A4
            </h4>
            <ul className="px-1.5 py-1">
              {TRECHOS_DA_FOLHA.map((t) => (
                <li key={t.rotulo}>
                  <button
                    type="button"
                    onClick={() => onInserir(t.trecho)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:cursor-pointer hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <FileStack className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium">{t.rotulo}</span>
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">{t.descricao}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {listas.map(({ lista, campos }) => (
          <BlocoLista key={lista.chave} lista={lista} campos={campos} onInserir={onInserir} desabilitado={desabilitado} />
        ))}

        {grupos.map((grupo) => (
          <section key={grupo.rotulo} aria-label={grupo.rotulo}>
            <h4 className="sticky top-0 z-10 border-b bg-card/95 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
              {grupo.rotulo}
            </h4>
            <ul className="px-1.5 py-1">
              {grupo.variaveis.map((variavel) => (
                <LinhaVariavel
                  key={variavel.chave}
                  chave={variavel.chave}
                  variavel={variavel}
                  onInserir={onInserir}
                  desabilitado={desabilitado}
                />
              ))}
            </ul>
          </section>
        ))}

        {grupos.length === 0 && listas.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma variável com “{busca}”.</p>
        ) : null}
      </div>
    </div>
  );
}

function BlocoLista({
  lista,
  campos,
  onInserir,
  desabilitado,
}: {
  lista: ListaDocumento;
  campos: VariavelDocumento[];
  onInserir: (t: string) => void;
  desabilitado?: boolean;
}) {
  return (
    <section aria-label={lista.rotulo}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-card/95 px-3 py-1.5 backdrop-blur-sm">
        <h4 className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">{lista.rotulo}</h4>
        {!desabilitado ? (
          <button
            type="button"
            onClick={() => onInserir(trechoDaLista(lista))}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:cursor-pointer hover:bg-primary/10"
          >
            <Repeat className="h-3 w-3" />
            Inserir repetição
          </button>
        ) : null}
      </div>
      <p className="px-3 pt-2 text-[11px] leading-snug text-muted-foreground">
        Dentro de <code className="rounded bg-muted px-1 font-mono">{`{{#${lista.chave}}}…{{/${lista.chave}}}`}</code> o
        trecho se repete para cada linha.
      </p>
      <ul className="px-1.5 py-1">
        {campos.map((campo) => (
          <LinhaVariavel
            key={campo.chave}
            chave={`${lista.item}.${campo.chave}`}
            variavel={campo}
            onInserir={onInserir}
            desabilitado={desabilitado}
          />
        ))}
      </ul>
    </section>
  );
}
