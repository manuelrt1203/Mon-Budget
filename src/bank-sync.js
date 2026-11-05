import { validateTransaction } from './budget.js';
import { categorize } from './categorization.js';

export function mergeBankTransactions(current,incoming){
 if(!Array.isArray(incoming)||incoming.some(t=>!validateTransaction(t)||t.source!=='revolut'||!/^bank-[a-f0-9]{64}$/.test(t.id)))throw new Error('Les opérations reçues sont invalides. Aucune modification effectuée.');
 const byId=new Map(current.map(t=>[t.id,t]));
 let added=0,updated=0,unchanged=0,categorized=0;
 for(const t of new Map(incoming.map(t=>[t.id,t])).values()){
  const previous=byId.get(t.id);
  const automatic=t.categorySource?t:{...t,...categorize(t)};
  if(previous){
   if(previous.source!=='revolut')throw new Error('Un identifiant d’opération existe déjà. Aucune modification effectuée.');
   const manual=previous.categorySource==='manual'||(!previous.categorySource&&previous.category!=='Autres');
   const next=manual?{...automatic,category:previous.category,categorySource:'manual',categoryReason:'Catégorie choisie par vous.'}:automatic;
   if(['label','amount','date','type','category','categorySource','dateSource'].some(key=>previous[key]!==next[key]))updated++;else unchanged++;
   if(!manual&&previous.category!==next.category)categorized++;
   byId.set(t.id,next);
  }else{byId.set(t.id,automatic);added++;if(!['unclassified','income'].includes(automatic.categorySource))categorized++;}
 }
 return{transactions:[...byId.values()],added,updated,unchanged,categorized};
}
