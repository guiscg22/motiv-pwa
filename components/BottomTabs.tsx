"use client";
export default function BottomTabs({ tab, setTab }:{
  tab: string; setTab: (t:string)=>void;
}) {
  const items = [
    { k:"corrida", label:"Corrida" },
    { k:"plano",   label:"Plano" },
    { k:"historico", label:"Histórico" },
    { k:"coach",   label:"Coach" },
    { k:"config",  label:"Config" },
  ];
  return (
    <nav className="tabs-mobile">
      {items.map(it=>(
        <button key={it.k}
          className={`tab-btn ${tab===it.k?"active":""}`}
          onClick={()=>setTab(it.k)}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}
