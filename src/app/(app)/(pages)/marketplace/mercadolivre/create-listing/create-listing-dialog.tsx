"use client";

/* eslint-disable @next/next/no-img-element -- as URLs vêm dinamicamente do ERP e do Mercado Livre. */

import { useMemo, useRef, useState } from "react";
import ProductSelect from "@/app/(app)/components/productSelect";
import type { Produto } from "@/app/(app)/(pages)/estoque/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListingDialogContent } from "../listing-dialog-content";
import { TabsContent } from "@/components/ui/tabs";
import { ListingStepper, type ListingStepDefinition } from "../listing-stepper";
import {
  AttributeCard,
  AttributeGroup,
  ErrorBox,
  Field,
  FieldError,
  FormSection,
  InfoBox,
  listingFieldClass as fieldClass,
  LoadingBox,
  MaybeError,
  RequiredLabel,
  StepHeading,
  Summary,
  withError,
} from "../listing-form-fields";
import { Textarea } from "@/components/ui/textarea";
import ValueInput from "@/components/ui/value-input";
import { isMercadoLivreListingTypeEnabled } from "@/lib/integrations/mercadolivre-listing-validation";
import { ListingMediaManager } from "../listing-media/listing-media-manager";
import {
  AlertTriangle,
  BadgeDollarSign,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  ImageIcon,
  Info,
  Loader2,
  LockKeyhole,
  PackageSearch,
  Tags,
  TrendingUp,
  UploadCloud,
  XCircle,
} from "lucide-react";
import type {
  ListingValidation,
  ListingValidationState,
  MercadoEnviosQuoteScenario,
  MercadoEnviosState,
  CategoryOption,
  ListingCommercialInfo,
  ListingForm,
  ListingTypeOption,
  MarketplaceVertical,
  MlCategoryAttribute,
  ProductRow,
  ShippingEligibility,
} from "../../marketplace-client";

export type CreateListingStep = "product" | "content" | "media" | "category" | "offer" | "review";

export type CreateListingIssue = {
  step: CreateListingStep;
  message: string;
};

const createListingSteps: ListingStepDefinition<CreateListingStep>[] = [
  { value: "product", title: "Produto do ERP", short: "Produto", description: "Escolha o item", icon: PackageSearch },
  { value: "content", title: "Conteúdo do anúncio", short: "Conteúdo", description: "Textos e dados", icon: FileText },
  { value: "media", title: "Mídia do anúncio", short: "Mídia", description: "Imagens e ordem", icon: ImageIcon },
  { value: "category", title: "Categoria e características", short: "Categoria", description: "Classifique o item", icon: Tags },
  { value: "offer", title: "Oferta e envio", short: "Oferta", description: "Preço e logística", icon: BadgeDollarSign },
  { value: "review", title: "Revisar anúncio", short: "Revisão", description: "Confira e publique", icon: ClipboardCheck },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: CreateListingStep;
  onStepChange: (step: CreateListingStep) => void;
  form: ListingForm;
  updateForm: <K extends keyof ListingForm>(key: K, value: ListingForm[K]) => void;
  updateDynamicAttribute: (attributeId: string, value: string) => void;
  fieldErrors: Record<string, string>;
  creating: boolean;
  selectedProduct: ProductRow | null;
  onSelectProduct: (product: ProductRow) => void;
  issues: CreateListingIssue[];
  onPublish: () => void;
  categoryPopoverOpen: boolean;
  onCategoryPopoverOpenChange: (open: boolean) => void;
  categorySearch: string;
  onCategorySearchChange: (value: string) => void;
  loadingCategories: boolean;
  categoryOptions: CategoryOption[];
  categoryParent: CategoryOption | null;
  onBackCategoryLevel: () => void;
  onBrowseCategory: (category: CategoryOption) => void;
  onSelectCategory: (category: CategoryOption) => void;
  onChangeCategoryVertical: (value: MarketplaceVertical) => void;
  categoryAttributes: MlCategoryAttribute[];
  loadingAttributes: boolean;
  listingTypeOptions: ListingTypeOption[];
  listingCommercialInfo: ListingCommercialInfo;
  loadingListingCommercialInfo: boolean;
  conditionOptions: string[];
  selectedListingType: ListingTypeOption | null;
  shippingEligibility: ShippingEligibility;
  mercadoEnviosBlockedReason: string;
  mercadoEnviosRestrictionNote: string;
  customShippingIssue: string;
  missingShippingDimensions: boolean;
  mercadoEnvios: MercadoEnviosState;
  onRefreshMercadoEnvios: () => void;
  freeShippingMandatory: boolean;
  selectedShippingQuote: MercadoEnviosQuoteScenario | null;
  mercadoEnviosIssue: string;
  validation: ListingValidation;
  validationState: ListingValidationState;
  onValidate: () => void;
  canValidate: boolean;
  canPublish: boolean;
  previewImages: string[];
  productImageUrls: string[];
  previewImageIndex: number;
  onPreviewImageIndexChange: (index: number) => void;
};


