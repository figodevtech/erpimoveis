"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import formatarEmReal from "@/utils/formatarEmReal";

import { reais, type ImportacaoResumida, type MovimentoGravado } from "./types";

/**
 * O histórico de extratos importados, e o que aconteceu com cada linha deles.
 *
 * É onde se responde "de onde veio esta movimentação?": o arquivo, o período,
 * quem importou, e o movimento original com FITID e MEMO ao lado da transação
 * que ele virou.
 */
export function HistoricoImportacoes({
  onAbrirPendencias,
}: {
  onAbrirPendencias: (importacaoId: number) => void;
}) {
  const [importacoes, setImportacoes] = useState<ImportacaoResumida[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [aberta, setAberta] = useState<number | null>(null);
  const [movimentos, setMovimentos] = useState<MovimentoGravado[]>([]);
  const [carregandoDetalhe, setCarregandoDetalhe] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await axios.get("/api/financeiro/conciliacao/ofx?limit=30");
      setImportacoes(resposta.data?.data ?? []);
    } catch (erro) {
      console.error("Erro ao carregar importações:", erro);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const abrir = useCallback(async (id: number) => {
    setAberta(id);
    setCarregandoDetalhe(true);
    try {
      const resposta = await axios.get(`/api/financeiro/conciliacao/ofx/${id}`);
      setMovimentos(resposta.data?.data?.movimentos ?? []);
    } catch (erro) {
      console.error("Erro ao carregar a importação:", erro);
      setMovimentos([]);
    } finally {
      setCarregandoDetalhe(false);
    }
  }, []);

  if (aberta != null) {
    const importacao = importacoes.find((item) => item.id === aberta) ?? null;
    const pendentes = movimentos.filter((movimento) => movimento.status === "PENDENTE").length;

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hover:cursor-pointer"
            onClick={() => setAberta(null)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          {pendentes > 0 ? (
            <Button
              type="button"
              size="sm"
              className="hover:cursor-pointer"
              onClick={() => onAbrirPendencias(aberta)}
            >
              Resolver {pendentes} em aberto
            </Button>
          ) : null}
        </div>

        {importacao ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="text-sm font-medium">{importacao.arquivo_nome}</p>
            <p className="text-muted-foreground">
              {importacao.banco?.titulo ?? "Conta removida"} ·{" "}
              {importacao.periodo_inicio && importacao.periodo_fim
                ? `${formatarDia(importacao.periodo_inicio)} a ${formatarDia(importacao.periodo_fim)}`
                : "período não informado"}{" "}
              · importado em {new Date(importacao.created_at).toLocaleString("pt-BR")}
              {importacao.usuario ? ` por ${importacao.usuario}` : ""}
            </p>
          </div>
        ) : null}

        {carregandoDetalhe ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando movimentos…
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="font-bold">
                  <TableCell>Data</TableCell>
                  <TableCell>Descrição do extrato</TableCell>
                  <TableCell className="text-right">Valor</TableCell>
                  <TableCell>Situação</TableCell>
                  <TableCell>Transação</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movimentos.map((movimento) => (
                  <TableRow key={movimento.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatarDia(movimento.data_postagem)}
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <span className="block truncate">
                        {movimento.memo ?? movimento.nome ?? "Sem descrição"}
                      </span>
                      {movimento.fitid ? (
                        <span className="text-[11px] text-muted-foreground">
                          FITID {movimento.fitid}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className={`whitespace-nowrap text-right ${
                        Number(movimento.valor_centavos) > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatarEmReal(reais(Number(movimento.valor_centavos)))}
                    </TableCell>
                    <TableCell>
                      <EstadoDoMovimento status={movimento.status} acao={movimento.acao_conciliacao} />
                    </TableCell>
                    <TableCell>
                      {movimento.transacao_id ? (
                        <span>
                          #{movimento.transacao_id}
                          {movimento.titulo_origem_id &&
                          movimento.titulo_origem_id !== movimento.transacao_id
                            ? ` (título #${movimento.titulo_origem_id})`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {carregando ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando importações…
        </p>
      ) : importacoes.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          Nenhum extrato importado até agora.
        </p>
      ) : (
        <div className="max-h-[55vh] overflow-y-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="font-bold">
                <TableCell>Conta</TableCell>
                <TableCell>Arquivo</TableCell>
                <TableCell>Período</TableCell>
                <TableCell className="text-right">Movimentos</TableCell>
                <TableCell className="text-right">Conciliados</TableCell>
                <TableCell className="text-right">Em aberto</TableCell>
                <TableCell>Importado em</TableCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importacoes.map((importacao) => (
                <TableRow
                  key={importacao.id}
                  onClick={() => void abrir(importacao.id)}
                  className="hover:cursor-pointer"
                >
                  <TableCell>{importacao.banco?.titulo ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{importacao.arquivo_nome}</span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {importacao.periodo_inicio && importacao.periodo_fim
                      ? `${formatarDia(importacao.periodo_inicio)} – ${formatarDia(importacao.periodo_fim)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {importacao.quantidade_importados}
                    {importacao.quantidade_repetidos > 0 ? (
                      <span className="text-muted-foreground">
                        {" "}
                        (+{importacao.quantidade_repetidos} repetidos)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">{importacao.situacoes.conciliados}</TableCell>
                  <TableCell className="text-right">{importacao.situacoes.pendentes}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {new Date(importacao.created_at).toLocaleDateString("pt-BR")}
                    {importacao.usuario ? ` · ${importacao.usuario}` : ""}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EstadoDoMovimento({ status, acao }: { status: string; acao: string | null }) {
  const aparencia =
    status === "CONCILIADO"
      ? "border-sky-600/40 bg-sky-600/10 text-sky-700 dark:text-sky-400"
      : status === "IGNORADO"
        ? "border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400"
        : "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400";

  const rotulo =
    status === "CONCILIADO"
      ? acao === "CRIAR"
        ? "Criado"
        : acao === "BAIXA_PARCIAL"
          ? "Baixa parcial"
          : acao === "LIQUIDAR"
            ? "Baixado"
            : "Vinculado"
      : status === "IGNORADO"
        ? "Ignorado"
        : "Em aberto";

  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${aparencia}`}
    >
      {rotulo}
    </span>
  );
}

/** Data em `yyyy-mm-dd` não tem fuso: montar como Date puro a moveria um dia. */
function formatarDia(valor: string): string {
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}
