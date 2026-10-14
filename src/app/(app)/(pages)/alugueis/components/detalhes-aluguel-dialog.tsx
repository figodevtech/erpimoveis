"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  History,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Package,
  UserRound,
} from "lucide-react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants";
import {
  ROTULO_TIPO_ITEM_ALUGUEL,
  duracaoContratada,
  politicaAluguel,
} from "@/lib/alugueis/status";
import { ChecklistImagePreview } from "@/app/(app)/(pages)/ordens/components/dialogs/checklist-image-preview";

import { carregarAluguel } from "../lib/api";
import type { AluguelDetalhe, ChecklistAluguel, EventoAluguel } from "../types";
import { nomeDoCliente, quantidadeQueVoltou } from "../types";
import { TEXTOS_CHECKLIST, type TipoChecklistAluguel } from "./checklist-aluguel";
import { RowActions, type AcaoAluguel } from "./row-actions";
import { DestinatarioBadge, DiasAluguel, StatusAluguelBadge, fmtData, fmtDataHora, fmtLimite, fmtMoeda } from "./status-aluguel";

const tabTriggerClass =
  "group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm";

const tabContentClass = "mt-0 h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-4 sm:px-6 sm:py-5";

const CLASSES_MARCA: Record<string, string> = {
  OK: "border-emerald-500/35 bg-emerald-100 text-emerald-900 dark:bg-emerald-600/15 dark:text-emerald-300",
  ALERTA: "border-amber-500/35 bg-amber-100 text-amber-900 dark:bg-amber-600/15 dark:text-amber-300",
  FALHA: "border-red-500/35 bg-red-100 text-red-900 dark:bg-red-600/15 dark:text-red-300",
};

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <div className="mt-0.5 break-words text-sm">{children}</div>
    </div>
  );
}

