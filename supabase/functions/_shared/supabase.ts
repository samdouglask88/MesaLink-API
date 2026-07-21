import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// Cliente com service_role: passa por cima da RLS. Usado para executar as RPCs
// de negócio (que são SECURITY DEFINER e já fazem a checagem de dono/papel).
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente da function");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Cliente no contexto do usuário logado (usa o header Authorization recebido),
// para descobrir quem é o chamador via auth.getUser().
export function userClient(authHeader: string | null): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY ausentes no ambiente da function");
  }
  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader ?? "" } },
  });
}
