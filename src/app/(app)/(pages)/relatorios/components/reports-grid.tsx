"use client";

import type React from "react";

import { Card } from "@/components/ui/card";
import {
  BadgeDollarSign,
  ChartNoAxesCombined,
  ClipboardCheck,
  Package,
  Users,
  Wrench,
} from "lucide-react";
import DialogRelatorioDiario from "./dialogs/dialog-relatorio-diario";
import DialogFluxo from "./dialogs/dialog-fluxo";
import DialogContasMovimentacao from "./dialogs/dialog-contas-movimentacao";
import DialogMetodosMovimentacao from "./dialogs/dialog-metodos-movimentacao";
import DialogDespesaCategoria from "./dialogs/dialog-despesa-categoria";
import DialogReceitaCategoria from "./dialogs/dialog-receita-categoria";
import { ProdutosEstoqueBaixo } from "./produtosEstoqueBaixo";
import { ProdutosEstoqueCritico } from "./produtosEstoqueCrítico";
import { ProdutosSemEstoque } from "./produtosSemEstoque";
import DialogClienteCompras from "./dialogs/dialog-cliente-compras";
import DialogProdutoCompras from "./dialogs/dialog-produto-compras";
import DialogComissaoRealizador from "./dialogs/dialog-comissao-realizador";
import DialogVendasUsuario from "./dialogs/dialog-vendas-usuario";
import DialogComissaoSetor from "./dialogs/dialog-comissao-setor";
import DialogVendasSetor from "./dialogs/dialog-vendas-setor";
import { DialogRelatorioOrdens } from "./dialogs/dialog-relatorio-ordens";
import { DialogRelatorioVendas } from "./dialogs/dialog-relatorio-vendas";
import DialogMovimentacaoEstoque from "./dialogs/dialog-movimentacao-estoque";

export function ReportsGrid() {

 

  return (
    <div className="space-y-8">
      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ClipboardCheck />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">Gerenciais</h2>
            <p className="text-sm text-muted-foreground">
              Visões consolidadas que cruzam todas as áreas do sistema
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogRelatorioDiario/>
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BadgeDollarSign />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Financeiro
            </h2>
            <p className="text-sm text-muted-foreground">
              Movimentações, receitas, despesas e classificações
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          
          <DialogFluxo/>
          <DialogContasMovimentacao/>
          <DialogMetodosMovimentacao/>
          <DialogDespesaCategoria/>
          <DialogReceitaCategoria/>
          
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wrench />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">Ordens de serviço</h2>
            <p className="text-sm text-muted-foreground">
              Acompanhamento operacional e resultado econômico das ordens
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogRelatorioOrdens mode="simples" />
          {/* <DialogRelatorioOrdens mode="financeiro" /> */}
        </div>
      </Card>

      {/* Vendas */}

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChartNoAxesCombined />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Vendas
            </h2>
            <p className="text-sm text-muted-foreground">
              Análise de vendas e faturamento
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogRelatorioVendas/>
          <DialogProdutoCompras/>
        </div>
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Users />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Usuários
            </h2>
            <p className="text-sm text-muted-foreground">
              Relatórios de desempenho e comissão por usuário
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogVendasUsuario/>
          <DialogComissaoRealizador/>
          <DialogComissaoSetor/>
          <DialogVendasSetor/>
        </div>
      </Card>

      {/* Estoque */}

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Estoque
            </h2>
            <p className="text-sm text-muted-foreground">
              Controle e movimentação de estoque
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogMovimentacaoEstoque/>
          <ProdutosEstoqueBaixo/>
          <ProdutosEstoqueCritico/>
          <ProdutosSemEstoque/>
        </div>
      </Card>

      {/* Clientes */}

      <Card className="p-4 sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Users />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-card-foreground">
              Clientes
            </h2>
            <p className="text-sm text-muted-foreground">
              Informações sobre a base de clientes
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DialogClienteCompras/>
          
          {/* <Button
            variant="outline"
            className="h-auto hover:cursor-pointer flex-col items-start justify-start gap-2 p-4 text-left hover:bg-accent hover:text-accent-foreground bg-transparent"
          >
            <div className="flex w-full items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                <TrendingUp />
              </div>
              <span className="flex-1 font-medium">Top Clientes </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Maiores compradores
            </p>
          </Button> */}
        </div>
      </Card>
    </div>
  );
}
