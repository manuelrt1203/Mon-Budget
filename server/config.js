import { createProvider } from './enable-banking.js';
import { MemorySessionStore, RedisSessionStore } from './session-store.js';
export function configuration() {
  const domain=process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const origin=process.env.APP_ORIGIN || (domain ? `https://${domain}` : 'http://localhost:5173');
  const accessPassword=process.env.APP_PASSWORD || '';
  const redisUrl=process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken=process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const store=redisUrl&&redisToken&&accessPassword.length>=16?new RedisSessionStore({url:redisUrl,token:redisToken,password:accessPassword,origin}):new MemorySessionStore();
  const provider=createProvider({appId:process.env.ENABLE_BANKING_APP_ID,keyPath:process.env.ENABLE_BANKING_PRIVATE_KEY_PATH,privateKey:process.env.ENABLE_BANKING_PRIVATE_KEY});
  return { origin,provider,store,accessPassword,trustVercelProxy:process.env.VERCEL==='1' };
}
