import { NextRequest, NextResponse } from "next/server";
import { verifyMetaWebhook, sendWhatsAppMessage } from "@/app/lib/whatsapp";
import { getVitalbaqAnswer } from "@/app/lib/ai-vitalbaq";

export const maxDuration = 60;

const NOMBRES: Record<string, string> = {
  "573013379407": "Andrés",
};

const SALUDOS = ["hola", "hi", "buenos", "buenas", "buen", "hey", "hello", "ola"];

function isAllowed(from: string): boolean {
  const raw = process.env.WHATSAPP_ALLOWED_PHONES?.trim();
  if (!raw) return true;
  const allowed = raw.split(",").map((p) => p.trim().replace(/^\+/, ""));
  return allowed.includes(from.replace(/^\+/, ""));
}

function getNombre(from: string): string | null {
  return NOMBRES[from.replace(/^\+/, "")] ?? null;
}

function esSaludo(body: string): boolean {
  const lower = body.toLowerCase().trim();
  return SALUDOS.some((s) => lower.startsWith(s));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = verifyMetaWebhook(
    searchParams.get("hub.mode"),
    searchParams.get("hub.verify_token"),
    searchParams.get("hub.challenge")
  );
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new NextResponse(null, { status: 200 });

    const from = message.from as string;
    const body = (message.text?.body ?? "").trim();

    if (!from || !body) return new NextResponse(null, { status: 200 });

    if (!isAllowed(from)) {
      await sendWhatsAppMessage(from, "No tienes acceso al asistente de VitalBAQ.");
      return new NextResponse(null, { status: 200 });
    }

    const nombre = getNombre(from);

    if (esSaludo(body)) {
      const saludo = nombre ? `¡Hola ${nombre}!` : "¡Hola!";
      await sendWhatsAppMessage(
        from,
        `${saludo} 👋 Soy el asistente de *VitalBAQ*.\n\n` +
        "Puedes preguntarme sobre empleados, pedidos, inventario, proveedores, activos o sesiones nutricionales.\n\n" +
        "Escribe *AYUDA* para ver todo lo que puedo hacer."
      );
      return new NextResponse(null, { status: 200 });
    }

    if (body.toUpperCase() === "AYUDA" || body.toUpperCase() === "HELP") {
      await sendWhatsAppMessage(
        from,
        "🏭 *VitalBAQ — Asistente Empresarial*\n\n" +
        "Puedes preguntarme sobre:\n\n" +
        "• 👥 Empleados y nómina\n" +
        "• 📦 Pedidos a proveedores\n" +
        "• 🏪 Inventario y stock\n" +
        "• 🤝 Proveedores\n" +
        "• ⚙️ Activos y equipos\n" +
        "• 🍽️ Sesiones nutricionales\n\n" +
        "Escribe *AYUDA* para ver este menú."
      );
      return new NextResponse(null, { status: 200 });
    }

    try {
      const respuesta = await getVitalbaqAnswer(body, nombre ?? undefined);
      await sendWhatsAppMessage(from, respuesta);
    } catch (e) {
      console.error("[VitalBAQ webhook IA]", e);
      await sendWhatsAppMessage(from, "Hubo un error al consultar los datos. Intenta de nuevo.");
    }

    return new NextResponse(null, { status: 200 });
  } catch (e) {
    console.error("[VitalBAQ webhook]", e);
    return NextResponse.json({ error: "Error en webhook" }, { status: 500 });
  }
}
