// Sauvegarde en ligne : garde une copie chiffrée des données du budget sur le serveur (accès par mot de passe),
// pour qu'elles survivent à l'effacement des données du navigateur ou au changement d'appareil.
import { defaultLimits, mergeStates, normalizeState } from './budget.js';

const REV_KEY = 'mon-budget-cloud-rev'; // dernière révision synchronisée (perdue avec le navigateur : c'est voulu)
const DIRTY_KEY = 'mon-budget-cloud-dirty'; // des changements locaux n'ont pas encore été envoyés

export const isEmptyState = state =>
  state.transactions.length === 0 && Object.keys(state.monthLimits).length === 0 && JSON.stringify(state.limits) === JSON.stringify(defaultLimits);

/**
 * Décide quoi faire en comparant les données locales et la sauvegarde en ligne.
 *  - adopt : reprendre la sauvegarde en ligne (navigateur vide, ou rien de modifié ici depuis la dernière synchronisation)
 *  - merge : les deux ont évolué (ou l'historique de synchronisation est inconnu) : réunir les opérations
 *  - push  : envoyer les données locales
 *  - none  : rien à faire
 */
export function planSync({ local, remote, knownRevision, dirty }) {
  if (!remote.exists) return isEmptyState(local) ? 'none' : 'push';
  if (isEmptyState(local)) return 'adopt';
  if (knownRevision === remote.revision) return dirty ? 'push' : 'none';
  if (knownRevision > 0 && !dirty) return 'adopt';
  return 'merge';
}

export function createCloud({ getState, applyState, onChange = () => {}, fetchImpl = (...args) => fetch(...args), storage = globalThis.localStorage, delay = 2500, now = Date.now }) {
  const read = key => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key, value) => { try { value === null ? storage?.removeItem(key) : storage?.setItem(key, String(value)); } catch { /* stockage indisponible */ } };

  let status = { phase: 'off', durable: null, lastSync: null, message: '' };
  let timer = null, busy = false, queued = false, replaceRemote = false, lastRun = 0;
  const set = patch => { status = { ...status, ...patch }; onChange(status); };

  async function call(path, body) {
    const response = await fetchImpl(`/api/bank/backup/${path}`, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30000),
    });
    let data = {};
    try { data = await response.json(); } catch { /* réponse vide ou illisible */ }
    return { ok: response.ok, status: response.status, data };
  }

  /** Vérifie que le serveur propose la sauvegarde et que l'accès est déverrouillé. */
  async function available() {
    try {
      const response = await fetchImpl('/api/bank/status', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const server = await response.json();
      if (!server.securityConfigured) { set({ phase: 'unavailable', message: 'Le serveur n’est pas configuré pour la sauvegarde en ligne (mot de passe et stockage sécurisé).' }); return false; }
      if (server.requiresPassword && !server.unlocked) { set({ phase: 'locked', message: '' }); return false; }
      return true;
    } catch {
      set({ phase: 'offline', message: 'Serveur injoignable : vos données restent sur cet appareil et seront envoyées dès que possible.' });
      return false;
    }
  }

  async function push(state, revision, force = false) {
    let current = state, expected = revision;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await call('put', { data: current, revision: expected, force });
      if (result.ok) {
        write(REV_KEY, result.data.revision);
        write(DIRTY_KEY, null);
        set({ phase: 'idle', durable: result.data.durable, lastSync: now(), message: '' });
        return;
      }
      if (result.status === 409 && result.data.conflict && result.data.data && !force) {
        // Un autre appareil a écrit entre-temps : on fusionne avec son état, puis on réessaie.
        current = mergeStates(getState(), normalizeState(result.data.data));
        applyState(current, { reason: 'merge' });
        expected = result.data.revision;
        continue;
      }
      throw new Error(result.data.error || 'La sauvegarde en ligne a échoué.');
    }
    throw new Error('La sauvegarde en ligne change trop souvent. Réessayez dans un instant.');
  }

  async function sync() {
    if (busy) { queued = true; return; }
    busy = true; lastRun = now(); clearTimeout(timer);
    try {
      // Sans accès, une demande d'effacement/remplacement est annulée : la sauvegarde en ligne ne doit jamais être
      // effacée plus tard, à l'insu de l'utilisateur ; ses données reviendront à la prochaine synchronisation.
      if (!(await available())) { replaceRemote = false; return; }
      set({ phase: 'syncing', message: '' });
      if (replaceRemote) { // l'utilisateur a demandé d'effacer ou de remplacer : la sauvegarde en ligne suit
        replaceRemote = false;
        await push(getState(), 0, true);
        return;
      }
      const got = await call('get');
      if (!got.ok) throw new Error(got.data.error || 'La sauvegarde en ligne est indisponible.');
      const remote = got.data;
      const action = planSync({ local: getState(), remote, knownRevision: Number(read(REV_KEY)) || 0, dirty: read(DIRTY_KEY) === '1' });
      if (action === 'adopt') {
        applyState(normalizeState(remote.data), { reason: 'restore' });
        write(REV_KEY, remote.revision);
        write(DIRTY_KEY, null);
        set({ phase: 'idle', durable: remote.durable, lastSync: now(), message: '' });
      } else if (action === 'merge') {
        const merged = mergeStates(getState(), normalizeState(remote.data));
        applyState(merged, { reason: 'merge' });
        await push(merged, remote.revision);
      } else if (action === 'push') {
        await push(getState(), remote.exists ? remote.revision : 0);
      } else {
        set({ phase: 'idle', durable: remote.durable, lastSync: now(), message: '' });
      }
    } catch (error) {
      set({ phase: 'error', message: error.message });
    } finally {
      busy = false;
      if (queued) { queued = false; schedule(); }
    }
  }

  function schedule(ms = delay) {
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
    timer.unref?.();
  }

  return {
    get status() { return status; },
    /** Première synchronisation (au démarrage) et synchronisation manuelle. */
    sync,
    /** À appeler après chaque enregistrement local. `replace` : la sauvegarde en ligne doit être remplacée (effacement, restauration). */
    markDirty({ replace = false } = {}) {
      write(DIRTY_KEY, '1');
      if (replace) replaceRemote = true;
      if (replace) return sync();
      if (!['locked', 'unavailable'].includes(status.phase)) schedule();
    },
    /** Reprend la synchronisation quand l'onglet redevient visible, sans harceler le serveur. */
    refreshIfStale(maxAgeMs = 5 * 60000) { if (now() - lastRun > maxAgeMs) return sync(); },
  };
}
