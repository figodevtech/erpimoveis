"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { toast } from "@/lib/toast";
import {
  Settings,
  Receipt,
  ShoppingCart,
  ClipboardCheck,
  Loader2,
  Save,
  AlertCircle,
  FileText,
  Package,
  Search,
  CalendarDays,
  Palette,
  Boxes,
  Building2,
  Store,
  ShoppingBag,
  KeyRound,
  Unplug,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Config } from "../../type";
import { identificarModeloEmissao } from "@/lib/services/fiscais/nfse-service";
import type { CodigosFiscaisForm, ModeloEmissao } from "../../ordens/components/dialogs/emissao-nota-dialog/emissao-nfse-dialog/types";

type UsoConsultasPlaca = {
  limite: number;
  usadas: number;
  mes: string;
};

type EmpresaResumo = {
  id: number;
  nome: string;
  cnpj: string;
};

type MercadoLivreAccount = {
  id: number;
  userId: number;
  nickname: string | null;
  siteId: string;
  needsReconnect: boolean;
  updatedAt: string | null;
  shipping?: {
    modes: string[];
    option: string | null;
    mercadoEnviosEnabled: boolean;
    error: string | null;
  } | null;
};

type ShopeeAccount = {
  id: number;
  shopId: number;
  shopName: string | null;
  region: string;
  needsReconnect: boolean;
  updatedAt: string | null;
};

type ShopeeIntegration = {
  configured: boolean;
  missing: string[];
  account: ShopeeAccount | null;
};

