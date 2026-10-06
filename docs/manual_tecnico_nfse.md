# Manual Técnico: Integração NFS-e (Focus NFe)

Este documento detalha a implementação técnica do fluxo de emissão de Notas Fiscais de Serviço Eletrônicas (NFS-e) para a prefeitura de João Pessoa/PB utilizando a API da Focus NFe v2.

Atualização de 05/10/2026: João Pessoa CRT 3 / item 14.01 desde 01/10 usa
formato nacional via Focus em ambiente municipal próprio (`/v2/nfsen`), com
Ambiente da NFSe Nacional desabilitado no painel. Consulte a
[documentação atualizada](documentacao_nfse_joao_pessoa_focusnfe.md).
As referências abaixo a CNAE e item da LC 116 descrevem o emissor municipal
legado, preservado para o histórico e as exceções da transição.

---

## 1. Arquitetura da Integração

A integração é composta por quatro camadas principais operando em harmonia:

-   **Camada de Serviço (`NFSeService`)**: Localizada em `src/lib/services/fiscais/nfse-service.ts`. Encapsula a lógica de comunicação, mapeamento de objetos e controle de ambiente.
-   **API Routes (Next.js)**: Localizadas em `src/app/api/nfse/`. Endpoints focados em ações específicas (emitir, consultar, cancelar).
-   **Persistência (Supabase)**: Tabela `nfse` para histórico e tabela `empresa` para configurações fiscais.
-   **Interface de Usuário (React/Shadcn)**: Diálogos interativos em `src/app/(app)/(pages)/ordens/components/dialogs/emissao-nota-dialog/`.

---

## 2. Configurações Fiscais Obrigatórias

Para que a emissão ocorra com sucesso, a tabela `empresa` deve estar preenchida com:

-   **CNPJ**: Apenas números.
-   **Inscrição Municipal**: Fundamental para João Pessoa.
-   **CNAE**: Código de 9 dígitos (o sistema sanitiza e completa com zeros).
-   **Regime Tributário**: Usado para definir o `regime_especial_tributacao`.
-   **UF**: Deve ser `PB`.
-   **Ambiente**: `PRODUCAO` ou `HOMOLOGACAO`.

---

## 3. Variáveis de Ambiente (.env.local)

As chaves de API devem ser configuradas separadamente:

```bash
# Token de Produção (Acesso Real)
FOCUS_NFE_API_TOKEN=sua_chave_producao
# Token de Homologação (Testes)
FOCUS_NFE_API_TOKEN_HOMOLOGACAO=sua_chave_homologacao
```

O sistema alterna automaticamente os tokens e as URLs da API (`api.focusnfe.com.br` vs `homologacao.focusnfe.com.br`) baseando-se na coluna `ambiente` da tabela `empresa`.

---

## 4. Lógica de Referência Única

Para permitir que um usuário emita múltiplas notas para o mesmo serviço da mesma OS, o sistema gera uma **Referência Exclusiva** para cada tentativa:

`referencia = OS_{os_id}_SRV_{osservico_id}_{timestamp}`

Isso garante que nunca ocorra o erro "Referência já utilizada", permitindo correções e re-emissões infinitas.

---

## 5. Endpoints Disponíveis

| Método | Endpoint | Função |
| :--- | :--- | :--- |
| `POST` | `/api/nfse/de-os/[id]` | Inicia emissão de um serviço da OS. |
| `GET` | `/api/nfse/servicos-de-os/[id]` | Lista serviços e o status da última nota vinculada. |
| `POST` | `/api/nfse/consultar/[id]` | Sincroniza o status local com a SEFAZ via Focus NFe. |
| `POST` | `/api/nfse/cancelar/[id]` | Realiza o cancelamento de uma nota autorizada. |

---

## 6. Mapeamento de Tributos (João Pessoa)

O sistema segue as normas específicas de João Pessoa/PB:
- **Natureza Operação**: `1` (Tributação no município).
- **Item Lista Serviço**: `14.01` (Lubrificação, limpeza, revisão, manutenção e conserto de veículos).
- **CNAE**: Sanitizado para 9 dígitos (ex: 452000100).
