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
