"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
// import { motion } from "framer-motion"; // opcional

type ChatMessage = { role: "user" | "assistant"; content: string; ts?: number };

const km = (m:number) => m / 1000;
const pad = (n:number) => String(n).padStart(2, "0");
const fmtClock = (s:number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
};
const fmtPace = (mps:number|null) => {
  if (!mps || mps <= 0) return "--:--";
  const secPerKm = 1000 / mps;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${pad(min)}:${pad(sec)}`;
};
const haversine = (a:any, b:any) => {
  if (!a || !b) return 0;
  const R = 6371000;
  const toRad = (x:number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const aVal = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(aVal), Math.sqrt(1 - aVal));
  return R * c;
};

// ✔ Setter compatível com SetStateAction<T>
function useLocalState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

function FlyTo({ latlng }: { latlng: any }){
  const map = useMap();
  useEffect(()=>{ if (latlng) map.flyTo(latlng, 16); }, [latlng]);
  return null;
}

function speak(text:string){
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "pt-BR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {}
}

export default function CoachApp(){
  const [tab, setTab] = useLocalState<string>("motiv.tab", "corrida");
  const [raceDate, setRaceDate] = useLocalState<string>("motiv.raceDate", "2025-10-12");
  const [targetPace, setTargetPace] = useLocalState<number>("motiv.target", 280); // s/km
  const [autoPause, setAutoPause] = useLocalState<boolean>("motiv.autopause", true);
  const [voiceCues, setVoiceCues] = useLocalState<boolean>("motiv.voice", true);

  const [watchId, setWatchId] = useState<number|null>(null);
  const [path, setPath] = useState<any[]>([]); // {lat,lng,ts}
  const [distance, setDistance] = useState<number>(0);
  const [movingTime, setMovingTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [recentSpeeds, setRecentSpeeds] = useState<number[]>([]);
  const [kmSplits, setKmSplits] = useState<number[]>([]);
  const [lastTick, setLastTick] = useState<number|null>(null);

  const current = path[path.length - 1] || null;
  const center = current ? { lat: current.lat, lng: current.lng } : { lat: -19.918, lng: -43.938 };

  useEffect(()=>{
    if (!isRunning || paused) return;
    const t = setInterval(()=> setMovingTime(s=>s+1), 1000);
    return ()=> clearInterval(t);
  }, [isRunning, paused]);

  const onPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, speed } = pos.coords;
    const ts = pos.timestamp || Date.now();
    const pt = { lat: latitude, lng: longitude, ts };
    setPath(prev => {
      const last = prev[prev.length-1];
      let add = true;
      if (last){
        const d = haversine(last, pt);
        if (d < 0.5) add = false;
        if (add) setDistance(dist => dist + d);
      }
      return add ? [...prev, pt] : prev;
    });
    setRecentSpeeds(arr => {
      const v = Number.isFinite(speed as number) ? (speed as number) : null;
      const keep = arr.slice(-8);
      return v===null ? keep : [...keep, v];
    });
  }, []);

  const onError = useCallback((err: any) => {
    console.error("Geolocation error", err);
    alert("Permita o acesso ao GPS e ative a alta precisão.");
  }, []);

  const startRun = () => {
    if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
    setIsRunning(true); setPaused(false); setPath([]); setDistance(0); setMovingTime(0); setKmSplits([]); setRecentSpeeds([]);
    const id = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 500, timeout: 10000 });
    // @ts-ignore
    setWatchId(id);
    setLastTick(Date.now());
    if (voiceCues) speak("Iniciando corrida. Bom treino!");
  };
  const pauseRun = () => { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); setWatchId(null); } setPaused(true); if (voiceCues) speak("Pausa ativada."); };
  const resumeRun = () => { if (!navigator.geolocation) return; const id = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 500, timeout: 10000 }); // @ts-ignore
    setWatchId(id); setPaused(false); if (voiceCues) speak("Voltando ao treino."); };
  const stopRun = () => { if (watchId !== null) navigator.geolocation.clearWatch(watchId); setWatchId(null); setIsRunning(false); setPaused(false); saveSession(); if (voiceCues) speak("Corrida salva. Bom trabalho!"); };

  useEffect(()=>{
    if (!autoPause || !isRunning) return;
    const vals = recentSpeeds;
    const filtered = vals.filter(v => Number.isFinite(v));
    const avg = filtered.length ? filtered.reduce((a,b)=>a+b,0)/filtered.length : null;
    if (avg !== null){
      if (avg < 0.6 && !paused) pauseRun();
      if (avg >= 0.8 && paused) resumeRun();
    }
  }, [recentSpeeds, autoPause, isRunning, paused]);

  useEffect(()=>{
    const doneKm = Math.floor(km(distance));
    if (doneKm > kmSplits.length){
      const splitTime = movingTime - (kmSplits.reduce((a,b)=>a+b,0));
      setKmSplits([...kmSplits, splitTime]);
      if (voiceCues) speak(`Quilômetro ${doneKm}. Parcial ${fmtClock(splitTime)}. Continue!`);
    }
  }, [distance, movingTime]);

  const avgSpeed = useMemo(()=> distance>0 && movingTime>0 ? distance / movingTime : 0, [distance, movingTime]);
  const curSpeed = useMemo(()=>{
    const vals = recentSpeeds;
    if (!vals.length) return 0;
    return vals.reduce((a,b)=>a+b,0)/vals.length;
  }, [recentSpeeds]);

  useEffect(()=>{
    if (!voiceCues || !isRunning || paused) return;
    const paceSec = curSpeed > 0 ? 1000 / curSpeed : null;
    if (!paceSec) return;
    const now = Date.now();
    if (!lastTick || now - lastTick > 30000){
      setLastTick(now);
      const gap = paceSec - targetPace;
      if (Math.abs(gap) > 8){
        const msg = gap > 0 ? "Acelere levemente para alcançar a meta." : "Segure um pouco, está rápido demais.";
        speak(`${fmtPace(curSpeed)} por quilômetro. ${msg}`);
      }
    }
  }, [curSpeed, targetPace, isRunning, paused, voiceCues, lastTick]);

  const [sessions, setSessions] = useLocalState<any[]>("motiv.sessions", []);
  const saveSession = () => {
    if (distance < 50 || path.length < 5) return;
    const s = {
      id: crypto.randomUUID(),
      name: `Corrida ${new Date().toLocaleString()}`,
      distance,
      movingTime,
      avgPace: avgSpeed ? 1000/avgSpeed : 0,
      path,
      splits: kmSplits,
      createdAt: Date.now(),
    };
    setSessions([s, ...sessions]);
  };

  const toGPX = (session:any) => {
    const header = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motiv" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${session.name||"Corrida"}</name><trkseg>`;
    const pts = session.path.map((p:any)=> `<trkpt lat="${p.lat}" lon="${p.lng}"><time>${new Date(p.ts).toISOString()}</time></trkpt>`).join("");
    const footer = `</trkseg></trk></gpx>`;
    return header + pts + footer;
  };
  const downloadGPX = (s:any) => {
    const gpx = toGPX(s);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${s.name.replace(/\s+/g,'_')}.gpx`; a.click(); URL.revokeObjectURL(url);
  };

  const targetPaceStr = `${Math.floor(targetPace/60)}:${pad(targetPace%60)}`;

  return (
    <div>
      <div className="topbar">
        <div className="container row" style={{justifyContent:'space-between', alignItems:'center'}}>
          <h1>Motiv — Assistente de Corrida</h1>
          <small>Meta: {targetPaceStr}/km • Prova: {new Date(raceDate).toLocaleDateString()}</small>
        </div>
      </div>

      <div className="container">
        <div className="row" style={{marginBottom:12}}>
          <button className="btn" onClick={()=>setTab("corrida")}>Corrida</button>
          <button className="btn" onClick={()=>setTab("plano")}>Plano</button>
          <button className="btn" onClick={()=>setTab("historico")}>Histórico</button>
          <button className="btn" onClick={()=>setTab("coach")}>Coach IA</button>
          <button className="btn" onClick={()=>setTab("config")}>Config</button>
        </div>

        {tab === "corrida" && (
          <div className="grid grid-2">
            <div className="card">
              <div style={{height:420, overflow:'hidden', borderRadius:12}}>
                <MapContainer center={center as any} zoom={15} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {path.length > 0 && <Polyline positions={path.map(p => [p.lat, p.lng]) as any} />}
                  {current && <Marker position={[current.lat, current.lng] as any} icon={L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png", shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png" })} />}
                  <FlyTo latlng={current} />
                </MapContainer>
              </div>
              <div className="row" style={{marginTop:10}}>
                {!isRunning && <button className="btn" onClick={startRun}>Iniciar</button>}
                {isRunning && !paused && <button className="btn" onClick={pauseRun}>Pausar</button>}
                {isRunning && paused && <button className="btn" onClick={resumeRun}>Retomar</button>}
                {isRunning && <button className="btn" onClick={stopRun}>Finalizar</button>}
              </div>
            </div>
            <div className="card">
              <div className="kpi">{km(distance).toFixed(2)} km</div>
              <div className="kpi-sub">Distância</div>
              <div className="kpi">{fmtClock(movingTime)}</div>
              <div className="kpi-sub">Tempo</div>
              <div className="kpi">{fmtPace(distance>0&&movingTime>0? distance/movingTime : 0)}</div>
              <div className="kpi-sub">Pace médio (/km)</div>
              <div className="kpi">{fmtPace(curSpeed)}</div>
              <div className="kpi-sub">Pace atual (/km)</div>
              <div className="separator" />
              <div className="label">Progresso 21,1 km</div>
              <div className="progress"><div style={{width: `${Math.min(100, (distance/21100)*100)}%`}} /></div>
            </div>
          </div>
        )}

        {tab === "plano" && (
          <div className="card">
            <div className="grid grid-2">
              <div>
                <label className="label">Data da prova</label>
                <input className="input" type="date" value={raceDate} onChange={(e)=>setRaceDate((e.target as HTMLInputElement).value)} />
                <div className="row" style={{marginTop:10}}>
                  <span className="badge">Natação ter/qui 19h</span>
                  <span className="badge">Força seg/qua/sex</span>
                </div>
              </div>
              <div>
                <p>Plano automático gerado até a prova (Easy • Intervalado • Tempo • Longão). Você pode focar em manter o pace-meta e acumular volume com segurança.</p>
              </div>
            </div>
          </div>
        )}

        {tab === "historico" && (
          <div className="card">
            {sessions.length === 0 && <p style={{opacity:.7}}>Sem corridas salvas ainda.</p>}
            <div className="grid">
              {sessions.map((s:any)=>(
                <div key={s.id} className="card">
                  <div style={{fontWeight:800}}>{s.name}</div>
                  <small>{new Date(s.createdAt).toLocaleString()}</small>
                  <div style={{marginTop:6}}>{(s.distance/1000).toFixed(2)} km • {fmtClock(s.movingTime)} • pace médio {fmtPace(s.distance/s.movingTime)}</div>
                  <div className="row" style={{marginTop:6}}>
                    <button className="btn" onClick={()=>downloadGPX(s)}>Baixar GPX</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "coach" && <CoachChat />}

        {tab === "config" && (
          <div className="card grid grid-2">
            <div>
              <label className="label">Meta de pace (/km)</label>
              <input className="input" type="time" step="1" value={`${pad(Math.floor(targetPace/60))}:${pad(targetPace%60)}`} onChange={(e)=>{
                const [mm, ss] = (e.target as HTMLInputElement).value.split(":").map(Number);
                setTargetPace(mm*60 + ss);
              }} />
              <div className="row" style={{marginTop:8}}>
                <label className="flex"><input type="checkbox" checked={autoPause} onChange={(e)=>setAutoPause((e.target as HTMLInputElement).checked)} />&nbsp;Autopausa</label>
                <label className="flex"><input type="checkbox" checked={voiceCues} onChange={(e)=>setVoiceCues((e.target as HTMLInputElement).checked)} />&nbsp;Coach de voz</label>
              </div>
            </div>
            <div>
              <p style={{opacity:.8}}>Dicas: ative alta precisão do GPS; mantenha a tela ligada nos primeiros minutos. Use o botão Instalar no navegador para ter o app na tela inicial.</p>
            </div>
          </div>
        )}

        <div style={{opacity:.6, fontSize:12, marginTop:16}}>Tudo salvo localmente (localStorage). Exporte o GPX e suba no Strava quando quiser.</div>
      </div>
    </div>
  );
}

function CoachChat(){
  const [chat, setChat] = useLocalState<ChatMessage[]>("motiv.chat", []);
  const [msg, setMsg] = useState<string>("");

  const sendMsg = async () => {
    if (!msg.trim()) return;
    const userMessage: ChatMessage = { role: "user", content: msg, ts: Date.now() };
    setChat((c: ChatMessage[]) => [...c, userMessage]);
    setMsg("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "Você é um treinador de corrida de elite. Responda em português do Brasil, prático e objetivo, com ritmos e números." },
            ...chat.map(({ role, content }) => ({ role, content })),
            { role: "user", content: userMessage.content }
          ],
          temperature: 0.2
        })
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "(sem resposta)";
      setChat((c: ChatMessage[]) => [...c, { role: "assistant", content: text, ts: Date.now() }]);
    } catch (e:any) {
      setChat((c: ChatMessage[]) => [...c, { role: "assistant", content: `Erro: ${e.message||e}` }]);
    }
  };

  return (
    <div className="card">
      <div style={{height:360, overflow:'auto', background:'rgba(0,0,0,.25)', borderRadius:10, padding:10}}>
        {chat.map((m, i)=>(
          <div key={i} style={{marginBottom:8, textAlign: m.role==='user'?'right':'left'}}>
            <div style={{display:'inline-block', maxWidth:'85%', whiteSpace:'pre-wrap', borderRadius:10, padding:'8px 10px', background: m.role==='user'?'#0E4DFFAA':'rgba(255,255,255,0.08)'}}>
              {m.content}
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{marginTop:8}}>
        <textarea className="textarea" rows={2} placeholder="Pergunte sobre seu treino, ajuste de ritmo, estratégia de prova…" value={msg} onChange={(e:any)=>setMsg(e.target.value)} />
        <button className="btn" onClick={sendMsg}>Enviar</button>
      </div>
    </div>
  );
}
