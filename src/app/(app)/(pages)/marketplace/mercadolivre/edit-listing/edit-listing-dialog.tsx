"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { toast } from "@/lib/toast";
import {
  getMercadoLivrePictureRequirement,
  mercadoLivrePictureRequirementMessage,
} from "@/lib/integrations/mercadolivre-listing-pictures";
import { isMercadoLivreListingTypeEnabled } from "@/lib/integrations/mercadolivre-listing-validation";
import type { ListingTypeOption, MlCategoryAttribute, ShippingQuote } from "../../marketplace-client";
import { ListingDialogContent } from "../listing-dialog-content";
import {
  AttributeCard,
  AttributeGroup,
  FormSection,
  listingFieldClass,
  ListingTypeCard,
  StepHeading,
} from "../listing-form-fields";
import { ListingMediaManager } from "../listing-media/listing-media-manager";
import { loadProductImageUrls } from "../listing-media/product-image-urls";
import { ListingStepper, type ListingStepDefinition } from "../listing-stepper";
import {
  BadgeDollarSign,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  ImageIcon,
  Loader2,
  Tags,
} from "lucide-react";

/**
 * Edição de um anúncio Mercado Livre já publicado. É o único diálogo de edição:
 * o cadastro do produto (estoque) e o módulo de marketplace (vendas) abrem este
 * mesmo componente, para que os dois nunca ofereçam campos diferentes.
 */

const listingSelectClass = listingFieldClass;

const DEFAULT_LISTING_TYPE_OPTIONS: ListingTypeOption[] = [
  { id: "gold_special", name: "Clássico" },
  { id: "gold_pro", name: "Premium" },
];

// Mudanças nesses campos alteram o frete; a simulação anterior deixa de valer.
const SHIPPING_QUOTE_FIELDS = new Set(["price", "listingTypeId", "condition", "logisticType", "freeShipping", "widthCm", "heightCm", "lengthCm", "weightGrams"]);

export type EditListingStep = "content" | "media" | "attributes" | "offer";

export const EDIT_LISTING_STEPS: ListingStepDefinition<EditListingStep>[] = [
  { value: "content", title: "Conteúdo do anúncio", short: "Conteúdo", description: "Textos e dados", icon: FileText },
  { value: "media", title: "Mídia do anúncio", short: "Mídia", description: "Mínimo de 3 fotos", icon: ImageIcon },
  { value: "attributes", title: "Categoria e características", short: "Categoria", description: "Classifique o item", icon: Tags },
  { value: "offer", title: "Oferta e envio", short: "Oferta", description: "Preço e logística", icon: BadgeDollarSign },
];

export type EditListingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId?: string | null;
  produtoId?: number | null;
  /** Produto do ERP; com `mercadolivre` (vínculo), também preenche título e família enquanto o anúncio carrega. */
  initialProduct?: any;
  onAfterSave?: () => void;
};

type EditForm = {
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
  attributes: Array<{ id?: string; name?: string; value_id?: string | null; value_name?: string | null }>;
};

const DEFAULT_CAPABILITIES = {
  title: true,
  price: true,
  stock: true,
  pictures: true,
  description: true,
  familyName: true,
};

function formatCurrencyInputFromNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
}

