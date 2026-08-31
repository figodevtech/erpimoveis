"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerDialog } from "@/app/(app)/(pages)/clientes/components/customerDialogRegister/customerDialog";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import { formatCpfCnpj } from "@/lib/nfe/recipientNormalization";
import formatarTelefone from "@/utils/formatarTelefone";
import { cn } from "@/lib/utils";
import { ExternalLink, FileText, Mail, MapPin, Phone, Send, User2 } from "lucide-react";
import { useSession } from "next-auth/react";
import type { ComponentType, ReactNode } from "react";

/** Formato mínimo comum entre OS e venda: cada tela envia o que já carregou. */
export type ClienteResumo = {
  id?: number | null;
  nome?: string | null;
  nomerazaosocial?: string | null;
  tipopessoa?: string | null;
  cpfcnpj?: string | null;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  endereconumero?: string | null;
  enderecocomplemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  status?: string | null;
  rank?: string | null;
  historico?: boolean;
};

const statusClasses: Record<string, string> = {
  ATIVO: "bg-emerald-600/15 text-emerald-600 dark:text-emerald-400",
  INATIVO: "bg-muted text-muted-foreground",
  PENDENTE: "bg-amber-600/15 text-amber-600 dark:text-amber-400",
};

const rankClasses: Record<string, string> = {
  EXCELENTE: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  ALTO: "border-sky-500/30 text-sky-600 dark:text-sky-400",
  NORMAL: "border-border text-muted-foreground",
  BAIXO: "border-red-500/30 text-red-600 dark:text-red-400",
};

function limpar(value?: string | null) {
  const texto = String(value ?? "").trim();
  return texto.length > 0 ? texto : null;
}

function Linha({
  icon: Icone,
  rotulo,
  valor,
  href,
}: {
  icon: ComponentType<{ className?: string }>;
  rotulo: string;
  valor: string | null;
  href?: string;
}) {
  if (!valor) return null;

  return (
    <div className="flex items-start gap-2">
      <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <span className="sr-only">{rotulo}: </span>
        {href ? (
          <a
            href={href}
            className="block truncate text-xs hover:underline"
            title={valor}
            onClick={(event) => event.stopPropagation()}
          >
            {valor}
          </a>
        ) : (
          <span className="block truncate text-xs" title={valor}>
            {valor}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Card de cliente compartilhado pelos detalhes da OS e pelos painéis de
 * pagamento (OS e venda). Mostra os dados básicos e leva ao cadastro completo.
 */
export function ClienteResumoCard({
  cliente,
  className,
  variant = "compact",
  onClienteAtualizado,
  acoes,
}: {
  cliente?: ClienteResumo | null;
  className?: string;
  /** "compact" segue as etiquetas em caixa alta dos painéis financeiros. */
  variant?: "compact" | "default";
  onClienteAtualizado?: () => void;
  /**
   * Ações do dono do card (ex.: trocar a titularidade da OS). Fica como slot
   * para o card seguir servindo OS e vendas sem conhecer nenhuma das duas.
   */
  acoes?: ReactNode;
}) {
  const { data: session } = useSession();
  const podeAcessarCliente = permissionSetHas((session?.user as any)?.permissoes, PERMS.CLIENTES);

  const nome = limpar(cliente?.nomerazaosocial) ?? limpar(cliente?.nome);
  const documentoBruto = limpar(cliente?.cpfcnpj) ?? limpar(cliente?.documento);
  const documento = documentoBruto ? formatCpfCnpj(documentoBruto) || documentoBruto : null;
  const telefoneBruto = limpar(cliente?.telefone);
  const telefoneFormatado = telefoneBruto ? formatarTelefone(telefoneBruto) : null;
  const telefone =
    telefoneFormatado && telefoneFormatado !== "Número inválido" ? telefoneFormatado : telefoneBruto;
  const email = limpar(cliente?.email);
  const tipoPessoa = limpar(cliente?.tipopessoa)?.toUpperCase();
  const status = limpar(cliente?.status)?.toUpperCase();
  const rank = limpar(cliente?.rank)?.toUpperCase();

  const logradouro = [limpar(cliente?.endereco), limpar(cliente?.endereconumero)]
    .filter(Boolean)
    .join(", ");
  const municipio = [limpar(cliente?.cidade), limpar(cliente?.estado)].filter(Boolean).join(" - ");
  const endereco =
    [logradouro, limpar(cliente?.bairro), municipio, limpar(cliente?.cep)].filter(Boolean).join(" • ") ||
    null;

  return (
    <div className={cn("rounded-lg border bg-card p-4", className)}>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <User2 className="h-4 w-4 shrink-0 text-primary" />
          <span
            className={
              variant === "compact"
                ? "text-[11px] uppercase tracking-wide text-muted-foreground"
                : "text-sm font-medium"
            }
          >
            Cliente
          </span>
          {cliente?.historico ? (
            <Badge variant="outline" className="border-sky-300 bg-sky-50 text-[10px] text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
              Legado
            </Badge>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {acoes}

          {cliente?.id && podeAcessarCliente ? (
            <CustomerDialog customerId={Number(cliente.id)} onUpdate={() => onClienteAtualizado?.()}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-xs hover:cursor-pointer"
                title="Abrir cadastro do cliente"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Cliente
              </Button>
            </CustomerDialog>
          ) : null}
        </div>
      </div>

      {nome ? (
        <>
          <p className="truncate text-sm font-medium" title={nome}>
            {nome}
          </p>

          {tipoPessoa || status || rank || telefoneBruto ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {tipoPessoa ? (
                <Badge variant="secondary" className="text-[10px]">
                  {tipoPessoa === "JURIDICA" ? "Pessoa jurídica" : "Pessoa física"}
                </Badge>
              ) : null}
              {status ? (
                <Badge className={cn("text-[10px]", statusClasses[status] ?? "")}>{status}</Badge>
              ) : null}
              {telefoneBruto ? (
                <a
                  href={`https://wa.me/55${telefoneBruto.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Conversar no WhatsApp"
                  onClick={(event) => event.stopPropagation()}
                  className="flex w-max items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] text-primary-foreground hover:bg-primary/90"
                >
                  WhatsApp
                  <Send className="h-2.5 w-2.5" />
                </a>
              ) : null}
              {rank ? (
                <Badge variant="outline" className={cn("text-[10px]", rankClasses[rank] ?? "")}>
                  Rank {rank}
                </Badge>
              ) : null}
            </div>
          ) : null}

          <div className="mt-2.5 space-y-1.5">
            <Linha icon={FileText} rotulo="Documento" valor={documento} />
            <Linha
              icon={Phone}
              rotulo="Telefone"
              valor={telefone}
              href={telefoneBruto ? `tel:${telefoneBruto.replace(/\D/g, "")}` : undefined}
            />
            <Linha icon={Mail} rotulo="E-mail" valor={email} href={email ? `mailto:${email}` : undefined} />
            <Linha icon={MapPin} rotulo="Endereço" valor={endereco} />
            {!documento && !telefone && !email && !endereco ? (
              <span className="block text-xs text-muted-foreground">Sem dados de contato cadastrados.</span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Cliente não vinculado</p>
      )}
    </div>
  );
}
