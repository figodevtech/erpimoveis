"use client";

// `import * as React` é o que os componentes testados do projeto fazem: sem
// ele, o runtime clássico de JSX do runner de testes não acha React.
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  classificarBuscaNcm,
  limparDescricaoNcm,
  normalizarCodigoNcm,
  type NcmItem,
} from "@/lib/fiscal/ncm";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;

/**
 * Rótulos já conhecidos, compartilhados por todas as instâncias do seletor.
 *
 * Sem isto, uma nota com quinze itens dispararia quinze consultas só para
 * escrever a descrição ao lado de cada código — e repetiria tudo a cada
 * reabertura do diálogo.
 */
const cacheDeRotulos = new Map<string, NcmItem>();

/** Códigos aguardando rótulo, agrupados para irem numa requisição só. */
let filaDeRotulos = new Set<string>();
let timerDaFila: ReturnType<typeof setTimeout> | null = null;
const ouvintesDaFila = new Set<() => void>();

function agendarBuscaDeRotulo(codigo: string, aoResolver: () => void) {
  filaDeRotulos.add(codigo);
  ouvintesDaFila.add(aoResolver);
  if (timerDaFila) return;

  timerDaFila = setTimeout(async () => {
    const codigos = [...filaDeRotulos];
    const ouvintes = [...ouvintesDaFila];
    filaDeRotulos = new Set();
    ouvintesDaFila.clear();
    timerDaFila = null;

    try {
      const resposta = await fetch(`/api/fiscal/ncm?codigos=${codigos.join(",")}`, {
        cache: "no-store",
      });
      const json = (await resposta.json().catch(() => null)) as
        | { ok?: boolean; items?: NcmItem[] }
        | null;
      if (resposta.ok && json?.ok) {
        for (const item of json.items ?? []) cacheDeRotulos.set(item.codigo, item);
      }
    } catch {
      // Sem rótulo a tela mostra só o código: nunca apaga o valor selecionado.
    }
    for (const ouvinte of ouvintes) ouvinte();
  }, 50);
}

export type EstadoNcmCombobox =
  | { tipo: "OCIOSO" }
  | { tipo: "CURTA" }
  | { tipo: "BUSCANDO" }
  | { tipo: "RESULTADOS"; itens: NcmItem[] }
  | { tipo: "VAZIO" }
  | { tipo: "INEXISTENTE"; codigo: string; sugestoes: NcmItem[] }
  | { tipo: "ERRO" };

type Estado = EstadoNcmCombobox;

export type RespostaBuscaNcm = {
  ok?: boolean;
  items?: NcmItem[];
  codigoInexistente?: string | null;
  sugestoes?: NcmItem[];
};

/**
 * Traduz a resposta da API no estado da lista.
 *
 * Separado do componente para o caminho de erro ser exercitável: o que importa
 * é que nenhuma resposta — nem falha, nem lista vazia — mexa no valor já
 * selecionado. Quem altera o valor é só a seleção do usuário.
 */
export function interpretarRespostaNcm(
  respostaOk: boolean,
  json: RespostaBuscaNcm | null,
): Estado {
  if (!respostaOk || !json?.ok) return { tipo: "ERRO" };

  if (json.codigoInexistente) {
    return {
      tipo: "INEXISTENTE",
      codigo: json.codigoInexistente,
      sugestoes: json.sugestoes ?? [],
    };
  }

  const itens = json.items ?? [];
  return itens.length ? { tipo: "RESULTADOS", itens } : { tipo: "VAZIO" };
}

