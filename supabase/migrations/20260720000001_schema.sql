-- =============================================================================
-- MesaLink — schema do domínio (mesas, comandas, cardápio, pedidos, fechamentos)
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------

create table public.mesas (
  id         uuid primary key default gen_random_uuid(),
  numero     integer not null unique,
  status     text not null default 'livre'
             check (status in ('livre', 'ocupada')),
  created_at timestamptz not null default now()
);

create table public.comandas (
  id         uuid primary key default gen_random_uuid(),
  mesa_id    uuid not null references public.mesas(id),
  -- token de sessão entregue ao dispositivo do cliente na abertura da comanda.
  token      text not null unique default encode(gen_random_bytes(16), 'hex'),
  status     text not null default 'aberta'
             check (status in ('aberta', 'fechamento_solicitado', 'fechada')),
  aberta_em  timestamptz not null default now(),
  fechada_em timestamptz
);

create table public.itens_cardapio (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  descricao  text,
  preco      numeric(10, 2) not null check (preco >= 0),
  categoria  text,
  disponivel boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.pedidos (
  id         uuid primary key default gen_random_uuid(),
  comanda_id uuid not null references public.comandas(id) on delete cascade,
  status     text not null default 'recebido'
             check (status in ('recebido', 'preparo', 'pronto', 'entregue')),
  created_at timestamptz not null default now()
);

create table public.itens_pedido (
  id                        uuid primary key default gen_random_uuid(),
  pedido_id                 uuid not null references public.pedidos(id) on delete cascade,
  item_cardapio_id          uuid not null references public.itens_cardapio(id),
  quantidade                integer not null check (quantidade > 0),
  -- preço "congelado" no momento do pedido; nunca vem do client.
  preco_unitario_registrado numeric(10, 2) not null check (preco_unitario_registrado >= 0)
);

create table public.fechamentos (
  id             uuid primary key default gen_random_uuid(),
  comanda_id     uuid not null references public.comandas(id),
  status         text not null default 'solicitado'
                 check (status in ('solicitado', 'avisado', 'fechado')),
  total          numeric(10, 2) not null default 0 check (total >= 0),
  forma_pagamento text
                 check (forma_pagamento in ('dinheiro', 'credito', 'debito', 'pix')),
  solicitado_em  timestamptz not null default now(),
  fechado_em     timestamptz
);

create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  nome         text not null,
  papel        text not null check (papel in ('cozinha', 'caixa', 'admin')),
  created_at   timestamptz not null default now()
);

-- Índices para os filtros mais frequentes.
create index idx_comandas_mesa      on public.comandas (mesa_id);
create index idx_comandas_token     on public.comandas (token);
create index idx_pedidos_comanda    on public.pedidos (comanda_id);
create index idx_pedidos_status     on public.pedidos (status);
create index idx_itens_pedido_pedido on public.itens_pedido (pedido_id);
create index idx_fechamentos_comanda on public.fechamentos (comanda_id);

-- -----------------------------------------------------------------------------
-- Funções auxiliares de contexto (usadas pelas policies de RLS)
-- -----------------------------------------------------------------------------

-- Papel do staff logado (null se o usuário atual não é staff).
create or replace function public.current_staff_papel()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select papel from public.staff where auth_user_id = auth.uid();
$$;

-- Token de comanda enviado pelo cliente no header x-comanda-token.
-- PostgREST expõe os headers da requisição via GUC request.headers.
create or replace function public.current_comanda_token()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-comanda-token',
      ''
    ),
    ''
  );
$$;

-- =============================================================================
-- Regras de negócio transacionais (RPC).
--
-- As Edge Functions são wrappers HTTP finos: validam entrada e autenticação e
-- delegam a mutação para estas funções. Como o corpo de uma função plpgsql roda
-- dentro de uma única transação, insert de pedido + itens (ou os updates de
-- fechamento) são atômicos: ou tudo grava, ou nada grava.
--
-- São SECURITY DEFINER de propósito — a Edge Function as chama com a service_role
-- e a checagem de dono da comanda é feita aqui dentro, pelo token.
-- =============================================================================

