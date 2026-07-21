-- Dados de exemplo para desenvolvimento local (`supabase start` aplica automaticamente).

insert into public.mesas (numero, status) values
  (1, 'ocupada'),
  (2, 'livre'),
  (3, 'livre');

insert into public.itens_cardapio (nome, descricao, preco, categoria, disponivel) values
  ('Classic Burger',   'Pão, hambúrguer 160g, queijo, alface e tomate', 28.00, 'burgers', true),
  ('Cheddar Bacon',    'Hambúrguer 160g, cheddar e bacon',              34.50, 'burgers', true),
  ('Veggie Burger',    'Hambúrguer de grão-de-bico',                    30.00, 'burgers', true),
  ('Batata Frita',     'Porção individual',                             16.00, 'acompanhamentos', true),
  ('Refrigerante Lata','350ml',                                          7.00, 'bebidas', true),
  ('Milkshake',        'Chocolate ou morango',                          18.00, 'bebidas', false);

-- Comanda aberta na mesa 1, com token fixo e conhecido para facilitar os testes.
insert into public.comandas (mesa_id, token, status)
select id, 'token-dev-mesa-1', 'aberta' from public.mesas where numero = 1;
