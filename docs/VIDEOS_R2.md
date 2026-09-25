# Vídeos de checklist: implantação

## Situação

### Início com a franquia gratuita

A migration `20260923123000_video_pilot_plans.sql` adiciona **Piloto 1 GB** (mensalidade zero, disponível para seleção) e **Piloto 5 GB** (mensalidade zero, inicialmente inativo). Aplique-a na central depois das duas migrations anteriores. Nenhuma empresa é habilitada automaticamente. Comece selecionando **Piloto 1 GB** apenas para Garage Premium PB.

Os planos de 100, 250, 500 GB e 1 TB permanecem cadastrados para expansão. Seus preços precisam ser definidos antes de ativá-los; não há aumento automático do plano. A migration não altera preços ou ativações já feitos pelo administrador.

A franquia do R2 Standard é compartilhada pela conta: 10 GB-mês, 1 milhão de operações classe A e 10 milhões classe B por mês. O limite por empresa não é um teto financeiro da Cloudflare. Some o consumo de todas as empresas e outros buckets e acompanhe as operações no painel R2. Para o piloto, mantenha somente a empresa de teste liberada. [Preços oficiais](https://developers.cloudflare.com/r2/pricing/).

Implementação local com vídeos desabilitados por padrão. Nenhum cliente recebe capacidade ou cobrança automaticamente. A conta/bucket R2 ainda precisa ser criado. Não publicar o recurso como homologado antes do teste real de upload, reprodução e download.

## Ordem de implantação

O guia passo a passo está também na central em **Planos de vídeos → Como configurar o armazenamento** (`/videos/configuracao`), com acesso administrativo. Ele inclui criação da conta, bucket, token, CORS e variáveis de cada aplicação.

### Criar a conta e integrar

1. Crie sua conta em https://dash.cloudflare.com/. Abra **Storage & databases → R2 → Overview**, conclua a ativação e as informações de pagamento solicitadas. [Guia oficial](https://developers.cloudflare.com/r2/get-started/).
2. Crie o bucket `figo-checklist-videos`, classe **Standard**, localização automática, privado. Não ative r2.dev público nem configure expiração de objetos concluídos. O limite de cada empresa é controlado pela central.
3. Em **Manage R2 API Tokens → Create Account API token**, escolha **Object Read & Write**, limitado ao bucket criado. Guarde **Access Key ID**, **Secret Access Key** e **Account ID**. [Credenciais oficiais](https://developers.cloudflare.com/r2/api/tokens/).
4. No bucket, em **Settings → CORS policy**, cole o exemplo abaixo substituindo a origem pelo domínio real do ERP. Adicione outras origens conforme novos clientes forem habilitados. [Configuração oficial](https://developers.cloudflare.com/r2/buckets/cors/).

```json
[
  {
    "AllowedOrigins": ["https://erp-do-cliente.exemplo.com.br"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

Na hospedagem da **central**, configure as variáveis abaixo; localmente, use o `.env.local` da pasta da central. Os valores são placeholders, nunca credenciais reais:

```dotenv
R2_ACCOUNT_ID=seu_account_id
R2_ACCESS_KEY_ID=seu_access_key_id
R2_SECRET_ACCESS_KEY=seu_secret_access_key
R2_VIDEO_BUCKET=figo-checklist-videos
```

No **ERP**, preserve o vínculo existente com a central. Se ainda não estiver configurado, obtenha os dados em **Empresas → Configuração da instalação do ERP** e configure no servidor do ERP:

```dotenv
PLATFORM_API_URL=https://central.figosoftwares.com.br
PLATFORM_INSTALLATION_ID=id_da_instalacao
PLATFORM_API_SECRET=chave_da_instalacao
```

As chaves R2 ficam somente na central. O navegador recebe URLs temporárias e envia o arquivo diretamente ao bucket. Reimplante os projetos após configurar as variáveis, na ordem abaixo. Não repita migrations que já foram aplicadas.

### Banco, publicação e liberação

1. Aplicar na central as migrations `20260923120000_checklist_video_storage.sql` e `20260923121500_video_plans.sql`.
2. Aplicar nos ERPs a migration `20260923121000_checklist_videos.sql`.
3. Criar um bucket R2 **Standard privado**, sem domínio público e sem regra de expiração para objetos concluídos. Configurar apenas abortar multipart incompleto após um dia como proteção adicional.
4. Criar credencial S3 R2 restrita ao bucket (leitura e escrita de objetos). Configurar **somente no servidor da central**: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_VIDEO_BUCKET`. Nunca usar `NEXT_PUBLIC_` para esses valores.
5. Configurar CORS no bucket com as origens HTTPS exatas dos ERPs autorizados, métodos `PUT`, `GET`, `HEAD`, cabeçalhos `Content-Type` e `Range`, e exposição de `ETag`, `Content-Length`, `Content-Range`, `Accept-Ranges`. Durante homologação adicionar explicitamente a origem local utilizada e removê-la ao terminar. Não usar origem `*`.
6. Publicar central antes do ERP; verificar `/api/cron/video-cleanup` com `Authorization: Bearer CRON_SECRET`. A agenda está no `vercel.json`, de hora em hora. A rotina não remove vídeos prontos.
7. Na central, abrir **Planos de vídeos**, configurar os preços desejados e ativar os planos. As quatro sugestões iniciais não têm preço e começam inativas. Editar um plano não altera contratos existentes.
8. Em **Empresas → Garage Premium PB → Vídeos nos checklists**, ativar o serviço, selecionar um plano, revisar capacidade e valor e salvar. Capacidade e preço vêm do cadastro do plano. Para piloto gratuito, definir explicitamente zero no preço do plano. Demais empresas continuam desabilitadas.
9. Confirmar consumo em Seu Plano e testar os itens de entrada e saída com uma OS autorizada para homologação. Não usar dados reais sem necessidade.

## Regras

- Capacidade decimal acumulada (1 GB = 1.000.000.000 bytes); não se renova mensalmente. Inclui reservas enquanto uploads não forem concluídos ou removidos.
- Até 2 minutos e 250 MB por arquivo, sem cota de quantidade por OS. Otimização local via WebCodecs/Mediabunny, MP4 H.264/AAC, até 1080p e 30 fps. Não é streaming adaptativo.
- Sem suporte à conversão: original só pode ser enviado se for MP4 H.264/AAC compatível, após aviso; arquivo incompatível é recusado. O tamanho real é conferido pela central e consome a quota.
- Preço novo começa na próxima competência ainda não emitida. A capacidade muda imediatamente. Cobranças mensais guardam base e adicional; tentativas seguintes preservam essa composição.
- Desativar bloqueia novos envios e agenda adicional zero; não apaga o acervo. O armazenamento retido continua gerando custo do fornecedor.
- Somente perfil `ADMINISTRADOR` do ERP pode excluir. A trilha central mantém autor do envio, exclusão, datas e identificação da empresa. Arquivos válidos nunca expiram por idade.
- Vídeos não entram nos PDFs, snapshots assinados ou links públicos. Downloads usam a cópia armazenada; não há backup adicional nesta versão.

## Verificação realizada e pendências

- Testes PostgreSQL local (PGlite): migrations, reserva idempotente, quota acumulada, limite, redução inválida, empresa desabilitada, RLS, agendamento e planos inativos sem preço.
- Teste de composição financeira: soma do adicional e preservação do valor em tentativas posteriores.
- Prévia de navegador com componentes reais: plano preenche GB/preço; layout desktop/mobile; conversão de vídeo sintético WebM para MP4 com transporte simulado.
- **Pendente:** R2 real (CORS, multipart, validação, URLs assinadas, download, expiração e exclusão); vídeos reais em Android/iPhone e redes móveis. Otimização local não pode ser prometida em todos os aparelhos.
- O typecheck geral do ERP contém referências antigas em `.next-dev` e um artefato de captura alheio à alteração; usar também verificação direcionada de `src`.

## Reversão

Desabilitar novos envios pela central; manter rotas de consulta e acesso para preservar o acervo. Não remover tabelas/bucket como reversão. Credenciais, links assinados e conteúdo de vídeos não devem ser registrados em logs.


## Videos em OS, produtos e vendas (24/09/2026)

A mesma liberacao e cota da empresa atende checklist, anexos gerais da OS,
produto (aba Fotos e videos na edicao) e anexos da venda. O seletor de arquivos
de cada tela aceita video e a miniatura aparece na lista existente de anexos.
Na OS e na venda, o video guarda a categoria escolhida no momento do envio.
Nao e necessario
criar buckets ou planos adicionais. Os videos continuam privados no R2.

Videos selecionados podem ter qualquer resolucao valida. A otimizacao preserva
resolucoes menores e reduz originais maiores para no maximo Full HD. A exigencia
de Full HD se aplica apenas a camera interna usada para gravar novos videos.
O original pode ter ate 1 GB; apos otimizar, o arquivo enviado deve ter ate
250 MB e durar no maximo 2 minutos.

Ordem de atualizacao:
1. Central: aplicar `20260924120000_video_attachment_scopes.sql` e publicar a Central.
2. ERP de cada cliente: aplicar `20260924121000_entity_videos.sql` e publicar o ERP.
3. Validar gravacao/selecao, envio, miniatura, reproducao em outra aba e download
   em cada tela com um usuario que tenha permissao de editar o respectivo modulo.
   Apenas administradores com essa permissao podem excluir videos.

A Central mantem os nomes legados da tabela e do campo `os_id` na API de videos.
Para anexos gerais, esse campo representa o ID do cadastro e `kind` define o
namespace (`os`, `produto`, `venda`). Listagens sempre filtram esse namespace;
checklist sem parametro `scope` continua limitado a entrada/saida. A reserva de
cota permanece atomica e soma todos os tipos. No ERP, `entity_video` vincula os
novos videos com chaves estrangeiras ao respectivo cadastro. Cadastre o produto
antes de anexar videos na sua tela de edicao.

Validacao manual apos deploy: usar OS, produto e venda com o mesmo ID e verificar
que cada tela mostra apenas seus videos; usuario sem editar deve poder consultar
sem enviar/excluir; plano desabilitado deve impedir novos envios; atingir a cota
em uma tela deve impedir excedente nas demais. Testar tambem Safari no iPhone.
