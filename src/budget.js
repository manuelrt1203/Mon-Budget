// Logique métier pure : aucune dépendance au navigateur, entièrement testable.
import { needsCategoryReview } from './categorization.js';

export const budgetCategories = ['Alimentation', 'Logement', 'Transport', 'Loisirs', 'Études', 'Santé', 'Autres'];
export const transferDirections = { 'Virement entrant': 'income', 'Virement sortant': 'expense', 'Vers l’épargne': 'expense', 'Depuis l’épargne': 'income' };
export const categories = [...budgetCategories, ...Object.keys(transferDirections)];
export const categoriesForType = type => categories.filter(category => !transferDirections[category] || transferDirections[category] === type);
export const isTransfer = t => transferDirections[t.category] === t.type;
export const defaultLimits = { Alimentation: 200, Logement: 450, Transport: 50, Loisirs: 80, Études: 40, Santé: 30, Autres: 50 };

const MAX_AMOUNT = 1_000_000_000;
const BANK_ID = /^bank-[a-f0-9]{64}$/;
const CATEGORY_SOURCES = ['mcc', 'rule', 'unclassified', 'income', 'manual'];

export const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const toCents = n => Math.round(n * 100);

export function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const m = Number(value.slice(5));
  return m >= 1 && m <= 12;
}

export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function validateTransaction(t) {
  return t !== null && typeof t === 'object'
    && typeof t.id === 'string' && t.id.length > 0 && t.id.length <= 128
    && typeof t.label === 'string' && t.label.trim().length > 0 && t.label.length <= 100
    && Number.isFinite(t.amount) && t.amount > 0 && t.amount < MAX_AMOUNT
    && ['income', 'expense'].includes(t.type)
    && categoriesForType(t.type).includes(t.category)
    && isRealDate(t.date);
}

/**
 * Totaux d'un mois. Tout est calculé en centimes entiers pour éviter les dérives flottantes.
 * `carryOver` : variation cumulée de tous les mois précédents (virements inclus), `cumulative` = report + variation du mois.
 */
export function summary(transactions, month) {
  const entries = [];
  const c = { income: 0, expenses: 0, budgetIncome: 0, budgetExpenses: 0, incomingTransfers: 0, outgoingTransfers: 0, toSavings: 0, fromSavings: 0 };
  let carry = 0;
  for (const t of transactions) {
    const m = t.date.slice(0, 7);
    const cents = toCents(t.amount);
    if (m === month) {
      entries.push(t);
      const transfer = isTransfer(t);
      if (t.type === 'income') { c.income += cents; if (!transfer) c.budgetIncome += cents; } else { c.expenses += cents; if (!transfer) c.budgetExpenses += cents; }
      if (t.category === 'Virement entrant') c.incomingTransfers += cents;
      if (t.category === 'Virement sortant') c.outgoingTransfers += cents;
      if (t.category === 'Vers l’épargne') c.toSavings += cents;
      if (t.category === 'Depuis l’épargne') c.fromSavings += cents;
    } else if (m < month) {
      carry += t.type === 'income' ? cents : -cents;
    }
  }
  const balance = c.income - c.expenses;
  return {
    entries,
    income: c.income / 100, expenses: c.expenses / 100, balance: balance / 100,
    budgetIncome: c.budgetIncome / 100, budgetExpenses: c.budgetExpenses / 100,
    incomingTransfers: c.incomingTransfers / 100, outgoingTransfers: c.outgoingTransfers / 100,
    toSavings: c.toSavings / 100, fromSavings: c.fromSavings / 100,
    carryOver: carry / 100, cumulative: (carry + balance) / 100,
  };
}

/** Dépenses de consommation par catégorie de budget (virements exclus par construction). */
export function spentByCategory(entries) {
  const cents = Object.fromEntries(budgetCategories.map(c => [c, 0]));
  for (const t of entries) if (t.type === 'expense' && Object.hasOwn(cents, t.category)) cents[t.category] += toCents(t.amount);
  return Object.fromEntries(Object.entries(cents).map(([c, v]) => [c, v / 100]));
}

/** Revenus et dépenses (hors virements) des `count` derniers mois, du plus ancien au mois affiché. */
export function monthlySeries(transactions, month, count = 6) {
  return Array.from({ length: count }, (_, i) => {
    const m = shiftMonth(month, i - count + 1);
    const { budgetIncome, budgetExpenses } = summary(transactions, m);
    return { month: m, income: budgetIncome, expenses: budgetExpenses };
  });
}

// ---------- Plafonds (par défaut, avec exceptions mensuelles) ----------

export function emptyState() {
  return { transactions: [], limits: { ...defaultLimits }, monthLimits: {} };
}

export const limitsFor = (state, month) => ({ ...state.limits, ...(state.monthLimits[month] ?? {}) });
export const hasMonthLimits = (state, month) => Object.hasOwn(state.monthLimits, month);

function cleanLimits(source, base) {
  return Object.fromEntries(budgetCategories.map(c => {
    const v = source?.[c];
    return [c, Number.isFinite(v) && v >= 0 && v < MAX_AMOUNT ? round2(v) : base[c]];
  }));
}

