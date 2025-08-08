import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Motiv — Assistente de Corrida (PWA)',
  description: 'Coach Online com GPS, pace e plano de treino',
  icons: [
    { rel: 'icon', url: '/icons/icon-192.png' },
    { rel: 'apple-touch-icon', url: '/icons/icon-192.png' },
  ],
  manifest: '/manifest.webmanifest',
  themeColor: '#0E4DFF',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

function ServiceWorkerRegister() {
  return (
    <script dangerouslySetInnerHTML={{ __html: `
      if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(()=>{});
        });
      }
    `}} />
  );
}
