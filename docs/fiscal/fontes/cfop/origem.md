# Tabela CFOP oficial — fonte do catálogo

Cópia exata do arquivo publicado pelo Portal Nacional da NF-e e usado para gerar
`src/lib/nfe/cfopCatalog.generated.ts`. Não edite: se a tabela mudar, adicione
o arquivo novo ao lado e regenere o catálogo a partir dele.

| Campo | Valor |
|---|---|
| Arquivo | `IT_2023_002_v2_10_Tabela_CFOP_Descricao.xlsx` |
| Nome original | `IT_2023_002_v2_10_Tabela_CFOP_Descrição.xlsx` (cabeçalho `Content-Disposition`) |
| Documento | Informe Técnico 2023.002 v2.10 — "Tabela de CFOP - Publicada em 04/09/2026" |
| Publicação | 04/09/2026 |
| Página de origem | https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=%2FNJarYc9nus%3D (seção "Diversos") |
| Link do arquivo | https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=cQyJHWhaTZQ= |
| Baixado em | 22/09/2026, 20:21 (horário de Brasília) |
| SHA-256 | `c95c91ed1644fdd1c2e6ada24498d8b68b1897f9c9a0665e07ef5eed6a75ff6f` (ver `SHA256.txt`) |
| Registros | 619 linhas na aba `CFOP` |
| Colunas | CFOP, Início/Fim de vigência, indNFe, indComunica, indTransp, indDevol, indRetor, indAnula, indRemes, indComb, indExcIBSCBS, Título do CFOP, Descrição (nota explicativa) |

O link `exibirArquivo.aspx?conteudo=...` aponta para esta publicação específica,
mas o Portal pode retirá-lo. A cópia aqui é a referência: o hash dela é o
`CFOP_CATALOG_SOURCE.sha256` do catálogo, e um teste confere as duas coisas.

## Regenerar

```sh
sha256sum -c docs/fiscal/fontes/cfop/SHA256.txt
node scripts/nfe/generate-cfop-catalog.mjs \
  --xlsx docs/fiscal/fontes/cfop/IT_2023_002_v2_10_Tabela_CFOP_Descricao.xlsx \
  --versao IT-2023.002-v2.10 --publicacao 2026-09-04
```

O resultado tem de ser idêntico ao `cfopCatalog.generated.ts` versionado
(`src/lib/nfe/cfopOperation.test.ts` refaz a geração e compara).

## Versão anterior

O catálogo anterior (IT 2023.002 v1.00, vigência 24/04/2023, SHA-256
`3C338C18…D411DA`) foi gerado de um arquivo que não estava no repositório, com
as descrições tiradas do HTML do CONFAZ. Ele não foi recuperado.
