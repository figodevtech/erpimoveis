"use client";

/**
 * Procurar no ERP a transação que corresponde a uma linha do extrato.
 *
 * A lista mora no seletor genérico de transações; aqui fica só o que é da
 * conciliação: onde procurar, o que já se sabe do movimento e a tradução da
 * transação escolhida para uma sugestão de correspondência.
 *
 * O que esta tela fazia antes — pedir 50 linhas quaisquer e filtrar por valor no
 * navegador — deixava a transação certa fora do alcance quando ela não caía
 * naquelas 50 linhas, e a mensagem "nenhuma transação compatível nesta página"
 * não dizia se ela existia. Agora o filtro de valor vai ao servidor junto com
 * todos os demais, e o que não serve aparece com o motivo em vez de sumir.
 */

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";
import formatarEmReal from "@/utils/formatarEmReal";
import TransactionSelect, {
  type TransactionFiltros,
} from "@/app/(app)/components/transactionSelect";
import {
  casarComFluxo,
  casarComTitulos,
  motivoDeIncompatibilidade,
  type CandidatoTransacao,
} from "@/lib/financeiro/ofx/matcher";

import type { Transaction } from "../../types";
import { formatarDia } from "./apresentacao";
import { reais, type MovimentoAnalisado, type SugestaoMatch } from "./types";

type Origem = "FLUXO" | "TITULO";

/**
 * A transação da lista, vista pelas regras de comparação.
 *
 * O matcher espera o fornecedor com um `nome`; a rota devolve `nomerazaosocial`.
 * A conversão vive aqui porque é do formato, não da regra.
 */
function paraCandidato(transacao: Transaction): CandidatoTransacao {
  return {
    ...transacao,
    data: String(transacao.data),
    fornecedor: transacao.fornecedor
      ? { nome: transacao.fornecedor.nomerazaosocial ?? transacao.fornecedor.nomefantasia ?? null }
      : null,
  } as CandidatoTransacao;
}

