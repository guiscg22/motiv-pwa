"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import BrandHeader from "./BrandHeader";
import BottomTabs from "./BottomTabs";

type ChatMessage = { role: "user" | "assistant"; content: string; ts?: number };
type GeoPt = { lat: number; lng: number; ts: number; acc?: number; ele?: number; spd?: number };
type Goal =
  | { type: "distance"; distanceKm: number; targetPaceSecPerKm?: number }
  | { type: "time"; timeSec: number; distanceKm?: number };

const pad = (n:number)=>String(n).padStart(2,"0");
const km = (m:number)=>m/1000;
const fmtClock = (s:number)=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return h>0?`${pad(h)}:${pad(m)}:${pad(sec)}`:`${pad(m)}:${pad(sec)}`;};
const fmtPace = (mps:number|null)=>{ if(!mps||mps<=0) return "--:--"; const t=1000/mps; const m=Math.floor(t/60), s=Math.round(t%60); return `${pad(m)}:${pad(s)}`; };
const haversine=(a:GeoPt,b:GeoPt)=>{const R=6371000,toR=(x:number)=>(x*Math.PI)/180;const dLat=toR(b.lat-a.lat),dLon=toR(b.lng-a.lng),lat1=toR(a.lat),lat2=toR(b.lat);const s1=Math.sin(dLat/2),s2=Math.sin(dLon/2);const aa=s1*s1+Math.cos(lat1)*Math.cos(lat2)*s2*s2;return 2*R*Math.atan2(Math.sqrt(aa),Math.sqrt(1-aa));};

// localStorage state
function useLocalState<T>(key:string, initial:T): [T, React.Dispatch<React.SetStateAction<T>>]{
  const [state, setState] = useState<T>(()=>{ try{const raw=localStorage.getItem(key); return raw?JSON.parse(raw):initial;}catch{return initial;} });
  useEffect(()=>{ try{localStorage.setItem(key, JSON.stringify(state));}catch{}},[key,state]);
  return [state, setState];
}
function FlyTo({ latlng }:{latlng:any}){ const map=useMap(); useEffect(()=>{ if(latlng) map.flyTo(latlng,16);},[latlng]); return null;}
function speak(text:string){ try{ const u=new SpeechSynthesisUtterance(text); u.lang="pt-BR"; u.rate=1; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);}catch{} }

