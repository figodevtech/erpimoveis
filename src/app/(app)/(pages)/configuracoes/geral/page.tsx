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
  Highlighter,
  Trash2,
  Plus,
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
import {
  DESTAQUE_CORES,
  DESTAQUE_ESTILOS,
  DESTAQUE_TEXTO_MAX,
  STATUS_OS_VALIDOS,
  estiloDestaque,
  rotuloStatusOS,
  statusOSValido,
  type DestaqueCor,
  type RegrasDestaqueStatus,
  type StatusOSValido,
} from "@/lib/ordens/destaque";

const SHOPEE_INTEGRATION_ENABLED = process.env.NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED === "true";

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

type SetorOption = {
  id: number;
  nome: string;
};

type ConfigGarantiaFiscal = {
  incluirGarantiaVendaNFe: boolean;
  incluirGarantiaVendaNFCe: boolean;
  incluirGarantiaOsNFe: boolean;
  incluirGarantiaOsNFCe: boolean;
  incluirGarantiaOsNFSe: boolean;
  nfceConfigurada: boolean;
};

const GARANTIA_FISCAL_DEFAULTS: ConfigGarantiaFiscal = {
  incluirGarantiaVendaNFe: false,
  incluirGarantiaVendaNFCe: false,
  incluirGarantiaOsNFe: false,
  incluirGarantiaOsNFCe: false,
  incluirGarantiaOsNFSe: false,
  nfceConfigurada: false,
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

/**
 * O destaque por status é guardado indexado pelo status — é assim que "uma cor
 * por status" fica garantida pelo próprio formato do dado. Mas uma linha
 * recém-adicionada na tela ainda não tem status escolhido e não caberia nesse
 * objeto, então a edição acontece sobre uma lista e só depois é serializada.
 */
type LinhaDestaque = {
  status: string;
  cor: DestaqueCor;
  texto: string;
};

function regrasParaLinhas(regras: RegrasDestaqueStatus | undefined | null): LinhaDestaque[] {
  if (!regras) return [];
  return STATUS_OS_VALIDOS.filter((status) => regras[status]).map((status) => ({
    status,
    cor: regras[status]!.cor,
    texto: regras[status]!.texto ?? "",
  }));
}

function linhasParaRegras(linhas: LinhaDestaque[]): RegrasDestaqueStatus {
  const regras: RegrasDestaqueStatus = {};
  for (const linha of linhas) {
    if (!statusOSValido(linha.status)) continue;
    regras[linha.status as StatusOSValido] = {
      cor: linha.cor,
      texto: linha.texto.trim() || null,
    };
  }
  return regras;
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
  const [setores, setSetores] = useState<SetorOption[]>([]);
  const [carregandoSetores, setCarregandoSetores] = useState(true);
  const [linhasDestaque, setLinhasDestaque] = useState<LinhaDestaque[]>([]);
  const [garantiaFiscal, setGarantiaFiscal] = useState<ConfigGarantiaFiscal>(
    GARANTIA_FISCAL_DEFAULTS,
  );
  const [garantiaFiscalDisponivel, setGarantiaFiscalDisponivel] = useState(false);

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
      impressao_cor_texto: "#ffffff",
      modo_baixa_estoque_os: "ORCAMENTO",
      produto_preco_medio_compra_obrigatorio: false,
      produto_ncm_obrigatorio: false,
      habilitar_edicao_transacoes: false,
      permitir_produto_avulso_os: false,
      setor_padrao_os_id: null,
      destaque_os_por_status: {},
    },
  });

  // Espelha a lista editável no campo do formulário, que é o que vai no PUT.
  const atualizarLinhasDestaque = useCallback(
    (proximas: LinhaDestaque[]) => {
      setLinhasDestaque(proximas);
      setValue("destaque_os_por_status", linhasParaRegras(proximas), { shouldDirty: true });
    },
    [setValue],
  );

  const carregarConfig = useCallback(async () => {
    setCarregando(true);
    setGarantiaFiscalDisponivel(false);
    try {
      const [
        response,
        empresaResponse,
        mercadoLivreResponse,
        shopeeResponse,
        setoresResponse,
        nfeResponse,
        nfseResponse,
      ] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/config/empresa", { cache: "no-store" }),
        fetch("/api/config/integracoes/mercadolivre", { cache: "no-store" }),
        SHOPEE_INTEGRATION_ENABLED ? fetch("/api/config/integracoes/shopee", { cache: "no-store" }) : Promise.resolve(null),
        fetch("/api/tipos/setores", { cache: "no-store" }),
        fetch("/api/config/nfe", { cache: "no-store" }),
        fetch("/api/config/nfse", { cache: "no-store" }),
      ]);
      const data = await response.json();
      const empresaData = await empresaResponse.json().catch(() => ({}));
      const mercadoLivreData = await mercadoLivreResponse.json().catch(() => ({}));
      const shopeeData = shopeeResponse ? await shopeeResponse.json().catch(() => ({})) : {};
      const setoresData = await setoresResponse.json().catch(() => ({}));
      const nfeData = await nfeResponse.json().catch(() => ({}));
      const nfseData = await nfseResponse.json().catch(() => ({}));
      if (response.ok && data.config) {
        reset(data.config);
        setLinhasDestaque(regrasParaLinhas(data.config.destaque_os_por_status));
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
        setUsoConsultasPlaca({
          limite: Number(empresa.placa_consulta_limite_mensal ?? 0),
          usadas: Number(empresa.placa_consulta_qtd_mes ?? 0),
          mes: empresa.placa_consulta_mes ?? "",
        });
      } else {
        setUsoConsultasPlaca(null);
        setEmpresaResumo(null);
      }
      setMercadoLivreAccount(mercadoLivreResponse.ok ? mercadoLivreData?.account ?? null : null);
      setShopeeIntegration(shopeeResponse?.ok ? {
        configured: Boolean(shopeeData?.configured),
        missing: shopeeData?.missing ?? [],
        account: shopeeData?.account ?? null,
      } : { configured: false, missing: [], account: null });
      setSetores(
        setoresResponse.ok && Array.isArray(setoresData?.items)
          ? setoresData.items.map((item: any) => ({ id: Number(item.id), nome: String(item.nome ?? "") }))
          : [],
      );
      const garantiaDisponivel = Boolean(
        nfeResponse.ok && nfeData?.nfe && nfseResponse.ok && nfseData?.nfse,
      );
      setGarantiaFiscalDisponivel(garantiaDisponivel);
      if (garantiaDisponivel) {
        setGarantiaFiscal({
          incluirGarantiaVendaNFe: Boolean(nfeData.nfe.incluirGarantiaVendaNFe),
          incluirGarantiaVendaNFCe: Boolean(nfeData.nfe.incluirGarantiaVendaNFCe),
          incluirGarantiaOsNFe: Boolean(nfeData.nfe.incluirGarantiaOsNFe),
          incluirGarantiaOsNFCe: Boolean(nfeData.nfe.incluirGarantiaOsNFCe),
          incluirGarantiaOsNFSe: Boolean(nfseData.nfse.incluirGarantiaOs),
          nfceConfigurada: Boolean(nfeData.nfe.nfceConfigurada),
        });
      }
    } catch (error) {
      console.error(error);
      toast.error("Falha na comunicação com o servidor");
    } finally {
      setCarregando(false);
      setCarregandoSetores(false);
    }
  }, [reset]);

  useEffect(() => {
    carregarConfig();
  }, [carregarConfig]);

  const onSalvar = async (values: Partial<Config>) => {
    setSalvando(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao salvar");

      if (garantiaFiscalDisponivel) {
        const [nfeResponse, nfseResponse] = await Promise.all([
          fetch("/api/config/nfe", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nfe: {
                incluirGarantiaVendaNFe: garantiaFiscal.incluirGarantiaVendaNFe,
                incluirGarantiaVendaNFCe: garantiaFiscal.incluirGarantiaVendaNFCe,
                incluirGarantiaOsNFe: garantiaFiscal.incluirGarantiaOsNFe,
                incluirGarantiaOsNFCe: garantiaFiscal.incluirGarantiaOsNFCe,
              },
            }),
          }),
          fetch("/api/config/nfse", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nfse: { incluirGarantiaOs: garantiaFiscal.incluirGarantiaOsNFSe },
            }),
          }),
        ]);
        const [nfeData, nfseData] = await Promise.all([
          nfeResponse.json().catch(() => ({})),
          nfseResponse.json().catch(() => ({})),
        ]);
        if (!nfeResponse.ok) {
          throw new Error(
            [nfeData?.error, nfeData?.detalhe].filter(Boolean).join(" ")
              || "Erro ao salvar as opções de garantia da NF-e/NFC-e.",
          );
        }
        if (!nfseResponse.ok) {
          throw new Error(nfseData?.error || "Erro ao salvar a opção de garantia da NFS-e.");
        }

        setGarantiaFiscal((atual) => ({
          incluirGarantiaVendaNFe: Boolean(nfeData?.nfe?.incluirGarantiaVendaNFe),
          incluirGarantiaVendaNFCe: Boolean(nfeData?.nfe?.incluirGarantiaVendaNFCe),
          incluirGarantiaOsNFe: Boolean(nfeData?.nfe?.incluirGarantiaOsNFe),
          incluirGarantiaOsNFCe: Boolean(nfeData?.nfe?.incluirGarantiaOsNFCe),
          incluirGarantiaOsNFSe: Boolean(nfseData?.nfse?.incluirGarantiaOs),
          nfceConfigurada: Boolean(nfeData?.nfe?.nfceConfigurada ?? atual.nfceConfigurada),
        }));
      }

      toast.success("Configurações atualizadas com sucesso!");
      reset(data.config);
      setLinhasDestaque(regrasParaLinhas(data.config.destaque_os_por_status));
      // Sem isso o resto do app segue com a config antiga em sessionStorage
      // até o próximo reload — e o destaque por status só apareceria na lista
      // de OS depois de recarregar a página.
      window.dispatchEvent(new CustomEvent("erpoficina:config-updated", { detail: data.config }));
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
  const impressaoCorTexto = watch("impressao_cor_texto") ?? "#ffffff";
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
              <Link href="/configuracoes/empresa">Alterar dados da empresa</Link>
            </Button>
          </section>

          {SHOPEE_INTEGRATION_ENABLED ? <MarketplaceConnectionCard
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
          /> : null}

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
          <CardContent className="grid gap-4 py-6 md:grid-cols-3">
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

            <div className="space-y-2">
              <Label>Cor do texto</Label>
              <div className="flex gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorTexto, "#ffffff")}
                  onChange={(event) => setValue("impressao_cor_texto", event.target.value, { shouldDirty: true })}
                />
                <Input
                  value={impressaoCorTexto}
                  onChange={(event) => setValue("impressao_cor_texto", event.target.value, { shouldDirty: true })}
                  placeholder="#ffffff"
                  className="font-mono"
                />
              </div>
            </div>

            {/* A cor do texto so faz sentido vista sobre a barra: sem a previa,
                so da para descobrir que ficou ilegivel imprimindo. */}
            <div className="md:col-span-3 space-y-2">
              <Label>Previa do cabecalho</Label>
              <div
                className="flex items-center justify-between gap-4 rounded-lg px-4 py-3"
                style={{
                  background: `linear-gradient(135deg, ${colorPickerValue(impressaoCorPrimaria, "#2563eb")}, ${colorPickerValue(impressaoCorSecundaria, "#0891b2")})`,
                  color: colorPickerValue(impressaoCorTexto, "#ffffff"),
                }}
              >
                <div className="min-w-0">
                  <div className="truncate text-base font-bold">
                    {empresaResumo?.nome || "Sua empresa"}
                  </div>
                  <div className="truncate text-[10px] opacity-95">
                    CNPJ {empresaResumo?.cnpj || "00.000.000/0001-00"}
                  </div>
                </div>
                <div
                  className="shrink-0 rounded-lg px-3 py-2 text-right"
                  style={{
                    background: `color-mix(in srgb, ${colorPickerValue(impressaoCorTexto, "#ffffff")} 15%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${colorPickerValue(impressaoCorTexto, "#ffffff")} 30%, transparent)`,
                  }}
                >
                  <div className="text-[8px] font-extrabold uppercase tracking-[.2em] opacity-90">
                    Ordem de Servico
                  </div>
                  <div className="text-2xl font-black leading-none">#123</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        {/* MÓDULO FISCAL */}
        <Card className="overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>Módulo Fiscal (NF-e / NFC-e / NFS-e)</CardTitle>
            </div>
            <CardDescription>
              Configure a visibilidade, as travas de emissão e o carregamento da garantia nas notas fiscais.
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
              {!garantiaFiscalDisponivel ? (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300 lg:col-span-2">
                  Não foi possível carregar as opções de garantia fiscal. Confira se a migration
                  fiscal mais recente foi aplicada.
                </div>
              ) : null}
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
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="garantia-venda-nfe">
                      Incluir informações de garantia na emissão de NF-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Carrega a garantia da Venda nas observações da NF-e.
                    </span>
                  </div>
                  <Switch
                    id="garantia-venda-nfe"
                    checked={garantiaFiscal.incluirGarantiaVendaNFe}
                    disabled={!garantiaFiscalDisponivel}
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaVendaNFe: value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col space-y-1">
                    <Label
                      htmlFor="garantia-venda-nfce"
                      className={
                        !garantiaFiscalDisponivel || !garantiaFiscal.nfceConfigurada
                          ? "opacity-60"
                          : undefined
                      }
                    >
                      Incluir informações de garantia na emissão de NFC-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {garantiaFiscal.nfceConfigurada
                        ? "Carrega a garantia da Venda nas observações da NFC-e."
                        : "Disponível após configurar o modelo 65."}
                    </span>
                  </div>
                  <Switch
                    id="garantia-venda-nfce"
                    checked={garantiaFiscal.incluirGarantiaVendaNFCe}
                    disabled={!garantiaFiscalDisponivel || !garantiaFiscal.nfceConfigurada}
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaVendaNFCe: value,
                      }))
                    }
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
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="garantia-os-nfe">
                      Incluir informações de garantia na emissão de NF-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Carrega a garantia da OS nas observações da NF-e.
                    </span>
                  </div>
                  <Switch
                    id="garantia-os-nfe"
                    checked={garantiaFiscal.incluirGarantiaOsNFe}
                    disabled={!garantiaFiscalDisponivel}
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaOsNFe: value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col space-y-1">
                    <Label
                      htmlFor="garantia-os-nfce"
                      className={
                        !garantiaFiscalDisponivel || !garantiaFiscal.nfceConfigurada
                          ? "opacity-60"
                          : undefined
                      }
                    >
                      Incluir informações de garantia na emissão de NFC-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      {garantiaFiscal.nfceConfigurada
                        ? "Carrega a garantia da OS nas observações da NFC-e."
                        : "Disponível após configurar o modelo 65."}
                    </span>
                  </div>
                  <Switch
                    id="garantia-os-nfce"
                    checked={garantiaFiscal.incluirGarantiaOsNFCe}
                    disabled={!garantiaFiscalDisponivel || !garantiaFiscal.nfceConfigurada}
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaOsNFCe: value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-col space-y-1">
                    <Label htmlFor="garantia-os-nfse">
                      Carregar informações de garantia para NFS-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Carrega a garantia da OS nas informações complementares da NFS-e.
                    </span>
                  </div>
                  <Switch
                    id="garantia-os-nfse"
                    checked={garantiaFiscal.incluirGarantiaOsNFSe}
                    disabled={!garantiaFiscalDisponivel}
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaOsNFSe: value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
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
              <CardTitle>{"Ordens de Servi\u00e7o"}</CardTitle>
            </div>
            <CardDescription>{"Defina os padr\u00f5es de cria\u00e7\u00e3o e o comportamento do estoque nas ordens."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{"Setor padr\u00e3o para cria\u00e7\u00e3o de OS"}</Label>
              <Select
                value={watch("setor_padrao_os_id") ? String(watch("setor_padrao_os_id")) : "SEM_PADRAO"}
                onValueChange={(value) =>
                  setValue("setor_padrao_os_id", value === "SEM_PADRAO" ? null : Number(value), { shouldDirty: true })
                }
                disabled={carregandoSetores}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={carregandoSetores ? "Carregando setores..." : "Selecione um setor"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEM_PADRAO">{"Sem setor padr\u00e3o"}</SelectItem>
                  {setores.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>{item.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {"Esse setor vir\u00e1 selecionado nas novas ordens de servi\u00e7o e poder\u00e1 ser alterado antes de salvar."}
              </p>
            </div>
            <Separator />
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
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col space-y-1">
                <Label>NCM obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Exige o NCM com 8 dígitos ao cadastrar ou editar produtos.
                </span>
              </div>
              <Switch
                checked={watch("produto_ncm_obrigatorio")}
                onCheckedChange={(value) =>
                  setValue("produto_ncm_obrigatorio", value, { shouldDirty: true })
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
              <Highlighter className="h-5 w-5 text-primary" />
              <CardTitle>Destacar ordens de serviço por status</CardTitle>
            </div>
            <CardDescription>
              Pinta na listagem toda OS que estiver no status escolhido. Uma cor por status.
              O destaque marcado à mão dentro da OS sempre sobrepõe estas regras.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {linhasDestaque.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum status destacado. As ordens aparecem com o visual padrão da lista.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_auto]">
                  <span>Status</span>
                  <span>Cor</span>
                  <span>Texto explicativo (opcional)</span>
                  <span className="w-9" />
                </div>

                {linhasDestaque.map((linha, indice) => {
                  // Uma cor por status: o select não oferece status já usado em
                  // outra linha, então nem dá para criar a regra conflitante.
                  const statusEmUso = new Set(
                    linhasDestaque.filter((_, i) => i !== indice).map((item) => item.status),
                  );
                  const estilo = estiloDestaque(linha.cor);

                  return (
                    <div
                      key={`${linha.status || "novo"}-${indice}`}
                      className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_auto] md:items-center"
                    >
                      <Select
                        value={linha.status || undefined}
                        onValueChange={(value) =>
                          atualizarLinhasDestaque(
                            linhasDestaque.map((item, i) =>
                              i === indice ? { ...item, status: value } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione o status" />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OS_VALIDOS.filter((status) => !statusEmUso.has(status)).map((status) => (
                            <SelectItem key={status} value={status}>
                              {rotuloStatusOS(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Select
                        value={linha.cor}
                        onValueChange={(value) =>
                          atualizarLinhasDestaque(
                            linhasDestaque.map((item, i) =>
                              i === indice ? { ...item, cor: value as DestaqueCor } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DESTAQUE_CORES.map((cor) => (
                            <SelectItem key={cor.valor} value={cor.valor}>
                              <span className="flex items-center gap-2">
                                <span className={`h-3 w-3 shrink-0 rounded-full ${DESTAQUE_ESTILOS[cor.valor].amostra}`} />
                                {cor.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <Input
                        value={linha.texto}
                        maxLength={DESTAQUE_TEXTO_MAX}
                        placeholder="Ex.: aguardando o cliente pagar"
                        onChange={(event) =>
                          atualizarLinhasDestaque(
                            linhasDestaque.map((item, i) =>
                              i === indice ? { ...item, texto: event.target.value } : item,
                            ),
                          )
                        }
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="justify-self-end text-destructive hover:text-destructive"
                        aria-label="Remover destaque"
                        onClick={() =>
                          atualizarLinhasDestaque(linhasDestaque.filter((_, i) => i !== indice))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>

                      {/* A cor só se explica vista como a lista mostra. */}
                      <div className="md:col-span-4">
                        <div className={`rounded-sm border px-3 py-2 text-xs ${estilo.linha}`}>
                          <span className="font-mono font-semibold">#1234</span>
                          <span className="mx-2 text-muted-foreground">·</span>
                          <span>{linha.status ? rotuloStatusOS(linha.status) : "Selecione o status"}</span>
                          {linha.texto.trim() ? (
                            <span className="ml-2 text-muted-foreground">— {linha.texto.trim()}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={linhasDestaque.length >= STATUS_OS_VALIDOS.length}
              onClick={() =>
                atualizarLinhasDestaque([...linhasDestaque, { status: "", cor: "verde", texto: "" }])
              }
            >
              <Plus className="h-4 w-4" />
              Adicionar destaque
            </Button>

            <p className="text-xs text-muted-foreground">
              Linhas sem status escolhido são descartadas ao salvar. O texto explicativo aparece
              no mesmo aviso que já mostra o motivo do destaque manual na listagem.
            </p>
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
