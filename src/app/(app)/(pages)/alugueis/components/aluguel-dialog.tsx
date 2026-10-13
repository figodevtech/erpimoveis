"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarDays,
  Car,
  ClipboardCheck,
  Loader2,
  Package,
  PackagePlus,
  PackageSearch,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { ESCOPOS_DE_ESTOQUE } from "@/lib/usoconsumo/escopo";
import {
  ROTULO_TIPO_ITEM_ALUGUEL,
  diferencaEmDias,
  hojeAluguel,
  somarDias,
  type TipoItemAluguel,
} from "@/lib/alugueis/status";

import CustomerSelect from "@/app/(app)/components/customerSelect";
import VehicleSelect from "@/app/(app)/components/vehicleSelect";
import { ItemSelectDialog, type ItemDeEstoqueOption } from "@/app/(app)/(pages)/usoconsumo/components/item-select-dialog";
import { DialogShell } from "@/app/(app)/(pages)/ordens/components/dialogs/dialog-shell";
import { OrdemFormSection } from "@/app/(app)/(pages)/ordens/components/form-section";

import { avisarAlteracaoAlugueis, carregarAluguel, criarAluguel, editarAluguel } from "../lib/api";
import type { AluguelPayload, ClienteCadastrado, ItemAluguelForm } from "../types";
import {
  ChecklistRascunhoCard,
  RASCUNHO_VAZIO,
  gravarChecklist,
  useModelosChecklist,
  type RascunhoChecklist,
} from "./checklist-aluguel";
import { fmtMoeda } from "./status-aluguel";

type ModoCliente = "cadastrado" | "avulso";
type ClienteAvulso = { nome: string; documento: string; telefone: string; email: string };

const AVULSO_VAZIO: ClienteAvulso = { nome: "", documento: "", telefone: "", email: "" };
const ATALHOS_DURACAO = [1, 7, 15, 30];
const TIPOS_DE_ESTOQUE: TipoItemAluguel[] = ["PRODUTO", "USOCONSUMO", "GERAL"];

let contador = 0;
const novaChave = () => `n${Date.now()}-${++contador}`;

/** "2026-10-13" <-> Date local, sem passar pelo UTC. */
function paraDate(data: string) {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(ano, mes - 1, dia);
}

