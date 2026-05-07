import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukbejxfvhhftpwugoxqb.supabase.co";

export function getSupabaseClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(SUPABASE_URL, key);
}

function toLines(rows: Record<string, unknown>[] | null): string {
  if (!rows?.length) return "(sin datos)";
  return rows.map(r => Object.entries(r).map(([k, v]) => `${k}:${v}`).join(" | ")).join("\n");
}

export async function buildVitalbaqContext(): Promise<string> {
  const sb = getSupabaseClient();

  const [
    { data: empleados },
    { data: pedidos },
    { data: items },
    { data: proveedores },
    { data: activos },
    { data: sesiones },
    { data: bodegas },
  ] = await Promise.all([
    sb.from("empleados").select("nombre,cargo,area,salario,tipo_contrato,estado").eq("estado", "Activo").limit(100),
    sb.from("pedidos").select("codigo,proveedor_nombre,categoria,fecha,estado,total").order("fecha", { ascending: false }).limit(30),
    sb.from("items").select("nombre,categoria,unidad,stock_actual,precio_ref").eq("activo", true).limit(100),
    sb.from("proveedores").select("nombre,nit,contacto,whatsapp,estado").limit(50),
    sb.from("activos").select("codigo,nombre,ubicacion,estado,prox_mant").limit(50),
    sb.from("sesiones_nutricionales").select("fecha,tipo_servicio,pacientes,total_venta").order("fecha", { ascending: false }).limit(20),
    sb.from("bodegas").select("nombre,activa"),
  ]);

  return `
=== EMPLEADOS ACTIVOS (${empleados?.length ?? 0}) ===
${toLines(empleados)}

=== PEDIDOS RECIENTES (últimos 30) ===
${toLines(pedidos)}

=== INVENTARIO / ITEMS (${items?.length ?? 0} productos activos) ===
${toLines(items)}

=== PROVEEDORES (${proveedores?.length ?? 0}) ===
${toLines(proveedores)}

=== ACTIVOS / EQUIPOS (${activos?.length ?? 0}) ===
${toLines(activos)}

=== SESIONES NUTRICIONALES (últimas 20) ===
${toLines(sesiones)}

=== BODEGAS ===
${toLines(bodegas)}
`.trim();
}
