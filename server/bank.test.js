import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBankServer, createBankHandler } from './app.js';
import { MemorySessionStore } from './session-store.js';
import { createProvider, normalizeTransactions, readTransactions } from './enable-banking.js';

const operation = { transaction_id:'tx-1', status:'BOOK', booking_date:'2026-11-01', transaction_amount:{amount:'12.50',currency:'EUR'}, credit_debit_indicator:'DBIT', remittance_information:['Courses'] };

test('normalise uniquement les opérations comptabilisées en EUR, avec un identifiant stable',()=>{
 const result = normalizeTransactions('account',[operation,{...operation,status:'PDNG'},{...operation,transaction_amount:{amount:'5',currency:'USD'}},{...operation,booking_date:'2026-02-30'},{...operation,transaction_id:null},{...operation,transaction_amount:{amount:'1.001',currency:'EUR'}}]);
 assert.equal(result.transactions.length,1);assert.equal(result.transactions[0].amount,12.5);assert.equal(result.transactions[0].type,'expense');assert.equal(result.transactions[0].category,'Autres');
 assert.deepEqual(result.skipped,{pending:1,currency:1,invalid:3,status:0,zero:0});
 assert.equal(result.transactions[0].id,normalizeTransactions('account',[operation]).transactions[0].id);
 assert.notEqual(result.transactions[0].id,normalizeTransactions('another-account',[operation]).transactions[0].id);
 assert.equal(normalizeTransactions('account',[{...operation,credit_debit_indicator:'CRDT'}]).transactions[0].type,'income');
});

test('suit la pagination et refuse une réponse incomplète sans import partiel',async()=>{
 const calls=[];
 const provider={request:async path=>{calls.push(path);return calls.length===1?{transactions:[operation],continuation_key:'next&key'}:{transactions:[{...operation,transaction_id:'tx-2'}]};}};
 const result=await readTransactions(provider,[{uid:'account'}],{});
 assert.equal(result.transactions.length,2);assert.match(calls[1],/continuation_key=next%26key/);
 await assert.rejects(readTransactions({request:async()=>({transactions:[operation],continuation_key:'same'})},['account'],{}),/incomplète/);
 await assert.rejects(readTransactions({request:async()=>({})},['account'],{}),/absente/);
});

test('conserve les identifiants à la reconnexion si l’IBAN est fourni, sans l’exposer',async()=>{
 const provider={request:async()=>({transactions:[operation]})};
 const account_id={iban:'FR76 3000 6000 0112 3456 7890 189'};
 const first=await readTransactions(provider,[{uid:'session-1',account_id}],{});
 const next=await readTransactions(provider,[{uid:'session-2',account_id}],{});
 assert.equal(first.transactions[0].id,next.transactions[0].id);
 assert.equal(first.unstableAccounts,0);assert.ok(!JSON.stringify(first).includes('3000'));
 const fallback=await readTransactions(provider,['session-1'],{});assert.equal(fallback.unstableAccounts,1);
});

test('signe un JWT RS256 côté serveur et ne divulgue pas les erreurs du prestataire',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'mb-bank-test-'));
 try {
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const path=join(dir,'test.pem');await writeFile(path,privateKey.export({format:'pem',type:'pkcs8'}));
  const provider=createProvider({appId:'app-test',keyPath:path,fetchImpl:async(url,options)=>{
   assert.equal(url,'https://api.enablebanking.com/aspsps');
   const token=options.headers.Authorization.slice(7),parts=token.split('.');
   assert.deepEqual(JSON.parse(Buffer.from(parts[0],'base64url')),{typ:'JWT',alg:'RS256',kid:'app-test'});
   assert.equal(verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),publicKey,Buffer.from(parts[2],'base64url')),true);
   assert.equal(JSON.parse(Buffer.from(parts[1],'base64url')).aud,'api.enablebanking.com');
   return new Response(JSON.stringify({secret:'NEVER_EXPOSE'}),{status:403});
  }});
  await assert.rejects(provider.request('/aspsps'),error=>error.message.includes('Accès refusé')&&!error.message.includes('NEVER_EXPOSE'));
 } finally { await rm(dir,{recursive:true,force:true}); }
});

