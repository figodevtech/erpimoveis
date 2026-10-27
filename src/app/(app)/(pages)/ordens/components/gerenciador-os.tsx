"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { OrdensTabs } from "./ordens-tabs";

function DialogLoading() {
  return <p role="status" className="fixed bottom-4 right-4 z-50 rounded-md border bg-background p-3 text-sm shadow">Carregando formulário...</p>;
}

const NovaOSDialog = dynamic(() => import("./novaOS/ordem-dialog").then((module) => module.NovaOSDialog), { loading: DialogLoading });
const EditarOSDialog = dynamic(() => import("./editarOS/editar-ordem-dialog").then((module) => module.EditarOSDialog), { loading: DialogLoading });
const OrcamentoDialog = dynamic(() => import("./orcamento/orcamento-dialog").then((module) => module.OrcamentoDialog), { loading: DialogLoading });

type Ordem = any;

export default function GerenciadorOS() {
  const [selecionada, setSelecionada] = useState<Ordem | null>(null);
  const [abrirCriar, setAbrirCriar] = useState(false);
  const [abrirEditar, setAbrirEditar] = useState(false);
  const [abrirOrcamento, setAbrirOrcamento] = useState(false);
  // Depois do primeiro uso, preserva montagem, estado e animacao ao fechar.
  const [dialogsCarregados, setDialogsCarregados] = useState({ criar: false, editar: false, orcamento: false });

  return (
    <>
      <OrdensTabs
        onNovaOS={() => {
          setDialogsCarregados((previous) => ({ ...previous, criar: true }));
          setAbrirCriar(true);
        }}
        onOpenOrcamento={(row) => {
          setDialogsCarregados((previous) => ({ ...previous, orcamento: true }));
          setSelecionada(row as Ordem);
          setAbrirOrcamento(true);
        }}
        onEditar={(row) => {
          setDialogsCarregados((previous) => ({ ...previous, editar: true }));
          setSelecionada(row as Ordem);
          setAbrirEditar(true);
        }}
      />

      {/* Nova OS (sem onCreate; vamos apenas refrescar ao fechar) */}
      {dialogsCarregados.criar && <NovaOSDialog
        open={abrirCriar}
        onOpenChange={(v) => {
          setAbrirCriar(v);
          if (!v) {
            // ao fechar, atualiza a lista (se o usuário criou algo dentro do dialog)
            window.dispatchEvent(new CustomEvent("os:refresh"));
          }
        }}
      />}

      {/* Editar OS */}
      {dialogsCarregados.editar && <EditarOSDialog
        open={abrirEditar}
        onOpenChange={(v) => setAbrirEditar(v)}
        defaultValues={selecionada}
        // onEdit={async (payload) => {
        //   await editarOrdem(payload.id, payload);
        //   setAbrirEditar(false);
        //   window.dispatchEvent(new CustomEvent("os:refresh"));
        // }}
      />}

      {/* Orçamento */}
      {dialogsCarregados.orcamento && <OrcamentoDialog
        open={abrirOrcamento}
        onOpenChange={(v) => {
          setAbrirOrcamento(v);
          if (!v) {
            window.dispatchEvent(new CustomEvent("os:refresh"));
          }
        }}
        osSelecionada={selecionada}
      />}
    </>
  );
}
