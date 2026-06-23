import { createClient } from "@supabase/supabase-js";
import { TABLAS } from "./db-schema";

const SUPABASE_URL = "https://ukbejxfvhhftpwugoxqb.supabase.co";

export function getSupabaseClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(SUPABASE_URL, key);
}

/** Catálogo liviano: nombre de tabla, cantidad de filas y columnas conocidas. */
export async function buildResumenContexto(): Promise<string> {
  const sb = getSupabaseClient();
  const nombres = Object.keys(TABLAS);

  const conteos = await Promise.all(
    nombres.map(async (tabla) => {
      const { count, error } = await sb.from(tabla).select("*", { count: "exact", head: true });
      return error ? "?" : String(count ?? 0);
    })
  );

  return nombres
    .map((tabla, i) => `- ${tabla} (${conteos[i]} filas) → columnas: ${TABLAS[tabla]}`)
    .join("\n");
}

type Filtro = { columna: string; operador: string; valor: unknown };

export type ConsultaArgs = {
  tabla: string;
  columnas?: string[];
  filtros?: Filtro[];
  orden?: { columna: string; ascendente?: boolean };
  limite?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryBuilder = any;

const OPERADORES: Record<string, (q: QueryBuilder, columna: string, valor: unknown) => QueryBuilder> = {
  eq: (q, c, v) => q.eq(c, v),
  neq: (q, c, v) => q.neq(c, v),
  gt: (q, c, v) => q.gt(c, v),
  gte: (q, c, v) => q.gte(c, v),
  lt: (q, c, v) => q.lt(c, v),
  lte: (q, c, v) => q.lte(c, v),
  like: (q, c, v) => q.like(c, String(v)),
  ilike: (q, c, v) => q.ilike(c, String(v)),
  in: (q, c, v) => q.in(c, Array.isArray(v) ? v : [v]),
  is: (q, c, v) => q.is(c, v === "null" ? null : v),
};

export async function consultarTabla(args: ConsultaArgs): Promise<{ data?: unknown[]; error?: string }> {
  if (!TABLAS[args.tabla]) {
    return { error: `Tabla no permitida: "${args.tabla}". Tablas disponibles: ${Object.keys(TABLAS).join(", ")}` };
  }

  const sb = getSupabaseClient();
  const select = args.columnas?.length ? args.columnas.join(",") : "*";
  let query: QueryBuilder = sb.from(args.tabla).select(select);

  for (const f of args.filtros ?? []) {
    const op = OPERADORES[f.operador];
    if (!op) return { error: `Operador no soportado: "${f.operador}". Usa: ${Object.keys(OPERADORES).join(", ")}` };
    query = op(query, f.columna, f.valor);
  }

  if (args.orden?.columna) {
    query = query.order(args.orden.columna, { ascending: args.orden.ascendente ?? true });
  }

  const limite = Math.min(Math.max(args.limite ?? 50, 1), 200);
  query = query.limit(limite);

  const { data, error } = await query;
  return error ? { error: error.message } : { data: (data ?? []) as unknown[] };
}

export async function guardarPreguntaSinRespuesta(params: {
  telefono?: string;
  pregunta: string;
  respuesta: string;
}): Promise<void> {
  const sb = getSupabaseClient();
  await sb.from("preguntas_sin_respuesta").insert({
    telefono: params.telefono ?? null,
    pregunta: params.pregunta,
    respuesta: params.respuesta,
  });
}
