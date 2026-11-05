import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeBankTransactions } from './bank-sync.js';
const t={id:`bank-${'a'.repeat(64)}`,source:'revolut',label:'Courses',amount:10,date:'2026-11-01',type:'expense',category:'Autres'};
test('la synchronisation est idempotente et préserve les catégories et les opérations manuelles',()=>{
 const manual={...t,id:'manual',source:undefined,amount:5};
 const first=mergeBankTransactions([manual],[t]);assert.equal(first.added,1);
 const second=mergeBankTransactions(first.transactions,[t,t]);assert.equal(second.added,0);assert.equal(second.transactions.length,2);
 const third=mergeBankTransactions([{...t,category:'Alimentation'},manual],[{...t,amount:12}]);
 assert.equal(third.updated,1);assert.equal(third.transactions[0].category,'Alimentation');assert.equal(third.transactions[0].amount,12);assert.deepEqual(third.transactions[1],manual);
});
test('refuse les réponses invalides avant toute modification des opérations',()=>{
 const current=[t];assert.throws(()=>mergeBankTransactions(current,[{...t,amount:-2}]),/invalides/);assert.equal(current[0].amount,10);
 assert.throws(()=>mergeBankTransactions(current,null),/invalides/);
 assert.throws(()=>mergeBankTransactions(current,[null]),/invalides/);
});

test('reclasse les anciens Autres et conserve les corrections manuelles, y compris Autres',()=>{
 const auto={...t,label:'Utile',category:'Alimentation',categorySource:'rule',categoryReason:'Suggestion : commerçant alimentaire.'};
 const upgraded=mergeBankTransactions([t],[auto]);assert.equal(upgraded.transactions[0].category,'Alimentation');assert.equal(upgraded.categorized,1);assert.equal(upgraded.updated,1);
 const manual=mergeBankTransactions([{...t,categorySource:'manual'}],[auto]);assert.equal(manual.transactions[0].category,'Autres');assert.equal(manual.transactions[0].categorySource,'manual');
 const corrected=mergeBankTransactions([{...t,category:'Loisirs'}],[auto]);assert.equal(corrected.transactions[0].category,'Loisirs');
 const again=mergeBankTransactions(upgraded.transactions,[auto]);assert.equal(again.updated,0);assert.equal(again.unchanged,1);assert.equal(again.categorized,0);
});
