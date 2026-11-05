import { createProvider } from './enable-banking.js';
import { MemorySessionStore, RedisSessionStore } from './session-store.js';

export function configuration(env=process.env) {
  const domain=env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const origin=env.APP_ORIGIN || (domain ? `https://${domain}` : 'http://localhost:5173');
  const hosted=new URL(origin).protocol==='https:';
  const accessPassword=env.APP_PASSWORD || '';
  const redisUrl=(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL || '').trim();
  const redisToken=(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN || '').trim();
  const appId=(env.ENABLE_BANKING_APP_ID || '').trim();
  const privateKey=env.ENABLE_BANKING_PRIVATE_KEY;
  const keyPath=env.ENABLE_BANKING_PRIVATE_KEY_PATH;
  const missingConfiguration=[];
  let store=new MemorySessionStore();

  if(hosted){
    if(accessPassword.length<16)missingConfiguration.push('APP_PASSWORD (au moins 16 caractères)');
    if(!redisUrl)missingConfiguration.push('KV_REST_API_URL ou UPSTASH_REDIS_REST_URL');
    if(!redisToken)missingConfiguration.push('KV_REST_API_TOKEN ou UPSTASH_REDIS_REST_TOKEN');
  }
  if(redisUrl&&redisToken&&accessPassword.length>=16){
    try{store=new RedisSessionStore({url:redisUrl,token:redisToken,password:accessPassword,origin});}
    catch{missingConfiguration.push('KV_REST_API_URL ou UPSTASH_REDIS_REST_URL (URL REST HTTPS Upstash valide)');}
  }
  if(!appId)missingConfiguration.push('ENABLE_BANKING_APP_ID');
  if(!privateKey&&!keyPath)missingConfiguration.push('ENABLE_BANKING_PRIVATE_KEY');
  let provider=createProvider({});
  try{provider=createProvider({appId,keyPath,privateKey});}
  catch{missingConfiguration.push('ENABLE_BANKING_PRIVATE_KEY (clé RSA illisible ou invalide)');}

  return {origin,provider,store,accessPassword,missingConfiguration,trustVercelProxy:env.VERCEL==='1'};
}
