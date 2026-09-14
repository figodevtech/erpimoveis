"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import type { Produto } from "../../../estoque/types";
import {
  MercadoLivreCreateListingDialog,
  type CreateListingIssue,
  type CreateListingStep,
} from "./create-listing-dialog";
import {
  EMPTY_LISTING_VALIDATION,
  EMPTY_MERCADO_ENVIOS,
  type CategoryOption,
  type FreeShippingPolicy,
  type ListingCommercialInfo,
  type ListingForm,
  type ListingTypeOption,
  type ListingValidation,
  type ListingValidationState,
  type MarketplaceVertical,
  type MercadoEnviosLogistic,
  type MercadoEnviosQuoteScenario,
  type MercadoEnviosState,
  type MlCategoryAttribute,
  type ProductRow,
  type ShippingEligibility,
} from "../../marketplace-client";
import {
  disabledMercadoLivreListingTypeMessage,
  isMercadoLivreListingTypeEnabled,
} from "@/lib/integrations/mercadolivre-listing-validation";
import {
  getMercadoLivrePictureRequirement,
  mercadoLivrePictureRequirementMessage,
} from "@/lib/integrations/mercadolivre-listing-pictures";
import { preferencesAllowShippingMode } from "@/lib/integrations/mercadolivre-mercado-envios";
import { shippingLogisticLabel } from "../edit-listing/edit-listing-dialog";

export type MercadoLivrePublishProductDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  produto: Produto | ProductRow | null;
  onAfterPublish?: () => void;
};

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

function initialDynamicAttributesFromProduct(product?: ProductRow | null) {
  return {
    BRAND: product?.fabricante ?? "",
    MODEL: product?.modelo ?? "",
    PART_NUMBER: product?.referencia ?? "",
    GTIN: normalizeGtin(product?.codigobarras),
  };
}

function getListingAttributeValue(
  form: Pick<ListingForm, "brand" | "model" | "partNumber" | "gtin" | "dynamicAttributes">,
  id: string,
) {
  const attrId = id.toUpperCase();
  const dynamicValue = (form.dynamicAttributes[attrId] ?? "").trim();
  if (dynamicValue) return dynamicValue;
  if (attrId === "BRAND") return form.brand.trim();
  if (attrId === "MODEL") return form.model.trim();
  if (attrId === "PART_NUMBER") return form.partNumber.trim();
  if (attrId === "GTIN") return form.gtin.trim();
  return "";
}

