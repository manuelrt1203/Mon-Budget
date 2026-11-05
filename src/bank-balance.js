export function selectDefaultAccount(accounts,previousId){
  if(accounts.some(a=>a.id===previousId))return previousId;
  if(accounts.length===1)return accounts[0].id;
  const current=accounts.filter(a=>a.type==='CACC'&&(!a.currency||a.currency==='EUR'));
  return current.length===1?current[0].id:'';
}

export function mountBalance(target){
  target.innerHTML=`<label class="account-choice" for="balance-account">Compte à afficher<select id="balance-account"></select></label><p id="bank-account-scope" class="account-scope"></p><div class="account-balance"><span id="account-balance-label">Solde du compte</span><strong id="account-balance-amount">—</strong><span id="account-balance-detail"></span><small id="account-balance-date"></small></div><p class="account-balance-note">Solde fourni par Revolut via la connexion bancaire. Les calculs du mois sont affichés séparément.</p>`;
  const $=selector=>target.querySelector(selector);
  let accounts=[],selected='',stale=false;
  const money=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n);
  const time=value=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(value);
  function render(){
    const account=accounts.find(a=>a.id===selected),balance=account?.balances?.[0];
    $('#account-balance-label').textContent=balance?balance.label:'Solde du compte';
    $('#account-balance-amount').textContent=balance?money(balance.amount):'—';
    $('#account-balance-detail').textContent=balance?balance.kind==='booked'?'Montant comptabilisé. Le disponible affiché par Revolut peut différer, notamment avec les paiements en attente.':'Montant disponible communiqué par la banque.':account?.error||'Sélectionnez le compte à consulter pour afficher son solde.';
    $('#account-balance-date').textContent=balance?`${stale?'Dernier relevé conservé — actualisation échouée. ':''}Consulté le ${time(account.fetchedAt)}${balance.bankDate?` · Date banque : ${/^\d{4}-\d{2}-\d{2}$/.test(balance.bankDate)?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short'}).format(new Date(balance.bankDate+'T12:00:00')):time(new Date(balance.bankDate))}`:' · Date du solde non précisée par la banque.'}`:'';
  }
  $('#balance-account').onchange=e=>{
    selected=e.target.value;
    try{localStorage.setItem('mon-budget-selected-account',selected);}catch{/* Selection works without persistence. */}
    render();
  };
  return {
    update(data){
      accounts=Array.isArray(data?.accounts)?data.accounts:[];
      let previous=selected;
      if(!previous)try{previous=localStorage.getItem('mon-budget-selected-account');}catch{/* Optional preference. */}
      selected=selectDefaultAccount(accounts,previous);stale=false;
      const options=[new Option('Choisir un compte…',''),...accounts.map(a=>{const type=a.type==='SVGS'?'Épargne':a.type==='CACC'?'Compte courant':null;return new Option([type,a.name!==type?a.name:null,a.maskedIban,a.currency||(a.balances?.length?'EUR':'Devise non précisée')].filter(Boolean).join(' · '),a.id);})];
      $('#bank-account-scope').textContent=`${accounts.length} compte(s) transmis pour cette autorisation. Si votre épargne manque, actualisez les comptes ou renouvelez l’autorisation. Certains produits d’épargne ne sont pas accessibles via cette API. Son solde n’est jamais déduit des virements.`;
      $('#balance-account').replaceChildren(...options);$('#balance-account').value=selected;
      target.hidden=false;render();
    },
    fail(message){
      if(accounts.length){stale=true;render();$('#account-balance-date').textContent+=` ${message}`;}
      else{target.hidden=false;$('#account-balance-amount').textContent='—';$('#account-balance-detail').textContent=message;}
    },
    clear(){accounts=[];stale=false;target.hidden=true;$('#account-balance-amount').textContent='—';$('#account-balance-detail').textContent='';$('#account-balance-date').textContent='';$('#balance-account').replaceChildren();$('#bank-account-scope').textContent='';},
  };
}
