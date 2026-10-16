"use client";

import * as React from "react";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useSession } from "next-auth/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

import {
  MoreHorizontal,
  FileEdit,
  Pencil,
  Link2,
  ThumbsUp,
  XCircle,
  RotateCcw,
  Play,
  Send,
  Wallet,
  Eye,
  ClipboardList,
  CreditCard,
  X,
  Printer,
  Gift,
  LogOut,
} from "lucide-react";
import { useConfig } from "../../config-context";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { osPodeEmitirNota } from "@/lib/nfe/elegibilidadeEmissao";

/** Tipo base mínimo da linha */
export type RowBase = {
  id: number;
  status?: string | null;
  descricao?: string | null;
  prioridade?: "ALTA" | "NORMAL" | "BAIXA" | null;
  cliente?: { nome?: string | null; telefone?: string | null } | null;
  veiculo?: { placa?: string | null; modelo?: string | null; marca?: string | null } | null;
  alvo_tipo?: "VEICULO" | "PECA" | "EQUIPAMENTO" | null;
  setor?: { nome?: string | null } | null;
  dataSaida?: string | null;
  datasaida?: string | null;
  migracaoReferencia?: string | null;
};

type Policy = {
  canEditBudget: boolean;
  showEditOS: boolean;
  showLinkAprov: boolean;
  showCancelBudget: boolean;
  showApproveBudget: boolean;
  showRejectBudget: boolean;
  showSendToApproval: boolean;
  showStart: boolean;
  showSendToPayment: boolean;
  showReceivePayment: boolean;
  showStonePayment: boolean;
};

