"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { prepararConfigParaSalvar } from "@/lib/config/faturamento-patch";
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
  ExternalLink,
  MapPin,
  RefreshCcw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS,
  type MercadoLivreNotificationEvent,
} from "@/lib/integrations/mercadolivre-notification-events";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  STATUS_OS_EMISSAO_OPCOES,
  STATUS_OS_EMISSAO_PADRAO,
} from "@/lib/nfe/elegibilidadeEmissao";
import { Checkbox } from "@/components/ui/checkbox";
import { TermosImpressaoOSCard } from "./components/termos-impressao-os-card";

const SHOPEE_INTEGRATION_ENABLED =
  process.env.NEXT_PUBLIC_SHOPEE_INTEGRATION_ENABLED === "true";

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
  defaultListingTypeId: "free" | "gold_special" | "gold_pro";
  quantityPricingDefaultEnabled: boolean;
  quantityPricingDefaultTiers: Array<{ quantity: number; percentage: number }>;
  notificationEvents: MercadoLivreNotificationEvent[];
  shipping?: {
    modes: string[];
    option: string | null;
    mercadoEnviosEnabled: boolean;
    error: string | null;
  } | null;
  shippingAddress?: {
    id: string;
    addressLine: string | null;
    zipCode: string | null;
    city: string | null;
    cityId: string | null;
    state: string | null;
    stateId: string | null;
    neighborhood: string | null;
    municipality: string | null;
    country: string | null;
    types: string[];
    normalized: boolean | null;
    status: string | null;
    source: "account_address" | "seller_profile" | "listing";
    partial: boolean;
  } | null;
  shippingAddressError?: string | null;
  shippingAddressNotice?: string | null;
  sellerProfile?: {
    userType: string | null;
    accountStatus: string | null;
    sellingAllowed: boolean | null;
    reputationLevelId: string | null;
    reputationLabel: string;
    powerSellerStatus: string | null;
    powerSellerLabel: string | null;
    completedSales: number | null;
    totalSales: number | null;
    businessEnabled: boolean;
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
  badges,
  connectHref,
  connectLabel,
  connectDisabled,
  onDisconnect,
  disconnecting,
  disconnectTitle,
  disconnectDescription,
  settingsHref,
}: {
  icon: React.ReactNode;
  iconClass: string;
  name: string;
  connected: boolean;
  title: string;
  description: string;
  details?: string | null;
  badges?: string[];
  connectHref: string;
  connectLabel: string;
  connectDisabled?: boolean;
  onDisconnect?: () => void;
  disconnecting?: boolean;
  disconnectTitle: string;
  disconnectDescription: string;
  settingsHref?: string;
}) {
  return (
    <section className="flex min-h-36 min-w-0 flex-col justify-between gap-3 border-b p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {name}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
              />
              {connected ? "Conectada" : "Desconectada"}
            </span>
          </div>
          <p className="mt-1 truncate text-base font-semibold">{title}</p>
          <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
          {badges?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <span
                  key={badge}
                  className="rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground/75"
                >
                  {badge}
                </span>
              ))}
            </div>
          ) : null}
          {details ? (
            <p className="mt-2 flex min-w-0 items-start gap-1.5 break-words text-xs text-foreground/70">
              <KeyRound className="h-3 w-3 shrink-0" />
              {details}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap gap-2">
        {connectDisabled ? (
          <Button size="sm" disabled>
            {connectLabel}
          </Button>
        ) : (
          <Button asChild size="sm" variant={connected ? "outline" : "default"}>
            <a href={connectHref}>{connectLabel}</a>
          </Button>
        )}
        {settingsHref && connected ? (
          <Button asChild size="sm" variant="outline">
            <a href={settingsHref}>Configurar operação</a>
          </Button>
        ) : null}
        {onDisconnect ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
              >
                <Unplug className="h-4 w-4" />
                Desconectar
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{disconnectTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {disconnectDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Desconectar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </section>
  );
}

function MercadoLivreOperationSettingsCard({
  account,
  savingListingType,
  refreshingAccount,
  onListingTypeChange,
  onQuantityDefaultsSave,
  onNotificationEventsChange,
  onRefreshAccount,
}: {
  account: MercadoLivreAccount | null;
  savingListingType: boolean;
  refreshingAccount: boolean;
  onListingTypeChange: (value: "free" | "gold_special" | "gold_pro") => void;
  onQuantityDefaultsSave: (
    enabled: boolean,
    tiers: Array<{ quantity: number; percentage: number }>,
  ) => Promise<boolean>;
  onNotificationEventsChange: (events: MercadoLivreNotificationEvent[]) => void;
  onRefreshAccount: () => Promise<void>;
}) {
  const connected = Boolean(account && !account.needsReconnect);
  const businessEnabled = Boolean(account?.sellerProfile?.businessEnabled);
  const flexEnabled = Boolean(
    account?.shipping?.modes.includes("self_service"),
  );
  const [quantityDefaultsDialogOpen, setQuantityDefaultsDialogOpen] =
    useState(false);
  const [quantityDefaultsEnabled, setQuantityDefaultsEnabled] = useState(
    Boolean(account?.quantityPricingDefaultEnabled),
  );
  const [quantityDefaultTiers, setQuantityDefaultTiers] = useState<
    Array<{ quantity: string; percentage: string }>
  >(() =>
    (account?.quantityPricingDefaultTiers?.length
      ? account.quantityPricingDefaultTiers
      : [
          { quantity: 2, percentage: 5 },
          { quantity: 5, percentage: 10 },
          { quantity: 10, percentage: 15 },
        ]
    ).map((tier) => ({
      quantity: String(tier.quantity),
      percentage: String(tier.percentage).replace(".", ","),
    })),
  );

  const quantityDefaultsSummary =
    quantityDefaultsEnabled && quantityDefaultTiers.length
      ? quantityDefaultTiers
          .filter((tier) => tier.quantity && tier.percentage)
          .map((tier) => `${tier.quantity} un. · ${tier.percentage}%`)
          .join("  |  ")
      : "Sem preenchimento automático";
  const shippingAddress = account?.shippingAddress ?? null;
  const shippingLocation = [shippingAddress?.city, shippingAddress?.state]
    .filter(Boolean)
    .join(" / ");
  const shippingAddressType = shippingAddress?.partial
    ? "Localização aproximada"
    : shippingAddress?.types.includes("shipping")
    ? "Endereço de envio"
    : shippingAddress?.types.includes("default_selling_address")
      ? "Endereço padrão de venda"
      : "Endereço da conta";

  return (
    <>
      <Card
        id="marketplace-settings"
        className="min-w-0 scroll-mt-4 overflow-hidden border-primary/10 p-0 shadow-sm"
      >
        <CardHeader className="bg-primary/5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Store className="h-5 w-5 text-primary" />
                <CardTitle>Operação do Mercado Livre</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Preferências de publicação, preços por quantidade e logística da
                conta.
              </CardDescription>
            </div>
            <span
              className={`max-w-full break-all rounded-full border px-2.5 py-1 text-xs font-medium ${connected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "text-muted-foreground"}`}
            >
              {connected
                ? account?.nickname || `Usuário ${account?.userId}`
                : account?.needsReconnect
                  ? "Reconexão necessária"
                  : "Conta não conectada"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-5">
          {!connected ? (
            <div className="flex flex-col items-start justify-between gap-3 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-sm font-medium">
                  Conecte ou reconecte a conta vendedora
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  A seção permanece visível, mas as preferências só podem ser
                  salvas após carregar a conta Mercado Livre.
                </p>
              </div>
              <Button asChild size="sm">
                <a href="/api/integracoes/mercadolivre/auth">
                  {account ? "Reconectar" : "Conectar conta"}
                </a>
              </Button>
            </div>
          ) : (
            <div className="grid min-w-0 gap-4 lg:grid-cols-3">
              <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div>
                  <p className="text-sm font-medium">Publicação padrão</p>
                  <p className="text-xs text-muted-foreground">
                    Tipo sugerido ao criar um novo anúncio.
                  </p>
                </div>
                <Select
                  value={account?.defaultListingTypeId || "gold_special"}
                  onValueChange={(value) =>
                    onListingTypeChange(
                      value as "free" | "gold_special" | "gold_pro",
                    )
                  }
                  disabled={savingListingType}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gold_special">Clássico</SelectItem>
                    <SelectItem value="gold_pro">Premium</SelectItem>
                    <SelectItem value="free">
                      Grátis, quando disponível
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {savingListingType
                    ? "Salvando preferência..."
                    : "A disponibilidade e a comissão são confirmadas antes de publicar."}
                </p>
              </section>

              <section className="flex flex-col justify-between gap-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Preço por quantidade</p>
                    <p className="text-xs text-muted-foreground">
                      Descontos progressivos B2B.
                    </p>
                  </div>
                  <Badge
                    variant={quantityDefaultsEnabled ? "secondary" : "outline"}
                  >
                    {quantityDefaultsEnabled
                      ? "Modelo ativo"
                      : businessEnabled
                        ? "Manual"
                        : "Indisponível"}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {businessEnabled
                    ? quantityDefaultsSummary
                    : "A conta ainda não possui a elegibilidade business liberada pelo Mercado Livre."}
                </p>
                {businessEnabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setQuantityDefaultsDialogOpen(true)}
                  >
                    Editar modelo
                  </Button>
                ) : null}
              </section>

              <section className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-4 lg:col-span-3">
                <div>
                  <p className="text-sm font-medium">Avisos do Mercado Livre</p>
                  <p className="text-xs text-muted-foreground">
                    O que interrompe a equipe na Central de Notificações.
                    Alterações feitas dentro do ERP nunca geram aviso.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {MERCADOLIVRE_NOTIFICATION_EVENT_GROUPS.map((group) => {
                    const events = account?.notificationEvents ?? [];
                    return (
                      <div key={group.id} className="rounded-md border bg-background p-3">
                        <p className="text-xs font-medium">{group.label}</p>
                        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                          {group.description}
                        </p>
                        <div className="space-y-1.5">
                          {group.events.map(([id, label]) => (
                            <label
                              key={id}
                              className="flex cursor-pointer items-start justify-between gap-2 text-xs"
                            >
                              <span className="leading-relaxed">{label}</span>
                              <Switch
                                checked={events.includes(id)}
                                disabled={!connected || savingListingType}
                                onCheckedChange={(checked) =>
                                  onNotificationEventsChange(
                                    checked
                                      ? Array.from(new Set([...events, id]))
                                      : events.filter((event) => event !== id),
                                  )
                                }
                              />
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Envio no mesmo dia</p>
                    <p className="text-xs text-muted-foreground">
                      Mercado Envios Flex.
                    </p>
                  </div>
                  <Badge variant={flexEnabled ? "secondary" : "outline"}>
                    {flexEnabled ? "Flex habilitado" : "Flex indisponível"}
                  </Badge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {flexEnabled
                    ? "A entrega depende das zonas, dias, capacidade e horário limite da conta."
                    : "Primeiro o vendedor precisa aderir e ser habilitado para o Envios Flex."}
                </p>
                {!flexEnabled ? (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href="https://www.mercadolivre.com.br/envios-flex"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver ativação do Flex
                    </a>
                  </Button>
                ) : null}
              </section>

              <section className="min-w-0 rounded-lg border bg-muted/20 p-4 lg:col-span-3">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">Origem dos envios</p>
                        {shippingAddress ? <Badge variant="outline">{shippingAddressType}</Badge> : null}
                        {shippingAddress?.normalized === false ? <Badge variant="destructive">Endereço não normalizado</Badge> : null}
                      </div>
                      {shippingAddress ? (
                        <div className="mt-2 space-y-1 text-sm">
                          {shippingAddress.addressLine ? <p className="break-words">{shippingAddress.addressLine}</p> : null}
                          <p className="break-words text-muted-foreground">
                            {[shippingAddress.neighborhood, shippingLocation].filter(Boolean).join(" · ") || "Localização não informada"}
                            {shippingAddress.zipCode ? ` · CEP ${shippingAddress.zipCode}` : ""}
                          </p>
                          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
                            {account?.shippingAddressNotice || "Este é o endereço retornado pela conta vendedora e usado como referência nas simulações do ERP. Em Full, Flex, coleta ou estoque multi-origem, o Mercado Livre pode definir outro depósito ou nó logístico para o envio real."}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-muted-foreground">
                          <p>{account?.shippingAddressError || "O Mercado Livre não retornou um endereço de envio ativo para esta conta."}</p>
                          <p className="mt-1 text-xs">Você pode conferir ou alterar a origem diretamente nas preferências de envio da conta vendedora.</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={() => void onRefreshAccount()} disabled={refreshingAccount}>
                      <RefreshCcw className={`h-4 w-4 ${refreshingAccount ? "animate-spin" : ""}`} />
                      Atualizar dados
                    </Button>
                    <Button asChild type="button" variant="outline" size="sm">
                      <a href="https://www.mercadolivre.com.br/" target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Editar no Mercado Livre
                      </a>
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </CardContent>
      </Card>
      <Dialog
        open={quantityDefaultsDialogOpen}
        onOpenChange={setQuantityDefaultsDialogOpen}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Modelo de preço por quantidade</DialogTitle>
            <DialogDescription>
              Estas faixas apenas preenchem novos anúncios. O desconto só será
              enviado ao Mercado Livre após a confirmação no anúncio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-3">
              <div>
                <Label htmlFor="quantity-default-enabled">
                  Usar modelo padrão
                </Label>
                <p className="text-xs text-muted-foreground">
                  Preencher automaticamente as faixas ao configurar um anúncio.
                </p>
              </div>
              <Switch
                id="quantity-default-enabled"
                checked={quantityDefaultsEnabled}
                onCheckedChange={setQuantityDefaultsEnabled}
                disabled={savingListingType}
              />
            </div>
            <div className="space-y-2">
              <div className="hidden grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground sm:grid">
                <span>Quantidade mínima</span>
                <span>Desconto</span>
                <span className="w-9" />
              </div>
              {quantityDefaultTiers.map((tier, index) => (
                <div
                  key={index}
                  className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
                >
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={tier.quantity}
                    onChange={(event) =>
                      setQuantityDefaultTiers((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index
                            ? { ...entry, quantity: event.target.value }
                            : entry,
                        ),
                      )
                    }
                    disabled={savingListingType || !quantityDefaultsEnabled}
                    placeholder="Quantidade"
                  />
                  <div className="relative">
                    <Input
                      inputMode="decimal"
                      value={tier.percentage}
                      onChange={(event) =>
                        setQuantityDefaultTiers((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index
                              ? {
                                  ...entry,
                                  percentage: event.target.value.replace(
                                    /[^\d,.]/g,
                                    "",
                                  ),
                                }
                              : entry,
                          ),
                        )
                      }
                      disabled={savingListingType || !quantityDefaultsEnabled}
                      className="pr-8"
                      placeholder="Desconto"
                    />
                    <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">
                      %
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={savingListingType || !quantityDefaultsEnabled}
                    onClick={() =>
                      setQuantityDefaultTiers((current) =>
                        current.filter((_, entryIndex) => entryIndex !== index),
                      )
                    }
                    aria-label="Remover faixa padrão"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                savingListingType ||
                !quantityDefaultsEnabled ||
                quantityDefaultTiers.length >= 5
              }
              onClick={() =>
                setQuantityDefaultTiers((current) => [
                  ...current,
                  { quantity: "", percentage: "" },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              Adicionar faixa
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuantityDefaultsDialogOpen(false)}
              disabled={savingListingType}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                savingListingType ||
                (quantityDefaultsEnabled && quantityDefaultTiers.length === 0)
              }
              onClick={async () => {
                const saved = await onQuantityDefaultsSave(
                  quantityDefaultsEnabled,
                  quantityDefaultTiers.map((tier) => ({
                    quantity: Number(tier.quantity),
                    percentage: Number(tier.percentage.replace(",", ".")),
                  })),
                );
                if (saved) setQuantityDefaultsDialogOpen(false);
              }}
            >
              {savingListingType ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Salvar modelo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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

function regrasParaLinhas(
  regras: RegrasDestaqueStatus | undefined | null,
): LinhaDestaque[] {
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
  const [desconectandoMercadoLivre, setDesconectandoMercadoLivre] =
    useState(false);
  const [salvandoPublicacaoPadrao, setSalvandoPublicacaoPadrao] =
    useState(false);
  const [atualizandoMercadoLivre, setAtualizandoMercadoLivre] = useState(false);
  const [desconectandoShopee, setDesconectandoShopee] = useState(false);
  const [usoConsultasPlaca, setUsoConsultasPlaca] =
    useState<UsoConsultasPlaca | null>(null);
  const [empresaResumo, setEmpresaResumo] = useState<EmpresaResumo | null>(
    null,
  );
  const [mercadoLivreAccount, setMercadoLivreAccount] =
    useState<MercadoLivreAccount | null>(null);
  const [shopeeIntegration, setShopeeIntegration] = useState<ShopeeIntegration>(
    { configured: false, missing: [], account: null },
  );
  const [setores, setSetores] = useState<SetorOption[]>([]);
  const [carregandoSetores, setCarregandoSetores] = useState(true);
  const [linhasDestaque, setLinhasDestaque] = useState<LinhaDestaque[]>([]);
  const [garantiaFiscal, setGarantiaFiscal] = useState<ConfigGarantiaFiscal>(
    GARANTIA_FISCAL_DEFAULTS,
  );
  const [garantiaFiscalDisponivel, setGarantiaFiscalDisponivel] =
    useState(false);

  const { handleSubmit, setValue, watch, reset, formState: { dirtyFields, defaultValues } } = useForm<Partial<Config>>({
    defaultValues: {
      checklist_obrigatorio: false,
      alerta_estoque_pdv: false,
      habilitar_emissao_nfe: false,
      emissao_nf_no_modulo_ordens: false,
      emissao_nf_no_modulo_vendas: false,
      emissao_nf_ordens_nao_pagas: false,
      emissao_nf_vendas_nao_pagas: false,
      emissao_nf_status_os: [...STATUS_OS_EMISSAO_PADRAO],
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
      habilitar_faturamento_os: false,
      setor_padrao_os_id: null,
      destaque_os_por_status: {},
    },
  });

  // Espelha a lista editável no campo do formulário, que é o que vai no PUT.
  const atualizarLinhasDestaque = useCallback(
    (proximas: LinhaDestaque[]) => {
      setLinhasDestaque(proximas);
      setValue("destaque_os_por_status", linhasParaRegras(proximas), {
        shouldDirty: true,
      });
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
        quotaResponse,
      ] = await Promise.all([
        fetch("/api/config", { cache: "no-store" }),
        fetch("/api/config/empresa", { cache: "no-store" }),
        fetch("/api/config/integracoes/mercadolivre", { cache: "no-store" }),
        SHOPEE_INTEGRATION_ENABLED
          ? fetch("/api/config/integracoes/shopee", { cache: "no-store" })
          : Promise.resolve(null),
        fetch("/api/tipos/setores", { cache: "no-store" }),
        fetch("/api/config/nfe", { cache: "no-store" }),
        fetch("/api/config/nfse", { cache: "no-store" }),
        fetch("/api/veiculos/cota-placas", { cache: "no-store" }),
      ]);
      const quotaData = await quotaResponse.json().catch(() => null);
      setUsoConsultasPlaca(quotaResponse.ok ? quotaData : null);
      const data = await response.json();
      const empresaData = await empresaResponse.json().catch(() => ({}));
      const mercadoLivreData = await mercadoLivreResponse
        .json()
        .catch(() => ({}));
      const shopeeData = shopeeResponse
        ? await shopeeResponse.json().catch(() => ({}))
        : {};
      const setoresData = await setoresResponse.json().catch(() => ({}));
      const nfeData = await nfeResponse.json().catch(() => ({}));
      const nfseData = await nfseResponse.json().catch(() => ({}));
      if (response.ok && data.config) {
        reset(data.config);
        setLinhasDestaque(regrasParaLinhas(data.config.destaque_os_por_status));
        window.dispatchEvent(
          new CustomEvent("erpoficina:config-updated", { detail: data.config }),
        );
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
      } else {
        setEmpresaResumo(null);
      }
      setMercadoLivreAccount(
        mercadoLivreResponse.ok ? (mercadoLivreData?.account ?? null) : null,
      );
      setShopeeIntegration(
        shopeeResponse?.ok
          ? {
              configured: Boolean(shopeeData?.configured),
              missing: shopeeData?.missing ?? [],
              account: shopeeData?.account ?? null,
            }
          : { configured: false, missing: [], account: null },
      );
      setSetores(
        setoresResponse.ok && Array.isArray(setoresData?.items)
          ? setoresData.items.map((item: any) => ({
              id: Number(item.id),
              nome: String(item.nome ?? ""),
            }))
          : [],
      );
      const garantiaDisponivel = Boolean(
        nfeResponse.ok && nfeData?.nfe && nfseResponse.ok && nfseData?.nfse,
      );
      setGarantiaFiscalDisponivel(garantiaDisponivel);
      if (garantiaDisponivel) {
        setGarantiaFiscal({
          incluirGarantiaVendaNFe: Boolean(nfeData.nfe.incluirGarantiaVendaNFe),
          incluirGarantiaVendaNFCe: Boolean(
            nfeData.nfe.incluirGarantiaVendaNFCe,
          ),
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

  const atualizarDadosMercadoLivre = async () => {
    setAtualizandoMercadoLivre(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao atualizar os dados do Mercado Livre.");
      setMercadoLivreAccount(data?.account ?? null);
      toast.success("Dados da conta Mercado Livre atualizados.");
    } catch (error: any) {
      toast.error(error?.message || "Falha ao atualizar os dados do Mercado Livre.");
    } finally {
      setAtualizandoMercadoLivre(false);
    }
  };

  const onSalvar = async (values: Partial<Config>) => {
    setSalvando(true);
    try {
      const response = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepararConfigParaSalvar(values,
          dirtyFields.habilitar_faturamento_os === true,
          defaultValues?.habilitar_faturamento_os === true)),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Erro ao salvar");

      // A configuração geral já foi salva, mesmo que uma integração fiscal
      // falhe depois. Atualiza imediatamente o formulário e o restante do app.
      reset(data.config);
      setLinhasDestaque(regrasParaLinhas(data.config.destaque_os_por_status));
      window.dispatchEvent(new CustomEvent("erpoficina:config-updated", { detail: data.config }));

      if (garantiaFiscalDisponivel) {
        const [nfeResponse, nfseResponse] = await Promise.all([
          fetch("/api/config/nfe", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nfe: {
                incluirGarantiaVendaNFe: garantiaFiscal.incluirGarantiaVendaNFe,
                incluirGarantiaVendaNFCe:
                  garantiaFiscal.incluirGarantiaVendaNFCe,
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
            [nfeData?.error, nfeData?.detalhe].filter(Boolean).join(" ") ||
              "Erro ao salvar as opções de garantia da NF-e/NFC-e.",
          );
        }
        if (!nfseResponse.ok) {
          throw new Error(
            nfseData?.error || "Erro ao salvar a opção de garantia da NFS-e.",
          );
        }

        setGarantiaFiscal((atual) => ({
          incluirGarantiaVendaNFe: Boolean(
            nfeData?.nfe?.incluirGarantiaVendaNFe,
          ),
          incluirGarantiaVendaNFCe: Boolean(
            nfeData?.nfe?.incluirGarantiaVendaNFCe,
          ),
          incluirGarantiaOsNFe: Boolean(nfeData?.nfe?.incluirGarantiaOsNFe),
          incluirGarantiaOsNFCe: Boolean(nfeData?.nfe?.incluirGarantiaOsNFCe),
          incluirGarantiaOsNFSe: Boolean(nfseData?.nfse?.incluirGarantiaOs),
          nfceConfigurada: Boolean(
            nfeData?.nfe?.nfceConfigurada ?? atual.nfceConfigurada,
          ),
        }));
      }

      toast.success("Configurações atualizadas com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao salvar configurações");
    } finally {
      setSalvando(false);
    }
  };

  const desconectarMercadoLivre = async () => {
    setDesconectandoMercadoLivre(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data?.error || "Falha ao desconectar a conta.");
      setMercadoLivreAccount(null);
      toast.success("Conta Mercado Livre desconectada.");
    } catch (error: any) {
      toast.error(
        error?.message || "Falha ao desconectar a conta Mercado Livre.",
      );
    } finally {
      setDesconectandoMercadoLivre(false);
    }
  };

  const salvarPublicacaoPadraoMercadoLivre = async (
    defaultListingTypeId: "free" | "gold_special" | "gold_pro",
  ) => {
    if (!mercadoLivreAccount) return;
    setSalvandoPublicacaoPadrao(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultListingTypeId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data?.error || "Falha ao salvar o tipo de publicação padrão.",
        );
      setMercadoLivreAccount((current) =>
        current ? { ...current, defaultListingTypeId } : current,
      );
      toast.success("Tipo de publicação padrão atualizado.");
    } catch (error: any) {
      toast.error(
        error?.message || "Falha ao salvar o tipo de publicação padrão.",
      );
    } finally {
      setSalvandoPublicacaoPadrao(false);
    }
  };

  const salvarAvisosMercadoLivre = async (
    notificationEvents: MercadoLivreNotificationEvent[],
  ) => {
    if (!mercadoLivreAccount) return;
    // Otimista: o switch responde na hora e volta atrás se o servidor recusar.
    const anterior = mercadoLivreAccount.notificationEvents;
    setMercadoLivreAccount((current) =>
      current ? { ...current, notificationEvents } : current,
    );
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEvents }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao salvar os avisos do Mercado Livre.");
    } catch (error: any) {
      setMercadoLivreAccount((current) =>
        current ? { ...current, notificationEvents: anterior } : current,
      );
      toast.error(error?.message || "Falha ao salvar os avisos do Mercado Livre.");
    }
  };

  const salvarPrecoQuantidadePadrao = async (
    enabled: boolean,
    tiers: Array<{ quantity: number; percentage: number }>,
  ) => {
    if (!mercadoLivreAccount) return false;
    setSalvandoPublicacaoPadrao(true);
    try {
      const response = await fetch("/api/config/integracoes/mercadolivre", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantityPricingDefaultEnabled: enabled,
          quantityPricingDefaultTiers: tiers,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data?.error || "Falha ao salvar o modelo de preço por quantidade.",
        );
      setMercadoLivreAccount((current) =>
        current
          ? {
              ...current,
              quantityPricingDefaultEnabled: Boolean(
                data.quantityPricingDefaultEnabled,
              ),
              quantityPricingDefaultTiers: Array.isArray(
                data.quantityPricingDefaultTiers,
              )
                ? data.quantityPricingDefaultTiers
                : [],
            }
          : current,
      );
      toast.success(
        enabled
          ? "Modelo de preço por quantidade atualizado."
          : "Preenchimento padrão desativado.",
      );
      return true;
    } catch (error: any) {
      toast.error(
        error?.message || "Falha ao salvar o modelo de preço por quantidade.",
      );
      return false;
    } finally {
      setSalvandoPublicacaoPadrao(false);
    }
  };

  const desconectarShopee = async () => {
    setDesconectandoShopee(true);
    try {
      const response = await fetch("/api/config/integracoes/shopee", {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data?.error || "Falha ao desconectar a loja.");
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
    limitePlacas > 0
      ? Math.min(100, Math.round((usadasPlacas / limitePlacas) * 100))
      : 100;

  return (
    <div className="container mx-auto min-w-0 max-w-7xl space-y-5 px-3 py-1 animate-in fade-in duration-500 sm:space-y-6 sm:px-6 lg:px-8">
      <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card px-4 py-4 shadow-sm sm:px-5 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <Settings className="size-6 shrink-0 text-primary sm:size-8" />
            Configurações Gerais
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Gerencie o comportamento global do sistema, módulos fiscais e
            alertas do PDV.
          </p>
        </div>
        <Button
          onClick={handleSubmit(onSalvar)}
          disabled={salvando}
          className="w-full shrink-0 shadow-md transition-all hover:shadow-lg sm:w-auto"
        >
          {salvando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Salvar Alterações
        </Button>
      </div>

      <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm">
        <CardHeader className="bg-primary/5 py-4">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            <CardTitle>Empresa e integrações de marketplace</CardTitle>
          </div>
          <CardDescription>
            Conecte as contas vendedoras que serão operadas pelo ERP.
          </CardDescription>
        </CardHeader>
        <CardContent
          className={`grid min-w-0 gap-0 p-0 ${SHOPEE_INTEGRATION_ENABLED ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}
        >
          <section className="flex min-h-36 min-w-0 flex-col justify-between gap-3 border-b p-4 lg:border-b-0 lg:border-r">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Empresa do ERP
                </p>
                <p className="mt-1 truncate text-base font-semibold">
                  {empresaResumo?.nome || "Não configurada"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {empresaResumo?.cnpj || "CNPJ não informado"}
                </p>
              </div>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-auto w-full min-w-0 whitespace-normal bg-transparent py-2 text-center sm:w-fit"
            >
              <Link href="/configuracoes/empresa">
                Alterar dados da empresa
              </Link>
            </Button>
          </section>

          <MarketplaceConnectionCard
            icon={<Store className="h-5 w-5" />}
            iconClass="bg-amber-500/15 text-amber-700 dark:text-amber-400"
            name="Mercado Livre"
            connected={Boolean(
              mercadoLivreAccount && !mercadoLivreAccount.needsReconnect,
            )}
            title={
              mercadoLivreAccount?.nickname ||
              (mercadoLivreAccount
                ? `Usuário ${mercadoLivreAccount.userId}`
                : "Nenhuma conta conectada")
            }
            description={
              mercadoLivreAccount
                ? mercadoLivreAccount.needsReconnect
                  ? "Reconexão necessária"
                  : `User ID ${mercadoLivreAccount.userId}`
                : "Autorize uma conta vendedora para publicar e receber pedidos."
            }
            badges={
              mercadoLivreAccount?.sellerProfile &&
              !mercadoLivreAccount.sellerProfile.error
                ? [
                    mercadoLivreAccount.sellerProfile.sellingAllowed === false
                      ? "Vendas bloqueadas"
                      : null,
                  ].filter((value): value is string => Boolean(value))
                : []
            }
            details={
              mercadoLivreAccount?.shipping &&
              !mercadoLivreAccount.needsReconnect
                ? mercadoLivreAccount.shipping.mercadoEnviosEnabled
                  ? "Mercado Envios habilitado"
                  : "Mercado Envios não habilitado"
                : null
            }
            connectHref="/api/integracoes/mercadolivre/auth"
            connectLabel={
              mercadoLivreAccount
                ? mercadoLivreAccount.needsReconnect
                  ? "Reconectar"
                  : "Trocar conta"
                : "Conectar conta"
            }
            onDisconnect={
              mercadoLivreAccount ? desconectarMercadoLivre : undefined
            }
            disconnecting={desconectandoMercadoLivre}
            disconnectTitle="Desconectar conta Mercado Livre?"
            disconnectDescription="Os pedidos históricos serão preservados. Os vínculos dos anúncios serão removidos e precisarão ser refeitos ao conectar outra conta."
            settingsHref="#marketplace-settings"
          />

          {SHOPEE_INTEGRATION_ENABLED ? (
            <MarketplaceConnectionCard
              icon={<ShoppingBag className="h-5 w-5" />}
              iconClass="bg-orange-500/15 text-orange-700 dark:text-orange-400"
              name="Shopee"
              connected={Boolean(
                shopeeIntegration.account &&
                !shopeeIntegration.account.needsReconnect,
              )}
              title={
                shopeeIntegration.account?.shopName ||
                (shopeeIntegration.account
                  ? `Loja ${shopeeIntegration.account.shopId}`
                  : "Nenhuma loja conectada")
              }
              description={
                shopeeIntegration.account
                  ? shopeeIntegration.account.needsReconnect
                    ? "Reconexão necessária"
                    : `Shop ID ${shopeeIntegration.account.shopId} · ${shopeeIntegration.account.region}`
                  : shopeeIntegration.configured
                    ? "Autorize a loja para importar pedidos e sincronizar o catálogo."
                    : "Credenciais do aplicativo ainda não configuradas."
              }
              details={
                !shopeeIntegration.configured
                  ? `${shopeeIntegration.missing.length || 3} variável(is) de ambiente pendente(s)`
                  : "Aplicativo Shopee configurado"
              }
              connectHref="/api/integracoes/shopee/auth"
              connectLabel={
                shopeeIntegration.account
                  ? shopeeIntegration.account.needsReconnect
                    ? "Reconectar"
                    : "Trocar loja"
                  : "Conectar loja"
              }
              connectDisabled={!shopeeIntegration.configured}
              onDisconnect={
                shopeeIntegration.account ? desconectarShopee : undefined
              }
              disconnecting={desconectandoShopee}
              disconnectTitle="Desconectar loja Shopee?"
              disconnectDescription="Os pedidos históricos serão preservados. Os vínculos de produtos Shopee serão removidos."
            />
          ) : null}
        </CardContent>
      </Card>

      <MercadoLivreOperationSettingsCard
        account={mercadoLivreAccount}
        savingListingType={salvandoPublicacaoPadrao}
        refreshingAccount={atualizandoMercadoLivre}
        onListingTypeChange={(value) =>
          void salvarPublicacaoPadraoMercadoLivre(value)
        }
        onQuantityDefaultsSave={salvarPrecoQuantidadePadrao}
        onNotificationEventsChange={salvarAvisosMercadoLivre}
        onRefreshAccount={atualizarDadosMercadoLivre}
      />

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-12 lg:gap-6">
        <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-5">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <CardTitle>Consultas de placa</CardTitle>
            </div>
            <CardDescription>Cota mensal e consumo registrados na Central.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">
                  Usadas no mes
                </span>
                <p className="mt-1 text-2xl font-semibold">
                  {usoConsultasPlaca ? usadasPlacas : "-"}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">
                  Limite mensal
                </span>
                <p className="mt-1 text-2xl font-semibold">
                  {usoConsultasPlaca ? limitePlacas : "-"}
                </p>
              </div>
              <div className="rounded-lg border bg-muted/20 p-4">
                <span className="text-xs text-muted-foreground">
                  Mes vigente
                </span>
                <p className="mt-1 text-2xl font-semibold">
                  {usoConsultasPlaca?.mes || "-"}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {usoConsultasPlaca
                    ? `${usadasPlacas}/${limitePlacas}`
                    : "Sem dados"}
                </span>
                <span>{usoConsultasPlaca ? `${percentualPlacas}%` : "-"}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: usoConsultasPlaca ? `${percentualPlacas}%` : "0%",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                A cota renova mensalmente em UTC. Falhas também consomem cota; o limite é gerenciado pela Central.
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-7">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <CardTitle>Agenda de atendimento</CardTitle>
            </div>
            <CardDescription>
              Defina dias, horario de trabalho e intervalo padrao dos
              agendamentos.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Intervalo dos slots</Label>
                <Select
                  value={String(watch("agendamento_intervalo_minutos") ?? 60)}
                  onValueChange={(value) =>
                    setValue("agendamento_intervalo_minutos", Number(value), {
                      shouldDirty: true,
                    })
                  }
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
                  value={(watch("agendamento_hora_inicio") ?? "08:00").slice(
                    0,
                    5,
                  )}
                  onChange={(event) =>
                    setValue("agendamento_hora_inicio", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Fim do expediente</Label>
                <Input
                  type="time"
                  value={(watch("agendamento_hora_fim") ?? "18:00").slice(0, 5)}
                  onChange={(event) =>
                    setValue("agendamento_hora_fim", event.target.value, {
                      shouldDirty: true,
                    })
                  }
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
                        setValue("agendamento_dias_trabalho", next, {
                          shouldDirty: true,
                        });
                      }}
                    >
                      {dia.label}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Esses valores controlam a grade do calendario e a duracao padrao
                sugerida em novos agendamentos.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <CardTitle>Impressao</CardTitle>
            </div>
            <CardDescription>
              Cores usadas nos modelos de OS e orcamento de venda.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 py-6 md:grid-cols-3">
            <div className="min-w-0 space-y-2">
              <Label>Cor primaria</Label>
              <div className="flex min-w-0 gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorPrimaria, "#2563eb")}
                  onChange={(event) =>
                    setValue("impressao_cor_primaria", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                />
                <Input
                  value={impressaoCorPrimaria}
                  onChange={(event) =>
                    setValue("impressao_cor_primaria", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                  placeholder="#2563eb"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Cor secundaria</Label>
              <div className="flex min-w-0 gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorSecundaria, "#0891b2")}
                  onChange={(event) =>
                    setValue("impressao_cor_secundaria", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                />
                <Input
                  value={impressaoCorSecundaria}
                  onChange={(event) =>
                    setValue("impressao_cor_secundaria", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                  placeholder="#0891b2"
                  className="font-mono"
                />
              </div>
            </div>

            <div className="min-w-0 space-y-2">
              <Label>Cor do texto</Label>
              <div className="flex min-w-0 gap-3">
                <Input
                  type="color"
                  className="h-10 w-14 shrink-0 p-1"
                  value={colorPickerValue(impressaoCorTexto, "#ffffff")}
                  onChange={(event) =>
                    setValue("impressao_cor_texto", event.target.value, {
                      shouldDirty: true,
                    })
                  }
                />
                <Input
                  value={impressaoCorTexto}
                  onChange={(event) =>
                    setValue("impressao_cor_texto", event.target.value, {
                      shouldDirty: true,
                    })
                  }
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

        {/* DIZERES DA IMPRESSÃO DA OS */}
        <TermosImpressaoOSCard />

        {/* MÓDULO FISCAL */}
        <Card className="min-w-0 overflow-hidden border-primary/10 p-0 shadow-sm lg:col-span-12">
          <CardHeader className="bg-primary/5 py-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-primary" />
              <CardTitle>Módulo Fiscal (NF-e / NFC-e / NFS-e)</CardTitle>
            </div>
            <CardDescription>
              Configure a visibilidade, as travas de emissão e o carregamento da
              garantia nas notas fiscais.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 py-6">
            <div className="flex items-center justify-between space-x-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Label className="text-base">Habilitar Emissão de NF</Label>
                <span className="text-sm text-muted-foreground">
                  Habilita globalmente os botões e recursos de emissão de NF-e e
                  NFC-e.
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
                  Não foi possível carregar as opções de garantia fiscal.
                  Confira se a migration fiscal mais recente foi aplicada.
                </div>
              ) : null}
              <div className="space-y-4">
                <div className="flex items-center gap-2 font-medium text-sm text-primary">
                  <FileText className="h-4 w-4" /> Módulo de Vendas
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">
                      Botão de emissão de NF é exibido no módulo de Vendas.
                    </span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_vendas")}
                    onCheckedChange={(v) =>
                      setValue("emissao_nf_no_modulo_vendas", v)
                    }
                  />
                </div>
                <div className="flex items-center justify-between p-4 rounded-lg bg-muted/30 border">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label>Emitir sem Pagamento</Label>
                    <span className="text-xs text-muted-foreground">
                      Permite emissão de NF de Vendas antes do financeiro
                      baixar.
                    </span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_vendas_nao_pagas")}
                    onCheckedChange={(v) =>
                      setValue("emissao_nf_vendas_nao_pagas", v)
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
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
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label
                      htmlFor="garantia-venda-nfce"
                      className={
                        !garantiaFiscalDisponivel ||
                        !garantiaFiscal.nfceConfigurada
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
                    disabled={
                      !garantiaFiscalDisponivel ||
                      !garantiaFiscal.nfceConfigurada
                    }
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
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label>Exibir no Módulo</Label>
                    <span className="text-xs text-muted-foreground">
                      Botão de emissão de NF é exibido no módulo de Ordens.
                    </span>
                  </div>
                  <Switch
                    checked={watch("emissao_nf_no_modulo_ordens")}
                    onCheckedChange={(v) =>
                      setValue("emissao_nf_no_modulo_ordens", v)
                    }
                  />
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label>Status que permitem emitir nota</Label>
                    <span className="text-xs text-muted-foreground">
                      A emissão de NF da OS só aparece nos status marcados.
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {STATUS_OS_EMISSAO_OPCOES.map((status) => {
                      const marcados = watch("emissao_nf_status_os") ?? [];
                      const marcado = marcados.includes(status);
                      const ultimo = marcado && marcados.length === 1;
                      const id = `emissao-status-os-${status}`;
                      return (
                        <div key={status} className="flex items-start gap-2">
                          <Checkbox
                            id={id}
                            checked={marcado}
                            disabled={ultimo}
                            title={ultimo ? "Selecione pelo menos um status." : undefined}
                            onCheckedChange={(v) =>
                              setValue(
                                "emissao_nf_status_os",
                                v === true
                                  ? STATUS_OS_EMISSAO_OPCOES.filter((s) => s === status || marcados.includes(s))
                                  : marcados.filter((s) => s !== status),
                                { shouldDirty: true },
                              )
                            }
                          />
                          <Label htmlFor={id} className="flex flex-col gap-0.5 text-sm font-normal leading-tight">
                            {rotuloStatusOS(status)}
                            {status === "FATURAMENTO" ? (
                              <span className="text-xs text-muted-foreground">
                                Só ocorre com o faturamento de OS ligado.
                              </span>
                            ) : null}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
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
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label
                      htmlFor="garantia-os-nfce"
                      className={
                        !garantiaFiscalDisponivel ||
                        !garantiaFiscal.nfceConfigurada
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
                    disabled={
                      !garantiaFiscalDisponivel ||
                      !garantiaFiscal.nfceConfigurada
                    }
                    onCheckedChange={(value) =>
                      setGarantiaFiscal((atual) => ({
                        ...atual,
                        incluirGarantiaOsNFCe: value,
                      }))
                    }
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor="garantia-os-nfse">
                      Carregar informações de garantia para NFS-e
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      Carrega a garantia da OS nas informações complementares da
                      NFS-e.
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
        <div className="space-y-6 lg:col-span-5">
          <Card className="min-w-0 border-primary/10 shadow-sm">
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
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <Label>Alerta de Estoque PDV</Label>
                    <Package className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Exibe alerta em produtos sem etoque no módulo PDV.
                  </span>
                </div>
                <Switch
                  checked={watch("alerta_estoque_pdv")}
                  onCheckedChange={(v) => setValue("alerta_estoque_pdv", v)}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label>Habilitar edição de transações</Label>
                  <span className="text-xs text-muted-foreground">
                    Permite alterar transações já cadastradas no fluxo de caixa.
                  </span>
                </div>
                <Switch
                  checked={watch("habilitar_edicao_transacoes")}
                  onCheckedChange={(value) =>
                    setValue("habilitar_edicao_transacoes", value, {
                      shouldDirty: true,
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 border-primary/10 shadow-sm lg:col-span-7">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" />
              <CardTitle>{"Ordens de Servi\u00e7o"}</CardTitle>
            </div>
            <CardDescription>
              {
                "Defina os padr\u00f5es de cria\u00e7\u00e3o e o comportamento do estoque nas ordens."
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>{"Setor padr\u00e3o para cria\u00e7\u00e3o de OS"}</Label>
              <Select
                value={
                  watch("setor_padrao_os_id")
                    ? String(watch("setor_padrao_os_id"))
                    : "SEM_PADRAO"
                }
                onValueChange={(value) =>
                  setValue(
                    "setor_padrao_os_id",
                    value === "SEM_PADRAO" ? null : Number(value),
                    { shouldDirty: true },
                  )
                }
                disabled={carregandoSetores}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      carregandoSetores
                        ? "Carregando setores..."
                        : "Selecione um setor"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEM_PADRAO">
                    {"Sem setor padr\u00e3o"}
                  </SelectItem>
                  {setores.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {
                  "Esse setor vir\u00e1 selecionado nas novas ordens de servi\u00e7o e poder\u00e1 ser alterado antes de salvar."
                }
              </p>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="habilitar-faturamento-os">Habilitar etapa de faturamento nas OS</Label>
                <span className="text-xs text-muted-foreground">
                  Separa a espera pelo pagamento do registro financeiro. Ao ativar,
                  envie a OS de Pagamento para Faturamento antes de registrar novos
                  recebimentos ou títulos. Adiantamentos continuam disponíveis.
                  Ao desativar, as OS em Faturamento voltam para Pagamento,
                  preservando os lançamentos.
                </span>
              </div>
              <Switch
                id="habilitar-faturamento-os"
                checked={watch("habilitar_faturamento_os")}
                onCheckedChange={(value) => setValue("habilitar_faturamento_os", value, { shouldDirty: true })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <Label>Permitir produto avulso em OS</Label>
                <span className="text-xs text-muted-foreground">
                  Permite orçar itens temporários, que devem ser cadastrados ou
                  vinculados antes de avançar a OS.
                </span>
              </div>
              <Switch
                checked={watch("permitir_produto_avulso_os")}
                onCheckedChange={(value) =>
                  setValue("permitir_produto_avulso_os", value, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <Label>Valor médio de compra obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Exige um custo médio maior que zero ao cadastrar ou editar
                  produtos.
                </span>
              </div>
              <Switch
                checked={watch("produto_preco_medio_compra_obrigatorio")}
                onCheckedChange={(value) =>
                  setValue("produto_preco_medio_compra_obrigatorio", value, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <Label>NCM obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Exige o NCM com 8 dígitos ao cadastrar ou editar produtos.
                </span>
              </div>
              <Switch
                checked={watch("produto_ncm_obrigatorio")}
                onCheckedChange={(value) =>
                  setValue("produto_ncm_obrigatorio", value, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>Modo de baixa no estoque</Label>
              <Select
                value={watch("modo_baixa_estoque_os") ?? "ORCAMENTO"}
                onValueChange={(value) =>
                  setValue(
                    "modo_baixa_estoque_os",
                    value as Config["modo_baixa_estoque_os"],
                    { shouldDirty: true },
                  )
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

        <Card className="min-w-0 border-primary/10 shadow-sm lg:col-span-12">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Highlighter className="h-5 w-5 text-primary" />
              <CardTitle>Destacar ordens de serviço por status</CardTitle>
            </div>
            <CardDescription>
              Pinta na listagem toda OS que estiver no status escolhido. Uma cor
              por status. O destaque marcado à mão dentro da OS sempre sobrepõe
              estas regras.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {linhasDestaque.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum status destacado. As ordens aparecem com o visual padrão
                da lista.
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
                    linhasDestaque
                      .filter((_, i) => i !== indice)
                      .map((item) => item.status),
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
                          {STATUS_OS_VALIDOS.filter(
                            (status) => !statusEmUso.has(status),
                          ).map((status) => (
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
                              i === indice
                                ? { ...item, cor: value as DestaqueCor }
                                : item,
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
                                <span
                                  className={`h-3 w-3 shrink-0 rounded-full ${DESTAQUE_ESTILOS[cor.valor].amostra}`}
                                />
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
                              i === indice
                                ? { ...item, texto: event.target.value }
                                : item,
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
                          atualizarLinhasDestaque(
                            linhasDestaque.filter((_, i) => i !== indice),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>

                      {/* A cor só se explica vista como a lista mostra. */}
                      <div className="md:col-span-4">
                        <div
                          className={`rounded-sm border px-3 py-2 text-xs ${estilo.linha}`}
                        >
                          <span className="font-mono font-semibold">#1234</span>
                          <span className="mx-2 text-muted-foreground">·</span>
                          <span>
                            {linha.status
                              ? rotuloStatusOS(linha.status)
                              : "Selecione o status"}
                          </span>
                          {linha.texto.trim() ? (
                            <span className="ml-2 text-muted-foreground">
                              — {linha.texto.trim()}
                            </span>
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
                atualizarLinhasDestaque([
                  ...linhasDestaque,
                  { status: "", cor: "verde", texto: "" },
                ])
              }
            >
              <Plus className="h-4 w-4" />
              Adicionar destaque
            </Button>

            <p className="text-xs text-muted-foreground">
              Linhas sem status escolhido são descartadas ao salvar. O texto
              explicativo aparece no mesmo aviso que já mostra o motivo do
              destaque manual na listagem.
            </p>
          </CardContent>
        </Card>

        <Card className="min-w-0 border-primary/10 shadow-sm lg:col-span-12">
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
              <div className="min-w-0 flex-1 space-y-1">
                <Label>Checklist de Entrada Obrigatório</Label>
                <span className="text-xs text-muted-foreground">
                  Impede o início de uma OS sem que o veículo passe pelo
                  checklist.
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
                <strong>Dica:</strong> Ao ativar o checklist obrigatório,
                certifique-se de que todos os seus técnicos têm acesso aos
                formulários de inspeção.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
