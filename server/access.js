import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
const digest=value=>createHash('sha256').update(String(value)).digest();
export const passwordMatches=(actual,expected)=>typeof actual==='string'&&typeof expected==='string'&&timingSafeEqual(digest(actual),digest(expected));
const signature=(value,password,origin)=>createHmac('sha256',password).update(`${origin}:${value}`).digest('base64url');
export function issueAccess(password,origin,now=Date.now()){
 const value=`${now+8*3600000}.${randomBytes(24).toString('hex')}`;
 return `${value}.${signature(value,password,origin)}`;
}
export function checkAccess(token,password,origin,now=Date.now()){
 if(typeof token!=='string'||!password)return false;
 const parts=token.split('.');
 if(parts.length!==3||!/^\d+$/.test(parts[0])||!Number.isSafeInteger(Number(parts[0]))||Number(parts[0])<=now||Number(parts[0])>now+8*3600000)return false;
 const expected=signature(parts.slice(0,2).join('.'),password,origin);
 return passwordMatches(parts[2],expected);
}
