export const normalizeMerchant=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const mccCategories={
 Alimentation:['5411','5422','5441','5451','5462','5499','5811','5812','5813','5814'],
 Logement:['4900','6513'],Transport:['4011','4111','4112','4121','4131','4511','4789','5541','5542'],
 Loisirs:['7832','7922','7996','7999'],Études:['8211','8220','8241','8244','8249','8299'],
 Santé:['5912','8011','8021','8031','8041','8042','8043','8049','8050','8062','8071','8099'],
};
const rules=[
 ['Alimentation',/\b(CARREFOUR|LIDL|ALDI|AUCHAN|INTERMARCHE|MONOPRIX|FRANPRIX|LECLERC|NETTO|PICARD|UTILE)\b/,'Commerçant alimentaire reconnu'],
 ['Alimentation',/\b(SUPER U|HYPER U|U EXPRESS|UBER EATS|DELIVEROO|JUST EAT|MCDONALD S|MCDONALDS|BURGER KING)\b/,'Commerçant alimentaire reconnu'],
 ['Alimentation',/\bCAFES?\s*BIBAL(?:\s*VENDING)?\b|\bBIBAL VENDING\b/,'Distributeur de boissons Café Bibal'],
 ['Logement',/\b(OQORO|EDF|ENGIE|VEOLIA)\b/,'Gestionnaire de logement ou fournisseur reconnu'],
 ['Transport',/\b(SNCF|OUIGO|RATP|TISSEO|BLABLACAR|UBER TRIP|UBER RIDES)\b/,'Service de transport reconnu'],
 ['Loisirs',/\b(NETFLIX|SPOTIFY|DISNEY PLUS|CINEMA|PATHE|GAUMONT)\b/,'Service de loisirs reconnu'],
 ['Études',/\b(CROUS SCOLARITE|FRAIS DE SCOLARITE|DROITS UNIVERSITAIRES|UNIVERSITE|BUREAU VALLEE)\b/,'Libellé lié aux études'],
 ['Santé',/\b(PHARMACIE|PARAPHARMACIE|DOCTOLIB|LABORATOIRE MEDICAL)\b/,'Libellé lié aux soins'],
];
export function categorize({label,type,mcc,merchant}){
 const merchantKey=normalizeMerchant(merchant||label);
 if(type==='income')return{category:'Autres',categorySource:'income',categoryReason:'Entrée d’argent ; catégorie de dépense non applicable.',merchantKey};
 const code=String(mcc||'').trim();
 for(const[category,codes]of Object.entries(mccCategories))if(codes.includes(code))return{category,categorySource:'mcc',categoryReason:`Code commerçant bancaire ${code}.`,merchantKey};
 const text=normalizeMerchant([merchant,label].filter(Boolean).join(' '));
 for(const[category,pattern,reason]of rules)if(pattern.test(text))return{category,categorySource:'rule',categoryReason:`Suggestion : ${reason.toLowerCase()}.`,merchantKey};
 return{category:'Autres',categorySource:'unclassified',categoryReason:'Informations insuffisantes pour proposer une catégorie fiable. À vérifier.',merchantKey};
}
export const needsCategoryReview=t=>t.source==='revolut'&&t.type==='expense'&&t.categorySource!=='manual'&&(t.categorySource==='unclassified'||(!t.categorySource&&t.category==='Autres'));
