import { createServer as createViteServer } from 'vite';
import { createBankServer } from '../server/app.js';
import { configuration } from '../server/config.js';
const config = configuration();
let vite;
const server = createBankServer({ ...config, frontend:(req,res)=>vite.middlewares(req,res) });
vite = await createViteServer({ server: { middlewareMode:true, hmr:{server} }, appType:'spa' });
server.listen(Number(process.env.PORT || 5173),process.env.HOST || '127.0.0.1',()=>console.log('Mon Budget : ouvrez l’adresse définie dans APP_ORIGIN (par défaut http://localhost:5173).'));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal,async()=>{ await vite.close(); server.close(()=>process.exit(0)); server.closeAllConnections(); });
