import Image from "next/image";

import { A4PdfActions } from "@/app/(app)/(full)/components/A4PdfActions";
import { PrintA4Paginator } from "@/app/(app)/(full)/components/PrintA4Paginator";
import { brl, montarIndicadores, pct } from "@/app/(app)/(pages)/(financeiro)/dre/apresentacao";
import type { LinhaDre, RespostaDre } from "@/app/(app)/(pages)/(financeiro)/dre/types";
import type { EmpresaDaImpressao } from "@/lib/print/empresa";
import { cn } from "@/lib/utils";

import { AjusteUmaFolha } from "./ajuste-uma-folha";
import { linhasDaFolha, periodoEmTexto, variacaoEmTexto, type PapelDaLinha } from "./report-model";

const CLASSE_DO_PAPEL: Record<PapelDaLinha, string> = {
  GRUPO: "dre-grupo",
  SUBGRUPO: "dre-subgrupo",
  CONTA: "dre-detalhe",
  SUBTOTAL: "dre-subtotal",
  RESULTADO: "dre-resultado",
  RESULTADO_FINAL: "dre-resultado dre-resultado-final",
};

/** Recuo por nível, em mm: a hierarquia do template fica visível sem depender de cor. */
const recuo = (nivel: number) => `${2 + (Math.max(1, nivel) - 1) * 4.5}mm`;

/**
 * A DRE numa folha A4.
 *
 * A estrutura é a do template e os valores são os da apuração — esta folha não
 * soma nada. O layout é dimensionado para a demonstração inteira caber numa
 * folha, e `AjusteUmaFolha` aperta as linhas se precisar. A montagem das folhas
 * é do `PrintA4Paginator`, o mesmo da OS e do checklist: ele mede antes de
 * imprimir, então a prévia na tela é exatamente o papel — e, se um modelo muito
 * maior não couber, divide em folhas sem cortar linha.
 */
