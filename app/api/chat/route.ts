import { NextResponse } from "next/server";
export const runtime = "edge";

// Tipagem para ponto de entrada
type Point = { lat: number; lng: number; ts: number };

// Função de fatiamento tipada
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const { points } = (await req.json()) as { points: Point[] };

    if (!Array.isArray(points) || points.length === 0) {
      return NextResponse.json({ elevations: [] });
    }

    // Open-Elevation aceita até ~100 pontos por chamada; usamos 90 por segurança
    const chunks = chunk(points, 90);
    const results: number[] = [];

    for (const part of chunks) {
      const query = part.map(p => `${p.lat},${p.lng}`).join("|");
      const url = `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(query)}`;
      
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) {
        // se falhar, adiciona undefined para manter alinhamento
        for (let i = 0; i < part.length; i++) results.push(undefined as any);
        continue;
      }

      const data: any = await r.json();
      const arr = Array.isArray(data?.results)
        ? data.results.map((x: any) => x.elevation)
        : [];

      results.push(...arr);

      // Preenche se a API retornar menos que o esperado
      while (arr.length < part.length) {
        results.push(undefined as any);
      }
    }

    return NextResponse.json({ elevations: results.slice(0, points.length) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
