import { AlertTriangle, Building2, Pencil, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCpfCnpj, formatFiscalCep } from "@/lib/nfe/recipientNormalization";
import formatarTelefone from "@/utils/formatarTelefone";
import type { ClienteResumo } from "./types";

function Dado({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-medium text-foreground" title={value}>{value || "—"}</dd>
    </div>
  );
}

export function NfseClienteCard({
  cliente,
  pendencias,
  loading,
  onEditar,
}: {
  cliente: ClienteResumo;
  pendencias: string[];
  loading: boolean;
  onEditar: () => void;
}) {
  const pessoaJuridica = cliente.tipopessoa === "JURIDICA";
  const Icone = pessoaJuridica ? Building2 : User;
  const endereco = [
    [cliente.endereco, cliente.endereconumero].filter(Boolean).join(", "),
    cliente.enderecocomplemento,
    cliente.bairro,
  ].filter(Boolean).join(" · ");
  const municipio = [cliente.cidade, cliente.estado].filter(Boolean).join("/");
  // `formatarTelefone` devolve "Número inválido" fora de 10/11 dígitos; aqui o
  // telefone é informativo, então o número cadastrado vale mais que o aviso.
  const telefoneFormatado = formatarTelefone(cliente.telefone) ?? "";
  const telefone = telefoneFormatado === "Número inválido"
    ? String(cliente.telefone ?? "")
    : telefoneFormatado;

  return (
    <section
      className={`border border-l-4 bg-card p-4 shadow-sm ${pendencias.length ? "border-l-amber-600" : "border-l-border"}`}
      aria-labelledby="nfse-tomador-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center border bg-muted text-muted-foreground">
            <Icone aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tomador da nota</p>
              <Badge variant="outline" className="rounded-sm">Cliente #{cliente.id}</Badge>
              {pendencias.length > 0 && (
                <Badge variant="outline" className="rounded-sm border-amber-600/25 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                  <AlertTriangle aria-hidden="true" className="mr-1 size-3.5" />
                  {pendencias.length} {pendencias.length === 1 ? "pendência" : "pendências"}
                </Badge>
              )}
            </div>
            <h2 id="nfse-tomador-title" className="mt-1 truncate text-base font-bold">
              {cliente.nomerazaosocial?.trim() || "Cliente sem nome cadastrado"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pessoaJuridica ? "Pessoa jurídica" : "Pessoa física"}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant={pendencias.length ? "default" : "outline"}
          className="min-h-11 shrink-0 rounded-sm"
          disabled={loading}
          onClick={onEditar}
        >
          <Pencil aria-hidden="true" className="mr-2 size-4" />
          Editar cliente
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3 sm:grid-cols-4">
        <Dado label={pessoaJuridica ? "CNPJ" : "CPF"} value={formatCpfCnpj(cliente.cpfcnpj)} />
        <Dado label="Telefone" value={telefone} />
        <Dado label="CEP" value={formatFiscalCep(cliente.cep)} />
        <Dado label="Município" value={municipio} />
        <Dado label="Endereço" value={endereco} />
        <Dado label="E-mail" value={cliente.email ?? ""} />
        <Dado label="Código IBGE" value={cliente.codigomunicipio ?? ""} />
        <Dado label="Inscrição municipal" value={cliente.inscricaomunicipal ?? ""} />
      </dl>

      {pendencias.length > 0 && (
        <div className="mt-3 border-l-2 border-amber-600/40 bg-amber-600/[0.06] py-2 pl-3 pr-2" role="status">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-amber-800 dark:text-amber-400">
            Complete o cadastro para liberar a emissão
          </p>
          <ul className="mt-1.5 space-y-1">
            {pendencias.map((pendencia) => (
              <li key={pendencia} className="flex gap-1.5 text-xs leading-relaxed text-foreground">
                <span aria-hidden="true" className="text-amber-700 dark:text-amber-500">•</span>
                <span>{pendencia}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