/** scope 'all' : plafonds par défaut ; scope 'month' : uniquement pour ce mois. */
export function applyLimits(state, month, limits, scope) {
  const clean = cleanLimits(limits, state.limits);
  if (scope === 'all') {
    const { [month]: _removed, ...rest } = state.monthLimits;
    return { ...state, limits: clean, monthLimits: rest };
  }
  return { ...state, monthLimits: { ...state.monthLimits, [month]: clean } };
}

export function resetMonthLimits(state, month) {
  const { [month]: _removed, ...rest } = state.monthLimits;
  return { ...state, monthLimits: rest };
}

// ---------- Opérations ----------

export const upsertTransaction = (list, t) =>
  list.some(x => x.id === t.id) ? list.map(x => (x.id === t.id ? t : x)) : [...list, t];

export const removeTransaction = (list, id) => list.filter(t => t.id !== id);

export const reviewCount = entries => entries.filter(needsCategoryReview).length;

/** Filtres : `type` vaut all | expense | income (hors virements) | review (à classer) | transfers. */
export function filterTransactions(list, { query = '', type = 'all', category = 'all', sort = 'date-desc' } = {}) {
  const q = query.trim().toLocaleLowerCase('fr');
  const matchesType = t => type === 'all'
    || (type === 'review' ? needsCategoryReview(t) : type === 'transfers' ? isTransfer(t) : t.type === type && !isTransfer(t));
  const sorters = {
    'date-desc': (a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label, 'fr'),
    'date-asc': (a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label, 'fr'),
    'amount-desc': (a, b) => b.amount - a.amount,
    'amount-asc': (a, b) => a.amount - b.amount,
  };
  return list
    .filter(t => matchesType(t) && (category === 'all' || t.category === category) && (!q || t.label.toLocaleLowerCase('fr').includes(q)))
    .sort(sorters[sort] ?? sorters['date-desc']);
}

export const netOf = list => list.reduce((s, t) => s + (t.type === 'income' ? toCents(t.amount) : -toCents(t.amount)), 0) / 100;

// ---------- Sauvegarde, import, export ----------

/** Liste blanche des champs : une sauvegarde importée ne peut pas injecter de champs inattendus. */
export function cleanTransaction(t) {
  const clean = { id: t.id, label: t.label.trim(), amount: round2(t.amount), type: t.type, category: t.category, date: t.date };
  if (t.source === 'revolut' && BANK_ID.test(t.id)) {
    clean.source = 'revolut';
    if (CATEGORY_SOURCES.includes(t.categorySource)) clean.categorySource = t.categorySource;
    if (typeof t.categoryReason === 'string') clean.categoryReason = t.categoryReason.slice(0, 300);
    if (typeof t.merchantKey === 'string') clean.merchantKey = t.merchantKey.slice(0, 120);
    if (['value_date', 'booking_date'].includes(t.dateSource)) clean.dateSource = t.dateSource;
  }
  return clean;
}

/** Accepte les anciennes données (opérations + plafonds) comme les nouvelles ; écarte tout ce qui est invalide. */
export function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  const seen = new Set();
  if (Array.isArray(raw.transactions)) {
    for (const t of raw.transactions) {
      if (validateTransaction(t) && !seen.has(t.id)) {
        seen.add(t.id);
        state.transactions.push(cleanTransaction(t));
      }
    }
  }
  state.limits = cleanLimits(raw.limits, defaultLimits);
  if (raw.monthLimits && typeof raw.monthLimits === 'object') {
    for (const [month, limits] of Object.entries(raw.monthLimits)) {
      if (isMonth(month)) state.monthLimits[month] = cleanLimits(limits, state.limits);
    }
  }
  return state;
}

export function serializeBackup(state, now = new Date()) {
  return JSON.stringify({ app: 'mon-budget', version: 2, exportedAt: now.toISOString(), ...state }, null, 2);
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'Ce fichier n’est pas un JSON valide.' }; }
  const looksRight = data && typeof data === 'object' && !Array.isArray(data) && (Array.isArray(data.transactions) || data.limits);
  if (!looksRight) return { ok: false, error: 'Ce fichier ne ressemble pas à une sauvegarde Mon Budget.' };
  const state = normalizeState(data);
  const received = Array.isArray(data.transactions) ? data.transactions.length : 0;
  return { ok: true, state, ignored: received - state.transactions.length };
}

/** Ajoute les opérations inconnues ; les données actuelles gardent la priorité. */
export function mergeStates(current, incoming) {
  const ids = new Set(current.transactions.map(t => t.id));
  return {
    transactions: [...current.transactions, ...incoming.transactions.filter(t => !ids.has(t.id))],
    limits: current.limits,
    monthLimits: { ...incoming.monthLimits, ...current.monthLimits },
  };
}

const csvCell = value => {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // empêche l'exécution de formules dans un tableur
  return /[";\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function transactionsToCsv(list) {
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date)).map(t =>
    [t.date, t.label, t.type === 'income' ? 'Revenu' : 'Dépense', t.category, String(t.amount).replace('.', ','), t.source === 'revolut' ? 'Revolut' : 'Saisie manuelle'].map(csvCell).join(';'));
  return ['Date;Libellé;Type;Catégorie;Montant;Origine', ...rows].join('\r\n');
}

/** Lit un montant saisi à la française ("12,50", "1 200.5"). Renvoie NaN si invalide. */
export function parseAmount(input) {
  const s = String(input).trim().replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return round2(Number(s));
}
