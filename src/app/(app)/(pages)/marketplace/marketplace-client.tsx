"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import ValueInput from "@/components/ui/value-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BadgePercent,
  CarFront,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ClipboardList,
  ExternalLink,
  FileText,
  Grid2X2,
  ImageIcon,
  Info,
  Link2,
  List,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  PackageCheck,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Store,
  Trash2,
  TrendingUp,
  Unlink,
  XCircle,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { MarketplaceAttentionCenter, MarketplaceChatLauncher, MarketplaceHeader, MarketplaceListToolbar, MarketplaceLoadingLine, MarketplacePagination, MarketplaceSectionNav, useMarketplaceQueryValue, useMarketplaceSection, type MarketplaceAttentionItem } from "./marketplace-layout";
import { MarketplaceConversationPanel } from "./marketplace-conversation-panel";

type MlMarketplaceSection = "overview" | "products" | "listings" | "orders" | "performance" | "atendimento" | "logs";
const ML_MARKETPLACE_SECTIONS: readonly MlMarketplaceSection[] = ["overview", "products", "listings", "orders", "performance", "atendimento", "logs"];

type Account = {
  id: number;
  empresa_id: number;
  ml_user_id: number;
  nickname?: string | null;
  site_id: string;
  expires_at?: string | null;
  updated_at?: string | null;
  needs_reconnect?: boolean;
};

type MarketplaceSellerProfile = {
  reputationLevelId: string | null;
  reputationLabel: string;
  powerSellerStatus: string | null;
  powerSellerLabel: string | null;
};

type MarketplaceShippingAddress = {
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  types?: string[];
  source?: "account_address" | "seller_profile" | "listing";
  partial?: boolean;
};

const PRODUCT_PAGE_SIZE_OPTIONS = [12, 24, 48];

type MlOrder = {
  id: number;
  venda_id?: number | null;
  ml_order_id: number;
  status?: string | null;
  status_detail?: string | null;
  payment_status?: string | null;
  payment_status_detail?: string | null;
  order_tags?: string[] | null;
  date_closed?: string | null;
  cancel_group?: string | null;
  cancel_code?: string | null;
  cancel_description?: string | null;
  cancel_requested_by?: string | null;
  cancel_date?: string | null;
  feedback_sale?: any;
  total_amount?: number | null;
  currency_id?: string | null;
  date_created?: string | null;
  ml_shipment_id?: number | null;
  shipment_status?: string | null;
  shipment_substatus?: string | null;
  shipping_mode?: string | null;
  logistic_type?: string | null;
  tracking_number?: string | null;
  tracking_method?: string | null;
  shipment_cost?: number | null;
  shipment_label_ready?: boolean;
  shipment_label_error?: string | null;
  shipment_label_checked_at?: string | null;
  shipment_handling_deadline?: string | null;
  shipment_estimated_delivery_from?: string | null;
  shipment_estimated_delivery_to?: string | null;
  shipment_last_event_at?: string | null;
  nfe_id?: number | null;
  ml_invoice_id?: string | null;
  invoice_status?: string | null;
  invoice_fiscal_key?: string | null;
  invoice_error?: string | null;
  invoice_sent_at?: string | null;
  invoice_updated_at?: string | null;
  raw_invoice?: any;
  import_status?: string | null;
  import_locked_at?: string | null;
  import_error?: string | null;
  raw_order?: any;
  raw_payments?: any[];
  raw_shipment?: any;
  raw_shipment_costs?: any;
  raw_shipment_items?: any[];
  shipment_updated_at?: string | null;
  last_synced_at?: string | null;
  created_at?: string | null;
};

type PublishedListing = {
  id: string;
  title: string;
  status?: string | null;
  price: number;
  soldQuantity: number;
  availableQuantity: number;
  thumbnail?: string | null;
  permalink?: string | null;
  produtoId?: number | null;
};

function marketplaceOrdersRevision(orders: MlOrder[]) {
  if (orders.length === 0) return "empty";

  return orders
    .map((order) =>
      [
        order.id,
        order.status,
        order.payment_status,
        order.shipment_status,
        order.shipment_substatus,
        order.invoice_status,
        order.import_status,
        order.last_synced_at,
        order.shipment_updated_at,
        order.created_at,
      ]
        .map((value) => String(value ?? ""))
        .join(":"),
    )
    .join("|");
}

type MlNotification = {
  id: number;
  topic?: string | null;
  resource?: string | null;
  ml_user_id?: number | null;
  status?: string | null;
  error?: string | null;
  processing_attempts?: number | null;
  next_retry_at?: string | null;
  locked_at?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

type MarketplacePriceSyncLog = {
  id: number;
  produto_id?: number | null;
  ml_item_id: string;
  direction: "ERP_PARA_ML" | "ML_PARA_ERP";
  source: string;
  status: "PROCESSANDO" | "SUCESSO" | "SEM_ALTERACAO" | "ERRO";
  erp_price_before?: number | null;
  erp_price_after?: number | null;
  ml_price_before?: number | null;
  ml_price_after?: number | null;
  message?: string | null;
  created_at: string;
  completed_at?: string | null;
};

type MarketplaceSyncRun = {
  id: number;
  job_name: string;
  trigger_source: string;
  status: "PROCESSANDO" | "CONCLUIDO" | "PARCIAL" | "ERRO";
  summary?: Record<string, { total?: number; success?: number; failed?: number } | boolean | number> | null;
  error?: string | null;
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
};

type ListingPerformanceDetails = {
  produto_id: number;
  ml_item_id: string;
  title?: string | null;
  permalink?: string | null;
  status?: string | null;
  visits_total?: number | null;
  sold_quantity?: number | null;
  available_quantity?: number | null;
  picturesCount: number;
  quality: {
    available: boolean;
    score?: number | null;
    level?: string | null;
    calculatedAt?: string | null;
    actions: Array<{
      id: string;
      title: string;
      status: string;
      message?: string;
      link?: string | null;
      kind?: "quantity_price" | "same_day_shipping" | "video" | "pictures" | "description" | "attributes" | "external";
    }>;
  };
  permissions: {
    title: boolean;
    price: boolean;
    stock: boolean;
    description: boolean;
    pictures: boolean;
    attributes: boolean;
    familyControlled: boolean;
    catalogControlled: boolean;
  };
  period: {
    days: number;
    visits: number;
    orders: number;
    units: number;
    revenue: number;
    averageTicket: number;
    conversionRate: number;
    previous: { visits: number; orders: number; units: number; revenue: number; conversionRate: number };
    deltas: { visits: number; orders: number; units: number; revenue: number };
    daily: Array<{ date: string; visits: number; orders: number; units: number; revenue: number }>;
  };
};

type QuantityPricingDetails = {
  eligible: boolean;
  reason?: string | null;
  itemId: string;
  basePrice: number;
  currency: string;
  tiers: Array<{ id?: string | null; quantity: number; percentage: number }>;
  recommendations: Array<{ quantity: number; percentage: number; unitPrice: number; incoherent: boolean }>;
  defaults?: { enabled: boolean; tiers: Array<{ quantity: number; percentage: number }> };
};

type QuantityTierForm = { quantity: string; percentage: string };

type CompatibilityOption = { id: string; name: string; metric: number };
type VehicleAttributeId = "BRAND" | "MODEL" | "VEHICLE_YEAR" | "SHORT_VERSION" | "ENGINE";
type CompatibilitySelection = Partial<Record<VehicleAttributeId, CompatibilityOption>>;
type CompatibilityDetails = {
  itemId: string;
  title: string;
  categoryId: string;
  itemDomainId: string;
  vehicleDomainId: string;
  userProductId?: string | null;
  required: boolean;
  pendingSuggestions: boolean;
  available: boolean;
  unavailableReason?: string | null;
  products: Array<{
    id?: string | null;
    catalogProductId?: string | null;
    name: string;
    domainId?: string | null;
    source: string;
    total: number;
    note?: string | null;
    reputationLevel?: string | null;
  }>;
};

type MarketplaceDiagnostics = {
  status: "ok" | "warning" | "error";
  checkedAt?: string | null;
  checks: Array<{
    id: string;
    label: string;
    status: "ok" | "warning" | "error";
    message: string;
    updatedAt?: string | null;
  }>;
};

type MlClaim = {
  id: string;
  orderDbId?: number | null;
  mlOrderId?: number | null;
  status?: string | null;
  stage?: string | null;
  type?: string | null;
  reason?: string | null;
  title?: string | null;
  dueDate?: string | null;
  closedAt?: string | null;
  resolution?: string | null;
  availableActions?: any[];
  players?: any[];
  resource?: string | null;
  error?: string | null;
  raw?: any;
  returnData?: any;
  returnId?: string | null;
  returnStatus?: string | null;
  returnTrackingNumber?: string | null;
  returnShipmentId?: number | null;
  partialRefundOffers?: Array<{ amount?: number; percentage?: number }>;
  returnUpdatedAt?: string | null;
};

type MlQuestion = {
  id: number;
  itemId?: string | null;
  sellerId?: number | null;
  status?: string | null;
  text: string;
  dateCreated?: string | null;
  deletedFromListing?: boolean;
  hold?: boolean;
  suspectedSpam?: boolean;
  answer?: {
    text?: string;
    status?: string | null;
    dateCreated?: string | null;
  } | null;
  from?: {
    id?: number | null;
    answeredQuestions?: number | null;
  } | null;
};

type MlChatMessage = {
  id: string;
  text: string;
  fromUserId?: number | null;
  toUserId?: number | null;
  fromSeller: boolean;
  status?: string | null;
  dateCreated?: string | null;
};

type MlChatConversation = {
  orderDbId: number;
  vendaId?: number | null;
  mlOrderId: number;
  packId?: number | string | null;
  buyerId?: number | null;
  title: string;
  status?: string | null;
  dateCreated?: string | null;
  messages: MlChatMessage[];
  error?: string | null;
};

type ProductRow = {
  id: number;
  titulo: string;
  descricao?: string | null;
  referencia?: string | null;
  fabricante?: string | null;
  modelo?: string | null;
  codigobarras?: string | null;
  conservacao?: string | null;
  precovenda: number;
  estoque: number;
  status_estoque?: string | null;
  tituloMarketplace?: string | null;
  descricaoMarketplace?: string | null;
  imgUrl?: string | null;
  imageUrls?: string[];
  mercadolivre?: {
    id: number;
    ml_item_id: string;
    ml_variation_id?: number | null;
    title?: string | null;
    permalink?: string | null;
    status?: string | null;
    user_product_id?: string | null;
    family_id?: string | null;
    family_name?: string | null;
    domain_id?: string | null;
    catalog_product_id?: string | null;
    user_product_enabled?: boolean;
    item_tags?: string[];
    visits_total?: number | null;
    sold_quantity?: number | null;
    available_quantity?: number | null;
    listing_type_id?: string | null;
    item_condition?: string | null;
    health?: number | null;
    catalog_listing?: boolean | null;
    stop_time?: string | null;
    metrics_updated_at?: string | null;
    updated_at?: string | null;
  } | null;
};

type ViewMode = "list" | "cards";

type MarketplacePerformance = {
  periodDays: number;
  visits: number;
  orders: number;
  units: number;
  revenue: number;
  conversionRate: number;
  lifetimeVisits: number;
  lifetimeSold: number;
  collectedAt?: string | null;
  daily: Array<{ date: string; visits: number; orders: number; units: number; revenue: number }>;
};

type MarketplaceStockSync = {
  pending: number;
  failed: number;
  lastError?: string | null;
  updatedAt?: string | null;
};

const EMPTY_PERFORMANCE: MarketplacePerformance = {
  periodDays: 30,
  visits: 0,
  orders: 0,
  units: 0,
  revenue: 0,
  conversionRate: 0,
  lifetimeVisits: 0,
  lifetimeSold: 0,
  collectedAt: null,
  daily: [],
};

type CategoryOption = {
  id: string;
  name: string;
  domainId?: string | null;
  domainName?: string | null;
  path?: string | null;
  childrenCount?: number | null;
  totalItems?: number | null;
  conditionOptions?: string[] | null;
  shippingOptions?: string[] | null;
  simpleShipping?: string | null;
  shippingProfile?: string | null;
};

type MarketplaceVertical = "products" | "vehicles" | "real_estate" | "services";

type ListingTypeOption = {
  id: string;
  name: string;
  available?: boolean;
  remainingListings?: number | null;
  restrictionCode?: string | null;
  restrictionReason?: string | null;
  saleFee?: number | null;
  saleFeePercentage?: number | null;
  financingFee?: number | null;
  fixedFee?: number | null;
  netAmount?: number | null;
  exposure?: string | null;
  interestFreeInstallments?: boolean;
  paymentDescription?: string | null;
};

type ListingCommercialInfo = {
  seller: {
    canList: boolean;
    restrictions: string[];
    accountType?: string | null;
    reputationLevel?: string | null;
    powerSellerStatus?: string | null;
    immediatePaymentRequired?: boolean | null;
  } | null;
  payment: {
    managedByMercadoPago: boolean;
    methods: Array<{ id: string; name: string }>;
    note?: string | null;
  } | null;
  source?: string | null;
  error?: string | null;
};

type ShippingEligibility = {
  loaded: boolean;
  categoryModes: string[];
  userModes: string[];
  logisticOptions: string[];
  me2Restricted: boolean;
  me2Restrictions: string[];
  userShippingOption: string | null;
  defaultDimensions: { height?: number; width?: number; length?: number; weight?: number } | null;
  error: string | null;
};

type ShippingQuote = {
  currencyId: string;
  listCost: number | null;
  sellerCost: number | null;
  billableWeight: number | null;
  origin?: MarketplaceShippingAddress | null;
  raw: any;
};

type MlCategoryAttribute = {
  id: string;
  name: string;
  valueType: string;
  required: boolean;
  fixed: boolean;
  values: Array<{ id?: string; name: string }>;
  allowedUnits: Array<{ id?: string; name: string }>;
  defaultUnit?: string | null;
  hint?: string | null;
  groupName?: string | null;
  role?: "parent" | "child" | "variation" | "standard";
};

type ListingForm = {
  produtoId: string;
  title: string;
  categoryId: string;
  categoryName: string;
  categoryPath: string;
  categoryShippingOptions: string[];
  categoryVertical: MarketplaceVertical;
  price: string;
  availableQuantity: string;
  condition: "new" | "used" | "not_specified";
  listingTypeId: string;
  description: string;
  pictureUrl: string;
  brand: string;
  model: string;
  partNumber: string;
  familyName: string;
  gtin: string;
  sku: string;
  warranty: string;
  warrantyTime: string;
  shippingMode: string;
  logisticType: string;
  freeShipping: boolean;
  localPickup: boolean;
  customShippingDescription: string;
  customShippingCost: string;
  customShippingDeadlineDays: string;
  customShippingQuoteZip: string;
  widthCm: string;
  heightCm: string;
  lengthCm: string;
  weightGrams: string;
  dynamicAttributes: Record<string, string>;
};

type ListingEditForm = {
  itemId: string;
  produtoId: string;
  categoryId: string;
  listingTypeId: string;
  title: string;
  familyName: string;
  userProductId: string;
  userProductEnabled: boolean;
  price: string;
  availableQuantity: string;
  condition: "new" | "used" | "not_specified";
  description: string;
  videoUrl: string;
  pictureUrl: string;
  warranty: string;
  warrantyTime: string;
  shippingMode: string;
  logisticType: string;
  freeShipping: boolean;
  localPickup: boolean;
  widthCm: string;
  heightCm: string;
  lengthCm: string;
  weightGrams: string;
  dynamicAttributes: Record<string, string>;
};

type UserProductFamilyMember = {
  id: string;
  name: string;
  attributes: Array<{
    id?: string;
    name?: string;
    value_id?: string | null;
    value_name?: string | null;
  }>;
};

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

function formatSignedPercent(value: unknown) {
  const number = Number(value ?? 0);
  return `${number > 0 ? "+" : ""}${number.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function sellerLevelLabel(value: string) {
  const labels: Record<string, string> = {
    silver: "MercadoLíder",
    gold: "MercadoLíder Gold",
    platinum: "MercadoLíder Platinum",
  };
  return labels[value.toLowerCase()] || value;
}

function SellerReputationMeter({ levelId, label }: { levelId?: string | null; label?: string | null }) {
  const normalized = String(levelId ?? "").toLowerCase();
  const levels = [
    { key: "red", color: "bg-red-500" },
    { key: "orange", color: "bg-orange-500" },
    { key: "yellow", color: "bg-yellow-400" },
    { key: "light_green", color: "bg-lime-400" },
    { key: "green", color: "bg-emerald-500" },
  ];
  const activeIndex = normalized.includes("light_green")
    ? 3
    : normalized.includes("green")
      ? 4
      : normalized.includes("yellow")
        ? 2
        : normalized.includes("orange")
          ? 1
          : normalized.includes("red")
            ? 0
            : -1;

  if (activeIndex < 0) return null;

  return (
    <span
      className="inline-flex items-end gap-0.5 rounded-full border bg-background px-2 py-1"
      title={`Reputação Mercado Livre: ${label || "nível do vendedor"}`}
      aria-label={`Reputação Mercado Livre: ${label || "nível do vendedor"}`}
    >
      {levels.map((level, index) => (
        <span
          key={level.key}
          className={`w-2 rounded-sm ${level.color} ${index === activeIndex ? "h-3 ring-1 ring-foreground/35 ring-offset-1" : "h-1.5 opacity-35"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function shippingOriginLabel(address?: MarketplaceShippingAddress | null) {
  if (!address) return null;
  const location = [address.city, address.state].filter(Boolean).join("/");
  const digits = String(address.zipCode ?? "").replace(/\D/g, "");
  const maskedZip = digits.length === 8 ? `${digits.slice(0, 5)}-***` : digits;
  return [location || null, maskedZip ? `CEP ${maskedZip}` : null].filter(Boolean).join(" · ") || null;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

function formatCurrencyInputFromNumber(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "";
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCurrencyInput(value: string) {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function marketplaceErrorMessage(error: unknown, fallback = "Falha na comunicação com o Mercado Livre.") {
  const raw = String((error as any)?.message ?? error ?? "").trim();
  if (!raw) return fallback;
  const parsed = parseMarketplaceErrorJson(raw);
  const message = parsed || raw;

  return message
    .replaceAll("Validation error", "Erro de validação")
    .replaceAll("invalid access token", "Token inválido. Reconecte a conta Mercado Livre.")
    .replaceAll("resource not found", "Recurso não encontrado no Mercado Livre.")
    .replaceAll("forbidden", "Acesso negado pelo Mercado Livre.")
    .replaceAll("Attribute", "Atributo")
    .replaceAll("ignored because it is not modifiable", "ignorado porque não pode ser alterado")
    .replaceAll("Product Identifier", "Identificador do produto")
    .replaceAll("contains values with invalid format", "possui valor em formato inválido")
    .replaceAll("expected integer value", "valor numérico inválido")
    .replaceAll("Bad Request", "Requisição inválida");
}

function parseMarketplaceErrorJson(raw: string) {
  const jsonStart = raw.indexOf("{");
  if (jsonStart < 0) return null;

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    const causes = Array.isArray(parsed.cause) ? parsed.cause : Array.isArray(parsed.cause_list) ? parsed.cause_list : [];
    const details = causes
      .map((cause: any) => cause?.message || cause?.msg || cause?.cause || cause?.code)
      .filter(Boolean)
      .join("; ");
    return details || parsed.message || parsed.error || null;
  } catch {
    return null;
  }
}

function mapConditionFromProduct(value?: string | null): ListingForm["condition"] {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "USADO" || normalized === "RECONDICIONADO") return "used";
  if (normalized === "NOVO") return "new";
  return "not_specified";
}

function initialDynamicAttributesFromProduct(product?: ProductRow | null) {
  return {
    BRAND: product?.fabricante ?? "",
    MODEL: product?.modelo ?? "",
    PART_NUMBER: product?.referencia ?? "",
    GTIN: normalizeGtin(product?.codigobarras),
  };
}

function getListingAttributeValue(form: Pick<ListingForm, "brand" | "model" | "partNumber" | "gtin" | "dynamicAttributes">, id: string) {
  const attrId = id.toUpperCase();
  const dynamicValue = (form.dynamicAttributes[attrId] ?? "").trim();
  if (dynamicValue) return dynamicValue;
  if (attrId === "BRAND") return form.brand.trim();
  if (attrId === "MODEL") return form.model.trim();
  if (attrId === "PART_NUMBER") return form.partNumber.trim();
  if (attrId === "GTIN") return form.gtin.trim();
  return "";
}

function buildListingFamilyName(form: Pick<ListingForm, "title" | "brand" | "model" | "partNumber" | "familyName" | "dynamicAttributes" | "gtin">) {
  const manual = form.familyName.trim();
  if (manual) return manual.replace(/\s+/g, " ").trim().slice(0, 60);

  const value = [getListingAttributeValue(form, "BRAND"), getListingAttributeValue(form, "MODEL"), getListingAttributeValue(form, "PART_NUMBER")]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  return (value || form.title).replace(/\s+/g, " ").trim().slice(0, 60);
}

function normalizeGtin(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : "";
}

function isValidGtin(value?: string | null) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return false;
  const sum = [...digits.slice(0, -1)]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function parsePictureUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return false;
      }
    });
}

