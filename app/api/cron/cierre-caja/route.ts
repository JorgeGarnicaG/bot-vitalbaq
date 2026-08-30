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
// plantilla aprobada por Meta — esas se entregan siempre — con el cierre de
// caja de las dos cafeterías ya incluido. Si responde algo, se abre la
// ventana de 24h y el bot puede seguir la conversación con más detalle
// (vía el flujo normal del webhook, sin necesitar un botón en la plantilla).
const PLANTILLA_CIERRE = "cierre_caja_vitalbaq";

/**
 * Quién recibe la plantilla oficial (no el texto libre). Además de Andrés
 * (cliente, destinatario original), Jorge (admin) la recibe también como
 * sonda de monitoreo: si a Jorge le llega, el cron sí disparó y el envío
 * de plantilla en sí funciona — permite comparar en vivo contra lo que le
 * llega a Andrés sin depender de logs. WHATSAPP_TEMPLATE_RECIPIENTS permite
 * sumar más números sin tocar código (opcional).
 */
function destinatariosPlantilla(): string[] {
  const extra = (process.env.WHATSAPP_TEMPLATE_RECIPIENTS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return Array.from(new Set([ANDRES_PHONE, ADMIN_PHONE, ...extra]));
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const hoy = hoyBogota();

  const { mensaje, resumen, cierresParaPlantilla } = await construirCierreCaja(sb, hoy);
  const resultados: Record<string, string> = {};

  // Los 6 parámetros deben coincidir 1 a 1 con las variables {{1}}..{{6}} de
  // la plantilla "cierre_caja_vitalbaq" aprobada en Meta: fecha, nombre y
  // estado de la cafetería 1, nombre y estado de la cafetería 2, total del día.
  const [cafe1, cafe2] = cierresParaPlantilla;
  const parametrosPlantilla = [
    fechaLegible(hoy),
    cafe1?.nombre ?? "—",
    cafe1?.estado ?? "⚠️ Sin datos",
    cafe2?.nombre ?? "—",
    cafe2?.estado ?? "⚠️ Sin datos",
    cop(resumen.total_cierres_caja),
  ];

  // ── Plantilla oficial: entrega garantizada sin ventana de 24 h ─────────────
  for (const phone of destinatariosPlantilla()) {
    try {
      await sendWhatsAppTemplate(phone, PLANTILLA_CIERRE, parametrosPlantilla);
      await registrarEnvio(sb, { tipo: "cierre-caja-plantilla", destinatario: phone, ok: true });
      resultados[phone] = "plantilla enviada";
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      await registrarEnvio(sb, { tipo: "cierre-caja-plantilla", destinatario: phone, ok: false, error: detalle });
      console.error(`[cierre-caja] plantilla fallida para ${phone}:`, detalle);
      resultados[phone] = "plantilla falló";

      if (phone === ANDRES_PHONE) {
        // Respaldo mientras la plantilla no exista o no esté aprobada: intentar
        // texto libre (solo llega si la ventana de 24 h está abierta).
        try {
          await sendWhatsAppMessage(ANDRES_PHONE, mensaje);
          await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: true });
          resultados[ANDRES_PHONE] = "plantilla falló; texto libre enviado";
        } catch (e2) {
          const detalle2 = e2 instanceof Error ? e2.message : String(e2);
          await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: ANDRES_PHONE, ok: false, error: detalle2 });
          resultados[ANDRES_PHONE] = "falló";
        }
      }

      // Anti-ruido: si a quien le falló la plantilla fue al propio admin, no
      // tiene sentido alertarlo por WhatsApp de que su propio WhatsApp falló.
      if (phone !== ADMIN_PHONE) {
        await notificarFalloAdmin(
          `Cierre de caja: la plantilla "${PLANTILLA_CIERRE}" falló para ${phone}` +
            (phone === ANDRES_PHONE ? " (Andrés) — ¿ya está creada y aprobada en Meta?" : ""),
          detalle
        );
      }
    }
  }

  // ── Informe completo (texto libre) — solo para Jorge, como respaldo ────────
  // La plantilla "cierre_caja_vitalbaq" ya le manda a Andrés el cierre de
  // caja completo de las dos cafeterías, así que no hace falta duplicárselo
  // por texto libre (que además fallaría casi siempre por la ventana de 24h,
  // ya que él no le escribe seguido al bot). Si Andrés responde algo al
  // mensaje, se abre esa ventana y el webhook puede seguirle respondiendo
  // con más detalle de forma normal.
  for (const phone of [ADMIN_PHONE]) {
    try {
      await sendWhatsAppMessage(phone, mensaje);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: phone, ok: true });
      resultados[phone] = `${resultados[phone]}; informe completo enviado`;
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      await registrarEnvio(sb, { tipo: "cierre-caja", destinatario: phone, ok: false, error: detalle });
      console.error(`[cierre-caja] envío fallido a ${phone}:`, detalle);
      resultados[phone] = `${resultados[phone]}; informe completo falló (ventana 24h cerrada)`;
    }
  }

  const huboExito = Object.values(resultados).some((r) => r.includes("enviad"));
  return NextResponse.json(
    { ok: huboExito, fecha: hoy, resultados, resumen },
    { status: huboExito ? 200 : 500 }
  );
}
