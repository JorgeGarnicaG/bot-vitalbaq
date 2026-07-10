import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import { sendWhatsAppMessage, notificarFalloAdmin, ADMIN_PHONE } from "@/app/lib/whatsapp";
import { construirCierreCaja, hoyBogota } from "@/app/lib/cierre-caja";
import { registrarEnvio } from "@/app/lib/envios-log";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const DESTINATARIOS = [
  "573013379407", // Andrés (dueño VitalBAQ)
  "573214650092", // Jorge (Zelia)
];

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const hoy = hoyBogota();

  const { mensaje, resumen } = await construirCierreCaja(sb, hoy);

  // Enviar a cada destinatario de forma independiente: si uno falla,
  // los demás igual reciben el informe.
  const fallidos: string[] = [];
  for (const numero of DESTINATARIOS) {
    try {
      await sendWhatsAppMessage(numero, mensaje);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: numero, ok: true });
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      fallidos.push(numero);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: numero, ok: false, error: detalle });
      console.error(`[cierre-caja] envío fallido a ${numero}:`, detalle);
      if (numero !== ADMIN_PHONE) {
        await notificarFalloAdmin(`Cierre de caja: falló el envío a ${numero}`, detalle);
      }
    }
  }

  if (fallidos.length === DESTINATARIOS.length) {
    return NextResponse.json({ ok: false, fecha: hoy, fallidos }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    enviado_a: DESTINATARIOS.filter((n) => !fallidos.includes(n)),
    fallidos,
    resumen,
  });
}
