// Credenciais falsas para os testes de serviço.
//
// `nfeAvulsaService` importa `supabaseAdmin`, que aborta na carga quando as
// variáveis de ambiente faltam. Os testes só exercitam funções puras de
// validação — nenhuma chamada sai daqui —, então basta o cliente conseguir ser
// construído. Importe este módulo ANTES do serviço para a ordem de avaliação
// garantir o env preenchido.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "chave-de-teste-sem-acesso";

// O build da Vercel roda os testes com o env do projeto, onde o token da Focus
// existe e passa na frente do token da empresa (`configurarAmbiente`). Local,
// o runner não lê o .env e o teste passa; lá, a asserção pega o token real.
// Os testes descrevem o token pelo banco falso, então o env não pode vazar.
delete process.env.FOCUS_NFE_API_TOKEN;
delete process.env.FOCUS_NFE_API_TOKEN_HOMOLOGACAO;
delete process.env.FOCUS_NFE_API_URL;

// `server-only` só existe dentro do bundler do Next: fora dele o pacote nem é
// resolvido. Os serviços que o importam (nfeConfigService) rodam aqui como
// código de servidor mesmo, então basta o import não quebrar.
import Module from "node:module";

type ResolverDeModulos = { _resolveFilename: (request: string, ...resto: unknown[]) => string };
const modulo = Module as unknown as ResolverDeModulos;
const resolverOriginal = modulo._resolveFilename;
modulo._resolveFilename = function (request: string, ...resto: unknown[]) {
  // Este próprio arquivo: já está no cache, carregá-lo de novo não faz nada.
  if (request === "server-only") return __filename;
  return resolverOriginal.call(this, request, ...resto);
};

export {};
