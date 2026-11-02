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
import {
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
  CalendarDays,
  ExternalLink,
  FileText,
  FolderArchive,
  Globe,
  Image as ImageIcon,
  Key,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

import { AnuncioPreview } from "./anuncio-preview";

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
  gallery = [],
}: {
  value: Entity;
  onChange: (value: Entity) => void;
  disabled?: boolean;
  /** Fotos já enviadas, na ordem do site (a primeira é a capa). */
  gallery?: string[];
}) {
  const address = value.endereco_publico ?? {};
  // Bairro, cidade e UF do site são os do endereço da aba Geral (o banco copia ao salvar).
  const internal = value.endereco ?? {};
  const location = [internal.bairro, [internal.cidade, internal.estado].filter(Boolean).join("/")]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");

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
              O site exibe apenas anúncios ativos marcados como publicados, com bairro, cidade e UF do endereço.
              Nome do proprietário, documentos, rua e número permanecem protegidos no ERP.
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

          {/* Fotos são reais por padrão; marcar aqui grava fotos_reais = false. */}
          <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/50 p-3.5 hover:bg-muted/20 transition-colors cursor-pointer touch-manipulation">
            <Checkbox
              disabled={disabled}
              checked={value.fotos_reais === false}
              onCheckedChange={(checked) => onChange({ ...value, fotos_reais: checked !== true })}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <span className="text-sm font-medium text-foreground block">Marcar como fotos ilustrativas</span>
              <span className="text-xs text-muted-foreground block">
                Marcado, o site identifica as imagens como ambientação ilustrativa ou modelo, e não como fotos do
                próprio imóvel.
              </span>
            </div>
          </label>
        </div>

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
            className="h-11 sm:h-10 text-base sm:text-sm sm:max-w-md"
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
        <div>
          <h3 className="font-semibold text-sm sm:text-base text-foreground">Detalhes da localização</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aparece na página do imóvel no site, junto com o bairro, a cidade e a UF do endereço.
          </p>
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
          {location ? (
            <span>
              No site: <span className="font-medium text-foreground">{location}</span>
            </span>
          ) : (
            <span>Preencha bairro, cidade e UF no endereço da aba Geral.</span>
          )}
        </div>

        <Field label="Detalhes da região" hint="Distâncias, pontos de referência e facilidades por perto. Não informe rua nem número.">
          <Textarea
            disabled={disabled}
            placeholder="Ex: Localizado a 150m da praia, próximo a padarias, farmácias e aos melhores restaurantes da orla..."
            rows={3}
            maxLength={1000}
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

      <section className="space-y-4 rounded-xl border border-border/60 bg-card p-4 sm:p-5 shadow-xs">
        <div>
          <h3 className="font-semibold text-sm sm:text-base text-foreground">Prévia do anúncio no site</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            O card do catálogo e a página do imóvel, com os dados desta tela, inclusive os ainda não salvos. As
            fotos são as já enviadas na aba Mídia, na mesma ordem.
          </p>
        </div>
        <AnuncioPreview value={value} gallery={gallery} />
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

// O painel de acesso cresceu (convite, senha, e-mail, bloqueio) e mora no próprio arquivo.
export { PortalAccessPanel } from "./portal-access-panel";

// Calendário, bloqueios, tarifas e simulador moram no próprio arquivo.
export { AvailabilityPanel } from "./availability-panel";
