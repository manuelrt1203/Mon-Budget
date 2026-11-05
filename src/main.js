import './style.css';
import { mountBank } from './bank-ui.js';
import { mergeBankTransactions } from './bank-sync.js';
import { needsCategoryReview } from './categorization.js';
import {
  categories, budgetCategories, categoriesForType, summary, spentByCategory, monthlySeries, shiftMonth, isMonth, isRealDate,
  validateTransaction, limitsFor, hasMonthLimits, applyLimits, resetMonthLimits, upsertTransaction, removeTransaction, filterTransactions,
  netOf, reviewCount, emptyState, serializeBackup, parseBackup, mergeStates, transactionsToCsv, parseAmount,
} from './budget.js';
import { loadState, saveState } from './storage.js';
import { createCloud } from './cloud.js';
import { icon, categoryIcon } from './icons.js';

// ---------- Utilitaires ----------

const euro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const money = n => euro.format(n || 0); // `|| 0` évite l'affichage de « -0,00 € »
const signed = n => `${n > 0 ? '+' : ''}${money(n)}`;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const currentMonth = () => today().slice(0, 7);
const monthDate = m => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1);
const longMonth = m => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(monthDate(m));
const shortMonth = m => new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(monthDate(m));
const dayLabel = (d, withYear) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${d}T12:00:00`));
const sum = values => values.reduce((s, n) => s + n, 0);
const $ = selector => document.querySelector(selector);
const isBank = t => t.source === 'revolut';
const budgetLabel = c => (c === 'Autres' ? 'Autres / à classer' : c);

// ---------- État ----------

const loaded = loadState();
let state = loaded.state;
let unreadable = loaded.error === 'unreadable';
let droppedAtLoad = loaded.dropped ?? 0;
let storageFailed = false;
let month = currentMonth();
const ui = { query: '', type: 'all', category: 'all', sort: 'date-desc', allMonths: false, limit: 50 };

function persist() {
  storageFailed = !saveState(state);
  renderNotice();
  cloud.markDirty(); // la copie en ligne suit chaque enregistrement (envoi différé de quelques secondes)
  return !storageFailed;
}

// ---------- Sauvegarde en ligne ----------

const cloud = createCloud({ getState: () => state, applyState, onChange: onCloudChange });

/** Applique des données venues de la sauvegarde en ligne (restauration ou fusion) sans les renvoyer aussitôt. */
function applyState(next, { reason }) {
  state = next;
  storageFailed = !saveState(state);
  unreadable = false;
  droppedAtLoad = 0;
  render();
  toast(reason === 'restore'
    ? `Données restaurées depuis la sauvegarde en ligne (${plural(next.transactions.length, 'opération')}).`
    : 'Données fusionnées avec la sauvegarde en ligne.');
}

let lockedShown = false;
function onCloudChange(status) {
  const card = document.querySelector('#cloud-card');
  if (card) card.innerHTML = cloudCardBody();
  const online = status.phase === 'idle' && status.durable;
  document.querySelectorAll('.privacy span').forEach(el => { el.textContent = online ? 'Sauvegardé sur cet appareil et en ligne' : 'Historique sauvegardé sur cet appareil'; });
  renderNotice();
  // Le bandeau « verrouillé » de la vue d'ensemble apparaît ou disparaît quand l'accès change.
  if ((status.phase === 'locked') !== lockedShown) { lockedShown = status.phase === 'locked'; if (routeName() === '') render(); }
}

// ---------- Thème ----------

const THEME_KEY = 'mon-budget-theme';
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch { return 'auto'; } };
function setTheme(theme) {
  try { theme === 'auto' ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, theme); } catch { /* préférence non conservée */ }
  theme === 'auto' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', theme);
}

// ---------- Coquille de l'application ----------

const navItems = [
  ['', 'dashboard', 'Vue d’ensemble'],
  ['operations', 'swap', 'Opérations'],
  ['budgets', 'target', 'Budgets'],
  ['banque', 'bank', 'Banque'],
  ['donnees', 'database', 'Données'],
];

$('#app').innerHTML = `
  <a class="skip-link" href="#main">Aller au contenu</a>
  <div class="layout">
    <nav class="sidebar" aria-label="Navigation principale">
      <a class="brand" href="#/" aria-label="Mon Budget, vue d’ensemble">
        <span class="brand-mark">${icon('wallet', 22)}</span><span class="brand-name">mon budget</span>
      </a>
      <ul class="nav-list">
        ${navItems.map(([route, ic, label]) => `<li><a class="nav-link" data-route="${route}" href="#/${route}">${icon(ic, 22)}<span>${label}</span></a></li>`).join('')}
      </ul>
      <aside class="sidebar-note">
        ${icon('sparkle', 20)}
        <p><strong>Un petit pas aujourd’hui, plus de liberté demain.</strong></p>
        <p>Chaque euro a sa place. À vous de lui donner un cap.</p>
      </aside>
    </nav>
    <main id="main" tabindex="-1">
      <div id="notice" role="status"></div>
      <div id="view"></div>
      <footer class="site-footer">
        <span>Mon Budget</span>
        <nav aria-label="Informations légales"><a href="./privacy.html">Confidentialité</a><a href="./terms.html">Conditions d’utilisation</a></nav>
      </footer>
    </main>
  </div>
  <div id="bank-holder" hidden><div id="bank-host"><div id="bank-anchor"></div></div></div>

  <dialog id="op-dialog" aria-labelledby="op-title">
    <form id="op-form" novalidate>
      <div class="dialog-head"><h2 id="op-title">Nouvelle opération</h2><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Fermer">${icon('x')}</button></div>
      <input type="hidden" name="id">
      <fieldset class="segmented">
        <legend>Type</legend>
        <label><input type="radio" name="type" value="expense" checked><span>${icon('arrow-up-right', 18)} Sortie d’argent</span></label>
        <label><input type="radio" name="type" value="income"><span>${icon('arrow-down-left', 18)} Entrée d’argent</span></label>
      </fieldset>
      <div class="field"><label for="f-label">Libellé</label><input id="f-label" name="label" maxlength="100" autocomplete="off" placeholder="Courses, bourse, loyer…" aria-describedby="err-f-label"><p class="field-error" id="err-f-label" hidden></p></div>
      <div class="field-row">
        <div class="field"><label for="f-amount">Montant (€)</label><input id="f-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" aria-describedby="err-f-amount"><p class="field-error" id="err-f-amount" hidden></p></div>
        <div class="field"><label for="f-date">Date</label><input id="f-date" name="date" type="date" aria-describedby="err-f-date"><p class="field-error" id="err-f-date" hidden></p></div>
      </div>
      <div class="field"><label for="f-category">Catégorie</label><select id="f-category" name="category"></select></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-action="close-dialog">Annuler</button><button type="submit" class="btn primary" id="op-submit">Enregistrer</button></div>
    </form>
  </dialog>

  <dialog id="budget-dialog" aria-labelledby="budget-title">
    <form id="budget-form" novalidate>
      <div class="dialog-head"><h2 id="budget-title">Ajuster les budgets</h2><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Fermer">${icon('x')}</button></div>
      <fieldset class="scope">
        <legend>Appliquer ces plafonds</legend>
        <label><input type="radio" name="scope" value="month"><span id="scope-month"></span></label>
        <label><input type="radio" name="scope" value="all"><span>À tous les mois <small>(valeurs par défaut ; les autres mois déjà personnalisés gardent leurs plafonds)</small></span></label>
      </fieldset>
      <div id="budget-fields"></div>
      <div class="dialog-actions"><button type="button" class="btn ghost" data-action="close-dialog">Annuler</button><button type="submit" class="btn primary">Enregistrer les budgets</button></div>
    </form>
  </dialog>

  <dialog id="choice-dialog" aria-labelledby="choice-title" aria-describedby="choice-message">
    <form method="dialog">
      <div class="dialog-head"><h2 id="choice-title"></h2></div>
      <p id="choice-message" class="dialog-text"></p>
      <div class="dialog-actions" id="choice-actions"></div>
    </form>
  </dialog>

  <input type="file" id="import-file" accept="application/json,.json" hidden>
  <div id="toasts" role="status" aria-live="polite"></div>
