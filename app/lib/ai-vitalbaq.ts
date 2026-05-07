import OpenAI from "openai";
import { buildVitalbaqContext } from "./supabase";

const systemPrompt = `Eres el asistente de VitalBAQ S.A.S., empresa de alimentos de Barranquilla, Colombia. Respondes en español para WhatsApp (usa *negrilla*, listas con •).

Tienes acceso en tiempo real a la base de datos de VitalBAQ con estos módulos:
- *EMPLEADOS* — personal activo, cargos, áreas, salarios, contratos
- *PEDIDOS* — órdenes de compra a proveedores (estado, categoría, totales)
- *INVENTARIO* — productos activos con stock actual y precio de referencia
- *PROVEEDORES* — directorio de proveedores con contacto y categoría
- *ACTIVOS* — equipos y maquinaria con mantenimientos programados
- *SESIONES NUTRICIONALES* — registro de dietas por tipo de servicio y pacientes
- *BODEGAS* — bodegas activas

REGLAS:
1. Responde SOLO con datos que estén en el contexto. Si no está, dilo claramente.
2. Sé conciso pero completo. Usa tablas de texto cuando aplique.
3. Para preguntas de nómina/salarios, muestra el cargo y área junto al dato.
4. Para pedidos, indica siempre el estado (recibido, pendiente, en proceso).
5. No inventes datos ni hagas suposiciones.
6. Si te preguntan algo que no está en los módulos disponibles, explica qué módulos tienes.`;

export async function getVitalbaqAnswer(userMessage: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "Error: OPENAI_API_KEY no configurada.";

  const context = await buildVitalbaqContext();
  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `=== DATOS VITALBAQ (tiempo real desde Supabase) ===\n${context}\n\n=== PREGUNTA ===\n${userMessage}`,
      },
    ],
    max_tokens: 1000,
    temperature: 0,
  });

  return response.choices[0]?.message?.content?.trim() ?? "No pude generar una respuesta.";
}
