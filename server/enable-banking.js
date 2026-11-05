import { normalizeTransactions } from './transactions.js';
export { normalizeTransactions } from './transactions.js';
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export class BankError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function createProvider({ appId, keyPath, privateKey, fetchImpl = fetch }) {
  let key;
  if (appId && (privateKey || keyPath)) {
    try {
      key = createPrivateKey(privateKey || readFileSync(keyPath));
      if (key.asymmetricKeyType !== 'rsa') throw new Error('Expected RSA');
    } catch { throw new BankError('La clé privée Enable Banking est illisible ou invalide.', 503); }
  }
  return {
    configured: Boolean(appId && key),
    async request(path, { method = 'GET', body, psu } = {}) {
      if (!appId || !key) throw new BankError('La connexion bancaire doit être configurée sur le serveur.', 503);
      const now = Math.floor(Date.now() / 1000);
      const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
      const unsigned = `${encode({ typ: 'JWT', alg: 'RS256', kid: appId })}.${encode({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 300 })}`;
      const jwt = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url')}`;
      let response;
      try {
        response = await fetchImpl(`https://api.enablebanking.com${path}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(psu ? { 'psu-ip-address': psu.ip, 'psu-user-agent': psu.agent } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch { throw new BankError('Le prestataire bancaire est injoignable. Réessayez plus tard.'); }
      // Never relay provider bodies: they may contain account data or credentials.
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw new BankError('Accès refusé par le prestataire : vérifiez la configuration ou reconnectez Revolut.', 502);
        if ([404, 410].includes(response.status)) throw new BankError('Le consentement bancaire peut avoir expiré. Reconnectez Revolut.', 409);
        if (response.status === 429) throw new BankError('Le prestataire demande de patienter avant une nouvelle synchronisation.', 429);
        throw new BankError('Le prestataire bancaire a refusé la demande. Vérifiez la configuration et réessayez.');
      }
      if (response.status === 204) return null;
      try { return await response.json(); } catch { throw new BankError('Réponse bancaire illisible.'); }
    },
  };
}

export async function readTransactions(provider, accounts, psu) {
  if (!Array.isArray(accounts) || !accounts.length) throw new BankError('Aucun compte accessible. Reconnectez Revolut.', 409);
  if (accounts.length > 30) throw new BankError('Trop de comptes pour cette synchronisation.');
  const all = [], skipped = { pending: 0, currency: 0, invalid: 0, status: 0, zero: 0 };
  const diagnostics={reasonCounts:{},items:[],omitted:0,valueDateUsed:0};
  let unstableAccounts = 0;
  const dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0,10);
  const startedAt = Date.now();
  for (const account of accounts) {
    const uid = typeof account === 'string' ? account : account?.uid;
    if (typeof uid !== 'string' || !uid) throw new BankError('Identifiant de compte absent de la réponse bancaire.');
    const iban = typeof account?.account_id?.iban === 'string' ? account.account_id.iban.replace(/\s/g,'').toUpperCase() : '';
    const stableIdentity = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban) ? iban : typeof account?.identification_hash === 'string' && account.identification_hash ? account.identification_hash : null;
    if (!stableIdentity) unstableAccounts++;
    let continuation, pages = 0;
    const seen = new Set();
    do {
      if (Date.now() - startedAt > 120000) throw new BankError('La synchronisation a pris trop de temps. Aucune opération n’a été importée.');
      const query = new URLSearchParams({ date_from: dateFrom });
      if (continuation) query.set('continuation_key', continuation);
      const result = await provider.request(`/accounts/${encodeURIComponent(uid)}/transactions?${query}`, { psu });
      if (!Array.isArray(result?.transactions)) throw new BankError('Liste des opérations absente de la réponse bancaire.');
      const normalized = normalizeTransactions(stableIdentity || uid, result.transactions);
      all.push(...normalized.transactions);
      for (const key of Object.keys(skipped)) skipped[key] += normalized.skipped[key];
      for(const [reason,count]of Object.entries(normalized.diagnostics.reasonCounts))diagnostics.reasonCounts[reason]=(diagnostics.reasonCounts[reason]||0)+count;
      diagnostics.items.push(...normalized.diagnostics.items.slice(0,Math.max(0,100-diagnostics.items.length)));
      diagnostics.valueDateUsed+=normalized.diagnostics.valueDateUsed;
      continuation = result.continuation_key;
      pages++;
      if (continuation && (typeof continuation !== 'string' || seen.has(continuation) || pages >= 100)) throw new BankError('La synchronisation est incomplète. Aucune opération n’a été importée.');
      if (continuation) seen.add(continuation);
      if (all.length > 20000) throw new BankError('Trop d’opérations dans la réponse bancaire.');
    } while (continuation);
  }
  const byId=new Map();
  for(const t of all){const old=byId.get(t.id);if(old&&['amount','date','type'].some(key=>old[key]!==t[key]))throw new BankError('La banque a renvoyé une même référence pour des écritures différentes. Import interrompu pour éviter un montant erroné.');byId.set(t.id,t);}
  diagnostics.omitted=Object.values(skipped).reduce((a,b)=>a+b,0)-diagnostics.items.length;
  return { schemaVersion:2,transactions:[...byId.values()],skipped,diagnostics,dateFrom,unstableAccounts };
}
