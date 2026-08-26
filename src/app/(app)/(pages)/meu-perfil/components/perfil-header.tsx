// src/app/(app)/(pages)/meu-perfil/components/perfil-header.tsx
"use client";

import { Building2, LoaderCircle, Mail, Pencil, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, { useRef, type ChangeEvent, type ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

// Linha unica tambem no celular: empilhado, o avatar sozinho custava uma faixa
// inteira de altura antes do primeiro dado util.
const MOLDURA =
  "relative flex items-center gap-3 overflow-hidden rounded-lg border bg-card p-3 sm:gap-4 sm:p-4";

export function PerfilHeader({
  perfil,
  carregando,
  seletorUsuario,
  enviandoFoto = false,
  onFotoSelecionada,
}: {
  perfil: MeuPerfil | null;
  carregando: boolean;
  seletorUsuario?: ReactNode;
  enviandoFoto?: boolean;
  onFotoSelecionada?: (file: File) => Promise<void>;
}) {
  const inputFotoRef = useRef<HTMLInputElement>(null);

  async function selecionarFoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !onFotoSelecionada) return;

    try {
      await onFotoSelecionada(file);
    } finally {
      // Permite selecionar novamente o mesmo arquivo depois de uma falha.
      event.target.value = "";
    }
  }

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
          <Skeleton className="size-12 shrink-0 rounded-full sm:size-14" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-5 w-full max-w-48" />
            <Skeleton className="h-4 w-full max-w-64" />
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
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={MOLA}
            className="relative size-12 shrink-0 sm:size-14"
          >
            <Avatar className="size-full bg-primary/10 text-base font-semibold text-primary ring-1 ring-primary/20 sm:text-lg">
              {perfil?.fotoUrl ? (
                <AvatarImage
                  src={perfil.fotoUrl}
                  alt={`Foto de ${perfil.nome ?? "usuário"}`}
                  className="object-cover"
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-primary">
                {iniciais(perfil?.nome ?? null)}
              </AvatarFallback>
            </Avatar>

            {perfil && onFotoSelecionada ? (
              <>
                <input
                  ref={inputFotoRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => void selecionarFoto(event)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="default"
                  className="absolute -right-1 -bottom-1 size-6 rounded-full border-2 border-card shadow-sm sm:size-7"
                  aria-label={`Alterar foto de ${perfil.nome ?? "usuário"}`}
                  title="Alterar foto"
                  disabled={enviandoFoto}
                  onClick={() => inputFotoRef.current?.click()}
                >
                  {enviandoFoto ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Pencil className="size-3.5" aria-hidden />
                  )}
                </Button>
              </>
            ) : null}
          </motion.div>

          <div className="relative min-w-0 flex-1">
            <motion.h1 variants={itemQueSobe} className="truncate text-lg font-semibold sm:text-xl">
              {perfil?.nome ?? "Meu perfil"}
            </motion.h1>

            <motion.div
              variants={itemQueSobe}
              className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-sm"
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

          {seletorUsuario && (
            <motion.div variants={itemQueSobe} className="relative w-40 shrink-0 sm:w-48">
              {seletorUsuario}
            </motion.div>
          )}

          {perfil && !perfil.ativo && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={MOLA_SUAVE}
              className="relative shrink-0"
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