type Props = {
  /** Só o código, com 8 dígitos. Nunca o rótulo. */
  value: string;
  onValueChange: (codigo: string) => void;
  /** Data fiscal do documento; define quais NCMs estão vigentes. */
  dataFiscal?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

function dataBr(iso: string | null | undefined) {
  if (!iso) return null;
  const [ano, mes, dia] = iso.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/**
 * Seletor de NCM sobre o catálogo oficial (Portal Único Siscomex) carregado em
 * `public.fiscal_ncm`.
 *
 * Busca no servidor, sempre limitada — o catálogo tem mais de 10 mil códigos e
 * nenhum deles é carregado no navegador de uma vez. O valor que sai é só o
 * código; a descrição é exibição, e por isso nunca é duplicada no cadastro.
 */
export function NcmCombobox({
  value,
  onValueChange,
  dataFiscal,
  disabled,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const [estado, setEstado] = useState<Estado>({ tipo: "OCIOSO" });
  const [, forcarRender] = useState(0);

  const codigoSelecionado = normalizarCodigoNcm(value);
  const itemSelecionado = codigoSelecionado ? cacheDeRotulos.get(codigoSelecionado) ?? null : null;

  // Descrição do valor que já está no cadastro: o produto guarda só o código.
  useEffect(() => {
    if (!codigoSelecionado || cacheDeRotulos.has(codigoSelecionado)) return;
    let vivo = true;
    agendarBuscaDeRotulo(codigoSelecionado, () => {
      if (vivo) forcarRender((n) => n + 1);
    });
    return () => {
      vivo = false;
    };
  }, [codigoSelecionado]);

  const buscar = useCallback(
    async (texto: string, signal: AbortSignal) => {
      const { tipo } = classificarBuscaNcm(texto);
      if (tipo === "CURTA") {
        setEstado(texto.trim() ? { tipo: "CURTA" } : { tipo: "OCIOSO" });
        return;
      }

      setEstado({ tipo: "BUSCANDO" });
      try {
        const query = new URLSearchParams({ q: texto });
        if (dataFiscal) query.set("data", dataFiscal);
        const resposta = await fetch(`/api/fiscal/ncm?${query}`, { cache: "no-store", signal });
        const json = (await resposta.json().catch(() => null)) as RespostaBuscaNcm | null;

        if (signal.aborted) return;

        for (const item of json?.items ?? []) cacheDeRotulos.set(item.codigo, item);
        for (const item of json?.sugestoes ?? []) cacheDeRotulos.set(item.codigo, item);

        setEstado(interpretarRespostaNcm(resposta.ok, json));
      } catch (erro) {
        if ((erro as Error)?.name === "AbortError") return;
        setEstado({ tipo: "ERRO" });
      }
    },
    [dataFiscal],
  );

  // Debounce com cancelamento: a busca anterior é abortada quando o termo muda,
  // para uma resposta lenta não sobrescrever a lista do termo mais novo.
  useEffect(() => {
    if (!aberto) return;
    const controle = new AbortController();
    const timer = setTimeout(() => void buscar(termo, controle.signal), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controle.abort();
    };
  }, [aberto, termo, buscar]);

  const selecionar = (item: NcmItem) => {
    cacheDeRotulos.set(item.codigo, item);
    onValueChange(item.codigo);
    setAberto(false);
    setTermo("");
    setEstado({ tipo: "OCIOSO" });
  };

  const rotuloDoBotao = useMemo(() => {
    if (!value) return "Selecione o NCM";
    const descricao = itemSelecionado ? limparDescricaoNcm(itemSelecionado.descricao) : "";
    return descricao ? `${value} — ${descricao}` : value;
  }, [itemSelecionado, value]);

  /**
   * Família, fonte e vigência no tooltip do campo, não abaixo dele.
   *
   * O campo divide a linha com CFOP e unidade: um parágrafo ali quebrava em
   * seis linhas e empurrava o resto do formulário. A família continua visível
   * onde ela serve para escolher — em cada linha da lista, que ocupa a largura
   * do popover.
   */
  const detalheDoCampo = useMemo(() => {
    if (!itemSelecionado) return undefined;
    const vigencia = itemSelecionado.vigenciaFim
      ? `Vigência: ${dataBr(itemSelecionado.vigenciaInicio)} a ${dataBr(itemSelecionado.vigenciaFim)}.`
      : itemSelecionado.vigenciaInicio
        ? `Vigente desde ${dataBr(itemSelecionado.vigenciaInicio)}.`
        : "";
    return [
      itemSelecionado.caminho,
      itemSelecionado.fonte ? `Fonte: ${itemSelecionado.fonte}.` : "",
      vigencia,
    ]
      .filter(Boolean)
      .join(" — ") || undefined;
  }, [itemSelecionado]);

  const linha = (item: NcmItem) => (
    <CommandItem
      key={item.codigo}
      value={`${item.codigo} ${item.descricao}`}
      onSelect={() => selecionar(item)}
      className="items-start gap-2"
    >
      <Check
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          item.codigo === codigoSelecionado ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="min-w-0">
        <span className="block font-bold tabular-nums">{item.codigo}</span>
        <span className="block text-xs">{limparDescricaoNcm(item.descricao)}</span>
        {/* Sem a família, "De sistemas de injeção" não diz injeção de quê — e
            um código "Outros" não diz absolutamente nada. */}
        {item.caminho ? (
          <span className="block text-[11px] leading-snug text-muted-foreground">
            {item.caminho}
          </span>
        ) : null}
      </span>
    </CommandItem>
  );

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={aberto}
            aria-label={ariaLabel ?? "Selecionar NCM"}
            title={detalheDoCampo}
            disabled={disabled}
            className="w-full justify-between px-3 text-left font-normal"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {rotuloDoBotao}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(36rem,calc(100vw-2rem))] p-0">
          {/* A filtragem é do servidor; o Command não pode refiltrar por conta. */}
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Buscar por código ou descrição..."
              value={termo}
              onValueChange={setTermo}
            />
            <CommandList className="max-h-72">
              {estado.tipo === "BUSCANDO" ? (
                <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando NCMs...
                </div>
              ) : null}

              {estado.tipo === "OCIOSO" ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  Digite o código ou parte da descrição. Exemplos: 9032.89.25, injeção.
                </div>
              ) : null}

              {estado.tipo === "CURTA" ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  Digite ao menos 2 caracteres para pesquisar.
                </div>
              ) : null}

              {estado.tipo === "VAZIO" ? (
                <CommandEmpty>Nenhum NCM encontrado.</CommandEmpty>
              ) : null}

              {estado.tipo === "ERRO" ? (
                <div className="px-3 py-6 text-sm text-destructive">
                  Não foi possível consultar o catálogo NCM. O valor atual foi mantido.
                </div>
              ) : null}

              {estado.tipo === "INEXISTENTE" ? (
                <>
                  <div className="px-3 py-3 text-sm text-destructive">
                    NCM {estado.codigo} não encontrado na Nomenclatura Comum do Mercosul.
                  </div>
                  {estado.sugestoes.length ? (
                    <CommandGroup heading="Códigos da mesma subposição">
                      {estado.sugestoes.map(linha)}
                    </CommandGroup>
                  ) : null}
                </>
              ) : null}

              {estado.tipo === "RESULTADOS" ? (
                <CommandGroup>{estado.itens.map(linha)}</CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

    </div>
  );
}

/** Só para os testes: semeia o cache sem passar pela rede. */
export function semearCacheNcm(itens: NcmItem[]) {
  for (const item of itens) cacheDeRotulos.set(item.codigo, item);
}

/** Só para os testes: o cache é global e sobrevive entre montagens. */
export function limparCacheNcm() {
  cacheDeRotulos.clear();
  filaDeRotulos.clear();
  ouvintesDaFila.clear();
  if (timerDaFila) {
    clearTimeout(timerDaFila);
    timerDaFila = null;
  }
}
