"use client";

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ValueInput } from "@/components/ui/value-input";
import { Plus, User2, Wrench, X } from "lucide-react";
import { toast } from "@/lib/toast";

import ProductSelect from "@/app/(app)/components/productSelect";
import ServiceSelect from "@/app/(app)/components/serviceSelect";
import CustomerSelect from "@/app/(app)/components/customerSelect";

import { useCarrinhoOrcamento } from "../../ordens/components/orcamento/ganchos/use-carrinho-orcamento";
import { TabelaItensProduto } from "../../ordens/components/orcamento/components/tabela-itens-produto";
import { TabelaItensServico } from "../../ordens/components/orcamento/components/tabela-tens-servico";
import { ProdutosAvulsos } from "../../ordens/components/orcamento/components/produtos-avulsos";
import { CampoDesconto } from "../../ordens/components/orcamento/components/campo-desconto";
import { dinheiro } from "../../ordens/components/orcamento/util";
import type { ProdutoBusca, ServicoBusca } from "../../ordens/components/orcamento/tipos";

import { carregarOrcamento, criarOrcamento, salvarOrcamento } from "../lib/api";
import type { ClienteResumo, PayloadOrcamento } from "../types";

export type OrcamentoAvulsoFormHandle = {
  salvar: () => Promise<number>;
};

export type OrcamentoAvulsoFormProps = {
  /** Ausente = orçamento novo: o carrinho começa vazio e só existe ao salvar. */
  orcamentoId?: number;
  onTotaisChange?: (totais: { totalProdutos: number; totalServicos: number; totalGeral: number }) => void;
  onLoadingChange?: (carregando: boolean) => void;
  onSalvo?: (id: number) => void;
};