`;

const view = $('#view');

// ---------- Composants ----------

const pageHeader = (eyebrow, title, lead, actions = '') => `
  <header class="page-head">
    <div><p class="eyebrow">${eyebrow}</p><h1 tabindex="-1">${title}</h1><p class="lead">${lead}</p></div>
    ${actions ? `<div class="head-actions">${actions}</div>` : ''}
  </header>`;

const addButton = `<button class="btn primary" data-action="add">${icon('plus', 18)}<span>Ajouter une opération</span></button>`;

function monthBar() {
  return `
  <div class="month-bar">
    <div class="month-control" role="group" aria-label="Choix du mois">
      <button class="icon-btn bordered" data-action="prev-month" aria-label="Mois précédent">${icon('chevron-left')}</button>
      <label class="month-field"><span class="sr-only">Mois affiché</span><input type="month" id="month" value="${month}" pattern="\\d{4}-\\d{2}" required></label>
      <button class="icon-btn bordered" data-action="next-month" aria-label="Mois suivant">${icon('chevron-right')}</button>
      ${month !== currentMonth() ? '<button class="btn ghost small" data-action="this-month">Ce mois-ci</button>' : ''}
    </div>
    <p class="privacy">${icon('shield', 16)}<span>Historique sauvegardé sur cet appareil</span></p>
  </div>`;
}

function statCard({ label, value, note, tone = '', ic }) {
  return `<article class="stat ${tone}"><div class="stat-head"><h2>${label}</h2><span class="stat-icon">${icon(ic, 20)}</span></div><p class="stat-value">${value}</p><p class="stat-note">${note}</p></article>`;
}

function budgetRow(category, spent, limit) {
  const i = budgetCategories.indexOf(category);
  const ratio = limit ? spent / limit : spent ? Infinity : 0;
  const level = spent > limit ? 'over' : ratio >= 0.8 ? 'warn' : 'ok';
  const note = level === 'over' ? `Plafond dépassé de ${money(spent - limit)}`
    : level === 'warn' ? `Presque atteint : il reste ${money(limit - spent)}`
    : `Il reste ${money(limit - spent)}`;
  const width = limit ? Math.min(100, (spent / limit) * 100) : spent ? 100 : 0;
  return `
  <li class="budget-row is-${level}">
    <span class="cat-icon cat-${i}">${categoryIcon(category)}</span>
    <div class="budget-body">
      <div class="budget-top"><strong>${budgetLabel(category)}</strong><span class="budget-figures"><b>${money(spent)}</b> / ${money(limit)}</span></div>
      <div class="track" role="progressbar" aria-label="${budgetLabel(category)}" aria-valuemin="0" aria-valuemax="${Math.max(limit, 1)}" aria-valuenow="${Math.min(spent, Math.max(limit, 1))}" aria-valuetext="${money(spent)} dépensés sur ${money(limit)}"><span style="width:${width}%"></span></div>
      <p class="budget-note">${level === 'ok' ? '' : icon('alert', 14)}${note}</p>
    </div>
  </li>`;
}

/** Libellé de la source de catégorie d'une opération Revolut (repris de la version précédente). */
const categorySourceLabel = t => (t.categorySource === 'manual' ? 'Votre choix' : t.categorySource === 'mcc' ? 'Code commerçant' : t.categorySource === 'rule' ? 'Suggestion' : t.type === 'income' ? 'Revenu' : 'À classer');

function categoryCell(t) {
  const review = needsCategoryReview(t);
  const options = categoriesForType(t.type).map(c => `<option value="${c}"${t.category === c && !review ? ' selected' : ''}>${c === 'Autres' && t.categorySource === 'income' ? 'Revenu' : c}</option>`).join('');
  return `<label class="bank-cat"><span class="sr-only">Catégorie de ${escape(t.label)}</span><select class="bank-category${review ? ' needs-review' : ''}" data-category-id="${escape(t.id)}" title="${escape(t.categoryReason || 'Catégorie à vérifier')}">${review ? '<option value="" selected>À classer</option>' : ''}${options}</select></label>`;
}

function opRow(t, withYear = false) {
  const i = categories.indexOf(t.category);
  const id = escape(t.id), label = escape(t.label);
  const bank = isBank(t);
  const meta = bank
    ? `<small class="bank-source" title="${escape(t.categoryReason || '')}">Revolut · ${categorySourceLabel(t)}</small>`
    : `<span class="op-meta">${t.category}</span>`;
  const date = `<time datetime="${t.date}">${dayLabel(t.date, withYear)}</time>${t.dateSource === 'value_date' ? ' <small class="bank-source inline">Date de valeur</small>' : ''}`;
  return `
  <li class="op${bank ? ' is-bank' : ''}">
    <span class="cat-icon cat-${i < budgetCategories.length ? i : 't'}">${categoryIcon(t.category)}</span>
    <div class="op-main"><strong class="op-label">${label}</strong><span class="op-meta">${date}</span></div>
    <div class="op-cat">${bank ? categoryCell(t) : meta}</div>
    <span class="op-amount ${t.type}"><span class="sr-only">${t.type === 'income' ? 'Revenu' : 'Dépense'} : </span>${t.type === 'income' ? '+' : '−'}&nbsp;${money(t.amount)}</span>
    <div class="op-actions">
      ${bank
        ? `<span class="sync-mark" title="Opération synchronisée depuis Revolut" role="img" aria-label="Opération bancaire synchronisée">${icon('refresh', 18)}</span>`
        : `<button class="icon-btn" data-action="edit" data-id="${id}" aria-label="Modifier ${label}">${icon('pencil', 18)}</button>
           <button class="icon-btn danger" data-action="delete" data-id="${id}" aria-label="Supprimer ${label}">${icon('trash', 18)}</button>`}
    </div>
  </li>`;
}

function emptyBlock(title, text, action = '') {
  return `<div class="empty">${icon('swap', 32)}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}

