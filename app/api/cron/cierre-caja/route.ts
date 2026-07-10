import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import {
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  notificarFalloAdmin,
  ADMIN_PHONE,
} from "@/app/lib/whatsapp";
import { construirCierreCaja, hoyBogota, fechaLegible, cop } from "@/app/lib/cierre-caja";
import { registrarEnvio } from "@/app/lib/envios-log";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ANDRES_PHONE = "573013379407";

// Andrés casi nunca le escribe al bot, así que el texto libre se pierde por
// la ventana de 24 h de WhatsApp (error 131047). A él se le envía una
// plantilla aprobada por Meta — esas se entregan siempre — con el resumen
// de toda la operación; si responde VER, el webhook le manda el detalle.
const PLANTILLA_CIERRE = "informe_diario_vitalbaq";

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const hoy = hoyBogota();

  const { mensaje, resumen } = await construirCierreCaja(sb, hoy);
  const resultados: Record<string, string> = {};

  // ── Andrés: plantilla (entrega garantizada sin ventana de 24 h) ────────────
  try {
    // Los 12 parámetros deben coincidir 1 a 1 con las variables {{1}}..{{12}}
    // de la plantilla aprobada en Meta.
    await sendWhatsAppTemplate(ANDRES_PHONE, PLANTILLA_CIERRE, [
      fechaLegible(hoy),
      String(resumen.sesiones),
      String(resumen.pacientes),
      cop(resumen.ventas_internas),
      cop(resumen.ventas_externas),
      String(resumen.ventas_cafeteria_num),
      cop(resumen.ventas_cafeteria),
      String(resumen.pedidos),
      cop(resumen.pedidos_valor),
      cop(resumen.total_compras),
      cop(resumen.total_ingresos),
      cop(resumen.total_ingresos - resumen.total_compras),
    ]);
    await registrarEnvio(sb, { tipo: "cierre-caja-plantilla", destinatario: ANDRES_PHONE, ok: true });
    resultados[ANDRES_PHONE] = "plantilla enviada";
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    await registrarEnvio(sb, { tipo: "cierre-caja-plantilla", destinatario: ANDRES_PHONE, ok: false, error: detalle });
    console.error("[cierre-caja] plantilla fallida:", detalle);

    // Respaldo mientras la plantilla no exista o no esté aprobada: intentar
    // texto libre (solo llega si la ventana de 24 h está abierta).
    try {
      await sendWhatsAppMessage(ANDRES_PHONE, mensaje);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: true });
      resultados[ANDRES_PHONE] = "texto libre (plantilla falló)";
    } catch (e2) {
      const detalle2 = e2 instanceof Error ? e2.message : String(e2);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: false, error: detalle2 });
      resultados[ANDRES_PHONE] = "falló";
    }
    await notificarFalloAdmin(
      `Cierre de caja: la plantilla "${PLANTILLA_CIERRE}" falló para Andrés (¿ya está creada y aprobada en Meta?)`,
      detalle
    );
  }

  // ── Jorge (admin): informe completo en texto libre ─────────────────────────
  try {
    await sendWhatsAppMessage(ADMIN_PHONE, mensaje);
    await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ADMIN_PHONE, ok: true });
    resultados[ADMIN_PHONE] = "informe completo enviado";
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ADMIN_PHONE, ok: false, error: detalle });
    console.error(`[cierre-caja] envío fallido a ${ADMIN_PHONE}:`, detalle);
    resultados[ADMIN_PHONE] = "falló";
  }

  const todoFallo = Object.values(resultados).every((r) => r === "falló");
  return NextResponse.json(
    { ok: !todoFallo, fecha: hoy, resultados, resumen },
    { status: todoFallo ? 500 : 200 }
  );
}