export function MercadoLivreCreateListingDialog(props: Props) {
  const {
    open,
    onOpenChange,
    step,
    onStepChange,
    form,
    updateForm,
    updateDynamicAttribute,
    fieldErrors,
    creating,
    selectedProduct,
    onSelectProduct,
    issues,
    onPublish,
    categoryPopoverOpen,
    onCategoryPopoverOpenChange,
    categorySearch,
    onCategorySearchChange,
    loadingCategories,
    categoryOptions,
    categoryParent,
    onBackCategoryLevel,
    onBrowseCategory,
    onSelectCategory,
    onChangeCategoryVertical,
    categoryAttributes,
    loadingAttributes,
    listingTypeOptions,
    listingCommercialInfo,
    loadingListingCommercialInfo,
    conditionOptions,
    selectedListingType,
    shippingEligibility,
    mercadoEnviosBlockedReason,
    mercadoEnviosRestrictionNote,
    customShippingIssue,
    missingShippingDimensions,
    mercadoEnvios,
    onRefreshMercadoEnvios,
    freeShippingMandatory,
    selectedShippingQuote,
    mercadoEnviosIssue,
    validation,
    validationState,
    onValidate,
    canValidate,
    canPublish,
    previewImages,
    productImageUrls,
    previewImageIndex,
    onPreviewImageIndexChange,
  } = props;
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  // Logisticas confirmadas para este anuncio; antes disso, as da conta/categoria.
  const logisticOptions = mercadoEnvios.loaded && mercadoEnvios.logistics.length
    ? mercadoEnvios.logistics
    : shippingEligibility.logistics.length
      ? shippingEligibility.logistics
      : shippingEligibility.logisticOptions.map((type) => ({ type, default: false, label: shippingLogisticLabel(type) }));
  const selectedPreviewImage = previewImages[Math.min(previewImageIndex, Math.max(previewImages.length - 1, 0))] ?? "";
  const issuesByStep = useMemo(() => {
    const grouped = new Map<CreateListingIssue["step"], CreateListingIssue[]>();
    for (const issue of issues) grouped.set(issue.step, [...(grouped.get(issue.step) ?? []), issue]);
    return grouped;
  }, [issues]);
  const issueCountByStep = useMemo(
    () => Object.fromEntries(createListingSteps.map((item) => [item.value, issuesByStep.get(item.value)?.length ?? 0])) as Record<CreateListingStep, number>,
    [issuesByStep],
  );
  const stepValidity: Record<CreateListingStep, boolean> = {
    product: !issuesByStep.get("product")?.length,
    content: !issuesByStep.get("content")?.length,
    media: !issuesByStep.get("media")?.length,
    category: !issuesByStep.get("category")?.length && !loadingAttributes,
    offer: !issuesByStep.get("offer")?.length && !loadingListingCommercialInfo,
    review: canPublish && !loadingAttributes && !loadingListingCommercialInfo,
  };
  const currentIndex = createListingSteps.findIndex((item) => item.value === step);

  function advance() {
    if (!stepValidity[step] || currentIndex >= createListingSteps.length - 1) return;
    onStepChange(createListingSteps[currentIndex + 1].value);
  }

  function updateIdentity(field: "brand" | "model" | "partNumber" | "gtin", attributeId: string, value: string) {
    updateForm(field, value);
    updateDynamicAttribute(attributeId, value);
  }

  const stepIssues = step === "review" ? issues : issuesByStep.get(step) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ListingDialogContent mode="create" stepCount={createListingSteps.length}>
        {fieldErrors.general ? (
          <div className="mx-5 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">
            {fieldErrors.general}
          </div>
        ) : null}

        <ListingStepper
          steps={createListingSteps}
          step={step}
          onStepChange={onStepChange}
          stepValidity={stepValidity}
          issueCountByStep={issueCountByStep}
          footerNote={<p className={`mr-auto text-left text-xs ${stepIssues.length ? "text-destructive" : "text-muted-foreground"}`}>Etapa {currentIndex + 1} de {createListingSteps.length} · {step === "review" ? validationStateLabel(validationState, canValidate) : stepValidity[step] ? "Concluída" : stepIssues.length ? `${stepIssues.length} pendência(s) obrigatória(s) para continuar.` : "Aguarde a validação dos dados."}</p>}
          footerActions={<><Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>Cancelar</Button>{currentIndex > 0 ? <Button variant="outline" onClick={() => onStepChange(createListingSteps[currentIndex - 1].value)} disabled={creating}><ChevronLeft className="h-4 w-4" />Voltar</Button> : null}{currentIndex < createListingSteps.length - 1 ? <Button onClick={advance} disabled={creating || !stepValidity[step]}>Avançar<ChevronRight className="h-4 w-4" /></Button> : <><Button variant="outline" onClick={onValidate} disabled={creating || !canValidate || validationState === "loading"}>{validationState === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}{validationState === "loading" ? "Validando..." : "Validar anúncio"}</Button><Button onClick={onPublish} disabled={creating || !canPublish}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}{creating ? "Publicando anúncio..." : "Publicar anúncio"}</Button></>}</>}
        >
              <TabsContent value="product" className="m-0 space-y-5">
                <StepHeading number="1" title="Produto do ERP" description="Pesquise no catálogo completo do ERP o produto que dará origem ao anúncio." />
                {selectedProduct ? (
                  <div className="overflow-hidden rounded-xl border bg-background">
                    <div className="grid gap-4 p-4 sm:grid-cols-[120px_minmax(0,1fr)]">
                      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
                        {selectedProduct.imgUrl ? (
                          <img src={selectedProduct.imgUrl} alt={selectedProduct.titulo} className="h-full w-full object-contain" />
                        ) : <ImageIcon className="h-8 w-8 text-muted-foreground" />}
                      </div>
                      <div className="min-w-0 space-y-3">
                        <div>
                          <h3 className="font-semibold">{selectedProduct.tituloMarketplace || selectedProduct.titulo}</h3>
                          <p className="text-xs text-muted-foreground">ID #{selectedProduct.id}{selectedProduct.referencia ? ` · Ref. ${selectedProduct.referencia}` : ""}</p>
                        </div>
                        <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                          <ProductDetail label="Fabricante" value={selectedProduct.fabricante} />
                          <ProductDetail label="Código de barras" value={selectedProduct.codigobarras} />
                          <ProductDetail label="Preço de venda no ERP" value={formatCurrency(selectedProduct.precovenda)} />
                          <div><span className="text-xs text-muted-foreground">Estoque atual</span><div className="flex items-center gap-2 font-medium">{selectedProduct.estoque} unidade(s) <StockBadge product={selectedProduct} /></div></div>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <RequiredLabel>Valor do anúncio no Mercado Livre</RequiredLabel>
                              <p className="text-xs text-muted-foreground">
                                Preço no ERP: {formatCurrency(selectedProduct.precovenda)} · <span className="font-medium text-foreground">Exclusivo do anúncio (não altera o cadastro no ERP)</span>
                              </p>
                            </div>
                            <div className="w-full sm:w-44">
                              <ValueInput
                                value={parseCurrency(form.price)}
                                onValueChange={(value) => updateForm("price", formatCurrencyInput(value))}
                                disabled={creating}
                                className={withError(fieldErrors.price)}
                              />
                              <MaybeError value={fieldErrors.price} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-end border-t bg-muted/20 p-3">
                      <ProductPicker open={productPickerOpen} onOpenChange={setProductPickerOpen} onSelect={onSelectProduct} label="Trocar produto" />
                    </div>
                  </div>
                ) : (
                  <div className={`flex flex-col items-center gap-4 rounded-xl border border-dashed p-8 text-center ${fieldErrors.product ? "border-destructive bg-destructive/5" : ""}`}>
                    <PackageSearch className="h-10 w-10 text-muted-foreground" />
                    <div><h3 className="font-medium">Nenhum produto selecionado</h3><p className="text-sm text-muted-foreground">Busque por nome, ID, referência, código de barras ou NCM.</p></div>
                    <ProductPicker open={productPickerOpen} onOpenChange={setProductPickerOpen} onSelect={onSelectProduct} label="Selecionar produto" />
                  </div>
                )}
                {fieldErrors.product ? <p className="text-sm text-destructive">{fieldErrors.product}</p> : null}
              </TabsContent>

              <TabsContent value="content" className="m-0 space-y-5">
                <StepHeading number="2" title="Conteúdo do anúncio" description="Revise os dados comerciais já preenchidos a partir do cadastro do produto." />
                <FormSection title="Dados do anúncio">
                <div className="space-y-2">
                  <div className="flex items-center justify-between"><RequiredLabel>Título do anúncio</RequiredLabel><span className="text-xs text-muted-foreground">{form.title.length}/60</span></div>
                  <Input value={form.title} onChange={(event) => updateForm("title", event.target.value)} maxLength={60} disabled={creating} className={withError(fieldErrors.title || fieldErrors.family)} aria-invalid={Boolean(fieldErrors.title || fieldErrors.family || !form.title.trim())} />
                  {/* Em contas User Products o Mercado Livre recusa `title` e exige
                      `family_name`; o backend deriva esse nome deste mesmo título,
                      então o erro de família pertence a este campo. */}
                  {fieldErrors.title || fieldErrors.family ? <FieldError>{fieldErrors.title || fieldErrors.family}</FieldError> : null}
                </div>
                <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.description} onChange={(event) => updateForm("description", event.target.value)} rows={7} disabled={creating} className={fieldClass} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="SKU interno"><Input value={form.sku} onChange={(event) => updateForm("sku", event.target.value)} placeholder="Referência do ERP" disabled={creating} className={fieldClass} /></Field>
                  <Field label="GTIN / EAN"><Input value={form.gtin} onChange={(event) => updateIdentity("gtin", "GTIN", event.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={creating} className={withError(fieldErrors.gtin || fieldErrors["attr:GTIN"])} /><MaybeError value={fieldErrors.gtin || fieldErrors["attr:GTIN"]} /></Field>
                  <Field label="Marca"><Input value={form.brand} onChange={(event) => updateIdentity("brand", "BRAND", event.target.value)} disabled={creating} className={withError(fieldErrors["attr:BRAND"])} /><MaybeError value={fieldErrors["attr:BRAND"]} /></Field>
                  <Field label="Modelo"><Input value={form.model} onChange={(event) => updateIdentity("model", "MODEL", event.target.value)} disabled={creating} className={withError(fieldErrors["attr:MODEL"])} /><MaybeError value={fieldErrors["attr:MODEL"]} /></Field>
                  <Field label="Código / número da peça"><Input value={form.partNumber} onChange={(event) => updateIdentity("partNumber", "PART_NUMBER", event.target.value)} disabled={creating} className={withError(fieldErrors["attr:PART_NUMBER"])} /><MaybeError value={fieldErrors["attr:PART_NUMBER"]} /></Field>
                </div>
                </FormSection>
                <FormSection title="Garantia">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tipo de garantia"><Select value={form.warranty} onValueChange={(value) => { updateForm("warranty", value); if (value === "Sem garantia") updateForm("warrantyTime", ""); }} disabled={creating}><SelectTrigger className={fieldClass}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="Sem garantia">Sem garantia</SelectItem><SelectItem value="Garantia de fábrica">Garantia de fábrica</SelectItem><SelectItem value="Garantia do vendedor">Garantia do vendedor</SelectItem></SelectContent></Select></Field>
                  <Field label="Prazo da garantia"><Select value={form.warrantyTime} onValueChange={(value) => updateForm("warrantyTime", value)} disabled={creating || form.warranty === "Sem garantia"}><SelectTrigger className={fieldClass}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{["30 dias", "60 dias", "90 dias", "6 meses", "12 meses"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Field>
                </div>
                </FormSection>
              </TabsContent>

              <TabsContent value="media" className="m-0 space-y-5">
                <StepHeading number="3" title="Mídia do anúncio" description="Envie, reordene e escolha a capa. A primeira imagem é a principal no Mercado Livre." />
                <ListingMediaManager
                  value={form.pictureUrl}
                  onChange={(value) => updateForm("pictureUrl", value)}
                  produtoId={selectedProduct?.id ?? null}
                  productImageUrls={productImageUrls}
                  disabled={creating}
                />
                <MaybeError value={fieldErrors.images} />
              </TabsContent>

              <TabsContent value="category" className="m-0 space-y-5">
                <StepHeading number="4" title="Categoria e características" description="Escolha uma categoria final e preencha os atributos exigidos por ela." />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tipo no Mercado Livre"><Select value={form.categoryVertical} onValueChange={(value) => onChangeCategoryVertical(value as MarketplaceVertical)} disabled={creating}><SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="products">Produtos</SelectItem><SelectItem value="vehicles">Veículos</SelectItem><SelectItem value="real_estate">Imóveis</SelectItem><SelectItem value="services">Serviços</SelectItem></SelectContent></Select></Field>
                  <div className="space-y-2"><RequiredLabel>Categoria Mercado Livre</RequiredLabel><CategoryPicker {...{ form, creating, categoryPopoverOpen, onCategoryPopoverOpenChange, categorySearch, onCategorySearchChange, loadingCategories, categoryOptions, categoryParent, onBackCategoryLevel, onBrowseCategory, onSelectCategory }} /><MaybeError value={fieldErrors.category} /></div>
                </div>
                {loadingAttributes ? <LoadingBox>Carregando atributos da categoria...</LoadingBox> : null}
                {!form.categoryId ? <InfoBox>Selecione uma categoria para carregar suas características obrigatórias e opcionais.</InfoBox> : null}
                {form.categoryId && !loadingAttributes && categoryAttributes.length === 0 ? <InfoBox>Nenhum atributo adicional foi retornado para esta categoria.</InfoBox> : null}
                {!loadingAttributes && categoryAttributes.some((attribute) => attribute.required) ? <AttributeSection title="Obrigatórios" attributes={categoryAttributes.filter((attribute) => attribute.required)} {...{ form, creating, fieldErrors, updateDynamicAttribute }} /> : null}
                {!loadingAttributes && categoryAttributes.some((attribute) => !attribute.required) ? <AttributeSection title="Opcionais" attributes={categoryAttributes.filter((attribute) => !attribute.required)} {...{ form, creating, fieldErrors, updateDynamicAttribute }} /> : null}
              </TabsContent>

              <TabsContent value="offer" className="m-0 space-y-5">
                <StepHeading number="5" title="Oferta e envio" description="Defina preço, estoque, exposição, tarifa e a modalidade logística." />
                <SellerStatus info={listingCommercialInfo} loading={loadingListingCommercialInfo} />
                <FormSection title="Preço e estoque">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2"><RequiredLabel>Preço</RequiredLabel><ValueInput value={parseCurrency(form.price)} onValueChange={(value) => updateForm("price", formatCurrencyInput(value))} disabled={creating} className={withError(fieldErrors.price)} /><MaybeError value={fieldErrors.price} /></div>
                  <Field label="Estoque" required><Input type="number" min="0" step="1" value={form.availableQuantity} onChange={(event) => updateForm("availableQuantity", event.target.value)} disabled={creating} className={withError(fieldErrors.stock || (form.listingTypeId === "free" && Number(form.availableQuantity) > 1 ? "invalid" : undefined))} /><MaybeError value={fieldErrors.stock || (form.listingTypeId === "free" && Number(form.availableQuantity) > 1 ? "Anúncios grátis permitem estoque máximo de 1 unidade." : undefined)} /></Field>
                  <Field label="Condição" required><Select value={form.condition} onValueChange={(value) => updateForm("condition", value as ListingForm["condition"])} disabled={creating}><SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger><SelectContent>{conditionOptions.map((value) => <SelectItem key={value} value={value}>{value === "new" ? "Novo" : value === "used" ? "Usado" : "Não especificado"}</SelectItem>)}</SelectContent></Select></Field>
                </div>
                </FormSection>
                <div className="space-y-3">
                  <RequiredLabel>Tipo de anúncio</RequiredLabel>
                  {loadingListingCommercialInfo ? <LoadingBox>Consultando condições comerciais no Mercado Livre...</LoadingBox> : null}
                  <div className="grid gap-3 md:grid-cols-2">
                    {listingTypeOptions.filter((option) => isMercadoLivreListingTypeEnabled(option.id)).map((option) => {
                      const unavailable = option.available === false;
                      return <ListingTypeCard key={option.id} option={option} selected={option.id === form.listingTypeId} disabled={creating || unavailable} unavailable={unavailable} onSelect={() => updateForm("listingTypeId", option.id)} />;
                    })}
                  </div>
                  <MaybeError value={fieldErrors.listingType} />
                </div>
                <FormSection title="Envio" description="Defina como o produto será entregue ao comprador.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Modo de envio" required><Select value={form.shippingMode} onValueChange={(value) => updateForm("shippingMode", value)} disabled={creating || loadingAttributes || !form.categoryId}><SelectTrigger className={withError(fieldErrors.shipping)}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="me2">Mercado Envios</SelectItem><SelectItem value="custom">Envio personalizado</SelectItem><SelectItem value="pickup">Retirada / própria</SelectItem></SelectContent></Select></Field>
                  <Field label={form.shippingMode === "me2" ? "Logística" : "Alternativa"} required={form.shippingMode === "me2"}>{form.shippingMode === "me2" ? <Select value={form.logisticType} onValueChange={(value) => updateForm("logisticType", value)} disabled={creating || loadingAttributes || logisticOptions.length === 0}><SelectTrigger className={withError(fieldErrors.shipping)}><SelectValue placeholder={logisticOptions.length ? "Selecione" : "Informe preço, dimensões e peso"} /></SelectTrigger><SelectContent>{logisticOptions.map((option) => <SelectItem key={option.type} value={option.type}>{option.label || shippingLogisticLabel(option.type)}{option.default ? " · padrão" : ""}</SelectItem>)}</SelectContent></Select> : <Input value={form.shippingMode === "custom" ? form.customShippingDescription : "Retirada / entrega própria"} onChange={(event) => updateForm("customShippingDescription", event.target.value)} disabled={creating || form.shippingMode === "pickup"} className={withError(fieldErrors.shipping)} />}</Field>
                </div>
                </FormSection>
                {form.shippingMode === "me2" ? (
                  <FormSection title="Embalagem" description="Informe as medidas e o peso reais do pacote para calcular o frete.">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                      <Field label="Comprimento (cm)" required><Input value={form.lengthCm} onChange={(event) => updateForm("lengthCm", event.target.value)} inputMode="decimal" disabled={creating} className={withError(fieldErrors.dimensions)} /></Field>
                      <Field label="Largura (cm)" required><Input value={form.widthCm} onChange={(event) => updateForm("widthCm", event.target.value)} inputMode="decimal" disabled={creating} className={withError(fieldErrors.dimensions)} /></Field>
                      <Field label="Altura (cm)" required><Input value={form.heightCm} onChange={(event) => updateForm("heightCm", event.target.value)} inputMode="decimal" disabled={creating} className={withError(fieldErrors.dimensions)} /></Field>
                      <Field label="Peso (g)" required><Input value={form.weightGrams} onChange={(event) => updateForm("weightGrams", event.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={creating} className={withError(fieldErrors.dimensions)} /></Field>
                    </div>
                    {shippingEligibility.defaultDimensions ? <p className="text-xs text-muted-foreground">Referência da categoria: {shippingEligibility.defaultDimensions.length ?? "-"} × {shippingEligibility.defaultDimensions.width ?? "-"} × {shippingEligibility.defaultDimensions.height ?? "-"} cm, {shippingEligibility.defaultDimensions.weight ?? "-"} g. Informe as medidas reais.</p> : null}
                    <MercadoEnviosPanel state={mercadoEnvios} onRefresh={onRefreshMercadoEnvios} disabled={creating || missingShippingDimensions} />
                  </FormSection>
                ) : null}
                {form.shippingMode === "custom" ? <div className="grid gap-4 sm:grid-cols-3"><Field label="Valor do frete" required={!form.freeShipping}><ValueInput value={parseCurrency(form.customShippingCost)} onValueChange={(value) => updateForm("customShippingCost", formatCurrencyInput(value))} disabled={creating || form.freeShipping} className={withError(fieldErrors.shipping)} /></Field><Field label="Prazo (dias úteis)" required><Input value={form.customShippingDeadlineDays} onChange={(event) => updateForm("customShippingDeadlineDays", event.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={creating} className={withError(fieldErrors.shipping)} /></Field><Field label="Consulta por CEP"><Input value={form.customShippingQuoteZip} onChange={(event) => updateForm("customShippingQuoteZip", event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" disabled={creating} className={fieldClass} /></Field></div> : null}
                {form.shippingMode === "me2" ? (
                  <FreeShippingChooser
                    freeShipping={form.freeShipping}
                    mandatory={freeShippingMandatory}
                    policy={mercadoEnvios.freeShippingPolicy}
                    quotes={mercadoEnvios.quotes}
                    disabled={creating}
                    onChange={(value) => updateForm("freeShipping", value)}
                  />
                ) : (
                  <label className="flex items-center gap-3 rounded-md border p-3 text-sm"><Checkbox checked={form.freeShipping} onCheckedChange={(checked) => updateForm("freeShipping", checked === true)} disabled={creating} />Oferecer frete grátis</label>
                )}
                {mercadoEnviosBlockedReason ? <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{mercadoEnviosBlockedReason}</p> : null}
                {mercadoEnviosRestrictionNote ? <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{mercadoEnviosRestrictionNote}</p> : null}
                {mercadoEnviosIssue ? <ErrorBox>{mercadoEnviosIssue}</ErrorBox> : null}{customShippingIssue ? <ErrorBox>{customShippingIssue}</ErrorBox> : null}<MaybeError value={fieldErrors.shipping || fieldErrors.dimensions} />
              </TabsContent>

              <TabsContent value="review" className="m-0 space-y-5">
                <StepHeading number="6" title="Revisar anúncio" description="Confira o resumo e corrija qualquer pendência antes da publicação." />
                <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-5">
                    <div className="rounded-xl border bg-card p-4 shadow-sm"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Checklist de publicação</h3><p className="text-xs text-muted-foreground">O backend continuará sendo a fonte de verdade na publicação.</p></div>{issues.length ? <Badge className="bg-amber-600 text-white">{issues.length} pendência(s)</Badge> : <Badge className="bg-emerald-600 text-white">Pronto</Badge>}</div>
                      <div className="mt-4 space-y-4">{issues.length ? createListingSteps.map((item) => { const grouped = issuesByStep.get(item.value); if (!grouped?.length) return null; return <div key={item.value}><div className="mb-2 text-sm font-semibold">{item.value === "review" ? "Validação final" : item.title}</div><div className="space-y-2">{grouped.map((issue) => <div key={issue.message} className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" /><span className="min-w-0 flex-1">{issue.message}</span><Button size="sm" variant="outline" className="h-7 bg-background" onClick={() => onStepChange(issue.step)}>Corrigir</Button></div>)}</div></div>; }) : <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm"><Check className="h-4 w-4 text-emerald-600" />Todas as validações do wizard foram atendidas.</div>}</div>
                    </div>
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <Summary label="Produto ERP" value={selectedProduct ? `#${selectedProduct.id} · ${selectedProduct.titulo}` : "-"} />
                      <Summary label="Título" value={form.title} />
                      <Summary label="Categoria" value={form.categoryPath || form.categoryName || form.categoryId || "-"} />
                      <Summary label="Preço e estoque" value={`${formatCurrency(parseCurrency(form.price))} · ${form.availableQuantity || 0} unidade(s)`} />
                      <Summary label="Condição e tipo" value={`${conditionLabel(form.condition)} · ${selectedListingType?.name || form.listingTypeId || "-"}`} />
                      <Summary label="Tarifa e recebimento" value={`${selectedListingType?.saleFee != null ? formatCurrency(selectedListingType.saleFee) : "Taxa não calculada"} · ${selectedListingType?.netAmount != null ? `líquido ${formatCurrency(selectedListingType.netAmount)}` : "líquido não calculado"}`} />
                      <Summary label="Frete" value={form.shippingMode === "me2" ? `Mercado Envios · ${shippingLogisticLabel(form.logisticType)}` : form.shippingMode === "custom" ? `Personalizado · ${form.freeShipping ? "grátis" : formatCurrency(parseCurrency(form.customShippingCost))}` : "Retirada / própria"} />
                      <Summary label="Dimensões" value={form.shippingMode === "me2" ? `${form.lengthCm || "-"} × ${form.widthCm || "-"} × ${form.heightCm || "-"} cm · ${form.weightGrams || "-"} g` : "Não se aplica"} />
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold">Valor do anúncio no Mercado Livre</h4>
                            <Badge variant="outline" className="text-[11px]">Exclusivo ML</Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Altere o valor do anúncio para recalcular taxas, margem líquida e frete. O cadastro no ERP não será modificado.
                          </p>
                        </div>
                        <div className="w-full sm:w-44">
                          <ValueInput
                            value={parseCurrency(form.price)}
                            onValueChange={(value) => updateForm("price", formatCurrencyInput(value))}
                            disabled={creating}
                            className={withError(fieldErrors.price)}
                          />
                          <MaybeError value={fieldErrors.price} />
                        </div>
                      </div>
                    </div>
                    <ListingCostsSummary
                      price={parseCurrency(form.price)}
                      listingTypeName={selectedListingType?.name || form.listingTypeId}
                      shippingMode={form.shippingMode}
                      logisticLabel={shippingLogisticLabel(form.logisticType)}
                      costs={validation.costs}
                      fallbackSaleFee={selectedListingType?.saleFee ?? null}
                      fallbackFixedFee={selectedListingType?.fixedFee ?? null}
                      sellerShippingCost={selectedShippingQuote?.sellerShippingCost ?? null}
                    />
                    <ListingValidationPanel
                      state={validationState}
                      validation={validation}
                      canValidate={canValidate}
                      creating={creating}
                      onValidate={onValidate}
                    />
                    {categoryAttributes.some((attribute) => formatAttributeValue(attribute, form.dynamicAttributes)) ? <div className="rounded-xl border bg-card p-4 shadow-sm"><h3 className="font-semibold">Características principais</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{categoryAttributes.filter((attribute) => formatAttributeValue(attribute, form.dynamicAttributes)).slice(0, 10).map((attribute) => <Summary key={attribute.id} label={attribute.name} value={formatAttributeValue(attribute, form.dynamicAttributes)} compact />)}</div></div> : null}
                  </div>
                  <ListingPreview form={form} selectedListingType={selectedListingType} selectedPreviewImage={selectedPreviewImage} previewImages={previewImages} previewImageIndex={previewImageIndex} onPreviewImageIndexChange={onPreviewImageIndexChange} />
                </div>
              </TabsContent>
        </ListingStepper>
      </ListingDialogContent>
    </Dialog>
  );
}

function validationStateLabel(state: ListingValidationState, canValidate: boolean) {
  if (!canValidate) return "Corrija as pendências antes de validar.";
  if (state === "loading") return "Validando o anúncio no Mercado Livre...";
  if (state === "valid") return "Anúncio validado. Publicação liberada.";
  if (state === "invalid") return "O Mercado Livre recusou o anúncio. Corrija e valide novamente.";
  if (state === "stale") return "Os dados mudaram depois da validação. Valide novamente.";
  return "Execute Validar anúncio para liberar a publicação.";
}

function freeShippingPolicyText(policy: MercadoEnviosState["freeShippingPolicy"]) {
  if (policy === "mandatory") return "O Mercado Livre exige frete grátis para este anúncio.";
  if (policy === "optional") return "Frete grátis opcional para este anúncio.";
  if (policy === "unavailable") return "Frete grátis indisponível para este anúncio.";
  return "O Mercado Livre ainda não informou a política de frete grátis.";
}

function quoteCostText(quote: MercadoEnviosQuoteScenario | null | undefined) {
  if (!quote) return "não calculado";
  if (quote.error) return quote.error;
  if (quote.sellerShippingCost == null) return "não informado pelo Mercado Livre";
  return formatCurrency(quote.sellerShippingCost);
}

function MercadoEnviosPanel({ state, onRefresh, disabled }: { state: MercadoEnviosState; onRefresh: () => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">Mercado Envios</h4>
          {state.loading ? (
            <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Consultando</Badge>
          ) : state.loaded && state.available ? (
            <Badge className="gap-1 bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3" />Disponível · ME2</Badge>
          ) : state.loaded ? (
            <Badge className="gap-1 bg-destructive text-white"><XCircle className="h-3 w-3" />Indisponível</Badge>
          ) : (
            <Badge variant="outline">Aguardando dados</Badge>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={disabled || state.loading}>
          <TrendingUp className="h-4 w-4" />Consultar novamente
        </Button>
      </div>

      {state.loaded && state.available ? (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Logística" value={state.logistics.find((option) => option.type === state.logisticType)?.label || shippingLogisticLabel(state.logisticType ?? "")} compact />
          <Summary label="Política de frete grátis" value={freeShippingPolicyText(state.freeShippingPolicy)} compact />
          <Summary label="Peso da embalagem" value={state.physicalWeight != null ? `${state.physicalWeight} g` : "-"} compact />
          <Summary label="Peso faturável" value={state.billableWeight != null ? `${state.billableWeight} g` : "não informado"} compact />
        </div>
      ) : null}

      {state.error ? <ErrorBox>{state.error}</ErrorBox> : state.loaded && !state.available && state.message ? <ErrorBox>{state.message}</ErrorBox> : null}
      {state.warnings.length ? (
        <div className="mt-3 space-y-1">
          {state.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FreeShippingChooser({
  freeShipping,
  mandatory,
  policy,
  quotes,
  disabled,
  onChange,
}: {
  freeShipping: boolean;
  mandatory: boolean;
  policy: MercadoEnviosState["freeShippingPolicy"];
  quotes: MercadoEnviosState["quotes"];
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  if (mandatory) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        <p className="flex items-center gap-2 font-semibold"><LockKeyhole className="h-4 w-4" />Frete grátis obrigatório</p>
        <p className="mt-1 text-muted-foreground">{freeShippingPolicyText(policy)}</p>
        <p className="mt-2">Custo estimado do vendedor: <strong>{quoteCostText(quotes.freeShipping)}</strong></p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h4 className="text-sm font-semibold">Forma de envio</h4>
      <p className="text-xs text-muted-foreground">{freeShippingPolicyText(policy)}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange(false)}
          disabled={disabled}
          className={`rounded-lg border p-3 text-left text-sm transition ${freeShipping ? "border-border" : "border-primary ring-1 ring-primary/30"}`}
        >
          <span className="block font-medium">Frete calculado pelo Mercado Livre</span>
          <span className="block text-xs text-muted-foreground">Comprador paga o frete</span>
          <span className="mt-1 block">Custo estimado para o vendedor: <strong>{quoteCostText(quotes.buyerPaysShipping)}</strong></span>
        </button>
        <button
          type="button"
          onClick={() => onChange(true)}
          disabled={disabled || policy === "unavailable"}
          className={`rounded-lg border p-3 text-left text-sm transition disabled:opacity-60 ${freeShipping ? "border-primary ring-1 ring-primary/30" : "border-border"}`}
        >
          <span className="block font-medium">Frete grátis</span>
          <span className="block text-xs text-muted-foreground">Comprador não paga</span>
          <span className="mt-1 block">Custo estimado para o vendedor: <strong>{quoteCostText(quotes.freeShipping)}</strong></span>
        </button>
      </div>
    </div>
  );
}

/**
 * A comissão e a taxa fixa são componentes explicativos do custo total por
 * vender devolvido pelo Mercado Livre; nunca são somadas de novo ao total.
 */
function ListingCostsSummary({
  price,
  listingTypeName,
  shippingMode,
  logisticLabel,
  costs,
  fallbackSaleFee,
  fallbackFixedFee,
  sellerShippingCost,
}: {
  price: number;
  listingTypeName: string;
  shippingMode: string;
  logisticLabel: string;
  costs: ListingValidation["costs"];
  fallbackSaleFee: number | null;
  fallbackFixedFee: number | null;
  sellerShippingCost: number | null;
}) {
  const marketplaceCost = costs?.marketplaceCost ?? fallbackSaleFee;
  const fixedFee = costs?.fixedFee ?? fallbackFixedFee;
  const shippingCost = costs?.sellerShippingCost ?? sellerShippingCost;
  const percentageCost = marketplaceCost != null && fixedFee != null ? Math.max(marketplaceCost - fixedFee, 0) : null;
  const net = costs?.estimatedNetAmount ?? (marketplaceCost != null ? price - marketplaceCost - (shippingCost ?? 0) : null);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <h3 className="font-semibold">Resumo da publicação</h3>
      <p className="text-xs text-muted-foreground">
        Comissão percentual e taxa fixa detalham o custo total por vender informado pelo Mercado Livre; não são cobranças adicionais.
      </p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <Row label="Preço" value={formatCurrency(price)} />
        <Row label="Tipo de anúncio" value={listingTypeName || "-"} />
        <Row label="Mercado Envios" value={shippingMode === "me2" ? `ME2 · ${logisticLabel}` : shippingMode === "custom" ? "Envio personalizado" : "Retirada / própria"} />
        <Row label="Custo total por vender" value={marketplaceCost != null ? `-${formatCurrency(marketplaceCost)}` : "não calculado"} strong />
        {percentageCost != null ? <Row label="Comissão percentual" value={formatCurrency(percentageCost)} nested /> : null}
        {fixedFee != null ? <Row label="Taxa fixa" value={formatCurrency(fixedFee)} nested /> : null}
        <Row label="Custo estimado do envio" value={shippingCost != null ? `-${formatCurrency(shippingCost)}` : shippingMode === "me2" ? "não calculado" : "não se aplica"} />
        <div className="!mt-3 border-t pt-2">
          <Row label="Líquido estimado" value={net != null ? formatCurrency(net) : "não calculado"} strong />
        </div>
      </dl>
    </div>
  );
}

function Row({ label, value, strong, nested }: { label: string; value: string; strong?: boolean; nested?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${nested ? "pl-4 text-xs text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className={strong ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function ListingValidationPanel({
  state,
  validation,
  canValidate,
  creating,
  onValidate,
}: {
  state: ListingValidationState;
  validation: ListingValidation;
  canValidate: boolean;
  creating: boolean;
  onValidate: () => void;
}) {
  const tone =
    state === "valid" ? "bg-emerald-600" : state === "invalid" ? "bg-destructive" : state === "stale" ? "bg-amber-600" : "bg-muted-foreground";
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Validação do Mercado Livre</h3>
          <p className="text-xs text-muted-foreground">{validationStateLabel(state, canValidate)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`${tone} text-white`}>
            {state === "valid" ? "Válido" : state === "invalid" ? "Inválido" : state === "stale" ? "Revalidar" : state === "loading" ? "Validando" : "Não validado"}
          </Badge>
          <Button type="button" size="sm" variant="outline" onClick={onValidate} disabled={creating || !canValidate || state === "loading"}>
            {state === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}Validar anúncio
          </Button>
        </div>
      </div>

      {validation.checks.length ? (
        <div className="mt-3 space-y-1.5">
          {validation.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-2 text-sm">
              {check.status === "ok" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : check.status === "error" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              ) : check.status === "warning" ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className={check.status === "skipped" ? "text-muted-foreground" : ""}>{check.label}</span>
                {check.detail ? <span className="block text-xs text-muted-foreground">{check.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {validation.warnings.length ? (
        <div className="mt-3 space-y-1">
          {validation.warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProductPicker({ open, onOpenChange, onSelect, label }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (product: ProductRow) => void; label: string }) {
  return <ProductSelect open={open} setOpen={onOpenChange} permitirCriacao={false} apiEndpoint="/api/integracoes/mercadolivre/products?includeOutOfStock=1" isProductDisabled={(product) => Boolean((product as ProductRow).mercadolivre)} getProductDisabledReason={() => "Este produto já possui anúncio Mercado Livre vinculado."} OnSelect={(product: Produto) => { if (product.id) onSelect(product as ProductRow); }}><Button type="button" variant={label === "Selecionar produto" ? "default" : "outline"}><PackageSearch className="h-4 w-4" />{label}</Button></ProductSelect>;
}

function CategoryPicker(props: Pick<Props, "form" | "creating" | "categoryPopoverOpen" | "onCategoryPopoverOpenChange" | "categorySearch" | "onCategorySearchChange" | "loadingCategories" | "categoryOptions" | "categoryParent" | "onBackCategoryLevel" | "onBrowseCategory" | "onSelectCategory">) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const finalCategory = props.categoryParent?.childrenCount === 0 ? props.categoryParent : null;
  return (
    <Dialog open={props.categoryPopoverOpen} onOpenChange={props.onCategoryPopoverOpenChange}>
      <DialogTrigger asChild>
        <Button ref={triggerRef} type="button" variant="outline" className="h-auto min-h-11 w-full justify-between gap-3 px-3 py-2 text-left" disabled={props.creating}>
          <Tags className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block whitespace-normal font-medium">{props.form.categoryName || props.form.categoryId || "Selecionar categoria"}</span>
            {props.form.categoryPath ? <span className="mt-1 block whitespace-normal text-xs font-normal text-muted-foreground">{props.form.categoryPath}</span> : null}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">{props.form.categoryId ? "Alterar" : "Escolher"}</span>
          <ChevronRight className="h-4 w-4 shrink-0" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[min(640px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl" onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 pr-12 text-left">
          <DialogTitle>Escolher categoria</DialogTitle>
          <DialogDescription>Busque pelo nome do produto ou navegue até a categoria mais específica.</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none [&_[cmdk-input-wrapper]]:h-12 [&_[cmdk-input-wrapper]]:shrink-0 [&_[cmdk-input-wrapper]]:border-t [&_[cmdk-input-wrapper]]:px-5">
          <CommandInput aria-label="Buscar categoria pelo produto" value={props.categorySearch} onValueChange={props.onCategorySearchChange} placeholder="Ex.: pastilha de freio, filtro de óleo..." />
          <div className="flex shrink-0 items-start gap-2 border-b bg-muted/30 px-4 py-3">
            {props.categoryParent ? <Button type="button" size="sm" variant="outline" disabled={props.loadingCategories} onClick={props.onBackCategoryLevel}><ChevronLeft className="h-4 w-4" />Voltar</Button> : null}
            <div className="min-w-0 flex-1 self-center">
              <p className="text-sm font-medium">{props.categorySearch.trim().length >= 2 ? "Sugestões para o seu produto" : props.categoryParent ? "Categoria atual" : "Todas as categorias"}</p>
              {props.categoryParent ? <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{props.categoryParent.path || props.categoryParent.name}</p> : null}
            </div>
            {props.categorySearch ? <Button type="button" variant="ghost" size="sm" onClick={() => props.onCategorySearchChange("")}>Limpar busca</Button> : null}
          </div>
          <CommandList key={props.categoryParent?.id || props.categorySearch} aria-label="Categorias do Mercado Livre" aria-busy={props.loadingCategories} className="min-h-0 max-h-none flex-1 overflow-y-auto overscroll-contain touch-pan-y [scrollbar-gutter:stable]">
            {props.loadingCategories ? (
              <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Carregando categorias...</div>
            ) : finalCategory ? (
              <div className="space-y-4 p-5">
                <div className="rounded-lg border bg-muted/20 p-4"><p className="font-medium">{finalCategory.name}</p><p className="mt-1 text-sm text-muted-foreground">Categoria final. Confirme para carregar as características do anúncio.</p></div>
                <Button type="button" className="min-h-11 w-full" onClick={() => props.onSelectCategory(finalCategory)}>Usar esta categoria<Check className="h-4 w-4" /></Button>
              </div>
            ) : (
              <>
                <CommandEmpty>Nenhuma categoria encontrada. Tente outro nome para o produto.</CommandEmpty>
                <CommandGroup className="p-2">
                  {props.categoryOptions.map((category) => {
                    // Quantidade desconhecida de filhos exige consultar antes de selecionar.
                    const isFinal = category.childrenCount === 0;
                    return (
                      <CommandItem key={category.id} value={category.id} onSelect={() => isFinal ? props.onSelectCategory(category) : props.onBrowseCategory(category)} className="min-h-16 cursor-pointer gap-3 rounded-lg px-3 py-3">
                        {props.form.categoryId === category.id ? <CheckCircle2 className="h-5 w-5 text-primary" /> : <Tags className="h-5 w-5 opacity-60" />}
                        <span className="min-w-0 flex-1">
                          <span className="block whitespace-normal font-medium">{category.name}</span>
                          <span className="mt-1 block whitespace-normal break-words text-xs leading-relaxed text-muted-foreground">{category.path || category.domainName || (isFinal ? "Categoria final" : "Explorar subcategorias")}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">{isFinal ? "Selecionar" : "Abrir"}</span>
                        {isFinal ? <Check className="h-4 w-4 opacity-50" /> : <ChevronRight className="h-4 w-4" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-muted/20 px-5 py-3">
          <p className="text-xs text-muted-foreground">Use ↑ ↓ e Enter para navegar e escolher.</p>
          <Button type="button" variant="outline" onClick={() => props.onCategoryPopoverOpenChange(false)}>Cancelar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AttributeSection({ title, attributes, form, creating, fieldErrors, updateDynamicAttribute }: { title: string; attributes: MlCategoryAttribute[]; form: ListingForm; creating: boolean; fieldErrors: Record<string, string>; updateDynamicAttribute: (id: string, value: string) => void }) {
  return (
    <AttributeGroup title={title} count={attributes.length}>
      {attributes.map((attribute) => {
        const value = form.dynamicAttributes[attribute.id] ?? "";
        const disabled = creating || (attribute.fixed && Boolean(value));
        return (
          <AttributeCard key={attribute.id} {...attribute} error={fieldErrors[`attr:${attribute.id}`]}>
            <AttributeInput
              attribute={attribute}
              value={value}
              disabled={disabled}
              onChange={(next) => updateDynamicAttribute(attribute.id, next)}
              onUnitChange={(unit) => updateDynamicAttribute(`${attribute.id}__unit`, unit)}
              unit={form.dynamicAttributes[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || attribute.allowedUnits[0]?.name || ""}
            />
          </AttributeCard>
        );
      })}
    </AttributeGroup>
  );
}

function AttributeInput({ attribute, value, disabled, onChange, onUnitChange, unit }: { attribute: MlCategoryAttribute; value: string; disabled: boolean; onChange: (value: string) => void; onUnitChange: (value: string) => void; unit: string }) {
  if (attribute.values.length) return <ControlledAttributeInput {...{ attribute, value, disabled, onChange }} />;
  if (attribute.valueType === "boolean") return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className={fieldClass}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent><SelectItem value="true">Sim</SelectItem><SelectItem value="false">Não</SelectItem></SelectContent></Select>;
  if (attribute.valueType === "number_unit") return <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2"><Input type="number" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={fieldClass} /><Select value={unit} onValueChange={onUnitChange} disabled={disabled || attribute.allowedUnits.length === 0}><SelectTrigger className={fieldClass}><SelectValue placeholder="Un." /></SelectTrigger><SelectContent>{(attribute.allowedUnits.length ? attribute.allowedUnits : [{ id: attribute.defaultUnit ?? "", name: attribute.defaultUnit ?? "Un." }]).map((item) => <SelectItem key={`${attribute.id}:${item.id || item.name}`} value={item.id || item.name}>{item.name}</SelectItem>)}</SelectContent></Select></div>;
  return <Input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} className={fieldClass} />;
}

function ControlledAttributeInput({ attribute, value, disabled, onChange }: { attribute: MlCategoryAttribute; value: string; disabled: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(value);
  const filtered = attribute.values.filter((item) => `${item.name} ${item.id || ""}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80);
  return <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setQuery(value); }}><PopoverTrigger asChild><Button type="button" variant="outline" className={`${fieldClass} h-10 w-full justify-between font-normal`} disabled={disabled}><span className="truncate">{value || "Selecione ou digite"}</span><ChevronsUpDown className="h-4 w-4 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-[--radix-popover-trigger-width] p-0"><Command shouldFilter={false}><CommandInput value={query} onValueChange={(next) => { setQuery(next); onChange(next); }} /><CommandList><CommandEmpty><button type="button" className="w-full p-2 text-left text-sm" onClick={() => { onChange(query.trim()); setOpen(false); }}>Usar &quot;{query.trim()}&quot;</button></CommandEmpty><CommandGroup>{filtered.map((item) => <CommandItem key={`${attribute.id}:${item.id || item.name}`} value={item.name} onSelect={() => { onChange(item.name); setOpen(false); }}><Check className={`mr-2 h-4 w-4 ${value === item.name ? "opacity-100" : "opacity-0"}`} />{item.name}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent></Popover>;
}

function ListingTypeCard({ option, selected, disabled, unavailable, onSelect }: { option: ListingTypeOption; selected: boolean; disabled: boolean; unavailable: boolean; onSelect: () => void }) {
  return <button type="button" onClick={onSelect} disabled={disabled} className={`rounded-xl border p-4 text-left transition-colors ${selected ? "border-primary bg-primary/5 ring-2 ring-primary/20" : "bg-background hover:border-primary/50"} disabled:cursor-not-allowed ${unavailable ? "border-dashed bg-muted/40 opacity-60" : "disabled:opacity-55"}`}><div className="flex items-center justify-between gap-2"><span className="font-semibold">{option.name}</span>{unavailable ? <Badge variant="secondary" className="text-[10px]">Desabilitado</Badge> : selected ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}</div><div className="mt-3 space-y-1 text-xs text-muted-foreground">{unavailable ? <p className="text-destructive">{option.restrictionReason || "Esta modalidade não pode ser usada. Escolha Clássico ou Premium."}</p> : <><p>{option.saleFee != null ? `Taxa estimada: ${formatCurrency(option.saleFee)}` : "Taxa a calcular"}</p>{option.saleFeePercentage != null ? <p>{option.saleFeePercentage.toLocaleString("pt-BR")}% do valor{option.fixedFee ? ` + ${formatCurrency(option.fixedFee)} fixa` : ""}</p> : null}{option.netAmount != null ? <p className="font-medium text-foreground">Você recebe: {formatCurrency(option.netAmount)}</p> : null}{option.exposure ? <p>Exposição: {option.exposure}</p> : null}{option.interestFreeInstallments ? <p>Parcelamento sem juros</p> : null}</>}</div></button>;
}

function SellerStatus({ info, loading }: { info: ListingCommercialInfo; loading: boolean }) { const blocked = info.seller?.canList === false; return <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${blocked ? "border-destructive/40 bg-destructive/5 text-destructive" : "bg-muted/20"}`}>{loading ? <Loader2 className="mt-0.5 h-4 w-4 animate-spin" /> : blocked ? <XCircle className="mt-0.5 h-4 w-4" /> : <Check className="mt-0.5 h-4 w-4 text-emerald-600" />}<div><p className="font-medium">Conta vendedora</p><p className="text-xs text-muted-foreground">{loading ? "Consultando condições comerciais no Mercado Livre..." : blocked ? info.seller?.restrictions.join(" ") || "Publicação bloqueada pelo Mercado Livre." : "Autorizada a publicar"}</p>{info.error ? <p className="text-xs text-destructive">{info.error}</p> : null}</div></div>; }

function ListingPreview({ form, selectedListingType, selectedPreviewImage, previewImages, previewImageIndex, onPreviewImageIndexChange }: { form: ListingForm; selectedListingType: ListingTypeOption | null; selectedPreviewImage: string; previewImages: string[]; previewImageIndex: number; onPreviewImageIndexChange: (index: number) => void }) { return <aside className="overflow-hidden rounded-2xl border bg-muted/20 p-3 shadow-sm lg:sticky lg:top-0"><div className="mb-3 flex items-center justify-between px-1"><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Prévia do anúncio</p><p className="text-[11px] text-muted-foreground">Como o comprador verá seu produto</p></div><Badge variant="secondary" className="text-[10px]">Mercado Livre</Badge></div><div className="overflow-hidden rounded-xl border bg-background shadow-sm"><div className="aspect-square bg-muted/60">{selectedPreviewImage ? <img src={selectedPreviewImage} alt={form.title || "Prévia"} className="h-full w-full object-contain" /> : <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground"><ImageIcon className="h-8 w-8" /><span className="text-xs">Sem imagem</span></div>}</div>{previewImages.length > 1 ? <div className="flex gap-2 overflow-x-auto border-t p-2">{previewImages.map((url, index) => <button key={`${url}:${index}`} type="button" onClick={() => onPreviewImageIndexChange(index)} className={`h-10 w-10 shrink-0 overflow-hidden rounded-md border transition-all hover:opacity-100 ${index === previewImageIndex ? "border-primary ring-2 ring-primary/30" : "opacity-60"}`}><img src={url} alt="" className="h-full w-full object-cover" /></button>)}</div> : null}<div className="space-y-3 p-4"><p className="line-clamp-2 font-medium leading-snug">{form.title || "Título do anúncio"}</p><p className="text-2xl font-semibold tracking-tight">{formatCurrency(parseCurrency(form.price))}</p><div className="grid grid-cols-2 gap-2 text-xs"><Summary label="Estoque" value={form.availableQuantity || "0"} compact /><Summary label="Tipo" value={selectedListingType?.name || "Não definido"} compact /></div><p className="border-t pt-3 text-xs text-muted-foreground">{form.categoryName || "Categoria não informada"}</p></div></div></aside>; }

function ProductDetail({ label, value }: { label: string; value?: string | null }) { return <div><span className="text-xs text-muted-foreground">{label}</span><p className="truncate font-medium">{value || "Não informado"}</p></div>; }
function StockBadge({ product }: { product: ProductRow }) { const out = Number(product.estoque) <= 0; return <Badge className={out ? "bg-destructive text-destructive-foreground" : "bg-emerald-600 text-white"}>{product.status_estoque ? product.status_estoque.replaceAll("_", " ") : out ? "SEM ESTOQUE" : "EM ESTOQUE"}</Badge>; }

function parseCurrency(value: string) { const number = Number(value.replace(/\./g, "").replace(",", ".")); return Number.isFinite(number) ? number : 0; }
function formatCurrencyInput(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
function formatCurrency(value: unknown) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0)); }
function conditionLabel(value: string) { return value === "new" ? "Novo" : value === "used" ? "Usado" : "Não especificado"; }
function shippingLogisticLabel(value: string) { const labels: Record<string, string> = { drop_off: "Postagem em agência", xd_drop_off: "Postagem em ponto parceiro", cross_docking: "Coleta do Mercado Livre", fulfillment: "Full", self_service: "Flex", custom: "Personalizada" }; return labels[value] || value || "Não definida"; }
function formatAttributeValue(attribute: MlCategoryAttribute, values: Record<string, string>) { const value = values[attribute.id] ?? ""; if (!value) return ""; if (attribute.valueType === "number_unit") { const unit = values[`${attribute.id}__unit`] || attribute.defaultUnit || attribute.allowedUnits[0]?.id || ""; return `${value}${unit ? ` ${unit}` : ""}`; } if (attribute.valueType === "boolean") return value === "true" ? "Sim" : value === "false" ? "Não" : value; return value; }