export function RowActions<TRow extends RowBase>({
  row,
  policy,
  onOpenOrcamento,
  onEditar,
  setStatus,
  onSendToApproval,

  // ✅ novos callbacks
  onCancelarOS,
  onResetOS,
  onFinalizeNoCharge,

  // dialogs
  setLinkRow,
  setLinkDialogOpen,
  setConfirmRow,
  setConfirmOpen,
  setPayRow,
  setPayOpen,
  setDetailsId,
  setDetailsOpen,
  setChecklistRow,
  setChecklistOpen,
  setEmissaoId,
  setEmissaoOpen,
  onRegistrarSaida,
}: {
  row: TRow;
  policy: Policy;
  onOpenOrcamento: (row: TRow) => void;
  onEditar: (row: TRow) => void;
  setStatus: (id: number, status: any) => Promise<any> | void;
  onSendToApproval: (row: TRow) => void;

  onCancelarOS: (row: TRow) => void;
  onResetOS: (row: TRow) => void;
  onFinalizeNoCharge: (row: TRow) => void;

  setLinkRow: (row: TRow | null) => void;
  setLinkDialogOpen: (open: boolean) => void;
  setConfirmRow: (row: TRow | null) => void;
  setConfirmOpen: (open: boolean) => void;
  setPayRow: (row: TRow | null) => void;
  setPayOpen: (open: boolean) => void;
  setDetailsId: (id: number | null) => void;
  setDetailsOpen: (open: boolean) => void;
  setChecklistRow: (row: TRow | null) => void;
  setChecklistOpen: (open: boolean) => void;
  setStoneRow: (row: TRow | null) => void;
  setStoneOpen: (open: boolean) => void;
  setEmissaoId: (id: number) => void;
  setEmissaoOpen: (open: boolean) => void;
  onRegistrarSaida: (row: TRow) => void;
}) {
  const { data: session } = useSession();
  const config = useConfig();
  // Só a volta de FATURAMENTO para PAGAMENTO mora aqui. A ida ao faturamento
  // passa pelo diálogo de condições da tabela, que coleta o acordo do cliente.
  const [devolverAberto, setDevolverAberto] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const canEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.ORDENS_EDITAR);
  const canFinanceiroEdit = permissionSetHas((session?.user as any)?.permissoes, PERMS.FINANCEIRO_EDITAR);
  const canNotasFiscais = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.FINANCEIRO_NOTAS_FISCAIS,
  );
  const canFinishNoCharge = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.ORDENS_FINALIZAR_SEM_COBRANCA,
  );
  const st = String(row.status ?? "").toUpperCase();
  const migrada = Boolean(row.migracaoReferencia);

  // ✅ finais: sem reset/cancelar
  const isFinalState = st === "CANCELADO" || st === "FINALIZADA" || st === "CONCLUIDO" || st === "SEM_COBRANCA";

  // Checklist editável até EM_ANDAMENTO. A partir de PAGAMENTO não aparece.
  const showChecklist = canEdit && !isFinalState && st !== "PAGAMENTO" && st !== "FATURAMENTO";

  // ✅ reset: exceto aguardando_orcamento e orcamento, e exceto finais
  const showResetOS = canEdit && !isFinalState && st !== "AGUARDANDO_ORCAMENTO" && st !== "ORCAMENTO" && st !== "AGUARDANDO_CHECKLIST";

  // ✅ cancelar: exceto finais
  const showCancelarOS = canEdit && !isFinalState;

  // Orçamento
  const showBudget = canEdit && (st === "ORCAMENTO" || st === "ORCAMENTO_RECUSADO" || st === "ORCAMENTO_APROVADO" || st === "EM_ANDAMENTO") && policy.canEditBudget;

  // Editar OS
  const showEditOS = canEdit && st === "ORCAMENTO" && policy.showEditOS;

  // Link aprovação
  const showLinkAprov = canEdit && policy.showLinkAprov && st === "APROVACAO_ORCAMENTO";

  // Aprovar/reprovar
  const showApproveBudget = canEdit && policy.showApproveBudget && st === "APROVACAO_ORCAMENTO";
  const showRejectBudget = canEdit && policy.showRejectBudget && st === "APROVACAO_ORCAMENTO";

  // Cancelar orçamento
  // Enviar p/ aprovação
  const showSendToApproval = canEdit && policy.showSendToApproval && (st === "ORCAMENTO" || st === "ORCAMENTO_RECUSADO");

  const showEmissaoDeNota = !migrada && osPodeEmitirNota(st, config);

  // Produção / Pagamento
  const showStart = canEdit && policy.showStart && st === "ORCAMENTO_APROVADO";
  const showSendToPayment = canEdit && policy.showSendToPayment && st === "EM_ANDAMENTO";
  const showReceivePayment = canFinanceiroEdit && policy.showReceivePayment && st === (config?.habilitar_faturamento_os ? "FATURAMENTO" : "PAGAMENTO");
  const showFinishNoCharge = canEdit && canFinishNoCharge && st === "EM_ANDAMENTO";
  const showRegistrarSaida = !migrada && canEdit && ["PAGAMENTO", "FATURAMENTO", "CONCLUIDO", "SEM_COBRANCA"].includes(st)
    && !(row.dataSaida ?? row.datasaida);

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 p-0">
          <span className="sr-only">Abrir menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Ações</DropdownMenuLabel>
        {canEdit && config?.habilitar_faturamento_os && (st === "PAGAMENTO" || st === "FATURAMENTO") && (
          <DropdownMenuItem onClick={() => {
            if (st === "PAGAMENTO") {
              setConfirmRow(row);
              setConfirmOpen(true);
            } else setDevolverAberto(true);
          }}>
            <Send className="mr-2 h-4 w-4" />
            {st === "PAGAMENTO" ? "Enviar para faturamento" : "Devolver para pagamento"}
          </DropdownMenuItem>
        )}

        {showChecklist && (
          <DropdownMenuItem
            onClick={() => {
              setChecklistRow(row);
              setChecklistOpen(true);
            }}
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Checklist
          </DropdownMenuItem>
        )}

        {showBudget && (
          <DropdownMenuItem onClick={() => onOpenOrcamento(row)}>
            <FileEdit className="mr-2 h-4 w-4" />
            Orçamento
          </DropdownMenuItem>
        )}

        {showEditOS && (
          <DropdownMenuItem onClick={() => onEditar(row)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar OS
          </DropdownMenuItem>
        )}

        {showSendToApproval && (
          <DropdownMenuItem onClick={() => onSendToApproval(row)}>
            <ThumbsUp className="mr-2 h-4 w-4" />
            Enviar para aprovação
          </DropdownMenuItem>
        )}

        {showApproveBudget && (
          <DropdownMenuItem onClick={() => setStatus(row.id, "ORCAMENTO_APROVADO")}>
            <ThumbsUp className="mr-2 h-4 w-4" />
            Aprovar orçamento
          </DropdownMenuItem>
        )}

        {showRejectBudget && (
          <DropdownMenuItem onClick={() => setStatus(row.id, "ORCAMENTO_RECUSADO")}>
            <XCircle className="mr-2 h-4 w-4" />
            Reprovar orçamento
          </DropdownMenuItem>
        )}

        {/* {showCancelBudget && (
          <DropdownMenuItem onClick={() => setStatus(row.id, "ORCAMENTO")}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Cancelar orçamento
          </DropdownMenuItem>
        )} */}

        {showLinkAprov && (
          <DropdownMenuItem
            onClick={() => {
              setLinkRow(row);
              setLinkDialogOpen(true);
            }}
          >
            <Link2 className="mr-2 h-4 w-4" />
            Gerar link de aprovação
          </DropdownMenuItem>
        )}

        {showStart && (
          <DropdownMenuItem onClick={() => setStatus(row.id, "EM_ANDAMENTO")}>
            <Play className="mr-2 h-4 w-4" />
            Iniciar
          </DropdownMenuItem>
        )}

        {showSendToPayment && (
          <DropdownMenuItem
            onClick={() => {
              setConfirmRow(row);
              setConfirmOpen(true);
            }}
          >
            <Send className="mr-2 h-4 w-4" />
            Enviar p/ pagamento
          </DropdownMenuItem>
        )}

        {showFinishNoCharge && (
          <DropdownMenuItem
            onClick={() => {
              onFinalizeNoCharge(row);
            }}
          >
            <Gift className="mr-2 h-4 w-4" />
            Finalizar sem cobrança
          </DropdownMenuItem>
        )}

        {showReceivePayment && (
          <DropdownMenuItem
            onClick={() => {
              setPayRow(row);
              setPayOpen(true);
            }}
          >
            <Wallet className="mr-2 h-4 w-4" />
            Registrar pagamento
          </DropdownMenuItem>
        )}

        {showRegistrarSaida && (
          <DropdownMenuItem onClick={() => onRegistrarSaida(row)}>
            <LogOut className="mr-2 h-4 w-4" />
            Registrar saída
          </DropdownMenuItem>
        )}

        {/* {showStonePayment && (
          <DropdownMenuItem
            onClick={() => {
              setStoneRow(row);
              setStoneOpen(true);
            }}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Cobrar na maquineta
          </DropdownMenuItem>
        )} */}

        {canNotasFiscais && config?.habilitar_emissao_nfe && showEmissaoDeNota && config?.emissao_nf_no_modulo_ordens && (
          <DropdownMenuItem
            onClick={() => {
              setEmissaoId(row.id);
              setEmissaoOpen(true);
            }}
          >
            <CreditCard className="mr-2 h-4 w-4" />
            Emissão de Nota
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {showResetOS && (
          <DropdownMenuItem onClick={() => onResetOS(row)}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Reiniciar OS
          </DropdownMenuItem>
        )}

        {showCancelarOS && (
          <DropdownMenuItem onClick={() => onCancelarOS(row)}>
            <X className="mr-2 h-4 w-4" />
            Cancelar OS
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => window.open(`/print/ordemservico/${row.id}`, "_blank")}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => {
            setDetailsId(row.id);
            setDetailsOpen(true);
          }}
        >
          <Eye className="mr-2 h-4 w-4" />
          Detalhes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <AlertDialog open={devolverAberto} onOpenChange={(open) => { if (!open && !salvando) setDevolverAberto(false); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Devolver para pagamento — OS #{row.id}</AlertDialogTitle>
          <AlertDialogDescription>
            A OS voltará a aguardar pagamento. Todos os lançamentos existentes serão preservados.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={salvando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction disabled={salvando} onClick={async (event) => {
            event.preventDefault();
            if (salvando) return;
            setSalvando(true);
            try { const ok = await setStatus(row.id, "PAGAMENTO"); if (ok !== false) setDevolverAberto(false); }
            finally { setSalvando(false); }
          }}>{salvando ? "Salvando..." : "Confirmar"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
