const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN;

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const TOKEN    = process.env.WHATSAPP_TOKEN;
  const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
  if (!TOKEN || !PHONE_ID) throw new Error("Meta WhatsApp no configurado");

  const number = to.replace(/^whatsapp:/, "").replace(/^\+/, "").replace(/\s/g, "");

  const res = await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: number,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Meta API error: ${JSON.stringify(err)}`);
  }
}

export function verifyMetaWebhook(
  mode: string | null,
  token: string | null,
  challenge: string | null
): string | null {
  if (mode === "subscribe" && token === VERIFY) return challenge;
  return null;
}
