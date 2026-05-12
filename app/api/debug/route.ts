import { NextResponse } from "next/server";
import { buildVitalbaqContext, getSupabaseClient } from "@/app/lib/supabase";

export async function GET() {
  const envCheck = {
    WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_ID: !!process.env.WHATSAPP_PHONE_ID,
    WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, env: envCheck, error: "SUPABASE_SERVICE_ROLE_KEY no configurada" }, { status: 500 });
  }

  const sb = getSupabaseClient();

  const tablas = [
    "empleados", "novedades", "incapacidades", "liquidaciones", "empresas_temporales",
    "pedidos", "detalle_pedidos", "remisiones",
    "items", "bodegas", "stock_bodega",
    "proveedores", "proveedor_categorias", "precios_historicos",
    "activos", "mantenimientos_activos", "solicitudes_mantenimiento",
    "rotaciones", "turnos",
    "sesiones_nutricionales", "remisiones_nutricionales", "precios_dieta",
    "empresa_areas", "empresa_cargos", "empresa_sedes",
  ];

  const tablaStatus: Record<string, number | string> = {};
  await Promise.allSettled(
    tablas.map(async (t) => {
      const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
      tablaStatus[t] = error ? `ERROR: ${error.message}` : (count ?? 0);
    })
  );

  try {
    const context = await buildVitalbaqContext();
    const kb = Math.round(context.length / 1024);
    const tokens = Math.round(context.length / 4);
    return NextResponse.json({
      ok: true,
      env: envCheck,
      tablas: tablaStatus,
      contextKB: kb,
      estimatedTokens: tokens,
      tokenLimit: 128000,
      withinLimit: tokens < 100000,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, env: envCheck, tablas: tablaStatus, error: String(e) },
      { status: 500 }
    );
  }
}
