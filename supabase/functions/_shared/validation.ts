// Validadores puros (sem I/O) — fáceis de testar com Deno.test — e o mapeamento
// dos erros de negócio (levantados pelas RPCs) para códigos HTTP.

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

export type ItemInput = { item_cardapio_id: string; quantidade: number };

// Valida o payload de criar-pedido. Repare: NÃO existe campo de preço — o preço
// é sempre buscado no banco pela RPC.
export function parseCriarPedido(body: unknown): {
  comanda_id: string;
  itens: ItemInput[];
} {
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.comanda_id)) {
    throw new HttpError(400, "COMANDA_ID_INVALIDO", "comanda_id ausente ou não é um UUID");
  }
  if (!Array.isArray(b.itens) || b.itens.length === 0) {
    throw new HttpError(400, "PEDIDO_SEM_ITENS", "itens deve ser uma lista não vazia");
  }

  const itens: ItemInput[] = b.itens.map((raw, i) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    if (!isUuid(it.item_cardapio_id)) {
      throw new HttpError(400, "ITEM_ID_INVALIDO", `itens[${i}].item_cardapio_id inválido`);
    }
    if (
      typeof it.quantidade !== "number" ||
      !Number.isInteger(it.quantidade) ||
      it.quantidade <= 0
    ) {
      throw new HttpError(400, "QUANTIDADE_INVALIDA", `itens[${i}].quantidade deve ser inteiro > 0`);
    }
    return { item_cardapio_id: it.item_cardapio_id, quantidade: it.quantidade };
  });

  return { comanda_id: b.comanda_id, itens };
}

export function parseSolicitarFechamento(body: unknown): { comanda_id: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.comanda_id)) {
    throw new HttpError(400, "COMANDA_ID_INVALIDO", "comanda_id ausente ou não é um UUID");
  }
  return { comanda_id: b.comanda_id };
}

const FORMAS_PAGAMENTO = ["dinheiro", "credito", "debito", "pix"] as const;

export function parseFecharConta(body: unknown): {
  fechamento_id: string;
  forma_pagamento: string;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isUuid(b.fechamento_id)) {
    throw new HttpError(400, "FECHAMENTO_ID_INVALIDO", "fechamento_id ausente ou não é um UUID");
  }
  if (
    typeof b.forma_pagamento !== "string" ||
    !FORMAS_PAGAMENTO.includes(b.forma_pagamento as (typeof FORMAS_PAGAMENTO)[number])
  ) {
    throw new HttpError(
      400,
      "FORMA_PAGAMENTO_INVALIDA",
      `forma_pagamento deve ser uma de: ${FORMAS_PAGAMENTO.join(", ")}`,
    );
  }
  return { fechamento_id: b.fechamento_id, forma_pagamento: b.forma_pagamento };
}

// Códigos de negócio levantados pelas RPCs -> status HTTP.
const NOT_FOUND = new Set([
  "COMANDA_NAO_ENCONTRADA",
  "ITEM_NAO_ENCONTRADO",
  "FECHAMENTO_NAO_ENCONTRADO",
]);
const CONFLICT = new Set([
  "COMANDA_NAO_ABERTA",
  "ITEM_INDISPONIVEL",
  "COMANDA_JA_FECHADA",
  "FECHAMENTO_JA_FECHADO",
]);
const BAD_REQUEST = new Set([
  "PEDIDO_SEM_ITENS",
  "QUANTIDADE_INVALIDA",
  "FORMA_PAGAMENTO_INVALIDA",
]);

// A mensagem de erro do Postgres/PostgREST carrega o código que levantamos
// (ex.: "COMANDA_NAO_ABERTA"). Traduzimos isso para o status HTTP adequado.
export function pgErrorToHttp(message: string): HttpError {
  const code = (message.match(/[A-Z_]{5,}/)?.[0]) ?? "ERRO_INTERNO";
  if (message.includes("TOKEN_INVALIDO")) return new HttpError(403, "TOKEN_INVALIDO");
  if (NOT_FOUND.has(code)) return new HttpError(404, code);
  if (CONFLICT.has(code)) return new HttpError(409, code);
  if (BAD_REQUEST.has(code)) return new HttpError(400, code);
  return new HttpError(500, "ERRO_INTERNO", message);
}
