// Os modelos com que cada banco nasce, um por módulo. A migration
// 20261014150000_documento_modelo.sql semeia exatamente estes textos (o teste
// `padrao.test.ts` confronta as duas cópias), e a tela usa daqui o
// "Restaurar texto padrão".

import type { ModuloDocumento } from "./tipos";

export type DocumentoPadrao = {
  codigo: string;
  modulo: ModuloDocumento;
  nome: string;
  html: string;
};

const ESTILO = `<style>
  @page { size: A4; margin: 16mm 15mm; }
  @media screen { body { padding: 16mm 15mm; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; color: #0f172a; background: #fff; }
  .cabecalho { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 10px; margin-bottom: 18px; border-bottom: 2px solid #0f172a; }
  .empresa { text-align: right; font-size: 11px; color: #334155; }
  .empresa strong { display: block; font-size: 14px; color: #0f172a; }
  h1 { margin: 0; font-size: 16px; text-align: center; text-transform: uppercase; letter-spacing: .04em; }
  .subtitulo { margin: 2px 0 18px; text-align: center; color: #475569; }
  h2 { margin: 16px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
  p { margin: 0 0 8px; text-align: justify; }
  ul { margin: 0 0 8px; padding-left: 18px; }
  .quadro { padding: 8px 10px; margin-bottom: 8px; border: 1px solid #cbd5e1; border-radius: 6px; }
  .totais { width: 260px; margin: 8px 0 0 auto; border-collapse: collapse; }
  .totais td { padding: 2px 0; }
  .totais td:last-child { text-align: right; }
  .totais tr:last-child td { padding-top: 4px; font-weight: bold; border-top: 1px solid #0f172a; }
  .local-data { margin-top: 28px; text-align: right; }
  .assinaturas { display: flex; gap: 40px; margin-top: 48px; }
  .assinatura { flex: 1; padding-top: 6px; text-align: center; font-size: 11px; border-top: 1px solid #0f172a; }
  .rodape { margin-top: 28px; font-size: 10px; color: #64748b; text-align: center; }
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; }
</style>`;

const CABECALHO = `<header class="cabecalho">
  <div>{{empresa.logo}}</div>
  <div class="empresa">
    <strong>{{empresa.nome}}</strong>
    CNPJ {{empresa.cnpj}}<br />
    {{empresa.endereco}}<br />
    {{empresa.telefone}}
  </div>
</header>`;

const RODAPE = `<p class="rodape">Documento emitido em {{documento.hora_emissao}} por {{documento.emitido_por}}.</p>`;

function pagina(titulo: string, corpo: string) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${titulo}</title>
${ESTILO}
</head>
<body>
${CABECALHO}
${corpo}
${RODAPE}
</body>
</html>
`;
}

const CONTRATO_VENDA = pagina(
  "Contrato de compra e venda",
  `<h1>Contrato de compra e venda</h1>
<p class="subtitulo">Venda nº {{venda.numero}} · {{venda.data}}</p>

<h2>1. Das partes</h2>
<div class="quadro">
  <p><strong>VENDEDORA:</strong> {{empresa.razao_social}}, inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.endereco}}.</p>
  <p><strong>COMPRADOR(A):</strong> {{cliente.nome}}, {{cliente.tipo_pessoa}}, CPF/CNPJ {{cliente.documento}}, residente ou sediado(a) em {{cliente.endereco_completo}}, telefone {{cliente.telefone}}, e-mail {{cliente.email}}.</p>
</div>

<h2>2. Do objeto</h2>
<p>Pelo presente instrumento, a VENDEDORA vende ao(à) COMPRADOR(A), que adquire, os produtos relacionados abaixo, novos e em perfeito estado, nas quantidades e valores indicados:</p>
{{venda.itens_tabela}}

<h2>3. Do preço e da forma de pagamento</h2>
<table class="totais">
  <tr><td>Subtotal</td><td>{{venda.subtotal}}</td></tr>
  <tr><td>Descontos</td><td>{{venda.desconto}}</td></tr>
  <tr><td>Frete</td><td>{{venda.frete}}</td></tr>
  <tr><td>Acréscimo financeiro</td><td>{{venda.acrescimo}}</td></tr>
  <tr><td>Total</td><td>{{venda.total}}</td></tr>
