# Runtime do middleware — 27/10/2026

O middleware agora declara runtime: "nodejs" em src/middleware.ts. Next.js 15.5 estabilizou essa opcao: https://nextjs.org/blog/next-15-5 e https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware.

Motivo: jose 6.2.13, carregado pelo Auth.js, inclui suporte a JWE comprimido via CompressionStream/DecompressionStream. O build Edge avisava que essas APIs nao estavam disponiveis. O JWT emitido pelo Auth.js atual nao usa zip, mas a dependencia integra essas funcoes ao bundle. Usar Node.js alinha o runtime com a biblioteca instalada, sem suprimir avisos ou regredir dependencias.

Preservados o matcher, o wrapper Auth.js e as verificacoes existentes de usuario ativo, sessao, permissoes, acesso da plataforma e rotas publicas. A configuracao enxuta continua em src/lib/auth-edge.ts por compatibilidade de imports; o nome do arquivo nao determina o runtime.

## Validacao

- Build final: status 0, 222 paginas, Compiled successfully; sem avisos CompressionStream/DecompressionStream/Edge.
- functions-config-manifest.json gerado confirma functions['/_middleware'].runtime = 'nodejs'; middleware.js e trace NFT gerados.
- 2.832 testes de negocio passaram; zero falhas.
- TypeScript de src/tipos de rota e ESLint dos arquivos alterados passaram.
- perf:smoke:auth no build local: anonimo bloqueado, sessao salva reconhecida, cookie adulterado recusado e logout bloqueando novamente a API. O cookie adulterado foi criado apenas em contexto descartavel; nenhum token foi registrado no log.
- Seis suites de perf:smoke:integrated passaram: consultas, filtros e abertura/cancelamento de formularios, sem gravacao de negocio. A confirmacao de OS usa status simulado somente na interface, como documentado nos testes existentes.

## Limites e operacao

Trocar Edge por Node.js altera o ambiente e pode alterar inicializacao, localizacao e latencia em hospedagem. Essa rodada valida next start local; nao mede latencia nem configura regioes do ambiente de producao. A hospedagem precisa suportar middleware Node.js do Next 15.5. Nenhum deploy foi feito.

Para aplicar localmente, reiniciar npm run dev ou gerar novo npm run build e reiniciar npm start. As mensagens de checagens de tipos/lint separadas e avisos independentes de snapshot de cache webpack nao sao tratados por essa mudanca.

Logs middleware-node-* em artifacts/performance/upgrade/. Servidor de teste encerrado; public/sw.js e next-env.d.ts restaurados dos snapshots do inicio desta rodada. Sem migracao de banco, alteracao de senha ou gravacao de negocio.
