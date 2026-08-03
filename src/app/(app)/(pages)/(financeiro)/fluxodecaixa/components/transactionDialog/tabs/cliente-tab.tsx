"use client";

import { Building2, User } from "lucide-react";

import { formatCpfCnpj } from "../../../utils";

import { Campo, Cartao, EstadoVazio, fmtPhone, fmtText, joinParts } from "./shared";
import type { ClienteContexto, FornecedorContexto } from "./types";

export function ClienteTab({
  cliente,
  fornecedor,
  nomepagador,
  cpfcnpjpagador,
}: {
  cliente: ClienteContexto | null;
  fornecedor: FornecedorContexto | null;
  nomepagador?: string | null;
  cpfcnpjpagador?: string | null;
}) {
  if (cliente) {
    const endereco = joinParts([
      cliente.endereco,
      cliente.endereconumero ? `Nº ${cliente.endereconumero}` : null,
      cliente.enderecocomplemento,
    ]);
    const local = joinParts(
      [cliente.bairro, cliente.cidade, cliente.estado, cliente.cep ? `CEP ${cliente.cep}` : null],
      " • ",
    );

    return (
      <Cartao titulo="Cliente vinculado" icone={<User className="h-3.5 w-3.5" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nome / Razão social">
            {fmtText(cliente.nomerazaosocial)}
          </Campo>
          <Campo label="CPF / CNPJ">
            {cliente.cpfcnpj ? formatCpfCnpj(cliente.cpfcnpj) : "—"}
          </Campo>
          <Campo label="Telefone">{fmtPhone(cliente.telefone)}</Campo>
          <Campo label="E-mail">{fmtText(cliente.email)}</Campo>
          <div className="sm:col-span-2">
            <Campo label="Endereço">
              {endereco || local ? (
                <div className="font-normal">
                  {endereco && <div>{endereco}</div>}
                  {local && <div className="text-muted-foreground">{local}</div>}
                </div>
              ) : (
                "—"
              )}
            </Campo>
          </div>
        </div>
      </Cartao>
    );
  }

  if (fornecedor) {
    const endereco = joinParts([
      fornecedor.endereco,
      fornecedor.endereconumero ? `Nº ${fornecedor.endereconumero}` : null,
    ]);
    const local = joinParts(
      [
        fornecedor.bairro,
        fornecedor.cidade,
        fornecedor.estado,
        fornecedor.cep ? `CEP ${fornecedor.cep}` : null,
      ],
      " • ",
    );

    return (
      <Cartao titulo="Fornecedor vinculado" icone={<Building2 className="h-3.5 w-3.5" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Razão social">{fmtText(fornecedor.nomerazaosocial)}</Campo>
          <Campo label="Nome fantasia">{fmtText(fornecedor.nomefantasia)}</Campo>
          <Campo label="CPF / CNPJ">
            {fornecedor.cpfcnpj ? formatCpfCnpj(fornecedor.cpfcnpj) : "—"}
          </Campo>
          <Campo label="Contato">{fmtText(fornecedor.contato)}</Campo>
          <div className="sm:col-span-2">
            <Campo label="Endereço">
              {endereco || local ? (
                <div className="font-normal">
                  {endereco && <div>{endereco}</div>}
                  {local && <div className="text-muted-foreground">{local}</div>}
                </div>
              ) : (
                "—"
              )}
            </Campo>
          </div>
        </div>
      </Cartao>
    );
  }

  // Sem cadastro vinculado a transacao ainda guarda o pagador em texto livre.
  if (nomepagador || cpfcnpjpagador) {
    return (
      <div className="space-y-3">
        <Cartao titulo="Pagador / recebedor" icone={<User className="h-3.5 w-3.5" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Nome">{fmtText(nomepagador)}</Campo>
            <Campo label="CPF / CNPJ">
              {cpfcnpjpagador ? formatCpfCnpj(cpfcnpjpagador) : "—"}
            </Campo>
          </div>
        </Cartao>
        <p className="text-xs text-muted-foreground">
          Esta transação não tem cliente nem fornecedor cadastrado vinculado — os
          dados acima foram digitados no registro.
        </p>
      </div>
    );
  }

  return <EstadoVazio>Esta transação não tem pagador informado.</EstadoVazio>;
}
