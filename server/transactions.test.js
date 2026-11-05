import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeTransactions,parseCents } from './transactions.js';
import { readTransactions } from './enable-banking.js';
const base={transaction_id:'reference-1',status:'BOOK',booking_date:'2026-11-05',transaction_amount:{amount:'10.00',currency:'EUR'},credit_debit_indicator:'DBIT',remittance_information:['Utile']};

test('conserve les identifiants existants et lit les précisions décimales sans arrondir les écritures',()=>{
 const result=normalizeTransactions('account',[{...base,transaction_amount:{amount:'-10.00000',currency:'EUR'}}]);
 assert.equal(result.transactions[0].amount,10);assert.equal(result.transactions[0].category,'Alimentation');
 assert.equal(result.transactions[0].id,`bank-${createHash('sha256').update(JSON.stringify(['account','reference-1'])).digest('hex')}`);
 assert.equal(parseCents('0.29'),29);assert.equal(parseCents('+123.45000'),12345);assert.equal(parseCents('0.001'),null);assert.equal(parseCents(null),null);
});

test('sépare les provisoires, les autres statuts, les montants nuls et les vrais défauts de lecture',()=>{
 const rows=[{...base,status:'PDNG'},{...base,status:'RJCT'},{...base,status:undefined},{...base,transaction_amount:{amount:'0.00',currency:'EUR'}},{...base,transaction_id:null},{...base,booking_date:'2026-02-30'},{...base,credit_debit_indicator:null},{...base,transaction_amount:{amount:'10.001',currency:'EUR'}},{...base,transaction_amount:{amount:'1',currency:null}},{...base,transaction_amount:{amount:'5',currency:'USD'}},null];
 const result=normalizeTransactions('account',rows);
 assert.deepEqual(result.skipped,{pending:1,currency:1,invalid:6,status:2,zero:1});
 assert.equal(result.diagnostics.reasonCounts.reference,1);assert.equal(result.diagnostics.reasonCounts.date,1);assert.equal(result.diagnostics.reasonCounts.direction,1);assert.equal(result.diagnostics.reasonCounts.amount,1);assert.equal(result.diagnostics.reasonCounts.missing_currency,1);assert.equal(result.diagnostics.reasonCounts.record,1);
 assert.equal(result.diagnostics.items.length,rows.length);assert.ok(result.diagnostics.items.every(item=>item.message));
 assert.equal(result.transactions.length,0);
});

test('emploie une date de valeur uniquement si la date comptable est absente et signale ce choix',()=>{
 const result=normalizeTransactions('account',[{...base,booking_date:null,value_date:'2026-11-04',remittance_information:'Utile'}]);
 assert.equal(result.transactions[0].date,'2026-11-04');assert.equal(result.transactions[0].dateSource,'value_date');assert.equal(result.diagnostics.valueDateUsed,1);assert.equal(result.transactions[0].label,'Utile');
 const inconsistent=normalizeTransactions('account',[{...base,transaction_amount:{amount:'-5',currency:'EUR'},credit_debit_indicator:'CRDT'}]);assert.equal(inconsistent.diagnostics.reasonCounts.conflicting_sign,1);
});

test('borne les détails privés et conserve tous les compteurs sur plusieurs pages',async()=>{
 let calls=0;const rows=Array.from({length:80},()=>({...base,status:'PDNG'}));
 const result=await readTransactions({request:async()=>++calls===1?{transactions:rows,continuation_key:'next'}:{transactions:rows}},['account'],{});
 assert.equal(result.skipped.pending,160);assert.equal(result.diagnostics.items.length,100);assert.equal(result.diagnostics.omitted,60);assert.equal(result.diagnostics.reasonCounts.pending,160);
 assert.equal(result.schemaVersion,2);assert.ok(!JSON.stringify(result.diagnostics).includes('reference-1'));
});

test('n’écrase pas silencieusement deux montants différents associés à une même référence',async()=>{
 await assert.rejects(readTransactions({request:async()=>({transactions:[base,{...base,transaction_amount:{amount:'20',currency:'EUR'}}]})},['account'],{}),/écritures différentes/);
 const same=await readTransactions({request:async()=>({transactions:[base,base]})},['account'],{});assert.equal(same.transactions.length,1);
});
