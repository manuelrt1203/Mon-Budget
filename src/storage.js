import { emptyState, normalizeState } from './budget.js';

// Même clé que les versions précédentes : les opérations déjà enregistrées (saisies et Revolut) sont reprises telles quelles.
const KEY = 'mon-budget-v1';
const CORRUPTED_KEY = 'mon-budget-sauvegarde-illisible';

/** Charge l'état. `error` vaut 'unreadable' si les données existantes étaient corrompues. */
export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (raw === null) return { state: emptyState(), error: null, dropped: 0 };
    const parsed = JSON.parse(raw);
    const state = normalizeState(parsed);
    const dropped = (Array.isArray(parsed?.transactions) ? parsed.transactions.length : 0) - state.transactions.length;
    // Des opérations ont été écartées (invalides ou aux règles plus strictes) : on garde l'original avant toute réécriture.
    if (dropped > 0) { try { localStorage.setItem(CORRUPTED_KEY, raw); } catch { /* stockage indisponible */ } }
    return { state, error: null, dropped };
  } catch {
    // On garde une copie du contenu illisible plutôt que de l'écraser silencieusement.
    try { if (raw) localStorage.setItem(CORRUPTED_KEY, raw); } catch { /* stockage indisponible */ }
    return { state: emptyState(), error: 'unreadable', dropped: 0 };
  }
}

/** Renvoie true si l'écriture a réussi. */
export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
