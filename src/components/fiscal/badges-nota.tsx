"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Badges de origem de uma nota fiscal.
 *
 * Uma NF-e pode documentar várias OS ou várias vendas. Nesse caso ela aparece
 * na lista de notas de TODAS as origens que cobre — e sem um sinal visível o
 * usuário abre a OS #12, vê uma nota com valor maior que a OS e não entende de
 * onde veio o resto.
 *
 * A convenção de cor por tipo de origem é a que a tela fiscal já usava:
 * OS em sky, venda em violet, entrada neutra, saída em emerald.
 */

export type OrigemDaNota = {
  tipo: "OS" | "VENDA" | "ENTRADA" | "SAIDA";
  id: number;
  ancora: boolean;
};

const CLASSE_POR_TIPO: Record<OrigemDaNota["tipo"], string> = {
  OS: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  VENDA: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  ENTRADA: "border-muted-foreground/30 bg-muted text-muted-foreground",
  SAIDA: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

const ROTULO_POR_TIPO: Record<OrigemDaNota["tipo"], string> = {
  OS: "OS",
  VENDA: "Venda",
  ENTRADA: "Entrada",
  SAIDA: "Saída",
};

/** Plural do tipo, para o badge de agrupamento. */
function rotuloPlural(tipo: OrigemDaNota["tipo"], quantidade: number) {
  if (tipo === "OS") return "OS";
  if (tipo === "VENDA") return quantidade > 1 ? "vendas" : "venda";
  if (tipo === "ENTRADA") return quantidade > 1 ? "entradas" : "entrada";
  return quantidade > 1 ? "saídas" : "saída";
}

/**
 * Diz que a nota cobre mais de uma origem, e quantas.
 *
 * É o badge que resolve a confusão do valor: "Agrupada · 3 OS" explica por que
 * a nota vale mais do que a OS que o usuário está olhando.
 */
export function BadgeAgrupada({
  origens,
  className,
}: {
  origens?: OrigemDaNota[] | null;
  className?: string;
}) {
  const lista = origens ?? [];
  if (lista.length <= 1) return null;

  // O tipo predominante nomeia o grupo. Na prática o grupo é homogêneo — a RPC
  // recusa misturar OS e venda —, mas a saída pode conviver com a âncora.
  const tipo = lista[0].tipo;
  const doTipo = lista.filter((origem) => origem.tipo === tipo);
  if (doTipo.length <= 1) return null;

  return (
    <Badge
      variant="outline"
      className={`border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 ${className ?? ""}`}
      title={`Esta nota documenta: ${doTipo
        .map((origem) => `${ROTULO_POR_TIPO[origem.tipo]} #${origem.id}`)
        .join(", ")}`}
    >
      Agrupada · {doTipo.length} {rotuloPlural(tipo, doTipo.length)}
    </Badge>
  );
}

/**
 * Um badge por origem da nota.
 *
 * `destaque` é a origem pela qual o usuário chegou até aqui: ela fica sólida e
 * as demais em contorno, para ficar claro o que é "esta OS" e o que é "as
 * outras que a mesma nota cobre".
 */
export function VinculosNota({
  origens,
  destaque,
  limite = 4,
}: {
  origens?: OrigemDaNota[] | null;
  destaque?: number | null;
  /** Acima disto, o excedente vira "+N" para não estourar a linha. */
  limite?: number;
}) {
  const lista = origens ?? [];
  if (lista.length === 0) return null;

  // A origem em foco primeiro; o resto por tipo e id, para a ordem não dançar
  // entre renders.
  const ordenadas = [...lista].sort((a, b) => {
    const focoA = destaque != null && a.id === destaque ? 0 : 1;
    const focoB = destaque != null && b.id === destaque ? 0 : 1;
    if (focoA !== focoB) return focoA - focoB;
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    return a.id - b.id;
  });

  const visiveis = ordenadas.slice(0, limite);
  const excedente = ordenadas.length - visiveis.length;

  return (
    <>
      {visiveis.map((origem) => {
        const emFoco = destaque != null && origem.id === destaque;
        return (
          <Badge
            key={`${origem.tipo}-${origem.id}`}
            variant="outline"
            className={`text-[10px] ${CLASSE_POR_TIPO[origem.tipo]} ${emFoco ? "font-semibold" : "opacity-80"}`}
            title={
              emFoco
                ? "A origem que você está vendo."
                : `Esta nota também cobre ${ROTULO_POR_TIPO[origem.tipo]} #${origem.id}.`
            }
          >
            {ROTULO_POR_TIPO[origem.tipo]} #{origem.id}
          </Badge>
        );
      })}
      {excedente > 0 ? (
        <Badge
          variant="outline"
          className="text-[10px] border-muted-foreground/30 bg-muted text-muted-foreground"
          title={ordenadas
            .slice(limite)
            .map((origem) => `${ROTULO_POR_TIPO[origem.tipo]} #${origem.id}`)
            .join(", ")}
        >
          +{excedente}
        </Badge>
      ) : null}
    </>
  );
}
