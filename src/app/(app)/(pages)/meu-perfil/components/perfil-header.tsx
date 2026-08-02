// src/app/(app)/(pages)/meu-perfil/components/perfil-header.tsx
"use client";

import { Building2, Mail, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MOLA, MOLA_SUAVE, SAIDA, containerEscalonado, itemQueSobe } from "../lib/motion";
import type { MeuPerfil } from "../types";

function iniciais(nome: string | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return `${primeira}${ultima}`.toUpperCase();
}

const MOLDURA =
  "relative flex flex-col gap-4 overflow-hidden rounded-lg border bg-card p-4 sm:flex-row sm:items-center";

export function PerfilHeader({ perfil, carregando }: { perfil: MeuPerfil | null; carregando: boolean }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {carregando && !perfil ? (
        <motion.header
          key="esqueleto"
          className={MOLDURA}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: SAIDA }}
        >
          <Skeleton className="size-14 rounded-full" />
          <div className="grid gap-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </motion.header>
      ) : (
        <motion.header
          key="perfil"
          className={MOLDURA}
          variants={containerEscalonado}
          initial="oculto"
          animate="visivel"
        >
          {/* Faixa de luz atras do avatar — ancora o olhar no canto de entrada. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 -left-10 size-40 rounded-full bg-primary opacity-[0.07] blur-3xl"
          />

          <motion.div
            aria-hidden
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={MOLA}
            className="relative flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary ring-1 ring-primary/20"
          >
            {iniciais(perfil?.nome ?? null)}
          </motion.div>

          <div className="relative min-w-0 flex-1">
            <motion.h1 variants={itemQueSobe} className="truncate text-xl font-semibold">
              {perfil?.nome ?? "Meu perfil"}
            </motion.h1>

            <motion.div
              variants={itemQueSobe}
              className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground"
            >
              {perfil?.email && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{perfil.email}</span>
                </span>
              )}
              {perfil?.perfil?.nome && (
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
                  {perfil.perfil.nome}
                </span>
              )}
              {perfil?.setor?.nome && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="size-3.5 shrink-0" aria-hidden />
                  {perfil.setor.nome}
                </span>
              )}
            </motion.div>
          </div>

          {perfil && !perfil.ativo && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={MOLA_SUAVE}
              className="relative"
            >
              <Badge variant="destructive" className="w-fit">
                Inativo
              </Badge>
            </motion.div>
          )}
        </motion.header>
      )}
    </AnimatePresence>
  );
}
