import { NextRequest, NextResponse } from "next/server";
import { verifyMetaWebhook, sendWhatsAppMessage, notificarFalloAdmin, ADMIN_PHONE } from "@/app/lib/whatsapp";
import { getVitalbaqAnswer } from "@/app/lib/ai-vitalbaq";
import { getSupabaseClient } from "@/app/lib/supabase";
import { registrarEnvio } from "@/app/lib/envios-log";
import { construirCierreCaja, hoyBogota } from "@/app/lib/cierre-caja";

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

    // entry[0].id = ID de la cuenta de WhatsApp Business (WABA) dueña del
    // número — útil para diagnósticos de plantillas/cuenta.
    console.log("[webhook] WABA:", payload?.entry?.[0]?.id);

    const value = payload?.entry?.[0]?.changes?.[0]?.value;

    // Meta reporta aquí los mensajes que NO se pudieron entregar (p. ej.
    // error 131047, fuera de la ventana de 24 h). Registrarlos para que los
    // fallos de entrega no pasen en silencio.
    const statusFallido = (value?.statuses ?? []).find(
      (s: { status?: string }) => s.status === "failed"
    );
    if (statusFallido) {
      const detalle = (statusFallido.errors ?? [])
        .map((e: { code?: number; title?: string }) => `${e.code}: ${e.title}`)
        .join(" | ");
      console.error("[webhook status failed]", statusFallido.recipient_id, detalle);
      await registrarEnvio(getSupabaseClient(), {
        tipo: "webhook-status",
        destinatario: statusFallido.recipient_id,
        ok: false,
        error: detalle || "failed sin detalle",
      });
      // Anti-bucle: si lo que no se entregó fue un mensaje al propio admin,
      // no intentar alertarlo por el mismo canal que acaba de fallar.
      if (statusFallido.recipient_id !== ADMIN_PHONE) {
        await notificarFalloAdmin(
          `WhatsApp no entregó un mensaje a ${statusFallido.recipient_id}`,
          detalle || "failed sin detalle"
        );
      }
    }

    const message = value?.messages?.[0];
    if (!message) return new NextResponse(null, { status: 200 });

    const from = message.from as string;
    // message.button = clic en un botón de respuesta rápida de una plantilla
    const body = (message.text?.body ?? message.button?.text ?? "").trim();

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

    // Respuesta a la plantilla del informe diario (botón "Ver informe
    // completo" o la palabra VER): enviar el detalle completo.
    if (body.toUpperCase() === "VER" || body.toUpperCase() === "VER INFORME COMPLETO") {
      const { mensaje } = await construirCierreCaja(getSupabaseClient(), hoyBogota());
      await sendWhatsAppMessage(from, mensaje);
      return new NextResponse(null, { status: 200 });
    }

    if (body.toUpperCase() === "AYUDA" || body.toUpperCase() === "HELP") {
      await sendWhatsAppMessage(
        from,
        "🏭 *VitalBAQ — Asistente Empresarial*\n\n" +
        "Puedes preguntarme sobre:\n\n" +
        "👥 *Nómina*\n" +
        "• Empleados, cargos, salarios, contratos\n" +
        "• Novedades (ingresos/deducciones) por mes\n" +
        "• Incapacidades y liquidaciones\n" +
        "• Personal EFISERVICIOS / WORK\n\n" +
        "🛒 *Compras y Pedidos*\n" +
        "• Órdenes de compra y su estado\n" +
        "• Remisiones y recepción de mercancía\n\n" +
        "📦 *Inventario*\n" +
        "• Stock por producto y por bodega\n" +
        "• Transferencias entre bodegas\n\n" +
        "🤝 *Proveedores*\n" +
        "• Directorio y contactos\n" +
        "• Historial y comparativo de precios\n\n" +
        "⚙️ *Activos y Mantenimiento*\n" +
        "• Equipos, estado y responsables\n" +
        "• Historial y solicitudes de mantenimiento\n\n" +
        "🔄 *Rotación de Personal*\n" +
        "• Turnos y horarios\n" +
        "• Historial de rotaciones por sede\n\n" +
        "🍽️ *Nutrición*\n" +
        "• Sesiones nutricionales y dietas\n" +
        "• Remisiones por sede y precios\n\n" +
        "Escribe *AYUDA* para ver este menú."
      );
      return new NextResponse(null, { status: 200 });
    }

    try {
      const respuesta = await getVitalbaqAnswer(body, nombre ?? undefined, from);
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
