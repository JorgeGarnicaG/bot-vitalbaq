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
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  await postMeta(to, { type: "text", text: { body } });
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
      language: { code: "es" },
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
