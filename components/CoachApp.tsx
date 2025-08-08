"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";

type ChatMessage = { role: "user" | "assistant"; content: string; ts?: number };
type GeoPt = { lat: number; lng: number; ts: number; acc?: number; ele?: number; spd?: number };

const BRAND = { blue: "#0E4DFF", blue2: "#1B75FF" };

// ---------- utils
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
const haversine = (a:GeoPt, b:GeoPt) => {
  const R = 6371000, toRad = (x:number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat/2), s2 = Math.sin(dLon/2);
  const aa = s1*s1 + Math.cos(lat1)*Math.cos(lat2)*s2*s2;
  return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
};

// ---------- local state with SetStateAction support
function useLocalState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; }
    catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch {} }, [key, state]);
  return [state, setState];
}

function FlyTo({ latlng }: { latlng: any }){
  const map = useMap();
  useEffect(()=>{ if (latlng) map.flyTo(latlng, 16); }, [latlng]);
  return null;
}

function speak(text:string){
  try { const u = new SpeechSynthesisUtterance(text); u.lang = "pt-BR"; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch {}
}

// ---------- main
export default function CoachApp(){
  // UI tabs
  const [tab, setTab] = useLocalState<string>("motiv.tab", "corrida");

  // Goals / settings
  const [raceDate, setRaceDate] = useLocalState<string>("motiv.raceDate", "2025-10-12");
  const [targetPace, setTargetPace] = useLocalState<number>("motiv.target", 280); // segundos/km
  const [autoPause, setAutoPause] = useLocalState<boolean>("motiv.autopause", true);
  const [voiceCues, setVoiceCues] = useLocalState<boolean>("motiv.voice", true);

  // Live telemetry
  const [watchId, setWatchId] = useState<number|null>(null);
  const [path, setPath] = useState<GeoPt[]>([]);
  const [distance, setDistance] = useState<number>(0);
  const [movingTime, setMovingTime] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [paused, setPaused] = useState<boolean>(false);
  const [emaSpeed, setEmaSpeed] = useState<number>(0);      // m/s suavizado (EMA)
  const [kmSplits, setKmSplits] = useState<number[]>([]);
  const [elevGain, setElevGain] = useState<number>(0);      // ganho positivo (m)
  const [lastCueAt, setLastCueAt] = useState<number|null>(null);

  // Derived
  const current = path[path.length - 1] || null;
  const center = current ? { lat: current.lat, lng: current.lng } : { lat: -19.918, lng: -43.938 };
  const avgSpeed = useMemo(()=> distance>0 && movingTime>0 ? distance / movingTime : 0, [distance, movingTime]);

  // timer do relógio em movimento
  useEffect(()=>{
    if (!isRunning || paused) return;
    const t = setInterval(()=> setMovingTime(s=>s+1), 1000);
    return ()=> clearInterval(t);
  }, [isRunning, paused]);

  // filtro: descarta pontos ruins e calcula fusão de velocidade
  const pushPoint = useCallback((pt: GeoPt) => {
    setPath(prev => {
      const last = prev[prev.length-1];
      let add = true;
      // descartar pontos com baixa precisão (>30m)
      if (typeof pt.acc === "number" && pt.acc > 30) add = false;
      // distância mínima 2m para evitar “ruído parado”
      if (last) {
        const d = haversine(last, pt);
        if (d < 2) add = false;
        if (add) {
          const dt = Math.max(0.5, (pt.ts - last.ts) / 1000);
          const segSpeed = d / dt;                              // m/s
          const gpsSpeed = typeof pt.spd === "number" ? pt.spd : null;
          const fused = gpsSpeed === null ? segSpeed : (0.6*segSpeed + 0.4*gpsSpeed);
          // sanitiza (0–9 m/s ≈ 0–32,4 km/h)
          const sane = Math.min(9, Math.max(0, fused));
          const alpha = 0.35; // suavização EMA
          setEmaSpeed(s => s ? (alpha*sane + (1-alpha)*s) : sane);
          setDistance(x => x + d);
          // ganho de elevação incremental (se ambos tiverem ele)
          if (typeof pt.ele === "number" && typeof last.ele === "number") {
            const up = pt.ele - last.ele;
            if (up > 0.5) setElevGain(g => g + up); // ignora ruído < 0.5m
          }
        }
      }
      return add ? [...prev, pt] : prev;
    });
  }, []);

  // geolocalização
  const onPosition = useCallback((pos: GeolocationPosition) => {
    const { latitude, longitude, speed, accuracy, altitude } = pos.coords as any;
    const pt: GeoPt = {
      lat: latitude, lng: longitude,
      ts: pos.timestamp || Date.now(),
      acc: accuracy, ele: (typeof altitude === "number" ? altitude : undefined),
      spd: (Number.isFinite(speed) ? speed : undefined)
    };
    pushPoint(pt);
  }, [pushPoint]);

  const onError = useCallback((err: any) => {
    console.error("Geolocation error", err);
    alert("Permita o acesso ao GPS e ative a alta precisão.");
  }, []);

  const startRun = () => {
    if (!navigator.geolocation) { alert("Geolocalização não suportada."); return; }
    setIsRunning(true); setPaused(false);
    setPath([]); setDistance(0); setMovingTime(0); setKmSplits([]); setEmaSpeed(0); setElevGain(0);
    const id = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10000
    });
    // @ts-ignore
    setWatchId(id);
    setLastCueAt(Date.now());
    if (voiceCues) speak("Iniciando corrida. Bom treino!");
  };
  const pauseRun = () => {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); setWatchId(null); }
    setPaused(true);
    if (voiceCues) speak("Pausa ativada.");
  };
  const resumeRun = () => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true, maximumAge: 0, timeout: 10000
    });
    // @ts-ignore
    setWatchId(id);
    setPaused(false);
    if (voiceCues) speak("Voltando ao treino.");
  };

  // ao finalizar, puxa elevação pelo servidor (com fallback)
  const stopRun = async () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null); setIsRunning(false); setPaused(false);
    let newPath = [...path];
    try {
      const bare = newPath.map(p => ({ lat: p.lat, lng: p.lng, ts: p.ts }));
      const res = await fetch("/api/elev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: bare }) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.elevations)) {
          newPath = newPath.map((p, i) => ({ ...p, ele: data.elevations[i] ?? p.ele }));
          // recomputa ganho
          let g = 0;
          for (let i=1;i<newPath.length;i++){
            if (typeof newPath[i].ele === "number" && typeof newPath[i-1].ele === "number") {
              const d = newPath[i].ele! - newPath[i-1].ele!;
              if (d > 0.5) g += d;
            }
          }
          setElevGain(g);
        }
      }
    } catch {}
    saveSession(newPath);
    if (voiceCues) speak("Corrida salva. Bom trabalho!");
  };

  // autopause com base na velocidade suavizada
  useEffect(()=>{
    if (!autoPause || !isRunning) return;
    const v = emaSpeed; // m/s
    if (v < 0.5 && !paused) pauseRun();
    if (v >= 0.8 && paused) resumeRun();
  }, [emaSpeed, autoPause, isRunning, paused]);

  // splits por km
  useEffect(()=>{
    const doneKm = Math.floor(km(distance));
    if (doneKm > kmSplits.length){
      const splitTime = movingTime - (kmSplits.reduce((a,b)=>a+b,0));
      setKmSplits([...kmSplits, splitTime]);
      if (voiceCues) speak(`Quilômetro ${doneKm}. Parcial ${fmtClock(splitTime)}.`);
    }
  }, [distance, movingTime, kmSplits, voiceCues]);

  // cues de ritmo a cada ~30s
  useEffect(()=>{
    if (!voiceCues || !isRunning || paused) return;
    const now = Date.now();
    if (!lastCueAt || now - lastCueAt > 30000){
      setLastCueAt(now);
      const paceSec = emaSpeed > 0 ? 1000 / emaSpeed : null;
      if (!paceSec) return;
      const gap = paceSec - targetPace;
      if (Math.abs(gap) > 6){
        const msg = gap > 0 ? "Acelere levemente para alcançar a meta." : "Segure um pouco, está rápido demais.";
        speak(`${fmtPace(emaSpeed)} por quilômetro. ${msg}`);
      }
    }
  }, [emaSpeed, targetPace, isRunning, paused, voiceCues, lastCueAt]);

  // salvar sessão
  const [sessions, setSessions] = useLocalState<any[]>("motiv.sessions", []);
  const saveSession = (finalPath: GeoPt[]) => {
    if (distance < 50 || finalPath.length < 5) return;
    const s = {
      id: crypto.randomUUID(),
      name: `Corrida ${new Date().toLocaleString()}`,
      distance,
      movingTime,
      avgPace: avgSpeed ? 1000/avgSpeed : 0,
      path: finalPath,
      splits: kmSplits,
      elevGain,
      createdAt: Date.now(),
    };
    setSessions((arr)=>[s, ...arr]);
  };

  // export GPX
  const toGPX = (session:any) => {
    const header = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motiv" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${session.name||"Corrida"}</name><trkseg>`;
    const pts = session.path.map((p:GeoPt)=> `<trkpt lat="${p.lat}" lon="${p.lng}"${typeof p.ele==="number"?`><ele>${p.ele.toFixed(1)}</ele>`:'>'}<time>${new Date(p.ts).toISOString()}</time></trkpt>`).join("");
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

  // UI
  const targetPaceStr = `${Math.floor(targetPace/60)}:${pad(targetPace%60)}`;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="container row jc-sb ai-c">
          <div className="brand">
            <div className="brand-mark">M</div>
            <div className="brand-name">MOTIV</div>
          </div>
          <small>Meta: {targetPaceStr}/km • Prova: {new Date(raceDate).toLocaleDateString()}</small>
        </div>
      </header>

      <main className="container">
        {/* nav topo (desktop) */}
        <div className="row mb12 hide-mobile">
          <button className={`chip ${tab==='corrida'?'chip-active':''}`} onClick={()=>setTab("corrida")}>Corrida</button>
          <button className={`chip ${tab==='plano'?'chip-active':''}`} onClick={()=>setTab("plano")}>Plano</button>
          <button className={`chip ${tab==='historico'?'chip-active':''}`} onClick={()=>setTab("historico")}>Histórico</button>
          <button className={`chip ${tab==='coach'?'chip-active':''}`} onClick={()=>setTab("coach")}>Coach IA</button>
          <button className={`chip ${tab==='config'?'chip-active':''}`} onClick={()=>setTab("config")}>Config</button>
        </div>

        {tab === "corrida" && (
          <section className="grid run-grid">
            <div className="card">
              <div className="map-wrap">
                <MapContainer center={center as any} zoom={15} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {path.length > 0 && <Polyline positions={path.map(p => [p.lat, p.lng]) as any} />}
                  {current && <Marker position={[current.lat, current.lng] as any} icon={L.icon({ iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png", shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png" })} />}
                  <FlyTo latlng={current} />
                </MapContainer>
              </div>

              <div className="bottom-actions">
                {!isRunning && <button className="btn primary" onClick={startRun}>Iniciar</button>}
                {isRunning && !paused && <button className="btn" onClick={pauseRun}>Pausar</button>}
                {isRunning && paused && <button className="btn" onClick={resumeRun}>Retomar</button>}
                {isRunning && <button className="btn danger" onClick={stopRun}>Finalizar</button>}
              </div>
            </div>

            <div className="card kpis">
              <div className="kpi-main">{km(distance).toFixed(2)} <span>km</span></div>
              <div className="kpi-subtitle">Distância</div>

              <div className="kpi-main">{fmtClock(movingTime)}</div>
              <div className="kpi-subtitle">Tempo</div>

              <div className="kpi-row">
                <div>
                  <div className="kpi-secondary">{fmtPace(avgSpeed)}</div>
                  <div className="kpi-subtitle">Pace médio</div>
                </div>
                <div>
                  <div className="kpi-secondary">{fmtPace(emaSpeed)}</div>
                  <div className="kpi-subtitle">Pace atual</div>
                </div>
                <div>
                  <div className="kpi-secondary">{Math.round(elevGain)} m</div>
                  <div className="kpi-subtitle">Ganho ↑</div>
                </div>
              </div>

              <div className="separator" />
              <div className="label">Progresso 21,1 km</div>
              <div className="progress"><div style={{width: `${Math.min(100, (distance/21100)*100)}%`}} /></div>
            </div>
          </section>
        )}

        {tab === "plano" && (
          <section className="card">
            <div className="grid two">
              <div>
                <label className="label">Data da prova</label>
                <input className="input" type="date" value={raceDate} onChange={(e)=>setRaceDate((e.target as HTMLInputElement).value)} />
                <div className="row mt10">
                  <span className="badge">Easy</span>
                  <span className="badge">Intervalado</span>
                  <span className="badge">Tempo</span>
                  <span className="badge">Longão</span>
                </div>
              </div>
              <div>
                <p>Plano automático gerado até a prova. Objetivo: manter {targetPaceStr}/km, subir volume com segurança e progressão semanal.</p>
              </div>
            </div>
          </section>
        )}

        {tab === "historico" && (
          <section className="card">
            <History onDownload={downloadGPX} />
          </section>
        )}

        {tab === "coach" && <CoachChat />}

        {tab === "config" && (
          <section className="card">
            <div className="grid two">
              <div>
                <label className="label">Meta de pace (/km)</label>
                <input className="input" type="time" step="1" value={`${pad(Math.floor(targetPace/60))}:${pad(targetPace%60)}`} onChange={(e)=>{
                  const [mm, ss] = (e.target as HTMLInputElement).value.split(":").map(Number);
                  setTargetPace(mm*60 + ss);
                }} />
                <div className="row mt10">
                  <label className="switch"><input type="checkbox" checked={autoPause} onChange={(e)=>setAutoPause((e.target as HTMLInputElement).checked)} /><span/>Autopausa</label>
                  <label className="switch"><input type="checkbox" checked={voiceCues} onChange={(e)=>setVoiceCues((e.target as HTMLInputElement).checked)} /><span/>Coach de voz</label>
                </div>
              </div>
              <div>
                <p style={{opacity:.8}}>Dicas: ative **Alta Precisão** no GPS; mantenha a tela ligada nos 2 primeiros minutos para o sinal estabilizar; instale como PWA na tela inicial.</p>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* bottom nav (mobile) */}
      <nav className="bottom-nav show-mobile">
        <button className={tab==='corrida'?'active':''} onClick={()=>setTab("corrida")}>Corrida</button>
        <button className={tab==='plano'?'active':''} onClick={()=>setTab("plano")}>Plano</button>
        <button className={tab==='historico'?'active':''} onClick={()=>setTab("historico")}>Histórico</button>
        <button className={tab==='coach'?'active':''} onClick={()=>setTab("coach")}>Coach</button>
        <button className={tab==='config'?'active':''} onClick={()=>setTab("config")}>Config</button>
      </nav>
    </div>
  );
}