// ---------- Graphique ----------

function chartPanel() {
  const series = monthlySeries(state.transactions, month, 6);
  const max = Math.max(1, ...series.flatMap(s => [s.income, s.expenses]));
  const W = 600, H = 220, top = 8, ph = H - top, slot = W / series.length, bw = Math.min(30, slot * 0.28);
  const barH = v => (v > 0 ? Math.max(3, (v / max) * ph) : 0);
  const bars = series.map((s, i) => {
    const cx = slot * i + slot / 2;
    const ih = barH(s.income), eh = barH(s.expenses);
    return `
    <g class="${s.month === month ? 'bar-group is-current' : 'bar-group'}">
      <rect class="bar-income" x="${cx - bw - 2}" y="${top + ph - ih}" width="${bw}" height="${ih}" rx="4"><title>Revenus, ${longMonth(s.month)} : ${money(s.income)}</title></rect>
      <rect class="bar-expense" x="${cx + 2}" y="${top + ph - eh}" width="${bw}" height="${eh}" rx="4" fill="url(#hatch)"><title>Dépenses, ${longMonth(s.month)} : ${money(s.expenses)}</title></rect>
    </g>`;
  }).join('');
  const hasData = series.some(s => s.income || s.expenses);
  return `
  <section class="panel chart-panel" aria-labelledby="chart-title">
    <div class="panel-head"><div><h2 id="chart-title">Les six derniers mois</h2><p>Revenus et dépenses hors virements, mois par mois.</p></div>
      <ul class="legend"><li><span class="swatch swatch-income"></span>Revenus</li><li><span class="swatch swatch-expense"></span>Dépenses</li></ul></div>
    ${hasData ? `
    <div class="chart-wrap">
      <p class="chart-max">${money(max)}</p>
      <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenus et dépenses hors virements sur six mois, détail dans le tableau ci-dessous">
        <defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" class="hatch-bg"/><line x1="0" y1="0" x2="0" y2="7" class="hatch-line" stroke-width="3"/></pattern></defs>
        <line class="grid-line" x1="0" x2="${W}" y1="${top}" y2="${top}"/><line class="grid-line" x1="0" x2="${W}" y1="${top + ph / 2}" y2="${top + ph / 2}"/><line class="grid-base" x1="0" x2="${W}" y1="${top + ph}" y2="${top + ph}"/>
        ${bars}
      </svg>
      <div class="chart-months" aria-hidden="true">${series.map(s => `<span class="${s.month === month ? 'is-current' : ''}">${shortMonth(s.month)}</span>`).join('')}</div>
    </div>
    <details class="chart-table"><summary>Voir les chiffres</summary>
      <table><thead><tr><th scope="col">Mois</th><th scope="col">Revenus</th><th scope="col">Dépenses</th></tr></thead>
      <tbody>${series.map(s => `<tr><th scope="row">${longMonth(s.month)}</th><td>${money(s.income)}</td><td>${money(s.expenses)}</td></tr>`).join('')}</tbody></table>
    </details>` : emptyBlock('Pas encore d’historique', 'Ajoutez quelques opérations ou synchronisez Revolut pour voir l’évolution de vos mois.')}
  </section>`;
}

// ---------- Pages ----------