function CampoData({ label, valor, onChange, minimo }: { label: string; valor: string; onChange: (v: string) => void; minimo?: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Popover open={aberto} onOpenChange={setAberto}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-start font-normal">
            <CalendarDays className="mr-2 h-4 w-4" />
            {valor ? format(paraDate(valor), "dd/MM/yyyy (EEE)", { locale: ptBR }) : "Selecionar"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={ptBR}
            selected={valor ? paraDate(valor) : undefined}
            defaultMonth={valor ? paraDate(valor) : undefined}
            disabled={minimo ? (data) => format(data, "yyyy-MM-dd") < minimo : undefined}
            onSelect={(data) => {
              if (!data) return;
              onChange(format(data, "yyyy-MM-dd"));
              setAberto(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function AluguelDialog({
  open,
  onOpenChange,
  aluguelId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Presente: edita o aluguel. Ausente: cria um novo. */
  aluguelId?: number | null;
}) {
  const editando = Boolean(aluguelId);
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const [modoCliente, setModoCliente] = useState<ModoCliente>("cadastrado");
  const [cliente, setCliente] = useState<ClienteCadastrado | null>(null);
  const [avulso, setAvulso] = useState<ClienteAvulso>(AVULSO_VAZIO);
  const [clienteAberto, setClienteAberto] = useState(false);

  const [dataInicio, setDataInicio] = useState(hojeAluguel());
  const [dataLimite, setDataLimite] = useState(somarDias(hojeAluguel(), 7));
  const [observacao, setObservacao] = useState("");

  const [itens, setItens] = useState<ItemAluguelForm[]>([]);
  const [estoqueAberto, setEstoqueAberto] = useState(false);
  const [veiculoAberto, setVeiculoAberto] = useState(false);
  const [itemAvulso, setItemAvulso] = useState({ descricao: "", identificacao: "", quantidade: 1 });

  const [checklistSaida, setChecklistSaida] = useState<RascunhoChecklist>(RASCUNHO_VAZIO);
  const modelos = useModelosChecklist(open && !editando);

  // O pai passa a callback inline; como dependência do effect, cada render dele
  // zeraria o formulário no meio da digitação.
  const fecharRef = useRef(onOpenChange);
  useEffect(() => {
    fecharRef.current = onOpenChange;
  });

  useEffect(() => {
    if (!open) return;
    setModoCliente("cadastrado");
    setCliente(null);
    setAvulso(AVULSO_VAZIO);
    setDataInicio(hojeAluguel());
    setDataLimite(somarDias(hojeAluguel(), 7));
    setObservacao("");
    setItens([]);
    setItemAvulso({ descricao: "", identificacao: "", quantidade: 1 });
    setChecklistSaida(RASCUNHO_VAZIO);
    if (!aluguelId) return;

    let vivo = true;
    setCarregando(true);
    carregarAluguel(aluguelId)
      .then((aluguel) => {
        if (!vivo) return;
        if (aluguel.cliente_id && aluguel.cliente) {
          setModoCliente("cadastrado");
          setCliente(aluguel.cliente);
        } else {
          setModoCliente("avulso");
          setAvulso({
            nome: aluguel.cliente_nome ?? "",
            documento: aluguel.cliente_documento ?? "",
            telefone: aluguel.cliente_telefone ?? "",
            email: aluguel.cliente_email ?? "",
          });
        }
        setDataInicio(aluguel.data_inicio);
        setDataLimite(aluguel.data_limite);
        setObservacao(aluguel.observacao ?? "");
        setItens(
          aluguel.itens.map((item) => ({
            chave: `i${item.id}`,
            id: item.id,
            tipo: item.tipo,
            produto_id: item.produto_id ?? null,
            usoconsumo_item_id: item.usoconsumo_item_id ?? null,
            veiculo_id: item.veiculo_id ?? null,
            descricao: item.descricao,
            identificacao: item.identificacao ?? "",
            quantidade: item.quantidade,
            valor: Number(item.valor ?? 0),
            disponivel: null,
          })),
        );
      })
      .catch((error) => {
        toast.error(error?.message || "Falha ao carregar aluguel.");
        fecharRef.current(false);
      })
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [open, aluguelId]);

  const duracao = useMemo(() => {
    if (!dataInicio || !dataLimite) return null;
    return diferencaEmDias(dataInicio, dataLimite);
  }, [dataInicio, dataLimite]);

  const total = useMemo(() => itens.reduce((soma, item) => soma + item.valor * item.quantidade, 0), [itens]);

  function alterarInicio(valor: string) {
    const dias = duracao ?? 0;
    setDataInicio(valor);
    // Mantém a duração escolhida quando o início anda.
    setDataLimite(somarDias(valor, Math.max(0, dias)));
  }

  function alterarItem(chave: string, patch: Partial<ItemAluguelForm>) {
    setItens((atual) => atual.map((item) => (item.chave === chave ? { ...item, ...patch } : item)));
  }

  function adicionarDoEstoque(opcao: ItemDeEstoqueOption) {
    const tipo = (opcao.escopo ?? "USOCONSUMO") as TipoItemAluguel;
    const campo = tipo === "PRODUTO" ? "produto_id" : "usoconsumo_item_id";
    if (itens.some((item) => item.tipo === tipo && item[campo] === opcao.id)) {
      toast.error("Este item já está no aluguel. Ajuste a quantidade na lista.");
      return;
    }
    setItens((atual) => [
      ...atual,
      {
        chave: novaChave(),
        tipo,
        produto_id: tipo === "PRODUTO" ? opcao.id : null,
        usoconsumo_item_id: tipo === "PRODUTO" ? null : opcao.id,
        descricao: opcao.titulo,
        identificacao: opcao.referencia ?? "",
        quantidade: 1,
        valor: 0,
        disponivel: typeof opcao.estoque === "number" ? opcao.estoque : null,
      },
    ]);
  }

  function adicionarVeiculo(veiculo: { id?: number; placa?: string; marca?: string; modelo?: string }) {
    if (!veiculo.id) return;
    if (itens.some((item) => item.tipo === "VEICULO" && item.veiculo_id === veiculo.id)) {
      toast.error("Este veículo já está no aluguel.");
      return;
    }
    setItens((atual) => [
      ...atual,
      {
        chave: novaChave(),
        tipo: "VEICULO",
        veiculo_id: veiculo.id,
        descricao: [veiculo.marca, veiculo.modelo].filter(Boolean).join(" ") || "Veículo",
        identificacao: veiculo.placa ?? "",
        quantidade: 1,
        valor: 0,
      },
    ]);
  }

  function adicionarAvulso() {
    const descricao = itemAvulso.descricao.trim();
    if (!descricao) {
      toast.error("Informe a descrição do item avulso.");
      return;
    }
    setItens((atual) => [
      ...atual,
      {
        chave: novaChave(),
        tipo: "AVULSO",
        descricao,
        identificacao: itemAvulso.identificacao.trim(),
        quantidade: Math.max(1, Math.floor(itemAvulso.quantidade || 1)),
        valor: 0,
      },
    ]);
    setItemAvulso({ descricao: "", identificacao: "", quantidade: 1 });
  }

  function validar(): string | null {
    if (modoCliente === "cadastrado" && !cliente) return "Selecione o cliente ou mude para cliente avulso.";
    if (modoCliente === "avulso" && !avulso.nome.trim()) return "Informe o nome do cliente avulso.";
    if (!dataInicio || !dataLimite) return "Informe a data de início e a data limite.";
    if (dataLimite < dataInicio) return "A data limite não pode ser anterior à data de início.";
    if (!itens.length) return "Adicione ao menos um item ao aluguel.";
    if (itens.some((item) => !item.descricao.trim())) return "Todo item precisa de descrição.";
    if (itens.some((item) => !Number.isInteger(item.quantidade) || item.quantidade <= 0)) return "Quantidade inválida em algum item.";
    return null;
  }

  async function salvar() {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    const payload: AluguelPayload = {
      data_inicio: dataInicio,
      data_limite: dataLimite,
      cliente_id: modoCliente === "cadastrado" ? cliente?.id ?? null : null,
      cliente: modoCliente === "avulso" ? { ...avulso, nome: avulso.nome.trim() } : undefined,
      observacao: observacao.trim(),
      itens: itens.map((item) => ({
        id: item.id,
        tipo: item.tipo,
        produto_id: item.produto_id ?? null,
        usoconsumo_item_id: item.usoconsumo_item_id ?? null,
        veiculo_id: item.veiculo_id ?? null,
        descricao: item.descricao,
        identificacao: item.identificacao,
        quantidade: item.quantidade,
        valor: item.valor,
      })),
    };

    setSalvando(true);
    try {
      const { id } = aluguelId ? await editarAluguel(aluguelId, payload) : await criarAluguel(payload);
      if (!aluguelId && checklistSaida.templateId) {
        try {
          await gravarChecklist(id, "SAIDA", checklistSaida, modelos);
        } catch (error: any) {
          toast.error(`Aluguel #${id} criado, mas o checklist de saída falhou: ${error?.message ?? "erro"}. Preencha pelos detalhes.`);
        }
      }
      toast.success(aluguelId ? `Aluguel #${id} atualizado.` : `Aluguel #${id} criado.`);
      avisarAlteracaoAlugueis();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Falha ao salvar aluguel.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={(valor) => !salvando && onOpenChange(valor)}
      variant="workbench"
      eyebrow="Aluguéis"
      title={editando ? `Editar aluguel #${aluguelId}` : "Novo aluguel"}
      description="Item de estoque sai do saldo ao salvar e volta quando o aluguel é encerrado ou excluído."
      loading={carregando}
      footer={
        <>
          <span className="mr-auto text-sm text-muted-foreground">
            Total: <strong className="text-foreground">{fmtMoeda(total)}</strong>
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando || carregando}>
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editando ? "Salvar alterações" : "Criar aluguel"}
          </Button>
        </>
      }
    >
      {carregando ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando aluguel...
        </div>
      ) : (
        <div className="space-y-4">
          <OrdemFormSection icon={UserRound} title="Cliente" description="Do cadastro ou avulso, sem cadastrar.">
            <div className="mb-3 inline-flex rounded-md border p-0.5">
              {(["cadastrado", "avulso"] as const).map((modo) => (
                <Button
                  key={modo}
                  type="button"
                  size="sm"
                  variant={modoCliente === modo ? "secondary" : "ghost"}
                  onClick={() => setModoCliente(modo)}
                >
                  {modo === "cadastrado" ? "Cadastrado" : "Avulso"}
                </Button>
              ))}
            </div>

            {modoCliente === "cadastrado" ? (
              <div className="flex flex-wrap items-center gap-3">
                {cliente ? (
                  <div className="min-w-0 flex-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <p className="font-medium">{cliente.nomerazaosocial}</p>
                    <p className="text-xs text-muted-foreground">
                      {[cliente.cpfcnpj, cliente.telefone, cliente.email].filter(Boolean).join(" · ") || "Sem contato"}
                    </p>
                  </div>
                ) : (
                  <p className="flex-1 text-sm text-muted-foreground">Nenhum cliente selecionado.</p>
                )}
                <CustomerSelect
                  open={clienteAberto}
                  setOpen={setClienteAberto}
                  OnSelect={(selecionado) => {
                    setCliente({
                      id: selecionado.id,
                      nomerazaosocial: selecionado.nomerazaosocial,
                      cpfcnpj: selecionado.cpfcnpj,
                      telefone: selecionado.telefone,
                      email: selecionado.email,
                    });
                    setClienteAberto(false);
                  }}
                >
                  <Button type="button" variant="outline">
                    {cliente ? "Trocar cliente" : "Selecionar cliente"}
                  </Button>
                </CustomerSelect>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Nome *</Label>
                  <Input value={avulso.nome} maxLength={200} onChange={(e) => setAvulso({ ...avulso, nome: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>CPF/CNPJ</Label>
                  <Input value={avulso.documento} maxLength={20} onChange={(e) => setAvulso({ ...avulso, documento: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={avulso.telefone} maxLength={30} onChange={(e) => setAvulso({ ...avulso, telefone: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>E-mail</Label>
                  <Input type="email" value={avulso.email} maxLength={200} onChange={(e) => setAvulso({ ...avulso, email: e.target.value })} />
                </div>
              </div>
            )}
          </OrdemFormSection>

          <OrdemFormSection icon={CalendarDays} title="Período" description="A contagem de dias usa a data limite.">
            <div className="grid gap-3 sm:grid-cols-2">
              <CampoData label="Data de início" valor={dataInicio} onChange={alterarInicio} />
              <CampoData label="Data limite" valor={dataLimite} onChange={setDataLimite} minimo={dataInicio} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Duração:</span>
              {ATALHOS_DURACAO.map((dias) => (
                <Button
                  key={dias}
                  type="button"
                  size="sm"
                  variant={duracao === dias ? "secondary" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setDataLimite(somarDias(dataInicio, dias))}
                >
                  {dias} {dias === 1 ? "dia" : "dias"}
                </Button>
              ))}
              {duracao !== null && duracao >= 0 ? (
                <Badge variant="outline" className="ml-auto">
                  {duracao} {duracao === 1 ? "dia" : "dias"} de aluguel
                </Badge>
              ) : null}
            </div>
          </OrdemFormSection>

          <OrdemFormSection icon={Package} title="Itens" description="Qualquer bem: estoque, veículo ou item avulso.">
            <div className="flex flex-wrap gap-2">
              <ItemSelectDialog
                open={estoqueAberto}
                setOpen={setEstoqueAberto}
                onSelect={(opcao) => {
                  adicionarDoEstoque(opcao);
                  setEstoqueAberto(false);
                }}
                escopo="PRODUTO"
                escopos={ESCOPOS_DE_ESTOQUE}
                permitirTrocaDeEscopo
                permitirCriacao={false}
              >
                <Button type="button" variant="outline">
                  <PackageSearch className="mr-2 h-4 w-4" /> Do estoque
                </Button>
              </ItemSelectDialog>
              <VehicleSelect
                open={veiculoAberto}
                setOpen={setVeiculoAberto}
                title="Selecionar veículo para aluguel"
                OnSelect={(veiculo) => {
                  adicionarVeiculo(veiculo);
                  setVeiculoAberto(false);
                }}
              >
                <Button type="button" variant="outline">
                  <Car className="mr-2 h-4 w-4" /> Veículo
                </Button>
              </VehicleSelect>
            </div>

            <div className="mt-3 grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_180px_90px_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label className="text-xs">Item avulso</Label>
                <Input
                  placeholder="Descrição do bem"
                  value={itemAvulso.descricao}
                  maxLength={255}
                  onChange={(e) => setItemAvulso({ ...itemAvulso, descricao: e.target.value })}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), adicionarAvulso())}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Identificação</Label>
                <Input
                  placeholder="Patrimônio, série..."
                  value={itemAvulso.identificacao}
                  maxLength={120}
                  onChange={(e) => setItemAvulso({ ...itemAvulso, identificacao: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Qtd.</Label>
                <Input
                  type="number"
                  min={1}
                  value={itemAvulso.quantidade}
                  onChange={(e) => setItemAvulso({ ...itemAvulso, quantidade: Number(e.target.value) })}
                />
              </div>
              <Button type="button" variant="secondary" onClick={adicionarAvulso}>
                <PackagePlus className="mr-2 h-4 w-4" /> Adicionar
              </Button>
            </div>

            {itens.length ? (
              <div className="mt-3 space-y-2">
                {itens.map((item) => {
                  const deEstoque = TIPOS_DE_ESTOQUE.includes(item.tipo);
                  const semSaldo = deEstoque && !item.id && item.disponivel != null && item.quantidade > item.disponivel;
                  return (
                    <div
                      key={item.chave}
                      className={cn(
                        "grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_150px_80px_120px_auto] sm:items-center",
                        semSaldo && "border-red-500/50",
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {ROTULO_TIPO_ITEM_ALUGUEL[item.tipo]}
                          </Badge>
                          {item.id ? <span className="text-[10px] text-muted-foreground">já no aluguel</span> : null}
                        </div>
                        {item.tipo === "AVULSO" ? (
                          <Input
                            className="mt-1 h-8"
                            value={item.descricao}
                            maxLength={255}
                            onChange={(e) => alterarItem(item.chave, { descricao: e.target.value })}
                          />
                        ) : (
                          <p className="mt-1 truncate text-sm font-medium" title={item.descricao}>
                            {item.descricao}
                          </p>
                        )}
                        {semSaldo ? (
                          <p className="text-xs text-red-600">Saldo disponível: {item.disponivel}</p>
                        ) : deEstoque && !item.id && item.disponivel != null ? (
                          <p className="text-xs text-muted-foreground">Saldo disponível: {item.disponivel}</p>
                        ) : null}
                      </div>
                      <Input
                        className="h-8"
                        placeholder="Identificação"
                        value={item.identificacao}
                        maxLength={120}
                        onChange={(e) => alterarItem(item.chave, { identificacao: e.target.value })}
                      />
                      <Input
                        className="h-8"
                        type="number"
                        min={1}
                        aria-label="Quantidade"
                        disabled={item.tipo === "VEICULO"}
                        value={item.quantidade}
                        onChange={(e) => alterarItem(item.chave, { quantidade: Math.floor(Number(e.target.value)) })}
                      />
                      <ValueInput
                        className="h-8 text-right"
                        aria-label="Valor unitário"
                        value={item.valor}
                        onValueChange={(valor) => alterarItem(item.chave, { valor })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remover item"
                        onClick={() => setItens((atual) => atual.filter((linha) => linha.chave !== item.chave))}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  );
                })}
                <p className="text-right text-xs text-muted-foreground">
                  Valor por unidade no período · total {fmtMoeda(total)}
                </p>
              </div>
            ) : (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Plus className="h-4 w-4" /> Nenhum item adicionado.
              </p>
            )}
          </OrdemFormSection>

          {!editando ? (
            <OrdemFormSection icon={ClipboardCheck} title="Checklist de saída" description="Opcional. Pode ser feito depois pelos detalhes.">
              <ChecklistRascunhoCard
                tipo="SAIDA"
                rascunho={checklistSaida}
                modelos={modelos}
                onChange={setChecklistSaida}
                disabled={salvando}
                ajuda={modelos.length ? "Opcional" : "Nenhum modelo de checklist ativo em Configurações."}
              />
            </OrdemFormSection>
          ) : null}

          <OrdemFormSection icon={ClipboardCheck} title="Observação">
            <Textarea
              rows={3}
              maxLength={1000}
              placeholder="Condições combinadas, caução, local de entrega..."
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </OrdemFormSection>
        </div>
      )}
    </DialogShell>
  );
}
