// StatusBadge.tsx
import { ClientStatus, type ContaSiteCliente } from "./types"
import { Badge } from "@/components/ui/badge"

/** Situação da conta do site em linguagem de atendimento; null quando não há conta. */
export const getContaSiteLabel = (site?: ContaSiteCliente | null) => {
    if (!site) return null
    if (site.status === "ATIVO") return "Site: acesso ativo"
    if (site.status === "BLOQUEADO") return "Site: acesso bloqueado"
    if (site.motivo_pendencia === "EMAIL_NAO_CONFIRMADO") return "Site: aguardando confirmação do e-mail"
    if (site.motivo_pendencia === "CADASTRO_DIVERGENTE") return "Site: conferir cadastro"
    return "Site: acesso pendente"
  }

export const getStatusBadge = (status: ClientStatus) => {
    switch (status) {
      case ClientStatus.ATIVO:
        return <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">Ativo</Badge>
      case ClientStatus.INATIVO:
        return <Badge variant="secondary" className="bg-red-100 text-gray-800">Inativo</Badge>
      case ClientStatus.PENDENTE:
        return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">Pendente</Badge>
      default:
        return <Badge variant="secondary">Desconhecido</Badge>
    }
  }
