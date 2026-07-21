# MesaLink API (backend Supabase)

Backend do sistema de comanda digital para hamburgueria. **Só backend** — nenhum
código de frontend, client SDK de exemplo ou página. O contrato que o frontend
consome está documentado abaixo.

## Stack

- **Supabase**: Postgres + Realtime + Auth + Edge Functions (Deno/TypeScript).
- Sem servidor Express/Node separado.

## Estrutura

```
supabase/
  config.toml                      # config do projeto local
  seed.sql                         # dados de exemplo (aplicado no supabase start)
  migrations/
    20260720000001_schema.sql      # tabelas, constraints, RPCs e triggers
    20260720000002_rls.sql         # políticas de Row Level Security
  functions/
    _shared/                       # cors, clientes supabase e validadores
    criar-pedido/
    solicitar-fechamento/
    fechar-conta/
    tests/                         # Deno.test (unitário + integração)
```

## Modelo de dados

- **mesas** — `numero`, `status` (`livre` | `ocupada`).
- **comandas** — `mesa_id`, `token` (sessão do cliente), `status` (`aberta` |
  `fechamento_solicitado` | `fechada`).
- **itens_cardapio** — `nome`, `descricao`, `preco`, `categoria`, `disponivel`.
- **pedidos** — `comanda_id`, `status` (`recebido` | `preparo` | `pronto` | `entregue`).
- **itens_pedido** — `pedido_id`, `item_cardapio_id`, `quantidade`,
  `preco_unitario_registrado` (preço congelado do pedido; nunca vem do client).
- **fechamentos** — `comanda_id`, `status` (`solicitado` | `avisado` | `fechado`),
  `total`, `forma_pagamento`.
- **staff** — `auth_user_id`, `nome`, `papel` (`cozinha` | `caixa` | `admin`).

Todos os `status` são validados por **check constraints** no banco, não texto livre.

## Segurança (RLS) — resumo

- **Cliente** (papel `anon`) se identifica pelo header **`x-comanda-token`**.
  Só enxerga a própria comanda/mesa/pedidos/fechamento e o cardápio disponível;
  só insere pedidos vinculados à sua comanda **aberta**.
- **Cozinha** vê a fila de pedidos e só faz `UPDATE` de **status** em `pedidos`
  (a restrição de coluna é garantida por trigger; a RLS restringe as linhas).
- **Caixa** vê contas e só faz `UPDATE` em `fechamentos`.
- **Admin** tem acesso total.

O papel do staff é resolvido por `current_staff_papel()` a partir de `auth.uid()`.
O token do cliente é lido por `current_comanda_token()` a partir dos headers da
requisição expostos pelo PostgREST.

As três operações de negócio são funções SQL (`SECURITY DEFINER`) chamadas pelas
Edge Functions, o que garante **atomicidade** (o corpo roda numa única transação):
`criar_pedido`, `solicitar_fechamento`, `fechar_conta`.

## Rodando local

Pré-requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli) e Docker.
(O Deno já vem embutido no runtime das functions do Supabase.)

```bash
# 1. Subir o stack local (Postgres, Auth, API, Studio...).
#    Aplica automaticamente as migrations em supabase/migrations/ e o seed.sql.
supabase start

# Se precisar (re)aplicar migrations sem recriar tudo:
supabase db reset          # dropa, recria e re-aplica migrations + seed

# 2. Servir as Edge Functions localmente.
supabase functions serve
```

O `supabase start` imprime as URLs e chaves locais (API URL, anon key,
service_role key). Guarde-as para chamar as funções e rodar os testes.

Por padrão:

- API / Functions base: `http://127.0.0.1:54321`
- Endpoint das funções: `http://127.0.0.1:54321/functions/v1/<nome>`
- Studio: `http://127.0.0.1:54323`

## Contrato das Edge Functions

Todas respondem JSON. Em erro, o corpo é `{ "error": "<CODIGO>", "message": "..." }`.
Status usados: `400` (payload/negócio inválido), `401` (não autenticado),
`403` (sem permissão / token errado), `404` (não encontrado), `409` (conflito de
estado), `201`/`200` (sucesso).

