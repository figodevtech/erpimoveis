"use client"
import { ChecklistVideoCamera } from "@/components/checklist-video-camera";
import { useEntityVideos } from "@/lib/videos/use-entity-videos";
import { EntityVideoPreview } from "@/components/entity-video-preview";
import { VideoViewerDialog } from "@/components/video-viewer-dialog";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react"
import { useSession } from "next-auth/react"
import { PERMS, permissionSetHas } from "@/app/api/_authz/permission-constants"
import { VendaEventosFinanceiros } from "./venda-eventos-financeiros"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Calendar,
  User,
  Package,
  Hash,
  ShoppingCart,
  ReceiptText,
  AlertCircle,
  Truck,
  FileText,
  Download,
  Save,
  Search,
  Paperclip,
  Upload,
  ExternalLink,
  Trash2,
  Plus,
  Minus,
  Phone,
  Mail,
  MapPin,
  type LucideIcon,
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
import { Input } from "@/components/ui/input"
import ValueInput from "@/components/ui/value-input"
import CustomerSelect from "@/app/(app)/components/customerSelect"
import ProductSelect from "@/app/(app)/components/productSelect"
import type { Customer } from "@/app/(app)/(pages)/clientes/types"
import type { Produto as EstoqueProduto } from "@/app/(app)/(pages)/estoque/types"
import { formatPaymentMethodLabel, type PaymentMethodOption } from "@/lib/payment-methods"
import { usePaymentMethodOptions } from "@/hooks/use-payment-method-options"
import { calculateFinancialSurcharge, calculateFinancialTotal } from "@/lib/financial-surcharge"
import { formatCpfCnpj } from "@/lib/nfe/recipientNormalization"
import formatarTelefone from "@/utils/formatarTelefone"
import {
  VENDA_ANEXO_CATEGORIAS,
  getVendaAnexoCategoriaLabel,
  type VendaAnexoCategoria,
} from "@/lib/venda-anexo-categorias"
import {
  DadosParaFinanceiroFields,
  dadosParaFinanceiroDaVenda,
  dadosParaFinanceiroVazios,
  formaAceitaParcelas,
  montarFormaPagamento,
  montarPagamentosPrevistos,
  validarDadosParaFinanceiro,
  type DadosParaFinanceiro,
} from "@/components/financeiro/dados-para-financeiro"

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
  valor_frete: number
  quantidade: number
}

interface Cliente {
  id: number
  nomerazaosocial: string
  tipopessoa?: "FISICA" | "JURIDICA" | string | null
  cpfcnpj?: string | null
  email?: string | null
  telefone?: string | null
  endereco?: string | null
  endereconumero?: string | null
  enderecocomplemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  status?: string | null
  rank?: string | null
}

function formatarDocumentoCliente(value?: string | null) {
  const original = String(value ?? "").trim()
  if (!original) return null
  const digitos = original.replace(/\D/g, "")
  return digitos.length === 11 || digitos.length === 14 ? formatCpfCnpj(digitos) : original
}

function formatarTelefoneCliente(value?: string | null) {
  const original = String(value ?? "").trim()
  if (!original) return null
  const formatado = formatarTelefone(original)
  return formatado && formatado !== "Número inválido" ? formatado : original
}

function DadoClienteCompacto({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value?: string | null
}) {
  const exibido = String(value ?? "").trim() || "Não informado"
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={`${label}: ${exibido}`}>
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="truncate text-[11px] font-medium text-foreground/85">{exibido}</span>
    </div>
  )
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
  statusaprovacao?: "PENDENTE" | "APROVADA" | "REPROVADA" | null
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
  motivo_cancelamento?: string | null
  cancelada_at?: string | null
  cancelada_by?: string | null
  cancelada_por?: { id: string; nome: string | null } | null
  editor?: {
    id: string
    nome: string
  } | null
  desconto_tipo: string | null
  desconto_valor: number
  valor_frete: number
  acrescimo_financeiro_tipo: "FIXO" | "PORCENTAGEM" | null
  acrescimo_financeiro_valor: number
  forma_pagamento?: string | null
  /** Formas previstas com valor e parcelas, como combinadas no fechamento. */
  pagamentos_previstos?: Array<{ metodo: string; valor: number; parcelas?: number | null }> | null
  descricao_financeiro?: string | null
  garantia?: string | null
  sub_total: number
  descricao?: string | null
  observacoes?: string | null
  observacoes_fiscais?: string | null
  itens: VendaProduto[]
}

