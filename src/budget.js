export const budgetCategories=['Alimentation','Logement','Transport','Loisirs','Études','Santé','Autres'];
export const transferDirections={'Virement entrant':'income','Virement sortant':'expense','Vers l’épargne':'expense','Depuis l’épargne':'income'};
export const categories=[...budgetCategories,...Object.keys(transferDirections)];
export const categoriesForType=type=>categories.filter(category=>!transferDirections[category]||transferDirections[category]===type);
export const isTransfer=t=>transferDirections[t.category]===t.type;
export const defaultLimits={Alimentation:200,Logement:450,Transport:50,Loisirs:80,Études:40,Santé:30,Autres:50};
export function summary(transactions,month){
 const entries=transactions.filter(t=>t.date.startsWith(month));
 const cents=predicate=>entries.filter(predicate).reduce((total,t)=>total+Math.round(t.amount*100),0);
 const sum=predicate=>cents(predicate)/100;
 const income=sum(t=>t.type==='income'),expenses=sum(t=>t.type==='expense');
 return{entries,income,expenses,balance:(cents(t=>t.type==='income')-cents(t=>t.type==='expense'))/100,budgetIncome:sum(t=>t.type==='income'&&!isTransfer(t)),budgetExpenses:sum(t=>t.type==='expense'&&!isTransfer(t)),incomingTransfers:sum(t=>t.category==='Virement entrant'),outgoingTransfers:sum(t=>t.category==='Virement sortant'),toSavings:sum(t=>t.category==='Vers l’épargne'),fromSavings:sum(t=>t.category==='Depuis l’épargne')};
}
export function validateTransaction(t){
 return t!==null&&typeof t==='object'&&typeof t.id==='string'&&typeof t.label==='string'&&t.label.trim().length>0&&t.label.length<=100&&Number.isFinite(t.amount)&&t.amount>0&&['income','expense'].includes(t.type)&&categoriesForType(t.type).includes(t.category)&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&!Number.isNaN(Date.parse(t.date))&&new Date(t.date).toISOString().slice(0,10)===t.date;
}
