-- Sustenta a apuração mensal de despesas por beneficiário sem varrer todo o
-- livro de eventos. O recorte por OS acompanha a fila financeira desta tela.
CREATE INDEX IF NOT EXISTS idx_eventos_financeiros_usuario_data
  ON public.eventos_financeiros (usuarioid, data_evento DESC, id DESC)
  WHERE usuarioid IS NOT NULL
    AND ordemservicoid IS NOT NULL;
