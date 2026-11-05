import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { configuration } from './config.js';

const origin='https://budget.example';
const redis={KV_REST_API_URL:'https://test.upstash.io',KV_REST_API_TOKEN:'synthetic-redis-secret'};
const password='unit-test-password-long-enough';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({type:'pkcs8',format:'pem'});
const bank={ENABLE_BANKING_APP_ID:'synthetic-app-id',ENABLE_BANKING_PRIVATE_KEY:pem};

test('repère le mot de passe manquant même si Redis est présent, sans révéler ses valeurs',()=>{
 const config=configuration({APP_ORIGIN:origin,...redis,...bank});
 assert.deepEqual(config.missingConfiguration,['APP_PASSWORD (au moins 16 caractères)']);
 assert.equal(config.store.durable,false);
 const output=JSON.stringify(config.missingConfiguration);
 assert.ok(!output.includes(redis.KV_REST_API_TOKEN));assert.ok(!output.includes('BEGIN PRIVATE KEY'));assert.ok(!output.includes(bank.ENABLE_BANKING_APP_ID));
});

test('distingue les variables Redis absentes des identifiants bancaires manquants',()=>{
 const config=configuration({APP_ORIGIN:origin,APP_PASSWORD:password});
 assert.deepEqual(config.missingConfiguration,[
  'KV_REST_API_URL ou UPSTASH_REDIS_REST_URL',
  'KV_REST_API_TOKEN ou UPSTASH_REDIS_REST_TOKEN',
  'ENABLE_BANKING_APP_ID','ENABLE_BANKING_PRIVATE_KEY',
 ]);
});

test('accepte les variables KV injectées par Vercel et refuse un mot de passe trop court',()=>{
 const ready=configuration({APP_ORIGIN:origin,APP_PASSWORD:password,...redis,...bank});
 assert.deepEqual(ready.missingConfiguration,[]);assert.equal(ready.store.durable,true);assert.equal(ready.provider.configured,true);
 const short=configuration({APP_ORIGIN:origin,APP_PASSWORD:'short',...redis,...bank});
 assert.deepEqual(short.missingConfiguration,['APP_PASSWORD (au moins 16 caractères)']);
});

test('signale un PEM ou une URL Redis invalides et conserve la banque désactivée',()=>{
 const config=configuration({APP_ORIGIN:origin,APP_PASSWORD:password,...redis,KV_REST_API_URL:'redis://test.invalid',...bank,ENABLE_BANKING_PRIVATE_KEY:'not-a-key'});
 assert.equal(config.store.durable,false);assert.equal(config.provider.configured,false);
 assert.ok(config.missingConfiguration.some(s=>s.includes('URL REST HTTPS')));
 assert.ok(config.missingConfiguration.some(s=>s.includes('clé RSA')));
});