function dashboardView() {
  const s = summary(state.transactions, month);
  const limits = limitsFor(state, month);
  const totalBudget = sum(Object.values(limits));
  const spent = spentByCategory(s.entries);
  const pct = s.budgetIncome ? Math.round((s.budgetExpenses / s.budgetIncome) * 100) : 0;
  const toReview = reviewCount(s.entries);
  const title = !s.entries.length ? 'Un nouveau départ.' : s.budgetIncome > 0 && s.budgetExpenses > s.budgetIncome ? 'Dépenses à surveiller.' : 'Le point sur le mois.';
  const text = !s.entries.length ? 'Ajoutez votre première opération pour voir votre mois prendre forme.'
    : !s.budgetIncome ? 'Aucun revenu hors virements identifié ce mois-ci.'
    : s.balance < 0 ? `La variation des entrées et sorties est négative de ${money(-s.balance)}, virements inclus.`
    : `La variation des entrées et sorties du mois est de ${money(s.balance)}.`;
  const overCount = budgetCategories.filter(c => spent[c] > limits[c]).length;
  const tip = overCount ? `${plural(overCount, 'catégorie')} ${overCount > 1 ? 'dépassent' : 'dépasse'} le plafond. Ajustez vos budgets ou freinez un peu.`
    : 'Prévoyez une petite marge pour les imprévus, même quelques euros.';
  const recent = filterTransactions(s.entries).slice(0, 5);

  return `
  ${pageHeader('Votre argent, simplement', 'On fait le point ?', 'Un regard sur vos finances, un peu plus de sérénité.', addButton)}
  ${monthBar()}
  ${toReview ? `<p class="banner info">${icon('alert', 18)}<span>${plural(toReview, 'dépense')} à classer ce mois-ci. Les suggestions automatiques sont modifiables ; vos choix sont conservés.</span><button class="btn ghost small" data-action="show-review">Les classer</button></p>` : ''}
  ${cloud.status.phase === 'locked' ? `<p class="banner info">${icon('shield', 18)}<span>Votre sauvegarde en ligne est protégée : déverrouillez l’accès avec votre mot de passe pour retrouver ou sauvegarder vos données.</span><a class="btn ghost small" href="#/banque">Déverrouiller</a></p>` : ''}
  <section class="stats" aria-label="Chiffres du mois">
    ${statCard({ label: 'Variation du mois', value: money(s.balance), note: `Toutes les entrées et sorties, virements inclus<br>Cumul des mois précédents : ${signed(s.carryOver)}`, tone: 'primary', ic: 'wallet' })}
    ${statCard({ label: 'Revenus hors virements', value: money(s.budgetIncome), note: 'Ce qui est entré ce mois-ci', tone: 'income', ic: 'arrow-down-left' })}
    ${statCard({ label: 'Dépenses hors virements', value: money(s.budgetExpenses), note: `Sur ${money(totalBudget)} de budget prévu`, tone: 'expense', ic: 'arrow-up-right' })}
  </section>
  <section class="panel monthly-transfers" aria-labelledby="transfers-title">
    <h2 id="transfers-title">Virements du mois</h2>
    <p>Tous les comptes importés et saisies manuelles. La variation du mois conserve toutes les entrées et sorties. Les deux premiers totaux excluent les mouvements d’épargne, détaillés à côté.</p>
    <div id="transfer-totals">${[['Virements entrants', s.incomingTransfers], ['Virements sortants', s.outgoingTransfers], ['Vers l’épargne', s.toSavings], ['Depuis l’épargne', s.fromSavings]].map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</div>
  </section>
  <div class="grid-2">
    ${chartPanel()}
    <section class="panel insight" aria-labelledby="insight-title">
      <p class="eyebrow">Le petit bilan</p>
      <h2 id="insight-title">${title}</h2>
      <div class="ring ${pct > 100 ? 'is-over' : ''}" style="--progress:${Math.min(pct, 100)}%" role="img" aria-label="${s.budgetIncome ? `${pct} % des revenus utilisés` : 'Aucun revenu hors virements ce mois-ci'}"><div><strong>${s.budgetIncome ? `${pct} %` : '—'}</strong><span>des revenus utilisés</span></div></div>
      <p class="insight-text">${text}</p>
      <p class="tip">${icon('sparkle', 18)}<span>${tip}</span></p>
    </section>
  </div>
  <div class="grid-2 even">
    <section class="panel" aria-labelledby="budgets-title">
      <div class="panel-head"><div><h2 id="budgets-title">Mes budgets</h2><p>Un cap pour chaque envie.</p></div><a class="btn ghost small" href="#/budgets">Gérer</a></div>
      <ul class="budget-list">${budgetCategories.map(c => budgetRow(c, spent[c], limits[c])).join('')}</ul>
      <p class="budget-footer">${s.budgetExpenses > totalBudget ? `Budget total dépassé de ${money(s.budgetExpenses - totalBudget)}` : `Encore ${money(totalBudget - s.budgetExpenses)} dans votre budget hors virements`}</p>
    </section>
    <section class="panel" aria-labelledby="recent-title">
      <div class="panel-head"><div><h2 id="recent-title">Dernières opérations</h2><p>Les petits mouvements qui font le mois.</p></div><a class="btn ghost small" href="#/operations">Tout voir</a></div>
      ${recent.length ? `<ul class="op-list compact">${recent.map(t => opRow(t)).join('')}</ul>`
        : emptyBlock('Votre mois commence ici', 'Un café, un loyer ou une bourse : ajoutez votre première opération.', addButton)}
    </section>
  </div>`;
}

const typeFilters = [['all', 'Toutes les opérations'], ['expense', 'Dépenses hors virements'], ['income', 'Revenus hors virements'], ['review', 'Dépenses à classer'], ['transfers', 'Virements']];
const sortOptions = [['date-desc', 'Plus récentes'], ['date-asc', 'Plus anciennes'], ['amount-desc', 'Montant décroissant'], ['amount-asc', 'Montant croissant']];

