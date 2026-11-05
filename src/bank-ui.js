import { mountBalance } from './bank-balance.js';
import { mountImportReport } from './import-report.js';
export function mountBank({ target, onSync }) {
  const section = document.createElement('section');
  section.className = 'panel bank-connection';
  section.setAttribute('aria-labelledby','bank-title');
  section.innerHTML = `<div class="panel-head"><div><h2 id="bank-title">Mon compte Revolut</h2><p>Connexion en lecture seule · Compte personnel · France</p></div><span class="bank-badge" id="bank-badge">Vérification…</span></div><p id="bank-description"></p><div id="bank-overview" hidden></div><form id="bank-login" hidden><label for="bank-password">Mot de passe de votre espace bancaire</label><div class="bank-login-row"><input id="bank-password" type="password" autocomplete="current-password" required maxlength="256"><button class="primary" type="submit">Déverrouiller</button></div></form><div class="bank-actions"><label id="bank-choice-label" hidden>Connexion disponible <select id="bank-choice"></select></label><button class="primary" id="bank-connect" disabled>Connecter Revolut</button><button class="primary" id="bank-sync" hidden>Synchroniser maintenant</button><button class="text-button" id="bank-disconnect" hidden>Déconnecter</button><button class="text-button" id="bank-lock" hidden>Verrouiller l’accès</button></div><p class="bank-feedback" id="bank-feedback" role="status" aria-live="polite"></p><details class="import-report" id="bank-report" hidden></details><details class="bank-help"><summary>Comment fonctionne la connexion ?</summary><p>Vous autorisez la lecture de vos comptes depuis le parcours bancaire. Mon Budget n’a pas accès à votre mot de passe Revolut et ne peut pas effectuer de paiement.</p><p>Les opérations comptabilisées en euros des 90 derniers jours sont synchronisées à l’ouverture, puis toutes les 15 minutes lorsque le site est visible. Les autres devises et opérations en attente sont ignorées. Les virements sont inclus : ils peuvent nécessiter un ajustement de votre budget. Le solde du compte est lu séparément auprès de la banque : le disponible est privilégié lorsqu’il est fourni ; sinon le solde comptabilisé et sa date sont indiqués. Le résultat du mois est calculé à partir des opérations importées.</p><p>Les catégories utilisent les codes commerçants fournis par la banque, puis des règles de reconnaissance du libellé. Les suggestions sont signalées et les dépenses ambiguës restent « À classer ». Vos corrections manuelles sont conservées. La déconnexion révoque cette connexion ; les opérations déjà importées restent sur cet appareil. Une absence de 8 heures nécessite une nouvelle connexion. Les opérations importées restent dans votre navigateur.</p><p>Configuration initiale : enregistrez une application sur <a href="https://enablebanking.com/cp/applications" target="_blank" rel="noopener noreferrer">Enable Banking</a>, activez l’accès réel à Revolut France et configurez le serveur suivant le README. Ne saisissez aucun identifiant bancaire dans Mon Budget.</p></details>`;
  target.before(section);
  const $ = selector => section.querySelector(selector);
  let status = {}, busy = false, disposed = false;
  const balancePanel = mountBalance($('#bank-overview'));
  const importReport = mountImportReport($('#bank-report'));
  const feedback = text => { $('#bank-feedback').textContent = text; };
  async function api(path, body) {
    const response = await fetch(`/api/bank/${path}`, { credentials:'same-origin', cache:'no-store', ...(body !== undefined ? { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(180000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'La connexion bancaire est indisponible.');
    return data;
  }
  function display() {
    const connected = status.connected;
    const locked = status.requiresPassword && !status.unlocked;
    if (!connected || locked) { balancePanel.clear(); importReport.clear(); }
    $('#bank-login').hidden = !(status.configured && locked);
    $('#bank-badge').textContent = connected ? 'Connecté' : status.configured ? locked ? 'Accès protégé' : 'À connecter' : 'Configuration requise';
    $('#bank-connect').hidden = Boolean(connected);
    $('#bank-sync').hidden = !connected;
    $('#bank-disconnect').hidden = !connected;
    $('#bank-lock').hidden = !(status.requiresPassword && status.unlocked);
    for (const button of section.querySelectorAll('button')) button.disabled = busy || !status.configured || (locked && !button.closest('#bank-login'));
    $('#bank-password').disabled = busy;
    $('#bank-description').textContent = connected
      ? `Synchronisation automatique des opérations en EUR. Autorisation valable au plus tard jusqu’au ${new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(status.expires)}.`
      : status.configured && locked ? 'Déverrouillez la connexion avec le mot de passe Mon Budget configuré sur votre serveur. Ce mot de passe est distinct de celui de Revolut.' : status.securityConfigured === false ? 'Le mot de passe applicatif et le stockage sécurisé doivent être configurés avant de connecter la banque.' : status.configured ? 'Autorisez Revolut pour retrouver vos opérations ici, sans saisie manuelle.' : 'Le serveur doit être configuré avec une application Enable Banking avant de pouvoir connecter votre compte réel. Consultez les instructions ci-dessous.';
  }
  async function loadStatus() { status = await api('status'); display(); }
  async function sync() {
    if (busy || !status.connected || (status.requiresPassword && !status.unlocked)) return;
    busy = true; display(); feedback('Synchronisation en cours…');
    try {
      let balanceError = '';
      try { balancePanel.update(await api('balances',{})); }
      catch(error) { balanceError = error.message; balancePanel.fail(`Solde indisponible : ${error.message}`); }
      const data = await api('sync',{});
      const result = onSync(data.transactions);
      const skipped = data.skipped || {};
      importReport.update(data);
      feedback(`${balanceError ? "Le solde n’a pas pu être actualisé. " : ""}${result.added} nouvelle(s), ${result.updated} actualisée(s), ${result.unchanged || 0} déjà à jour ; ${result.categorized || 0} catégorie(s) attribuée(s). Synchronisé à ${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(data.syncedAt)}. Non importées : ${skipped.pending || 0} provisoires, ${skipped.currency || 0} hors EUR, ${skipped.zero || 0} de montant nul, ${skipped.status || 0} autre(s) statut(s), ${skipped.invalid || 0} à examiner. Ouvrez le détail ci-dessous.${data.unstableAccounts ? " Identifiant de compte stable absent : vérifiez les doublons éventuels après une nouvelle connexion." : ""}`);
    } catch (error) {
      feedback(error.message === 'The operation was aborted due to timeout' ? 'La synchronisation a pris trop de temps. Réessayez.' : error.message);
      try { await loadStatus(); } catch { /* Preserve the useful synchronization error. */ }
    } finally { busy = false; display(); }
  }
  $('#bank-login').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const password = $('#bank-password').value;
    $('#bank-password').value = ''; busy = true; display();
    try { await api('login',{password}); await loadStatus(); feedback('Accès bancaire déverrouillé.'); }
    catch(error) { feedback(error.message); }
    finally { busy = false; display(); }
    if (status.connected) await sync();
  };
  $('#bank-connect').onclick = async()=>{
    if (busy) return;
    busy = true; display(); feedback('Préparation du parcours Revolut…');
    try {
      const data = await api('connect',$('#bank-choice').value ? { bank:$('#bank-choice').value } : {});
      if (data.banks) {
        $('#bank-choice').replaceChildren(...data.banks.map(name=>new Option(name,name)));
        $('#bank-choice-label').hidden = false;
        feedback('Plusieurs connexions sont disponibles. Choisissez celle de votre compte, puis cliquez sur Connecter Revolut.');
      } else {
        const url = new URL(data.url);
        if (url.protocol !== 'https:') throw new Error('Adresse d’autorisation invalide.');
        window.location.assign(url.href);
      }
    } catch(error) { feedback(error.message); }
    finally { busy = false; display(); }
  };
  $('#bank-sync').onclick = sync;
  $('#bank-lock').onclick = async()=>{
    if(busy)return;busy=true;display();
    try{await api('logout',{});await loadStatus();feedback('Accès bancaire verrouillé. Les données déjà présentes dans ce navigateur restent sur cet appareil.');}
    catch(error){feedback(error.message);}finally{busy=false;display();}
  };
  $('#bank-disconnect').onclick = async()=>{
    if (busy || !confirm('Révoquer la connexion Revolut ? Les opérations déjà importées resteront sur cet appareil.')) return;
    busy = true; display();
    try { await api('disconnect',{}); await loadStatus(); feedback('Connexion révoquée. Vos opérations importées sont conservées.'); }
    catch(error) { feedback(error.message); }
    finally { busy = false; display(); }
  };
  const params = new URLSearchParams(location.search);
  const outcome = params.get('bank');
  if (outcome) {
    const url = new URL(location.href); url.searchParams.delete('bank'); history.replaceState(null,'',url);
    feedback(outcome === 'connected' ? 'Autorisation reçue. Synchronisation…' : outcome === 'cancelled' ? 'Autorisation annulée. Aucune nouvelle connexion créée.' : 'La connexion n’a pas abouti. Réessayez depuis ce navigateur.');
  }
  loadStatus().then(()=>{ if(status.connected) return sync(); }).catch(()=>{ $('#bank-badge').textContent='Serveur indisponible'; $('#bank-description').textContent='La connexion bancaire est momentanément indisponible. Réessayez lorsque le serveur sera accessible.'; });
  const interval = setInterval(()=>{ if(!disposed && document.visibilityState === 'visible') loadStatus().then(sync).catch(()=>feedback('Serveur bancaire indisponible.')); },15*60000);
  window.addEventListener('pagehide',()=>{ disposed = true; clearInterval(interval); },{once:true});
}
