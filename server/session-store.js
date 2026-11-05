import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { BankError } from './enable-banking.js';

const TTL = 8 * 3600;
export class MemorySessionStore {
  durable = false;
  constructor() { this.data = new Map(); this.locks = new Map(); this.counters = new Map(); }
  async get(id) {
    const item = this.data.get(id);
    if (!item || item.expires < Date.now()) { this.data.delete(id); return null; }
    return structuredClone(item.value);
  }
  async save(id, value) {
    for (const [key,item] of this.data) if (item.expires < Date.now()) this.data.delete(key);
    if (!this.data.has(id) && this.data.size >= 1000) throw new BankError('Le serveur est occupé. Réessayez plus tard.',503);
    this.data.set(id,{value:structuredClone(value),expires:Date.now()+TTL*1000});
  }
  async touch(id) { const item=this.data.get(id);if(item)item.expires=Date.now()+TTL*1000; }
  async acquire(id) {
    if ((this.locks.get(id)||0)>Date.now()) return null;
    this.locks.set(id,Date.now()+180000);
    return async()=>{this.locks.delete(id);};
  }
  async allowed(id, limit, seconds) {
    for(const [key,item] of this.counters)if(item.expires<Date.now())this.counters.delete(key);
    let item=this.counters.get(id);
    if(!item){item={count:0,expires:Date.now()+seconds*1000};this.counters.set(id,item);}
    return ++item.count<=limit;
  }
}

export class RedisSessionStore {
  durable = true;
  constructor({url,token,password,origin,fetchImpl=fetch}) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||!parsed.hostname.endsWith('.upstash.io')||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new Error('Adresse Redis REST invalide.');
    if(!token||!password||password.length<16)throw new Error('Le stockage bancaire exige un mot de passe applicatif d’au moins 16 caractères.');
    this.url=parsed.href;this.token=token;this.fetchImpl=fetchImpl;
    this.key=scryptSync(password,`mon-budget:${origin}`,32);
    this.prefix=`mb:${createHash('sha256').update(origin).digest('hex').slice(0,20)}:`;
  }
  name(kind,id){return this.prefix+kind+':'+createHash('sha256').update(id).digest('hex');}
  encrypt(value){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return [iv,cipher.getAuthTag(),ciphertext].map(b=>b.toString('base64url')).join('.');
  }
  decrypt(value){
    try{
      const [iv,tag,ciphertext]=value.split('.').map(s=>Buffer.from(s,'base64url'));
      const decipher=createDecipheriv('aes-256-gcm',this.key,iv);decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8'));
    }catch{throw new BankError('La session bancaire est illisible. Vérifiez le mot de passe applicatif puis reconnectez Revolut.',503);}
  }
  async command(parts){
    try{
      const response=await this.fetchImpl(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(parts),signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok)throw new Error('Redis refused');
      const data=await response.json();if(data.error)throw new Error('Redis error');return data.result;
    }catch{throw new BankError('Le stockage sécurisé des sessions est indisponible. Réessayez plus tard.',503);}
  }
  async get(id){const value=await this.command(['GET',this.name('session',id)]);return value?this.decrypt(value):null;}
  async save(id,value){await this.command(['SET',this.name('session',id),this.encrypt(value),'EX',TTL]);}
  async touch(id){await this.command(['EXPIRE',this.name('session',id),TTL]);}
  async acquire(id){
    const key=this.name('lock',id),token=randomBytes(24).toString('hex');
    const result=await this.command(['SET',key,token,'NX','PX',180000]);
    if(result!=='OK')return null;
    return async()=>{await this.command(['EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,key,token]);};
  }
  async allowed(id,limit,seconds){
    const count=await this.command(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",1,this.name('rate',id),seconds]);
    return Number(count)<=limit;
  }
}
