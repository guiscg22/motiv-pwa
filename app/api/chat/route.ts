import { NextResponse } from "next/server";
export const runtime = "edge";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
    const model = body?.model || "deepseek-chat";
    const temperature = typeof body?.temperature === "number" ? body.temperature : 0.2;

    const system: Msg = {
      role: "system",
      content: [
        "Você é um treinador de corrida de ELITE (2025).",
        "Fale em PT-BR, direto, com números. Segurança em 1º lugar.",
        "Use os dados do snapshot (objetivo, distância, pace atual/médio, splits, elevação, terreno).",
        "Diga O QUE fazer AGORA: ajuste de ritmo (± s/km), cadência, respiração, postura, hidratação, estratégia de subida/descida.",
        "Se objetivo for por TEMPO, gerencie déficit/sobra. Converta pace↔km/h quando útil.",
        "Responda curto (1–2 frases), tom confiante."
      ].join(" "),
    };

    const payload = { model, temperature, messages: [system, ...messages] };

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "DEEPSEEK_API_KEY ausente" }, { status: 500 });

    const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return NextResponse.json({ error: `Upstream ${r.status}: ${t}` }, { status: 500 });
    }
    const json = await r.json();
    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