function formatAttributeValue(attribute: MlCategoryAttribute, values: Record<string, string>) {
  const value = values[attribute.id] ?? "";
  if (!value) return "";
  if (attribute.valueType === "number_unit") {
    const unit = values[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || "";
    return `${value}${unit ? ` ${unit}` : ""}`;
  }
  if (attribute.valueType === "boolean") {
    return value === "true" ? "Sim" : value === "false" ? "Não" : value;
  }
  return value;
}

function ControlledAttributeInput({
  attribute,
  value,
  disabled,
  onChange,
}: {
  attribute: MlCategoryAttribute;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const options = attribute.values;
  const filteredOptions = options.filter((option) => {
    const text = `${option.name} ${option.id ?? ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    setQuery(value);
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={`${listingFieldClassStatic} h-10 w-full justify-between px-3 font-normal`} disabled={disabled}>
          <span className="truncate">{value || "Selecione ou digite"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(nextValue) => {
              setQuery(nextValue);
              onChange(nextValue);
            }}
            placeholder={`Buscar ou digitar ${attribute.name.toLowerCase()}`}
          />
          <CommandList>
            <CommandEmpty>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange(query.trim());
                  setOpen(false);
                }}
              >
                Usar &quot;{query.trim()}&quot;
              </button>
            </CommandEmpty>
            <CommandGroup>
              {filteredOptions.slice(0, 80).map((option) => (
                <CommandItem
                  key={`${attribute.id}:${option.id ?? option.name}`}
                  value={option.name}
                  onSelect={() => {
                    onChange(option.name);
                    setOpen(false);
                  }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === option.name ? "opacity-100" : "opacity-0"}`} />
                  {option.name}
                </CommandItem>
              ))}
              {query.trim() && !filteredOptions.some((option) => option.name.toLowerCase() === query.trim().toLowerCase()) && (
                <CommandItem
                  value={query.trim()}
                  onSelect={() => {
                    onChange(query.trim());
                    setOpen(false);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Usar &quot;{query.trim()}&quot;
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function CompatibilityOptionInput({
  label,
  options,
  selected,
  disabled,
  loading,
  placeholder,
  onSelect,
}: {
  label: string;
  options: CompatibilityOption[];
  selected?: CompatibilityOption;
  disabled: boolean;
  loading: boolean;
  placeholder: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  const filtered = options
    .filter((option) => !normalizedQuery || `${option.name} ${option.id}`.toLocaleLowerCase("pt-BR").includes(normalizedQuery))
    .slice(0, 120);

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-10 w-full justify-between px-3 font-normal" disabled={disabled || loading}>
          {loading ? (
            <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</span>
          ) : (
            <span className={cn("truncate", !selected && "text-muted-foreground")}>{selected?.name || placeholder}</span>
          )}
          {!loading ? <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={`Buscar ${label.toLowerCase()}`} />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhuma opção encontrada.</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.name} ${option.id}`}
                  onSelect={() => { onSelect(option.id); setOpen(false); setQuery(""); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", selected?.id === option.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const listingFieldClassStatic =
  "border-border/80 bg-white shadow-sm ring-1 ring-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/40";

function statusBadge(status?: string | null) {
  const value = String(status ?? "sem_status").toUpperCase();
  const label = statusLabel(value);
  const className =
    value === "ACTIVE" || value === "PAID" || value === "APPROVED" || value === "SHIPPED" || value === "DELIVERED" || value === "CONCLUIDO" || value === "SUCESSO" || value === "SEM_ALTERACAO"
      ? "bg-emerald-600 text-white"
      : value === "READY_TO_SHIP" || value === "HANDLING"
        ? "bg-blue-600 text-white"
      : value === "PAUSED" || value === "PENDING" || value === "IN_PROCESS" || value === "PAYMENT_REQUIRED" || value === "PROCESSANDO" || value === "PARCIAL"
        ? "bg-yellow-600 text-white"
        : value === "CLOSED" || value === "CANCELLED" || value === "CANCELED" || value === "REFUNDED" || value === "CHARGED_BACK"
          ? "bg-red-600 text-white"
          : "bg-slate-600 text-white";

  return <Badge className={`text-xs ${className}`}>{label}</Badge>;
}

function statusLabel(value: string) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "Ativo",
    PAUSED: "Pausado",
    CLOSED: "Finalizado",
    PAID: "Pago",
    APPROVED: "Aprovado",
    REFUNDED: "Reembolsado",
    PAYMENT_REFUNDED: "Pagamento reembolsado",
    PARTIALLY_REFUNDED: "Reembolsado parcialmente",
    PAYMENT_PARTIALLY_REFUNDED: "Pagamento reembolsado parcialmente",
    REFUNDED_BY_SELLER: "Reembolsado pelo vendedor",
    REFUNDED_BY_MEDIATION: "Reembolsado por mediação",
    MONEY_REFUNDED: "Dinheiro reembolsado",
    CHARGED_BACK: "Estornado",
    CHARGEBACK: "Estornado",
    REVERSED: "Revertido",
    IN_PROCESS: "Em processamento",
    PAYMENT_REQUIRED: "Aguardando pagamento",
    PAYMENT_IN_PROCESS: "Pagamento em processamento",
    PARTIALLY_PAID: "Pago parcialmente",
    PENDING_CANCEL: "Cancelamento pendente",
    INVALID: "Inválido",
    PENDING_CONTINGENCY: "Pagamento em processamento",
    PENDING_REVIEW_MANUAL: "Pagamento em análise manual",
    PENDING_WAITING_PAYMENT: "Aguardando pagamento",
    PENDING_ADDITIONAL_INFO: "Aguardando informações adicionais",
    ACCREDITED: "Aprovado e creditado",
    CC_REJECTED_BAD_FILLED_CARD_NUMBER: "Número do cartão incorreto",
    CC_REJECTED_BAD_FILLED_DATE: "Validade do cartão incorreta",
    CC_REJECTED_BAD_FILLED_OTHER: "Dados do cartão incorretos",
    CC_REJECTED_BAD_FILLED_SECURITY_CODE: "Código de segurança incorreto",
    CC_REJECTED_BLACKLIST: "Pagamento recusado",
    CC_REJECTED_CALL_FOR_AUTHORIZE: "Pagamento precisa de autorização",
    CC_REJECTED_CARD_DISABLED: "Cartão desativado",
    CC_REJECTED_DUPLICATED_PAYMENT: "Pagamento duplicado",
    CC_REJECTED_HIGH_RISK: "Pagamento recusado por segurança",
    CC_REJECTED_INSUFFICIENT_AMOUNT: "Saldo insuficiente",
    CC_REJECTED_MAX_ATTEMPTS: "Limite de tentativas excedido",
    CC_REJECTED_OTHER_REASON: "Pagamento recusado",
    CONFIRMED: "Confirmado",
    NEW: "Novo",
    USED: "Usado",
    GOLD_SPECIAL: "Clássico",
    GOLD_PRO: "Premium",
    GOLD: "Ouro",
    SILVER: "Prata",
    BRONZE: "Bronze",
    FREE: "Grátis",
    CANCELLED: "Cancelado",
    CANCELED: "Cancelado",
    READY_TO_SHIP: "Pronto para envio",
    HANDLING: "Em preparação",
    SHIPPED: "Enviado",
    DELIVERED: "Entregue",
    PENDING: "Pendente",
    OPENED: "Aberta",
    OPEN: "Aberta",
    UNDER_REVIEW: "Em análise",
    CLOSED_BY_MEDIATION: "Encerrada por mediação",
    NOT_DELIVERED: "Não entregue",
    OUT_FOR_DELIVERY: "Saiu para entrega",
    RECEIVER_ABSENT: "Destinatário ausente",
    DANGEROUS_AREA: "Área de entrega com risco",
    BAD_ADDRESS: "Endereço incorreto",
    UNAUTHORIZED_RECEIVER: "Recebedor não autorizado",
    RETURNING_TO_SENDER: "Em devolução ao vendedor",
    WAITING_FOR_WITHDRAWAL: "Aguardando retirada",
    SHIPPED_OUTSIDE_ME: "Enviado fora do Mercado Envios",
    SHIPPED_OUTSIDE_ME_TRUSTED: "Enviado fora do Mercado Envios",
    INVOICE_PENDING: "Aguardando nota fiscal",
    READY_TO_PRINT: "Pronto para imprimir",
    WAITING_FOR_LABEL_GENERATION: "Gerando etiqueta",
    PRINTED: "Etiqueta impressa",
    PICKED_UP: "Coletado pela transportadora",
    AUTHORIZED_BY_CARRIER: "Autorizado pela transportadora",
    IN_HUB: "No centro de distribuição",
    RETURNED_TO_SENDER: "Devolvido ao vendedor",
    DELIVERY_FAILED: "Falha na entrega",
    BUYER_CANCELED: "Cancelado pelo comprador",
    BUYER_CANCELLED: "Cancelado pelo comprador",
    SELLER_CANCELED: "Cancelado pelo vendedor",
    SELLER_CANCELLED: "Cancelado pelo vendedor",
    CLAIM_OPENED: "Reclamação aberta",
    CLAIM_CLOSED: "Reclamação encerrada",
    MEDIATION: "Em mediação",
    RESOLVED: "Resolvido",
    RESOLVED_BY_MEDIATION: "Resolvido por mediação",
    REFUND: "Reembolsar",
    FULL_REFUND: "Reembolso integral",
    PARTIAL_REFUND: "Reembolso parcial",
    ALLOW_REFUND: "Autorizar reembolso",
    RETURN: "Devolução",
    RETURN_PRODUCT: "Devolver produto",
    ACCEPT_RETURN: "Aceitar devolução",
    ALLOW_RETURN: "Autorizar devolução",
    RETURN_REVIEW_OK: "Confirmar produto devolvido",
    RETURN_REVIEW_FAIL: "Informar problema na devolução",
    ALLOW_PARTIAL_REFUND: "Oferecer reembolso parcial",
    PARTIAL_REFUND_ACCEPTED: "Reembolso parcial aceito",
    PARTIAL_REFUND_REJECTED: "Reembolso parcial recusado",
    SEND_MESSAGE: "Enviar mensagem",
    PROVIDE_EVIDENCE: "Enviar evidências",
    CLOSE_CLAIM: "Encerrar reclamação",
    CREDIT_CARD: "Cartão de crédito",
    DEBIT_CARD: "Cartão de débito",
    ACCOUNT_MONEY: "Saldo no Mercado Pago",
    TICKET: "Boleto",
    BANK_TRANSFER: "Transferência bancária",
    PIX: "Pix",
    DROP_OFF: "Postagem em agência",
    XD_DROP_OFF: "Postagem em ponto de despacho",
    CROSS_DOCKING: "Coleta do Mercado Envios",
    SELF_SERVICE: "Mercado Envios Flex",
    FULFILLMENT: "Mercado Envios Full",
    RECEBIDA: "Recebida",
    PENDENTE: "Pendente",
    PROCESSANDO: "Processando",
    PROCESSADA: "Processada",
    CONCLUIDO: "Concluído",
    PARCIAL: "Concluído com falhas",
    IMPORTADA: "Importada",
    IGNORADA: "Ignorada",
    ERRO: "Erro",
    SUCESSO: "Sucesso",
    SEM_ALTERACAO: "Sem alteração",
    NOT_SPECIFIED: "Não especificado",
    CUSTOM: "Envio personalizado",
    ME2: "Mercado Envios",
    SEM_STATUS: "Sem status",
  };

  if (labels[normalized]) return labels[normalized];

  const words: Record<string, string> = {
    PAYMENT: "pagamento",
    REFUNDED: "reembolsado",
    REFUND: "reembolso",
    PARTIAL: "parcial",
    CLOSED: "encerrado",
    OPEN: "aberto",
    OPENED: "aberto",
    CANCELLED: "cancelado",
    CANCELED: "cancelado",
    APPROVED: "aprovado",
    PENDING: "pendente",
    SELLER: "vendedor",
    BUYER: "comprador",
    BY: "pelo",
    MEDIATION: "mediação",
    RETURN: "devolução",
    PRODUCT: "produto",
    SHIPPING: "envio",
    SHIPMENT: "envio",
    DELIVERED: "entregue",
    SHIPPED: "enviado",
    NOT: "não",
    AVAILABLE: "disponível",
    ACCEPT: "aceitar",
    SEND: "enviar",
    MESSAGE: "mensagem",
  };
  const translated = normalized
    .split("_")
    .filter(Boolean)
    .map((part) => words[part] ?? part.toLowerCase())
    .join(" ");

  return translated ? translated.charAt(0).toUpperCase() + translated.slice(1) : "Sem status";
}

function rawStatusLabel(value?: string | null) {
  return statusLabel(String(value ?? "sem_status"));
}

function shippingLogisticLabel(value: string) {
  const labels: Record<string, string> = {
    drop_off: "Postagem em agência",
    xd_drop_off: "Postagem em ponto de despacho",
    cross_docking: "Coleta do Mercado Envios",
    self_service: "Mercado Envios Flex",
    fulfillment: "Mercado Envios Full",
    default: "Logística padrão",
  };
  return labels[value] ?? rawStatusLabel(value);
}

function optionalStatusLabel(value?: string | null) {
  return value ? rawStatusLabel(value) : "-";
}

function marketplaceTextLabel(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  const looksLikeMarketplaceEnglish = /\b(payment|refund(?:ed)?|buyer|seller|claim|return|cancel(?:led|ed)?|closed|opened|mediation)\b/i.test(text);
  const looksLikeCode = /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(text);
  return looksLikeMarketplaceEnglish || looksLikeCode ? statusLabel(text) : text;
}

function syncRunErrorLabel(value?: string | null) {
  const text = String(value ?? "").trim();
  if (/\b429\b|rate[ _-]?limit(?:ed)?/i.test(text)) {
    return "Limite temporário de consultas do Mercado Livre atingido. A rotina tentará novamente.";
  }
  return marketplaceTextLabel(text);
}

function getPaymentDescription(payment: any) {
  return [payment?.payment_method_id, payment?.payment_type, payment?.status_detail]
    .filter(Boolean)
    .map((value) => rawStatusLabel(String(value)))
    .join(" · ");
}

function formatOrderAddress(address: any) {
  if (!address) return "-";
  return [
    [address.street_name, address.street_number].filter(Boolean).join(", "),
    address.comment,
    address.neighborhood?.name || address.neighborhood,
    address.city?.name || address.city,
    address.state?.name || address.state,
    address.zip_code,
  ]
    .filter(Boolean)
    .join(" - ") || "-";
}

function getOrderPayments(rawOrder: any) {
  return Array.isArray(rawOrder?.payments) ? rawOrder.payments : [];
}

function getStoredOrderPayments(order: MlOrder) {
  return Array.isArray(order.raw_payments) && order.raw_payments.length > 0 ? order.raw_payments : getOrderPayments(order.raw_order);
}

function getOrderPaymentStatus(order: MlOrder) {
  const fromColumn = order.payment_status || order.payment_status_detail;
  if (fromColumn) return String(fromColumn);

  const payments = getStoredOrderPayments(order);
  const payment = payments.find((item: any) => item?.status) ?? payments[0];
  return payment?.status || payment?.status_detail || null;
}

function isPartiallyRefundedOrder(order: MlOrder) {
  const values = [order.status, order.payment_status, order.payment_status_detail, ...(order.order_tags ?? [])]
    .map((value) => String(value ?? "").toLowerCase());
  return values.some((value) => value.includes("partial") && value.includes("refund"));
}

function isRefundedOrder(order: MlOrder) {
  const status = String(order.status ?? "").toLowerCase();
  const paymentStatus = String(order.payment_status ?? "").toLowerCase();
  const paymentDetail = String(order.payment_status_detail ?? "").toLowerCase();
  const tags = [...(Array.isArray(order.order_tags) ? order.order_tags : []), ...(Array.isArray(order.raw_order?.tags) ? order.raw_order.tags : [])].map((tag) =>
    String(tag).toLowerCase(),
  );

  if (isPartiallyRefundedOrder(order)) return false;
  return (
    ["cancelled", "canceled", "invalid"].includes(status) ||
    Boolean(order.cancel_code || order.feedback_sale?.fulfilled === false) ||
    paymentStatus === "refunded" ||
    paymentStatus.includes("charged_back") ||
    paymentDetail.includes("refunded") ||
    paymentDetail.includes("chargeback") ||
    tags.some((tag) => ["cancelled", "canceled", "unfulfilled", "not_fulfilled"].includes(tag))
  );
}

function getRefundablePayment(order: MlOrder) {
  if (isRefundedOrder(order)) return null;
  const payments = getStoredOrderPayments(order).filter((payment: any) => payment?.id);
  return (
    payments.find((payment: any) => ["approved", "paid"].includes(String(payment.status ?? "").toLowerCase())) ??
    payments.find((payment: any) => !["refunded", "charged_back", "cancelled", "canceled"].includes(String(payment.status ?? "").toLowerCase())) ??
    null
  );
}

function isActiveClaim(claim?: MlClaim | null) {
  if (!claim) return false;
  const status = String(claim.status ?? "").toLowerCase();
  const stage = String(claim.stage ?? "").toLowerCase();
  const closedAt = Boolean(claim.closedAt);
  return !closedAt && !["closed", "closed_by_mediation", "cancelled", "canceled", "resolved"].some((value) => status.includes(value) || stage.includes(value));
}

type SupportedClaimAction = {
  id: "refund" | "partial_refund" | "allow_return" | "return_review_ok";
  label: string;
  confirmation: string;
  destructive?: boolean;
};

function getClaimActionName(action: any) {
  return String(action?.action ?? action?.type ?? action?.name ?? action ?? "").trim().toLowerCase();
}

function getSupportedClaimActions(claim: MlClaim): SupportedClaimAction[] {
  const available = new Set((Array.isArray(claim.availableActions) ? claim.availableActions : []).map(getClaimActionName).filter(Boolean));
  const actions: SupportedClaimAction[] = [];

  if (available.has("refund") || available.has("allow_refund")) {
    actions.push({
      id: "refund",
      label: "Reembolsar integralmente",
      confirmation: "Este procedimento devolve integralmente o pagamento ao comprador e não pode ser desfeito.",
      destructive: true,
    });
  }
  if ((available.has("allow_partial_refund") || available.has("partial_refund")) && (claim.partialRefundOffers?.length ?? 0) > 0) {
    actions.push({
      id: "partial_refund",
      label: "Oferecer reembolso parcial",
      confirmation: "O comprador receberá uma proposta de reembolso parcial com o percentual selecionado.",
    });
  }
  if (available.has("allow_return") || available.has("return_product")) {
    actions.push({
      id: "allow_return",
      label: "Autorizar devolução",
      confirmation: "O comprador será autorizado a devolver o produto conforme o fluxo do Mercado Livre.",
    });
  }
  if (available.has("return_review_ok")) {
    actions.push({
      id: "return_review_ok",
      label: "Confirmar produto devolvido",
      confirmation: "Confirme somente se o produto devolvido já foi recebido e conferido.",
    });
  }

  return actions;
}

function getOrderPackId(rawOrder: any) {
  return rawOrder?.pack_id || rawOrder?.pack?.id || null;
}

function getOrderCancellationHint(order: MlOrder) {
  const status = String(order.status ?? order.raw_order?.status ?? "").toLowerCase();
  const paymentStatus = getOrderPaymentStatus(order);
  const tags = [...(Array.isArray(order.order_tags) ? order.order_tags : []), ...(Array.isArray(order.raw_order?.tags) ? order.raw_order.tags : [])].map((tag) =>
    String(tag).toLowerCase(),
  );
  if (String(order.status ?? "").toLowerCase() === "pending_cancel") {
    return "O cancelamento foi solicitado e ainda está sendo processado pelo Mercado Livre.";
  }
  if (isPartiallyRefundedOrder(order)) {
    return `Este pedido possui reembolso parcial${paymentStatus ? ` (${rawStatusLabel(paymentStatus)})` : ""}. A venda permanece ativa para fins de estoque.`;
  }
  if (order.cancel_description || order.cancel_code) {
    const requestedBy = order.cancel_requested_by ? ` Solicitado por ${rawStatusLabel(order.cancel_requested_by)}.` : "";
    return `${marketplaceTextLabel(order.cancel_description || order.cancel_code)}.${requestedBy}`;
  }
  if (isRefundedOrder(order)) {
    return `Este pedido possui indicação de cancelamento ou reembolso${paymentStatus ? ` (${rawStatusLabel(paymentStatus)})` : ""}.`;
  }
  if (status.includes("cancel") || tags.some((tag) => tag.includes("cancel"))) {
    return "Este pedido veio do Mercado Livre com indicação de cancelamento.";
  }
  if (tags.some((tag) => tag.includes("claim") || tag.includes("mediation"))) {
    return "Há indicação de disputa no pedido. A consulta detalhada de reclamações precisa ser feita pelo endpoint de Claims.";
  }
  return "Nenhum cancelamento ou reclamação foi identificado nos dados importados deste pedido.";
}

function canCancelSale(order: MlOrder, hasActiveClaim: boolean) {
  const status = String(order.status ?? "").toLowerCase();
  const shipmentStatus = getOrderShipmentStatus(order);
  return (
    !hasActiveClaim &&
    !isRefundedOrder(order) &&
    status !== "pending_cancel" &&
    !["shipped", "delivered"].includes(shipmentStatus ?? "") &&
    order.feedback_sale?.fulfilled !== false
  );
}

function getOrderItems(order: MlOrder) {
  return Array.isArray(order.raw_order?.order_items) ? order.raw_order.order_items : [];
}

function getPrimaryOrderItem(order: MlOrder) {
  return getOrderItems(order)[0] ?? null;
}

function getOrderItemTitle(order: MlOrder) {
  const item = getPrimaryOrderItem(order);
  return item?.item?.title || item?.title || "Item Mercado Livre";
}

function getOrderItemSku(order: MlOrder) {
  const item = getPrimaryOrderItem(order);
  return item?.item?.seller_sku || item?.item?.seller_custom_field || item?.seller_sku || "-";
}

function getOrderItemImage(order: MlOrder) {
  const item = getPrimaryOrderItem(order);
  return item?.item?.thumbnail || item?.thumbnail || item?.item?.secure_thumbnail || null;
}

function getOrderItemQuantity(order: MlOrder) {
  return Number(getPrimaryOrderItem(order)?.quantity ?? 1);
}

function isMercadoEnviosOrder(order: MlOrder) {
  const mode = String(order.shipping_mode ?? order.raw_shipment?.mode ?? order.raw_order?.shipping?.mode ?? "").toLowerCase();
  const logisticType = String(order.logistic_type ?? order.raw_shipment?.logistic_type ?? "").trim();
  return Boolean(order.ml_shipment_id && mode === "me2" && logisticType);
}

function canSendInvoiceToMercadoLivre(order: MlOrder) {
  const supportedLogistics = new Set(["drop_off", "xd_drop_off", "xd_same_day", "cross_docking"]);
  return isMercadoEnviosOrder(order) && supportedLogistics.has(String(order.logistic_type ?? "").toLowerCase());
}

function isInvoiceSent(order: MlOrder) {
  const status = String(order.invoice_status ?? "").toLowerCase();
  return Boolean(order.invoice_sent_at || order.ml_invoice_id || ["sent", "accepted", "approved", "ready_to_print", "processed"].includes(status));
}

function canPrintMercadoLivreLabel(order: MlOrder) {
  if (!isMercadoEnviosOrder(order)) return false;
  if (order.shipment_label_checked_at) return order.shipment_label_ready === true;
  return getOrderShipmentStatus(order) === "ready_to_ship" && ["ready_to_print", "printed"].includes(String(order.shipment_substatus ?? "").toLowerCase());
}

function getOrderShipmentStatus(order: MlOrder) {
  return String(order.shipment_status || order.raw_shipment?.status || "").toLowerCase() || null;
}

function isPaidOrder(order: MlOrder) {
  const status = String(getOrderPaymentStatus(order) ?? order.status ?? "").toLowerCase();
  return ["paid", "approved"].includes(status);
}

function getOrderBuyerLabel(order: MlOrder) {
  const buyer = order.raw_order?.buyer;
  return [buyer?.first_name, buyer?.last_name].filter(Boolean).join(" ") || buyer?.nickname || (buyer?.id ? `Cliente #${buyer.id}` : "Comprador");
}

function formatMarketplaceOrderDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const dateLabel = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(date).replace(".", "");
  const timeLabel = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${dateLabel} ${timeLabel} hs`;
}

function getOrderOperationalState(order: MlOrder, claim?: MlClaim | null) {
  if (order.import_status === "ERRO" || (order.import_error && !order.venda_id)) {
    return {
      title: "Falha ao importar a venda no ERP",
      description: marketplaceTextLabel(order.import_error || "Sincronize novamente para tentar importar este pedido."),
      tone: "danger" as const,
      action: "Tentar novamente",
      actionType: "sync" as const,
    };
  }

  if (claim && isActiveClaim(claim)) {
    return {
      title: claim?.title ? marketplaceTextLabel(claim.title) : "Reclamação aberta. Atenda a solicitação do comprador",
      description: claim?.reason
        ? marketplaceTextLabel(claim.reason)
        : claim?.error
          ? marketplaceTextLabel(claim.error)
          : "Abra os detalhes para acompanhar a reclamação e as próximas ações.",
      tone: "danger" as const,
      action: "Atender reclamação",
      actionType: "details" as const,
    };
  }

  if (claim && !isActiveClaim(claim)) {
    return {
      title: "Reclamação encerrada",
      description: claim.resolution ? `Resolução: ${rawStatusLabel(claim.resolution)}.` : "A reclamação já foi encerrada no Mercado Livre.",
      tone: "default" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (String(order.status ?? "").toLowerCase() === "pending_cancel") {
    return {
      title: "Cancelamento em processamento",
      description: getOrderCancellationHint(order),
      tone: "warning" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (isPartiallyRefundedOrder(order)) {
    return {
      title: "Pedido com reembolso parcial",
      description: getOrderCancellationHint(order),
      tone: "warning" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (isRefundedOrder(order)) {
    return {
      title: "Pedido cancelado ou reembolsado",
      description: getOrderCancellationHint(order),
      tone: "danger" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (!isPaidOrder(order)) {
    return {
      title: "Aguardando confirmação do pagamento",
      description: "O pedido ainda não está liberado para preparação e envio.",
      tone: "warning" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  const shipmentStatus = getOrderShipmentStatus(order);
  if (shipmentStatus === "delivered") {
    return {
      title: "Pedido entregue",
      description: order.tracking_number ? `Entrega concluída. Rastreio ${order.tracking_number}.` : "A entrega foi confirmada pelo Mercado Livre.",
      tone: "success" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (shipmentStatus === "shipped") {
    return {
      title: "Pedido enviado",
      description: order.tracking_number
        ? `Enviado por ${rawStatusLabel(order.tracking_method)}. Rastreio ${order.tracking_number}.`
        : "O envio foi comunicado ao Mercado Livre.",
      tone: "success" as const,
      action: "Ver rastreio",
      actionType: "details" as const,
    };
  }

  if (["not_delivered", "cancelled", "canceled"].includes(shipmentStatus ?? "")) {
    return {
      title: shipmentStatus === "not_delivered" ? "Entrega não concluída" : "Envio cancelado",
      description: order.shipment_substatus ? rawStatusLabel(order.shipment_substatus) : "Consulte os detalhes retornados pelo Mercado Livre.",
      tone: "danger" as const,
      action: "Ver detalhes",
      actionType: "details" as const,
    };
  }

  if (canSendInvoiceToMercadoLivre(order) && String(order.shipment_substatus ?? "").toLowerCase() === "invoice_pending" && !isInvoiceSent(order)) {
    return {
      title: "NF-e necessária para liberar a etiqueta",
      description: "Emita e autorize a NF-e da venda no ERP e envie o XML ao Mercado Livre.",
      tone: "warning" as const,
      action: "Enviar NF-e",
      actionType: "invoice" as const,
    };
  }

  if (isMercadoEnviosOrder(order)) {
    const handling = shipmentStatus === "handling";
    const labelReady = canPrintMercadoLivreLabel(order);
    return {
      title: labelReady ? "Pronto para enviar pelo Mercado Envios" : handling ? "Pedido em preparação" : "Aguardando liberação da etiqueta",
      description: labelReady
        ? order.tracking_number ? `Rastreio ${order.tracking_number}.` : "Imprima a etiqueta para postar ou despachar o pedido."
        : order.shipment_label_error || "Sincronize o envio para consultar a próxima ação liberada pelo Mercado Livre.",
      tone: labelReady ? ("default" as const) : ("warning" as const),
      action: labelReady ? "Imprimir etiqueta" : "Sincronizar envio",
      actionType: labelReady ? ("label" as const) : ("sync_shipment" as const),
    };
  }

  if (order.ml_shipment_id) {
    return {
      title: order.tracking_number ? "Rastreio registrado, envio ainda não confirmado" : "Envio personalizado aguardando postagem",
      description: order.tracking_number ? `Rastreio ${order.tracking_number}` : "Este pedido não gera etiqueta do Mercado Livre. Registre rastreio e transportadora no ERP.",
      tone: order.tracking_number ? ("warning" as const) : ("default" as const),
      action: order.tracking_number ? "Confirmar envio" : "Registrar envio",
      actionType: "custom" as const,
    };
  }

  return {
    title: "Mercado Envios pendente",
    description: "O Mercado Livre ainda não retornou um envio para este pedido. Sincronize novamente; se continuar sem envio, o anúncio/compra foi concluído fora do Mercado Envios.",
    tone: "default" as const,
    action: "Sincronizar pedido",
    actionType: "sync" as const,
  };
}

function questionStatusBadge(status?: string | null) {
  const value = String(status ?? "sem_status").toUpperCase();
  const label =
    value === "UNANSWERED"
      ? "Pendente"
      : value === "ANSWERED"
        ? "Respondida"
        : value === "BANNED"
          ? "Bloqueada"
          : value === "CLOSED_UNANSWERED"
            ? "Fechada sem resposta"
            : value === "UNDER_REVIEW"
              ? "Em análise"
              : value
                  .toLowerCase()
                  .split("_")
                  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                  .join(" ");
  const className =
    value === "UNANSWERED"
      ? "bg-yellow-600 text-white"
      : value === "ANSWERED"
        ? "bg-emerald-600 text-white"
        : value === "BANNED" || value === "CLOSED_UNANSWERED" || value === "DELETED"
          ? "bg-red-600 text-white"
          : "bg-slate-600 text-white";

  return <Badge className={`text-xs ${className}`}>{label}</Badge>;
}

function stockStatusBadge(status?: string | null, stock?: number | null) {
  const value = String(status ?? (Number(stock ?? 0) <= 0 ? "SEM_ESTOQUE" : "OK")).toUpperCase();
  const label = value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const className =
    value === "OK"
      ? "bg-emerald-600 text-white"
      : value === "BAIXO"
        ? "bg-yellow-600 text-white"
        : value === "CRITICO" || value === "SEM_ESTOQUE"
          ? "bg-red-600 text-white"
          : "bg-slate-600 text-white";

  return <Badge className={`text-xs ${className}`}>{label}</Badge>;
}

function ProductImage({ product, showControls = false }: { product: ProductRow; showControls?: boolean }) {
  const imageUrls = useMemo(
    () => Array.from(new Set([...(product.imageUrls ?? []), product.imgUrl].filter(Boolean) as string[])),
    [product.imageUrls, product.imgUrl],
  );
  const [imageIndex, setImageIndex] = useState(0);
  const displayedImageIndex = Math.min(imageIndex, Math.max(imageUrls.length - 1, 0));
  const imageUrl = imageUrls[displayedImageIndex];
  const hasMultipleImages = showControls && imageUrls.length > 1;

  function showPreviousImage() {
    setImageIndex((current) => (current === 0 ? imageUrls.length - 1 : current - 1));
  }

  function showNextImage() {
    setImageIndex((current) => (current + 1) % imageUrls.length);
  }

  if (imageUrl) {
    return (
      <div className="group relative h-full w-full bg-muted/60">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={product.tituloMarketplace || product.titulo}
          className="h-full w-full object-contain"
        />
        {hasMultipleImages && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute left-1 top-1/2 h-7 w-7 -translate-y-1/2 opacity-90 shadow-sm"
              onClick={showPreviousImage}
              aria-label="Imagem anterior"
              title="Imagem anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 opacity-90 shadow-sm"
              onClick={showNextImage}
              aria-label="Próxima imagem"
              title="Próxima imagem"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
              {displayedImageIndex + 1}/{imageUrls.length}
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      <ImageIcon className="h-5 w-5" />
    </div>
  );
}

export default function MarketplacePage() {
  const ordersRevisionRef = useRef<string | null>(null);
  const checkingOrdersRevisionRef = useRef(false);
  const claimsLoadedForAccountRef = useRef<number | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sellerProfile, setSellerProfile] = useState<MarketplaceSellerProfile | null>(null);
  const [shippingAddress, setShippingAddress] = useState<MarketplaceShippingAddress | null>(null);
  const [orders, setOrders] = useState<MlOrder[]>([]);
  const [notifications, setNotifications] = useState<MlNotification[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<MlNotification | null>(null);
  const [syncRuns, setSyncRuns] = useState<MarketplaceSyncRun[]>([]);
  const [priceSyncLogs, setPriceSyncLogs] = useState<MarketplacePriceSyncLog[]>([]);
  const [diagnostics, setDiagnostics] = useState<MarketplaceDiagnostics>({ status: "warning", checkedAt: null, checks: [] });
  const [claims, setClaims] = useState<MlClaim[]>([]);
  const [questions, setQuestions] = useState<MlQuestion[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [performance, setPerformance] = useState<MarketplacePerformance>(EMPTY_PERFORMANCE);
  const [stockSync, setStockSync] = useState<MarketplaceStockSync>({ pending: 0, failed: 0, lastError: null, updatedAt: null });
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useMarketplaceSection(ML_MARKETPLACE_SECTIONS, "overview");
  const [orderSearch, setOrderSearch] = useMarketplaceQueryValue("ml_pedido_busca");
  const [orderStatusFilter, setOrderStatusFilter] = useMarketplaceQueryValue("ml_pedido_status", "all");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [questionStatusFilter, setQuestionStatusFilter] = useState("UNANSWERED");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [productsPage, setProductsPage] = useState(1);
  const [productsPageSize, setProductsPageSize] = useState(12);
  const [listingsPage, setListingsPage] = useState(1);
  const [listingsPageSize, setListingsPageSize] = useState(20);
  const [listingsFilter, setListingsFilter] = useState("all");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChatMessage, setSendingChatMessage] = useState(false);
  const [chatConversations, setChatConversations] = useState<MlChatConversation[]>([]);
  const [selectedChatOrderId, setSelectedChatOrderId] = useState<number | null>(null);
  const [chatMessageText, setChatMessageText] = useState("");
  const [customShipmentForm, setCustomShipmentForm] = useState({
    carrier: "CORREIOS",
    trackingCode: "",
    trackingUrl: "",
    deadline: "",
    markAsShipped: true,
    notifyBuyer: true,
  });
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [linkingProductId, setLinkingProductId] = useState<number | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [publishedListings, setPublishedListings] = useState<PublishedListing[]>([]);
  const [loadingPublishedListings, setLoadingPublishedListings] = useState(false);
  const [publishedProductByItem, setPublishedProductByItem] = useState<Record<string, string>>({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogTab, setCreateDialogTab] = useState("dados");
  const [listingFieldErrors, setListingFieldErrors] = useState<Record<string, string>>({});
  const [creatingListing, setCreatingListing] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(false);
  const [performanceDialogOpen, setPerformanceDialogOpen] = useState(false);
  const [loadingListingPerformance, setLoadingListingPerformance] = useState(false);
  const [listingPerformance, setListingPerformance] = useState<ListingPerformanceDetails | null>(null);
  const [quantityPricingOpen, setQuantityPricingOpen] = useState(false);
  const [loadingQuantityPricing, setLoadingQuantityPricing] = useState(false);
  const [savingQuantityPricing, setSavingQuantityPricing] = useState(false);
  const [quantityPricing, setQuantityPricing] = useState<QuantityPricingDetails | null>(null);
  const [quantityTiers, setQuantityTiers] = useState<QuantityTierForm[]>([]);
  const [compatibilityDialogOpen, setCompatibilityDialogOpen] = useState(false);
  const [loadingCompatibilities, setLoadingCompatibilities] = useState(false);
  const [savingCompatibility, setSavingCompatibility] = useState(false);
  const [compatibilityDetails, setCompatibilityDetails] = useState<CompatibilityDetails | null>(null);
  const [compatibilitySelection, setCompatibilitySelection] = useState<CompatibilitySelection>({});
  const [compatibilityOptions, setCompatibilityOptions] = useState<Partial<Record<VehicleAttributeId, CompatibilityOption[]>>>({});
  const [loadingCompatibilityOptions, setLoadingCompatibilityOptions] = useState<Partial<Record<VehicleAttributeId, boolean>>>({});
  const [compatibilityNote, setCompatibilityNote] = useState("");
  const [loadingEditListing, setLoadingEditListing] = useState(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<MlOrder | null>(null);
  const [orderToCancel, setOrderToCancel] = useState<MlOrder | null>(null);
  const [cancelSaleForm, setCancelSaleForm] = useState({ reason: "BUYER_REGRETS", message: "Venda não concretizada a pedido do comprador." });
  const [answeringQuestionId, setAnsweringQuestionId] = useState<number | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [categoryParent, setCategoryParent] = useState<CategoryOption | null>(null);
  const [categoryStack, setCategoryStack] = useState<CategoryOption[]>([]);
  const [listingTypeOptions, setListingTypeOptions] = useState<ListingTypeOption[]>([
    { id: "gold_special", name: "Clássico" },
    { id: "gold_pro", name: "Premium" },
    { id: "free", name: "Grátis" },
  ]);
  const [listingCommercialInfo, setListingCommercialInfo] = useState<ListingCommercialInfo>({ seller: null, payment: null });
  const [loadingListingCommercialInfo, setLoadingListingCommercialInfo] = useState(false);
  const [userProductSeller, setUserProductSeller] = useState(false);
  const [conditionOptions, setConditionOptions] = useState<string[]>(["new", "used", "not_specified"]);
  const [categoryAttributes, setCategoryAttributes] = useState<MlCategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [shippingEligibility, setShippingEligibility] = useState<ShippingEligibility>({
    loaded: false,
    categoryModes: [],
    userModes: [],
    logisticOptions: [],
    me2Restricted: false,
    me2Restrictions: [],
    userShippingOption: null,
    defaultDimensions: null,
    error: null,
  });
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [loadingShippingQuote, setLoadingShippingQuote] = useState(false);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const [listingForm, setListingForm] = useState<ListingForm>({
    produtoId: "",
    title: "",
    categoryId: "",
    price: "",
    availableQuantity: "",
    condition: "new",
    listingTypeId: "gold_special",
    description: "",
    pictureUrl: "",
    categoryName: "",
    categoryPath: "",
    categoryShippingOptions: [],
    categoryVertical: "products",
    brand: "",
    model: "",
    partNumber: "",
    familyName: "",
    gtin: "",
    sku: "",
    warranty: "",
    warrantyTime: "",
    shippingMode: "me2",
    logisticType: "drop_off",
    freeShipping: false,
    localPickup: false,
    customShippingDescription: "Correios personalizado",
    customShippingCost: "",
    customShippingDeadlineDays: "7",
    customShippingQuoteZip: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    weightGrams: "",
    dynamicAttributes: {},
  });
  const [editForm, setEditForm] = useState<ListingEditForm>({
    itemId: "",
    produtoId: "",
    categoryId: "",
    listingTypeId: "",
    title: "",
    familyName: "",
    userProductId: "",
    userProductEnabled: false,
    price: "",
    availableQuantity: "",
    condition: "new",
    description: "",
    videoUrl: "",
    pictureUrl: "",
    warranty: "",
    warrantyTime: "",
    shippingMode: "me2",
    logisticType: "drop_off",
    freeShipping: false,
    localPickup: false,
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    weightGrams: "",
    dynamicAttributes: {},
  });
  const [editingProductImageUrls, setEditingProductImageUrls] = useState<string[]>([]);
  const [editShippingModes, setEditShippingModes] = useState<string[]>([]);
  const [editLogisticOptions, setEditLogisticOptions] = useState<string[]>([]);
  const [editCategoryAttributes, setEditCategoryAttributes] = useState<MlCategoryAttribute[]>([]);
  const [editFamilyMembers, setEditFamilyMembers] = useState<UserProductFamilyMember[]>([]);
  const [editInitialAttributes, setEditInitialAttributes] = useState<Record<string, string>>({});
  const [editInitialForm, setEditInitialForm] = useState<ListingEditForm | null>(null);
  const [editShippingQuote, setEditShippingQuote] = useState<ShippingQuote | null>(null);
  const [loadingEditShippingQuote, setLoadingEditShippingQuote] = useState(false);
  const [editCapabilities, setEditCapabilities] = useState({
    title: true,
    price: true,
    stock: true,
    pictures: true,
    description: true,
    familyName: true,
  });

  const activeAccount = accounts[0] ?? null;
  const requiresReconnect = Boolean(activeAccount?.needs_reconnect);
  const connected = Boolean(activeAccount) && !requiresReconnect;
  const linkedCount = products.filter((product) => product.mercadolivre).length;
  const unlinkedCount = Math.max(products.length - linkedCount, 0);
  const linkedProducts = products.filter((product) => product.mercadolivre);
  const publishableProducts = products.filter((product) => !product.mercadolivre);
  const unlinkedPublishedListings = publishedListings.filter((listing) => !listing.produtoId);
  const listingRows = [
    ...unlinkedPublishedListings.map((listing) => ({ kind: "unlinked" as const, listing })),
    ...linkedProducts.map((product) => ({ kind: "linked" as const, product, listing: product.mercadolivre! })),
  ];
  const normalizedListingSearch = search.trim().toLocaleLowerCase("pt-BR");
  const filteredListingRows = listingRows.filter((row) => {
    const status = String(row.listing.status ?? "").toLowerCase();
    if (listingsFilter === "linked" && row.kind !== "linked") return false;
    if (listingsFilter === "unlinked" && row.kind !== "unlinked") return false;
    if (listingsFilter === "active" && status !== "active") return false;
    if (listingsFilter === "paused" && status !== "paused") return false;
    if (!normalizedListingSearch) return true;
    const searchable = row.kind === "linked"
      ? [row.listing.ml_item_id, row.listing.title, row.product.tituloMarketplace, row.product.titulo, row.product.referencia]
      : [row.listing.id, row.listing.title];
    return searchable.some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(normalizedListingSearch));
  });
  const listingsTotalPages = Math.max(1, Math.ceil(filteredListingRows.length / listingsPageSize));
  const safeListingsPage = Math.min(listingsPage, listingsTotalPages);
  const paginatedListingRows = filteredListingRows.slice((safeListingsPage - 1) * listingsPageSize, safeListingsPage * listingsPageSize);
  const productsTotalPages = Math.max(1, Math.ceil(products.length / productsPageSize));
  const safeProductsPage = Math.min(productsPage, productsTotalPages);
  const productsPageStart = products.length === 0 ? 0 : (safeProductsPage - 1) * productsPageSize + 1;
  const productsPageEnd = Math.min(safeProductsPage * productsPageSize, products.length);
  const paginatedProducts = products.slice((safeProductsPage - 1) * productsPageSize, safeProductsPage * productsPageSize);
  const maxDailyVisits = Math.max(...performance.daily.map((day) => Number(day.visits ?? 0)), 1);
  const unansweredQuestions = questions.filter((question) => String(question.status ?? "").toUpperCase() === "UNANSWERED").length;
  const selectedChatConversation =
    chatConversations.find((conversation) => conversation.orderDbId === selectedChatOrderId) ?? chatConversations[0] ?? null;
  const normalizedChatConversations = useMemo(() => chatConversations.map((conversation) => ({
    id: String(conversation.orderDbId),
    name: `Pedido ${conversation.mlOrderId}`,
    preview: conversation.title || `${conversation.messages.length} mensagem(ns)`,
    unreadCount: conversation.messages.filter((message) => !message.fromSeller && String(message.status ?? "").toLowerCase() === "unread").length,
  })), [chatConversations]);
  const normalizedChatMessages = useMemo(() => (selectedChatConversation?.messages ?? []).map((message) => ({
    id: String(message.id),
    text: message.text || "",
    fromBuyer: !message.fromSeller,
    date: message.dateCreated,
  })), [selectedChatConversation]);
  const claimsByOrderId = useMemo(() => {
    const map = new Map<number, MlClaim[]>();
    for (const claim of claims) {
      const orderDbId = Number(claim.orderDbId);
      if (!Number.isFinite(orderDbId) || orderDbId <= 0) continue;
      const current = map.get(orderDbId) ?? [];
      current.push(claim);
      map.set(orderDbId, current);
    }
    return map;
  }, [claims]);
  const filteredOrders = useMemo(() => {
    const term = orderSearch.trim().toLocaleLowerCase("pt-BR");
    return orders.filter((order) => {
      const matchesSearch = !term || [order.ml_order_id, order.venda_id, getOrderBuyerLabel(order), getOrderItemTitle(order), getOrderItemSku(order)]
        .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term));
      const status = String(order.status ?? "").toLowerCase();
      const activeClaim = (claimsByOrderId.get(order.id) ?? []).some(isActiveClaim);
      const matchesStatus = orderStatusFilter === "all"
        || (orderStatusFilter === "claim" && activeClaim)
        || (orderStatusFilter === "pending_erp" && !order.venda_id)
        || status === orderStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [claimsByOrderId, orderSearch, orderStatusFilter, orders]);
  const orderTotalPages = Math.max(1, Math.ceil(filteredOrders.length / orderPageSize));
  const safeOrderPage = Math.min(orderPage, orderTotalPages);
  const paginatedOrders = filteredOrders.slice((safeOrderPage - 1) * orderPageSize, safeOrderPage * orderPageSize);
  const selectedOrderClaims = selectedOrderDetails ? claimsByOrderId.get(selectedOrderDetails.id) ?? [] : [];
  const loadingOrdersView = activeTab === "orders" && (loadingDashboard || syncing || loadingClaims);
  const unreadChatMessageCount = chatConversations.reduce(
    (sum, conversation) =>
      sum +
      conversation.messages.filter((message) => !message.fromSeller && String(message.status ?? "").toLowerCase() === "unread").length,
    0,
  );

  useEffect(() => {
    if (productsPage > productsTotalPages) setProductsPage(productsTotalPages);
  }, [productsPage, productsTotalPages]);
  useEffect(() => { setOrderPage(1); }, [orderSearch, orderStatusFilter, orderPageSize]);
  const previewImages = listingForm.pictureUrl
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  const validPreviewImages = parsePictureUrls(listingForm.pictureUrl);
  const selectedPreviewImage = previewImages[Math.min(previewImageIndex, Math.max(previewImages.length - 1, 0))] ?? "";
  const requiredMissingAttributes = categoryAttributes.filter((attribute) => {
    if (!attribute.required) return false;
    if (attribute.id === "BRAND" && listingForm.brand.trim()) return false;
    if (attribute.id === "MODEL" && listingForm.model.trim()) return false;
    if (attribute.id === "PART_NUMBER" && listingForm.partNumber.trim()) return false;
    if (attribute.id === "GTIN" && listingForm.gtin.trim()) return false;
    const value = (listingForm.dynamicAttributes[attribute.id] ?? "").trim();
    if (!value) return true;
    if (attribute.valueType !== "number_unit") return false;
    return !(listingForm.dynamicAttributes[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id);
  });
  const missingShippingDimensions =
    listingForm.shippingMode === "me2" &&
    (!listingForm.widthCm || !listingForm.heightCm || !listingForm.lengthCm || !listingForm.weightGrams);
  const categoryShippingOptions = listingForm.categoryShippingOptions.map((option) => option.toLowerCase());
  const categorySupportsMercadoEnvios =
    !listingForm.categoryId || !shippingEligibility.loaded || categoryShippingOptions.includes("me2");
  const categorySupportsCustomShipping = !listingForm.categoryId || !shippingEligibility.loaded || categoryShippingOptions.includes("custom");
  const categoryBlocksMercadoEnvios =
    listingForm.categoryId && listingForm.shippingMode === "me2" && !categorySupportsMercadoEnvios;
  const categoryShippingIssue = categoryBlocksMercadoEnvios
    ? shippingEligibility.error
      ? shippingEligibility.error
      : !shippingEligibility.userModes.includes("me2")
        ? "A conta vendedora conectada não possui Mercado Envios ativo. Revise as preferências de envio e o endereço de origem no Mercado Livre."
        : !shippingEligibility.categoryModes.includes("me2")
          ? "A categoria selecionada não oferece Mercado Envios. Escolha uma categoria compatível ou uma alternativa de envio disponível."
          : "O Mercado Envios não está disponível para esta combinação de conta, categoria e logística."
    : "";
  const customShippingIssue =
    listingForm.shippingMode === "custom" && !categorySupportsCustomShipping
      ? `A categoria selecionada não retornou suporte a envio personalizado. Opções retornadas: ${listingForm.categoryShippingOptions.join(", ") || "não informadas"}.`
      : listingForm.shippingMode === "custom" &&
          (!listingForm.customShippingDescription.trim() ||
            Number(listingForm.customShippingDeadlineDays) <= 0 ||
            (!listingForm.freeShipping && parseCurrencyInput(listingForm.customShippingCost) <= 0))
        ? "Informe descrição, prazo e valor válido para o envio personalizado."
      : "";
  const listingGtin = getListingAttributeValue(listingForm, "GTIN").replace(/\D/g, "");
  const selectedListingType = listingTypeOptions.find((option) => option.id === listingForm.listingTypeId) ?? null;
  const sellerListingIssue = listingCommercialInfo.seller?.canList === false
    ? listingCommercialInfo.seller.restrictions.join(" ") || "A conta conectada não está autorizada a publicar anúncios."
    : "";
  const listingTypeIssue = selectedListingType?.available === false
    ? selectedListingType.restrictionReason || "O tipo de anúncio selecionado não está disponível para esta conta e categoria."
    : "";
  const freeListingStockIssue = listingForm.listingTypeId === "free" && Number(listingForm.availableQuantity) > 1
    ? "Anúncios grátis permitem estoque máximo de 1 unidade."
    : "";
  const listingIssues = [
    !listingForm.produtoId ? "Selecione um produto do ERP." : "",
    !listingForm.title.trim() ? "Informe o título do anúncio." : "",
    !listingForm.categoryId ? "Selecione a categoria Mercado Livre." : "",
    !listingForm.listingTypeId ? "Selecione um tipo de anúncio disponível para a conta." : "",
    parseCurrencyInput(listingForm.price) <= 0 ? "Informe um preço válido." : "",
    Number(listingForm.availableQuantity) <= 0 ? "Informe estoque disponível." : "",
    freeListingStockIssue,
    validPreviewImages.length === 0 ? "Informe ao menos uma imagem pública válida." : "",
    listingGtin && !isValidGtin(listingGtin) ? "Informe um GTIN/EAN válido ou deixe o campo vazio." : "",
    ...requiredMissingAttributes.map((attribute) => `Preencha o atributo obrigatório: ${attribute.name}.`),
    categoryShippingIssue,
    customShippingIssue,
    missingShippingDimensions ? "Informe dimensões e peso para o envio Mercado Envios." : "",
    sellerListingIssue,
    listingTypeIssue,
  ].filter(Boolean);
  const canPublishListing = listingIssues.length === 0;
  const notificationErrors = notifications.filter((notification) => String(notification.status ?? "").toUpperCase() === "ERRO").length;
  const diagnosticAlerts = diagnostics.checks.filter((check) => check.status !== "ok").length;
  const integrationAlerts = Math.max(notificationErrors + stockSync.failed, diagnosticAlerts);
  const marketplaceAttentionItems: MarketplaceAttentionItem[] = [];
  if (!connected) marketplaceAttentionItems.push({ id: "connection", title: requiresReconnect ? "Reconectar Mercado Livre" : "Conectar Mercado Livre", description: "A conta precisa estar autorizada para sincronizar e operar o canal.", tone: "danger", actionLabel: "Configurar", onAction: () => window.location.assign("/configuracoes/geral") });
  if (integrationAlerts > 0) marketplaceAttentionItems.push({ id: "integration", title: "Alertas de integração", description: "Existem webhooks, diagnósticos ou sincronizações com falha.", count: integrationAlerts, tone: "danger", actionLabel: "Ver integração", onAction: () => changeMainTab("logs") });
  if (stockSync.pending > 0) marketplaceAttentionItems.push({ id: "stock", title: "Estoque aguardando sincronização", description: "Produtos possuem atualizações ainda não enviadas ao canal.", count: stockSync.pending, actionLabel: "Ver produtos", onAction: () => changeMainTab("products") });
  if (unansweredQuestions > 0) marketplaceAttentionItems.push({ id: "questions", title: "Perguntas sem resposta", description: "Compradores aguardam retorno nos anúncios.", count: unansweredQuestions, actionLabel: "Responder", onAction: () => changeMainTab("atendimento") });
  const ordersWithoutSale = orders.filter((order) => !order.venda_id).length;
  if (ordersWithoutSale > 0) marketplaceAttentionItems.push({ id: "orders", title: "Pedidos sem venda no ERP", description: "Revise pedidos que ainda não foram vinculados ao fluxo interno.", count: ordersWithoutSale, actionLabel: "Revisar", onAction: () => { setOrderStatusFilter("pending_erp"); changeMainTab("orders"); } });
  if (unlinkedPublishedListings.length > 0) marketplaceAttentionItems.push({ id: "listings", title: "Anúncios sem vínculo", description: "Anúncios do Mercado Livre ainda não apontam para um produto do ERP.", count: unlinkedPublishedListings.length, actionLabel: "Vincular", onAction: () => changeMainTab("listings") });

  const listingFieldClass =
    "border-border/80 bg-white shadow-sm ring-1 ring-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/40";
  const listingSelectClass = `h-10 w-full ${listingFieldClass}`;
  const listingErrorClass = "border-destructive ring-destructive/40 focus-visible:border-destructive focus-visible:ring-destructive/30";
  const familyNamePreview = buildListingFamilyName(listingForm);

  function fieldClass(field: string, base = listingFieldClass) {
    return `${base} ${listingFieldErrors[field] ? listingErrorClass : ""}`;
  }

  function clearListingErrors(...fields: string[]) {
    setListingFieldErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  function listingErrorTab(errors: Record<string, string>) {
    if (errors.title || errors.price || errors.stock || errors.product) return "dados";
    if (errors.category || errors.listingType || errors.condition || errors.warranty) return "categoria";
    if (errors.family || errors.gtin || Object.keys(errors).some((key) => key.startsWith("attr:"))) return "atributos";
    if (errors.images) return "midia";
    if (errors.shipping || errors.dimensions) return "envio";
    return "revisao";
  }

  function mapListingApiError(message: string) {
    const normalized = message.toLowerCase();
    const errors: Record<string, string> = {};

    if (normalized.includes("título") || normalized.includes("title")) {
      errors.title = message;
    }
    if (normalized.includes("família") || normalized.includes("family_name")) {
      errors.family = message;
    }
    if (normalized.includes("conflict")) {
      errors.family =
        "Família do produto em conflito no Mercado Livre. Altere para um nome mais específico, de preferência usando marca, modelo e referência exata.";
    }
    if (normalized.includes("gtin") || normalized.includes("ean")) {
      errors.gtin = message;
      errors["attr:GTIN"] = message;
    }
    const isShippingError =
      normalized.includes("envio") ||
      normalized.includes("entrega") ||
      normalized.includes("dimensions") ||
      normalized.includes("peso") ||
      normalized.includes("shipping") ||
      normalized.includes("logística") ||
      normalized.includes("logistica") ||
      normalized.includes("mercado envios") ||
      normalized.includes("not_specified");

    if (isShippingError) {
      errors.shipping = message;
      errors.dimensions = message;
    }
    if (!isShippingError && (normalized.includes("categoria") || normalized.includes("category"))) {
      errors.category = message;
    }
    if (normalized.includes("preço") || normalized.includes("price")) {
      errors.price = message;
    }
    if (normalized.includes("tipo de anúncio") || normalized.includes("listing_type") || normalized.includes("listing type")) {
      errors.listingType = message;
    }
    if (normalized.includes("imagem") || normalized.includes("pictures")) {
      errors.images = message;
    }

    return Object.keys(errors).length ? errors : { general: message };
  }

  const tabHeader = {
    overview: {
      title: "Visão geral",
      description: "Acompanhe a operação e acesse rapidamente o que exige atenção.",
    },
    products: {
      title: "Produtos e anúncios",
      description: "Vincule anúncios existentes e sincronize preço/estoque.",
    },
    listings: {
      title: "Anúncios Mercado Livre",
      description: "Anúncios já vinculados a produtos do ERP.",
    },
    performance: {
      title: "Desempenho Mercado Livre",
      description: "Visualizações, pedidos e conversão dos últimos 30 dias.",
    },
    orders: {
      title: "Pedidos Mercado Livre",
      description: "Pedidos importados e vinculados a vendas do ERP.",
    },
    atendimento: {
      title: "Atendimento Mercado Livre",
      description: "Perguntas recebidas nos anúncios e respostas enviadas pelo ERP.",
    },
    logs: {
      title: "Logs de integração",
      description: "Webhooks, falhas e eventos recebidos do Mercado Livre.",
    },
  }[activeTab] ?? {
    title: "Marketplace",
    description: "Gerencie produtos, anúncios e pedidos.",
  };
  const tabResultLabel = activeTab === "products"
    ? `${products.length} produto(s)`
    : activeTab === "listings"
      ? `${filteredListingRows.length} anúncio(s)`
      : activeTab === "orders"
        ? `${filteredOrders.length} pedido(s)`
        : null;

  async function loadDashboard(options: { silent?: boolean } = {}) {
    if (!options.silent) setLoadingDashboard(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/dashboard", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar painel.");
      const nextOrders = (json.orders ?? []) as MlOrder[];
      ordersRevisionRef.current = marketplaceOrdersRevision(nextOrders);
      setAccounts(json.accounts ?? []);
      setSellerProfile(json.sellerProfile ?? null);
      setShippingAddress(json.shippingAddress ?? null);
      setOrders(nextOrders);
      setSelectedOrderDetails((current) => (current ? nextOrders.find((order) => order.id === current.id) ?? current : null));
      setNotifications(json.notifications ?? []);
      setSyncRuns(json.syncRuns ?? []);
      setPriceSyncLogs(json.priceSyncLogs ?? []);
      setDiagnostics(json.diagnostics ?? { status: "warning", checkedAt: null, checks: [] });
      setPerformance({ ...EMPTY_PERFORMANCE, ...(json.performance ?? {}) });
      setStockSync({ pending: 0, failed: 0, lastError: null, updatedAt: null, ...(json.stockSync ?? {}) });
    } catch (e: any) {
      if (!options.silent) {
        toast.error("Erro ao carregar marketplace", { description: marketplaceErrorMessage(e) });
      }
    } finally {
      if (!options.silent) setLoadingDashboard(false);
    }
  }

  async function checkOrdersRevision() {
    if (checkingOrdersRevisionRef.current || document.visibilityState !== "visible") return;

    checkingOrdersRevisionRef.current = true;
    try {
      const response = await fetch("/api/integracoes/mercadolivre/orders/revision", { cache: "no-store" });
      if (!response.ok) return;

      const json = await response.json().catch(() => ({}));
      const revision = String(json?.revision ?? "");
      if (!revision) return;

      const previousRevision = ordersRevisionRef.current;
      if (previousRevision === null) {
        ordersRevisionRef.current = revision;
        return;
      }

      if (revision !== previousRevision) {
        ordersRevisionRef.current = revision;
        await Promise.all([loadDashboard({ silent: true }), loadClaims({ silent: true })]);
      }
    } catch {
      // A sincronizacao manual continua disponivel caso a verificacao em segundo plano falhe.
    } finally {
      checkingOrdersRevisionRef.current = false;
    }
  }

  async function loadClaims(options: { silent?: boolean } = {}) {
    if (!connected) {
      setClaims([]);
      claimsLoadedForAccountRef.current = null;
      return;
    }

    if (!options.silent) setLoadingClaims(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/claims", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar reclamações.");
      setClaims(json.data ?? []);
      claimsLoadedForAccountRef.current = activeAccount?.id ?? null;
    } catch (e: any) {
      setClaims([]);
      if (!options.silent) {
        toast.error("Erro ao carregar reclamações", { description: marketplaceErrorMessage(e) });
      }
    } finally {
      if (!options.silent) setLoadingClaims(false);
    }
  }

  async function loadQuestions(status = questionStatusFilter, options: { silent?: boolean } = {}) {
    if (!connected) {
      setQuestions([]);
      return;
    }

    if (!options.silent) setLoadingQuestions(true);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (status && status !== "all") params.set("status", status);
      const response = await fetch(`/api/integracoes/mercadolivre/questions?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok && json?.requiresReconnect) {
        setAccounts((current) => current.map((account, index) => (index === 0 ? { ...account, needs_reconnect: true } : account)));
        setQuestions([]);
        return;
      }
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar perguntas.");
      setQuestions(json.data ?? []);
    } catch (e: any) {
      if (!options.silent) {
        toast.error("Erro ao carregar perguntas", { description: marketplaceErrorMessage(e) });
      }
    } finally {
      if (!options.silent) setLoadingQuestions(false);
    }
  }

  async function loadListingOptions(
    filters?: { categoryId?: string; price?: number; shippingMode?: string; logisticType?: string; billableWeight?: number },
    signal?: AbortSignal,
  ) {
    const hasCommercialFilters = Boolean(filters?.categoryId && Number(filters?.price) > 0);
    if (hasCommercialFilters) setLoadingListingCommercialInfo(true);
    try {
      const params = new URLSearchParams();
      if (filters?.categoryId) params.set("categoryId", filters.categoryId);
      if (Number(filters?.price) > 0) params.set("price", String(filters?.price));
      if (filters?.shippingMode) params.set("shippingMode", filters.shippingMode);
      if (filters?.logisticType) params.set("logisticType", filters.logisticType);
      if (Number(filters?.billableWeight) > 0) params.set("billableWeight", String(filters?.billableWeight));
      const response = await fetch(`/api/integracoes/mercadolivre/listing-options${params.size ? `?${params.toString()}` : ""}`, {
        cache: "no-store",
        signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar opções de anúncio.");
      if (Array.isArray(json.listingTypes) && json.listingTypes.length > 0) {
        setListingTypeOptions(json.listingTypes);
        setListingForm((current) => {
          const selected = json.listingTypes.find((option: ListingTypeOption) => option.id === current.listingTypeId);
          const fallbackId = json.defaultListingTypeId || json.listingTypes.find((option: ListingTypeOption) => option.available !== false)?.id;
          if (!filters?.categoryId && fallbackId && current.listingTypeId !== fallbackId) {
            return { ...current, listingTypeId: fallbackId };
          }
          if (!selected || selected.available === false) {
            return fallbackId ? { ...current, listingTypeId: fallbackId } : current;
          }
          return current;
        });
      }
      setListingCommercialInfo({
        seller: json.seller ?? null,
        payment: json.payment ?? null,
        source: json.source ?? null,
        error: null,
      });
      setUserProductSeller(Boolean(json.userProductSeller));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      const message = marketplaceErrorMessage(e);
      setListingCommercialInfo((current) => ({ ...current, error: message }));
      if (!hasCommercialFilters) toast.error("Erro ao carregar opções do Mercado Livre", { description: message });
    } finally {
      if (hasCommercialFilters && !signal?.aborted) setLoadingListingCommercialInfo(false);
    }
  }

  async function loadCategoryAttributes(categoryId: string) {
    setLoadingAttributes(true);
    setShippingEligibility((current) => ({ ...current, loaded: false, error: null }));
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar atributos.");
      const attrs = (json.data ?? []) as MlCategoryAttribute[];
      const shippingOptions = Array.isArray(json.settings?.shippingOptions) ? json.settings.shippingOptions.filter(Boolean) : [];
      const logisticOptions = Array.isArray(json.settings?.logisticOptions) ? json.settings.logisticOptions.filter(Boolean) : [];
      setShippingEligibility({
        loaded: true,
        categoryModes: Array.isArray(json.settings?.categoryShippingOptions) ? json.settings.categoryShippingOptions : [],
        userModes: Array.isArray(json.settings?.userShippingOptions) ? json.settings.userShippingOptions : [],
        logisticOptions,
        me2Restricted: Boolean(json.settings?.me2Restricted),
        me2Restrictions: Array.isArray(json.settings?.me2Restrictions) ? json.settings.me2Restrictions : [],
        userShippingOption: json.settings?.userShippingOption ?? null,
        defaultDimensions: json.settings?.defaultDimensions ?? null,
        error: null,
      });
      setCategoryAttributes(attrs);
      setListingForm((current) => ({
        ...current,
        categoryShippingOptions: shippingOptions,
        shippingMode:
          !shippingOptions.includes("me2") && shippingOptions.includes("custom")
            ? "custom"
            : current.shippingMode,
        logisticType: logisticOptions.includes(current.logisticType) ? current.logisticType : logisticOptions[0] ?? "",
        dynamicAttributes: attrs.reduce(
          (acc, attribute) => {
            if (acc[attribute.id]) return acc;
            if (attribute.id === "BRAND" && current.brand) acc[attribute.id] = current.brand;
            if (attribute.id === "MODEL" && current.model) acc[attribute.id] = current.model;
            if (attribute.id === "PART_NUMBER" && current.partNumber) acc[attribute.id] = current.partNumber;
            if (attribute.id === "GTIN" && normalizeGtin(current.gtin)) acc[attribute.id] = normalizeGtin(current.gtin);
            return acc;
          },
          { ...current.dynamicAttributes },
        ),
      }));
    } catch (e: any) {
      const message = marketplaceErrorMessage(e);
      toast.error("Erro ao carregar atributos e envios da categoria", { description: message });
      setCategoryAttributes([]);
      setShippingEligibility({
        loaded: true,
        categoryModes: [],
        userModes: [],
        logisticOptions: [],
        me2Restricted: false,
        me2Restrictions: [],
        userShippingOption: null,
        defaultDimensions: null,
        error: message,
      });
      setListingForm((current) => ({ ...current, categoryShippingOptions: [] }));
    } finally {
      setLoadingAttributes(false);
    }
  }

  async function loadProducts(searchText = search) {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ limit: "120" });
      if (searchText.trim()) params.set("search", searchText.trim());
      const response = await fetch(`/api/integracoes/mercadolivre/products?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar produtos.");
      setProducts(json.data ?? []);
      setProductsPage(1);
    } catch (e: any) {
      toast.error("Erro ao carregar produtos", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingProducts(false);
    }
  }

  async function refreshMarketplace() {
    if (activeTab === "orders" && connected) {
      await Promise.all([syncOrders(), loadProducts(), loadQuestions()]);
      return;
    }

    await Promise.all([loadDashboard(), loadProducts(), connected ? loadQuestions() : Promise.resolve()]);
  }

  async function syncOrders() {
    setSyncing(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/sync-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 15, limit: 50 }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao sincronizar pedidos.");
      const failed = Array.isArray(json.results) ? json.results.filter((item: any) => item?.error).length : 0;
      if (failed > 0) {
        const firstError = json.results.find((item: any) => item?.error)?.error;
        toast.error(`${failed} pedido(s) encontrado(s), mas com falha na importação.`, { description: marketplaceErrorMessage(firstError) });
      } else if (Number(json.created ?? 0) > 0) {
        toast.success(`${json.created} nova(s) venda(s) importada(s).`);
      }
      await loadDashboard();
    } catch (e: any) {
      toast.error("Erro ao sincronizar Mercado Livre", { description: marketplaceErrorMessage(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function syncShipment(vendaId: number) {
    setActionKey(`shipment:${vendaId}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/shipments/venda/${vendaId}`, {
        method: "POST",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao sincronizar envio.");
      toast.success("Mercado Envios sincronizado.");
      await loadDashboard();
    } catch (e: any) {
      toast.error("Erro ao sincronizar envio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function simulateShippingQuote() {
    setLoadingShippingQuote(true);
    setShippingQuote(null);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/shipping-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemPrice: parseCurrencyInput(listingForm.price),
          listingTypeId: listingForm.listingTypeId,
          condition: listingForm.condition,
          logisticType: listingForm.logisticType,
          freeShipping: listingForm.freeShipping,
          lengthCm: Number(listingForm.lengthCm.replace(",", ".")),
          widthCm: Number(listingForm.widthCm.replace(",", ".")),
          heightCm: Number(listingForm.heightCm.replace(",", ".")),
          weightGrams: Number(listingForm.weightGrams),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao simular frete.");
      setShippingQuote(json.data ?? null);
    } catch (error: any) {
      toast.error("Erro ao simular Mercado Envios", { description: marketplaceErrorMessage(error) });
    } finally {
      setLoadingShippingQuote(false);
    }
  }

  async function simulateEditShippingQuote() {
    setLoadingEditShippingQuote(true);
    setEditShippingQuote(null);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/shipping-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemPrice: parseCurrencyInput(editForm.price),
          listingTypeId: editForm.listingTypeId,
          condition: editForm.condition,
          logisticType: editForm.logisticType,
          freeShipping: editForm.freeShipping,
          lengthCm: Number(editForm.lengthCm.replace(",", ".")),
          widthCm: Number(editForm.widthCm.replace(",", ".")),
          heightCm: Number(editForm.heightCm.replace(",", ".")),
          weightGrams: Number(editForm.weightGrams),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao simular frete.");
      setEditShippingQuote(json.data ?? null);
    } catch (error: any) {
      toast.error("Erro ao simular Mercado Envios", { description: marketplaceErrorMessage(error) });
    } finally {
      setLoadingEditShippingQuote(false);
    }
  }

  async function saveCustomShipment(order: MlOrder) {
    if (!order.id) return;
    if (!customShipmentForm.carrier.trim()) {
      toast.error("Informe a transportadora.");
      return;
    }
    if (!customShipmentForm.trackingCode.trim() && !customShipmentForm.trackingUrl.trim()) {
      toast.error("Informe o código de rastreio ou o link de acompanhamento.");
      return;
    }
    if (customShipmentForm.markAsShipped && !customShipmentForm.trackingCode.trim()) {
      toast.error("Informe o código de rastreio para marcar como enviado no Mercado Livre.");
      return;
    }

    setActionKey(`custom-shipment:${order.id}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/orders/${order.id}/custom-shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(customShipmentForm),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao registrar envio personalizado.");

      const updated = json.data as MlOrder;
      setOrders((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
      setSelectedOrderDetails((current) => (current?.id === updated.id ? { ...current, ...updated } : current));
      if (json.marketplaceStatusUpdated) {
        if (json.marketplaceStatusConfirmed) {
          toast.success(json.messageSent ? "Pedido confirmado como enviado e comprador avisado." : "Pedido confirmado como enviado.");
          if (json.messageError) {
            toast.warning("O envio foi confirmado, mas a mensagem não foi entregue ao comprador.", {
              description: marketplaceErrorMessage(json.messageError),
            });
          }
        } else {
          toast.warning("Rastreio salvo, mas o Mercado Livre ainda não confirmou o status enviado.", {
            description: `Status retornado: ${rawStatusLabel(json.confirmedStatus)}. Sincronize novamente em alguns instantes.`,
          });
        }
      } else {
        toast.success(json.messageSent ? "Envio registrado e comprador avisado." : "Envio registrado.");
      }
      await loadDashboard();
    } catch (e: any) {
      toast.error("Erro ao registrar envio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function updateExternalShipmentStatus(order: MlOrder, deliveryStatus: "delivered" | "not_delivered") {
    const actionLabel = deliveryStatus === "delivered" ? "confirmar a entrega" : "informar que a entrega não foi concluída";
    if (!window.confirm(`Deseja ${actionLabel} no Mercado Livre?${deliveryStatus === "delivered" ? " Esta ação é final e não pode ser desfeita." : ""}`)) return;

    setActionKey(`delivery-status:${order.id}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/orders/${order.id}/custom-shipment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrier: order.tracking_method || order.raw_shipment?.custom?.carrier || "TRANSPORTADORA",
          trackingCode: order.tracking_number || order.raw_shipment?.custom?.tracking_code || "",
          trackingUrl: order.raw_shipment?.custom?.tracking_url || "",
          deadline: order.raw_shipment?.custom?.deadline || "",
          markAsShipped: false,
          notifyBuyer: false,
          deliveryStatus,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao atualizar o status da entrega.");
      if (!json.marketplaceStatusConfirmed) {
        toast.warning("O Mercado Livre recebeu a atualização, mas ainda não confirmou o novo status.");
      } else {
        toast.success(deliveryStatus === "delivered" ? "Entrega confirmada no Mercado Livre." : "Falha de entrega informada ao Mercado Livre.");
      }
      await loadDashboard();
    } catch (error: any) {
      toast.error("Erro ao atualizar a entrega", { description: marketplaceErrorMessage(error) });
    } finally {
      setActionKey(null);
    }
  }

  async function openShipmentLabel(vendaId: number) {
    setActionKey(`label:${vendaId}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/shipments/venda/${vendaId}/label`);
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json?.error || "Falha ao gerar a etiqueta.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      await loadDashboard();
    } catch (error: any) {
      toast.error("Etiqueta indisponível", { description: marketplaceErrorMessage(error) });
    } finally {
      setActionKey(null);
    }
  }

  async function sendOrderInvoice(order: MlOrder) {
    if (!canSendInvoiceToMercadoLivre(order)) {
      toast.error("Este envio não aceita importação de NF-e pelo Mercado Livre.", {
        description: "A nota continua vinculada à venda no ERP, mas a importação no shipment exige uma logística compatível do Mercado Envios.",
      });
      return;
    }

    if (!window.confirm(`Enviar a NF-e autorizada da venda #${order.venda_id} ao pedido Mercado Livre #${order.ml_order_id}?`)) return;

    setActionKey(`invoice:${order.id}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/orders/${order.id}/invoice`, { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao enviar a NF-e.");

      const invoice = json.data?.invoice ?? {};
      const updates: Partial<MlOrder> = {
        nfe_id: json.data?.nfe?.id ?? order.nfe_id,
        ml_invoice_id: invoice.id ?? order.ml_invoice_id,
        invoice_status: invoice.status ?? "sent",
        invoice_fiscal_key: invoice.fiscalKey ?? order.invoice_fiscal_key,
        invoice_error: null,
        invoice_sent_at: invoice.sentAt ?? new Date().toISOString(),
        invoice_updated_at: invoice.updatedAt ?? new Date().toISOString(),
      };
      setOrders((current) => current.map((item) => (item.id === order.id ? { ...item, ...updates } : item)));
      setSelectedOrderDetails((current) => (current?.id === order.id ? { ...current, ...updates } : current));
      toast.success("NF-e enviada ao Mercado Livre.", { description: "Sincronize o envio para acompanhar a liberação da etiqueta." });
      await loadDashboard();
    } catch (e: any) {
      toast.error("Erro ao enviar NF-e", { description: marketplaceErrorMessage(e) });
      await loadDashboard();
    } finally {
      setActionKey(null);
    }
  }

  async function refundOrder(order: MlOrder) {
    const activeClaim = (claimsByOrderId.get(order.id) ?? []).find(isActiveClaim);
    if (activeClaim) {
      toast.error("Este pedido possui uma reclamação ativa.", {
        description: "Use uma das ações disponibilizadas pelo Mercado Livre nos detalhes da reclamação.",
      });
      return;
    }

    const payment = getRefundablePayment(order);
    if (!payment?.id) {
      toast.error("Este pedido não possui pagamento disponível para reembolso.");
      return;
    }

    const confirmed = window.confirm(`Reembolsar integralmente o pedido Mercado Livre #${order.ml_order_id}? Esta ação devolve o pagamento ao comprador.`);
    if (!confirmed) return;

    setActionKey(`refund:${order.id}`);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderDbId: order.id, paymentId: payment.id }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao reembolsar pedido.");
      toast.success("Reembolso solicitado ao Mercado Pago.");
      await Promise.all([loadDashboard(), loadClaims()]);
    } catch (e: any) {
      toast.error("Erro ao reembolsar pedido", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function cancelSale() {
    if (!orderToCancel) return;
    const key = `cancel:${orderToCancel.id}`;
    setActionKey(key);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/orders/${orderToCancel.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cancelSaleForm),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao cancelar a venda.");
      toast.success("Cancelamento enviado ao Mercado Livre.", { description: "O pedido e o estoque serão atualizados pela sincronização." });
      setOrderToCancel(null);
      await Promise.all([loadDashboard(), loadClaims()]);
    } catch (e: any) {
      toast.error("Erro ao cancelar venda", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function executeClaimAction(claim: MlClaim, action: SupportedClaimAction) {
    let percentage: number | undefined;
    if (action.id === "partial_refund") {
      const offers = claim.partialRefundOffers ?? [];
      const options = offers.map((offer) => `${offer.percentage}% (${formatCurrency(offer.amount)})`).join(", ");
      const selected = window.prompt(`Percentuais permitidos pelo Mercado Livre: ${options}\n\nInforme o percentual desejado:`);
      if (selected == null) return;
      percentage = Number(String(selected).replace(",", "."));
      if (!offers.some((offer) => Number(offer.percentage) === percentage)) {
        toast.error("Selecione um dos percentuais oferecidos pelo Mercado Livre.");
        return;
      }
    }
    if (!window.confirm(`${action.label}?\n\n${action.confirmation}`)) return;

    const key = `claim:${claim.id}:${action.id}`;
    setActionKey(key);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.id, action: action.id, percentage }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao executar a ação na reclamação.");

      toast.success("Ação enviada ao Mercado Livre.", { description: `${action.label} solicitada com sucesso.` });
      await Promise.all([loadClaims(), loadDashboard()]);
    } catch (e: any) {
      toast.error("Erro ao atualizar reclamação", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function loadChatConversations(orderDbId?: number, options: { silent?: boolean } = {}) {
    if (!options.silent) setLoadingChat(true);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (orderDbId) params.set("orderDbId", String(orderDbId));
      const response = await fetch(`/api/integracoes/mercadolivre/messages?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar mensagens.");
      const data = (json.data ?? []) as MlChatConversation[];
      setChatConversations((current) => {
        if (!orderDbId) return mergeChatConversations(current, data);
        const byId = new Map(current.map((conversation) => [conversation.orderDbId, conversation]));
        for (const conversation of data) {
          const previous = byId.get(conversation.orderDbId);
          byId.set(conversation.orderDbId, mergeChatConversation(previous, conversation));
        }
        return Array.from(byId.values());
      });
      if (data[0]?.orderDbId) setSelectedChatOrderId(data[0].orderDbId);
    } catch (e: any) {
      if (!options.silent) {
        toast.error("Erro ao carregar chat Mercado Livre", { description: marketplaceErrorMessage(e) });
      }
    } finally {
      if (!options.silent) setLoadingChat(false);
    }
  }

  async function openMarketplaceChat(orderDbId?: number) {
    setChatOpen(true);
    if (orderDbId) setSelectedChatOrderId(orderDbId);
    await loadChatConversations(orderDbId);
  }

  async function sendChatMessage() {
    const conversation = selectedChatConversation;
    const text = chatMessageText.trim();
    if (!conversation || !text) return;

    setSendingChatMessage(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderDbId: conversation.orderDbId, text }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao enviar mensagem.");
      setChatMessageText("");
      setChatConversations((current) =>
        current.map((item) =>
          item.orderDbId === conversation.orderDbId
            ? {
                ...item,
                messages: [
                  ...item.messages,
                  {
                    id: `local:${Date.now()}`,
                    text,
                    fromSeller: true,
                    status: "sent",
                    dateCreated: new Date().toISOString(),
                  },
                ],
                error: null,
              }
            : item,
        ),
      );
      await loadChatConversations(conversation.orderDbId);
      toast.success("Mensagem enviada.");
    } catch (e: any) {
      toast.error("Erro ao enviar mensagem", { description: marketplaceErrorMessage(e) });
    } finally {
      setSendingChatMessage(false);
    }
  }

  function mergeChatConversations(current: MlChatConversation[], next: MlChatConversation[]) {
    const byId = new Map(current.map((conversation) => [conversation.orderDbId, conversation]));
    for (const conversation of next) {
      byId.set(conversation.orderDbId, mergeChatConversation(byId.get(conversation.orderDbId), conversation));
    }
    return Array.from(byId.values());
  }

  function mergeChatConversation(previous: MlChatConversation | undefined, next: MlChatConversation) {
    if (!previous) return next;
    if (next.error && next.messages.length === 0 && previous.messages.length > 0) {
      return { ...previous, error: next.error };
    }
    return next;
  }

  async function answerQuestion(questionId: number) {
    const text = answerText.trim();
    if (!text) {
      toast.error("Informe a resposta.");
      return;
    }

    setActionKey(`answer:${questionId}`);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, text }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao responder pergunta.");
      toast.success("Resposta enviada ao Mercado Livre.");
      setAnsweringQuestionId(null);
      setAnswerText("");
      await loadQuestions();
    } catch (e: any) {
      toast.error("Erro ao responder pergunta", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function linkProduct(produtoId: number) {
    const mlItemId = linkValue.trim();
    if (!mlItemId) {
      toast.error("Informe o código do anúncio.");
      return;
    }

    setActionKey(`link:${produtoId}`);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId, mlItemId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao vincular anúncio.");
      toast.success("Anúncio vinculado ao produto.");
      setLinkingProductId(null);
      setLinkValue("");
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao vincular anúncio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function unlinkProduct(produtoId: number) {
    setActionKey(`unlink:${produtoId}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/product-links?produtoId=${produtoId}`, {
        method: "DELETE",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao remover vínculo.");
      toast.success("Vínculo removido.");
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao remover vínculo", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  async function itemAction(itemId: string, action: "pause" | "activate" | "close" | "sync_stock_price") {
    setActionKey(`${action}:${itemId}`);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao atualizar anúncio.");
      const returnedStatus = String(json?.data?.status || json?.status || "").toLowerCase();
      if (returnedStatus) {
        setProducts((current) =>
          current.map((product) =>
            product.mercadolivre?.ml_item_id === itemId
              ? {
                  ...product,
                  mercadolivre: {
                    ...product.mercadolivre,
                    status: returnedStatus,
                    title: json?.data?.title ?? product.mercadolivre.title,
                    permalink: json?.data?.permalink ?? product.mercadolivre.permalink,
                    updated_at: new Date().toISOString(),
                  },
                }
              : product,
          ),
        );
      }
      toast.success(
        action === "pause"
          ? "Anúncio pausado."
          : action === "activate"
            ? "Anúncio ativado."
            : action === "close"
              ? "Anúncio finalizado."
              : "Anúncio atualizado.",
      );
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao atualizar anúncio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  const loadCategories = useCallback(async (params?: { query?: string; parentId?: string; vertical?: MarketplaceVertical }) => {
    const query = params?.query?.trim() ?? "";
    const parentId = params?.parentId ?? "";
    const vertical = params?.vertical ?? listingForm.categoryVertical;
    setLoadingCategories(true);
    try {
      const searchParams = new URLSearchParams({ limit: "8", vertical });
      if (query) searchParams.set("q", query);
      if (parentId) searchParams.set("parentId", parentId);

      const response = await fetch(`/api/integracoes/mercadolivre/categories?${searchParams.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao buscar categorias.");
      setCategoryOptions(json.data ?? []);
      setCategoryParent(json.parent ?? null);
    } catch (e: any) {
      toast.error("Erro ao buscar categorias", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingCategories(false);
    }
  }, [listingForm.categoryVertical]);

  function fillListingForm(product?: ProductRow | null) {
    setListingForm((current) => ({
      ...current,
      produtoId: product ? String(product.id) : "",
      title: product?.tituloMarketplace || product?.titulo || "",
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      categoryShippingOptions: [],
      price: product ? formatCurrencyInputFromNumber(product.precovenda) : "",
      availableQuantity: product ? String(Math.max(Number(product.estoque ?? 0), 0)) : "",
      condition: mapConditionFromProduct(product?.conservacao),
      description: product?.descricaoMarketplace || product?.descricao || "",
      pictureUrl: (product?.imageUrls?.length ? product.imageUrls : product?.imgUrl ? [product.imgUrl] : []).join("\n"),
      sku: product?.referencia || "",
      brand: product?.fabricante || "",
      model: product?.modelo || "",
      partNumber: product?.referencia || "",
      familyName: "",
      gtin: normalizeGtin(product?.codigobarras),
      dynamicAttributes: initialDynamicAttributesFromProduct(product),
    }));
    setCategorySearch(product?.tituloMarketplace || product?.titulo || "");
    setCategoryParent(null);
    setCategoryStack([]);
    setCategoryAttributes([]);
    setPreviewImageIndex(0);
    setShippingEligibility({ loaded: false, categoryModes: [], userModes: [], logisticOptions: [], me2Restricted: false, me2Restrictions: [], userShippingOption: null, defaultDimensions: null, error: null });
    setShippingQuote(null);
  }

  function openCreateListing() {
    if (!connected) {
      toast.error("Conecte uma conta Mercado Livre antes de criar anúncios.");
      return;
    }

    fillListingForm(publishableProducts[0] ?? null);
    setCreateDialogTab("dados");
    setListingFieldErrors({});
    setCreateDialogOpen(true);
    loadCategories({ vertical: "products" });
    loadListingOptions();
  }

  async function openEditListing(product: ProductRow) {
    const link = product.mercadolivre;
    if (!link) return;

    const fallbackForm: ListingEditForm = {
      itemId: link.ml_item_id,
      produtoId: String(product.id),
      categoryId: "",
      listingTypeId: "",
      title: link.title || product.tituloMarketplace || product.titulo || "",
      familyName: link.family_name || "",
      userProductId: link.user_product_id || "",
      userProductEnabled: Boolean(link.user_product_enabled || link.family_name || link.user_product_id),
      price: formatCurrencyInputFromNumber(product.precovenda),
      availableQuantity: String(Math.max(Number(product.estoque ?? 0), 0)),
      condition: "new",
      description: product.descricaoMarketplace || product.descricao || "",
      videoUrl: "",
      pictureUrl: (product.imageUrls?.length ? product.imageUrls : product.imgUrl ? [product.imgUrl] : []).join("\n"),
      warranty: "",
      warrantyTime: "",
      shippingMode: "me2",
      logisticType: "drop_off",
      freeShipping: false,
      localPickup: false,
      widthCm: "",
      heightCm: "",
      lengthCm: "",
      weightGrams: "",
      dynamicAttributes: {},
    };

    setEditForm({ ...fallbackForm });
    setEditInitialForm({ ...fallbackForm });
    setEditingProductImageUrls(Array.from(new Set((product.imageUrls?.length ? product.imageUrls : product.imgUrl ? [product.imgUrl] : []).filter(Boolean))));
    setEditShippingModes([]);
    setEditLogisticOptions([]);
    setEditCategoryAttributes([]);
    setEditFamilyMembers([]);
    setEditInitialAttributes({});
    setEditShippingQuote(null);
    setEditCapabilities({ title: !fallbackForm.userProductEnabled, price: true, stock: true, pictures: true, description: true, familyName: true });
    setEditDialogOpen(true);

    setLoadingEditListing(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(link.ml_item_id)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar dados atuais do anúncio.");
      const item = json.data ?? {};
      const categoryId = String(item.categoryId ?? "");
      const shippingMode = String(item.shippingMode || fallbackForm.shippingMode);
      const dynamicAttributes = item.dynamicAttributes && typeof item.dynamicAttributes === "object" ? item.dynamicAttributes : {};
      const loadedForm: ListingEditForm = {
        ...fallbackForm,
        categoryId,
        listingTypeId: String(item.listingTypeId ?? ""),
        title: item.title || fallbackForm.title,
        familyName: item.familyName || fallbackForm.familyName,
        userProductId: item.userProductId || fallbackForm.userProductId,
        userProductEnabled: Boolean(item.userProductEnabled),
        price: formatCurrencyInputFromNumber(item.price ?? product.precovenda),
        availableQuantity: String(Math.max(Number(item.availableQuantity ?? product.estoque ?? 0), 0)),
        condition: ["new", "used", "not_specified"].includes(String(item.condition)) ? item.condition : "new",
        description: item.description || fallbackForm.description,
        videoUrl: item.videoUrl || "",
        pictureUrl: Array.isArray(item.pictures) && item.pictures.length ? item.pictures.join("\n") : fallbackForm.pictureUrl,
        warranty: item.warranty || "",
        warrantyTime: item.warrantyTime || "",
        shippingMode,
        logisticType: item.logisticType || fallbackForm.logisticType,
        freeShipping: Boolean(item.freeShipping),
        localPickup: false,
        widthCm: item.widthCm || "",
        heightCm: item.heightCm || "",
        lengthCm: item.lengthCm || "",
        weightGrams: item.weightGrams || "",
        dynamicAttributes,
      };
      setEditForm(loadedForm);
      setEditInitialForm(loadedForm);
      setEditInitialAttributes(dynamicAttributes);
      setEditCapabilities((current) => ({ ...current, ...(item.capabilities ?? {}) }));
      setEditFamilyMembers(
        (Array.isArray(item.familyMembers) ? item.familyMembers : []).map((member: any) => ({
          id: String(member?.id ?? ""),
          name: String(member?.name ?? ""),
          attributes: Array.isArray(member?.attributes) ? member.attributes : [],
        })),
      );
      if (categoryId) {
        const [attributesResponse] = await Promise.all([
          fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, { cache: "no-store" }),
          loadEditShippingOptions(categoryId, shippingMode, String(item.logisticType || "")),
        ]);
        const attributesJson = await attributesResponse.json().catch(() => ({}));
        if (!attributesResponse.ok) throw new Error(attributesJson?.error || "Falha ao carregar atributos da categoria.");
        setEditCategoryAttributes(Array.isArray(attributesJson.data) ? attributesJson.data : []);
      }
    } catch (e: any) {
      toast.error("Não foi possível carregar o anúncio atual", {
        description: marketplaceErrorMessage(e, "O formulário foi aberto com os dados locais do ERP."),
      });
    } finally {
      setLoadingEditListing(false);
    }
  }

  async function openListingPerformance(product: ProductRow) {
    setListingPerformance(null);
    setPerformanceDialogOpen(true);
    setLoadingListingPerformance(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/products/${product.id}/performance`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar desempenho do anúncio.");
      if (!json?.linked || !json?.data) throw new Error("Este produto não possui anúncio Mercado Livre vinculado.");
      setListingPerformance(json.data);
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao carregar desempenho do anúncio."));
      setPerformanceDialogOpen(false);
    } finally {
      setLoadingListingPerformance(false);
    }
  }

  async function openQuantityPricing(itemId: string) {
    setPerformanceDialogOpen(false);
    setQuantityPricingOpen(true);
    setLoadingQuantityPricing(true);
    setQuantityPricing(null);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(itemId)}/quantity-prices`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao consultar preços por quantidade.");
      setQuantityPricing(data);
      const current = Array.isArray(data?.tiers) ? data.tiers : [];
      const recommended = Array.isArray(data?.recommendations) ? data.recommendations.filter((entry: any) => !entry.incoherent) : [];
      const configuredDefaults = data?.defaults?.enabled && Array.isArray(data?.defaults?.tiers) ? data.defaults.tiers : [];
      const initial = current.length ? current : configuredDefaults.length ? configuredDefaults : recommended;
      setQuantityTiers(initial.map((entry: any) => ({
        quantity: String(entry.quantity ?? ""),
        percentage: Number(entry.percentage ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
      })));
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao consultar preços por quantidade."));
      setQuantityPricingOpen(false);
    } finally {
      setLoadingQuantityPricing(false);
    }
  }

  async function saveQuantityPricing(tiers = quantityTiers) {
    if (!quantityPricing?.itemId || !quantityPricing.eligible) return;
    setSavingQuantityPricing(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(quantityPricing.itemId)}/quantity-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tiers: tiers.map((tier) => ({
            quantity: Number(tier.quantity),
            percentage: Number(tier.percentage.replace(",", ".")),
          })),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao salvar preços por quantidade.");
      toast.success(tiers.length ? "Preços por quantidade atualizados." : "Preços por quantidade removidos.");
      setQuantityPricingOpen(false);
      if (listingPerformance) {
        const product = products.find((candidate) => candidate.id === listingPerformance.produto_id);
        if (product) void openListingPerformance(product);
      }
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao salvar preços por quantidade."));
    } finally {
      setSavingQuantityPricing(false);
    }
  }

  async function loadCompatibilityOptions(
    itemId: string,
    attributeId: VehicleAttributeId,
    selection: CompatibilitySelection,
  ) {
    setLoadingCompatibilityOptions((current) => ({ ...current, [attributeId]: true }));
    try {
      const knownAttributes = (["BRAND", "MODEL", "VEHICLE_YEAR", "SHORT_VERSION", "ENGINE"] as VehicleAttributeId[])
        .filter((id) => id !== attributeId && selection[id])
        .map((id) => ({ id, value_id: selection[id]!.id, value_name: selection[id]!.name }));
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(itemId)}/compatibilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "options", attributeId, knownAttributes }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao consultar opções de veículos.");
      setCompatibilityOptions((current) => ({ ...current, [attributeId]: Array.isArray(data?.options) ? data.options : [] }));
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao consultar opções de veículos."));
    } finally {
      setLoadingCompatibilityOptions((current) => ({ ...current, [attributeId]: false }));
    }
  }

  async function loadCompatibilities(itemId: string) {
    setLoadingCompatibilities(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(itemId)}/compatibilities`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao consultar compatibilidades.");
      setCompatibilityDetails(data);
      return data as CompatibilityDetails;
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao consultar compatibilidades."));
      setCompatibilityDialogOpen(false);
      return null;
    } finally {
      setLoadingCompatibilities(false);
    }
  }

  async function openCompatibilities(product: ProductRow) {
    const itemId = product.mercadolivre?.ml_item_id;
    if (!itemId) return;
    setCompatibilityDetails(null);
    setCompatibilitySelection({});
    setCompatibilityOptions({});
    setLoadingCompatibilityOptions({});
    setCompatibilityNote("");
    setCompatibilityDialogOpen(true);
    const details = await loadCompatibilities(itemId);
    if (details?.available) void loadCompatibilityOptions(itemId, "BRAND", {});
  }

  async function selectCompatibilityOption(attributeId: VehicleAttributeId, optionId: string) {
    const option = compatibilityOptions[attributeId]?.find((candidate) => candidate.id === optionId);
    if (!option || !compatibilityDetails) return;
    const order: VehicleAttributeId[] = ["BRAND", "MODEL", "VEHICLE_YEAR", "SHORT_VERSION", "ENGINE"];
    const index = order.indexOf(attributeId);
    const nextSelection = { ...compatibilitySelection, [attributeId]: option };
    for (const dependent of order.slice(index + 1)) delete nextSelection[dependent];
    setCompatibilitySelection(nextSelection);
    setCompatibilityOptions((current) => {
      const next = { ...current };
      for (const dependent of order.slice(index + 1)) delete next[dependent];
      return next;
    });
    const nextAttribute = order[index + 1];
    if (nextAttribute) void loadCompatibilityOptions(compatibilityDetails.itemId, nextAttribute, nextSelection);
    if (attributeId === "VEHICLE_YEAR") {
      void loadCompatibilityOptions(compatibilityDetails.itemId, "ENGINE", nextSelection);
    }
  }

  async function addCompatibility() {
    if (!compatibilityDetails || !compatibilitySelection.BRAND || !compatibilitySelection.MODEL) return;
    setSavingCompatibility(true);
    try {
      const attributes = (["BRAND", "MODEL", "VEHICLE_YEAR", "SHORT_VERSION", "ENGINE"] as VehicleAttributeId[])
        .filter((id) => compatibilitySelection[id])
        .map((id) => ({ id, value_id: compatibilitySelection[id]!.id, value_name: compatibilitySelection[id]!.name }));
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(compatibilityDetails.itemId)}/compatibilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", attributes, note: compatibilityNote }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao adicionar compatibilidade.");
      toast.success(data?.created > 1 ? `${data.created} veículos compatíveis foram adicionados.` : "Compatibilidade adicionada.");
      setCompatibilitySelection({});
      setCompatibilityOptions({});
      setCompatibilityNote("");
      await loadCompatibilities(compatibilityDetails.itemId);
      void loadCompatibilityOptions(compatibilityDetails.itemId, "BRAND", {});
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao adicionar compatibilidade."));
    } finally {
      setSavingCompatibility(false);
    }
  }

  async function removeCompatibility(catalogProductId: string) {
    if (!compatibilityDetails) return;
    setSavingCompatibility(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(compatibilityDetails.itemId)}/compatibilities`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogProductId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Falha ao remover compatibilidade.");
      toast.success("Compatibilidade removida.");
      await loadCompatibilities(compatibilityDetails.itemId);
    } catch (error) {
      toast.error(marketplaceErrorMessage(error, "Falha ao remover compatibilidade."));
    } finally {
      setSavingCompatibility(false);
    }
  }

  async function handleQualityObjective(action: ListingPerformanceDetails["quality"]["actions"][number]) {
    if (action.kind === "quantity_price" && listingPerformance?.ml_item_id) {
      await openQuantityPricing(listingPerformance.ml_item_id);
      return;
    }
    if (action.kind === "same_day_shipping") {
      window.location.href = "/configuracoes/geral#marketplace-settings";
      return;
    }
    const editableKinds = new Set(["video", "pictures", "description", "attributes"]);
    if (action.kind && editableKinds.has(action.kind)) {
      const product = products.find((candidate) => candidate.id === listingPerformance?.produto_id);
      if (!product) {
        toast.error("Não foi possível localizar o produto vinculado no ERP.");
        return;
      }
      setPerformanceDialogOpen(false);
      await openEditListing(product);
      return;
    }

    if (action.link) {
      window.open(action.link, "_blank", "noopener,noreferrer");
      return;
    }
    toast.info("O Mercado Livre não disponibilizou uma ação automática para este objetivo.");
  }

  async function saveEditedListing() {
    if (!editForm.itemId) return;
    if (!editForm.userProductEnabled && !editForm.title.trim()) {
      toast.error("Informe o título do anúncio.");
      return;
    }
    if (parseCurrencyInput(editForm.price) <= 0) {
      toast.error("Informe um preço válido.");
      return;
    }
    if (Number(editForm.availableQuantity) < 0) {
      toast.error("Informe um estoque válido.");
      return;
    }

    setEditingListing(true);
    try {
      const changedAttributes = Object.fromEntries(
        Object.entries(editForm.dynamicAttributes).filter(([key, value]) => value !== editInitialAttributes[key]),
      );
      for (const attribute of editCategoryAttributes) {
        if (attribute.valueType !== "number_unit" || !(attribute.id in changedAttributes)) continue;
        const unitKey = `${attribute.id}__unit`;
        changedAttributes[unitKey] = editForm.dynamicAttributes[unitKey] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || "";
      }
      const initial = editInitialForm;
      const changes: Record<string, unknown> = {};
      const addTextChange = (key: keyof ListingEditForm, value: string) => {
        if (!initial || String(initial[key] ?? "").trim() !== value.trim()) changes[key] = value;
      };
      addTextChange("title", editForm.title);
      addTextChange("familyName", editForm.familyName);
      addTextChange("description", editForm.description);
      addTextChange("videoUrl", editForm.videoUrl);
      addTextChange("pictureUrl", editForm.pictureUrl);
      addTextChange("warranty", editForm.warranty);
      addTextChange("warrantyTime", editForm.warrantyTime);
      addTextChange("shippingMode", editForm.shippingMode === "me2" ? "me2" : "");
      addTextChange("logisticType", editForm.logisticType);

      const price = parseCurrencyInput(editForm.price);
      if (!initial || Math.abs(price - parseCurrencyInput(initial.price)) >= 0.01) changes.price = price;
      const availableQuantity = Number(editForm.availableQuantity);
      if (!initial || availableQuantity !== Number(initial.availableQuantity)) changes.availableQuantity = availableQuantity;
      if (!initial || editForm.freeShipping !== initial.freeShipping) changes.freeShipping = editForm.freeShipping;
      if (!initial || editForm.localPickup !== initial.localPickup) changes.localPickup = false;

      for (const key of ["widthCm", "heightCm", "lengthCm"] as const) {
        const value = Number(editForm[key].replace(",", "."));
        const initialValue = Number(initial?.[key]?.replace(",", "."));
        if (!initial || value !== initialValue) changes[key] = value;
      }
      const weightGrams = Number(editForm.weightGrams);
      if (!initial || weightGrams !== Number(initial.weightGrams)) changes.weightGrams = weightGrams;
      if (["warranty", "warrantyTime"].some((key) => key in changes)) {
        changes.warranty = editForm.warranty;
        changes.warrantyTime = editForm.warrantyTime;
      }
      if (
        ["shippingMode", "logisticType", "freeShipping", "localPickup", "widthCm", "heightCm", "lengthCm", "weightGrams"]
          .some((key) => key in changes)
      ) {
        changes.shippingMode = editForm.shippingMode === "me2" ? "me2" : "";
        changes.logisticType = editForm.logisticType;
        changes.freeShipping = editForm.freeShipping;
        changes.localPickup = false;
        changes.widthCm = Number(editForm.widthCm.replace(",", "."));
        changes.heightCm = Number(editForm.heightCm.replace(",", "."));
        changes.lengthCm = Number(editForm.lengthCm.replace(",", "."));
        changes.weightGrams = Number(editForm.weightGrams);
      }
      if (Object.keys(changedAttributes).length) {
        changes.attributes = changedAttributes;
        changes.attributeDefinitions = editCategoryAttributes;
      }
      if (!Object.keys(changes).length) {
        toast.info("Nenhuma alteração para enviar.");
        return;
      }
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(editForm.itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_listing",
          changes,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao editar anúncio.");

      const divergent = Array.isArray(json?.confirmations)
        ? json.confirmations.filter((result: any) => result?.status === "DIVERGENTE")
        : [];
      if (divergent.length) {
        toast.warning("O Mercado Livre aplicou apenas parte das alterações.", {
          description: `Não foi possível confirmar: ${divergent.map((result: any) => result.field).join(", ")}.`,
        });
      } else {
        toast.success("Alterações confirmadas pelo Mercado Livre.");
        setEditDialogOpen(false);
      }
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao editar anúncio", { description: marketplaceErrorMessage(e) });
    } finally {
      setEditingListing(false);
    }
  }

  async function loadEditShippingOptions(categoryId: string, currentMode: string, currentLogisticType: string) {
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao consultar opções de envio.");
      const modes = Array.isArray(json.settings?.shippingOptions) ? json.settings.shippingOptions.filter(Boolean) : [];
      const logistics = Array.isArray(json.settings?.logisticOptions) ? json.settings.logisticOptions.filter(Boolean) : [];
      setEditShippingModes(Array.from(new Set([currentMode, ...modes].filter(Boolean))));
      setEditLogisticOptions(Array.from(new Set([currentLogisticType, ...logistics].filter(Boolean))));
    } catch (error: any) {
      setEditShippingModes(currentMode ? [currentMode] : []);
      setEditLogisticOptions(currentLogisticType ? [currentLogisticType] : []);
      toast.error("Não foi possível validar o envio do anúncio", { description: marketplaceErrorMessage(error) });
    }
  }

  function selectListingProduct(produtoId: string) {
    const product = products.find((item) => String(item.id) === produtoId);
    fillListingForm(product ?? null);
  }

  function selectCategory(category: CategoryOption) {
    updateListingForm("categoryId", category.id);
    updateListingForm("categoryName", category.name);
    updateListingForm("categoryPath", category.path ?? "");
    updateListingForm("categoryShippingOptions", []);
    const nextConditions = category.conditionOptions?.length ? category.conditionOptions : ["new", "used", "not_specified"];
    setConditionOptions(nextConditions);
    if (!nextConditions.includes(listingForm.condition)) {
      updateListingForm("condition", nextConditions[0] as ListingForm["condition"]);
    }
    setCategorySearch(category.name);
    setCategoryPopoverOpen(false);
    loadCategoryAttributes(category.id);
  }

  function changeCategoryVertical(value: MarketplaceVertical) {
    updateListingForm("categoryVertical", value);
    updateListingForm("categoryId", "");
    updateListingForm("categoryName", "");
    updateListingForm("categoryPath", "");
    updateListingForm("categoryShippingOptions", []);
    setShippingEligibility({ loaded: false, categoryModes: [], userModes: [], logisticOptions: [], me2Restricted: false, me2Restrictions: [], userShippingOption: null, defaultDimensions: null, error: null });
    setShippingQuote(null);
    setCategorySearch("");
    setCategoryParent(null);
    setCategoryStack([]);
    loadCategories({ vertical: value });
  }

  function browseCategory(category: CategoryOption) {
    if (categoryParent) setCategoryStack((current) => [...current, categoryParent]);
    setCategorySearch("");
    loadCategories({ parentId: category.id, vertical: listingForm.categoryVertical });
  }

  function backCategoryLevel() {
    const previous = categoryStack.at(-1);
    setCategoryStack((current) => current.slice(0, -1));
    setCategorySearch("");

    if (previous?.id) {
      loadCategories({ parentId: previous.id, vertical: listingForm.categoryVertical });
    } else {
      setCategoryParent(null);
      loadCategories({ vertical: listingForm.categoryVertical });
    }
  }

  async function createListing() {
    if (!canPublishListing) {
      toast.error("Revise o anúncio antes de publicar.", {
        description: listingIssues[0],
      });
      return;
    }

    if (!listingForm.produtoId) {
      toast.error("Selecione um produto.");
      return;
    }
    if (Number(listingForm.availableQuantity) <= 0) {
      toast.error("Não é possível publicar anúncio sem estoque disponível.");
      return;
    }

    setCreatingListing(true);
    try {
      const listingBrand = getListingAttributeValue(listingForm, "BRAND");
      const listingModel = getListingAttributeValue(listingForm, "MODEL");
      const listingPartNumber = getListingAttributeValue(listingForm, "PART_NUMBER");
      const listingGtin = getListingAttributeValue(listingForm, "GTIN").replace(/\D/g, "");
      const response = await fetch("/api/integracoes/mercadolivre/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          produtoId: Number(listingForm.produtoId),
          title: listingForm.title,
          categoryId: listingForm.categoryId,
          price: parseCurrencyInput(listingForm.price),
          availableQuantity: Number(listingForm.availableQuantity),
          condition: listingForm.condition,
          listingTypeId: listingForm.listingTypeId,
          description: listingForm.description,
          pictureUrl: listingForm.pictureUrl,
          brand: listingBrand,
          model: listingModel,
          partNumber: listingPartNumber,
          familyName: familyNamePreview,
          gtin: listingGtin,
          sku: listingForm.sku,
          warranty: listingForm.warranty,
          warrantyTime: listingForm.warrantyTime,
          attributes: listingForm.dynamicAttributes,
          attributeDefinitions: categoryAttributes,
          shippingMode: listingForm.shippingMode,
          logisticType: listingForm.logisticType,
          freeShipping: listingForm.freeShipping,
          localPickup: listingForm.shippingMode === "pickup",
          customShippingDescription: listingForm.customShippingDescription,
          customShippingCost: listingForm.freeShipping ? 0 : parseCurrencyInput(listingForm.customShippingCost),
          customShippingDeadlineDays: Number(listingForm.customShippingDeadlineDays),
          widthCm: Number(listingForm.widthCm.replace(",", ".")),
          heightCm: Number(listingForm.heightCm.replace(",", ".")),
          lengthCm: Number(listingForm.lengthCm.replace(",", ".")),
          weightGrams: Number(listingForm.weightGrams),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiError = new Error(json?.error || "Falha ao criar anúncio.");
        (apiError as any).fieldErrors = json?.fieldErrors;
        throw apiError;
      }

      const confirmedShipping = json?.item?.shipping;
      const confirmedLogisticType = String(confirmedShipping?.logistic_type ?? "").trim().toLowerCase();
      toast.success("Anúncio criado no Mercado Livre.", {
        description:
          String(confirmedShipping?.mode ?? "").toLowerCase() === "me2" && confirmedLogisticType
            ? `Mercado Envios confirmado: ${shippingLogisticLabel(confirmedLogisticType)}.`
            : undefined,
      });
      setCreateDialogOpen(false);
      setListingFieldErrors({});
      await loadProducts();
    } catch (e: any) {
      const message = marketplaceErrorMessage(e);
      const fieldErrors = { ...mapListingApiError(message), ...((e as any)?.fieldErrors ?? {}) };
      setListingFieldErrors(fieldErrors);
      setCreateDialogTab(listingErrorTab(fieldErrors));
      toast.error("Erro ao criar anúncio", {
        description: "Corrija os campos destacados no formulário.",
      });
    } finally {
      setCreatingListing(false);
    }
  }

  function updateListingForm<K extends keyof ListingForm>(key: K, value: ListingForm[K]) {
    if (key === "title") clearListingErrors("title", "family", "general");
    if (key === "brand" || key === "model" || key === "partNumber") clearListingErrors("family", `attr:${String(key).toUpperCase()}`, "general");
    if (key === "familyName") clearListingErrors("family", "general");
    if (key === "gtin") clearListingErrors("gtin", "attr:GTIN", "general");
    if (key === "price") clearListingErrors("price", "general");
    if (key === "categoryId" || key === "categoryName" || key === "categoryPath") clearListingErrors("category", "listingType", "general");
    if (key === "listingTypeId") clearListingErrors("listingType", "general");
    if (key === "pictureUrl") clearListingErrors("images", "general");
    if (
      [
        "shippingMode",
        "logisticType",
        "widthCm",
        "heightCm",
        "lengthCm",
        "weightGrams",
        "customShippingDescription",
        "customShippingCost",
        "customShippingDeadlineDays",
        "customShippingQuoteZip",
        "freeShipping",
      ].includes(String(key))
    ) {
      clearListingErrors("shipping", "dimensions", "general");
      setShippingQuote(null);
    }

    setListingForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateEditForm<K extends keyof ListingEditForm>(key: K, value: ListingEditForm[K]) {
    if (["price", "listingTypeId", "condition", "logisticType", "freeShipping", "widthCm", "heightCm", "lengthCm", "weightGrams"].includes(String(key))) {
      setEditShippingQuote(null);
    }
    setEditForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateEditDynamicAttribute(attributeId: string, value: string) {
    setEditForm((current) => ({
      ...current,
      dynamicAttributes: {
        ...current.dynamicAttributes,
        [attributeId]: value,
      },
    }));
  }

  function updateDynamicAttribute(attributeId: string, value: string) {
    clearListingErrors(`attr:${attributeId}`, attributeId.toUpperCase() === "GTIN" ? "gtin" : "", "general");
    setListingForm((current) => ({
      ...current,
      dynamicAttributes: {
        ...current.dynamicAttributes,
        [attributeId]: value,
      },
    }));
  }

  function changeMainTab(value: string) {
    if (ML_MARKETPLACE_SECTIONS.includes(value as MlMarketplaceSection)) {
      setActiveTab(value as MlMarketplaceSection);
    }
  }

  async function loadPublishedListings() {
    setLoadingPublishedListings(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/product-links", {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao buscar anúncios publicados.");
      setPublishedListings(Array.isArray(json?.data) ? json.data : []);
    } catch (e: any) {
      toast.error("Erro ao buscar anúncios", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingPublishedListings(false);
    }
  }

  async function linkPublishedListing(itemId: string) {
    const produtoId = Number(publishedProductByItem[itemId]);
    if (!Number.isInteger(produtoId) || produtoId <= 0) {
      toast.error("Selecione um produto do ERP.");
      return;
    }

    setActionKey(`published-link:${itemId}`);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId, mlItemId: itemId }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao vincular anúncio.");
      toast.success("Anúncio vinculado ao produto.");
      setPublishedListings((current) =>
        current.map((item) => (item.id === itemId ? { ...item, produtoId } : item)),
      );
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao vincular anúncio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  useEffect(() => {
    if (!createDialogOpen) return;
    if (categoryParent && categorySearch.trim().length === 0) return;

    const timer = window.setTimeout(() => {
      loadCategories({ query: categorySearch, vertical: listingForm.categoryVertical });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [categoryParent, categorySearch, createDialogOpen, listingForm.categoryVertical, loadCategories]);

  useEffect(() => {
    if (!createDialogOpen || !listingForm.categoryId || parseCurrencyInput(listingForm.price) <= 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadListingOptions(
        {
          categoryId: listingForm.categoryId,
          price: parseCurrencyInput(listingForm.price),
          shippingMode: listingForm.shippingMode,
          logisticType: listingForm.logisticType,
          billableWeight: Number(listingForm.weightGrams),
        },
        controller.signal,
      );
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    createDialogOpen,
    listingForm.categoryId,
    listingForm.price,
    listingForm.shippingMode,
    listingForm.logisticType,
    listingForm.weightGrams,
  ]);

  useEffect(() => {
    if (previewImageIndex > 0 && previewImageIndex >= previewImages.length) {
      setPreviewImageIndex(0);
    }
  }, [previewImageIndex, previewImages.length]);

  useEffect(() => {
    if (!selectedOrderDetails) return;
    const customShipment = selectedOrderDetails.raw_shipment?.custom ?? {};
    setCustomShipmentForm({
      carrier: String(selectedOrderDetails.tracking_method || customShipment.carrier || "CORREIOS").toUpperCase(),
      trackingCode: String(selectedOrderDetails.tracking_number || customShipment.tracking_code || ""),
      trackingUrl: String(customShipment.tracking_url || ""),
      deadline: String(customShipment.deadline || ""),
      markAsShipped: true,
      notifyBuyer: true,
    });
  }, [selectedOrderDetails]);

  useEffect(() => {
    let mounted = true;
    Promise.all([loadDashboard(), loadProducts(""), loadListingOptions()]).finally(() => {
      if (mounted) setInitialLoading(false);
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!connected) {
      setQuestions([]);
      return;
    }

    loadQuestions(questionStatusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, questionStatusFilter]);

  useEffect(() => {
    if (!connected) return;

    let refreshing = false;
    const refreshService = async (topic?: string) => {
      if (refreshing || document.visibilityState !== "visible") return;
      refreshing = true;
      try {
        const normalizedTopic = String(topic ?? "").toLowerCase();
        const refreshEverything = !normalizedTopic;
        const tasks: Promise<void>[] = [];

        if (refreshEverything || normalizedTopic === "questions") {
          tasks.push(loadQuestions(questionStatusFilter, { silent: true }));
        }
        if ((refreshEverything || normalizedTopic === "messages" || normalizedTopic === "messaging") && chatOpen) {
          tasks.push(loadChatConversations(selectedChatOrderId ?? undefined, { silent: true }));
        }
        if (normalizedTopic.includes("claim") || normalizedTopic.includes("reclama")) {
          tasks.push(loadClaims({ silent: true }));
        }

        await Promise.all(tasks);
      } finally {
        refreshing = false;
      }
    };

    const handleSystemNotification = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (String(detail?.source ?? "") !== "MERCADOLIVRE_WEBHOOK") return;
      const metadata = detail?.metadata as Record<string, unknown> | undefined;
      void refreshService(String(metadata?.topic ?? ""));
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && (activeTab === "atendimento" || chatOpen)) {
        void refreshService();
      }
    };

    window.addEventListener("erp:system-notification", handleSystemNotification);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = window.setInterval(() => {
      if (activeTab === "atendimento" || chatOpen) void refreshService();
    }, 15_000);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("erp:system-notification", handleSystemNotification);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // As funcoes de carga usam o estado atual desta renderizacao. Recriar a
    // assinatura quando conta, filtro ou contexto visual muda e intencional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, activeTab, chatOpen, connected, questionStatusFilter, selectedChatOrderId]);

  useEffect(() => {
    if (!connected || activeTab !== "orders") {
      if (!connected) {
        setClaims([]);
        claimsLoadedForAccountRef.current = null;
      }
      return;
    }

    void checkOrdersRevision();
    if (claimsLoadedForAccountRef.current !== activeAccount?.id) {
      void loadClaims({ silent: true });
    }

    const intervalId = window.setInterval(() => {
      void checkOrdersRevision();
    }, 15_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkOrdersRevision();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, activeTab, connected]);

  if (initialLoading) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
          <p className="text-primary">Carregando marketplace...</p>
        </div>
      </div>
    );
  }

  const productActions = (product: ProductRow, compact = false) => {
    const link = product.mercadolivre;
    const busy = actionKey?.endsWith(`:${product.id}`) || (link && actionKey?.endsWith(`:${link.ml_item_id}`));

    if (!link) {
      return (
        <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setLinkingProductId(product.id)}>
          <Link2 className="h-4 w-4" />
          Vincular
        </Button>
      );
    }

    const listingStatus = String(link.status ?? "").toLowerCase();

    return (
      <div className={`flex ${compact ? "justify-end" : "justify-end"}`}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-8 bg-transparent px-2.5 text-xs" disabled={Boolean(busy)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
              Ações
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onClick={() => openEditListing(product)} disabled={Boolean(busy)}>
              <Pencil className="mr-2 h-4 w-4" />
              Editar anúncio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openListingPerformance(product)} disabled={Boolean(busy)}>
              <TrendingUp className="mr-2 h-4 w-4" />
              Desempenho e qualidade
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openQuantityPricing(link.ml_item_id)} disabled={Boolean(busy)}>
              <BadgePercent className="mr-2 h-4 w-4" />
              Preço por quantidade
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openCompatibilities(product)} disabled={Boolean(busy)}>
              <CarFront className="mr-2 h-4 w-4" />
              Veículos compatíveis
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "sync_stock_price")} disabled={Boolean(busy)}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Atualizar estoque e preço
            </DropdownMenuItem>
            {listingStatus === "active" && (
              <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "pause")} disabled={Boolean(busy)}>
                <Pause className="mr-2 h-4 w-4" />
                Pausar anúncio
              </DropdownMenuItem>
            )}
            {listingStatus === "paused" && (
              <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "activate")} disabled={Boolean(busy)}>
                <Play className="mr-2 h-4 w-4" />
                Ativar anúncio
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => unlinkProduct(product.id)} disabled={Boolean(busy)}>
              <Unlink className="mr-2 h-4 w-4" />
              Remover vínculo
            </DropdownMenuItem>
            {listingStatus !== "closed" && (
              <DropdownMenuItem
                onClick={() => itemAction(link.ml_item_id, "close")}
                disabled={Boolean(busy)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Finalizar anúncio
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const linkEditor = (product: ProductRow) => (
    <div className="space-y-2">
      <Label className="text-xs">Código do anúncio</Label>
      <div className="flex gap-2">
        <Input value={linkValue} onChange={(event) => setLinkValue(event.target.value)} placeholder="Ex: MLB123456789" />
        <Button size="sm" onClick={() => linkProduct(product.id)} disabled={actionKey === `link:${product.id}`}>
          {actionKey === `link:${product.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto space-y-4">
      <MarketplaceHeader
        icon={Store}
        iconClassName="text-amber-600"
        description="Produtos, vendas, atendimento e desempenho dos seus canais."
        connected={connected}
        accountName={requiresReconnect ? "Sessão inválida" : activeAccount ? String(activeAccount.nickname || activeAccount.ml_user_id) : "Conta desconectada"}
        accountDescription={activeAccount ? `Mercado Livre · ${shippingOriginLabel(shippingAddress) ? `Origem ${shippingOriginLabel(shippingAddress)}` : `User ID ${activeAccount.ml_user_id}`}` : "Configure a integração em Configurações Gerais"}
        accountBadge={connected ? <SellerReputationMeter levelId={sellerProfile?.reputationLevelId} label={sellerProfile?.reputationLabel} /> : null}
      />

      {activeTab === "overview" ? <Card className="gap-0 overflow-hidden py-2 shadow-sm">
        <section aria-label="Resumo do marketplace" className="grid grid-cols-2 xl:grid-cols-4">
          <button type="button" className="group min-w-0 border-b border-r text-left transition-colors hover:bg-muted/30 xl:border-b-0" onClick={() => changeMainTab("products")}>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">Produtos vinculados</CardTitle>
                <div className="text-xl font-bold leading-tight">{linkedCount}</div>
                <p className="truncate text-xs leading-tight text-muted-foreground">{unlinkedCount} sem vínculo nesta lista</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
                <PackageCheck className="h-4 w-4 text-blue-600" />
              </div>
            </div>
          </button>
          <button type="button" className="group min-w-0 border-b text-left transition-colors hover:bg-muted/30 xl:border-b-0 xl:border-r" onClick={() => changeMainTab("orders")}>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">Pedidos recentes</CardTitle>
                <div className="text-xl font-bold leading-tight">{orders.length}</div>
                <p className="truncate text-xs leading-tight text-muted-foreground">Importados do Mercado Livre</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-violet-500/10">
                <ClipboardList className="h-4 w-4 text-violet-600" />
              </div>
            </div>
          </button>
          <button type="button" className="group min-w-0 border-r text-left transition-colors hover:bg-muted/30" onClick={() => changeMainTab("atendimento")}>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">Perguntas pendentes</CardTitle>
                <div className="text-xl font-bold leading-tight">{unansweredQuestions}</div>
                <p className="truncate text-xs leading-tight text-muted-foreground">{questions.length} carregadas no atendimento</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-500/10">
                <MessageCircle className={`h-4 w-4 ${unansweredQuestions > 0 ? "text-amber-600" : "text-muted-foreground"}`} />
              </div>
            </div>
          </button>
          <button type="button" className="group min-w-0 text-left transition-colors hover:bg-muted/30" onClick={() => changeMainTab("logs")}>
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-medium">Alertas de integração</CardTitle>
                <div className="text-xl font-bold leading-tight">{integrationAlerts}</div>
                <p className="truncate text-xs leading-tight text-muted-foreground">{stockSync.pending > 0 ? `${stockSync.pending} estoque(s) aguardando sincronização` : `${notifications.length} evento(s) recentes`}</p>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-rose-500/10">
                <AlertTriangle className={`h-4 w-4 ${integrationAlerts > 0 ? "text-rose-600" : "text-muted-foreground"}`} />
              </div>
            </div>
          </button>
        </section>
      </Card> : null}

      <Tabs value={activeTab} onValueChange={changeMainTab}>
        <Card className="gap-0 bg-card">
          <CardHeader className="gap-0 border-b-2 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <CardTitle>{tabHeader.title}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={refreshMarketplace}
                    className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 disabled:cursor-wait disabled:opacity-60"
                    disabled={loadingDashboard || loadingProducts}
                  >
                    <span>Recarregar</span>
                    <Loader2 className={`h-3 w-3 ${loadingDashboard || loadingProducts ? "animate-spin" : ""}`} />
                  </button>
                  {tabResultLabel ? <><span aria-hidden="true">·</span><span>{tabResultLabel}</span></> : null}
                </CardDescription>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                {activeTab === "orders" ? <MarketplaceListToolbar compact search={orderSearch} onSearchChange={setOrderSearch} searchPlaceholder="Buscar pedido, comprador, produto ou SKU..." filter={orderStatusFilter} onFilterChange={setOrderStatusFilter} filterOptions={[
                  { value: "all", label: "Todos os pedidos" }, { value: "claim", label: "Com reclamação" }, { value: "pending_erp", label: "Sem venda no ERP" }, { value: "paid", label: "Pagos" }, { value: "confirmed", label: "Confirmados" }, { value: "cancelled", label: "Cancelados" },
                ]} resultLabel={`${filteredOrders.length} pedido(s)`} /> : null}
                {(activeTab === "products" || activeTab === "listings") && (
                  <div className="relative hidden w-[360px] xl:block">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        if (activeTab === "listings") setListingsPage(1);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") loadProducts();
                      }}
                      placeholder="Buscar produto ou anúncio..."
                      className="h-9 bg-background pl-8 pr-20"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0.5 top-1/2 h-8 -translate-y-1/2 px-2.5 text-xs"
                      onClick={() => loadProducts()}
                      disabled={loadingProducts}
                    >
                      Buscar
                    </Button>
                  </div>
                )}
                {activeTab === "listings" ? (
                  <Select value={listingsFilter} onValueChange={(value) => { setListingsFilter(value); setListingsPage(1); }}>
                    <SelectTrigger className="h-9 w-40 bg-background" aria-label="Filtrar anúncios">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="linked">Vinculados</SelectItem>
                      <SelectItem value="unlinked">Sem vínculo</SelectItem>
                      <SelectItem value="active">Ativos</SelectItem>
                      <SelectItem value="paused">Pausados</SelectItem>
                    </SelectContent>
                  </Select>
                ) : null}
                {activeTab === "orders" && (
                  <Button variant="outline" size="sm" onClick={syncOrders} disabled={!connected || syncing}>
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    Sincronizar pedidos
                  </Button>
                )}
                {activeTab === "listings" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadPublishedListings}
                    disabled={!connected || loadingPublishedListings}
                  >
                    {loadingPublishedListings ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                    Sincronizar anúncios
                  </Button>
                )}
                {(activeTab === "products" || activeTab === "listings") && (
                  <Button size="sm" onClick={openCreateListing} disabled={!connected}>
                    <Plus className="h-4 w-4" />
                    Criar anúncio
                  </Button>
                )}
              </div>
            </div>

            {(activeTab === "products" || activeTab === "listings") && (
              <div className="relative mt-3 xl:hidden">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    if (activeTab === "listings") setListingsPage(1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") loadProducts();
                  }}
                  placeholder="Buscar produto ou anúncio..."
                  className="h-9 bg-background pl-8 pr-20"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0.5 top-1/2 h-8 -translate-y-1/2 px-2.5 text-xs"
                  onClick={() => loadProducts()}
                  disabled={loadingProducts}
                >
                  Buscar
                </Button>
              </div>
            )}

          </CardHeader>
          <MarketplaceLoadingLine loading={loadingDashboard || loadingProducts || loadingQuestions || syncing || loadingPublishedListings} />

          <MarketplaceSectionNav
            items={[
              { value: "overview", label: "Visão geral", icon: LayoutDashboard },
              { value: "products", label: "Produtos", icon: PackageCheck, count: products.length },
              { value: "listings", label: "Anúncios", icon: Store, count: publishedListings.length || linkedCount },
              { value: "orders", label: "Pedidos", icon: ClipboardList, count: orders.length },
              { value: "performance", label: "Desempenho", icon: TrendingUp },
              { value: "atendimento", label: "Atendimento", icon: MessageCircle, count: unansweredQuestions, attention: unansweredQuestions > 0 },
              { value: "logs", label: "Integração", icon: AlertTriangle, count: integrationAlerts, attention: integrationAlerts > 0 },
            ]}
            trailing={activeTab === "products" ? (
                <div className="flex rounded-xl border bg-muted/40 p-1">
                  <Button title="Visualização em lista" size="sm" variant={viewMode === "list" ? "secondary" : "ghost"} className="h-8 w-8 rounded-lg p-0" onClick={() => setViewMode("list")}>
                    <List className="h-4 w-4" />
                  </Button>
                  <Button title="Visualização em cards" size="sm" variant={viewMode === "cards" ? "secondary" : "ghost"} className="h-8 w-8 rounded-lg p-0" onClick={() => setViewMode("cards")}>
                    <Grid2X2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : undefined}
          />

          <CardContent className="relative min-h-[300px] pt-4">
            <TabsContent value="overview" className="mt-0 grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border bg-muted/10 p-5">
                <p className="text-sm font-semibold">Operação Mercado Livre</p>
                <p className="mt-1 text-sm text-muted-foreground">Situação atual da integração e dos processos automáticos.</p>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span>Conta conectada</span><Badge variant={connected ? "secondary" : "destructive"}>{connected ? "Pronta" : "Pendente"}</Badge></div>
                  <div className="flex items-center justify-between gap-3"><span>Estoque aguardando sincronização</span><Badge variant="outline">{stockSync.pending}</Badge></div>
                  <div className="flex items-center justify-between gap-3"><span>Alertas de integração</span><Badge variant={integrationAlerts ? "destructive" : "secondary"}>{integrationAlerts}</Badge></div>
                </div>
              </div>
              <div className="rounded-lg border p-5">
                <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Pedidos recentes</p><p className="text-xs text-muted-foreground">Vendas recebidas do Mercado Livre</p></div><Button variant="ghost" size="sm" onClick={() => changeMainTab("orders")}>Ver todos</Button></div>
                <div className="mt-4 divide-y">{orders.slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">Pedido #{order.ml_order_id}</p><p className="text-xs text-muted-foreground">{order.status || "Sem status"}</p></div><p className="text-sm font-medium">{formatCurrency(order.total_amount)}</p></div>)}{!orders.length ? <p className="py-8 text-center text-sm text-muted-foreground">Nenhum pedido recebido.</p> : null}</div>
              </div>
              <div className="lg:col-span-2"><MarketplaceAttentionCenter items={marketplaceAttentionItems} /></div>
            </TabsContent>
            <TabsContent value="products" className="mt-0">
              {viewMode === "list" ? (
                <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[46%]">Produto ERP</TableHead>
                      <TableHead>Qtd. estoque</TableHead>
                      <TableHead>Status estoque</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead>Anúncio ML</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedProducts.map((product) => {
                      const link = product.mercadolivre;
                      return (
                        <TableRow key={product.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-12 w-12 overflow-hidden rounded-md border bg-muted">
                                <ProductImage product={product} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-medium">{product.tituloMarketplace || product.titulo}</div>
                                <div className="text-xs text-muted-foreground">
                                  #{product.id} {product.referencia ? `- ${product.referencia}` : ""}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{product.estoque ?? 0}</TableCell>
                          <TableCell>{stockStatusBadge(product.status_estoque, product.estoque)}</TableCell>
                          <TableCell>{formatCurrency(product.precovenda)}</TableCell>
                          <TableCell>
                            {link ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs">{link.ml_item_id}</span>
                                  {statusBadge(link.status)}
                                </div>
                                <div className="max-w-[260px] truncate text-xs text-muted-foreground">{link.title || "Sem título"}</div>
                                {link.permalink && (
                                  <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" href={link.permalink} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-3 w-3" />
                                    Abrir anúncio
                                  </a>
                                )}
                              </div>
                            ) : linkingProductId === product.id ? (
                              linkEditor(product)
                            ) : (
                              <span className="text-sm text-muted-foreground">Não vinculado</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{productActions(product)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!loadingProducts && products.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                          Nenhum produto encontrado.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
                  {paginatedProducts.map((product) => {
                    const link = product.mercadolivre;
                    return (
                      <div key={product.id} className="overflow-hidden rounded-md border bg-background">
                        <div className="aspect-[16/9] border-b bg-muted">
                          <ProductImage product={product} showControls />
                        </div>
                        <div className="space-y-1.5 p-2">
                          <div className="min-h-[34px]">
                            <div className="line-clamp-2 text-xs font-medium leading-snug">{product.tituloMarketplace || product.titulo}</div>
                            <div className="text-xs text-muted-foreground">
                              #{product.id} {product.referencia ? `- ${product.referencia}` : ""}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <div className="rounded-md border bg-muted/30 px-2 py-1">
                              <div className="text-[11px] text-muted-foreground">Estoque</div>
                              <div className="text-sm font-semibold leading-5">{product.estoque ?? 0}</div>
                            </div>
                            <div className="rounded-md border bg-muted/30 px-2 py-1">
                              <div className="text-[11px] text-muted-foreground">Preço</div>
                              <div className="truncate text-sm font-semibold leading-5">{formatCurrency(product.precovenda)}</div>
                            </div>
                          </div>
                          <div className="min-h-[52px] rounded-md border p-1.5">
                            {link ? (
                              <div className="space-y-0.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px]">{link.ml_item_id}</span>
                                  {statusBadge(link.status)}
                                </div>
                                <div className="line-clamp-1 text-[11px] text-muted-foreground">{link.title || "Sem título"}</div>
                                {link.permalink && (
                                  <a className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" href={link.permalink} target="_blank" rel="noreferrer">
                                    <ExternalLink className="h-3 w-3" />
                                    Abrir anúncio
                                  </a>
                                )}
                              </div>
                            ) : linkingProductId === product.id ? (
                              linkEditor(product)
                            ) : (
                              <div className="flex h-full items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>Não vinculado</span>
                                <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setLinkingProductId(product.id)}>
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                              <PackageCheck className="h-3.5 w-3.5" />
                              {stockStatusBadge(product.status_estoque, product.estoque)}
                            </div>
                            {productActions(product, true)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!loadingProducts && products.length === 0 && (
                    <div className="col-span-full flex h-32 items-center justify-center text-sm text-muted-foreground">
                      Nenhum produto encontrado.
                    </div>
                  )}
                </div>
              )}
              {products.length > 0 && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="flex flex-nowrap text-xs text-muted-foreground">
                    <span>{productsPageStart}</span> - <span>{productsPageEnd}</span>
                    <span className="ml-1 hidden sm:block">de {products.length}</span>
                    <Loader2 className={cn("h-full w-4 animate-spin opacity-0 transition-all", loadingProducts && "opacity-100")} />
                  </div>

                  <div className="flex items-center justify-center space-x-1 sm:space-x-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover:cursor-pointer"
                      onClick={() => setProductsPage(1)}
                      disabled={safeProductsPage === 1}
                    >
                      <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="hover:cursor-pointer"
                      onClick={() => setProductsPage((current) => Math.max(1, current - 1))}
                      disabled={safeProductsPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-nowrap text-[10px] font-medium sm:text-xs">
                      Pg. {safeProductsPage} de {productsTotalPages || 1}
                    </span>
                    <Button
                      className="hover:cursor-pointer"
                      variant="outline"
                      size="sm"
                      onClick={() => setProductsPage((current) => Math.min(productsTotalPages || 1, current + 1))}
                      disabled={safeProductsPage === productsTotalPages || productsTotalPages === 0}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                      className="hover:cursor-pointer"
                      variant="outline"
                      size="sm"
                      onClick={() => setProductsPage(productsTotalPages || 1)}
                      disabled={safeProductsPage === productsTotalPages || productsTotalPages === 0}
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div>
                    <Select
                      value={String(productsPageSize)}
                      onValueChange={(value) => {
                        setProductsPageSize(Number(value));
                        setProductsPage(1);
                      }}
                    >
                      <SelectTrigger size="sm" className="ml-2 hover:cursor-pointer">
                        <SelectValue placeholder={productsPageSize} />
                      </SelectTrigger>
                      <SelectContent>
                        {PRODUCT_PAGE_SIZE_OPTIONS.map((option) => (
                          <SelectItem key={option} className="hover:cursor-pointer" value={String(option)}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="listings" className="mt-0">
              <div className="overflow-hidden rounded-md border">
                <div className="overflow-x-auto">
                  <Table className="min-w-[980px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[34%]">Anúncio</TableHead>
                        <TableHead className="w-[25%]">Produto ERP</TableHead>
                        <TableHead>Desempenho</TableHead>
                        <TableHead>Estoque</TableHead>
                        <TableHead>Preço</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedListingRows.map((row) => {
                        if (row.kind === "unlinked") {
                          const listing = row.listing;
                          return (
                            <TableRow key={`unlinked:${listing.id}`} className="bg-amber-500/[0.03]">
                              <TableCell>
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted">
                                    {listing.thumbnail ? (
                                      <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={listing.thumbnail} alt={listing.title} className="h-full w-full object-contain" />
                                      </>
                                    ) : <ImageIcon className="m-3 h-5 w-5 text-muted-foreground" />}
                                  </div>
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex items-center gap-2"><span className="font-mono text-xs">{listing.id}</span>{statusBadge(listing.status)}</div>
                                    <p className="line-clamp-2 text-sm font-medium">{listing.title}</p>
                                    {listing.permalink ? <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" href={listing.permalink} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Abrir no Mercado Livre</a> : null}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="space-y-2">
                                  <Badge variant="outline" className="border-amber-500/40 text-amber-700">Sem vínculo</Badge>
                                  <div className="flex min-w-[230px] gap-2">
                                    <Select value={publishedProductByItem[listing.id] || ""} onValueChange={(value) => setPublishedProductByItem((current) => ({ ...current, [listing.id]: value }))}>
                                      <SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder="Selecionar produto" /></SelectTrigger>
                                      <SelectContent>{publishableProducts.map((product) => <SelectItem key={product.id} value={String(product.id)}>{product.titulo}{product.referencia ? ` · ${product.referencia}` : ""}</SelectItem>)}</SelectContent>
                                    </Select>
                                    <Button size="icon" variant="outline" onClick={() => linkPublishedListing(listing.id)} disabled={actionKey === `published-link:${listing.id}`} aria-label="Vincular anúncio">
                                      {actionKey === `published-link:${listing.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                                    </Button>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell><div className="space-y-1 text-xs"><p><span className="text-muted-foreground">Visualizações:</span> —</p><p><span className="text-muted-foreground">Vendidos:</span> <strong>{listing.soldQuantity.toLocaleString("pt-BR")}</strong></p></div></TableCell>
                              <TableCell><div className="space-y-1 text-xs"><p><span className="text-muted-foreground">Mercado Livre:</span> <strong>{listing.availableQuantity.toLocaleString("pt-BR")}</strong></p><p className="text-muted-foreground">ERP: sem vínculo</p></div></TableCell>
                              <TableCell className="font-medium">{formatCurrency(listing.price)}</TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">Vincule para editar</TableCell>
                            </TableRow>
                          );
                        }

                        const { product, listing: link } = row;
                        return (
                          <TableRow key={`linked:${link.id}`}>
                            <TableCell>
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted"><ProductImage product={product} /></div>
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{link.ml_item_id}</span>{statusBadge(link.status)}</div>
                                  <p className="line-clamp-2 text-sm font-medium">{link.title || "Sem título"}</p>
                                  <div className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                                    {link.listing_type_id ? <span>{rawStatusLabel(link.listing_type_id)}</span> : null}
                                    {link.item_condition ? <span>{rawStatusLabel(link.item_condition)}</span> : null}
                                    {link.catalog_listing ? <span>Catálogo</span> : null}
                                    {link.health != null && Number.isFinite(Number(link.health)) ? <span>Qualidade {Math.round(Number(link.health) * 100)}%</span> : null}
                                  </div>
                                  {link.permalink ? <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" href={link.permalink} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3" />Abrir no Mercado Livre</a> : null}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <p className="max-w-[260px] truncate text-sm font-medium">{product.tituloMarketplace || product.titulo}</p>
                              <p className="text-xs text-muted-foreground">#{product.id}{product.referencia ? ` · ${product.referencia}` : ""}</p>
                              {link.family_name ? <p className="mt-1 max-w-[260px] truncate text-[11px] text-muted-foreground">Família: {link.family_name}</p> : null}
                            </TableCell>
                            <TableCell><div className="space-y-1 text-xs"><p><span className="text-muted-foreground">Visualizações:</span> <strong>{link.visits_total == null ? "—" : Number(link.visits_total).toLocaleString("pt-BR")}</strong></p><p><span className="text-muted-foreground">Vendidos:</span> <strong>{link.sold_quantity == null ? "—" : Number(link.sold_quantity).toLocaleString("pt-BR")}</strong></p></div></TableCell>
                            <TableCell><div className="space-y-1.5 text-xs"><p><span className="text-muted-foreground">Mercado Livre:</span> <strong>{link.available_quantity == null ? "—" : Number(link.available_quantity).toLocaleString("pt-BR")}</strong></p><div className="flex items-center gap-2"><span><span className="text-muted-foreground">ERP:</span> <strong>{product.estoque ?? 0}</strong></span>{stockStatusBadge(product.status_estoque, product.estoque)}</div></div></TableCell>
                            <TableCell className="font-medium">{formatCurrency(product.precovenda)}</TableCell>
                            <TableCell className="text-right">{productActions(product)}</TableCell>
                          </TableRow>
                        );
                      })}
                      {loadingPublishedListings && filteredListingRows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando anúncios do Mercado Livre...</TableCell></TableRow> : null}
                      {!loadingPublishedListings && filteredListingRows.length === 0 ? <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">{listingRows.length ? "Nenhum anúncio corresponde à busca ou ao filtro." : "Nenhum anúncio encontrado na conta Mercado Livre."}</TableCell></TableRow> : null}
                    </TableBody>
                  </Table>
                </div>
                {filteredListingRows.length > 0 ? (
                  <MarketplacePagination
                    page={safeListingsPage}
                    totalPages={listingsTotalPages}
                    pageSize={listingsPageSize}
                    total={filteredListingRows.length}
                    visible={paginatedListingRows.length}
                    onPageChange={setListingsPage}
                    onPageSizeChange={(value) => { setListingsPageSize(value); setListingsPage(1); }}
                  />
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="performance" className="mt-0">
              <div className="space-y-5">
                <div className="grid divide-y rounded-md border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Visualizações em 30 dias</div>
                    <div className="mt-1 text-2xl font-bold">{performance.visits.toLocaleString("pt-BR")}</div>
                    <div className="text-xs text-muted-foreground">{performance.lifetimeVisits.toLocaleString("pt-BR")} acumuladas</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Pedidos em 30 dias</div>
                    <div className="mt-1 text-2xl font-bold">{performance.orders.toLocaleString("pt-BR")}</div>
                    <div className="text-xs text-muted-foreground">{formatCurrency(performance.revenue)} em vendas válidas</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Itens vendidos</div>
                    <div className="mt-1 text-2xl font-bold">{performance.units.toLocaleString("pt-BR")}</div>
                    <div className="text-xs text-muted-foreground">{performance.lifetimeSold.toLocaleString("pt-BR")} acumulados nos anúncios</div>
                  </div>
                  <div className="px-4 py-3">
                    <div className="text-xs font-medium text-muted-foreground">Taxa de conversão</div>
                    <div className="mt-1 text-2xl font-bold">{performance.conversionRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div>
                    <div className="text-xs text-muted-foreground">Pedidos ÷ visualizações</div>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Visualizações diárias</h3>
                      <div className="text-xs text-muted-foreground">Últimos {performance.periodDays} dias</div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {performance.collectedAt ? `Atualizado em ${formatDate(performance.collectedAt)}` : "Aguardando primeira coleta do agendador"}
                    </div>
                  </div>

                  <div className="mt-5 overflow-x-auto pb-2">
                    <div className="flex h-56 min-w-[900px] items-end gap-1.5 border-b px-1">
                      {performance.daily.map((day, index) => {
                        const height = day.visits > 0 ? Math.max((day.visits / maxDailyVisits) * 100, 4) : 1;
                        const date = new Date(`${day.date}T12:00:00`);
                        const dayLabel = Number.isNaN(date.getTime()) ? day.date : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(date);
                        const showLabel = index % 5 === 0 || index === performance.daily.length - 1;
                        return (
                          <div
                            key={day.date}
                            className="group flex h-full min-w-6 flex-1 flex-col items-center justify-end"
                            title={`${dayLabel}: ${day.visits} visualização(ões), ${day.orders} pedido(s), ${day.units} item(ns)`}
                          >
                            {day.orders > 0 && <span className="mb-1 text-[10px] font-semibold text-emerald-600">{day.orders}</span>}
                            <div className="w-full max-w-7 rounded-t-sm bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${height}%` }} />
                            <span className="mt-1 h-4 whitespace-nowrap text-[10px] text-muted-foreground">{showLabel ? dayLabel : ""}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/75" />Visualizações</span>
                    <span className="font-semibold text-emerald-600">Número acima da barra: pedidos</span>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="orders" className="mt-0">
              <ScrollArea className="h-[calc(100vh-430px)] min-h-[360px] pr-3">
                <div className="space-y-4">
                  {loadingOrdersView ? (
                    <div className="flex min-h-52 items-center justify-center rounded-lg border bg-background">
                      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                        <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary [animation-duration:650ms]" />
                        Carregando pedidos do Mercado Livre...
                      </div>
                    </div>
                  ) : (
                    <Accordion type="multiple" className="space-y-3">
                      {paginatedOrders.map((order) => {
                    const vendaId = Number(order.venda_id);
                    const hasVenda = Number.isFinite(vendaId) && vendaId > 0;
                    const syncingShipment = actionKey === `shipment:${vendaId}`;
                    const orderClaims = claimsByOrderId.get(order.id) ?? [];
                    const orderClaim = orderClaims.find(isActiveClaim) ?? orderClaims[0] ?? null;
                    const orderHasActiveClaim = Boolean(orderClaim && isActiveClaim(orderClaim));
                    const operationalState = getOrderOperationalState(order, orderClaim);
                    const imageUrl = getOrderItemImage(order);
                    const itemTitle = getOrderItemTitle(order);
                    const sku = getOrderItemSku(order);
                    const quantity = getOrderItemQuantity(order);
                    const paymentStatus = getOrderPaymentStatus(order);
                    const shipmentStatus = getOrderShipmentStatus(order);
                    const refundablePayment = getRefundablePayment(order);
                    const refundingOrder = actionKey === `refund:${order.id}`;
                    const canPrintShipmentLabel = hasVenda && canPrintMercadoLivreLabel(order);

                    return (
                      <AccordionItem key={order.id} value={String(order.id)} className="overflow-hidden rounded-lg border bg-background shadow-sm">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="grid min-w-0 flex-1 items-center gap-3 text-left md:grid-cols-[minmax(230px,1fr)_minmax(130px,0.7fr)_110px_125px_135px_100px]">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge variant={orderHasActiveClaim ? "destructive" : "outline"}>{orderHasActiveClaim ? "Reclamação" : "Mercado Livre"}</Badge>
                                <span className="truncate font-mono text-xs">Pedido #{order.ml_order_id}</span>
                              </div>
                              <div className="mt-1 truncate text-sm font-medium">{itemTitle}</div>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{getOrderBuyerLabel(order)}</div>
                              <div className="text-xs text-muted-foreground">{formatMarketplaceOrderDate(order.date_created || order.created_at)}</div>
                            </div>
                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Pedido</div>
                              {statusBadge(order.status)}
                            </div>
                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Pagamento</div>
                              {statusBadge(paymentStatus)}
                            </div>
                            <div className="space-y-1">
                              <div className="text-[11px] text-muted-foreground">Entrega</div>
                              {statusBadge(shipmentStatus || (order.ml_shipment_id ? "pending" : "not_specified"))}
                            </div>
                            <div>
                              <div className="text-[11px] text-muted-foreground">Total</div>
                              <div className="text-sm font-medium">{formatCurrency(order.total_amount)}</div>
                            </div>
                          </div>
                        </AccordionTrigger>

                        <AccordionContent className="px-4 pb-4 data-[state=closed]:duration-300 data-[state=open]:duration-300">
                          <div className="animate-in fade-in-0 slide-in-from-top-1 duration-300 ease-out">
                            <div className="flex flex-col gap-4 border-t pt-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div
                                className={
                                  operationalState.tone === "danger"
                                    ? "font-semibold text-red-600"
                                    : operationalState.tone === "success"
                                      ? "font-semibold text-emerald-700 dark:text-emerald-400"
                                      : operationalState.tone === "warning"
                                        ? "font-semibold text-amber-700 dark:text-amber-400"
                                        : "font-semibold"
                                }
                              >
                                {operationalState.title}
                                {operationalState.tone === "danger" && <AlertTriangle className="ml-1 inline h-4 w-4" />}
                              </div>
                              <div className="mt-1 text-sm text-muted-foreground">{operationalState.description}</div>
                              <div className="mt-2 text-xs text-muted-foreground">Venda ERP {order.venda_id ? `#${order.venda_id}` : "não vinculada"}</div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <Button
                                size="sm"
                                className="h-8 min-w-32 px-3 text-xs"
                                variant={operationalState.tone === "danger" ? "destructive" : "default"}
                                onClick={() => {
                                  if (operationalState.actionType === "label" && canPrintShipmentLabel) openShipmentLabel(vendaId);
                                  else if (operationalState.actionType === "invoice") sendOrderInvoice(order);
                                  else if (operationalState.actionType === "sync_shipment" && hasVenda) syncShipment(vendaId);
                                  else if (operationalState.actionType === "sync") syncOrders();
                                  else setSelectedOrderDetails(order);
                                }}
                              >
                                {operationalState.action}
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="outline" className="h-8 bg-transparent px-2.5 text-xs">
                                    <MoreHorizontal className="h-4 w-4" />
                                    Ações
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                  <DropdownMenuItem onClick={() => hasVenda && syncShipment(vendaId)} disabled={!hasVenda || syncingShipment}>
                                    {syncingShipment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                                    Sincronizar envio
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => hasVenda && openShipmentLabel(vendaId)} disabled={!canPrintShipmentLabel}>
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Abrir etiqueta
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openMarketplaceChat(order.id)}>
                                    <MessageCircle className="mr-2 h-4 w-4" />
                                    Abrir chat
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={syncOrders} disabled={syncing}>
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    Atualizar pedido
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => void loadClaims()} disabled={loadingClaims || !connected}>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Atualizar reclamações
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setCancelSaleForm({ reason: "BUYER_REGRETS", message: "Venda não concretizada a pedido do comprador." });
                                      setOrderToCancel(order);
                                    }}
                                    disabled={!canCancelSale(order, orderHasActiveClaim) || Boolean(actionKey)}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    <XCircle className="mr-2 h-4 w-4" />
                                    Cancelar venda
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => refundOrder(order)} disabled={!refundablePayment || refundingOrder || Boolean(orderClaim)}>
                                    {refundingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                    Reembolsar pagamento
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => sendOrderInvoice(order)}
                                    disabled={!hasVenda || !canSendInvoiceToMercadoLivre(order) || isInvoiceSent(order) || actionKey === `invoice:${order.id}`}
                                  >
                                    {actionKey === `invoice:${order.id}` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                                    {isInvoiceSent(order) ? "NF-e enviada" : "Enviar NF-e"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setSelectedOrderDetails(order)}>
                                    <ClipboardList className="mr-2 h-4 w-4" />
                                    Detalhes
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>

                            <div className="mt-5 grid items-center gap-4 rounded-md bg-muted/40 p-3 md:grid-cols-[minmax(0,1fr)_120px_100px_120px_minmax(120px,180px)]">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
                                {imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={imageUrl} alt={itemTitle} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                    <ImageIcon className="h-5 w-5" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">{itemTitle}</div>
                                <div className="text-xs text-muted-foreground">Venda ERP {order.venda_id ? `#${order.venda_id}` : "não vinculada"}</div>
                              </div>
                            </div>
                            <div>
                              <div className="text-sm font-medium">{formatCurrency(order.total_amount)}</div>
                              {order.shipment_cost != null && <div className="text-xs text-muted-foreground">Frete {formatCurrency(order.shipment_cost)}</div>}
                            </div>
                            <div className="text-sm text-muted-foreground">{quantity} unidade{quantity === 1 ? "" : "s"}</div>
                            <div className="text-sm text-muted-foreground">{order.shipment_cost != null ? formatCurrency(order.shipment_cost) : "Frete -"}</div>
                              <div className="truncate text-xs text-muted-foreground">SKU: {sku}</div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                    </Accordion>
                  )}

                  {!loadingOrdersView && filteredOrders.length === 0 && (
                    <div className="rounded-lg border bg-background py-16 text-center text-muted-foreground">
                      {orders.length ? "Nenhum pedido corresponde aos filtros." : "Nenhum pedido importado."}
                    </div>
                  )}
                </div>
              </ScrollArea>
              <MarketplacePagination page={safeOrderPage} totalPages={orderTotalPages} pageSize={orderPageSize} total={filteredOrders.length} visible={paginatedOrders.length} onPageChange={setOrderPage} onPageSizeChange={setOrderPageSize} />
            </TabsContent>

            <TabsContent value="atendimento" className="mt-0">
              <div className="mb-4 grid gap-2 sm:grid-cols-[220px_1fr]">
                  <Select value={questionStatusFilter} onValueChange={setQuestionStatusFilter}>
                    <SelectTrigger className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNANSWERED">Pendentes</SelectItem>
                      <SelectItem value="ANSWERED">Respondidas</SelectItem>
                      <SelectItem value="UNDER_REVIEW">Em análise</SelectItem>
                      <SelectItem value="all">Todas</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MessageCircle className="h-4 w-4" />
                    {unansweredQuestions} pergunta(s) pendente(s) na visualização atual
                  </div>
              </div>

              <div className="space-y-3">
                {questions.map((question) => {
                  const isAnswering = answeringQuestionId === question.id;
                  const canAnswer = String(question.status ?? "").toUpperCase() === "UNANSWERED";

                  return (
                    <div key={question.id} className="rounded-md border bg-background p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {questionStatusBadge(question.status)}
                            <span className="font-mono text-xs text-muted-foreground">Pergunta #{question.id}</span>
                            {question.itemId && <span className="font-mono text-xs text-muted-foreground">Anúncio {question.itemId}</span>}
                          </div>
                          <p className="text-sm leading-relaxed">{question.text || "-"}</p>
                          <div className="text-xs text-muted-foreground">
                            Cliente {question.from?.id ? `#${question.from.id}` : "-"} · {formatDate(question.dateCreated)}
                          </div>
                        </div>
                        {question.itemId && (
                          <Button size="sm" variant="outline" className="bg-transparent" asChild>
                            <a href={`https://produto.mercadolivre.com.br/${question.itemId}`} target="_blank" rel="noreferrer">
                              <ExternalLink className="h-4 w-4" />
                              Abrir
                            </a>
                          </Button>
                        )}
                      </div>

                      {question.answer?.text && (
                        <div className="mt-3 rounded-md border bg-muted/30 p-3">
                          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                            Respondida em {formatDate(question.answer.dateCreated)}
                          </div>
                          <p className="text-sm">{question.answer.text}</p>
                        </div>
                      )}

                      {canAnswer && (
                        <div className="mt-3">
                          {isAnswering ? (
                            <div className="space-y-2">
                              <Textarea
                                value={answerText}
                                onChange={(event) => setAnswerText(event.target.value)}
                                placeholder="Digite a resposta que será enviada ao Mercado Livre"
                                className="min-h-24"
                              />
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  className="bg-transparent"
                                  onClick={() => {
                                    setAnsweringQuestionId(null);
                                    setAnswerText("");
                                  }}
                                  disabled={actionKey === `answer:${question.id}`}
                                >
                                  Cancelar
                                </Button>
                                <Button onClick={() => answerQuestion(question.id)} disabled={actionKey === `answer:${question.id}`}>
                                  {actionKey === `answer:${question.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  Enviar resposta
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => {
                                setAnsweringQuestionId(question.id);
                                setAnswerText("");
                              }}
                            >
                              <Send className="h-4 w-4" />
                              Responder
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {!loadingQuestions && questions.length === 0 && (
                  <div className="flex h-32 items-center justify-center rounded-md border text-sm text-muted-foreground">
                    Nenhuma pergunta encontrada.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="logs" className="mt-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    diagnostics.status === "ok"
                      ? "bg-emerald-500/10 text-emerald-600"
                      : diagnostics.status === "error"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-amber-500/10 text-amber-600"
                  }`}>
                    {diagnostics.status === "ok" ? <CheckCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
                  </div>
                  <div>
                    <div className="font-medium">
                      {diagnostics.status === "ok" ? "Integração operacional" : diagnostics.status === "error" ? "Integração requer atenção" : "Integração com avisos"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {integrationAlerts} alerta(s) · diagnóstico em {formatDate(diagnostics.checkedAt)}
                    </div>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{notifications.length} evento(s) consultados</div>
                  <div>{stockSync.pending} atualização(ões) de preço/estoque na fila</div>
                </div>
              </div>

              <div className="grid border-b md:grid-cols-2 xl:grid-cols-3">
                {diagnostics.checks.map((check) => (
                  <div key={check.id} className="flex gap-3 border-b px-3 py-3 last:border-b-0 md:border-r xl:[&:nth-child(3n)]:border-r-0">
                    {check.status === "ok" ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : check.status === "error" ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    ) : (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{check.label}</div>
                      <div className="text-xs text-muted-foreground">{marketplaceTextLabel(check.message)}</div>
                      {check.updatedAt && <div className="mt-1 text-[11px] text-muted-foreground">Atualizado em {formatDate(check.updatedAt)}</div>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-b py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Sincronização de preços</h3>
                    <p className="text-xs text-muted-foreground">
                      Alterações enviadas pelo ERP e recebidas do Mercado Livre.
                    </p>
                  </div>
                  <Badge variant="outline">{priceSyncLogs.length} registro(s)</Badge>
                </div>
                <div className="max-h-[360px] overflow-auto rounded-md border">
                  <Table className="min-w-[960px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Direção</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Anúncio</TableHead>
                        <TableHead>Preço anterior</TableHead>
                        <TableHead>Preço final</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Detalhe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {priceSyncLogs.map((log) => {
                        const previousPrice = log.direction === "ERP_PARA_ML" ? log.ml_price_before : log.erp_price_before;
                        const finalPrice = log.direction === "ERP_PARA_ML" ? log.ml_price_after : log.erp_price_after;
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap">{formatDate(log.created_at)}</TableCell>
                            <TableCell className="whitespace-nowrap text-xs font-medium">
                              {log.direction === "ERP_PARA_ML" ? "ERP → Mercado Livre" : "Mercado Livre → ERP"}
                            </TableCell>
                            <TableCell>{log.produto_id ? `#${log.produto_id}` : "-"}</TableCell>
                            <TableCell className="font-mono text-xs">{log.ml_item_id}</TableCell>
                            <TableCell>{previousPrice != null ? formatCurrency(Number(previousPrice)) : "-"}</TableCell>
                            <TableCell>{finalPrice != null ? formatCurrency(Number(finalPrice)) : "-"}</TableCell>
                            <TableCell>{statusBadge(log.status)}</TableCell>
                            <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground" title={log.message || log.source}>
                              {log.message || log.source}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {!loadingDashboard && priceSyncLogs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="h-20 text-center text-muted-foreground">
                            Nenhuma sincronização de preço registrada.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Execuções automáticas</h3>
                    <p className="text-xs text-muted-foreground">Histórico do agendador e resultado de cada rotina.</p>
                  </div>
                  <Badge variant="outline">{syncRuns.length} registro(s)</Badge>
                </div>
                <div className="max-h-[440px] overflow-auto rounded-md border">
                  <Table className="min-w-[760px] table-fixed">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[160px]">Início</TableHead>
                        <TableHead className="w-[110px]">Origem</TableHead>
                        <TableHead className="w-[150px]">Status</TableHead>
                        <TableHead>Resultado</TableHead>
                        <TableHead className="w-[90px] text-right">Duração</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncRuns.map((run) => {
                        const technicalError = String(run.error ?? "").trim();
                        const errorLabel = technicalError ? syncRunErrorLabel(technicalError) : null;
                        const taskResults = Object.entries(run.summary ?? {})
                          .filter(([, value]) => value && typeof value === "object" && ("success" in value || "failed" in value))
                          .reduce(
                            (total, [, value]: any) => ({ success: total.success + Number(value.success ?? 0), failed: total.failed + Number(value.failed ?? 0) }),
                            { success: 0, failed: 0 },
                          );
                        return (
                          <TableRow key={run.id}>
                            <TableCell>{formatDate(run.started_at)}</TableCell>
                            <TableCell className="text-xs">{run.trigger_source === "SUPABASE_CRON" ? "Supabase" : run.trigger_source === "VERCEL_CRON" ? "Vercel" : "Requisição HTTP"}</TableCell>
                            <TableCell>{statusBadge(run.status)}</TableCell>
                            <TableCell className="min-w-0 text-xs">
                              {errorLabel ? (
                                <span className="block truncate text-destructive" title={technicalError}>
                                  {errorLabel}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">{taskResults.success} sucesso(s) · {taskResults.failed} falha(s)</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right text-xs">{run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)} s` : "Em execução"}</TableCell>
                          </TableRow>
                        );
                      })}
                      {!loadingDashboard && syncRuns.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                            Nenhuma execução registrada. A próxima chamada do agendador criará o primeiro registro.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Eventos recebidos</h3>
                  <p className="text-xs text-muted-foreground">Webhooks recentes e tentativas de processamento.</p>
                </div>
                <Badge variant="outline">{notificationErrors} com erro</Badge>
              </div>
              <div className="max-h-[440px] overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tópico</TableHead>
                      <TableHead>Recurso</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Tentativas</TableHead>
                      <TableHead>Detalhe</TableHead>
                      <TableHead>Recebido em</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map((notification) => (
                      <TableRow key={notification.id}>
                        <TableCell className="font-medium">{notification.topic || "-"}</TableCell>
                        <TableCell className="max-w-[360px] truncate font-mono text-xs">{notification.resource || "-"}</TableCell>
                        <TableCell>{statusBadge(notification.status)}</TableCell>
                        <TableCell>{notification.processing_attempts ?? 0}</TableCell>
                        <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">{notification.error || "-"}</TableCell>
                        <TableCell>{formatDate(notification.created_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedNotification(notification)}>
                            Detalhes
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!loadingDashboard && notifications.length === 0 && (
                      <TableRow>
                          <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                          Nenhum log recebido.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <Dialog open={Boolean(selectedNotification)} onOpenChange={(open) => !open && setSelectedNotification(null)}>
                <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Detalhes do evento</DialogTitle>
                    <DialogDescription>Registro completo recebido e resultado do processamento.</DialogDescription>
                  </DialogHeader>
                  {selectedNotification && (
                    <ScrollArea className="max-h-[62vh] pr-4">
                      <div className="grid gap-4 text-sm sm:grid-cols-2">
                        <div><Label>Tópico</Label><p className="mt-1 break-all">{selectedNotification.topic || "-"}</p></div>
                        <div><Label>Status</Label><div className="mt-1">{statusBadge(selectedNotification.status)}</div></div>
                        <div className="sm:col-span-2"><Label>Recurso</Label><p className="mt-1 break-all font-mono text-xs">{selectedNotification.resource || "-"}</p></div>
                        <div><Label>Tentativas</Label><p className="mt-1">{selectedNotification.processing_attempts ?? 0}</p></div>
                        <div><Label>Recebido em</Label><p className="mt-1">{formatDate(selectedNotification.created_at)}</p></div>
                        <div className="sm:col-span-2">
                          <Label>Resultado do processamento</Label>
                          <p className={`mt-1 whitespace-pre-wrap break-words rounded-md border p-3 text-xs ${selectedNotification.error ? "text-destructive" : "text-muted-foreground"}`}>
                            {selectedNotification.error || "Evento processado sem erros."}
                          </p>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Payload recebido</Label>
                          <pre className="mt-1 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 text-xs">
                            {JSON.stringify(selectedNotification.raw_payload ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </ScrollArea>
                  )}
                </DialogContent>
              </Dialog>
            </TabsContent>

          </CardContent>
        </Card>
      </Tabs>

      <Dialog open={false} onOpenChange={() => undefined}>
        <DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Anúncios publicados no Mercado Livre</DialogTitle>
            <DialogDescription>
              Consulte os anúncios ativos ou pausados da conta e vincule cada um ao produto correspondente no ERP.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1 pr-3">
            {loadingPublishedListings ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando anúncios...
              </div>
            ) : publishedListings.length ? (
              <div className="space-y-2 py-1">
                {publishedListings.map((listing) => (
                  <div key={listing.id} className="rounded-lg border p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium">{listing.title}</p>
                          <Badge variant={listing.status === "active" ? "default" : "outline"}>
                            {listing.status === "active" ? "Ativo" : listing.status === "paused" ? "Pausado" : listing.status || "—"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {listing.id} · {formatCurrency(listing.price)} · Estoque {listing.availableQuantity}
                        </p>
                      </div>
                      {listing.produtoId ? (
                        <Badge variant="secondary">Já vinculado</Badge>
                      ) : (
                        <div className="flex min-w-0 flex-col gap-2 sm:w-[330px] sm:flex-row">
                          <Select
                            value={publishedProductByItem[listing.id] || ""}
                            onValueChange={(value) =>
                              setPublishedProductByItem((current) => ({ ...current, [listing.id]: value }))
                            }
                          >
                            <SelectTrigger className="min-w-0 flex-1">
                              <SelectValue placeholder="Selecione o produto do ERP" />
                            </SelectTrigger>
                            <SelectContent>
                              {publishableProducts.map((product) => (
                                <SelectItem key={product.id} value={String(product.id)}>
                                  {product.titulo}{product.referencia ? ` · ${product.referencia}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            onClick={() => linkPublishedListing(listing.id)}
                            disabled={actionKey === `published-link:${listing.id}`}
                          >
                            {actionKey === `published-link:${listing.id}` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Link2 className="h-4 w-4" />
                            )}
                            Vincular
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
                Nenhum anúncio ativo ou pausado foi encontrado nesta conta.
              </div>
            )}
          </ScrollArea>
          <DialogFooter>
            <Button variant="outline">Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setListingFieldErrors({});
        }}
      >
        <DialogContent className="flex h-[92dvh] w-[100dvw] max-w-[100dvw] flex-col overflow-hidden p-4 sm:h-[850px] sm:max-h-[92dvh] sm:w-[95vw] sm:max-w-[1100px] sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle>Criar anúncio Mercado Livre</DialogTitle>
            <DialogDescription>
              Publique um produto do ERP como novo anúncio e salve o vínculo automaticamente.
            </DialogDescription>
          </DialogHeader>
          {listingFieldErrors.general && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {listingFieldErrors.general}
            </div>
          )}

          <div className="grid min-h-0 flex-1 gap-5 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
            <Tabs value={createDialogTab} onValueChange={setCreateDialogTab} className="flex min-h-0 min-w-0 flex-col">
              <TabsList className="h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto rounded-2xl border bg-muted/40 p-1">
                <TabsTrigger value="dados" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Dados
                </TabsTrigger>
                <TabsTrigger value="categoria" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Categoria e venda
                </TabsTrigger>
                <TabsTrigger value="atributos" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Atributos
                </TabsTrigger>
                <TabsTrigger value="midia" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Mídia
                </TabsTrigger>
                <TabsTrigger value="envio" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Envio
                </TabsTrigger>
                <TabsTrigger value="revisao" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Revisão
                </TabsTrigger>
              </TabsList>

              <TabsContent value="dados" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className="space-y-2">
                  <Label>Produto do ERP</Label>
                  <Select
                    value={listingForm.produtoId}
                    onValueChange={selectListingProduct}
                    disabled={creatingListing || publishableProducts.length === 0}
                  >
                    <SelectTrigger className={fieldClass("product", listingSelectClass)}>
                      <SelectValue placeholder="Selecione um produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {publishableProducts.map((product) => (
                        <SelectItem key={product.id} value={String(product.id)}>
                          #{product.id} - {product.tituloMarketplace || product.titulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {publishableProducts.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum produto disponível para publicar.</p>
                  )}
                  {listingFieldErrors.product && <p className="text-xs text-destructive">{listingFieldErrors.product}</p>}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                  <Label>{userProductSeller ? "Título cadastrado no ERP" : "Título do anúncio"}</Label>
                    <span className="text-xs text-muted-foreground">{listingForm.title.length}/60</span>
                  </div>
                  <Input
                    value={listingForm.title}
                    onChange={(event) => updateListingForm("title", event.target.value)}
                    disabled={creatingListing}
                    maxLength={60}
                    className={fieldClass("title")}
                  />
                  {listingFieldErrors.title && <p className="text-xs text-destructive">{listingFieldErrors.title}</p>}
                  {userProductSeller && (
                    <div className="flex gap-2 rounded-md border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs leading-relaxed text-foreground">
                      <Info className="mt-0.5 size-4 shrink-0 text-blue-600" />
                      <p>
                        Esta conta usa o modelo User Products. Este título identifica o produto no ERP, mas não é enviado como
                        título final. O nome público será baseado na <strong>Família do produto</strong>, configurada na próxima etapa.
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Preço</Label>
                    <div>
                      <ValueInput
                        value={parseCurrencyInput(listingForm.price)}
                        onValueChange={(value) => updateListingForm("price", formatCurrencyInputFromNumber(value))}
                        disabled={creatingListing}
                        className={fieldClass("price")}
                      />
                    </div>
                    {listingFieldErrors.price && <p className="text-xs text-destructive">{listingFieldErrors.price}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Estoque</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={listingForm.availableQuantity}
                      onChange={(event) => updateListingForm("availableQuantity", event.target.value)}
                      disabled={creatingListing}
                      className={`${fieldClass("stock")} ${freeListingStockIssue ? listingErrorClass : ""}`}
                    />
                    {(listingFieldErrors.stock || freeListingStockIssue) && (
                      <p className="text-xs text-destructive">{listingFieldErrors.stock || freeListingStockIssue}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>SKU interno</Label>
                    <Input
                      value={listingForm.sku}
                      onChange={(event) => updateListingForm("sku", event.target.value)}
                      disabled={creatingListing}
                      placeholder="Referência do ERP"
                      className={listingFieldClass}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Descrição</Label>
                  <Textarea
                    value={listingForm.description}
                    onChange={(event) => updateListingForm("description", event.target.value)}
                    disabled={creatingListing}
                    className={`min-h-40 ${listingFieldClass}`}
                  />
                </div>
              </TabsContent>

              <TabsContent value="categoria" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border px-3 py-2 text-xs ${
                  listingCommercialInfo.seller?.canList === false
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : "bg-muted/20 text-muted-foreground"
                }`}>
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {loadingListingCommercialInfo ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : listingCommercialInfo.seller?.canList === false ? (
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    Conta vendedora
                  </span>
                  <span>
                    {listingCommercialInfo.seller?.canList === false
                      ? listingCommercialInfo.seller.restrictions.join(" ") || "Publicação bloqueada pelo Mercado Livre."
                      : "Autorizada a publicar"}
                  </span>
                  {listingCommercialInfo.seller?.powerSellerStatus && (
                    <Badge variant="outline" className="h-5 rounded px-1.5 text-[10px]">
                      {sellerLevelLabel(listingCommercialInfo.seller.powerSellerStatus)}
                    </Badge>
                  )}
                  {listingCommercialInfo.error && <span className="text-destructive">{listingCommercialInfo.error}</span>}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipo no Mercado Livre</Label>
                    <Select
                      value={listingForm.categoryVertical}
                      onValueChange={(value) => changeCategoryVertical(value as MarketplaceVertical)}
                      disabled={creatingListing}
                    >
                      <SelectTrigger className={fieldClass("listingType", listingSelectClass)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="products">Produtos</SelectItem>
                        <SelectItem value="vehicles">Veículos</SelectItem>
                        <SelectItem value="real_estate">Imóveis</SelectItem>
                        <SelectItem value="services">Serviços</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Categoria Mercado Livre</Label>
                    <Popover open={categoryPopoverOpen} onOpenChange={setCategoryPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className={`h-10 w-full justify-between px-3 py-2 text-left ${fieldClass("category")}`}
                          disabled={creatingListing}
                        >
                          <span className="min-w-0">
                            {listingForm.categoryId ? (
                              <span className="block truncate">
                                {listingForm.categoryName || listingForm.categoryId}
                                <span className="ml-2 font-mono text-xs text-muted-foreground">{listingForm.categoryId}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Selecionar categoria</span>
                            )}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={categorySearch}
                            onValueChange={setCategorySearch}
                            placeholder="Buscar categoria..."
                          />
                          <div className="flex items-center justify-between gap-2 border-b px-2 py-2">
                            <div className="min-w-0 text-xs text-muted-foreground">
                              {categoryParent ? (
                                <span className="block truncate">{categoryParent.path || categoryParent.name}</span>
                              ) : (
                                <span>Categorias iniciais</span>
                              )}
                            </div>
                            {categoryParent && (
                              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={backCategoryLevel}>
                                Voltar
                              </Button>
                            )}
                          </div>
                          <CommandList>
                            <CommandEmpty>
                              {loadingCategories ? "Buscando categorias..." : "Nenhuma categoria encontrada."}
                            </CommandEmpty>
                            <CommandGroup>
                              {categoryOptions.map((category) => (
                                <CommandItem
                                  key={category.id}
                                  value={`${category.id} ${category.name}`}
                                  onSelect={() => {
                                    if (category.childrenCount && category.childrenCount > 0) browseCategory(category);
                                    else selectCategory(category);
                                  }}
                                  className="items-start gap-3"
                                >
                                  <Check
                                    className={`mt-1 h-4 w-4 ${
                                      listingForm.categoryId === category.id ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <span className="min-w-0">
                                    <span className="block truncate font-medium">{category.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {category.path || category.domainName || category.id}
                                    </span>
                                    <span className="font-mono text-xs text-muted-foreground">
                                      {category.id}
                                      {typeof category.totalItems === "number" ? ` · ${category.totalItems.toLocaleString("pt-BR")} anúncios` : ""}
                                    </span>
                                  </span>
                                  <span className="ml-auto flex shrink-0 gap-1">
                                    {category.childrenCount && category.childrenCount > 0 ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          event.stopPropagation();
                                          browseCategory(category);
                                        }}
                                      >
                                        Abrir
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 bg-transparent px-2 text-xs"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        selectCategory(category);
                                      }}
                                    >
                                      Selecionar
                                    </Button>
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {listingFieldErrors.category && <p className="text-xs text-destructive">{listingFieldErrors.category}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de anúncio</Label>
                    <Select
                      value={listingForm.listingTypeId}
                      onValueChange={(value) => updateListingForm("listingTypeId", value)}
                      disabled={creatingListing}
                    >
                      <SelectTrigger className={fieldClass("listingType", listingSelectClass)}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {listingTypeOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id} disabled={option.available === false}>
                            {option.name}
                            {option.remainingListings != null ? ` · ${option.remainingListings} restante(s)` : ""}
                            {option.saleFee != null ? ` · taxa ${formatCurrency(option.saleFee)}` : ""}
                            {option.available === false ? " · indisponível" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {listingFieldErrors.listingType && <p className="text-xs text-destructive">{listingFieldErrors.listingType}</p>}
                    {selectedListingType?.restrictionReason && selectedListingType.available === false && (
                      <p className="text-xs text-destructive">{selectedListingType.restrictionReason}</p>
                    )}
                  </div>
                </div>

                {selectedListingType && (
                  <div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-background px-3 py-2.5">
                      <div className="text-[11px] text-muted-foreground">Tarifa estimada</div>
                      <div className="mt-0.5 text-sm font-semibold">
                        {selectedListingType.saleFee != null ? formatCurrency(selectedListingType.saleFee) : "A calcular"}
                      </div>
                      {selectedListingType.saleFeePercentage != null && (
                        <div className="text-[11px] text-muted-foreground">{selectedListingType.saleFeePercentage.toLocaleString("pt-BR")}% do valor</div>
                      )}
                      {selectedListingType.fixedFee != null && selectedListingType.fixedFee > 0 && (
                        <div className="text-[11px] text-muted-foreground">Inclui custo fixo de {formatCurrency(selectedListingType.fixedFee)}</div>
                      )}
                    </div>
                    <div className="bg-background px-3 py-2.5">
                      <div className="text-[11px] text-muted-foreground">Recebimento estimado</div>
                      <div className="mt-0.5 text-sm font-semibold">
                        {selectedListingType.netAmount != null ? formatCurrency(selectedListingType.netAmount) : "A calcular"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">Antes do custo de envio</div>
                    </div>
                    <div className="bg-background px-3 py-2.5">
                      <div className="text-[11px] text-muted-foreground">Parcelamento</div>
                      <div className="mt-0.5 text-sm font-semibold">
                        {selectedListingType.interestFreeInstallments ? "Sem juros" : "Com juros do comprador"}
                      </div>
                      {selectedListingType.financingFee != null && selectedListingType.financingFee > 0 && (
                        <div className="text-[11px] text-muted-foreground">Custo incluído: {formatCurrency(selectedListingType.financingFee)}</div>
                      )}
                    </div>
                    <div className="bg-background px-3 py-2.5">
                      <div className="text-[11px] text-muted-foreground">Pagamentos</div>
                      <div className="mt-0.5 line-clamp-2 text-xs font-medium">
                        {listingCommercialInfo.payment?.methods.length
                          ? listingCommercialInfo.payment.methods.map((method) => method.name).join(", ")
                          : "Definidos pelo Mercado Pago"}
                      </div>
                    </div>
                  </div>
                )}

                {selectedListingType?.paymentDescription && (
                  <p className="text-xs text-muted-foreground">{selectedListingType.paymentDescription}</p>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Condição</Label>
                    <Select
                      value={listingForm.condition}
                      onValueChange={(value) => updateListingForm("condition", value as ListingForm["condition"])}
                      disabled={creatingListing}
                    >
                      <SelectTrigger className={listingSelectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {conditionOptions.map((condition) => (
                          <SelectItem key={condition} value={condition}>
                            {condition === "new" ? "Novo" : condition === "used" ? "Usado" : "Não especificado"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tipo de garantia</Label>
                    <Select
                      value={listingForm.warranty}
                      onValueChange={(value) => {
                        updateListingForm("warranty", value);
                        if (value === "Sem garantia") updateListingForm("warrantyTime", "");
                      }}
                      disabled={creatingListing}
                    >
                      <SelectTrigger className={listingSelectClass}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Sem garantia">Sem garantia</SelectItem>
                        <SelectItem value="Garantia de fábrica">Garantia de fábrica</SelectItem>
                        <SelectItem value="Garantia do vendedor">Garantia do vendedor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Prazo da garantia</Label>
                    <Select
                      value={listingForm.warrantyTime}
                      onValueChange={(value) => updateListingForm("warrantyTime", value)}
                      disabled={creatingListing || listingForm.warranty === "Sem garantia"}
                    >
                      <SelectTrigger className={listingSelectClass}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30 dias">30 dias</SelectItem>
                        <SelectItem value="60 dias">60 dias</SelectItem>
                        <SelectItem value="90 dias">90 dias</SelectItem>
                        <SelectItem value="6 meses">6 meses</SelectItem>
                        <SelectItem value="12 meses">12 meses</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="atributos" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                {userProductSeller && <div className={`rounded-md border border-primary/30 bg-primary/[0.035] p-3 text-sm ${listingFieldErrors.family ? "border-destructive bg-destructive/10" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium">
                      Família do produto
                      <Badge variant="secondary" className="text-[10px]">Define o título público</Badge>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">{familyNamePreview.length}/60</span>
                  </div>
                  <Input
                    value={listingForm.familyName}
                    onChange={(event) => updateListingForm("familyName", event.target.value.slice(0, 60))}
                    disabled={creatingListing}
                    className={`mt-2 ${fieldClass("family")}`}
                    placeholder={buildListingFamilyName({ ...listingForm, familyName: "" }) || "Ex.: Wega WO-120"}
                  />
                  <div className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    <p>
                      Este é o nome enviado ao Mercado Livre. Se ficar vazio, o ERP gera usando Marca + Modelo + Número da peça.
                    </p>
                    <p>
                      <strong className="text-foreground">Nome que será enviado:</strong>{" "}
                      <span className="font-mono text-foreground">{familyNamePreview || "Não gerada"}</span>
                    </p>
                    <p>O Mercado Livre ainda poderá padronizar letras maiúsculas, termos e ordem das palavras.</p>
                  </div>
                  {listingFieldErrors.family && <p className="mt-2 text-xs text-destructive">{listingFieldErrors.family}</p>}
                </div>}

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Atributos da categoria</h3>
                      <p className="text-xs text-muted-foreground">
                        O Mercado Livre define estes campos conforme a categoria selecionada.
                      </p>
                    </div>
                    {loadingAttributes && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </div>

                  {!listingForm.categoryId && (
                    <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                      Selecione uma categoria para carregar os atributos específicos do Mercado Livre.
                    </div>
                  )}

                  {listingForm.categoryId && !loadingAttributes && categoryAttributes.length === 0 && (
                    <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                      Nenhum atributo adicional retornado para esta categoria.
                    </div>
                  )}

                  {categoryAttributes.length > 0 && (
                    <div className="grid gap-3 xl:grid-cols-2">
                      {categoryAttributes.map((attribute) => {
                        const value = listingForm.dynamicAttributes[attribute.id] ?? "";
                        const disabledAttribute = creatingListing || (attribute.fixed && Boolean(value));
                        const attributeError = listingFieldErrors[`attr:${attribute.id}`];
                        return (
                          <div
                            key={attribute.id}
                            className={`flex min-h-[112px] flex-col gap-2 rounded-md border bg-background p-3 shadow-sm ${
                              attributeError ? "border-destructive bg-destructive/10" : ""
                            }`}
                          >
                            <div className="flex min-h-5 items-start justify-between gap-3">
                              <Label className="leading-5">
                                {attribute.name}
                                {attribute.required && <span className="ml-1 text-destructive">*</span>}
                              </Label>
                              <div className="flex shrink-0 items-center gap-1">
                                {attribute.role && attribute.role !== "standard" && (
                                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                    {attribute.role === "parent" ? "Família" : attribute.role === "child" ? "Variação" : "Variável"}
                                  </Badge>
                                )}
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                  {attribute.id}
                                </span>
                              </div>
                            </div>
                            {attribute.values.length > 0 ? (
                              <ControlledAttributeInput
                                attribute={attribute}
                                value={value}
                                disabled={disabledAttribute}
                                onChange={(nextValue) => updateDynamicAttribute(attribute.id, nextValue)}
                              />
                            ) : attribute.valueType === "boolean" ? (
                              <Select value={value} onValueChange={(nextValue) => updateDynamicAttribute(attribute.id, nextValue)} disabled={disabledAttribute}>
                                <SelectTrigger className={listingSelectClass}>
                                  <SelectValue placeholder="Selecione" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="true">Sim</SelectItem>
                                  <SelectItem value="false">Não</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : attribute.valueType === "number_unit" ? (
                              <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                                <Input
                                  type="number"
                                  value={value}
                                  onChange={(event) => updateDynamicAttribute(attribute.id, event.target.value)}
                                  disabled={disabledAttribute}
                                  className={listingFieldClass}
                                />
                                <Select
                                  value={listingForm.dynamicAttributes[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || attribute.allowedUnits[0]?.name || ""}
                                  onValueChange={(nextValue) => updateDynamicAttribute(`${attribute.id}__unit`, nextValue)}
                                  disabled={disabledAttribute || attribute.allowedUnits.length === 0}
                                >
                                  <SelectTrigger className={listingSelectClass}>
                                    <SelectValue placeholder="Un." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(attribute.allowedUnits.length ? attribute.allowedUnits : [{ id: attribute.defaultUnit ?? "", name: attribute.defaultUnit ?? "Un." }]).map((unit) => (
                                      <SelectItem key={`${attribute.id}:${unit.id ?? unit.name}`} value={unit.id ?? unit.name}>
                                        {unit.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            ) : (
                              <Input
                                value={value}
                                onChange={(event) => updateDynamicAttribute(attribute.id, event.target.value)}
                                disabled={disabledAttribute}
                                className={listingFieldClass}
                                placeholder={attribute.defaultUnit ? `Valor em ${attribute.defaultUnit}` : undefined}
                              />
                            )}
                            {attributeError && <p className="text-xs text-destructive">{attributeError}</p>}
                            {attribute.hint && <p className="line-clamp-2 text-xs text-muted-foreground">{attribute.hint}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="midia" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className="space-y-2">
                  <Label>Imagens do anúncio</Label>
                  <Textarea
                    value={listingForm.pictureUrl}
                    onChange={(event) => updateListingForm("pictureUrl", event.target.value)}
                    placeholder="Uma URL por linha"
                    disabled={creatingListing}
                    className={`min-h-28 ${fieldClass("images")}`}
                  />
                  {listingFieldErrors.images && <p className="text-xs text-destructive">{listingFieldErrors.images}</p>}
                  <p className="text-xs text-muted-foreground">Use URLs públicas das imagens. A primeira será usada na pré-visualização.</p>
                </div>
              </TabsContent>

              <TabsContent value="envio" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Modo de envio</Label>
                    <Select
                      value={listingForm.shippingMode}
                      onValueChange={(value) => updateListingForm("shippingMode", value)}
                      disabled={creatingListing || loadingAttributes || !listingForm.categoryId}
                    >
                      <SelectTrigger className={`${fieldClass("shipping", listingSelectClass)} ${categoryBlocksMercadoEnvios ? listingErrorClass : ""}`}>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="me2" disabled={!categorySupportsMercadoEnvios}>
                          Mercado Envios
                        </SelectItem>
                        <SelectItem value="custom">Envio personalizado</SelectItem>
                        <SelectItem value="pickup">Retirada / própria</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{listingForm.shippingMode === "me2" ? "Logística" : "Alternativa"}</Label>
                    {listingForm.shippingMode === "me2" ? (
                      <Select
                        value={listingForm.logisticType}
                        onValueChange={(value) => updateListingForm("logisticType", value)}
                        disabled={creatingListing || loadingAttributes || shippingEligibility.logisticOptions.length === 0}
                      >
                        <SelectTrigger className={fieldClass("shipping", listingSelectClass)}>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {shippingEligibility.logisticOptions.map((option) => (
                            <SelectItem key={option} value={option}>{shippingLogisticLabel(option)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={listingForm.shippingMode === "custom" ? listingForm.customShippingDescription : "Retirada / entrega própria"}
                        onChange={(event) => updateListingForm("customShippingDescription", event.target.value)}
                        disabled={creatingListing || listingForm.shippingMode === "pickup"}
                        className={fieldClass("shipping")}
                      />
                    )}
                  </div>
                </div>

                {listingForm.shippingMode === "me2" && (
                  <div className="space-y-3">
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Comprimento (cm)</Label>
                        <Input value={listingForm.lengthCm} onChange={(event) => updateListingForm("lengthCm", event.target.value)} disabled={creatingListing} className={fieldClass("dimensions")} inputMode="decimal" />
                      </div>
                      <div className="space-y-2">
                        <Label>Largura (cm)</Label>
                        <Input value={listingForm.widthCm} onChange={(event) => updateListingForm("widthCm", event.target.value)} disabled={creatingListing} className={fieldClass("dimensions")} inputMode="decimal" />
                      </div>
                      <div className="space-y-2">
                        <Label>Altura (cm)</Label>
                        <Input value={listingForm.heightCm} onChange={(event) => updateListingForm("heightCm", event.target.value)} disabled={creatingListing} className={fieldClass("dimensions")} inputMode="decimal" />
                      </div>
                      <div className="space-y-2">
                        <Label>Peso (g)</Label>
                        <Input value={listingForm.weightGrams} onChange={(event) => updateListingForm("weightGrams", event.target.value.replace(/\D/g, ""))} disabled={creatingListing} className={fieldClass("dimensions")} inputMode="numeric" />
                      </div>
                    </div>
                    {shippingEligibility.defaultDimensions ? (
                      <p className="text-xs text-muted-foreground">
                        Referência da categoria: {shippingEligibility.defaultDimensions.length ?? "-"} × {shippingEligibility.defaultDimensions.width ?? "-"} × {shippingEligibility.defaultDimensions.height ?? "-"} cm, {shippingEligibility.defaultDimensions.weight ?? "-"} g. Informe as medidas reais da embalagem.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="bg-transparent"
                        onClick={simulateShippingQuote}
                        disabled={creatingListing || loadingShippingQuote || Boolean(missingShippingDimensions) || !listingForm.logisticType || !categorySupportsMercadoEnvios}
                      >
                        {loadingShippingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
                        Simular custo do vendedor
                      </Button>
                      {shippingQuote ? (
                        <div className="text-sm">
                          Custo estimado: <strong>{formatCurrency(shippingQuote.sellerCost ?? shippingQuote.listCost ?? 0)}</strong>
                          {shippingQuote.listCost != null && shippingQuote.sellerCost != null && shippingQuote.listCost !== shippingQuote.sellerCost
                            ? ` (tabela ${formatCurrency(shippingQuote.listCost)})`
                            : ""}
                          {shippingQuote.billableWeight != null ? ` · peso tarifado ${shippingQuote.billableWeight} g` : ""}
                          {shippingOriginLabel(shippingQuote.origin) ? ` · origem ${shippingOriginLabel(shippingQuote.origin)}` : ""}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
                {listingForm.categoryId && shippingEligibility.loaded && !categoryShippingIssue && listingForm.shippingMode === "me2" && (
                  <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    Mercado Envios validado para esta conta e categoria. Logística disponível: {shippingEligibility.logisticOptions.map(shippingLogisticLabel).join(", ") || "definida automaticamente pelo Mercado Livre"}.
                  </div>
                )}
                {listingForm.shippingMode === "custom" && (
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Valor do frete</Label>
                      <div>
                        <ValueInput
                          value={parseCurrencyInput(listingForm.customShippingCost)}
                          onValueChange={(value) =>
                            updateListingForm("customShippingCost", formatCurrencyInputFromNumber(value))
                          }
                          disabled={creatingListing || listingForm.freeShipping}
                          className={fieldClass("shipping")}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Prazo</Label>
                      <Input
                        value={listingForm.customShippingDeadlineDays}
                        onChange={(event) => updateListingForm("customShippingDeadlineDays", event.target.value.replace(/\D/g, ""))}
                        disabled={creatingListing}
                        className={fieldClass("shipping")}
                        inputMode="numeric"
                        placeholder="Dias úteis"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>Consulta por CEP</Label>
                      <Input
                        value={listingForm.customShippingQuoteZip}
                        onChange={(event) => updateListingForm("customShippingQuoteZip", event.target.value.replace(/\D/g, "").slice(0, 8))}
                        disabled={creatingListing}
                        className={fieldClass("shipping")}
                        inputMode="numeric"
                        placeholder="Digite o CEP para simular"
                      />
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm sm:col-span-4">
                      {listingForm.customShippingQuoteZip.length === 8 ? (
                        <span>
                          Para o CEP {listingForm.customShippingQuoteZip.replace(/^(\d{5})(\d{3})$/, "$1-$2")}:{" "}
                          <strong>{listingForm.freeShipping ? "Frete grátis" : formatCurrency(parseCurrencyInput(listingForm.customShippingCost))}</strong>
                          {Number(listingForm.customShippingDeadlineDays) > 0 ? ` em até ${listingForm.customShippingDeadlineDays} dia(s) úteis.` : "."}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          A consulta usa o valor e prazo configurados neste anúncio. Para cálculo real por transportadora, será necessário integrar Correios, Melhor Envio ou outro provedor.
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {categoryShippingIssue && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {categoryShippingIssue}
                  </div>
                )}
                {customShippingIssue && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {customShippingIssue}
                  </div>
                )}
                {(listingFieldErrors.shipping || listingFieldErrors.dimensions) && (
                  <p className="text-xs text-destructive">{listingFieldErrors.shipping || listingFieldErrors.dimensions}</p>
                )}

                <div className="grid gap-3 sm:grid-cols-1">
                  <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-3 text-sm">
                    <Checkbox checked={listingForm.freeShipping} onCheckedChange={(checked) => updateListingForm("freeShipping", checked === true)} disabled={creatingListing} />
                    Oferecer frete grátis
                  </label>
                </div>
              </TabsContent>

              <TabsContent value="revisao" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className="rounded-md border bg-background p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">Checklist de publicação</h3>
                      <p className="text-xs text-muted-foreground">Corrija os itens pendentes antes de publicar no Mercado Livre.</p>
                    </div>
                    {canPublishListing ? (
                      <Badge className="bg-emerald-600 text-white">Pronto</Badge>
                    ) : (
                      <Badge className="bg-yellow-600 text-white">{listingIssues.length} pendência(s)</Badge>
                    )}
                  </div>
                  <div className="mt-4 space-y-2">
                    {listingIssues.length > 0 ? (
                      listingIssues.map((issue) => (
                        <div key={issue} className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-yellow-600" />
                          {issue}
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                        <Check className="h-4 w-4 text-emerald-600" />
                        Os dados mínimos estão preenchidos para tentar publicar.
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">{userProductSeller ? "Título cadastrado no ERP" : "Produto"}</div>
                    <div className="font-medium">{listingForm.title || "-"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{listingForm.sku || "SKU não informado"}</div>
                  </div>
                  {userProductSeller && (
                    <div className="rounded-md border border-primary/30 bg-primary/[0.035] p-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                        <Info className="size-3.5" />
                        Nome enviado ao Mercado Livre
                      </div>
                      <div className="mt-1 font-medium">{familyNamePreview || "-"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">O título público será baseado nesta família e poderá ser padronizado pelo Mercado Livre.</div>
                    </div>
                  )}
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">Categoria</div>
                    <div className="font-medium">{listingForm.categoryName || listingForm.categoryId || "-"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{listingForm.categoryPath || listingForm.categoryId || "-"}</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">Preço e estoque</div>
                    <div className="font-medium">{formatCurrency(parseCurrencyInput(listingForm.price))}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{listingForm.availableQuantity || 0} unidade(s)</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">Envio</div>
                    <div className="font-medium">{listingForm.shippingMode === "me2" ? "Mercado Envios" : listingForm.shippingMode === "custom" ? "Personalizado" : "Não especificado"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {listingForm.lengthCm || "-"} x {listingForm.widthCm || "-"} x {listingForm.heightCm || "-"} cm, {listingForm.weightGrams || "-"} g
                    </div>
                  </div>
                </div>

                {categoryAttributes.length > 0 && (
                  <div className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">Atributos enviados</h3>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {categoryAttributes
                        .filter((attribute) => formatAttributeValue(attribute, listingForm.dynamicAttributes))
                        .map((attribute) => (
                          <div key={attribute.id} className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                            <div className="text-muted-foreground">{attribute.name}</div>
                            <div className="font-medium text-foreground">{formatAttributeValue(attribute, listingForm.dynamicAttributes)}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="min-h-0 overflow-hidden lg:self-start">
              <div className="max-h-full overflow-y-auto rounded-md border bg-background">
                <div className="aspect-[4/3] bg-muted">
                  {selectedPreviewImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedPreviewImage}
                      alt={listingForm.title || "Prévia do anúncio"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>
                {previewImages.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto border-t p-2">
                    {previewImages.map((url, index) => (
                      <button
                        key={`${url}:${index}`}
                        type="button"
                        onClick={() => setPreviewImageIndex(index)}
                        className={`h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted ${
                          index === previewImageIndex ? "ring-2 ring-primary ring-offset-2" : "opacity-75 hover:opacity-100"
                        }`}
                        aria-label={`Visualizar imagem ${index + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="space-y-3 p-4 pb-5">
                  <div>
                    <div className="line-clamp-2 text-sm font-medium">
                      {(userProductSeller ? familyNamePreview : listingForm.title) || "Título do anúncio"}
                    </div>
                    {userProductSeller && <div className="mt-1 text-[10px] text-muted-foreground">Prévia baseada na família do produto</div>}
                    <div className="mt-2 text-2xl font-semibold">{formatCurrency(parseCurrencyInput(listingForm.price))}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                      <div className="text-muted-foreground">Estoque</div>
                      <div className="font-semibold">{listingForm.availableQuantity || "0"}</div>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                      <div className="text-muted-foreground">Tipo</div>
                      <div className="font-semibold">
                        {selectedListingType?.name || listingForm.listingTypeId || "Não definido"}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div>Categoria: {listingForm.categoryName || listingForm.categoryId || "Não informada"}</div>
                    {listingForm.categoryPath && <div className="line-clamp-2">Caminho: {listingForm.categoryPath}</div>}
                    {listingForm.categoryId && <div>Código: {listingForm.categoryId}</div>}
                    <div>SKU: {listingForm.sku || "Não informado"}</div>
                    <div>Marca: {listingForm.brand || "Não informada"}</div>
                    <div>Modelo: {listingForm.model || "Não informado"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background pt-4">
            <Button variant="outline" className="bg-transparent" onClick={() => setCreateDialogOpen(false)} disabled={creatingListing}>
              Cancelar
            </Button>
            <Button
              onClick={createListing}
              disabled={creatingListing || !canPublishListing}
            >
              {creatingListing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Publicar anúncio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[92dvh] sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1100px] sm:rounded-lg sm:border">
          {loadingEditListing && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-background">
              <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
              <span className="text-primary">Carregando...</span>
            </div>
          )}
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5 sm:pr-12">
            <DialogTitle>Editar anúncio Mercado Livre</DialogTitle>
            <DialogDescription>
              Atualize os dados principais do anúncio publicado e sincronize com o Mercado Livre.
            </DialogDescription>
          </DialogHeader>
          {(!editCapabilities.price || !editCapabilities.stock || !editCapabilities.title || !editCapabilities.pictures) && (
            <div className="mx-4 mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 sm:mx-6">
              Alguns campos estão bloqueados pelas regras do Mercado Livre:
              {!editCapabilities.price && " preço com automação ativa;"}
              {!editCapabilities.stock && " estoque administrado pela logística Full/multiorigem;"}
              {!editCapabilities.title && " título controlado pelo catálogo/família;"}
              {!editCapabilities.pictures && " imagens controladas pelo catálogo;"}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Título do anúncio</Label>
                <Input
                  value={editForm.title}
                  onChange={(event) => updateEditForm("title", event.target.value)}
                  disabled={editingListing || loadingEditListing || !editCapabilities.title}
                  maxLength={60}
                  className={listingFieldClass}
                />
              </div>
              <div className="space-y-2">
                <Label>Código ML</Label>
                <Input value={editForm.itemId} disabled className={listingFieldClass} />
              </div>
              {editForm.userProductEnabled && (
                <>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Família do produto</Label>
                    <Input
                      value={editForm.familyName}
                      onChange={(event) => updateEditForm("familyName", event.target.value.slice(0, 120))}
                      disabled={editingListing || loadingEditListing}
                      maxLength={120}
                      className={listingFieldClass}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>User Product</Label>
                    <Input value={editForm.userProductId || "Gerado pelo Mercado Livre"} disabled className={listingFieldClass} />
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Preço</Label>
                <div>
                  <ValueInput
                    value={parseCurrencyInput(editForm.price)}
                    onValueChange={(value) => updateEditForm("price", formatCurrencyInputFromNumber(value))}
                    disabled={editingListing || loadingEditListing || !editCapabilities.price}
                    className={listingFieldClass}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Estoque disponível</Label>
                <Input
                  type="number"
                  min="0"
                  value={editForm.availableQuantity}
                  onChange={(event) => updateEditForm("availableQuantity", event.target.value)}
                    disabled={editingListing || loadingEditListing || !editCapabilities.stock}
                  className={listingFieldClass}
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo de garantia</Label>
                <Select
                  value={editForm.warranty || "none"}
                  onValueChange={(value) => {
                    updateEditForm("warranty", value === "none" ? "" : value);
                    if (value === "Sem garantia") updateEditForm("warrantyTime", "");
                  }}
                  disabled={editingListing || loadingEditListing}
                >
                  <SelectTrigger className={listingSelectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não alterar</SelectItem>
                    <SelectItem value="Sem garantia">Sem garantia</SelectItem>
                    <SelectItem value="Garantia de fábrica">Garantia de fábrica</SelectItem>
                    <SelectItem value="Garantia do vendedor">Garantia do vendedor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Prazo da garantia</Label>
                <Select
                  value={editForm.warrantyTime || "none"}
                  onValueChange={(value) => updateEditForm("warrantyTime", value === "none" ? "" : value)}
                  disabled={editingListing || loadingEditListing || editForm.warranty === "Sem garantia"}
                >
                  <SelectTrigger className={listingSelectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Não alterar</SelectItem>
                    <SelectItem value="30 dias">30 dias</SelectItem>
                    <SelectItem value="60 dias">60 dias</SelectItem>
                    <SelectItem value="90 dias">90 dias</SelectItem>
                    <SelectItem value="6 meses">6 meses</SelectItem>
                    <SelectItem value="12 meses">12 meses</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Modo de envio</Label>
                <Select value={editForm.shippingMode} onValueChange={(value) => updateEditForm("shippingMode", value)} disabled={editingListing || loadingEditListing}>
                  <SelectTrigger className={listingSelectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {editShippingModes.map((mode) => (
                      <SelectItem key={mode} value={mode} disabled={mode !== "me2" && mode !== editForm.shippingMode}>
                        {mode === "me2" ? "Mercado Envios" : mode === "custom" ? "Envio personalizado atual" : rawStatusLabel(mode)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Logística</Label>
                <Select
                  value={editForm.logisticType}
                  onValueChange={(value) => updateEditForm("logisticType", value)}
                  disabled={editingListing || loadingEditListing || editForm.shippingMode !== "me2" || editLogisticOptions.length === 0}
                >
                  <SelectTrigger className={listingSelectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {editLogisticOptions.map((option) => (
                      <SelectItem key={option} value={option}>{shippingLogisticLabel(option)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {editCategoryAttributes.length > 0 && (
              <section className="mt-4 space-y-3 border-t pt-4">
                <div>
                  <h3 className="text-sm font-medium">Atributos do Mercado Livre</h3>
                  <p className="text-xs text-muted-foreground">
                    Campos compartilhados pela família e específicos desta variação.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {editCategoryAttributes.map((attribute) => {
                    const value = editForm.dynamicAttributes[attribute.id] ?? "";
                    const disabledAttribute = editingListing || loadingEditListing || (attribute.fixed && Boolean(value));
                    return (
                      <div key={attribute.id} className="space-y-2 rounded-md border bg-background p-3">
                        <div className="flex min-h-5 items-start justify-between gap-3">
                          <Label className="leading-5">
                            {attribute.name}
                            {attribute.required && <span className="ml-1 text-destructive">*</span>}
                          </Label>
                          <div className="flex shrink-0 items-center gap-1">
                            {attribute.role && attribute.role !== "standard" && (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                {attribute.role === "parent" ? "Família" : attribute.role === "child" ? "Variação" : "Variável"}
                              </Badge>
                            )}
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {attribute.id}
                            </span>
                          </div>
                        </div>
                        {attribute.values.length > 0 ? (
                          <ControlledAttributeInput
                            attribute={attribute}
                            value={value}
                            disabled={disabledAttribute}
                            onChange={(nextValue) => updateEditDynamicAttribute(attribute.id, nextValue)}
                          />
                        ) : attribute.valueType === "boolean" ? (
                          <Select value={value} onValueChange={(nextValue) => updateEditDynamicAttribute(attribute.id, nextValue)} disabled={disabledAttribute}>
                            <SelectTrigger className={listingSelectClass}>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Sim</SelectItem>
                              <SelectItem value="false">Não</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : attribute.valueType === "number_unit" ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                            <Input
                              type="number"
                              value={value}
                              onChange={(event) => updateEditDynamicAttribute(attribute.id, event.target.value)}
                              disabled={disabledAttribute}
                              className={listingFieldClass}
                            />
                            <Select
                              value={editForm.dynamicAttributes[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || attribute.allowedUnits[0]?.name || ""}
                              onValueChange={(nextValue) => updateEditDynamicAttribute(`${attribute.id}__unit`, nextValue)}
                              disabled={disabledAttribute || attribute.allowedUnits.length === 0}
                            >
                              <SelectTrigger className={listingSelectClass}>
                                <SelectValue placeholder="Un." />
                              </SelectTrigger>
                              <SelectContent>
                                {(attribute.allowedUnits.length ? attribute.allowedUnits : [{ id: attribute.defaultUnit ?? "", name: attribute.defaultUnit ?? "Un." }]).map((unit) => (
                                  <SelectItem key={`${attribute.id}:${unit.id ?? unit.name}`} value={unit.id ?? unit.name}>
                                    {unit.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <Input
                            value={value}
                            onChange={(event) => updateEditDynamicAttribute(attribute.id, event.target.value)}
                            disabled={disabledAttribute}
                            className={listingFieldClass}
                          />
                        )}
                        {attribute.hint && <p className="line-clamp-2 text-xs text-muted-foreground">{attribute.hint}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {editForm.userProductEnabled && editFamilyMembers.length > 0 && (
              <section className="mt-4 space-y-3 border-t pt-4">
                <div>
                  <h3 className="text-sm font-medium">Variações da família</h3>
                  <p className="text-xs text-muted-foreground">
                    Cada variação é um anúncio independente ligado à mesma família do Mercado Livre.
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {editFamilyMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{member.name || `User Product ${member.id}`}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {member.attributes
                            .slice(0, 3)
                            .map((attribute) => attribute.value_name || attribute.value_id)
                            .filter(Boolean)
                            .join(" · ") || "Sem atributos resumidos"}
                        </div>
                      </div>
                      <Badge variant={member.id === editForm.userProductId ? "default" : "outline"} className="shrink-0">
                        {member.id === editForm.userProductId ? "Atual" : member.id}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Comprimento (cm)</Label>
                <Input value={editForm.lengthCm} onChange={(event) => updateEditForm("lengthCm", event.target.value)} disabled={editingListing || loadingEditListing} className={listingFieldClass} />
              </div>
              <div className="space-y-2">
                <Label>Largura (cm)</Label>
                <Input value={editForm.widthCm} onChange={(event) => updateEditForm("widthCm", event.target.value)} disabled={editingListing || loadingEditListing} className={listingFieldClass} />
              </div>
              <div className="space-y-2">
                <Label>Altura (cm)</Label>
                <Input value={editForm.heightCm} onChange={(event) => updateEditForm("heightCm", event.target.value)} disabled={editingListing || loadingEditListing} className={listingFieldClass} />
              </div>
              <div className="space-y-2">
                <Label>Peso (g)</Label>
                <Input value={editForm.weightGrams} onChange={(event) => updateEditForm("weightGrams", event.target.value.replace(/\D/g, ""))} disabled={editingListing || loadingEditListing} className={listingFieldClass} />
              </div>
            </div>

            <div className="mt-4 rounded-md border bg-muted/20 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-3 text-sm">
                  <Checkbox checked={editForm.freeShipping} onCheckedChange={(checked) => updateEditForm("freeShipping", checked === true)} disabled={editingListing || loadingEditListing} />
                  <span><strong>Frete grátis</strong><span className="mt-0.5 block text-xs font-normal text-muted-foreground">O comprador não paga; o Mercado Livre calcula a parcela assumida pelo vendedor.</span></span>
                </label>
                <Button type="button" variant="outline" size="sm" onClick={simulateEditShippingQuote} disabled={editingListing || loadingEditListing || loadingEditShippingQuote || editForm.shippingMode !== "me2"}>
                  {loadingEditShippingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Simular custo
                </Button>
              </div>
              {editShippingQuote ? (
                <div className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                  Custo estimado do vendedor: <strong className="text-foreground">{formatCurrency(editShippingQuote.sellerCost ?? editShippingQuote.listCost ?? 0)}</strong>
                  {editShippingQuote.listCost != null && editShippingQuote.sellerCost != null && editShippingQuote.listCost !== editShippingQuote.sellerCost ? ` · tarifa cheia ${formatCurrency(editShippingQuote.listCost)}` : ""}
                  {editShippingQuote.billableWeight != null ? ` · peso tarifado ${editShippingQuote.billableWeight} g` : ""}
                  {shippingOriginLabel(editShippingQuote.origin) ? ` · origem ${shippingOriginLabel(editShippingQuote.origin)}` : ""}
                </div>
              ) : null}
            </div>

            <div className="mt-4 space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={editForm.description}
                onChange={(event) => updateEditForm("description", event.target.value)}
                disabled={editingListing || loadingEditListing || !editCapabilities.description}
                className={`min-h-32 ${listingFieldClass}`}
              />
            </div>

            <div className="mt-4 space-y-2">
              <Label>Vídeo do anúncio</Label>
              <Input
                value={editForm.videoUrl}
                onChange={(event) => updateEditForm("videoUrl", event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={editingListing || loadingEditListing}
                className={listingFieldClass}
              />
              <p className="text-xs text-muted-foreground">
                Use uma URL pública do YouTube ou o código de 11 caracteres do vídeo. A disponibilidade final depende da categoria e das regras do anúncio.
              </p>
            </div>

            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Imagens do anúncio</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={editingListing || loadingEditListing || !editCapabilities.pictures || editingProductImageUrls.length === 0}
                  onClick={() => {
                    const merged = Array.from(new Set([...parsePictureUrls(editForm.pictureUrl), ...editingProductImageUrls]));
                    setEditForm((current) => ({ ...current, pictureUrl: merged.join("\n") }));
                    toast.success(`${editingProductImageUrls.length} imagem(ns) do produto adicionada(s).`);
                  }}
                >
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Adicionar imagens do produto
                </Button>
              </div>
              <Textarea
                value={editForm.pictureUrl}
                onChange={(event) => updateEditForm("pictureUrl", event.target.value)}
                placeholder="Uma URL por linha"
                disabled={editingListing || loadingEditListing || !editCapabilities.pictures}
                className={`min-h-24 ${listingFieldClass}`}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <Button variant="outline" className="w-full bg-transparent sm:w-auto" onClick={() => setEditDialogOpen(false)} disabled={editingListing}>
              Cancelar
            </Button>
            <Button className="w-full sm:w-auto" onClick={saveEditedListing} disabled={editingListing || loadingEditListing || !editForm.itemId}>
              {editingListing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={compatibilityDialogOpen} onOpenChange={setCompatibilityDialogOpen}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-[100dvw] max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[92dvh] sm:max-h-[850px] sm:w-[95vw] sm:max-w-[1000px] sm:rounded-lg sm:border">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left sm:px-6 sm:py-5 sm:pr-12">
            <DialogTitle className="flex items-center gap-2">
              <CarFront className="h-5 w-5 text-primary" />
              Veículos compatíveis
            </DialogTitle>
            <DialogDescription>
              Selecione veículos do catálogo oficial do Mercado Livre para informar onde esta peça pode ser aplicada.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {loadingCompatibilities ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                Consultando compatibilidades...
              </div>
            ) : compatibilityDetails ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{compatibilityDetails.title || compatibilityDetails.itemId}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {compatibilityDetails.itemId} · Categoria {compatibilityDetails.categoryId || "não informada"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {compatibilityDetails.required && <Badge variant="destructive">Compatibilidade obrigatória</Badge>}
                    {compatibilityDetails.pendingSuggestions && <Badge variant="secondary">Há sugestões no Mercado Livre</Badge>}
                    {compatibilityDetails.userProductId && <Badge variant="outline">Família de produto</Badge>}
                  </div>
                </div>

                {compatibilityDetails.pendingSuggestions ? (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-4 py-3 text-sm text-muted-foreground">
                    O Mercado Livre possui sugestões automáticas para este anúncio. Pela regra atual da API, essas sugestões devem ser revisadas no Gerenciador de Compatibilidades do próprio Mercado Livre; pelo ERP você pode cadastrar e administrar as aplicações criadas pelo vendedor.
                  </div>
                ) : null}

                {!compatibilityDetails.available ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                      <div>
                        <p className="font-medium">Esta categoria não permite gerenciar compatibilidades pela API.</p>
                        <p className="mt-1 text-muted-foreground">{compatibilityDetails.unavailableReason || "Confira a categoria do anúncio no Mercado Livre."}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <section className="space-y-4 rounded-lg border p-4">
                    <div>
                      <h3 className="font-medium">Adicionar aplicação</h3>
                      <p className="text-xs text-muted-foreground">
                        Marca e modelo são obrigatórios. Ano, versão e motor refinam a aplicação e evitam indicar veículos incorretos.
                      </p>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {([
                        ["BRAND", "Marca", true],
                        ["MODEL", "Modelo", true],
                        ["VEHICLE_YEAR", "Ano", false],
                        ["SHORT_VERSION", "Versão", false],
                        ["ENGINE", "Motor", false],
                      ] as Array<[VehicleAttributeId, string, boolean]>).map(([attributeId, label, required]) => {
                        const prerequisite: Partial<Record<VehicleAttributeId, VehicleAttributeId>> = {
                          MODEL: "BRAND",
                          VEHICLE_YEAR: "MODEL",
                          SHORT_VERSION: "VEHICLE_YEAR",
                          ENGINE: "VEHICLE_YEAR",
                        };
                        const disabled = Boolean(prerequisite[attributeId] && !compatibilitySelection[prerequisite[attributeId]!]);
                        const options = compatibilityOptions[attributeId] ?? [];
                        return (
                          <div key={attributeId} className="min-w-0 space-y-2">
                            <Label>{label}{required ? <span className="ml-1 text-destructive">*</span> : null}</Label>
                            <CompatibilityOptionInput
                              label={label}
                              options={options}
                              selected={compatibilitySelection[attributeId]}
                              disabled={disabled || savingCompatibility}
                              loading={Boolean(loadingCompatibilityOptions[attributeId])}
                              placeholder={disabled ? `Selecione ${String(prerequisite[attributeId] ?? "").toLowerCase()} antes` : `Selecione ${label.toLowerCase()}`}
                              onSelect={(value) => void selectCompatibilityOption(attributeId, value)}
                            />
                            {!disabled && !loadingCompatibilityOptions[attributeId] && options.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Nenhuma opção retornada para este filtro.</p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                    <div className="space-y-2">
                      <Label>Observação da aplicação</Label>
                      <Textarea
                        value={compatibilityNote}
                        onChange={(event) => setCompatibilityNote(event.target.value.slice(0, 500))}
                        placeholder="Ex.: somente versões com freio dianteiro a disco"
                        className="min-h-20"
                        disabled={savingCompatibility}
                      />
                      <p className="text-right text-xs text-muted-foreground">{compatibilityNote.length}/500</p>
                    </div>
                    <div className="flex justify-end">
                      <Button className="w-full sm:w-auto" onClick={addCompatibility} disabled={savingCompatibility || !compatibilitySelection.BRAND || !compatibilitySelection.MODEL}>
                        {savingCompatibility ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Adicionar compatibilidade
                      </Button>
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h3 className="font-medium">Compatibilidades atuais</h3>
                      <p className="text-xs text-muted-foreground">
                        As criadas pelo vendedor podem ser removidas no ERP. As originadas do catálogo são somente leitura.
                      </p>
                    </div>
                    <Badge variant="outline">{compatibilityDetails.products.reduce((total, entry) => total + Math.max(entry.total, 1), 0)} veículo(s)</Badge>
                  </div>
                  {compatibilityDetails.products.length ? (
                    <div className="divide-y rounded-lg border">
                      {compatibilityDetails.products.map((entry, index) => (
                        <div key={entry.id || entry.catalogProductId || `${entry.name}:${index}`} className="flex items-start justify-between gap-3 p-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{entry.name}</p>
                              <Badge variant={entry.source === "SELLER" ? "outline" : "secondary"}>{entry.source === "SELLER" ? "Vendedor" : "Catálogo"}</Badge>
                              {entry.total > 1 ? <Badge variant="secondary">{entry.total} veículos</Badge> : null}
                            </div>
                            {entry.note ? <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p> : null}
                            {entry.catalogProductId ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{entry.catalogProductId}</p> : null}
                          </div>
                          {entry.source === "SELLER" && entry.catalogProductId ? (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="shrink-0 text-destructive hover:text-destructive"
                              disabled={savingCompatibility}
                              onClick={() => void removeCompatibility(entry.catalogProductId!)}
                              aria-label={`Remover compatibilidade ${entry.name}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                      Nenhum veículo compatível foi informado para este anúncio.
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <Button variant="outline" className="w-full bg-transparent sm:w-auto" onClick={() => setCompatibilityDialogOpen(false)} disabled={savingCompatibility}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={performanceDialogOpen} onOpenChange={setPerformanceDialogOpen}>
        <DialogContent className="flex h-[92dvh] w-[100dvw] max-w-[100dvw] flex-col overflow-hidden p-4 sm:h-[850px] sm:max-h-[92dvh] sm:w-[95vw] sm:max-w-[1100px] sm:p-6">
          {loadingListingPerformance && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-background">
              <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
              <span className="text-primary">Carregando...</span>
            </div>
          )}
          <DialogHeader className="shrink-0">
            <DialogTitle>Desempenho do anúncio</DialogTitle>
            <DialogDescription>
              Métricas dos últimos 30 dias e recomendações de qualidade retornadas pelo Mercado Livre.
            </DialogDescription>
          </DialogHeader>
          {listingPerformance && (
            <ScrollArea className="min-h-0 flex-1 pr-4">
              <div className="space-y-5 pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{listingPerformance.ml_item_id}</span>
                      {statusBadge(listingPerformance.status)}
                    </div>
                    <h3 className="mt-1 truncate font-medium">{listingPerformance.title || "Anúncio Mercado Livre"}</h3>
                  </div>
                  {listingPerformance.permalink && (
                    <Button asChild variant="outline" size="sm" className="bg-transparent">
                      <a href={listingPerformance.permalink} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" /> Abrir anúncio
                      </a>
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  {[
                    ["Visualizações", listingPerformance.period.visits.toLocaleString("pt-BR")],
                    ["Pedidos", listingPerformance.period.orders.toLocaleString("pt-BR")],
                    ["Unidades", listingPerformance.period.units.toLocaleString("pt-BR")],
                    ["Faturamento", formatCurrency(listingPerformance.period.revenue)],
                    ["Ticket médio", formatCurrency(listingPerformance.period.averageTicket)],
                    ["Conversão", `${listingPerformance.period.conversionRate.toLocaleString("pt-BR")} %`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-muted/15 px-3 py-3">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-lg font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Comparado aos 30 dias anteriores: visitas {formatSignedPercent(listingPerformance.period.deltas.visits)},
                  {" "}pedidos {formatSignedPercent(listingPerformance.period.deltas.orders)},
                  {" "}faturamento {formatSignedPercent(listingPerformance.period.deltas.revenue)}.
                </p>

                <section className="space-y-3">
                  <div>
                    <h3 className="text-sm font-medium">Visualizações diárias</h3>
                    <p className="text-xs text-muted-foreground">Últimos 30 dias coletados pela rotina automática.</p>
                  </div>
                  <div className="flex h-32 items-end gap-1 rounded-md border px-3 pb-3 pt-5">
                    {listingPerformance.period.daily.map((day) => {
                      const maxVisits = Math.max(...listingPerformance.period.daily.map((entry) => entry.visits), 1);
                      const height = Math.max((day.visits / maxVisits) * 100, day.visits > 0 ? 6 : 2);
                      return (
                        <div key={day.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${day.date}: ${day.visits} visualização(ões)`}>
                          <div className="w-full rounded-t-sm bg-primary/75 transition-colors group-hover:bg-primary" style={{ height: `${height}%` }} />
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-3 border-t pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">Qualidade do anúncio</h3>
                      <p className="text-xs text-muted-foreground">Avaliação oficial da API de performance.</p>
                    </div>
                    {listingPerformance.quality.score != null && (
                      <Badge variant="outline" className="text-sm">
                        {Math.round(listingPerformance.quality.score)}% · {listingPerformance.quality.level || "Sem nível"}
                      </Badge>
                    )}
                  </div>
                  {!listingPerformance.quality.available ? (
                    <p className="rounded-md border p-3 text-sm text-muted-foreground">O Mercado Livre ainda não disponibilizou a avaliação deste anúncio.</p>
                  ) : listingPerformance.quality.actions.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
                      <Check className="h-4 w-4" /> Nenhuma melhoria pendente foi retornada.
                    </div>
                  ) : (
                    <div className="divide-y rounded-md border">
                      {listingPerformance.quality.actions.map((action) => {
                        const editableInErp = ["video", "pictures", "description", "attributes"].includes(action.kind ?? "");
                        const accountConfiguration = action.kind === "quantity_price" || action.kind === "same_day_shipping";
                        return (
                          <div key={`${action.id}:${action.title}`} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-medium">{marketplaceTextLabel(action.title)}</p>
                                <Badge variant={editableInErp ? "secondary" : "outline"} className="text-[10px]">
                                  {editableInErp ? "Ajuste no ERP" : accountConfiguration ? "Depende da conta" : "Orientação"}
                                </Badge>
                              </div>
                              {action.message && <p className="mt-0.5 text-xs text-muted-foreground">{marketplaceTextLabel(action.message)}</p>}
                              {action.kind === "quantity_price" && (
                                <p className="mt-1 text-xs text-muted-foreground">Disponível somente quando o vendedor e o anúncio forem elegíveis para preço por quantidade.</p>
                              )}
                              {action.kind === "same_day_shipping" && (
                                <p className="mt-1 text-xs text-muted-foreground">Configuração logística da conta: exige Envios Flex, área atendida, horário limite e capacidade.</p>
                              )}
                            </div>
                            {(editableInErp || action.link || accountConfiguration) && (
                              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void handleQualityObjective(action)}>
                                {editableInErp ? <Pencil className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
                                {editableInErp ? "Corrigir no ERP" : action.link ? "Abrir configuração" : "Ver requisito"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-medium">Alterações permitidas</h3>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["Título", listingPerformance.permissions.title],
                      ["Preço", listingPerformance.permissions.price],
                      ["Estoque", listingPerformance.permissions.stock],
                      ["Descrição", listingPerformance.permissions.description],
                      ["Imagens", listingPerformance.permissions.pictures],
                      ["Atributos", listingPerformance.permissions.attributes],
                    ].map(([label, allowed]) => (
                      <Badge key={String(label)} variant={allowed ? "secondary" : "outline"} className={!allowed ? "text-muted-foreground line-through" : ""}>
                        {label}
                      </Badge>
                    ))}
                  </div>
                  {(listingPerformance.permissions.familyControlled || listingPerformance.permissions.catalogControlled) && (
                    <p className="text-xs text-muted-foreground">
                      {listingPerformance.permissions.catalogControlled
                        ? "Este anúncio pertence ao catálogo; imagens, título e ficha técnica podem ser controlados pelo Mercado Livre."
                        : "Este anúncio usa User Products; título e atributos da família podem ser controlados pelo Mercado Livre."}
                    </p>
                  )}
                </section>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={quantityPricingOpen} onOpenChange={(open) => !savingQuantityPricing && setQuantityPricingOpen(open)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preço por quantidade</DialogTitle>
            <DialogDescription>
              Configure descontos progressivos para compradores empresariais elegíveis no Mercado Livre.
            </DialogDescription>
          </DialogHeader>
          {loadingQuantityPricing ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Consultando elegibilidade e recomendações...
            </div>
          ) : quantityPricing ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Anúncio</p>
                  <p className="mt-1 font-mono text-sm">{quantityPricing.itemId}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Preço base</p>
                  <p className="mt-1 text-sm font-medium">{formatCurrency(quantityPricing.basePrice)}</p>
                </div>
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs text-muted-foreground">Elegibilidade</p>
                  <p className={`mt-1 text-sm font-medium ${quantityPricing.eligible ? "text-emerald-600" : "text-amber-600"}`}>
                    {quantityPricing.eligible ? "Conta B2B habilitada" : "Não habilitada"}
                  </p>
                </div>
              </div>

              {!quantityPricing.eligible ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                  {quantityPricing.reason} O ERP não consegue solicitar essa habilitação; ela é liberada pelo próprio Mercado Livre.
                </div>
              ) : (
                <>
                  <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
                    <Checkbox
                      checked={quantityTiers.length > 0}
                      onCheckedChange={(checked) => {
                        if (!checked) {
                          setQuantityTiers([]);
                          return;
                        }
                        const recommended = quantityPricing.recommendations.filter((entry) => !entry.incoherent);
                        setQuantityTiers(
                          (recommended.length ? recommended : [{ quantity: 2, percentage: 5 }]).map((entry) => ({
                            quantity: String(entry.quantity),
                            percentage: Number(entry.percentage).toLocaleString("pt-BR", { maximumFractionDigits: 2 }),
                          })),
                        );
                      }}
                      disabled={savingQuantityPricing}
                    />
                    <span>
                      <span className="block text-sm font-medium">Ativar descontos progressivos</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Desmarque e salve para remover todas as faixas deste anúncio.</span>
                    </span>
                  </label>
                  <div className="space-y-2">
                    <div className="hidden grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid">
                      <span>Quantidade mínima</span><span>Desconto</span><span>Preço estimado/un.</span><span className="w-9" />
                    </div>
                    {quantityTiers.map((tier, index) => {
                      const percentage = Number(tier.percentage.replace(",", "."));
                      const estimated = quantityPricing.basePrice * (1 - (Number.isFinite(percentage) ? percentage : 0) / 100);
                      const recommendation = quantityPricing.recommendations.find((entry) => entry.quantity === Number(tier.quantity));
                      return (
                        <div key={index} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-start">
                          <Input
                            type="number"
                            min="1"
                            max="100"
                            value={tier.quantity}
                            onChange={(event) => setQuantityTiers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry))}
                            disabled={savingQuantityPricing}
                          />
                          <div>
                            <div className="relative">
                              <Input
                                inputMode="decimal"
                                value={tier.percentage}
                                onChange={(event) => setQuantityTiers((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, percentage: event.target.value.replace(/[^\d,.]/g, "") } : entry))}
                                disabled={savingQuantityPricing}
                                className="pr-8"
                              />
                              <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span>
                            </div>
                            {recommendation && <p className="mt-1 text-[11px] text-muted-foreground">Mínimo recomendado: {recommendation.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</p>}
                          </div>
                          <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm">{formatCurrency(estimated)}</div>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remover faixa" onClick={() => setQuantityTiers((current) => current.filter((_, entryIndex) => entryIndex !== index))} disabled={savingQuantityPricing}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                    {quantityTiers.length === 0 && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhuma faixa configurada.</p>}
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled={savingQuantityPricing || quantityTiers.length >= 5} onClick={() => setQuantityTiers((current) => [...current, { quantity: "", percentage: "" }])}>
                    <Plus className="h-4 w-4" /> Adicionar faixa
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Antes de salvar, o ERP consulta novamente a recomendação oficial e impede descontos abaixo do mínimo aceito. O Mercado Livre permite até cinco faixas.
                  </p>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuantityPricingOpen(false)} disabled={savingQuantityPricing}>Cancelar</Button>
            <Button onClick={() => void saveQuantityPricing()} disabled={loadingQuantityPricing || savingQuantityPricing || !quantityPricing?.eligible}>
              {savingQuantityPricing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {quantityTiers.length ? "Salvar preços" : "Remover preços"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(orderToCancel)} onOpenChange={(open) => !open && setOrderToCancel(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancelar venda #{orderToCancel?.ml_order_id}</DialogTitle>
            <DialogDescription>
              Marque a operação como não concretizada no Mercado Livre. Esta ação pode afetar a reputação da conta conforme o motivo informado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label htmlFor="cancel-sale-reason">Motivo</Label>
              <Select
                value={cancelSaleForm.reason}
                onValueChange={(reason) => setCancelSaleForm((current) => ({ ...current, reason }))}
                disabled={actionKey === `cancel:${orderToCancel?.id}`}
              >
                <SelectTrigger id="cancel-sale-reason" className={listingFieldClassStatic}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUYER_REGRETS">Comprador desistiu</SelectItem>
                  <SelectItem value="BUYER_DID_NOT_ANSWER">Comprador não respondeu</SelectItem>
                  <SelectItem value="BUYER_NOT_ENOUGH_MONEY">Comprador não conseguiu pagar</SelectItem>
                  <SelectItem value="THEY_NOT_HONORING_POLICIES">Comprador não cumpriu as políticas</SelectItem>
                  <SelectItem value="OUT_OF_STOCK">Produto sem estoque</SelectItem>
                  <SelectItem value="SELLER_REGRETS">Desistência do vendedor</SelectItem>
                  <SelectItem value="OTHER_THEIR_RESPONSIBILITY">Outro motivo de responsabilidade do comprador</SelectItem>
                  <SelectItem value="OTHER_MY_RESPONSIBILITY">Outro motivo de responsabilidade do vendedor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cancel-sale-message">Mensagem da operação</Label>
              <Textarea
                id="cancel-sale-message"
                value={cancelSaleForm.message}
                onChange={(event) => setCancelSaleForm((current) => ({ ...current, message: event.target.value.slice(0, 159) }))}
                className={`min-h-24 ${listingFieldClassStatic}`}
                disabled={actionKey === `cancel:${orderToCancel?.id}`}
              />
              <div className="text-right text-xs text-muted-foreground">{cancelSaleForm.message.length}/159</div>
            </div>
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
              O ERP não solicita reposição direta no anúncio para evitar estoque duplicado. A baixa será revertida no estoque do ERP e a fila de sincronização enviará a quantidade correta ao Mercado Livre.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-transparent" onClick={() => setOrderToCancel(null)} disabled={Boolean(actionKey)}>
              Voltar
            </Button>
            <Button variant="destructive" onClick={cancelSale} disabled={!cancelSaleForm.message.trim() || Boolean(actionKey)}>
              {actionKey === `cancel:${orderToCancel?.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedOrderDetails)} onOpenChange={(open) => !open && setSelectedOrderDetails(null)}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Pedido Mercado Livre #{selectedOrderDetails?.ml_order_id}</DialogTitle>
            <DialogDescription>Dados importados do pedido, envio e integração com o ERP.</DialogDescription>
          </DialogHeader>

          {selectedOrderDetails && (
            <ScrollArea className="max-h-[70vh] pr-3">
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Status do pedido</div>
                    <div className="mt-1">{statusBadge(selectedOrderDetails.status)}</div>
                    {selectedOrderDetails.status_detail && <div className="mt-1 text-xs text-muted-foreground">{rawStatusLabel(selectedOrderDetails.status_detail)}</div>}
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Pagamento</div>
                    <div className="mt-1">{getOrderPaymentStatus(selectedOrderDetails) ? statusBadge(getOrderPaymentStatus(selectedOrderDetails)) : "-"}</div>
                    {selectedOrderDetails.payment_status_detail && <div className="mt-1 text-xs text-muted-foreground">{rawStatusLabel(selectedOrderDetails.payment_status_detail)}</div>}
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Venda ERP</div>
                    <div className="mt-1 font-medium">{selectedOrderDetails.venda_id ? `#${selectedOrderDetails.venda_id}` : "Não vinculada"}</div>
                  </div>
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="mt-1 font-medium">{formatCurrency(selectedOrderDetails.total_amount)}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Comprador</h3>
                    <div className="mt-3 space-y-1 text-sm">
                      <div>ID: <span className="font-mono">{selectedOrderDetails.raw_order?.buyer?.id ?? "-"}</span></div>
                      <div>Apelido: {selectedOrderDetails.raw_order?.buyer?.nickname ?? "-"}</div>
                      <div>Nome: {[selectedOrderDetails.raw_order?.buyer?.first_name, selectedOrderDetails.raw_order?.buyer?.last_name].filter(Boolean).join(" ") || "-"}</div>
                      <div>Pack ID: <span className="font-mono">{getOrderPackId(selectedOrderDetails.raw_order) ?? "-"}</span></div>
                    </div>
                  </div>

                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Envio</h3>
                    <div className="mt-3 space-y-1 text-sm">
                      <div>Shipment ID: <span className="font-mono">{selectedOrderDetails.ml_shipment_id ?? "-"}</span></div>
                      <div>Status: {selectedOrderDetails.shipment_status ? statusBadge(selectedOrderDetails.shipment_status) : "-"}</div>
                      <div>Modo: {optionalStatusLabel(selectedOrderDetails.shipping_mode || selectedOrderDetails.raw_shipment?.mode)}</div>
                      <div>Logística: {optionalStatusLabel(selectedOrderDetails.logistic_type)}</div>
                      <div>Rastreio: <span className="font-mono">{selectedOrderDetails.tracking_number || "-"}</span></div>
                      <div>Custo do frete: {selectedOrderDetails.shipment_cost != null ? formatCurrency(selectedOrderDetails.shipment_cost) : "-"}</div>
                      <div>Itens no envio: {Array.isArray(selectedOrderDetails.raw_shipment_items) ? selectedOrderDetails.raw_shipment_items.length : "-"}</div>
                      <div>Método: {selectedOrderDetails.tracking_method || selectedOrderDetails.raw_shipment?.tracking_method || "-"}</div>
                      <div>Atualizado em: {formatDate(selectedOrderDetails.shipment_updated_at)}</div>
                      <div>Prazo para despacho: {formatDate(selectedOrderDetails.shipment_handling_deadline)}</div>
                      <div>
                        Previsão de entrega: {formatDate(selectedOrderDetails.shipment_estimated_delivery_from)}
                        {selectedOrderDetails.shipment_estimated_delivery_to ? ` até ${formatDate(selectedOrderDetails.shipment_estimated_delivery_to)}` : ""}
                      </div>
                      <div>Etiqueta: {canPrintMercadoLivreLabel(selectedOrderDetails) ? "Disponível" : selectedOrderDetails.shipment_label_error || "Aguardando sincronização"}</div>
                    </div>
                    {!isMercadoEnviosOrder(selectedOrderDetails) && ["shipped", "delivered"].includes(getOrderShipmentStatus(selectedOrderDetails) ?? "") && (
                      <div className="mt-4 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <PackageCheck className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <div className="font-medium">
                            {getOrderShipmentStatus(selectedOrderDetails) === "delivered" ? "Entrega confirmada" : "Envio confirmado no Mercado Livre"}
                          </div>
                          <div className="mt-0.5 text-xs opacity-80">
                            {selectedOrderDetails.tracking_number
                              ? `Código de rastreio: ${selectedOrderDetails.tracking_number}`
                              : "O status foi atualizado pela plataforma."}
                          </div>
                        </div>
                      </div>
                    )}
                    {!isMercadoEnviosOrder(selectedOrderDetails) && getOrderShipmentStatus(selectedOrderDetails) === "shipped" && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-transparent"
                          onClick={() => updateExternalShipmentStatus(selectedOrderDetails, "delivered")}
                          disabled={actionKey === `delivery-status:${selectedOrderDetails.id}`}
                        >
                          {actionKey === `delivery-status:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                          Confirmar entrega
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-transparent text-destructive hover:text-destructive"
                          onClick={() => updateExternalShipmentStatus(selectedOrderDetails, "not_delivered")}
                          disabled={actionKey === `delivery-status:${selectedOrderDetails.id}`}
                        >
                          <XCircle className="h-4 w-4" />
                          Informar falha
                        </Button>
                      </div>
                    )}
                    {!isMercadoEnviosOrder(selectedOrderDetails) && !["shipped", "delivered"].includes(getOrderShipmentStatus(selectedOrderDetails) ?? "") && (
                      <div className="mt-4 space-y-3 border-t pt-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Transportadora</Label>
                            <Select
                              value={customShipmentForm.carrier}
                              onValueChange={(value) => setCustomShipmentForm((current) => ({ ...current, carrier: value }))}
                            >
                              <SelectTrigger className="h-10">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="CORREIOS">Correios</SelectItem>
                                <SelectItem value="JADLOG">Jadlog</SelectItem>
                                <SelectItem value="LOGGI">Loggi</SelectItem>
                                <SelectItem value="AZUL_CARGO">Azul Cargo</SelectItem>
                                <SelectItem value="GRUPO_SBF">Grupo SBF</SelectItem>
                                <SelectItem value="TRANSPORTADORA">Transportadora</SelectItem>
                                <SelectItem value="RETIRADA">Retirada / própria</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Código de rastreio</Label>
                            <Input
                              value={customShipmentForm.trackingCode}
                              onChange={(event) => setCustomShipmentForm((current) => ({ ...current, trackingCode: event.target.value.trim() }))}
                              placeholder="Ex.: AA123456789BR"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label>Link de acompanhamento</Label>
                            <Input
                              value={customShipmentForm.trackingUrl}
                              onChange={(event) => setCustomShipmentForm((current) => ({ ...current, trackingUrl: event.target.value.trim() }))}
                              placeholder="Opcional. Se for Correios, o ERP gera o link pelo código."
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Prazo informado</Label>
                            <Input
                              value={customShipmentForm.deadline}
                              onChange={(event) => setCustomShipmentForm((current) => ({ ...current, deadline: event.target.value }))}
                              placeholder="Ex.: 5 dias úteis"
                            />
                          </div>
                          <label className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                            <Checkbox
                              checked={customShipmentForm.markAsShipped}
                              onCheckedChange={(checked) => setCustomShipmentForm((current) => ({ ...current, markAsShipped: checked === true }))}
                            />
                            Marcar como enviado no Mercado Livre
                          </label>
                          <label className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                            <Checkbox
                              checked={customShipmentForm.notifyBuyer}
                              onCheckedChange={(checked) => setCustomShipmentForm((current) => ({ ...current, notifyBuyer: checked === true }))}
                            />
                            Avisar comprador automaticamente
                          </label>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => saveCustomShipment(selectedOrderDetails)}
                          disabled={actionKey === `custom-shipment:${selectedOrderDetails.id}`}
                        >
                          {actionKey === `custom-shipment:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Salvar envio
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Pagamento</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      {getStoredOrderPayments(selectedOrderDetails).map((payment: any, index: number) => (
                        <div key={`${payment.id ?? index}`} className="rounded-md bg-muted/30 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{formatCurrency(payment.transaction_amount ?? payment.total_paid_amount ?? 0)}</span>
                            {statusBadge(payment.status)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {getPaymentDescription(payment) || "Forma de pagamento não informada"}
                          </div>
                        </div>
                      ))}
                      {getStoredOrderPayments(selectedOrderDetails).length === 0 && <div className="text-muted-foreground">Pagamento não retornado no pedido.</div>}
                    </div>
                  </div>

                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Endereço de entrega</h3>
                    <div className="mt-3 space-y-1 text-sm">
                      <div>{formatOrderAddress(selectedOrderDetails.raw_shipment?.receiver_address)}</div>
                      <div className="text-xs text-muted-foreground">
                        {selectedOrderDetails.raw_shipment?.receiver_address
                          ? "Endereço retornado pelo Mercado Envios."
                          : "Sincronize o envio para tentar buscar o endereço do shipment."}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <h3 className="text-sm font-semibold">Itens</h3>
                  <div className="mt-3 overflow-hidden rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Item</TableHead>
                          <TableHead>Qtd.</TableHead>
                          <TableHead>Unitário</TableHead>
                          <TableHead>Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(selectedOrderDetails.raw_order?.order_items ?? []).map((item: any, index: number) => {
                          const quantity = Number(item.quantity ?? 1);
                          const unitPrice = Number(item.unit_price ?? item.full_unit_price ?? 0);
                          return (
                            <TableRow key={`${item.item?.id ?? index}`}>
                              <TableCell>
                                <div className="font-medium">{item.item?.title ?? "Item Mercado Livre"}</div>
                                <div className="font-mono text-xs text-muted-foreground">{item.item?.id ?? "-"}</div>
                              </TableCell>
                              <TableCell>{quantity}</TableCell>
                              <TableCell>{formatCurrency(unitPrice)}</TableCell>
                              <TableCell>{formatCurrency(quantity * unitPrice)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Cancelamento/Reembolso</h3>
                    <div className="mt-3 text-sm text-muted-foreground">
                      <div>Status atual do pedido: {rawStatusLabel(selectedOrderDetails.status)}.</div>
                      <div>Status da importação: {rawStatusLabel(selectedOrderDetails.import_status || (selectedOrderDetails.venda_id ? "IMPORTADA" : "PENDENTE"))}.</div>
                      {selectedOrderDetails.import_error && <div className="text-destructive">Erro de importação: {marketplaceTextLabel(selectedOrderDetails.import_error)}</div>}
                      {getOrderPaymentStatus(selectedOrderDetails) && <div>Status do pagamento: {rawStatusLabel(getOrderPaymentStatus(selectedOrderDetails))}.</div>}
                      {selectedOrderDetails.date_closed && <div>Encerrado em: {formatDate(selectedOrderDetails.date_closed)}.</div>}
                      {selectedOrderDetails.cancel_date && <div>Cancelamento registrado em: {formatDate(selectedOrderDetails.cancel_date)}.</div>}
                      {selectedOrderDetails.cancel_requested_by && <div>Solicitado por: {rawStatusLabel(selectedOrderDetails.cancel_requested_by)}.</div>}
                      <div>{getOrderCancellationHint(selectedOrderDetails)}</div>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="mt-2 mr-2"
                        onClick={() => {
                          setCancelSaleForm({ reason: "BUYER_REGRETS", message: "Venda não concretizada a pedido do comprador." });
                          setOrderToCancel(selectedOrderDetails);
                        }}
                        disabled={!canCancelSale(selectedOrderDetails, selectedOrderClaims.some(isActiveClaim)) || Boolean(actionKey)}
                      >
                        <XCircle className="h-4 w-4" />
                        Cancelar venda
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 bg-transparent"
                        onClick={() => refundOrder(selectedOrderDetails)}
                        disabled={
                          !getRefundablePayment(selectedOrderDetails) ||
                          actionKey === `refund:${selectedOrderDetails.id}` ||
                          selectedOrderClaims.some(isActiveClaim)
                        }
                      >
                        {actionKey === `refund:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Reembolsar pagamento
                      </Button>
                      <div className="text-xs">
                        {selectedOrderClaims.some(isActiveClaim)
                          ? "Há uma reclamação ativa. Use as ações disponibilizadas no quadro de reclamações."
                          : "Disponível apenas quando houver pagamento aprovado e ainda não reembolsado."}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Reclamações</h3>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {selectedOrderClaims.map((claim) => (
                        <div key={claim.id} className="rounded-md border bg-muted/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{claim.title ? marketplaceTextLabel(claim.title) : "Reclamação Mercado Livre"}</span>
                            {claim.status ? statusBadge(claim.status) : null}
                          </div>
                          <div className="mt-1">
                            {claim.reason
                              ? marketplaceTextLabel(claim.reason)
                              : claim.error
                                ? marketplaceTextLabel(claim.error)
                                : "Detalhe da reclamação importado pelo webhook."}
                          </div>
                          {claim.dueDate && <div className="mt-1 text-xs">Prazo: {formatDate(claim.dueDate)}</div>}
                          {claim.closedAt && <div className="mt-1 text-xs">Encerrada em: {formatDate(claim.closedAt)}</div>}
                          {claim.resolution && <div className="mt-1 text-xs">Resolução: {rawStatusLabel(claim.resolution)}</div>}
                          {claim.returnId && (
                            <div className="mt-2 rounded-md border bg-background p-2 text-xs">
                              <div className="font-medium text-foreground">Devolução #{claim.returnId}</div>
                              <div>Status: {claim.returnStatus ? rawStatusLabel(claim.returnStatus) : "Aguardando atualização"}</div>
                              {claim.returnTrackingNumber && <div>Rastreio: <span className="font-mono">{claim.returnTrackingNumber}</span></div>}
                            </div>
                          )}
                          {Array.isArray(claim.availableActions) && claim.availableActions.length > 0 && (
                            <div className="mt-1 text-xs">
                              Ações disponíveis: {claim.availableActions.map((action: any) => rawStatusLabel(action?.action || action?.type || action?.name || action)).join(", ")}
                            </div>
                          )}
                          {getSupportedClaimActions(claim).length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {getSupportedClaimActions(claim).map((action) => {
                                const loading = actionKey === `claim:${claim.id}:${action.id}`;
                                return (
                                  <Button
                                    key={action.id}
                                    size="sm"
                                    variant={action.destructive ? "destructive" : "outline"}
                                    className={action.destructive ? "" : "bg-transparent"}
                                    onClick={() => executeClaimAction(claim, action)}
                                    disabled={Boolean(actionKey)}
                                  >
                                    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                    {action.label}
                                  </Button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                      {selectedOrderClaims.length === 0 && (
                        <div>Nenhuma reclamação importada para este pedido até o momento.</div>
                      )}
                      <Button size="sm" variant="outline" className="mt-2 bg-transparent" onClick={() => void loadClaims()} disabled={loadingClaims}>
                        {loadingClaims ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                        Atualizar reclamações
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Nota fiscal do pedido</h3>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <div>
                          Status no Mercado Livre: {selectedOrderDetails.invoice_status ? rawStatusLabel(selectedOrderDetails.invoice_status) : "Não enviada"}
                        </div>
                        <div>
                          Chave de acesso: <span className="font-mono text-xs text-foreground">{selectedOrderDetails.invoice_fiscal_key || "-"}</span>
                        </div>
                        {selectedOrderDetails.invoice_sent_at && <div>Enviada em: {formatDate(selectedOrderDetails.invoice_sent_at)}</div>}
                        {selectedOrderDetails.invoice_error && <div className="text-destructive">{marketplaceTextLabel(selectedOrderDetails.invoice_error)}</div>}
                        {!canSendInvoiceToMercadoLivre(selectedOrderDetails) && (
                          <div>A importação automática do XML no shipment está disponível apenas para logísticas compatíveis do Mercado Envios.</div>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isInvoiceSent(selectedOrderDetails) ? "outline" : "default"}
                      className={isInvoiceSent(selectedOrderDetails) ? "bg-transparent" : undefined}
                      onClick={() => sendOrderInvoice(selectedOrderDetails)}
                      disabled={
                        !selectedOrderDetails.venda_id ||
                        !canSendInvoiceToMercadoLivre(selectedOrderDetails) ||
                        isInvoiceSent(selectedOrderDetails) ||
                        actionKey === `invoice:${selectedOrderDetails.id}`
                      }
                    >
                      {actionKey === `invoice:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      {isInvoiceSent(selectedOrderDetails) ? "NF-e enviada" : "Enviar NF-e"}
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border p-4">
                  <h3 className="text-sm font-semibold">Ações operacionais</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      onClick={() => selectedOrderDetails.venda_id && syncShipment(Number(selectedOrderDetails.venda_id))}
                      disabled={!selectedOrderDetails.venda_id || actionKey === `shipment:${selectedOrderDetails.venda_id}`}
                    >
                      {actionKey === `shipment:${selectedOrderDetails.venda_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      Sincronizar envio
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      onClick={() => selectedOrderDetails.venda_id && openShipmentLabel(Number(selectedOrderDetails.venda_id))}
                      disabled={!selectedOrderDetails.venda_id || !canPrintMercadoLivreLabel(selectedOrderDetails) || actionKey === `label:${selectedOrderDetails.venda_id}`}
                    >
                      {actionKey === `label:${selectedOrderDetails.venda_id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                      Abrir etiqueta
                    </Button>
                    <Button size="sm" variant="outline" className="bg-transparent" onClick={() => openMarketplaceChat(selectedOrderDetails.id)}>
                      <MessageCircle className="h-4 w-4" />
                      Abrir chat
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      onClick={() => sendOrderInvoice(selectedOrderDetails)}
                      disabled={!selectedOrderDetails.venda_id || !canSendInvoiceToMercadoLivre(selectedOrderDetails) || isInvoiceSent(selectedOrderDetails) || actionKey === `invoice:${selectedOrderDetails.id}`}
                    >
                      {actionKey === `invoice:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      Enviar NF-e
                    </Button>
                  </div>
                </div>

                <details className="rounded-md border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Dados técnicos</summary>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify({ order: selectedOrderDetails.raw_order, payments: selectedOrderDetails.raw_payments, shipment: selectedOrderDetails.raw_shipment, shipmentCosts: selectedOrderDetails.raw_shipment_costs, shipmentItems: selectedOrderDetails.raw_shipment_items, invoice: selectedOrderDetails.raw_invoice }, null, 2)}
                  </pre>
                </details>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <MarketplaceChatLauncher onClick={() => void openMarketplaceChat()} disabled={!connected} unreadCount={unreadChatMessageCount} />

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Chat Mercado Livre</SheetTitle>
            <SheetDescription>Conversas pós-venda vinculadas aos pedidos importados.</SheetDescription>
          </SheetHeader>

          <MarketplaceConversationPanel
            channelName="Mercado Livre"
            conversations={normalizedChatConversations}
            selectedId={selectedChatConversation ? String(selectedChatConversation.orderDbId) : null}
            selectedName={selectedChatConversation ? `Pedido ${selectedChatConversation.mlOrderId}` : null}
            messages={normalizedChatMessages}
            loading={loadingChat || sendingChatMessage}
            error={selectedChatConversation?.error}
            messageText={chatMessageText}
            onMessageTextChange={setChatMessageText}
            onRefresh={() => void loadChatConversations()}
            onSelect={(id) => setSelectedChatOrderId(Number(id))}
            onSend={() => void sendChatMessage()}
          />
        </SheetContent>
      </Sheet>

      {!connected && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">
          <XCircle className="h-4 w-4 text-yellow-600" />
          Conecte uma conta Mercado Livre antes de sincronizar pedidos ou vincular anúncios.
        </div>
      )}
    </div>
  );
}
