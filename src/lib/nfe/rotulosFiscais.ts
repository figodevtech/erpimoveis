// Rótulos legíveis dos códigos fiscais, para quem preenche não precisar
// decorar tabela.
//
// Ficam aqui, e não na tela, porque duas telas usam os mesmos códigos: o editor
// fiscal do item na emissão e o cadastro do padrão em Configurações. Rótulo
// divergente entre as duas seria bug de interpretação, não de layout.

export const ORIGENS_MERCADORIA = [
  ['0', 'Nacional'],
  ['1', 'Estrangeira — importação direta'],
  ['2', 'Estrangeira — mercado interno'],
  ['3', 'Nacional, conteúdo importado superior a 40%'],
  ['4', 'Nacional, processo produtivo básico'],
  ['5', 'Nacional, conteúdo importado até 40%'],
  ['6', 'Estrangeira sem similar nacional'],
  ['7', 'Estrangeira sem similar — mercado interno'],
  ['8', 'Nacional, conteúdo importado superior a 70%'],
] as const;

export const CSOSN_DESCRICOES: Record<string, string> = {
  '101': 'Tributada pelo Simples com permissão de crédito',
  '102': 'Tributada pelo Simples sem permissão de crédito',
  '103': 'Isenção por faixa de receita',
  '201': 'Tributada com crédito e ICMS-ST',
  '202': 'Tributada sem crédito e com ICMS-ST',
  '203': 'Isenção por faixa de receita e ICMS-ST',
  '300': 'Imune',
  '400': 'Não tributada',
  '500': 'ICMS-ST cobrado anteriormente',
  '900': 'Outros',
};

export const CST_ICMS_DESCRICOES: Record<string, string> = {
  '00': 'Tributada integralmente',
  '10': 'Tributada com ICMS-ST',
  '20': 'Redução de base de cálculo',
  '30': 'Isenta/não tributada com ICMS-ST',
  '40': 'Isenta',
  '41': 'Não tributada',
  '50': 'Suspensão',
  '51': 'Diferimento',
  '60': 'ICMS-ST cobrado anteriormente',
  '70': 'Redução de base com ICMS-ST',
  '90': 'Outras',
};
