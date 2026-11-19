"use client";

import { PageLoading } from "@/components/page-loading";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Building2, CalendarDays, FileText, Loader2, Palette, RefreshCw, Save, Settings, ShieldCheck, Tags, ShoppingCart, Package, Sparkles } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ResponsavelLimpezaSelect } from "@/components/imobiliario/responsavel-limpeza-select";

type GeneralSettings = {
  impressao_cor_primaria: string;
  impressao_cor_secundaria: string;
  impressao_cor_texto: string;
  habilitar_edicao_transacoes: boolean;
  alerta_estoque_pdv: boolean;
  reserva_min_noites?: number;
  limpeza_sempre_solicitar?: boolean;
  limpeza_responsavel_padrao_id?: string | null;
};
type Company = { nome: string; cnpj: string };
const DEFAULT_SETTINGS: GeneralSettings = {
  impressao_cor_primaria: "#2563eb",
  impressao_cor_secundaria: "#0891b2",
  impressao_cor_texto: "#ffffff",
  habilitar_edicao_transacoes: false,
  alerta_estoque_pdv: false,
};
const COLOR_FIELDS = [
  { key: "impressao_cor_primaria", label: "Cor primária" },
  { key: "impressao_cor_secundaria", label: "Cor secundária" },
  { key: "impressao_cor_texto", label: "Cor do texto" },
] as const;
const SHORTCUTS = [
  { href: "/configuracoes/tipos", title: "Cadastros imobiliários", description: "Tipos de imóveis, comodidades e categorias da operação.", icon: Tags },
  { href: "/configuracoes/documentos", title: "Modelos de documentos", description: "Prepare os documentos utilizados na gestão dos imóveis.", icon: FileText },
  { href: "/imoveis", title: "Calendários e canais", description: "Abra um imóvel para configurar seus canais e a disponibilidade.", icon: CalendarDays },
  { href: "/configuracoes/perfis", title: "Perfis e permissões", description: "Defina o acesso da equipe aos módulos do ERP.", icon: ShieldCheck },
];

function validColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// O formulário envia apenas as preferências deste segmento.
function readSettings(config: Partial<GeneralSettings>): GeneralSettings {
  return {
    impressao_cor_primaria: config.impressao_cor_primaria ?? DEFAULT_SETTINGS.impressao_cor_primaria,
    impressao_cor_secundaria: config.impressao_cor_secundaria ?? DEFAULT_SETTINGS.impressao_cor_secundaria,
    impressao_cor_texto: config.impressao_cor_texto ?? DEFAULT_SETTINGS.impressao_cor_texto,
    habilitar_edicao_transacoes: config.habilitar_edicao_transacoes === true,
    alerta_estoque_pdv: config.alerta_estoque_pdv === true,
    ...(config.reserva_min_noites !== undefined ? { reserva_min_noites: config.reserva_min_noites } : {}),
    ...(config.limpeza_sempre_solicitar !== undefined ? { limpeza_sempre_solicitar: config.limpeza_sempre_solicitar } : {}),
    ...(config.limpeza_responsavel_padrao_id !== undefined ? { limpeza_responsavel_padrao_id: config.limpeza_responsavel_padrao_id } : {}),
  };
}

