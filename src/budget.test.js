import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summary, validateTransaction, spentByCategory, monthlySeries, shiftMonth, isRealDate,
  emptyState, limitsFor, applyLimits, resetMonthLimits, hasMonthLimits, defaultLimits,
  upsertTransaction, removeTransaction, filterTransactions, netOf, reviewCount,
  normalizeState, serializeBackup, parseBackup, mergeStates, transactionsToCsv, parseAmount,
} from './budget.js';
const tx = { id: 'a', label: 'Courses', amount: 42.5, date: '2026-11-04', category: 'Alimentation', type: 'expense' };
test('calcule les revenus, dépenses et solde du mois sélectionné',()=>{
 const result=summary([tx,{...tx,id:'b',type:'income',amount:800},{...tx,id:'c',date:'2026-10-31',amount:100}], '2026-11');
 assert.equal(result.income,800);assert.equal(result.expenses,42.5);assert.equal(result.balance,757.5);assert.equal(result.entries.length,2);
});
test('un mois vide a un solde nul',()=>assert.equal(summary([tx],'2027-01').balance,0));
test('refuse montants invalides, catégories inconnues et libellés vides',()=>{
 assert.equal(validateTransaction(tx),true);
 for(const patch of [{amount:0},{amount:-1},{amount:Infinity},{category:'Inconnue'},{label:' '},{type:'other'},{date:'invalide'}]) assert.equal(validateTransaction({...tx,...patch}),false);
});

test('sépare la consommation et les virements sans changer la variation des mouvements',()=>{
 const base={...tx,date:'2026-11-04'};
 const result=summary([
  {...base,type:'income',amount:1000,category:'Autres'},
  {...base,amount:100,category:'Alimentation'},
  {...base,amount:200,category:'Vers l’épargne'},
  {...base,type:'income',amount:50,category:'Depuis l’épargne'},
  {...base,amount:75,category:'Virement sortant'},
  {...base,type:'income',amount:25,category:'Virement entrant'},
 ],'2026-11');
 assert.equal(result.income,1075);assert.equal(result.expenses,375);assert.equal(result.balance,700);
 assert.equal(result.budgetIncome,1000);assert.equal(result.budgetExpenses,100);
 assert.equal(result.toSavings,200);assert.equal(result.fromSavings,50);assert.equal(result.incomingTransfers,25);assert.equal(result.outgoingTransfers,75);
 assert.equal(validateTransaction({...base,category:'Virement entrant',type:'expense'}),false);
 assert.equal(validateTransaction({...base,category:'Vers l’épargne',type:'expense'}),true);
});

test('additionne les mouvements au centime sans produire un faux découvert d’arrondi',()=>{
 const result=summary([{...tx,type:'income',amount:0.3},{...tx,amount:0.1},{...tx,amount:0.2}],'2026-11');
 assert.equal(result.balance,0);assert.equal(result.expenses,0.3);
});

// ---------- Nouveautés ----------

const income = (id, date, amount) => ({ ...tx, id, type: 'income', category: 'Autres', label: 'Bourse', date, amount });
const bankId = `bank-${'a'.repeat(64)}`;
const bankTx = { ...tx, id: bankId, source: 'revolut', categorySource: 'unclassified', categoryReason: 'À vérifier', merchantKey: 'X', dateSource: 'value_date', category: 'Autres' };

test('cumule la variation des mois précédents (report), virements compris', () => {
  const list = [income('r1', '2026-09-01', 500), { ...tx, id: 'd1', date: '2026-09-10', amount: 120 }, income('r2', '2026-10-01', 300), { ...tx, id: 's', date: '2026-10-05', amount: 50, category: 'Vers l’épargne' }];
  const oct = summary(list, '2026-10');
  assert.equal(oct.carryOver, 380);
  assert.equal(oct.balance, 250);
  assert.equal(oct.cumulative, 630);
  assert.equal(summary(list, '2026-09').carryOver, 0);
  assert.equal(summary(list, '2026-11').carryOver, 630);
});

test('accepte les identifiants bancaires de 69 caractères et les vraies dates uniquement', () => {
  assert.equal(validateTransaction(bankTx), true);
  assert.equal(validateTransaction({ ...tx, date: '2026-02-31' }), false);
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-02-29'), false);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('regroupe les dépenses de consommation par catégorie, sans les virements', () => {
  const spent = spentByCategory([tx, { ...tx, id: 'b', amount: 7.5 }, { ...tx, id: 'v', amount: 90, category: 'Virement sortant' }, income('c', '2026-11-02', 50)]);
  assert.equal(spent.Alimentation, 50);
  assert.equal(spent.Autres, 0);
  assert.equal(Object.hasOwn(spent, 'Virement sortant'), false);
});

