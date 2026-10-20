"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, PackageSearch, Pencil, Unlink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/lib/toast";

import { classifySpedProduct, type SpedProductUse } from "../api";
import type { SpedCompetenciaDetail, SpedDocumento } from "../types";
import { EmptyState } from "./empty-state";

type Item = SpedDocumento["itens"][number];

const USOS: Array<{ valor: SpedProductUse; rotulo: string; detalhe: string; tipo: string; industria?: boolean }> = [
  { valor: "REVENDA", rotulo: "Revenda ou peça aplicada em serviço", detalhe: "Vendido no balcão ou usado nas ordens de serviço", tipo: "00" },
  { valor: "USO_CONSUMO", rotulo: "Uso e consumo da empresa", detalhe: "Limpeza, escritório, ferramentas pequenas", tipo: "07" },
  { valor: "ATIVO", rotulo: "Bem da empresa", detalhe: "Máquina, equipamento, veículo, móvel", tipo: "08" },
  { valor: "MATERIA_PRIMA", rotulo: "Matéria-prima", detalhe: "Usada para fabricar outro produto", tipo: "01", industria: true },
  { valor: "PRODUTO_ACABADO", rotulo: "Produto fabricado pela empresa", detalhe: "Sai da produção própria", tipo: "04", industria: true },
];

const ROTULO_POR_TIPO = new Map(USOS.map((uso) => [uso.tipo, uso.rotulo]));

type Produto = {
  produtoId: number;
  descricao: string;
  tipoItem: string | null;
  classificado: boolean;
  notas: Set<string>;
};

type ItemSemProduto = { chave: string; documento: SpedDocumento; item: Item };

/**
 * Cada produto movimentado precisa dizer para que a empresa o usa. A resposta
 * vale para o produto (todas as notas, todos os meses seguintes); o código
 * fiscal e o crédito de ICMS o ERP decide sozinho a partir dela.
 */
