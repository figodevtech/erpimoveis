// src/app/(app)/(pages)/meu-perfil/components/tabela-shell.tsx
"use client";

import type { ReactNode } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { MOLA, MOLA_SUAVE, SAIDA, containerDeLinhas, linha } from "../lib/motion";

/*
 * Elementos de tabela animados.
 *
 * Usamos `motion.tbody` / `motion.tr` diretamente, replicando as classes do
 * shadcn, em vez de `motion.create(TableRow)`: o wrapper do shadcn nao encaminha
 * ref explicitamente, e depender do ref-como-prop do React 19 para algo tao
 * central quanto a tabela nao compensa o risco.
 */
const CLASSE_LINHA = "hover:bg-muted/50 border-b transition-colors";

/** Corpo que escalona a entrada das linhas. Troque a `key` para reexecutar. */
export function CorpoAnimado({ className, children, ...props }: HTMLMotionProps<"tbody">) {
  return (
    <motion.tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      variants={containerDeLinhas}
      initial="oculto"
      animate="visivel"
      {...props}
    >
      {children}
    </motion.tbody>
  );
}

export function LinhaAnimada({ className, children, ...props }: HTMLMotionProps<"tr">) {
  return (
    <motion.tr data-slot="table-row" className={cn(CLASSE_LINHA, className)} variants={linha} {...props}>
      {children}
    </motion.tr>
  );
}

/** Chevron que gira em vez de trocar de icone. */
export function BotaoExpandir({
  aberto,
  rotulo,
  controla,
  onClick,
}: {
  aberto: boolean;
  rotulo: string;
  controla: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-expanded={aberto}
      aria-controls={controla}
      aria-label={rotulo}
      whileTap={{ scale: 0.88 }}
      transition={MOLA}
      className={cn(
        "flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors",
        "hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        aberto && "text-foreground",
      )}
    >
      <motion.span animate={{ rotate: aberto ? 90 : 0 }} transition={MOLA} className="flex">
        <ChevronRight className="size-4" aria-hidden />
      </motion.span>
    </motion.button>
  );
}

/**
 * Linha de detalhe que abre e fecha com altura animada. Fica dentro do
 * `AnimatePresence` do chamador para que o fechamento tambem seja animado.
 */
export function LinhaDeDetalhe({
  id,
  colunas,
  children,
}: {
  id: string;
  colunas: number;
  children: ReactNode;
}) {
  return (
    <motion.tr
      className="bg-muted/40"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: SAIDA }}
    >
      <td colSpan={colunas} className="p-0">
        <motion.div
          id={id}
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0, transition: SAIDA }}
          transition={MOLA_SUAVE}
          className="overflow-hidden"
        >
          <div className="px-4 py-3">{children}</div>
        </motion.div>
      </td>
    </motion.tr>
  );
}

export function LinhasCarregando({ colunas, linhas: total = 5 }: { colunas: number; linhas?: number }) {
  return (
    <>
      {Array.from({ length: total }).map((_, indice) => (
        <TableRow key={indice}>
          {Array.from({ length: colunas }).map((__, coluna) => (
            <TableCell key={coluna}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

export function LinhaVazia({ colunas, mensagem }: { colunas: number; mensagem: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colunas} className="h-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={MOLA_SUAVE}
          className="flex flex-col items-center gap-2 text-muted-foreground"
        >
          <Inbox className="size-6" aria-hidden />
          <span className="text-sm">{mensagem}</span>
        </motion.div>
      </TableCell>
    </TableRow>
  );
}

export function LinhaErro({
  colunas,
  mensagem,
  onTentarNovamente,
}: {
  colunas: number;
  mensagem: string;
  onTentarNovamente: () => void;
}) {
  return (
    <TableRow>
      <TableCell colSpan={colunas} className="h-32 text-center">
        <motion.div
          role="alert"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={MOLA_SUAVE}
          className="flex flex-col items-center gap-2"
        >
          <AlertCircle className="size-6 text-destructive" aria-hidden />
          <span className="text-sm text-muted-foreground">{mensagem}</span>
          <Button type="button" variant="outline" size="sm" onClick={onTentarNovamente}>
            Tentar novamente
          </Button>
        </motion.div>
      </TableCell>
    </TableRow>
  );
}

export function Paginacao({
  page,
  totalPages,
  total,
  rotuloItens,
  onMudarPagina,
}: {
  page: number;
  totalPages: number;
  total: number;
  rotuloItens: string;
  onMudarPagina: (pagina: number) => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {total > 0 && (
        <motion.nav
          aria-label="Paginação"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0, transition: SAIDA }}
          transition={MOLA_SUAVE}
          className="overflow-hidden border-t"
        >
          <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {total} {rotuloItens} · página {page} de {totalPages}
            </p>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onMudarPagina(page - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden />
                Anterior
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => onMudarPagina(page + 1)}
              >
                Próxima
                <ChevronRight className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

export function CartaoTabela({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-lg border bg-card">{children}</div>;
}
