"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestJson, useModulePermission, useRemote } from "@/components/imobiliario/shared";
import { dateLabel } from "@/components/imobiliario/model";
import { getContaSiteLabel } from "../../utils";

const detail: Record<string, string> = {
  EMAIL_NAO_CONFIRMADO: "O cliente se cadastrou no site e ainda não confirmou o e-mail. A confirmação ativa o cadastro automaticamente.",
  CADASTRO_DIVERGENTE: "A conta do site usa este CPF com um e-mail diferente do cadastro. Confira a identidade do cliente antes de liberar o acesso às reservas.",
  CONTA_INTERNA: "O e-mail da conta pertence a um usuário interno do ERP.",
  EMAIL_PROPRIETARIO: "O e-mail da conta pertence ao acesso de um proprietário.",
  BLOQUEADO_PELO_ERP: "Acesso bloqueado pela equipe. O cliente não consegue entrar na área do site.",
};

/** Situação da conta do site no próprio cadastro do cliente; só aparece quando ela existe. */
export default function CustomerSiteAccessCard({ customerId }: { customerId: number }) {
  const { can } = useModulePermission(); const [busy, setBusy] = useState(false);
  const remote = useRemote(`/api/clientes/${customerId}/acesso-site`); const site = remote.data?.item;
  if (!site) return null;
  const act = async (acao: "LIBERAR" | "BLOQUEAR" | "DESBLOQUEAR") => {
    setBusy(true);
    try { await requestJson(`/api/clientes/${customerId}/acesso-site`, { method: "POST", body: JSON.stringify({ acao }) }); toast.success(acao === "LIBERAR" ? "Acesso ao site liberado" : acao === "BLOQUEAR" ? "Acesso ao site bloqueado" : "Acesso ao site desbloqueado"); remote.reload(); }
    catch (error) { toast.error((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-1"><p className="flex items-center gap-2 text-sm font-semibold"><Globe className="h-4 w-4" />{getContaSiteLabel(site)}</p><p className="text-xs text-muted-foreground">{site.email} · cadastro em {dateLabel(site.created_at)}</p>{detail[site.motivo_pendencia] ? <p className="text-xs text-muted-foreground">{detail[site.motivo_pendencia]}</p> : null}</div>
    {can("clientes:editar") ? <div className="flex flex-wrap gap-2">{site.status === "PENDENTE" && site.motivo_pendencia === "CADASTRO_DIVERGENTE" ? <Button type="button" size="sm" disabled={busy} onClick={() => act("LIBERAR")}>Liberar acesso</Button> : null}{site.status === "BLOQUEADO" ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act("DESBLOQUEAR")}>Desbloquear</Button> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act("BLOQUEAR")}>Bloquear acesso</Button>}</div> : null}</div></div>;
}
