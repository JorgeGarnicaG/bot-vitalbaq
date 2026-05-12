import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukbejxfvhhftpwugoxqb.supabase.co";

export function getSupabaseClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(SUPABASE_URL, key);
}

function toLines(rows: Record<string, unknown>[] | null): string {
  if (!rows?.length) return "(sin datos)";
  return rows
    .map((r) =>
      Object.entries(r)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => {
          const val = typeof v === "object" ? JSON.stringify(v) : String(v);
          return `${k}:${val}`;
        })
        .join(" | ")
    )
    .join("\n");
}

export async function buildVitalbaqContext(): Promise<string> {
  const sb = getSupabaseClient();

  const [
    // Nómina
    { data: empleados },
    { data: novedades },
    { data: incapacidades },
    { data: liquidaciones },
    { data: empresasTemporales },
    // Pedidos / Compras
    { data: pedidos },
    { data: detallePedidos },
    { data: remisiones },
    { data: detalleRemisiones },
    // Inventario
    { data: items },
    { data: bodegas },
    { data: stockBodega },
    { data: transferencias },
    // Proveedores
    { data: proveedores },
    { data: proveedorCategorias },
    { data: preciosHistoricos },
    // Activos
    { data: activos },
    { data: mantenimientosActivos },
    { data: solicitudesMantenimiento },
    // Rotación
    { data: turnos },
    { data: rotaciones },
    // Nutrición
    { data: sesionesNutricionales },
    { data: remisionesNutricionales },
    { data: preciosDieta },
    // Config
    { data: empresaAreas },
    { data: empresaCargos },
    { data: empresaSedes },
  ] = await Promise.all([
    // Nómina
    sb
      .from("empleados")
      .select(
        "id,cc,nombre,nombre_corto,cargo,area,salario,tipo_contrato,fecha_inicio,fecha_fin,sede,estado,email,telefono,empresa_temporal_id"
      )
      .order("nombre"),
    sb
      .from("novedades")
      .select("empleado_id,concepto,tipo,cantidad,unidad,mes,fecha")
      .order("mes", { ascending: false })
      .limit(100),
    sb
      .from("incapacidades")
      .select("empleado_id,tipo,fecha_inicio,fecha_fin,dias,estado,obs")
      .order("fecha_inicio", { ascending: false })
      .limit(50),
    sb
      .from("liquidaciones")
      .select("mes,total,num_empleados,detalle")
      .order("mes", { ascending: false })
      .limit(24),
    sb.from("empresas_temporales").select("id,nombre,color"),
    // Pedidos / Compras
    sb
      .from("pedidos")
      .select(
        "id,codigo,proveedor_nombre,categoria,fecha,fecha_entrega,estado,total,obs"
      )
      .order("fecha", { ascending: false })
      .limit(50),
    sb
      .from("detalle_pedidos")
      .select("pedido_id,nombre,cantidad,cantidad_recibida,unidad,precio_ref,subtotal")
      .limit(150),
    sb
      .from("remisiones")
      .select(
        "id,pedido_id,proveedor,fecha,factura_numero,valor_remision,valor_factura,estado,obs"
      )
      .order("fecha", { ascending: false })
      .limit(30),
    sb
      .from("detalle_remisiones")
      .select("remision_id,nombre,unidad,cantidad_pedida,cantidad_recibida,subtotal,conforme")
      .limit(100),
    // Inventario
    sb
      .from("items")
      .select(
        "id,codigo,nombre,categoria,unidad,stock_minimo,stock_maximo,stock_actual,precio_ref,bodega"
      )
      .eq("activo", true)
      .order("nombre")
      .limit(150),
    sb.from("bodegas").select("id,nombre,es_principal,activa"),
    sb
      .from("stock_bodega")
      .select("item_id,bodega_id,cantidad")
      .limit(300),
    sb
      .from("transferencias")
      .select("item_id,cantidad,bodega_origen_id,bodega_destino_id,obs,creado_en")
      .order("creado_en", { ascending: false })
      .limit(30),
    // Proveedores
    sb
      .from("proveedores")
      .select("id,nombre,nit,contacto,whatsapp,correo,frecuencia,estado")
      .order("nombre"),
    sb.from("proveedor_categorias").select("id,nombre"),
    sb
      .from("precios_historicos")
      .select("producto,proveedor,semana,semana_label,precio,cantidad,total,fecha_factura,numero_factura")
      .order("creado_en", { ascending: false })
      .limit(50),
    // Activos
    sb
      .from("activos")
      .select(
        "id,codigo,nombre,marca,ubicacion,valor,estado,responsable,fecha_adquisicion,ultimo_mant,prox_mant,descripcion"
      )
      .order("nombre"),
    sb
      .from("mantenimientos_activos")
      .select("activo_id,tipo,tecnico,fecha,costo,estado,obs")
      .order("fecha", { ascending: false })
      .limit(50),
    sb
      .from("solicitudes_mantenimiento")
      .select("activo,proveedor,tipo,descripcion,fecha,estado,aprobado_por,costo_estimado,obs")
      .order("fecha", { ascending: false })
      .limit(30),
    // Rotación
    sb
      .from("turnos")
      .select("empleado_id,sede,horario_inicio,horario_fin,fecha,estado")
      .order("fecha", { ascending: false })
      .limit(50),
    sb
      .from("rotaciones")
      .select("empleado_id,sede_origen,sede_destino,fecha,motivo")
      .order("fecha", { ascending: false })
      .limit(30),
    // Nutrición
    sb
      .from("sesiones_nutricionales")
      .select("fecha,tipo_servicio,pacientes,medicos_por_sede,total_venta")
      .order("fecha", { ascending: false })
      .limit(30),
    sb
      .from("remisiones_nutricionales")
      .select("sesion_id,sede,fecha,detalles,total_venta")
      .order("fecha", { ascending: false })
      .limit(50),
    sb.from("precios_dieta").select("dieta,desayuno,almuerzo,cena"),
    // Config
    sb.from("empresa_areas").select("nombre"),
    sb.from("empresa_cargos").select("nombre"),
    sb.from("empresa_sedes").select("nombre"),
  ]);

  // Mapas de referencia para enriquecer datos
  const bodegaMap: Record<string, string> = {};
  (bodegas ?? []).forEach((b) => {
    bodegaMap[b.id] = b.nombre;
  });

  const empTemporalMap: Record<string, string> = {};
  (empresasTemporales ?? []).forEach((et) => {
    empTemporalMap[et.id] = et.nombre;
  });

  const empleadoMap: Record<string, string> = {};
  (empleados ?? []).forEach((e) => {
    if (e.id) empleadoMap[e.id] = e.nombre;
  });

  const activoMap: Record<string, string> = {};
  (activos ?? []).forEach((a) => {
    if (a.id) activoMap[a.id] = a.nombre;
  });

  const itemMap: Record<string, string> = {};
  (items ?? []).forEach((i) => {
    if (i.id) itemMap[i.id] = i.nombre;
  });

  // Enriquecer stock_bodega con nombres
  const stockEnriquecido = (stockBodega ?? []).map((s) => ({
    item: itemMap[s.item_id] ?? s.item_id,
    bodega: bodegaMap[s.bodega_id] ?? s.bodega_id,
    cantidad: s.cantidad,
  }));

  // Enriquecer novedades con nombre del empleado
  const novedadesEnriquecidas = (novedades ?? []).map((n) => ({
    empleado: empleadoMap[n.empleado_id] ?? n.empleado_id,
    concepto: n.concepto,
    tipo: n.tipo,
    cantidad: n.cantidad,
    unidad: n.unidad,
    mes: n.mes,
    fecha: n.fecha,
  }));

  const incapacidadesEnriquecidas = (incapacidades ?? []).map((i) => ({
    empleado: empleadoMap[i.empleado_id] ?? i.empleado_id,
    tipo: i.tipo,
    fecha_inicio: i.fecha_inicio,
    fecha_fin: i.fecha_fin,
    dias: i.dias,
    estado: i.estado,
    obs: i.obs,
  }));

  const turnosEnriquecidos = (turnos ?? []).map((t) => ({
    empleado: empleadoMap[t.empleado_id] ?? t.empleado_id,
    sede: t.sede,
    horario: `${t.horario_inicio}-${t.horario_fin}`,
    fecha: t.fecha,
    estado: t.estado,
  }));

  const rotacionesEnriquecidas = (rotaciones ?? []).map((r) => ({
    empleado: empleadoMap[r.empleado_id] ?? r.empleado_id,
    de: r.sede_origen,
    a: r.sede_destino,
    fecha: r.fecha,
    motivo: r.motivo,
  }));

  const mantEnriquecidos = (mantenimientosActivos ?? []).map((m) => ({
    activo: activoMap[m.activo_id] ?? m.activo_id,
    tipo: m.tipo,
    tecnico: m.tecnico,
    fecha: m.fecha,
    costo: m.costo,
    estado: m.estado,
    obs: m.obs,
  }));

  const transEnriquecidas = (transferencias ?? []).map((t) => ({
    item: itemMap[t.item_id] ?? t.item_id,
    cantidad: t.cantidad,
    origen: bodegaMap[t.bodega_origen_id] ?? t.bodega_origen_id,
    destino: bodegaMap[t.bodega_destino_id] ?? t.bodega_destino_id,
    obs: t.obs,
    fecha: t.creado_en,
  }));

  const empleadosEnriquecidos = (empleados ?? []).map((e) => ({
    ...e,
    empresa_temporal: e.empresa_temporal_id
      ? (empTemporalMap[e.empresa_temporal_id] ?? e.empresa_temporal_id)
      : undefined,
    empresa_temporal_id: undefined,
  }));

  return `
=== EMPLEADOS (${empleados?.length ?? 0}) ===
${toLines(empleadosEnriquecidos)}

=== NOVEDADES DE NÓMINA (últimas 100) ===
${toLines(novedadesEnriquecidas)}

=== INCAPACIDADES (últimas 50) ===
${toLines(incapacidadesEnriquecidas)}

=== LIQUIDACIONES (últimas 24 mensualidades) ===
${toLines(liquidaciones)}

=== EMPRESAS TEMPORALES ===
${toLines(empresasTemporales)}

=== PEDIDOS RECIENTES (últimos 50) ===
${toLines(pedidos)}

=== DETALLE DE PEDIDOS (hasta 150 líneas) ===
${toLines(detallePedidos)}

=== REMISIONES / RECEPCIONES (últimas 30) ===
${toLines(remisiones)}

=== DETALLE REMISIONES (hasta 100 líneas) ===
${toLines(detalleRemisiones)}

=== INVENTARIO / ITEMS (${items?.length ?? 0} productos activos) ===
${toLines(items)}

=== BODEGAS ===
${toLines(bodegas)}

=== STOCK POR BODEGA ===
${toLines(stockEnriquecido)}

=== TRANSFERENCIAS ENTRE BODEGAS (últimas 30) ===
${toLines(transEnriquecidas)}

=== PROVEEDORES (${proveedores?.length ?? 0}) ===
${toLines(proveedores)}

=== CATEGORÍAS DE PROVEEDORES ===
${toLines(proveedorCategorias)}

=== HISTORIAL DE PRECIOS (últimos 50 registros) ===
${toLines(preciosHistoricos)}

=== ACTIVOS / EQUIPOS (${activos?.length ?? 0}) ===
${toLines(activos)}

=== MANTENIMIENTOS DE ACTIVOS (últimos 50) ===
${toLines(mantEnriquecidos)}

=== SOLICITUDES DE MANTENIMIENTO (últimas 30) ===
${toLines(solicitudesMantenimiento)}

=== TURNOS DE PERSONAL (últimos 50) ===
${toLines(turnosEnriquecidos)}

=== ROTACIONES DE PERSONAL (últimas 30) ===
${toLines(rotacionesEnriquecidas)}

=== SESIONES NUTRICIONALES (últimas 30) ===
${toLines(sesionesNutricionales)}

=== REMISIONES NUTRICIONALES (últimas 50 por sede) ===
${toLines(remisionesNutricionales)}

=== PRECIOS DE DIETA ===
${toLines(preciosDieta)}

=== ÁREAS DE LA EMPRESA ===
${toLines(empresaAreas)}

=== CARGOS DE LA EMPRESA ===
${toLines(empresaCargos)}

=== SEDES DE LA EMPRESA ===
${toLines(empresaSedes)}
`.trim();
}
