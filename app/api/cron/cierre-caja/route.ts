import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/app/lib/supabase";
import { sendWhatsAppMessage } from "@/app/lib/whatsapp";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ANDRES_PHONE = "573013379407";

function hoyBogota(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

function fechaLegible(fechaISO: string): string {
  return new Date(`${fechaISO}T12:00:00Z`).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota",
  });
}

function cop(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CO")}`;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sb = getSupabaseClient();
  const hoy = hoyBogota();

  // ── 1. Sesiones nutricionales (cafetería interna) ──────────────────────────
  const { data: sesiones } = await sb
    .from("sesiones_nutricionales")
    .select("tipo_servicio,total_venta,pacientes")
    .eq("fecha", hoy);

  const sesionesHoy = sesiones ?? [];
  const totalVentasSesiones = sesionesHoy.reduce((s, r) => s + (r.total_venta ?? 0), 0);
  const totalPacientes = sesionesHoy.reduce((s, r) => s + (r.pacientes ?? 0), 0);

  // Agrupar por tipo de servicio
  const porTipo: Record<string, { venta: number; pacientes: number }> = {};
  for (const s of sesionesHoy) {
    const t = s.tipo_servicio ?? "Otro";
    if (!porTipo[t]) porTipo[t] = { venta: 0, pacientes: 0 };
    porTipo[t].venta += s.total_venta ?? 0;
    porTipo[t].pacientes += s.pacientes ?? 0;
  }

  // ── 2. Remisiones nutricionales (ventas externas por sede) ─────────────────
  const { data: remisNut } = await sb
    .from("remisiones_nutricionales")
    .select("sede,total_venta")
    .eq("fecha", hoy);

  const remisNutHoy = remisNut ?? [];
  const totalVentasRemisNut = remisNutHoy.reduce((s, r) => s + (r.total_venta ?? 0), 0);

  const porSede: Record<string, number> = {};
  for (const r of remisNutHoy) {
    const sede = r.sede ?? "Sin sede";
    porSede[sede] = (porSede[sede] ?? 0) + (r.total_venta ?? 0);
  }

  // ── 3. Pedidos del día ─────────────────────────────────────────────────────
  const { data: pedidos } = await sb
    .from("pedidos")
    .select("codigo,proveedor_nombre,estado,total,categoria")
    .eq("fecha", hoy);

  const pedidosHoy = pedidos ?? [];
  const totalPedidos = pedidosHoy.reduce((s, p) => s + (p.total ?? 0), 0);

  // ── 4. Remisiones de compra recibidas hoy ─────────────────────────────────
  const { data: remisCompra } = await sb
    .from("remisiones")
    .select("proveedor,valor_remision,valor_factura,estado")
    .eq("fecha", hoy);

  const remisCompraHoy = remisCompra ?? [];
  const totalRemisCompra = remisCompraHoy.reduce(
    (s, r) => s + (r.valor_factura ?? r.valor_remision ?? 0),
    0
  );

  // ── 5. Ventas de Cafetería (BAQ / Adelita) ─────────────────────────────────
  const { data: ventasCafe } = await sb
    .from("ventas_cafeteria")
    .select("total_ref,detalle_ventas_cafeteria(nombre,cantidad,unidad,subtotal),pagos_venta_cafeteria(metodo,monto)")
    .eq("fecha", hoy);

  type DetalleCafeRow = { nombre: string; cantidad: number; unidad: string; subtotal: number };
  type PagoCafeRow = { metodo: string; monto: number };
  type VentaCafeRow = {
    total_ref: number;
    detalle_ventas_cafeteria: DetalleCafeRow[] | null;
    pagos_venta_cafeteria: PagoCafeRow[] | null;
  };

  const ventasCafeHoy = (ventasCafe ?? []) as unknown as VentaCafeRow[];
  const totalVentasCafe = ventasCafeHoy.reduce((s, v) => s + (v.total_ref ?? 0), 0);

  let efectivoCafe = 0;
  let transferenciaCafe = 0;
  const itemsCafeMap: Record<string, { cantidad: number; unidad: string; subtotal: number }> = {};

  for (const v of ventasCafeHoy) {
    for (const p of v.pagos_venta_cafeteria ?? []) {
      if (p.metodo === "efectivo") efectivoCafe += p.monto ?? 0;
      else if (p.metodo === "transferencia") transferenciaCafe += p.monto ?? 0;
    }
    for (const d of v.detalle_ventas_cafeteria ?? []) {
      if (!itemsCafeMap[d.nombre]) itemsCafeMap[d.nombre] = { cantidad: 0, unidad: d.unidad, subtotal: 0 };
      itemsCafeMap[d.nombre].cantidad += Number(d.cantidad ?? 0);
      itemsCafeMap[d.nombre].subtotal += Number(d.subtotal ?? 0);
    }
  }

  const itemsCafeOrdenados = Object.entries(itemsCafeMap).sort((a, b) => b[1].subtotal - a[1].subtotal);

  const lineasCafeItems =
    itemsCafeOrdenados.length > 0
      ? itemsCafeOrdenados
          .map(([nombre, d]) => `  • ${nombre} ×${d.cantidad} ${d.unidad} — ${cop(d.subtotal)}`)
          .join("\n")
      : "  Sin ventas";

  // ── Construir mensaje ──────────────────────────────────────────────────────
  const totalIngresosHoy = totalVentasSesiones + totalVentasRemisNut + totalVentasCafe;

  const lineasTipo =
    Object.entries(porTipo).length > 0
      ? Object.entries(porTipo)
          .map(([tipo, d]) => `  • ${tipo}: ${cop(d.venta)} · ${d.pacientes} pac.`)
          .join("\n")
      : "  Sin registros";

  const lineasSede =
    Object.entries(porSede).length > 0
      ? Object.entries(porSede)
          .map(([sede, venta]) => `  • ${sede}: ${cop(venta)}`)
          .join("\n")
      : "  Sin remisiones";

  const lineasPedidos =
    pedidosHoy.length > 0
      ? pedidosHoy
          .map((p) => `  • ${p.codigo ?? "—"} · ${p.proveedor_nombre ?? "Proveedor"} · ${p.estado}`)
          .join("\n")
      : "  Sin pedidos";

  const lineasRemisCompra =
    remisCompraHoy.length > 0
      ? remisCompraHoy
          .map((r) => `  • ${r.proveedor ?? "Proveedor"} · ${r.estado} · ${cop(r.valor_factura ?? r.valor_remision ?? 0)}`)
          .join("\n")
      : "  Sin remisiones";

  const mensaje = [
    `📊 *CIERRE DE CAJA — VitalBAQ*`,
    `📅 ${fechaLegible(hoy)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `🥗 *CAFETERÍA*`,
    `• Sesiones: ${sesionesHoy.length} · Pacientes: ${totalPacientes}`,
    `• Ventas internas: ${cop(totalVentasSesiones)}`,
    ``,
    `Por servicio:`,
    lineasTipo,
    ``,
    `🏥 *REMISIONES NUTRICIONALES*`,
    `• Ventas externas: ${cop(totalVentasRemisNut)}`,
    lineasSede,
    ``,
    `🧃 *CAFETERÍA BAQ / ADELITA (${ventasCafeHoy.length} ventas)*`,
    lineasCafeItems,
    ventasCafeHoy.length > 0
      ? `• Total: ${cop(totalVentasCafe)} — Efectivo: ${cop(efectivoCafe)} · Transferencia: ${cop(transferenciaCafe)}`
      : "",
    ``,
    `📦 *PEDIDOS DEL DÍA (${pedidosHoy.length})*`,
    lineasPedidos,
    pedidosHoy.length > 0 ? `• Total pedidos: ${cop(totalPedidos)}` : "",
    ``,
    `🚚 *REMISIONES DE COMPRA (${remisCompraHoy.length})*`,
    lineasRemisCompra,
    remisCompraHoy.length > 0 ? `• Total compras: ${cop(totalRemisCompra)}` : "",
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 *RESUMEN EJECUTIVO*`,
    `• Total ingresos: ${cop(totalIngresosHoy)}`,
    `• Total compras:  ${cop(totalRemisCompra)}`,
    `• Balance:        ${cop(totalIngresosHoy - totalRemisCompra)}`,
    ``,
    `_VitalBAQ Bot · Generado automáticamente_`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  await sendWhatsAppMessage(ANDRES_PHONE, mensaje);

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    enviado_a: ANDRES_PHONE,
    resumen: {
      ventas_internas: totalVentasSesiones,
      ventas_externas: totalVentasRemisNut,
      ventas_cafeteria: totalVentasCafe,
      cafeteria_efectivo: efectivoCafe,
      cafeteria_transferencia: transferenciaCafe,
      total_ingresos: totalIngresosHoy,
      total_compras: totalRemisCompra,
      pedidos: pedidosHoy.length,
    },
  });
}
