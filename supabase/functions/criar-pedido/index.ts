// criar-pedido
// Recebe { comanda_id, itens: [{ item_cardapio_id, quantidade }] } e o header
// x-comanda-token. Valida o payload, delega para a RPC criar_pedido (que checa
// dono/comanda aberta, busca o preço real de cada item e grava pedido + itens
// numa única transação) e devolve o pedido criado.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { HttpError, parseCriarPedido, pgErrorToHttp } from "../_shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METODO_NAO_PERMITIDO" }, 405);

  try {
    const token = req.headers.get("x-comanda-token");
    if (!token) throw new HttpError(401, "TOKEN_AUSENTE", "header x-comanda-token é obrigatório");

    const { comanda_id, itens } = parseCriarPedido(await req.json().catch(() => null));

    const { data, error } = await serviceClient().rpc("criar_pedido", {
      p_comanda_id: comanda_id,
      p_token: token,
      p_itens: itens,
    });
    if (error) throw pgErrorToHttp(error.message);

    return jsonResponse(data, 201);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code, message: err.message }, err.status);
    return jsonResponse({ error: "ERRO_INTERNO", message: String(err) }, 500);
  }
});