function parseCurrencyInput(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;
  const sanitized = String(value).replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const number = Number(sanitized);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function productImages(product: any): string[] {
  const urls: unknown[] = product?.imageUrls?.length ? product.imageUrls : product?.imgUrl ? [product.imgUrl] : [];
  return Array.from(new Set(urls.filter(Boolean).map(String)));
}

function fallbackEditForm(itemId: string, produtoId: string, product: any): EditForm {
  const link = product?.mercadolivre ?? null;
  return {
    itemId,
    produtoId,
    categoryId: "",
    listingTypeId: "",
    title: link?.title || product?.tituloMarketplace || product?.titulo || "",
    familyName: link?.family_name || "",
    userProductId: link?.user_product_id || "",
    userProductEnabled: Boolean(link?.user_product_enabled || link?.family_name || link?.user_product_id),
    price: formatCurrencyInputFromNumber(product?.precovenda),
    availableQuantity: String(Math.max(Number(product?.estoque ?? 0), 0)),
    condition: "new",
    description: product?.descricaoMarketplace || product?.descricao || "",
    videoUrl: "",
    pictureUrl: productImages(product).join("\n"),
    warranty: "",
    warrantyTime: "",
    shippingMode: "me2",
    logisticType: "",
    freeShipping: false,
    localPickup: false,
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    weightGrams: "",
    dynamicAttributes: {},
  };
}

export function shippingLogisticLabel(value?: string | null) {
  switch (value) {
    case "cross_docking": return "Coleta Mercado Envios";
    case "fulfillment": return "Mercado Envios Full";
    case "drop_off": return "Agência Mercado Livre";
    case "xd_drop_off": return "Agência ou Coleta";
    case "self_service": return "Mercado Envios Flex";
    case "not_specified": return "Padrão da conta";
    default: return value || "Não definida";
  }
}

export function shippingOriginLabel(address?: ShippingQuote["origin"]) {
  if (!address) return null;
  const location = [address.city, address.state].filter(Boolean).join("/");
  const digits = String(address.zipCode ?? "").replace(/\D/g, "");
  const maskedZip = digits.length === 8 ? `${digits.slice(0, 5)}-***` : digits;
  return [location || null, maskedZip ? `CEP ${maskedZip}` : null].filter(Boolean).join(" · ") || null;
}

export function rawStatusLabel(value?: string | null) {
  if (!value) return "Não informado";
  switch (String(value).toLowerCase()) {
    case "active": return "Ativo";
    case "paused": return "Pausado";
    case "closed": return "Finalizado";
    case "under_review": return "Em análise";
    case "inactive": return "Inativo";
    default: return String(value);
  }
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
  const options = Array.isArray(attribute?.values) ? attribute.values : [];
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
        <Button type="button" variant="outline" className={`${listingFieldClass} h-10 w-full justify-between px-3 font-normal`} disabled={disabled}>
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
            placeholder={`Buscar ou digitar ${attribute.name?.toLowerCase() || "característica"}`}
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
                    setQuery(option.name);
                    setOpen(false);
                  }}
                >
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function MercadoLivreEditListingDialog({
  open,
  onOpenChange,
  itemId,
  produtoId,
  initialProduct,
  onAfterSave,
}: EditListingDialogProps) {
  const [step, setStep] = useState<EditListingStep>("content");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [shippingModes, setShippingModes] = useState<string[]>([]);
  const [logisticOptions, setLogisticOptions] = useState<string[]>([]);
  const [categoryAttributes, setCategoryAttributes] = useState<MlCategoryAttribute[]>([]);
  const [familyMembers, setFamilyMembers] = useState<UserProductFamilyMember[]>([]);
  const [initialAttributes, setInitialAttributes] = useState<Record<string, string>>({});
  const [shippingQuote, setShippingQuote] = useState<ShippingQuote | null>(null);
  const [loadingShippingQuote, setLoadingShippingQuote] = useState(false);
  const [productImageUrls, setProductImageUrls] = useState<string[]>([]);
  const [listingTypeOptions, setListingTypeOptions] = useState<ListingTypeOption[]>(DEFAULT_LISTING_TYPE_OPTIONS);
  const [loadingListingTypes, setLoadingListingTypes] = useState(false);
  const [capabilities, setCapabilities] = useState(DEFAULT_CAPABILITIES);
  const [form, setForm] = useState<EditForm>(() =>
    fallbackEditForm(itemId || "", String(produtoId || initialProduct?.id || ""), initialProduct),
  );
  const [initialForm, setInitialForm] = useState<EditForm>(form);

  // O produto só semeia o formulário na abertura. Uma nova referência dele com o
  // diálogo aberto (o formulário do estoque re-renderiza) não pode recarregar o
  // anúncio e apagar o que o usuário já digitou.
  const initialProductRef = useRef(initialProduct);
  useEffect(() => {
    initialProductRef.current = initialProduct;
  }, [initialProduct]);

  useEffect(() => {
    if (!open || !itemId) return;

    let active = true;
    const initialProduct = initialProductRef.current;
    // Recomeça do zero a cada abertura: sem isso, um anúncio que falhasse ao
    // carregar mostraria os dados do último anúncio editado.
    const fallback = fallbackEditForm(itemId, String(produtoId || initialProduct?.id || ""), initialProduct);
    setForm(fallback);
    setInitialForm(fallback);
    setInitialAttributes({});
    setCategoryAttributes([]);
    setFamilyMembers([]);
    setShippingModes([]);
    setLogisticOptions([]);
    setShippingQuote(null);
    setListingTypeOptions(DEFAULT_LISTING_TYPE_OPTIONS);
    setCapabilities({ ...DEFAULT_CAPABILITIES, title: !fallback.userProductEnabled });
    setStep("content");
    setLoading(true);
    setProductImageUrls(productImages(initialProduct));

    // Vindo do cadastro de estoque, o produto só traz a capa; "Usar imagens do
    // produto" precisa da galeria inteira.
    const imageProductId = Number(produtoId || initialProduct?.id || 0);
    if (!Array.isArray(initialProduct?.imageUrls) && imageProductId > 0) {
      loadProductImageUrls(imageProductId, initialProduct?.imgUrl)
        .then((urls) => {
          if (active && urls.length) setProductImageUrls(urls);
        })
        .catch((error) => console.error("Falha ao carregar as imagens do produto:", error));
    }

    (async () => {
      try {
        const res = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(itemId)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Falha ao carregar dados do anúncio.");
        if (!active) return;

        const item = json.data ?? {};
        const categoryId = String(item.categoryId ?? "");
        const shippingMode = String(item.shippingMode || fallback.shippingMode);
        const logisticType = String(item.logisticType || fallback.logisticType);
        const dynamicAttributes = item.dynamicAttributes && typeof item.dynamicAttributes === "object" ? item.dynamicAttributes : {};

        const loadedForm: EditForm = {
          ...fallback,
          itemId: String(item.id || itemId),
          produtoId: fallback.produtoId || String(item.produtoId || ""),
          categoryId,
          listingTypeId: String(item.listingTypeId ?? ""),
          title: item.title || fallback.title,
          familyName: item.familyName || fallback.familyName,
          userProductId: item.userProductId || fallback.userProductId,
          userProductEnabled: Boolean(item.userProductEnabled),
          price: formatCurrencyInputFromNumber(item.price ?? initialProduct?.precovenda),
          availableQuantity: String(Math.max(Number(item.availableQuantity ?? initialProduct?.estoque ?? 0), 0)),
          condition: ["new", "used", "not_specified"].includes(String(item.condition)) ? item.condition : "new",
          description: item.description || fallback.description,
          videoUrl: item.videoUrl || "",
          pictureUrl: Array.isArray(item.pictures) ? item.pictures.join("\n") : "",
          warranty: item.warranty || "",
          warrantyTime: item.warrantyTime || "",
          shippingMode,
          logisticType,
          freeShipping: Boolean(item.freeShipping),
          localPickup: false,
          widthCm: item.widthCm || "",
          heightCm: item.heightCm || "",
          lengthCm: item.lengthCm || "",
          weightGrams: item.weightGrams || "",
          dynamicAttributes,
        };

        setForm(item.productPackage?{
          ...loadedForm,
          widthCm:item.productPackage.widthCm,
          heightCm:item.productPackage.heightCm,
          lengthCm:item.productPackage.lengthCm,
          weightGrams:item.productPackage.weightGrams,
        }:loadedForm);
        setInitialForm(loadedForm);
        setInitialAttributes(dynamicAttributes);
        setCapabilities((curr) => ({ ...curr, ...(item.capabilities ?? {}) }));
        setFamilyMembers(
          (Array.isArray(item.familyMembers) ? item.familyMembers : []).map((member: any) => ({
            id: String(member?.id ?? ""),
            name: String(member?.name ?? ""),
            attributes: Array.isArray(member?.attributes) ? member.attributes : [],
          })),
        );
        if (!getMercadoLivrePictureRequirement(loadedForm.pictureUrl).valid) setStep("media");

        if (!categoryId) return;
        // A mesma consulta traz os atributos da categoria e as opções de envio
        // que conta e categoria aceitam. O modo e a logística atuais ficam na
        // lista mesmo quando não aparecem nela, para o anúncio não perder o valor.
        const attrRes = await fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, { cache: "no-store" });
        const attrJson = await attrRes.json().catch(() => ({}));
        if (!active) return;
        const modes: string[] = Array.isArray(attrJson.settings?.shippingOptions) ? attrJson.settings.shippingOptions.filter(Boolean).map(String) : [];
        const logistics: string[] = Array.isArray(attrJson.settings?.logisticOptions) ? attrJson.settings.logisticOptions.filter(Boolean).map(String) : [];
        setShippingModes(Array.from(new Set([shippingMode, ...modes].filter(Boolean))));
        setLogisticOptions(Array.from(new Set([logisticType, ...logistics].filter(Boolean))));
        if (!attrRes.ok) throw new Error(attrJson?.error || "Falha ao carregar atributos e opções de envio da categoria.");
        setCategoryAttributes(Array.isArray(attrJson.data) ? attrJson.data : []);
      } catch (err) {
        if (!active) return;
        toast.error("Não foi possível carregar os detalhes do anúncio", {
          description: err instanceof Error ? err.message : "Falha na comunicação com o Mercado Livre.",
        });
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [open, itemId, produtoId]);

  // Taxas e disponibilidade de Clássico/Premium dependem da categoria e do preço,
  // então a consulta acompanha o valor digitado com um pequeno atraso.
  const listingOptionsPrice = parseCurrencyInput(form.price);
  useEffect(() => {
    if (!open || !form.categoryId) return;

    let active = true;
    const timer = setTimeout(() => {
      setLoadingListingTypes(true);
      const params = new URLSearchParams({ categoryId: form.categoryId });
      if (listingOptionsPrice > 0) params.set("price", String(listingOptionsPrice));
      if (form.shippingMode) params.set("shippingMode", form.shippingMode);
      if (form.logisticType) params.set("logisticType", form.logisticType);
      fetch(`/api/integracoes/mercadolivre/listing-options?${params.toString()}`, { cache: "no-store" })
        .then(async (res) => {
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json?.error || "Falha ao consultar os tipos de anúncio.");
          if (!active || !Array.isArray(json.listingTypes)) return;
          const enabled = (json.listingTypes as ListingTypeOption[]).filter((option) => isMercadoLivreListingTypeEnabled(option.id));
          if (enabled.length) setListingTypeOptions(enabled);
        })
        .catch((error) => console.error("Falha ao consultar os tipos de anúncio:", error))
        .finally(() => {
          if (active) setLoadingListingTypes(false);
        });
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, form.categoryId, listingOptionsPrice, form.shippingMode, form.logisticType]);

  function updateForm<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    if (SHIPPING_QUOTE_FIELDS.has(String(key))) setShippingQuote(null);
    setForm((curr) => ({ ...curr, [key]: value }));
  }

  function updateDynamicAttribute(attrId: string, value: string) {
    setForm((curr) => ({
      ...curr,
      dynamicAttributes: {
        ...curr.dynamicAttributes,
        [attrId]: value,
      },
    }));
  }

  async function simulateShipping() {
    setLoadingShippingQuote(true);
    setShippingQuote(null);
    try {
      const res = await fetch("/api/integracoes/mercadolivre/shipping-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemPrice: parseCurrencyInput(form.price),
          categoryId: form.categoryId,
          listingTypeId: form.listingTypeId,
          condition: form.condition,
          logisticType: form.logisticType,
          freeShipping: form.freeShipping,
          lengthCm: Number(form.lengthCm.replace(",", ".")),
          widthCm: Number(form.widthCm.replace(",", ".")),
          heightCm: Number(form.heightCm.replace(",", ".")),
          weightGrams: Number(form.weightGrams),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao simular frete.");
      setShippingQuote(json.data ?? null);
    } catch (err: any) {
      toast.error("Erro ao simular Mercado Envios", { description: err?.message || "Falha ao consultar frete." });
    } finally {
      setLoadingShippingQuote(false);
    }
  }

  async function handleSave() {
    if (!form.itemId) return;
    const pictureRequirement = getMercadoLivrePictureRequirement(form.pictureUrl);
    if (!pictureRequirement.valid) {
      setStep("media");
      toast.error("Complete as fotos do anúncio", {
        description: mercadoLivrePictureRequirementMessage(pictureRequirement.count),
      });
      return;
    }
    const titleField = form.userProductEnabled ? "familyName" : "title";
    if (!form[titleField]?.trim()) {
      toast.error("Informe o título do anúncio.");
      return;
    }
    if (parseCurrencyInput(form.price) <= 0) {
      toast.error("Informe um preço válido para o anúncio.");
      return;
    }
    if (Number(form.availableQuantity) < 0) {
      toast.error("Informe uma quantidade válida.");
      return;
    }

    setSaving(true);
    try {
      const changedAttributes = Object.fromEntries(
        Object.entries(form.dynamicAttributes).filter(([key, val]) => val !== initialAttributes[key])
      );
      for (const attr of categoryAttributes) {
        if (attr.valueType !== "number_unit" || !(attr.id in changedAttributes)) continue;
        const unitKey = `${attr.id}__unit`;
        changedAttributes[unitKey] = form.dynamicAttributes[unitKey] || attr.defaultUnit || attr.allowedUnits[0]?.id || "";
      }

      const initial = initialForm;
      const changes: Record<string, unknown> = {};
      const addTextChange = (key: keyof EditForm, val: string) => {
        if (String(initial[key] ?? "").trim() !== val.trim()) changes[key] = val;
      };

      addTextChange("title", form.title);
      addTextChange("familyName", form.familyName);
      addTextChange("description", form.description);
      addTextChange("videoUrl", form.videoUrl);
      addTextChange("pictureUrl", form.pictureUrl);
      addTextChange("warranty", form.warranty);
      addTextChange("warrantyTime", form.warrantyTime);
      addTextChange("shippingMode", form.shippingMode === "me2" ? "me2" : "");
      addTextChange("logisticType", form.logisticType);

      const price = parseCurrencyInput(form.price);
      if (Math.abs(price - parseCurrencyInput(initial.price)) >= 0.01) changes.price = price;
      const qty = Number(form.availableQuantity);
      if (qty !== Number(initial.availableQuantity)) changes.availableQuantity = qty;
      if (form.freeShipping !== initial.freeShipping) changes.freeShipping = form.freeShipping;
      if (form.listingTypeId && form.listingTypeId !== initial.listingTypeId) changes.listingTypeId = form.listingTypeId;

      for (const dim of ["widthCm", "heightCm", "lengthCm"] as const) {
        const val = Number(form[dim].replace(",", "."));
        const initVal = Number(initial[dim]?.replace(",", "."));
        if (val !== initVal) changes[dim] = val;
      }
      const weight = Number(form.weightGrams);
      if (weight !== Number(initial.weightGrams)) changes.weightGrams = weight;

      if (["warranty", "warrantyTime"].some((k) => k in changes)) {
        changes.warranty = form.warranty;
        changes.warrantyTime = form.warrantyTime;
      }

      if (["shippingMode", "logisticType", "freeShipping", "widthCm", "heightCm", "lengthCm", "weightGrams"].some((k) => k in changes)) {
        changes.shippingMode = form.shippingMode === "me2" ? "me2" : "";
        changes.logisticType = form.logisticType;
        changes.freeShipping = form.freeShipping;
        changes.localPickup = false;
        changes.widthCm = Number(form.widthCm.replace(",", "."));
        changes.heightCm = Number(form.heightCm.replace(",", "."));
        changes.lengthCm = Number(form.lengthCm.replace(",", "."));
        changes.weightGrams = Number(form.weightGrams);
      }

      if (Object.keys(changedAttributes).length) {
        changes.attributes = changedAttributes;
        changes.attributeDefinitions = categoryAttributes;
      }

      if (!Object.keys(changes).length) {
        toast.info("Nenhuma alteração detectada para enviar ao Mercado Livre.");
        return;
      }

      const res = await fetch(`/api/integracoes/mercadolivre/items/${encodeURIComponent(form.itemId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_listing",
          changes,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao salvar alterações no anúncio.");

      const divergent = Array.isArray(json?.confirmations)
        ? json.confirmations.filter((r: any) => r?.status === "DIVERGENTE")
        : [];

      if (divergent.length) {
        toast.warning("O Mercado Livre aplicou apenas parte das alterações.", {
          description: `Não foi possível confirmar: ${divergent.map((r: any) => r.field).join(", ")}.`,
        });
      } else {
        toast.success("Anúncio atualizado com sucesso no Mercado Livre!");
        onOpenChange(false);
      }
      // Mesmo parcial, parte da edição entrou: a tela de origem precisa recarregar.
      onAfterSave?.();
    } catch (err: any) {
      toast.error("Erro ao salvar anúncio", {
        description: err instanceof Error ? err.message : "Falha na comunicação com o Mercado Livre.",
      });
    } finally {
      setSaving(false);
    }
  }

  const editTitleField = form.userProductEnabled ? "familyName" : "title";
  const editTitleMaxLength = form.userProductEnabled ? 120 : 60;
  const editTitleEditable = form.userProductEnabled ? capabilities.familyName : capabilities.title;
  const pictureRequirement = useMemo(() => getMercadoLivrePictureRequirement(form.pictureUrl), [form.pictureUrl]);
  const pictureIssue = pictureRequirement.valid ? "" : mercadoLivrePictureRequirementMessage(pictureRequirement.count);
  const stepValidity: Record<EditListingStep, boolean> = {
    content: true,
    media: pictureRequirement.valid,
    attributes: true,
    offer: true,
  };
  const issueCountByStep: Partial<Record<EditListingStep, number>> = {
    media: pictureRequirement.valid ? 0 : 1,
  };
  const mediaDisabledReason = capabilities.pictures
    ? null
    : pictureRequirement.valid
      ? "As imagens deste anúncio são controladas pelo catálogo do Mercado Livre."
      : `As imagens são controladas pelo catálogo e este anúncio tem ${pictureRequirement.count} de 3 fotos. Corrija as fotos diretamente no Mercado Livre; o salvamento pelo ERP permanecerá bloqueado até atender ao mínimo.`;
  const restrictions = [
    !capabilities.price && "preço com automação ativa",
    !capabilities.stock && "estoque administrado pela logística Full/multiorigem",
    !editTitleEditable && "título controlado pelo catálogo/família",
    !capabilities.pictures && "imagens controladas pelo catálogo",
  ].filter(Boolean);
  const originLabel = shippingOriginLabel(shippingQuote?.origin);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ListingDialogContent
        mode="edit"
        stepCount={EDIT_LISTING_STEPS.length}
        notice={restrictions.length ? `Alguns campos estão bloqueados pelas regras do Mercado Livre: ${restrictions.join("; ")}.` : undefined}
      >
        {loading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/95 backdrop-blur-sm">
            <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
            <span className="text-sm font-medium text-primary">Carregando dados do anúncio no Mercado Livre...</span>
          </div>
        )}

        <ListingStepper
          steps={EDIT_LISTING_STEPS}
          step={step}
          onStepChange={setStep}
          stepValidity={stepValidity}
          issueCountByStep={issueCountByStep}
          footerNote={<p className={`mr-auto text-left text-xs ${pictureIssue ? "text-destructive" : "text-muted-foreground"}`}>{pictureIssue || "As alterações são enviadas ao Mercado Livre apenas quando você salva."}</p>}
          footerActions={
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancelar
              </Button>
              {step !== EDIT_LISTING_STEPS[0].value ? (
                <Button
                  variant="outline"
                  onClick={() => setStep(EDIT_LISTING_STEPS[EDIT_LISTING_STEPS.findIndex((i) => i.value === step) - 1].value)}
                  disabled={saving || loading}
                >
                  <ChevronLeft className="h-4 w-4" /> Voltar
                </Button>
              ) : null}
              {step !== EDIT_LISTING_STEPS[EDIT_LISTING_STEPS.length - 1].value ? (
                <Button
                  onClick={() => setStep(EDIT_LISTING_STEPS[EDIT_LISTING_STEPS.findIndex((i) => i.value === step) + 1].value)}
                  disabled={saving || loading}
                >
                  Avançar <ChevronRight className="h-4 w-4" />
                </Button>
              ) : null}
              <Button onClick={handleSave} disabled={saving || loading || !form.itemId || !pictureRequirement.valid}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Salvar alterações
              </Button>
            </>
          }
        >
          {/* ETAPA 1: CONTEÚDO */}
          <TabsContent value="content" className="m-0 space-y-5">
            <StepHeading number="1" title="Conteúdo do anúncio" description="Ajuste os dados comerciais do anúncio já publicado no Mercado Livre." />
            <FormSection title="Dados do anúncio">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-dialog-title">Título do anúncio</Label>
                  <span className="text-xs text-muted-foreground">
                    {(form[editTitleField] || "").length}/{editTitleMaxLength}
                  </span>
                </div>
                <Input
                  id="edit-dialog-title"
                  value={form[editTitleField]}
                  onChange={(e) => updateForm(editTitleField, e.target.value.slice(0, editTitleMaxLength))}
                  disabled={saving || loading || !editTitleEditable}
                  maxLength={editTitleMaxLength}
                  className={listingFieldClass}
                />
              </div>

              <div className="space-y-2">
                <Label>Descrição</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => updateForm("description", e.target.value)}
                  disabled={saving || loading || !capabilities.description}
                  rows={7}
                  className={listingFieldClass}
                />
              </div>
            </FormSection>

            <FormSection title="Garantia">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipo de garantia</Label>
                  <Select
                    value={form.warranty || "none"}
                    onValueChange={(val) => {
                      updateForm("warranty", val === "none" ? "" : val);
                      if (val === "Sem garantia") updateForm("warrantyTime", "");
                    }}
                    disabled={saving || loading}
                  >
                    <SelectTrigger className={listingSelectClass}><SelectValue /></SelectTrigger>
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
                    value={form.warrantyTime || "none"}
                    onValueChange={(val) => updateForm("warrantyTime", val === "none" ? "" : val)}
                    disabled={saving || loading || form.warranty === "Sem garantia"}
                  >
                    <SelectTrigger className={listingSelectClass}><SelectValue /></SelectTrigger>
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
              </div>
            </FormSection>

            <FormSection title="Identificação do anúncio">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Categoria Mercado Livre</Label>
                  <Input value={form.categoryId} disabled className={listingFieldClass} />
                  {/* O Mercado Livre não aceita category_id em PUT /items para anúncios
                      de marketplace; trocar de categoria exige publicar de novo. */}
                  <p className="text-xs text-muted-foreground">
                    A categoria não pode ser alterada em um anúncio publicado. Para mudar, finalize este anúncio e publique o produto na categoria correta.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Código do anúncio</Label>
                  <Input value={form.itemId} disabled className={listingFieldClass} />
                </div>
                {form.userProductEnabled && (
                  <div className="space-y-2">
                    <Label>Identificador do produto no Mercado Livre</Label>
                    <Input value={form.userProductId || "Gerado pelo Mercado Livre"} disabled className={listingFieldClass} />
                  </div>
                )}
              </div>
            </FormSection>
          </TabsContent>

          {/* ETAPA 2: MÍDIA */}
          <TabsContent value="media" className="m-0 space-y-5">
            <StepHeading number="2" title="Mídia do anúncio" description="Adicione pelo menos 3 fotos, organize a ordem e escolha a capa do anúncio." />
            <div className="space-y-2">
              <ListingMediaManager
                value={form.pictureUrl}
                onChange={(val) => updateForm("pictureUrl", val)}
                productImageUrls={productImageUrls}
                disabled={saving || loading || !capabilities.pictures}
                disabledReason={mediaDisabledReason}
              />
            </div>
            <div className="space-y-2">
              <Label>Vídeo do anúncio (YouTube)</Label>
              <Input
                value={form.videoUrl}
                onChange={(e) => updateForm("videoUrl", e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                disabled={saving || loading}
                className={listingFieldClass}
              />
              <p className="text-xs text-muted-foreground">
                Use uma URL pública do YouTube ou o código de 11 caracteres do vídeo. A disponibilidade final depende da categoria e das regras do anúncio.
              </p>
            </div>
          </TabsContent>

          {/* ETAPA 3: ATRIBUTOS */}
          <TabsContent value="attributes" className="m-0 space-y-5">
            <StepHeading number="3" title="Categoria e características" description="Ficha técnica, atributos exigidos pela categoria e variações da família." />
            {[true, false].map((required) => {
              const attrs = categoryAttributes.filter((a) => a.required === required);
              if (!attrs.length) return null;
              return (
                <AttributeGroup key={String(required)} title={required ? "Obrigatórios" : "Opcionais"} count={attrs.length}>
                  {attrs.map((attribute) => {
                    const value = form.dynamicAttributes[attribute.id] ?? "";
                    const disabledAttr = saving || loading || (attribute.fixed && Boolean(value));
                    return (
                      <AttributeCard key={attribute.id} {...attribute}>
                        {attribute.values?.length > 0 ? (
                          <ControlledAttributeInput
                            attribute={attribute}
                            value={value}
                            disabled={disabledAttr}
                            onChange={(nextVal) => updateDynamicAttribute(attribute.id, nextVal)}
                          />
                        ) : attribute.valueType === "boolean" ? (
                          <Select value={value} onValueChange={(nextVal) => updateDynamicAttribute(attribute.id, nextVal)} disabled={disabledAttr}>
                            <SelectTrigger className={listingSelectClass}>
                              <SelectValue placeholder="Selecione" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Sim</SelectItem>
                              <SelectItem value="false">Não</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : attribute.valueType === "number_unit" ? (
                          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
                            <Input
                              type="number"
                              value={value}
                              onChange={(e) => updateDynamicAttribute(attribute.id, e.target.value)}
                              disabled={disabledAttr}
                              className={listingFieldClass}
                            />
                            <Select
                              value={form.dynamicAttributes[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits?.[0]?.id || attribute.allowedUnits?.[0]?.name || ""}
                              onValueChange={(nextVal) => updateDynamicAttribute(`${attribute.id}__unit`, nextVal)}
                              disabled={disabledAttr || !attribute.allowedUnits?.length}
                            >
                              <SelectTrigger className={listingSelectClass}>
                                <SelectValue placeholder="Un." />
                              </SelectTrigger>
                              <SelectContent>
                                {(attribute.allowedUnits?.length ? attribute.allowedUnits : [{ id: attribute.defaultUnit ?? "", name: attribute.defaultUnit ?? "Un." }]).map((unit) => (
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
                            onChange={(e) => updateDynamicAttribute(attribute.id, e.target.value)}
                            disabled={disabledAttr}
                            className={listingFieldClass}
                          />
                        )}
                      </AttributeCard>
                    );
                  })}
                </AttributeGroup>
              );
            })}

            {categoryAttributes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Esta categoria não retornou atributos editáveis.</p>
            ) : null}

            {form.userProductEnabled && familyMembers.length > 0 && (
              <section className="mt-4 space-y-3 border-t pt-4">
                <div>
                  <h3 className="text-sm font-medium">Variações da família</h3>
                  <p className="text-xs text-muted-foreground">
                    Cada variação é um anúncio independente ligado à mesma família do Mercado Livre.
                  </p>
                </div>
                <div className="divide-y rounded-md border">
                  {familyMembers.map((member) => (
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
                      <Badge variant={member.id === form.userProductId ? "default" : "outline"} className="shrink-0">
                        {member.id === form.userProductId ? "Atual" : member.id}
                      </Badge>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </TabsContent>

          {/* ETAPA 4: OFERTA E ENVIO */}
          <TabsContent value="offer" className="m-0 space-y-5">
            <StepHeading number="4" title="Oferta e envio" description="Preço exclusivo do anúncio, tipo de anúncio, estoque e condições de frete." />
            <FormSection title="Preço e estoque">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Valor do anúncio no ML</Label>
                  <ValueInput
                    value={parseCurrencyInput(form.price)}
                    onValueChange={(val) => updateForm("price", formatCurrencyInputFromNumber(val))}
                    disabled={saving || loading || !capabilities.price}
                    className={listingFieldClass}
                  />
                  <p className="text-[11px] text-muted-foreground">Exclusivo do anúncio (não altera o ERP).</p>
                </div>
                <div className="space-y-2">
                  <Label>Estoque disponível</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.availableQuantity}
                    onChange={(e) => updateForm("availableQuantity", e.target.value)}
                    disabled={saving || loading || !capabilities.stock}
                    className={listingFieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Condição</Label>
                  <Select value={form.condition} disabled>
                    <SelectTrigger className={listingSelectClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">Novo</SelectItem>
                      <SelectItem value="used">Usado</SelectItem>
                      <SelectItem value="not_specified">Não especificado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </FormSection>

            <FormSection
              title="Tipo de anúncio"
              description="A troca vale para o anúncio já publicado e muda a tarifa cobrada nas próximas vendas."
            >
              {loadingListingTypes ? (
                <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando condições comerciais no Mercado Livre...
                </p>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {listingTypeOptions.map((option) => {
                  // O tipo atual continua selecionável mesmo que a conta não possa
                  // mais publicá-lo: é só o ponto de partida da troca.
                  const unavailable = option.available === false && option.id !== initialForm.listingTypeId;
                  return (
                    <ListingTypeCard
                      key={option.id}
                      option={option}
                      selected={option.id === form.listingTypeId}
                      disabled={saving || loading || unavailable}
                      unavailable={unavailable}
                      onSelect={() => updateForm("listingTypeId", option.id)}
                    />
                  );
                })}
              </div>
              {initialForm.listingTypeId && form.listingTypeId !== initialForm.listingTypeId ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  Atual: <strong className="text-foreground">{listingTypeOptions.find((option) => option.id === initialForm.listingTypeId)?.name || initialForm.listingTypeId}</strong>. A troca é enviada ao Mercado Livre quando você salvar.
                </p>
              ) : null}
            </FormSection>

            <FormSection title="Envio e Logística">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Modo de envio</Label>
                  <Select value={form.shippingMode} onValueChange={(val) => updateForm("shippingMode", val)} disabled={saving || loading}>
                    <SelectTrigger className={listingSelectClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {shippingModes.map((mode) => (
                        <SelectItem key={mode} value={mode} disabled={mode !== "me2" && mode !== form.shippingMode}>
                          {mode === "me2" ? "Mercado Envios" : mode === "custom" ? "Envio personalizado atual" : rawStatusLabel(mode)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Logística</Label>
                  <Select
                    value={form.logisticType}
                    onValueChange={(val) => updateForm("logisticType", val)}
                    disabled={saving || loading || form.shippingMode !== "me2" || !logisticOptions.length}
                  >
                    <SelectTrigger className={listingSelectClass}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {logisticOptions.map((opt) => (
                        <SelectItem key={opt} value={opt}>{shippingLogisticLabel(opt)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </FormSection>

            <FormSection title="Embalagem" description="Informe as medidas reais do pacote em centímetros e gramas.">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="space-y-2">
                  <Label>Comprimento (cm)</Label>
                  <Input inputMode="decimal" value={form.lengthCm} onChange={(e) => updateForm("lengthCm", e.target.value)} disabled={saving || loading} className={listingFieldClass} />
                </div>
                <div className="space-y-2">
                  <Label>Largura (cm)</Label>
                  <Input inputMode="decimal" value={form.widthCm} onChange={(e) => updateForm("widthCm", e.target.value)} disabled={saving || loading} className={listingFieldClass} />
                </div>
                <div className="space-y-2">
                  <Label>Altura (cm)</Label>
                  <Input inputMode="decimal" value={form.heightCm} onChange={(e) => updateForm("heightCm", e.target.value)} disabled={saving || loading} className={listingFieldClass} />
                </div>
                <div className="space-y-2">
                  <Label>Peso (g)</Label>
                  <Input inputMode="numeric" value={form.weightGrams} onChange={(e) => updateForm("weightGrams", e.target.value.replace(/\D/g, ""))} disabled={saving || loading} className={listingFieldClass} />
                </div>
              </div>
            </FormSection>

            <FormSection title="Frete Grátis">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-3 text-sm cursor-pointer">
                  <Checkbox checked={form.freeShipping} onCheckedChange={(checked) => updateForm("freeShipping", checked === true)} disabled={saving || loading} />
                  <span>
                    <strong>Oferecer frete grátis</strong>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">O comprador não paga; o Mercado Livre calcula a parcela assumida pelo vendedor.</span>
                  </span>
                </label>
                <Button type="button" variant="outline" size="sm" onClick={simulateShipping} disabled={saving || loading || loadingShippingQuote || form.shippingMode !== "me2"}>
                  {loadingShippingQuote ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                  Simular custo
                </Button>
              </div>
              {shippingQuote ? (
                <div className="mt-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Custo estimado do vendedor: <strong className="text-foreground">{shippingQuote.sellerShippingCost != null ? formatCurrency(shippingQuote.sellerShippingCost) : "não informado pelo Mercado Livre"}</strong>
                  {shippingQuote.listCostBeforeDiscount != null ? ` · tarifa cheia ${formatCurrency(shippingQuote.listCostBeforeDiscount)}` : ""}
                  {shippingQuote.billableWeight != null ? ` · peso tarifado ${shippingQuote.billableWeight} g` : ""}
                  {originLabel ? ` · origem ${originLabel}` : ""}
                </div>
              ) : null}
            </FormSection>
          </TabsContent>
        </ListingStepper>
      </ListingDialogContent>
    </Dialog>
  );
}
