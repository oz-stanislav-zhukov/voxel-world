// Voxel World multiplayer server (no dependencies).
// Serves the built game from dist/ and a WebSocket at /net.
// Protocol (JSON):
//   server -> client: {t:'init', id, color} | {t:'block', x,y,z,id} | {t:'player', id,x,y,z,yaw,color} | {t:'leave', id}
//   client -> server: {t:'pos', x,y,z,yaw} | {t:'block', x,y,z,id}
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = process.env.PORT ? Number(process.env.PORT) : 8132;
const DIST = join(process.cwd(), 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

// Shared block edits across all clients: "x,y,z" -> id
const edits = new Map();
const clients = new Map(); // ws -> { id, color }
const COLORS = [0x34d399, 0xf59e0b, 0x60a5fa, 0xf472b6, 0xa78bfa, 0xf87171];
let nextId = 1;

// ---------- WebSocket (RFC 6455, minimal) ----------
function wsAccept(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function encodeFrame(payload, opcode = 1) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

function decodeFrames(buf) {
  // Returns { frames: Buffer[], rest: Buffer }
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    let mask = null;
    if (masked) {
      if (buf.length - p < 4) break;
      mask = buf.subarray(p, p + 4);
      p += 4;
    }
    if (buf.length - p < len) break;
    let data = buf.subarray(p, p + len);
    if (mask) {
      data = Buffer.from(data);
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    }
    frames.push({ opcode, data: Buffer.from(data) });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

function broadcast(obj, exceptWs) {
  const payload = encodeFrame(Buffer.from(JSON.stringify(obj)));
  for (const [ws, c] of clients) {
    if (ws === exceptWs || ws.readyState !== 'open') continue;
    try { ws.write(payload); } catch (e) {}
  }
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/net')) {
    res.writeHead(400).end();
    return;
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = normalize(file).replace(/^\.\.[/\\]/, '');
  try {
    const data = await readFile(join(DIST, file));
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(404).end('Not found');
  }
});

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/net')) {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + 'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );

  const id = 'p' + nextId++;
  const color = COLORS[(nextId - 2) % COLORS.length];
  const c = { id, color };
  clients.set(socket, c);
  let buf = Buffer.alloc(0);

  const send = (obj) => {
    try { socket.write(encodeFrame(Buffer.from(JSON.stringify(obj)))); } catch (e) {}
  };

  // Hello: identity + all current block edits
  send({ t: 'init', id, color });
  for (const [k, bid] of edits) {
    const [x, y, z] = k.split(',').map(Number);
    send({ t: 'block', x, y, z, id: bid });
  }
  // Tell everyone about the newcomer
  broadcast({ t: 'player', id, x: 0, y: 0, z: 0, yaw: 0, color, join: true }, socket);

  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const { frames, rest } = decodeFrames(buf);
    buf = rest;
    for (const f of frames) {
      if (f.opcode === 8) { socket.end(); return; }
      if (f.opcode === 9) { try { socket.write(encodeFrame(f.data, 10)); } catch (e) {} continue; }
      if (f.opcode !== 1) continue;
      let msg;
      try { msg = JSON.parse(f.data.toString()); } catch (e) { continue; }
      if (msg.t === 'pos') {
        broadcast({ t: 'player', id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, color }, socket);
      } else if (msg.t === 'block') {
        const k = msg.x + ',' + msg.y + ',' + msg.z;
        edits.set(k, msg.id);
        broadcast({ t: 'block', x: msg.x, y: msg.y, z: msg.z, id: msg.id }, socket);
      }
    }
  });

  socket.on('end', () => {
    // Client closed the TCP side: answer with a WS close frame, then tear down.
    try { socket.write(encodeFrame(Buffer.alloc(0), 8)); } catch (e) {}
    socket.destroy();
  });
  socket.on('close', () => {
    clients.delete(socket);
    broadcast({ t: 'leave', id }, null);
  });
  socket.on('error', () => { try { socket.destroy(); } catch (e) {} });
});

server.listen(PORT, () => {
  console.log('Voxel World server: http://localhost:' + PORT + '  (ws: /net)');
});