function buildListingFamilyName(
  form: Pick<ListingForm, "title" | "brand" | "model" | "partNumber" | "dynamicAttributes" | "gtin">,
) {
  const title = form.title.replace(/\s+/g, " ").trim();
  if (title) return title.slice(0, 60);

  const value = [getListingAttributeValue(form, "BRAND"), getListingAttributeValue(form, "MODEL"), getListingAttributeValue(form, "PART_NUMBER")]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");

  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

function listingErrorStep(errors: Record<string, string>): CreateListingStep {
  if (errors.product) return "product";
  if (errors.images) return "media";
  if (errors.title || errors.family || errors.gtin || errors["attr:GTIN"]) return "content";
  if (errors.category || Object.keys(errors).some((key) => key.startsWith("attr:"))) return "category";
  if (errors.listingType || errors.condition || errors.warranty || errors.price || errors.stock || errors.shipping || errors.dimensions) return "offer";
  return "review";
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
  if (normalized.includes("estoque") || normalized.includes("stock")) {
    errors.stock = message;
  }
  if (normalized.includes("condição") || normalized.includes("condition")) {
    errors.condition = message;
  }
  if (normalized.includes("garantia") || normalized.includes("warranty")) {
    errors.warranty = message;
  }
  if (normalized.includes("produto") && normalized.includes("vinculad")) {
    errors.product = message;
  }
  return errors;
}

function createInitialListingForm(product?: ProductRow | null): ListingForm {
  return {
    produtoId: product ? String(product.id) : "",
    title: product?.tituloMarketplace || product?.titulo || "",
    categoryId: "",
    categoryName: "",
    categoryPath: "",
    categoryShippingOptions: [],
    categoryVertical: "products",
    price: product ? formatCurrencyInputFromNumber(product.precovenda) : "",
    availableQuantity: product ? String(Math.max(Number(product.estoque ?? 0), 0)) : "",
    condition: mapConditionFromProduct(product?.conservacao),
    listingTypeId: "gold_special",
    description: product?.descricaoMarketplace || product?.descricao || "",
    pictureUrl: (product?.imageUrls?.length ? product.imageUrls : product?.imgUrl ? [product.imgUrl] : []).join("\n"),
    sku: product?.referencia || "",
    brand: product?.fabricante || "",
    model: product?.modelo || "",
    partNumber: product?.referencia || "",
    familyName: "",
    gtin: normalizeGtin(product?.codigobarras),
    warranty: "",
    warrantyTime: "",
    shippingMode: "me2",
    logisticType: "",
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
    dynamicAttributes: initialDynamicAttributesFromProduct(product),
  };
}

export function MercadoLivrePublishProductDialog({
  open,
  onOpenChange,
  produto,
  onAfterPublish,
}: MercadoLivrePublishProductDialogProps) {
  const [step, setStep] = useState<CreateListingStep>("product");
  const [chosenProduct, setChosenProduct] = useState<ProductRow | null>(null);
  const [listingForm, setListingForm] = useState<ListingForm>(() => createInitialListingForm(null));
  const [listingFieldErrors, setListingFieldErrors] = useState<Record<string, string>>({});
  const [creatingListing, setCreatingListing] = useState(false);

  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);
  const [categoryParent, setCategoryParent] = useState<CategoryOption | null>(null);
  const [categoryStack, setCategoryStack] = useState<CategoryOption[]>([]);

  const [listingTypeOptions, setListingTypeOptions] = useState<ListingTypeOption[]>([
    { id: "gold_special", name: "Clássico" },
    { id: "gold_pro", name: "Premium" },
  ]);
  const [listingCommercialInfo, setListingCommercialInfo] = useState<ListingCommercialInfo>({
    seller: null,
    payment: null,
  });
  const [loadingListingCommercialInfo, setLoadingListingCommercialInfo] = useState(false);
  const [conditionOptions, setConditionOptions] = useState<string[]>(["new", "used", "not_specified"]);
  const [categoryAttributes, setCategoryAttributes] = useState<MlCategoryAttribute[]>([]);
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [shippingEligibility, setShippingEligibility] = useState<ShippingEligibility>({
    loaded: false,
    categoryModes: [],
    userModes: [],
    logisticOptions: [],
    logistics: [],
    me2Restricted: false,
    me2Restrictions: [],
    userShippingOption: null,
    defaultDimensions: null,
    error: null,
  });
  const [mercadoEnvios, setMercadoEnvios] = useState<MercadoEnviosState>(EMPTY_MERCADO_ENVIOS);
  const [listingValidation, setListingValidation] = useState<ListingValidation>(EMPTY_LISTING_VALIDATION);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);

  const categoryRequestRef = useRef<AbortController | null>(null);
  const categoryAttributesRequestRef = useRef<AbortController | null>(null);
  const mercadoEnviosRequestRef = useRef<{ controller: AbortController | null; id: number }>({ controller: null, id: 0 });
  const listingValidationRequestRef = useRef<{ controller: AbortController | null; id: number }>({ controller: null, id: 0 });

  const selectedProduct: ProductRow | null = useMemo(() => {
    if (chosenProduct) return chosenProduct;
    if (!produto) return null;
    return {
      id: Number(produto.id),
      titulo: produto.titulo || "",
      tituloMarketplace: (produto as any).tituloMarketplace || "",
      descricao: (produto as any).descricao || "",
      descricaoMarketplace: (produto as any).descricaoMarketplace || "",
      precovenda: Number((produto as any).precovenda ?? 0),
      estoque: Number((produto as any).estoque ?? 0),
      conservacao: (produto as any).conservacao || "",
      codigobarras: (produto as any).codigobarras || "",
      referencia: (produto as any).referencia || "",
      fabricante: (produto as any).fabricante || "",
      modelo: (produto as any).modelo || "",
      imgUrl: (produto as any).imgUrl || "",
      imageUrls: Array.isArray((produto as any).imageUrls)
        ? (produto as any).imageUrls
        : (produto as any).imgUrl
          ? [(produto as any).imgUrl]
          : [],
      mercadolivre: (produto as any).mercadolivre || null,
    };
  }, [chosenProduct, produto]);

  const selectedListingProductImageUrls = useMemo(() => {
    return Array.from(
      new Set(
        [
          ...(selectedProduct?.imageUrls ?? []),
          selectedProduct?.imgUrl,
        ].filter(Boolean) as string[],
      ),
    );
  }, [selectedProduct]);

  const fillFormFromProduct = useCallback((targetProduct: ProductRow | null) => {
    categoryAttributesRequestRef.current?.abort();
    categoryAttributesRequestRef.current = null;
    setLoadingAttributes(false);
    setListingForm(createInitialListingForm(targetProduct));
    setCategorySearch(targetProduct?.tituloMarketplace || targetProduct?.titulo || "");
    setCategoryParent(null);
    setCategoryStack([]);
    setCategoryAttributes([]);
    setPreviewImageIndex(0);
    setShippingEligibility({
      loaded: false,
      categoryModes: [],
      userModes: [],
      logisticOptions: [],
      logistics: [],
      me2Restricted: false,
      me2Restrictions: [],
      userShippingOption: null,
      defaultDimensions: null,
      error: null,
    });
    setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
    setListingValidation(EMPTY_LISTING_VALIDATION);
  }, []);

  const loadListingOptions = useCallback(
    async (
      filters?: { categoryId?: string; price?: number; shippingMode?: string; logisticType?: string; sellerShippingCost?: number },
      signal?: AbortSignal,
    ) => {
      const hasCommercialFilters = Boolean(filters?.categoryId && Number(filters?.price) > 0);
      if (hasCommercialFilters) setLoadingListingCommercialInfo(true);
      try {
        const params = new URLSearchParams();
        if (filters?.categoryId) params.set("categoryId", filters.categoryId);
        if (Number(filters?.price) > 0) params.set("price", String(filters?.price));
        if (filters?.shippingMode) params.set("shippingMode", filters.shippingMode);
        if (filters?.logisticType) params.set("logisticType", filters.logisticType);
        if (Number(filters?.sellerShippingCost) > 0) params.set("sellerShippingCost", String(filters?.sellerShippingCost));
        const response = await fetch(`/api/integracoes/mercadolivre/listing-options${params.size ? `?${params.toString()}` : ""}`, {
          cache: "no-store",
          signal,
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Falha ao carregar opções de anúncio.");
        if (Array.isArray(json.listingTypes) && json.listingTypes.length > 0) {
          const enabledListingTypes = (json.listingTypes as ListingTypeOption[]).filter((option) => isMercadoLivreListingTypeEnabled(option.id));
          setListingTypeOptions(enabledListingTypes);
          setListingForm((current) => {
            const selected = enabledListingTypes.find((option) => option.id === current.listingTypeId);
            const fallbackId = enabledListingTypes.find((option) => option.id === json.defaultListingTypeId && option.available !== false)?.id
              || enabledListingTypes.find((option) => option.available !== false)?.id;
            if (!filters?.categoryId && fallbackId && current.listingTypeId !== fallbackId) {
              return { ...current, listingTypeId: fallbackId };
            }
            if (!selected || selected.available === false || !isMercadoLivreListingTypeEnabled(selected.id)) {
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
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        const message = marketplaceErrorMessage(e);
        setListingCommercialInfo((current) => ({ ...current, error: message }));
        if (!hasCommercialFilters) toast.error("Erro ao carregar opções do Mercado Livre", { description: message });
      } finally {
        if (hasCommercialFilters && !signal?.aborted) setLoadingListingCommercialInfo(false);
      }
    },
    [],
  );

  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current && produto) {
      const row: ProductRow = {
        id: Number(produto.id),
        titulo: produto.titulo || "",
        tituloMarketplace: (produto as any).tituloMarketplace || "",
        descricao: (produto as any).descricao || "",
        descricaoMarketplace: (produto as any).descricaoMarketplace || "",
        precovenda: Number((produto as any).precovenda ?? 0),
        estoque: Number((produto as any).estoque ?? 0),
        conservacao: (produto as any).conservacao || "",
        codigobarras: (produto as any).codigobarras || "",
        referencia: (produto as any).referencia || "",
        fabricante: (produto as any).fabricante || "",
        modelo: (produto as any).modelo || "",
        imgUrl: (produto as any).imgUrl || "",
        imageUrls: Array.isArray((produto as any).imageUrls)
          ? (produto as any).imageUrls
          : (produto as any).imgUrl
            ? [(produto as any).imgUrl]
            : [],
        mercadolivre: (produto as any).mercadolivre || null,
      };
      setChosenProduct(row);
      fillFormFromProduct(row);
      setStep("product");
      setListingFieldErrors({});
      loadListingOptions();
    }
    if (!open && prevOpenRef.current) {
      categoryRequestRef.current?.abort();
      categoryAttributesRequestRef.current?.abort();
      mercadoEnviosRequestRef.current.controller?.abort();
      listingValidationRequestRef.current.controller?.abort();
      setLoadingCategories(false);
      setLoadingAttributes(false);
      setListingFieldErrors({});
      setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
      setListingValidation(EMPTY_LISTING_VALIDATION);
      setChosenProduct(null);
    }
    prevOpenRef.current = open;
  }, [open, produto, fillFormFromProduct, loadListingOptions]);

  function clearListingErrors(...fields: string[]) {
    setListingFieldErrors((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
  }

  function updateListingForm<K extends keyof ListingForm>(key: K, value: ListingForm[K]) {
    if (key === "title") clearListingErrors("title", "family", "general");
    if (key === "brand" || key === "model" || key === "partNumber") clearListingErrors("family", `attr:${String(key).toUpperCase()}`, "general");
    if (key === "familyName") clearListingErrors("family", "general");
    if (key === "gtin") clearListingErrors("gtin", "attr:GTIN", "general");
    if (key === "price") clearListingErrors("price", "general");
    if (key === "availableQuantity") clearListingErrors("stock", "general");
    if (key === "condition") clearListingErrors("condition", "general");
    if (key === "warranty" || key === "warrantyTime") clearListingErrors("warranty", "general");
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
    }

    setListingForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateDynamicAttribute(attributeId: string, value: string) {
    clearListingErrors(`attr:${attributeId}`, "general");
    setListingForm((current) => ({
      ...current,
      dynamicAttributes: {
        ...current.dynamicAttributes,
        [attributeId]: value,
      },
    }));
  }

  function handleSelectProduct(product: ProductRow) {
    if (product.mercadolivre) {
      toast.info("Este produto já possui um anúncio Mercado Livre vinculado.");
      return;
    }
    setChosenProduct(product);
    setListingFieldErrors({});
    fillFormFromProduct(product);
  }

  const loadCategories = useCallback(
    async (params?: { query?: string; parentId?: string; vertical?: MarketplaceVertical }) => {
      const query = params?.query?.trim() ?? "";
      const parentId = params?.parentId ?? "";
      const vertical = params?.vertical ?? listingForm.categoryVertical;
      categoryRequestRef.current?.abort();
      const controller = new AbortController();
      categoryRequestRef.current = controller;
      setLoadingCategories(true);
      try {
        const searchParams = new URLSearchParams({ limit: "8", vertical });
        if (query) searchParams.set("q", query);
        if (parentId) searchParams.set("parentId", parentId);

        const response = await fetch(`/api/integracoes/mercadolivre/categories?${searchParams.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(json?.error || "Falha ao buscar categorias.");
        if (controller.signal.aborted) return;
        setCategoryOptions(json.data ?? []);
        setCategoryParent(json.parent ?? null);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        toast.error("Erro ao buscar categorias", { description: marketplaceErrorMessage(e) });
      } finally {
        if (categoryRequestRef.current === controller) {
          categoryRequestRef.current = null;
          setLoadingCategories(false);
        }
      }
    },
    [listingForm.categoryVertical],
  );

  async function loadCategoryAttributes(categoryId: string) {
    categoryAttributesRequestRef.current?.abort();
    const controller = new AbortController();
    categoryAttributesRequestRef.current = controller;
    setLoadingAttributes(true);
    setShippingEligibility((current) => ({ ...current, loaded: false, error: null }));
    try {
      const response = await fetch(`/api/integracoes/mercadolivre/category-attributes?categoryId=${encodeURIComponent(categoryId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json?.error || "Falha ao carregar atributos.");
      const attrs = (json.data ?? []) as MlCategoryAttribute[];
      const shippingOptions = Array.isArray(json.settings?.shippingOptions) ? json.settings.shippingOptions.filter(Boolean) : [];
      const logisticOptions = Array.isArray(json.settings?.logisticOptions) ? json.settings.logisticOptions.filter(Boolean) : [];
      const logistics: MercadoEnviosLogistic[] = Array.isArray(json.settings?.logistics)
        ? json.settings.logistics
        : logisticOptions.map((type: string) => ({ type, default: false, label: shippingLogisticLabel(type) }));
      const categoryModes: string[] = Array.isArray(json.settings?.categoryShippingOptions)
        ? json.settings.categoryShippingOptions.map((mode: string) => String(mode).toLowerCase())
        : [];
      const userModes: string[] = Array.isArray(json.settings?.userShippingOptions)
        ? json.settings.userShippingOptions.map((mode: string) => String(mode).toLowerCase())
        : [];
      setShippingEligibility({
        loaded: true,
        categoryModes,
        userModes,
        logisticOptions,
        logistics,
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
          (categoryModes.length && !categoryModes.includes("me2")) || (userModes.length && !userModes.includes("me2"))
            ? shippingOptions.includes("custom")
              ? "custom"
              : current.shippingMode
            : current.shippingMode,
        logisticType: logisticOptions.includes(current.logisticType)
          ? current.logisticType
          : json.settings?.defaultLogisticOption ?? logisticOptions[0] ?? "",
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
      if (e?.name === "AbortError") return;
      const message = marketplaceErrorMessage(e);
      toast.error("Erro ao carregar atributos e envios da categoria", { description: message });
      setCategoryAttributes([]);
      setShippingEligibility({
        loaded: true,
        categoryModes: [],
        userModes: [],
        logisticOptions: [],
        logistics: [],
        me2Restricted: false,
        me2Restrictions: [],
        userShippingOption: null,
        defaultDimensions: null,
        error: message,
      });
      setListingForm((current) => ({ ...current, categoryShippingOptions: [] }));
    } finally {
      if (categoryAttributesRequestRef.current === controller) {
        categoryAttributesRequestRef.current = null;
        setLoadingAttributes(false);
      }
    }
  }

  function selectCategory(category: CategoryOption) {
    const nextConditions = category.conditionOptions?.length ? category.conditionOptions : ["new", "used", "not_specified"];
    setConditionOptions(nextConditions);
    clearListingErrors("category", "listingType", "general");
    setListingForm((current) => ({
      ...current,
      categoryId: category.id,
      categoryName: category.name,
      categoryPath: category.path ?? "",
      categoryShippingOptions: [],
      condition: nextConditions.includes(current.condition) ? current.condition : (nextConditions[0] as ListingForm["condition"]),
      dynamicAttributes: {
        BRAND: current.brand,
        MODEL: current.model,
        PART_NUMBER: current.partNumber,
        GTIN: normalizeGtin(current.gtin),
      },
    }));
    setCategoryAttributes([]);
    setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
    setListingValidation(EMPTY_LISTING_VALIDATION);
    setCategorySearch("");
    setCategoryPopoverOpen(false);
    loadCategoryAttributes(category.id);
  }

  function changeCategoryVertical(value: MarketplaceVertical) {
    clearListingErrors("category", "listingType", "general");
    setListingForm((current) => ({
      ...current,
      categoryVertical: value,
      categoryId: "",
      categoryName: "",
      categoryPath: "",
      categoryShippingOptions: [],
      dynamicAttributes: {
        BRAND: current.brand,
        MODEL: current.model,
        PART_NUMBER: current.partNumber,
        GTIN: normalizeGtin(current.gtin),
      },
    }));
    setCategoryAttributes([]);
    setShippingEligibility({
      loaded: false,
      categoryModes: [],
      userModes: [],
      logisticOptions: [],
      logistics: [],
      me2Restricted: false,
      me2Restrictions: [],
      userShippingOption: null,
      defaultDimensions: null,
      error: null,
    });
    setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
    setListingValidation(EMPTY_LISTING_VALIDATION);
    setCategorySearch("");
    setCategoryParent(null);
    setCategoryStack([]);
  }

  function browseCategory(category: CategoryOption) {
    if (categoryParent) setCategoryStack((current) => [...current, categoryParent]);
    categoryRequestRef.current?.abort();
    setLoadingCategories(true);
    setCategorySearch("");
    loadCategories({ parentId: category.id });
  }

  function backCategoryLevel() {
    if (!categoryStack.length) {
      setCategoryParent(null);
      setCategoryOptions([]);
      loadCategories({ parentId: "" });
      return;
    }
    const previousParent = categoryStack[categoryStack.length - 1];
    setCategoryStack((current) => current.slice(0, -1));
    setCategorySearch("");
    loadCategories({ parentId: previousParent?.id ?? "" });
  }

  const pictureRequirement = useMemo(
    () => getMercadoLivrePictureRequirement(listingForm.pictureUrl),
    [listingForm.pictureUrl],
  );
  const validPreviewImages = pictureRequirement.urls;

  const requiredMissingAttributes = useMemo(() => {
    return categoryAttributes.filter((attribute) => {
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
  }, [categoryAttributes, listingForm.brand, listingForm.dynamicAttributes, listingForm.gtin, listingForm.model, listingForm.partNumber]);

  const missingShippingDimensions = Boolean(
    listingForm.shippingMode === "me2" &&
      (![listingForm.widthCm, listingForm.heightCm, listingForm.lengthCm]
        .map((value) => Number(value.replace(",", ".")))
        .every((value) => Number.isFinite(value) && value > 0) ||
        !Number.isInteger(Number(listingForm.weightGrams)) ||
        Number(listingForm.weightGrams) <= 0),
  );

  const categoryPreferenceModes = useMemo(
    () => shippingEligibility.categoryModes.map((option) => option.toLowerCase()),
    [shippingEligibility.categoryModes],
  );
  const userPreferenceModes = useMemo(
    () => shippingEligibility.userModes.map((option) => option.toLowerCase()),
    [shippingEligibility.userModes],
  );

  const preferencesUnknown = !listingForm.categoryId || !shippingEligibility.loaded;
  const preferenceModes = useMemo(
    () => ({ categoryModes: categoryPreferenceModes, userModes: userPreferenceModes }),
    [categoryPreferenceModes, userPreferenceModes],
  );

  const mercadoEnviosPreferenceCheck = preferencesUnknown
    ? { allowed: true, blockedBy: null as "category" | "seller" | null }
    : preferencesAllowShippingMode("me2", preferenceModes);

  const categorySupportsCustomShipping =
    preferencesUnknown || preferencesAllowShippingMode("custom", preferenceModes).allowed;

  const mercadoEnviosBlockedReason =
    listingForm.categoryId && shippingEligibility.loaded && !mercadoEnviosPreferenceCheck.allowed
      ? mercadoEnviosPreferenceCheck.blockedBy === "category"
        ? `As preferências da categoria ${listingForm.categoryId} não listaram Mercado Envios (retornou: ${categoryPreferenceModes.join(", ") || "nenhum modo"}). A disponibilidade real deste anúncio será confirmada ao consultar o Mercado Envios com preço, dimensões e peso.`
        : mercadoEnviosPreferenceCheck.blockedBy === "seller"
          ? `As preferências da conta não listaram Mercado Envios (retornou: ${userPreferenceModes.join(", ") || "nenhum modo"}). A disponibilidade real deste anúncio será confirmada ao consultar o Mercado Envios com preço, dimensões e peso.`
          : shippingEligibility.error || ""
      : "";

  const mercadoEnviosRestrictionNote =
    shippingEligibility.me2Restricted && listingForm.categoryId
      ? `Esta categoria é marcada como restrita pelo Mercado Livre${
          shippingEligibility.me2Restrictions.length ? ` (${shippingEligibility.me2Restrictions.join(", ")})` : ""
        }. Categorias restritas exigem acordo comercial na conta para usar o Mercado Envios.`
      : "";

  const customShippingIssue =
    listingForm.shippingMode === "custom" && !categorySupportsCustomShipping
      ? `A categoria selecionada não retornou suporte a envio personalizado. Modos retornados: ${categoryPreferenceModes.join(", ") || "não informados"}.`
      : listingForm.shippingMode === "custom" &&
          (!listingForm.customShippingDescription.trim() ||
            Number(listingForm.customShippingDeadlineDays) <= 0 ||
            (!listingForm.freeShipping && parseCurrencyInput(listingForm.customShippingCost) <= 0))
        ? "Informe descrição, prazo e valor válido para o envio personalizado."
        : "";

  const listingGtin = getListingAttributeValue(listingForm, "GTIN").replace(/\D/g, "");
  const familyNamePreview = buildListingFamilyName(listingForm);

  const listingSignature = JSON.stringify({
    categoryId: listingForm.categoryId,
    title: listingForm.title,
    familyName: familyNamePreview,
    price: parseCurrencyInput(listingForm.price),
    availableQuantity: Number(listingForm.availableQuantity),
    condition: listingForm.condition,
    listingTypeId: listingForm.listingTypeId,
    pictureUrl: listingForm.pictureUrl,
    gtin: listingGtin,
    warranty: listingForm.warranty,
    warrantyTime: listingForm.warrantyTime,
    attributes: listingForm.dynamicAttributes,
    shippingMode: listingForm.shippingMode,
    logisticType: listingForm.logisticType,
    freeShipping: listingForm.freeShipping,
    widthCm: listingForm.widthCm,
    heightCm: listingForm.heightCm,
    lengthCm: listingForm.lengthCm,
    weightGrams: listingForm.weightGrams,
    customShippingDescription: listingForm.customShippingDescription,
    customShippingCost: listingForm.customShippingCost,
    customShippingDeadlineDays: listingForm.customShippingDeadlineDays,
  });

  const listingValidationCurrent = listingValidation.signature === listingSignature;
  const listingValidationState: ListingValidationState =
    listingValidation.state === "valid" || listingValidation.state === "invalid"
      ? listingValidationCurrent
        ? listingValidation.state
        : "stale"
      : listingValidation.state;

  const selectedShippingQuote: MercadoEnviosQuoteScenario | null =
    listingForm.shippingMode === "me2"
      ? listingForm.freeShipping
        ? mercadoEnvios.quotes.freeShipping
        : mercadoEnvios.quotes.buyerPaysShipping
      : null;

  const freeShippingMandatory = mercadoEnvios.freeShippingPolicy === "mandatory";
  const mercadoEnviosIssue =
    listingForm.shippingMode === "me2" && mercadoEnvios.loaded && !mercadoEnvios.available
      ? mercadoEnvios.error || mercadoEnvios.message || "Mercado Envios não está disponível para este anúncio."
      : listingForm.shippingMode === "me2" &&
          mercadoEnvios.available &&
          listingForm.logisticType &&
          !mercadoEnvios.logistics.some((option) => option.type === listingForm.logisticType)
        ? "A logística selecionada não está disponível para este anúncio."
        : "";

  const selectedListingType = listingTypeOptions.find((option) => option.id === listingForm.listingTypeId) ?? null;

  const sellerListingIssue =
    listingCommercialInfo.seller?.canList === false
      ? listingCommercialInfo.seller.restrictions.join(" ") || "A conta conectada não está autorizada a publicar anúncios."
      : "";

  const listingTypeIssue =
    listingForm.listingTypeId && !isMercadoLivreListingTypeEnabled(listingForm.listingTypeId)
      ? disabledMercadoLivreListingTypeMessage
      : selectedListingType?.available === false
        ? selectedListingType.restrictionReason || "O tipo de anúncio selecionado não está disponível para esta conta e categoria."
        : "";

  const freeListingStockIssue =
    listingForm.listingTypeId === "free" && Number(listingForm.availableQuantity) > 1
      ? "Anúncios grátis permitem estoque máximo de 1 unidade."
      : "";

  const clientListingIssues: Array<CreateListingIssue | null> = [
    !listingForm.produtoId ? { step: "product", message: "Selecione um produto do ERP." } : null,
    selectedProduct?.mercadolivre ? { step: "product", message: "Este produto já possui anúncio Mercado Livre vinculado." } : null,
    !listingForm.title.trim() ? { step: "content", message: "Informe o título do anúncio." } : null,
    !pictureRequirement.valid
      ? { step: "media", message: mercadoLivrePictureRequirementMessage(pictureRequirement.count) }
      : null,
    listingGtin && !isValidGtin(listingGtin) ? { step: "content", message: "Informe um GTIN/EAN válido ou deixe o campo vazio." } : null,
    !listingForm.categoryId ? { step: "category", message: "Selecione a categoria Mercado Livre." } : null,
    ...requiredMissingAttributes.map((attribute) => ({ step: "category" as const, message: `Preencha o atributo obrigatório: ${attribute.name}.` })),
    !listingForm.listingTypeId ? { step: "offer", message: "Selecione um tipo de anúncio disponível para a conta." } : null,
    parseCurrencyInput(listingForm.price) <= 0 ? { step: "offer", message: "Informe um preço válido." } : null,
    Number(listingForm.availableQuantity) <= 0 ? { step: "offer", message: "Informe estoque disponível." } : null,
    freeListingStockIssue ? { step: "offer", message: freeListingStockIssue } : null,
    mercadoEnviosIssue ? { step: "offer", message: mercadoEnviosIssue } : null,
    customShippingIssue ? { step: "offer", message: customShippingIssue } : null,
    missingShippingDimensions ? { step: "offer", message: "Informe comprimento, largura e altura maiores que zero e o peso inteiro em gramas." } : null,
    sellerListingIssue ? { step: "offer", message: sellerListingIssue } : null,
    listingTypeIssue ? { step: "offer", message: listingTypeIssue } : null,
  ];

  const listingIssueDetails = [...clientListingIssues.filter((issue): issue is CreateListingIssue => Boolean(issue))];
  for (const [field, message] of Object.entries(listingFieldErrors)) {
    const issue = { step: listingErrorStep({ [field]: message }), message } satisfies CreateListingIssue;
    if (!listingIssueDetails.some((current) => current.step === issue.step && current.message === issue.message)) {
      listingIssueDetails.push(issue);
    }
  }

  const listingIssues = listingIssueDetails.map((issue) => issue.message);
  const listingReadyToValidate = listingIssues.length === 0;
  const canPublishListing = listingReadyToValidate && listingValidationState === "valid";

  const categoryParentId = categoryParent?.id;
  useEffect(() => {
    if (!open || !categoryPopoverOpen) return;
    const timer = window.setTimeout(() => {
      loadCategories({ query: categorySearch, parentId: categoryParentId, vertical: listingForm.categoryVertical });
    }, categorySearch.trim() ? 350 : 0);

    return () => {
      window.clearTimeout(timer);
      categoryRequestRef.current?.abort();
      categoryRequestRef.current = null;
    };
  }, [categoryParentId, categoryPopoverOpen, categorySearch, open, listingForm.categoryVertical, loadCategories]);

  useEffect(() => {
    if (!open || !listingForm.categoryId || parseCurrencyInput(listingForm.price) <= 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      loadListingOptions(
        {
          categoryId: listingForm.categoryId,
          price: parseCurrencyInput(listingForm.price),
          shippingMode: listingForm.shippingMode,
          logisticType: listingForm.logisticType,
          sellerShippingCost: selectedShippingQuote?.sellerShippingCost ?? undefined,
        },
        controller.signal,
      );
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    open,
    listingForm.categoryId,
    listingForm.price,
    listingForm.shippingMode,
    listingForm.logisticType,
    selectedShippingQuote?.sellerShippingCost,
    loadListingOptions,
  ]);

  async function loadMercadoEnvios() {
    const price = parseCurrencyInput(listingForm.price);
    if (
      listingForm.shippingMode !== "me2" ||
      !listingForm.categoryId ||
      !listingForm.listingTypeId ||
      price <= 0 ||
      missingShippingDimensions
    ) {
      mercadoEnviosRequestRef.current.controller?.abort();
      mercadoEnviosRequestRef.current = { controller: null, id: mercadoEnviosRequestRef.current.id + 1 };
      setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
      return;
    }

    mercadoEnviosRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = mercadoEnviosRequestRef.current.id + 1;
    mercadoEnviosRequestRef.current = { controller, id: requestId };
    setMercadoEnvios((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetch("/api/integracoes/mercadolivre/mercado-envios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          title: listingForm.title,
          categoryId: listingForm.categoryId,
          price,
          listingTypeId: listingForm.listingTypeId,
          condition: listingForm.condition,
          logisticType: listingForm.logisticType,
          localPickup: false,
          lengthCm: Number(listingForm.lengthCm.replace(",", ".")),
          widthCm: Number(listingForm.widthCm.replace(",", ".")),
          heightCm: Number(listingForm.heightCm.replace(",", ".")),
          weightGrams: Number(listingForm.weightGrams),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (mercadoEnviosRequestRef.current.id !== requestId) return;
      if (!response.ok) throw new Error(json?.error || "Falha ao consultar o Mercado Envios.");

      const data = json.data ?? {};
      const logistics: MercadoEnviosLogistic[] = Array.isArray(data.logistics) ? data.logistics : [];
      setMercadoEnvios({
        loading: false,
        loaded: true,
        available: Boolean(data.available),
        mode: data.mode ?? null,
        logisticType: data.logisticType ?? null,
        logistics,
        freeShippingPolicy: (data.freeShippingPolicy ?? "unknown") as FreeShippingPolicy,
        quotes: data.quotes ?? { buyerPaysShipping: null, freeShipping: null },
        physicalWeight: data.physicalWeight ?? null,
        billableWeight: data.billableWeight ?? null,
        origin: data.origin ?? null,
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        message: data.message ?? null,
        error: null,
      });

      setListingForm((current) => {
        const next = { ...current };
        if (logistics.length && !logistics.some((option) => option.type === current.logisticType)) {
          next.logisticType = data.logisticType ?? logistics[0].type;
        }
        if (data.freeShippingPolicy === "mandatory") next.freeShipping = true;
        return next.logisticType === current.logisticType && next.freeShipping === current.freeShipping ? current : next;
      });
      if (data.available) clearListingErrors("shipping");
    } catch (e: any) {
      if (e?.name === "AbortError" || mercadoEnviosRequestRef.current.id !== requestId) return;
      setMercadoEnvios({ ...EMPTY_MERCADO_ENVIOS, loaded: true, error: marketplaceErrorMessage(e) });
    }
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadMercadoEnvios();
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    listingForm.shippingMode,
    listingForm.categoryId,
    listingForm.listingTypeId,
    listingForm.condition,
    listingForm.price,
    listingForm.widthCm,
    listingForm.heightCm,
    listingForm.lengthCm,
    listingForm.weightGrams,
  ]);

  useEffect(() => {
    if (previewImageIndex > 0 && previewImageIndex >= validPreviewImages.length) {
      setPreviewImageIndex(0);
    }
  }, [previewImageIndex, validPreviewImages.length]);

  function buildListingRequestBody() {
    return {
      produtoId: Number(listingForm.produtoId),
      title: listingForm.title,
      categoryId: listingForm.categoryId,
      price: parseCurrencyInput(listingForm.price),
      availableQuantity: Number(listingForm.availableQuantity),
      condition: listingForm.condition,
      listingTypeId: listingForm.listingTypeId,
      description: listingForm.description,
      pictureUrl: listingForm.pictureUrl,
      brand: getListingAttributeValue(listingForm, "BRAND"),
      model: getListingAttributeValue(listingForm, "MODEL"),
      partNumber: getListingAttributeValue(listingForm, "PART_NUMBER"),
      familyName: familyNamePreview,
      gtin: getListingAttributeValue(listingForm, "GTIN").replace(/\D/g, ""),
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
    };
  }

  async function validateListing() {
    listingValidationRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = listingValidationRequestRef.current.id + 1;
    listingValidationRequestRef.current = { controller, id: requestId };
    const signature = listingSignature;
    setListingValidation((current) => ({ ...current, state: "loading", errors: [], warnings: [] }));

    try {
      const response = await fetch("/api/integracoes/mercadolivre/items/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(buildListingRequestBody()),
      });
      const json = await response.json().catch(() => ({}));
      if (listingValidationRequestRef.current.id !== requestId) return;
      if (!response.ok) throw new Error(json?.error || "Falha ao validar o anúncio no Mercado Livre.");

      const data = json.data ?? {};
      const valid = data.state === "valid";
      setListingValidation({
        state: valid ? "valid" : "invalid",
        checks: Array.isArray(data.checks) ? data.checks : [],
        errors: Array.isArray(data.errors) ? data.errors.filter(Boolean) : [],
        warnings: Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [],
        costs: data.costs ?? null,
        signature,
      });
      const fieldErrors = (data.fieldErrors && typeof data.fieldErrors === "object" ? data.fieldErrors : {}) as Record<string, string>;
      setListingFieldErrors(valid ? {} : fieldErrors);
      if (data.shipping) {
        setMercadoEnvios((current) => ({
          ...current,
          loaded: true,
          available: Boolean(data.shipping.available),
          mode: data.shipping.mode ?? null,
          logisticType: data.shipping.logisticType ?? current.logisticType,
          logistics: Array.isArray(data.shipping.logistics) ? data.shipping.logistics : current.logistics,
          freeShippingPolicy: (data.shipping.freeShippingPolicy ?? current.freeShippingPolicy) as FreeShippingPolicy,
          quotes: data.shipping.quotes ?? current.quotes,
          physicalWeight: data.shipping.physicalWeight ?? current.physicalWeight,
          billableWeight: data.shipping.billableWeight ?? current.billableWeight,
          message: data.shipping.message ?? null,
        }));
      }

      if (valid) {
        toast.success("Anúncio validado pelo Mercado Livre.");
      } else {
        toast.error("O Mercado Livre recusou o anúncio.", {
          description: (Array.isArray(data.errors) ? data.errors[0] : null) || "Revise os campos destacados.",
        });
        setStep(listingErrorStep(fieldErrors));
      }
    } catch (e: any) {
      if (e?.name === "AbortError" || listingValidationRequestRef.current.id !== requestId) return;
      const message = marketplaceErrorMessage(e);
      setListingValidation({ state: "invalid", checks: [], errors: [message], warnings: [], costs: null, signature });
      toast.error("Erro ao validar anúncio", { description: message });
    }
  }

  async function createListing() {
    if (!listingReadyToValidate) {
      toast.error("Revise o anúncio antes de publicar.", { description: listingIssues[0] });
      return;
    }
    if (listingValidationState !== "valid") {
      toast.error("Valide o anúncio no Mercado Livre antes de publicar.", {
        description:
          listingValidationState === "stale"
            ? "Os dados mudaram depois da última validação. Execute Validar anúncio novamente."
            : "Use o botão Validar anúncio na etapa de revisão.",
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
      const response = await fetch("/api/integracoes/mercadolivre/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildListingRequestBody()),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiError = new Error(json?.error || "Falha ao criar anúncio.");
        (apiError as any).fieldErrors = json?.fieldErrors;
        throw apiError;
      }

      const confirmed = json?.shipping;
      toast.success("Anúncio criado no Mercado Livre.", {
        description:
          confirmed?.mode === "me2" && confirmed?.logisticType
            ? `Mercado Envios confirmado: ${confirmed.logisticLabel || shippingLogisticLabel(confirmed.logisticType)}.`
            : undefined,
      });
      if (confirmed?.logisticMismatch) {
        toast.warning("O Mercado Livre aplicou uma logística diferente da prevista.", {
          description: `Prevista: ${shippingLogisticLabel(confirmed.expectedLogisticType)} · aplicada: ${confirmed.logisticLabel || shippingLogisticLabel(confirmed.logisticType)}.`,
        });
      }
      setListingValidation(EMPTY_LISTING_VALIDATION);
      setMercadoEnvios(EMPTY_MERCADO_ENVIOS);
      setListingFieldErrors({});
      onOpenChange(false);
      onAfterPublish?.();
    } catch (e: any) {
      const message = marketplaceErrorMessage(e);
      const fieldErrors = { ...mapListingApiError(message), ...((e as any)?.fieldErrors ?? {}) };
      setListingFieldErrors(fieldErrors);
      setStep(listingErrorStep(fieldErrors));
      toast.error("Erro ao criar anúncio", {
        description: "Corrija os campos destacados no formulário.",
      });
    } finally {
      setCreatingListing(false);
    }
  }

  if (!open) return null;

  return (
    <MercadoLivreCreateListingDialog
      open={open}
      onOpenChange={onOpenChange}
      step={step}
      onStepChange={setStep}
      form={listingForm}
      updateForm={updateListingForm}
      updateDynamicAttribute={updateDynamicAttribute}
      fieldErrors={listingFieldErrors}
      creating={creatingListing}
      selectedProduct={selectedProduct}
      onSelectProduct={handleSelectProduct}
      issues={listingIssueDetails}
      onPublish={createListing}
      categoryPopoverOpen={categoryPopoverOpen}
      onCategoryPopoverOpenChange={setCategoryPopoverOpen}
      categorySearch={categorySearch}
      onCategorySearchChange={(query) => {
        categoryRequestRef.current?.abort();
        setLoadingCategories(true);
        setCategoryOptions([]);
        setCategoryParent(null);
        setCategoryStack([]);
        setCategorySearch(query);
      }}
      loadingCategories={loadingCategories}
      categoryOptions={categoryOptions}
      categoryParent={categoryParent}
      onBackCategoryLevel={backCategoryLevel}
      onBrowseCategory={browseCategory}
      onSelectCategory={selectCategory}
      onChangeCategoryVertical={changeCategoryVertical}
      categoryAttributes={categoryAttributes}
      loadingAttributes={loadingAttributes}
      listingTypeOptions={listingTypeOptions}
      listingCommercialInfo={listingCommercialInfo}
      loadingListingCommercialInfo={loadingListingCommercialInfo}
      conditionOptions={conditionOptions}
      selectedListingType={selectedListingType}
      shippingEligibility={shippingEligibility}
      mercadoEnviosBlockedReason={mercadoEnviosBlockedReason}
      mercadoEnviosRestrictionNote={mercadoEnviosRestrictionNote}
      customShippingIssue={customShippingIssue}
      missingShippingDimensions={missingShippingDimensions}
      mercadoEnvios={mercadoEnvios}
      onRefreshMercadoEnvios={loadMercadoEnvios}
      freeShippingMandatory={freeShippingMandatory}
      selectedShippingQuote={selectedShippingQuote}
      mercadoEnviosIssue={mercadoEnviosIssue}
      validation={listingValidation}
      validationState={listingValidationState}
      onValidate={validateListing}
      canValidate={listingReadyToValidate}
      canPublish={canPublishListing}
      previewImages={validPreviewImages}
      productImageUrls={selectedListingProductImageUrls}
      previewImageIndex={previewImageIndex}
      onPreviewImageIndexChange={setPreviewImageIndex}
    />
  );
}