-- criar_pedido: valida comanda aberta + token do dono, busca o preço real de
-- cada item no banco (NUNCA aceita preço do client) e insere pedido + itens.
create or replace function public.criar_pedido(
  p_comanda_id uuid,
  p_token      text,
  p_itens      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comanda   public.comandas%rowtype;
  v_pedido_id uuid;
  v_item      jsonb;
  v_qtd       integer;
  v_preco     numeric(10, 2);
  v_disp      boolean;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array'
     or jsonb_array_length(p_itens) = 0 then
    raise exception 'PEDIDO_SEM_ITENS' using errcode = '23514';
  end if;

  select * into v_comanda from public.comandas where id = p_comanda_id for update;
  if not found then
    raise exception 'COMANDA_NAO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if p_token is null or v_comanda.token <> p_token then
    raise exception 'TOKEN_INVALIDO' using errcode = '42501';
  end if;
  if v_comanda.status <> 'aberta' then
    raise exception 'COMANDA_NAO_ABERTA' using errcode = 'P0001';
  end if;

  insert into public.pedidos (comanda_id)
  values (p_comanda_id)
  returning id into v_pedido_id;

  for v_item in select * from jsonb_array_elements(p_itens)
  loop
    v_qtd := nullif(v_item ->> 'quantidade', '')::integer;
    if v_qtd is null or v_qtd <= 0 then
      raise exception 'QUANTIDADE_INVALIDA' using errcode = '23514';
    end if;

    select preco, disponivel into v_preco, v_disp
    from public.itens_cardapio
    where id = (v_item ->> 'item_cardapio_id')::uuid;

    if not found then
      raise exception 'ITEM_NAO_ENCONTRADO' using errcode = 'P0002';
    end if;
    if not v_disp then
      raise exception 'ITEM_INDISPONIVEL' using errcode = 'P0001';
    end if;

    insert into public.itens_pedido
      (pedido_id, item_cardapio_id, quantidade, preco_unitario_registrado)
    values
      (v_pedido_id, (v_item ->> 'item_cardapio_id')::uuid, v_qtd, v_preco);
  end loop;

  return jsonb_build_object(
    'pedido', (select to_jsonb(p) from public.pedidos p where p.id = v_pedido_id),
    'itens',  (select coalesce(jsonb_agg(to_jsonb(ip)), '[]'::jsonb)
               from public.itens_pedido ip where ip.pedido_id = v_pedido_id)
  );
end;
$$;

-- solicitar_fechamento: soma os itens dos pedidos ENTREGUES da comanda, cria o
-- fechamento 'solicitado' com o total e marca a comanda como fechamento_solicitado.
create or replace function public.solicitar_fechamento(
  p_comanda_id uuid,
  p_token      text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comanda       public.comandas%rowtype;
  v_total         numeric(10, 2);
  v_fechamento_id uuid;
begin
  select * into v_comanda from public.comandas where id = p_comanda_id for update;
  if not found then
    raise exception 'COMANDA_NAO_ENCONTRADA' using errcode = 'P0002';
  end if;
  if p_token is null or v_comanda.token <> p_token then
    raise exception 'TOKEN_INVALIDO' using errcode = '42501';
  end if;
  if v_comanda.status = 'fechada' then
    raise exception 'COMANDA_JA_FECHADA' using errcode = 'P0001';
  end if;

  select coalesce(sum(ip.quantidade * ip.preco_unitario_registrado), 0)
  into v_total
  from public.pedidos p
  join public.itens_pedido ip on ip.pedido_id = p.id
  where p.comanda_id = p_comanda_id
    and p.status = 'entregue';

  insert into public.fechamentos (comanda_id, status, total)
  values (p_comanda_id, 'solicitado', v_total)
  returning id into v_fechamento_id;

  update public.comandas
  set status = 'fechamento_solicitado'
  where id = p_comanda_id;

  return (select to_jsonb(f) from public.fechamentos f where f.id = v_fechamento_id);
end;
$$;

-- fechar_conta: fecha o fechamento com a forma de pagamento, fecha a comanda e
-- libera a mesa. Chamada apenas pela Edge Function após checar papel caixa/admin.
create or replace function public.fechar_conta(
  p_fechamento_id  uuid,
  p_forma_pagamento text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comanda_id uuid;
  v_status     text;
begin
  if p_forma_pagamento is null
     or p_forma_pagamento not in ('dinheiro', 'credito', 'debito', 'pix') then
    raise exception 'FORMA_PAGAMENTO_INVALIDA' using errcode = '23514';
  end if;

  select comanda_id, status into v_comanda_id, v_status
  from public.fechamentos
  where id = p_fechamento_id
  for update;

  if not found then
    raise exception 'FECHAMENTO_NAO_ENCONTRADO' using errcode = 'P0002';
  end if;
  if v_status = 'fechado' then
    raise exception 'FECHAMENTO_JA_FECHADO' using errcode = 'P0001';
  end if;

  update public.fechamentos
  set status = 'fechado', forma_pagamento = p_forma_pagamento, fechado_em = now()
  where id = p_fechamento_id;

  update public.comandas
  set status = 'fechada', fechada_em = now()
  where id = v_comanda_id;

  update public.mesas
  set status = 'livre'
  where id = (select mesa_id from public.comandas where id = v_comanda_id);

  return (select to_jsonb(f) from public.fechamentos f where f.id = p_fechamento_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Trigger: cozinha só pode alterar a coluna status de pedidos.
-- (RLS controla QUAIS linhas; este trigger controla QUAIS colunas.)
-- -----------------------------------------------------------------------------
create or replace function public.pedidos_cozinha_somente_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_staff_papel() = 'cozinha' then
    if new.comanda_id is distinct from old.comanda_id
       or new.created_at is distinct from old.created_at
       or new.id is distinct from old.id then
      raise exception 'COZINHA_SO_ALTERA_STATUS' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_pedidos_cozinha_somente_status
before update on public.pedidos
for each row
execute function public.pedidos_cozinha_somente_status();
