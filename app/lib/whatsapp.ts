const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;

/** Jorge (Zelia) — recibe las alertas cuando algo falla en el bot. */
export const ADMIN_PHONE = "573214650092";

/**
 * Avisa al admin por WhatsApp que algo falló. Nunca lanza: si la alerta
 * misma no se puede enviar, solo queda en console.error.
 */
export async function notificarFalloAdmin(contexto: string, detalle: string): Promise<void> {
  try {
    await sendWhatsAppMessage(
      ADMIN_PHONE,
      `⚠️ *VitalBAQ Bot — Fallo detectado*\n\n📍 ${contexto}\n\n\`\`\`${detalle.slice(0, 500)}\`\`\``
    );
  } catch (e) {
    console.error("[alerta admin] no se pudo notificar el fallo:", e);
  }
}

async function postMeta(to: string, payload: Record<string, unknown>): Promise<void> {
  // .trim() + limpieza de "\n" literal: el token pegado en Vercel puede traer
  // saltos de línea al final y Meta lo rechaza como "Malformed access token".
  const TOKEN    = process.env.WHATSAPP_TOKEN?.replace(/\\n/g, "").trim();
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID?.replace(/\\n/g, "").trim();
  if (!TOKEN || !PHONE_ID) throw new Error("Meta WhatsApp no configurado");

  const number = to.replace(/^whatsapp:/, "").replace(/^\+/, "").replace(/\s/g, "");

  const res = await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to: number, ...payload }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API error: ${JSON.stringify(err)}`);
  }
  // OJO: res.ok=200 aquí solo significa que Meta ACEPTÓ el mensaje para
  // procesarlo (te da un wamid). NO significa que ya le llegó al destinatario.
  // La entrega real (sent/delivered/read/failed) llega después, async, por
  // el webhook de status — incl. el caso típico de "failed 131047" cuando la
  // ventana de 24 h se cerró después de que este POST ya había devuelto 200.
  // Cualquier "enviado" en resultados/logs de los crons refleja este punto,
  // no la entrega final.
}

// Meta rechaza cualquier texto libre de más de 4096 caracteres con
// "Param text.body must be at most 4096 characters long." (code 100). El
// informe de cierre de caja completo (o el comando VER) puede superar ese
// límite en días con mucha actividad, así que se parte en varios mensajes
// en vez de fallar en silencio.
const WHATSAPP_MAX_BODY = 4096;

function splitForWhatsApp(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const partes: string[] = [];
  let restante = text;
  while (restante.length > maxLen) {
    let corte = restante.lastIndexOf("\n", maxLen);
    if (corte <= 0) corte = maxLen; // sin salto de línea cerca: corte duro
    partes.push(restante.slice(0, corte));
    restante = restante.slice(corte).replace(/^\n+/, "");
  }
  if (restante) partes.push(restante);
  return partes;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  // Reservar espacio para el prefijo "Parte X/Y" cuando haga falta partir.
  const partes = splitForWhatsApp(body, WHATSAPP_MAX_BODY - 20);
  for (let i = 0; i < partes.length; i++) {
    const texto = partes.length > 1 ? `_(Parte ${i + 1}/${partes.length})_\n\n${partes[i]}` : partes[i];
    await postMeta(to, { type: "text", text: { body: texto } });
  }
}

/**
 * Envía una plantilla aprobada por Meta. A diferencia del texto libre,
 * las plantillas se entregan SIN necesidad de que el destinatario haya
 * escrito al bot en las últimas 24 h (evita el error 131047).
 */
export async function sendWhatsAppTemplate(
  to: string,
  nombre: string,
  parametros: string[]
): Promise<void> {
  await postMeta(to, {
    type: "template",
    template: {
      name: nombre,
      // Debe coincidir con el idioma elegido al crear la plantilla en Meta:
      // "Spanish (COL)" = es_CO
      language: { code: "es_CO" },
      components: [
        {
          type: "body",
          parameters: parametros.map((text) => ({ type: "text", text })),
        },
      ],
    },
  });
}

export function verifyMetaWebhook(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  if (mode === "subscribe" && token === VERIFY) return challenge;
  return null;
}
