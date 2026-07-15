"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { toast } from "@/lib/toast";

import type { Perfil, Permissao } from "./types";
import { listarPerfisEPermissoes, buscarPerfil, criarPerfil, atualizarPerfil } from "./lib/api";

import { TabelaPerfis } from "./components/tabela-perfis";
import { DialogPerfil } from "./components/dialog-perfis";

export default function PerfisClient() {
  const { update } = useSession();
  const [carregando, setCarregando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const [perfis, setPerfis] = React.useState<Perfil[]>([]);
  const [permissoes, setPermissoes] = React.useState<Permissao[]>([]);

  const [dialogAberto, setDialogAberto] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [modoDialog, setModoDialog] = React.useState<"criar" | "editar">("criar");
  const [perfilEmEdicao, setPerfilEmEdicao] = React.useState<Perfil | null>(null);

  // NOVO: loading específico do conteúdo do dialog (principalmente no editar)
  const [carregandoDialog, setCarregandoDialog] = React.useState(false);

  const carregar = React.useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { perfis: pfs, permissoes: pms } = await listarPerfisEPermissoes();
      setPerfis(pfs);
      setPermissoes(pms);
    } catch (e: any) {
      setErro(e?.message ?? "Não foi possível carregar os perfis.");
      setPerfis([]);
      setPermissoes([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  React.useEffect(() => {
    carregar();
  }, [carregar]);

  const abrirCriacao = () => {
    setModoDialog("criar");
    setPerfilEmEdicao(null);
    setCarregandoDialog(false); // no criar não tem fetch do perfil
    setDialogAberto(true);
  };

  const abrirEdicao = async (p: Perfil) => {
    try {
      setModoDialog("editar");
      setPerfilEmEdicao(null);
      setCarregandoDialog(true);
      setDialogAberto(true);

      const completo = await buscarPerfil(p.id);
      setPerfilEmEdicao(completo);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível carregar o perfil para edição.");
      setDialogAberto(false);
      setModoDialog("criar");
    } finally {
      setCarregandoDialog(false);
    }
  };

  const salvar = async (dados: { nome: string; descricao: string; permissoesIds: number[] }) => {
    if (salvando) return;
    setSalvando(true);

    try {
      if (modoDialog === "editar" && perfilEmEdicao?.id) {
        await atualizarPerfil(perfilEmEdicao.id, dados);
        toast.success("Perfil atualizado");
      } else {
        await criarPerfil(dados);
        toast.success("Perfil criado");
      }

      setDialogAberto(false);
      setPerfilEmEdicao(null);
      await carregar();
      await update();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar perfil");
    } finally {
      setSalvando(false);
    }
  };

  // regra: mostra loading no dialog quando estiver buscando o perfil (editar),
  // ou quando permissões ainda não carregaram (primeiro load e usuário abre rápido).
  const carregandoPermissoesDialog = permissoes.length === 0 && carregando;
  const carregandoConteudoDialog = carregandoDialog || carregandoPermissoesDialog;

  return (
    <>
      <TabelaPerfis
        items={perfis}
        loading={carregando}
        error={erro}
        onReload={carregar}
        onNew={abrirCriacao}
        onEdit={abrirEdicao}
      />

      <DialogPerfil
        aberto={dialogAberto}
        setAberto={(open) => {
          setDialogAberto(open);
          if (!open) setCarregandoDialog(false);
        }}
        modo={modoDialog}
        perfilInicial={perfilEmEdicao}
        permissoesDisponiveis={permissoes}
        carregandoConteudo={carregandoConteudoDialog}
        salvando={salvando}
        onSalvar={salvar}
      />
    </>
  );
}
