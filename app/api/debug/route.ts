import { NextResponse } from "next/server";
import { buildVitalbaqContext } from "@/app/lib/supabase";

export async function GET() {
  const envCheck = {
    WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
    WHATSAPP_PHONE_ID: !!process.env.WHATSAPP_PHONE_ID,
    WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  try {
    const context = await buildVitalbaqContext();
    return NextResponse.json({ ok: true, env: envCheck, contextLength: context.length });
  } catch (e) {
    return NextResponse.json({ ok: false, env: envCheck, error: String(e) }, { status: 500 });
  }
}
