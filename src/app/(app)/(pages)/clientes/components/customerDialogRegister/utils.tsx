import { Frown, Meh, Smile, SmilePlus } from "lucide-react";
import { Cliente_rank, TelefoneCliente } from "../../types";
import { TelefoneSecundario, TipoPessoa } from "./types";

/** Converte os telefones vindos da API nas linhas editáveis do formulário. */
export const toTelefonesSecundarios = (
  telefones?: TelefoneCliente[] | null,
): TelefoneSecundario[] =>
  (telefones ?? []).map((item) => ({
    id: item.id,
    telefone: item.telefone ?? "",
    contato: item.contato ?? "",
    observacao: item.observacao ?? "",
  }));

 

 export const formatCpfCnpj = (value: string, tipopessoa: TipoPessoa) => {
    const numbers = value.replace(/\D/g, "");

    if (tipopessoa === "FISICA") {
      // CPF: 000.000.000-00
      return numbers.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    } else {
      // CNPJ: 00.000.000/0000-00
      return numbers.replace(
        /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
        "$1.$2.$3/$4-$5"
      );
    }
  };

 export  const formatCep = (value?: string | null) => {
    if(!value) return null;
    const numbers = value.replace(/\D/g, "");
    return numbers.replace(/(\d{5})(\d{3})/, "$1-$2");
  };

 export  const formatTelefone = (value?: string | null) => {
  if(!value) return null;
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 10) {
      return numbers.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
    } else {
      return numbers.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
    }
  };

  export const getRankEmoji = (status: Cliente_rank) => {
    const defaultStyle = "w-3 h-3";
    switch (status) {
      case Cliente_rank.EXELENTE:
        return <SmilePlus className={`${defaultStyle} text-blue-500`}/>
      case Cliente_rank.ALTO:
        return <Smile className={`${defaultStyle} text-green-500`}/>
      case Cliente_rank.NORMAL:
        return <Meh className={`${defaultStyle} text-yellow-500`}/>
      case Cliente_rank.BAIXO:
        return <Frown className={`${defaultStyle} text-red-500`}/>
      
      default:
        return <Meh className={`${defaultStyle} text-gray-500`} />
    }
  }
