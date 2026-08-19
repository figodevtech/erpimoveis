// src/app/(app)/(pages)/configuracoes/tipos/components/bandeiras-section.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { Loader2, Minus, MoreHorizontal, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBancos } from "@/app/(app)/(pages)/(financeiro)/fluxodecaixa/hooks/use-bancos";
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options";
import { faixasOrdenadas, maximoDeParcelas } from "@/lib/financeiro/bandeira";

type Faixa = { parcelas: number; taxaPercentual: number };

type BandeiraItem = {
  id: number;
  nome: string;
  descricao: string | null;
  bancoId: number | null;
  metodoPagamento: string;
  ativo: boolean;
  parcelas: Faixa[];
};

/**
 * A faixa enquanto o usuário digita.
 *
 * Texto, e não número: um campo de taxa em estado numérico não deixa apagar o
 * último dígito sem virar 0, e "0%" é uma taxa legítima — o operador não teria
 * como distinguir "ainda estou digitando" de "esta faixa é isenta".
 */
type FaixaEmEdicao = { id: number; parcelas: string; taxa: string };

type Formulario = {
  nome: string;
  descricao: string;
  bancoId: string;
  metodoPagamento: string;
  ativo: boolean;
  faixas: FaixaEmEdicao[];
};

const FORM_VAZIO: Formulario = {
  nome: "",
  descricao: "",
  bancoId: "",
  metodoPagamento: "",
  ativo: true,
  faixas: [{ id: 1, parcelas: "1", taxa: "" }],
};

const ENDPOINT = "/api/tipos/bandeiras";

function porcentagem(valor: number) {
  return `${valor.toFixed(2).replace(".", ",")}%`;
}

/**
 * Bandeiras de cartão e a taxa que cada uma cobra por faixa de parcelamento.
 *
 * Não reusa `CategoriasTransacaoSection` como os centros de custo fazem: aquele
 * componente genérico é nome + descrição + ativo, e aqui existe uma tabela filha
 * de faixas que é o coração do cadastro.
 */
