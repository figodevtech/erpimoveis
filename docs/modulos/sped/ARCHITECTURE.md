# Arquitetura — módulo SPED Fiscal

## Componentes

```text
UI /fiscal/sped
  -> Route Handlers autenticados (/api/fiscal/sped/*)
    -> serviços de aplicação (src/services/fiscal/sped)
      -> domínio puro (src/lib/sped/efd-icms-ipi)
      -> identificadores fiscais (src/lib/fiscal-identifiers)
      -> leitores XML existentes (src/lib/nfe)
      -> Supabase service-role (somente servidor)
        -> configuração e competências
        -> versões e snapshots imutáveis
        -> apuração, ajustes e diagnósticos
        -> artefatos em Storage privado
```

## Módulos e responsabilidades

- `src/lib/fiscal-identifiers`: normalização, formatação e DV de CPF/CNPJ, incluindo CNPJ alfanumérico.
- `src/lib/fiscal-date`: data civil, offset lexical e instante UTC sem alterar a competência fiscal.
- `src/lib/sped/efd-icms-ipi`: tipos, schemas de registros, ordenação, serialização e contadores do leiaute 020.
- `src/services/fiscal/sped`: seleção de fontes, projeção do declarante, validação, apuração, máquina de estados e persistência.
- `src/app/api/fiscal/sped`: fronteira HTTP, autenticação, autorização e respostas serializáveis.
- `src/app/(app)/(pages)/(financeiro)/fiscal/sped`: operação da competência, gates, inconsistências e arquivos.

## Estado e consistência

- Competência: `ABERTA -> EM_VALIDACAO -> COM_ERROS | APTA -> FECHADA`.
- Versão: `RASCUNHO -> VALIDADA -> FECHADA -> SUBSTITUIDA`.
- O fechamento usa lock transacional, refaz a validação e persiste um snapshot com corte de fontes.
- Reabertura cria uma nova versão ligada à anterior.
- A geração usa apenas snapshots fechados e produz hash SHA-256 reproduzível.

## Datas

- Datas de XML têm `originalText`, `civilDate`, `originalOffset` e, quando calculável, `instantUtc`.
- `civilDate` é extraída do texto do documento antes de qualquer conversão.
- `timezone_iana` pertence à configuração do estabelecimento; para a Demir, o valor inicial esperado é `America/Fortaleza`.

## Identidade fiscal

- CNPJ canônico: `^[A-Z0-9]{12}[0-9]{2}$`, uppercase e sem pontuação.
- DV: módulo 11 usando o valor ASCII menos 48 para as doze posições-base.
- CPF, CEP, IE, chaves e códigos numéricos continuam com normalizadores específicos.
- O valor bruto original também é preservado nos snapshots para auditoria.

## Autorização

- `fiscal:sped`: leitura e download.
- `fiscal:sped_gerenciar`: configuração, importações, ajustes, validação, fechamento e reabertura.
- Nenhum componente cliente recebe `service_role` ou acessa diretamente as tabelas SPED.

## Gates

- Perfil EFD, Bloco K, 1400 e C176/C179 usam estados `PENDENTE`, `CONFIRMADO` ou `NAO_APLICAVEL`.
- Gate pendente ou aplicabilidade detectada sem dados suficientes gera diagnóstico bloqueante.
- Se C176/C179 ou Bloco K forem confirmados como obrigatórios, seus registros entram no piloto antes do fechamento.
