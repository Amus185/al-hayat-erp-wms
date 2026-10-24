// LOCAL DEVELOPMENT ONLY: a tiny in-memory stand-in for Cloudflare R2, so the
// staff app's photo uploads work without the internet or a Cloudflare account.
// It accepts any upload signature and keeps files in memory (gone on restart).
//
//   node backend/scripts/dev-photo-store.mjs            (listens on 127.0.0.1:9100)
//
// Backend env for local runs:
//   R2_ENDPOINT=http://127.0.0.1:9100  R2_BUCKET=photos
//   R2_PUBLIC_BASE_URL=http://127.0.0.1:9100/photos
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY = any non-empty value
import http from 'node:http';

const PORT = Number(process.env.DEV_PHOTO_STORE_PORT || 9100);
const store = new Map();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, HEAD, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Type, ETag',
};

http.createServer((req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://local').pathname);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      store.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] || 'application/octet-stream' });
      res.writeHead(200, cors);
      res.end();
    });
    return;
  }
  if (req.method === 'DELETE') { store.delete(key); res.writeHead(204, cors); res.end(); return; }
  const obj = store.get(key);
  if (!obj) { res.writeHead(404, cors); res.end(); return; }
  res.writeHead(200, { ...cors, 'Content-Length': obj.body.length, 'Content-Type': obj.type });
  res.end(req.method === 'HEAD' ? undefined : obj.body);
}).listen(PORT, '127.0.0.1', () => console.log(`Local photo store on http://127.0.0.1:${PORT} (in memory, development only)`));