export function BuscaManual({
  movimento,
  bancoId,
  onSelecionar,
}: {
  movimento: MovimentoAnalisado;
  bancoId: number;
  onSelecionar: (sugestao: SugestaoMatch) => void;
}) {
  const [origem, setOrigem] = useState<Origem>("FLUXO");
  const [seletorAberto, setSeletorAberto] = useState(false);

  const entrada = movimento.valorCentavos > 0;
  const alvoEmCentavos = Math.abs(movimento.valorCentavos);
  const alvo = reais(alvoEmCentavos);
  const tipos = entrada ? "RECEITA,DEPOSITO" : "DESPESA,SAQUE";

  /*
   * O escopo que a barra de filtros não pode desfazer.
   *
   * São as condições que definem a pergunta: no Fluxo, dinheiro que já passou
   * por ESTA conta; nos títulos, obrigação ainda em aberto. Deixá-las editáveis
   * só ofereceria linhas que a conciliação vai recusar.
   *
   * `comBanco` no Fluxo não é redundante com `bancoId`: é ele que traz de volta
   * as baixas parciais, que a rota esconde por padrão.
   */
  const filtrosFixos: Partial<TransactionFiltros> = useMemo(
    () =>
      origem === "FLUXO"
        ? { tipos, pendente: false, bancoId: String(bancoId), comBanco: true }
        : { tipos, pendente: true },
    [origem, tipos, bancoId],
  );

  /*
   * O valor já vem preenchido: é o filtro que faz a transação certa aparecer na
   * primeira página em vez de ficar perdida na paginação.
   *
   * PISO, nunca teto — nos dois lados. O filtro do servidor é sobre o valor
   * BRUTO, e o que a conciliação compara é o líquido (no Fluxo) ou o saldo (no
   * título); os dois só descem em relação ao bruto. Um teto de R$ 970 cortaria
   * exatamente a venda de R$ 1.000 no cartão que entrou na conta como R$ 970 —
   * o caso que mais precisa ser encontrado.
   *
   * Ordenar pelo valor crescente resolve o resto: o valor exato vem primeiro, e
   * logo atrás os que têm taxa ou saldo parcial.
   */
  const filtrosIniciais: Partial<TransactionFiltros> = useMemo(
    () => ({ valorMin: alvo, ordenarPor: "valor" as const, ordem: "asc" as const }),
    [alvo],
  );

  const avaliarLinha = (transacao: Transaction) => {
    const candidato = paraCandidato(transacao);
    const motivo = motivoDeIncompatibilidade(movimento, candidato, bancoId, origem);
    if (motivo) return { compativel: false, motivo };

    // A nota avisa antes do clique o que a confirmação vai fazer: baixar em
    // parte não é o mesmo que quitar.
    const sugestao =
      origem === "FLUXO"
        ? casarComFluxo(movimento, [candidato], bancoId)[0]
        : casarComTitulos(movimento, [candidato])[0];

    return {
      compativel: true,
      nota: sugestao?.parcial
        ? `Baixa parcial: quita ${formatarEmReal(alvo)} de ${formatarEmReal(reais(sugestao.valorCentavos))}.`
        : null,
    };
  };

  /**
   * A sugestão sai da própria regra de negócio, nunca montada à mão.
   *
   * Rodar o matcher sobre a única linha escolhida faz score, diferença de dias e
   * `parcial` saírem certos sem duplicar aqui o que `casarComFluxo` e
   * `casarComTitulos` já sabem.
   */
  const escolher = (transacao: Transaction) => {
    const candidato = paraCandidato(transacao);
    const sugestao =
      origem === "FLUXO"
        ? casarComFluxo(movimento, [candidato], bancoId)[0]
        : casarComTitulos(movimento, [candidato])[0];

    if (!sugestao) {
      // Só chega aqui se a linha tiver mudado no servidor entre a busca e o
      // clique — a lista não deixa escolher incompatível.
      toast.error("Esta transação não corresponde mais ao movimento", {
        description: "Refaça a busca para ver a situação atual.",
      });
      return;
    }

    onSelecionar(sugestao);
  };

  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Procurar transação no ERP</h3>
        <span className="text-xs text-muted-foreground">
          {entrada ? "Entrada" : "Saída"} de {formatarEmReal(alvo)}
        </span>
      </div>

      <Select value={origem} onValueChange={(valor) => setOrigem(valor as Origem)}>
        <SelectTrigger className="w-full" aria-label="Onde procurar">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="FLUXO">Fluxo de Caixa · mesma conta</SelectItem>
          <SelectItem value="TITULO">Contas a pagar / receber em aberto</SelectItem>
        </SelectContent>
      </Select>

      <p className="text-xs text-muted-foreground">
        {origem === "FLUXO"
          ? "Mesma conta, valor e direção, sem limite de diferença entre as datas."
          : "Mesma direção e saldo suficiente, sem limite de dias entre o vencimento e o pagamento ou recebimento. Antecipações e pagamentos múltiplos são resolvidos nos fluxos próprios."}{" "}
        A confirmação revalida a disponibilidade da transação.
      </p>

      <Button
        type="button"
        variant="outline"
        className="w-full justify-start hover:cursor-pointer"
        onClick={() => setSeletorAberto(true)}
      >
        <Search className="size-4" />
        Procurar transação
      </Button>

      <TransactionSelect
        open={seletorAberto}
        setOpen={setSeletorAberto}
        onSelect={escolher}
        title={
          origem === "FLUXO"
            ? "Procurar no Fluxo de Caixa desta conta"
            : "Procurar título em aberto"
        }
        description={`Movimento do extrato: ${entrada ? "entrada" : "saída"} de ${formatarEmReal(alvo)} em ${formatarDia(movimento.dataPostagem)}. O que não puder ser conciliado aparece na lista com o motivo.`}
        filtrosFixos={filtrosFixos}
        filtrosIniciais={filtrosIniciais}
        avaliarLinha={avaliarLinha}
        emptyHint="Use “Ampliar busca” para procurar sem a faixa de valor — a transação pode estar com valor diferente do extrato."
      />
    </section>
  );
}
