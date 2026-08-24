-- O icone de transferencia que faltava na lista.
--
-- `categoriatransacao_icone_check` e uma lista fechada, espelho do seletor de
-- icones da tela: so entra o que o front sabe desenhar. Quem escreveu a
-- transferencia entre contas pediu 'arrow-left-right', que e o desenho certo
-- para a operacao — duas setas em sentidos opostos — e que nao estava nem na
-- constraint nem no mapa do front.
--
-- O resultado foi um deploy que passou na Demonstracao e quebrou na Demir. Nao
-- foi divergencia de schema: a Demonstracao ja tinha uma categoria chamada
-- TRANSFERENCIA (a propria baseline cria uma), entao a migration caiu no ramo
-- que so faz UPDATE e nunca tocou no icone. Onde a categoria nao existia, o
-- INSERT rodou e bateu na constraint.
--
-- Esta migration roda depois da 20260824120000 de proposito: a lista tem que
-- aceitar o valor antes de alguem grava-lo. O DROP/ADD e idempotente e reescreve
-- a lista inteira, entao os quatro bancos terminam com a mesma definicao,
-- inclusive o que ja tinha aplicado a anterior.
BEGIN;

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
    'part', 'store', 'truck', 'users', 'warehouse', 'wrench',
    -- Novo: duas setas em sentidos opostos, para transferencia entre contas.
    'arrow-left-right'
  ));

-- So a categoria de sistema. Uma categoria de transferencia criada a mao pelo
-- usuario, com icone escolhido por ele, nao e reescrita: `codigo_sistema` e o
-- que marca a linha como do proprio ERP.
UPDATE public.categoriatransacao
   SET icone = 'arrow-left-right',
       updatedat = now()
 WHERE codigo_sistema = 'TRANSFERENCIA'
   AND icone IS DISTINCT FROM 'arrow-left-right';

COMMIT;
