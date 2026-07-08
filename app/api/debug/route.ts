import { NextRequest, NextResponse } from "next/server";
import { buildResumenContexto, consultarTabla, getSupabaseClient } from "@/app/lib/supabase";
import { getVitalbaqAnswer } from "@/app/lib/ai-vitalbaq";
import { TABLAS } from "@/app/lib/db-schema";
import { construirCierreCaja, hoyBogota } from "@/app/lib/cierre-caja";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const pregunta = request.nextUrl.searchParams.get("pregunta");
  if (pregunta) {
    const respuesta = await getVitalbaqAnswer(pregunta);
    return NextResponse.json({ pregunta, respuesta });
  }

  // Vista previa del informe de cierre de caja — arma el mismo mensaje que
  // el cron envía por WhatsApp, pero SIN enviarlo (solo lectura).
  const previewCierre = request.nextUrl.searchParams.get("cierreCaja");
  if (previewCierre) {
    const fecha = request.nextUrl.searchParams.get("fecha") || hoyBogota();
    const sb = getSupabaseClient();
    const { mensaje, resumen } = await construirCierreCaja(sb, fecha);
    return NextResponse.json({ fecha, mensaje, resumen });
  }

  const envCheck = {
    WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_ID: !!process.env.WHATSAPP_PHONE_ID,
    WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    WHATSAPP_NOTIFY_PHONES: !!process.env.WHATSAPP_NOTIFY_PHONES,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, env: envCheck, error: "SUPABASE_SERVICE_ROLE_KEY no configurada" }, { status: 500 });
  }

  try {
    const catalogo = await buildResumenContexto();

    const sb = getSupabaseClient();
    const { error: logError } = await sb.from("preguntas_sin_respuesta").select("id").limit(1);

    const tablaPrueba = await consultarTabla({ tabla: "empleados", limite: 1 });

    return NextResponse.json({
      ok: true,
      env: envCheck,
      tablas: Object.keys(TABLAS),
      catalogo,
      consultaPrueba: tablaPrueba,
      tablaPreguntasSinRespuesta: logError ? `ERROR: ${logError.message}` : "ok",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, env: envCheck, error: String(e) }, { status: 500 });
  }
}
