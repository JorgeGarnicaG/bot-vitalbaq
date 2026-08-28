import { SupabaseClient } from "@supabase/supabase-js";

export function hoyBogota(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
}

export function fechaLegible(fechaISO: string): string {
  return new Date(`${fechaISO}T12:00:00Z`).toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Bogota",
  });
}

export function cop(valor: number): string {
  return `$${Math.round(valor).toLocaleString("es-CO")}`;
}

type DetalleCafeRow = { nombre: string; cantidad: number; unidad: string; subtotal: number };
type PagoCafeRow = { metodo: string; monto: number };
type VentaCafeRow = {
  total_ref: number;
  detalle_ventas_cafeteria: DetalleCafeRow[] | null;
  pagos_venta_cafeteria: PagoCafeRow[] | null;
};

type CierreCafeteriaRow = {
  total_ventas: number;
  total_ref: number;
  efectivo_esperado: number;
  transferencia_esperada: number;
  efectivo_contado: number;
  sobrante_faltante: number;
  estado: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function construirCierreCaja(sb: SupabaseClient<any, any, any>, hoy: string) {
  // ── 1. Sesiones nutricionales (cafetería interna) ──────────────────────────
  const { data: sesiones } = await sb
    .from("sesiones_nutricionales")
    .select("tipo_servicio,total_venta,pacientes")
    .eq("fecha", hoy);

  const sesionesHoy = sesiones ?? [];
  const totalVentasSesiones = sesionesHoy.reduce((s, r) => s + (r.total_venta ?? 0), 0);
  const totalPacientes = sesionesHoy.reduce((s, r) => s + (r.pacientes ?? 0), 0);

  // ── 2. Remisiones nutricionales (ventas externas por sede) ─────────────────
  const { data: remisNut } = await sb
    .from("remisiones_nutricionales")
    .select("sede,total_venta")
    .eq("fecha", hoy);

  const remisNutHoy = remisNut ?? [];
  const totalVentasRemisNut = remisNutHoy.reduce((s, r) => s + (r.total_venta ?? 0), 0);

  // ── 3. Pedidos del día ─────────────────────────────────────────────────────
  const { data: pedidos } = await sb
    .from("pedidos")
    .select("codigo,proveedor_nombre,estado,total,categoria")
    .eq("fecha", hoy);

  const pedidosHoy = pedidos ?? [];
  const totalPedidos = pedidosHoy.reduce((s, p) => s + (p.total ?? 0), 0);

  // ── 4. Remisiones de compra recibidas hoy ─────────────────────────────────
  // NOTA: la tabla "remisiones" (compras) está definida en el schema.prisma
  // del backend pero nunca se migró a la base real — no existe en producción
  // todavía. Hasta que se cree, esta sección queda en $0 sin consultar nada.
  const totalRemisCompra = 0;

  // ── 4b. Cierres de caja por cafetería (el foco del informe) ────────────────
  const { data: bodegasCafe } = await sb
    .from("bodegas")
    .select("id,nombre")
    .ilike("nombre", "%cafeter%")
    .eq("activa", true)
    .order("nombre");

  const cierresPorBodega = await Promise.all(
    (bodegasCafe ?? []).map(async (b) => {
      const { data: cierre } = await sb
        .from("cierres_cafeteria")
        .select("total_ventas,total_ref,efectivo_esperado,transferencia_esperada,efectivo_contado,sobrante_faltante,estado")
        .eq("bodega_id", b.id)
        .eq("fecha", hoy)
        .maybeSingle();
      return { nombre: b.nombre as string, cierre: cierre as CierreCafeteriaRow | null };
    })
  );

  // ── 5. Ventas de Cafetería (BAQ / Adelita) ─────────────────────────────────
  const { data: ventasCafe } = await sb
    .from("ventas_cafeteria")
    .select("total_ref,detalle_ventas_cafeteria(nombre,cantidad,unidad,subtotal),pagos_venta_cafeteria(metodo,monto)")
    .eq("fecha", hoy);

  const ventasCafeHoy = (ventasCafe ?? []) as unknown as VentaCafeRow[];
  const totalVentasCafe = ventasCafeHoy.reduce((s, v) => s + (v.total_ref ?? 0), 0);

  let efectivoCafe = 0;
  let transferenciaCafe = 0;
  for (const v of ventasCafeHoy) {
    for (const p of v.pagos_venta_cafeteria ?? []) {
      if (p.metodo === "efectivo") efectivoCafe += p.monto ?? 0;
      else if (p.metodo === "transferencia") transferenciaCafe += p.monto ?? 0;
    }
  }

  // ── Construir mensaje ──────────────────────────────────────────────────────
  const totalIngresosHoy = totalVentasSesiones + totalVentasRemisNut + totalVentasCafe;

  // ── Líneas por cafetería: cerrada (con números) o alerta de no-cierre ──────
  const lineasCierres = cierresPorBodega.flatMap(({ nombre, cierre }) => {
    if (!cierre) {
      return [`🏪 *${nombre}*`, `⚠️ *No se cerró la caja hoy*`, ``];
    }
    const cuadrada = Math.round(cierre.sobrante_faltante) === 0;
    return [
      `🏪 *${nombre}*`,
      cuadrada ? `✅ Caja cerrada — cuadrada` : `⚠️ Caja cerrada — descuadre de ${cop(cierre.sobrante_faltante)}`,
      `• Ventas: ${cierre.total_ventas} · Total: ${cop(cierre.total_ref)}`,
      `• Efectivo: ${cop(cierre.efectivo_esperado)} · Transferencia: ${cop(cierre.transferencia_esperada)}`,
      ``,
    ];
  });

  const totalCierresHoy = cierresPorBodega.reduce((s, c) => s + (c.cierre?.total_ref ?? 0), 0);

  const mensaje = [
    `💰 *CIERRE DE CAJA — VitalBAQ*`,
    `📅 ${fechaLegible(hoy)}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    ...lineasCierres,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 Total ingresos del día: ${cop(totalCierresHoy)}`,
    ``,
    `_VitalBAQ Bot · Generado automáticamente_`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  return {
    mensaje,
    resumen: {
      sesiones: sesionesHoy.length,
      pacientes: totalPacientes,
      ventas_internas: totalVentasSesiones,
      ventas_externas: totalVentasRemisNut,
      ventas_cafeteria_num: ventasCafeHoy.length,
      ventas_cafeteria: totalVentasCafe,
      cafeteria_efectivo: efectivoCafe,
      cafeteria_transferencia: transferenciaCafe,
      total_ingresos: totalIngresosHoy,
      total_compras: totalRemisCompra,
      pedidos: pedidosHoy.length,
      pedidos_valor: totalPedidos,
    },
  };
}