function operationsView() {
  return `
  ${pageHeader('Tout ce qui bouge', 'Mes opérations', 'Cherchez, filtrez, corrigez : vos saisies sont modifiables, les opérations Revolut se reclassent d’un clic.', addButton)}
  ${ui.allMonths ? '' : monthBar()}
  <form class="toolbar" role="search" aria-label="Filtrer les opérations">
    <div class="field grow"><label for="flt-q">Rechercher</label><div class="search-box">${icon('search', 18)}<input id="flt-q" type="search" data-filter="query" value="${escape(ui.query)}" placeholder="Libellé…" autocomplete="off"></div></div>
    <div class="field"><label for="flt-type">Afficher</label><select id="flt-type" data-filter="type">${typeFilters.map(([v, l]) => `<option value="${v}" ${ui.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="flt-cat">Catégorie</label><select id="flt-cat" data-filter="category"><option value="all">Toutes</option>${categories.map(c => `<option value="${escape(c)}" ${ui.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label for="flt-sort">Trier par</label><select id="flt-sort" data-filter="sort">${sortOptions.map(([v, l]) => `<option value="${v}" ${ui.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <label class="check"><input type="checkbox" id="flt-all" data-filter="allMonths" ${ui.allMonths ? 'checked' : ''}><span>Tous les mois</span></label>
  </form>
  <section class="panel" aria-label="Résultats"><div id="op-results">${opResults()}</div></section>`;
}

function opResults() {
  const base = ui.allMonths ? state.transactions : summary(state.transactions, month).entries;
  const list = filterTransactions(base, ui);
  if (!list.length) {
    const filtered = ui.query || ui.type !== 'all' || ui.category !== 'all';
    return emptyBlock(filtered ? 'Aucune opération trouvée' : 'Rien pour ce mois',
      filtered ? 'Essayez d’autres mots ou retirez un filtre.' : 'Ajoutez une opération pour commencer.', filtered ? '' : addButton);
  }
  const shown = list.slice(0, ui.limit);
  const toReview = reviewCount(base);
  return `
  <p class="result-count" aria-live="polite">${plural(list.length, 'opération')} · solde ${signed(netOf(list))}</p>
  ${toReview ? `<p class="category-review-note">${plural(toReview, 'dépense')} à classer. Les suggestions automatiques sont modifiables ; vos choix sont conservés.</p>` : ''}
  <ul class="op-list">${shown.map(t => opRow(t, ui.allMonths)).join('')}</ul>
  ${list.length > shown.length ? `<div class="more"><button class="btn ghost" data-action="more">Afficher plus (${list.length - shown.length} restantes)</button></div>` : ''}`;
}

function budgetsView() {
  const s = summary(state.transactions, month);
  const limits = limitsFor(state, month);
  const spent = spentByCategory(s.entries);
  const totalBudget = sum(Object.values(limits));
  const custom = hasMonthLimits(state, month);
  const share = totalBudget ? Math.min(100, (s.budgetExpenses / totalBudget) * 100) : 0;
  return `
  ${pageHeader('Un cap pour chaque envie', 'Mes budgets', 'Fixez un plafond par catégorie, valable pour un mois ou pour tous. Les virements n’y comptent pas.', `<button class="btn primary" data-action="edit-budgets">${icon('pencil', 18)}<span>Ajuster les plafonds</span></button>`)}
  ${monthBar()}
  ${custom ? `<p class="banner">${icon('alert', 18)}<span>Plafonds personnalisés pour ${longMonth(month)}.</span><button class="btn ghost small" data-action="reset-month-limits">Revenir aux valeurs par défaut</button></p>` : ''}
  <section class="panel" aria-labelledby="total-title">
    <div class="panel-head"><div><h2 id="total-title">Budget total de ${longMonth(month)}</h2><p>${money(s.budgetExpenses)} dépensés sur ${money(totalBudget)}</p></div></div>
    <div class="track big" role="progressbar" aria-labelledby="total-title" aria-valuemin="0" aria-valuemax="${Math.max(totalBudget, 1)}" aria-valuenow="${Math.min(s.budgetExpenses, Math.max(totalBudget, 1))}" aria-valuetext="${money(s.budgetExpenses)} dépensés sur ${money(totalBudget)}"><span style="width:${share}%"></span></div>
    <p class="budget-footer">${s.budgetExpenses > totalBudget ? `Budget total dépassé de ${money(s.budgetExpenses - totalBudget)}` : `Encore ${money(totalBudget - s.budgetExpenses)} dans votre budget hors virements`}</p>
  </section>
  <section class="panel" aria-labelledby="cats-title">
    <div class="panel-head"><div><h2 id="cats-title">Par catégorie</h2></div></div>
    <ul class="budget-list wide">${budgetCategories.map(c => budgetRow(c, spent[c], limits[c])).join('')}</ul>
  </section>`;
}

function bankView() {
  return `
  ${pageHeader('Lecture seule', 'Ma banque', 'Connexion à Revolut (France) via Enable Banking. Mon Budget ne voit jamais votre mot de passe bancaire et ne peut effectuer aucun paiement.')}
  <div id="bank-slot"></div>`;
}

function cloudCardBody() {
  const s = cloud.status;
  const when = s.lastSync ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(s.lastSync) : '';
  const text = {
    off: 'Vérification de la connexion au serveur…',
    syncing: 'Synchronisation en cours…',
    idle: `Dernière sauvegarde : ${when}.`,
    locked: 'Accès verrouillé. Déverrouillez-le dans la page Banque : vos données restent enregistrées sur cet appareil en attendant.',
  }[s.phase] ?? escape(s.message);
  const warning = s.phase === 'idle' && s.durable === false
    ? `<p class="cloud-warning">${icon('alert', 16)}<span>Ce serveur (mode local) garde la sauvegarde en mémoire seulement : elle sera perdue à son arrêt.</span></p>` : '';
  const unreadable = s.phase === 'error' && /illisible/.test(s.message);
  const buttons = s.phase === 'locked'
    ? '<a class="btn primary" href="#/banque">Déverrouiller</a>'
    : `<button class="btn ghost" data-action="cloud-sync"${s.phase === 'syncing' ? ' disabled' : ''}>${icon('refresh', 18)}<span>Synchroniser maintenant</span></button>${unreadable ? `<button class="btn danger" data-action="cloud-replace">${icon('upload', 18)}<span>Remplacer la sauvegarde en ligne</span></button>` : ''}`;
  return `<span class="stat-icon">${icon('shield', 22)}</span>
    <div><h2>Sauvegarde en ligne</h2>
    <p>Une copie chiffrée de vos opérations et plafonds est conservée sur le serveur, protégée par votre mot de passe. Elle survit à l’effacement des données du navigateur : après un effacement, déverrouillez l’accès et vos mois reviennent.</p>
    <p class="cloud-status" role="status">${text}</p>${warning}</div>
    <div class="card-actions">${buttons}</div>`;
}

function dataView() {
  const count = state.transactions.length;
  const banked = state.transactions.filter(isBank).length;
  const theme = getTheme();
  const card = (ic, title, text, button) => `<article class="panel data-card"><span class="stat-icon">${icon(ic, 22)}</span><div><h2>${title}</h2><p>${text}</p></div>${button}</article>`;
  return `
  ${pageHeader('Vos données vous appartiennent', 'Mes données', 'Tout est enregistré dans ce navigateur. Exportez régulièrement pour ne rien perdre.')}
  <p class="banner info">${icon('shield', 18)}<span>${plural(count, 'opération')} enregistrée${count > 1 ? 's' : ''} sur cet appareil${banked ? `, dont ${banked} synchronisée${banked > 1 ? 's' : ''} depuis Revolut` : ''}. Effacer les données du navigateur les supprimerait aussi.</span></p>
  <div class="data-grid">
    <article class="panel data-card cloud-card" id="cloud-card">${cloudCardBody()}</article>
    ${card('download', 'Sauvegarde complète', 'Un fichier JSON avec vos opérations (Revolut comprises) et tous vos plafonds. Il contient des données financières : rangez-le dans un endroit sûr.', `<button class="btn primary" data-action="export-json">${icon('download', 18)}<span>Exporter en JSON</span></button>`)}
    ${card('download', 'Tableur', 'Vos opérations au format CSV, lisible dans Excel, LibreOffice ou Google Sheets.', `<button class="btn ghost" data-action="export-csv"${count ? '' : ' disabled'}>${icon('download', 18)}<span>Exporter en CSV</span></button>`)}
    ${card('upload', 'Importer une sauvegarde', 'Fusionnez avec vos données actuelles ou remplacez-les, au choix, avant toute modification.', `<button class="btn ghost" data-action="import">${icon('upload', 18)}<span>Choisir un fichier</span></button>`)}
    ${card('sparkle', 'Apparence', 'Suivre le réglage de votre appareil, ou forcer un thème.', `<div class="field"><label for="theme">Thème</label><select id="theme" data-theme-select>${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<option value="${v}" ${theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`)}
    ${card('trash', 'Tout effacer', 'Supprime les opérations et remet les plafonds par défaut sur cet appareil. La connexion Revolut n’est pas révoquée (page Banque) : une synchronisation réimporterait les 90 derniers jours.', `<button class="btn danger" data-action="reset-all">${icon('trash', 18)}<span>Effacer mes données</span></button>`)}
  </div>`;
}

const routes = {
  '': { title: 'Vue d’ensemble', render: dashboardView },
  operations: { title: 'Opérations', render: operationsView },
  budgets: { title: 'Budgets', render: budgetsView },
  banque: { title: 'Banque', render: bankView },
  donnees: { title: 'Données', render: dataView },
};
const routeName = () => {
  const name = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return Object.hasOwn(routes, name) ? name : '';
};

// ---------- Rendu ----------

function renderNotice() {
  const messages = [];
  if (droppedAtLoad) messages.push(`Des données enregistrées étaient invalides : ${plural(droppedAtLoad, 'opération')} ${droppedAtLoad > 1 ? 'ont été écartées' : 'a été écartée'}. Une copie brute des données d’origine est conservée sur cet appareil.`);
  if (unreadable) messages.push('Vos données enregistrées étaient illisibles. Une copie brute est conservée sur cet appareil et vous repartez d’un budget vide : importez une sauvegarde si vous en avez une.');
  if (cloud.status.phase === 'error') messages.push(`Sauvegarde en ligne : ${escape(cloud.status.message)} Vos données restent enregistrées sur cet appareil.`);
  if (storageFailed) messages.push('La sauvegarde locale est indisponible : vos changements seront perdus à la fermeture. Pensez à exporter vos données.');
  $('#notice').innerHTML = messages.map(m => `<p class="banner warn">${icon('alert', 18)}<span>${m}</span></p>`).join('');
}

/**
 * `focus` : sélecteur de l'élément à refocaliser après le rendu.
 * Sans `focus`, le champ actif (recherche, filtre…) est restauré : une synchronisation en arrière-plan ne coupe pas la saisie.
 * Le panneau bancaire est déplacé (jamais recréé) pour conserver son état, ses minuteurs et ses écouteurs.
 */
function render({ focus = null } = {}) {
  const active = document.activeElement;
  const activeId = !focus && active?.id && view.contains(active) ? active.id : null;
  const caret = activeId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;

  $('#bank-holder').append($('#bank-host'));
  const name = routeName();
  document.title = `${routes[name].title} · Mon Budget`;
  view.innerHTML = routes[name].render();
  $('#bank-slot')?.append($('#bank-host'));
  document.querySelectorAll('.nav-link').forEach(a => {
    const isActive = a.dataset.route === name;
    a.classList.toggle('active', isActive);
    isActive ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
  });
  renderNotice();

  if (focus) view.querySelector(focus)?.focus();
  else if (activeId) {
    const el = document.getElementById(activeId);
    el?.focus();
    if (el && caret) { try { el.setSelectionRange(...caret); } catch { /* type sans sélection */ } }
  }
}

function setMonth(next, focus) {
  month = next;
  ui.limit = 50;
  render({ focus });
}

// ---------- Messages et boîtes de dialogue ----------

function toast(message, { actionLabel, onAction, timeout = 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${escape(message)}</span>`;
  const remove = () => el.remove();
  if (actionLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.innerHTML = `${icon('undo', 16)}<span>${escape(actionLabel)}</span>`;
    button.onclick = () => { remove(); onAction?.(); };
    el.append(button);
  }
  $('#toasts').append(el);
  setTimeout(remove, timeout);
}

/** Boîte de choix générique ; renvoie la valeur du bouton cliqué ('' si fermée avec Échap). */
function choose({ title, message, choices }) {
  const dialog = $('#choice-dialog');
  $('#choice-title').textContent = title;
  $('#choice-message').textContent = message;
  $('#choice-actions').innerHTML = choices.map(c => `<button class="btn ${c.style ?? 'ghost'}" value="${escape(c.value)}">${escape(c.label)}</button>`).join('');
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
  });
}

const confirmAction = ({ title, message, label, danger = false }) =>
  choose({ title, message, choices: [{ value: 'cancel', label: 'Annuler' }, { value: 'ok', label, style: danger ? 'danger' : 'primary' }] }).then(v => v === 'ok');

function showError(input, message) {
  const error = $(`#err-${input.id}`);
  if (!error) return;
  error.textContent = message ?? '';
  error.hidden = !message;
  message ? input.setAttribute('aria-invalid', 'true') : input.removeAttribute('aria-invalid');
}

// ---------- Opérations : ajout, modification, suppression ----------

function setOperationCategories(selected) {
  const form = $('#op-form');
  const type = form.elements.type.value;
  const options = categoriesForType(type);
  form.elements.category.replaceChildren(...options.map(c => new Option(c, c)));
  form.elements.category.value = options.includes(selected) ? selected : type === 'income' ? 'Autres' : options[0];
}

function openOperation(tx) {
  const form = $('#op-form');
  form.reset();
  form.querySelectorAll('input, select').forEach(el => showError(el, null));
  form.elements.id.value = tx?.id ?? '';
  form.elements.type.value = tx?.type ?? 'expense';
  form.elements.label.value = tx?.label ?? '';
  form.elements.amount.value = tx ? String(tx.amount).replace('.', ',') : '';
  form.elements.date.value = tx?.date ?? (month === currentMonth() ? today() : `${month}-01`);
  setOperationCategories(tx?.category);
  $('#op-title').textContent = tx ? 'Modifier l’opération' : 'Nouvelle opération';
  $('#op-submit').textContent = tx ? 'Enregistrer les modifications' : 'Enregistrer l’opération';
  $('#op-dialog').showModal();
}

function submitOperation(event) {
  event.preventDefault();
  const form = event.currentTarget, data = new FormData(form);
  const label = String(data.get('label')).trim();
  const amount = parseAmount(data.get('amount'));
  const date = String(data.get('date'));
  const errors = {};
  if (!label) errors['f-label'] = 'Indiquez un libellé, par exemple « Courses ».';
  if (!(amount > 0)) errors['f-amount'] = 'Saisissez un montant supérieur à 0, avec au plus 2 décimales (ex. 12,50).';
  if (!isRealDate(date)) errors['f-date'] = 'Choisissez une date valide.';
  const id = String(data.get('id'));
  const tx = { id: id || uid(), label, type: data.get('type'), amount, date, category: data.get('category') };
  if (!Object.keys(errors).length && !validateTransaction(tx)) errors['f-amount'] = 'Ce montant est trop élevé.';
  for (const field of ['f-label', 'f-amount', 'f-date']) showError($(`#${field}`), errors[field]);
  const firstInvalid = Object.keys(errors)[0];
  if (firstInvalid) return $(`#${firstInvalid}`).focus();

  const previous = state.transactions.find(t => t.id === tx.id);
  if (previous && isBank(previous)) return $('#op-dialog').close(); // les opérations Revolut ne se modifient pas à la main
  state = { ...state, transactions: upsertTransaction(state.transactions, tx) };
  month = date.slice(0, 7);
  persist();
  $('#op-dialog').close();
  render();
  toast(previous ? 'Opération modifiée.' : 'Opération ajoutée.');
}

function deleteOperation(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx || isBank(tx)) return;
  state = { ...state, transactions: removeTransaction(state.transactions, id) };
  persist();
  render({ focus: 'h1' });
  toast(`« ${tx.label} » supprimée.`, {
    actionLabel: 'Annuler',
    onAction: () => { state = { ...state, transactions: upsertTransaction(state.transactions, tx) }; persist(); render(); },
  });
}

/** Reclassement d'une opération Revolut : le choix manuel est conservé par les synchronisations suivantes. */
function recategorize(id, category) {
  const tx = state.transactions.find(t => t.id === id && isBank(t));
  if (!tx || !categoriesForType(tx.type).includes(category)) return;
  const next = { ...tx, category, categorySource: 'manual', categoryReason: 'Catégorie choisie par vous.' };
  state = { ...state, transactions: upsertTransaction(state.transactions, next) };
  persist();
  render();
}

// ---------- Budgets ----------

function openBudgets() {
  const limits = limitsFor(state, month);
  const custom = hasMonthLimits(state, month);
  $('#scope-month').textContent = `Seulement pour ${longMonth(month)}`;
  $('#budget-form').elements.scope.value = custom ? 'month' : 'all';
  $('#budget-fields').innerHTML = budgetCategories.map((c, i) => `
    <div class="budget-field">
      <label for="b-${i}"><span class="cat-icon cat-${i}">${categoryIcon(c, 18)}</span>${budgetLabel(c)}</label>
      <input id="b-${i}" name="${c}" inputmode="decimal" autocomplete="off" value="${String(limits[c]).replace('.', ',')}" aria-describedby="err-b-${i}">
      <p class="field-error" id="err-b-${i}" hidden></p>
    </div>`).join('');
  $('#budget-dialog').showModal();
}

function submitBudgets(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget), limits = {};
  let firstInvalid = null;
  budgetCategories.forEach((c, i) => {
    const input = $(`#b-${i}`), value = parseAmount(data.get(c));
    limits[c] = value;
    showError(input, Number.isNaN(value) ? 'Saisissez un montant positif (ex. 120 ou 45,50).' : null);
    if (Number.isNaN(value) && !firstInvalid) firstInvalid = input;
  });
  if (firstInvalid) return firstInvalid.focus();
  state = applyLimits(state, month, limits, data.get('scope'));
  persist();
  $('#budget-dialog').close();
  render();
  toast('Budgets enregistrés.');
}

