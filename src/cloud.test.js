import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBankHandler } from '../server/app.js';
import { MemorySessionStore } from '../server/session-store.js';
import { createCloud, planSync, isEmptyState } from './cloud.js';
import { emptyState, applyLimits, defaultLimits } from './budget.js';

const origin = 'http://localhost:5179';
const password = 'unit-test-password-long-enough';
const tx = (id, label = 'Courses') => ({ id, label, amount: 12.5, type: 'expense', category: 'Alimentation', date: '2026-11-04' });
const withTx = (...ids) => ({ ...emptyState(), transactions: ids.map(id => tx(id)) });

/** Adaptateur : les appels fetch du client sont traités par le VRAI gestionnaire du serveur (stockage en mémoire partagé). */
function serverFetch(handler) {
  let cookie = '';
  return async (url, init = {}) => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code) { this.code = code; }, end(d) { this.text = d; } };
    await handler({ method: init.method || 'GET', url: new URL(url, origin).pathname, body: init.body ? JSON.parse(init.body) : undefined, headers: { host: 'localhost:5179', origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, socket: {} }, res);
    if (res.headers['Set-Cookie']) cookie = res.headers['Set-Cookie'].split(';')[0];
    return new Response(res.text, { status: res.code, headers: { 'Content-Type': 'application/json' } });
  };
}

/** Un « navigateur » : ses données locales, son stockage local et son client de sauvegarde. */
function device(fetchImpl, initial = emptyState()) {
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const d = { state: initial, applied: [], storage };
  d.cloud = createCloud({ getState: () => d.state, applyState: (s, info) => { d.state = s; d.applied.push(info.reason); }, fetchImpl, storage, delay: 3_600_000 });
  return d;
}

const shared = (options = {}) => serverFetch(createBankHandler({ origin, provider: { configured: false }, store: new MemorySessionStore(), ...options }));

test('planSync choisit la bonne action', () => {
  const remote = { exists: true, revision: 5 };
  assert.equal(planSync({ local: withTx('a'), remote: { exists: false }, knownRevision: 0, dirty: false }), 'push');
  assert.equal(planSync({ local: emptyState(), remote: { exists: false }, knownRevision: 0, dirty: false }), 'none');
  assert.equal(planSync({ local: emptyState(), remote, knownRevision: 0, dirty: false }), 'adopt'); // navigateur effacé
  assert.equal(planSync({ local: withTx('a'), remote, knownRevision: 5, dirty: false }), 'none');
  assert.equal(planSync({ local: withTx('a'), remote, knownRevision: 5, dirty: true }), 'push');
  assert.equal(planSync({ local: withTx('a'), remote, knownRevision: 3, dirty: false }), 'adopt'); // un autre appareil a avancé
  assert.equal(planSync({ local: withTx('a'), remote, knownRevision: 3, dirty: true }), 'merge');
  assert.equal(planSync({ local: withTx('a'), remote, knownRevision: 0, dirty: false }), 'merge'); // historique inconnu
  assert.equal(isEmptyState(emptyState()), true);
  assert.equal(isEmptyState(applyLimits(emptyState(), '2026-11', { ...defaultLimits, Santé: 1 }, 'month')), false);
});

test('les données survivent à l’effacement du navigateur', async () => {
  const fetchImpl = shared();
  const before = device(fetchImpl, withTx('a', 'b'));
  await before.cloud.sync();
  assert.equal(before.cloud.status.phase, 'idle');
  assert.equal(before.cloud.status.durable, false); // serveur en mémoire : signalé à l'utilisateur

  // Navigateur effacé : plus de données locales, plus de numéro de révision.
  const afterClearing = device(fetchImpl);
  await afterClearing.cloud.sync();
  assert.deepEqual(afterClearing.applied, ['restore']);
  assert.deepEqual(afterClearing.state.transactions.map(t => t.id), ['a', 'b']);
});

test('les limites par mois sont sauvegardées avec les opérations', async () => {
  const fetchImpl = shared();
  const limits = applyLimits(withTx('a'), '2026-11', { ...defaultLimits, Loisirs: 150 }, 'month');
  await device(fetchImpl, limits).cloud.sync();
  const restored = device(fetchImpl);
  await restored.cloud.sync();
  assert.equal(restored.state.monthLimits['2026-11'].Loisirs, 150);
});

