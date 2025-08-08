"use client";
export default function BrandHeader({ meta }: { meta: string }) {
  return (
    <header className="topbar">
      <div className="container row between">
        <div className="brand">
          <div className="logo">M</div>
          <span className="brand-name">MOTIV</span>
        </div>
        <small className="meta">{meta}</small>
      </div>
    </header>
  );
}