</table>
<p>O preço total ajustado é de <strong>{{venda.total}}</strong> ({{venda.total_extenso}}), pago da seguinte forma:</p>
{{venda.pagamentos}}
<p>O atraso no pagamento de qualquer parcela sujeita o(a) COMPRADOR(A) à multa de 2% (dois por cento) sobre o valor devido, acrescido de juros de mora de 1% (um por cento) ao mês, calculados dia a dia.</p>

<h2>4. Da entrega</h2>
<p><strong>Forma de entrega:</strong> {{entrega.metodo}} {{entrega.endereco}}</p>
<p>No ato do recebimento, o(a) COMPRADOR(A) confere a quantidade e o estado dos produtos, e a assinatura deste contrato vale como declaração de recebimento conforme.</p>

<h2>5. Da garantia</h2>
<p>Os produtos contam com a garantia legal prevista no Código de Defesa do Consumidor (Lei nº 8.078/1990), além da garantia contratual indicada a seguir: {{venda.garantia}}. A garantia não cobre danos causados por mau uso, instalação inadequada, acidentes ou desgaste natural.</p>

<h2>6. Das disposições gerais</h2>
<p>{{venda.observacoes}}</p>
<p>As partes elegem o foro da comarca da sede da VENDEDORA para dirimir quaisquer dúvidas oriundas deste contrato, ressalvado ao(à) COMPRADOR(A) consumidor(a) o foro do seu domicílio. E, por estarem de acordo, assinam o presente em duas vias de igual teor.</p>

<p class="local-data">{{documento.data_emissao_extenso}}</p>

<div class="assinaturas">
  <div class="assinatura">{{empresa.razao_social}}<br />VENDEDORA</div>
  <div class="assinatura">{{cliente.nome}}<br />COMPRADOR(A)</div>
</div>`,
);

const RECIBO_OS = pagina(
  "Recibo de serviço prestado",
  `<h1>Recibo de serviço prestado</h1>
<p class="subtitulo">Ordem de serviço nº {{os.numero}}</p>

<div class="quadro">
  <p>Recebemos de <strong>{{cliente.nome}}</strong>, CPF/CNPJ {{cliente.documento}}, a importância de <strong>{{os.total}}</strong> ({{os.total_extenso}}), referente às peças e aos serviços executados na ordem de serviço nº {{os.numero}}, conforme descrito abaixo.</p>
  <p><strong>{{os.alvo}}:</strong> {{os.alvo_descricao}}</p>
  <p><strong>Entrada:</strong> {{os.data_entrada}} · <strong>Conclusão:</strong> {{os.data_conclusao}}</p>
</div>

<h2>Peças</h2>
{{os.pecas_tabela}}

<h2>Serviços</h2>
{{os.servicos_tabela}}

<table class="totais">
  <tr><td>Peças</td><td>{{os.total_pecas}}</td></tr>
  <tr><td>Serviços</td><td>{{os.total_servicos}}</td></tr>
  <tr><td>Desconto</td><td>{{os.desconto}}</td></tr>
  <tr><td>Frete</td><td>{{os.frete}}</td></tr>
  <tr><td>Total</td><td>{{os.total}}</td></tr>
</table>

<h2>Pagamento</h2>
{{os.pagamentos}}

<h2>Garantia</h2>
<p>{{os.garantia}}</p>
<p>A garantia cobre as peças fornecidas e a mão de obra dos serviços listados neste recibo, e não se estende a danos causados por mau uso, acidentes ou intervenção de terceiros.</p>

<p>Para clareza, firmamos o presente recibo, dando plena e geral quitação do valor acima.</p>

<p class="local-data">{{documento.data_emissao_extenso}}</p>

<div class="assinaturas">
  <div class="assinatura">{{empresa.nome}}<br />CNPJ {{empresa.cnpj}}</div>
  <div class="assinatura">{{cliente.nome}}<br />Recebi o serviço em perfeitas condições</div>
