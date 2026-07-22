"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Calendar,
  User,
  Package,
  Hash,
  ShoppingCart,
  AlertCircle,
  Truck,
  FileText,
  Save,
  Search,
  Paperclip,
  Upload,
  ExternalLink,
  Trash2,
} from "lucide-react"
import { toast } from "@/lib/toast"
import type { VendaCanal, VendaStatusEntrega, vendaStatus } from "../types"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogTitle,
  DialogHeader,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
} from "@/components/ui/drawer"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import CustomerSelect from "@/app/(app)/components/customerSelect"
import type { Customer } from "@/app/(app)/(pages)/clientes/types"
import {
  VENDA_ANEXO_CATEGORIAS,
  getVendaAnexoCategoriaLabel,
  type VendaAnexoCategoria,
} from "@/lib/venda-anexo-categorias"

interface Produto {
  id: number
  titulo: string
  descricao: string
  precovenda: number
  unidade: string
  codigobarras: string | null
  ncm: string
  cest: string
  cfop: string
  csosn: string
  cst: string
  aliquotaicms: number
  cst_pis: string
  aliquota_pis: number | null
  cst_cofins: string
  aliquota_cofins: number
  imgUrl: string | null
}

interface VendaProduto {
  id: number
  created_at: string
  updated_at: string
  venda_id: number
  produtoid: number
  produto: Produto
  sub_total: number
  valor_total: number
  valor_desconto: number
  tipo_desconto: string | null
  quantidade: number
}

interface Cliente {
  id: number
  nomerazaosocial: string
}

type CategoriaVenda = {
  id: number
  nome: string
  descricao?: string | null
  ativo?: boolean | null
}

type VendaAnexo = {
  id: number
  vendaid: number
  nome: string
  tipo?: string | null
  tamanho?: number | null
  url: string
  path: string
  descricao?: string | null
  categoria: VendaAnexoCategoria
  createdat?: string | null
}
const MAX_ANEXOS_POR_VENDA = 5

interface Venda {
  id: number
  clienteid: number
  cliente: Cliente
  status: vendaStatus
  categoriavendaid?: number | null
  categoria_venda?: CategoriaVenda | null
  canal: VendaCanal
  status_entrega?: VendaStatusEntrega | null
  codigo_rastreio?: string | null
  transportadora_rastreio?: string | null
  ultimo_evento_rastreio?: string | null
  ultimo_evento_rastreio_em?: string | null
  nfe_chave_acesso?: string | null
  danfe_url?: string | null
  valortotal: number
  datavenda: string | null
  createdat: string | null
  updatedat: string | null
  created_by: string | null
  criador?: {
    id: string
    nome: string
  } | null
  vendedor: string | null
  vendedor_rel?: {
    id: string
    nome: string
  } | null
  updated_by: string | null
  editor?: {
    id: string
    nome: string
  } | null
  desconto_tipo: string | null
  desconto_valor: number
  sub_total: number
  observacoes?: string | null
  observacoes_fiscais?: string | null
  itens: VendaProduto[]
}

