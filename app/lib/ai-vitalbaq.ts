import Anthropic from "@anthropic-ai/sdk";
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
10. "Vencimientos de contratos" = columna fecha_fin en tabla empleados. Consulta todos los empleados con fecha_fin no nula y ordénalos por fecha_fin ascendente.
11. Si después de consultar las tablas relevantes la información solicitada NO existe en la base de datos, responde EMPEZANDO EXACTAMENTE con "${SIN_DATOS}" seguido de una explicación breve. No uses esa etiqueta en ningún otro caso.`;

const tool: Anthropic.Tool = {
  name: "consultar_tabla",
  description: "Consulta filas de una tabla de la base de datos de VitalBAQ, con filtros, orden y límite opcionales.",
  input_schema: {
    type: "object" as const,
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
};

const MAX_ITERACIONES = 6;

export async function getVitalbaqAnswer(userMessage: string, nombre?: string, telefono?: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "Error: ANTHROPIC_API_KEY no configurada.";

  const catalogo = await buildResumenContexto();
  const client = new Anthropic({ apiKey });

  const userContext = nombre
    ? `El usuario que pregunta se llama ${nombre}. Dirígete a él por su nombre cuando sea natural.\n\n`
    : "";

  // Bloque fijo (cacheable) separado del catálogo dinámico (cambia con los datos).
  // Así las instrucciones base no se refacturan completas en cada iteración del loop
  // de herramientas ni en cada conversación nueva.
  const systemPrompt: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPromptBase, cache_control: { type: "ephemeral" } },
    { type: "text", text: `=== TABLAS DISPONIBLES (filas actuales y columnas conocidas) ===\n${catalogo}` },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `${userContext}${userMessage}` },
  ];

  let respuestaFinal = "No pude generar una respuesta.";

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      thinking: { type: "disabled" },
      system: systemPrompt,
      tools: [tool],
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        let resultado: { data?: unknown[]; error?: string };
        try {
          resultado = await consultarTabla(block.input as Parameters<typeof consultarTabla>[0]);
        } catch (e) {
          resultado = { error: String(e) };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(resultado).slice(0, 12000),
        });
      }

      messages.push({ role: "user", content: toolResults });
      continue;
    }

    for (const block of response.content) {
      if (block.type === "text") {
        respuestaFinal = block.text.trim();
        break;
      }
    }
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
