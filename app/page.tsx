"use client";
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

const CoachApp = dynamic(() => import('../components/CoachApp'), { ssr: false });

export default function Page(){
  return (
    <main>
      <CoachApp />
    </main>
  );
}