export const OrcamentoAvulsoForm = forwardRef<OrcamentoAvulsoFormHandle, OrcamentoAvulsoFormProps>(
  function OrcamentoAvulsoForm({ orcamentoId, onTotaisChange, onLoadingChange, onSalvo }, ref) {
    const [cliente, setCliente] = useState<ClienteResumo | null>(null);
    const [descricao, setDescricao] = useState("");
    const [observacoes, setObservacoes] = useState("");
    const [clienteAberto, setClienteAberto] = useState(false);
    const [produtoAberto, setProdutoAberto] = useState(false);
    const [servicoAberto, setServicoAberto] = useState(false);
    const [pronto, setPronto] = useState(false);

    // Uma unica leitura preenche cabecalho e carrinho: o GET devolve os dois, e
    // buscar duas vezes deixaria a tela abrir com metade do estado defasada.
    const carregar = useCallback(async () => {
      const detalhe = await carregarOrcamento(orcamentoId as number);
      setCliente(detalhe.cliente ?? null);
      setDescricao(detalhe.descricao ?? "");
      setObservacoes(detalhe.observacoes ?? "");
      return {
        produtos: detalhe.produtos ?? [],
        produtosAvulsos: detalhe.produtosAvulsos ?? [],
        servicos: detalhe.servicos ?? [],
        descontoTipo: detalhe.descontoTipo ?? null,
        desconto: Number(detalhe.desconto) || 0,
        valorFrete: Number(detalhe.valorFrete) || 0,
      };
    }, [orcamentoId]);

    const {
      itensProduto,
      itensServico,
      itensProdutoAvulso,
      carregarItens,
      adicionarProduto,
      adicionarServico,
      atualizarProduto,
      atualizarServico,
      removerProduto,
      removerServico,
      adicionarProdutoAvulso,
      atualizarProdutoAvulso,
      removerProdutoAvulso,
      descontoTipo,
      desconto,
      valorFrete,
      setDescontoTipo,
      setDesconto,
      setValorFrete,
      subtotal,
      descontoAplicado,
      totalGeral,
      totalProdutos,
      totalServicos,
    } = useCarrinhoOrcamento(orcamentoId ? carregar : null);

    useEffect(() => {
      onTotaisChange?.({ totalProdutos, totalServicos, totalGeral });
    }, [onTotaisChange, totalProdutos, totalServicos, totalGeral]);

    // Orçamento novo não tem nada a buscar: entra pronto, com o carrinho vazio.
    useEffect(() => {
      let vivo = true;

      if (!orcamentoId) {
        setPronto(true);
        return;
      }

      (async () => {
        onLoadingChange?.(true);
        setPronto(false);
        try {
          await carregarItens();
          if (!vivo) return;
          setPronto(true);
        } catch (erro: any) {
          if (!vivo) return;
          toast.error(erro?.message ?? "Falha ao carregar orçamento");
        } finally {
          if (vivo) onLoadingChange?.(false);
        }
      })();

      return () => {
        vivo = false;
      };
    }, [orcamentoId, carregarItens, onLoadingChange]);

    const montarPayload = useCallback((): PayloadOrcamento => {
      return {
        clienteid: cliente?.id ?? null,
        veiculoid: null,
        descricao: descricao.trim() || null,
        observacoes: observacoes.trim() || null,
        produtos: itensProduto.map((item) => ({
          produtoid: item.produtoid,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        servicos: itensServico.map((item) => ({
          servicoid: item.servicoid,
          descricao: item.descricaoServico ?? null,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        produtosAvulsos: itensProdutoAvulso.map((item) => ({
          titulo: item.titulo,
          quantidade: item.quantidade,
          precounitario: item.precounitario,
          descontoTipo: item.descontoTipo ?? null,
          desconto: item.desconto ?? 0,
        })),
        descontoTipo: descontoTipo ?? null,
        desconto: desconto ?? 0,
        valorFrete: valorFrete ?? 0,
      };
    }, [
      cliente,
      descricao,
      observacoes,
      itensProduto,
      itensServico,
      itensProdutoAvulso,
      descontoTipo,
      desconto,
      valorFrete,
    ]);

    const salvar = useCallback(async () => {
      const vazio =
        itensProduto.length === 0 && itensServico.length === 0 && itensProdutoAvulso.length === 0;
      if (vazio) {
        const erro = new Error("Adicione ao menos um produto ou serviço ao orçamento.");
        toast.error(erro.message);
        throw erro;
      }

      const payload = montarPayload();

      try {
        if (orcamentoId) {
          await salvarOrcamento(orcamentoId, payload);
          toast.success("Orçamento salvo.");
          onSalvo?.(orcamentoId);
          return orcamentoId;
        }

        const { id } = await criarOrcamento(payload);
        toast.success("Orçamento criado.");
        onSalvo?.(id);
        return id;
      } catch (erro: any) {
        toast.error(erro?.message ?? "Falha ao salvar orçamento");
        // Propaga para o dialog não fechar em cima do erro.
        throw erro;
      }
    }, [itensProduto, itensServico, itensProdutoAvulso, montarPayload, orcamentoId, onSalvo]);

    useImperativeHandle(ref, () => ({ salvar }), [salvar]);

    const nomeCliente = useMemo(
      () => cliente?.nomerazaosocial?.trim() || (cliente ? `Cliente #${cliente.id}` : ""),
      [cliente],
    );

    const selecionarProduto = (produto: any) => {
      const adaptado: ProdutoBusca = {
        id: produto.id,
        codigo: String(produto.codigo ?? produto.referencia ?? produto.codigobarras ?? produto.id),
        referencia: String(produto.referencia ?? produto.codigo ?? "").trim() || null,
        etiqueta: String(produto.etiqueta ?? "").trim() || null,
        descricao: produto.titulo ?? produto.descricao ?? String(produto.id),
        precounitario: Number(produto.precovenda ?? produto.precounitario ?? 0),
        estoque: Number(produto.estoque ?? produto.estoque_atual) || 0,
      };
      adicionarProduto(adaptado);
      toast.success(`Produto "${adaptado.descricao}" adicionado.`);
    };

    const selecionarServico = (servico: any) => {
      const adaptado: ServicoBusca = {
        id: servico.id,
        codigo: String(servico.codigo ?? servico.id),
        referencia: String(servico.codigo ?? "").trim() || null,
        descricao: servico.descricao ?? String(servico.id),
        precohora: Number(servico.precohora ?? servico.valor ?? servico.preco ?? 0),
      };
      adicionarServico(adaptado);
      toast.success(`Serviço "${adaptado.descricao}" adicionado.`);
    };

    if (!pronto) return null;

    return (
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <User2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">Cliente e identificação</CardTitle>
            </div>
            <CardDescription>
              O cliente é opcional — um orçamento de balcão pode ser feito para quem ainda não tem
              cadastro.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Cliente</Label>
              <div className="flex flex-wrap items-center gap-2">
                <CustomerSelect
                  open={clienteAberto}
                  setOpen={setClienteAberto}
                  OnSelect={(selecionado: any) =>
                    setCliente({
                      id: Number(selecionado.id),
                      nomerazaosocial: selecionado.nomerazaosocial ?? selecionado.nome ?? null,
                      cpfcnpj: selecionado.cpfcnpj ?? null,
                      telefone: selecionado.telefone ?? null,
                      email: selecionado.email ?? null,
                    })
                  }
                >
                  <Button type="button" variant="outline">
                    <User2 className="mr-2 h-4 w-4" />
                    {cliente ? "Trocar cliente" : "Selecionar cliente"}
                  </Button>
                </CustomerSelect>

                {cliente ? (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                    <span className="font-medium">{nomeCliente}</span>
                    {cliente.telefone ? (
                      <span className="text-muted-foreground">{cliente.telefone}</span>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setCliente(null)}
                      aria-label="Remover cliente"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Sem cliente vinculado</span>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Input
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: revisão de freios"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Observações</Label>
                <Textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                  rows={2}
                  placeholder="Condições, prazo de validade combinado, etc."
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              <CardTitle className="text-base sm:text-lg">Itens do orçamento</CardTitle>
            </div>

            <CardDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm">
                Orçamento não reserva estoque: o saldo só é movimentado quando ele virar uma OS.
              </span>

              <div className="flex flex-row items-center gap-3">
                <ServiceSelect open={servicoAberto} setOpen={setServicoAberto} OnSelect={selecionarServico}>
                  <Button className="hover:cursor-pointer" type="button">
                    <Plus className="h-4 w-4" />
                    Serviço
                  </Button>
                </ServiceSelect>

                <ProductSelect open={produtoAberto} setOpen={setProdutoAberto} OnSelect={selecionarProduto}>
                  <Button className="hover:cursor-pointer" type="button">
                    <Plus className="h-4 w-4" />
                    Produto
                  </Button>
                </ProductSelect>
              </div>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6">
            <TabelaItensProduto
              itens={itensProduto}
              errosEstoque={{}}
              onAtualizar={atualizarProduto}
              onRemover={(indice) => {
                removerProduto(indice);
                toast.success("Produto removido");
              }}
            />

            <Separator />

            {/* Sempre disponível aqui: cotar peça que a oficina não tem cadastrada
                é justamente o que se faz num orçamento. O flag
                permitir_produto_avulso_os continua valendo só dentro da OS. */}
            <ProdutosAvulsos
              itens={itensProdutoAvulso}
              onAdicionar={adicionarProdutoAvulso}
              onAtualizar={atualizarProdutoAvulso}
              onRemover={removerProdutoAvulso}
            />

            <Separator />

            <TabelaItensServico
              itens={itensServico}
              onAtualizar={atualizarServico}
              onRemover={(indice) => {
                removerServico(indice);
                toast.success("Serviço removido");
              }}
            />

            <Separator />

            <div className="grid gap-5 rounded-md border bg-muted/20 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Desconto total</h3>
                  <p className="text-xs text-muted-foreground">
                    Aplicado depois dos descontos individuais dos itens.
                  </p>
                </div>

                <div className="max-w-xl space-y-1.5">
                  <Label className="text-xs">Tipo e valor do desconto</Label>
                  <CampoDesconto
                    tipo={descontoTipo}
                    valor={desconto}
                    onTipoChange={setDescontoTipo}
                    onValorChange={setDesconto}
                    className="grid gap-2 sm:grid-cols-[180px_160px]"
                    selectClassName="h-9"
                    inputClassName="h-9"
                  />
                </div>

                <div className="max-w-xs space-y-1.5">
                  <Label className="text-xs">Frete</Label>
                  <ValueInput value={valorFrete} onValueChange={setValorFrete} className="h-9" />
                </div>
              </div>

              <div className="space-y-2 rounded-md border bg-background/70 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    {dinheiro(subtotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Desconto</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    - {dinheiro(descontoAplicado)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Frete</span>
                  <span className="min-w-[130px] text-right font-medium tabular-nums">
                    + {dinheiro(valorFrete)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-3 text-base">
                  <span className="font-medium">Total</span>
                  <span className="min-w-[130px] text-right font-bold tabular-nums">
                    {dinheiro(totalGeral)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  },
);

export default OrcamentoAvulsoForm;
