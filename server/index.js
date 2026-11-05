import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createBankServer } from './app.js';
import { configuration } from './config.js';
const root = resolve('dist');
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
const server = createBankServer({ ...configuration(), frontend:async(req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  let path;
  try { path = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  const target = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!target.startsWith(root + '/')) { res.writeHead(403); return res.end(); }
  try { const data = await readFile(target); res.setHeader('Content-Type',types[extname(target)] || 'application/octet-stream'); res.end(req.method === 'HEAD' ? undefined : data); }
  catch { res.writeHead(404); res.end('Page introuvable'); }
} });
server.listen(Number(process.env.PORT || 5173),process.env.HOST || '127.0.0.1',()=>console.log('Mon Budget : serveur démarré.'));