test('deux appareils : adoption des nouveautés, puis fusion en cas de modifications simultanées', async () => {
  const fetchImpl = shared();
  const a = device(fetchImpl, withTx('a'));
  await a.cloud.sync();
  const b = device(fetchImpl);
  await b.cloud.sync(); // B restaure la révision 1

  // A ajoute une opération : B, resté inchangé, la reprend sans rien fusionner.
  a.state = withTx('a', 'a2'); await a.cloud.markDirty({}); await a.cloud.sync();
  await b.cloud.sync();
  assert.deepEqual(b.state.transactions.map(t => t.id), ['a', 'a2']);

  // Les deux modifient en même temps : aucune opération n'est perdue.
  a.state = withTx('a', 'a2', 'fromA'); a.cloud.markDirty({}); await a.cloud.sync();
  b.state = withTx('a', 'a2', 'fromB'); b.cloud.markDirty({}); await b.cloud.sync();
  assert.deepEqual(b.state.transactions.map(t => t.id).sort(), ['a', 'a2', 'fromA', 'fromB']);
  await a.cloud.sync();
  assert.deepEqual(a.state.transactions.map(t => t.id).sort(), ['a', 'a2', 'fromA', 'fromB']);
});

test('« tout effacer » remplace la sauvegarde en ligne et se propage', async () => {
  const fetchImpl = shared();
  const a = device(fetchImpl, withTx('a'));
  await a.cloud.sync();
  const b = device(fetchImpl);
  await b.cloud.sync();
  a.state = emptyState();
  await a.cloud.markDirty({ replace: true });
  await b.cloud.sync();
  assert.equal(b.state.transactions.length, 0);
});

test('verrouillé : rien n’est envoyé, puis tout part après la saisie du mot de passe', async () => {
  const fetchImpl = shared({ accessPassword: password });
  const a = device(fetchImpl, withTx('a'));
  await a.cloud.sync();
  assert.equal(a.cloud.status.phase, 'locked');
  await a.cloud.markDirty({});
  assert.equal(a.cloud.status.phase, 'locked');
  assert.equal((await fetchImpl('/api/bank/login', { method: 'POST', body: JSON.stringify({ password }) })).status, 200);
  await a.cloud.sync();
  assert.equal(a.cloud.status.phase, 'idle');
  const fresh = device(fetchImpl);
  await fresh.cloud.sync();
  assert.equal(fresh.state.transactions.length, 1);
});

test('effacer sans accès ne détruit jamais la sauvegarde en ligne', async () => {
  const store = new MemorySessionStore();
  const make = () => serverFetch(createBankHandler({ origin, provider: { configured: false }, store, accessPassword: password }));
  const unlocked = make();
  await unlocked('/api/bank/login', { method: 'POST', body: JSON.stringify({ password }) });
  await device(unlocked, withTx('a', 'b')).cloud.sync();

  // Un navigateur non déverrouillé « efface tout » : la demande est ignorée côté serveur.
  const lockedFetch = make();
  const locked = device(lockedFetch, emptyState());
  await locked.cloud.markDirty({ replace: true });
  assert.equal(locked.cloud.status.phase, 'locked');

  // Plus tard, ce même navigateur se déverrouille : ses données reviennent au lieu d'être effacées.
  await lockedFetch('/api/bank/login', { method: 'POST', body: JSON.stringify({ password }) });
  await locked.cloud.sync();
  assert.deepEqual(locked.applied, ['restore']);
  assert.deepEqual(locked.state.transactions.map(t => t.id), ['a', 'b']);
});

test('serveur injoignable ou sauvegarde illisible : les données locales ne sont jamais touchées', async () => {
  const offline = device(async () => { throw new TypeError('network'); }, withTx('a'));
  await offline.cloud.sync();
  assert.equal(offline.cloud.status.phase, 'offline');
  assert.equal(offline.state.transactions.length, 1);

  const unreadable = device(async url => (String(url).endsWith('/status')
    ? Response.json({ securityConfigured: true, requiresPassword: false, unlocked: true })
    : Response.json({ error: 'La sauvegarde en ligne est illisible : le mot de passe applicatif a probablement changé.' }, { status: 422 })), withTx('a'));
  await unreadable.cloud.sync();
  assert.equal(unreadable.cloud.status.phase, 'error');
  assert.match(unreadable.cloud.status.message, /illisible/);
  assert.equal(unreadable.state.transactions.length, 1);
  assert.deepEqual(unreadable.applied, []);
});
