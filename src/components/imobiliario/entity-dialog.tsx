"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EntityShell,
  RemoteState,
  StatusBadge,
  requestJson,
  useModulePermission,
  useRemote,
} from "./shared";
import { GeneralFields, ReservationQuote, type Quote } from "./forms";
import {
  AvailabilityPanel,
  FilesPanel,
  PortalAccessPanel,
  PublicationPanel,
  RelationshipPanel,
} from "./detail-panels";
import { FinancePanel } from "./finance-panel";
import { MidiaPanel } from "./midia/midia-panel";
import { AnexosPanel } from "./midia/anexos-panel";
import { useImovelMidia } from "./midia/use-imovel-midia";
import { notifyRemoval } from "./row-actions";
import { OperationAction } from "./actions-dialog";
import { CommercialPanel } from "./commercial-panel";
import {
  MODULES,
  type Entity,
  type ModuleKind,
  clientName,
  dateLabel,
  endpoint,
  entityName,
  itemFrom,
  propertyName,
  rowStatus,
} from "./model";
import {
  Building2,
  Users,
  CalendarDays,
  Key,
  BadgePercent,
  FileText,
  FolderArchive,
  Globe,
  CalendarCheck,
  WalletCards,
  ShieldCheck,
  MapPin,
  AlertCircle,
  Info,
  Trash2,
  Save,
  Loader2,
  Check,
  CheckCircle2,
  LogOut,
  XCircle,
  Receipt,
  Percent,
  Image as ImageIcon,
  Paperclip,
} from "lucide-react";

export type EntityDialogProps = {
  kind: ModuleKind;
  id?: number;
  initial?: Entity;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
};

function defaults(kind: ModuleKind): Entity {
  const today = new Date().toLocaleDateString("en-CA");
  if (kind === "proprietarios")
    return { tipopessoa: "FISICA", ativo: true, telefones: [], percentual_admin: 0 };
  if (kind === "imoveis")
    return {
      ativo: true,
      publicado: false,
      modalidades: ["TEMPORADA"],
      tipo: "FLAT",
      capacidade: 1,
      diaria: 0,
      taxa_limpeza: 0,
      percentual_admin: 0,
      endereco: {},
      endereco_publico: {},
      caracteristicas: {},
    };
  if (kind === "reservas")
    return { hospedes: 1, inicio: today, fim: "", observacoes: "" };
  if (kind === "locacoes-imobiliarias")
    return {
      inicio: today,
      fim: "",
      dia_vencimento: 5,
      valor_mensal: "",
      percentual_admin: 0,
      indice_reajuste: "IPCA",
    };
  return { data_venda: today, valor_total: "", comissao_percentual: 0 };
}

const tabIcons: Record<string, any> = {
  geral: FileText,
  imoveis: Building2,
  reservas: CalendarDays,
  "locacoes-imobiliarias": Key,
  "vendas-imobiliarias": BadgePercent,
  financeiro: WalletCards,
  acesso: ShieldCheck,
  arquivos: FolderArchive,
  midia: ImageIcon,
  anexos: Paperclip,
  publicacao: Globe,
  disponibilidade: CalendarCheck,
  visitas: MapPin,
};

const kindIcons: Record<ModuleKind, any> = {
  imoveis: Building2,
  proprietarios: Users,
  reservas: CalendarDays,
  "locacoes-imobiliarias": Key,
  "vendas-imobiliarias": BadgePercent,
};

