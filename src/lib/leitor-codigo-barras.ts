/**
 * Leitor de codigo de barras USB/Bluetooth em modo teclado (HID): ele "digita"
 * o codigo em poucos milissegundos por caractere e fecha com Enter (alguns,
 * com Tab). O que separa a leitura da digitacao humana e a velocidade — nenhuma
 * pessoa digita 8 digitos seguidos com menos de 60ms entre eles.
 */

/** Intervalo maximo entre dois caracteres da mesma leitura. */
export const INTERVALO_MAXIMO_ENTRE_CARACTERES_MS = 60;
/** O sufixo (Enter/Tab) as vezes chega um pouco depois do ultimo digito. */
export const INTERVALO_MAXIMO_ATE_SUFIXO_MS = 150;

/** Mesma regra do campo do cadastro: GTIN de 8 a 14 digitos. */
const CODIGO_LIDO = /^\d{8,14}$/;

const MODIFICADORES = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock", "NumLock"]);

export type TeclaRegistrada =
  /** Caractere comum; `inicio` marca o primeiro da rajada (antes de entrar no campo). */
  | { tipo: "caractere"; inicio: boolean }
  /** Sufixo fechando uma rajada valida: e uma leitura do aparelho. */
  | { tipo: "leitura"; codigo: string }
  | { tipo: "outra" };

export function criarDetectorDeLeitura() {
  let rajada = "";
  let ultimaTecla = Number.NEGATIVE_INFINITY;

  return {
    /** Recebe `event.key` e `event.timeStamp` de cada keydown, na ordem. */
    registrar(tecla: string, instante: number): TeclaRegistrada {
      // Shift antes de letra maiuscula faz parte da rajada, nao a interrompe.
      if (MODIFICADORES.has(tecla)) return { tipo: "outra" };

      const intervalo = instante - ultimaTecla;
      ultimaTecla = instante;

      if (tecla === "Enter" || tecla === "Tab") {
        const codigo = rajada;
        rajada = "";
        return intervalo <= INTERVALO_MAXIMO_ATE_SUFIXO_MS && CODIGO_LIDO.test(codigo)
          ? { tipo: "leitura", codigo }
          : { tipo: "outra" };
      }

      if (tecla.length !== 1) {
        rajada = "";
        return { tipo: "outra" };
      }

      const continua = rajada !== "" && intervalo <= INTERVALO_MAXIMO_ENTRE_CARACTERES_MS;
      rajada = continua ? rajada + tecla : tecla;
      return { tipo: "caractere", inicio: !continua };
    },
  };
}

type ProdutoLido = {
  id: number;
  titulo: string | null;
  exibirPdv: boolean | null;
  grupo: { exibirPdv: boolean | null } | null;
};

export type ResultadoDaLeitura<P extends ProdutoLido> =
  | { resultado: "encontrado"; produto: P }
  | { resultado: "nao_encontrado" }
  /** Existe, mas o produto ou o grupo dele esta oculto no PDV. */
  | { resultado: "fora_do_pdv"; titulo: string | null }
  /** Mais de um produto visivel com o mesmo codigo: quem escolhe e o operador. */
  | { resultado: "ambiguo"; produtos: Array<{ id: number; titulo: string | null }> };

/**
 * Mesma regra de visibilidade do catalogo do PDV (`pdv_search_products`):
 * produto e grupo com exibirPdv ligado. Recebe so produtos nao excluidos.
 */
export function classificarProdutosLidos<P extends ProdutoLido>(candidatos: P[]): ResultadoDaLeitura<P> {
  if (candidatos.length === 0) return { resultado: "nao_encontrado" };

  const visiveis = candidatos.filter((p) => p.exibirPdv === true && p.grupo?.exibirPdv === true);
  if (visiveis.length === 0) return { resultado: "fora_do_pdv", titulo: candidatos[0].titulo };
  if (visiveis.length > 1) {
    return { resultado: "ambiguo", produtos: visiveis.map((p) => ({ id: p.id, titulo: p.titulo })) };
  }
  return { resultado: "encontrado", produto: visiveis[0] };
}
