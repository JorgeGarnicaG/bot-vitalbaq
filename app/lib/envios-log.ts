import { SupabaseClient } from "@supabase/supabase-js";

export type EnvioLog = {
  tipo: string; // "cierre-caja" | "empleados-10-meses" | "webhook-status" | ...
  destinatario?: string;
  ok: boolean;
  error?: string;
};

/**
 * Registra el resultado de un envío de WhatsApp en la tabla envios_log.
 * Nunca lanza: si la tabla no existe o Supabase falla, el envío principal
 * no debe verse afectado.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registrarEnvio(sb: SupabaseClient<any, any, any>, log: EnvioLog): Promise<void> {
  try {
    const { error } = await sb.from("envios_log").insert({
      tipo: log.tipo,
      destinatario: log.destinatario ?? null,
      ok: log.ok,
      error: log.error ?? null,
    });
    if (error) console.error("[envios_log]", error.message);
  } catch (e) {
    console.error("[envios_log]", e);
  }
}
