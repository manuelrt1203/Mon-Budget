import { validateTransaction } from './budget.js';

export function mergeBankTransactions(current, incoming) {
  if (!Array.isArray(incoming) || incoming.some(t => !validateTransaction(t) || t.source !== 'revolut' || !/^bank-[a-f0-9]{64}$/.test(t.id))) throw new Error('Les opérations reçues sont invalides. Aucune modification effectuée.');
  const byId = new Map(current.map(t => [t.id,t]));
  let added = 0, updated = 0;
  for (const t of incoming) {
    const previous = byId.get(t.id);
    if (previous) {
      if (previous.source !== 'revolut') throw new Error('Un identifiant d’opération existe déjà. Aucune modification effectuée.');
      const next = { ...t, category:previous.category };
      if (['label','amount','date','type'].some(key=>previous[key] !== next[key])) updated++;
      byId.set(t.id,next);
    } else { byId.set(t.id,t); added++; }
  }
  return { transactions:[...byId.values()], added, updated };
}
