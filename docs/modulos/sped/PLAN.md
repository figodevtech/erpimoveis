# Plano de execução — SPED Fiscal (EFD ICMS/IPI)

## Projeto

- Tipo: WEB full-stack (Next.js App Router + Supabase + Vercel Functions).
- Competência piloto: agosto de 2026.
- Leiaute inicial: EFD ICMS/IPI 020.
- Entrega desta implementação: migrations versionadas, domínio, serviços, APIs, UI e testes. Não inclui transmitir a EFD.

## Estado em 16/09/2026

| # | Marco | Estado |
|---|-------|--------|
| 1 | CNPJ alfanumérico, preservando os numéricos | Concluído (já na main) |
| 2 | Data fiscal civil, offset e timezone IANA por estabelecimento | Concluído |
| 3 | Estruturas de configuração, competência, versão, snapshots, apuração, diagnósticos, arquivos, 1601 e inventário | Concluído. Migrations provadas com rollback em Demir e Garage |
| 4 | Motor do leiaute 020 (blocos 0, C, E, H, 1 e 9) | Implementado, com testes unitários. **Não passou pelo PVA** |
| 5 | Gates de Perfil, Bloco K, 1400 e C176/C179 | Concluído. O banco recusa o fechamento com gate PENDENTE |
| 6 | Importações, validação, fechamento/reabertura, geração e download | Implementado. Ciclo de fechamento e reabertura provado no banco; geração e download ainda sem teste contra o Storage real |
| 7 | Área `/fiscal/sped`, permissões e rastreabilidade | Concluído, incluindo abrir competência e confirmar datas fiscais de entrada |
| 8 | Testes e regressão | `test:negocio`, `db:test:sped-fiscal` e `next build` passando |

### O que o teste de banco prova

`npm run db:test:sped-fiscal -- <demo|demir|garage>` aplica todas as migrations pendentes do banco numa transação revertida e verifica:

- as migrations aplicam sobre os dados reais;
- o ciclo completo da competência, com as travas:
  - não abre duas versões editáveis;
  - recusa hash divergente;
  - bloqueio impede APTA;
  - gate pendente impede o fechamento;
  - lock antigo é recusado;
  - versão fechada, snapshots, ajustes e competência são imutáveis;
  - reabrir exige motivo e cria a versão 2 retificadora sem tocar na 1;
  - fechar a 2 substitui a 1;
- cancelamento de NF-e sobre uma nota real: evento preservado, idempotente, divergência recusada, evento imutável;
- RLS ligada nas 23 tabelas, sem acesso para `anon`/`authenticated`, nenhuma função nova executável por `anon` e bucket `fiscal-sped` privado.

Cada migration roda dentro de `DO ... EXECUTE`. Ali dentro, um `COMMIT` embutido gera erro em vez de efetivar o teste.

## Publicação

A ordem importa: o cancelamento de NF-e da branch usa `fiscal_registrar_cancelamento_nfe`, que só existe depois das migrations.

1. **Demonstração, uma única vez:** `npx tsx scripts/db/registrar-historico-sped-demo.ts --aplicar`.
   - Uma versão anterior do teste aplicou de fato as 9 migrations pendentes nesse banco, sem gravar o histórico.
   - O script confere o efeito de cada uma e só então registra as versões.
   - Rode antes sem `--aplicar` para simular.
2. `npm run db:deploy`: aplica as 9 migrations em Demir e Garage. Na Demonstração, depois do passo 1, não há nada pendente.
3. Merge da `feature/sped` na `main` e push.
4. Smoke na Demonstração: abrir a competência 08/2026, confirmar as datas das entradas, validar e conferir os diagnósticos.

**As migrations de `20260916054031` a `20260917100000` não podem mais ser editadas**, porque a Demonstração já as executou. Qualquer correção de SQL vai numa migration nova.

## Fronteiras e segurança

- XML autorizado/evento SEFAZ é a fonte histórica de documento e tributos.
- Cadastro atual nunca reescreve o histórico fiscal.
- Entradas exigem `data_entrada_fiscal` confirmada. Nada é preenchido automaticamente: a tela oferece a data de emissão e a data do lançamento como atalhos, e o usuário confirma. A confirmação é recusada quando atinge uma competência FECHADA.
- NF-e denegada, enviada sem retorno, em contingência ou com resultado incerto no período bloqueia a validação. O motor ainda não gera C100 com COD_SIT 04.
- Cancelamento homologado pela SEFAZ sempre marca a NF-e como CANCELADA. Se a preservação do evento falhar, a tela avisa.
- Tabelas SPED usam RLS e não concedem acesso direto a `anon`/`authenticated`. As APIs autenticadas usam o cliente administrativo no servidor.
- Versões fechadas, snapshots e artefatos são imutáveis.
- CNPJ é texto canônico de 14 posições; nunca é normalizado com `\D`.
- Datas civis do XML são preservadas sem conversão cega de timezone.

## Critérios de conclusão técnica

- [x] Migrations consistentes, provadas com rollback nos bancos de cliente.
- [x] Testes com `00000000E08G12` e CNPJ numérico.
- [x] Geração determinística com contadores e Bloco 9 coerentes (testes unitários do serializador).
- [x] Fechamento bloqueado por erros, datas não confirmadas e gates pendentes.
- [x] Reabertura cria nova versão sem mutar a anterior.
- [x] Suítes existentes continuam passando.
- [ ] Arquivo gerado de uma competência real importado no PVA.

## Bloqueios externos do piloto

- Confirmações do contador: perfil da IE, Bloco K, C176/C179, 1400, IPI, EFD-Contribuições e ajustes.
- EFD oficial de julho de 2026.
- Revisão das datas fiscais de entrada.
- Arquivo mensal do 1601 e dados das instituições.
- PVA vigente e aprovação contábil do TXT final.

Sem esses itens, os gates ficam PENDENTE e a competência não fecha. É o comportamento esperado.
