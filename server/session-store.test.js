import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RedisSessionStore } from './session-store.js';
import { checkAccess, issueAccess } from './access.js';

function fakeRedis(){
 const data=new Map(),commands=[];
 return{data,commands,fetchImpl:async(_url,options)=>{
  const command=JSON.parse(options.body);commands.push(command);const [name,key,value,...args]=command;let result;
  if(name==='GET')result=data.get(key)||null;
  if(name==='SET'){if(args.includes('NX')&&data.has(key))result=null;else{data.set(key,value);result='OK';}}
  if(name==='EXPIRE')result=1;
  if(name==='EVAL'){
   if(key.includes("redis.call('GET'")){const actualKey=args[0],token=args[1];if(data.get(actualKey)===token){data.delete(actualKey);result=1;}else result=0;}
   else{const actualKey=args[0];result=Number(data.get(actualKey)||0)+1;data.set(actualKey,result);}
  }
  return Response.json({result});
 }};
}

test('chiffre les données Redis, restaure sur une autre instance et utilise un bail partagé',async()=>{
 const redis=fakeRedis(),options={url:'https://test.upstash.io',token:'test-token',password:'unit-test-password-long-enough',origin:'https://budget.example',fetchImpl:redis.fetchImpl};
 const a=new RedisSessionStore(options),b=new RedisSessionStore(options);
 const session={bank:{session_id:'bank-private',accounts:[{uid:'private-account'}]},pending:{state:'private-state'}};
 await a.save('browser-cookie',session);
 const serialized=JSON.stringify([...redis.data]);for(const value of ['bank-private','private-account','private-state','browser-cookie'])assert.ok(!serialized.includes(value));
 assert.deepEqual(await b.get('browser-cookie'),session);
 const release=await a.acquire('browser-cookie');assert.ok(release);assert.equal(await b.acquire('browser-cookie'),null);await release();assert.ok(await b.acquire('browser-cookie'));
 assert.equal(await a.allowed('ip',1,60),true);assert.equal(await b.allowed('ip',1,60),false);
 const other=new RedisSessionStore({...options,password:'another-password-long-enough'});await assert.rejects(other.get('browser-cookie'),/illisible/);
 const saved=redis.commands.find(c=>c[0]==='SET'&&c[1].includes('session'));assert.deepEqual(saved.slice(-2),['EX',28800]);
});

test('refuse les stockages non HTTPS et masque les erreurs et secrets du prestataire Redis',async()=>{
 assert.throws(()=>new RedisSessionStore({url:'http://test.upstash.io',token:'secret',password:'unit-test-password-long-enough',origin:'https://budget.example'}),/invalide/);
 const store=new RedisSessionStore({url:'https://test.upstash.io',token:'secret-token',password:'unit-test-password-long-enough',origin:'https://budget.example',fetchImpl:async()=>new Response('PRIVATE-ERROR',{status:401})});
 await assert.rejects(store.get('cookie'),e=>e.message.includes('indisponible')&&!e.message.includes('PRIVATE')&&!e.message.includes('secret-token'));
});

test('le cookie d’accès ne peut pas être modifié, réutilisé sur un autre site ou après expiration',()=>{
 const password='unit-test-password-long-enough',origin='https://budget.example',now=1000000000;
 const cookie=issueAccess(password,origin,now);
 assert.equal(checkAccess(cookie,password,origin,now+1000),true);
 assert.equal(checkAccess(cookie,password,origin,now+9*3600000),false);
 assert.equal(checkAccess(cookie+'x',password,origin,now+1000),false);
 assert.equal(checkAccess(cookie,password,'https://other.example',now+1000),false);
});
