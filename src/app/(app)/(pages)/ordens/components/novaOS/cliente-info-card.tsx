import {
  Building2,
  Calendar,
  Car,
  FileText,
  Mail,
  MapPin,
  Phone,
  User,
  Wrench,
} from "lucide-react";
import { CustomerBlockedAlert } from "@/components/cliente/customer-blocked-alert";
import formatarTelefone from "@/utils/formatarTelefone";
import type { Customer } from "../../../clientes/types";

type CustomerDatumProps = {
  icon: typeof User;
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
};

function CustomerDatum({
  icon: Icon,
  label,
  value,
  className,
  valueClassName,
}: CustomerDatumProps) {
  return (
    <div className={className}>
      <dt className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3" aria-hidden="true" />
        {label}
      </dt>
      <dd
        className={`mt-1 truncate text-xs font-medium text-foreground ${valueClassName ?? ""}`}
        title={value}
      >
        {value || "—"}
      </dd>
    </div>
  );
}

function formatCpfCnpj(value: string, tipoPessoa: Customer["tipopessoa"]) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (tipoPessoa === "FISICA") {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ClienteInfoCard({ customer }: { customer: Customer }) {
  const isCompany = customer.tipopessoa === "JURIDICA";
  const address = [
    [customer.endereco, customer.endereconumero].filter(Boolean).join(", "),
    customer.enderecocomplemento,
    customer.bairro,
    [customer.cidade, customer.estado].filter(Boolean).join("/"),
    customer.cep ? `CEP ${customer.cep}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="@container overflow-hidden border border-border bg-background">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-foreground dark:bg-primary/20 dark:border dark:border-primary dark:text-white px-3 py-2.5 text-background sm:px-4">
        <div className="flex size-8 shrink-0 items-center justify-center border border-background/25">
          {isCompany ? (
            <Building2 className="size-4" aria-hidden="true" />
          ) : (
            <User className="size-4" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold uppercase tracking-wide sm:text-base">
            {customer.nomerazaosocial || "Cliente sem nome"}
          </h3>
          <p className="text-[11px] text-background/65 dark:text-white/80">
            #{customer.id} · {isCompany ? "Pessoa jurídica" : "Pessoa física"}
          </p>
        </div>
        <span
          className={
            customer.status === "INATIVO"
              ? "border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200"
              : customer.status === "PENDENTE"
                ? "border border-amber-400/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-200"
                : "border border-emerald-400/50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300"
          }
        >
          {customer.status || "ATIVO"}
        </span>
      </header>

      <CustomerBlockedAlert
        status={customer.status}
        compact
        className="border-b border-border px-3 py-2 sm:px-4"
      />

      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 p-3 @sm:grid-cols-2 @3xl:grid-cols-4 sm:p-4">
        <CustomerDatum
          icon={FileText}
          label={isCompany ? "CNPJ" : "CPF"}
          value={formatCpfCnpj(customer.cpfcnpj, customer.tipopessoa)}
        />
        <CustomerDatum icon={Phone} label="Telefone" value={formatarTelefone(customer.telefone) || "—"} />
        <CustomerDatum icon={Mail} label="E-mail" value={customer.email || "—"} />
        <CustomerDatum icon={Calendar} label="Cadastro" value={formatDate(customer.createdat)} />

        <CustomerDatum
          icon={MapPin}
          label="Endereço"
          value={address || "Não informado"}
          className="@sm:col-span-2 @3xl:col-span-4"
          valueClassName="whitespace-normal"
        />

        {isCompany && (customer.inscricaoestadual || customer.inscricaomunicipal) ? (
          <>
            <CustomerDatum
              icon={FileText}
              label="Inscrição estadual"
              value={customer.inscricaoestadual || "—"}
            />
            <CustomerDatum
              icon={FileText}
              label="Inscrição municipal"
              value={customer.inscricaomunicipal || "—"}
            />
          </>
        ) : null}

        {customer.veiculos ? (
          <CustomerDatum icon={Car} label="Veículos" value={String(customer.veiculos.length)} />
        ) : null}
        {customer.ordens ? (
          <CustomerDatum icon={Wrench} label="Ordens" value={String(customer.ordens.length)} />
        ) : null}
      </dl>
    </article>
  );
}