### `POST /functions/v1/criar-pedido`

Chamada pelo dispositivo do cliente.

- **Headers**: `x-comanda-token: <token da comanda>` (obrigatório).
- **Body**:

```json
{
  "comanda_id": "uuid",
  "itens": [
    { "item_cardapio_id": "uuid", "quantidade": 2 }
  ]
}
```

> O client **não** envia preço. A função valida que a comanda está `aberta` e
> pertence ao token, busca o preço real de cada item no banco e grava
> `pedido` + `itens_pedido` numa transação.

- **Resposta `201`**:

```json
{
  "pedido": { "id": "uuid", "comanda_id": "uuid", "status": "recebido", "created_at": "..." },
  "itens": [
    { "id": "uuid", "pedido_id": "uuid", "item_cardapio_id": "uuid",
      "quantidade": 2, "preco_unitario_registrado": "28.00" }
  ]
}
```

Erros: `PEDIDO_SEM_ITENS`/`QUANTIDADE_INVALIDA` (400), `TOKEN_AUSENTE` (401),
`TOKEN_INVALIDO` (403), `COMANDA_NAO_ENCONTRADA`/`ITEM_NAO_ENCONTRADO` (404),
`COMANDA_NAO_ABERTA`/`ITEM_INDISPONIVEL` (409).

### `POST /functions/v1/solicitar-fechamento`

Chamada pelo cliente.

- **Headers**: `x-comanda-token` (obrigatório).
- **Body**: `{ "comanda_id": "uuid" }`
- Soma `quantidade * preco_unitario_registrado` de todos os `itens_pedido` cujos
  pedidos estão `entregue`, cria um `fechamento` `solicitado` com o total e muda
  a comanda para `fechamento_solicitado`.
- **Resposta `201`**:

```json
{ "id": "uuid", "comanda_id": "uuid", "status": "solicitado",
  "total": "56.00", "forma_pagamento": null, "solicitado_em": "...", "fechado_em": null }
```

Erros: `TOKEN_AUSENTE` (401), `TOKEN_INVALIDO` (403),
`COMANDA_NAO_ENCONTRADA` (404), `COMANDA_JA_FECHADA` (409).

### `POST /functions/v1/fechar-conta`

Chamada pelo **staff** (`caixa` ou `admin`).

- **Headers**: `Authorization: Bearer <access_token do usuário logado>`
  (`verify_jwt = true`). O papel é conferido na tabela `staff`.
- **Body**: `{ "fechamento_id": "uuid", "forma_pagamento": "dinheiro|credito|debito|pix" }`
- Marca o fechamento como `fechado`, a comanda como `fechada` e a mesa como
  `livre`, tudo numa transação.
- **Resposta `200`**: o registro de `fechamento` atualizado.

Erros: `FORMA_PAGAMENTO_INVALIDA` (400), `NAO_AUTENTICADO` (401),
`SEM_PERMISSAO` (403), `FECHAMENTO_NAO_ENCONTRADO` (404),
`FECHAMENTO_JA_FECHADO` (409).

## Testes

Os testes usam `Deno.test`.

**Unitários** (validadores puros, não precisam do Supabase de pé):

```bash
deno test supabase/functions/tests/validation.test.ts
```

**Integração** (exigem `supabase start` + `supabase functions serve` rodando).
Passe as chaves impressas pelo `supabase start` e ligue com `INTEGRATION=1`:

```bash
INTEGRATION=1 \
SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_ANON_KEY="<anon key>" \
SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \
deno test -A supabase/functions/tests/
```

Sem `INTEGRATION=1`, os testes de integração são ignorados automaticamente e só
os unitários rodam.

## Variáveis de ambiente das funções

Em produção/local, as Edge Functions esperam (o Supabase injeta as três
primeiras automaticamente ao usar `supabase functions serve`):

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Para os testes de integração e scripts locais, copie o modelo e preencha com as
chaves impressas pelo `supabase start`:

```bash
cp .env.example .env
```

O `.env` real **não** é versionado (está no `.gitignore`); só o `.env.example`
(com placeholders) vai para o repositório.