function Cartao({ icone: Icone, titulo, children }: { icone: typeof UserRound; titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icone className="h-4 w-4 text-primary" /> {titulo}
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function descreverEvento(evento: EventoAluguel): string {
  const d = evento.dados ?? {};
  const periodo = (p?: { data_inicio?: string; data_limite?: string | null }) =>
    !p ? "" : p.data_limite ? `${fmtData(p.data_inicio)} a ${fmtData(p.data_limite)}` : `${fmtData(p.data_inicio)}, sem limite`;
  switch (evento.tipo) {
    case "CRIADO":
      return `Aluguel criado com ${d.itens ?? 0} item(ns), ${d.data_limite ? `de ${periodo(d)}` : `a partir de ${fmtData(d.data_inicio)}, prazo indeterminado`}.`;
    case "EDITADO": {
      const partes = [];
      if (JSON.stringify(d.antes) !== JSON.stringify(d.depois)) partes.push(`período ${periodo(d.antes)} → ${periodo(d.depois)}`);
      // Eventos a partir de 20261013180000 trazem a descrição; os anteriores, só a contagem.
      const lista = (valor: unknown) => (Array.isArray(valor) && valor.length ? (valor as string[]).join(", ") : null);
      const adicionados = lista(d.descricao_adicionados);
      const removidos = lista(d.descricao_removidos);
      const trocados = lista(d.descricao_trocados);
      if (adicionados) partes.push(`adicionado(s): ${adicionados}`);
      else if (d.itens_adicionados) partes.push(`${d.itens_adicionados} item(ns) adicionado(s)`);
      if (removidos) partes.push(`retirado(s) e devolvido(s) ao estoque: ${removidos}`);
      else if (d.itens_removidos) partes.push(`${d.itens_removidos} item(ns) devolvido(s) ao retirar`);
      if (trocados) partes.push(`alterado(s): ${trocados}`);
      return partes.length ? `Editado: ${partes.join("; ")}.` : "Dados do aluguel editados.";
    }
    case "PAUSADO":
      return d.dias_restantes == null ? "Contagem pausada (prazo indeterminado)." : `Contagem pausada com ${d.dias_restantes} dia(s) até o limite.`;
    case "REINICIADO":
      return `Reiniciado a partir de hoje: ${periodo(d.depois)}${d.duracao_dias == null ? "" : ` (${d.duracao_dias} dias)`}. Antes: ${periodo(d.antes)}.`;
    case "ENCERRADO":
    {
      const naoVoltaram = Array.isArray(d.nao_retornados) && d.nao_retornados.length ? d.nao_retornados.join(", ") : null;
      return `Encerrado com retorno em ${fmtDataHora(d.encerrado_em)}; ${d.itens_devolvidos ?? 0} item(ns) baixado(s) do aluguel.${naoVoltaram ? ` Não retornou: ${naoVoltaram}.` : ""}${d.observacao ? ` Obs.: ${d.observacao}` : ""}`;
    }
    case "EXCLUIDO":
      return `Excluído: ${d.motivo ?? ""}`;
    case "CHECKLIST_SAIDA":
    case "CHECKLIST_RETORNO":
      return `${evento.tipo === "CHECKLIST_SAIDA" ? "Checklist de saída" : "Checklist de retorno"} gravado: ${d.itens ?? 0} itens, ${d.alertas ?? 0} alerta(s), ${d.falhas ?? 0} falha(s).`;
    default:
      return evento.tipo;
  }
}

const ROTULO_EVENTO: Record<EventoAluguel["tipo"], string> = {
  CRIADO: "Criado",
  EDITADO: "Editado",
  PAUSADO: "Pausado",
  REINICIADO: "Reiniciado",
  ENCERRADO: "Encerrado",
  EXCLUIDO: "Excluído",
  CHECKLIST_SAIDA: "Checklist de saída",
  CHECKLIST_RETORNO: "Checklist de retorno",
};

function ChecklistSecao({
  tipo,
  aluguel,
  podeEditar,
  onAcao,
}: {
  tipo: TipoChecklistAluguel;
  aluguel: AluguelDetalhe;
  podeEditar: boolean;
  onAcao: (acao: AcaoAluguel, aluguel: AluguelDetalhe) => void;
}) {
  const salvo: ChecklistAluguel | undefined = aluguel.checklists.find((item) => item.tipo === tipo);
  const politica = politicaAluguel(aluguel.status);
  // Saída se mexe enquanto o aluguel está aberto; retorno, depois do encerramento.
  const liberado = podeEditar && (tipo === "SAIDA" ? politica.podeChecklistSaida : politica.podeChecklistRetorno);
  const textos = TEXTOS_CHECKLIST[tipo];

  return (
    <AccordionItem value={tipo} className="rounded-lg border bg-card px-4">
      <AccordionTrigger className="hover:no-underline">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <ClipboardCheck className="h-4 w-4 text-primary" /> {textos.titulo}
          {salvo ? (
            <span className="text-xs font-normal text-muted-foreground">
              {fmtDataHora(salvo.realizado_em)}
              {salvo.realizador?.nome ? ` · ${salvo.realizador.nome}` : ""}
            </span>
          ) : (
            <Badge variant="outline" className="text-[10px]">Não preenchido</Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4">
        {liberado ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAcao(tipo === "SAIDA" ? "checklist-saida" : "checklist-retorno", aluguel)}
            >
              {salvo ? "Editar checklist" : "Preencher checklist"}
            </Button>
          </div>
        ) : null}

        {salvo ? (
          salvo.itens
            .slice()
            .sort((a, b) => a.ordem - b.ordem)
            .map((item) => (
              <div key={item.id} className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.titulo}</p>
                    {item.observacao ? <p className="mt-1 text-xs text-muted-foreground">{item.observacao}</p> : null}
                  </div>
                  {item.status ? (
                    <Badge className={cn("text-[11px]", CLASSES_MARCA[item.status])}>{item.status}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px]">Sem marcação</Badge>
                  )}
                </div>
                {item.imagens?.length ? (
                  <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                    {item.imagens.map((imagem) => (
                      <div key={imagem.id} className="w-28 shrink-0">
                        <ChecklistImagePreview src={imagem.url} alt={imagem.descricao ?? item.titulo} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {tipo === "RETORNO" && aluguel.status !== "ENCERRADO"
              ? "O checklist de retorno fica disponível depois do encerramento do aluguel."
              : "Nenhum checklist registrado."}
          </p>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

export type AbaDetalhesAluguel = "resumo" | "itens" | "checklists" | "historico";

export function DetalhesAluguelDialog({
  aluguelId,
  onOpenChange,
  onAcao,
  abaInicial = "resumo",
}: {
  aluguelId: number | null;
  onOpenChange: (open: boolean) => void;
  /** As mesmas ações do menu da lista; a tela recarrega com `alugueis:refresh`. */
  onAcao: (acao: AcaoAluguel, aluguel: AluguelDetalhe) => void;
  abaInicial?: AbaDetalhesAluguel;
}) {
  const open = Boolean(aluguelId);
  const { data: session } = useSession();
  const podeEditar = permissionSetHas((session?.user as any)?.permissoes, PERMS.ALUGUEIS_EDITAR);
  const [dados, setDados] = useState<AluguelDetalhe | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aba, setAba] = useState<string>(abaInicial);

  const recarregar = useCallback(async () => {
    if (!aluguelId) return;
    try {
      setDados(await carregarAluguel(aluguelId));
    } catch (error: any) {
      toast.error(error?.message || "Falha ao carregar aluguel.");
    }
  }, [aluguelId]);

  useEffect(() => {
    let vivo = true;
    void Promise.resolve().then(async () => {
      if (!vivo) return;
      if (!aluguelId) {
        setDados(null);
        return;
      }
      setAba(abaInicial);
      setCarregando(true);
      await recarregar();
      if (vivo) setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [aluguelId, recarregar, abaInicial]);

  // Ações abertas daqui (editar, checklist, encerrar...) avisam pelo mesmo evento da lista.
  useEffect(() => {
    if (!aluguelId) return;
    const aoMudar = () => void recarregar();
    window.addEventListener("alugueis:refresh", aoMudar);
    return () => window.removeEventListener("alugueis:refresh", aoMudar);
  }, [aluguelId, recarregar]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-[100dvw] flex-col overflow-hidden rounded-none !gap-0 p-0 sm:h-[90vh] sm:w-[95vw] sm:rounded-lg md:max-w-[1000px]"
      >
        <div className="shrink-0 border-b bg-background/95 backdrop-blur">
          <DialogHeader className="gap-1 px-5 py-4 pr-12">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Aluguel #{aluguelId}
              {dados ? <StatusAluguelBadge aluguel={dados} /> : null}
              {dados ? (
                <span className="ml-auto">
                  <RowActions
                    aluguel={dados}
                    onAcao={(acao) => onAcao(acao, dados)}
                    ocultar={["detalhes"]}
                    trigger={
                      <Button variant="outline" size="sm" className="h-8">
                        <MoreHorizontal className="mr-1 h-4 w-4" /> Ações
                      </Button>
                    }
                  />
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {dados ? (
                <>
                  <span>{nomeDoCliente(dados)}</span>
                  <span>
                    {fmtData(dados.data_inicio)} a {fmtData(dados.data_limite)}
                  </span>
                  <DiasAluguel aluguel={dados} />
                </>
              ) : (
                "Carregando..."
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {carregando || !dados ? (
          <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
            {carregando ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando
              </span>
            ) : (
              "Não foi possível carregar os detalhes."
            )}
          </div>
        ) : (
          <Tabs value={aba} onValueChange={setAba} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 overflow-x-auto px-2 pb-2 pt-3">
              <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1">
                <TabsTrigger value="resumo" className={tabTriggerClass}>
                  <span className="flex items-center gap-2"><FileText className="h-3.5 w-3.5" /> Resumo</span>
                </TabsTrigger>
                <TabsTrigger value="itens" className={tabTriggerClass}>
                  <span className="flex items-center gap-2"><Package className="h-3.5 w-3.5" /> Itens ({dados.itens.length})</span>
                </TabsTrigger>
                <TabsTrigger value="checklists" className={tabTriggerClass}>
                  <span className="flex items-center gap-2"><ClipboardCheck className="h-3.5 w-3.5" /> Checklists</span>
                </TabsTrigger>
                <TabsTrigger value="historico" className={tabTriggerClass}>
                  <span className="flex items-center gap-2"><History className="h-3.5 w-3.5" /> Histórico</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="resumo" className={tabContentClass}>
              <Cartao icone={UserRound} titulo="Destinatário">
                <Campo rotulo="Nome">
                  {nomeDoCliente(dados)}
                  <DestinatarioBadge aluguel={dados} className="ml-2" />
                </Campo>
                <Campo rotulo="CPF/CNPJ">{dados.cliente?.cpfcnpj || dados.cliente_documento || "—"}</Campo>
                <Campo rotulo="Telefone">{dados.cliente?.telefone || dados.cliente_telefone || "—"}</Campo>
                <Campo rotulo="E-mail">{dados.cliente?.email || dados.destinatario?.email || dados.cliente_email || "—"}</Campo>
              </Cartao>

              <Cartao icone={CalendarDays} titulo="Período">
                <Campo rotulo="Início">{fmtData(dados.data_inicio)}</Campo>
                <Campo rotulo="Limite">{fmtLimite(dados.data_limite)}</Campo>
                <Campo rotulo="Duração contratada">
                  {dados.data_limite ? `${duracaoContratada(dados)} dia(s)` : "Prazo indeterminado"}
                </Campo>
                <Campo rotulo="Situação"><DiasAluguel aluguel={dados} /></Campo>
                {dados.pausado_em ? <Campo rotulo="Pausado em">{fmtDataHora(dados.pausado_em)}</Campo> : null}
                {dados.encerrado_em ? (
                  <Campo rotulo="Retorno">
                    {fmtDataHora(dados.encerrado_em)}
                    {dados.encerrador?.nome ? ` · ${dados.encerrador.nome}` : ""}
                  </Campo>
                ) : null}
              </Cartao>

              <Cartao icone={FileText} titulo="Registro">
                <Campo rotulo="Valor total">{fmtMoeda(dados.valor_total)}</Campo>
                <Campo rotulo="Criado por">
                  {dados.criador?.nome ?? "—"} em {fmtDataHora(dados.created_at)}
                </Campo>
                <Campo rotulo="Observação">{dados.observacao || "—"}</Campo>
                {dados.observacao_encerramento ? (
                  <Campo rotulo="Observação do retorno">{dados.observacao_encerramento}</Campo>
                ) : null}
              </Cartao>
            </TabsContent>

            <TabsContent value="itens" className={tabContentClass}>
              <div className="overflow-hidden rounded-md border bg-card">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead>Tipo</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Identificação</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      {dados.status === "ENCERRADO" ? <TableHead className="text-right">Retornou</TableHead> : null}
                      <TableHead className="text-right">Valor</TableHead>
                      <TableHead className="text-right">Subtotal</TableHead>
                      <TableHead>Estoque</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dados.itens.map((item) => {
                      const saida = item.estoque_saida_id ?? item.usoconsumo_saida_id;
                      const voltou = quantidadeQueVoltou(item);
                      const falta = dados.status === "ENCERRADO" ? item.quantidade - voltou : 0;
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{ROTULO_TIPO_ITEM_ALUGUEL[item.tipo]}</Badge>
                          </TableCell>
                          <TableCell className="font-medium">{item.descricao}</TableCell>
                          <TableCell>{item.identificacao || "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{item.quantidade}</TableCell>
                          {dados.status === "ENCERRADO" ? (
                            <TableCell className={cn("text-right tabular-nums", falta > 0 && "font-semibold text-amber-700 dark:text-amber-300")}>
                              {voltou}
                            </TableCell>
                          ) : null}
                          <TableCell className="text-right tabular-nums">{fmtMoeda(item.valor)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoeda(item.valor * item.quantidade)}</TableCell>
                          <TableCell>
                            {!saida ? (
                              <span className="text-muted-foreground">{falta > 0 ? `${falta} não retornou` : "Sem saldo"}</span>
                            ) : item.devolvido_em && falta > 0 ? (
                              // A saída apontada é a da falta, que seguiu fora do estoque.
                              <span className="text-amber-700 dark:text-amber-300">
                                {voltou ? `${voltou} devolvido · ` : ""}
                                {falta} fora do estoque · saída #{saida}
                              </span>
                            ) : item.devolvido_em ? (
                              <span className="text-emerald-700 dark:text-emerald-300">Devolvido · saída #{saida}</span>
                            ) : (
                              <span className="text-amber-700 dark:text-amber-300">Fora do estoque · saída #{saida}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-right text-sm">
                Total: <strong>{fmtMoeda(dados.valor_total)}</strong>
              </p>
            </TabsContent>

            <TabsContent value="checklists" className={tabContentClass}>
              <Accordion type="multiple" defaultValue={["SAIDA", "RETORNO"]} className="space-y-3">
                <ChecklistSecao tipo="SAIDA" aluguel={dados} podeEditar={podeEditar} onAcao={onAcao} />
                <ChecklistSecao tipo="RETORNO" aluguel={dados} podeEditar={podeEditar} onAcao={onAcao} />
              </Accordion>
            </TabsContent>

            <TabsContent value="historico" className={tabContentClass}>
              {dados.eventos.length ? (
                <ol className="relative space-y-3 border-l pl-5">
                  {dados.eventos.map((evento) => (
                    <li key={evento.id} className="relative">
                      <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                      <div className="rounded-md border bg-card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{ROTULO_EVENTO[evento.tipo] ?? evento.tipo}</span>
                          <span className="text-xs text-muted-foreground">
                            {fmtDataHora(evento.created_at)}
                            {evento.usuario?.nome ? ` · ${evento.usuario.nome}` : ""}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{descreverEvento(evento)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum evento registrado.</p>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
