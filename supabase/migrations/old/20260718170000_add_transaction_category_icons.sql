ALTER TABLE public.categoriatransacao
  ADD COLUMN IF NOT EXISTS icone text NOT NULL DEFAULT 'other';

UPDATE public.categoriatransacao
SET icone = CASE nome
  WHEN 'ALUGUEL' THEN 'warehouse'
  WHEN 'COMISSÃO' THEN 'commission'
  WHEN 'EQUIPAMENTO' THEN 'equipment'
  WHEN 'FERRAMENTA' THEN 'wrench'
  WHEN 'IMPOSTO' THEN 'landmark'
  WHEN 'TAXA' THEN 'landmark'
  WHEN 'PEÇA' THEN 'part'
  WHEN 'PRODUTO' THEN 'purchase'
  WHEN 'SALÁRIO' THEN 'salary'
  WHEN 'REMUNERAÇÃO' THEN 'salary'
  WHEN 'SERVIÇO' THEN 'handshake'
  WHEN 'TRANSFERÊNCIA' THEN 'banknote'
  WHEN 'TRANSPORTE' THEN 'truck'
  WHEN 'LOGÍSTICA' THEN 'truck'
  WHEN 'UTILIDADE' THEN 'utility'
  ELSE 'other'
END;

ALTER TABLE public.categoriatransacao
  DROP CONSTRAINT IF EXISTS categoriatransacao_icone_check;

ALTER TABLE public.categoriatransacao
  ADD CONSTRAINT categoriatransacao_icone_check CHECK (icone IN (
    'activity', 'alarm', 'ambulance', 'apple', 'armchair', 'badge-dollar',
    'bike', 'book', 'box', 'bus-front', 'calculator', 'calendar', 'camera',
    'chart-column', 'chart-line', 'check', 'chef', 'church', 'parking',
    'construction', 'container', 'cooking', 'cross', 'crown', 'dog',
    'droplets', 'dumbbell', 'factory', 'file', 'fire-extinguisher', 'flower',
    'gamepad', 'gauge', 'graduation', 'hammer', 'hard-hat', 'headphones',
    'hotel', 'key', 'laptop', 'leaf', 'mail', 'location', 'medal', 'megaphone',
    'monitor', 'music', 'paintbrush', 'paw', 'phone', 'piggy-bank', 'plane',
    'printer', 'rocket', 'route', 'school', 'scissors', 'shield',
    'shopping-bag', 'siren', 'stethoscope', 'tag', 'ticket', 'train', 'trash',
    'trending', 'trophy', 'umbrella', 'wallet',
    'banknote', 'briefcase', 'building', 'bus', 'car', 'circle-dollar-sign',
    'other', 'clipboard', 'coffee', 'coins', 'credit-card', 'fuel', 'gift',
    'salary', 'handshake', 'health', 'house', 'commission', 'landmark',
    'utility', 'package', 'equipment', 'receipt', 'purchase', 'smartphone',
    'part', 'store', 'truck', 'users', 'warehouse', 'wrench'
  ));

ALTER TABLE public.transacao
  ADD COLUMN IF NOT EXISTS categoria_id integer;

UPDATE public.transacao AS transacao
SET categoria_id = categoria.id
FROM public.categoriatransacao AS categoria
WHERE upper(btrim(transacao.categoria)) = upper(btrim(categoria.nome))
  AND transacao.categoria_id IS NULL;

ALTER TABLE public.transacao
  DROP CONSTRAINT IF EXISTS transacao_categoria_id_fkey;

ALTER TABLE public.transacao
  ADD CONSTRAINT transacao_categoria_id_fkey
  FOREIGN KEY (categoria_id) REFERENCES public.categoriatransacao(id)
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transacao_categoria_id
  ON public.transacao(categoria_id);

CREATE OR REPLACE FUNCTION public.sincronizar_categoria_transacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.categoria_id IS NOT NULL THEN
    SELECT nome INTO NEW.categoria
    FROM public.categoriatransacao
    WHERE id = NEW.categoria_id;
  ELSIF nullif(btrim(NEW.categoria), '') IS NOT NULL THEN
    SELECT id INTO NEW.categoria_id
    FROM public.categoriatransacao
    WHERE upper(btrim(nome)) = upper(btrim(NEW.categoria))
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sincronizar_categoria_transacao ON public.transacao;
CREATE TRIGGER trg_sincronizar_categoria_transacao
BEFORE INSERT OR UPDATE OF categoria, categoria_id ON public.transacao
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_categoria_transacao();

CREATE OR REPLACE FUNCTION public.propagar_nome_categoria_transacao()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.nome IS DISTINCT FROM OLD.nome THEN
    UPDATE public.transacao
    SET categoria = NEW.nome
    WHERE categoria_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagar_nome_categoria_transacao ON public.categoriatransacao;
CREATE TRIGGER trg_propagar_nome_categoria_transacao
AFTER UPDATE OF nome ON public.categoriatransacao
FOR EACH ROW EXECUTE FUNCTION public.propagar_nome_categoria_transacao();
