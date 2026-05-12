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
        .map(([k, v]) => `${k}:${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join("|")
    )
    .join("\n");
}

export async function buildVitalbaqContext(): Promise<string> {
  const sb = getSupabaseClient();

  const results = await Promise.allSettled([
    // 0 empleados — todos, son ~31
    sb.from("empleados")
      .select("id,cc,nombre,cargo,area,salario,tipo_contrato,fecha_inicio,sede,estado,empresa_temporal_id")
      .order("nombre"),
    // 1 novedades — últimas 40
    sb.from("novedades")
      .select("empleado_id,concepto,tipo,cantidad,unidad,mes")
      .order("mes", { ascending: false }).limit(40),
    // 2 incapacidades — todas (pocas)
    sb.from("incapacidades")
      .select("empleado_id,tipo,fecha_inicio,fecha_fin,dias,estado,obs")
      .order("fecha_inicio", { ascending: false }),
    // 3 liquidaciones — últimas 6
    sb.from("liquidaciones")
      .select("mes,total,num_empleados")
      .order("mes", { ascending: false }).limit(6),
    // 4 empresas_temporales
    sb.from("empresas_temporales").select("id,nombre"),
    // 5 pedidos — últimos 20
    sb.from("pedidos")
      .select("id,codigo,proveedor_nombre,categoria,fecha,estado,total")
      .order("fecha", { ascending: false }).limit(20),
    // 6 detalle_pedidos — solo de los 20 pedidos más recientes (limite 40 líneas)
    sb.from("detalle_pedidos")
      .select("pedido_id,nombre,cantidad,cantidad_recibida,unidad,precio_ref")
      .limit(40),
    // 7 remisiones — últimas 10
    sb.from("remisiones")
      .select("id,pedido_id,proveedor,fecha,factura_numero,valor_remision,valor_factura,estado")
      .order("fecha", { ascending: false }).limit(10),
    // 8 items — top 60 con stock > 0
    sb.from("items")
      .select("id,nombre,categoria,unidad,stock_actual,precio_ref")
      .eq("activo", true)
      .gt("stock_actual", 0)
      .order("nombre").limit(60),
    // 9 items sin stock (para saber cuáles están agotados) — solo nombres
    sb.from("items")
      .select("nombre,categoria,unidad")
      .eq("activo", true)
      .eq("stock_actual", 0)
      .order("nombre").limit(40),
    // 10 bodegas
    sb.from("bodegas").select("id,nombre,activa"),
    // 11 stock_bodega — solo con cantidad > 0
    sb.from("stock_bodega")
      .select("item_id,bodega_id,cantidad")
      .gt("cantidad", 0).limit(80),
    // 12 proveedores — todos (~22)
    sb.from("proveedores")
      .select("id,nombre,nit,contacto,whatsapp,estado")
      .order("nombre"),
    // 13 proveedor_categorias
    sb.from("proveedor_categorias").select("id,nombre"),
    // 14 precios_historicos — últimos 20
    sb.from("precios_historicos")
      .select("producto,proveedor,semana_label,precio,total,fecha_factura")
      .order("creado_en", { ascending: false }).limit(20),
    // 15 activos — todos con campos clave
    sb.from("activos")
      .select("id,codigo,nombre,ubicacion,estado,responsable,prox_mant")
      .order("nombre"),
    // 16 mantenimientos_activos — últimos 20
    sb.from("mantenimientos_activos")
      .select("activo_id,tipo,tecnico,fecha,costo,estado")
      .order("fecha", { ascending: false }).limit(20),
    // 17 solicitudes_mantenimiento — últimas 15
    sb.from("solicitudes_mantenimiento")
      .select("activo,proveedor,tipo,descripcion,fecha,estado,costo_estimado")
      .order("fecha", { ascending: false }).limit(15),
    // 18 rotaciones — últimas 20
    sb.from("rotaciones")
      .select("empleado_id,sede_origen,sede_destino,fecha,motivo")
      .order("fecha", { ascending: false }).limit(20),
    // 19 turnos vigentes — últimos 20
    sb.from("turnos")
      .select("empleado_id,sede,horario_inicio,horario_fin,fecha,estado")
      .order("fecha", { ascending: false }).limit(20),
    // 20 sesiones_nutricionales — últimas 15 (sin JSON masivo)
    sb.from("sesiones_nutricionales")
      .select("fecha,tipo_servicio,total_venta,pacientes")
      .order("fecha", { ascending: false }).limit(15),
    // 21 remisiones_nutricionales — últimas 20 (sin detalles JSON)
    sb.from("remisiones_nutricionales")
      .select("sede,fecha,total_venta")
      .order("fecha", { ascending: false }).limit(20),
    // 22 precios_dieta
    sb.from("precios_dieta").select("dieta,desayuno,almuerzo,cena"),
    // 23 config
    sb.from("empresa_areas").select("nombre"),
    sb.from("empresa_cargos").select("nombre"),
    sb.from("empresa_sedes").select("nombre"),
  ]);

  const [
    empleados, novedades, incapacidades, liquidaciones, empresasTemporales,
    pedidos, detallePedidos, remisiones,
    itemsConStock, itemsSinStock, bodegas, stockBodega,
    proveedores, proveedorCategorias, preciosHistoricos,
    activos, mantenimientosActivos, solicitudesMantenimiento,
    rotaciones, turnos,
    sesionesNutricionales, remisionesNutricionales, preciosDieta,
    empresaAreas, empresaCargos, empresaSedes,
  ] = results.map(ok);

  // Mapas de referencia
  const bodegaMap: Record<string, string> = {};
  bodegas.forEach((b) => { if (b.id) bodegaMap[String(b.id)] = String(b.nombre); });

  const empTemporalMap: Record<string, string> = {};
  empresasTemporales.forEach((et) => { if (et.id) empTemporalMap[String(et.id)] = String(et.nombre); });

  const empleadoMap: Record<string, string> = {};
  empleados.forEach((e) => { if (e.id) empleadoMap[String(e.id)] = String(e.nombre); });

  const activoMap: Record<string, string> = {};
  activos.forEach((a) => { if (a.id) activoMap[String(a.id)] = String(a.nombre); });

  const itemMap: Record<string, string> = {};
  itemsConStock.forEach((i) => { if (i.id) itemMap[String(i.id)] = String(i.nombre); });

  const empRows = empleados.map((e) => ({
    cc: e.cc, nombre: e.nombre, cargo: e.cargo, area: e.area,
    salario: e.salario, contrato: e.tipo_contrato,
    inicio: e.fecha_inicio, sede: e.sede, estado: e.estado,
    temporal: e.empresa_temporal_id ? (empTemporalMap[String(e.empresa_temporal_id)] ?? undefined) : undefined,
  }));

  const novRows = novedades.map((n) => ({
    empleado: empleadoMap[String(n.empleado_id)] ?? n.empleado_id,
    concepto: n.concepto, tipo: n.tipo, cantidad: n.cantidad, unidad: n.unidad, mes: n.mes,
  }));

  const incapRows = incapacidades.map((i) => ({
    empleado: empleadoMap[String(i.empleado_id)] ?? i.empleado_id,
    tipo: i.tipo, inicio: i.fecha_inicio, fin: i.fecha_fin, dias: i.dias, estado: i.estado, obs: i.obs,
  }));

  const stockRows = stockBodega.map((s) => ({
    item: itemMap[String(s.item_id)] ?? s.item_id,
    bodega: bodegaMap[String(s.bodega_id)] ?? s.bodega_id,
    cant: s.cantidad,
  }));

  const mantRows = mantenimientosActivos.map((m) => ({
    activo: activoMap[String(m.activo_id)] ?? m.activo_id,
    tipo: m.tipo, tecnico: m.tecnico, fecha: m.fecha, costo: m.costo, estado: m.estado,
  }));

  const rotRows = rotaciones.map((r) => ({
    empleado: empleadoMap[String(r.empleado_id)] ?? r.empleado_id,
    de: r.sede_origen, a: r.sede_destino, fecha: r.fecha, motivo: r.motivo,
  }));

  const turnosRows = turnos.map((t) => ({
    empleado: empleadoMap[String(t.empleado_id)] ?? t.empleado_id,
    sede: t.sede, horario: `${t.horario_inicio}-${t.horario_fin}`, fecha: t.fecha, estado: t.estado,
  }));

  const secciones = [
    `=== EMPLEADOS (${empRows.length}) ===\n${toLines(empRows)}`,
    `=== NOVEDADES NÓMINA ===\n${toLines(novRows)}`,
    `=== INCAPACIDADES (${incapRows.length}) ===\n${toLines(incapRows)}`,
    `=== LIQUIDACIONES ===\n${toLines(liquidaciones)}`,
    `=== PEDIDOS RECIENTES (${pedidos.length}) ===\n${toLines(pedidos)}`,
    `=== DETALLE PEDIDOS ===\n${toLines(detallePedidos)}`,
    `=== REMISIONES ===\n${toLines(remisiones)}`,
    `=== INVENTARIO CON STOCK (${itemsConStock.length} items) ===\n${toLines(itemsConStock)}`,
    `=== ITEMS AGOTADOS (${itemsSinStock.length}) ===\n${itemsSinStock.map(i => `${i.nombre}|${i.categoria}|${i.unidad}`).join("\n")}`,
    `=== STOCK POR BODEGA ===\n${toLines(stockRows)}`,
    `=== PROVEEDORES (${proveedores.length}) ===\n${toLines(proveedores)}`,
    `=== CATEGORÍAS PROVEEDORES ===\n${toLines(proveedorCategorias)}`,
    `=== HISTORIAL PRECIOS ===\n${toLines(preciosHistoricos)}`,
    `=== ACTIVOS / EQUIPOS (${activos.length}) ===\n${toLines(activos)}`,
    `=== MANTENIMIENTOS ===\n${toLines(mantRows)}`,
    `=== SOLICITUDES MANTENIMIENTO ===\n${toLines(solicitudesMantenimiento)}`,
    `=== ROTACIONES PERSONAL ===\n${toLines(rotRows)}`,
    `=== TURNOS ===\n${toLines(turnosRows)}`,
    `=== SESIONES NUTRICIONALES ===\n${sesionesNutricionales.map(s => {
      // Resumir el JSON de pacientes: extraer totales por dieta
      let resumenPacientes = "";
      try {
        const pac = s.pacientes as Record<string, unknown>;
        if (pac && typeof pac === "object") {
          resumenPacientes = Object.entries(pac)
            .map(([k, v]) => {
              if (typeof v === "number") return `${k}:${v}`;
              if (typeof v === "object" && v !== null) {
                const total = Object.values(v as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
                return `${k}:${total}`;
              }
              return `${k}:${v}`;
            })
            .join(",");
        }
      } catch { resumenPacientes = "(error parseando)"; }
      return `fecha:${s.fecha}|servicio:${s.tipo_servicio}|total_venta:${s.total_venta}|pacientes_por_dieta:{${resumenPacientes}}`;
    }).join("\n") || "(sin datos)"}`,
    `=== REMISIONES NUTRICIONALES ===\n${toLines(remisionesNutricionales)}`,
    `=== PRECIOS DIETA ===\n${toLines(preciosDieta)}`,
    `=== CONFIG ===\nÁreas:${empresaAreas.map(a => a.nombre).join(",")}\nCargos:${empresaCargos.map(c => c.nombre).join(",")}\nSedes:${empresaSedes.map(s => s.nombre).join(",")}`,
  ];

  return secciones.join("\n\n");
}
