"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type AutorizarNfeResponse = {
  ok: boolean;
  ambiente?: string;
  chave?: string;
  idNFe?: string;
  httpStatus?: number;
  mensagem?: string;
  message?: string;
  detalhe?: string;
  /**
   * Só vem `true` quando a SEFAZ ficou inalcançável e o lote comprovadamente
   * NÃO chegou lá. Rejeição fiscal nunca liga esta flag — rejeição se corrige,
   * não vira contingência.
   */
  podeEmitirEmContingencia?: boolean;
  sefaz?: {
    lote?: {
      cStat?: string | number | null;
      xMotivo?: string | null;
      nRec?: string | null;
    };
    protocolo?: {
      cStat?: string | number | null;
      xMotivo?: string | null;
      nProt?: string | null;
    };
  };
  nfeDb?: {
    id: number;
    status?: string | null;
    protocolo?: string | number | null;
  };
};

type AutorizarNfeButtonProps = {
  nfeId: number;
  /**
   * Callback opcional para o pai poder recarregar lista, fechar dialog, etc.
   */
  onAfterAuthorize?: (data: AutorizarNfeResponse) => void;
  /**
   * Chamado quando a SEFAZ não pôde ser alcançada e a NFC-e pode sair em
   * contingência. Quem decide é o operador — por isso a tela só é avisada.
   */
  onContingenciaDisponivel?: (nfeId: number) => void;
} & Omit<React.ComponentProps<typeof Button>, "onClick">;

export function AutorizarNfeButton({
  nfeId,
  onAfterAuthorize,
  onContingenciaDisponivel,
  children,
  disabled,
  ...buttonProps
}: AutorizarNfeButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    if (!nfeId) {
      toast.error("NF-e inválida", {
        description: "ID da nota não foi informado.",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/nfe/autorizar/${nfeId}`, {
        method: "POST",
      });

      // O corpo é lido mesmo em resposta de erro: é nele que vem a indicação de
      // que a nota pode sair em contingência (HTTP 504 na falha de rede).
      const data: AutorizarNfeResponse | null = await res.json().catch(() => null);

      if (!data) {
        toast.error("Erro ao autorizar a nota", {
          description: `HTTP ${res.status} — tente novamente.`,
        });
        return;
      }

      if (data.podeEmitirEmContingencia && onContingenciaDisponivel) {
        toast.warning("A SEFAZ não respondeu.", {
          description:
            data.mensagem ||
            "A nota não chegou à SEFAZ. Você pode emitir em contingência para não travar a venda.",
          icon: <AlertTriangle className="h-5 w-5 text-amber-400" />,
        });
        onContingenciaDisponivel(nfeId);
        onAfterAuthorize?.(data);
        return;
      }

      if (!data.ok) {
        toast.error("Falha ao autorizar NF-e", {
          description:
            data.mensagem ||
            data.message ||
            data.detalhe ||
            "A SEFAZ retornou uma falha na autorização.",
        });
        return;
      }

      const statusDb = (data.nfeDb?.status || "").toUpperCase();
      const protCStat = data.sefaz?.protocolo?.cStat?.toString() ?? null;
      const protMotivo = data.sefaz?.protocolo?.xMotivo ?? null;
      const loteCStat = data.sefaz?.lote?.cStat?.toString() ?? null;
      const loteMotivo = data.sefaz?.lote?.xMotivo ?? null;

      if (statusDb === "AUTORIZADA" || protCStat === "100") {
        toast.success("NF-e autorizada com sucesso!", {
          description: [
            data.ambiente ? `Ambiente: ${data.ambiente}` : null,
            data.chave ? `Chave: ${data.chave}` : null,
            data.nfeDb?.protocolo
              ? `Protocolo: ${data.nfeDb.protocolo}`
              : null,
          ]
            .filter(Boolean)
            .join(" • "),
          icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" />,
        });
      } else if (statusDb === "DENEGADA") {
        toast.error("NF-e denegada pela SEFAZ.", {
          description:
            protMotivo ||
            loteMotivo ||
            `cStat protocolo: ${protCStat ?? "-"} / cStat lote: ${
              loteCStat ?? "-"
            }`,
          icon: <AlertTriangle className="h-5 w-5 text-amber-400" />,
        });
      } else if (statusDb === "REJEITADA") {
        toast.error("NF-e rejeitada pela SEFAZ.", {
          description:
            protMotivo ||
            loteMotivo ||
            `cStat protocolo: ${protCStat ?? "-"} / cStat lote: ${
              loteCStat ?? "-"
            }`,
          icon: <AlertTriangle className="h-5 w-5 text-red-400" />,
        });
                console.log(protMotivo, loteMotivo);

      } else {
        toast.info("Retorno da SEFAZ recebido.", {
          description:
            protMotivo ||
            loteMotivo ||
            `Status da NF-e: ${statusDb || "desconhecido"}`,
        });
        console.log(protMotivo, loteMotivo);
      }

      if (onAfterAuthorize) {
        onAfterAuthorize(data);
      }
    } catch (e: any) {
      toast.error("Erro inesperado ao autorizar NF-e", {
        description: e?.message || "Verifique sua conexão e tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={loading || disabled}
      {...buttonProps}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Autorizando...
        </>
      ) : (
        <>{children ?? "Autorizar NF-e"}</>
      )}
    </Button>
  );
}
