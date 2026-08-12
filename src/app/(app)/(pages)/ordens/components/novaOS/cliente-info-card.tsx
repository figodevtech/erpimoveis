import { User, Mail, Phone, MapPin, FileText, Building2, Calendar, Package, Wrench } from "lucide-react"
import { Customer } from "../../../clientes/types"
import formatarTelefone from "@/utils/formatarTelefone"
import { CustomerBlockedAlert } from "@/components/cliente/customer-blocked-alert"

export type TipoPessoa = "FISICA" | "JURIDICA"
export type ClientStatus = "ATIVO" | "INATIVO" | "PENDENTE"

interface CustomerInfoCardProps {
  customer: Customer
}

export function ClienteInfoCard({ customer }: CustomerInfoCardProps) {
  const formatCpfCnpj = (value: string) => {
    if (customer.tipopessoa === "FISICA") {
      return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    }
    return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
  }

  const getStatusColor = (status: ClientStatus) => {
    switch (status) {
      case "ATIVO":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
      case "INATIVO":
        return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      case "PENDENTE":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  return (
    <div className="w-full bg-card rounded-lg border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-primary/20 px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 dark:bg-primary-foreground/10 not-dark:bg-primary-foreground rounded-lg">
              {customer.tipopessoa === "FISICA" ? (
                <User className="w-5 h-5 text-primary" />
              ) : (
                <Building2 className="w-5 h-5 text-primary-foreground" />
              )}
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-primary text-balance">
                {customer.nomerazaosocial || ""}
              </h2>
              <p className="text-sm text-primary-foreground mt-0.5">
                {customer.tipopessoa === "FISICA" ? "Pessoa Física" : "Pessoa Jurídica"}
              </p>
            </div>
          </div>
          <div
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium self-start sm:self-center ${getStatusColor(customer.status)}`}
          >
            {customer.status || ""}
          </div>
        </div>
      </div>

      <CustomerBlockedAlert
        status={customer.status}
        className="px-4 pt-4 md:px-6"
      />

      {/* Content */}
      <div className="p-4 md:p-6 space-y-6">
        {/* Dados Principais */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Dados Principais</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
              <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{customer.tipopessoa === "FISICA" ? "CPF" : "CNPJ"}</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{formatCpfCnpj(customer.cpfcnpj)}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
              <Mail className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">E-mail</p>
                <p className="text-sm font-medium text-foreground mt-0.5 truncate">{customer.email || ""}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
              <Phone className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Telefone</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{formatarTelefone(customer.telefone)  || ""}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-md">
              <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Cadastrado em</p>
                <p className="text-sm font-medium text-foreground mt-0.5">{formatDate(customer.createdat)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Endereço */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Endereço</h3>
          <div className="p-4 bg-muted/50 rounded-md space-y-2">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {customer.endereco || ""}, {customer.endereconumero || ""}
                  {customer.enderecocomplemento && ` - ${customer.enderecocomplemento}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {customer.bairro || ""} - {customer.cidade || ""}/{customer.estado || ""}
                </p>
                <p className="text-sm text-muted-foreground">CEP: {customer.cep || ""}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Inscrições (apenas para PJ) */}
        {customer.tipopessoa === "JURIDICA" && (customer.inscricaoestadual || customer.inscricaomunicipal) && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Inscrições</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {customer.inscricaoestadual && (
                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-xs text-muted-foreground">Inscrição Estadual</p>
                  <p className="text-sm font-medium text-foreground mt-0.5">{customer.inscricaoestadual}</p>
                </div>
              )}
              {customer.inscricaomunicipal && (
                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-xs text-muted-foreground">Inscrição Municipal</p>
                  <p className="text-sm font-medium text-foreground mt-0.5">{customer.inscricaomunicipal}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Estatísticas */}
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-border">
            {customer.veiculos && (

          <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
            <Package className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-2xl font-bold text-foreground">{customer.veiculos.length}</p>
              <p className="text-xs text-muted-foreground">Veículos</p>
            </div>
          </div>
            )}
          {customer.ordens && (

          <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
            <Wrench className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-2xl font-bold text-foreground">{customer.ordens.length}</p>
              <p className="text-xs text-muted-foreground">Ordens</p>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