// ---------- Données : export, import, effacement ----------

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  if (file.size > 5 * 1024 * 1024) return toast('Ce fichier est trop volumineux (5 Mo maximum).');
  const parsed = parseBackup(await file.text());
  if (!parsed.ok) return toast(parsed.error);
  const count = parsed.state.transactions.length;
  const revolut = parsed.state.transactions.filter(isBank).length;
  const revolutNote = revolut ? ` Dont ${plural(revolut, 'opération')} marquée${revolut > 1 ? 's' : ''} « Revolut » : elles viennent du fichier, pas de la banque. Ne les importez que si vous l’avez créé vous-même.` : '';
  const ignored = parsed.ignored ? ` ${plural(parsed.ignored, 'entrée')} invalide${parsed.ignored > 1 ? 's' : ''} ou en double ${parsed.ignored > 1 ? 'seront ignorées' : 'sera ignorée'}.` : '';
  const choice = await choose({
    title: 'Importer cette sauvegarde ?',
    message: `${plural(count, 'opération')} trouvée${count > 1 ? 's' : ''}.${revolutNote}${ignored} Fusionner ajoute les opérations manquantes ; remplacer efface vos données actuelles.`,
    choices: [{ value: 'cancel', label: 'Annuler' }, { value: 'replace', label: 'Remplacer', style: 'danger' }, { value: 'merge', label: 'Fusionner', style: 'primary' }],
  });
  if (choice !== 'merge' && choice !== 'replace') return;
  state = choice === 'merge' ? mergeStates(state, parsed.state) : parsed.state;
  unreadable = false;
  droppedAtLoad = 0;
  persist();
  render();
  if (choice === 'replace') cloud.markDirty({ replace: true }); // « remplacer » vaut aussi pour la sauvegarde en ligne
  toast(choice === 'merge' ? 'Sauvegarde fusionnée.' : 'Sauvegarde restaurée.');
}

