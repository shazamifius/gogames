@echo off
REM Lance le pont KataGo puis sert le site en local sur http://localhost:8000
REM Fermer cette fenetre arrete les deux.

cd /d "%~dp0"

if not exist "katago\katago.exe" (
  echo [!] katago\katago.exe est introuvable. Voir la section Installation du README.
  pause
  exit /b 1
)
if not exist "katago\net.bin.gz" (
  echo [!] katago\net.bin.gz est introuvable. Voir la section Installation du README.
  pause
  exit /b 1
)

start "Pont KataGo" cmd /k node server\bridge.js
start "" http://localhost:8000
node -e "const h=require('http'),f=require('fs'),p=require('path');const t={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};h.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u==='/')u='/index.html';const fp=p.join(process.cwd(),u);if(!fp.startsWith(process.cwd())){s.writeHead(403);return s.end();}f.readFile(fp,(e,d)=>{if(e){s.writeHead(404);return s.end('introuvable');}s.writeHead(200,{'Content-Type':t[p.extname(fp)]||'application/octet-stream'});s.end(d);});}).listen(8000,()=>console.log('Site servi sur http://localhost:8000'));"