export default function BandeirasSection() {
  const [bandeiras, setBandeiras] = useState<BandeiraItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editando, setEditando] = useState<BandeiraItem | null>(null);
  const [form, setForm] = useState<Formulario>(FORM_VAZIO);

  const { bancos, loadingBancos } = useBancos();
  const { options: metodos } = usePaymentMethodOptions();

  const nomeDoBanco = useMemo(() => {
    const porId = new Map(bancos.map((banco) => [Number(banco.id), banco.titulo]));
    return (id: number | null) => (id == null ? "—" : (porId.get(id) ?? `Conta #${id}`));
  }, [bancos]);

  async function carregar() {
    try {
      setIsLoading(true);
      setErro(null);
      const resposta = await fetch(ENDPOINT, { cache: "no-store" });
      const corpo = await resposta.json();
      if (!resposta.ok) throw new Error(corpo?.error || "Erro ao carregar as bandeiras");
      setBandeiras(corpo.items ?? []);
    } catch (causa: any) {
      const mensagem = causa?.message || "Erro ao carregar as bandeiras";
      setErro(mensagem);
      toast.error(mensagem);
      setBandeiras([]);
    } finally {
      setIsLoading(false);
    }
  }

  // Carga única na montagem: o endpoint não muda durante a vida da seção.
  useEffect(() => {
    carregar();
  }, []);

  function abrirNova() {
    setEditando(null);
    setForm(FORM_VAZIO);
    setDialogOpen(true);
  }

  function abrirEdicao(bandeira: BandeiraItem) {
    setEditando(bandeira);
    setForm({
      nome: bandeira.nome,
      descricao: bandeira.descricao ?? "",
      bancoId: bandeira.bancoId == null ? "" : String(bandeira.bancoId),
      metodoPagamento: bandeira.metodoPagamento,
      ativo: bandeira.ativo,
      faixas: (bandeira.parcelas.length > 0
        ? bandeira.parcelas
        : [{ parcelas: 1, taxaPercentual: 0 }]
      ).map((faixa, indice) => ({
        id: indice + 1,
        parcelas: String(faixa.parcelas),
        taxa: String(faixa.taxaPercentual).replace(".", ","),
      })),
    });
    setDialogOpen(true);
  }

  function alterarFaixa(id: number, campo: "parcelas" | "taxa", valor: string) {
    setForm((atual) => ({
      ...atual,
      faixas: atual.faixas.map((faixa) =>
        faixa.id === id ? { ...faixa, [campo]: valor } : faixa,
      ),
    }));
  }

  /** A próxima faixa começa uma parcela acima da última — quase sempre o certo. */
  function adicionarFaixa() {
    setForm((atual) => {
      const ultima = atual.faixas[atual.faixas.length - 1];
      const proxima = Number(ultima?.parcelas ?? 0) + 1;
      return {
        ...atual,
        faixas: [
          ...atual.faixas,
          {
            id: Date.now(),
            parcelas: String(Number.isFinite(proxima) && proxima > 1 ? proxima : atual.faixas.length + 1),
            taxa: "",
          },
        ],
      };
    });
  }

  function removerFaixa(id: number) {
    setForm((atual) => {
      if (atual.faixas.length === 1) {
        toast.error("A bandeira precisa de ao menos uma faixa.");
        return atual;
      }
      return { ...atual, faixas: atual.faixas.filter((faixa) => faixa.id !== id) };
    });
  }

  async function salvar() {
    if (!form.nome.trim()) {
      toast.error("Nome é obrigatório.");
      return;
    }
    if (!form.bancoId) {
      toast.error("Selecione a conta bancária.");
      return;
    }
    if (!form.metodoPagamento) {
      toast.error("Selecione a forma de pagamento.");
      return;
    }

    // Vírgula decimal é como se digita taxa em português; `faixasOrdenadas` já
    // aceita as duas formas e devolve a lista limpa.
    const informadas = form.faixas.map((faixa) => ({
      parcelas: faixa.parcelas,
      taxaPercentual: faixa.taxa.trim() === "" ? NaN : faixa.taxa,
    }));
    const faixas = faixasOrdenadas(informadas as unknown as Faixa[]);

    if (faixas.length !== form.faixas.length) {
      toast.error(
        "Confira as faixas: use de 1 a 36 parcelas, taxa entre 0% e 100%, sem repetir a mesma quantidade.",
      );
      return;
    }

    const corpo = {
      nome: form.nome.trim(),
      descricao: form.descricao.trim() || null,
      bancoId: Number(form.bancoId),
      metodoPagamento: form.metodoPagamento,
      ativo: form.ativo,
      parcelas: faixas,
    };

    try {
      setIsSaving(true);
      const resposta = await fetch(
        editando ? `${ENDPOINT}/${editando.id}` : ENDPOINT,
        {
          method: editando ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        },
      );
      const retorno = await resposta.json();
      if (!resposta.ok) {
        throw new Error(retorno?.error || "Falha ao salvar a bandeira");
      }

      toast.success(editando ? "Bandeira atualizada." : "Bandeira cadastrada.");
      setDialogOpen(false);
      setEditando(null);
      setForm(FORM_VAZIO);
      await carregar();
    } catch (causa: any) {
      toast.error(causa?.message || "Erro ao salvar a bandeira");
    } finally {
      setIsSaving(false);
    }
  }

  async function excluir(bandeira: BandeiraItem) {
    try {
      const resposta = await fetch(`${ENDPOINT}/${bandeira.id}`, { method: "DELETE" });
      const retorno = await resposta.json();
      if (!resposta.ok) throw new Error(retorno?.error || "Falha ao excluir a bandeira");
      toast.success("Bandeira excluída.");
      await carregar();
    } catch (causa: any) {
      toast.error(causa?.message || "Erro ao excluir a bandeira");
    }
  }

  return (
    <Card className="min-h-[460px]">
      <CardHeader className="border-b pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Bandeiras de cartão</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <button
                onClick={carregar}
                className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 text-xs"
              >
                <span>Recarregar</span>
                <Loader2 width={12} className={isLoading ? "animate-spin" : ""} />
              </button>
              <span className="text-foreground/60">
                {bandeiras.length} {bandeiras.length === 1 ? "bandeira" : "bandeiras"}
              </span>
              {erro && (
                <Badge variant="destructive" className="ml-1">
                  {erro}
                </Badge>
              )}
            </CardDescription>
          </div>

          <Dialog
            open={dialogOpen}
            onOpenChange={(aberto) => {
              setDialogOpen(aberto);
              if (!aberto) {
                setEditando(null);
                setForm(FORM_VAZIO);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="hover:cursor-pointer" onClick={abrirNova}>
                <Plus className="mr-1 h-4 w-4" />
                Bandeira
              </Button>
            </DialogTrigger>

            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editando ? "Editar bandeira" : "Nova bandeira"}
                </DialogTitle>
              </DialogHeader>

              <ScrollArea className="max-h-[65vh]">
                <div className="mt-2 space-y-4 rounded-2xl bg-card p-4 pr-5">
                  <div className="space-y-1.5">
                    <Label>Nome</Label>
                    <Input
                      value={form.nome}
                      onChange={(evento) =>
                        setForm((atual) => ({ ...atual, nome: evento.target.value }))
                      }
                      placeholder="Ex.: Visa, Mastercard, Elo"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Conta bancária</Label>
                      <Select
                        value={form.bancoId}
                        onValueChange={(valor) =>
                          setForm((atual) => ({ ...atual, bancoId: valor }))
                        }
                        disabled={loadingBancos}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={loadingBancos ? "Carregando..." : "Selecione"} />
                        </SelectTrigger>
                        <SelectContent>
                          {bancos.map((banco) => (
                            <SelectItem key={banco.id} value={String(banco.id)}>
                              {banco.titulo}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Forma de pagamento</Label>
                      <Select
                        value={form.metodoPagamento}
                        onValueChange={(valor) =>
                          setForm((atual) => ({ ...atual, metodoPagamento: valor }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {metodos.map((metodo) => (
                            <SelectItem key={metodo.value} value={metodo.value}>
                              {metodo.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Descrição</Label>
                    <Input
                      value={form.descricao}
                      onChange={(evento) =>
                        setForm((atual) => ({ ...atual, descricao: evento.target.value }))
                      }
                      placeholder="Opcional"
                    />
                  </div>

                  <div className="space-y-2 border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Taxa por parcelamento</p>
                      <p className="text-xs text-muted-foreground">
                        As faixas cadastradas são as únicas que o lançamento vai
                        oferecer. Uma bandeira sem a linha de 6x simplesmente não
                        parcela em 6x.
                      </p>
                    </div>

                    <div className="flex flex-col gap-2">
                      {form.faixas.map((faixa) => (
                        <div key={faixa.id} className="flex items-end gap-2">
                          <div className="w-24 space-y-1">
                            <Label className="text-[11px]">Parcelas</Label>
                            <Input
                              inputMode="numeric"
                              value={faixa.parcelas}
                              onChange={(evento) =>
                                alterarFaixa(faixa.id, "parcelas", evento.target.value)
                              }
                            />
                          </div>
                          <div className="flex-1 space-y-1">
                            <Label className="text-[11px]">Taxa (%)</Label>
                            <Input
                              inputMode="decimal"
                              value={faixa.taxa}
                              onChange={(evento) =>
                                alterarFaixa(faixa.id, "taxa", evento.target.value)
                              }
                              placeholder="Ex.: 5,20"
                            />
                          </div>
                          <button
                            type="button"
                            aria-label={`Remover a faixa de ${faixa.parcelas}x`}
                            className="flex size-10 shrink-0 items-center justify-center border border-destructive bg-destructive text-destructive-foreground hover:cursor-pointer"
                            onClick={() => removerFaixa(faixa.id)}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="flex h-9 w-max items-center gap-2 border border-border bg-background px-3 text-xs font-semibold hover:cursor-pointer hover:bg-muted/50"
                      onClick={adicionarFaixa}
                    >
                      <Plus className="h-4 w-4 text-primary" />
                      <span>Adicionar faixa</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium">Status da bandeira</span>
                      <p className="text-xs text-muted-foreground">
                        Inativa some do lançamento, mas o histórico continua
                        identificado.
                      </p>
                    </div>
                    <Switch
                      checked={form.ativo}
                      onCheckedChange={(valor) =>
                        setForm((atual) => ({ ...atual, ativo: valor }))
                      }
                    />
                  </div>
                </div>
              </ScrollArea>

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="button" onClick={salvar} disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent className="relative min-h-[190px] -mt-[24px] px-4 pb-4 pt-0 sm:px-6">
        <Table className="mt-6">
          <TableHeader>
            <TableRow>
              <TableHead>Bandeira</TableHead>
              <TableHead>Conta</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead>Parcelamento</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : bandeiras.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhuma bandeira cadastrada. Clique em <b>+ Bandeira</b> para
                  cadastrar a taxa da sua maquineta.
                </TableCell>
              </TableRow>
            ) : (
              bandeiras.map((bandeira) => (
                <TableRow key={bandeira.id} className="hover:cursor-default">
                  <TableCell className="font-medium">{bandeira.nome}</TableCell>
                  <TableCell>{nomeDoBanco(bandeira.bancoId)}</TableCell>
                  <TableCell>{bandeira.metodoPagamento}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {bandeira.parcelas.length === 0
                      ? "—"
                      : `até ${maximoDeParcelas(bandeira.parcelas)}x · ${porcentagem(
                          bandeira.parcelas[0].taxaPercentual,
                        )} a ${porcentagem(
                          bandeira.parcelas[bandeira.parcelas.length - 1].taxaPercentual,
                        )}`}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={bandeira.ativo ? "default" : "outline"}
                      className={bandeira.ativo ? "" : "border-destructive bg-destructive"}
                    >
                      {bandeira.ativo ? "Ativa" : "Inativa"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0 hover:cursor-pointer">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => abrirEdicao(bandeira)}>
                          Editar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => excluir(bandeira)}
                        >
                          Excluir
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