function ReservasTemporadaCard({
  minNoites,
  onChange,
  limpezaSempreSolicitar,
  limpezaResponsavelId,
  onLimpezaSempreSolicitarChange,
  onLimpezaResponsavelChange,
}: {
  /** Ausente enquanto a coluna não existe no banco. */
  minNoites: number | undefined;
  onChange: (value: number) => void;
  /** Ausente enquanto a migration da limpeza (20261118120000) não foi aplicada. */
  limpezaSempreSolicitar: boolean | undefined;
  limpezaResponsavelId: string | null | undefined;
  onLimpezaSempreSolicitarChange: (value: boolean) => void;
  onLimpezaResponsavelChange: (value: string | null) => void;
}) {
  const stepClass =
    "grid h-full w-10 place-items-center text-lg text-muted-foreground transition-colors hover:cursor-pointer hover:bg-muted disabled:cursor-default disabled:opacity-40";
  return (
    <Card className="min-w-0 border-primary/10 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <CardTitle>Reservas de temporada</CardTitle>
        </div>
        <CardDescription>
          Regras que valem para todas as reservas de diárias, no site e no ERP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <Label id="reserva-min-noites-label">Mínimo de noites por reserva</Label>
            <span className="block text-xs text-muted-foreground">
              O site não aceita estadias mais curtas. No ERP, uma reserva abaixo do
              mínimo pede confirmação ao salvar. Imóveis e tarifas podem exigir mais
              noites: vale sempre o maior mínimo.
            </span>
          </div>
          {minNoites === undefined ? (
            <span className="text-xs text-muted-foreground sm:max-w-56 sm:text-right">
              Disponível depois de aplicar a migration do mínimo de noites no banco.
            </span>
          ) : (
            <div
              role="group"
              aria-labelledby="reserva-min-noites-label"
              className="flex h-10 shrink-0 items-center self-start overflow-hidden rounded-xl border border-input bg-background sm:self-auto"
            >
              <button
                type="button"
                aria-label="Menos uma noite"
                disabled={minNoites <= 1}
                onClick={() => onChange(Math.max(1, minNoites - 1))}
                className={stepClass}
              >
                −
              </button>
              <span className="min-w-20 px-2 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                {minNoites} {minNoites === 1 ? "noite" : "noites"}
              </span>
              <button
                type="button"
                aria-label="Mais uma noite"
                disabled={minNoites >= 365}
                onClick={() => onChange(Math.min(365, minNoites + 1))}
                className={stepClass}
              >
                +
              </button>
            </div>
          )}
        </div>

        {limpezaSempreSolicitar === undefined ? null : (
          <>
            <Separator className="my-6" />
            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">Limpeza no check-out</p>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="limpeza-sempre-solicitar">Sempre solicitar limpeza</Label>
                  <span className="block text-xs text-muted-foreground">
                    No check-out, a opção &quot;Solicitar limpeza&quot; já vem marcada. Desligado, ela vem
                    desmarcada. Em qualquer caso, quem registra o check-out pode mudar.
                  </span>
                </div>
                <Switch
                  id="limpeza-sempre-solicitar"
                  checked={limpezaSempreSolicitar}
                  onCheckedChange={onLimpezaSempreSolicitarChange}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label>Responsável padrão pela limpeza</Label>
                  <span className="block text-xs text-muted-foreground">
                    Já vem selecionado no check-out; dá para escolher outro ou deixar sem responsável.
                    Cada responsável vê as limpezas dele na Execução.
                  </span>
                </div>
                <div className="w-full sm:w-72">
                  <ResponsavelLimpezaSelect
                    value={limpezaResponsavelId}
                    onValueChange={onLimpezaResponsavelChange}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ConfigGeralPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_SETTINGS);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const [response, companyResponse] = await Promise.all([
          fetch("/api/config", { cache: "no-store", signal: controller.signal }),
          fetch("/api/config/empresa", { cache: "no-store", signal: controller.signal }).catch(() => null),
        ]);
        const data = await response.json();
        if (!response.ok || !data.config) throw new Error(data.error || "Não foi possível carregar as configurações.");
        const companyData = companyResponse?.ok ? await companyResponse.json() : null;
        if (controller.signal.aborted) return;
        setSettings(readSettings(data.config));
        const empresa = companyData?.empresa;
        setCompany(empresa ? { nome: empresa.nomefantasia || empresa.razaosocial || "Empresa", cnpj: empresa.cnpj || "" } : null);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Não foi possível carregar as configurações.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

  const save = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading || loadError) return;
    if (COLOR_FIELDS.some(({ key }) => !validColor(settings[key]))) {
      toast.error("Informe cores válidas no formato #000000.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(readSettings(settings)),
      });
      const data = await response.json();
      if (!response.ok || !data.config) throw new Error(data.error || "Não foi possível salvar as configurações.");
      setSettings(readSettings(data.config));
      window.dispatchEvent(new CustomEvent("erpimoveis:config-updated", { detail: data.config }));
      toast.success("Configurações atualizadas com sucesso!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }, [settings, saving, loading, loadError]);

  const disabled = loading || saving || Boolean(loadError);
  if (loading) return <PageLoading />;

  return (
    <div className="container mx-auto min-w-0 max-w-7xl space-y-5 px-3 py-1 sm:space-y-6 sm:px-6 lg:px-8">
      <header className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card px-4 py-4 shadow-sm sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Settings className="size-6 shrink-0 text-primary sm:size-8" aria-hidden="true" />Configurações Gerais
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Preferências da gestão imobiliária, documentos e alertas do PDV.</p>
        </div>
        <Button type="submit" form="general-settings" disabled={disabled} className="w-full shrink-0 shadow-md transition-all hover:shadow-lg sm:w-auto">
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          {saving ? "Salvando…" : "Salvar Alterações"}
        </Button>
      </header>

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>{loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setReload(value => value + 1)}><RefreshCw className="size-4" />Tentar novamente</Button>
        </div>
      ) : null}

      <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm">
        <CardHeader className="bg-primary/5 py-4">
          <CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" aria-hidden="true" />Empresa</CardTitle>
          <CardDescription>Identificação da empresa responsável pela administração dos imóveis.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="break-words font-semibold">{company?.nome || "Consulte os dados da empresa"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{company?.cnpj ? `CNPJ ${company.cnpj}` : "Mantenha os dados cadastrais e de contato atualizados."}</p>
          </div>
          <Button asChild variant="outline" className="w-full shrink-0 sm:w-auto"><Link href="/configuracoes/empresa">Dados da empresa<ArrowUpRight className="size-4" /></Link></Button>
        </CardContent>
      </Card>

      <form id="general-settings" onSubmit={save}>
        <fieldset disabled={disabled} className="min-w-0 space-y-5 sm:space-y-6">
          <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm">
            <CardHeader className="bg-primary/5 py-4">
              <CardTitle className="flex items-center gap-2"><Palette className="size-5 text-primary" aria-hidden="true" />Impressão</CardTitle>
              <CardDescription>Personalize as cores dos cabeçalhos nos modelos de impressão.</CardDescription>
            </CardHeader>
            <CardContent className="grid min-w-0 gap-4 py-6 md:grid-cols-3">
              <div className="contents">
                {COLOR_FIELDS.map(({ key, label }) => (
                  <div key={key} className="space-y-2">
                    <Label htmlFor={key}>{label}</Label>
                    <div className="flex gap-2">
                      <Input type="color" aria-label={`Selecionar ${label.toLowerCase()}`} className="h-10 w-14 shrink-0 p-1" value={validColor(settings[key]) ? settings[key] : DEFAULT_SETTINGS[key]} onChange={event => setSettings(current => ({ ...current, [key]: event.target.value }))} />
                      <Input id={key} value={settings[key]} maxLength={7} pattern="#[0-9a-fA-F]{6}" required title="Informe uma cor no formato #000000" className="min-w-0 font-mono" onChange={event => setSettings(current => ({ ...current, [key]: event.target.value }))} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="min-w-0 space-y-2 md:col-span-3">
                <p className="text-sm font-medium">Prévia do cabeçalho</p>
                <div className="overflow-hidden rounded-xl border bg-background">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 p-5" style={{ background: `linear-gradient(135deg, ${validColor(settings.impressao_cor_primaria) ? settings.impressao_cor_primaria : DEFAULT_SETTINGS.impressao_cor_primaria}, ${validColor(settings.impressao_cor_secundaria) ? settings.impressao_cor_secundaria : DEFAULT_SETTINGS.impressao_cor_secundaria})`, color: validColor(settings.impressao_cor_texto) ? settings.impressao_cor_texto : DEFAULT_SETTINGS.impressao_cor_texto }}>
                    <div className="min-w-0 flex-1"><p className="break-words font-semibold">{company?.nome || "Sua imobiliária"}</p><p className="mt-1 text-xs">Gestão de imóveis</p></div>
                    <FileText className="size-6 shrink-0" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <ReservasTemporadaCard
            minNoites={settings.reserva_min_noites}
            onChange={value => setSettings(current => ({ ...current, reserva_min_noites: value }))}
            limpezaSempreSolicitar={settings.limpeza_sempre_solicitar}
            limpezaResponsavelId={settings.limpeza_responsavel_padrao_id}
            onLimpezaSempreSolicitarChange={value => setSettings(current => ({ ...current, limpeza_sempre_solicitar: value }))}
            onLimpezaResponsavelChange={value => setSettings(current => ({ ...current, limpeza_responsavel_padrao_id: value }))}
          />

          <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm">
            <CardHeader className="bg-primary/5 py-4">
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="size-5 text-primary" aria-hidden="true" />Operações de Venda &amp; PDV</CardTitle>
              <CardDescription>Alertas e comportamentos do fluxo de caixa e ponto de venda.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 py-6">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2"><Label htmlFor="pdv-stock-alert">Alerta de Estoque PDV</Label><Package className="size-3 text-muted-foreground" aria-hidden="true" /></div>
                  <p id="pdv-stock-description" className="text-xs text-muted-foreground">Exibe alerta em produtos sem estoque no módulo PDV.</p>
                </div>
                <Switch id="pdv-stock-alert" aria-describedby="pdv-stock-description" className="shrink-0" checked={settings.alerta_estoque_pdv} onCheckedChange={value => setSettings(current => ({ ...current, alerta_estoque_pdv: value }))} />
              </div>
              <div className="flex items-center justify-between gap-4 border-t pt-6">
                <div className="min-w-0 space-y-1"><Label htmlFor="edit-transactions">Habilitar edição de transações</Label><p id="edit-transactions-description" className="text-xs text-muted-foreground">Permite alterar transações já cadastradas, respeitando as permissões da equipe.</p></div>
                <Switch id="edit-transactions" aria-describedby="edit-transactions-description" className="shrink-0" checked={settings.habilitar_edicao_transacoes} onCheckedChange={value => setSettings(current => ({ ...current, habilitar_edicao_transacoes: value }))} />
              </div>
            </CardContent>
          </Card>
        </fieldset>
      </form>

      <section aria-labelledby="related-settings" className="space-y-3">
        <div><h2 id="related-settings" className="text-base font-semibold">Configurações da operação</h2><p className="mt-1 text-sm text-muted-foreground">Acesse os cadastros e controles utilizados na administração dos imóveis.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SHORTCUTS.map(({ href, title, description, icon: Icon }) => (
            <Link key={href} href={href} className="group flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