test('construit la série des six derniers mois hors virements', () => {
  const series = monthlySeries([tx, income('r', '2026-08-15', 200), { ...tx, id: 'v', amount: 999, category: 'Vers l’épargne' }], '2026-11');
  assert.deepEqual(series.map(s => s.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(series[2].income, 200);
  assert.equal(series[5].expenses, 42.5);
});

test('les plafonds peuvent différer selon le mois', () => {
  let state = emptyState();
  state = applyLimits(state, '2026-11', { ...defaultLimits, Loisirs: 150 }, 'month');
  assert.equal(limitsFor(state, '2026-11').Loisirs, 150);
  assert.equal(limitsFor(state, '2026-12').Loisirs, defaultLimits.Loisirs);
  assert.equal(hasMonthLimits(state, '2026-11'), true);
  assert.equal(hasMonthLimits(resetMonthLimits(state, '2026-11'), '2026-11'), false);
  state = applyLimits(state, '2026-11', { ...defaultLimits, Loisirs: 99 }, 'all');
  assert.equal(limitsFor(state, '2026-12').Loisirs, 99);
  assert.equal(hasMonthLimits(state, '2026-11'), false);
});

test('ajoute, modifie et supprime une opération sans muter la liste', () => {
  const base = [tx];
  const edited = upsertTransaction(base, { ...tx, label: 'Supermarché' });
  assert.equal(edited.length, 1);
  assert.equal(edited[0].label, 'Supermarché');
  assert.equal(base[0].label, 'Courses');
  assert.equal(upsertTransaction(edited, { ...tx, id: 'z' }).length, 2);
  assert.equal(removeTransaction(edited, 'a').length, 0);
});

test('recherche, filtre et trie les opérations (virements et « à classer » compris)', () => {
  const transfer = { ...tx, id: 't', label: 'Épargne', category: 'Vers l’épargne', amount: 20, date: '2026-11-02' };
  const list = [tx, { ...tx, id: 'b', label: 'Cinéma', category: 'Loisirs', amount: 12, date: '2026-11-10' }, income('c', '2026-11-01', 800), transfer, bankTx];
  assert.deepEqual(filterTransactions(list, { query: 'CINÉ' }).map(t => t.id), ['b']);
  assert.deepEqual(filterTransactions(list, { type: 'income' }).map(t => t.id), ['c']);
  assert.deepEqual(filterTransactions(list, { type: 'transfers' }).map(t => t.id), ['t']);
  assert.deepEqual(filterTransactions(list, { type: 'review' }).map(t => t.id), [bankId]);
  assert.equal(filterTransactions(list, { type: 'expense' }).some(t => t.id === 't'), false);
  assert.deepEqual(filterTransactions(list, { category: 'Alimentation' }).map(t => t.id), ['a']);
  assert.deepEqual(filterTransactions(list, { sort: 'amount-desc' }).map(t => t.id)[0], 'c');
  assert.equal(reviewCount(list), 1);
  assert.equal(netOf([tx, income('c', '2026-11-01', 800)]), 757.5);
});

test('normalise les anciennes données, conserve les champs bancaires et écarte le reste', () => {
  const v1 = { transactions: [tx, { ...tx, id: 'a' }, { ...tx, id: 'bad', amount: -3 }, bankTx], limits: { Loisirs: 10, Santé: -5 } };
  const state = normalizeState(v1);
  assert.equal(state.transactions.length, 2);
  assert.equal(state.limits.Loisirs, 10);
  assert.equal(state.limits.Santé, defaultLimits.Santé);
  assert.deepEqual(state.monthLimits, {});
  assert.deepEqual(state.transactions[1], bankTx);
  assert.deepEqual(normalizeState('n’importe quoi'), emptyState());
});

test('une sauvegarde importée ne peut pas se faire passer pour une opération bancaire', () => {
  const forged = { ...tx, id: 'manuel-1', source: 'revolut', categorySource: 'manual', extra: '<script>' };
  const [clean] = normalizeState({ transactions: [forged] }).transactions;
  assert.equal(clean.source, undefined);
  assert.equal(clean.extra, undefined);
  assert.equal(clean.categorySource, undefined);
});

test('sauvegarde puis restaure sans perte', () => {
  let state = { ...emptyState(), transactions: [tx, bankTx] };
  state = applyLimits(state, '2026-11', { ...defaultLimits, Santé: 5 }, 'month');
  const parsed = parseBackup(serializeBackup(state));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ignored, 0);
  assert.deepEqual(parsed.state, state);
});

test('rejette un import illisible ou étranger', () => {
  assert.equal(parseBackup('{pas du json').ok, false);
  assert.equal(parseBackup('[1,2]').ok, false);
  assert.equal(parseBackup('{"foo":1}').ok, false);
  const partial = parseBackup(JSON.stringify({ transactions: [tx, { nope: 1 }] }));
  assert.equal(partial.ok, true);
  assert.equal(partial.ignored, 1);
});

test('fusionne sans dupliquer ni écraser les données actuelles', () => {
  const current = { ...emptyState(), transactions: [tx] };
  const incoming = { ...emptyState(), transactions: [{ ...tx, label: 'Autre version' }, { ...tx, id: 'n' }] };
  const merged = mergeStates(current, incoming);
  assert.equal(merged.transactions.length, 2);
  assert.equal(merged.transactions[0].label, 'Courses');
});

test('exporte en CSV en neutralisant les formules et en indiquant l’origine', () => {
  const csv = transactionsToCsv([{ ...tx, label: '=SOMME(A1)' }, { ...tx, id: 'b', label: 'Pain; "bio"', date: '2026-11-02' }, bankTx]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Date;Libellé;Type;Catégorie;Montant;Origine');
  assert.equal(lines[1], '2026-11-02;"Pain; ""bio""";Dépense;Alimentation;42,5;Saisie manuelle');
  assert.ok(lines.includes("2026-11-04;'=SOMME(A1);Dépense;Alimentation;42,5;Saisie manuelle"));
  assert.ok(lines.some(l => l.endsWith(';Revolut')));
});

test('lit les montants saisis à la française', () => {
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount(' 1 200.5 '), 1200.5);
  for (const bad of ['', 'abc', '-3', '1,234', '1e3']) assert.ok(Number.isNaN(parseAmount(bad)), bad);
});

// ---------- Corrections issues des revues de code et de sécurité ----------

test('refuse un montant qui s’arrondit à 0,00 €', () => {
  assert.equal(validateTransaction({ ...tx, amount: 1e-9 }), false);
  assert.equal(validateTransaction({ ...tx, amount: 0.004 }), false);
  assert.equal(validateTransaction({ ...tx, amount: 0.01 }), true);
});

test('écarte un identifiant de forme bancaire sans origine Revolut (il bloquerait la synchronisation)', () => {
  const fake = { ...tx, id: `bank-${'f'.repeat(64)}` };
  const real = { ...fake, id: `bank-${'e'.repeat(64)}`, source: 'revolut', categorySource: 'unclassified', category: 'Autres' };
  const state = normalizeState({ transactions: [fake, real] });
  assert.deepEqual(state.transactions.map(t => t.id), [real.id]);
  assert.equal(parseBackup(JSON.stringify({ transactions: [fake, real] })).ignored, 1);
});

test('plafonne le nombre d’opérations importées', () => {
  const many = Array.from({ length: 20005 }, (_, i) => ({ ...tx, id: `n${i}` }));
  const parsed = parseBackup(JSON.stringify({ transactions: many }));
  assert.equal(parsed.state.transactions.length, 20000);
  assert.equal(parsed.ignored, 5);
});

test('la série des mois ignore les opérations hors période et les virements, en un passage', () => {
  const list = [
    { ...tx, id: 'old', date: '2025-01-05', amount: 999 },
    { ...tx, id: 'in', type: 'income', category: 'Autres', date: '2026-10-02', amount: 100.1 },
    { ...tx, id: 'ex', date: '2026-10-09', amount: 20.2 },
    { ...tx, id: 'tr', date: '2026-10-10', amount: 500, category: 'Virement sortant' },
  ];
  const oct = monthlySeries(list, '2026-11').find(s => s.month === '2026-10');
  assert.deepEqual(oct, { month: '2026-10', income: 100.1, expenses: 20.2 });
  assert.equal(monthlySeries(list, '2026-11').reduce((s, m) => s + m.expenses, 0), 20.2);
});