function MarketplaceConnectionCard({
  icon,
  iconClass,
  name,
  connected,
  title,
  description,
  details,
  connectHref,
  connectLabel,
  connectDisabled,
  onDisconnect,
  disconnecting,
  disconnectTitle,
  disconnectDescription,
}: {
  icon: React.ReactNode;
  iconClass: string;
  name: string;
  connected: boolean;
  title: string;
  description: string;
  details?: string | null;
  connectHref: string;
  connectLabel: string;
  connectDisabled?: boolean;
  onDisconnect?: () => void;
  disconnecting?: boolean;
  disconnectTitle: string;
  disconnectDescription: string;
}) {
  return (
    <section className="flex min-h-44 flex-col justify-between gap-5 border-b p-5 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{name}</p>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
              {connected ? "Conectada" : "Desconectada"}
            </span>
          </div>
          <p className="mt-1 truncate text-base font-semibold">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          {details ? <p className="mt-2 flex items-center gap-1.5 text-xs text-foreground/70"><KeyRound className="h-3 w-3" />{details}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {connectDisabled ? (
          <Button size="sm" disabled>{connectLabel}</Button>
        ) : (
          <Button asChild size="sm" variant={connected ? "outline" : "default"}><a href={connectHref}>{connectLabel}</a></Button>
        )}
        {onDisconnect ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Unplug className="h-4 w-4" />Desconectar</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>{disconnectTitle}</AlertDialogTitle><AlertDialogDescription>{disconnectDescription}</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onDisconnect} disabled={disconnecting}>
                  {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Desconectar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </section>
  );
}

const DIAS_SEMANA = [
  { value: 0, label: "Dom" },
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
];

function colorPickerValue(value: string | undefined, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value! : fallback;
}

function getModeloFiscalLabel(modelo: ModeloEmissao) {
  if (modelo === "NACIONAL") return "NFS-e Nacional (MEI)";
  if (modelo === "MUNICIPAL_CABEDELO") return "NFS-e Cabedelo";
  return "NFS-e João Pessoa";
}

export default function ConfigGeralPage() {
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [desconectandoMercadoLivre, setDesconectandoMercadoLivre] = useState(false);
  const [desconectandoShopee, setDesconectandoShopee] = useState(false);
  const [usoConsultasPlaca, setUsoConsultasPlaca] = useState<UsoConsultasPlaca | null>(null);
  const [empresaResumo, setEmpresaResumo] = useState<EmpresaResumo | null>(null);
  const [mercadoLivreAccount, setMercadoLivreAccount] = useState<MercadoLivreAccount | null>(null);
  const [shopeeIntegration, setShopeeIntegration] = useState<ShopeeIntegration>({ configured: false, missing: [], account: null });
  const [empresaFiscal, setEmpresaFiscal] = useState({ codigomunicipio: "", regimetributario: "" });
  const [nfseConfig, setNfseConfig] = useState<Record<string, unknown> | null>(null);
  const [padraoFiscalForm, setPadraoFiscalForm] = useState<Partial<CodigosFiscaisForm>>({});
  const [salvandoPadraoFiscal, setSalvandoPadraoFiscal] = useState(false);

  const { handleSubmit, setValue, watch, reset } = useForm<Partial<Config>>({
    defaultValues: {
      checklist_obrigatorio: false,
      alerta_estoque_pdv: false,
      habilitar_emissao_nfe: false,
      emissao_nf_no_modulo_ordens: false,
      emissao_nf_no_modulo_vendas: false,
      emissao_nf_ordens_nao_pagas: false,
      emissao_nf_vendas_nao_pagas: false,
      agendamento_intervalo_minutos: 60,
      agendamento_hora_inicio: "08:00",
      agendamento_hora_fim: "18:00",
      agendamento_dias_trabalho: [1, 2, 3, 4, 5],
      impressao_cor_primaria: "#2563eb",
      impressao_cor_secundaria: "#0891b2",
      modo_baixa_estoque_os: "ORCAMENTO",
      produto_preco_medio_compra_obrigatorio: false,
      habilitar_edicao_transacoes: false,
      permitir_produto_avulso_os: false,
    },
  });

  const carregarConfig = useCallback(async () => {
    setCarregando(true);
    try {
      const [response, empresaResponse, mercadoLivreResponse, shopeeResponse, nfseConfigResponse] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/config/empresa", { cache: "no-store" }),
        fetch("/api/config/integracoes/mercadolivre", { cache: "no-store" }),
        fetch("/api/config/integracoes/shopee", { cache: "no-store" }),
        fetch("/api/config/nfse", { cache: "no-store" }),
      ]);
      const data = await response.json();
      const empresaData = await empresaResponse.json().catch(() => ({}));
      const mercadoLivreData = await mercadoLivreResponse.json().catch(() => ({}));
      const shopeeData = await shopeeResponse.json().catch(() => ({}));
      const nfseConfigData = await nfseConfigResponse.json().catch(() => ({}));
      if (response.ok && data.config) {
        reset(data.config);
        window.dispatchEvent(new CustomEvent("erpoficina:config-updated", { detail: data.config }));
      } else {
        toast.error("Erro ao carregar configurações");
      }
      if (empresaResponse.ok && empresaData?.empresa) {
        const empresa = empresaData.empresa;
        setEmpresaResumo({
          id: Number(empresa.empresaId),
          nome: empresa.nomefantasia || empresa.razaosocial || "Empresa",
          cnpj: empresa.cnpj || "",
        });
        setEmpresaFiscal({
          codigomunicipio: empresa.codigomunicipio || "",
          regimetributario: String(empresa.regimetributario ?? ""),
        });
        setUsoConsultasPlaca({
          limite: Number(empresa.placa_consulta_limite_mensal ?? 0),
          usadas: Number(empresa.placa_consulta_qtd_mes ?? 0),
          mes: empresa.placa_consulta_mes ?? "",
        });
      } else {
        setUsoConsultasPlaca(null);
        setEmpresaResumo(null);
        setEmpresaFiscal({ codigomunicipio: "", regimetributario: "" });
      }
      setMercadoLivreAccount(mercadoLivreResponse.ok ? mercadoLivreData?.account ?? null : null);
      setShopeeIntegration(shopeeResponse.ok ? {
        configured: Boolean(shopeeData?.configured),
        missing: shopeeData?.missing ?? [],
        account: shopeeData?.account ?? null,
      } : { configured: false, missing: [], account: null });
      setNfseConfig(nfseConfigResponse.ok ? nfseConfigData : null);
    } catch (error) {
      console.error(error);
      toast.error("Falha na comunicação com o servidor");
    } finally {
      setCarregando(false);
    }
  }, [reset]);

  useEffect(() => {
    carregarConfig();
  }, [carregarConfig]);

  const modeloFiscalAtual: ModeloEmissao | null = identificarModeloEmissao(empresaFiscal);

  useEffect(() => {
    const padroes = (nfseConfig?.padroesEmissao as Partial<Record<ModeloEmissao, Partial<CodigosFiscaisForm>>> | undefined) ?? {};
    setPadraoFiscalForm(modeloFiscalAtual ? padroes[modeloFiscalAtual] ?? {} : {});
  }, [nfseConfig, modeloFiscalAtual]);

  const atualizarPadraoFiscal = (campo: keyof CodigosFiscaisForm, valor: string) => {
    setPadraoFiscalForm((current) => ({ ...current, [campo]: valor }));
  };

  const onSalvarPadraoFiscal = async () => {
    if (!modeloFiscalAtual) return;
    setSalvandoPadraoFiscal(true);
    try {
      const padroesAtuais = (nfseConfig?.padroesEmissao as Record<string, unknown> | undefined) ?? {};
      const response = await fetch("/api/config/nfse", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nfse: {
            ...nfseConfig,
            padroesEmissao: { ...padroesAtuais, [modeloFiscalAtual]: padraoFiscalForm },
          },
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Erro ao salvar padrões fiscais");
      setNfseConfig(data.nfse);
      toast.success("Padrões fiscais atualizados com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar padrões fiscais");
    } finally {
      setSalvandoPadraoFiscal(false);
    }
  };

  const onSalvar = async (values: Partial<Config>) => {
    setSalvando(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();
      if (response.ok) {
        toast.success("Configurações atualizadas com sucesso!");
        reset(data.config);
      } else {
        throw new Error(data.error || "Erro ao salvar");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar configurações");
    } finally {
      setSalvando(false);
    }
  };

  const desconectarMercadoLivre = async () => {
    setDesconectandoMercadoLivre(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao desconectar a conta.");
      setMercadoLivreAccount(null);
      toast.success("Conta Mercado Livre desconectada.");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao desconectar a conta Mercado Livre.");
    } finally {
      setDesconectandoMercadoLivre(false);
    }
  };

  const desconectarShopee = async () => {
    setDesconectandoShopee(true);
    try {
      const response = await fetch("/api/config/integracoes/shopee", { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao desconectar a loja.");
      setShopeeIntegration((current) => ({ ...current, account: null }));
      toast.success("Loja Shopee desconectada.");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao desconectar a loja Shopee.");
    } finally {
      setDesconectandoShopee(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
          <p className="text-primary">Carregando configurações...</p>
        </div>
      </div>
    );
  }

  const limitePlacas = usoConsultasPlaca?.limite ?? 0;
  const usadasPlacas = usoConsultasPlaca?.usadas ?? 0;
  const diasTrabalho = watch("agendamento_dias_trabalho") ?? [1, 2, 3, 4, 5];
  const impressaoCorPrimaria = watch("impressao_cor_primaria") ?? "#2563eb";
  const impressaoCorSecundaria = watch("impressao_cor_secundaria") ?? "#0891b2";
  const percentualPlacas =
    limitePlacas > 0 ? Math.min(100, Math.round((usadasPlacas / limitePlacas) * 100)) : 100;

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-1 animate-in fade-in duration-500 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Settings className="h-8 w-8 text-primary" />
            Configurações Gerais
          </h1>
          <p className="text-muted-foreground">
            Gerencie o comportamento global do sistema, módulos fiscais e alertas do PDV.
          </p>
        </div>
        <Button
          onClick={handleSubmit(onSalvar)}
          disabled={salvando}
          className="shadow-md hover:shadow-lg transition-all"
        >
          {salvando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar Alterações
        </Button>
      </div>

      <Card className="overflow-hidden border-primary/10 p-0 shadow-sm">
        <CardHeader className="bg-primary/5 py-4">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <CardTitle>Empresa e integrações de marketplace</CardTitle>
          </div>
          <CardDescription>Conecte as contas vendedoras que serão operadas pelo ERP.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-0 p-0 lg:grid-cols-3">
          <section className="flex min-h-44 flex-col justify-between gap-5 border-b p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Empresa do ERP</p>
                <p className="mt-1 truncate text-base font-semibold">{empresaResumo?.nome || "Não configurada"}</p>
                <p className="text-xs text-muted-foreground">{empresaResumo?.cnpj || "CNPJ não informado"}</p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm" className="w-fit bg-transparent">
              <Link href="/configuracoes/fiscal-pagamentos">Alterar dados da empresa</Link>
            </Button>
          </section>

          <MarketplaceConnectionCard
            icon={<Store className="h-5 w-5" />}
            iconClass="bg-amber-500/15 text-amber-700 dark:text-amber-400"
            name="Mercado Livre"
            connected={Boolean(mercadoLivreAccount && !mercadoLivreAccount.needsReconnect)}
            title={mercadoLivreAccount?.nickname || (mercadoLivreAccount ? `Usuário ${mercadoLivreAccount.userId}` : "Nenhuma conta conectada")}
            description={mercadoLivreAccount ? (mercadoLivreAccount.needsReconnect ? "Reconexão necessária" : `User ID ${mercadoLivreAccount.userId}`) : "Autorize uma conta vendedora para publicar e receber pedidos."}
            details={mercadoLivreAccount?.shipping && !mercadoLivreAccount.needsReconnect
              ? (mercadoLivreAccount.shipping.mercadoEnviosEnabled ? "Mercado Envios habilitado" : "Mercado Envios não habilitado")
              : null}
            connectHref="/api/integracoes/mercadolivre/auth"
            connectLabel={mercadoLivreAccount ? (mercadoLivreAccount.needsReconnect ? "Reconectar" : "Trocar conta") : "Conectar conta"}
            onDisconnect={mercadoLivreAccount ? desconectarMercadoLivre : undefined}
            disconnecting={desconectandoMercadoLivre}
            disconnectTitle="Desconectar conta Mercado Livre?"
            disconnectDescription="Os pedidos históricos serão preservados. Os vínculos dos anúncios serão removidos e precisarão ser refeitos ao conectar outra conta."
          />

          <MarketplaceConnectionCard
            icon={<ShoppingBag className="h-5 w-5" />}
            iconClass="bg-orange-500/15 text-orange-700 dark:text-orange-400"
            name="Shopee"
            connected={Boolean(shopeeIntegration.account && !shopeeIntegration.account.needsReconnect)}
            title={shopeeIntegration.account?.shopName || (shopeeIntegration.account ? `Loja ${shopeeIntegration.account.shopId}` : "Nenhuma loja conectada")}
            description={shopeeIntegration.account
              ? (shopeeIntegration.account.needsReconnect ? "Reconexão necessária" : `Shop ID ${shopeeIntegration.account.shopId} · ${shopeeIntegration.account.region}`)
              : shopeeIntegration.configured ? "Autorize a loja para importar pedidos e sincronizar o catálogo." : "Credenciais do aplicativo ainda não configuradas."}
            details={!shopeeIntegration.configured ? `${shopeeIntegration.missing.length || 3} variável(is) de ambiente pendente(s)` : "Aplicativo Shopee configurado"}
            connectHref="/api/integracoes/shopee/auth"
            connectLabel={shopeeIntegration.account ? (shopeeIntegration.account.needsReconnect ? "Reconectar" : "Trocar loja") : "Conectar loja"}
            connectDisabled={!shopeeIntegration.configured}
            onDisconnect={shopeeIntegration.account ? desconectarShopee : undefined}
            disconnecting={desconectandoShopee}
            disconnectTitle="Desconectar loja Shopee?"
            disconnectDescription="Os pedidos históricos serão preservados. Os vínculos de produtos Shopee serão removidos."
          />
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-5">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <CardTitle>Consultas de placa</CardTitle>
            </div>
            <CardDescription>Uso mensal da API de placas.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Usadas no mes</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca ? usadasPlacas : "-"}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Limite mensal</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca ? limitePlacas : "-"}</p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">Mes vigente</span>
                <p className="mt-1 text-2xl font-semibold">{usoConsultasPlaca?.mes || "-"}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{usoConsultasPlaca ? `${usadasPlacas}/${limitePlacas}` : "Sem dados"}</span>
                <span>{usoConsultasPlaca ? `${percentualPlacas}%` : "-"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: usoConsultasPlaca ? `${percentualPlacas}%` : "0%" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ao virar o mes, o contador e reiniciado automaticamente na proxima consulta.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-7">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle>Agenda de atendimento</CardTitle>
            </div>
            <CardDescription>Defina dias, horario de trabalho e intervalo padrao dos agendamentos.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Intervalo dos slots</Label>
                <Select
                  value={String(watch("agendamento_intervalo_minutos") ?? 60)}
                  onValueChange={(value) => setValue("agendamento_intervalo_minutos", Number(value), { shouldDirty: true })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutos</SelectItem>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="45">45 minutos</SelectItem>
                    <SelectItem value="60">1 hora</SelectItem>
                    <SelectItem value="90">1h30</SelectItem>
                    <SelectItem value="120">2 horas</SelectItem>
                    <SelectItem value="180">3 horas</SelectItem>
                    <SelectItem value="240">4 horas</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Inicio do expediente</Label>
                <Input
                  type="time"
                  value={(watch("agendamento_hora_inicio") ?? "08:00").slice(0, 5)}
                  onChange={(event) => setValue("agendamento_hora_inicio", event.target.value, { shouldDirty: true })}
                />
              </div>

              <div className="space-y-2">
                <Label>Fim do expediente</Label>
                <Input
                  type="time"
                  value={(watch("agendamento_hora_fim") ?? "18:00").slice(0, 5)}
                  onChange={(event) => setValue("agendamento_hora_fim", event.target.value, { shouldDirty: true })}
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Dias de trabalho</Label>
              <div className="flex flex-wrap gap-2">
                {DIAS_SEMANA.map((dia) => {
                  const active = diasTrabalho.includes(dia.value);
                  return (
                    <Button
                      key={dia.value}
                      type="button"
                      variant={active ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        const next = active
                          ? diasTrabalho.filter((item) => item !== dia.value)
                          : [...diasTrabalho, dia.value].sort((a, b) => a - b);
                        if (next.length === 0) {
                          toast.error("Selecione ao menos um dia de trabalho.");
                          return;
                        }
                        setValue("agendamento_dias_trabalho", next, { shouldDirty: true });
                      }}
                    >
                      {dia.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Esses valores controlam a grade do calendario e a duracao padrao sugerida em novos agendamentos.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <CardTitle>Impressao</CardTitle>
            </div>
            <CardDescription>Cores usadas nos modelos de OS e orcamento de venda.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Cor primaria</Label>
              <div className="flex gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorPrimaria, "#2563eb")}
                  onChange={(event) => setValue("impressao_cor_primaria", event.target.value, { shouldDirty: true })}
                />
                <Input
                  value={impressaoCorPrimaria}
                  onChange={(event) => setValue("impressao_cor_primaria", event.target.value, { shouldDirty: true })}
                  placeholder="#2563eb"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Cor secundaria</Label>
              <div className="flex gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorSecundaria, "#0891b2")}
                  onChange={(event) => setValue("impressao_cor_secundaria", event.target.value, { shouldDirty: true })}
                />
                <Input
                  value={impressaoCorSecundaria}
                  onChange={(event) => setValue("impressao_cor_secundaria", event.target.value, { shouldDirty: true })}
                  placeholder="#0891b2"
                  className="font-mono"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        {/* MÓDULO FISCAL */}
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>Módulo Fiscal (NF-e / NFC-e)</CardTitle>
            </div>
            <CardDescription>
              Configure a visibilidade e as travas de emissão de notas fiscais no sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="flex items-center justify-between space-x-2">
              <div className="flex flex-col space-y-1">
                <Label className="text-base">Habilitar Emissão de NF</Label>
                <span className="text-sm text-muted-foreground">
                  Habilita globalmente os botões e recursos de emissão de NF-e e NFC-e.
                </span>
              </div>
              <Switch
                checked={watch("habilitar_emissao_nfe")}
                onCheckedChange={(v) => setValue("habilitar_emissao_nfe", v)}
              />
            </div>

            <Separator />

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center gap-2 font-medium text-sm text-primary">
                  <FileText className="h-4 w-4" /> Módulo de Vendas
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">Botão de emissão de NF é exibido no módulo de Vendas.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_vendas")}
                    onCheckedChange={(v) => setValue("emissao_nf_no_modulo_vendas", v)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Emitir sem Pagamento</Label>
                    <span className="text-xs text-muted-foreground">Permite emissão de NF de Vendas antes do financeiro baixar.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_vendas_nao_pagas")}
                    onCheckedChange={(v) => setValue("emissao_nf_vendas_nao_pagas", v)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center gap-2 font-medium text-sm text-primary">
                  <ClipboardCheck className="h-4 w-4" /> Módulo de Ordens (OS)
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">Botão de emissão de NF é exibido no módulo de Ordens.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_ordens")}
                    onCheckedChange={(v) => setValue("emissao_nf_no_modulo_ordens", v)}
                  />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="flex flex-col space-y-1">
                    <Label>Emitir sem Pagamento</Label>
                    <span className="text-xs text-muted-foreground">Permite emissão de NF de OS antes do financeiro baixar.</span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_ordens_nao_pagas")}
                    onCheckedChange={(v) => setValue("emissao_nf_ordens_nao_pagas", v)}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PADRÕES FISCAIS DA NFS-e */}
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle>Padrões fiscais da NFS-e</CardTitle>
            </div>
            <CardDescription>
              Códigos que já vêm preenchidos ao emitir uma NFS-e, com base no modelo de emissão da empresa.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            {!modeloFiscalAtual ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Preencha o código IBGE do município e o regime tributário da empresa para habilitar os padrões de emissão.{" "}
                <Link href="/configuracoes/fiscal-pagamentos" className="font-medium text-primary underline underline-offset-2">
                  Alterar dados da empresa
                </Link>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Modelo ativo: <span className="font-semibold text-foreground">{getModeloFiscalLabel(modeloFiscalAtual)}</span>
                </p>

                {modeloFiscalAtual === "NACIONAL" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Código de Tributação Nacional do ISS</Label>
                      <Input
                        value={padraoFiscalForm.codigoTributacaoNacionalIss ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("codigoTributacaoNacionalIss", event.target.value)}
                        placeholder="Ex.: 140101"
                        inputMode="numeric"
                        maxLength={12}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Alíquota do ISS (%)</Label>
                      <Input
                        value={padraoFiscalForm.aliquotaIss ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("aliquotaIss", event.target.value)}
                        placeholder="Quando exigida"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tributação do ISS</Label>
                      <Select
                        value={padraoFiscalForm.tributacaoIss ?? ""}
                        onValueChange={(value) => atualizarPadraoFiscal("tributacaoIss", value)}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Operação tributável</SelectItem>
                          <SelectItem value="2">Imunidade</SelectItem>
                          <SelectItem value="3">Exportação de serviço</SelectItem>
                          <SelectItem value="4">Não incidência</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Retenção do ISS</Label>
                      <Select
                        value={padraoFiscalForm.tipoRetencaoIss ?? ""}
                        onValueChange={(value) => atualizarPadraoFiscal("tipoRetencaoIss", value)}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Não retido</SelectItem>
                          <SelectItem value="2">Retido pelo tomador</SelectItem>
                          <SelectItem value="3">Retido pelo intermediário</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>CST do IBS/CBS</Label>
                      <Input
                        value={padraoFiscalForm.ibsCbsSituacaoTributaria ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("ibsCbsSituacaoTributaria", event.target.value)}
                        placeholder="3 dígitos"
                        inputMode="numeric"
                        maxLength={3}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Classificação Tributária do IBS/CBS</Label>
                      <Input
                        value={padraoFiscalForm.ibsCbsClassificacaoTributaria ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("ibsCbsClassificacaoTributaria", event.target.value)}
                        placeholder="6 dígitos"
                        inputMode="numeric"
                        maxLength={6}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Código NBS</Label>
                      <Input
                        value={padraoFiscalForm.codigoNbs ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("codigoNbs", event.target.value)}
                        placeholder="9 dígitos, quando aplicável"
                        inputMode="numeric"
                        maxLength={14}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Item da Lista de Serviço</Label>
                      <Input
                        value={padraoFiscalForm.itemListaServico ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("itemListaServico", event.target.value)}
                        placeholder="Ex.: 14.01"
                        maxLength={8}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>CNAE</Label>
                      <Input
                        value={padraoFiscalForm.codigoCnae ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("codigoCnae", event.target.value)}
                        placeholder={modeloFiscalAtual === "MUNICIPAL_JOAO_PESSOA" ? "9 dígitos" : "7 a 9 dígitos"}
                        inputMode="numeric"
                        maxLength={12}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Natureza da operação</Label>
                      <Select
                        value={padraoFiscalForm.naturezaOperacao ?? ""}
                        onValueChange={(value) => atualizarPadraoFiscal("naturezaOperacao", value)}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Tributação no município</SelectItem>
                          <SelectItem value="2">Tributação fora do município</SelectItem>
                          <SelectItem value="3">Isenção</SelectItem>
                          <SelectItem value="4">Imunidade</SelectItem>
                          <SelectItem value="5">Exigibilidade suspensa — decisão judicial</SelectItem>
                          <SelectItem value="6">Exigibilidade suspensa — processo administrativo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>ISS retido</Label>
                      <Select
                        value={padraoFiscalForm.issRetido ?? ""}
                        onValueChange={(value) => atualizarPadraoFiscal("issRetido", value)}
                      >
                        <SelectTrigger className="w-full"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="false">Não</SelectItem>
                          <SelectItem value="true">Sim</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Alíquota do ISS (%)</Label>
                      <Input
                        value={padraoFiscalForm.aliquotaIss ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("aliquotaIss", event.target.value)}
                        placeholder="Ex.: 3,00"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Código NBS</Label>
                      <Input
                        value={padraoFiscalForm.codigoNbs ?? ""}
                        onChange={(event) => atualizarPadraoFiscal("codigoNbs", event.target.value)}
                        placeholder="9 dígitos, quando aplicável"
                        inputMode="numeric"
                        maxLength={14}
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button type="button" variant="outline" disabled={salvandoPadraoFiscal} onClick={onSalvarPadraoFiscal}>
                    {salvandoPadraoFiscal ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar padrões fiscais
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* SISTEMA E INTERFACE */}
        <Card className="border-primary/10 shadow-sm lg:col-span-5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-primary" />
                <CardTitle>Operações de Venda & PDV</CardTitle>
              </div>
              <CardDescription>
                Alertas e comportamentos do fluxo de caixa e ponto de venda.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col space-y-1">
                  <div className="flex items-center gap-2">
                    <Label>Alerta de Estoque PDV</Label>
                    <Package className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">Exibe alerta em produtos sem etoque no módulo PDV.</span>
                </div>
                <Switch
                  checked={watch("alerta_estoque_pdv")}
                  onCheckedChange={(v) => setValue("alerta_estoque_pdv", v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col space-y-1">
                  <Label>Habilitar edição de transações</Label>
                  <span className="text-xs text-muted-foreground">
                    Permite alterar transações já cadastradas no fluxo de caixa.
                  </span>
                </div>
                <Switch
                  checked={watch("habilitar_edicao_transacoes")}
                  onCheckedChange={(value) =>
                    setValue("habilitar_edicao_transacoes", value, { shouldDirty: true })
                  }
                />
              </div>
            </CardContent>
        </Card>

        <Card className="border-primary/10 shadow-sm lg:col-span-7">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <CardTitle>Estoque em Ordens de Serviço</CardTitle>
            </div>
            <CardDescription>Defina quando os produtos da OS saem do estoque.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col space-y-1">
                <Label>Permitir produto avulso em OS</Label>
                <span className="text-xs text-muted-foreground">
                  Permite orçar itens temporários, que devem ser cadastrados ou vinculados antes de avançar a OS.
                </span>
              </div>
              <Switch
                checked={watch("permitir_produto_avulso_os")}
                onCheckedChange={(value) =>
                  setValue("permitir_produto_avulso_os", value, { shouldDirty: true })
                }
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col space-y-1">
                <Label>Valor médio de compra obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Exige um custo médio maior que zero ao cadastrar ou editar produtos.
                </span>
              </div>
              <Switch
                checked={watch("produto_preco_medio_compra_obrigatorio")}
                onCheckedChange={(value) =>
                  setValue("produto_preco_medio_compra_obrigatorio", value, { shouldDirty: true })
                }
              />
            </div>
            <Separator />
            <div className="space-y-2">
            <Label>Modo de baixa no estoque</Label>
            <Select
              value={watch("modo_baixa_estoque_os") ?? "ORCAMENTO"}
              onValueChange={(value) =>
                setValue("modo_baixa_estoque_os", value as Config["modo_baixa_estoque_os"], { shouldDirty: true })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORCAMENTO">Baixa no Orçamento</SelectItem>
                <SelectItem value="EXECUCAO">Baixa na Execução</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Na execução, o estoque é validado quando a OS é iniciada.
            </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-primary/10 shadow-sm lg:col-span-12">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-primary" />
                <CardTitle>Processos & Qualidade</CardTitle>
              </div>
              <CardDescription>
                Regras de negócio para garantir a execução de processos internos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex flex-col space-y-1">
                  <Label>Checklist de Entrada Obrigatório</Label>
                  <span className="text-xs text-muted-foreground">
                    Impede o início de uma OS sem que o veículo passe pelo checklist.
                  </span>
                </div>
                <Switch
                  checked={watch("checklist_obrigatorio")}
                  onCheckedChange={(v) => setValue("checklist_obrigatorio", v)}
                />
              </div>

              <div className="p-4 rounded-lg bg-primary/5 border border-primary/20 flex gap-3">
                <AlertCircle className="h-5 w-5 text-primary shrink-0" />
                <p className="text-xs text-primary/80 leading-relaxed">
                  <strong>Dica:</strong> Ao ativar o checklist obrigatório, certifique-se de que todos os seus técnicos têm acesso aos formulários de inspeção.
                </p>
              </div>
            </CardContent>
        </Card>
      </div>

    </div>
  );
}
