import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import { sendWhatsAppMessage } from "@/app/lib/whatsapp";
import { construirCierreCaja, hoyBogota } from "@/app/lib/cierre-caja";

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

  await sendWhatsAppMessage(ANDRES_PHONE, mensaje);

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    enviado_a: ANDRES_PHONE,
    resumen,
  });
}
