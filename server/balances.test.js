import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBalances, readAccountBalances } from './balances.js';
import { BankError } from './enable-banking.js';

const amount=(value,type='ITAV',currency='EUR',extra={})=>({balance_amount:{amount:value,currency},balance_type:type,...extra});

test('privilégie le disponible fourni par la banque sans additionner le comptabilisé ou les opérations',()=>{
 const values=normalizeBalances([amount('278.13','ITBD'),amount('263.18','ITAV'),amount('9999','OPBD'),amount('500','ITAV','USD')]);
 assert.equal(values[0].amount,263.18);assert.equal(values[0].kind,'available');assert.equal(values[1].amount,278.13);assert.equal(values[1].kind,'booked');assert.equal(values.length,2);
 const bookedOnly=normalizeBalances([amount('278.13','ITBD')]);assert.equal(bookedOnly[0].label,'Solde comptabilisé');
 const closing=normalizeBalances([amount('278.13','CLBD','EUR',{reference_date:'2026-11-04'})]);assert.equal(closing[0].bankDate,'2026-11-04');assert.match(closing[0].label,/clôture/);
});

test('accepte zéro et les découverts et refuse les valeurs ambiguës ou les fractions de centime',()=>{
 assert.equal(normalizeBalances([amount('0.00')])[0].amount,0);
 assert.equal(normalizeBalances([amount('-42.50')])[0].amount,-42.5);
 assert.equal(normalizeBalances([amount('42.50','ITBD','EUR',{credit_debit_indicator:'DBIT'})])[0].amount,-42.5);
 assert.equal(normalizeBalances([amount('263.18000')])[0].amount,263.18);
 for(const value of ['NaN','1e5','12,50','42.001','900719925474099100'])assert.deepEqual(normalizeBalances([amount(value)]),[]);
 assert.deepEqual(normalizeBalances([null,{},amount('12','UNKNOWN'),amount('12','ITAV','USD')]),[]);
 assert.throws(()=>normalizeBalances(undefined),/liste de soldes/);
});

test('lit chaque compte séparément, ne transmet ni UID ni IBAN complet et conserve un succès partiel',async()=>{
 const calls=[],iban='FR7630006000011234567890189';
 const provider={request:async(path)=>{calls.push(path);if(path.includes('savings'))throw new BankError('Solde temporairement indisponible.');return{balances:[amount('263.18')]};}};
 const result=await readAccountBalances(provider,[{uid:'current-private-uid',account_type:'CACC',currency:'EUR',account_id:{iban}},{uid:'savings-private-uid',account_type:'SVGS',currency:'EUR'}],{});
 assert.equal(calls.length,2);assert.equal(calls[0],'/accounts/current-private-uid/balances');
 assert.equal(result.accounts[0].balances[0].amount,263.18);assert.equal(result.accounts[0].maskedIban,'•••• 0189');
 assert.equal(result.accounts[1].balances.length,0);assert.match(result.accounts[1].error,/indisponible/);
 const output=JSON.stringify(result);assert.ok(!output.includes(iban));assert.ok(!output.includes('private-uid'));
 const again=await readAccountBalances(provider,[{uid:'changed-session-uid',account_id:{iban}}],{});assert.equal(again.accounts[0].id,result.accounts[0].id);
});

test('un format bancaire absent ne produit jamais de solde inventé',async()=>{
 const result=await readAccountBalances({request:async()=>({transactions:[]})},['account'],{});
 assert.deepEqual(result.accounts[0].balances,[]);assert.match(result.accounts[0].error,/liste de soldes/);
 await assert.rejects(readAccountBalances({},[],{}),/Aucun compte/);
});
