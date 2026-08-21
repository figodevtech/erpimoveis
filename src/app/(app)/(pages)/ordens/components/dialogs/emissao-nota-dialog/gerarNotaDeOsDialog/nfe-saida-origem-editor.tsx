"use client";

// Origem fiscal da NF-e de saída, dentro do próprio diálogo de emissão.
//
// Antes isto era um diálogo separado que gravava o contexto no banco e só
// então abria o assistente de tributação — dois passos para uma decisão só, com
// o destinatário perguntado nos dois. Aqui é uma seção do diálogo de emissão: o
// que o operador escolhe reflete na hora nos itens e viaja no mesmo POST que
// gera o rascunho.

import { AlertCircle, FileSearch, Link2, Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { chaveAcessoValida } from "@/lib/nfe/chaveAcesso";

export type OperacaoFiscalSaidaOption = {
  codigo: string;
  label: string;
  naturezaOperacao: string;
  finalidade: string;
  exigeDocumentoReferenciado: boolean;
};

export type EntradaCandidata = {
  id: number;
  entrada_id: number;
  produto_id: number;
  quantidade: number;
  valor_unitario_compra?: number | string | null;
  precovenda?: number | string | null;
  numero_item_fiscal?: number | null;
  entrada?: {
    id: number;
    notachave?: string | null;
    created_at?: string | null;
    fornecedor?: { id: number; nomerazaosocial?: string | null } | Array<{ id: number; nomerazaosocial?: string | null }> | null;
  } | Array<any> | null;
};

export type SaidaOrigemItem = {
  /** `sourceItemId` do item no assistente: `saida:{saidaId}:{itemId}`. */
  sourceItemId: string;
  saidaId: number;
  saidaItemId: number;
  produtoId: number;
  titulo: string;
  quantidade: number;
  entradaItemOrigemId: number | null;
  numeroItemReferenciado: number | null;
  percentualDevolucao: number;
  valorIpiDevolvido: number;
  /** Aviso devolvido pelo espelho fiscal, quando o XML da origem não serviu. */
  aviso?: string | null;
};

export type SaidaOrigemDraft = {
  operacaoFiscalCodigo: string;
  naturezaOperacao: string;
  finalidade: string;
  documentoReferenciadoObrigatorio: boolean;
  chaveAcessoReferenciada: string;
  itens: SaidaOrigemItem[];
};

export function relacaoUnica<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

/** Regra única de "esta operação precisa citar um documento de origem?". */
export function exigeDocumentoDeOrigem(draft: SaidaOrigemDraft) {
  return draft.documentoReferenciadoObrigatorio || draft.finalidade === "DEVOLUCAO";
}

/** Pendências que impedem gerar o rascunho, na linguagem da tela. */
export function validarOrigemFiscalSaida(draft: SaidaOrigemDraft) {
  const erros: string[] = [];
  if (!draft.operacaoFiscalCodigo) {
    erros.push("Escolha a natureza fiscal da saída.");
  }
  if (!draft.naturezaOperacao.trim()) {
    erros.push("Informe a natureza da operação.");
  }
  if (!exigeDocumentoDeOrigem(draft)) return erros;

  if (!chaveAcessoValida(draft.chaveAcessoReferenciada)) {
    erros.push(
      onlyDigits(draft.chaveAcessoReferenciada).length === 44
        ? "A chave da NF-e de origem tem dígito verificador inválido."
        : "Informe a chave de acesso com 44 dígitos da NF-e de origem.",
    );
  }
  draft.itens.forEach((item, index) => {
    if (!item.entradaItemOrigemId) {
      erros.push(`Vincule a linha ${index + 1} à entrada fiscal que trouxe a mercadoria.`);
    }
    const numero = Number(item.numeroItemReferenciado ?? 0);
    if (!Number.isInteger(numero) || numero <= 0 || numero > 990) {
      erros.push(`Informe o nº do item na NF-e recebida para a linha ${index + 1}.`);
    }
    if (draft.finalidade === "DEVOLUCAO" && !(item.percentualDevolucao > 0 && item.percentualDevolucao <= 100)) {
      erros.push(`O percentual devolvido da linha ${index + 1} deve ficar entre 0,01 e 100.`);
    }
  });
  return erros;
}

export function NfeSaidaOrigemEditor({
  value,
  onChange,
  operacoes,
  entradasCandidatas,
  selectedSourceIds,
  espelhando = false,
  onEscolherEntrada,
}: {
  value: SaidaOrigemDraft;
  onChange: (next: SaidaOrigemDraft) => void;
  operacoes: OperacaoFiscalSaidaOption[];
  entradasCandidatas: EntradaCandidata[];
  /** Exibe a origem somente das linhas que realmente irão para a NF-e. */
  selectedSourceIds?: string[];
  /** Consulta da NF-e de origem em andamento. */
  espelhando?: boolean;
  /**
   * Avisa o diálogo que a origem de um item mudou, para ele buscar o espelho
   * fiscal e o preço da compra. Recebe o rascunho já atualizado.
   */
  onEscolherEntrada: (next: SaidaOrigemDraft, saidaItemId: number) => void;
}) {
  const exigeReferencia = exigeDocumentoDeOrigem(value);
  const isCustom = value.operacaoFiscalCodigo === "OUTRA";
  const chaveDigitos = onlyDigits(value.chaveAcessoReferenciada);
  const chaveInvalida = chaveDigitos.length > 0 && !chaveAcessoValida(chaveDigitos);
  const itensVisiveis = selectedSourceIds
    ? value.itens.filter((item) => selectedSourceIds.includes(item.sourceItemId))
    : value.itens;

  function atualizarItem(saidaItemId: number, patch: Partial<SaidaOrigemItem>) {
    return {
      ...value,
      itens: value.itens.map((item) =>
        item.saidaItemId === saidaItemId ? { ...item, ...patch } : item,
      ),
    };
  }

  function escolherOperacao(codigo: string) {
    const operacao = operacoes.find((item) => item.codigo === codigo);
    if (!operacao || codigo === "OUTRA") {
      onChange({ ...value, operacaoFiscalCodigo: codigo });
      return;
    }
    onChange({
      ...value,
      operacaoFiscalCodigo: codigo,
      naturezaOperacao: operacao.naturezaOperacao,
      finalidade: operacao.finalidade,
      documentoReferenciadoObrigatorio: operacao.exigeDocumentoReferenciado,
    });
  }

  function escolherEntrada(saidaItemId: number, candidatoId: string) {
    const entradaItemOrigemId = candidatoId === "NONE" ? null : Number(candidatoId);
    const candidato = entradasCandidatas.find((item) => Number(item.id) === entradaItemOrigemId);
    const entrada = relacaoUnica<any>(candidato?.entrada);
    const item = value.itens.find((linha) => linha.saidaItemId === saidaItemId);

    // Devolução parcial: a proporção sai da quantidade baixada contra a
    // comprada. Continua editável — é sugestão, não imposição.
    const percentualDevolucao = candidato && item && Number(candidato.quantidade) > 0
      ? Math.min(100, Number(((item.quantidade / Number(candidato.quantidade)) * 100).toFixed(4)))
      : 100;

    const chaveEntrada = onlyDigits(entrada?.notachave);
    const next: SaidaOrigemDraft = {
      ...atualizarItem(saidaItemId, {
        entradaItemOrigemId,
        percentualDevolucao,
        numeroItemReferenciado: candidato?.numero_item_fiscal
          ? Number(candidato.numero_item_fiscal)
          : item?.numeroItemReferenciado ?? null,
        aviso: null,
      }),
      // Todos os itens referenciam a mesma entrada nesta versão, então a chave
      // do cabeçalho acompanha a entrada escolhida.
      chaveAcessoReferenciada: chaveEntrada.length === 44
        ? chaveEntrada
        : value.chaveAcessoReferenciada,
    };
    onChange(next);
    onEscolherEntrada(next, saidaItemId);
  }

  return (
    <section className="min-w-0 space-y-4 border border-l-4 border-l-border bg-card p-3 sm:p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 font-medium">
          <FileSearch className="size-4" /> Origem fiscal da saída
        </p>
        <p className="text-xs text-muted-foreground">
          A natureza é escolhida aqui; o motivo do estoque não classifica a operação.
          Vincular a entrada faz os tributos do item virem da NF-e de compra.
        </p>
        {espelhando ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Lendo os tributos da NF-e de origem…
          </p>
        ) : null}
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5 sm:col-span-2">
          <Label>Natureza fiscal <span className="text-destructive">*</span></Label>
          <Select value={value.operacaoFiscalCodigo} onValueChange={escolherOperacao}>
            <SelectTrigger><SelectValue placeholder="Selecione a natureza" /></SelectTrigger>
            <SelectContent>
              {operacoes.map((operacao) => (
                <SelectItem key={operacao.codigo} value={operacao.codigo}>{operacao.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isCustom ? (
          <>
            <div className="min-w-0 space-y-1.5 sm:col-span-2">
              <Label>Natureza da operação <span className="text-destructive">*</span></Label>
              <Input
                value={value.naturezaOperacao}
                maxLength={60}
                onChange={(event) => onChange({ ...value, naturezaOperacao: event.target.value })}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label>Finalidade da NF-e <span className="text-destructive">*</span></Label>
              <Select
                value={value.finalidade}
                onValueChange={(finalidade) => onChange({ ...value, finalidade })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="COMPLEMENTAR">Complementar</SelectItem>
                  <SelectItem value="AJUSTE">Ajuste</SelectItem>
                  <SelectItem value="DEVOLUCAO">Devolução</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={value.documentoReferenciadoObrigatorio}
                onCheckedChange={(documentoReferenciadoObrigatorio) =>
                  onChange({ ...value, documentoReferenciadoObrigatorio })
                }
              />
              <Label>Exige documento fiscal de origem</Label>
            </div>
          </>
        ) : null}
      </div>

      {exigeReferencia ? (
        <div className="min-w-0 space-y-1.5">
          <Label>Chave de acesso da NF-e de origem <span className="text-destructive">*</span></Label>
          <Input
            inputMode="numeric"
            maxLength={44}
            placeholder="44 dígitos"
            value={value.chaveAcessoReferenciada}
            onChange={(event) =>
              onChange({
                ...value,
                chaveAcessoReferenciada: onlyDigits(event.target.value).slice(0, 44),
              })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Preenchida sozinha ao vincular a entrada. Sem ela a SEFAZ rejeita a
            devolução (rejeição 321).
          </p>
          {chaveInvalida ? (
            <p className="text-[11px] text-destructive">
              {chaveDigitos.length < 44
                ? `Faltam ${44 - chaveDigitos.length} dígito(s).`
                : "Dígito verificador não confere: revise a chave."}
            </p>
          ) : null}
        </div>
      ) : null}

      {exigeReferencia ? (
        <div className="space-y-3">
          {itensVisiveis.map((item) => {
            const candidatos = entradasCandidatas.filter(
              (candidato) => {
                if (Number(candidato.produto_id) !== Number(item.produtoId)) return false;
                const entrada = relacaoUnica<any>(candidato.entrada);
                const chaveCandidata = onlyDigits(entrada?.notachave);
                return !chaveDigitos || chaveCandidata === chaveDigitos;
              },
            );
            return (
              <div key={item.sourceItemId} className="min-w-0 space-y-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{item.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    Saída #{item.saidaId} · quantidade baixada: {item.quantidade}
                  </p>
                </div>

                {candidatos.length === 0 ? (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertDescription>
                      Nenhuma entrada fiscal confirmada com chave de acesso foi encontrada para
                      este produto. Sem ela não há como referenciar a nota de origem.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 space-y-1.5 sm:col-span-2">
                      <Label>Entrada fiscal de origem <span className="text-destructive">*</span></Label>
                      <Select
                        value={item.entradaItemOrigemId ? String(item.entradaItemOrigemId) : "NONE"}
                        onValueChange={(candidatoId) => escolherEntrada(item.saidaItemId, candidatoId)}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione a entrada" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NONE">Selecione...</SelectItem>
                          {candidatos.map((candidato) => {
                            const entrada = relacaoUnica<any>(candidato.entrada);
                            const fornecedor = relacaoUnica<any>(entrada?.fornecedor);
                            return (
                              <SelectItem key={candidato.id} value={String(candidato.id)}>
                                Entrada #{candidato.entrada_id} · {fornecedor?.nomerazaosocial || "Fornecedor"}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <Label>Nº do item na NF-e recebida <span className="text-destructive">*</span></Label>
                      <Input
                        type="number"
                        min={1}
                        max={990}
                        value={item.numeroItemReferenciado ?? ""}
                        onChange={(event) => {
                          const numeroItemReferenciado = event.target.value
                            ? Number(event.target.value)
                            : null;
                          const next = atualizarItem(item.saidaItemId, { numeroItemReferenciado });
                          onChange(next);
                          if (numeroItemReferenciado) onEscolherEntrada(next, item.saidaItemId);
                        }}
                      />
                    </div>

                    {value.finalidade === "DEVOLUCAO" ? (
                      <>
                        <div className="min-w-0 space-y-1.5">
                          <Label>Percentual devolvido</Label>
                          <Input
                            type="number"
                            min={0.01}
                            max={100}
                            step="0.01"
                            value={item.percentualDevolucao}
                            onChange={(event) =>
                              onChange(atualizarItem(item.saidaItemId, {
                                percentualDevolucao: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <Label>IPI devolvido (R$)</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.valorIpiDevolvido}
                            onChange={(event) =>
                              onChange(atualizarItem(item.saidaItemId, {
                                valorIpiDevolvido: Number(event.target.value),
                              }))
                            }
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {item.aviso ? (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <Link2 className="mt-px size-3 shrink-0" /> {item.aviso}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
