"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Loader2, MinusCircle, PlusCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import formatarEmReal from "@/utils/formatarEmReal";

import { Cartao, EstadoVazio, fmtDateTime } from "./shared";

/**
 * Acrescimos e descontos de um pagamento.
 *
 * A cadeia que a aba mostra e a mesma do banco:
 *
 *   base  ->  + acrescimos  ->  bruto  ->  - descontos  ->  liquido
 *
 * Nenhuma conta e refeita aqui: os totais vem da propria transacao, recalculada
 * pelo gatilho a cada linha inserida ou removida. A tela so exibe.
 *
 * A taxa de recebimento e um desconto como os outros — deixou de ser a diferenca
 * implicita entre bruto e liquido e passou a ter linha propria, com nome.
 */

type TipoAjuste = {
  id: number;
  codigo: string;
  nome: string;
  natureza: "ACRESCIMO" | "DESCONTO";
  codigo_sistema: string | null;
};

type LinhaAjuste = {
  id: number;
  natureza: "ACRESCIMO" | "DESCONTO";
  modo: "FIXO" | "PORCENTAGEM";
  valor_informado: number | string;
  valor_calculado: number | string;
  observacao: string | null;
  created_at: string;
  tipo: { id: number; codigo: string; nome: string; codigo_sistema: string | null } | null;
};

type Totais = {
  valor_base?: number | string | null;
  valor_acrescimos?: number | string | null;
  valor_descontos?: number | string | null;
  valor?: number | string | null;
  valorLiquido?: number | string | null;
};

const num = (valor: unknown) => {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
};

