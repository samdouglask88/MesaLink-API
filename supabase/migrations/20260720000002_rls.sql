-- =============================================================================
-- MesaLink — Row Level Security
--
-- Papéis:
--   anon           -> dispositivo do cliente, identificado pelo header
--                     x-comanda-token (ver current_comanda_token()).
--   authenticated  -> staff logado; comportamento depende de current_staff_papel()
--                     (cozinha / caixa / admin).
--
-- Regras principais:
--   * cliente só insere pedidos vinculados à comanda do seu próprio token;
--   * cozinha só faz UPDATE de status em pedidos (coluna garantida por trigger);
--   * caixa só faz UPDATE em fechamentos;
--   * cada papel só enxerga o que lhe diz respeito.
--
-- As RPCs de negócio são SECURITY DEFINER e passam por cima da RLS de propósito;
-- estas policies são o modelo de segurança do acesso DIRETO às tabelas.
-- =============================================================================

alter table public.mesas          enable row level security;
alter table public.comandas       enable row level security;
alter table public.itens_cardapio enable row level security;
alter table public.pedidos        enable row level security;
alter table public.itens_pedido   enable row level security;
alter table public.fechamentos    enable row level security;
alter table public.staff          enable row level security;

-- -----------------------------------------------------------------------------
-- ADMIN: acesso total (uma policy FOR ALL por tabela).
-- -----------------------------------------------------------------------------
create policy admin_all_mesas on public.mesas
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_comandas on public.comandas
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_cardapio on public.itens_cardapio
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_pedidos on public.pedidos
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_itens_pedido on public.itens_pedido
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_fechamentos on public.fechamentos
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

create policy admin_all_staff on public.staff
  for all to authenticated
  using (public.current_staff_papel() = 'admin')
  with check (public.current_staff_papel() = 'admin');

-- -----------------------------------------------------------------------------
-- STAFF: cada um vê a própria linha em staff (para resolver o próprio papel).
-- -----------------------------------------------------------------------------
create policy staff_ve_a_si_mesmo on public.staff
  for select to authenticated
  using (auth_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- CLIENTE (anon), identificado pelo x-comanda-token.
-- -----------------------------------------------------------------------------

-- Cardápio: cliente só vê itens disponíveis.
create policy cliente_ve_cardapio on public.itens_cardapio
  for select to anon
  using (disponivel = true);

-- Comanda: cliente só vê a própria comanda (pelo token).
create policy cliente_ve_sua_comanda on public.comandas
  for select to anon
  using (token = public.current_comanda_token());

-- Mesa: cliente vê a mesa da própria comanda.
create policy cliente_ve_sua_mesa on public.mesas
  for select to anon
  using (
    id in (
      select mesa_id from public.comandas
      where token = public.current_comanda_token()
    )
  );

-- Pedidos: cliente vê os pedidos da própria comanda.
create policy cliente_ve_seus_pedidos on public.pedidos
  for select to anon
  using (
    comanda_id in (
      select id from public.comandas
      where token = public.current_comanda_token()
    )
  );

-- Pedidos: cliente só insere pedido vinculado à SUA comanda, e só se ela
-- estiver aberta. (O caminho normal é a Edge Function; esta policy garante que
-- o acesso direto respeite a mesma regra.)
create policy cliente_insere_pedido on public.pedidos
  for insert to anon
  with check (
    comanda_id in (
      select id from public.comandas
      where token = public.current_comanda_token()
        and status = 'aberta'
    )
  );

-- Itens do pedido: cliente vê os itens dos seus pedidos.
create policy cliente_ve_seus_itens_pedido on public.itens_pedido
  for select to anon
  using (
    pedido_id in (
      select p.id from public.pedidos p
      join public.comandas c on c.id = p.comanda_id
      where c.token = public.current_comanda_token()
    )
  );

-- Itens do pedido: cliente só insere itens em pedidos da sua comanda aberta.
create policy cliente_insere_itens_pedido on public.itens_pedido
  for insert to anon
  with check (
    pedido_id in (
      select p.id from public.pedidos p
      join public.comandas c on c.id = p.comanda_id
      where c.token = public.current_comanda_token()
        and c.status = 'aberta'
    )
  );

-- Fechamento: cliente pode ver o fechamento da própria comanda (acompanhar a conta).
create policy cliente_ve_seu_fechamento on public.fechamentos
  for select to anon
  using (
    comanda_id in (
      select id from public.comandas
      where token = public.current_comanda_token()
    )
  );

-- -----------------------------------------------------------------------------
-- COZINHA: enxerga a fila de pedidos e só ATUALIZA status de pedidos.
-- (A restrição de coluna é garantida pelo trigger
--  pedidos_cozinha_somente_status; RLS controla apenas as linhas.)
-- -----------------------------------------------------------------------------
create policy cozinha_ve_pedidos on public.pedidos
  for select to authenticated
  using (public.current_staff_papel() = 'cozinha');

create policy cozinha_ve_itens_pedido on public.itens_pedido
  for select to authenticated
  using (public.current_staff_papel() = 'cozinha');

create policy cozinha_ve_cardapio on public.itens_cardapio
  for select to authenticated
  using (public.current_staff_papel() = 'cozinha');

create policy cozinha_atualiza_pedido on public.pedidos
  for update to authenticated
  using (public.current_staff_papel() = 'cozinha')
  with check (public.current_staff_papel() = 'cozinha');

-- -----------------------------------------------------------------------------
-- CAIXA: enxerga contas/fechamentos e só ATUALIZA fechamentos.
-- -----------------------------------------------------------------------------
create policy caixa_ve_fechamentos on public.fechamentos
  for select to authenticated
  using (public.current_staff_papel() = 'caixa');

create policy caixa_atualiza_fechamentos on public.fechamentos
  for update to authenticated
  using (public.current_staff_papel() = 'caixa')
  with check (public.current_staff_papel() = 'caixa');

create policy caixa_ve_comandas on public.comandas
  for select to authenticated
  using (public.current_staff_papel() = 'caixa');

create policy caixa_ve_mesas on public.mesas
  for select to authenticated
  using (public.current_staff_papel() = 'caixa');

create policy caixa_ve_pedidos on public.pedidos
  for select to authenticated
  using (public.current_staff_papel() = 'caixa');

create policy caixa_ve_itens_pedido on public.itens_pedido
  for select to authenticated
  using (public.current_staff_papel() = 'caixa');
