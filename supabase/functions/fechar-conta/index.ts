// fechar-conta
// Recebe { fechamento_id, forma_pagamento }. Exige um usuário do Auth com papel
// 'caixa' ou 'admin' (verify_jwt = true no config.toml + checagem do papel na
// tabela staff). Delega para a RPC fechar_conta, que fecha o fechamento, fecha
// a comanda e libera a mesa numa única transação.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { HttpError, parseFecharConta, pgErrorToHttp } from "../_shared/validation.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METODO_NAO_PERMITIDO" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new HttpError(401, "NAO_AUTENTICADO", "Authorization é obrigatório");

    // Descobre o usuário pelo JWT enviado.
    const { data: userData, error: userErr } = await userClient(authHeader).auth.getUser();
    if (userErr || !userData.user) throw new HttpError(401, "NAO_AUTENTICADO");

    const svc = serviceClient();

    // Confere o papel do staff (service_role para não depender de RLS aqui).
    const { data: staff, error: staffErr } = await svc
      .from("staff")
      .select("papel")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();
    if (staffErr) throw pgErrorToHttp(staffErr.message);
    if (!staff || (staff.papel !== "caixa" && staff.papel !== "admin")) {
      throw new HttpError(403, "SEM_PERMISSAO", "apenas caixa ou admin podem fechar a conta");
    }

    const { fechamento_id, forma_pagamento } = parseFecharConta(await req.json().catch(() => null));

    const { data, error } = await svc.rpc("fechar_conta", {
      p_fechamento_id: fechamento_id,
      p_forma_pagamento: forma_pagamento,
    });
    if (error) throw pgErrorToHttp(error.message);

    return jsonResponse(data, 200);
  } catch (err) {
    if (err instanceof HttpError) return jsonResponse({ error: err.code, message: err.message }, err.status);
    return jsonResponse({ error: "ERRO_INTERNO", message: String(err) }, 500);
  }
});
