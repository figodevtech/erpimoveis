"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronsUpDown,
  ClipboardList,
  ExternalLink,
  Grid2X2,
  ImageIcon,
  Link2,
  List,
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
import { toast } from "sonner";

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
  raw_order?: any;
  raw_payments?: any[];
  raw_shipment?: any;
  raw_shipment_costs?: any;
  raw_shipment_items?: any[];
  shipment_updated_at?: string | null;
  last_synced_at?: string | null;
  created_at?: string | null;
};

type MlNotification = {
  id: number;
  topic?: string | null;
  resource?: string | null;
  ml_user_id?: number | null;
  status?: string | null;
  error?: string | null;
  created_at?: string | null;
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
    updated_at?: string | null;
  } | null;
};

type ViewMode = "list" | "cards";

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
};

type SimilarProduct = {
  id?: string;
  title?: string;
  price: number;
  currencyId: string;
  availableQuantity?: number | null;
  thumbnail?: string | null;
  permalink?: string | null;
  condition?: string | null;
  categoryId?: string | null;
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
  title: string;
  price: string;
  availableQuantity: string;
  description: string;
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
};

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
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

function formatCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return (Number(digits) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const listingFieldClassStatic =
  "border-border/80 bg-white shadow-sm ring-1 ring-border/50 focus-visible:border-primary/50 focus-visible:ring-primary/20 dark:bg-input/40";

function statusBadge(status?: string | null) {
  const value = String(status ?? "sem_status").toUpperCase();
  const label = statusLabel(value);
  const className =
    value === "ACTIVE" || value === "PAID" || value === "APPROVED"
      ? "bg-emerald-600 text-white"
      : value === "PAUSED" || value === "PENDING" || value === "IN_PROCESS"
        ? "bg-yellow-600 text-white"
        : value === "CLOSED" || value === "CANCELLED" || value === "CANCELED" || value === "REFUNDED" || value === "CHARGED_BACK"
          ? "bg-red-600 text-white"
          : "bg-slate-600 text-white";

  return <Badge className={`text-xs ${className}`}>{label}</Badge>;
}

function statusLabel(value: string) {
  const normalized = String(value ?? "").toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "Ativo",
    PAUSED: "Pausado",
    CLOSED: "Finalizado",
    PAID: "Pago",
    APPROVED: "Aprovado",
    REFUNDED: "Reembolsado",
    CHARGED_BACK: "Estornado",
    IN_PROCESS: "Em processamento",
    PAYMENT_REQUIRED: "Aguardando pagamento",
    CONFIRMED: "Confirmado",
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
    SEM_STATUS: "Sem status",
  };

  return labels[normalized] ?? normalized
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function rawStatusLabel(value?: string | null) {
  return statusLabel(String(value ?? "sem_status"));
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

function isRefundedOrder(order: MlOrder) {
  const status = String(order.status ?? "").toLowerCase();
  const paymentStatus = String(order.payment_status ?? "").toLowerCase();
  const paymentDetail = String(order.payment_status_detail ?? "").toLowerCase();
  const tags = [...(Array.isArray(order.order_tags) ? order.order_tags : []), ...(Array.isArray(order.raw_order?.tags) ? order.raw_order.tags : [])].map((tag) =>
    String(tag).toLowerCase(),
  );

  return (
    status.includes("cancel") ||
    paymentStatus.includes("refund") ||
    paymentStatus.includes("charged_back") ||
    paymentDetail.includes("refund") ||
    paymentDetail.includes("chargeback") ||
    tags.some((tag) => tag.includes("refund") || tag.includes("cancel"))
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

function getOrderPackId(rawOrder: any) {
  return rawOrder?.pack_id || rawOrder?.pack?.id || null;
}

function getOrderCancellationHint(order: MlOrder) {
  const status = String(order.status ?? order.raw_order?.status ?? "").toLowerCase();
  const paymentStatus = getOrderPaymentStatus(order);
  const tags = [...(Array.isArray(order.order_tags) ? order.order_tags : []), ...(Array.isArray(order.raw_order?.tags) ? order.raw_order.tags : [])].map((tag) =>
    String(tag).toLowerCase(),
  );
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
  if (claim && isActiveClaim(claim)) {
    return {
      title: claim?.title || "Reclamação aberta. Atenda a solicitação do comprador",
      description: claim?.reason || claim?.error || "Abra os detalhes para acompanhar a reclamação e as próximas ações.",
      tone: "danger" as const,
      action: "Atender reclamação",
    };
  }

  if (claim && !isActiveClaim(claim)) {
    return {
      title: "Reclamação encerrada",
      description: claim.resolution ? `Resolução: ${rawStatusLabel(claim.resolution)}.` : "A reclamação já foi encerrada no Mercado Livre.",
      tone: "default" as const,
      action: "Ver detalhes",
    };
  }

  if (isRefundedOrder(order)) {
    return {
      title: "Pedido cancelado ou reembolsado",
      description: getOrderCancellationHint(order),
      tone: "danger" as const,
      action: "Ver detalhes",
    };
  }

  if (isMercadoEnviosOrder(order)) {
    return {
      title: "Envio Mercado Envios",
      description: order.tracking_number ? `Rastreio ${order.tracking_number}` : "Imprima a etiqueta e acompanhe o envio.",
      tone: "default" as const,
      action: "Imprimir etiqueta",
    };
  }

  if (order.ml_shipment_id) {
    return {
      title: "Envio personalizado",
      description: order.tracking_number ? `Rastreio ${order.tracking_number}` : "Este pedido não gera etiqueta do Mercado Livre. Registre rastreio e transportadora no ERP.",
      tone: "default" as const,
      action: "Registrar envio",
    };
  }

  return {
    title: "Mercado Envios pendente",
    description: "O Mercado Livre ainda não retornou um envio para este pedido. Sincronize novamente; se continuar sem envio, o anúncio/compra foi concluído fora do Mercado Envios.",
    tone: "default" as const,
    action: "Sincronizar pedido",
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

function ProductImage({ product }: { product: ProductRow }) {
  const imageUrl = product.imageUrls?.[0] || product.imgUrl;

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={product.tituloMarketplace || product.titulo}
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      <ImageIcon className="h-5 w-5" />
    </div>
  );
}

export default function MarketplacePage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [orders, setOrders] = useState<MlOrder[]>([]);
  const [notifications, setNotifications] = useState<MlNotification[]>([]);
  const [claims, setClaims] = useState<MlClaim[]>([]);
  const [questions, setQuestions] = useState<MlQuestion[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("products");
  const [questionStatusFilter, setQuestionStatusFilter] = useState("UNANSWERED");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
    notifyBuyer: true,
  });
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [linkingProductId, setLinkingProductId] = useState<number | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogTab, setCreateDialogTab] = useState("dados");
  const [listingFieldErrors, setListingFieldErrors] = useState<Record<string, string>>({});
  const [creatingListing, setCreatingListing] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(false);
  const [loadingEditListing, setLoadingEditListing] = useState(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<MlOrder | null>(null);
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
  const [conditionOptions, setConditionOptions] = useState<string[]>(["new", "used", "not_specified"]);
  const [categoryAttributes, setCategoryAttributes] = useState<MlCategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<SimilarProduct[]>([]);
  const [loadingSimilarProducts, setLoadingSimilarProducts] = useState(false);
  const [similarProductsUnavailable, setSimilarProductsUnavailable] = useState(false);
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
    title: "",
    price: "",
    availableQuantity: "",
    description: "",
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
  });

  const activeAccount = accounts[0] ?? null;
  const requiresReconnect = Boolean(activeAccount?.needs_reconnect);
  const connected = Boolean(activeAccount) && !requiresReconnect;
  const linkedCount = products.filter((product) => product.mercadolivre).length;
  const unlinkedCount = Math.max(products.length - linkedCount, 0);
  const linkedProducts = products.filter((product) => product.mercadolivre);
  const publishableProducts = products.filter((product) => !product.mercadolivre);
  const unansweredQuestions = questions.filter((question) => String(question.status ?? "").toUpperCase() === "UNANSWERED").length;
  const selectedChatConversation =
    chatConversations.find((conversation) => conversation.orderDbId === selectedChatOrderId) ?? chatConversations[0] ?? null;
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
  const selectedOrderClaims = selectedOrderDetails ? claimsByOrderId.get(selectedOrderDetails.id) ?? [] : [];
  const loadingOrdersView = activeTab === "orders" && (loadingDashboard || syncing || loadingClaims);
  const unreadChatMessageCount = chatConversations.reduce(
    (sum, conversation) =>
      sum +
      conversation.messages.filter((message) => !message.fromSeller && String(message.status ?? "").toLowerCase() === "unread").length,
    0,
  );
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
    categoryShippingOptions.length === 0 || categoryShippingOptions.includes("me2") || categoryShippingOptions.includes("carrier");
  const categorySupportsCustomShipping = categoryShippingOptions.length === 0 || categoryShippingOptions.includes("custom");
  const categoryBlocksMercadoEnvios =
    listingForm.categoryId && listingForm.shippingMode === "me2" && !categorySupportsMercadoEnvios;
  const categoryShippingIssue = categoryBlocksMercadoEnvios
    ? `A categoria selecionada retorna envio ${listingForm.categoryShippingOptions.join(", ")} no Mercado Livre. Use Envio personalizado com custo fixo ou escolha uma categoria compatível com Mercado Envios.`
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
  const listingIssues = [
    !listingForm.produtoId ? "Selecione um produto do ERP." : "",
    !listingForm.title.trim() ? "Informe o título do anúncio." : "",
    !listingForm.categoryId ? "Selecione a categoria Mercado Livre." : "",
    parseCurrencyInput(listingForm.price) <= 0 ? "Informe um preço válido." : "",
    Number(listingForm.availableQuantity) <= 0 ? "Informe estoque disponível." : "",
    validPreviewImages.length === 0 ? "Informe ao menos uma imagem pública válida." : "",
    ...requiredMissingAttributes.map((attribute) => `Preencha o atributo obrigatório: ${attribute.name}.`),
    categoryShippingIssue,
    customShippingIssue,
    missingShippingDimensions ? "Informe dimensões e peso para o envio Mercado Envios." : "",
  ].filter(Boolean);
  const canPublishListing = listingIssues.length === 0;
  const notificationErrors = notifications.filter((notification) => notification.error || String(notification.status ?? "").toUpperCase() === "ERRO").length;

  const authUrl = useMemo(() => "/api/integracoes/mercadolivre/auth", []);
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
    if (normalized.includes("imagem") || normalized.includes("pictures")) {
      errors.images = message;
    }

    return Object.keys(errors).length ? errors : { general: message };
  }

  const tabHeader = {
    products: {
      title: "Produtos e anúncios",
      description: "Vincule anúncios existentes e sincronize preço/estoque.",
    },
    listings: {
      title: "Anúncios Mercado Livre",
      description: "Anúncios já vinculados a produtos do ERP.",
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

  async function loadDashboard() {
    setLoadingDashboard(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/dashboard", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar painel.");
      setAccounts(json.accounts ?? []);
      setOrders(json.orders ?? []);
      setNotifications(json.notifications ?? []);
    } catch (e: any) {
      toast.error("Erro ao carregar marketplace", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function loadClaims() {
    if (!connected) {
      setClaims([]);
      return;
    }

    setLoadingClaims(true);
    try {
      const response = await fetch("/api/integracoes/mercadolivre/claims", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar reclamações.");
      setClaims(json.data ?? []);
    } catch (e: any) {
      setClaims([]);
      toast.error("Erro ao carregar reclamações", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingClaims(false);
    }
  }

  async function loadQuestions(status = questionStatusFilter) {
    if (!connected) {
      setQuestions([]);
      return;
    }

    setLoadingQuestions(true);
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
      toast.error("Erro ao carregar perguntas", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingQuestions(false);
    }
  }

  async function loadListingOptions() {
    try {
      const response = await fetch("/api/integracoes/mercadolivre/listing-options", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar opções de anúncio.");
      if (Array.isArray(json.listingTypes) && json.listingTypes.length > 0) {
        setListingTypeOptions(json.listingTypes);
      }
    } catch (e: any) {
      toast.error("Erro ao carregar opções do Mercado Livre", { description: marketplaceErrorMessage(e) });
    }
  }

  async function loadCategoryAttributes(categoryId: string) {
    setLoadingAttributes(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar atributos.");
      const attrs = (json.data ?? []) as MlCategoryAttribute[];
      const shippingOptions = Array.isArray(json.settings?.shippingOptions) ? json.settings.shippingOptions.filter(Boolean) : [];
      setCategoryAttributes(attrs);
      setListingForm((current) => ({
        ...current,
        categoryShippingOptions: shippingOptions,
        shippingMode:
          shippingOptions.length > 0 && !shippingOptions.includes("carrier") && !shippingOptions.includes("me2") && shippingOptions.includes("custom")
            ? "custom"
            : current.shippingMode,
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
      toast.error("Erro ao carregar atributos da categoria", { description: marketplaceErrorMessage(e) });
      setCategoryAttributes([]);
    } finally {
      setLoadingAttributes(false);
    }
  }

  async function searchSimilarProducts() {
    const q = listingForm.title.trim();
    if (q.length < 3) {
      toast.error("Informe um título para pesquisar semelhantes.");
      return;
    }

    setLoadingSimilarProducts(true);
    try {
      const params = new URLSearchParams({ q, limit: "8" });
      if (listingForm.categoryId) params.set("categoryId", listingForm.categoryId);
      const response = await fetch(`/api/integracoes/mercadolivre/similar-products?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao pesquisar semelhantes.");
      setSimilarProducts(json.data ?? []);
      setSimilarProductsUnavailable(Boolean(json.unavailable));
      if (json.unavailable) return;
      if (!json.data?.length) toast.message("Nenhum anúncio semelhante encontrado.");
    } catch (e: any) {
      toast.error("Erro ao pesquisar semelhantes", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingSimilarProducts(false);
    }
  }

  function applySimilarProduct(product: SimilarProduct) {
    setListingForm((current) => ({
      ...current,
      title: product.title || current.title,
      price: formatCurrencyInputFromNumber(product.price),
      categoryId: product.categoryId || current.categoryId,
      condition: product.condition === "new" || product.condition === "used" || product.condition === "not_specified" ? product.condition : current.condition,
    }));

    if (product.categoryId && product.categoryId !== listingForm.categoryId) {
      loadCategoryAttributes(product.categoryId);
    }
    toast.success("Dados do anúncio semelhante aplicados.");
  }

  async function loadProducts(searchText = search) {
    setLoadingProducts(true);
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (searchText.trim()) params.set("search", searchText.trim());
      const response = await fetch(`/api/integracoes/mercadolivre/products?${params.toString()}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar produtos.");
      setProducts(json.data ?? []);
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
      const processed = Array.isArray(json.results) ? json.results.length : 0;
      const failed = Array.isArray(json.results) ? json.results.filter((item: any) => item?.error).length : 0;
      if (failed > 0) {
        const firstError = json.results.find((item: any) => item?.error)?.error;
        toast.error(`${failed} pedido(s) encontrado(s), mas com falha na importação.`, { description: marketplaceErrorMessage(firstError) });
      } else {
      toast.success(
        Number(json.created ?? 0) > 0
          ? `${json.created} venda(s) importada(s).`
          : processed > 0
            ? `${processed} pedido(s) verificado(s), sem venda nova.`
            : "Nenhum pedido encontrado no período.",
      );
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
      toast.success(json.messageSent ? "Envio registrado e comprador avisado." : "Envio registrado.");
      await loadDashboard();
    } catch (e: any) {
      toast.error("Erro ao registrar envio", { description: marketplaceErrorMessage(e) });
    } finally {
      setActionKey(null);
    }
  }

  function openShipmentLabel(vendaId: number) {
    window.open(`/api/integracoes/mercadolivre/shipments/venda/${vendaId}/label`, "_blank", "noopener,noreferrer");
  }

  async function refundOrder(order: MlOrder) {
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

  async function loadChatConversations(orderDbId?: number) {
    setLoadingChat(true);
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
      toast.error("Erro ao carregar chat Mercado Livre", { description: marketplaceErrorMessage(e) });
    } finally {
      setLoadingChat(false);
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
      toast.success("Anúncio atualizado.");
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
    setSimilarProducts([]);
    setSimilarProductsUnavailable(false);
    setPreviewImageIndex(0);
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
  }

  async function openEditListing(product: ProductRow) {
    const link = product.mercadolivre;
    if (!link) return;

    const fallbackForm: ListingEditForm = {
      itemId: link.ml_item_id,
      produtoId: String(product.id),
      title: link.title || product.tituloMarketplace || product.titulo || "",
      price: formatCurrencyInputFromNumber(product.precovenda),
      availableQuantity: String(Math.max(Number(product.estoque ?? 0), 0)),
      description: product.descricaoMarketplace || product.descricao || "",
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
    };

    setEditForm({
      ...fallbackForm,
    });
    setEditDialogOpen(true);

    setLoadingEditListing(true);
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(link.ml_item_id)}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar dados atuais do anúncio.");
      const item = json.data ?? {};
      setEditForm({
        ...fallbackForm,
        title: item.title || fallbackForm.title,
        price: formatCurrencyInputFromNumber(item.price ?? product.precovenda),
        availableQuantity: String(Math.max(Number(item.availableQuantity ?? product.estoque ?? 0), 0)),
        description: item.description || fallbackForm.description,
        pictureUrl: Array.isArray(item.pictures) && item.pictures.length ? item.pictures.join("\n") : fallbackForm.pictureUrl,
        warranty: item.warranty || "",
        warrantyTime: item.warrantyTime || "",
        shippingMode: "me2",
        logisticType: item.logisticType || fallbackForm.logisticType,
        freeShipping: Boolean(item.freeShipping),
        localPickup: false,
        widthCm: item.widthCm || "",
        heightCm: item.heightCm || "",
        lengthCm: item.lengthCm || "",
        weightGrams: item.weightGrams || "",
      });
    } catch (e: any) {
      toast.error("Não foi possível carregar o anúncio atual", {
        description: marketplaceErrorMessage(e, "O formulário foi aberto com os dados locais do ERP."),
      });
    } finally {
      setLoadingEditListing(false);
    }
  }

  async function saveEditedListing() {
    if (!editForm.itemId) return;
    if (!editForm.title.trim()) {
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
      const response = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(editForm.itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_listing",
          title: editForm.title,
          price: parseCurrencyInput(editForm.price),
          availableQuantity: Number(editForm.availableQuantity),
          description: editForm.description,
          pictureUrl: editForm.pictureUrl,
          warranty: editForm.warranty,
          warrantyTime: editForm.warrantyTime,
          shippingMode: "me2",
          logisticType: editForm.logisticType,
          freeShipping: editForm.freeShipping,
          localPickup: false,
          widthCm: Number(editForm.widthCm.replace(",", ".")),
          heightCm: Number(editForm.heightCm.replace(",", ".")),
          lengthCm: Number(editForm.lengthCm.replace(",", ".")),
          weightGrams: Number(editForm.weightGrams),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao editar anúncio.");

      toast.success("Anúncio atualizado.");
      setEditDialogOpen(false);
      await loadProducts();
    } catch (e: any) {
      toast.error("Erro ao editar anúncio", { description: marketplaceErrorMessage(e) });
    } finally {
      setEditingListing(false);
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
    updateListingForm("categoryShippingOptions", category.shippingOptions ?? []);
    const nextShippingOptions = (category.shippingOptions ?? []).map((option) => option.toLowerCase());
    if (nextShippingOptions.length > 0 && !nextShippingOptions.includes("carrier") && !nextShippingOptions.includes("me2") && nextShippingOptions.includes("custom")) {
      updateListingForm("shippingMode", "custom");
    }
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
      const listingGtin = normalizeGtin(getListingAttributeValue(listingForm, "GTIN"));
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
      if (!response.ok) throw new Error(json?.error || "Falha ao criar anúncio.");

      toast.success("Anúncio criado no Mercado Livre.");
      setCreateDialogOpen(false);
      setListingFieldErrors({});
      await loadProducts();
    } catch (e: any) {
      const message = marketplaceErrorMessage(e);
      const fieldErrors = mapListingApiError(message);
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
    if (key === "categoryId" || key === "categoryName" || key === "categoryPath") clearListingErrors("category", "general");
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
    }

    setListingForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateEditForm<K extends keyof ListingEditForm>(key: K, value: ListingEditForm[K]) {
    setEditForm((current) => ({
      ...current,
      [key]: value,
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
    setActiveTab(value);
    if (value === "orders" && connected && !syncing) {
      syncOrders().then(() => loadClaims());
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
    if (!connected || activeTab !== "orders") {
      if (!connected) setClaims([]);
      return;
    }

    loadClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connected]);

  if (initialLoading) {
    return (
      <div className="flex h-[80vh] w-full items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="animate-pulse text-muted-foreground">Carregando marketplace...</p>
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
            <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "sync_stock_price")} disabled={Boolean(busy)}>
              <RefreshCcw className="mr-2 h-4 w-4" />
              Atualizar estoque e preço
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "pause")} disabled={Boolean(busy)}>
              <Pause className="mr-2 h-4 w-4" />
              Pausar anúncio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => itemAction(link.ml_item_id, "activate")} disabled={Boolean(busy)}>
              <Play className="mr-2 h-4 w-4" />
              Ativar anúncio
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => unlinkProduct(product.id)} disabled={Boolean(busy)}>
              <Unlink className="mr-2 h-4 w-4" />
              Remover vínculo
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => itemAction(link.ml_item_id, "close")}
              disabled={Boolean(busy)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Finalizar anúncio
            </DropdownMenuItem>
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
    <div className="mx-auto space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="min-h-0">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Conta Mercado Livre</CardTitle>
              <div className="truncate text-2xl font-bold leading-tight">
                {requiresReconnect ? "Sessão inválida" : activeAccount ? activeAccount.nickname || activeAccount.ml_user_id : "Desconectada"}
              </div>
              <p className="text-xs text-muted-foreground">{activeAccount ? `User ID ${activeAccount.ml_user_id}` : "Autorize uma conta"}</p>
            </div>
            {connected ? <Check className="h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-orange-500" />}
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Produtos vinculados</CardTitle>
              <div className="text-2xl font-bold leading-tight">{linkedCount}</div>
              <p className="text-xs text-muted-foreground">{unlinkedCount} sem vínculo na lista</p>
            </div>
            <PackageCheck className="h-5 w-5 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Pedidos importados</CardTitle>
              <div className="text-2xl font-bold leading-tight">{orders.length}</div>
              <p className="text-xs text-muted-foreground">Últimos registros</p>
            </div>
            <Store className="h-5 w-5 shrink-0 text-muted-foreground" />
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Perguntas pendentes</CardTitle>
              <div className="text-2xl font-bold leading-tight">{unansweredQuestions}</div>
              <p className="text-xs text-muted-foreground">{questions.length} na visualização</p>
            </div>
            <MessageCircle className={`h-5 w-5 shrink-0 ${unansweredQuestions > 0 ? "text-yellow-600" : "text-muted-foreground"}`} />
          </CardContent>
        </Card>
        <Card className="min-h-0">
          <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium">Alertas</CardTitle>
              <div className="text-2xl font-bold leading-tight">{notificationErrors}</div>
              <p className="text-xs text-muted-foreground">{notifications.length} evento(s) recentes</p>
            </div>
            <AlertTriangle className={`h-5 w-5 shrink-0 ${notificationErrors > 0 ? "text-yellow-600" : "text-muted-foreground"}`} />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardContent className="px-3 py-1.5">
          <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") loadProducts();
                }}
                placeholder="Busque por produto, referência ou título de marketplace..."
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-8 bg-transparent px-3 text-xs hover:cursor-pointer" onClick={() => loadProducts()} disabled={loadingProducts}>
                <Search className="h-3.5 w-3.5" />
                Buscar
              </Button>
              <Button variant="outline" size="sm" className="h-8 bg-transparent px-3 text-xs hover:cursor-pointer" onClick={syncOrders} disabled={!connected || syncing}>
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />}
                Sincronizar pedidos
              </Button>
              {(!activeAccount || requiresReconnect) && (
                <Button asChild size="sm" className="h-8 px-3 text-xs">
                  <a href={authUrl}>{requiresReconnect ? "Reconectar" : "Conectar"}</a>
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={changeMainTab}>
        <Card className="bg-card">
          <CardHeader className="border-b-2 pb-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <CardTitle>{tabHeader.title}</CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={refreshMarketplace}
                    className="inline-flex items-center gap-1 text-foreground/50 hover:text-foreground/70 disabled:cursor-wait disabled:opacity-60"
                    disabled={loadingDashboard || loadingProducts}
                  >
                    <span>Recarregar</span>
                    <Loader2 width={12} className={loadingDashboard || loadingProducts ? "animate-spin" : ""} />
                  </button>
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <TabsList className="h-auto justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                  <TabsTrigger
                    value="products"
                    className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    Produtos
                  </TabsTrigger>
                  <TabsTrigger
                    value="listings"
                    className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    Mercado Livre
                  </TabsTrigger>
                  <TabsTrigger
                    value="orders"
                    className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    Pedidos
                  </TabsTrigger>
                  <TabsTrigger
                    value="atendimento"
                    className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    Atendimento
                  </TabsTrigger>
                  <TabsTrigger
                    value="logs"
                    className="h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                  >
                    Logs
                  </TabsTrigger>
                </TabsList>
                <div className={activeTab === "products" ? "flex rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm" : "invisible flex rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm"} aria-hidden={activeTab === "products" ? undefined : "true"}>
                  <Button size="sm" variant={viewMode === "list" ? "secondary" : "ghost"} className="h-8 rounded-xl" onClick={() => setViewMode("list")}>
                    <List className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant={viewMode === "cards" ? "secondary" : "ghost"} className="h-8 rounded-xl" onClick={() => setViewMode("cards")}>
                    <Grid2X2 className="h-4 w-4" />
                  </Button>
                </div>
                <Button className="h-9 rounded-xl" onClick={openCreateListing} disabled={!connected}>
                  <Plus className="h-4 w-4" />
                  Criar anúncio
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative min-h-[300px] -mt-[24px] px-4 pb-4 pt-0">
            <div
              className={`${
                loadingDashboard || loadingProducts || loadingQuestions ? "opacity-100" : "opacity-0"
              } absolute left-0 right-0 top-0 h-0.5 w-full overflow-hidden bg-slate-400 transition-all`}
            >
              <div
                className={`absolute left-0 h-full w-1/2 -translate-x-[100%] rounded-lg bg-primary ${
                  loadingDashboard || loadingProducts || loadingQuestions ? "animate-slideIn" : ""
                }`}
              />
            </div>
            <TabsContent value="products" className="mt-6">
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
                    {products.map((product) => {
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {products.map((product) => {
                    const link = product.mercadolivre;
                    return (
                      <div key={product.id} className="overflow-hidden rounded-md border bg-background">
                        <div className="aspect-[5/3] border-b bg-muted">
                          <ProductImage product={product} />
                        </div>
                        <div className="space-y-2 p-2.5">
                          <div className="min-h-[38px]">
                            <div className="line-clamp-2 text-xs font-medium leading-snug">{product.tituloMarketplace || product.titulo}</div>
                            <div className="text-xs text-muted-foreground">
                              #{product.id} {product.referencia ? `- ${product.referencia}` : ""}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                              <div className="text-xs text-muted-foreground">Estoque</div>
                              <div className="text-sm font-semibold">{product.estoque ?? 0}</div>
                              <div className="mt-1">{stockStatusBadge(product.status_estoque, product.estoque)}</div>
                            </div>
                            <div className="rounded-md border bg-muted/30 px-2 py-1.5">
                              <div className="text-xs text-muted-foreground">Preço</div>
                              <div className="text-sm font-semibold">{formatCurrency(product.precovenda)}</div>
                            </div>
                          </div>
                          <div className="min-h-[62px] rounded-md border p-2">
                            {link ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-mono text-[11px]">{link.ml_item_id}</span>
                                  {statusBadge(link.status)}
                                </div>
                                <div className="line-clamp-1 text-[11px] text-muted-foreground">{link.title || "Sem título"}</div>
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
                              <div className="flex h-full items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>Não vinculado</span>
                                <Button size="sm" variant="outline" className="bg-transparent" onClick={() => setLinkingProductId(product.id)}>
                                  <Link2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
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
            </TabsContent>

            <TabsContent value="listings" className="mt-6">
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Anúncio</TableHead>
                      <TableHead>Produto ERP</TableHead>
                      <TableHead>Qtd. estoque</TableHead>
                      <TableHead>Status estoque</TableHead>
                      <TableHead>Preço</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linkedProducts.map((product) => {
                      const link = product.mercadolivre;
                      if (!link) return null;

                      return (
                        <TableRow key={link.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs">{link.ml_item_id}</span>
                                {statusBadge(link.status)}
                              </div>
                              <div className="max-w-[320px] truncate text-xs text-muted-foreground">{link.title || "Sem título"}</div>
                              {link.permalink && (
                                <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" href={link.permalink} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3 w-3" />
                                  Abrir anúncio
                                </a>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 overflow-hidden rounded-md border bg-muted">
                                <ProductImage product={product} />
                              </div>
                              <div className="min-w-0">
                                <div className="truncate font-medium">{product.tituloMarketplace || product.titulo}</div>
                                <div className="text-xs text-muted-foreground">#{product.id}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">{product.estoque ?? 0}</TableCell>
                          <TableCell>{stockStatusBadge(product.status_estoque, product.estoque)}</TableCell>
                          <TableCell>{formatCurrency(product.precovenda)}</TableCell>
                          <TableCell className="text-right">{productActions(product)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {linkedProducts.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                          Nenhum anúncio vinculado.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="orders" className="mt-6">
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
                      {orders.map((order) => {
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
                    const refundablePayment = getRefundablePayment(order);
                    const refundingOrder = actionKey === `refund:${order.id}`;
                    const canPrintShipmentLabel = hasVenda && isMercadoEnviosOrder(order);

                    return (
                      <AccordionItem key={order.id} value={String(order.id)} className="overflow-hidden rounded-lg border bg-background shadow-sm">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="grid min-w-0 flex-1 items-center gap-3 text-left md:grid-cols-[minmax(220px,1fr)_150px_130px_130px]">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <Badge variant={orderHasActiveClaim ? "destructive" : "outline"}>{orderHasActiveClaim ? "Reclamação" : "Mercado Livre"}</Badge>
                                <span className="truncate font-mono text-xs">Pedido #{order.ml_order_id}</span>
                              </div>
                              <div className="mt-1 truncate text-sm font-medium">{itemTitle}</div>
                            </div>
                            <div className="truncate text-sm text-muted-foreground">{getOrderBuyerLabel(order)}</div>
                            <div className="text-sm text-muted-foreground">{formatMarketplaceOrderDate(order.date_created || order.created_at)}</div>
                            <div className="text-sm font-medium">
                              {formatCurrency(order.total_amount)}
                              {paymentStatus && <div className="text-xs font-normal text-muted-foreground">Pagamento {rawStatusLabel(paymentStatus)}</div>}
                              {order.shipment_cost != null && <div className="text-xs font-normal text-muted-foreground">Frete {formatCurrency(order.shipment_cost)}</div>}
                            </div>
                          </div>
                        </AccordionTrigger>

                        <AccordionContent className="px-4 pb-4 data-[state=closed]:duration-300 data-[state=open]:duration-300">
                          <div className="animate-in fade-in-0 slide-in-from-top-1 duration-300 ease-out">
                            <div className="flex flex-col gap-4 border-t pt-4 lg:flex-row lg:items-start lg:justify-between">
                            <div>
                              <div className={operationalState.tone === "danger" ? "font-semibold text-red-600" : "font-semibold"}>
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
                                  if (orderHasActiveClaim || isRefundedOrder(order)) setSelectedOrderDetails(order);
                                  else if (canPrintShipmentLabel) openShipmentLabel(vendaId);
                                  else if (order.ml_shipment_id) setSelectedOrderDetails(order);
                                  else syncOrders();
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
                                  <DropdownMenuItem onClick={loadClaims} disabled={loadingClaims || !connected}>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Atualizar reclamações
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => refundOrder(order)} disabled={!refundablePayment || refundingOrder}>
                                    {refundingOrder ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                    Reembolsar pagamento
                                  </DropdownMenuItem>
                                  <DropdownMenuItem disabled>
                                    NF-e
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
                            <div className="text-sm font-medium">{formatCurrency(order.total_amount)}</div>
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

                  {!loadingOrdersView && orders.length === 0 && (
                    <div className="rounded-lg border bg-background py-16 text-center text-muted-foreground">
                      Nenhum pedido importado.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="atendimento" className="mt-6">
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

            <TabsContent value="logs" className="mt-6">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ClipboardList className="h-4 w-4" />
                    Eventos recebidos
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{notifications.length}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    Com erro
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{notificationErrors}</div>
                </div>
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCcw className="h-4 w-4" />
                    Última atualização
                  </div>
                  <div className="mt-1 text-sm font-medium">{formatDate(notifications[0]?.created_at)}</div>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tópico</TableHead>
                      <TableHead>Recurso</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Erro</TableHead>
                      <TableHead>Recebido em</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notifications.map((notification) => (
                      <TableRow key={notification.id}>
                        <TableCell className="font-medium">{notification.topic || "-"}</TableCell>
                        <TableCell className="max-w-[360px] truncate font-mono text-xs">{notification.resource || "-"}</TableCell>
                        <TableCell>{statusBadge(notification.status)}</TableCell>
                        <TableCell className="max-w-[320px] truncate text-xs text-muted-foreground">{notification.error || "-"}</TableCell>
                        <TableCell>{formatDate(notification.created_at)}</TableCell>
                      </TableRow>
                    ))}
                    {!loadingDashboard && notifications.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                          Nenhum log recebido.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

          </CardContent>
        </Card>
      </Tabs>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) setListingFieldErrors({});
        }}
      >
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-7xl">
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
                <TabsTrigger value="semelhantes" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                  Semelhantes
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
                    <Label>Título do anúncio</Label>
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
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Preço</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        R$
                      </span>
                      <Input
                        inputMode="numeric"
                        value={listingForm.price}
                        onChange={(event) => updateListingForm("price", formatCurrencyInput(event.target.value))}
                        disabled={creatingListing}
                        className={`${fieldClass("price")} pl-10`}
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
                      className={listingFieldClass}
                    />
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
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipo no Mercado Livre</Label>
                    <Select
                      value={listingForm.categoryVertical}
                      onValueChange={(value) => changeCategoryVertical(value as MarketplaceVertical)}
                      disabled={creatingListing}
                    >
                      <SelectTrigger className={listingSelectClass}>
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
                      <SelectTrigger className={listingSelectClass}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {listingTypeOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

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

              <TabsContent value="semelhantes" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1 space-y-2">
                    <Label>Pesquisar por título</Label>
                    <Input
                      value={listingForm.title}
                      onChange={(event) => updateListingForm("title", event.target.value)}
                      disabled={creatingListing || loadingSimilarProducts}
                      className={listingFieldClass}
                    />
                  </div>
                  <Button type="button" onClick={searchSimilarProducts} disabled={loadingSimilarProducts || listingForm.title.trim().length < 3}>
                    {loadingSimilarProducts ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Pesquisar
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {similarProducts.map((product) => (
                    <div key={product.id ?? product.permalink} className="overflow-hidden rounded-md border bg-background">
                      <div className="flex gap-3 p-3">
                        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-md border bg-muted">
                          {product.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={product.thumbnail} alt={product.title || "Anúncio semelhante"} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageIcon className="h-5 w-5" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="line-clamp-2 text-sm font-medium">{product.title || "Sem título"}</div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">{formatCurrency(product.price)}</span>
                            {product.condition && <span>{product.condition === "new" ? "Novo" : product.condition === "used" ? "Usado" : "Não especificado"}</span>}
                            {product.categoryId && <span className="font-mono">{product.categoryId}</span>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant="outline" className="h-8 bg-transparent" onClick={() => applySimilarProduct(product)}>
                              Usar dados
                            </Button>
                            {product.permalink && (
                              <Button asChild type="button" size="sm" variant="ghost" className="h-8">
                                <a href={product.permalink} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-4 w-4" />
                                  Abrir
                                </a>
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {similarProductsUnavailable && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-sm text-yellow-700 dark:text-yellow-300">
                    O Mercado Livre bloqueou a busca de anúncios semelhantes para esta aplicação/conta. Ainda é possível
                    criar o anúncio preenchendo categoria, atributos, preço e imagens manualmente.
                  </div>
                )}

                {!loadingSimilarProducts && !similarProductsUnavailable && similarProducts.length === 0 && (
                  <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                    Pesquise anúncios semelhantes para comparar título, preço, condição e categoria antes de publicar.
                  </div>
                )}
              </TabsContent>

              <TabsContent value="atributos" className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
                <div className={`rounded-md border bg-background p-3 text-sm ${listingFieldErrors.family ? "border-destructive bg-destructive/10" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium">Família do produto</div>
                    <span className="font-mono text-xs text-muted-foreground">{familyNamePreview.length}/60</span>
                  </div>
                  <Input
                    value={listingForm.familyName}
                    onChange={(event) => updateListingForm("familyName", event.target.value.slice(0, 60))}
                    disabled={creatingListing}
                    className={`mt-2 ${fieldClass("family")}`}
                    placeholder={buildListingFamilyName({ ...listingForm, familyName: "" }) || "Ex.: Wega WO-120"}
                  />
                  <div className="mt-2 text-xs text-muted-foreground">
                    Deixe vazio para gerar por Marca + Modelo + Número da peça. Valor enviado:{" "}
                    <span className="font-mono text-foreground">{familyNamePreview || "Não gerada"}</span>
                  </div>
                  {listingFieldErrors.family && <p className="mt-2 text-xs text-destructive">{listingFieldErrors.family}</p>}
                </div>

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
                              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {attribute.id}
                              </span>
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
                      disabled={creatingListing}
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
                        disabled={creatingListing}
                      >
                        <SelectTrigger className={fieldClass("shipping", listingSelectClass)}>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="drop_off">Agência Mercado Livre</SelectItem>
                          <SelectItem value="xd_drop_off">Coleta/Envio flexível</SelectItem>
                          <SelectItem value="fulfillment">Full</SelectItem>
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
                )}
                {listingForm.shippingMode === "custom" && (
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Valor do frete</Label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                        <Input
                          value={listingForm.customShippingCost}
                          onChange={(event) => updateListingForm("customShippingCost", formatCurrencyInput(event.target.value))}
                          disabled={creatingListing || listingForm.freeShipping}
                          className={`${fieldClass("shipping")} pl-10`}
                          inputMode="decimal"
                          placeholder="0,00"
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
                    <div className="text-xs text-muted-foreground">Produto</div>
                    <div className="font-medium">{listingForm.title || "-"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{listingForm.sku || "SKU não informado"}</div>
                  </div>
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
                    <div className="line-clamp-2 text-sm font-medium">{listingForm.title || "Título do anúncio"}</div>
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
                        {listingForm.listingTypeId === "gold_pro" ? "Premium" : listingForm.listingTypeId === "free" ? "Grátis" : "Clássico"}
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
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Editar anúncio Mercado Livre</DialogTitle>
            <DialogDescription>
              Atualize os dados principais do anúncio publicado e sincronize com o Mercado Livre.
            </DialogDescription>
          </DialogHeader>
          {loadingEditListing && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando dados atuais do Mercado Livre...
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label>Título do anúncio</Label>
                <Input
                  value={editForm.title}
                  onChange={(event) => updateEditForm("title", event.target.value)}
                  disabled={editingListing || loadingEditListing}
                  maxLength={60}
                  className={listingFieldClass}
                />
              </div>
              <div className="space-y-2">
                <Label>Código ML</Label>
                <Input value={editForm.itemId} disabled className={listingFieldClass} />
              </div>
              <div className="space-y-2">
                <Label>Preço</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
                  <Input
                    inputMode="numeric"
                    value={editForm.price}
                    onChange={(event) => updateEditForm("price", formatCurrencyInput(event.target.value))}
                    disabled={editingListing || loadingEditListing}
                    className={`${listingFieldClass} pl-10`}
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
                  disabled={editingListing || loadingEditListing}
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
                    <SelectItem value="me2">Mercado Envios</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Logística</Label>
                <Select
                  value={editForm.logisticType}
                  onValueChange={(value) => updateEditForm("logisticType", value)}
                  disabled={editingListing || loadingEditListing || editForm.shippingMode !== "me2"}
                >
                  <SelectTrigger className={listingSelectClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drop_off">Agência Mercado Livre</SelectItem>
                    <SelectItem value="xd_drop_off">Coleta/Envio flexível</SelectItem>
                    <SelectItem value="fulfillment">Full</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

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

            <div className="mt-4 grid gap-3 md:grid-cols-1">
              <label className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-3 text-sm">
                <Checkbox checked={editForm.freeShipping} onCheckedChange={(checked) => updateEditForm("freeShipping", checked === true)} disabled={editingListing || loadingEditListing} />
                Frete grátis
              </label>
            </div>

            <div className="mt-4 space-y-2">
              <Label>Descrição</Label>
              <Textarea
                value={editForm.description}
                onChange={(event) => updateEditForm("description", event.target.value)}
                disabled={editingListing || loadingEditListing}
                className={`min-h-32 ${listingFieldClass}`}
              />
            </div>

            <div className="mt-4 space-y-2">
              <Label>Imagens do anúncio</Label>
              <Textarea
                value={editForm.pictureUrl}
                onChange={(event) => updateEditForm("pictureUrl", event.target.value)}
                placeholder="Uma URL por linha"
                disabled={editingListing || loadingEditListing}
                className={`min-h-24 ${listingFieldClass}`}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background pt-4">
            <Button variant="outline" className="bg-transparent" onClick={() => setEditDialogOpen(false)} disabled={editingListing}>
              Cancelar
            </Button>
            <Button onClick={saveEditedListing} disabled={editingListing || loadingEditListing || !editForm.itemId}>
              {editingListing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Salvar alterações
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
                      <div>Modo: {selectedOrderDetails.shipping_mode || selectedOrderDetails.raw_shipment?.mode || "-"}</div>
                      <div>Logística: {selectedOrderDetails.logistic_type || "-"}</div>
                      <div>Rastreio: <span className="font-mono">{selectedOrderDetails.tracking_number || "-"}</span></div>
                      <div>Custo do frete: {selectedOrderDetails.shipment_cost != null ? formatCurrency(selectedOrderDetails.shipment_cost) : "-"}</div>
                      <div>Itens no envio: {Array.isArray(selectedOrderDetails.raw_shipment_items) ? selectedOrderDetails.raw_shipment_items.length : "-"}</div>
                      <div>Método: {selectedOrderDetails.tracking_method || selectedOrderDetails.raw_shipment?.tracking_method || "-"}</div>
                      <div>Atualizado em: {formatDate(selectedOrderDetails.shipment_updated_at)}</div>
                    </div>
                    {!isMercadoEnviosOrder(selectedOrderDetails) && (
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
                          Salvar e avisar comprador
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
                            {[payment.payment_method_id, payment.payment_type, payment.status_detail].filter(Boolean).join(" · ") || "Forma de pagamento não informada"}
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
                      {getOrderPaymentStatus(selectedOrderDetails) && <div>Status do pagamento: {rawStatusLabel(getOrderPaymentStatus(selectedOrderDetails))}.</div>}
                      {selectedOrderDetails.date_closed && <div>Encerrado em: {formatDate(selectedOrderDetails.date_closed)}.</div>}
                      <div>{getOrderCancellationHint(selectedOrderDetails)}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 bg-transparent"
                        onClick={() => refundOrder(selectedOrderDetails)}
                        disabled={!getRefundablePayment(selectedOrderDetails) || actionKey === `refund:${selectedOrderDetails.id}`}
                      >
                        {actionKey === `refund:${selectedOrderDetails.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                        Reembolsar pagamento
                      </Button>
                      <div className="text-xs">Disponível apenas quando houver pagamento aprovado e ainda não reembolsado.</div>
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <h3 className="text-sm font-semibold">Reclamações</h3>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      {selectedOrderClaims.map((claim) => (
                        <div key={claim.id} className="rounded-md border bg-muted/20 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground">{claim.title || "Reclamação Mercado Livre"}</span>
                            {claim.status ? statusBadge(claim.status) : null}
                          </div>
                          <div className="mt-1">{claim.reason || claim.error || "Detalhe da reclamação importado pelo webhook."}</div>
                          {claim.dueDate && <div className="mt-1 text-xs">Prazo: {formatDate(claim.dueDate)}</div>}
                          {claim.closedAt && <div className="mt-1 text-xs">Encerrada em: {formatDate(claim.closedAt)}</div>}
                          {claim.resolution && <div className="mt-1 text-xs">Resolução: {rawStatusLabel(claim.resolution)}</div>}
                          {Array.isArray(claim.availableActions) && claim.availableActions.length > 0 && (
                            <div className="mt-1 text-xs">
                              Ações disponíveis: {claim.availableActions.map((action: any) => rawStatusLabel(action?.action || action?.type || action?.name || action)).join(", ")}
                            </div>
                          )}
                        </div>
                      ))}
                      {selectedOrderClaims.length === 0 && (
                        <div>Nenhuma reclamação importada para este pedido até o momento.</div>
                      )}
                      <Button size="sm" variant="outline" className="mt-2 bg-transparent" onClick={loadClaims} disabled={loadingClaims}>
                        {loadingClaims ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                        Atualizar reclamações
                      </Button>
                    </div>
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
                      disabled={!selectedOrderDetails.venda_id || !isMercadoEnviosOrder(selectedOrderDetails)}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Abrir etiqueta
                    </Button>
                    <Button size="sm" variant="outline" className="bg-transparent" onClick={() => openMarketplaceChat(selectedOrderDetails.id)}>
                      <MessageCircle className="h-4 w-4" />
                      Abrir chat
                    </Button>
                  </div>
                </div>

                <details className="rounded-md border p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Dados técnicos</summary>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify({ order: selectedOrderDetails.raw_order, payments: selectedOrderDetails.raw_payments, shipment: selectedOrderDetails.raw_shipment, shipmentCosts: selectedOrderDetails.raw_shipment_costs, shipmentItems: selectedOrderDetails.raw_shipment_items }, null, 2)}
                  </pre>
                </details>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      <Button type="button" className="fixed bottom-5 right-5 z-40 h-12 rounded-full px-4 shadow-lg" onClick={() => openMarketplaceChat()} disabled={!connected}>
        <MessageCircle className="h-5 w-5" />
        Chat
        {unreadChatMessageCount > 0 && <Badge className="ml-1 bg-background text-foreground">{unreadChatMessageCount}</Badge>}
      </Button>

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent className="w-full gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b px-5 py-4">
            <SheetTitle>Chat Mercado Livre</SheetTitle>
            <SheetDescription>Conversas pós-venda vinculadas aos pedidos importados.</SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] overflow-hidden">
            <div className="border-r bg-muted/20">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">Pedidos</span>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => loadChatConversations()} disabled={loadingChat}>
                  {loadingChat ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                </Button>
              </div>
              <ScrollArea className="h-[calc(100vh-121px)]">
                <div className="space-y-1 p-2">
                  {chatConversations.map((conversation) => (
                    <button
                      key={conversation.orderDbId}
                      type="button"
                      onClick={() => setSelectedChatOrderId(conversation.orderDbId)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        selectedChatConversation?.orderDbId === conversation.orderDbId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                    >
                      <div className="truncate font-medium">Pedido {conversation.mlOrderId}</div>
                      <div className="truncate text-xs opacity-80">{conversation.title}</div>
                      <div className="mt-1 text-xs opacity-70">{conversation.messages.length} mensagem(ns)</div>
                    </button>
                  ))}
                  {!loadingChat && chatConversations.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">Nenhum pedido importado com conversa.</div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="border-b px-4 py-3">
                <div className="truncate text-sm font-semibold">
                  {selectedChatConversation ? `Pedido ${selectedChatConversation.mlOrderId}` : "Selecione um pedido"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {selectedChatConversation?.title || "As mensagens aparecem após importar a venda."}
                </div>
              </div>

              <ScrollArea className="h-[calc(100vh-185px)]">
                <div className="flex min-h-full flex-col justify-end space-y-3 p-4">
                  {selectedChatConversation?.error && (
                    <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm">{selectedChatConversation.error}</div>
                  )}
                  {selectedChatConversation?.messages.map((message) => (
                    <div key={message.id} className={`flex ${message.fromSeller ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${message.fromSeller ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <div>{message.text || "-"}</div>
                        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] opacity-70">
                          <span>{formatDate(message.dateCreated)}</span>
                          {message.fromSeller && (String(message.status ?? "").toLowerCase() === "read" ? <CheckCheck className="h-3 w-3" /> : <Check className="h-3 w-3" />)}
                        </div>
                      </div>
                    </div>
                  ))}
                  {selectedChatConversation && !selectedChatConversation.error && selectedChatConversation.messages.length === 0 && (
                    <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">Nenhuma mensagem nesta conversa.</div>
                  )}
                </div>
              </ScrollArea>

              <div className="border-t bg-background p-3">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={chatMessageText}
                    onChange={(event) => setChatMessageText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        sendChatMessage();
                      }
                    }}
                    placeholder="Digite uma mensagem para o comprador"
                    className="max-h-28 min-h-11 flex-1 resize-none py-2"
                    disabled={!selectedChatConversation || sendingChatMessage}
                  />
                  <Button className="h-11 w-11 shrink-0 p-0" onClick={sendChatMessage} disabled={!selectedChatConversation || !chatMessageText.trim() || sendingChatMessage}>
                    {sendingChatMessage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
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