async function fixture(t,options={}) {
 let authBody,sessionCreates=0;
 const provider={configured:true,request:async(path,request={})=>{
  if(path.startsWith('/aspsps'))return{aspsps:[{name:'Revolut',country:'FR'}]};
  if(path==='/auth'){authBody=request.body;return{url:'https://bank.example/authorize'};}
  if(path==='/sessions'){sessionCreates++;return{session_id:'provider-session-SECRET',accounts:[{uid:'account'}]};}
  if(path==='/sessions/provider-session-SECRET'&&request.method==='DELETE')return null;
  if(path.endsWith('/balances'))return{balances:[{balance_amount:{amount:'263.18',currency:'EUR'},balance_type:'ITAV'}]};
  if(path.startsWith('/accounts/'))return{transactions:[operation]};
  throw new Error('Unexpected provider route');
 }};
 const origin=options.origin || 'http://localhost:5179';
 const server=createBankServer({provider,...options,origin,frontend:(_req,res)=>res.end('app')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const jar=new Map();
 const cookie=()=>[...jar].map(([k,v])=>`${k}=${v}`).join('; ');
 const request=async(path,{method='GET',body,customOrigin=origin,withCookie=true}={})=>{
  const headers={host:new URL(origin).host,...(withCookie&&jar.size?{cookie:cookie()}:{}),...(method==='POST'?{Origin:customOrigin,'Content-Type':'application/json'}:{})};
  const response=await new Promise((resolve,reject)=>{
   const req=httpRequest(base+path,{method,headers},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const response=new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers});response.cookies=res.headers['set-cookie']||[];resolve(response);});
   });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  for(const value of response.cookies){const pair=value.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  return response;
 };
 return{request,getAuth:()=>authBody,getCreates:()=>sessionCreates};
}

test('consentement lié au navigateur, état à usage unique, synchronisation et révocation',async t=>{
 const f=await fixture(t);
 assert.equal((await (await f.request('/api/bank/status')).json()).connected,false);
 assert.equal((await f.request('/api/bank/sync',{method:'POST',body:{}})).status,401);
 assert.equal((await f.request('/api/bank/connect',{method:'POST',body:{},customOrigin:'https://evil.example'})).status,403);
 const connect=await f.request('/api/bank/connect',{method:'POST',body:{}});
 assert.equal(connect.status,200);assert.match(connect.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);
 assert.equal(f.getAuth().psu_type,'personal');assert.equal(f.getAuth().aspsp.country,'FR');assert.equal(f.getAuth().redirect_url,'http://localhost:5179/api/bank/callback');
 const cb=`/api/bank/callback?code=secret-code&state=${f.getAuth().state}`;
 assert.equal((await f.request(cb,{withCookie:false})).headers.get('location'),'/?bank=error');
 assert.equal((await f.request('/api/bank/callback?code=secret-code&state=wrong')).headers.get('location'),'/?bank=error');
 assert.equal(f.getCreates(),0);
 assert.equal((await f.request(cb)).headers.get('location'),'/?bank=connected');
 assert.equal((await f.request(cb)).headers.get('location'),'/?bank=error');assert.equal(f.getCreates(),1);
 const status=await (await f.request('/api/bank/status')).text();assert.equal(JSON.parse(status).connected,true);assert.ok(!status.includes('SECRET'));
 const synced=await (await f.request('/api/bank/sync',{method:'POST',body:{}})).json();assert.equal(synced.transactions.length,1);
 const balances=await (await f.request('/api/bank/balances',{method:'POST',body:{}})).json();assert.equal(balances.accounts[0].balances[0].amount,263.18);
 assert.equal((await f.request('/api/bank/balances',{method:'POST',body:{},withCookie:false})).status,401);
 assert.equal((await f.request('/api/bank/sync',{method:'POST',body:{},withCookie:false})).status,401);
 assert.equal((await f.request('/api/bank/disconnect',{method:'POST',body:{}})).status,200);
 assert.equal((await (await f.request('/api/bank/status')).json()).connected,false);
});

test('refuse un callback expiré et explique la configuration manquante',async t=>{
 let clock=Date.now();const f=await fixture(t,{now:()=>clock});
 await f.request('/api/bank/connect',{method:'POST',body:{}});clock+=11*60000;
 assert.equal((await f.request(`/api/bank/callback?code=x&state=${f.getAuth().state}`)).headers.get('location'),'/?bank=error');assert.equal(f.getCreates(),0);
 const missing=await fixture(t,{provider:{configured:false}});
 assert.equal((await missing.request('/api/bank/connect',{method:'POST',body:{}})).status,503);
});


