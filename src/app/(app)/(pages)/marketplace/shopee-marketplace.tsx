"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Eye, Heart, ImagePlus, Info, LayoutDashboard, Link2, Loader2, PackageSearch, Plus, RefreshCcw, Search, Settings2, ShoppingBag, Star, Store, TrendingUp, UploadCloud } from "lucide-react";
import ProductSelect from "@/app/(app)/components/productSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { prepareProductImageForUpload, productImageUploadError } from "@/lib/product-image-upload";
import { MarketplaceConversationPanel } from "./marketplace-conversation-panel";
import { MarketplaceAttentionCenter, MarketplaceChatLauncher, MarketplaceHeader, MarketplaceListToolbar, MarketplaceLoadingLine, MarketplacePagination, MarketplaceSectionNav, useMarketplaceQueryValue, useMarketplaceSection, type MarketplaceAttentionItem } from "./marketplace-layout";

type Dashboard = {
  accounts: Array<{ id: number; shop_id: number; shop_name?: string | null; region: string; expires_at?: string | null; updated_at?: string | null }>;
  orders: Array<{ id: number; venda_id?: number | null; order_sn: string; status?: string | null; buyer_username?: string | null; currency?: string | null; total_amount?: number | null; tracking_number?: string | null; shipping_carrier?: string | null; create_time?: string | null; import_status?: string | null; import_error?: string | null }>;
  links: Array<{ id: number; produto_id: number; item_id: number; model_id?: number | null; title?: string | null; item_sku?: string | null; model_sku?: string | null; status?: string | null }>;
  configuration: { ready: boolean; missing: string[] };
};
type ProductPagination = { page: number; limit: number; total: number; totalPages: number };

type Product = { id: number; titulo: string; descricao?: string | null; referencia?: string | null; precovenda?: number | null; estoque?: number | null; imageUrls?: string[]; shopee?: Dashboard["links"][number] | null };
type RemoteItem = { item_id: number; item_name?: string; item_sku?: string; item_status?: string; price_info?: Array<{ current_price?: number; original_price?: number }>; stock_info_v2?: { summary_info?: { total_available_stock?: number } } };
type Conversation = { conversation_id: string | number; to_id?: number; buyer_id?: number; to_name?: string; buyer_username?: string; unread_count?: number; latest_message_content?: { text?: string } };
type ShopeeMessage = { message_id?: string | number; id?: string | number; from_id?: number; to_id?: number; message_type?: string; content?: { text?: string }; created_timestamp?: number };
type ShopeeTab = "overview" | "products" | "listings" | "orders" | "performance";
const SHOPEE_MARKETPLACE_SECTIONS: readonly ShopeeTab[] = ["overview", "products", "listings", "orders", "performance"];
type ShopeePerformance = { items: Array<{ item_id: number; views?: number; view_count?: number; likes?: number; like_count?: number; sale?: number; sold?: number; sold_quantity?: number; comment_count?: number; rating_count?: number; link?: { title?: string; produto_id?: number } | null }>; summary: { views: number; likes: number; sales: number; comments: number } };
type ShopeeAttribute = { id: number; name: string; required: boolean; inputType: string; maxValueCount?: number; allowCustomValue: boolean; units: string[]; values: Array<{ id: number | null; name: string; originalName?: string; unit?: string | null }> };
type ShopeeCategory = { id: number; parentId: number; name: string; hasChildren: boolean };
type ShopeeBrand = { id: number; name: string; originalName: string };
type PublishStep = "product" | "content" | "category" | "shipping";

function emptyPublishForm() {
  return { produtoId: "", title: "", description: "", categoryId: "", brandId: "", brandName: "", brandOriginalName: "", condition: "NEW", price: "", stock: "", weight: "", length: "", width: "", height: "", logisticId: "" };
}

