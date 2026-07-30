const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// rooms: code -> { host: ws|null, guest: ws|null }
const rooms = new Map();

function safeSend(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }

    if (data.type === 'host') {
      const code = String(data.room || '').trim().toUpperCase();
      if (!code) return;
      let room = rooms.get(code);
      if (!room) { room = { host: null, guest: null }; rooms.set(code, room); }
      room.host = ws;
      ws.roomCode = code;
      ws.role = 'host';
      safeSend(ws, { type: 'hosted', room: code });
      if (room.guest) safeSend(ws, { type: 'guest-joined' });
    }

    else if (data.type === 'join') {
      const code = String(data.room || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.host) { safeSend(ws, { type: 'join-failed' }); return; }
      room.guest = ws;
      ws.roomCode = code;
      ws.role = 'guest';
      safeSend(ws, { type: 'joined', room: code });
      safeSend(room.host, { type: 'guest-joined' });
    }

    else if (data.type === 'state') {
      // Host -> Gast: kompletter Spielzustand
      const room = rooms.get(ws.roomCode);
      if (room && room.guest) safeSend(room.guest, { type: 'state', payload: data.payload });
    }

    else if (data.type === 'action') {
      // Gast -> Host: eine Bau-/Sende-Aktion
      const room = rooms.get(ws.roomCode);
      if (room && room.host) safeSend(room.host, { type: 'action', payload: data.payload });
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode) return;
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    if (room.host === ws) { room.host = null; safeSend(room.guest, { type: 'opponent-left' }); }
    if (room.guest === ws) { room.guest = null; safeSend(room.host, { type: 'opponent-left' }); }
    if (!room.host && !room.guest) rooms.delete(ws.roomCode);
  });
});

// Tote Verbindungen aufräumen (z.B. Handy-Tab im Hintergrund)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
