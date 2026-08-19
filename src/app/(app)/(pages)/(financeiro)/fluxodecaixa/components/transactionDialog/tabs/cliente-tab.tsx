"use client";

import { Building2, User } from "lucide-react";

import { formatCpfCnpj } from "../../../utils";
import type { FormularioTransacao } from "../use-transacao-edicao";

import { Campo, Cartao, EstadoVazio, fmtPhone, fmtText, joinParts } from "./shared";
import type { ClienteContexto, FornecedorContexto } from "./types";

/**
 * Quem pagou ou recebeu — a vista por extenso.
 *
 * Só leitura: a edição vive na aba Detalhes, junto do resto do formulário, para
 * não haver dois lugares mexendo nos mesmos campos. Aqui ficam os dados que não
 * cabem lá — telefone, e-mail, endereço —, que vêm do contexto e não do
 * formulário.
 *
 * O cadastro mostrado é o vinculado à TRANSAÇÃO, não o cliente da OS: a ordem é
 * de quem mandou consertar o carro, e o pagamento pode vir da seguradora, da
 * empresa ou de um terceiro.
 */
export function ClienteTab({
  cliente,
  fornecedor,
  form,
  editavel,
}: {
  cliente: ClienteContexto | null;
  fornecedor: FornecedorContexto | null;
  form: FormularioTransacao;
  editavel: boolean;
}) {
  const vinculado = form.cliente_id != null || form.fornecedor_id != null;

  /*
   * O cartão vem do contexto, que é o que está no BANCO. Enquanto uma troca
   * feita na aba Detalhes não for salva, ele descreve outra pessoa — por isso só
   * aparece quando o cadastro carregado é o mesmo que o formulário aponta.
   * Endereço e telefone de quem foi substituído seriam pior do que nenhum.
   */
  const detalhesValem =
    (cliente != null && cliente.id === form.cliente_id) ||
    (fornecedor != null && fornecedor.id === form.fornecedor_id);

  if (vinculado && !detalhesValem) {
    return (
      <div className="space-y-3">
        <Cartao titulo="Pagador / recebedor" icone={<User className="h-3.5 w-3.5" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Nome">{fmtText(form.nomepagador)}</Campo>
            <Campo label="CPF / CNPJ">
              {form.cpfcnpjpagador ? formatCpfCnpj(form.cpfcnpjpagador) : "—"}
            </Campo>
          </div>
        </Cartao>
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Cadastro trocado na aba Detalhes e ainda não salvo. Telefone, e-mail e
          endereço aparecem aqui depois de salvar.
        </p>
      </div>
    );
  }

  if (detalhesValem && cliente && form.cliente_id != null) {
    return <CartaoDoCliente cliente={cliente} />;
  }

  if (detalhesValem && fornecedor && form.fornecedor_id != null) {
    return <CartaoDoFornecedor fornecedor={fornecedor} />;
  }

  // Sem cadastro vinculado a transacao ainda guarda o pagador em texto livre.
  if (form.nomepagador || form.cpfcnpjpagador) {
    return (
      <div className="space-y-3">
        <Cartao titulo="Pagador / recebedor" icone={<User className="h-3.5 w-3.5" />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Nome">{fmtText(form.nomepagador)}</Campo>
            <Campo label="CPF / CNPJ">
              {form.cpfcnpjpagador ? formatCpfCnpj(form.cpfcnpjpagador) : "—"}
            </Campo>
          </div>
        </Cartao>
        <p className="text-xs text-muted-foreground">
          Esta transação não tem cliente nem fornecedor cadastrado vinculado — os
          dados acima foram digitados no lançamento.
          {editavel ? " Para vincular um cadastro, use a aba Detalhes." : ""}
        </p>
      </div>
    );
  }

  return <EstadoVazio>Esta transação não tem pagador informado.</EstadoVazio>;
}

function CartaoDoCliente({ cliente }: { cliente: ClienteContexto }) {
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
        <Campo label="Nome / Razão social">{fmtText(cliente.nomerazaosocial)}</Campo>
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

function CartaoDoFornecedor({ fornecedor }: { fornecedor: FornecedorContexto }) {
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