</div>`,
);

const CONTRATO_ALUGUEL = pagina(
  "Contrato de locação",
  `<h1>Contrato de locação de bens móveis</h1>
<p class="subtitulo">Aluguel nº {{aluguel.numero}}</p>

<h2>1. Das partes</h2>
<div class="quadro">
  <p><strong>LOCADORA:</strong> {{empresa.razao_social}}, inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.endereco}}.</p>
  <p><strong>LOCATÁRIO(A):</strong> {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}, endereço {{cliente.endereco_completo}}, telefone {{cliente.telefone}}.</p>
</div>

<h2>2. Do objeto</h2>
<p>A LOCADORA cede ao(à) LOCATÁRIO(A), em locação, os bens relacionados abaixo, que este(a) declara receber em perfeito estado de conservação e funcionamento:</p>
{{aluguel.itens_tabela}}

<h2>3. Do prazo</h2>
<p>A locação tem início em <strong>{{aluguel.data_inicio}}</strong> e data limite para devolução em <strong>{{aluguel.data_limite}}</strong> ({{aluguel.duracao}}). A permanência com os bens após a data limite, sem acordo com a LOCADORA, sujeita o(a) LOCATÁRIO(A) à cobrança proporcional dos dias excedentes.</p>

<h2>4. Do valor</h2>
<p>Pela locação, o(a) LOCATÁRIO(A) pagará à LOCADORA o valor de <strong>{{aluguel.valor_total}}</strong> ({{aluguel.valor_total_extenso}}).</p>

<h2>5. Das obrigações do(a) locatário(a)</h2>
<ul>
  <li>Usar os bens apenas para o fim a que se destinam, com cuidado e conforme as orientações recebidas;</li>
  <li>Não emprestar, sublocar ou ceder os bens a terceiros sem autorização por escrito da LOCADORA;</li>
  <li>Responder pelos danos, perdas, furto ou roubo dos bens enquanto estiverem em sua posse, ressarcindo o valor de reparo ou de reposição;</li>
  <li>Devolver os bens na data limite, limpos e no mesmo estado em que os recebeu, ressalvado o desgaste natural do uso.</li>
</ul>

<h2>6. Da devolução</h2>
<p>Na devolução, os bens serão conferidos pela LOCADORA. Qualquer avaria constatada será informada ao(à) LOCATÁRIO(A) e cobrada conforme a cláusula 5.</p>

<h2>7. Observações</h2>
{{aluguel.observacao}}

<p>As partes elegem o foro da comarca da sede da LOCADORA para dirimir quaisquer dúvidas oriundas deste contrato. E, por estarem de acordo, assinam o presente em duas vias de igual teor.</p>

<p class="local-data">{{documento.data_emissao_extenso}}</p>

<div class="assinaturas">
  <div class="assinatura">{{empresa.razao_social}}<br />LOCADORA</div>
  <div class="assinatura">{{cliente.nome}}<br />LOCATÁRIO(A)</div>
</div>`,
);

export const DOCUMENTOS_PADRAO: readonly DocumentoPadrao[] = [
  { codigo: "venda_contrato", modulo: "venda", nome: "Contrato de compra e venda", html: CONTRATO_VENDA },
  { codigo: "os_recibo", modulo: "os", nome: "Recibo de serviço prestado", html: RECIBO_OS },
  { codigo: "aluguel_contrato", modulo: "aluguel", nome: "Contrato de locação", html: CONTRATO_ALUGUEL },
];

export function documentoPadrao(codigo: string | null | undefined) {
  return DOCUMENTOS_PADRAO.find((d) => d.codigo === codigo) ?? null;
}

/** Ponto de partida de um documento novo: o mesmo cabeçalho e rodapé dos padrões. */
export const MODELO_EM_BRANCO = pagina(
  "Novo documento",
  `<h1>Novo documento</h1>\n<p>Escreva aqui o texto do documento e use as variáveis ao lado.</p>`,
);