interface VendaDetailsDialogProps {
  vendaId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

const statusColors: Record<vendaStatus, string> = {
  ORCAMENTO: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20",
  APROVACAO_ORCAMENTO: "bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20",
  ORCAMENTO_APROVADO: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  ORCAMENTO_RECUSADO: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
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
  ORCAMENTO: "Orçamento",
  APROVACAO_ORCAMENTO: "Aprovação orçamento",
  ORCAMENTO_APROVADO: "Orçamento aprovado",
  ORCAMENTO_RECUSADO: "Orçamento recusado",
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
  { value: "Eventos", label: "Eventos financeiros", icon: ReceiptText },
  { value: "Produtos", label: "Produtos", icon: Package },
  { value: "Fiscal", label: "Fiscal", icon: FileText },
  { value: "Anexos", label: "Anexos", icon: Paperclip },
] as const

const roundMoney = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100

function itemUnitPrice(item: VendaProduto) {
  return roundMoney(Number(item.sub_total ?? 0) / Math.max(Number(item.quantidade ?? 1), 1))
}

function itemDiscountApplied(item: VendaProduto) {
  const gross = Math.max(0, Number(item.sub_total ?? 0))
  const raw = Math.max(0, Number(item.valor_desconto ?? 0))
  return item.tipo_desconto === "PORCENTAGEM"
    ? roundMoney(gross * (Math.min(raw, 100) / 100))
    : item.tipo_desconto === "FIXO"
      ? Math.min(gross, roundMoney(raw))
      : 0
}

function recalculateItem(
  item: VendaProduto,
  changes: { quantidade?: number; precoUnitario?: number; desconto?: number; descontoTipo?: string | null; frete?: number },
) {
  const quantidade = Math.max(1, Math.trunc(changes.quantidade ?? item.quantidade ?? 1))
  const precoUnitario = Math.max(0, changes.precoUnitario ?? itemUnitPrice(item))
  const tipoDesconto = changes.descontoTipo === undefined ? item.tipo_desconto : changes.descontoTipo
  const desconto = Math.max(0, changes.desconto ?? item.valor_desconto ?? 0)
  const frete = Math.max(0, changes.frete ?? item.valor_frete ?? 0)
  const subTotal = roundMoney(precoUnitario * quantidade)
  const descontoAplicado = tipoDesconto === "PORCENTAGEM"
    ? roundMoney(subTotal * (Math.min(desconto, 100) / 100))
    : tipoDesconto === "FIXO"
      ? Math.min(subTotal, roundMoney(desconto))
      : 0

  return {
    ...item,
    quantidade,
    sub_total: subTotal,
    valor_desconto: tipoDesconto ? desconto : 0,
    tipo_desconto: tipoDesconto,
    valor_frete: roundMoney(frete),
    valor_total: roundMoney(subTotal - descontoAplicado + frete),
  }
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

type PaymentAmounts = Partial<Record<PaymentMethodOption, string>>

const moneyToCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100)
const centsToNumber = (value: number) => value / 100

const amountInputToCents = (value: string): number | null => {
  const raw = value.trim()
  if (!raw) return null

  const digits = raw.replace(/\D/g, "")
  if (digits) return Number(digits)

  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null

  return moneyToCents(parsed)
}

const formatCentsToPaymentInput = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centsToNumber(Math.max(0, value)))

/**
 * Separa os métodos de forma_pagamento.
 *
 * `split(",")` direto não serve: o valor em pt-BR também tem vírgula, então
 * "PIX: R$ 3.000,00" virava ["PIX: R$ 3.000", "00"] e o "00" órfão derrubava o
 * parse inteiro. Só quebra quando o trecho seguinte começa com um método
 * conhecido — vírgula dentro de valor fica onde está.
 */
function splitFormaPagamento(text: string): string[] {
  return text.includes(":")
    ? text.split(/,\s*(?=[A-Z][A-Z0-9_]*\s*:)/).map((entry) => entry.trim()).filter(Boolean)
    : text.split(",").map((entry) => entry.trim()).filter(Boolean)
}

/**
 * A string em forma_pagamento pode vir como "PIX", "PIX, CREDITO" (sem valores) ou
 * "PIX: R$ 100,00, CREDITO: R$ 50,00" (formato gerado pelo PDV). Só reidrata os
 * métodos/valores quando reconhece TODOS os tokens; caso contrário, começa vazio
 * em vez de arriscar interpretar texto livre legado como um método inválido.
 */
function parseFormaPagamento(raw: string | null | undefined): {
  methods: PaymentMethodOption[]
  amounts: PaymentAmounts
} {
  const text = String(raw ?? "").trim()
  if (!text) return { methods: [], amounts: {} }

  const parts = splitFormaPagamento(text)
  if (!parts.length) return { methods: [], amounts: {} }

  const methods: PaymentMethodOption[] = []
  const amounts: PaymentAmounts = {}

  for (const part of parts) {
    const [methodRaw, ...valueParts] = part.split(":")
    const method = methodRaw.trim().toUpperCase()
    if (!/^[A-Z][A-Z0-9_]*$/.test(method)) return { methods: [], amounts: {} }

    methods.push(method as PaymentMethodOption)
    const valueText = valueParts.join(":").trim()
    if (valueText) {
      const cents = amountInputToCents(valueText.replace(/[^\d.,]/g, ""))
      if (cents != null) amounts[method as PaymentMethodOption] = formatCentsToPaymentInput(cents)
    }
  }

  return { methods, amounts }
}

