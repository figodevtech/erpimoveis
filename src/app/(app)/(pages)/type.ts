export interface Config {
    id: number;
    aviso_pagamento: boolean;
    checklist_obrigatorio: boolean;
    alerta_estoque_pdv: boolean;
    habilitar_emissao_nfe: boolean;
    emissao_nf_no_modulo_ordens: boolean;
    emissao_nf_no_modulo_vendas: boolean;
    emissao_nf_ordens_nao_pagas: boolean;
    emissao_nf_vendas_nao_pagas: boolean;
    habilitar_drawers: boolean;
    agendamento_intervalo_minutos: number;
    agendamento_hora_inicio: string;
    agendamento_hora_fim: string;
    agendamento_dias_trabalho: number[];
    impressao_cor_primaria: string;
    impressao_cor_secundaria: string;
    modo_baixa_estoque_os: "ORCAMENTO" | "EXECUCAO";
    produto_preco_medio_compra_obrigatorio: boolean;
    habilitar_edicao_transacoes: boolean;
    permitir_produto_avulso_os: boolean;
    created_at: string;
}