export function DreReport({
  periodo,
  template,
  linhas,
  indicadores,
  empresa,
  logoUrl,
  emitidoEm,
}: {
  periodo: RespostaDre["periodo"];
  template: RespostaDre["template"];
  linhas: LinhaDre[];
  indicadores: Record<string, number>;
  empresa: EmpresaDaImpressao | null;
  logoUrl: string | null;
  emitidoEm: string;
}) {
  const periodoTexto = periodoEmTexto(periodo);
  const anteriorTexto = periodoEmTexto(periodo.anterior);
  const folha = linhasDaFolha(linhas);
  const dadosDaEmpresa = empresa
    ? [
        [empresa.razaoSocial, empresa.cnpj && `CNPJ ${empresa.cnpj}`].filter(Boolean).join(" · "),
        [empresa.endereco, empresa.telefone && `Tel. ${empresa.telefone}`].filter(Boolean).join(" · "),
      ].filter(Boolean)
    : [];

  return (
    <main className="dre-impressao">
      <style>{DRE_IMPRESSAO_CSS}</style>

      <div className="dre-barra print:hidden">
        <div className="min-w-0">
          <p className="dre-barra-titulo">Demonstração do Resultado</p>
          <p className="dre-barra-apoio">Visualização de impressão · {periodoTexto}</p>
        </div>
        <A4PdfActions
          filename={`dre-${periodo.de}-a-${periodo.ate}.pdf`}
          backHref="/dre"
          selector=".print-generated-page.dre-folha"
          pixelRatio={3}
          quality={0.98}
        />
      </div>

      <div className="dre-rolagem" role="region" aria-label="Prévia da DRE em formato A4" tabIndex={0}>
        <div
          data-print-pagination-root
          data-print-pagination-number-pages
          data-print-pagination-footer={`Documento gerado pelo ERP em ${emitidoEm}`}
        >
          <AjusteUmaFolha />
          <PrintA4Paginator />
          <div data-print-pagination-source-holder>
            <article className="dre-folha" data-print-pagination-source>
              <div className="conteudo">
                <header className="dre-cabecalho">
                  {logoUrl && (
                    <div className="dre-logo">
                      <Image src={logoUrl} alt="Logo da empresa" width={64} height={64} unoptimized priority />
                    </div>
                  )}
                  <div className="dre-empresa">
                    {empresa && <p className="dre-empresa-nome">{empresa.nome}</p>}
                    {dadosDaEmpresa.map((dados) => (
                      <p key={dados} className="dre-empresa-dados">{dados}</p>
                    ))}
                  </div>
                  <p className="dre-emissao">
                    Gerado em
                    <strong>{emitidoEm}</strong>
                  </p>
                </header>

                <div className="dre-titulo">
                  <h1>Demonstração do Resultado do Exercício — DRE</h1>
                  <p>
                    Período: <strong>{periodoTexto}</strong>
                    <span className="dre-titulo-apoio">
                      {" "}
                      · Regime de competência · Comparativo com {anteriorTexto}
                    </span>
                  </p>
                </div>

                <section className="dre-indicadores" aria-label="Resumo do resultado">
                  {montarIndicadores(indicadores).map((card) => (
                    <div key={card.chave} className="dre-indicador">
                      <div className="dre-indicador-topo">
                        <span className="dre-indicador-rotulo">{card.rotulo}</span>
                        {/* A receita líquida é a base das margens: ela mesma não tem uma. */}
                        {card.chave !== "rl" && (
                          <span className="dre-indicador-apoio">
                            {card.extra === null ? "margem indisponível" : `margem ${pct(card.extra)}`}
                          </span>
                        )}
                      </div>
                      <div className={cn("dre-indicador-valor", card.valor < 0 && "negativo")}>{brl(card.valor)}</div>
                    </div>
                  ))}
                </section>

                <table className="dre-tabela" data-print-items-table>
                  <colgroup>
                    <col />
                    <col style={{ width: "30mm" }} />
                    <col style={{ width: "30mm" }} />
                    <col style={{ width: "21mm" }} />
                    <col style={{ width: "17mm" }} />
                  </colgroup>
                  <thead>
                    {/* Cabeçalho corrido: só aparece da segunda folha em diante. */}
                    <tr className="dre-corrido">
                      <th colSpan={5}>
                        <span className="dre-corrido-conteudo">
                          <span>{empresa?.nome ?? "Demonstração do Resultado do Exercício"}</span>
                          <span>DRE · {periodoTexto}</span>
                        </span>
                      </th>
                    </tr>
                    <tr className="dre-colunas">
                      <th scope="col">Conta</th>
                      <th scope="col">
                        Período
                        <small>{periodoTexto}</small>
                      </th>
                      <th scope="col">
                        Anterior
                        <small>{anteriorTexto}</small>
                      </th>
                      <th scope="col">Variação</th>
                      <th scope="col">% RL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folha.length ? (
                      folha.map(({ linha, papel, manterComProxima }) => (
                        <tr
                          key={linha.id}
                          className={CLASSE_DO_PAPEL[papel]}
                          data-print-row-keep-with-next={manterComProxima ? "" : undefined}
                        >
                          <td style={{ paddingLeft: recuo(linha.nivel) }}>
                            <span className="dre-rotulo">
                              <span className="dre-codigo">{linha.codigo}</span>
                              <span className="dre-nome">{linha.nome}</span>
                            </span>
                          </td>
                          <td className={cn("dre-valor dre-atual", linha.valor < 0 && "negativo")}>{brl(linha.valor)}</td>
                          <td className="dre-valor dre-apoio">{brl(linha.valorAnterior)}</td>
                          <td className="dre-valor dre-apoio">{variacaoEmTexto(linha)}</td>
                          <td className="dre-valor dre-apoio">{pct(linha.percentualReceitaLiquida)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="dre-vazio">
                          Nenhuma linha ativa no modelo da DRE.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>

                <footer className="dre-notas" data-print-final-block>
                  <p>
                    <strong>Notas.</strong> Valores em reais, apurados pelo regime de competência.{" "}
                    <strong>Anterior:</strong> período imediatamente anterior, com a mesma quantidade de dias.{" "}
                    <strong>Variação:</strong> diferença percentual do período sobre o anterior.{" "}
                    <strong>% RL:</strong> participação sobre a receita líquida. “—” indica que não há base
                    para o cálculo. Modelo: {template.nome}, versão {template.versao}.
                  </p>
                </footer>
              </div>
            </article>
          </div>
        </div>
      </div>
    </main>
  );
}

const DRE_IMPRESSAO_CSS = `
  .dre-impressao{
    --a4w:210mm;
    --a4h:297mm;
    /* Contraste pensado para papel e para quem enxerga pouco: o texto de apoio é
       quase preto, e a hierarquia vem de peso, tamanho e faixas, não de cinza claro. */
    --dre-tinta:#0f172a;
    --dre-apoio:#1e293b;
    --dre-suave:#334155;
    --dre-fio:#cbd5e1;
    --dre-fio-forte:#64748b;
    min-height:100vh;
    padding:16px 12px 32px;
    background:#e2e8f0;
    color:var(--dre-tinta);
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  .dre-barra{
    width:min(210mm, 100%);
    margin:0 auto 12px;
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    justify-content:space-between;
    gap:8px 16px;
  }
  .dre-barra-titulo{ margin:0; font-size:14px; font-weight:700; }
  .dre-barra-apoio{ margin:0; font-size:12px; color:var(--dre-apoio); }

  .dre-rolagem{
    max-width:100%;
    overflow-x:auto;
    overscroll-behavior-x:contain;
    padding-bottom:8px;
  }

  .dre-folha{
    position:relative;
    display:flex;
    flex-direction:column;
    width:var(--a4w);
    height:var(--a4h);
    min-height:var(--a4h);
    overflow:hidden;
    background:#fff;
    box-shadow:0 10px 30px rgba(15,23,42,.14);
  }
  .dre-folha .conteudo{
    display:flex;
    flex:1 1 auto;
    flex-direction:column;
    min-height:0;
    /* O pé fica livre para o rodapé e a numeração que o paginador põe a 6mm da borda. */
    padding:8mm 12mm 12.5mm;
    overflow:hidden;
  }
  /* Nenhum bloco encolhe para caber: o excesso tem de aparecer como transbordo,
     que é o que o ajuste de densidade e o paginador medem. Um bloco que encolhe
     esconde o excesso e corta o próprio conteúdo. */
  .dre-folha .conteudo > *{ flex-shrink:0; }
  /* Rodapé e numeração vêm do paginador, em cinza claro: aqui ganham o mesmo contraste da folha. */
  .dre-folha .print-generated-page-number,
  .dre-folha .print-generated-page-footer{ font-size:9px; color:var(--dre-suave); }

  /* Tamanhos de fonte inteiros de propósito: na exportação para PDF o html-to-image
     arredonda cada tamanho para baixo e tira 0,1px — 9,4px virava 8,9px. */

  .dre-cabecalho{
    display:flex;
    align-items:center;
    gap:3.5mm;
    padding-bottom:2.5mm;
    border-bottom:1.5px solid var(--dre-tinta);
  }
  .dre-logo{
    flex:none;
    display:flex;
    align-items:center;
    justify-content:center;
    width:13mm;
    height:13mm;
  }
  .dre-logo img{ width:100%; height:100%; object-fit:contain; }
  .dre-empresa{ flex:1 1 auto; min-width:0; }
  .dre-empresa-nome{
    margin:0;
    font-size:13px;
    font-weight:800;
    line-height:1.2;
    overflow-wrap:anywhere;
  }
  .dre-empresa-dados{
    margin:.5mm 0 0;
    font-size:8px;
    line-height:1.35;
    color:var(--dre-apoio);
    overflow-wrap:anywhere;
  }
  .dre-emissao{
    flex:none;
    align-self:flex-start;
    margin:0;
    font-size:8px;
    line-height:1.4;
    text-align:right;
    color:var(--dre-suave);
  }
  .dre-emissao strong{
    display:block;
    font-size:9px;
    font-weight:700;
    font-variant-numeric:tabular-nums;
    color:var(--dre-tinta);
  }

  .dre-titulo{ margin:2.5mm 0; text-align:center; }
  .dre-titulo h1{
    margin:0;
    font-size:12px;
    font-weight:800;
    line-height:1.2;
    letter-spacing:.06em;
    text-transform:uppercase;
  }
  .dre-titulo p{ margin:.8mm 0 0; font-size:9px; line-height:1.3; font-variant-numeric:tabular-nums; }
  .dre-titulo .dre-titulo-apoio{ color:var(--dre-suave); }

  /* Sem overflow:hidden: na exportação em imagem, qualquer diferença de medida
     cortava o valor do card pela borda da caixa. */
  .dre-indicadores{
    display:grid;
    grid-template-columns:repeat(4, minmax(0, 1fr));
    margin-bottom:2.5mm;
    border:1px solid var(--dre-fio-forte);
    border-radius:1.5mm;
  }
  .dre-indicador{ min-width:0; padding:1.5mm 2.5mm; border-left:1px solid var(--dre-fio-forte); }
  .dre-indicador:first-child{ border-left:0; }
  .dre-indicador-topo{
    display:flex;
    flex-wrap:wrap;
    align-items:baseline;
    justify-content:space-between;
    column-gap:1.5mm;
    font-size:8px;
    line-height:1.35;
  }
  .dre-indicador-rotulo{
    font-weight:700;
    letter-spacing:.06em;
    text-transform:uppercase;
    white-space:nowrap;
    color:var(--dre-suave);
  }
  .dre-indicador-apoio{
    font-variant-numeric:tabular-nums;
    white-space:nowrap;
    color:var(--dre-suave);
  }
  .dre-indicador-valor{
    margin-top:.5mm;
    font-size:12px;
    font-weight:800;
    line-height:1.3;
    font-variant-numeric:tabular-nums;
    white-space:nowrap;
  }

  /* A densidade só mexe nas linhas da demonstração: é o que cresce com o modelo. */
  .dre-tabela{
    width:100%;
    border-collapse:collapse;
    table-layout:fixed;
    font-size:calc(10px * var(--dre-densidade, 1));
    line-height:1.25;
    font-variant-numeric:tabular-nums;
  }
  .dre-tabela th,
  .dre-tabela td{ padding:calc(.55mm * var(--dre-densidade, 1)) 2mm; }

  .dre-corrido th{ padding:0 0 2mm; font-size:8px; font-weight:500; text-align:left; color:var(--dre-suave); }
  .dre-corrido-conteudo{
    display:flex;
    justify-content:space-between;
    gap:4mm;
    padding-bottom:1.5mm;
    border-bottom:1px solid var(--dre-fio-forte);
  }
  /* Na primeira folha o cabeçalho completo já identifica o documento. */
  [data-print-pagination-source] .dre-corrido,
  [data-print-pagination-generated] > .print-generated-holder:first-child .dre-corrido{ display:none; }

  .dre-colunas th{
    padding-top:1.1mm;
    padding-bottom:1.1mm;
    border-bottom:1.5px solid var(--dre-tinta);
    font-size:8px;
    line-height:1.3;
    font-weight:700;
    letter-spacing:.06em;
    text-align:right;
    text-transform:uppercase;
    vertical-align:bottom;
    color:var(--dre-apoio);
  }
  .dre-colunas th:first-child{ text-align:left; }
  .dre-colunas small{
    display:block;
    margin-top:.3mm;
    font-size:7px;
    font-weight:500;
    letter-spacing:0;
    text-transform:none;
    white-space:nowrap;
    color:var(--dre-suave);
  }

  .dre-tabela tbody tr{ break-inside:avoid; page-break-inside:avoid; }
  .dre-tabela tbody td{ border-bottom:.75px solid var(--dre-fio); vertical-align:middle; }
  .dre-rotulo{ display:flex; align-items:baseline; gap:2mm; min-width:0; }
  .dre-codigo{ flex:none; min-width:6mm; font-size:.9em; color:var(--dre-suave); }
  .dre-nome{ min-width:0; overflow-wrap:anywhere; }
  .dre-valor{ text-align:right; white-space:nowrap; }
  /* O valor do período é o que se lê primeiro. Grupo e resultado mantêm o peso da própria linha. */
  .dre-atual{ font-weight:600; }
  .dre-apoio{ color:var(--dre-apoio); }
  .dre-vazio{ padding:10mm 2mm !important; text-align:center; color:var(--dre-suave); }
  .dre-impressao .negativo{ color:#991b1b; }

  tr.dre-grupo td{
    background:#f1f5f9;
    border-top:1px solid var(--dre-fio-forte);
    border-bottom-color:#94a3b8;
    font-weight:700;
  }
  tr.dre-grupo .dre-nome,
  tr.dre-resultado .dre-nome{ text-transform:uppercase; letter-spacing:.02em; }
  tr.dre-subgrupo td{ font-weight:600; }
  tr.dre-subtotal td{ border-top:1px solid var(--dre-fio-forte); font-weight:700; }
  tr.dre-resultado td{
    background:#e2e8f0;
    border-top:1.5px solid var(--dre-tinta);
    border-bottom:1px solid var(--dre-tinta);
    font-weight:800;
  }
  tr.dre-resultado-final td{
    padding-top:calc(1.1mm * var(--dre-densidade, 1));
    padding-bottom:calc(1.1mm * var(--dre-densidade, 1));
    background:#cbd5e1;
    border-top:3px double var(--dre-tinta);
    border-bottom:3px double var(--dre-tinta);
    font-size:calc(11px * var(--dre-densidade, 1));
  }
  tr.dre-resultado-final .dre-apoio{ color:var(--dre-tinta); }

  .dre-notas{ padding-top:2mm; font-size:8px; line-height:1.4; color:var(--dre-suave); }
  .dre-notas p{ margin:0; }
  .dre-notas strong{ font-weight:700; color:var(--dre-tinta); }

  @page{ size:A4 portrait; margin:0; }

  @media print{
    html, body{ margin:0 !important; padding:0 !important; background:#fff !important; }
    .dre-impressao{ min-height:0 !important; padding:0 !important; background:#fff !important; }
    .dre-barra{ display:none !important; }
    .dre-rolagem{ overflow:visible !important; padding:0 !important; }
    .dre-folha{ box-shadow:none !important; }
    /* Sem isto o navegador descarta as faixas cinza dos grupos e resultados. */
    .dre-folha, .dre-folha *{ -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  }

  @media screen and (max-width:639px){
    .dre-impressao{ padding-inline:8px; }
  }
`;
