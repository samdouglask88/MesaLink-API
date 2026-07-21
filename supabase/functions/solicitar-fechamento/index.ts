// solicitar-fechamento
// Recebe { comanda_id } e o header x-comanda-token. Delega para a RPC
// solicitar_fechamento, que soma os itens dos pedidos 'entregue', cria o
// fechamento 'solicitado' com o total e marca a comanda como
// fechamento_solicitado. Devolve o fechamento criado.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { HttpError, parseSolicitarFechamento, pgErrorToHttp } from "../_shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METODO_NAO_PERMITIDO" }, 405);

  try {
    const token = req.headers.get("x-comanda-token");
    if (!token) throw new HttpError(401, "TOKEN_AUSENTE", "header x-comanda-token é obrigatório");

    const { comanda_id } = parseSolicitarFechamento(await req.json().catch(() => null));

    const { data, error } = await serviceClient().rpc("solicitar_fechamento", {
      p_comanda_id: comanda_id,
      p_token: token,
    });
    if (error) throw pgErrorToHttp(error.message);

    return jsonResponse(data, 201);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code, message: err.message }, err.status);
    return jsonResponse({ error: "ERRO_INTERNO", message: String(err) }, 500);
  }
});
