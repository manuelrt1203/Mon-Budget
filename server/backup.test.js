import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createBankHandler } from './app.js';
import { RedisSessionStore } from './session-store.js';

const origin = 'http://localhost:5179';
const password = 'unit-test-password-long-enough';
const tx = { id: 'a', label: 'Courses secrètes', amount: 12.5, type: 'expense', category: 'Alimentation', date: '2026-11-04' };
const budget = (transactions = [tx]) => ({ transactions, limits: { Alimentation: 123 }, monthLimits: {} });

/** Client de test : appelle directement le gestionnaire, avec un « cookie » conservé entre les appels. */
function client(options = {}) {
  const handler = createBankHandler({ origin, provider: { configured: false }, ...options });
  let cookie = '';
  return async (path, body = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code) { this.code = code; }, end(d) { this.body = d ? JSON.parse(d) : undefined; } };
    await handler({ method: 'POST', url: path, body, headers: { host: 'localhost:5179', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, socket: {} }, res);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return res;
  };
}

test('sauvegarde, relit, détecte les conflits et nettoie les données reçues', async () => {
  const call = client();
  const empty = await call('/api/bank/backup/get');
  assert.deepEqual([empty.code, empty.body.exists, empty.body.durable], [200, false, false]);

  const first = await call('/api/bank/backup/put', { data: budget(), revision: 0 });
  assert.deepEqual([first.code, first.body.revision], [200, 1]);

  const read = await call('/api/bank/backup/get');
  assert.equal(read.body.exists, true);
  assert.equal(read.body.revision, 1);
  assert.equal(read.body.data.transactions[0].label, 'Courses secrètes');
  assert.equal(read.body.data.limits.Alimentation, 123);

  // Un autre appareil encore à la révision 0 ne peut pas écraser : il reçoit l'état courant pour le fusionner.
  const stale = await call('/api/bank/backup/put', { data: budget([]), revision: 0 });
  assert.deepEqual([stale.code, stale.body.conflict, stale.body.revision, stale.body.data.transactions.length], [409, true, 1, 1]);

  assert.equal((await call('/api/bank/backup/put', { data: budget([]), revision: 1 })).body.revision, 2);
  assert.equal((await call('/api/bank/backup/put', { data: budget([tx]), revision: 0, force: true })).body.revision, 3);

  // Données invalides : rejetées ou nettoyées, jamais stockées telles quelles.
  assert.equal((await call('/api/bank/backup/put', { data: {}, revision: 3 })).code, 400);
  await call('/api/bank/backup/put', { data: budget([tx, { id: 'x', label: '<b>', amount: -5 }, { ...tx, id: 'bank-' + 'f'.repeat(64) }]), revision: 3 });
  assert.equal((await call('/api/bank/backup/get')).body.data.transactions.length, 1);
});

test('exige le déverrouillage quand un mot de passe est configuré', async () => {
  const call = client({ accessPassword: password });
  assert.equal((await call('/api/bank/backup/get')).code, 401);
  assert.equal((await call('/api/bank/backup/put', { data: budget(), revision: 0 })).code, 401);
  assert.equal((await call('/api/bank/login', { password })).code, 200);
  assert.equal((await call('/api/bank/backup/get')).code, 200);
});

test('limite la taille d’une sauvegarde et le nombre de demandes', async () => {
  const call = client();
  assert.equal((await call('/api/bank/backup/put', { data: budget(), revision: 0, pad: 'x'.repeat(3_100_000) })).code, 413);
  for (let i = 0; i < 60; i++) await call('/api/bank/backup/get');
  assert.equal((await call('/api/bank/backup/get')).code, 429);
});

function fakeVaultRedis() {
  const data = new Map(), commands = [];
  return {
    data, commands,
    fetchImpl: async (_url, options) => {
      const command = JSON.parse(options.body);
      commands.push(command);
      let result;
      if (command[0] === 'MGET') result = command.slice(1).map(key => data.get(key) ?? null);
      else if (command[0] === 'EVAL') {
        const [, , , dataKey, revKey, mode, expected, encoded] = command;
        const current = Number(data.get(revKey) || 0);
        if (mode === 'force' || current === Number(expected)) { data.set(dataKey, encoded); data.set(revKey, current + 1); result = current + 1; }
        else result = -current - 1;
      }
      return Response.json({ result });
    },
  };
}

test('le coffre Redis est chiffré, sans expiration, versionné et illisible avec un autre mot de passe', async () => {
  const redis = fakeVaultRedis();
  const options = { url: 'https://test.upstash.io', token: 'test-token', password, origin: 'https://budget.example', fetchImpl: redis.fetchImpl };
  const store = new RedisSessionStore(options);
  const value = { updatedAt: 1, data: budget() };

  assert.equal(await store.getVault(), null);
  assert.deepEqual(await store.saveVault(0, value), { ok: true, revision: 1 });
  const stored = JSON.stringify([...redis.data]);
  for (const secret of ['Courses secrètes', 'Alimentation', '2026-11-04']) assert.ok(!stored.includes(secret), secret);
  assert.ok(redis.commands.every(command => !command.includes('EX') && !command.includes('PX')), 'aucune expiration');

  // Une autre instance du serveur relit la même sauvegarde.
  assert.deepEqual(await new RedisSessionStore(options).getVault(), { revision: 1, value });
  assert.deepEqual(await store.saveVault(0, value), { ok: false, revision: 1 });
  assert.deepEqual(await store.saveVault(0, value, true), { ok: true, revision: 2 });

  const other = new RedisSessionStore({ ...options, password: 'another-password-long-enough' });
  await assert.rejects(other.getVault(), /illisible/);
});

test('refuse une sauvegarde trop volumineuse pour Redis', async () => {
  const redis = fakeVaultRedis();
  const store = new RedisSessionStore({ url: 'https://test.upstash.io', token: 'test-token', password, origin: 'https://budget.example', fetchImpl: redis.fetchImpl });
  await assert.rejects(store.saveVault(0, { updatedAt: 1, data: { noise: randomBytes(1_500_000).toString('hex') } }), /volumineuse/);
  assert.equal(redis.data.size, 0);
});
