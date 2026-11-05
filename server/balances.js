import { createHash } from 'node:crypto';
import { BankError } from './enable-banking.js';

const TYPES = {
  ITAV: {kind:'available',label:'Solde disponible',priority:0},
  ITBD: {kind:'booked',label:'Solde comptabilisé',priority:1},
  CLAV: {kind:'available',label:'Solde disponible de clôture',priority:2},
  CLBD: {kind:'booked',label:'Solde comptabilisé de clôture',priority:3},
};

export function normalizeBalances(rows) {
  if (!Array.isArray(rows)) throw new BankError('La banque n’a pas fourni de liste de soldes.');
  return rows.flatMap(row=>{
    if (!row || row.balance_amount?.currency!=='EUR' || !TYPES[row.balance_type]) return [];
    const raw=String(row.balance_amount.amount);
    const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
    if (!match || (match[3]||'').slice(2).replace(/0/g,'')!=='') return [];
    const cents=Number(match[2])*100+Number((match[3]||'').padEnd(2,'0').slice(0,2));
    if (!Number.isSafeInteger(cents)) return [];
    if(row.credit_debit_indicator && !['CRDT','DBIT'].includes(row.credit_debit_indicator))return [];
    const negative=match[1]==='-'||row.credit_debit_indicator==='DBIT';
    let amount=(negative?-cents:cents)/100;
    if(Object.is(amount,-0))amount=0;
    const rawDate=row.last_change_date_time || row.reference_date || null;
    const bankDate=typeof rawDate==='string'&&!Number.isNaN(Date.parse(rawDate))?rawDate:null;
    return [{amount,currency:'EUR',type:row.balance_type,...TYPES[row.balance_type],bankDate}];
  }).sort((a,b)=>a.priority-b.priority || (b.bankDate||'').localeCompare(a.bankDate||''));
}

function describeAccount(account,index){
  const uid=typeof account==='string'?account:account?.uid;
  if(typeof uid!=='string'||!uid)throw new BankError('Identifiant de compte absent de la réponse bancaire.');
  const iban=typeof account?.account_id?.iban==='string'?account.account_id.iban.replace(/\s/g,'').toUpperCase():'';
  const validIban=/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban);
  const identity=validIban?iban:typeof account?.identification_hash==='string'&&account.identification_hash?account.identification_hash:uid;
  const type=typeof account?.cash_account_type==='string'?account.cash_account_type:typeof account?.account_type==='string'?account.account_type:null;
  const fallback=type==='CACC'?'Compte courant':type==='SVGS'?'Épargne':`Compte Revolut ${index+1}`;
  const name=typeof account?.name==='string'&&account.name.trim()?account.name.trim().slice(0,100):fallback;
  const currency=typeof account?.currency==='string'&&/^[A-Z]{3}$/.test(account.currency)?account.currency:null;
  return {uid,id:`account-${createHash('sha256').update(identity).digest('hex')}`,name:validIban?name.replaceAll(iban,`•••• ${iban.slice(-4)}`):name,type,currency,maskedIban:validIban?`•••• ${iban.slice(-4)}`:null};
}

export async function readAccountBalances(provider,accounts,psu){
  if(!Array.isArray(accounts)||!accounts.length)throw new BankError('Aucun compte accessible. Reconnectez Revolut.',409);
  if(accounts.length>30)throw new BankError('Trop de comptes pour cette synchronisation.');
  const descriptions=accounts.map(describeAccount);
  const started=Date.now(),results=[];
  // Small batches keep provider requests bounded and allow each account to fail independently.
  for(let offset=0;offset<descriptions.length;offset+=3){
    const batch=descriptions.slice(offset,offset+3);
    const outcomes=await Promise.all(batch.map(async account=>{
      const {uid,...publicAccount}=account;
      try{
        if(Date.now()-started>100000)throw new BankError('Actualisation trop longue. Réessayez pour ce compte.');
        const data=await provider.request(`/accounts/${encodeURIComponent(uid)}/balances`,{psu});
        const balances=normalizeBalances(data?.balances);
        return {...publicAccount,balances,fetchedAt:Date.now(),error:balances.length?null:'La banque n’a pas fourni de solde EUR disponible ou comptabilisé exploitable.'};
      }catch(error){return {...publicAccount,balances:[],fetchedAt:null,error:error instanceof BankError?error.message:'Le solde de ce compte est indisponible.'};}
    }));
    results.push(...outcomes);
  }
  return {accounts:results,queriedAt:Date.now()};
}