export default function CoachApp(){
  const [tab, setTab] = useLocalState("motiv.tab","corrida");
  const [raceDate, setRaceDate] = useLocalState("motiv.raceDate","2025-10-12");
  const [targetPace, setTargetPace] = useLocalState<number>("motiv.target", 280);
  const [autoPause, setAutoPause] = useLocalState<boolean>("motiv.autopause", true);
  const [voiceCues, setVoiceCues] = useLocalState<boolean>("motiv.voice", true);
  const [goal, setGoal] = useLocalState<Goal | null>("motiv.goal", null);

  // telemetria
  const [watchId, setWatchId] = useState<number|null>(null);
  const [path, setPath] = useState<GeoPt[]>([]);
  const [distance, setDistance] = useState(0);
  const [movingTime, setMovingTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [emaSpeed, setEmaSpeed] = useState(0);
  const [kmSplits, setKmSplits] = useState<number[]>([]);
  const [elevGain, setElevGain] = useState(0);
  const [goalModal, setGoalModal] = useState(false);
  const [lastCueAt, setLastCueAt] = useState<number|null>(null);
  const [lastCoachDist, setLastCoachDist] = useState(0);

  const current = path[path.length-1] || null;
  const center = current ? {lat:current.lat, lng:current.lng} : {lat:-19.918, lng:-43.938};
  const avgSpeed = useMemo(()=> distance>0&&movingTime>0? distance/movingTime : 0, [distance,movingTime]);
  const metaStr = `Meta: ${Math.floor(targetPace/60)}:${pad(targetPace%60)}/km • Prova: ${new Date(raceDate).toLocaleDateString()}`;

  // relógio
  useEffect(()=>{ if(!isRunning || paused) return; const t=setInterval(()=>setMovingTime(s=>s+1),1000); return ()=>clearInterval(t); },[isRunning,paused]);

  // push point (EMA + fusão com speed do GPS)
  const pushPoint = useCallback((pt:GeoPt)=>{
    setPath(prev=>{
      const last=prev[prev.length-1];
      let add=true;
      if (typeof pt.acc==="number" && pt.acc>30) add=false;
      if (last){
        const d=haversine(last,pt);
        if (d<2) add=false; // ruído parado
        if (add){
          const dt=Math.max(0.5,(pt.ts-last.ts)/1000);
          const segSpeed=d/dt;
          const gpsSpeed=Number.isFinite(pt.spd)?pt.spd!:null;
          const fused=gpsSpeed===null?segSpeed:0.6*segSpeed+0.4*gpsSpeed;
          const sane=Math.min(9,Math.max(0,fused));
          const alpha=0.35;
          setEmaSpeed(s=>s?alpha*sane+(1-alpha)*s:sane);
          setDistance(x=>x+d);
          if (typeof pt.ele==="number" && typeof last.ele==="number"){ const up=pt.ele-last.ele; if (up>0.5) setElevGain(g=>g+up); }
        }
      }
      return add?[...prev,pt]:prev;
    });
  },[]);

  const onPosition = useCallback((pos:GeolocationPosition)=>{
    const { latitude, longitude, speed, accuracy, altitude } = pos.coords as any;
    const pt:GeoPt={ lat:latitude, lng:longitude, ts:pos.timestamp||Date.now(), acc:accuracy, ele:(typeof altitude==="number"?altitude:undefined), spd:(Number.isFinite(speed)?speed:undefined) };
    pushPoint(pt);
  },[pushPoint]);

  const onError = useCallback((e:any)=>{ console.error(e); alert("Ative o GPS de alta precisão e permita o acesso."); },[]);

  // iniciar: abre modal de objetivo
  const startRun = ()=> setGoalModal(true);
  const confirmGoalAndStart = (g:Goal)=>{
    setGoal(g);
    if (g.type==="distance" && g.targetPaceSecPerKm) setTargetPace(g.targetPaceSecPerKm);
    if (!navigator.geolocation){ alert("Geolocalização não suportada."); return; }
    setIsRunning(true); setPaused(false);
    setPath([]); setDistance(0); setMovingTime(0); setKmSplits([]); setEmaSpeed(0); setElevGain(0);
    const id=navigator.geolocation.watchPosition(onPosition,onError,{ enableHighAccuracy:true, maximumAge:0, timeout:10000 });
    // @ts-ignore
    setWatchId(id); setGoalModal(false); setLastCueAt(Date.now()); setLastCoachDist(0);
    if (voiceCues) speak("Iniciando corrida. Vamos atingir sua meta.");
  };

  const pauseRun = ()=>{ if(watchId!==null){ navigator.geolocation.clearWatch(watchId); setWatchId(null);} setPaused(true); if(voiceCues) speak("Pausa ativada."); };
  const resumeRun = ()=>{ const id=navigator.geolocation.watchPosition(onPosition,onError,{ enableHighAccuracy:true, maximumAge:0, timeout:10000 }); // @ts-ignore
    setWatchId(id); setPaused(false); if(voiceCues) speak("Voltando ao treino."); };

  const [sessions, setSessions] = useLocalState<any[]>("motiv.sessions",[]);
  const stopRun = async ()=>{
    if(watchId!==null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null); setIsRunning(false); setPaused(false);
    let finalPath=[...path];
    try{
      const bare=finalPath.map(p=>({lat:p.lat,lng:p.lng,ts:p.ts}));
      const r=await fetch("/api/elev",{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ points: bare }) });
      if(r.ok){ const d=await r.json(); if(Array.isArray(d?.elevations)){
        finalPath=finalPath.map((p,i)=>({ ...p, ele: d.elevations[i] ?? p.ele }));
        let g=0; for(let i=1;i<finalPath.length;i++){ const a=finalPath[i-1].ele,b=finalPath[i].ele; if(typeof a==="number"&&typeof b==="number"){ const up=b-a; if(up>0.5) g+=up; } }
        setElevGain(g);
      }}
    }catch{}
    if(distance>=50 && finalPath.length>=5){
      const s={ id:crypto.randomUUID(), name:`Corrida ${new Date().toLocaleString()}`, distance, movingTime, avgPace:(distance>0&&movingTime>0)?1000/(distance/movingTime):0, path:finalPath, splits:kmSplits, elevGain, goal, createdAt:Date.now() };
      setSessions(arr=>[s,...arr]);
    }
    if (voiceCues) speak("Corrida salva. Bom trabalho!");
  };

  // autopausa
  useEffect(()=>{ if(!autoPause||!isRunning) return; if(emaSpeed<0.5 && !paused) pauseRun(); if(emaSpeed>=0.8 && paused) resumeRun(); },[emaSpeed,autoPause,isRunning,paused]);

  // splits
  useEffect(()=>{
    const doneKm=Math.floor(km(distance));
    if(doneKm>kmSplits.length){
      const splitTime=movingTime-kmSplits.reduce((a,b)=>a+b,0);
      setKmSplits([...kmSplits,splitTime]);
      if(voiceCues) speak(`Quilômetro ${doneKm}. Parcial ${fmtClock(splitTime)}.`);
    }
  },[distance,movingTime,kmSplits,voiceCues]);

  // coach ao vivo (a cada 20s OU 200m)
  useEffect(()=>{
    if(!isRunning||paused) return;
    const maybe=async ()=>{
      const now=Date.now();
      const distKm=km(distance);
      const distDelta=(distKm-lastCoachDist)*1000;
      const byTime=!lastCueAt || (now-lastCueAt>20000);
      const byDist=distDelta>=200;
      if(!byTime && !byDist) return;
      setLastCueAt(now); setLastCoachDist(distKm);

      const snapshot={
        ts:now,
        distance_km:Number(distKm.toFixed(2)),
        time_s:movingTime,
        pace_current:fmtPace(emaSpeed),
        pace_avg:fmtPace(avgSpeed),
        elev_gain_m:Math.round(elevGain),
        split_last_s:kmSplits[kmSplits.length-1]||null,
        goal,
      };
      try{
        const r=await fetch("/api/chat",{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ model:"deepseek-chat", temperature:0.2, messages:[{ role:"user", content:`Snapshot: ${JSON.stringify(snapshot)}` }] }) });
        const d=await r.json(); const text=d?.choices?.[0]?.message?.content || "";
        if(text && voiceCues) speak(text);
      }catch{}
    };
    const t=setInterval(maybe,4000);
    return ()=>clearInterval(t);
  },[isRunning,paused,distance,movingTime,emaSpeed,avgSpeed,elevGain,kmSplits,goal,lastCueAt,lastCoachDist,voiceCues]);

  // UI
  const kpi = {
    dist: km(distance).toFixed(2),
    time: fmtClock(movingTime),
    paceAvg: fmtPace(avgSpeed),
    paceNow: fmtPace(emaSpeed),
    gain: Math.round(elevGain),
  };

  return (
    <>
      <BrandHeader meta={metaStr} />
      <main className="container app">
        {/* Nav desktop */}
        <div className="tabs-desktop">
          {["corrida","plano","historico","coach","config"].map(k=>(
            <button key={k} className={`chip ${tab===k?"active":""}`} onClick={()=>setTab(k)}>
              {k[0].toUpperCase()+k.slice(1)}
            </button>
          ))}
        </div>

        {tab==="corrida" && (
          <section className="run-layout">
            <article className="card map-card">
              <div className="map-wrap">
                <MapContainer center={center as any} zoom={15} style={{ height: "100%", width: "100%" }}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {path.length>0 && <Polyline positions={path.map(p=>[p.lat,p.lng]) as any} />}
                  {current && <Marker position={[current.lat,current.lng] as any} icon={L.icon({ iconUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png", shadowUrl:"https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png" })} />}
                  <FlyTo latlng={current} />
                </MapContainer>
                <div className="pill">{kpi.time} • {kpi.paceNow}/km</div>
              </div>
              <div className="row gap">
                {!isRunning && <button className="btn primary" onClick={startRun}>Iniciar</button>}
                {isRunning && !paused && <button className="btn" onClick={pauseRun}>Pausar</button>}
                {isRunning && paused && <button className="btn" onClick={resumeRun}>Retomar</button>}
                {isRunning && <button className="btn danger" onClick={stopRun}>Finalizar</button>}
              </div>
            </article>

            <aside className="card kpis">
              <div className="kpi big">{kpi.dist} <span>km</span></div>
              <div className="kpi-sub">Distância</div>

              <div className="kpi big">{kpi.time}</div>
              <div className="kpi-sub">Tempo</div>

              <div className="row kpi-row">
                <div>
                  <div className="kpi">{kpi.paceAvg}</div>
                  <div className="kpi-sub">Pace médio</div>
                </div>
                <div>
                  <div className="kpi">{kpi.paceNow}</div>
                  <div className="kpi-sub">Pace atual</div>
                </div>
                <div>
                  <div className="kpi">{kpi.gain} m</div>
                  <div className="kpi-sub">Ganho ↑</div>
                </div>
              </div>

              <div className="separator" />
              <div className="label">Progresso 21,1 km</div>
              <div className="progress"><div style={{width:`${Math.min(100,(distance/21100)*100)}%`}} /></div>
            </aside>
          </section>
        )}

        {tab==="historico" && <HistoryCard />}

        {tab==="coach" && <CoachChat />}

        {tab==="plano" && (
          <section className="card">
            <h3>Plano</h3>
            <p>Plano automático até a prova. (Próximo passo: modos intervalado/tempo e semanas periodizadas.)</p>
          </section>
        )}

        {tab==="config" && (
          <section className="card grid2">
            <div>
              <label className="label">Meta base de pace (/km)</label>
              <input className="input" type="time" step="1"
                value={`${pad(Math.floor(targetPace/60))}:${pad(targetPace%60)}`}
                onChange={(e)=>{ const [mm,ss]=(e.target as HTMLInputElement).value.split(":").map(Number); setTargetPace(mm*60+ss); }} />
              <div className="row gap">
                <label className="flex"><input type="checkbox" checked={autoPause} onChange={(e)=>setAutoPause((e.target as HTMLInputElement).checked)} />&nbsp;Autopausa</label>
                <label className="flex"><input type="checkbox" checked={voiceCues} onChange={(e)=>setVoiceCues((e.target as HTMLInputElement).checked)} />&nbsp;Coach de voz</label>
              </div>
            </div>
            <div><p style={{opacity:.8}}>Dicas: Ative alta precisão do GPS. Instale como PWA para trancar a tela e rodar suave.</p></div>
          </section>
        )}
      </main>

      {/* Tabs fixas no mobile */}
      <BottomTabs tab={tab} setTab={setTab} />

      {/* Modal de objetivo */}
      {goalModal && <GoalModal onClose={()=>setGoalModal(false)} onConfirm={confirmGoalAndStart} />}
    </>
  );
}

function HistoryCard(){
  const [sessions] = useLocalState<any[]>("motiv.sessions",[]);
  if(!sessions.length) return <section className="card"><p style={{opacity:.7}}>Sem corridas salvas ainda.</p></section>;
  return (
    <section className="grid-history">
      {sessions.map((s:any)=>(
        <article key={s.id} className="card">
          <div className="row between">
            <div>
              <div className="title">{s.name}</div>
              <small>{new Date(s.createdAt).toLocaleString()}</small>
            </div>
            <div className="pill small">{(s.distance/1000).toFixed(2)} km • {fmtClock(s.movingTime)}</div>
          </div>
          <div className="muted">pace méd {fmtPace(s.distance/s.movingTime)} • ganho {Math.round(s.elevGain||0)} m</div>
          <div className="row"><button className="btn" onClick={()=>{
            const gpx = toGPX(s); const blob=new Blob([gpx],{type:"application/gpx+xml"});
            const url=URL.createObjectURL(blob); const a=document.createElement("a");
            a.href=url; a.download=`${s.name.replace(/\s+/g,'_')}.gpx`; a.click(); URL.revokeObjectURL(url);
          }}>Baixar GPX</button></div>
        </article>
      ))}
    </section>
  );
}

function toGPX(session:any){
  const header=`<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Motiv" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${session.name||"Corrida"}</name><trkseg>`;
  const pts=session.path.map((p:GeoPt)=>`<trkpt lat="${p.lat}" lon="${p.lng}">${typeof p.ele==="number"?`<ele>${p.ele.toFixed(1)}</ele>`:''}<time>${new Date(p.ts).toISOString()}</time></trkpt>`).join("");
  return header+pts+`</trkseg></trk></gpx>`;
}

function CoachChat(){
  const [chat, setChat] = useLocalState<ChatMessage[]>("motiv.chat",[]);
  const [msg, setMsg] = useState("");
  const send = async ()=>{
    if(!msg.trim()) return;
    const userMsg:{role:"user";content:string;ts:number}={ role:"user", content:msg, ts:Date.now() };
    setChat(c=>[...c,userMsg]); setMsg("");
    try{
      const r=await fetch("/api/chat",{ method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ model:"deepseek-chat", temperature:0.2, messages:[{ role:"user", content: msg }]}) });
      const d=await r.json(); const text=d?.choices?.[0]?.message?.content || "(sem resposta)";
      setChat(c=>[...c,{ role:"assistant", content:text, ts:Date.now() }]);
    }catch(e:any){ setChat(c=>[...c,{ role:"assistant", content:`Erro: ${e.message||e}` }]); }
  };
  return (
    <section className="card">
      <div className="chat">
        {chat.map((m,i)=>(
          <div key={i} className={`bubble ${m.role}`}>{m.content}</div>
        ))}
      </div>
      <div className="row gap">
        <textarea className="textarea" rows={2} placeholder="Pergunte sobre ritmo, prova, estratégia…" value={msg} onChange={e=>setMsg((e.target as HTMLTextAreaElement).value)} />
        <button className="btn primary" onClick={send}>Enviar</button>
      </div>
    </section>
  );
}

function GoalModal({ onClose, onConfirm }:{ onClose:()=>void; onConfirm:(g:Goal)=>void; }){
  const [mode, setMode]=useState<"distance"|"time">("distance");
  const [dist, setDist]=useState(5);
  const [pace, setPace]=useState("04:40");
  const [time, setTime]=useState("00:30:00");
  const parsePace=(s:string)=>{ const [m,sec]=s.split(":").map(Number); return (m||0)*60+(sec||0); };
  const parseTime=(s:string)=>{ const [h,m,sec]=s.split(":").map(Number); return (h||0)*3600+(m||0)*60+(sec||0); };

  return (
    <div className="modal">
      <div className="card modal-card">
        <h3>Definir objetivo</h3>
        <div className="row gap">
          <button className={`chip ${mode==="distance"?"active":""}`} onClick={()=>setMode("distance")}>Por distância</button>
          <button className={`chip ${mode==="time"?"active":""}`} onClick={()=>setMode("time")}>Por tempo</button>
        </div>
        {mode==="distance" ? (
          <div className="grid2">
            <div>
              <label className="label">Distância (km)</label>
              <input className="input" type="number" min={1} step={0.5} value={dist} onChange={e=>setDist(Number((e.target as HTMLInputElement).value))} />
            </div>
            <div>
              <label className="label">Pace alvo (/km)</label>
              <input className="input" type="text" placeholder="MM:SS" value={pace} onChange={e=>setPace((e.target as HTMLInputElement).value)} />
            </div>
          </div>
        ) : (
          <div>
            <label className="label">Tempo alvo (HH:MM:SS)</label>
            <input className="input" type="text" placeholder="00:45:00" value={time} onChange={e=>setTime((e.target as HTMLInputElement).value)} />
          </div>
        )}
        <div className="row end gap">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={()=> mode==="distance"
            ? onConfirm({ type:"distance", distanceKm:dist, targetPaceSecPerKm:parsePace(pace) })
            : onConfirm({ type:"time", timeSec:parseTime(time) })
          }>Começar</button>
        </div>
      </div>
    </div>
  );
}
