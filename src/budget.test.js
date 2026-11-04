import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summary, validateTransaction } from './budget.js';
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