export function ProductUsePanel({
  competencia,
  canManage,
  disabled,
  onSaved,
}: {
  competencia: SpedCompetenciaDetail;
  canManage: boolean;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [salvando, setSalvando] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [mostrarClassificados, setMostrarClassificados] = useState(false);
  const locked = !canManage || disabled || competencia.status === "FECHADA";
  const industria = competencia.configuracao.indicadorAtividade === "0";
  const usos = USOS.filter((uso) => industria || !uso.industria);

  const { produtos, semProduto } = useMemo(() => {
    const porProduto = new Map<number, Produto>();
    const soltos: ItemSemProduto[] = [];
    for (const documento of competencia.documentos) {
      if (documento.situacao === "02" || documento.situacao === "04") continue;
      const nota = `${documento.modelo} ${documento.serie}/${documento.numero}`;
      for (const item of documento.itens) {
        if (item.produtoId == null) {
          if (documento.direcao === "ENTRADA") soltos.push({ chave: `${documento.id}:${item.id}`, documento, item });
          continue;
        }
        const atual = porProduto.get(item.produtoId) ?? {
          produtoId: item.produtoId,
          descricao: item.descricao,
          tipoItem: item.tipoItem,
          classificado: item.itemConfigId != null,
          notas: new Set<string>(),
        };
        atual.notas.add(nota);
        if (item.itemConfigId != null) {
          atual.classificado = true;
          atual.tipoItem = item.tipoItem;
        }
        porProduto.set(item.produtoId, atual);
      }
    }
    return {
      produtos: Array.from(porProduto.values()).sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")),
      semProduto: soltos,
    };
  }, [competencia.documentos]);

  // Classificações salvas que a competência atualizada ainda não trouxe.
  const [salvos, setSalvos] = useState<Record<number, string>>({});
  useEffect(() => setSalvos({}), [competencia.documentos]);
  const comSalvos = produtos.map((produto) => salvos[produto.produtoId]
    ? { ...produto, classificado: true, tipoItem: salvos[produto.produtoId] }
    : produto);
  const pendentes = comSalvos.filter((produto) => !produto.classificado);
  const classificados = comSalvos.filter((produto) => produto.classificado);

  async function classificar(produtoId: number, uso: SpedProductUse) {
    setSalvando(produtoId);
    try {
      const resposta = await classifySpedProduct(competencia.id, produtoId, uso);
      setSalvos((atual) => ({ ...atual, [produtoId]: resposta.data.itemType }));
      toast.success("Uso do produto salvo.", { description: "Vale para todas as notas deste produto. Gere o SPED de novo para aplicar." });
      setEditando(null);
      onSaved();
    } catch (error: unknown) {
      toast.error("Não foi possível salvar o uso do produto", {
        description: error instanceof Error ? error.message : "Falha inesperada.",
      });
    } finally {
      setSalvando(null);
    }
  }

  if (!produtos.length && !semProduto.length) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="Nenhum produto nas notas desta competência"
        description="Gere o SPED da competência para o ERP ler as notas e listar os produtos."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageSearch className="size-4" aria-hidden="true" /> Para que a empresa usa estes produtos?
          </CardTitle>
          <CardDescription>
            A resposta vale para o produto em todas as notas e nos próximos meses. Com ela, o ERP define o código do item,
            o CFOP de entrada e se o ICMS da compra gera crédito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendentes.length ? pendentes.map((produto) => (
            <ProdutoLinha
              key={produto.produtoId}
              produto={produto}
              usos={usos}
              valorAtual={null}
              disabled={locked || salvando != null}
              salvando={salvando === produto.produtoId}
              onEscolher={(uso) => void classificar(produto.produtoId, uso)}
            />
          )) : (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
              <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
              Todos os produtos desta competência já têm uso definido.
            </p>
          )}
        </CardContent>
      </Card>

      {semProduto.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Unlink className="size-4" aria-hidden="true" /> Itens de compra sem produto do estoque
            </CardTitle>
            <CardDescription>
              Estes itens chegaram nas notas de compra e não foram ligados a um produto. Abra a entrada da nota e vincule cada item a um
              produto do estoque; depois diga aqui para que a empresa usa o produto.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border text-sm">
              {semProduto.map(({ chave, documento, item }) => (
                <li key={chave} className="flex flex-col gap-0.5 p-3">
                  <span className="font-medium">{item.descricao}</span>
                  <span className="text-xs text-muted-foreground">
                    Nota {documento.serie}/{documento.numero} de {documento.participante} · item {item.numero}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {classificados.length ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">Produtos com uso definido ({classificados.length})</CardTitle>
              <CardDescription>Altere se algum estiver errado.</CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => setMostrarClassificados((valor) => !valor)}>
              {mostrarClassificados ? "Esconder" : "Mostrar"}
            </Button>
          </CardHeader>
          {mostrarClassificados ? (
            <CardContent>
              <div className="divide-y rounded-lg border">
                {classificados.map((produto) => editando === produto.produtoId ? (
                  <div key={produto.produtoId} className="p-3">
                    <ProdutoLinha
                      produto={produto}
                      usos={usos}
                      valorAtual={produto.tipoItem}
                      disabled={locked || salvando != null}
                      salvando={salvando === produto.produtoId}
                      onEscolher={(uso) => void classificar(produto.produtoId, uso)}
                      onCancelar={() => setEditando(null)}
                    />
                  </div>
                ) : (
                  <div key={produto.produtoId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 text-sm">
                      <p className="font-medium">{produto.descricao}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROTULO_POR_TIPO.get(produto.tipoItem ?? "") ?? `Tipo ${produto.tipoItem ?? "não informado"} (definido pelo contador)`}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant="ghost" disabled={locked || salvando != null} onClick={() => setEditando(produto.produtoId)}>
                      <Pencil aria-hidden="true" /> Alterar
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function ProdutoLinha({
  produto,
  usos,
  valorAtual,
  disabled,
  salvando,
  onEscolher,
  onCancelar,
}: {
  produto: Produto;
  usos: typeof USOS;
  valorAtual: string | null;
  disabled: boolean;
  salvando: boolean;
  onEscolher: (uso: SpedProductUse) => void;
  onCancelar?: () => void;
}) {
  const notas = Array.from(produto.notas);
  return (
    <div className={valorAtual == null ? "space-y-2 rounded-lg border p-4" : "space-y-2"}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm font-medium">{produto.descricao}</p>
        <Badge variant="outline">Produto {produto.produtoId}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Em {notas.length === 1 ? "1 nota" : `${notas.length} notas`}: {notas.slice(0, 3).join(", ")}{notas.length > 3 ? "..." : ""}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        {usos.map((uso) => (
          <Button
            key={uso.valor}
            type="button"
            size="sm"
            variant={uso.tipo === valorAtual ? "default" : "outline"}
            disabled={disabled}
            title={uso.detalhe}
            onClick={() => onEscolher(uso.valor)}
          >
            {uso.rotulo}
          </Button>
        ))}
        {onCancelar ? <Button type="button" size="sm" variant="ghost" onClick={onCancelar}>Cancelar</Button> : null}
        {salvando ? <span className="self-center text-xs text-muted-foreground">Salvando...</span> : null}
      </div>
    </div>
  );
}
