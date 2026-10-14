BEGIN;

-- Documentos dinâmicos.
--
-- O PROBLEMA
-- As impressões do sistema são fixas (OS, orçamento, etiqueta). Contrato de
-- venda, recibo, contrato de locação — cada oficina tem a sua redação, e não
-- havia onde escrevê-la.
--
-- A REGRA
-- 1) Cada linha é um modelo em HTML, de um módulo só (venda, os, aluguel). O
--    módulo define as variáveis disponíveis (src/lib/documentos/catalogo.ts);
--    a emissão troca `{{cliente.nome}}` pelo dado do registro, já escapado.
-- 2) O dropdown de emissão de cada módulo lista os modelos ativos, por
--    `ordem` e depois `nome`. Nome repetido dentro do módulo é recusado.
-- 3) Exclusão é lógica (`is_deleted`). Os três modelos de fábrica levam
--    `codigo_padrao`: é por ele que a tela restaura o texto original, e é ele
--    que impede o seed de ressuscitar um padrão que a oficina excluiu.
-- 4) O seed é cópia de src/lib/documentos/padrao.ts; `padrao.test.ts`
--    confronta as duas. Banco que nasce de dump só de estrutura recebe os
--    padrões por `npm run db:carregar:catalogos`.
--
-- ORDEM DO DEPLOY
-- Esta migration antes do código. O código antigo não lê a tabela.

CREATE TABLE IF NOT EXISTS public.documento_modelo (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo_padrao text,
  modulo        text NOT NULL,
  nome          text NOT NULL,
  html          text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  ordem         integer NOT NULL DEFAULT 0,
  is_deleted    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES public.usuario(id),
  updated_by    uuid REFERENCES public.usuario(id),
  CONSTRAINT documento_modelo_modulo_check CHECK (modulo IN ('venda', 'os', 'aluguel')),
  CONSTRAINT documento_modelo_nome_check CHECK (btrim(nome) <> '' AND char_length(nome) <= 120),
  CONSTRAINT documento_modelo_html_check CHECK (btrim(html) <> '' AND char_length(html) <= 200000),
  CONSTRAINT documento_modelo_ordem_check CHECK (ordem >= 0),
  CONSTRAINT documento_modelo_codigo_padrao_key UNIQUE (codigo_padrao)
);

COMMENT ON TABLE public.documento_modelo IS
  'Modelos HTML de documentos emitidos a partir de venda, OS ou aluguel, com variáveis do registro.';
COMMENT ON COLUMN public.documento_modelo.modulo IS
  'Onde o documento aparece para emissão: venda, os ou aluguel.';
COMMENT ON COLUMN public.documento_modelo.codigo_padrao IS
  'Preenchido só nos modelos de fábrica; permite restaurar o texto original.';

CREATE UNIQUE INDEX IF NOT EXISTS documento_modelo_nome_modulo_uidx
  ON public.documento_modelo (modulo, lower(btrim(nome)))
  WHERE NOT is_deleted;

CREATE INDEX IF NOT EXISTS documento_modelo_emissao_idx
  ON public.documento_modelo (modulo, ordem, nome)
  WHERE ativo AND NOT is_deleted;

CREATE OR REPLACE FUNCTION public.set_documento_modelo_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_documento_modelo_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_documento_modelo_updated_at ON public.documento_modelo;
CREATE TRIGGER trg_documento_modelo_updated_at
BEFORE UPDATE ON public.documento_modelo
FOR EACH ROW EXECUTE FUNCTION public.set_documento_modelo_updated_at();

