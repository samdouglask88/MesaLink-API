// Integração: fechar-conta.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  callFunction,
  integrationReady,
  itemDisponivel,
  novaComandaAberta,
  staffToken,
  svc,
} from "./_helpers.ts";

Deno.test({
  name: "fechar-conta: caixa fecha fechamento, comanda e libera a mesa",
  ignore: !integrationReady,
  async fn() {
    const { mesaId, comandaId, token } = await novaComandaAberta(21);
    const item = await itemDisponivel();
    const db = svc();

    const a = await callFunction(
      "criar-pedido",
      { comanda_id: comandaId, itens: [{ item_cardapio_id: item.id, quantidade: 1 }] },
      { "x-comanda-token": token },
    );
    await db.from("pedidos").update({ status: "entregue" }).eq("id", a.json.pedido.id);

    const sol = await callFunction(
      "solicitar-fechamento",
      { comanda_id: comandaId },
      { "x-comanda-token": token },
    );
    const fechamentoId = sol.json.id;

    const caixa = await staffToken("caixa");
    const { status, json } = await callFunction(
      "fechar-conta",
      { fechamento_id: fechamentoId, forma_pagamento: "pix" },
      { Authorization: `Bearer ${caixa}` },
    );

    assertEquals(status, 200);
    assertEquals(json.status, "fechado");
    assertEquals(json.forma_pagamento, "pix");

    const { data: comanda } = await db.from("comandas").select("status").eq("id", comandaId).single();
    const { data: mesa } = await db.from("mesas").select("status").eq("id", mesaId).single();
    assertEquals(comanda!.status, "fechada");
    assertEquals(mesa!.status, "livre");
  },
});

Deno.test({
  name: "fechar-conta: cozinha não pode fechar -> 403",
  ignore: !integrationReady,
  async fn() {
    const { comandaId, token } = await novaComandaAberta(22);
    const sol = await callFunction(
      "solicitar-fechamento",
      { comanda_id: comandaId },
      { "x-comanda-token": token },
    );
    const cozinha = await staffToken("cozinha");
    const { status } = await callFunction(
      "fechar-conta",
      { fechamento_id: sol.json.id, forma_pagamento: "dinheiro" },
      { Authorization: `Bearer ${cozinha}` },
    );
    assertEquals(status, 403);
  },
});

Deno.test({
  name: "fechar-conta: forma de pagamento inválida -> 400",
  ignore: !integrationReady,
  async fn() {
    const { comandaId, token } = await novaComandaAberta(23);
    const sol = await callFunction(
      "solicitar-fechamento",
      { comanda_id: comandaId },
      { "x-comanda-token": token },
    );
    const caixa = await staffToken("caixa");
    const { status } = await callFunction(
      "fechar-conta",
      { fechamento_id: sol.json.id, forma_pagamento: "cheque" },
      { Authorization: `Bearer ${caixa}` },
    );
    assertEquals(status, 400);
  },
});