function LinhaTotal({
  rotulo,
  valor,
  sinal,
  destaque = false,
}: {
  rotulo: string;
  valor: number;
  sinal?: "mais" | "menos";
  destaque?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 text-sm ${
        destaque ? "font-semibold" : "text-muted-foreground"
      }`}
    >
      <span>{rotulo}</span>
      <span
        className={
          sinal === "mais"
            ? "text-emerald-600 dark:text-emerald-400"
            : sinal === "menos"
              ? "text-destructive"
              : undefined
        }
      >
        {sinal === "mais" ? "+ " : sinal === "menos" ? "− " : ""}
        {formatarEmReal(valor)}
      </span>
    </div>
  );
}

export function AjustesTab({
  transacaoId,
  totais,
  pendente,
  editavel,
  onAlterado,
}: {
  transacaoId: number;
  totais: Totais;
  /** Acrescimo mexe no bruto, e bruto de transacao baixada e imutavel. */
  pendente: boolean;
  editavel: boolean;
  /** Recebe a transação já recalculada, para o dialog atualizar sem refetch. */
  onAlterado?: (transacao?: Totais, quantidadeDeDescontos?: number) => void;
}) {
  const [tipos, setTipos] = useState<TipoAjuste[]>([]);
  const [linhas, setLinhas] = useState<LinhaAjuste[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [tipoId, setTipoId] = useState<string>("");
  const [modo, setModo] = useState<"FIXO" | "PORCENTAGEM">("FIXO");
  const [valor, setValor] = useState<string>("");

  /**
   * `mostrarSpinner` só na primeira carga. Depois de lançar ou remover uma
   * linha, a lista se atualiza por baixo: trocar o conteúdo por um spinner faria
   * a aba piscar e tiraria o usuário de onde ele estava olhando.
   */
  const carregarLinhas = async (mostrarSpinner: boolean) => {
    if (mostrarSpinner) setCarregando(true);
    try {
      const requisicoes: Promise<unknown>[] = [
        axios.get(`/api/transaction/${transacaoId}/ajustes`),
      ];
      // O catalogo nao muda enquanto o dialog esta aberto: busca uma vez so.
      if (mostrarSpinner) requisicoes.push(axios.get("/api/tipos/ajustes-transacao"));

      const [linhasRes, tiposRes] = (await Promise.all(requisicoes)) as Array<{
        data?: { data?: unknown };
      }>;

      const atuais = (linhasRes?.data?.data as LinhaAjuste[]) ?? [];
      setLinhas(atuais);
      if (tiposRes) setTipos((tiposRes.data?.data as TipoAjuste[]) ?? []);
      return atuais;
    } catch {
      toast.error("Não foi possível carregar os ajustes.");
      return null;
    } finally {
      if (mostrarSpinner) setCarregando(false);
    }
  };

  const quantosDescontos = (atuais: LinhaAjuste[] | null) =>
    atuais ? atuais.filter((linha) => linha.natureza === "DESCONTO").length : undefined;

  const carregar = () => carregarLinhas(true);

  useEffect(() => {
    if (transacaoId) void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transacaoId]);

  const base = num(totais.valor_base ?? totais.valor);
  const acrescimos = num(totais.valor_acrescimos);
  const descontos = num(totais.valor_descontos);
  const bruto = num(totais.valor);
  const liquido = num(totais.valorLiquido) || bruto;

  const tipoEscolhido = useMemo(
    () => tipos.find((t) => String(t.id) === tipoId) ?? null,
    [tipos, tipoId],
  );

  // Acrescimo altera o bruto; depois da baixa isso e recusado pelo banco. Tirar
  // da lista evita oferecer uma opcao que so daria erro ao salvar.
  const tiposDisponiveis = pendente
    ? tipos
    : tipos.filter((t) => t.natureza === "DESCONTO");

  const adicionar = async () => {
    const informado = Number(String(valor).replace(",", "."));
    if (!tipoEscolhido) {
      toast.error("Escolha o tipo do ajuste.");
      return;
    }
    if (!Number.isFinite(informado) || informado <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }

    setSalvando(true);
    try {
      const resposta = await axios.post(`/api/transaction/${transacaoId}/ajustes`, {
        tipoId: tipoEscolhido.id,
        modo,
        valorInformado: informado,
      });
      setValor("");
      const atuais = await carregarLinhas(false);
      // A resposta ja traz a transacao recalculada: o dialog costura os totais
      // em memoria em vez de recarregar a tela. A contagem vai junto porque e
      // ela que decide se o campo de liquido da aba Detalhes continua editavel.
      onAlterado?.(resposta.data?.data?.transacao, quantosDescontos(atuais));
      toast.success("Ajuste lançado.");
    } catch (error) {
      const mensagem =
        axios.isAxiosError(error) && error.response?.data?.error
          ? String(error.response.data.error)
          : "Não foi possível lançar o ajuste.";
      toast.error(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (ajusteId: number) => {
    setSalvando(true);
    try {
      const resposta = await axios.delete(
        `/api/transaction/${transacaoId}/ajustes?ajusteId=${ajusteId}`,
      );
      const atuais = await carregarLinhas(false);
      onAlterado?.(resposta.data?.data?.transacao, quantosDescontos(atuais));
      toast.success("Ajuste removido.");
    } catch (error) {
      const mensagem =
        axios.isAxiosError(error) && error.response?.data?.error
          ? String(error.response.data.error)
          : "Não foi possível remover o ajuste.";
      toast.error(mensagem);
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando ajustes
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Cartao titulo="Composição do valor">
        <LinhaTotal rotulo="Valor de face" valor={base} />
        {acrescimos > 0 ? (
          <LinhaTotal rotulo="Acréscimos" valor={acrescimos} sinal="mais" />
        ) : null}
        <LinhaTotal rotulo="Valor cobrado" valor={bruto} destaque />
        {descontos > 0 ? (
          <LinhaTotal rotulo="Descontos" valor={descontos} sinal="menos" />
        ) : null}
        <div className="mt-1 border-t pt-1">
          <LinhaTotal rotulo="Entra na conta" valor={liquido} destaque />
        </div>
      </Cartao>

      <Cartao titulo="Lançamentos">
        {linhas.length === 0 ? (
          <EstadoVazio>Nenhum acréscimo ou desconto lançado neste pagamento.</EstadoVazio>
        ) : (
          <ul className="divide-y">
            {linhas.map((linha) => {
              const ehAcrescimo = linha.natureza === "ACRESCIMO";
              const podeRemover = editavel && (pendente || !ehAcrescimo);
              return (
                <li key={linha.id} className="flex items-center gap-3 py-2">
                  {ehAcrescimo ? (
                    <PlusCircle
                      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden
                    />
                  ) : (
                    <MinusCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {linha.tipo?.nome ?? "Ajuste"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {linha.modo === "PORCENTAGEM"
                        ? `${num(linha.valor_informado)}% sobre o valor de face`
                        : "Valor fixo"}
                      {" · "}
                      {fmtDateTime(linha.created_at)}
                    </p>
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      ehAcrescimo
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {ehAcrescimo ? "+ " : "− "}
                    {formatarEmReal(num(linha.valor_calculado))}
                  </span>
                  {podeRemover ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={salvando}
                      onClick={() => remover(linha.id)}
                      aria-label={`Remover ${linha.tipo?.nome ?? "ajuste"}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      {editavel ? (
        <Cartao titulo="Lançar ajuste">
          {!pendente ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Esta transação já foi baixada. Só é possível lançar desconto, porque
              acréscimo alteraria o valor bruto, que vira histórico depois da baixa.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha" />
                </SelectTrigger>
                <SelectContent>
                  {tiposDisponiveis.map((tipo) => (
                    <SelectItem key={tipo.id} value={String(tipo.id)}>
                      {tipo.natureza === "ACRESCIMO" ? "+ " : "− "}
                      {tipo.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Modo</Label>
              <Select
                value={modo}
                onValueChange={(valor) => setModo(valor as "FIXO" | "PORCENTAGEM")}
              >
                <SelectTrigger className="w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXO">Em reais</SelectItem>
                  <SelectItem value="PORCENTAGEM">Percentual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                {modo === "PORCENTAGEM" ? "Percentual" : "Valor"}
              </Label>
              <Input
                inputMode="decimal"
                value={valor}
                onChange={(evento) => setValor(evento.target.value)}
                placeholder={modo === "PORCENTAGEM" ? "10" : "30,00"}
                className="w-full sm:w-28"
              />
            </div>

            <Button onClick={adicionar} disabled={salvando} className="sm:w-auto">
              {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Lançar"}
            </Button>
          </div>
          {modo === "PORCENTAGEM" ? (
            <p className="mt-2 text-xs text-muted-foreground">
              O percentual incide sobre o valor de face ({formatarEmReal(base)}), não
              sobre o acumulado — duas linhas de 10% somam 20%.
            </p>
          ) : null}
        </Cartao>
      ) : null}
    </div>
  );
}
