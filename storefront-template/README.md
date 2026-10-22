# Estrutura comum das lojas

O controle comum de estoque, tentativas de pagamento e publicação está descrito
em [CHECKOUT.md](./CHECKOUT.md).

`supabase/migrations` é a fonte comum para as lojas novas. Mudanças de tabelas,
funções, RLS e índices entram aqui como **nova migration**, depois são
sincronizadas para cada loja. Nunca reescreva migrations já aplicadas.

```powershell
node scripts/storefront/template.mjs check site_brpecaspb
node scripts/storefront/template.mjs sync site_novocliente
node scripts/storefront/template.mjs check site_novocliente
```

`sync` copia apenas arquivos ausentes. Divergências são reportadas e não são
sobrescritas. Nenhum comando deste utilitário conecta ou altera banco de dados.
Depois configure o banco próprio do cliente e execute o migrador da loja.

Na Demir, o baseline antigo e a migration antiga de segurança permanecem no
histórico. O schema inicial de uma loja nova não deve ser executado novamente
nessa base. O utilitário ignora esse baseline ao sincronizar a Demir e adiciona
somente migrations comuns ausentes. Os bancos podem ter históricos antigos
diferentes e convergir para as mesmas tabelas e funções com migrations aditivas.

As diferenças históricas de nome da empresa são aceitas na comparação; novos
schemas usam o nome neutro `Loja virtual`. A identidade da loja fica no código,
nas variáveis próprias e na configuração da Central.

Validação da cadeia completa, sem banco real:

```powershell
node scripts/tests/storefront-schema.cjs
```