/**
 * Reidrata os dados do financeiro para edição.
 *
 * `pagamentos_previstos` é a fonte quando existe: guarda forma, valor e parcelas
 * como dado. Venda anterior à coluna tem só `forma_pagamento`, o resumo em texto
 * — dele saem formas e valores, mas não parcelas, que nunca chegaram a ser
 * gravadas. Reabrir uma venda dessas e salvar passa a registrar as duas coisas.
 */
function hidratarDadosFinanceiro(venda: Venda | null | undefined): DadosParaFinanceiro {
  const dados = dadosParaFinanceiroDaVenda(venda ?? {})
  if (dados.metodos.length > 0) return dados

  const legado = parseFormaPagamento(venda?.forma_pagamento)
  for (const metodo of legado.methods) {
    dados.metodos.push(metodo)
    dados.valores[metodo] = centsToNumber(amountInputToCents(legado.amounts[metodo] ?? "") ?? 0)
    if (formaAceitaParcelas(metodo)) dados.parcelas[metodo] = 1
  }

  return dados
}

export function VendaDetailsDialog({ vendaId, open, onOpenChange, onSaved }: VendaDetailsDialogProps) {
  const { options: paymentMethodOptions } = usePaymentMethodOptions()
  const [venda, setVenda] = useState<Venda | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [itemsDirty, setItemsDirty] = useState(false)
  const [openCustomerSelect, setOpenCustomerSelect] = useState(false)
  const [openProductSelect, setOpenProductSelect] = useState(false)
  const [currentTab, setCurrentTab] = useState<string>("Geral")
  const { data: session } = useSession()
  const podeVerEventos = permissionSetHas((session?.user as any)?.permissoes, PERMS.FINANCEIRO)
  /*
   * Trocar o vendedor transfere a comissão: o banco lê `vendedor` como
   * beneficiário e reapura pela taxa de quem entra. Por isso não basta
   * `vendas:editar` — quem corrige uma descrição não move dinheiro de uma
   * pessoa para outra. Quem decide é o servidor; aqui só evitamos oferecer um
   * campo que a gravação recusaria.
   */
  const podeAlterarVendedor = permissionSetHas(
    (session?.user as any)?.permissoes,
    PERMS.VENDAS_ALTERAR_VENDEDOR,
  )
  const [users, setUsers] = useState<Array<{ id: string; nome: string | null }>>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [categoriasVenda, setCategoriasVenda] = useState<CategoriaVenda[]>([])
  const [loadingCategoriasVenda, setLoadingCategoriasVenda] = useState(false)
  const [anexos, setAnexos] = useState<VendaAnexo[]>([])
  const vendaVideos = useEntityVideos(vendaId, "venda", open)
  const [loadingAnexos, setLoadingAnexos] = useState(false)
  const [uploadingAnexo, setUploadingAnexo] = useState(false)
  const [deletingAnexoId, setDeletingAnexoId] = useState<number | null>(null)
  const [anexoCategoria, setAnexoCategoria] =
    useState<VendaAnexoCategoria>("COMPROVANTE_PAGAMENTO")
  const [dadosFinanceiro, setDadosFinanceiro] = useState<DadosParaFinanceiro>(
    dadosParaFinanceiroVazios,
  )
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const itemEditingLocked = venda
    ? ["PAGO", "FINALIZADA", "CANCELADA", "CANCELADO"].includes(String(venda.status).toUpperCase())
    : true
  const itemsSubTotal = roundMoney(
    venda?.itens.reduce((sum, item) => sum + Math.max(0, Number(item.sub_total ?? 0)), 0) ?? 0,
  )
  const itemsDiscount = roundMoney(
    venda?.itens.reduce((sum, item) => sum + itemDiscountApplied(item), 0) ?? 0,
  )
  const itemsFreight = roundMoney(
    venda?.itens.reduce((sum, item) => sum + Math.max(0, Number(item.valor_frete ?? 0)), 0) ?? 0,
  )
  const generalDiscountBase = Math.max(0, roundMoney(itemsSubTotal - itemsDiscount))
  const generalDiscount = venda?.desconto_tipo === "PORCENTAGEM"
    ? roundMoney(generalDiscountBase * (Math.min(Math.max(Number(venda.desconto_valor ?? 0), 0), 100) / 100))
    : venda?.desconto_tipo === "FIXO"
      ? Math.min(generalDiscountBase, Math.max(0, Number(venda.desconto_valor ?? 0)))
      : 0
  const commercialTotal = roundMoney(
    generalDiscountBase + itemsFreight - generalDiscount + Math.max(0, Number(venda?.valor_frete ?? 0)),
  )
  const financialSurcharge = calculateFinancialSurcharge(
    commercialTotal,
    venda?.acrescimo_financeiro_tipo,
    venda?.acrescimo_financeiro_valor,
  )
  const financialTotal = calculateFinancialTotal(
    commercialTotal,
    venda?.acrescimo_financeiro_tipo,
    venda?.acrescimo_financeiro_valor,
  )

  useEffect(() => {
    if (!open || !podeAlterarVendedor) return
    let active = true
    const loadUsers = async () => {
      try {
        setLoadingUsers(true)
        setUsersError(null)
        const response = await fetch("/api/venda/vendedores", { cache: "no-store" })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || "Erro ao carregar vendedores")
        if (active) setUsers(Array.isArray(data?.users) ? data.users : [])
      } catch (fetchError) {
        if (active) setUsersError(fetchError instanceof Error ? fetchError.message : "Erro ao carregar vendedores")
      } finally {
        if (active) setLoadingUsers(false)
      }
    }
    loadUsers()
    return () => { active = false }
  }, [open, podeAlterarVendedor])

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
      setItemsDirty(false)
      setDadosFinanceiro(hidratarDadosFinanceiro(result.data))
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
      setItemsDirty(false)
      setDadosFinanceiro(dadosParaFinanceiroVazios())
    }
  }, [open, vendaId, fetchVenda, fetchAnexos])

  const handleUpdateVenda = async () => {
    if (!venda || !vendaId) return

    if (!venda.itens.length) {
      toast.error("A venda deve possuir ao menos um produto.")
      return
    }
    if (venda.itens.some((item) => item.quantidade <= 0 || itemUnitPrice(item) <= 0)) {
      toast.error("Revise as quantidades e os preços dos produtos.")
      return
    }
    if (!itemEditingLocked) {
      const recusa = validarDadosParaFinanceiro(dadosFinanceiro, moneyToCents(financialTotal))
      if (recusa) {
        toast.error(recusa)
        return
      }
    }

    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/venda/${vendaId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clienteId: venda.clienteid,
          descricao: venda.descricao,
          observacoes: venda.observacoes,
          observacoesFiscais: venda.observacoes_fiscais,
          vendedor: venda.vendedor,
          categoriaVendaId: venda.categoriavendaid ?? null,
          dataVenda: venda.datavenda,
          formaPagamento: montarFormaPagamento(dadosFinanceiro),
          pagamentosPrevistos: montarPagamentosPrevistos(dadosFinanceiro),
          descricaoFinanceiro: dadosFinanceiro.descricaoFinanceiro.trim() || null,
          garantia: dadosFinanceiro.garantia.trim() || null,
          descontoTipo: venda.desconto_tipo,
          descontoValor: venda.desconto_tipo ? Math.max(0, Number(venda.desconto_valor ?? 0)) : 0,
          valorFrete: Math.max(0, Number(venda.valor_frete ?? 0)),
          acrescimoFinanceiroTipo: venda.acrescimo_financeiro_tipo,
          acrescimoFinanceiroValor: venda.acrescimo_financeiro_tipo
            ? Math.max(0, Number(venda.acrescimo_financeiro_valor ?? 0))
            : 0,
          subTotal: itemsSubTotal,
          valorTotal: commercialTotal,
          ...(itemEditingLocked || !itemsDirty
            ? {}
            : {
                itens: venda.itens.map((item) => ({
                  produtoId: item.produtoid,
                  quantidade: item.quantidade,
                  precoUnitario: itemUnitPrice(item),
                  valorDesconto: item.tipo_desconto ? Math.max(0, Number(item.valor_desconto ?? 0)) : 0,
                  tipoDesconto: item.tipo_desconto,
                  valorFrete: Math.max(0, Number(item.valor_frete ?? 0)),
                  subTotal: item.sub_total,
                  valorTotal: item.valor_total,
                })),
              }),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Erro ao atualizar venda")
      }

      toast.success("Sucesso!", { description: "Venda atualizada com sucesso.", duration: 2000 })
      setVenda(null)
      await fetchVenda()
      onSaved?.()
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

  const updateSaleItem = (
    itemId: number,
    changes: { quantidade?: number; precoUnitario?: number; desconto?: number; descontoTipo?: string | null; frete?: number },
  ) => {
    setItemsDirty(true)
    setVenda((prev) => prev
      ? {
          ...prev,
          itens: prev.itens.map((item) => item.id === itemId ? recalculateItem(item, changes) : item),
        }
      : prev)
  }

  const addProduct = (product: EstoqueProduto) => {
    if (!product.id || !product.precovenda || product.precovenda <= 0) {
      toast.error("O produto selecionado não possui preço de venda válido.")
      return
    }
    const productId = product.id
    const productPrice = product.precovenda
    setItemsDirty(true)

    setVenda((prev) => {
      if (!prev) return prev
      const existing = prev.itens.find((item) => item.produtoid === productId)
      if (existing) {
        return {
          ...prev,
          itens: prev.itens.map((item) => item.id === existing.id
            ? recalculateItem(item, { quantidade: item.quantidade + 1 })
            : item),
        }
      }

      const now = new Date().toISOString()
      const item: VendaProduto = {
        id: -Date.now(),
        created_at: now,
        updated_at: now,
        venda_id: prev.id,
        produtoid: productId,
        produto: product as unknown as Produto,
        sub_total: roundMoney(productPrice),
        valor_total: roundMoney(productPrice),
        valor_desconto: 0,
        tipo_desconto: null,
        valor_frete: 0,
        quantidade: 1,
      }
      return { ...prev, itens: [...prev.itens, item] }
    })
  }

  const removeSaleItem = (itemId: number) => {
    setItemsDirty(true)
    setVenda((prev) => prev ? { ...prev, itens: prev.itens.filter((item) => item.id !== itemId) } : prev)
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
              tipopessoa: customer.tipopessoa,
              cpfcnpj: customer.cpfcnpj,
              email: customer.email,
              telefone: customer.telefone,
              endereco: customer.endereco,
              endereconumero: customer.endereconumero,
              enderecocomplemento: customer.enderecocomplemento,
              bairro: customer.bairro,
              cidade: customer.cidade,
              estado: customer.estado,
              cep: customer.cep,
              status: customer.status,
              rank: customer.rank,
            },
          }
        : prev,
    )
  }
  const handleAnexoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || !vendaId) return

    if (file.type.startsWith("video/")) {
      try { await vendaVideos.upload(file, anexoCategoria); toast.success("Vídeo anexado") }
      catch (error) { toast.error("Erro", { description: error instanceof Error ? error.message : "Falha ao anexar vídeo" }) }
      return
    }

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
                          {TAB_ITEMS.filter((tab) => tab.value !== "Eventos" || podeVerEventos).map((tab) => {
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
                          <div className="flex items-start gap-2.5 rounded-lg border bg-card p-3">
                            <div className="rounded-full bg-primary/10 p-2">
                              <User className="h-4 w-4 text-primary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-0.5">
                                  <p className="text-xs font-medium text-muted-foreground">Cliente</p>
                                  <p className="truncate text-sm font-semibold leading-tight" title={venda.cliente.nomerazaosocial}>
                                    {venda.cliente.nomerazaosocial}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    #{venda.cliente.id}
                                    {venda.cliente.tipopessoa
                                      ? ` · ${venda.cliente.tipopessoa === "JURIDICA" ? "Pessoa jurídica" : "Pessoa física"}`
                                      : ""}
                                  </p>
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
                                    className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                                    disabled={isSubmitting || loading}
                                    title="Alterar cliente da venda"
                                  >
                                    <Search className="h-3.5 w-3.5" />
                                    Alterar
                                  </Button>
                                </CustomerSelect>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t pt-2">
                                <DadoClienteCompacto
                                  icon={FileText}
                                  label={venda.cliente.tipopessoa === "JURIDICA" ? "CNPJ" : "CPF"}
                                  value={formatarDocumentoCliente(venda.cliente.cpfcnpj)}
                                />
                                <DadoClienteCompacto
                                  icon={Phone}
                                  label="Fone"
                                  value={formatarTelefoneCliente(venda.cliente.telefone)}
                                />
                                <DadoClienteCompacto icon={Mail} label="E-mail" value={venda.cliente.email} />
                                <DadoClienteCompacto
                                  icon={MapPin}
                                  label="Cidade"
                                  value={[venda.cliente.cidade, venda.cliente.estado].filter(Boolean).join("/")}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 rounded-lg border bg-card p-4">
                            <div className="rounded-full bg-primary/10 p-2">
                              <Calendar className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">Data da Venda</p>
                              <Input
                                type="datetime-local"
                                value={toDateTimeLocal(venda.datavenda)}
                                onChange={(event) =>
                                  handleChange(
                                    "datavenda",
                                    event.target.value ? new Date(event.target.value).toISOString() : null,
                                  )
                                }
                              />
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
                              {venda.statusaprovacao ? (
                                <Badge variant="outline" className="ml-2 mt-2">
                                  Aprovação: {venda.statusaprovacao === "REPROVADA" ? "RECUSADA" : venda.statusaprovacao}
                                </Badge>
                              ) : null}
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
                              ) : !podeAlterarVendedor ? (
                                /*
                                  Sem a permissão o nome aparece como texto, e
                                  não como um seletor desabilitado: um campo
                                  travado parece um ajuste que dá para
                                  destravar, e a pessoa fica tentando.
                                */
                                <>
                                  <p className="mt-2 text-sm font-medium">
                                    {venda.vendedor_rel?.nome || venda.vendedor || "Sem vendedor"}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    Trocar o vendedor transfere a comissão e depende da
                                    permissão “Alterar vendedor da venda”.
                                  </p>
                                </>
                              ) : usersError ? (
                                <p className="mt-2 text-sm text-destructive">{usersError}</p>
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
                                        {u.nome || u.id}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                            {venda.motivo_cancelamento && (
                              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:col-span-2">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Motivo do cancelamento
                                </p>
                                <p className="mt-1 text-sm">{venda.motivo_cancelamento}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {venda.cancelada_at ? formatDate(venda.cancelada_at) : "Data não informada"}
                                  {venda.cancelada_por?.nome ? ` por ${venda.cancelada_por.nome}` : ""}
                                </p>
                              </div>
                            )}
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
                              Descrição
                            </h3>
                          </div>
                          <Textarea
                            id="descricao"
                            placeholder="Descrição comercial exibida ao cliente..."
                            className="min-h-[100px] resize-none"
                            value={venda.descricao || ""}
                            onChange={(e) => handleChange("descricao", e.target.value)}
                          />
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
                        <div className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2">
                          <div className="space-y-2 md:col-span-2">
                            <p className="text-xs font-medium text-muted-foreground">Dados para o financeiro</p>
                            {itemEditingLocked ? (
                              <div className="space-y-3 text-sm">
                                <p className="font-medium">
                                  {dadosFinanceiro.metodos.length > 0
                                    ? dadosFinanceiro.metodos
                                        .map((metodo) => {
                                          const rotulo =
                                            paymentMethodOptions.find((opcao) => opcao.value === metodo)?.label ??
                                            formatPaymentMethodLabel(metodo)
                                          const parcelas = Number(dadosFinanceiro.parcelas[metodo] ?? 0)
                                          const sufixo = parcelas > 1 ? ` em ${parcelas}x` : ""
                                          return `${rotulo}: ${formatCurrency(Number(dadosFinanceiro.valores[metodo] ?? 0))}${sufixo}`
                                        })
                                        .join(", ")
                                    : "Não informado"}
                                </p>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground">Descrição para o financeiro</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words">
                                    {dadosFinanceiro.descricaoFinanceiro.trim() || "Nenhuma orientação informada."}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground">Garantia</p>
                                  <p className="mt-1 whitespace-pre-wrap break-words">
                                    {dadosFinanceiro.garantia.trim() || "Nenhuma garantia informada."}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <DadosParaFinanceiroFields
                                value={dadosFinanceiro}
                                onChange={setDadosFinanceiro}
                                totalCents={moneyToCents(financialTotal)}
                              />
                            )}
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Tipo de desconto geral</p>
                            <Select
                              value={venda.desconto_tipo ?? "NONE"}
                              onValueChange={(value) => {
                                handleChange("desconto_tipo", value === "NONE" ? null : value)
                                if (value === "NONE") handleChange("desconto_valor", 0)
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Sem desconto" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Sem desconto</SelectItem>
                                <SelectItem value="FIXO">Fixo</SelectItem>
                                <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              {venda.desconto_tipo === "PORCENTAGEM" ? "Desconto (%)" : "Valor do desconto"}
                            </p>
                            {venda.desconto_tipo === "PORCENTAGEM" ? (
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                disabled={!venda.desconto_tipo}
                                value={venda.desconto_valor || ""}
                                onChange={(event) => handleChange("desconto_valor", Math.min(100, Number(event.target.value || 0)))}
                              />
                            ) : (
                              <ValueInput
                                value={venda.desconto_valor}
                                disabled={!venda.desconto_tipo}
                                onValueChange={(value) => handleChange("desconto_valor", Math.min(generalDiscountBase, value))}
                              />
                            )}
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Frete</p>
                            <ValueInput
                              value={venda.valor_frete}
                              onValueChange={(value) => handleChange("valor_frete", value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Tipo de acréscimo financeiro</p>
                            <Select
                              value={venda.acrescimo_financeiro_tipo ?? "NONE"}
                              onValueChange={(value) => {
                                handleChange("acrescimo_financeiro_tipo", value === "NONE" ? null : value)
                                if (value === "NONE") handleChange("acrescimo_financeiro_valor", 0)
                              }}
                            >
                              <SelectTrigger><SelectValue placeholder="Sem acréscimo" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Sem acréscimo</SelectItem>
                                <SelectItem value="FIXO">Fixo</SelectItem>
                                <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">
                              {venda.acrescimo_financeiro_tipo === "PORCENTAGEM" ? "Acréscimo (%)" : "Valor do acréscimo"}
                            </p>
                            {venda.acrescimo_financeiro_tipo === "PORCENTAGEM" ? (
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.01"
                                disabled={!venda.acrescimo_financeiro_tipo}
                                value={venda.acrescimo_financeiro_valor || ""}
                                onChange={(event) => handleChange("acrescimo_financeiro_valor", Math.min(100, Number(event.target.value || 0)))}
                              />
                            ) : (
                              <ValueInput
                                value={venda.acrescimo_financeiro_valor}
                                disabled={!venda.acrescimo_financeiro_tipo}
                                onValueChange={(value) => handleChange("acrescimo_financeiro_valor", value)}
                              />
                            )}
                          </div>
                        </div>

                        <div className="space-y-3 rounded-lg border bg-card p-4">
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Produtos</span><span>{formatCurrency(itemsSubTotal)}</span></div>
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Descontos dos itens</span><span>-{formatCurrency(itemsDiscount)}</span></div>
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Fretes dos itens</span><span>+{formatCurrency(itemsFreight)}</span></div>
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Desconto geral</span><span>-{formatCurrency(generalDiscount)}</span></div>
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Frete geral</span><span>+{formatCurrency(venda.valor_frete)}</span></div>
                          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Acréscimo financeiro</span><span>+{formatCurrency(financialSurcharge)}</span></div>
                          <Separator className="my-2" />
                          <div className="flex items-center justify-between"><span className="text-base font-semibold">Total financeiro</span><span className="text-xl font-bold text-primary">{formatCurrency(financialTotal)}</span></div>
                        </div>
                      </TabsContent>

                      {podeVerEventos ? <TabsContent value="Eventos" className="m-0 space-y-6"><VendaEventosFinanceiros key={venda.id} vendaId={venda.id} /></TabsContent> : null}

                      <TabsContent value="Produtos" className="m-0 space-y-6">
                        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold">Produtos da venda</p>
                            <p className="text-xs text-muted-foreground">
                              {itemEditingLocked
                                ? "Os itens ficam bloqueados quando a venda está paga, finalizada ou cancelada."
                                : "Altere produto, quantidade, preço e desconto. O estoque será reconciliado ao salvar."}
                            </p>
                          </div>
                          {!itemEditingLocked ? (
                            <ProductSelect open={openProductSelect} setOpen={setOpenProductSelect} OnSelect={addProduct}>
                              <Button type="button" variant="outline"><Plus className="mr-2 h-4 w-4" />Adicionar produto</Button>
                            </ProductSelect>
                          ) : null}
                        </div>

                        <div className="space-y-3">
                          {venda.itens.map((item) => (
                            <div key={item.id} className="rounded-lg border bg-card p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold leading-tight">{item.produto.titulo}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">Produto #{item.produtoid} · {item.produto.unidade}</p>
                                </div>
                                {!itemEditingLocked ? (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    onClick={() => removeSaleItem(item.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                ) : <p className="font-bold">{formatCurrency(item.valor_total)}</p>}
                              </div>

                              {!itemEditingLocked ? (
                                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Quantidade</p>
                                    <div className="flex items-center gap-1">
                                      <Button type="button" size="icon" variant="outline" onClick={() => updateSaleItem(item.id, { quantidade: Math.max(1, item.quantidade - 1) })}><Minus className="h-3.5 w-3.5" /></Button>
                                      <Input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={item.quantidade}
                                        onChange={(event) => updateSaleItem(item.id, { quantidade: Number(event.target.value || 1) })}
                                        className="text-center"
                                      />
                                      <Button type="button" size="icon" variant="outline" onClick={() => updateSaleItem(item.id, { quantidade: item.quantidade + 1 })}><Plus className="h-3.5 w-3.5" /></Button>
                                    </div>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Preço unitário</p>
                                    <ValueInput value={itemUnitPrice(item)} onValueChange={(value) => updateSaleItem(item.id, { precoUnitario: value })} />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Tipo de desconto</p>
                                    <Select
                                      value={item.tipo_desconto ?? "NONE"}
                                      onValueChange={(value) => updateSaleItem(item.id, { descontoTipo: value === "NONE" ? null : value, desconto: value === "NONE" ? 0 : item.valor_desconto })}
                                    >
                                      <SelectTrigger><SelectValue placeholder="Sem desconto" /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="NONE">Sem desconto</SelectItem>
                                        <SelectItem value="FIXO">Fixo</SelectItem>
                                        <SelectItem value="PORCENTAGEM">Porcentagem</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Desconto</p>
                                    {item.tipo_desconto === "PORCENTAGEM" ? (
                                      <Input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step="0.01"
                                        value={item.valor_desconto || ""}
                                        onChange={(event) => updateSaleItem(item.id, { desconto: Math.min(100, Number(event.target.value || 0)) })}
                                      />
                                    ) : (
                                      <ValueInput
                                        value={item.valor_desconto}
                                        disabled={!item.tipo_desconto}
                                        onValueChange={(value) => updateSaleItem(item.id, { desconto: Math.min(item.sub_total, value) })}
                                      />
                                    )}
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Frete do produto</p>
                                    <ValueInput
                                      value={item.valor_frete}
                                      onValueChange={(value) => updateSaleItem(item.id, { frete: value })}
                                    />
                                  </div>
                                </div>
                              ) : null}

                              <div className="mt-3 flex flex-wrap justify-end gap-4 border-t pt-3 text-sm">
                                <span className="text-muted-foreground">Subtotal: {formatCurrency(item.sub_total)}</span>
                                {itemDiscountApplied(item) > 0 ? <span className="text-emerald-700">Desconto: -{formatCurrency(itemDiscountApplied(item))}</span> : null}
                                {item.valor_frete > 0 ? <span className="text-muted-foreground">Frete: +{formatCurrency(item.valor_frete)}</span> : null}
                                <span className="font-semibold">Total: {formatCurrency(item.valor_total)}</span>
                              </div>
                            </div>
                          ))}
                          {!venda.itens.length ? (
                            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhum produto adicionado.</div>
                          ) : null}
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
                                Anexe imagem, PDF ou vídeo relacionado a esta venda. Imagens e vídeos são otimizados automaticamente.
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {anexos.length + vendaVideos.videos.length} anexos · limite de {MAX_ANEXOS_POR_VENDA} para imagens e PDFs.
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
                                size="sm" className="h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5"
                                disabled={uploadingAnexo || loadingAnexos || !!vendaVideos.busy || anexos.length >= MAX_ANEXOS_POR_VENDA}
                                onClick={() => fileInputRef.current?.click()}
                              >
                                {uploadingAnexo ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-primary" />
                                ) : (
                                  <Upload className="h-4 w-4" />
                                )}
                                {uploadingAnexo ? "Enviando..." : "Adicionar foto ou PDF"}
                              </Button>
                              {vendaVideos.enabled && vendaVideos.canEdit && <>
                                <input ref={videoInputRef} type="file" className="hidden" accept="video/*" onChange={handleAnexoChange} />
                                <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5" disabled={uploadingAnexo || loadingAnexos || !!vendaVideos.busy} onClick={() => videoInputRef.current?.click()}>
                                  <Upload className="h-4 w-4" />{vendaVideos.busy || "Escolher vídeo salvo"}
                                </Button>
            <ChecklistVideoCamera compact disabled={uploadingAnexo || loadingAnexos || !!vendaVideos.busy} onCapture={file => { void vendaVideos.upload(file, anexoCategoria).catch(() => undefined); }} />
            <p className="basis-full text-xs text-muted-foreground">Para gravar em Full HD, use Gravar vídeo aqui no ERP. No seletor do iPhone, escolha Fototeca ou Arquivos.</p>
                              </>}
                              {vendaVideos.error && <p role="alert" className="text-xs text-destructive">{vendaVideos.error}</p>}
                            </div>
                          </div>

                          {loadingAnexos || vendaVideos.loading ? (
                            <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-lg border text-muted-foreground">
                              <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
                              <p className="text-sm">Carregando anexos...</p>
                            </div>
                          ) : anexos.length === 0 && vendaVideos.videos.length === 0 ? (
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
                              {vendaVideos.videos.map((video) => (
                                <div key={`video-${video.id}`} className="overflow-hidden rounded-lg border bg-card">
                                  <div className="h-32 w-full"><EntityVideoPreview id={video.id} name={video.name} access={vendaVideos.access} open={vendaVideos.open} /></div>
                                  <div className="space-y-2 p-3">
                                    <Badge variant="secondary">{getVendaAnexoCategoriaLabel(video.category as VendaAnexoCategoria || "COMPROVANTE_PAGAMENTO")} · Vídeo</Badge>
                                    <p className="truncate text-sm font-semibold" title={video.name}>{video.name}</p>
                                    <p className="text-xs text-muted-foreground">{formatFileSize(video.size_bytes)}{video.created_at ? ` - ${formatDate(video.created_at)}` : ""}</p>
                                    <div className="flex items-center justify-end gap-2">
                                      <Button type="button" variant="outline" size="sm" onClick={() => vendaVideos.open(video.id)}>Visualizar</Button>
                                      <Button type="button" variant="outline" size="sm" aria-label="Baixar vídeo" onClick={() => void vendaVideos.download(video.id).catch(error => toast.error("Erro", { description: error.message }))}><Download className="h-4 w-4" /></Button>
                                      {vendaVideos.canDelete && vendaVideos.canEdit && <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={!!vendaVideos.busy} onClick={() => {
                                        if (window.confirm("Excluir permanentemente este vídeo?")) void vendaVideos.remove(video.id).catch(error => toast.error("Erro", { description: error.message }));
                                      }}><Trash2 className="h-4 w-4" />Remover</Button>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {vendaVideos.viewing && <VideoViewerDialog key={vendaVideos.viewing.id} id={vendaVideos.viewing.id} name={vendaVideos.viewing.name} access={vendaVideos.access} onClose={vendaVideos.closeViewer} />}
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
