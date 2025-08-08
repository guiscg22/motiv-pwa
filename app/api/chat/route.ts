import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: Request){
  try{
    const { points } = await req.json() as { points: Array<{lat:number,lng:number,ts:number}> };
    if (!Array.isArray(points) || points.length === 0) return NextResponse.json({ elevations: [] });

    // Open-Elevation aceita até ~100 pontos por chamada; vamos fatiar
    const chunk = (arr:any[], n:number)=> arr.length ? [arr.slice(0,n), ...chunk(arr.slice(n), n)] : [];
    const chunks = chunk(points, 90);

    const results:number[] = [];
    for (const part of chunks){
      const query = part.map(p=>`${p.lat},${p.lng}`).join("|");
      const url = `https://api.open-elevation.com/api/v1/lookup?locations=${encodeURIComponent(query)}`;
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const data:any = await r.json();
      const arr = Array.isArray(data?.results) ? data.results.map((x:any)=>x.elevation) : [];
      results.push(...arr);
      // para alinhamento, caso retorne menos, preenche undefined
      while (results.length < part.length) results.push(undefined as any);
    }
    return NextResponse.json({ elevations: results.slice(0, points.length) });
  }catch(e:any){
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
