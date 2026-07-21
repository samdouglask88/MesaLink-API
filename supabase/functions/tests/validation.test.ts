// Testes unitários dos validadores puros — não precisam do Supabase rodando.
// Rodar: deno test supabase/functions/tests/validation.test.ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  HttpError,
  parseCriarPedido,
  parseFecharConta,
  parseSolicitarFechamento,
  pgErrorToHttp,
} from "../_shared/validation.ts";

const COMANDA = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const FECHAMENTO = "33333333-3333-4333-8333-333333333333";

Deno.test("parseCriarPedido: payload válido", () => {
  const out = parseCriarPedido({ comanda_id: COMANDA, itens: [{ item_cardapio_id: ITEM, quantidade: 2 }] });
  assertEquals(out.comanda_id, COMANDA);
  assertEquals(out.itens.length, 1);
  assertEquals(out.itens[0].quantidade, 2);
});

Deno.test("parseCriarPedido: ignora preço vindo do client", () => {
  // Mesmo que o client mande 'preco', ele não aparece na saída — o preço real
  // é sempre resolvido no banco.
  const out = parseCriarPedido({
    comanda_id: COMANDA,
    itens: [{ item_cardapio_id: ITEM, quantidade: 1, preco: 0.01 }],
  });
  assertEquals(Object.keys(out.itens[0]).sort(), ["item_cardapio_id", "quantidade"]);
});

Deno.test("parseCriarPedido: comanda_id inválido", () => {
  assertThrows(() => parseCriarPedido({ comanda_id: "nope", itens: [{ item_cardapio_id: ITEM, quantidade: 1 }] }), HttpError);
});

Deno.test("parseCriarPedido: lista de itens vazia", () => {
  assertThrows(() => parseCriarPedido({ comanda_id: COMANDA, itens: [] }), HttpError);
});

Deno.test("parseCriarPedido: quantidade não-inteira ou <= 0", () => {
  assertThrows(() => parseCriarPedido({ comanda_id: COMANDA, itens: [{ item_cardapio_id: ITEM, quantidade: 0 }] }), HttpError);
  assertThrows(() => parseCriarPedido({ comanda_id: COMANDA, itens: [{ item_cardapio_id: ITEM, quantidade: 1.5 }] }), HttpError);
});

Deno.test("parseSolicitarFechamento: válido e inválido", () => {
  assertEquals(parseSolicitarFechamento({ comanda_id: COMANDA }).comanda_id, COMANDA);
  assertThrows(() => parseSolicitarFechamento({}), HttpError);
});

Deno.test("parseFecharConta: forma de pagamento aceita e rejeitada", () => {
  assertEquals(parseFecharConta({ fechamento_id: FECHAMENTO, forma_pagamento: "pix" }).forma_pagamento, "pix");
  assertThrows(() => parseFecharConta({ fechamento_id: FECHAMENTO, forma_pagamento: "cheque" }), HttpError);
  assertThrows(() => parseFecharConta({ fechamento_id: "x", forma_pagamento: "pix" }), HttpError);
});

Deno.test("pgErrorToHttp: mapeia códigos de negócio para status", () => {
  assertEquals(pgErrorToHttp("... COMANDA_NAO_ENCONTRADA ...").status, 404);
  assertEquals(pgErrorToHttp("... COMANDA_NAO_ABERTA ...").status, 409);
  assertEquals(pgErrorToHttp("... ITEM_INDISPONIVEL ...").status, 409);
  assertEquals(pgErrorToHttp("... TOKEN_INVALIDO ...").status, 403);
  assertEquals(pgErrorToHttp("... QUANTIDADE_INVALIDA ...").status, 400);
  assertEquals(pgErrorToHttp("erro desconhecido").status, 500);
});
