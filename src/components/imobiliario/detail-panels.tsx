"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import ValueInput from "@/components/ui/value-input";
import {
  EntityShell,
  Field,
  RemoteState,
  SelectField,
  StatusBadge,
  requestJson,
  useModulePermission,
  useRemote,
} from "./shared";
import {
  type Entity,
  type ModuleKind,
  clientName,
  dateLabel,
  endpoint,
  entityName,
  listFrom,
  money,
  propertyName,
  rowStatus,
  titleCase,
} from "./model";
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarX,
  Coins,
  ExternalLink,
  FileText,
  FolderArchive,
  Globe,
  Image as ImageIcon,
  Key,
  Lock,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  UserX,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

const EntityDialog = dynamic(() => import("./entity-dialog"), {
  loading: () => (
    <div className="flex items-center justify-center p-8 gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span>Carregando cadastro…</span>
    </div>
  ),
});

export function RelationshipPanel({
  kind,
  item,
  relation,
}: {
  kind: ModuleKind;
  item: Entity;
  relation: "imoveis" | "reservas" | "locacoes-imobiliarias" | "vendas-imobiliarias";
}) {
  const { can } = useModulePermission();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number | "new" | null>(null);
  const modulePermission = relation.replaceAll("-", "_");
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "10",
    [kind === "proprietarios" ? "proprietario_id" : "imovel_id"]: String(item.id),
  });
  const remote = useRemote(
    can(`${modulePermission}:visualizar`) ? `${endpoint(relation)}?${params}` : null
  );
  const list = listFrom(remote.data);
  const seed =
    kind === "proprietarios"
      ? { proprietario_id: item.id, proprietario: item }
      : { imovel_id: item.id, imovel: item };

  if (!can(`${modulePermission}:visualizar`))
    return (
      <div className="rounded-xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
        Seu perfil não tem acesso a estes registros vinculados.
      </div>
    );

  const totalPages = Math.max(1, Math.ceil(list.total / 10));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {list.total} {list.total === 1 ? "registro vinculado" : "registros vinculados"}
          </p>
          <p className="text-xs text-muted-foreground">
            Histórico associado diretamente a este {kind === "proprietarios" ? "proprietário" : "imóvel"}.
          </p>
        </div>
        {can(`${modulePermission}:criar`) ? (
          <Button
            size="sm"
            onClick={() => setSelected("new")}
            className="h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation shadow-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Novo registro</span>
          </Button>
        ) : null}
      </div>

      <RemoteState loading={remote.loading} error={remote.error} retry={remote.reload} empty={!list.items.length}>
        <div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 border-b border-border/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="p-3.5 sm:px-4">{relation === "imoveis" ? "Imóvel" : "Operação"}</th>
                  <th className="p-3.5 sm:px-4">Cliente / Período</th>
                  <th className="p-3.5 sm:px-4">Situação</th>
                  <th className="p-3.5 sm:px-4">Valor</th>
                  <th className="p-3.5 sm:px-4 text-right">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {list.items.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3.5 sm:px-4">
                      <span className="font-medium text-foreground block">
                        {relation === "imoveis" ? entityName(row) : propertyName(row)}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">#{row.id}</span>
                    </td>
                    <td className="p-3.5 sm:px-4">
                      {relation !== "imoveis" ? (
                        <>
                          <span className="font-medium text-foreground block">{clientName(row)}</span>
                          <span className="text-xs text-muted-foreground">
                            {dateLabel(row.inicio ?? row.data_venda)}
                            {row.fim ? ` — ${dateLabel(row.fim)}` : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {[row.endereco?.bairro, row.endereco?.cidade].filter(Boolean).join(" · ") || "Sem localização"}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 sm:px-4">
                      <StatusBadge status={rowStatus(row)} />
                    </td>
                    <td className="p-3.5 sm:px-4 font-medium text-foreground">
                      {money(row.valor_total ?? row.valor_mensal ?? row.diaria)}
                    </td>
                    <td className="p-3.5 sm:px-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs gap-1 hover:cursor-pointer touch-manipulation"
                        onClick={() => setSelected(Number(row.id))}
                      >
                        <span>Abrir</span>
                        <ExternalLink className="h-3 w-3 opacity-70" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </RemoteState>

      {list.total > 10 ? (
        <div className="flex items-center justify-between gap-3 text-xs sm:text-sm pt-2">
          <span className="text-muted-foreground">
            Página {page} de {totalPages} ({list.total} itens)
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 hover:cursor-pointer"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Anterior</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 hover:cursor-pointer"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              <span>Próxima</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {selected ? (
        <EntityDialog
          kind={relation}
          id={selected === "new" ? undefined : selected}
          initial={seed}
          open
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onSaved={remote.reload}
        />
      ) : null}
    </div>
  );
}

export function PublicationPanel({
  value,
  onChange,
  disabled,
}: {
  value: Entity;
  onChange: (value: Entity) => void;
  disabled?: boolean;
}) {
  const address = value.endereco_publico ?? {};

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm sm:text-base text-foreground">Catálogo do site público</h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              O site exibe apenas anúncios ativos marcados como publicados e dados da localização pública.
              Nome do proprietário, documentos e endereço interno completo permanecem protegidos no ERP.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
        <h3 className="font-semibold text-sm sm:text-base text-foreground">Identificação e status no portal</h3>
        
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Card de Ativação do Anúncio */}
          <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3.5 hover:bg-muted/20 transition-colors cursor-pointer touch-manipulation">
            <Checkbox
              disabled={disabled}
              checked={Boolean(value.publicado)}
              onCheckedChange={(checked) => onChange({ ...value, publicado: checked === true })}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground block">Publicado no catálogo do site</span>
              <span className="text-xs text-muted-foreground block">
                Quando ativado, o anúncio fica visível para reservas e buscas de clientes online.
              </span>
            </div>
          </label>

          {/* Card de Fotos Reais */}
          <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3.5 hover:bg-muted/20 transition-colors cursor-pointer touch-manipulation">
            <Checkbox
              disabled={disabled}
              checked={Boolean(value.fotos_reais)}
              onCheckedChange={(checked) => onChange({ ...value, fotos_reais: checked === true })}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground block">Fotos reais do próprio imóvel</span>
              <span className="text-xs text-muted-foreground block">
                Desmarcado, o site identifica as imagens como ambientação ilustrativa ou modelo.
              </span>
            </div>
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Slug / URL amigável do anúncio"
            hint="Apenas letras minúsculas, números e hífens. Ex: flat-luxo-enseada"
          >
            <div className="space-y-1.5">
              <Input
                value={value.slug ?? ""}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                placeholder="ex: flat-beira-mar-101"
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })
                }
                className="h-11 sm:h-10 text-base sm:text-sm font-mono"
              />
              {value.slug ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border border-border/40 truncate">
                  <Globe className="h-3 w-3 text-primary shrink-0" />
                  <span className="truncate">https://seusite.com.br/imoveis/{value.slug}</span>
                </div>
              ) : null}
            </div>
          </Field>

          <Field
            label="Selo de destaque do anúncio (opcional)"
            hint="Frase curta sobreposta à foto principal no site. Máx 60 caracteres."
          >
            <Input
              maxLength={60}
              placeholder="Ex: Vista para o mar · Frente praia"
              disabled={disabled}
              value={value.selo_anuncio ?? ""}
              onChange={(event) => onChange({ ...value, selo_anuncio: event.target.value })}
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
        <div>
          <h3 className="font-semibold text-sm sm:text-base text-foreground">Localização pública (exibida no site)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Defina apenas o bairro e cidade públicos. Evite expor o número da unidade ou rua para privacidade.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Bairro público">
            <Input
              disabled={disabled}
              placeholder="Ex: Praia das Pitangueiras"
              value={address.bairro ?? ""}
              onChange={(event) =>
                onChange({ ...value, endereco_publico: { ...address, bairro: event.target.value } })
              }
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </Field>
          <Field label="Cidade pública">
            <Input
              disabled={disabled}
              placeholder="Ex: Guarujá"
              value={address.cidade ?? ""}
              onChange={(event) =>
                onChange({ ...value, endereco_publico: { ...address, cidade: event.target.value } })
              }
              className="h-11 sm:h-10 text-base sm:text-sm"
            />
          </Field>
          <Field label="UF pública">
            <Input
              disabled={disabled}
              placeholder="Ex: SP"
              maxLength={2}
              value={address.estado ?? ""}
              onChange={(event) =>
                onChange({
                  ...value,
                  endereco_publico: { ...address, estado: event.target.value.toUpperCase() },
                })
              }
              className="h-11 sm:h-10 text-base sm:text-sm uppercase font-medium"
            />
          </Field>
        </div>

        <Field
          label="Descrição de referência da região"
          hint="Destaque pontos turísticos, comodidades ao redor e facilidades de acesso."
        >
          <Textarea
            disabled={disabled}
            placeholder="Ex: Localizado a 150m da praia, próximo a padarias, farmácias e aos melhores restaurantes da orla..."
            rows={3}
            value={address.localizacao_aproximada ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                endereco_publico: { ...address, localizacao_aproximada: event.target.value },
              })
            }
            className="text-base sm:text-sm"
          />
        </Field>
      </section>
    </div>
  );
}

