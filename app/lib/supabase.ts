import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukbejxfvhhftpwugoxqb.supabase.co";

export function getSupabaseClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(SUPABASE_URL, key);
}

type Row = Record<string, unknown>;

function ok(result: PromiseSettledResult<{ data: Row[] | null; error: unknown }>): Row[] {
  if (result.status === "rejected") return [];
  return result.value?.data ?? [];
}

function toLines(rows: Row[]): string {
  if (!rows.length) return "(sin datos)";
  return rows
    .map((r) =>
      Object.entries(r)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => {
          const val = typeof v === "object" ? JSON.stringify(v) : String(v);
          return `${k}:${val}`;
        })
        .join("|")
    )
    .join("\n");
}

export async function buildVitalbaqContext(): Promise<string> {
  const sb = getSupabaseClient();

  const results = await Promise.allSettled([
    // 0 empleados
    sb
      .from("empleados")
      .select("id,cc,nombre,cargo,area,salario,tipo_contrato,fecha_inicio,sede,estado,empresa_temporal_id")
      .order("nombre"),
    // 1 novedades
    sb
      .from("novedades")
      .select("empleado_id,concepto,tipo,cantidad,unidad,mes")
      .order("mes", { ascending: false })
      .limit(80),
    // 2 incapacidades
    sb
      .from("incapacidades")
      .select("empleado_id,tipo,fecha_inicio,fecha_fin,dias,estado")
      .order("fecha_inicio", { ascending: false })
      .limit(30),
    // 3 liquidaciones
    sb
      .from("liquidaciones")
      .select("mes,total,num_empleados")
      .order("mes", { ascending: false })
      .limit(12),
    // 4 empresas_temporales
    sb.from("empresas_temporales").select("id,nombre"),
    // 5 pedidos
    sb
      .from("pedidos")
      .select("id,codigo,proveedor_nombre,categoria,fecha,estado,total,obs")
      .order("fecha", { ascending: false })
      .limit(30),
    // 6 detalle_pedidos
    sb
      .from("detalle_pedidos")
      .select("pedido_id,nombre,cantidad,cantidad_recibida,unidad,precio_ref,subtotal")
      .limit(100),
    // 7 remisiones
    sb
      .from("remisiones")
      .select("id,pedido_id,proveedor,fecha,factura_numero,valor_remision,valor_factura,estado")
      .order("fecha", { ascending: false })
      .limit(20),
    // 8 detalle_remisiones
    sb
      .from("detalle_remisiones")
      .select("remision_id,nombre,unidad,cantidad_pedida,cantidad_recibida,conforme")
      .limit(60),
    // 9 items
    sb
      .from("items")
      .select("id,codigo,nombre,categoria,unidad,stock_actual,precio_ref")
      .eq("activo", true)
      .order("nombre")
      .limit(100),
    // 10 bodegas
    sb.from("bodegas").select("id,nombre,activa"),
    // 11 stock_bodega
    sb
      .from("stock_bodega")
      .select("item_id,bodega_id,cantidad")
      .limit(200),
    // 12 transferencias
    sb
      .from("transferencias")
      .select("item_id,cantidad,bodega_origen_id,bodega_destino_id,obs,creado_en")
      .order("creado_en", { ascending: false })
      .limit(20),
    // 13 proveedores
    sb
      .from("proveedores")
      .select("id,nombre,nit,contacto,whatsapp,correo,estado")
      .order("nombre"),
    // 14 proveedor_categorias
    sb.from("proveedor_categorias").select("id,nombre"),
    // 15 precios_historicos
    sb
      .from("precios_historicos")
      .select("producto,proveedor,semana_label,precio,cantidad,total,fecha_factura")
      .order("creado_en", { ascending: false })
      .limit(30),
    // 16 activos
    sb
      .from("activos")
      .select("id,codigo,nombre,ubicacion,valor,estado,responsable,prox_mant")
      .order("nombre"),
    // 17 mantenimientos_activos
    sb
      .from("mantenimientos_activos")
      .select("activo_id,tipo,tecnico,fecha,costo,estado")
      .order("fecha", { ascending: false })
      .limit(30),
    // 18 solicitudes_mantenimiento
    sb
      .from("solicitudes_mantenimiento")
      .select("activo,proveedor,tipo,descripcion,fecha,estado,costo_estimado")
      .order("fecha", { ascending: false })
      .limit(20),
    // 19 turnos
    sb
      .from("turnos")
      .select("empleado_id,sede,horario_inicio,horario_fin,fecha,estado")
      .order("fecha", { ascending: false })
      .limit(30),
    // 20 rotaciones
    sb
      .from("rotaciones")
      .select("empleado_id,sede_origen,sede_destino,fecha,motivo")
      .order("fecha", { ascending: false })
      .limit(20),
    // 21 sesiones_nutricionales
    sb
      .from("sesiones_nutricionales")
      .select("fecha,tipo_servicio,pacientes,total_venta")
      .order("fecha", { ascending: false })
      .limit(20),
    // 22 remisiones_nutricionales
    sb
      .from("remisiones_nutricionales")
      .select("sede,fecha,detalles,total_venta")
      .order("fecha", { ascending: false })
      .limit(30),
    // 23 precios_dieta
    sb.from("precios_dieta").select("dieta,desayuno,almuerzo,cena"),
    // 24 empresa_areas
    sb.from("empresa_areas").select("nombre"),
    // 25 empresa_cargos
    sb.from("empresa_cargos").select("nombre"),
    // 26 empresa_sedes
    sb.from("empresa_sedes").select("nombre"),
  ]);

  const [
    empleados, novedades, incapacidades, liquidaciones, empresasTemporales,
    pedidos, detallePedidos, remisiones, detalleRemisiones,
    items, bodegas, stockBodega, transferencias,
    proveedores, proveedorCategorias, preciosHistoricos,
    activos, mantenimientosActivos, solicitudesMantenimiento,
    turnos, rotaciones,
    sesionesNutricionales, remisionesNutricionales, preciosDieta,
    empresaAreas, empresaCargos, empresaSedes,
  ] = results.map(ok);

  // Mapas de referencia para nombres
  const bodegaMap: Record<string, string> = {};
  bodegas.forEach((b) => { if (b.id) bodegaMap[String(b.id)] = String(b.nombre); });

  const empTemporalMap: Record<string, string> = {};
  empresasTemporales.forEach((et) => { if (et.id) empTemporalMap[String(et.id)] = String(et.nombre); });

  const empleadoMap: Record<string, string> = {};
  empleados.forEach((e) => { if (e.id) empleadoMap[String(e.id)] = String(e.nombre); });

  const activoMap: Record<string, string> = {};
  activos.forEach((a) => { if (a.id) activoMap[String(a.id)] = String(a.nombre); });

  const itemMap: Record<string, string> = {};
  items.forEach((i) => { if (i.id) itemMap[String(i.id)] = String(i.nombre); });

  const empEnriquecidos = empleados.map((e) => ({
    cc: e.cc, nombre: e.nombre, cargo: e.cargo, area: e.area,
    salario: e.salario, contrato: e.tipo_contrato,
    inicio: e.fecha_inicio, sede: e.sede, estado: e.estado,
    temporal: e.empresa_temporal_id ? (empTemporalMap[String(e.empresa_temporal_id)] ?? e.empresa_temporal_id) : undefined,
  }));

  const novEnriquecidas = novedades.map((n) => ({
    empleado: empleadoMap[String(n.empleado_id)] ?? n.empleado_id,
    concepto: n.concepto, tipo: n.tipo, cantidad: n.cantidad, unidad: n.unidad, mes: n.mes,
  }));

  const incapEnriquecidas = incapacidades.map((i) => ({
    empleado: empleadoMap[String(i.empleado_id)] ?? i.empleado_id,
    tipo: i.tipo, inicio: i.fecha_inicio, fin: i.fecha_fin, dias: i.dias, estado: i.estado,
  }));

  const stockEnriquecido = stockBodega.map((s) => ({
    item: itemMap[String(s.item_id)] ?? s.item_id,
    bodega: bodegaMap[String(s.bodega_id)] ?? s.bodega_id,
    cantidad: s.cantidad,
  }));

  const transEnriquecidas = transferencias.map((t) => ({
    item: itemMap[String(t.item_id)] ?? t.item_id,
    cantidad: t.cantidad,
    de: bodegaMap[String(t.bodega_origen_id)] ?? t.bodega_origen_id,
    a: bodegaMap[String(t.bodega_destino_id)] ?? t.bodega_destino_id,
    obs: t.obs, fecha: t.creado_en,
  }));

  const mantEnriquecidos = mantenimientosActivos.map((m) => ({
    activo: activoMap[String(m.activo_id)] ?? m.activo_id,
    tipo: m.tipo, tecnico: m.tecnico, fecha: m.fecha, costo: m.costo, estado: m.estado,
  }));

  const turnosEnriquecidos = turnos.map((t) => ({
    empleado: empleadoMap[String(t.empleado_id)] ?? t.empleado_id,
    sede: t.sede, horario: `${t.horario_inicio}-${t.horario_fin}`, fecha: t.fecha, estado: t.estado,
  }));

  const rotEnriquecidas = rotaciones.map((r) => ({
    empleado: empleadoMap[String(r.empleado_id)] ?? r.empleado_id,
    de: r.sede_origen, a: r.sede_destino, fecha: r.fecha, motivo: r.motivo,
  }));

  const secciones = [
    `=== EMPLEADOS (${empEnriquecidos.length}) ===\n${toLines(empEnriquecidos)}`,
    `=== NOVEDADES NÓMINA ===\n${toLines(novEnriquecidas)}`,
    `=== INCAPACIDADES ===\n${toLines(incapEnriquecidas)}`,
    `=== LIQUIDACIONES ===\n${toLines(liquidaciones)}`,
    `=== PEDIDOS (${pedidos.length}) ===\n${toLines(pedidos)}`,
    `=== DETALLE PEDIDOS ===\n${toLines(detallePedidos)}`,
    `=== REMISIONES ===\n${toLines(remisiones)}`,
    `=== DETALLE REMISIONES ===\n${toLines(detalleRemisiones)}`,
    `=== INVENTARIO (${items.length} items) ===\n${toLines(items)}`,
    `=== STOCK POR BODEGA ===\n${toLines(stockEnriquecido)}`,
    `=== TRANSFERENCIAS ===\n${toLines(transEnriquecidas)}`,
    `=== PROVEEDORES (${proveedores.length}) ===\n${toLines(proveedores)}`,
    `=== CATEGORÍAS PROVEEDORES ===\n${toLines(proveedorCategorias)}`,
    `=== HISTORIAL PRECIOS ===\n${toLines(preciosHistoricos)}`,
    `=== ACTIVOS (${activos.length}) ===\n${toLines(activos)}`,
    `=== MANTENIMIENTOS ===\n${toLines(mantEnriquecidos)}`,
    `=== SOLICITUDES MANTENIMIENTO ===\n${toLines(solicitudesMantenimiento)}`,
    `=== TURNOS ===\n${toLines(turnosEnriquecidos)}`,
    `=== ROTACIONES ===\n${toLines(rotEnriquecidas)}`,
    `=== SESIONES NUTRICIONALES ===\n${toLines(sesionesNutricionales)}`,
    `=== REMISIONES NUTRICIONALES ===\n${toLines(remisionesNutricionales)}`,
    `=== PRECIOS DIETA ===\n${toLines(preciosDieta)}`,
    `=== ÁREAS / CARGOS / SEDES ===\nÁreas: ${empresaAreas.map(a => a.nombre).join(", ")}\nCargos: ${empresaCargos.map(c => c.nombre).join(", ")}\nSedes: ${empresaSedes.map(s => s.nombre).join(", ")}`,
  ];

  return secciones.join("\n\n");
}
