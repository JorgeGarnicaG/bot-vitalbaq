import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import { sendWhatsAppMessage } from "@/app/lib/whatsapp";
import { construirCierreCaja, hoyBogota } from "@/app/lib/cierre-caja";
import { registrarEnvio } from "@/app/lib/envios-log";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ANDRES_PHONE = "573013379407";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const hoy = hoyBogota();

  const { mensaje, resumen } = await construirCierreCaja(sb, hoy);

  try {
    await sendWhatsAppMessage(ANDRES_PHONE, mensaje);
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: false, error: detalle });
    console.error("[cierre-caja] envío fallido:", detalle);
    return NextResponse.json({ ok: false, fecha: hoy, error: detalle }, { status: 500 });
  }

  await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: true });

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    enviado_a: ANDRES_PHONE,
    resumen,
  });
}
