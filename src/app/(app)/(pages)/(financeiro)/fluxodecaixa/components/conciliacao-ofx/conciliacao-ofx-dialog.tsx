"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import axios, { isAxiosError } from "axios";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Loader2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";

import { useBancos } from "../../hooks/use-bancos";
import { HistoricoImportacoes } from "./historico-importacoes";
import { MovimentoDialog } from "./movimento-dialog";
import {
  APARENCIA_DA_SITUACAO,
  ROTULO_DA_ACAO,
  reais,
  type Decisao,
  type MovimentoAnalisado,
  type MovimentoGravado,
  type PreviewDoExtrato,
} from "./types";

type Aba = "IMPORTAR" | "HISTORICO";

/**
 * Conciliação bancária por arquivo OFX.
 *
 * Duas etapas, e a separação entre elas é a regra de negócio mais importante da
 * tela: analisar NÃO altera o financeiro. A primeira chamada lê o extrato,
 * compara com o Fluxo de Caixa e com os títulos em aberto e mostra o que
 * encontrou; nada é criado, baixado ou vinculado antes de o usuário confirmar.
 *
 * A decisão padrão de cada linha vem da análise, mas ninguém é conciliado sem
 * estar marcado: o que a tela propõe é sugestão, e a lista existe para ser
 * revisada.
 */
