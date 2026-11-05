import { createHash } from 'node:crypto';
import { categorize } from '../src/categorization.js';

export const IMPORT_REASONS={
 pending:'Opération provisoire : la banque ne l’a pas encore comptabilisée.',
 status:'Statut bancaire absent ou non pris en charge ; opération non assimilée à une attente.',
 currency:'Devise autre que l’euro : aucun taux de conversion appliqué.',
 missing_currency:'Devise absente de la réponse bancaire.',
 reference:'Référence bancaire stable absente : import bloqué pour éviter les doublons.',
 date:'Date comptable invalide, ou aucune date comptable/de valeur exploitable.',
 direction:'Sens débit/crédit absent ou invalide.',
 amount:'Montant absent, illisible, hors limites ou comportant une fraction de centime.',
 conflicting_sign:'Montant négatif associé à un crédit : informations contradictoires.',
 zero:'Montant nul : aucune entrée ou sortie d’argent à compter.',
 record:'Ligne bancaire illisible.',
};
export function parseCents(value){
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const m=/^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
 if(!m||(m[3]||'').slice(2).replace(/0/g,'')!=='')return null;
 const cents=Number(m[2])*100+Number((m[3]||'').padEnd(2,'0').slice(0,2));
 if(!Number.isSafeInteger(cents))return null;
 return m[1]==='-'?-cents:cents;
}
function dateOnly(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))return null;
 const date=value.slice(0,10);
 if(Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return null;
 if(value.length>10&&Number.isNaN(Date.parse(value)))return null;
 return date;
}
function labelOf(row){
 const info=Array.isArray(row?.remittance_information)?row.remittance_information.filter(s=>typeof s==='string').join(' '):typeof row?.remittance_information==='string'?row.remittance_information:'';
 const name=row?.credit_debit_indicator==='CRDT'?row?.debtor?.name:row?.creditor?.name;
 return(info.trim()||(typeof name==='string'?name.trim():'')||'Opération Revolut').slice(0,100);
}
export function normalizeTransactions(account,rows){
 const transactions=[],skipped={pending:0,currency:0,invalid:0,status:0,zero:0};
 const diagnostics={reasonCounts:{},items:[],omitted:0,valueDateUsed:0};
 function skip(row,bucket,reason){
  skipped[bucket]++;diagnostics.reasonCounts[reason]=(diagnostics.reasonCounts[reason]||0)+1;
  if(diagnostics.items.length<100){
   const cents=parseCents(row?.transaction_amount?.amount);
   diagnostics.items.push({label:labelOf(row),date:dateOnly(row?.booking_date)||dateOnly(row?.value_date),amount:cents===null?null:cents/100,currency:typeof row?.transaction_amount?.currency==='string'?row.transaction_amount.currency.slice(0,8):null,status:typeof row?.status==='string'?row.status.slice(0,20):null,reason,message:IMPORT_REASONS[reason]});
  }else diagnostics.omitted++;
 }
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row)){skip(row,'invalid','record');continue;}
  const status=typeof row.status==='string'?row.status.trim().toUpperCase():'';
  if(['PDNG','PENDING'].includes(status)){skip(row,'pending','pending');continue;}
  if(status!=='BOOK'){skip(row,'status','status');continue;}
  if(!row.transaction_amount?.currency){skip(row,'invalid','missing_currency');continue;}
  if(row.transaction_amount.currency!=='EUR'){skip(row,'currency','currency');continue;}
  const cents=parseCents(row.transaction_amount.amount);
  if(cents===null){skip(row,'invalid','amount');continue;}
  if(cents===0){skip(row,'zero','zero');continue;}
  const ref=[row.transaction_id,row.entry_reference].find(value=>(typeof value==='string'&&value.trim())||(typeof value==='number'&&Number.isSafeInteger(value)));
  if(ref===undefined){skip(row,'invalid','reference');continue;}
  const booking=dateOnly(row.booking_date);
  const fallback=!row.booking_date?dateOnly(row.value_date):null;
  const date=booking||fallback;
  if(!date){skip(row,'invalid','date');continue;}
  if(!['DBIT','CRDT'].includes(row.credit_debit_indicator)){skip(row,'invalid','direction');continue;}
  if(cents<0&&row.credit_debit_indicator==='CRDT'){skip(row,'invalid','conflicting_sign');continue;}
  const type=row.credit_debit_indicator==='CRDT'?'income':'expense',label=labelOf(row);
  const id=`bank-${createHash('sha256').update(JSON.stringify([account,String(ref)])).digest('hex')}`;
  const merchant=[row.merchant?.name,row.merchant_details?.name].find(s=>typeof s==='string'&&s.trim());
  const mcc=row.merchant_category_code??row.merchant?.merchant_category_code??row.merchant_details?.merchant_category_code;
  if(fallback)diagnostics.valueDateUsed++;
  transactions.push({id,label,amount:Math.abs(cents)/100,date,type,...categorize({label,type,mcc,merchant}),dateSource:fallback?'value_date':'booking_date',source:'revolut'});
 }
 return{transactions,skipped,diagnostics};
}
