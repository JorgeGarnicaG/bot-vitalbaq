import OpenAI from "openai";
import { buildResumenContexto, consultarTabla, guardarPreguntaSinRespuesta } from "./supabase";

const SIN_DATOS = "[SIN_DATOS]";

const systemPromptBase = `Eres el asistente de VitalBAQ S.A.S., empresa de alimentos de Barranquilla, Colombia. Respondes en español para WhatsApp (usa *negrilla*, listas con •).

Tienes acceso en tiempo real a la base de datos de VitalBAQ mediante la herramienta "consultar_tabla". Cubre estos módulos:

*NÓMINA*: empleados, novedades, incapacidades, liquidaciones, empresas_temporales
*COMPRAS / PEDIDOS*: pedidos, detalle_pedidos, remisiones
*INVENTARIO*: items, bodegas, stock_bodega
*PROVEEDORES*: proveedores, proveedor_categorias, precios_historicos
*ACTIVOS / EQUIPOS*: activos, mantenimientos_activos, solicitudes_mantenimiento
*ROTACIÓN DE PERSONAL*: rotaciones, turnos
*NUTRICIÓN / CONCILIACIÓN*: sesiones_nutricionales, remisiones_nutricionales, precios_dieta
*CONFIGURACIÓN*: empresa_areas, empresa_cargos, empresa_sedes

REGLAS:
1. Usa SOLO datos obtenidos vía "consultar_tabla". No inventes ni asumas nada.
2. Encadena varias consultas si lo necesitas (ej: primero busca el id de un empleado por nombre, luego usa ese id para filtrar novedades, rotaciones, etc.).
3. Para resolver nombres usa "ilike" con "%texto%".
4. Para comparar columnas de texto (estado, tipo_contrato, categoria, sede, etc.) usa "ilike" con el valor exacto SIN "%" (es insensible a mayúsculas/minúsculas). Usa "eq" solo para ids (uuid), números o booleanos.
5. Sé conciso pero completo. Usa tablas de texto cuando aplique.
6. Para nómina/salarios, muestra cargo y área junto al dato.
7. Para pedidos y remisiones, indica siempre el estado.
8. Para inventario, diferencia entre stock_actual global y stock por bodega (tabla stock_bodega).
9. Para novedades, agrupa por empleado cuando sean varias.
10. Si después de consultar las tablas relevantes la información solicitada NO existe en la base de datos, responde EMPEZANDO EXACTAMENTE con "${SIN_DATOS}" seguido de una explicación breve. No uses esa etiqueta en ningún otro caso.`;

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "consultar_tabla",
      description: "Consulta filas de una tabla de la base de datos de VitalBAQ, con filtros, orden y límite opcionales.",
      parameters: {
        type: "object",
        properties: {
          tabla: { type: "string", description: "Nombre exacto de la tabla a consultar." },
          columnas: {
            type: "array",
            items: { type: "string" },
            description: "Columnas a devolver. Si se omite, devuelve todas.",
          },
          filtros: {
            type: "array",
            description: "Condiciones a aplicar (se combinan con AND).",
            items: {
              type: "object",
              properties: {
                columna: { type: "string" },
                operador: {
                  type: "string",
                  enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"],
                },
                valor: { description: "Valor a comparar. Para 'in' usa un arreglo." },
              },
              required: ["columna", "operador", "valor"],
            },
          },
          orden: {
            type: "object",
            properties: {
              columna: { type: "string" },
              ascendente: { type: "boolean", description: "true = ascendente, false = descendente" },
            },
            required: ["columna"],
          },
          limite: { type: "integer", description: "Máximo de filas a devolver (por defecto 50, máximo 200)." },
        },
        required: ["tabla"],
      },
    },
  },
];

const MAX_ITERACIONES = 6;

export async function getVitalbaqAnswer(userMessage: string, nombre?: string, telefono?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "Error: OPENAI_API_KEY no configurada.";

  const catalogo = await buildResumenContexto();
  const openai = new OpenAI({ apiKey });

  const userContext = nombre
    ? `El usuario que pregunta se llama ${nombre}. Dirígete a él por su nombre cuando sea natural.\n\n`
    : "";

  const systemPrompt = `${systemPromptBase}\n\n=== TABLAS DISPONIBLES (filas actuales y columnas conocidas) ===\n${catalogo}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${userContext}${userMessage}` },
  ];

  let respuestaFinal = "No pude generar una respuesta.";

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      max_tokens: 1000,
      temperature: 0,
    });

    const msg = response.choices[0]?.message;
    if (!msg) break;

    if (msg.tool_calls?.length) {
      messages.push(msg);
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        let resultado: { data?: unknown[]; error?: string };
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          resultado = await consultarTabla(args);
        } catch (e) {
          resultado = { error: String(e) };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(resultado).slice(0, 12000),
        });
      }
      continue;
    }

    respuestaFinal = msg.content?.trim() ?? respuestaFinal;
    break;
  }

  if (respuestaFinal.includes(SIN_DATOS)) {
    await guardarPreguntaSinRespuesta({ telefono, pregunta: userMessage, respuesta: respuestaFinal }).catch((e) =>
      console.error("[guardarPreguntaSinRespuesta]", e)
    );
    return respuestaFinal.split(SIN_DATOS).join("").replace(/[ \t]{2,}/g, " ").trim();
  }

  return respuestaFinal;
}
