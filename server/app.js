import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BankError, readTransactions } from './enable-banking.js';
import { MemorySessionStore } from './session-store.js';
import { checkAccess, issueAccess, passwordMatches } from './access.js';

const COOKIE='mb_bank', ACCESS='mb_access';
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function cookies(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(c=>{const i=c.indexOf('=');return i<0?['','']:[c.slice(0,i).trim(),c.slice(i+1)];}));}
export function createBankHandler({provider,origin,frontend=(_req,res)=>{res.writeHead(404);res.end();},now=Date.now,store=new MemorySessionStore(),accessPassword='',trustVercelProxy=false,missingConfiguration=[]}){
  const expected=new URL(origin),hosted=expected.protocol==='https:';
  if(expected.origin!==origin||!['http:','https:'].includes(expected.protocol)||(expected.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(expected.hostname)))throw new Error('APP_ORIGIN doit être une origine HTTPS, ou HTTP sur localhost.');
  const protectionRequired=hosted||Boolean(accessPassword);
  const readySecurity=!hosted||(store.durable&&accessPassword.length>=16);
  const cookieHeader=(name,value,maxAge)=>`${name}=${value}; HttpOnly; SameSite=Lax; Path=/api/bank${hosted?'; Secure':''}${maxAge!==undefined?`; Max-Age=${maxAge}`:''}`;
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
  function redirect(res,result){res.writeHead(303,{Location:`/?bank=${result}`});res.end();}
  return async(req,res)=>{
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    if(req.headers.host!==expected.host)return json(res,400,{error:'Utilisez l’adresse de production configurée pour ouvrir Mon Budget.'});
    const url=new URL(req.url,origin);
    if(!url.pathname.startsWith('/api/bank/'))return frontend(req,res);
    res.setHeader('Cache-Control','no-store');
    const browserCookies=cookies(req);
    let id=/^[a-f0-9]{64}$/.test(browserCookies[COOKIE]||'')?browserCookies[COOKIE]:null;
    const unlocked=!protectionRequired||checkAccess(browserCookies[ACCESS],accessPassword,origin,now());
    let ip=req.socket?.remoteAddress||'unknown';
    if(trustVercelProxy){const forwarded=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||'').split(',')[0].trim();if(isIP(forwarded))ip=forwarded;}
    const psu={ip,agent:String(req.headers['user-agent']||'').slice(0,500)};
    let release;
    try{
      if(req.method==='GET'&&url.pathname==='/api/bank/status'){
        const session=readySecurity&&unlocked&&id?await store.get(id):null;
        if(session)await store.touch(id);
        const connected=Boolean(session?.bank&&session.expires>now());
        return json(res,200,{diagnosticVersion:1,missingConfiguration,configured:provider.configured&&readySecurity,securityConfigured:readySecurity,requiresPassword:protectionRequired,unlocked,connected,expires:connected?session.expires:null,country:'FR',lastSync:connected?session.lastSync||null:null});
      }
      if(!readySecurity)throw new BankError('Configurez le mot de passe et le stockage sécurisé du serveur avant d’activer la connexion bancaire.',503);
      const callback=req.method==='GET'&&url.pathname==='/api/bank/callback';
      if(!callback&&req.method!=='POST')return json(res,405,{error:'Méthode non autorisée.'});
      let body={};
      if(!callback){
        if(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,403,{error:'Origine de la demande non autorisée.'});
        let raw='';
        // Vercel can parse the body before invoking a Node.js function.
        if(req.body!==undefined)raw=typeof req.body==='string'?req.body:JSON.stringify(req.body);
        else for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw new BankError('Demande trop volumineuse.',413);}
        if(Buffer.byteLength(raw)>2048)throw new BankError('Demande trop volumineuse.',413);
        try{body=JSON.parse(raw||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{throw new BankError('Demande illisible.',400);}
      }
      if(url.pathname==='/api/bank/login'){
        if(!await store.allowed(`login:${ip}`,5,60))throw new BankError('Trop de tentatives. Réessayez dans une minute.',429);
        if(!accessPassword||!passwordMatches(body.password,accessPassword))throw new BankError('Mot de passe incorrect.',401);
        res.setHeader('Set-Cookie',cookieHeader(ACCESS,issueAccess(accessPassword,origin,now()),8*3600));
        return json(res,200,{unlocked:true});
      }
      if(!unlocked)throw new BankError('Déverrouillez l’accès bancaire avec votre mot de passe Mon Budget.',401);
      if(url.pathname==='/api/bank/logout'){res.setHeader('Set-Cookie',cookieHeader(ACCESS,'',0));return json(res,200,{unlocked:false});}
      if(!id){
        if(callback)return redirect(res,'error');
        if(url.pathname!=='/api/bank/connect')throw new BankError('Connectez Revolut pour synchroniser vos opérations.',401);
        if(!await store.allowed(`connect:${ip}`,10,3600))throw new BankError('Trop de demandes de connexion. Réessayez plus tard.',429);
        id=randomBytes(32).toString('hex');
        res.setHeader('Set-Cookie',cookieHeader(COOKIE,id));
      }
      release=await store.acquire(id);
      if(!release)throw new BankError('Une opération bancaire est déjà en cours. Réessayez dans un instant.',429);
      const session=await store.get(id)||{};
      if(callback){
        const pending=session.pending;
        if(!pending||pending.expires<now()||!same(url.searchParams.get('state'),pending.state))return redirect(res,'error');
        delete session.pending;await store.save(id,session);
        if(url.searchParams.has('error')||!url.searchParams.get('code'))return redirect(res,'cancelled');
        const bank=await provider.request('/sessions',{method:'POST',body:{code:url.searchParams.get('code')},psu});
        if(typeof bank?.session_id!=='string'||!Array.isArray(bank.accounts)||!bank.accounts.length)throw new BankError('La connexion bancaire n’a renvoyé aucun compte.');
        session.bank=bank;session.expires=Math.min(pending.validUntil,Date.parse(bank.access?.valid_until)||pending.validUntil);session.cached=null;session.lastSync=null;
        await store.save(id,session);return redirect(res,'connected');
      }
      if(url.pathname==='/api/bank/connect'){
        if(!provider.configured)throw new BankError('Configurez Enable Banking sur le serveur avant de connecter Revolut.',503);
        if(session.lastConnect&&now()-session.lastConnect<30000)throw new BankError('Patientez 30 secondes avant de recommencer la connexion.',429);
        const institutions=await provider.request('/aspsps?country=FR');
        const banks=institutions?.aspsps?.filter(b=>b.country==='FR'&&/revolut/i.test(b.name))||[];
        if(!banks.length)throw new BankError('Revolut France n’est pas disponible pour cette application Enable Banking. Vérifiez son accès en production.',409);
        if(banks.length>1&&!body.bank)return json(res,200,{banks:banks.map(b=>b.name)});
        const bank=banks.find(b=>b.name===body.bank)||(banks.length===1?banks[0]:null);
        if(!bank)throw new BankError('Choisissez une connexion Revolut valide.',400);
        session.lastConnect=now();await store.save(id,session);
        const maxSeconds=Number(bank.maximum_consent_validity);
        const validUntil=now()+Math.min(10*86400,Number.isFinite(maxSeconds)&&maxSeconds>0?maxSeconds:10*86400)*1000;
        const state=randomBytes(32).toString('hex');
        const auth=await provider.request('/auth',{method:'POST',psu,body:{access:{valid_until:new Date(validUntil).toISOString()},aspsp:{name:bank.name,country:'FR'},state,redirect_url:`${origin}/api/bank/callback`,psu_type:'personal'}});
        let target;try{target=new URL(auth.url);}catch{throw new BankError('Adresse d’autorisation bancaire invalide.');}
        if(target.protocol!=='https:'||target.username||target.password)throw new BankError('Adresse d’autorisation bancaire invalide.');
        session.pending={state,expires:now()+10*60000,validUntil};await store.save(id,session);
        return json(res,200,{url:target.href});
      }
      if(!session.bank)throw new BankError('Connectez Revolut pour synchroniser vos opérations.',401);
      if(url.pathname==='/api/bank/disconnect'){
        try{await provider.request(`/sessions/${encodeURIComponent(session.bank.session_id)}`,{method:'DELETE',psu});}catch(error){if(!(error instanceof BankError)||error.status!==409)throw error;}
        delete session.bank;delete session.pending;delete session.cached;await store.save(id,session);
        return json(res,200,{disconnected:true});
      }
      if(url.pathname==='/api/bank/sync'){
        if(session.expires<=now())throw new BankError('Votre autorisation a expiré. Reconnectez Revolut.',409);
        if(session.cached&&now()-session.lastSync<60000)return json(res,200,session.cached);
        const data=await readTransactions(provider,session.bank.accounts,psu);
        session.lastSync=now();session.cached={...data,syncedAt:session.lastSync};await store.save(id,session);
        return json(res,200,session.cached);
      }
      return json(res,404,{error:'Cette route n’existe pas.'});
    }catch(error){
      if(url.pathname==='/api/bank/callback')return redirect(res,'error');
      return json(res,error instanceof BankError?error.status:500,{error:error instanceof BankError?error.message:'La connexion bancaire a rencontré un problème.'});
    }finally{if(release)try{await release();}catch{/* The lease expires automatically; never log session data. */}}
  };
}
export const createBankServer=options=>createServer(createBankHandler(options));
