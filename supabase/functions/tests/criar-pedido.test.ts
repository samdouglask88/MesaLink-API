// Integração: criar-pedido.
// Requer Supabase local + functions serve. Ver README.
// Rodar: INTEGRATION=1 SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//        SUPABASE_SERVICE_ROLE_KEY=... deno test -A supabase/functions/tests/
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callFunction, integrationReady, itemDisponivel, novaComandaAberta, svc } from "./_helpers.ts";

Deno.test({
  name: "criar-pedido: cria pedido e usa o preço do banco (não o do client)",
  ignore: !integrationReady,
  async fn() {
    const { comandaId, token } = await novaComandaAberta(1);
    const item = await itemDisponivel();

    const { status, json } = await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 2, preco: 0.01 }] },
      { "x-comanda-token": token },
    );

    assertEquals(status, 201);
    assertExists(json.pedido.id);
    assertEquals(json.pedido.status, "recebido");
    assertEquals(json.itens.length, 1);
    // Preço registrado veio do cardápio, ignorando o 0.01 enviado.
    assertEquals(Number(json.itens[0].preco_unitario_registrado), item.preco);
  },
});

Deno.test({
  name: "criar-pedido: token errado -> 403",
  ignore: !integrationReady,
  async fn() {
    const { comandaId } = await novaComandaAberta(2);
    const item = await itemDisponivel();
    const { status } = await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 1 }] },
      { "x-comanda-token": "token-errado" },
    );
    assertEquals(status, 403);
  },
});

Deno.test({
  name: "criar-pedido: comanda fechada -> 409",
  ignore: !integrationReady,
  async fn() {
    const { comandaId, token } = await novaComandaAberta(3);
    await svc().from("comandas").update({ status: "fechada" }).eq("id", comandaId);
    const item = await itemDisponivel();
    const { status, json } = await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 1 }] },
      { "x-comanda-token": token },
    );
    assertEquals(status, 409);
    assertEquals(json.error, "COMANDA_NAO_ABERTA");
  },
});

Deno.test({
  name: "criar-pedido: sem header de token -> 401",
  ignore: !integrationReady,
  async fn() {
    const { comandaId } = await novaComandaAberta(4);
    const item = await itemDisponivel();
    const { status } = await callFunction("criar-pedido", {
      comanda_id: comandaId,
      itens: [{ item_cardapio_id: item.id, quantidade: 1 }],
    });
    assertEquals(status, 401);
  },
});