test('HTTPS exige stockage durable et mot de passe avant tout appel bancaire',async t=>{
 const f=await fixture(t,{origin:'https://budget.example'});
 const status=await (await f.request('/api/bank/status')).json();
 assert.equal(status.configured,false);assert.equal(status.securityConfigured,false);
 assert.equal((await f.request('/api/bank/connect',{method:'POST',body:{}})).status,503);
 assert.equal(f.getAuth(),undefined);
});

test('mot de passe, cookie Secure, limitation des essais et isolation de l’accès',async t=>{
 const store=new MemorySessionStore();store.durable=true;
 const origin='https://budget.example',accessPassword='unit-test-password-long-enough';
 const f=await fixture(t,{origin,store,accessPassword});
 let status=await (await f.request('/api/bank/status')).json();assert.equal(status.unlocked,false);assert.equal(status.requiresPassword,true);
 assert.equal((await f.request('/api/bank/connect',{method:'POST',body:{}})).status,401);
 assert.equal((await f.request('/api/bank/login',{method:'POST',body:{password:accessPassword},customOrigin:'https://evil.example'})).status,403);
 assert.equal((await f.request('/api/bank/login',{method:'POST',body:{password:'wrong'}})).status,401);
 const login=await f.request('/api/bank/login',{method:'POST',body:{password:accessPassword}});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Secure/);
 status=await (await f.request('/api/bank/status')).json();assert.equal(status.unlocked,true);
 assert.equal((await (await f.request('/api/bank/status',{withCookie:false})).json()).unlocked,false);
 assert.equal((await f.request('/api/bank/connect',{method:'POST',body:{}})).status,200);
 assert.equal(f.getAuth().redirect_url,origin+'/api/bank/callback');
 for(let i=0;i<5;i++)await f.request('/api/bank/login',{method:'POST',body:{password:'wrong'}});
 assert.equal((await f.request('/api/bank/login',{method:'POST',body:{password:accessPassword}})).status,429);
});

test('l’état OAuth peut être créé et consommé par deux instances de fonction distinctes',async t=>{
 const store=new MemorySessionStore();let body;
 const first=await fixture(t,{store,provider:{configured:true,request:async(path,options)=>{
  if(path.startsWith('/aspsps'))return{aspsps:[{name:'Revolut',country:'FR'}]};
  body=options.body;return{url:'https://bank.example/auth'};
 }}});
 const connect=await first.request('/api/bank/connect',{method:'POST',body:{}});
 const cookie=connect.headers.get('set-cookie').split(';')[0];
 let creations=0;
 const second=createBankHandler({origin:'http://localhost:5179',store,provider:{configured:true,request:async()=>{creations++;return{session_id:'bank-session',accounts:[{uid:'account'}]};}}});
 const invoke=async()=>{
  const headers=new Map();const result={setHeader:(k,v)=>headers.set(k.toLowerCase(),v),writeHead:(code,h)=>{result.code=code;Object.entries(h||{}).forEach(([k,v])=>headers.set(k.toLowerCase(),v));},end:()=>{}};
  await second({method:'GET',url:`/api/bank/callback?code=one-use&state=${body.state}`,headers:{host:'localhost:5179',cookie},socket:{}},result);
  return headers.get('location');
 };
 assert.equal(await invoke(),'/?bank=connected');assert.equal(await invoke(),'/?bank=error');assert.equal(creations,1);
});

test('verrouiller l’accès retire le cookie de déverrouillage sans dévoiler la session bancaire',async t=>{
 const store=new MemorySessionStore();store.durable=true;
 const accessPassword='unit-test-password-long-enough';
 const f=await fixture(t,{origin:'https://budget.example',store,accessPassword});
 await f.request('/api/bank/login',{method:'POST',body:{password:accessPassword}});
 const logout=await f.request('/api/bank/logout',{method:'POST',body:{}});
 assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal((await (await f.request('/api/bank/status')).json()).unlocked,false);
 assert.equal((await f.request('/api/bank/connect',{method:'POST',body:{}})).status,401);
});

