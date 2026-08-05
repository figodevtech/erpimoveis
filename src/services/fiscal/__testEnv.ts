// Credenciais falsas para os testes de serviço.
//
// `nfeAvulsaService` importa `supabaseAdmin`, que aborta na carga quando as
// variáveis de ambiente faltam. Os testes só exercitam funções puras de
// validação — nenhuma chamada sai daqui —, então basta o cliente conseguir ser
// construído. Importe este módulo ANTES do serviço para a ordem de avaliação
// garantir o env preenchido.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste-sem-acesso";

export {};