export function ConciliacaoOfxDialog({
  aberto,
  setAberto,
  onConcluido,
}: {
  aberto: boolean;
  setAberto: (valor: boolean) => void;
  onConcluido: () => void;
}) {
  const { bancos, loadingBancos } = useBancos();
  const inputArquivo = useRef<HTMLInputElement>(null);

  const [aba, setAba] = useState<Aba>("IMPORTAR");
  const [bancoId, setBancoId] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [preview, setPreview] = useState<PreviewDoExtrato | null>(null);

  /** Quando preenchido, a tela está resolvendo pendências de uma importação já gravada. */
  const [pendenciasDe, setPendenciasDe] = useState<number | null>(null);
  const [movimentosPendentes, setMovimentosPendentes] = useState<MovimentoAnalisado[]>([]);

  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>({});
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [emEdicao, setEmEdicao] = useState<MovimentoAnalisado | null>(null);
  const [dialogMovimento, setDialogMovimento] = useState(false);

  const movimentos = pendenciasDe != null ? movimentosPendentes : (preview?.movimentos ?? []);

  const limpar = useCallback(() => {
    setPreview(null);
    setArquivo(null);
    setDecisoes({});
    setMarcadas(new Set());
    setPendenciasDe(null);
    setMovimentosPendentes([]);
    if (inputArquivo.current) inputArquivo.current.value = "";
  }, []);

  function fechar(valor: boolean) {
    setAberto(valor);
    if (!valor) {
      limpar();
      setAba("IMPORTAR");
    }
  }

  /**
   * Decisão inicial de cada linha.
   *
   * Só o que a análise conseguiu afirmar sozinha nasce marcado. Ambíguo,
   * revisão manual e "não encontrado" ficam sem decisão de propósito: são
   * justamente os casos em que uma escolha automática erraria.
   */
  function prepararDecisoes(linhas: MovimentoAnalisado[]) {
    const iniciais: Record<string, Decisao> = {};
    const marcar = new Set<string>();

    for (const linha of linhas) {
      if (linha.statusGravado && linha.statusGravado !== "PENDENTE") continue;

      const { acaoSugerida, sugestoes } = linha.analise;
      const sugestao = sugestoes[0];
      if (!acaoSugerida || !sugestao) continue;

      if (acaoSugerida === "VINCULAR") {
        iniciais[linha.fingerprint] = {
          fingerprint: linha.fingerprint,
          movimentoId: linha.movimentoId ?? undefined,
          acao: "VINCULAR",
          transacaoId: sugestao.transacaoId,
        };
        marcar.add(linha.fingerprint);
        continue;
      }

      if (acaoSugerida === "LIQUIDAR" || acaoSugerida === "BAIXA_PARCIAL") {
        // Sem forma de pagamento a baixa não passa, e inventar uma seria pior
        // do que pedir. A linha fica com a decisão montada e desmarcada.
        iniciais[linha.fingerprint] = {
          fingerprint: linha.fingerprint,
          movimentoId: linha.movimentoId ?? undefined,
          acao: "LIQUIDAR",
          transacaoId: sugestao.transacaoId,
          valor: sugestao.parcial ? reais(Math.abs(linha.valorCentavos)) : null,
          metodopagamento: linha.metodoSugerido,
        };
        if (linha.metodoSugerido) marcar.add(linha.fingerprint);
      }
    }

    setDecisoes(iniciais);
    setMarcadas(marcar);
  }

  async function analisar() {
    if (!arquivo || !bancoId) return;

    setAnalisando(true);
    try {
      const dados = new FormData();
      dados.append("arquivo", arquivo);
      dados.append("bancoId", bancoId);

      const resposta = await axios.post("/api/financeiro/conciliacao/ofx/preview", dados);
      const analise = resposta.data?.data as PreviewDoExtrato;

      setPreview(analise);
      prepararDecisoes(analise.movimentos);
    } catch (erro) {
      toast.error(mensagemDeErro(erro, "Não foi possível analisar o extrato."));
    } finally {
      setAnalisando(false);
    }
  }

  async function confirmar() {
    const selecionadas = movimentos
      .filter((movimento) => marcadas.has(movimento.fingerprint))
      .map((movimento) => decisoes[movimento.fingerprint])
      .filter(Boolean);

    setConfirmando(true);
    try {
      if (pendenciasDe != null) {
        const resposta = await axios.post(
          `/api/financeiro/conciliacao/ofx/${pendenciasDe}/conciliar`,
          { decisoes: selecionadas },
        );
        relatar(resposta.data?.data);
      } else {
        if (!arquivo || !bancoId) return;
        const dados = new FormData();
        dados.append("arquivo", arquivo);
        dados.append("bancoId", bancoId);
        dados.append("decisoes", JSON.stringify(selecionadas));

        const resposta = await axios.post("/api/financeiro/conciliacao/ofx/importar", dados);
        relatar(resposta.data?.data);
      }

      onConcluido();
      limpar();
      setAba("HISTORICO");
    } catch (erro) {
      toast.error(mensagemDeErro(erro, "Não foi possível concluir a conciliação."));
    } finally {
      setConfirmando(false);
    }
  }

  function relatar(resultado: any) {
    const conciliados = Number(resultado?.conciliados ?? 0);
    const falhas = Array.isArray(resultado?.falhas) ? resultado.falhas : [];

    if (resultado?.quantidadeImportados != null) {
      toast.success(
        `Extrato importado: ${resultado.quantidadeImportados} movimentos novos` +
          (resultado.quantidadeRepetidos > 0
            ? `, ${resultado.quantidadeRepetidos} já existiam` : "") +
          `. ${conciliados} conciliados.`,
      );
    } else {
      toast.success(`${conciliados} movimentos conciliados.`);
    }

    // As falhas aparecem uma a uma: cada uma tem um motivo próprio, e uma
    // contagem sozinha não diria o que corrigir.
    for (const falha of falhas.slice(0, 5)) {
      toast.error(falha?.erro ?? "Um movimento não pôde ser conciliado.");
    }
  }

  const abrirPendencias = useCallback(async (importacaoId: number) => {
    setPendenciasDe(importacaoId);
    setAba("IMPORTAR");
    try {
      const resposta = await axios.get(`/api/financeiro/conciliacao/ofx/${importacaoId}`);
      const linhas = ((resposta.data?.data?.movimentos ?? []) as MovimentoGravado[])
        .filter((linha) => linha.status === "PENDENTE")
        .map(comoMovimentoAnalisado);

      setMovimentosPendentes(linhas);
      prepararDecisoes(linhas);
    } catch (erro) {
      toast.error(mensagemDeErro(erro, "Não foi possível carregar os movimentos em aberto."));
      setPendenciasDe(null);
    }
  }, []);

  const totalMarcadas = marcadas.size;
  const resumo = preview?.resumo ?? null;

  const podeAnalisar = Boolean(arquivo && bancoId) && !analisando;
  const conta = useMemo(
    () => bancos.find((banco) => String(banco.id) === bancoId) ?? null,
    [bancos, bancoId],
  );

  return (
    <Dialog open={aberto} onOpenChange={fechar}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Conciliação bancária</DialogTitle>
          <DialogDescription>
            Importe o extrato OFX da conta e confira, linha a linha, o que já está no
            financeiro e o que falta lançar.
          </DialogDescription>
        </DialogHeader>

        <div
          role="tablist"
          aria-label="Conciliação bancária"
          className="inline-flex w-fit items-center gap-1.5 rounded-2xl border bg-muted/40 p-1"
        >
          {(
            [
              ["IMPORTAR", "Importar extrato"],
              ["HISTORICO", "Importações"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={aba === valor}
              onClick={() => setAba(valor)}
              className={`inline-flex h-8 items-center justify-center whitespace-nowrap rounded-xl px-3 text-xs font-medium transition-all hover:cursor-pointer ${
                aba === valor
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {aba === "HISTORICO" ? (
          <HistoricoImportacoes onAbrirPendencias={abrirPendencias} />
        ) : movimentos.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Conta bancária</Label>
              <Select value={bancoId} onValueChange={setBancoId} disabled={loadingBancos}>
                <SelectTrigger className="w-full hover:cursor-pointer">
                  <SelectValue placeholder="Escolha a conta do extrato" />
                </SelectTrigger>
                <SelectContent>
                  {bancos.map((banco) => (
                    <SelectItem
                      key={banco.id}
                      value={String(banco.id)}
                      className="hover:cursor-pointer"
                    >
                      {banco.titulo}
                      {banco.contanumero ? ` · ${banco.contanumero}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="ofx-arquivo">Arquivo OFX</Label>
              <Input
                id="ofx-arquivo"
                ref={inputArquivo}
                type="file"
                accept=".ofx,.OFX,text/plain,application/x-ofx"
                className="hover:cursor-pointer"
                onChange={(evento) => setArquivo(evento.target.files?.[0] ?? null)}
              />
            </div>

            <div className="sm:col-span-2">
              <Button
                type="button"
                disabled={!podeAnalisar}
                className="hover:cursor-pointer"
                onClick={() => void analisar()}
              >
                {analisando ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="mr-2 h-4 w-4" />
                )}
                Analisar extrato
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                A análise não altera nada no financeiro: ela só compara o extrato com o que
                já existe. {conta ? `Conta escolhida: ${conta.titulo}.` : ""}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {pendenciasDe != null ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="hover:cursor-pointer"
                onClick={() => {
                  limpar();
                  setAba("HISTORICO");
                }}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar às importações
              </Button>
            ) : null}

            {preview ? (
              <>
                {preview.arquivo.jaImportado ? (
                  <Aviso tom="erro">
                    Este arquivo já foi importado nesta conta em{" "}
                    {new Date(preview.arquivo.jaImportado.created_at).toLocaleDateString("pt-BR")}.
                    Importar de novo será recusado — os movimentos que faltam resolver estão na
                    aba Importações.
                  </Aviso>
                ) : null}

                {preview.divergenciaDeConta ? (
                  <Aviso tom="atencao">{preview.divergenciaDeConta}</Aviso>
                ) : null}

                <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-4">
                  <Dado rotulo="Conta" valor={preview.conta.titulo} />
                  <Dado
                    rotulo="Período"
                    valor={
                      preview.cabecalho.periodoInicio && preview.cabecalho.periodoFim
                        ? `${formatarDia(preview.cabecalho.periodoInicio)} – ${formatarDia(preview.cabecalho.periodoFim)}`
                        : "—"
                    }
                  />
                  <Dado
                    rotulo="Saldo inicial"
                    valor={
                      preview.cabecalho.saldoInicial == null
                        ? "—"
                        : formatarEmReal(preview.cabecalho.saldoInicial)
                    }
                  />
                  <Dado
                    rotulo="Saldo final"
                    valor={
                      preview.cabecalho.saldoFinal == null
                        ? "—"
                        : formatarEmReal(preview.cabecalho.saldoFinal)
                    }
                  />
                  <Dado rotulo="Movimentos" valor={String(resumo?.quantidade ?? 0)} />
                  <Dado
                    rotulo="Créditos"
                    valor={`${resumo?.creditos ?? 0} · ${formatarEmReal(reais(resumo?.totalCreditosCentavos ?? 0))}`}
                  />
                  <Dado
                    rotulo="Débitos"
                    valor={`${resumo?.debitos ?? 0} · ${formatarEmReal(reais(resumo?.totalDebitosCentavos ?? 0))}`}
                  />
                  <Dado
                    rotulo="Situação"
                    valor={`${resumo?.encontrados ?? 0} no fluxo · ${resumo?.provaveis ?? 0} prováveis · ${resumo?.ambiguos ?? 0} ambíguos · ${resumo?.novos ?? 0} novos`}
                  />
                </div>
              </>
            ) : null}

            <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="font-bold">
                    <TableCell className="w-8" />
                    <TableCell>Data</TableCell>
                    <TableCell>Descrição do extrato</TableCell>
                    <TableCell className="text-right">Valor</TableCell>
                    <TableCell>Situação</TableCell>
                    <TableCell>Correspondência</TableCell>
                    <TableCell className="text-right">Ação</TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movimentos.map((movimento) => {
                    const decisao = decisoes[movimento.fingerprint] ?? null;
                    const aparencia = APARENCIA_DA_SITUACAO[movimento.analise.situacao];
                    const bloqueada =
                      movimento.jaImportado && movimento.statusGravado !== "PENDENTE";
                    const sugestao = movimento.analise.sugestoes[0] ?? null;
                    const entrada = movimento.valorCentavos > 0;

                    return (
                      <TableRow key={movimento.fingerprint}>
                        <TableCell>
                          <Checkbox
                            checked={marcadas.has(movimento.fingerprint)}
                            disabled={bloqueada || !decisao}
                            aria-label={`Conciliar movimento de ${movimento.dataPostagem}`}
                            className="hover:cursor-pointer"
                            onCheckedChange={() =>
                              setMarcadas((atual) => {
                                const proximo = new Set(atual);
                                if (proximo.has(movimento.fingerprint)) {
                                  proximo.delete(movimento.fingerprint);
                                } else {
                                  proximo.add(movimento.fingerprint);
                                }
                                return proximo;
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {formatarDia(movimento.dataPostagem)}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <span className="block truncate">
                            {movimento.memo ?? movimento.nome ?? "Sem descrição"}
                          </span>
                          {movimento.tipoOfx ? (
                            <span className="text-[11px] text-muted-foreground">
                              {movimento.tipoOfx}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-right font-medium ${
                            entrada
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {entrada ? "+ " : "- "}
                          {formatarEmReal(reais(Math.abs(movimento.valorCentavos)))}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${aparencia.classe}`}
                          >
                            {bloqueada ? "Já resolvido" : aparencia.rotulo}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          {sugestao ? (
                            <>
                              <span className="block truncate">
                                #{sugestao.transacaoId} {sugestao.descricao}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                score {sugestao.score}
                                {movimento.analise.sugestoes.length > 1
                                  ? ` · ${movimento.analise.sugestoes.length} candidatos`
                                  : ""}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant={decisao ? "secondary" : "outline"}
                            disabled={bloqueada}
                            className="h-7 whitespace-nowrap px-2 text-[11px] hover:cursor-pointer"
                            onClick={() => {
                              setEmEdicao(movimento);
                              setDialogMovimento(true);
                            }}
                          >
                            {decisao
                              ? ROTULO_DA_ACAO[
                                  decisao.acao === "LIQUIDAR" && decisao.valor
                                    ? "BAIXA_PARCIAL"
                                    : decisao.acao
                                ]
                              : "Escolher"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {aba === "IMPORTAR" && movimentos.length > 0 ? (
          <DialogFooter className="gap-2 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {totalMarcadas} de {movimentos.length} movimentos serão conciliados agora. Os
              demais ficam registrados em aberto.
            </p>
            <Button
              type="button"
              disabled={confirmando}
              className="hover:cursor-pointer"
              onClick={() => void confirmar()}
            >
              {confirmando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : pendenciasDe != null ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {pendenciasDe != null ? "Conciliar selecionados" : "Importar e conciliar"}
            </Button>
          </DialogFooter>
        ) : null}

        <MovimentoDialog
          movimento={emEdicao}
          decisaoAtual={emEdicao ? (decisoes[emEdicao.fingerprint] ?? null) : null}
          aberto={dialogMovimento}
          setAberto={setDialogMovimento}
          onDecidir={(decisao) => {
            if (!emEdicao) return;
            const chave = emEdicao.fingerprint;

            setDecisoes((atual) => {
              const proximo = { ...atual };
              if (decisao) proximo[chave] = decisao;
              else delete proximo[chave];
              return proximo;
            });

            setMarcadas((atual) => {
              const proximo = new Set(atual);
              if (decisao) proximo.add(chave);
              else proximo.delete(chave);
              return proximo;
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** A linha gravada, na forma que a tabela e o dialog de escolha já entendem. */
function comoMovimentoAnalisado(linha: MovimentoGravado): MovimentoAnalisado {
  return {
    sequencia: linha.sequencia,
    tipoOfx: linha.tipo_ofx,
    dataPostagem: String(linha.data_postagem).slice(0, 10),
    dataDisponivel: null,
    valorCentavos: Number(linha.valor_centavos),
    fitid: linha.fitid,
    checknum: linha.checknum,
    refnum: linha.refnum,
    nome: linha.nome,
    memo: linha.memo,
    fingerprint: linha.fingerprint,
    analise: linha.analise,
    metodoSugerido: linha.metodoSugerido,
    jaImportado: true,
    movimentoId: linha.id,
    statusGravado: linha.status,
  };
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p className="truncate font-medium">{valor}</p>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "erro" | "atencao"; children: React.ReactNode }) {
  return (
    <p
      className={`flex items-start gap-2 rounded-lg border p-2 text-xs ${
        tom === "erro"
          ? "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400"
          : "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400"
      }`}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function formatarDia(valor: string): string {
  const [ano, mes, dia] = String(valor).slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function mensagemDeErro(erro: unknown, padrao: string): string {
  if (isAxiosError(erro)) return erro.response?.data?.error ?? padrao;
  return erro instanceof Error ? erro.message : padrao;
}
