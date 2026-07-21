// Utilidades para os testes de integração das Edge Functions.
// Estes testes só rodam se o Supabase local estiver de pé e as variáveis abaixo
// estiverem no ambiente; caso contrário são ignorados (ver `integrationReady`).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const FUNCTIONS_URL = Deno.env.get("FUNCTIONS_URL") ?? `${SUPABASE_URL}/functions/v1`;

// Só roda a integração quando explicitamente ligada e com as chaves presentes.
export const integrationReady = Deno.env.get("INTEGRATION") === "1" && !!ANON_KEY && !!SERVICE_KEY;

export function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// Cria uma mesa (número alto para não colidir com o seed) + comanda aberta.
// `n` deve ser único por teste. Retorna ids e o token da comanda.
export async function novaComandaAberta(n: number) {
  const db = svc();
  const numero = 9000 + n;
  const { data: mesa, error: e1 } = await db
    .from("mesas")
    .insert({ numero, status: "ocupada" })
    .select()
    .single();
  if (e1) throw e1;

  const token = `token-teste-${numero}`;
  const { data: comanda, error: e2 } = await db
    .from("comandas")
    .insert({ mesa_id: mesa.id, token, status: "aberta" })
    .select()
    .single();
  if (e2) throw e2;

  return { mesaId: mesa.id as string, comandaId: comanda.id as string, token };
}

// Um item disponível qualquer do cardápio (usa o seed).
export async function itemDisponivel(): Promise<{ id: string; preco: number }> {
  const { data, error } = await svc()
    .from("itens_cardapio")
    .select("id, preco")
    .eq("disponivel", true)
    .limit(1)
    .single();
  if (error) throw error;
  return { id: data.id, preco: Number(data.preco) };
}

// Cria (ou reaproveita) um usuário de staff com o papel dado e devolve um
// access_token válido para chamar funções que exigem Auth.
export async function staffToken(papel: "caixa" | "cozinha" | "admin"): Promise<string> {
  const db = svc();
  const email = `${papel}.teste@mesalink.local`;
  const password = "senha-teste-123";

  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  let userId: string;
  if (createErr) {
    // Já existe: busca pela listagem.
    const { data: list } = await db.auth.admin.listUsers();
    const found = list.users.find((u) => u.email === email);
    if (!found) throw createErr;
    userId = found.id;
  } else {
    userId = created.user!.id;
  }

  await db.from("staff").upsert(
    { auth_user_id: userId, nome: `Teste ${papel}`, papel },
    { onConflict: "auth_user_id" },
  );

  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;
  return session.session!.access_token;
}

export async function callFunction(
  name: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  // O `supabase functions serve` local baixa/compila as dependências no PRIMEIRO
  // acesso a cada função (cold start), o que pode estourar o wall-clock e devolver
  // 503 (early termination). Isso é artefato do runtime local — nossas funções
  // nunca respondem 503 — então tentamos de novo até o isolate esquentar.
  const MAX_TENTATIVAS = 6;
  let ultima: { status: number; json: any } = { status: 0, json: null };

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        Authorization: headers.Authorization ?? `Bearer ${ANON_KEY}`,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    ultima = { status: res.status, json };

    if (res.status !== 503) return ultima;
    await new Promise((r) => setTimeout(r, 2000 * tentativa)); // backoff progressivo
  }

  return ultima;
}
