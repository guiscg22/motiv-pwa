import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'Missing DEEPSEEK_API_KEY' }, { status: 500 });

    const r = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