export function FilesPanel({
  kind,
  id,
  editable,
}: {
  kind: ModuleKind;
  id: number;
  editable: boolean;
}) {
  const remote = useRemote(`${endpoint(kind, id)}/arquivos`);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState(kind === "imoveis" || kind === "proprietarios" ? "FOTO" : "DOCUMENTO");
  const [publicFile, setPublicFile] = useState(kind === "imoveis");
  const [error, setError] = useState("");

  const rows: Entity[] = remote.data?.items ?? [];

  const upload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const file = body.get("file");
    if (!(file instanceof File) || !file.size) return;

    body.set("tipo", type);
    body.set("publico", String(type === "FOTO" && publicFile));
    body.set("ordem", String(rows.length));
    setBusy(true);
    setError("");

    try {
      await requestJson(`${endpoint(kind, id)}/arquivos`, { method: "POST", body });
      toast.success("Arquivo anexado com sucesso!");
      form.reset();
      remote.reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: Entity) => {
    if (!window.confirm(`Excluir o arquivo “${row.nome}”?`)) return;
    setBusy(true);
    try {
      await requestJson(`${endpoint(kind, id)}/arquivos/${row.id}`, { method: "DELETE" });
      remote.reload();
      toast.success("Arquivo excluído");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {editable ? (
        <form
          onSubmit={upload}
          className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm sm:text-base text-foreground flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              Anexar foto ou documento
            </h3>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Tipo de anexo"
              value={type}
              options={
                kind === "imoveis" || kind === "proprietarios"
                  ? [
                      { value: "FOTO", label: "Foto" },
                      { value: "DOCUMENTO", label: "Documento privado" },
                    ]
                  : [{ value: "DOCUMENTO", label: "Documento privado" }]
              }
              onChange={setType}
            />

            <Field label="Arquivo">
              <Input
                name="file"
                type="file"
                required
                accept={
                  type === "FOTO"
                    ? "image/jpeg,image/png,image/webp"
                    : "application/pdf,image/jpeg,image/png,image/webp"
                }
                className="h-11 sm:h-10 text-base sm:text-sm file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-primary/10 file:text-primary"
              />
            </Field>

            <Field label="Título / Legenda descritiva">
              <Input
                name="titulo"
                placeholder="Ex: Fachada principal, Sala de estar, Escritura"
                className="h-11 sm:h-10 text-base sm:text-sm"
              />
            </Field>

            {kind === "imoveis" && type === "FOTO" ? (
              <div className="flex items-center pt-2 sm:pt-6">
                <label className="flex items-center gap-2 text-xs sm:text-sm hover:cursor-pointer touch-manipulation">
                  <Checkbox
                    checked={publicFile}
                    onCheckedChange={(checked) => setPublicFile(checked === true)}
                  />
                  <span>Foto destinada à galeria pública do anúncio</span>
                </label>
              </div>
            ) : null}
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              disabled={busy}
              className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation shrink-0"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Enviando arquivo…</span>
                </>
              ) : (
                <>
                  <Upload className="h-3.5 w-3.5" />
                  <span>Anexar arquivo</span>
                </>
              )}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <RemoteState loading={remote.loading} error={remote.error} retry={remote.reload} empty={!rows.length}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className="group overflow-hidden rounded-xl border border-border/60 bg-card shadow-xs transition-all hover:shadow-md flex flex-col justify-between"
            >
              <div>
                {row.tipo === "FOTO" && (row.url ?? row.public_url) ? (
                  <a
                    href={row.url ?? row.public_url}
                    target="_blank"
                    rel="noreferrer"
                    className="block relative overflow-hidden bg-muted aspect-[4/3]"
                  >
                    <Image
                      unoptimized
                      width={600}
                      height={450}
                      alt={row.titulo ?? row.nome ?? "Foto do imóvel"}
                      src={row.url ?? row.public_url}
                      className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute top-2 right-2">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] backdrop-blur-md ${
                          row.publico
                            ? "bg-emerald-500/80 text-white border-transparent"
                            : "bg-background/80 text-foreground"
                        }`}
                      >
                        {row.publico ? "Foto Pública" : "Privada"}
                      </Badge>
                    </div>
                  </a>
                ) : (
                  <div className="flex items-center justify-center p-8 bg-muted/40 aspect-[4/3] text-muted-foreground">
                    <FileText className="h-10 w-10 opacity-60" />
                  </div>
                )}

                <div className="p-3.5 space-y-1">
                  <p className="break-all text-sm font-medium text-foreground line-clamp-1">
                    {row.titulo ?? row.nome}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span>{titleCase(row.tipo)}</span>
                    <span>·</span>
                    <span>{row.publico ? "Público" : "Privado"}</span>
                  </p>
                </div>
              </div>

              <div className="p-3.5 pt-0 flex items-center justify-between gap-2 border-t border-border/40 mt-2">
                {row.url ?? row.public_url ? (
                  <Button asChild size="sm" variant="outline" className="h-8 text-xs gap-1 hover:cursor-pointer">
                    <a href={row.url ?? row.public_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3" />
                      <span>Abrir</span>
                    </a>
                  </Button>
                ) : (
                  <div />
                )}
                {editable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => remove(row)}
                    className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 hover:cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Excluir</span>
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </RemoteState>
    </div>
  );
}

export function PortalAccessPanel({
  item,
  onSaved,
}: {
  item: Entity;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState(item.portal_email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Entity | null>(null);

  const account = result ?? item;
  const connected = Boolean(account.user_id ?? account.portal_user_id ?? account.acesso?.user_id);

  const execute = async (acao: string) => {
    if (
      ["BLOQUEAR", "REVOGAR"].includes(acao) &&
      !window.confirm(
        acao === "REVOGAR"
          ? "Revogar o acesso deste proprietário ao portal?"
          : "Bloquear temporariamente o acesso deste proprietário?"
      )
    )
      return;

    setBusy(true);
    setError("");
    try {
      const response = await requestJson(`${endpoint("proprietarios", item.id)}/acesso`, {
        method: "POST",
        body: JSON.stringify({ acao, email }),
      });
      setResult(response.item ?? response);
      toast.success(response.inviteSent ? "Convite de acesso enviado!" : "Acesso atualizado!");
      onSaved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm sm:text-base text-foreground">Portal do Proprietário</h3>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 max-w-xl">
                Permite ao proprietário consultar relatórios, extratos e ocupação dos seus imóveis. O e-mail de acesso
                deve ser único e não pode pertencer a uma conta de hóspede comum.
              </p>
            </div>
          </div>
          <StatusBadge
            status={account.portal_status ?? account.acesso?.status ?? (connected ? "ATIVO" : "SEM_ACESSO")}
          />
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
        <Field label="E-mail de acesso ao portal do proprietário" hint="O proprietário receberá o convite com link de login">
          <Input
            type="email"
            required
            placeholder="proprietario@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-11 sm:h-10 text-base sm:text-sm max-w-md"
          />
        </Field>

        <div className="flex flex-wrap gap-2 pt-2">
          {!connected ? (
            <Button
              disabled={busy || !email.includes("@")}
              onClick={() => execute("CRIAR")}
              className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              <span>Criar acesso e enviar convite</span>
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => execute("REENVIAR")}
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              >
                <Mail className="h-3.5 w-3.5" />
                <span>Reenviar convite</span>
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => execute("BLOQUEAR")}
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Bloquear acesso</span>
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => execute("REVOGAR")}
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              >
                <UserX className="h-3.5 w-3.5" />
                <span>Revogar acesso</span>
              </Button>
            </>
          )}
        </div>
      </section>

      {error ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}

export function AvailabilityPanel({
  item,
  editable,
}: {
  item: Entity;
  editable: boolean;
}) {
  const remote = useRemote(`/api/imoveis/${item.id}/disponibilidade`);
  const rates = useRemote(`/api/imoveis/${item.id}/tarifas`);
  const [modal, setModal] = useState<"BLOQUEIO" | "TARIFA" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [value, setValue] = useState<Entity>({
    inicio: "",
    fim: "",
    motivo: "",
    diaria: "",
    minimo_noites: 1,
  });

  const rows: Entity[] = remote.data?.items ?? [];
  const tariffs: Entity[] = rates.data?.items ?? [];

  const set = (key: string, data: unknown) => setValue((current) => ({ ...current, [key]: data }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/imoveis/${item.id}/${modal === "TARIFA" ? "tarifas" : "bloqueios"}`, {
        method: "POST",
        body: JSON.stringify(value),
      });
      toast.success(modal === "TARIFA" ? "Tarifa registrada com sucesso" : "Bloqueio registrado com sucesso");
      setModal(null);
      remote.reload();
      rates.reload();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeBlock = async (row: Entity) => {
    if (!window.confirm("Remover este bloqueio e liberar o período para reservas?")) return;
    try {
      await requestJson(`/api/imoveis/${item.id}/bloqueios/${row.bloqueio_id ?? row.id}`, {
        method: "DELETE",
      });
      remote.reload();
      toast.success("Bloqueio removido com sucesso");
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm sm:text-base text-foreground">Disponibilidade e Tarifário</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gerencie bloqueios de manutenção, datas indisponíveis e regras de diárias por período.
          </p>
        </div>
        {editable ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              onClick={() => {
                setError("");
                setModal("TARIFA");
              }}
            >
              <Coins className="h-3.5 w-3.5 text-primary" />
              <span>Nova tarifa</span>
            </Button>
            <Button
              size="sm"
              className="h-9 text-xs gap-1.5 hover:cursor-pointer touch-manipulation"
              onClick={() => {
                setError("");
                setModal("BLOQUEIO");
              }}
            >
              <CalendarX className="h-3.5 w-3.5" />
              <span>Bloquear período</span>
            </Button>
          </div>
        ) : null}
      </div>

      <section className="space-y-3">
        <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-primary" />
          Calendário de ocupação e bloqueios
        </h4>
        <RemoteState loading={remote.loading} error={remote.error} retry={remote.reload} empty={!rows.length}>
          <div className="space-y-2">
            {rows.map((row, index) => {
              const type = String(row.tipo ?? row.origem ?? row.tipo_origem ?? "");
              const block = Boolean(row.bloqueio_id || type.includes("BLOQUEIO") || type.includes("MANUTENCAO"));
              return (
                <div
                  key={row.id ?? index}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 shadow-xs"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {titleCase(type)} {row.motivo ? `· ${row.motivo}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dateLabel(row.inicio)} a {dateLabel(row.fim)}
                      {row.reserva_id
                        ? ` · Reserva #${row.reserva_id}`
                        : row.locacao_id
                        ? ` · Locação #${row.locacao_id}`
                        : ""}
                    </p>
                  </div>
                  {editable && block ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 hover:cursor-pointer"
                      onClick={() => removeBlock(row)}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Remover bloqueio</span>
                    </Button>
                  ) : (
                    <StatusBadge status={row.status ?? "OCUPADO"} />
                  )}
                </div>
              );
            })}
          </div>
        </RemoteState>
      </section>

      <section className="space-y-3">
        <h4 className="font-semibold text-xs sm:text-sm text-foreground flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          Tarifas sazonais por período
        </h4>
        <RemoteState loading={rates.loading} error={rates.error} retry={rates.reload} empty={!tariffs.length}>
          <div className="space-y-2">
            {tariffs.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4 text-sm shadow-xs"
              >
                <div>
                  <span className="font-medium text-foreground block">
                    {dateLabel(row.inicio)} a {dateLabel(row.fim)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Mínimo de {row.minimo_noites ?? 1} noite(s)
                  </span>
                </div>
                <strong className="text-base font-bold text-primary">
                  {money(row.diaria ?? row.valor_diaria)} <span className="text-xs font-normal text-muted-foreground">/ noite</span>
                </strong>
              </div>
            ))}
          </div>
        </RemoteState>
      </section>

      {modal ? (
        <EntityShell
          open
          onOpenChange={(open) => {
            if (!open && !busy) setModal(null);
          }}
          title={modal === "TARIFA" ? "Nova tarifa por período" : "Bloquear período do imóvel"}
          description={
            modal === "TARIFA"
              ? "A cotação aplicará automaticamente o valor da diária para reservas dentro deste período."
              : "O período selecionado ficará indisponível para novas reservas e locações no calendário."
          }
          className="w-[95vw] max-w-xl max-h-[85vh]"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setModal(null)}
                disabled={busy}
                className="h-10 sm:h-9 text-xs hover:cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                form="availability-form"
                type="submit"
                size="sm"
                disabled={busy}
                className="h-10 sm:h-9 text-xs gap-1.5 hover:cursor-pointer"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Salvando…</span>
                  </>
                ) : (
                  <span>Salvar configuração</span>
                )}
              </Button>
            </div>
          }
        >
          <form id="availability-form" className="space-y-4" onSubmit={save}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data de início">
                <Input
                  type="date"
                  required
                  value={value.inicio}
                  onChange={(event) => set("inicio", event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm"
                />
              </Field>
              <Field label="Data de fim (exclusivo)">
                <Input
                  type="date"
                  required
                  min={value.inicio || undefined}
                  value={value.fim}
                  onChange={(event) => set("fim", event.target.value)}
                  className="h-11 sm:h-10 text-base sm:text-sm"
                />
              </Field>
              {modal === "TARIFA" ? (
                <>
                  <Field label="Diária padrão do período">
                    <ValueInput
                      required
                      placeholder="R$ 0,00"
                      value={value.diaria != null && value.diaria !== "" ? Number(value.diaria) : null}
                      onValueChange={(val) => set("diaria", val)}
                      onEmpty={() => set("diaria", 0)}
                      className="h-11 sm:h-10 text-base sm:text-sm"
                    />
                  </Field>
                  <Field label="Mínimo de noites">
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={value.minimo_noites}
                      onChange={(event) => set("minimo_noites", Number(event.target.value))}
                      className="h-11 sm:h-10 text-base sm:text-sm"
                    />
                  </Field>
                </>
              ) : null}
            </div>
            <Field label={modal === "TARIFA" ? "Descrição da tarifa" : "Motivo do bloqueio"}>
              <Textarea
                required
                placeholder={
                  modal === "TARIFA"
                    ? "Ex: Alta temporada de réveillon, Carnaval..."
                    : "Ex: Reforma na pintura, Uso do proprietário..."
                }
                value={value.motivo}
                onChange={(event) => set("motivo", event.target.value)}
                className="text-base sm:text-sm"
                rows={3}
              />
            </Field>
            {error ? (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs sm:text-sm text-destructive"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </form>
        </EntityShell>
      ) : null}
    </div>
  );
}
