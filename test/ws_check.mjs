
import http from 'node:http';
import crypto from 'node:crypto';

function connect(port, path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path,
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });
    req.on('upgrade', (res, socket) => {
      const buf = { frames: [] };
      let rest = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        rest = Buffer.concat([rest, chunk]);
        let off = 0;
        while (rest.length - off >= 2) {
          const b1 = rest[off + 1];
          let len = b1 & 0x7f;
          let p = off + 2;
          if (len === 126) { len = rest.readUInt16BE(p); p += 2; }
          else if (len === 127) { len = Number(rest.readBigUInt64BE(p)); p += 8; }
          if (rest.length - p < len) break;
          const opcode = rest[off] & 0x0f;
          const data = rest.subarray(p, p + len);
          if (opcode === 1) {
            try { buf.frames.push(JSON.parse(data.toString())); } catch (e) {}
          }
          off = p + len;
        }
        rest = rest.subarray(off);
      });
      const send = (obj) => {
        const payload = Buffer.from(JSON.stringify(obj));
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(payload);
        for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
        let header;
        if (payload.length < 126) {
          header = Buffer.from([0x81, 0x80 | payload.length]);
        } else {
          header = Buffer.alloc(4);
          header[0] = 0x81; header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
        }
        socket.write(Buffer.concat([header, mask, masked]));
      };
      resolve({ socket, send, get frames() { return buf.frames; } });
    });
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const a = await connect(8132, '/net');
await sleep(200);
const initA = a.frames.find((f) => f.t === 'init');
console.log('A init:', JSON.stringify(initA));

const b = await connect(8132, '/net');
await sleep(200);
const initB = b.frames.find((f) => f.t === 'init');
console.log('B init:', JSON.stringify(initB));

// A moves
a.send({ t: 'pos', x: 10, y: 20, z: 30, yaw: 1.5 });
await sleep(200);
const posB = b.frames.filter((f) => f.t === 'player' && f.id === initA.id);
console.log('B saw A pos:', JSON.stringify(posB[posB.length - 1]));

// A breaks a block
a.send({ t: 'block', x: 5, y: 10, z: 5, id: 0 });
await sleep(200);
const blkB = b.frames.filter((f) => f.t === 'block');
console.log('B saw block edit:', JSON.stringify(blkB[blkB.length - 1]));

// A leaves -> B gets leave
a.socket.end();
await sleep(800);
const leaveB = b.frames.filter((f) => f.t === 'leave');
console.log('B saw leave:', JSON.stringify(leaveB));

// New client C gets the block edit replay
const c = await connect(8132, '/net');
await sleep(300);
const replay = c.frames.filter((f) => f.t === 'block');
console.log('C replay block:', JSON.stringify(replay));

console.log('WS_TEST_DONE');
b.socket.destroy();
c.socket.destroy();
process.exit(0);