async function resetAll() {
  const ok = await confirmAction({ title: 'Tout effacer ?', message: 'Vos opérations (saisies et Revolut) et vos plafonds personnalisés seront supprimés de cet appareil. Si la sauvegarde en ligne est accessible, elle est effacée aussi ; sinon elle sera restaurée à la prochaine synchronisation. Cette action est définitive : pensez à exporter d’abord.', label: 'Effacer mes données', danger: true });
  if (!ok) return;
  state = emptyState();
  unreadable = false;
  droppedAtLoad = 0;
  persist();
  render();
  cloud.markDirty({ replace: true });
  toast('Données effacées.');
}

// ---------- Événements ----------

const actions = {
  add: () => openOperation(),
  edit: el => openOperation(state.transactions.find(t => t.id === el.dataset.id)),
  delete: el => deleteOperation(el.dataset.id),
  more: () => { ui.limit += 50; $('#op-results').innerHTML = opResults(); },
  'show-review': () => { Object.assign(ui, { type: 'review', category: 'all', query: '', allMonths: false }); if (routeName() === 'operations') render({ focus: 'h1' }); else location.hash = '#/operations'; },
  'prev-month': () => setMonth(shiftMonth(month, -1), '[data-action="prev-month"]'),
  'next-month': () => setMonth(shiftMonth(month, 1), '[data-action="next-month"]'),
  'this-month': () => setMonth(currentMonth(), '[data-action="prev-month"]'),
  'edit-budgets': openBudgets,
  'reset-month-limits': () => { state = resetMonthLimits(state, month); persist(); render({ focus: 'h1' }); toast('Plafonds par défaut rétablis pour ce mois.'); },
  'export-json': () => download(`mon-budget-${today()}.json`, serializeBackup(state), 'application/json'),
  'export-csv': () => download(`mon-budget-${today()}.csv`, `﻿${transactionsToCsv(state.transactions)}`, 'text/csv;charset=utf-8'),
  import: () => $('#import-file').click(),
  'cloud-sync': () => cloud.sync(),
  'cloud-replace': async () => {
    const ok = await confirmAction({ title: 'Remplacer la sauvegarde en ligne ?', message: 'La sauvegarde en ligne actuelle sera écrasée par les données de cet appareil. Utile si elle est illisible (par exemple après un changement de mot de passe). Cette action est définitive.', label: 'Remplacer', danger: true });
    if (ok) cloud.markDirty({ replace: true });
  },
  'reset-all': resetAll,
  'close-dialog': el => el.closest('dialog').close(),
};

