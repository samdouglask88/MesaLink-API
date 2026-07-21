// Integração: solicitar-fechamento.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callFunction, integrationReady, itemDisponivel, novaComandaAberta, svc } from "./_helpers.ts";

Deno.test({
  name: "solicitar-fechamento: soma só pedidos 'entregue' e marca a comanda",
  ignore: !integrationReady,
  async fn() {
    const { comandaId, token } = await novaComandaAberta(11);
    const item = await itemDisponivel();
    const db = svc();

    // Pedido A: 2 unidades, marcado como ENTREGUE (deve entrar no total).
    const a = await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 2 }] },
      { "x-comanda-token": token },
    );
    await db.from("pedidos").update({ status: "entregue" }).eq("id", a.json.pedido.id);

    // Pedido B: 5 unidades, ainda em 'recebido' (NÃO deve entrar no total).
    await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 5 }] },
      { "x-comanda-token": token },
    );

    const { status, json } = await callFunction(
      "solicitar-fechamento",
      { comanda_id: comandaId },
      { "x-comanda-token": token },
    );

    assertEquals(status, 201);
    assertEquals(json.status, "solicitado");
    assertEquals(Number(json.total), item.preco * 2);

    const { data: comanda } = await db.from("comandas").select("status").eq("id", comandaId).single();
    assertEquals(comanda!.status, "fechamento_solicitado");
  },
});

Deno.test({
  name: "solicitar-fechamento: token errado -> 403",
  ignore: !integrationReady,
  async fn() {
    const { comandaId } = await novaComandaAberta(12);
    const { status } = await callFunction(
      "solicitar-fechamento",
      { comanda_id: comandaId },
      { "x-comanda-token": "token-errado" },
    );
    assertEquals(status, 403);
  },
});
