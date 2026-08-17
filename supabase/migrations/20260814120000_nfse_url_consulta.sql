ALTER TABLE public.nfse
  ADD COLUMN IF NOT EXISTS url_consulta text;

COMMENT ON COLUMN public.nfse.url_consulta IS
  'URL do espelho HTML/portal da NFS-e; o PDF permanece exclusivamente em url_pdf.';