// Un dialogue ne se ferme que si le clic a commencé ET fini sur le fond : sélectionner du texte et relâcher en dehors ne perd plus la saisie.
let pressTarget = null;
document.addEventListener('mousedown', event => { pressTarget = event.target; });
document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (el && !el.disabled) actions[el.dataset.action]?.(el);
  if (event.target instanceof HTMLDialogElement && pressTarget === event.target) event.target.close(); // clic sur le fond
});

document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'month') {
    if (isMonth(el.value)) setMonth(el.value, '#month');
  } else if (el.dataset.filter) {
    ui[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    ui.limit = 50;
    if (el.dataset.filter === 'allMonths') render({ focus: '#flt-all' });
    else $('#op-results').innerHTML = opResults();
  } else if ('themeSelect' in el.dataset) {
    setTheme(el.value);
  }
});

document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset?.categoryId && categories.includes(el.value)) recategorize(el.dataset.categoryId, el.value);
});

document.addEventListener('submit', event => { if (event.target.matches('.toolbar')) event.preventDefault(); }); // filtres : pas de rechargement de page
$('#op-form').addEventListener('submit', submitOperation);
$('#budget-form').addEventListener('submit', submitBudgets);
$('#op-form').addEventListener('input', event => {
  if (event.target.name === 'type') setOperationCategories(); // revient à la catégorie par défaut du type choisi
  if (event.target.id) showError(event.target, null);
});
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await importFile(file);
});
window.addEventListener('hashchange', () => { render({ focus: 'h1' }); window.scrollTo(0, 0); });

// ---------- Démarrage ----------

setTheme(getTheme());
// Retour du parcours d'autorisation bancaire (?bank=connected|cancelled|error) : on ouvre la page Banque, qui affiche le résultat.
if (new URLSearchParams(location.search).has('bank')) location.hash = '#/banque';
render();

mountBank({
  target: $('#bank-anchor'),
  onSync: incoming => {
    const result = mergeBankTransactions(state.transactions, incoming);
    const previous = state;
    state = { ...state, transactions: result.transactions };
    if (!persist()) {
      state = previous;
      throw new Error('Sauvegarde locale indisponible. Aucune opération bancaire ajoutée. Libérez de l’espace ou autorisez le stockage local.');
    }
    if (routeName() !== 'banque' && (result.added || result.updated)) render();
    return result;
  },
});

// Sauvegarde en ligne : première synchronisation, puis à chaque déverrouillage et au retour sur l'onglet.
cloud.sync();
window.addEventListener('bank:unlocked', () => cloud.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloud.refreshIfStale(); });
navigator.storage?.persist?.().catch(() => {}); // demande au navigateur de ne pas évacuer les données locales en cas de manque de place

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}
