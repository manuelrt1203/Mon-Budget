export function mountImportReport(target){
 const summary=document.createElement('summary');summary.textContent='Comprendre les opérations non importées';
 const content=document.createElement('div');target.replaceChildren(summary,content);
 return{
  clear(){target.hidden=true;content.replaceChildren();},
  update(data){
   const skipped=data.skipped||{},diagnostics=data.diagnostics;
   const ignored=Object.values(skipped).reduce((sum,n)=>sum+(Number(n)||0),0);
   content.replaceChildren();target.hidden=false;
   const intro=document.createElement('p');intro.textContent=`${data.transactions?.length||0} opération(s) comptabilisée(s) reçue(s) sur les 90 derniers jours ; ${ignored} ligne(s) non importée(s). Ces totaux portent sur toute la période, pas uniquement le mois affiché.${data.syncedAt ? ` Lecture du ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(data.syncedAt)}.` : ''}`;content.append(intro);
   const explanation=document.createElement('p');explanation.textContent='Une opération provisoire n’est pas encore comptabilisée par la banque. Elle n’entre pas dans les budgets et sera relue à la prochaine synchronisation. Son impact éventuel sur le disponible est déjà géré par le solde bancaire ; Mon Budget ne le soustrait pas une deuxième fois.';content.append(explanation);
   if(!diagnostics){const p=document.createElement('p');p.textContent='Ce résultat ne contient pas encore les motifs détaillés. Relancez la synchronisation après le déploiement de la nouvelle version.';content.append(p);return;}
   const counts=new Map();for(const item of diagnostics.items||[])counts.set(item.reason,item.message);
   const labels={pending:'Provisoires (statut bancaire PDNG/PENDING)',status:'Autres statuts ou statut absent',currency:'Devises hors EUR',missing_currency:'Devise absente',reference:'Référence bancaire absente',date:'Date inexploitable',direction:'Sens débit/crédit absent',amount:'Montant inexploitable',conflicting_sign:'Montant et sens contradictoires',zero:'Montant nul',record:'Ligne illisible'};
   const list=document.createElement('ul');for(const[reason,count]of Object.entries(diagnostics.reasonCounts||{})){const li=document.createElement('li');li.textContent=`${count} — ${labels[reason]||counts.get(reason)||reason}`;list.append(li);}content.append(list);
   if(diagnostics.valueDateUsed){const p=document.createElement('p');p.textContent=`${diagnostics.valueDateUsed} opération(s) importée(s) utilisent la date de valeur car la date comptable est absente. Elles sont signalées dans le tableau.`;content.append(p);}
   if(diagnostics.items?.length){
    const wrap=document.createElement('div');wrap.className='table-wrap';
    const table=document.createElement('table');const head=document.createElement('thead'),tr=document.createElement('tr');
    for(const text of ['Opération','Statut banque','Motif']){const th=document.createElement('th');th.textContent=text;tr.append(th);}head.append(tr);table.append(head);
    const body=document.createElement('tbody');
    for(const item of diagnostics.items){const row=document.createElement('tr');for(const[index,text]of [item.label,item.status||'Absent',item.message].entries()){const td=document.createElement('td');td.textContent=text;if(index===0){const small=document.createElement('small');small.className='bank-source';small.textContent=`${item.date||'Date non fournie'} · Montant indiqué : ${item.amount===null?'non fourni':new Intl.NumberFormat('fr-FR',{minimumFractionDigits:2,maximumFractionDigits:2}).format(item.amount)} ${item.currency||''}`;td.append(small);}row.append(td);}body.append(row);}table.append(body);wrap.append(table);content.append(wrap);
   }
   if(diagnostics.omitted){const p=document.createElement('p');p.textContent=`${diagnostics.omitted} ligne(s) supplémentaire(s) non affichée(s) ; elles restent incluses dans les compteurs ci-dessus.`;content.append(p);}
  },
 };
}