interface VendaDetailsDialogProps {
  vendaId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusColors: Record<vendaStatus, string> = {
  ORCAMENTO: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  ABERTA: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  PAGAMENTO: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  PENDENTE: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  AUTORIZADO: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  PAGO: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  FINALIZADA: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  CANCELADA: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  CANCELADO: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
}

const statusLabels: Record<vendaStatus, string> = {
  ORCAMENTO: "Orcamento",
  ABERTA: "Aberta",
  PAGAMENTO: "Pagamento",
  PENDENTE: "Pendente",
  AUTORIZADO: "Autorizado",
  PAGO: "Pago",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
  CANCELADO: "Cancelada",
}

const TAB_ITEMS = [
  { value: "Geral", label: "Geral", icon: User },
  { value: "Entrega", label: "Entrega", icon: Truck },
  { value: "Financeiro", label: "Financeiro", icon: ShoppingCart },
  { value: "Produtos", label: "Produtos", icon: Package },
  { value: "Fiscal", label: "Fiscal", icon: FileText },
  { value: "Anexos", label: "Anexos", icon: Paperclip },
] as const

export function VendaDetailsDialog({ vendaId, open, onOpenChange }: VendaDetailsDialogProps) {
  const [venda, setVenda] = useState<Venda | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [openCustomerSelect, setOpenCustomerSelect] = useState(false)
  const [currentTab, setCurrentTab] = useState<string>("Geral")
  const [users, setUsers] = useState<Array<{ id: string; nome: string | null; email?: string }>>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [categoriasVenda, setCategoriasVenda] = useState<CategoriaVenda[]>([])
  const [loadingCategoriasVenda, setLoadingCategoriasVenda] = useState(false)
  const [anexos, setAnexos] = useState<VendaAnexo[]>([])
  const [loadingAnexos, setLoadingAnexos] = useState(false)
  const [uploadingAnexo, setUploadingAnexo] = useState(false)
  const [deletingAnexoId, setDeletingAnexoId] = useState<number | null>(null)
  const [anexoCategoria, setAnexoCategoria] =
    useState<VendaAnexoCategoria>("COMPROVANTE_PAGAMENTO")
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isDesktop = useMediaQuery("(min-width: 768px)")

  useEffect(() => {
    const loadUsers = async () => {
      try {
        setLoadingUsers(true)
        const response = await fetch("/api/users?ativos=1", { cache: "no-store" })
        const data = await response.json().catch(() => ({}))
        if (response.ok && Array.isArray(data?.users)) {
          setUsers(data.users)
        }
      } catch (fetchError) {
        console.error("Erro ao carregar usuarios:", fetchError)
      } finally {
        setLoadingUsers(false)
      }
    }
    loadUsers()
  }, [])

  useEffect(() => {
    const loadCategoriasVenda = async () => {
      try {
        setLoadingCategoriasVenda(true)
        const response = await fetch("/api/tipos/categorias-venda?ativo=true", { cache: "no-store" })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || "Erro ao carregar categorias de venda")

        const items: CategoriaVenda[] = Array.isArray(data?.items)
          ? data.items.map((c: any) => ({
              id: Number(c.id),
              nome: String(c.nome ?? ""),
              descricao: c.descricao ?? null,
              ativo: typeof c.ativo === "boolean" ? c.ativo : true,
            }))
          : []

        setCategoriasVenda(items)
      } catch (fetchError) {
        console.error("Erro ao carregar categorias de venda:", fetchError)
      } finally {
        setLoadingCategoriasVenda(false)
      }
    }
    loadCategoriasVenda()
  }, [])

