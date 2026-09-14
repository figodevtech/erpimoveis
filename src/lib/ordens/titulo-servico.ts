// O título de um serviço dentro de uma OS, montado de duas fontes.
//
// `servico.descricao` é o nome do cadastro; `osservico.descricao` é o texto
// livre da linha — o que foi feito naquele veículo. Serviços guarda-chuva
// ("REPARO", "SERVIÇOS DIVERSOS") só se explicam pelo texto livre, e o nome do
// cadastro sozinho não diz nada a quem lê o financeiro.
//
// Antes cada tela escolhia um dos dois: o painel de itens mostrava o cadastro,
// o evento financeiro mostrava o texto livre, e conferir a OS contra o
// financeiro virava adivinhação. Agora os dois dizem
// "REPARO - RECUPERAÇÃO DO CILINDRO DA CABINE".
//
// A mesma regra existe no banco, em `public.titulo_servico_os`
// (20260913120000), que é quem carimba a descrição do evento financeiro. Ao
// mexer numa, mexa na outra — senão a tela e o livro voltam a divergir.

const texto = (valor: unknown) =>
  typeof valor === "string" ? valor.replace(/\s+/g, " ").trim() : "";

/**
 * Junta o nome do cadastro com o texto livre da linha da OS.
 *
 * - os dois, diferentes → `"REPARO - RECUPERAÇÃO DO CILINDRO DA CABINE"`
 * - só um deles → o que existir
 * - texto livre já começando pelo cadastro → só ele, sem repetir o nome
 * - nenhum dos dois → `"Serviço #37"`, para a linha nunca sair sem nome
 */
export function tituloServicoDaOs(
  descricaoCadastro: unknown,
  descricaoItem: unknown,
  servicoid?: number | string | null,
): string {
  const cadastro = texto(descricaoCadastro);
  const item = texto(descricaoItem);

  // O texto livre que já começa pelo nome do cadastro vale sozinho — senão
  // "MAO DE OBRA + SERVIÇO, REVISAO NA BOMBA" viraria "MAO DE OBRA + SERVIÇO -
  // MAO DE OBRA + SERVIÇO, REVISAO NA BOMBA". Cobre de quebra o texto idêntico,
  // que é o caso comum de quem repete o nome do serviço no campo livre.
  //
  // Comparação sem caixa: o campo é digitado à mão e a oficina alterna entre
  // maiúsculas e minúsculas no mesmo dia.
  const jaComecaPeloCadastro =
    !!cadastro && !!item &&
    item.toLocaleLowerCase("pt-BR").startsWith(cadastro.toLocaleLowerCase("pt-BR"));

  if (cadastro && item) return jaComecaPeloCadastro ? item : `${cadastro} - ${item}`;
  if (cadastro) return cadastro;
  if (item) return item;
  return servicoid ? `Serviço #${servicoid}` : "Serviço";
}
