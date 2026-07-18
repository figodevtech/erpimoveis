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
