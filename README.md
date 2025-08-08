# Motiv — Assistente de Corrida (PWA)

PWA instalável (iPhone/Android) com GPS em tempo real, mapa, pace, plano, histórico e Coach IA via proxy.

## Rodar local
```bash
npm install
cp .env.example .env.local
# edite .env.local e coloque sua DEEPSEEK_API_KEY
npm run dev
```
Abra http://localhost:3000 (ou pelo IP do PC no celular). Permita o GPS no navegador.

## Deploy (Vercel)
1. Suba esse projeto para um repositório (GitHub).
2. Importe na Vercel → Settings → Environment Variables:
   - `DEEPSEEK_API_KEY` = sua chave (não exponha no cliente)
3. Deploy. HTTPS habilitado (necessário p/ geolocalização + PWA).

## PWA
- iOS (Safari): Compartilhar → Adicionar à Tela de Início
- Android (Chrome): Banner "Instalar app"

## Ícones
Arquivos em `public/icons/icon-192.png` e `public/icons/icon-512.png`.
