// Modelo de dados do relatório consolidado: as seções são declaradas como
// dados, não como JSX, para que a paginação consiga medi-las antes de render.

export type Tom = "neutro" | "positivo" | "negativo" | "destaque";

export type Coluna = {
  titulo: string;
  /** Largura fixa em mm; sem isso a coluna absorve a sobra da folha. */
  largura?: string;
  direita?: boolean;
};

export type Celula = {
  principal: string;
  apoio?: string;
  tom?: Tom;
  forte?: boolean;
};

export type Linha = { chave: string; celulas: Celula[] };

export type Secao = {
  id: string;
  titulo: string;
  /** Texto da tabela sem nenhuma linha — a seção aparece mesmo assim. */
  vazio: string;
  colunas: Coluna[];
  linhas: Linha[];
  rodape?: Celula[];
  /** Preenchido quando a seção foi cortada no limite de linhas. */
  aviso?: string;
};

/* -------------------------------------------------------------------------
 * Alturas em milímetros. A folha corta o excedente sem avisar, então todos
 * os valores arredondam para cima do que o layout realmente ocupa.
 * ----------------------------------------------------------------------- */
export const MM_LINHA_SIMPLES = 6;
export const MM_LINHA_DUPLA = 8;
export const MM_CABECALHO_SECAO = 10;
export const MM_RODAPE_SECAO = 7;
export const MM_ESPACO_SECAO = 3;
export const MM_AVISO_SECAO = 4;

/** Folha A4 retrato menos margens, cabeçalho do documento e faixa de KPIs. */
export const MM_PRIMEIRA_FOLHA = 244;
export const MM_DEMAIS_FOLHAS = 270;

export function alturaLinha(linha: Linha) {
  return linha.celulas.some((celula) => celula.apoio) ? MM_LINHA_DUPLA : MM_LINHA_SIMPLES;
}

/** Uma seção pode aparecer em mais de uma folha; cada fatia repete o cabeçalho. */
export type Fatia = {
  secao: Secao;
  linhas: Linha[];
  continuacao: boolean;
  /** O rodapé de totais só sai na fatia que fecha a seção. */
  fechaSecao: boolean;
};

export function paginar(secoes: Secao[]): Fatia[][] {
  const folhas: Fatia[][] = [];
  let folha: Fatia[] = [];
  let usado = 0;

  const fechar = () => {
    if (folha.length) folhas.push(folha);
    folha = [];
    usado = 0;
  };
  const limite = () => (folhas.length === 0 ? MM_PRIMEIRA_FOLHA : MM_DEMAIS_FOLHAS);

  secoes.forEach((secao) => {
    const fixo = MM_CABECALHO_SECAO + MM_ESPACO_SECAO + (secao.aviso ? MM_AVISO_SECAO : 0);

    // Seção vazia: só o cabeçalho e a linha de aviso.
    if (!secao.linhas.length) {
      if (usado + fixo + MM_LINHA_SIMPLES > limite()) fechar();
      folha.push({ secao, linhas: [], continuacao: false, fechaSecao: true });
      usado += fixo + MM_LINHA_SIMPLES;
      return;
    }

    let indice = 0;
    let continuacao = false;

    while (indice < secao.linhas.length) {
      let disponivel = limite() - usado - fixo;
      // Não vale abrir uma seção no pé da folha para caber uma linha só.
      if (disponivel < MM_LINHA_DUPLA * 2) {
        fechar();
        disponivel = limite() - fixo;
      }

      const fatia: Linha[] = [];
      let altura = 0;

      for (let cursor = indice; cursor < secao.linhas.length; cursor += 1) {
        const proxima = alturaLinha(secao.linhas[cursor]);
        const fecharia = cursor === secao.linhas.length - 1;
        const extra = fecharia && secao.rodape ? MM_RODAPE_SECAO : 0;

        if (altura + proxima + extra > disponivel && fatia.length) break;
        fatia.push(secao.linhas[cursor]);
        altura += proxima + extra;
      }

      if (!fatia.length) {
        fechar();
        continue;
      }

      indice += fatia.length;
      const fechaSecao = indice >= secao.linhas.length;
      folha.push({ secao, linhas: fatia, continuacao, fechaSecao });
      usado += fixo + altura;
      continuacao = true;

      if (!fechaSecao) fechar();
    }
  });

  fechar();
  return folhas.length ? folhas : [[]];
}
