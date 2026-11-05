import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorize,needsCategoryReview } from './categorization.js';

test('classe les commerçants alimentaires identifiables avec une justification de suggestion',()=>{
 for(const label of ['Utile','CARREFOUR CITY','Nyx*cafesbibalvending','Uber Eats Paris']){
  const result=categorize({label,type:'expense'});assert.equal(result.category,'Alimentation',label);assert.equal(result.categorySource,'rule');assert.match(result.categoryReason,/Suggestion/);
 }
 assert.equal(categorize({label:'Envoyé depuis Revolut To Oqoro',type:'expense'}).category,'Logement');
 assert.equal(categorize({label:'SNCF Voyageurs',type:'expense'}).category,'Transport');
 assert.equal(categorize({label:'Pharmacie du Centre',type:'expense'}).category,'Santé');
});

test('priorise les codes commerçants et ne devine pas les libellés ambigus',()=>{
 assert.equal(categorize({label:'UBER PAYMENTS B.V.*AMSTERDAM',type:'expense',mcc:'5814'}).category,'Alimentation');
 const ambiguous=categorize({label:'UBER PAYMENTS B.V.*AMSTERDAM',type:'expense'});assert.equal(ambiguous.categorySource,'unclassified');assert.ok(needsCategoryReview({...ambiguous,type:'expense',source:'revolut'}));
 assert.equal(categorize({label:'Virement à une personne',type:'expense'}).category,'Virement sortant');
 assert.equal(categorize({label:'Notile',type:'expense'}).categorySource,'unclassified');
 assert.equal(categorize({label:'Lidl',type:'income'}).categorySource,'income');
 assert.equal(needsCategoryReview({source:'revolut',type:'income',category:'Autres'}),false);
});

test('classe les virements avec leur sens et distingue les mouvements d’épargne',()=>{
 for(const[label,type,expected]of [
  ["To Compte d’épargne",'expense','Vers l’épargne'],
  ["From Compte d’épargne",'income','Depuis l’épargne'],
  ['To Savings account','expense','Vers l’épargne'],
  ['Virement reçu Payment from Exemple','income','Virement entrant'],
  ['Envoyé depuis Revolut To Exemple','expense','Virement sortant'],
  ['From Exemple','income','Virement entrant'],['To Exemple','expense','Virement sortant'],
 ])assert.equal(categorize({label,type}).category,expected,label);
 assert.equal(categorize({label:'VIREMENT-SALAIRE-OCTOBRE Payment from Employeur',type:'income'}).categorySource,'income');
 assert.equal(categorize({label:'To Oqoro',type:'expense',bankCode:'PMNT-ICDT-ESCT'}).category,'Logement');
 assert.equal(categorize({label:'Règlement inconnu',type:'expense',bankCode:'PMNT-ICDT-ESCT'}).category,'Virement sortant');
 assert.notEqual(categorize({label:'To Compte d’épargne',type:'income'}).category,'Vers l’épargne');
});
