// src/app/(app)/(pages)/ordens/components/orcamento/ganchos/use-carrinho-orcamento.ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { ItemProduto, ItemProdutoAvulso, ItemServico, ProdutoBusca, ServicoBusca, TipoDesconto } from "../tipos";
import { carregarItensDaOSAPI } from "../servicos/api-orcamento";
import { calcularDescontoAplicado, calcularTotalComDesconto } from "../util";

const toNum = (v: any) => (v === null || v === undefined || isNaN(+v) ? 0 : +v);

export function useCarrinhoOrcamento(
  osId: number | undefined,
  onTotaisChange?: (tot: {
    subtotal: number;
    totalProdutos: number;
    totalServicos: number;
    desconto: number;
    valorFrete: number;
    totalGeral: number;
  }) => void
) {
  const [itensProduto, setItensProduto] = useState<ItemProduto[]>([]);
  const [itensServico, setItensServico] = useState<ItemServico[]>([]);
  const [itensProdutoAvulso, setItensProdutoAvulso] = useState<ItemProdutoAvulso[]>([]);
  const [descontoTipo, setDescontoTipo] = useState<TipoDesconto | null>(null);
  const [desconto, setDesconto] = useState(0);
  const [valorFrete, setValorFrete] = useState(0);

  const totalProdutos = useMemo(
    () =>
      itensProduto.reduce((acc, it) => acc + toNum(it.subtotal), 0) +
      itensProdutoAvulso.reduce((acc, it) => acc + toNum(it.subtotal), 0),
    [itensProduto, itensProdutoAvulso],
  );
  const totalServicos = useMemo(() => itensServico.reduce((acc, it) => acc + toNum(it.subtotal), 0), [itensServico]);
  const subtotal = totalProdutos + totalServicos;
  const descontoAplicado = useMemo(
    () => calcularDescontoAplicado(subtotal, descontoTipo, desconto),
    [subtotal, descontoTipo, desconto],
  );
  const totalGeral = useMemo(
    () => calcularTotalComDesconto(subtotal, descontoTipo, desconto) + Math.max(0, toNum(valorFrete)),
    [subtotal, descontoTipo, desconto, valorFrete],
  );

  useEffect(() => {
    onTotaisChange?.({ subtotal, totalProdutos, totalServicos, desconto: descontoAplicado, valorFrete, totalGeral });
  }, [descontoAplicado, onTotaisChange, subtotal, totalGeral, totalProdutos, totalServicos, valorFrete]);

  const carregarItensDaOS = useCallback(async () => {
    if (!osId) return;
    const data = await carregarItensDaOSAPI(osId);
    const { produtos, produtosAvulsos, servicos } = data;
    setItensProduto(produtos);
    setItensProdutoAvulso(produtosAvulsos);
    setItensServico(servicos);
    setDescontoTipo(data.descontoTipo);
    setDesconto(data.desconto);
    setValorFrete(data.valorFrete);
  }, [osId]);

  const adicionarProduto = (p: ProdutoBusca) => {
    setItensProduto((prev) => {
      const idx = prev.findIndex((x) => x.produtoid === p.id);
      if (idx >= 0) {
        const novo = [...prev];
        const q = novo[idx].quantidade + 1;
        const pu = novo[idx].precounitario || p.precounitario || 0;
        const bruto = q * pu;
        novo[idx] = {
          ...novo[idx],
          quantidade: q,
          precounitario: pu,
          subtotal: calcularTotalComDesconto(bruto, novo[idx].descontoTipo, novo[idx].desconto),
        };
        return novo;
      }
      const pu = toNum(p.precounitario || 0);
      return [
        ...prev,
        {
          produtoid: p.id,
          descricao: p.descricao,
          referencia: p.referencia === undefined ? p.codigo || null : p.referencia,
          etiqueta: p.etiqueta ?? null,
          quantidade: 1,
          precounitario: pu,
          subtotal: pu,
          descontoTipo: null,
          desconto: 0,
        },
      ];
    });
  };

  const adicionarServico = (s: ServicoBusca) => {
    setItensServico((prev) => {
      const idx = prev.findIndex((x) => x.servicoid === s.id);
      if (idx >= 0) {
        const novo = [...prev];
        const q = novo[idx].quantidade + 1;
        const pu = novo[idx].precounitario || s.precohora || 0;
        const bruto = q * pu;
        novo[idx] = {
          ...novo[idx],
          quantidade: q,
          precounitario: pu,
          subtotal: calcularTotalComDesconto(bruto, novo[idx].descontoTipo, novo[idx].desconto),
        };
        return novo;
      }
      const pu = toNum(s.precohora || 0);
      return [
        ...prev,
        {
          servicoid: s.id,
          descricao: s.descricao,
          referencia: s.referencia === undefined ? s.codigo || null : s.referencia,
          descricaoServico: null,
          quantidade: 1,
          precounitario: pu,
          subtotal: pu,
          descontoTipo: null,
          desconto: 0,
        },
      ];
    });
  };

  const atualizarProduto = (i: number, patch: Partial<ItemProduto>) => {
    setItensProduto((prev) => {
      const novo = [...prev];
      const base = { ...novo[i], ...patch };
      const q = toNum(base.quantidade || 1);
      const pu = toNum(base.precounitario || 0);
      base.quantidade = q;
      base.precounitario = pu;
      base.desconto = toNum(base.desconto ?? 0);
      base.subtotal = calcularTotalComDesconto(q * pu, base.descontoTipo, base.desconto);
      novo[i] = base;
      return novo;
    });
  };

  const atualizarServico = (i: number, patch: Partial<ItemServico>) => {
    setItensServico((prev) => {
      const novo = [...prev];
      const base = { ...novo[i], ...patch };
      const q = toNum(base.quantidade || 1);
      const pu = toNum(base.precounitario || 0);
      base.quantidade = q;
      base.precounitario = pu;
      base.desconto = toNum(base.desconto ?? 0);
      base.subtotal = calcularTotalComDesconto(q * pu, base.descontoTipo, base.desconto);
      novo[i] = base;
      return novo;
    });
  };

  const removerProduto = (i: number) => setItensProduto((prev) => prev.filter((_, idx) => idx !== i));
  const adicionarProdutoAvulso = (item: ItemProdutoAvulso) =>
    setItensProdutoAvulso((prev) => [...prev, item]);
  const atualizarProdutoAvulso = (i: number, patch: Partial<ItemProdutoAvulso>) => {
    setItensProdutoAvulso((prev) => {
      const next = [...prev];
      const item = { ...next[i], ...patch };
      item.quantidade = Math.max(1, Math.trunc(toNum(item.quantidade) || 1));
      item.precounitario = Math.max(0, toNum(item.precounitario));
      item.desconto = toNum(item.desconto ?? 0);
      item.subtotal = calcularTotalComDesconto(
        item.quantidade * item.precounitario,
        item.descontoTipo,
        item.desconto,
      );
      next[i] = item;
      return next;
    });
  };
  const removerProdutoAvulso = (i: number) =>
    setItensProdutoAvulso((prev) => prev.filter((_, idx) => idx !== i));
  const removerServico = (i: number) => setItensServico((prev) => prev.filter((_, idx) => idx !== i));

  return {
    itensProduto,
    itensServico,
    itensProdutoAvulso,
    totalProdutos,
    totalServicos,
    subtotal,
    descontoAplicado,
    totalGeral,
    descontoTipo,
    desconto,
    valorFrete,
    setDescontoTipo,
    setDesconto,
    setValorFrete,
    carregarItensDaOS,
    adicionarProduto,
    adicionarServico,
    atualizarProduto,
    atualizarServico,
    removerProduto,
    adicionarProdutoAvulso,
    atualizarProdutoAvulso,
    removerProdutoAvulso,
    removerServico,
  };
}
