# Plano de execução — SPED Fiscal (EFD ICMS/IPI)

## Projeto

- Tipo: WEB full-stack (Next.js App Router + Supabase + Vercel Functions).
- Competência piloto: agosto de 2026.
- Leiaute inicial: EFD ICMS/IPI 020.
- Entrega desta implementação: migrations versionadas, domínio, serviços, APIs, UI e testes. Não inclui aplicar migrations no ambiente remoto, transmitir a EFD, fazer commit ou deploy.

## Marcos

1. Corrigir a compatibilidade fiscal com CNPJ alfanumérico, preservando os CNPJs numéricos atuais.
2. Modelar data fiscal civil, offset original e timezone IANA por estabelecimento.
3. Criar as estruturas aditivas de configuração, competência, versão, snapshots, apuração, diagnósticos, arquivos, 1601 e inventário.
4. Implementar o motor determinístico do leiaute 020, incluindo os registros dos blocos 0, C, E, H, 1 e 9 previstos no plano aprovado.
5. Implementar gates de Perfil EFD, Bloco K, 1400 e C176/C179; nenhum gate pendente pode permitir fechamento.
6. Implementar importações, validação, fechamento/reabertura imutável, geração e download privado.
7. Entregar a área `/fiscal/sped`, permissões separadas e rastreabilidade de fontes.
8. Executar testes unitários, integração estática, typecheck e regressão fiscal/NF-e.

## Fronteiras e segurança

- XML autorizado/evento SEFAZ é a fonte histórica de documento e tributos.
- Cadastro atual nunca reescreve o histórico fiscal.
- Entradas exigem `data_entrada_fiscal` confirmada.
- Tabelas SPED usam RLS e não concedem acesso direto a `anon`/`authenticated`; APIs autenticadas usam o cliente administrativo no servidor.
- Versões fechadas, snapshots e artefatos são imutáveis.
- CNPJ é texto canônico de 14 posições; nunca é normalizado com `\D`.
- Datas civis do XML são preservadas sem conversão cega de timezone.

## Critérios de conclusão técnica

- Migrations consistentes e não aplicadas remotamente.
- Testes com `00000000E08G12` e CNPJ numérico.
- Geração determinística com contadores e Bloco 9 coerentes.
- Fechamento bloqueado por erros, datas não confirmadas e gates pendentes.
- Reabertura cria nova versão sem mutar a anterior.
- Suítes existentes continuam passando.

## Bloqueios externos do piloto

- Confirmações do contador: perfil da IE, Bloco K, C176/C179, 1400, IPI, EFD-Contribuições e ajustes.
- EFD oficial de julho de 2026.
- Revisão das datas fiscais de entrada.
- Arquivo mensal do 1601 e dados das instituições.
- PVA vigente e aprovação contábil do TXT final.
