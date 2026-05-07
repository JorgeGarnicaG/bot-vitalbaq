import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukbejxfvhhftpwugoxqb.supabase.co";

export function getSupabaseClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(SUPABASE_URL, key);
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
    sb.from("empleados").select("nombre,cargo,area,salario,tipo_contrato,estado,sede").eq("estado", "Activo"),
    sb.from("pedidos").select("codigo,proveedor_nombre,categoria,fecha,estado,total").order("fecha", { ascending: false }).limit(50),
    sb.from("items").select("nombre,categoria,unidad,stock_actual,precio_ref").eq("activo", true),
    sb.from("proveedores").select("nombre,nit,contacto,whatsapp,categoria_id,estado"),
    sb.from("activos").select("codigo,nombre,marca,ubicacion,valor,estado,ultimo_mant,prox_mant"),
    sb.from("sesiones_nutricionales").select("fecha,tipo_servicio,pacientes,total_venta").order("fecha", { ascending: false }).limit(30),
    sb.from("bodegas").select("nombre,activa"),
  ]);

  const fmt = (v: unknown) => JSON.stringify(v ?? [], null, 2);

  return `
=== EMPLEADOS ACTIVOS (${empleados?.length ?? 0}) ===
${fmt(empleados)}

=== PEDIDOS RECIENTES (últimos 50) ===
${fmt(pedidos)}

=== INVENTARIO / ITEMS (${items?.length ?? 0} productos activos) ===
${fmt(items)}

=== PROVEEDORES (${proveedores?.length ?? 0}) ===
${fmt(proveedores)}

=== ACTIVOS / EQUIPOS (${activos?.length ?? 0}) ===
${fmt(activos)}

=== SESIONES NUTRICIONALES (últimas 30) ===
${fmt(sesiones)}

=== BODEGAS ===
${fmt(bodegas)}
`.trim();
}