  const fetchVenda = useCallback(async () => {
    if (!vendaId) return
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/venda/${vendaId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Erro ao buscar venda")
      }

      const result = await response.json()
      setVenda(result.data)
    } catch (err) {
      console.error("[debug] Erro ao buscar venda:", err)
      setError(err instanceof Error ? err.message : "Erro ao carregar dados da venda")
    } finally {
      setLoading(false)
    }
  }, [vendaId])

  const fetchAnexos = useCallback(async () => {
    if (!vendaId) return
    setLoadingAnexos(true)

    try {
      const response = await fetch(`/api/venda/${vendaId}/anexos`, { cache: "no-store" })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao carregar anexos")
      }

      const items: VendaAnexo[] = Array.isArray(data?.items)
        ? data.items.map((item: any) => ({
            id: Number(item.id),
            vendaid: Number(item.vendaid),
            nome: String(item.nome ?? "Anexo"),
            tipo: item.tipo ?? null,
            tamanho: typeof item.tamanho === "number" ? item.tamanho : Number(item.tamanho ?? 0) || null,
            url: String(item.url ?? ""),
            path: String(item.path ?? ""),
            descricao: item.descricao ?? null,
            categoria: (item.categoria ?? "OUTROS") as VendaAnexoCategoria,
            createdat: item.createdat ?? null,
          }))
        : []

      setAnexos(items)
    } catch (err) {
      console.error("Erro ao carregar anexos:", err)
      toast.error("Erro", { description: err instanceof Error ? err.message : "Erro ao carregar anexos" })
    } finally {
      setLoadingAnexos(false)
    }
  }, [vendaId])

  useEffect(() => {
    if (open && vendaId) {
      fetchVenda()
      fetchAnexos()
    } else if (!open) {
      setVenda(null)
      setAnexos([])
      setCurrentTab("Geral")
    }
  }, [open, vendaId, fetchVenda, fetchAnexos])

  const handleUpdateVenda = async () => {
    if (!venda || !vendaId) return

    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/venda/${vendaId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clienteId: venda.clienteid,
          observacoes: venda.observacoes,
          observacoesFiscais: venda.observacoes_fiscais,
          vendedor: venda.vendedor,
          categoriaVendaId: venda.categoriavendaid ?? null,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Erro ao atualizar venda")
      }

      toast.success("Sucesso!", { description: "Venda atualizada com sucesso.", duration: 2000 })
      setVenda(null)
      await fetchVenda()
    } catch (err) {
      console.error("Erro ao atualizar venda:", err)
      toast.error("Erro", { description: err instanceof Error ? err.message : "Erro ao atualizar venda", duration: 2500 })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (field: keyof Venda, value: any) => {
    setVenda((prev) => (prev ? { ...prev, [field]: value } : null))
  }

  const handleCustomerSelect = (customer: Customer) => {
    setVenda((prev) =>
      prev
        ? {
            ...prev,
            clienteid: customer.id,
            cliente: {
              id: customer.id,
              nomerazaosocial: customer.nomerazaosocial,
            },
          }
        : prev,
    )
  }
  const handleAnexoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !vendaId) return

    if (anexos.length >= MAX_ANEXOS_POR_VENDA) {
      toast.error("Limite de anexos atingido", {
        description: `Esta venda aceita no máximo ${MAX_ANEXOS_POR_VENDA} anexos.`,
      })
      return
    }

    setUploadingAnexo(true)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("categoria", anexoCategoria)

      const response = await fetch(`/api/venda/${vendaId}/anexos`, {
        method: "POST",
        body: formData,
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao anexar arquivo")
      }

      toast.success("Anexo enviado", {
        description: file.type.startsWith("image/")
          ? "Imagem otimizada e anexo adicionado à venda."
          : "Anexo adicionado à venda.",
      })
      await fetchAnexos()
    } catch (err) {
      console.error("Erro ao anexar arquivo:", err)
      toast.error("Erro", { description: err instanceof Error ? err.message : "Erro ao anexar arquivo" })
    } finally {
      setUploadingAnexo(false)
    }
  }

  const handleDeleteAnexo = async (anexoId: number) => {
    if (!vendaId) return

    setDeletingAnexoId(anexoId)

    try {
      const response = await fetch(`/api/venda/${vendaId}/anexos/${anexoId}`, {
        method: "DELETE",
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data?.error || "Erro ao excluir anexo")
      }

      toast.success("Anexo removido")
      setAnexos((prev) => prev.filter((anexo) => anexo.id !== anexoId))
    } catch (err) {
      console.error("Erro ao excluir anexo:", err)
      toast.error("Erro", { description: err instanceof Error ? err.message : "Erro ao excluir anexo" })
    } finally {
      setDeletingAnexoId(null)
    }
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value)

  const formatDate = (date: string | null) => {
    if (!date) return "N/A"
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(date))
  }

  const formatQuantity = (qty: number) =>
    new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(qty)

  const formatFileSize = (value?: number | null) => {
    if (!value) return "Tamanho nÃ£o informado"
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  const isImageAnexo = (anexo: VendaAnexo) => String(anexo.tipo ?? "").startsWith("image/")

  const showFullLoading = (loading || isSubmitting) && !venda

  const categoriaVendaOptions = venda?.categoria_venda
    ? categoriasVenda.some((c) => c.id === venda.categoria_venda?.id)
      ? categoriasVenda
      : [...categoriasVenda, venda.categoria_venda]
    : categoriasVenda

  const Content = isDesktop ? DialogContent : DrawerContent
  const Header = isDesktop ? DialogHeader : DrawerHeader
  const Title = isDesktop ? DialogTitle : DrawerTitle
  const Description = isDesktop ? DialogDescription : DrawerDescription
  const Footer = isDesktop ? DialogFooter : DrawerFooter
  const Close = isDesktop ? DialogClose : DrawerClose

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Content
        className={
          isDesktop
            ? "h-svh w-[100dvw] max-w-[100dvw] min-w-0 overflow-hidden p-0 sm:max-h-[850px] sm:max-w-[1100px] sm:min-w-0 sm:w-[95vw]"
            : "mt-0 flex h-[100dvh] min-h-dvh max-h-none flex-col rounded-none"
        }
      >
        <div className="flex h-full min-h-0 min-w-0 flex-col">
          {showFullLoading ? (
            <div className="flex flex-1 flex-col items-center justify-center">
              <Header className="hidden">
                <Title />
                <Description />
              </Header>
              <div className="size-8 animate-spin rounded-t-full border-t-2 border-primary" />
              <span className="mt-3 animate-pulse text-sm font-medium text-primary">
                {isSubmitting ? "Salvando alteracoes..." : "Buscando dados da venda..."}
              </span>
            </div>
          ) : (
            <>
              <Header className={isDesktop ? "shrink-0 border-b px-6 py-4" : "shrink-0 px-4 py-2"}>
                <Title className={isDesktop ? "pr-4 text-sm sm:text-lg" : ""}>
                  {venda ? `Venda #${venda.id}` : "Venda"}
                </Title>
                <Description>
                  {venda ? "Detalhes completos da venda" : error ? "Erro ao carregar dados" : "Carregando..."}
                </Description>
              </Header>

              <div className="relative flex-1 min-h-0 min-w-0">
                {error && !venda ? (
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 rounded-full bg-destructive/10 p-3">
                      <AlertCircle className="h-8 w-8 text-destructive" />
                    </div>
                    <p className="font-semibold text-destructive">Erro ao carregar venda</p>
                    <p className="text-sm text-muted-foreground">{error}</p>
                    <Button variant="outline" className="mt-4" onClick={() => fetchVenda()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : venda ? (
                  <Tabs
                    value={currentTab}
                    onValueChange={setCurrentTab}
                    defaultValue="Geral"
                    className="flex h-full min-h-0 flex-col overflow-hidden"
                  >
                    <div className="sticky top-0 z-10 mt-4 shrink-0">
                      <div className={isDesktop ? "overflow-x-auto px-6 pb-2" : "overflow-x-auto px-4 pb-2"}>
                        <TabsList className="h-auto min-w-full justify-start gap-1.5 rounded-2xl border bg-muted/40 p-1 backdrop-blur-sm">
                          {TAB_ITEMS.map((tab) => {
                            const Icon = tab.icon
                            return (
                              <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="group h-8 rounded-xl border border-transparent px-3 text-xs font-medium text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-[state=active]:bg-primary dark:data-[state=active]:bg-primary data-[state=active]:text-primary-foreground dark:data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                              >
                                <span className="flex items-center gap-2">
                                  <Icon className="h-3.5 w-3.5 transition-transform group-data-[state=active]:scale-105" />
                                  {tab.label}
                                </span>
                              </TabsTrigger>
                            )
                          })}
                        </TabsList>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto px-6 py-4">
                      <TabsContent value="Geral" className="m-0 space-y-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
                            <div className="rounded-full bg-primary/10 p-2">
                              <User className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">Cliente</p>
                                  <p className="text-sm font-semibold leading-tight">{venda.cliente.nomerazaosocial}</p>
                                  <p className="text-xs text-muted-foreground">ID: {venda.cliente.id}</p>
                                </div>
                                <CustomerSelect
                                  open={openCustomerSelect}
                                  setOpen={setOpenCustomerSelect}
                                  OnSelect={handleCustomerSelect}
                                >
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="gap-2"
                                    disabled={isSubmitting || loading}
                                  >
                                    <Search className="h-4 w-4" />
                                    Alterar cliente
                                  </Button>
                                </CustomerSelect>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
                            <div className="rounded-full bg-primary/10 p-2">
                              <Calendar className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">Data da Venda</p>
                              <p className="text-sm font-semibold">{formatDate(venda.datavenda)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border bg-card p-4">
                          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Informações do Sistema
                          </h3>

                          
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
                            <div className="rounded-lg border bg-background/80 p-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Status
                              </p>
                              <Badge variant="outline" className={statusColors[venda.status] + " mt-2"}>
                                {statusLabels[venda.status]}
                              </Badge>
                            </div>
                            <div className="rounded-lg border bg-background/80 p-3">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Categoria de venda
                              </p>
                              {loadingCategoriasVenda ? (
                                <p className="mt-2 text-sm font-medium text-muted-foreground">Carregando...</p>
                              ) : (
                                <Select
                                  value={venda.categoriavendaid ? String(venda.categoriavendaid) : "uncategorized"}
                                  onValueChange={(val) =>
                                    handleChange("categoriavendaid", val === "uncategorized" ? null : Number(val))
                                  }
                                >
                                  <SelectTrigger className="mt-2 h-9 w-full">
                                    <SelectValue placeholder="Selecione uma categoria" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="uncategorized">Sem categoria</SelectItem>
                                    {categoriaVendaOptions.map((categoria) => (
                                      <SelectItem key={categoria.id} value={String(categoria.id)}>
                                        {categoria.nome}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                           
                            {venda.updatedat && (
                              <div className="rounded-lg border bg-background/80 p-3">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Atualizado em
                                </p>
                                <p className="mt-1 text-sm font-medium">{formatDate(venda.updatedat)}</p>
                                {venda.editor?.nome && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    por {venda.editor.nome}
                                  </p>
                                )}
                              </div>
                            )}
                            {venda.created_by && (
                              <div className="rounded-lg border bg-background/80 p-3">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Criado por
                                </p>
                                <p className="mt-1 text-sm font-medium">{venda.criador?.nome || venda.created_by}</p>
                              </div>
                            )}
                            <div className="rounded-lg border bg-background/80 p-3 sm:col-span-2 xl:col-span-1">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Vendedor / Responsavel
                              </p>
                              {loadingUsers ? (
                                <p className="mt-2 text-sm font-medium text-muted-foreground">Carregando...</p>
                              ) : (
                                <Select
                                  value={venda.vendedor || "unassigned"}
                                  onValueChange={(val) => handleChange("vendedor", val === "unassigned" ? null : val)}
                                >
                                  <SelectTrigger className="mt-2 h-9 w-full">
                                    <SelectValue placeholder="Selecione um vendedor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unassigned">Sem vendedor</SelectItem>
                                    {users.map((u) => (
                                      <SelectItem key={u.id} value={u.id}>
                                        {u.nome || u.email || u.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                             {venda.createdat && (
                              <div className="rounded-lg border bg-background/80 p-3">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Criado em
                                </p>
                                <p className="mt-1 text-sm font-medium">{formatDate(venda.createdat)}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4 rounded-lg border bg-card p-4">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              Observações internas
                            </h3>
                          </div>
                          <div className="space-y-2">
                            <Textarea
                              id="observacoes"
                              placeholder="Digite observacoes internas da venda..."
                              className="min-h-[120px] resize-none"
                              value={venda.observacoes || ""}
                              onChange={(e) => handleChange("observacoes", e.target.value)}
                            />
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="Entrega" className="m-0 space-y-6">
                        {isMarketplaceCanal(venda.canal) ? (
                          <div className="space-y-6">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
                                <div className="rounded-full bg-primary/10 p-2">
                                  <Package className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex-1 space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">Entrega</p>
                                  <p className="text-sm font-semibold">{venda.status_entrega ?? "Nao iniciada"}</p>
                                  {venda.ultimo_evento_rastreio && (
                                    <p className="text-xs text-muted-foreground">
                                      Rastreio: {venda.ultimo_evento_rastreio}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
                                <div className="rounded-full bg-primary/10 p-2">
                                  <Hash className="h-4 w-4 text-primary" />
                                </div>
                                <div className="flex-1 space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground">Codigo de rastreio</p>
                                  <p className="text-sm font-semibold leading-tight">
                                    {venda.codigo_rastreio ?? "Nao informado"}
                                  </p>
                                  {venda.transportadora_rastreio && (
                                    <p className="text-xs text-muted-foreground">
                                      Transportadora: {venda.transportadora_rastreio}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                            <Truck className="h-12 w-12 opacity-20" />
                            <p>Esta é uma venda de PDV (presencial). Nao possui dados de entrega.</p>
                          </div>
                        )}
                      </TabsContent>

                      <TabsContent value="Financeiro" className="m-0 space-y-6">
                        <div className="space-y-3 rounded-lg border bg-card p-4">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span className="font-medium">{formatCurrency(venda.sub_total)}</span>
                          </div>
                          {venda.desconto_valor > 0 && (
                            <div className="flex items-center justify-between text-sm text-emerald-600 dark:text-emerald-400">
                              <span>Desconto</span>
                              <span className="font-medium">-{formatCurrency(venda.desconto_valor)}</span>
                            </div>
                          )}
                          <Separator className="my-2" />
                          <div className="flex items-center justify-between">
                            <span className="text-base font-semibold">Valor Total</span>
                            <span className="text-xl font-bold text-primary">
                              {formatCurrency(venda.valortotal)}
                            </span>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="Produtos" className="m-0 space-y-6">
                        <div className="space-y-3">
                          {venda.itens.map((item) => (
                            <div key={item.id} className="rounded-lg border bg-card p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <p className="font-semibold leading-tight">{item.produto.titulo}</p>
                                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>
                                      {formatQuantity(item.quantidade)} {item.produto.unidade}
                                    </span>
                                    <span>-</span>
                                    <span>{formatCurrency(item.valor_total / item.quantidade)} / unid.</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-bold">{formatCurrency(item.valor_total)}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TabsContent>

                      <TabsContent value="Fiscal" className="m-0 space-y-6">
                        <div className="space-y-4 rounded-lg border bg-card p-4">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                              Observações fiscais
                            </h3>
                          </div>
                          <div className="space-y-2">
                            <Textarea
                              id="observacoes_fiscais"
                              placeholder="Ex: Venda com beneficio fiscal, isencao de IPI, etc..."
                              className="min-h-[150px] resize-none"
                              value={venda.observacoes_fiscais || ""}
                              onChange={(e) => handleChange("observacoes_fiscais", e.target.value)}
                            />
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="Anexos" className="m-0 space-y-6">
                        <div className="space-y-4">
                          <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Paperclip className="h-4 w-4 text-muted-foreground" />
                                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                  Anexos da venda
                                </h3>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Anexe imagem ou PDF relacionado a esta venda, com categoria definida. Imagens são otimizadas automaticamente.
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {anexos.length}/{MAX_ANEXOS_POR_VENDA} anexos utilizados.
                              </p>
                            </div>
                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px]">
                              <Select
                                value={anexoCategoria}
                                onValueChange={(value) => setAnexoCategoria(value as VendaAnexoCategoria)}
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Categoria do anexo" />
                                </SelectTrigger>
                                <SelectContent>
                                  {VENDA_ANEXO_CATEGORIAS.map((categoria) => (
                                    <SelectItem key={categoria.value} value={categoria.value}>
                                      {categoria.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <input
                                ref={fileInputRef}
                                type="file"
                                className="hidden"
                                accept="image/*,application/pdf"
                                onChange={handleAnexoChange}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                className="gap-2"
                                disabled={uploadingAnexo || loadingAnexos || anexos.length >= MAX_ANEXOS_POR_VENDA}
                                onClick={() => fileInputRef.current?.click()}
                              >
                                {uploadingAnexo ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
                                ) : (
                                  <Upload className="h-4 w-4" />
                                )}
                                {uploadingAnexo
                                  ? "Enviando..."
                                  : anexos.length >= MAX_ANEXOS_POR_VENDA
                                    ? "Limite atingido"
                                    : "Adicionar anexo"}
                              </Button>
                            </div>
                          </div>

                          {loadingAnexos ? (
                            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
                              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
                              <p className="text-sm">Carregando anexos...</p>
                            </div>
                          ) : anexos.length === 0 ? (
                            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center text-muted-foreground">
                              <Paperclip className="h-10 w-10 opacity-25" />
                              <p className="text-sm">Nenhum anexo vinculado.</p>
                            </div>
                          ) : (
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {anexos.map((anexo) => (
                                  <div key={anexo.id} className="overflow-hidden rounded-lg border bg-card">
                                    {isImageAnexo(anexo) ? (
                                      <a href={anexo.url} target="_blank" rel="noreferrer" className="block">
                                        <img
                                          src={anexo.url}
                                          alt={anexo.nome}
                                          className="h-32 w-full object-cover"
                                        />
                                      </a>
                                    ) : (
                                      <div className="flex h-32 items-center justify-center bg-muted/40">
                                        <FileText className="h-10 w-10 text-muted-foreground/50" />
                                      </div>
                                    )}
                                    <div className="space-y-2 p-3">
                                    <div className="min-w-0 space-y-1">
                                      <Badge variant="secondary" className="mb-1">
                                        {getVendaAnexoCategoriaLabel(anexo.categoria)}
                                      </Badge>
                                      <p className="truncate text-sm font-semibold" title={anexo.nome}>
                                        {anexo.nome}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {formatFileSize(anexo.tamanho)}
                                        {anexo.createdat ? ` - ${formatDate(anexo.createdat)}` : ""}
                                      </p>
                                    </div>
                                    <div className="flex items-center justify-end gap-2">
                                      <Button type="button" variant="outline" size="sm" asChild>
                                        <a href={anexo.url} target="_blank" rel="noreferrer" className="gap-2">
                                          <ExternalLink className="h-4 w-4" />
                                          Abrir
                                        </a>
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="gap-2 text-destructive hover:text-destructive"
                                        disabled={deletingAnexoId === anexo.id}
                                        onClick={() => handleDeleteAnexo(anexo.id)}
                                      >
                                        {deletingAnexoId === anexo.id ? (
                                          <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-destructive" />
                                        ) : (
                                          <Trash2 className="h-4 w-4" />
                                        )}
                                        Remover
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </TabsContent>
                    </div>
                  </Tabs>
                ) : null}
              </div>

              <Footer className={isDesktop ? "px-6 py-4" : "px-4 py-4"}>
                <div className="flex w-full justify-end gap-2">
                  <Close asChild>
                    <Button className="hover:cursor-pointer" variant="outline">
                      Cancelar
                    </Button>
                  </Close>
                  <Button
                    type="button"
                    disabled={isSubmitting || loading || !venda}
                    className="min-w-[100px] hover:cursor-pointer"
                    onClick={handleUpdateVenda}
                  >
                    {isSubmitting ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                        Salvando...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Salvar
                      </>
                    )}
                  </Button>
                </div>
              </Footer>
            </>
          )}
        </div>
      </Content>
    </Dialog>
  )
}

function isMarketplaceCanal(canal: unknown) {
  const value = String(canal ?? "").toUpperCase();
  return value === "ONLINE" || value === "MERCADO_LIVRE" || value === "SHOPEE";
}