export default function ShopeeMarketplace() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [linkedProducts, setLinkedProducts] = useState<Product[]>([]);
  const [productPagination, setProductPagination] = useState<ProductPagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [productSearchInput, setProductSearchInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [selectedPublishProduct, setSelectedPublishProduct] = useState<Product | null>(null);
  const [selectedProductLoading, setSelectedProductLoading] = useState(false);
  const [publishImageUploading, setPublishImageUploading] = useState(false);
  const publishImageInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useMarketplaceSection(SHOPEE_MARKETPLACE_SECTIONS, "overview");
  const [orderSearch, setOrderSearch] = useMarketplaceQueryValue("sp_pedido_busca");
  const [orderStatusFilter, setOrderStatusFilter] = useMarketplaceQueryValue("sp_pedido_status", "all");
  const [orderPage, setOrderPage] = useState(1);
  const [orderPageSize, setOrderPageSize] = useState(20);
  const [listingSearch, setListingSearch] = useMarketplaceQueryValue("sp_anuncio_busca");
  const [listingStatusFilter, setListingStatusFilter] = useMarketplaceQueryValue("sp_anuncio_status", "all");
  const [listingPage, setListingPage] = useState(1);
  const [listingPageSize, setListingPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingLink, setSavingLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ produtoId: "", itemId: "", modelId: "", itemSku: "", modelSku: "" });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [remoteItems, setRemoteItems] = useState<RemoteItem[]>([]);
  const [remoteSelections, setRemoteSelections] = useState<Record<string, string>>({});
  const [publishForm, setPublishForm] = useState(emptyPublishForm);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishStep, setPublishStep] = useState<PublishStep>("product");
  const [categoryAttributes, setCategoryAttributes] = useState<ShopeeAttribute[]>([]);
  const [categoryBrands, setCategoryBrands] = useState<ShopeeBrand[]>([]);
  const [categoryBrandRequired, setCategoryBrandRequired] = useState(false);
  const [categories, setCategories] = useState<ShopeeCategory[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesAttempted, setCategoriesAttempted] = useState(false);
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({});
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesError, setAttributesError] = useState<string | null>(null);
  const [attributesCategoryId, setAttributesCategoryId] = useState("");
  const [logistics, setLogistics] = useState<Array<{ id: number; name: string; logistics_channel_id?: number; logistic_id?: number; logistics_channel_name?: string; logistic_name?: string; enabled: boolean; compulsory?: boolean; minWeight?: number | null; maxWeight?: number | null }>>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ShopeeMessage[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const [messageText, setMessageText] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoaded, setChatLoaded] = useState(false);
  const [performance, setPerformance] = useState<ShopeePerformance | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceAttempted, setPerformanceAttempted] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", sku: "" });
  const account = data?.accounts[0];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashboardResponse, productResponse] = await Promise.all([
        fetch("/api/integracoes/shopee/dashboard", { cache: "no-store" }),
        fetch(`/api/integracoes/shopee/products?page=${productPagination.page}&limit=${productPagination.limit}&search=${encodeURIComponent(productSearch)}`, { cache: "no-store" }),
      ]);
      const dashboard = await dashboardResponse.json();
      if (!dashboardResponse.ok) throw new Error(dashboard.error || "Falha ao carregar Shopee.");
      setData(dashboard);
      if (productResponse.ok) {
        const productJson = await productResponse.json();
        setProducts(productJson.products ?? []);
        setLinkedProducts(productJson.linkedProducts ?? []);
        setProductPagination(productJson.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 1 });
      }
    } catch (error: any) {
      toast.error("Erro ao carregar Shopee", { description: error?.message });
    } finally {
      setLoading(false);
    }
  }, [productPagination.page, productPagination.limit, productSearch]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProductPagination((current) => ({ ...current, page: 1 }));
      setProductSearch(productSearchInput.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [productSearchInput]);

  useEffect(() => { setOrderPage(1); }, [orderSearch, orderStatusFilter, orderPageSize]);
  useEffect(() => { setListingPage(1); }, [listingSearch, listingStatusFilter, listingPageSize]);

  useEffect(() => {
    if (!account) return;
    void fetch("/api/integracoes/shopee/metadata?type=logistics", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(await response.json()))
      .then((json) => setLogistics(json.data ?? []))
      .catch(() => setLogistics([]));
  }, [account]);

  useEffect(() => {
    if (chatOpen && account && !chatLoaded) void loadConversations();
  }, [chatOpen, account, chatLoaded]);

  useEffect(() => {
    if (activeTab === "performance" && account && !performanceAttempted) void loadPerformance();
  }, [activeTab, account, performanceAttempted]);

  useEffect(() => {
    if (!publishOpen || categoriesAttempted) return;
    void loadCategories();
  }, [publishOpen, categoriesAttempted]);

  useEffect(() => {
    const categoryId = Number(publishForm.categoryId);
    if (!publishOpen || !Number.isInteger(categoryId) || categoryId <= 0) {
      setCategoryAttributes([]);
      setAttributesError(null);
      return;
    }
    const timer = window.setTimeout(() => void loadCategoryAttributes(categoryId), 350);
    return () => window.clearTimeout(timer);
  }, [publishOpen, publishForm.categoryId]);

  async function syncOrders() {
    setSyncing(true);
    try {
      const response = await fetch("/api/integracoes/shopee/sync-orders", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 15 }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao sincronizar pedidos.");
      toast.success("Pedidos Shopee sincronizados", { description: `${json.created || 0} nova(s) venda(s) importada(s).` });
      await load();
    } catch (error: any) {
      toast.error("Erro na sincronização Shopee", { description: error?.message });
    } finally {
      setSyncing(false);
    }
  }

  async function saveLink() {
    setSavingLink(true);
    try {
      const product = products.find((row) => String(row.id) === linkForm.produtoId);
      const response = await fetch("/api/integracoes/shopee/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...linkForm, title: product?.titulo }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao salvar vínculo.");
      toast.success("Produto vinculado à Shopee");
      setLinkForm({ produtoId: "", itemId: "", modelId: "", itemSku: "", modelSku: "" });
      await load();
    } catch (error: any) {
      toast.error("Erro ao vincular produto", { description: error?.message });
    } finally {
      setSavingLink(false);
    }
  }

  async function syncCatalog() {
    setCatalogLoading(true);
    try {
      const response = await fetch("/api/integracoes/shopee/products?refresh=1", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao sincronizar catálogo.");
      setProducts(json.products ?? []);
      setRemoteItems(json.remoteItems ?? []);
      if (json.remoteError) toast.warning("Catálogo parcialmente carregado", { description: json.remoteError });
      else toast.success("Catálogo Shopee atualizado", { description: `${json.remoteItems?.length || 0} anúncio(s) consultado(s).` });
      await load();
    } catch (error: any) {
      toast.error("Erro no catálogo", { description: error?.message });
    } finally {
      setCatalogLoading(false);
    }
  }

  async function loadPerformance() {
    setPerformanceAttempted(true);
    setPerformanceLoading(true);
    setPerformanceError(null);
    try {
      const response = await fetch("/api/integracoes/shopee/performance", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao consultar desempenho.");
      setPerformance(json);
    } catch (error: any) {
      setPerformanceError(error?.message || "Falha ao consultar desempenho Shopee.");
    } finally {
      setPerformanceLoading(false);
    }
  }

  async function loadCategoryAttributes(categoryId: number) {
    setAttributesLoading(true);
    setAttributesError(null);
    setAttributesCategoryId("");
    try {
      const [attributesResponse, brandsResponse] = await Promise.all([
        fetch(`/api/integracoes/shopee/metadata?type=attributes&categoryId=${categoryId}`, { cache: "no-store" }),
        fetch(`/api/integracoes/shopee/metadata?type=brands&categoryId=${categoryId}`, { cache: "no-store" }),
      ]);
      const [attributesJson, brandsJson] = await Promise.all([attributesResponse.json(), brandsResponse.json()]);
      if (!attributesResponse.ok) throw new Error(attributesJson.error || "Falha ao consultar atributos da categoria.");
      const loadedBrands: ShopeeBrand[] = brandsResponse.ok && Array.isArray(brandsJson.data) ? brandsJson.data : [];
      const brandRequired = Boolean(brandsResponse.ok && brandsJson.required);
      const noBrand = loadedBrands.find((brand) => brand.id === 0);
      setCategoryAttributes(Array.isArray(attributesJson.data) ? attributesJson.data : []);
      setCategoryBrands(loadedBrands);
      setCategoryBrandRequired(brandRequired);
      setAttributeValues({});
      setPublishForm((current) => ({
        ...current,
        brandId: brandRequired && noBrand ? String(noBrand.id) : "",
        brandName: brandRequired && noBrand ? noBrand.name : "",
        brandOriginalName: brandRequired && noBrand ? noBrand.originalName : "",
      }));
      setAttributesCategoryId(String(categoryId));
    } catch (error: any) {
      setCategoryAttributes([]);
      setCategoryBrands([]);
      setCategoryBrandRequired(false);
      setAttributesCategoryId("");
      const message = String(error?.message || "Não foi possível consultar os atributos da categoria.");
      setAttributesError(message.includes("Módulo Shopee não autorizado") ? `${message} Publique a versão atual da Figo Central e tente novamente.` : message);
    } finally {
      setAttributesLoading(false);
    }
  }

  async function loadCategories() {
    setCategoriesAttempted(true);
    setCategoriesLoading(true);
    try {
      const response = await fetch("/api/integracoes/shopee/metadata?type=categories", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao consultar categorias.");
      setCategories(Array.isArray(json.data) ? json.data : []);
    } catch (error: any) {
      toast.error("Categorias Shopee indisponíveis", { description: error?.message });
    } finally {
      setCategoriesLoading(false);
    }
  }

  async function linkRemoteItem(item: RemoteItem) {
    const produtoId = remoteSelections[String(item.item_id)];
    if (!produtoId) return;
    setSavingLink(true);
    try {
      const response = await fetch("/api/integracoes/shopee/product-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId, itemId: item.item_id, itemSku: item.item_sku || null, title: item.item_name || null }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao vincular anúncio.");
      toast.success("Anúncio vinculado ao produto do ERP");
      setRemoteItems((current) => current.filter((row) => Number(row.item_id) !== Number(item.item_id)));
      await load();
    } catch (error: any) {
      toast.error("Erro ao vincular anúncio", { description: error?.message });
    } finally {
      setSavingLink(false);
    }
  }

  function choosePublishProduct(produtoId: string) {
    const product = products.find((row) => String(row.id) === produtoId);
    if (product) choosePublishProductData(product);
  }

  function choosePublishProductData(product: Product) {
    if ((data?.links ?? []).some((link) => Number(link.produto_id) === Number(product.id))) {
      toast.warning("Produto já anunciado", { description: "Este produto já possui um anúncio Shopee vinculado." });
      return;
    }
    setSelectedPublishProduct(product);
    setPublishForm((current) => ({
      ...current,
      produtoId: String(product.id),
      title: product.titulo || "",
      description: product.descricao || product.titulo || "",
      price: String(product.precovenda ?? ""),
      stock: String(Math.max(0, Math.trunc(Number(product.estoque || 0)))),
    }));
  }

  async function choosePublishProductFromPicker(product: Product) {
    choosePublishProductData(product);
    setSelectedProductLoading(true);
    try {
      const response = await fetch(`/api/integracoes/shopee/products?search=${encodeURIComponent(`#${product.id}`)}&page=1&limit=10`, { cache: "no-store" });
      const json = await response.json();
      const detailed = (json.products ?? []).find((row: Product) => Number(row.id) === Number(product.id));
      if (response.ok && detailed) choosePublishProductData(detailed);
    } catch {
      // A API de publicação ainda buscará todas as imagens diretamente no banco.
    } finally {
      setSelectedProductLoading(false);
    }
  }

  async function uploadPublishProductImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedPublishProduct) return;
    const productId = selectedPublishProduct.id;

    setPublishImageUploading(true);
    try {
      const preparedFile = await prepareProductImageForUpload(file);
      const form = new FormData();
      form.append("files", preparedFile);
      const response = await fetch(`/api/products/${productId}/images`, { method: "POST", body: form });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Falha ao enviar a imagem do produto.");
      const uploadedUrls = (Array.isArray(json.imagens) ? json.imagens : []).map((image: any) => String(image?.url || "").trim()).filter(Boolean);
      if (!uploadedUrls.length) throw new Error("O upload foi concluído sem retornar a imagem salva.");
      const mergeImageUrls = (product: Product) => ({ ...product, imageUrls: Array.from(new Set([...(product.imageUrls ?? []), ...uploadedUrls])) });
      setSelectedPublishProduct((current) => current && Number(current.id) === Number(productId) ? mergeImageUrls(current) : current);
      setProducts((current) => current.map((product) => Number(product.id) === Number(productId) ? mergeImageUrls(product) : product));
      toast.success("Imagem adicionada", { description: "A imagem já está pronta para a publicação na Shopee." });
    } catch (error) {
      toast.error("Não foi possível adicionar a imagem", { description: productImageUploadError(error, file.name) });
    } finally {
      setPublishImageUploading(false);
    }
  }

  async function recommendCategory() {
    if (!publishForm.title) return;
    try {
      const response = await fetch(`/api/integracoes/shopee/metadata?type=recommend-category&itemName=${encodeURIComponent(publishForm.title)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Categoria não encontrada.");
      const categoryId = json.data?.category_id_list?.[0]?.category_id ?? json.data?.category_id_list?.[0] ?? json.data?.category_id;
      if (!categoryId) throw new Error("A Shopee não sugeriu uma categoria para este produto.");
      setCategorySearch("");
      setPublishForm((current) => ({ ...current, categoryId: String(categoryId) }));
      toast.success("Categoria sugerida pela Shopee", { description: `Categoria ${categoryId}` });
    } catch (error: any) {
      toast.error("Não foi possível sugerir a categoria", { description: error?.message });
    }
  }

  async function publishProduct() {
    setSavingLink(true);
    try {
      const response = await fetch("/api/integracoes/shopee/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...publishForm, logisticIds: [publishForm.logisticId], attributeValues }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao publicar produto.");
      toast.success("Produto publicado na Shopee", { description: `Item ID ${json.link?.item_id || json.item?.item_id}` });
      resetPublishDraft();
      closePublishDialog();
      await load();
    } catch (error: any) {
      toast.error("Publicação recusada", { description: error?.message });
    } finally {
      setSavingLink(false);
    }
  }

  function resetPublishDraft() {
    setPublishForm(emptyPublishForm());
    setSelectedPublishProduct(null);
    setSelectedProductLoading(false);
    setPublishImageUploading(false);
    setProductPickerOpen(false);
    setPublishStep("product");
    setCategorySearch("");
    setCategoryAttributes([]);
    setCategoryBrands([]);
    setCategoryBrandRequired(false);
    setAttributeValues({});
    setAttributesLoading(false);
    setAttributesError(null);
    setAttributesCategoryId("");
  }

  function closePublishDialog() {
    setPublishOpen(false);
  }

  function handlePublishOpenChange(open: boolean) {
    if (open) {
      setPublishOpen(true);
      setPublishStep("product");
      return;
    }
    closePublishDialog();
  }

  async function updateListing(product: Product, action: "sync" | "unlist" | "relist" | "delete") {
    if (action === "delete" && !window.confirm(`Excluir definitivamente o anúncio Shopee de ${product.titulo}? Esta ação não pode ser desfeita.`)) return;
    try {
      const response = await fetch("/api/integracoes/shopee/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ produtoId: product.id, action, stock: Math.max(0, Math.trunc(Number(product.estoque || 0))), price: Number(product.precovenda || 0) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao atualizar anúncio.");
      toast.success(action === "sync" ? "Preço e estoque enviados" : action === "unlist" ? "Anúncio pausado" : action === "relist" ? "Anúncio reativado" : "Anúncio excluído da Shopee");
      await load();
    } catch (error: any) {
      toast.error("Erro ao atualizar Shopee", { description: error?.message });
    }
  }

  function openEditListing(product: Product) {
    setEditingProduct(product);
    setEditForm({ title: product.titulo || "", description: product.descricao || "", sku: product.referencia || "" });
  }

  async function saveListingEdit() {
    if (!editingProduct) return;
    setSavingLink(true);
    try {
      const response = await fetch("/api/integracoes/shopee/products", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ produtoId: editingProduct.id, action: "edit", ...editForm }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao editar anúncio.");
      toast.success("Anúncio Shopee atualizado");
      setEditingProduct(null);
      await load();
    } catch (error: any) {
      toast.error("Alteração recusada", { description: error?.message });
    } finally {
      setSavingLink(false);
    }
  }

  async function loadConversations() {
    setChatLoaded(true);
    setChatLoading(true);
    setChatError(null);
    try {
      const response = await fetch("/api/integracoes/shopee/messages", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao carregar conversas.");
      setConversations(json.conversations ?? []);
    } catch (error: any) {
      const message = String(error?.message || "Falha ao carregar mensagens.");
      setChatError(message.includes("Módulo Shopee não autorizado") ? `${message} O gateway publicado está desatualizado; publique a versão atual da Figo Central.` : message);
    } finally {
      setChatLoading(false);
    }
  }

  async function openConversation(conversation: Conversation) {
    setSelectedConversation(conversation);
    setChatLoading(true);
    try {
      const response = await fetch(`/api/integracoes/shopee/messages?conversationId=${encodeURIComponent(String(conversation.conversation_id))}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao carregar mensagens.");
      setMessages(json.messages ?? []);
      await fetch("/api/integracoes/shopee/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", conversationId: conversation.conversation_id }) });
    } catch (error: any) {
      toast.error("Erro no atendimento", { description: error?.message });
    } finally {
      setChatLoading(false);
    }
  }

  async function sendMessage() {
    const toId = selectedConversation?.to_id || selectedConversation?.buyer_id;
    if (!toId || !messageText.trim()) return;
    setChatLoading(true);
    try {
      const response = await fetch("/api/integracoes/shopee/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ toId, text: messageText }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Falha ao enviar mensagem.");
      setMessageText("");
      await openConversation(selectedConversation!);
    } catch (error: any) {
      toast.error("Mensagem não enviada", { description: error?.message });
      setChatLoading(false);
    }
  }

  const importErrors = useMemo(() => (data?.orders ?? []).filter((order) => order.import_error).length, [data?.orders]);
  const filteredOrders = useMemo(() => {
    const term = orderSearch.trim().toLocaleLowerCase("pt-BR");
    return (data?.orders ?? []).filter((order) => {
      const matchesSearch = !term || [order.order_sn, order.buyer_username, order.tracking_number, order.shipping_carrier, order.venda_id]
        .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term));
      const status = String(order.status ?? "").toUpperCase();
      const matchesStatus = orderStatusFilter === "all"
        || (orderStatusFilter === "error" && Boolean(order.import_error))
        || (orderStatusFilter === "pending_erp" && !order.venda_id)
        || status === orderStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data?.orders, orderSearch, orderStatusFilter]);
  const orderTotalPages = Math.max(1, Math.ceil(filteredOrders.length / orderPageSize));
  const safeOrderPage = Math.min(orderPage, orderTotalPages);
  const paginatedOrders = filteredOrders.slice((safeOrderPage - 1) * orderPageSize, safeOrderPage * orderPageSize);
  const filteredListings = useMemo(() => {
    const term = listingSearch.trim().toLocaleLowerCase("pt-BR");
    return linkedProducts.filter((product) => {
      const matchesSearch = !term || [product.id, product.titulo, product.referencia, product.shopee?.item_id, product.shopee?.item_sku]
        .some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(term));
      const status = String(product.shopee?.status ?? "").toUpperCase();
      return matchesSearch && (listingStatusFilter === "all" || status === listingStatusFilter);
    });
  }, [linkedProducts, listingSearch, listingStatusFilter]);
  const listingTotalPages = Math.max(1, Math.ceil(filteredListings.length / listingPageSize));
  const safeListingPage = Math.min(listingPage, listingTotalPages);
  const paginatedListings = filteredListings.slice((safeListingPage - 1) * listingPageSize, safeListingPage * listingPageSize);
  const unlinkedRemoteItems = useMemo(() => {
    const linkedIds = new Set((data?.links ?? []).map((link) => Number(link.item_id)));
    return remoteItems.filter((item) => !linkedIds.has(Number(item.item_id)));
  }, [data?.links, remoteItems]);
  const shopeeUnreadCount = conversations.reduce((sum, item) => sum + Number(item.unread_count || 0), 0);
  const marketplaceAttentionItems: MarketplaceAttentionItem[] = [];
  if (!data?.configuration.ready) marketplaceAttentionItems.push({ id: "configuration", title: "Aplicativo Shopee incompleto", description: "Finalize as variáveis da integração antes de operar o canal.", tone: "danger", actionLabel: "Configurar", onAction: () => window.location.assign("/configuracoes/geral") });
  else if (!account) marketplaceAttentionItems.push({ id: "connection", title: "Conectar loja Shopee", description: "Autorize a conta vendedora nas Configurações Gerais.", tone: "danger", actionLabel: "Conectar", onAction: () => window.location.assign("/configuracoes/geral") });
  if (importErrors > 0) marketplaceAttentionItems.push({ id: "orders", title: "Pedidos com erro de importação", description: "Pedidos recebidos pela Shopee precisam de correção para gerar a venda.", count: importErrors, tone: "danger", actionLabel: "Revisar", onAction: () => { setOrderStatusFilter("error"); setActiveTab("orders"); } });
  if (unlinkedRemoteItems.length > 0) marketplaceAttentionItems.push({ id: "listings", title: "Anúncios sem produto no ERP", description: "Vincule os itens encontrados na loja ao estoque correspondente.", count: unlinkedRemoteItems.length, actionLabel: "Vincular", onAction: () => setActiveTab("listings") });
  if (shopeeUnreadCount > 0) marketplaceAttentionItems.push({ id: "messages", title: "Mensagens não lidas", description: "Compradores aguardam atendimento pelo chat da Shopee.", count: shopeeUnreadCount, actionLabel: "Atender", onAction: () => setChatOpen(true) });
  const normalizedConversations = useMemo(() => conversations.map((conversation) => ({
    id: String(conversation.conversation_id),
    name: conversation.to_name || conversation.buyer_username || `Conversa ${conversation.conversation_id}`,
    preview: conversation.latest_message_content?.text || "",
    unreadCount: conversation.unread_count || 0,
  })), [conversations]);
  const normalizedMessages = useMemo(() => messages.map((message, index) => ({
    id: String(message.message_id || message.id || index),
    text: message.content?.text || "",
    type: message.message_type,
    fromBuyer: Number(message.from_id) === Number(selectedConversation?.to_id || selectedConversation?.buyer_id),
    date: message.created_timestamp,
  })), [messages, selectedConversation]);
  const missingRequiredAttributes = useMemo(() => categoryAttributes.filter((attribute) => attribute.required && !String(attributeValues[String(attribute.id)] || "").trim()), [categoryAttributes, attributeValues]);
  const filteredCategories = useMemo(() => {
    const term = categorySearch.trim().toLocaleLowerCase("pt-BR");
    return categories.filter((category) => !category.hasChildren && (!term || category.name.toLocaleLowerCase("pt-BR").includes(term) || String(category.id).includes(term))).slice(0, 300);
  }, [categories, categorySearch]);
  const publishStepValidity = useMemo(() => ({
    product: Boolean(selectedPublishProduct?.id && selectedPublishProduct.imageUrls?.length && !selectedProductLoading),
    content: Boolean(publishForm.title.trim() && publishForm.description.trim()),
    category: Boolean(publishForm.categoryId && attributesCategoryId === publishForm.categoryId && !attributesLoading && !attributesError && missingRequiredAttributes.length === 0 && (!categoryBrandRequired || publishForm.brandId !== "")),
    shipping: Boolean(Number(publishForm.price) > 0 && Number.isInteger(Number(publishForm.stock)) && Number(publishForm.stock) >= 0 && Number(publishForm.weight) > 0 && Number(publishForm.length) > 0 && Number(publishForm.width) > 0 && Number(publishForm.height) > 0 && publishForm.logisticId),
  }), [selectedPublishProduct, selectedProductLoading, publishForm, attributesCategoryId, attributesLoading, attributesError, missingRequiredAttributes.length, categoryBrandRequired]);
  const publishSteps: Array<{ value: PublishStep; number: number; title: string; short: string }> = [
    { value: "product", number: 1, title: "Produto do ERP", short: "Produto" },
    { value: "content", number: 2, title: "Conteúdo do anúncio", short: "Conteúdo" },
    { value: "category", number: 3, title: "Categoria e características", short: "Categoria" },
    { value: "shipping", number: 4, title: "Preço, estoque e envio", short: "Oferta e envio" },
  ];
  const currentPublishStepIndex = publishSteps.findIndex((step) => step.value === publishStep);
  const firstInvalidPublishStepIndex = publishSteps.findIndex((step) => !publishStepValidity[step.value]);
  const canOpenPublishStep = (index: number) => index <= (firstInvalidPublishStepIndex === -1 ? publishSteps.length - 1 : firstInvalidPublishStepIndex);

  function advancePublishStep() {
    const current = publishSteps[currentPublishStepIndex];
    if (!publishStepValidity[current.value]) {
      toast.warning("Complete os campos obrigatórios", { description: publishStepError(current.value, { selectedPublishProduct, publishForm, attributesError, missingRequiredAttributes }) });
      return;
    }
    const next = publishSteps[currentPublishStepIndex + 1];
    if (next) setPublishStep(next.value);
  }
  const tabHeader = {
    overview: { title: "Visão geral", description: "Acompanhe a preparação e a saúde da operação Shopee." },
    products: { title: "Produtos do ERP", description: "Escolha quais produtos serão publicados ou vinculados à Shopee." },
    listings: { title: "Anúncios Shopee", description: "Administre os anúncios existentes na loja, preço, estoque e situação." },
    orders: { title: "Pedidos Shopee", description: "Sincronize vendas, status, clientes e rastreamento." },
    performance: { title: "Desempenho", description: "Visualizações, curtidas, vendas e avaliações disponibilizadas pela Shopee." },
  }[activeTab];
  const tabResultLabel = activeTab === "products"
    ? `${productPagination.total} produto(s)`
    : activeTab === "orders"
      ? `${filteredOrders.length} pedido(s)`
      : activeTab === "listings"
        ? `${filteredListings.length} anúncio(s)`
        : null;

  return (
    <div className="mx-auto space-y-4">
      <MarketplaceHeader
        icon={ShoppingBag}
        iconClassName="text-orange-600"
        description="Produtos, vendas, atendimento e desempenho dos seus canais."
        connected={Boolean(account)}
        accountName={account?.shop_name || (account ? `Loja ${account.shop_id}` : "Loja desconectada")}
        accountDescription={account ? `Shopee · Shop ID ${account.shop_id}` : "Conecte em Configurações Gerais"}
      />

      {!loading && data && (!data.configuration.ready || !account) ? (
        <Card className="overflow-hidden border-orange-300/70 bg-orange-50/50 p-0 dark:bg-orange-950/10">
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
              <div>
                <p className="font-medium">{data.configuration.ready ? "Conecte sua loja Shopee" : "Aplicativo Shopee ainda não configurado"}</p>
                <p className="text-sm text-muted-foreground">{data.configuration.ready ? "A autorização da loja é feita em Configurações Gerais." : `Variáveis pendentes: ${data.configuration.missing.join(", ")}.`}</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0 bg-background"><Link href="/configuracoes/geral"><Settings2 className="mr-2 h-4 w-4" />Abrir configurações</Link></Button>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "overview" ? <Card className="gap-0 overflow-hidden py-0 shadow-sm">
        <section aria-label="Resumo da Shopee" className="grid grid-cols-2 [&>button]:border-b [&>button:nth-child(odd)]:border-r xl:grid-cols-4 xl:[&>button]:border-b-0 xl:[&>button]:border-r xl:[&>button:last-child]:border-r-0">
          <SummaryButton title="Pedidos sincronizados" value={data?.orders.length ?? 0} description="Últimos 100 pedidos" icon={<ClipboardList className="h-4 w-4 text-violet-600" />} iconClass="bg-violet-500/10" onClick={() => setActiveTab("orders")} />
          <SummaryButton title="Produtos do ERP" value={productPagination.total} description="Disponíveis para integração" icon={<PackageSearch className="h-4 w-4 text-blue-600" />} iconClass="bg-blue-500/10" onClick={() => setActiveTab("products")} />
          <SummaryButton title="Anúncios Shopee" value={data?.links.length ?? 0} description="Publicados ou vinculados" icon={<Store className="h-4 w-4 text-orange-600" />} iconClass="bg-orange-500/10" onClick={() => setActiveTab("listings")} />
          <SummaryButton title="Pendências" value={importErrors} description={importErrors ? "Pedidos que precisam de atenção" : "Operação sem falhas"} icon={<AlertTriangle className={`h-4 w-4 ${importErrors ? "text-rose-600" : "text-emerald-600"}`} />} iconClass={importErrors ? "bg-rose-500/10" : "bg-emerald-500/10"} onClick={() => setActiveTab(importErrors ? "orders" : "overview")} />
        </section>
      </Card> : null}

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ShopeeTab)}>
        <Card className="gap-0 overflow-hidden">
          <CardHeader className="border-b-2 pb-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 shrink-0"><CardTitle>{tabHeader.title}</CardTitle><CardDescription className="flex items-center gap-2"><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-foreground/50 hover:cursor-pointer hover:text-foreground/70 disabled:cursor-wait disabled:opacity-60"><span>Recarregar</span><Loader2 width={12} className={loading ? "animate-spin" : ""} /></button>{tabResultLabel ? <><span aria-hidden="true">·</span><span>{tabResultLabel}</span></> : null}</CardDescription></div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                {activeTab === "products" ? <MarketplaceListToolbar compact search={productSearchInput} onSearchChange={setProductSearchInput} searchPlaceholder="Buscar por nome, ID, referência ou código..." resultLabel={`${productPagination.total} produto(s)`} /> : null}
                {activeTab === "orders" ? <MarketplaceListToolbar compact search={orderSearch} onSearchChange={setOrderSearch} searchPlaceholder="Buscar pedido, cliente ou rastreio..." filter={orderStatusFilter} onFilterChange={setOrderStatusFilter} filterOptions={[
                  { value: "all", label: "Todos os pedidos" }, { value: "error", label: "Com erro de importação" }, { value: "pending_erp", label: "Sem venda no ERP" }, { value: "READY_TO_SHIP", label: "Prontos para envio" }, { value: "PROCESSED", label: "Processados" }, { value: "SHIPPED", label: "Enviados" }, { value: "COMPLETED", label: "Concluídos" }, { value: "CANCELLED", label: "Cancelados" },
                ]} resultLabel={`${filteredOrders.length} pedido(s)`} /> : null}
                {activeTab === "listings" ? <MarketplaceListToolbar compact search={listingSearch} onSearchChange={setListingSearch} searchPlaceholder="Buscar produto, SKU ou Item ID..." filter={listingStatusFilter} onFilterChange={setListingStatusFilter} filterOptions={[
                  { value: "all", label: "Todos os anúncios" }, { value: "NORMAL", label: "Ativos" }, { value: "UNLIST", label: "Pausados" }, { value: "BANNED", label: "Bloqueados" },
                ]} resultLabel={`${filteredListings.length} anúncio(s)`} /> : null}
                {(activeTab === "overview" || activeTab === "orders") ? <Button size="sm" onClick={syncOrders} disabled={!account || syncing}>{syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}Sincronizar pedidos</Button> : null}
                {activeTab === "listings" ? <Button size="sm" variant="outline" onClick={syncCatalog} disabled={catalogLoading || !account}>{catalogLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}Importar anúncios</Button> : null}
                {(activeTab === "products" || activeTab === "listings") ? <Button size="sm" onClick={() => setPublishOpen(true)} disabled={!account}><Plus className="mr-2 h-4 w-4" />Criar anúncio</Button> : null}
                {activeTab === "performance" ? <Button size="sm" onClick={() => void loadPerformance()} disabled={!account || performanceLoading}>{performanceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TrendingUp className="mr-2 h-4 w-4" />}Consultar desempenho</Button> : null}
              </div>
            </div>
          </CardHeader>
          <MarketplaceLoadingLine loading={loading || syncing || catalogLoading || performanceLoading} />

          <MarketplaceSectionNav items={[
            { value: "overview", label: "Visão geral", icon: LayoutDashboard },
            { value: "products", label: "Produtos", icon: PackageSearch, count: productPagination.total },
            { value: "listings", label: "Anúncios", icon: Store, count: data?.links.length ?? 0 },
            { value: "orders", label: "Pedidos", icon: ClipboardList, count: data?.orders.length ?? 0 },
            { value: "performance", label: "Desempenho", icon: TrendingUp },
          ]} />

          <TabsContent value="overview" className="m-0">
            <CardContent className="grid gap-4 p-4 lg:grid-cols-[1.1fr_0.9fr] lg:p-6">
              <div className="rounded-lg border bg-muted/10 p-5">
                <p className="text-sm font-semibold">Preparação do canal</p>
                <p className="mt-1 text-sm text-muted-foreground">Complete estes passos antes de operar pedidos reais.</p>
                <div className="mt-5 space-y-4">
                  <ReadinessItem done={data?.configuration.ready ?? false} title="Aplicativo configurado" description="Partner ID, chave e URL de retorno cadastrados." />
                  <ReadinessItem done={Boolean(account)} title="Loja autorizada" description="O vendedor concedeu acesso ao ERP." />
                  <ReadinessItem done={Boolean(data?.links.length)} title="Produtos vinculados" description="Os SKUs da Shopee apontam para o estoque correto." />
                </div>
              </div>
              <div className="rounded-lg border p-5">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Pedidos recentes</p><p className="text-xs text-muted-foreground">Últimas movimentações recebidas</p></div><Button variant="ghost" size="sm" onClick={() => setActiveTab("orders")}>Ver todos<ArrowRight className="ml-1 h-4 w-4" /></Button></div>
                <div className="mt-4 divide-y">{(data?.orders ?? []).slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">#{order.order_sn}</p><p className="truncate text-xs text-muted-foreground">{order.buyer_username || "Comprador Shopee"} · {formatDate(order.create_time)}</p></div><div className="text-right"><p className="text-sm font-medium">{formatMoney(order.total_amount, order.currency)}</p><p className="text-xs text-muted-foreground">{statusLabel(order.status)}</p></div></div>)}
                  {!data?.orders.length ? <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="Nenhum pedido recebido" description="Conecte a loja e execute a primeira sincronização." /> : null}
                </div>
              </div>
              <div className="lg:col-span-2"><MarketplaceAttentionCenter items={marketplaceAttentionItems} /></div>
            </CardContent>
          </TabsContent>

          <TabsContent value="orders" className="m-0">
            <CardContent className="p-0">
              <div className="p-4 lg:p-6"><div className="overflow-hidden rounded-md border">
              <Table><TableHeader className="bg-muted/30"><TableRow><TableHead className="pl-4">Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Status</TableHead><TableHead>Valor</TableHead><TableHead>Rastreio</TableHead><TableHead className="pr-4">Venda ERP</TableHead></TableRow></TableHeader>
                <TableBody>{paginatedOrders.map((order) => <TableRow key={order.id}><TableCell className="pl-4"><div className="font-medium">{order.order_sn}</div><div className="text-xs text-muted-foreground">{formatDate(order.create_time)}</div></TableCell><TableCell>{order.buyer_username || "Comprador Shopee"}</TableCell><TableCell><Badge variant={order.import_error ? "destructive" : "outline"}>{order.import_error ? "Erro de importação" : statusLabel(order.status)}</Badge>{order.import_error ? <div className="mt-1 max-w-xs text-xs text-destructive">{order.import_error}</div> : null}</TableCell><TableCell>{formatMoney(order.total_amount, order.currency)}</TableCell><TableCell>{order.tracking_number || order.shipping_carrier || "—"}</TableCell><TableCell className="pr-4">{order.venda_id ? <Badge variant="secondary">Venda #{order.venda_id}</Badge> : "Pendente"}</TableCell></TableRow>)}
                  {!loading && !filteredOrders.length ? <TableRow><TableCell colSpan={6}><EmptyState icon={<ClipboardList className="h-6 w-6" />} title={data?.orders.length ? "Nenhum pedido encontrado" : "Nenhum pedido Shopee"} description={data?.orders.length ? "Altere a busca ou os filtros para ver outros pedidos." : "Os pedidos aparecerão aqui depois da primeira sincronização."} /></TableCell></TableRow> : null}
                </TableBody></Table></div></div>
              <MarketplacePagination page={safeOrderPage} totalPages={orderTotalPages} pageSize={orderPageSize} total={filteredOrders.length} visible={paginatedOrders.length} onPageChange={setOrderPage} onPageSizeChange={setOrderPageSize} />
            </CardContent>
          </TabsContent>

          <TabsContent value="products" className="m-0">
            <CardContent className="p-0">
              <div className="p-4 lg:p-6"><div className="overflow-hidden rounded-md border"><Table>
                <TableHeader className="bg-muted/30"><TableRow><TableHead className="pl-4">Produto do ERP</TableHead><TableHead>Preço</TableHead><TableHead>Estoque</TableHead><TableHead>Shopee</TableHead><TableHead className="pr-4 text-right">Ação</TableHead></TableRow></TableHeader>
                <TableBody>
                  {products.map((product) => <TableRow key={product.id}><TableCell className="pl-4"><p className="font-medium">{product.titulo}</p><p className="text-xs text-muted-foreground">{product.referencia || `ERP #${product.id}`}</p></TableCell><TableCell>{formatMoney(product.precovenda, "BRL")}</TableCell><TableCell>{Math.max(0, Math.trunc(Number(product.estoque || 0)))} unidade(s)</TableCell><TableCell>{product.shopee ? <div><Badge variant="outline">Anúncio {product.shopee.item_id}</Badge><p className="mt-1 text-xs text-muted-foreground">{product.shopee.status || "Vinculado"}</p></div> : <Badge variant="secondary">Não publicado</Badge>}</TableCell><TableCell className="pr-4 text-right">{product.shopee ? <Button size="sm" variant="outline" onClick={() => setActiveTab("listings")}>Ver anúncio</Button> : <Button size="sm" onClick={() => { choosePublishProduct(String(product.id)); setPublishOpen(true); }}><Plus className="mr-2 h-4 w-4" />Publicar</Button>}</TableCell></TableRow>)}
                  {!loading && !products.length ? <TableRow><TableCell colSpan={5}><EmptyState icon={<PackageSearch className="h-6 w-6" />} title="Nenhum produto disponível" description="Cadastre produtos no ERP para publicá-los na Shopee." /></TableCell></TableRow> : null}
                </TableBody>
              </Table></div></div>
              <MarketplacePagination page={productPagination.page} totalPages={productPagination.totalPages} pageSize={productPagination.limit} total={productPagination.total} visible={products.length} onPageChange={(page) => setProductPagination((current) => ({ ...current, page }))} onPageSizeChange={(limit) => setProductPagination((current) => ({ ...current, page: 1, limit }))} />
            </CardContent>
          </TabsContent>

          <TabsContent value="listings" className="m-0">
            <CardContent className="p-0">
              <div className="space-y-5 p-4 lg:p-6">
                <div className="overflow-hidden rounded-lg border">
                  <div className="border-b bg-muted/20 px-4 py-3"><p className="text-sm font-semibold">Anúncios e estoque</p><p className="text-xs text-muted-foreground">Itens publicados ou vinculados à loja Shopee.</p></div>
                  <Table><TableHeader className="bg-muted/30"><TableRow><TableHead className="pl-4">Produto</TableHead><TableHead>Shopee</TableHead><TableHead>Preço / estoque</TableHead><TableHead className="pr-4 text-right">Ações</TableHead></TableRow></TableHeader><TableBody>{paginatedListings.map((product) => <TableRow key={product.id}><TableCell className="pl-4"><p className="font-medium">{product.titulo}</p><p className="text-xs text-muted-foreground">{product.referencia || `ERP #${product.id}`}</p></TableCell><TableCell><p>Item {product.shopee?.item_id}</p><Badge variant="outline" className="mt-1">{product.shopee?.status || "Vinculado"}</Badge></TableCell><TableCell><p>{formatMoney(product.precovenda, "BRL")}</p><p className="text-xs text-muted-foreground">{Math.max(0, Math.trunc(Number(product.estoque || 0)))} unidade(s)</p></TableCell><TableCell className="pr-4"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => openEditListing(product)}>Editar</Button><Button size="sm" variant="outline" onClick={() => updateListing(product, "sync")}>Sincronizar</Button><Button size="sm" variant="ghost" onClick={() => updateListing(product, product.shopee?.status === "UNLIST" ? "relist" : "unlist")}>{product.shopee?.status === "UNLIST" ? "Ativar" : "Pausar"}</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => updateListing(product, "delete")}>Excluir</Button></div></TableCell></TableRow>)}{!filteredListings.length ? <TableRow><TableCell colSpan={4}><EmptyState icon={<PackageSearch className="h-6 w-6" />} title={linkedProducts.length ? "Nenhum anúncio encontrado" : "Nenhum anúncio vinculado"} description={linkedProducts.length ? "Altere a busca ou o filtro de situação." : "Clique em Importar anúncios para consultar a loja Shopee."} /></TableCell></TableRow> : null}</TableBody></Table>
                  <MarketplacePagination page={safeListingPage} totalPages={listingTotalPages} pageSize={listingPageSize} total={filteredListings.length} visible={paginatedListings.length} onPageChange={setListingPage} onPageSizeChange={setListingPageSize} />
                </div>
                {unlinkedRemoteItems.length ? <div className="overflow-hidden rounded-lg border border-orange-300/70"><div className="border-b bg-orange-50 px-4 py-3 dark:bg-orange-950/20"><p className="text-sm font-semibold">Anúncios sem vínculo no ERP</p><p className="text-xs text-muted-foreground">Encontrados na Shopee, mas o SKU não correspondeu automaticamente a um produto.</p></div><div className="divide-y">{unlinkedRemoteItems.map((item) => <div key={item.item_id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)_auto] md:items-center"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.item_name || `Item ${item.item_id}`}</p><p className="text-xs text-muted-foreground">Item {item.item_id} · SKU {item.item_sku || "não informado"}</p></div><Select value={remoteSelections[String(item.item_id)] || ""} onValueChange={(value) => setRemoteSelections((current) => ({ ...current, [String(item.item_id)]: value }))}><SelectTrigger><SelectValue placeholder="Vincular ao produto..." /></SelectTrigger><SelectContent>{products.filter((product) => !product.shopee).map((product) => <SelectItem key={product.id} value={String(product.id)}>#{product.id} · {product.titulo}</SelectItem>)}</SelectContent></Select><Button size="sm" onClick={() => linkRemoteItem(item)} disabled={savingLink || !remoteSelections[String(item.item_id)]}><Link2 className="mr-2 h-4 w-4" />Vincular</Button></div>)}</div></div> : null}
                <details className="rounded-lg border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">Vincular anúncio existente manualmente</summary><div className="mt-4 grid gap-3 md:grid-cols-[minmax(260px,1fr)_180px_180px_auto] md:items-end"><Field label="Produto do ERP"><Select value={linkForm.produtoId} onValueChange={(value) => setLinkForm((current) => ({ ...current, produtoId: value }))}><SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{products.map((product) => <SelectItem key={product.id} value={String(product.id)}>#{product.id} · {product.titulo}</SelectItem>)}</SelectContent></Select></Field><Field label="Item ID"><Input inputMode="numeric" value={linkForm.itemId} onChange={(event) => setLinkForm((current) => ({ ...current, itemId: event.target.value }))} /></Field><Field label="Model ID"><Input inputMode="numeric" value={linkForm.modelId} onChange={(event) => setLinkForm((current) => ({ ...current, modelId: event.target.value }))} /></Field><Button variant="outline" onClick={saveLink} disabled={savingLink || !linkForm.produtoId || !linkForm.itemId}><Link2 className="mr-2 h-4 w-4" />Salvar vínculo</Button></div></details>
              </div>
            </CardContent>
          </TabsContent>

          <TabsContent value="performance" className="m-0">
            <CardContent className="space-y-5 p-4 lg:p-6">
              {performanceError ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:bg-amber-950/20"><p className="font-medium text-amber-900 dark:text-amber-200">Desempenho indisponível</p><p className="mt-1 text-muted-foreground">{performanceError}</p></div> : null}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Visualizações" value={performance?.summary.views ?? 0} icon={<Eye className="h-4 w-4" />} />
                <MetricCard title="Curtidas" value={performance?.summary.likes ?? 0} icon={<Heart className="h-4 w-4" />} />
                <MetricCard title="Vendas" value={performance?.summary.sales ?? 0} icon={<TrendingUp className="h-4 w-4" />} />
                <MetricCard title="Avaliações" value={performance?.summary.comments ?? 0} icon={<Star className="h-4 w-4" />} />
              </div>
              <div className="overflow-hidden rounded-md border"><Table><TableHeader className="bg-muted/30"><TableRow><TableHead className="pl-4">Item</TableHead><TableHead>Visualizações</TableHead><TableHead>Curtidas</TableHead><TableHead>Vendas</TableHead><TableHead className="pr-4">Avaliações</TableHead></TableRow></TableHeader><TableBody>{(performance?.items ?? []).map((item) => <TableRow key={item.item_id}><TableCell className="pl-4"><p className="font-medium">{item.link?.title || `Item ${item.item_id}`}</p><p className="text-xs text-muted-foreground">Shopee #{item.item_id}</p></TableCell><TableCell>{metricValue(item.views, item.view_count)}</TableCell><TableCell>{metricValue(item.likes, item.like_count)}</TableCell><TableCell>{metricValue(item.sale, item.sold, item.sold_quantity)}</TableCell><TableCell className="pr-4">{metricValue(item.comment_count, item.rating_count)}</TableCell></TableRow>)}{performanceLoading ? <TableRow><TableCell colSpan={5}><EmptyState icon={<Loader2 className="h-6 w-6 animate-spin" />} title="Consultando a Shopee" description="Carregando os indicadores dos anúncios." /></TableCell></TableRow> : null}{!performanceLoading && !performance?.items.length ? <TableRow><TableCell colSpan={5}><EmptyState icon={<TrendingUp className="h-6 w-6" />} title="Sem indicadores disponíveis" description="A Shopee pode exigir anúncios ativos, movimentação ou uma permissão adicional para disponibilizar estes dados." /></TableCell></TableRow> : null}</TableBody></Table></div>
            </CardContent>
          </TabsContent>
        </Card>
      </Tabs>

      <MarketplaceChatLauncher onClick={() => setChatOpen(true)} disabled={!account} unreadCount={shopeeUnreadCount} />

      <Sheet open={chatOpen} onOpenChange={setChatOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
          <SheetHeader className="border-b px-5 py-4"><SheetTitle>Chat Shopee</SheetTitle><SheetDescription>Conversas dos compradores vinculadas à loja conectada.</SheetDescription></SheetHeader>
          <MarketplaceConversationPanel channelName="Shopee" conversations={normalizedConversations} selectedId={selectedConversation ? String(selectedConversation.conversation_id) : null} selectedName={selectedConversation?.to_name || selectedConversation?.buyer_username} messages={normalizedMessages} loading={chatLoading} error={chatError} messageText={messageText} onMessageTextChange={setMessageText} onRefresh={loadConversations} onSelect={(id) => { const conversation = conversations.find((item) => String(item.conversation_id) === id); if (conversation) void openConversation(conversation); }} onSend={() => void sendMessage()} />
        </SheetContent>
      </Sheet>

      <Dialog open={publishOpen} onOpenChange={handlePublishOpenChange}>
        <DialogContent onPointerDownOutside={(event) => event.preventDefault()} className="flex max-h-[94vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b bg-muted/20 px-6 py-5"><DialogTitle>Publicar anúncio na Shopee</DialogTitle><DialogDescription>Selecione o produto do ERP e complete os dados comerciais, categoria e entrega.</DialogDescription></DialogHeader>
          <Tabs value={publishStep} onValueChange={(value) => { const index = publishSteps.findIndex((step) => step.value === value); if (canOpenPublishStep(index)) setPublishStep(value as PublishStep); }} className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 border-b px-5 py-3 sm:px-6"><TabsList className="grid h-auto w-full grid-cols-4 gap-1 bg-muted/50 p-1">{publishSteps.map((step, index) => { const complete = publishStepValidity[step.value]; const active = publishStep === step.value; return <TabsTrigger key={step.value} value={step.value} disabled={!canOpenPublishStep(index)} className="h-auto min-w-0 gap-2 px-2 py-2.5 data-[state=active]:bg-background data-[state=active]:text-foreground"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${complete ? "bg-emerald-500 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{complete ? <CheckCircle2 className="h-4 w-4" /> : step.number}</span><span className="hidden truncate text-xs font-medium sm:block">{step.short}</span></TabsTrigger>; })}</TabsList></div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <TabsContent value="product" className="m-0 space-y-5">
                <StepHeading number="1" title="Produto do ERP" description="Escolha o produto que dará origem ao anúncio. Produto e imagem são obrigatórios." />
                <div className="grid gap-3 lg:grid-cols-3"><PublicationNotice title="Sempre obrigatório" tone="required" items={["Ao menos uma imagem pública", "Produto sem anúncio Shopee vinculado", "Preço e estoque cadastrados no ERP"]} /><PublicationNotice title="Depende da categoria" tone="dynamic" items={["Cor, tamanho, material e atributos", "Marca e certificações", "Regras regionais da Shopee"]} /><PublicationNotice title="Ainda não suportado" tone="warning" items={["Grades completas de variações", "Preço e estoque por variação", "Vídeo no anúncio"]} /></div>
                <div className="flex flex-col gap-3 rounded-lg border bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {selectedPublishProduct ? <>
                      <p className="truncate font-medium">{selectedPublishProduct.titulo}</p>
                      <p className="text-xs text-muted-foreground">#{selectedPublishProduct.id} · {selectedPublishProduct.referencia || "Sem referência"} · {formatMoney(selectedPublishProduct.precovenda, "BRL")} · {Math.max(0, Math.trunc(Number(selectedPublishProduct.estoque || 0)))} em estoque</p>
                      <p className={`mt-2 text-xs font-medium ${selectedPublishProduct.imageUrls?.length ? "text-emerald-600" : "text-destructive"}`}>{selectedProductLoading ? "Verificando imagens..." : selectedPublishProduct.imageUrls?.length ? `${selectedPublishProduct.imageUrls.length} imagem(ns) pronta(s) para envio à Shopee.` : "Obrigatório: adicione ao menos uma imagem antes de avançar."}</p>
                    </> : <>
                      <p className="font-medium">Nenhum produto selecionado</p>
                      <p className="text-xs text-muted-foreground">Busque por nome, ID, referência, código de barras ou NCM.</p>
                    </>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <input ref={publishImageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="hidden" onChange={uploadPublishProductImage} />
                    {selectedPublishProduct && !selectedPublishProduct.imageUrls?.length ? <Button type="button" variant="outline" onClick={() => publishImageInputRef.current?.click()} disabled={publishImageUploading || selectedProductLoading}>{publishImageUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}{publishImageUploading ? "Enviando..." : "Adicionar imagem"}</Button> : null}
                    <ProductSelect open={productPickerOpen} setOpen={setProductPickerOpen} OnSelect={(product) => { if (!product.id) return; void choosePublishProductFromPicker({ id: product.id, titulo: product.titulo || `Produto #${product.id}`, descricao: product.descricao, referencia: product.referencia, precovenda: product.precovenda, estoque: product.estoque, imageUrls: product.imgUrl ? [product.imgUrl] : [] }); }}>
                      <Button type="button" variant={selectedPublishProduct ? "outline" : "default"}><PackageSearch className="mr-2 h-4 w-4" />{selectedPublishProduct ? "Trocar produto" : "Selecionar produto"}</Button>
                    </ProductSelect>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="content" className="m-0 space-y-5"><StepHeading number="2" title="Conteúdo do anúncio" description="Revise as informações que serão exibidas para o comprador." /><div className="grid gap-4"><RequiredField label="Título"><Input value={publishForm.title} onChange={(event) => setPublishForm((current) => ({ ...current, title: event.target.value }))} aria-invalid={!publishForm.title.trim()} /></RequiredField><RequiredField label="Descrição"><Textarea rows={8} value={publishForm.description} onChange={(event) => setPublishForm((current) => ({ ...current, description: event.target.value }))} aria-invalid={!publishForm.description.trim()} /></RequiredField></div></TabsContent>

              <TabsContent value="category" className="m-0 space-y-5"><StepHeading number="3" title="Categoria e características" description="A Shopee devolve os atributos obrigatórios e opcionais da categoria selecionada." /><div className="flex gap-3 rounded-lg border border-blue-300/60 bg-blue-50 p-4 text-sm dark:bg-blue-950/20"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><p className="text-muted-foreground">Cor, tamanho, material e certificações só aparecem quando definidos pela categoria. Campos com <span className="font-semibold text-destructive">*</span> são obrigatórios.</p></div><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-[minmax(180px,0.65fr)_minmax(260px,1fr)_auto]"><Field label="Buscar categoria"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder="Nome ou código" /></div></Field><RequiredField label="Categoria Shopee"><Select value={publishForm.categoryId} onValueChange={(value) => setPublishForm((current) => ({ ...current, categoryId: value }))}><SelectTrigger><SelectValue placeholder={categoriesLoading ? "Carregando categorias..." : "Selecione uma categoria final"} /></SelectTrigger><SelectContent>{filteredCategories.map((category) => <SelectItem key={category.id} value={String(category.id)}>{category.name} · {category.id}</SelectItem>)}</SelectContent></Select></RequiredField><Button className="sm:mt-6" size="sm" variant="outline" onClick={recommendCategory}>Sugerir categoria</Button></div>{attributesLoading || (publishForm.categoryId && attributesCategoryId !== publishForm.categoryId && !attributesError) ? <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando campos e marcas desta categoria na Shopee...</div> : null}{attributesError ? <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{attributesError}</div> : null}{publishForm.categoryId && attributesCategoryId === publishForm.categoryId && !attributesError ? <div className="grid gap-3 sm:grid-cols-2"><Field label="Marca (quando aplicável)"><Select value={publishForm.brandId} onValueChange={(value) => { const brand = categoryBrands.find((item) => String(item.id) === value); setPublishForm((current) => ({ ...current, brandId: value, brandName: brand?.name || "" })); }}><SelectTrigger><SelectValue placeholder={categoryBrands.length ? "Selecione a marca ou Sem marca" : "Nenhuma marca específica retornada"} /></SelectTrigger><SelectContent>{categoryBrands.map((brand) => <SelectItem key={`${brand.id}-${brand.name}`} value={String(brand.id)}>{brand.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Condição"><Select value={publishForm.condition} onValueChange={(value) => setPublishForm((current) => ({ ...current, condition: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NEW">Novo</SelectItem><SelectItem value="USED">Usado</SelectItem></SelectContent></Select></Field></div> : null}{attributesCategoryId === publishForm.categoryId && categoryAttributes.length ? <div className="space-y-4">{categoryAttributes.some((attribute) => attribute.required) ? <AttributeSection title="Obrigatórios" attributes={categoryAttributes.filter((attribute) => attribute.required)} values={attributeValues} onChange={(id, value) => setAttributeValues((current) => ({ ...current, [String(id)]: value }))} /> : <p className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">Esta categoria não retornou atributos obrigatórios adicionais.</p>}{categoryAttributes.some((attribute) => !attribute.required) ? <AttributeSection title="Opcionais" attributes={categoryAttributes.filter((attribute) => !attribute.required)} values={attributeValues} onChange={(id, value) => setAttributeValues((current) => ({ ...current, [String(id)]: value }))} /> : null}</div> : null}</div></TabsContent>

              <TabsContent value="shipping" className="m-0 space-y-5"><StepHeading number="4" title="Preço, estoque e envio" description="Complete a oferta e os dados usados pela Shopee para calcular e processar o envio." /><div className="grid gap-5"><div className="grid grid-cols-2 gap-3"><RequiredField label="Preço"><Input inputMode="decimal" value={publishForm.price} onChange={(event) => setPublishForm((current) => ({ ...current, price: event.target.value }))} /></RequiredField><RequiredField label="Estoque"><Input inputMode="numeric" value={publishForm.stock} onChange={(event) => setPublishForm((current) => ({ ...current, stock: event.target.value }))} /></RequiredField></div><div><p className="mb-2 text-sm font-medium">Pacote <span className="text-destructive">*</span></p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><RequiredField label="Peso kg"><Input inputMode="decimal" value={publishForm.weight} onChange={(event) => setPublishForm((current) => ({ ...current, weight: event.target.value }))} /></RequiredField><RequiredField label="Comp. cm"><Input inputMode="decimal" value={publishForm.length} onChange={(event) => setPublishForm((current) => ({ ...current, length: event.target.value }))} /></RequiredField><RequiredField label="Larg. cm"><Input inputMode="decimal" value={publishForm.width} onChange={(event) => setPublishForm((current) => ({ ...current, width: event.target.value }))} /></RequiredField><RequiredField label="Alt. cm"><Input inputMode="decimal" value={publishForm.height} onChange={(event) => setPublishForm((current) => ({ ...current, height: event.target.value }))} /></RequiredField></div></div><RequiredField label="Canal logístico"><Select value={publishForm.logisticId} onValueChange={(value) => setPublishForm((current) => ({ ...current, logisticId: value }))}><SelectTrigger><SelectValue placeholder="Selecione a forma de entrega" /></SelectTrigger><SelectContent>{logistics.filter((item) => item.enabled !== false).map((item) => { const id = item.logistics_channel_id || item.logistic_id; return id ? <SelectItem key={id} value={String(id)}>{item.logistics_channel_name || item.logistic_name || `Canal ${id}`}</SelectItem> : null; })}</SelectContent></Select></RequiredField><div className="flex gap-3 rounded-lg border border-blue-300/60 bg-blue-50 p-4 text-sm dark:bg-blue-950/20"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><p className="text-muted-foreground">A modalidade efetiva do pedido será definida entre as opções habilitadas. Código de rastreio e etiqueta serão obtidos da Shopee no fluxo de expedição.</p></div><div className="flex gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm dark:bg-amber-950/20"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><p className="text-muted-foreground">A validação final é da Shopee. O anúncio ainda pode ser recusado por regras regionais, imagem, marca, certificação ou combinação de atributos.</p></div></div></TabsContent>
            </div>

            <DialogFooter className="shrink-0 items-center border-t bg-muted/20 px-6 py-4 sm:justify-between"><p className="text-left text-xs text-muted-foreground">Etapa {currentPublishStepIndex + 1} de {publishSteps.length} · {publishStepValidity[publishStep] ? "Concluída" : publishStepError(publishStep, { selectedPublishProduct, publishForm, attributesError, missingRequiredAttributes })}</p><div className="flex gap-2"><Button variant="outline" onClick={closePublishDialog}>Cancelar</Button>{currentPublishStepIndex > 0 ? <Button variant="outline" onClick={() => setPublishStep(publishSteps[currentPublishStepIndex - 1].value)}><ChevronLeft className="mr-2 h-4 w-4" />Voltar</Button> : null}{currentPublishStepIndex < publishSteps.length - 1 ? <Button onClick={advancePublishStep} disabled={!publishStepValidity[publishStep]}>Avançar<ChevronRight className="ml-2 h-4 w-4" /></Button> : <Button onClick={publishProduct} disabled={savingLink || !Object.values(publishStepValidity).every(Boolean)}>{savingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}Publicar anúncio</Button>}</div></DialogFooter>
          </Tabs>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingProduct)} onOpenChange={(open) => { if (!open) setEditingProduct(null); }}><DialogContent><DialogHeader><DialogTitle>Editar anúncio Shopee</DialogTitle><DialogDescription>Altere os dados comerciais do anúncio vinculado. Preço e estoque são sincronizados pela ação própria.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Título"><Input value={editForm.title} onChange={(event) => setEditForm((current) => ({ ...current, title: event.target.value }))} /></Field><Field label="Descrição"><Textarea rows={6} value={editForm.description} onChange={(event) => setEditForm((current) => ({ ...current, description: event.target.value }))} /></Field><Field label="SKU"><Input value={editForm.sku} onChange={(event) => setEditForm((current) => ({ ...current, sku: event.target.value }))} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setEditingProduct(null)}>Cancelar</Button><Button onClick={saveListingEdit} disabled={savingLink || !editForm.title.trim()}>{savingLink ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Salvar na Shopee</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function SummaryButton({ title, value, description, icon, iconClass, onClick }: { title: string; value: number; description: string; icon: React.ReactNode; iconClass: string; onClick: () => void }) {
  return <button type="button" className="group min-w-0 text-left transition-colors hover:bg-muted/30" onClick={onClick}><div className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="text-sm font-medium">{title}</p><p className="text-xl font-bold leading-tight">{value}</p><p className="truncate text-xs text-muted-foreground">{description}</p></div><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${iconClass}`}>{icon}</span></div></button>;
}

function MetricCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return <div className="flex items-center justify-between rounded-lg border bg-card p-4"><div><p className="text-xs text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-semibold">{new Intl.NumberFormat("pt-BR").format(value)}</p></div><span className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/10 text-orange-600">{icon}</span></div>;
}

function StepHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{number}</span><div><h3 className="font-semibold">{title}</h3><p className="text-sm text-muted-foreground">{description}</p></div></div>;
}

function RequiredField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}<span className="ml-1 text-destructive">*</span></Label>{children}</div>;
}

function PublicationNotice({ title, tone, items }: { title: string; tone: "required" | "dynamic" | "warning"; items: string[] }) {
  const styles = tone === "required" ? "border-rose-300/60 bg-rose-50 dark:bg-rose-950/20" : tone === "dynamic" ? "border-blue-300/60 bg-blue-50 dark:bg-blue-950/20" : "border-amber-300/60 bg-amber-50 dark:bg-amber-950/20";
  return <div className={`rounded-lg border p-4 ${styles}`}><p className="text-sm font-semibold">{title}</p><ul className="mt-2 space-y-1 text-xs text-muted-foreground">{items.map((item) => <li key={item} className="flex gap-2"><span aria-hidden>•</span><span>{item}</span></li>)}</ul></div>;
}

function publishStepError(step: PublishStep, context: { selectedPublishProduct: Product | null; publishForm: { title: string; description: string; categoryId: string; price: string; stock: string; weight: string; length: string; width: string; height: string; logisticId: string }; attributesError: string | null; missingRequiredAttributes: ShopeeAttribute[] }) {
  if (step === "product") return !context.selectedPublishProduct ? "Selecione um produto do ERP." : "Adicione uma imagem pública ao produto.";
  if (step === "content") return !context.publishForm.title.trim() ? "Informe o título obrigatório." : "Informe a descrição obrigatória.";
  if (step === "category") {
    if (!context.publishForm.categoryId) return "Selecione uma categoria Shopee.";
    if (context.attributesError) return "Corrija a consulta da categoria antes de avançar.";
    if (context.missingRequiredAttributes.length) return `Preencha ${context.missingRequiredAttributes.length} atributo(s) obrigatório(s).`;
    return "Aguarde a validação da categoria pela Shopee.";
  }
  if (!(Number(context.publishForm.price) > 0)) return "Informe um preço maior que zero.";
  if (!Number.isInteger(Number(context.publishForm.stock)) || Number(context.publishForm.stock) < 0) return "Informe um estoque válido.";
  if (![context.publishForm.weight, context.publishForm.length, context.publishForm.width, context.publishForm.height].every((value) => Number(value) > 0)) return "Preencha peso e todas as dimensões do pacote.";
  return "Selecione o canal logístico obrigatório.";
}

function AttributeSection({ title, attributes, values, onChange }: { title: string; attributes: ShopeeAttribute[]; values: Record<string, string>; onChange: (id: number | string, value: string) => void }) {
  return <section className="space-y-2"><div className="flex items-center gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p><Badge variant="secondary">{attributes.length}</Badge></div><div className="grid gap-3 sm:grid-cols-2">{attributes.map((attribute) => <div key={attribute.id} className="space-y-1.5 rounded-md border bg-background p-3"><Label htmlFor={`shopee-attribute-${attribute.id}`}>{attribute.name}{attribute.required ? <span className="ml-1 text-destructive">*</span> : null}</Label><div className={attribute.units.length && !attribute.values.length ? "grid grid-cols-[1fr_110px] gap-2" : ""}>{attribute.values.length ? <Select value={values[String(attribute.id)] || ""} onValueChange={(value) => onChange(attribute.id, value)}><SelectTrigger id={`shopee-attribute-${attribute.id}`}><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{attribute.values.map((option) => <SelectItem key={`${attribute.id}-${option.id ?? option.name}`} value={String(option.id ?? option.name)}>{option.name}{option.unit ? ` (${option.unit})` : ""}</SelectItem>)}</SelectContent></Select> : <Input id={`shopee-attribute-${attribute.id}`} value={values[String(attribute.id)] || ""} onChange={(event) => onChange(attribute.id, event.target.value)} placeholder={attribute.inputType.includes("INT") || attribute.inputType.includes("DECIMAL") ? "Informe um valor numérico" : "Informe o valor"} inputMode={attribute.inputType.includes("INT") || attribute.inputType.includes("DECIMAL") ? "decimal" : "text"} />}{attribute.units.length && !attribute.values.length ? <Select value={values[`${attribute.id}__unit`] || attribute.units[0]} onValueChange={(value) => onChange(`${attribute.id}__unit`, value)}><SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger><SelectContent>{attribute.units.map((unit) => <SelectItem key={`${attribute.id}-${unit}`} value={unit}>{unit}</SelectItem>)}</SelectContent></Select> : null}</div><p className="text-[11px] text-muted-foreground">Código Shopee {attribute.id}{attribute.allowCustomValue ? " · aceita valor livre" : ""}</p></div>)}</div></section>;
}

function metricValue(...values: Array<number | undefined>) {
  const value = values.find((item) => typeof item === "number") ?? 0;
  return new Intl.NumberFormat("pt-BR").format(value);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function ReadinessItem({ done, title, description }: { done: boolean; title: string; description: string }) {
  return <div className="flex gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-semibold">•</span>}</span><div><p className="text-sm font-medium">{title}</p><p className="text-xs text-muted-foreground">{description}</p></div></div>;
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center text-muted-foreground"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted">{icon}</span><p className="text-sm font-medium text-foreground">{title}</p><p className="mt-1 max-w-sm text-xs">{description}</p></div>;
}

function formatMoney(value?: number | null, currency?: string | null) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(value ?? 0));
}

function formatDate(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = { UNPAID: "Aguardando pagamento", READY_TO_SHIP: "Pronto para envio", PROCESSED: "Processado", SHIPPED: "Enviado", TO_CONFIRM_RECEIVE: "Aguardando recebimento", COMPLETED: "Concluído", IN_CANCEL: "Cancelamento solicitado", CANCELLED: "Cancelado" };
  return labels[String(value ?? "").toUpperCase()] || value || "Sem status";
}