-- As rotas usam o service_role; nada para anon/authenticated.
ALTER TABLE public.documento_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documento_modelo NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.documento_modelo FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documento_modelo TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Os três modelos de fábrica, um por módulo. Padrão excluído continua na
-- tabela (exclusão lógica), então o ON CONFLICT não o traz de volta.
INSERT INTO public.documento_modelo (codigo_padrao, modulo, nome, ordem, html)
VALUES
  ('venda_contrato', 'venda', 'Contrato de compra e venda', 0, $doc$<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Contrato de compra e venda</title>
<style>
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
</style>
</head>
<body>
<header class="cabecalho">
  <div>{{empresa.logo}}</div>
  <div class="empresa">
    <strong>{{empresa.nome}}</strong>
    CNPJ {{empresa.cnpj}}<br />
    {{empresa.endereco}}<br />
    {{empresa.telefone}}
  </div>
</header>
<h1>Contrato de compra e venda</h1>
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
</div>
<p class="rodape">Documento emitido em {{documento.hora_emissao}} por {{documento.emitido_por}}.</p>
</body>
</html>
$doc$),
  ('os_recibo', 'os', 'Recibo de serviço prestado', 1, $doc$<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Recibo de serviço prestado</title>
<style>
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
</style>
</head>
<body>
<header class="cabecalho">
  <div>{{empresa.logo}}</div>
  <div class="empresa">
    <strong>{{empresa.nome}}</strong>
    CNPJ {{empresa.cnpj}}<br />
    {{empresa.endereco}}<br />
    {{empresa.telefone}}
  </div>
</header>
<h1>Recibo de serviço prestado</h1>
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
</div>
<p class="rodape">Documento emitido em {{documento.hora_emissao}} por {{documento.emitido_por}}.</p>
</body>
</html>
$doc$),
  ('aluguel_contrato', 'aluguel', 'Contrato de locação', 2, $doc$<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Contrato de locação</title>
<style>
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
</style>
</head>
<body>
<header class="cabecalho">
  <div>{{empresa.logo}}</div>
  <div class="empresa">
    <strong>{{empresa.nome}}</strong>
    CNPJ {{empresa.cnpj}}<br />
    {{empresa.endereco}}<br />
    {{empresa.telefone}}
  </div>
</header>
<h1>Contrato de locação de bens móveis</h1>
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
</div>
<p class="rodape">Documento emitido em {{documento.hora_emissao}} por {{documento.emitido_por}}.</p>
</body>
</html>
$doc$)
ON CONFLICT (codigo_padrao) DO NOTHING;

-- Auditoria: corpo vivo de auditoria_modulo_tabela com `documento` em
-- configurações.
CREATE OR REPLACE FUNCTION public.auditoria_modulo_tabela(nome_tabela text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when nome_tabela ~* '^(mercadolivre|marketplace)' then 'marketplace'
    when nome_tabela ~* '^desmanche' then 'desmanche'
    when nome_tabela ~* '^(agendamento)' then 'agendamentos'
    when nome_tabela ~* '^aluguel' then 'alugueis'
    when nome_tabela ~* '^(ordemservico|os|checklist|imagemvistoria)' then 'ordens'
    when nome_tabela ~* '^(venda|categoria_venda)' then 'vendas'
    when nome_tabela ~* '^(produto|fornecedor|peca|unidademedida|produtogrupo)' then 'estoque'
    when nome_tabela ~* '^(pagamento|transacao|bancoconta|categoriatransacao)' then 'financeiro'
    when nome_tabela ~* '^(nfe|nfse|notafiscal|fiscal)' then 'fiscal'
    when nome_tabela ~* '^(veiculo|transferencias_veiculos|cores_veiculos)' then 'veiculos'
    when nome_tabela ~* '^cliente' then 'clientes'
    when nome_tabela ~* '^(usuario|perfil|permissao|perfilpermissao|setor)' then 'usuarios'
    when nome_tabela ~* '^(config|empresa|categoriaservico|tiposervico|servico|documento_modelo)' then 'configuracoes'
    else 'outros'
  end;
$function$;

DO $auditoria$
BEGIN
  IF to_regprocedure('public.habilitar_auditoria_tabela(regclass)') IS NOT NULL THEN
    PERFORM public.habilitar_auditoria_tabela('public.documento_modelo'::regclass);
  END IF;
END;
$auditoria$;

COMMIT;
