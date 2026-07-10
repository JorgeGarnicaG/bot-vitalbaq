import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import { sendWhatsAppMessage, notificarFalloAdmin } from "@/app/lib/whatsapp";
import { registrarEnvio } from "@/app/lib/envios-log";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function hoyBogota(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const { data: empleados, error } = await sb
    .from("empleados")
    .select("nombre,cargo,sede,fecha_inicio")
    .eq("estado", "Activo")
    .not("fecha_inicio", "is", null);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const hoy = hoyBogota();
  const cumplen = (empleados ?? []).filter(
    (e) => e.fecha_inicio && addMonths(String(e.fecha_inicio), 10) === hoy
  );

  if (cumplen.length === 0) {
    return NextResponse.json({ ok: true, fecha: hoy, notificados: 0 });
  }

  const lineas = cumplen
    .map((e) => `• *${e.nombre}* — ${e.cargo} (${e.sede ?? "sin sede"})\n  Ingreso: ${e.fecha_inicio} → hoy cumple 10 meses`)
    .join("\n\n");

  const mensaje =
    `📅 *VitalBAQ — Alerta 10 meses de antigüedad*\n\n` +
    `${cumplen.length === 1 ? "El siguiente empleado cumple" : "Los siguientes empleados cumplen"} hoy 10 meses de trabajo:\n\n` +
    lineas;

  const phones = (process.env.WHATSAPP_NOTIFY_PHONES ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  await Promise.all(
    phones.map(async (phone) => {
      try {
        await sendWhatsAppMessage(phone, mensaje);
        await registrarEnvio(sb, { tipo: "empleados-10-meses", destinatario: phone, ok: true });
      } catch (e) {
        const detalle = e instanceof Error ? e.message : String(e);
        await registrarEnvio(sb, { tipo: "empleados-10-meses", destinatario: phone, ok: false, error: detalle });
        console.error(`[empleados-10-meses] envío fallido a ${phone}:`, detalle);
        await notificarFalloAdmin(`Alerta 10 meses: falló el envío a ${phone}`, detalle);
      }
    })
  );

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    notificados: cumplen.length,
    empleados: cumplen.map((e) => e.nombre),
    enviadoA: phones,
  });
}