test('accepte un corps déjà parsé par Vercel et refuse les requêtes mal formées',async()=>{
 const handler=createBankHandler({origin:'http://localhost:5179',provider:{configured:false}});
 async function invoke(body,headers={}){
  const response={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(code){this.code=code;},end(data){this.body=data;}};
  await handler({method:'POST',url:'/api/bank/connect',body,headers:{host:'localhost:5179',origin:'http://localhost:5179','content-type':'application/json',...headers},socket:{}},response);
  return response;
 }
 assert.equal((await invoke({})).code,503);
 assert.equal((await invoke(null)).code,400);
 assert.equal((await invoke({bank:'x'.repeat(3000)})).code,413);
 assert.equal((await invoke({},{origin:'https://evil.example'})).code,403);
});

test('le statut expose seulement les noms de configuration nécessaires au diagnostic',async t=>{
 const missingConfiguration=['APP_PASSWORD (au moins 16 caractères)','KV_REST_API_TOKEN ou UPSTASH_REDIS_REST_TOKEN'];
 const f=await fixture(t,{origin:'https://budget.example',missingConfiguration});
 const response=await f.request('/api/bank/status');const data=await response.json();
 assert.equal(data.diagnosticVersion,1);assert.deepEqual(data.missingConfiguration,missingConfiguration);assert.equal(data.securityConfigured,false);
 assert.ok(!JSON.stringify(data).includes('provider-session-SECRET'));
});

test('une ancienne réponse en cache est relue pour produire les catégories et les motifs détaillés',async t=>{
 const store=new MemorySessionStore(),f=await fixture(t,{store});
 const started=await f.request('/api/bank/connect',{method:'POST',body:{}});
 const id=started.headers.get('set-cookie').split(';')[0].split('=')[1];
 await f.request(`/api/bank/callback?code=x&state=${f.getAuth().state}`);
 const session=await store.get(id);session.lastSync=Date.now();session.cached={transactions:[],skipped:{invalid:12}};await store.save(id,session);
 const data=await(await f.request('/api/bank/sync',{method:'POST',body:{}})).json();
 assert.equal(data.schemaVersion,3);assert.equal(data.transactions.length,1);assert.ok(data.transactions[0].categorySource);assert.ok(data.diagnostics);
});

test('relit seulement les comptes de la session autorisée et conserve les identifiants des écritures existantes',async t=>{
 const accounts=[{uid:'account',account_type:'CACC',account_id:{iban:'FR7630006000011234567890189'}},{uid:'savings',account_type:'SVGS',currency:'EUR'}];
 const baseProvider={configured:true,request:async(path,options={})=>{
  if(path.startsWith('/aspsps'))return{aspsps:[{name:'Revolut',country:'FR'}]};
  if(path==='/auth')return{url:'https://bank.example/auth'};
  if(path==='/sessions')return{session_id:'same-session',accounts:[{uid:'account'}]};
  if(path==='/sessions/same-session')return{session_id:'same-session',accounts};
  if(path.endsWith('/balances'))return{balances:[{balance_amount:{amount:path.includes('savings')?'100':'20',currency:'EUR'},balance_type:'ITAV'}]};
  if(path.startsWith('/accounts/'))return{transactions:[operation]};
  throw new Error('Unexpected route');
 }};
 const store=new MemorySessionStore(),f=await fixture(t,{provider:baseProvider,store});
 const started=await f.request('/api/bank/connect',{method:'POST',body:{}});
 const id=started.headers.get('set-cookie').split(';')[0].split('=')[1],session=await store.get(id);
 const linked=await f.request(`/api/bank/callback?code=x&state=${session.pending.state}`);assert.equal(linked.headers.get('location'),'/?bank=connected');
 const old=await(await f.request('/api/bank/sync',{method:'POST',body:{}})).json();assert.equal(old.transactions.length,1);
 assert.equal((await f.request('/api/bank/accounts',{method:'POST',body:{},withCookie:false})).status,401);
 const updated=await(await f.request('/api/bank/accounts',{method:'POST',body:{}})).json();
 assert.equal(updated.accounts.length,2);assert.equal(updated.accounts[1].type,'SVGS');assert.equal(updated.accounts[1].balances[0].amount,100);
 const next=await(await f.request('/api/bank/sync',{method:'POST',body:{}})).json();assert.equal(next.transactions.length,2);assert.ok(next.transactions.some(t=>t.id===old.transactions[0].id));
 assert.ok(!JSON.stringify(updated).includes(accounts[0].account_id.iban));
});
