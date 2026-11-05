import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDefaultAccount } from './bank-balance.js';
test('conserve le choix explicite et distingue compte courant EUR et épargne',()=>{
 const current={id:'current',type:'CACC',currency:'EUR'},saving={id:'saving',type:'SVGS',currency:'EUR'},usd={id:'usd',type:'CACC',currency:'USD'};
 assert.equal(selectDefaultAccount([saving,current,usd]),'current');
 assert.equal(selectDefaultAccount([saving,current],'saving'),'saving');
 assert.equal(selectDefaultAccount([current,{...current,id:'second'}]),'');
 assert.equal(selectDefaultAccount([{id:'unknown-1'},{id:'unknown-2'}]),'');
 assert.equal(selectDefaultAccount([current],'old-account'),'current');
 assert.equal(selectDefaultAccount([]),'');
});