// ---------- History
function History({ onDownload }:{ onDownload: (s:any)=>void }){
  const [sessions, setSessions] = useLocalState<any[]>("motiv.sessions", []);
  if (!sessions.length) return <p style={{opacity:.7}}>Sem corridas salvas ainda.</p>;
  return (
    <div className="grid">
      {sessions.map((s:any)=>(
        <div key={s.id} className="card">
          <div className="row jc-sb ai-c">
            <div style={{fontWeight:800}}>{s.name}</div>
            <small>{new Date(s.createdAt).toLocaleString()}</small>
          </div>
          <div className="row mt10">
            {(s.distance/1000).toFixed(2)} km • {fmtClock(s.movingTime)} • pace médio {fmtPace(s.distance/s.movingTime)} • ganho {Math.round(s.elevGain||0)} m
          </div>
          <div className="row mt10">
            <button className="btn" onClick={()=>onDownload(s)}>Baixar GPX</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Chat
function CoachChat(){
  const [chat, setChat] = useLocalState<ChatMessage[]>("motiv.chat", []);
  const [msg, setMsg] = useState<string>("");

  const sendMsg = async () => {
    if (!msg.trim()) return;
    const userMessage: ChatMessage = { role: "user", content: msg, ts: Date.now() };
    setChat((c) => [...c, userMessage]);
    setMsg("");
    try {
      const context = buildContextFromLocal(); // contexto numérico pro coach
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: `Você é um treinador de corrida de elite. Responda em PT-BR, prático e objetivo. Use dados: pace atual/médio, splits, distância, ganho altimétrico. Foque em ações táticas para o próximo km.` },
            ...chat.map(({ role, content }) => ({ role, content })),
            { role: "user", content: `${userMessage.content}\n\nContexto: ${context}` }
          ],
          temperature: 0.2
        })
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "(sem resposta)";
      setChat((c) => [...c, { role: "assistant", content: text, ts: Date.now() }]);
    } catch (e:any) {
      setChat((c) => [...c, { role: "assistant", content: `Erro: ${e.message||e}` }]);
    }
  };

  return (
    <section className="card">
      <div className="chat">
        {chat.map((m, i)=>(
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
      </div>
      <div className="row mt10">
        <textarea className="textarea" rows={2} placeholder="Pergunte sobre treino, estratégia, ritmo..." value={msg} onChange={(e)=>setMsg((e.target as HTMLTextAreaElement).value)} />
        <button className="btn" onClick={sendMsg}>Enviar</button>
      </div>
    </section>
  );
}

function buildContextFromLocal(){
  try {
    const sessions = JSON.parse(localStorage.getItem("motiv.sessions")||"[]");
    const last = sessions[0];
    if (!last) return "Sem sessões salvas";
    const splits = (last.splits||[]).map((s:number,i:number)=>`km${i+1}:${fmtClock(s)}`).join(", ");
    return `dist=${(last.distance/1000).toFixed(2)}km, tempo=${fmtClock(last.movingTime)}, paceMed=${fmtPace(last.distance/last.movingTime)}, ganho=${Math.round(last.elevGain||0)}m, splits=[${splits}]`;
  } catch { return "Sem contexto"; }
}
