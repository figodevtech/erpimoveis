"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";

import { CabecalhoOS } from "./cabecalho-os";
import { TabelaProdutos } from "./tabela-produtos";
import { TabelaServicos } from "./tabela-servicos";
import { AcoesAprovacao } from "./acoes-aprovacao";
import { CartaoFeedback } from "./cartao-feedback";
import { SolicitarDocumento } from "./solicitar-documento";

/* ----------------------------- Tipagens locais ---------------------------- */
type LinhaProduto = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};
type LinhaServico = {
  descricao: string;
  quantidade: number;
  precounitario: number;
  subtotal: number;
};

type Resumo = {
  produtos: LinhaProduto[];
  servicos: LinhaServico[];
  totalProdutos: number;
  totalServicos: number;
  totalGeral: number;
};

type DadosBasicos = {
  osId: number;
  cliente: { nome: string };
  statusOS:
    | "ORCAMENTO"
    | "APROVACAO_ORCAMENTO"
    | "EM_ANDAMENTO"
    | "ORCAMENTO_APROVADO"
    | "PAGAMENTO"
    | "CONCLUIDO"
    | "CANCELADO";
  statusToken: "valido" | "expirado" | "usado";
};

/* ------------------------------- Componente ------------------------------- */
export default function AprovacaoCliente({ token }: { token: string }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dados, setDados] = useState<DadosBasicos | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);

  const [resultado, setResultado] = useState<"aprovado" | "reprovado" | null>(null);

  const [docAberto, setDocAberto] = useState(true);
  const [validandoDoc, setValidandoDoc] = useState(false);
  const [ultimoDoc, setUltimoDoc] = useState<string | null>(null);

  // 1) carrega status do token e infos básicas (sem revelar orçamento)
  async function carregarBasico() {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/ordens/aprovacao/${token}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Falha ao carregar orçamento");

      const statusToken: DadosBasicos["statusToken"] =
        j.usado
          ? "usado"
          : j.expirado
          ? "expirado"
          : (j.statusToken as DadosBasicos["statusToken"]) || "valido";

      const base: DadosBasicos = {
        osId: j.ordemservicoid ?? j.osId,
        cliente: {
          nome: j.cliente?.nomerazaosocial || j.cliente?.nome || "Cliente",
        },
        statusOS: j.statusOS || j.ordemservico?.status || "ORCAMENTO",
        statusToken,
      };

      setDados(base);
      setResumo(null);
      setDocAberto(true);
      setUltimoDoc(null);
    } catch (e: any) {
      console.error(e);
      setErro(e?.message || "Falha ao carregar orçamento");
      setDados(null);
      setResumo(null);
    } finally {
      setCarregando(false);
    }
  }

  // 2) valida documento e, se ok, carrega resumo
  async function validarDocumento(cpfcnpj: string) {
    if (!dados) return;
    setValidandoDoc(true);
    try {
      const doc = (cpfcnpj || "").replace(/\D+/g, "");
      const url = new URL(`/api/ordens/aprovacao/${token}`, window.location.origin);
      url.searchParams.set("doc", doc);

      const r = await fetch(url.toString(), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) throw new Error(j?.error || "CPF/CNPJ inválido para esta OS");
      if (j.acessoLiberado !== true) throw new Error("Documento não confere para este orçamento");

      const resumoOk: Resumo = {
        produtos: Array.isArray(j.produtos) ? j.produtos : j.resumo?.produtos || [],
        servicos: Array.isArray(j.servicos) ? j.servicos : j.resumo?.servicos || [],
        totalProdutos: j.totais?.totalProdutos ?? j.resumo?.totalProdutos ?? 0,
        totalServicos: j.totais?.totalServicos ?? j.resumo?.totalServicos ?? 0,
        totalGeral: j.totais?.totalGeral ?? j.resumo?.totalGeral ?? 0,
      };

      setDados((old) =>
        old
          ? {
              osId: j.ordemservicoid ?? j.osId ?? old.osId,
              cliente: {
                nome: j.cliente?.nomerazaosocial || j.cliente?.nome || old.cliente.nome,
              },
              statusOS: j.statusOS || j.ordemservico?.status || old.statusOS,
              statusToken:
                j.usado || j.expirado
                  ? (j.usado ? "usado" : "expirado")
                  : (j.statusToken as DadosBasicos["statusToken"]) || old.statusToken,
            }
          : null
      );

      setResumo(resumoOk);
      setUltimoDoc(doc);
      setDocAberto(false);
      toast.success("Documento confirmado. Você pode visualizar o orçamento.");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Falha ao validar o documento");
    } finally {
      setValidandoDoc(false);
    }
  }

  useEffect(() => {
    carregarBasico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const statusBloqueio = useMemo<"expirado" | "usado" | null>(() => {
    if (!dados) return null;
    if (dados.statusToken === "expirado") return "expirado";
    if (dados.statusToken === "usado") return "usado";
    return null;
  }, [dados]);

  // Loading
  if (carregando) {
    return (
      <main className="min-h-[80vh] w-full grid place-items-center bg-gradient-to-b from-muted/50 to-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando orçamento…
        </div>
      </main>
    );
  }

  // Erro
  if (erro || !dados) {
    return (
      <main className="min-h-[80vh] w-full grid place-items-center bg-gradient-to-b from-muted/50 to-background p-4">
        <CartaoFeedback
          variante="erro"
          titulo="Falha ao carregar"
          descricao={
            erro ??
            "Não foi possível carregar este orçamento. Verifique o link e tente novamente."
          }
        />
      </main>
    );
  }

  // Pós-ação
  if (resultado === "aprovado") {
    return (
      <main className="min-h-[80vh] w-full grid place-items-center bg-gradient-to-b from-muted/50 to-background p-4">
        <CartaoFeedback
          variante="sucesso"
          titulo="Orçamento aprovado!"
          descricao="Obrigado! Sua OS foi encaminhada para execução."
        />
      </main>
    );
  }
  if (resultado === "reprovado") {
    return (
      <main className="min-h-[80vh] w-full grid place-items-center bg-gradient-to-b from-muted/50 to-background p-4">
        <CartaoFeedback
          variante="aviso"
          titulo="Orçamento recusado"
          descricao="A equipe receberá sua resposta e entrará em contato para ajustar o orçamento."
        />
      </main>
    );
  }

  // Token expirado/usado
  if (statusBloqueio) {
    const tit = statusBloqueio === "expirado" ? "Link expirado" : "Link já utilizado";
    const desc =
      statusBloqueio === "expirado"
        ? "Este link não está mais válido. Solicite um novo orçamento para aprovação."
        : "Este link já foi utilizado. Caso precise revisar, solicite um novo link de aprovação.";
    return (
      <main className="min-h-[80vh] w-full grid place-items-center bg-gradient-to-b from-muted/50 to-background p-4">
        <CartaoFeedback variante="aviso" titulo={tit} descricao={desc} />
      </main>
    );
  }

  return (
    <main className="min-h-[80vh] w-full bg-gradient-to-b from-muted/50 to-background">
      <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <Card className="bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/60 border-border shadow-sm">
          <CardContent className="p-5 sm:p-6 space-y-6">
            <CabecalhoOS
              osId={dados.osId}
              clienteNome={dados.cliente?.nome ?? ""}
              totalGeral={resumo?.totalGeral || 0}
            />

            <div className="space-y-5">
              <TabelaProdutos itens={resumo?.produtos ?? []} />
              <Separator />
              <TabelaServicos itens={resumo?.servicos ?? []} />
            </div>

            <AcoesAprovacao
              token={token}
              totalGeral={resumo?.totalGeral || 0}
              docConfirmado={ultimoDoc}
              onAprovado={() => setResultado("aprovado")}
              onReprovado={() => setResultado("reprovado")}
              disabled={!resumo || !ultimoDoc}
            />
          </CardContent>
        </Card>
      </section>

      {docAberto && (
        <div className="fixed inset-0 bg-background/70 backdrop-blur-sm grid place-items-center p-4 z-40">
          <SolicitarDocumento
            clienteNome={dados.cliente?.nome ?? ""}
            loading={validandoDoc}
            onConfirmar={validarDocumento}
          />
        </div>
      )}
    </main>
  );
}