export default function EntityDialog({
  kind,
  id,
  initial,
  open,
  onOpenChange,
  onSaved,
}: EntityDialogProps) {
  const config = MODULES[kind];
  const permission = config.permission;
  const { can } = useModulePermission();
  const formId = useId();
  const [currentId, setCurrentId] = useState(id);
  const remote = useRemote(currentId && open ? endpoint(kind, currentId) : null);
  const [value, setValue] = useState<Entity>(() => ({ ...defaults(kind), ...initial }));
  const [tab, setTab] = useState("geral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [operation, setOperation] = useState<ModuleKind | null>(null);
  // Fica no diálogo, e não na aba, para as fotos pendentes sobreviverem à troca de aba.
  const midia = useImovelMidia(kind === "imoveis" ? currentId : undefined);

  useEffect(() => {
    if (remote.data) setValue(itemFrom(remote.data));
  }, [remote.data]);

  const update = (next: Entity) => {
    setValue(next);
    setQuote(null);
    setRequestKey(crypto.randomUUID());
    setError("");
  };

  const editable = currentId ? can(`${permission}:editar`) : can(`${permission}:criar`);
  const financial = can(`${permission}:financeiro`);
  const original = remote.data ? itemFrom(remote.data) : null;
  const reservationChanged =
    kind === "reservas" &&
    (!currentId ||
      ["imovel_id", "cliente_id", "inicio", "fim", "hospedes"].some(
        (key) => String(value[key] ?? "") !== String(original?.[key] ?? "")
      ));

  const saved = () => {
    remote.reload();
    onSaved?.();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editable && !(kind === "imoveis" && can("imoveis:publicar") && tab === "publicacao")) return;
    if (reservationChanged && !quote) {
      setError("Consulte a cotação antes de confirmar as datas e valores da reserva.");
      setTab("geral");
      return;
    }
    if (value.inicio && value.fim && value.fim <= value.inicio) {
      setError("A data final deve ser posterior ao início.");
      return;
    }
    if (kind === "imoveis" && !(value.modalidades ?? []).length) {
      setError("Selecione ao menos uma modalidade do imóvel.");
      setTab("geral");
      return;
    }

    let payload: Entity = {
      ...value,
      idempotency_key: currentId ? value.idempotency_key : requestKey,
    };

    if (kind === "proprietarios") {
      for (const key of [
        "email",
        "telefone",
        "endereco",
        "bairro",
        "cidade",
        "estado",
        "cep",
        "endereconumero",
        "enderecocomplemento",
      ]) {
        if (payload[key] === "") payload[key] = null;
      }
    }

    if (kind === "locacoes-imobiliarias") {
      for (const key of ["fim", "proximo_reajuste"]) {
        if (!payload[key]) payload[key] = null;
      }
    }

    if (kind === "imoveis") {
      if (!can("imoveis:publicar")) {
        delete payload.publicado;
        delete payload.slug;
        delete payload.endereco_publico;
        delete payload.selo_anuncio;
        delete payload.fotos_reais;
      }
      if (!editable && tab === "publicacao") {
        payload = {
          publicado: value.publicado,
          slug: value.slug,
          endereco_publico: value.endereco_publico,
          selo_anuncio: value.selo_anuncio,
          fotos_reais: value.fotos_reais,
        };
      }
      if (payload.comodidades) {
        payload.comodidades = payload.comodidades
          .map((entry: string) => entry.trim())
          .filter(Boolean);
      }
    }

    if (reservationChanged) {
      payload = {
        ...payload,
        expected_total: quote?.total,
        cotacao_id: (quote as Entity)?.quoteId,
      };
    }

    setBusy(true);
    setError("");
    try {
      const response = await requestJson(endpoint(kind, currentId), {
        method: currentId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const item = itemFrom(response);
      if (item.id) {
        setCurrentId(Number(item.id));
        setValue(item);
      }
      toast.success(
        currentId
          ? tab === "publicacao"
            ? "Publicação atualizada"
            : "Cadastro atualizado"
          : kind === "reservas"
          ? "Reserva confirmada"
          : "Cadastro registrado"
      );
      onSaved?.();
      if (currentId) remote.reload();
      // Fotos escolhidas antes de salvar sobem junto com o cadastro, na ordem da galeria.
      if (kind === "imoveis" && item.id && midia.imagensPendentes.length > 0) {
        await midia.uploadPendentes(Number(item.id));
      }
    } catch (error) {
      const failure = error as Error & { status?: number };
      setError(failure.message);
      if (failure.status === 409 && kind === "reservas") setQuote(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        kind === "imoveis"
          ? "Excluir este imóvel? Sem reservas, locações, vendas ou lançamentos financeiros, ele é apagado definitivamente com fotos e anexos; com algum desses vínculos, é apenas inativado."
          : `Inativar ou excluir este ${config.singular}? Registros com histórico serão preservados pelo sistema.`
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      notifyRemoval(await requestJson(endpoint(kind, currentId), { method: "DELETE" }));
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [{ key: "geral", label: "Geral" }];
  if (currentId) {
    if (kind === "proprietarios") {
      tabs.push({ key: "imoveis", label: "Imóveis" }, { key: "reservas", label: "Reservas" });
      if (financial) tabs.push({ key: "financeiro", label: "Financeiro" });
      if (can("proprietarios:acesso_portal")) tabs.push({ key: "acesso", label: "Acesso ao portal" });
      tabs.push({ key: "arquivos", label: "Documentos / fotos" });
    } else if (kind === "imoveis") {
      tabs.push(
        { key: "midia", label: "Mídia" },
        { key: "anexos", label: "Anexos" },
        { key: "publicacao", label: "Publicação" },
        { key: "disponibilidade", label: "Disponibilidade" },
        { key: "reservas", label: "Reservas" },
        { key: "locacoes-imobiliarias", label: "Locações" },
        { key: "vendas-imobiliarias", label: "Vendas" }
      );
      if (financial) tabs.push({ key: "financeiro", label: "Financeiro" });
      tabs.push({ key: "visitas", label: "Visitas" });
    } else {
      tabs.push({ key: "arquivos", label: "Documentos" });
      if (financial) tabs.push({ key: "financeiro", label: "Financeiro" });
    }
  } else if (kind === "imoveis") {
    // Já no cadastro novo dá para escolher as fotos; elas sobem ao salvar.
    tabs.push({ key: "midia", label: "Mídia" });
  }

  const financeKey = ({
    proprietarios: "proprietario_id",
    imoveis: "imovel_id",
    reservas: "reserva_id",
    "locacoes-imobiliarias": "locacao_id",
    "vendas-imobiliarias": "venda_id",
  } as const)[kind];

  const KindIcon = kindIcons[kind] || Building2;

  const requestClose = () => {
    if (busy || midia.subindoImagens) return;
    const pendentes = midia.imagensPendentes.length;
    if (
      pendentes > 0 &&
      !window.confirm(
        `${pendentes === 1 ? "Há 1 foto que ainda não foi enviada" : `Há ${pendentes} fotos que ainda não foram enviadas`}. Fechar e descartar?`
      )
    )
      return;
    onOpenChange(false);
  };

  const itemTitle = currentId
    ? kind === "imoveis"
      ? (value.titulo?.trim() || `Imóvel #${currentId}`)
      : kind === "proprietarios"
      ? (value.nomerazaosocial?.trim() || `Proprietário #${currentId}`)
      : kind === "reservas"
      ? (value.codigo ? `Reserva #${value.codigo}` : `Reserva #${currentId}`)
      : `${config.singular.charAt(0).toUpperCase() + config.singular.slice(1)} #${currentId}`
    : config.singular.charAt(0).toUpperCase() + config.singular.slice(1);

  const headerTitle = (
    <div className="flex items-center gap-2 flex-wrap text-sm sm:text-lg">
      <span>{itemTitle}</span>
      <span className="text-muted-foreground text-sm font-light">
        | {currentId ? "Edição" : "Novo"}
      </span>
    </div>
  );

  const headerDescription = currentId
    ? kind === "imoveis"
      ? `ID #${currentId} · Modifique os dados para atualizar o imóvel`
      : kind === "proprietarios"
      ? `ID #${currentId} · Modifique os dados para atualizar o proprietário`
      : `Modifique os dados para atualizar o cadastro de ${config.singular}`
    : `Preencha os dados para registrar um novo cadastro de ${config.singular}`;

  return (
    <>
      <EntityShell
        open={open}
        onOpenChange={(next) => {
          if (!next) requestClose();
          else if (!busy) onOpenChange(next);
        }}
        title={headerTitle}
        description={headerDescription}
        badge={
          currentId ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusBadge status={rowStatus(value)} />
              {kind === "imoveis" ? (
                value.publicado ? (
                  <Badge
                    variant="outline"
                    className="text-emerald-700 dark:text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[11px] gap-1"
                  >
                    <Globe className="h-3 w-3" /> Publicado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground text-[11px]">
                    Não publicado
                  </Badge>
                )
              ) : null}
              {kind === "reservas" && value.financeiro_status ? (
                <StatusBadge status={value.financeiro_status} />
              ) : null}
            </div>
          ) : undefined
        }
        headerActions={
          currentId ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              {kind === "imoveis" ? (
                value.ativo !== false && !value.vendido_em ? (
                  <>
                    {can("reservas:criar") ? (
                      <QuickAction
                        label="Nova reserva"
                        icon={CalendarDays}
                        tone="sky"
                        onClick={() => setOperation("reservas")}
                      />
                    ) : null}
                    {can("locacoes_imobiliarias:criar") ? (
                      <QuickAction
                        label="Nova locação"
                        icon={Key}
                        tone="amber"
                        onClick={() => setOperation("locacoes-imobiliarias")}
                      />
                    ) : null}
                    {can("vendas_imobiliarias:criar") ? (
                      <QuickAction
                        label="Nova venda"
                        icon={BadgePercent}
                        tone="emerald"
                        onClick={() => setOperation("vendas-imobiliarias")}
                      />
                    ) : null}
                  </>
                ) : null
              ) : (
                <OperationButtons kind={kind} item={value} onAction={setAction} />
              )}
            </div>
          ) : undefined
        }
        footer={
          <div className="flex flex-row items-center justify-between gap-2 w-full">
            <div>
              {currentId && can(`${permission}:excluir`) && (kind === "imoveis" || kind === "proprietarios") ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={remove}
                  className="h-9 text-destructive/80 hover:text-destructive hover:bg-destructive/10 text-xs gap-1.5 hover:cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Inativar / excluir</span>
                </Button>
              ) : null}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                disabled={busy || midia.subindoImagens}
                onClick={requestClose}
                className="h-9 min-w-24 hover:cursor-pointer text-sm"
              >
                Cancelar
              </Button>

              {(tab === "geral" && editable) || (tab === "publicacao" && can("imoveis:publicar")) ? (
                <Button
                  type="submit"
                  form={formId}
                  disabled={busy || Boolean(currentId && remote.loading)}
                  className="h-9 min-w-24 text-sm hover:cursor-pointer"
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : !currentId && kind === "reservas" ? (
                    "Confirmar reserva"
                  ) : tab === "publicacao" ? (
                    "Salvar publicação"
                  ) : (
                    "Salvar"
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <RemoteState
          loading={Boolean(currentId && remote.loading)}
          error={remote.error}
          retry={remote.reload}
        >
          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex-1 min-h-0 w-full min-w-0 overflow-hidden pb-0 flex flex-col"
          >
            <div className="sticky top-0 z-10 mt-4 w-full min-w-0 shrink-0">
              <div className="flex w-full max-w-full touch-pan-x overflow-x-auto overscroll-x-contain px-4 pb-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* As abas crescem até ocupar toda a largura; se não couberem (celular), rolam na horizontal. */}
                <TabsList className="flex h-auto w-max min-w-full shrink-0 justify-start gap-1 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  {tabs.map((entry) => {
                    const Icon = tabIcons[entry.key] || FileText;
                    return (
                      <TabsTrigger
                        key={entry.key}
                        value={entry.key}
                        className="group h-11 flex-auto justify-center rounded-xl border border-transparent px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-[background-color,color,box-shadow] hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                          {entry.label}
                        </span>
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden">
              <TabsContent
                value="geral"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  <form id={formId} className="space-y-6" onSubmit={save}>
                    <GeneralFields
                      kind={kind}
                      value={value}
                      editing={Boolean(currentId)}
                      onChange={update}
                      disabled={
                        !editable ||
                        busy ||
                        Boolean(currentId && kind === "reservas" && value.status !== "CONFIRMADA")
                      }
                    />

                    {kind === "reservas" && reservationChanged && editable ? (
                      <ReservationQuote
                        key={`${value.imovel_id}-${value.inicio}-${value.fim}-${value.hospedes}`}
                        value={value}
                        onQuote={setQuote}
                      />
                    ) : null}

                    {currentId && kind === "reservas" ? (
                      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-300">
                        <Info className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400 mt-0.5" />
                        <p className="text-xs leading-relaxed">
                          Os dados desta reserva confirmada preservam a cotação original. Para registrar
                          a entrada/saída ou cancelamento com histórico, utilize as ações de check-in,
                          check-out ou cancelamento no topo.
                        </p>
                      </div>
                    ) : null}

                    {error ? (
                      <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : null}
                  </form>
                </div>
              </TabsContent>

              <TabsContent
                value="publicacao"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "publicacao" ? (
                    <form id={formId} onSubmit={save}>
                      <PublicationPanel
                        value={value}
                        onChange={update}
                        disabled={!can("imoveis:publicar") || busy}
                      />
                      {error ? (
                        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive mt-4">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          <span>{error}</span>
                        </div>
                      ) : null}
                    </form>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="arquivos"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "arquivos" && currentId ? (
                    <FilesPanel kind={kind} id={currentId} editable={editable} />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="midia"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "midia" && kind === "imoveis" ? (
                    <MidiaPanel midia={midia} editable={editable} isNew={!currentId} />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="anexos"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "anexos" && currentId && kind === "imoveis" ? (
                    <AnexosPanel imovelId={currentId} editable={editable} />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="disponibilidade"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "disponibilidade" && currentId ? (
                    <AvailabilityPanel item={value} editable={editable} />
                  ) : null}
                </div>
              </TabsContent>

              {(["imoveis", "reservas", "locacoes-imobiliarias", "vendas-imobiliarias"] as const).map(
                (relation) => (
                  <TabsContent
                    value={relation}
                    key={relation}
                    className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
                  >
                    <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                      {tab === relation && currentId ? (
                        <RelationshipPanel kind={kind} item={value} relation={relation} />
                      ) : null}
                    </div>
                  </TabsContent>
                )
              )}

              <TabsContent
                value="financeiro"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "financeiro" && currentId && financial ? (
                    <FinancePanel
                      context={{ [financeKey]: currentId }}
                      permission={`${permission}:financeiro`}
                    />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="acesso"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "acesso" && currentId && can("proprietarios:acesso_portal") ? (
                    <PortalAccessPanel item={value} onSaved={saved} />
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent
                value="visitas"
                className="h-full min-h-0 overflow-hidden p-0 m-0 focus-visible:outline-none"
              >
                <div className="h-full min-h-0 overflow-auto bg-muted-foreground/5 px-4 py-4 space-y-6 sm:px-6">
                  {tab === "visitas" && currentId && kind === "imoveis" ? (
                    <CommercialPanel imovelId={currentId} />
                  ) : null}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </RemoteState>
      </EntityShell>

      {action && currentId ? (
        <OperationAction
          kind={kind}
          item={value}
          action={action}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            saved();
          }}
        />
      ) : null}

      {operation && currentId ? (
        <EntityDialog
          key={operation}
          kind={operation}
          initial={{ imovel_id: currentId, imovel: value }}
          open
          onOpenChange={(open) => {
            if (!open) setOperation(null);
          }}
          onSaved={saved}
        />
      ) : null}
    </>
  );
}

const quickActionTones = {
  sky: "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500 hover:text-white hover:border-sky-500 dark:text-sky-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 hover:bg-amber-500 hover:text-white hover:border-amber-500 dark:text-amber-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500 hover:text-white hover:border-emerald-500 dark:text-emerald-400",
} as const;

/** Atalho do topo do diálogo: só ícone, com o nome na dica e no leitor de tela. */
function QuickAction({
  label,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  icon: any;
  tone: keyof typeof quickActionTones;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:translate-y-0 touch-manipulation ${quickActionTones[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function OperationButtons({
  kind,
  item,
  onAction,
}: {
  kind: ModuleKind;
  item: Entity;
  onAction: (action: string) => void;
}) {
  const { can } = useModulePermission();
  const status = rowStatus(item);
  const choices: {
    action: string;
    label: string;
    permission: string;
    show: boolean;
    icon?: any;
  }[] = [];

  if (kind === "reservas") {
    choices.push(
      {
        action: "CHECKIN",
        label: "Check-in",
        permission: "reservas:checkin_checkout",
        show: status === "CONFIRMADA",
        icon: CheckCircle2,
      },
      {
        action: "CHECKOUT",
        label: "Check-out",
        permission: "reservas:checkin_checkout",
        show: status === "EM_ANDAMENTO",
        icon: LogOut,
      },
      {
        action: "CANCELAR",
        label: "Cancelar reserva",
        permission: "reservas:cancelar",
        show: ["CONFIRMADA", "EM_ANDAMENTO"].includes(status),
        icon: XCircle,
      }
    );
  }

  if (kind === "locacoes-imobiliarias") {
    choices.push(
      {
        action: "ATIVAR",
        label: "Ativar contrato",
        permission: "locacoes_imobiliarias:confirmar",
        show: status === "RASCUNHO",
        icon: CheckCircle2,
      },
      {
        action: "GERAR_COBRANCAS",
        label: "Gerar cobranças",
        permission: "locacoes_imobiliarias:financeiro",
        show: status === "ATIVA",
        icon: Receipt,
      },
      {
        action: "REAJUSTAR",
        label: "Reajustar",
        permission: "locacoes_imobiliarias:editar",
        show: status === "ATIVA",
        icon: Percent,
      },
      {
        action: "ENCERRAR",
        label: "Encerrar contrato",
        permission: "locacoes_imobiliarias:cancelar",
        show: status === "ATIVA",
        icon: XCircle,
      }
    );
  }

  if (kind === "vendas-imobiliarias") {
    choices.push(
      {
        action: "CONCLUIR",
        label: "Concluir venda",
        permission: "vendas_imobiliarias:concluir",
        show: status === "RASCUNHO",
        icon: CheckCircle2,
      },
      {
        action: "CANCELAR",
        label: "Cancelar venda",
        permission: "vendas_imobiliarias:cancelar",
        show: status === "RASCUNHO",
        icon: XCircle,
      }
    );
  }

  return (
    <>
      {choices
        .filter((choice) => choice.show && can(choice.permission))
        .map((choice) => {
          const Icon = choice.icon;
          const isDestructive = choice.action === "CANCELAR" || choice.action === "ENCERRAR";
          const isPrimary =
            choice.action === "CONCLUIR" || choice.action === "CHECKIN" || choice.action === "ATIVAR";
          return (
            <Button
              key={choice.action}
              variant={isPrimary ? "default" : isDestructive ? "outline" : "secondary"}
              size="sm"
              className={`h-8 text-xs gap-1.5 hover:cursor-pointer ${
                isDestructive
                  ? "text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                  : ""
              }`}
              onClick={() => onAction(choice.action)}
            >
              {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
              <span>{choice.label}</span>
            </Button>
          );
        })}
    </>
  );
}
