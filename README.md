# Mon Budget

Application web en français pour gérer son budget étudiant : revenus, dépenses, catégories, plafonds mensuels et solde. Les opérations sont conservées dans le stockage local du navigateur. Les plafonds sont communs à tous les mois ; le résultat du mois est le revenu moins les dépenses du mois, sans report. Le solde du compte est lu séparément auprès de Revolut.

## Développement

Node.js **24.x** (24.5 ou plus récent) est requis (notamment pour le proxy réseau natif). Aucun secret n’est nécessaire pour la saisie manuelle.

```sh
npm ci
npm run dev
```

Ouvrir l’adresse définie dans `APP_ORIGIN`, par défaut `http://localhost:5173` (développement local uniquement ; le formulaire de production du prestataire peut exiger HTTPS). Cette commande démarre ensemble le serveur bancaire et Vite. Une simple page statique ou `npm run preview` ne permet pas la connexion bancaire.

```sh
npm test
npm run build
npm start
```

`npm start` sert la compilation `dist` et l’API sur le même port. `HOST` vaut `127.0.0.1` par défaut ; utiliser `HOST=0.0.0.0` si un environnement cloud doit accéder au serveur. `APP_ORIGIN` doit correspondre exactement à l’adresse utilisée dans le navigateur, port compris.

## Revolut personnel — France

L’intégration prépare un accès en lecture seule via **Enable Banking**. Elle ne demande jamais le mot de passe Revolut et n’implémente aucun paiement. La présence du code ne signifie pas qu’un compte bancaire est connecté : il faut une application chez le prestataire, un accès réel à Revolut France et le consentement de l’utilisateur.

### Configuration initiale du prestataire

1. Créer un compte développeur sur https://enablebanking.com/ et une application dans https://enablebanking.com/cp/applications.
2. Vérifier auprès du prestataire l’éligibilité de l’application à l’accès réel au compte personnel Revolut France et les conditions applicables. Un accès sandbox permet seulement de tester ; la disponibilité de Revolut est vérifiée via `/aspsps?country=FR` au moment de la connexion. Elle n’a pas été vérifiée en production dans cet environnement.
3. Pour une application de production, enregistrer l’URL de retour HTTPS réelle du site suivie de `/api/bank/callback`. L’adresse localhost sert uniquement aux tests locaux et peut être refusée par le prestataire. Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour obtenir cette URL sur Vercel.
4. Copier `.env.example` vers `.env`. Renseigner `ENABLE_BANKING_APP_ID`, `APP_ORIGIN` et `ENABLE_BANKING_PRIVATE_KEY_PATH`. Placer la clé RSA privée du prestataire dans `secrets/enablebanking.pem` (hors versionnement), avec des permissions de lecture limitées au propriétaire (`chmod 600 secrets/enablebanking.pem` sous Linux/macOS). Ne jamais envoyer cette clé dans le chat ou utiliser une variable `VITE_` pour elle. La clé sert localement à signer un JWT : un jeton proxy ne peut pas la remplacer.
5. Redémarrer `npm run dev` ou `npm start`. Dans l’application, cliquer sur « Connecter Revolut », choisir la connexion si plusieurs existent et terminer l’autorisation bancaire. Au retour, les opérations sont synchronisées.

Le serveur doit pouvoir accéder en HTTPS à `api.enablebanking.com` avec vérification TLS activée. Les variables proxy et la confiance CA de l’environnement sont conservées. Les redirections d’autorisation sont ouvertes par le navigateur de l’utilisateur.

### Synchronisation et conservation

- Lecture des **90 derniers jours**, avec pagination, pour les comptes autorisés. Les opérations `BOOK` en **EUR** avec une référence stable sont importées. Les statuts explicitement provisoires `PDNG`/`PENDING`, autres statuts, autres devises, montants nuls et défauts de lecture sont distingués avec leurs motifs. Aucun taux de conversion n’est inventé.
- Synchronisation à l’ouverture d’une connexion existante, puis toutes les **15 minutes tant que la page est visible**. Le bouton permet aussi une actualisation manuelle ; le serveur conserve une réponse 60 secondes pour éviter les requêtes répétées. Il n’y a pas de synchronisation lorsque le site est fermé.
- Les identifiants sont dérivés du compte (IBAN ou identifiant stable si fourni, sinon identifiant de session) et de la référence fournie par le prestataire. En l’absence d’identifiant de compte stable, un avertissement invite à vérifier les doublons après une nouvelle connexion. Répéter la synchronisation met à jour les opérations existantes sans les dupliquer et conserve les catégories choisies. Les dépenses sont catégorisées à partir des codes commerçants disponibles puis de règles sur les libellés. Les suggestions sont marquées ; les cas ambigus restent « À classer ». Les corrections manuelles et leurs catégories, y compris « Autres », sont conservées. Les anciennes valeurs « Autres » sans marque manuelle sont réévaluées, car l’ancienne version ne distinguait pas un choix explicite d’une valeur par défaut.
- Tous les mouvements restent inclus dans la variation des flux selon leur sens débit/crédit. Les écritures catégorisées comme virements entrants/sortants ou vers/depuis l’épargne sont séparées des budgets de consommation. Les remboursements et libellés ambigus peuvent nécessiter une correction de catégorie. Les absences d’une fenêtre de synchronisation ne suppriment pas l’historique déjà importé.
- « Déconnecter » révoque la session chez le prestataire ; les opérations importées restent sur cet appareil. Les opérations bancaires sont en lecture seule dans le tableau, sauf leur catégorie.
- Le consentement est demandé pour 10 jours au maximum, dans la limite annoncée par la banque. Une nouvelle autorisation peut être nécessaire plus tôt. Les sessions sont liées à un cookie HttpOnly et isolées par navigateur. En local sans Redis, elles sont en mémoire et perdues au redémarrage ou après 8 heures sans requête. Sur Vercel, Redis conserve ces sessions et leur cache chiffrés avec expiration après 8 heures d’inactivité, indépendamment des instances serveur. L’historique budgétaire reste dans le navigateur. Cette version ne propose ni comptes utilisateurs, ni synchronisation entre appareils.

Le déploiement Vercel personnel exige un mot de passe applicatif et un stockage Redis chiffré avant tout accès bancaire ; il comporte des limites de tentatives et des verrous partagés. Le serveur local ne fait pas confiance à `X-Forwarded-For` ; les en-têtes Vercel sont utilisés seulement dans son environnement géré. Une ouverture à d’autres utilisateurs exigerait une authentification par compte et un suivi d’exploitation adapté. Utiliser HTTPS et une origine unique ; le cookie devient `Secure` en HTTPS. Ne pas publier les fichiers `.env`, `secrets/` ou des relevés réels.

## Validation

`npm test` couvre notamment la signature JWT, les opérations bancaires normalisées, les références stables, la pagination, la fusion sans doublons, l’isolation entre navigateurs, l’état d’autorisation à usage unique, le refus inter-origines, l’expiration et la révocation. Les appels prestataire y sont simulés : ils ne prouvent pas l’accès réel à Revolut. Le parcours est basé sur les exemples officiels : https://github.com/enablebanking/enablebanking-api-samples.

## Pages légales pour l’enregistrement chez le prestataire

Les documents à relire se trouvent dans `docs/privacy.html` et `docs/terms.html`, avec leur feuille de style `docs/legal.css`. Ils décrivent le fonctionnement actuel (usage personnel, données locales, connexion bancaire facultative). L’identité et le contact proviennent des informations fournies lors de la configuration ; les vérifier avant publication. Ces textes n’ont pas été validés par le prestataire.

Vite copie automatiquement `docs` à la racine de `dist`. Les liens du pied de page ouvrent les documents dans la version de développement ou la version compilée. Aucun appel bancaire ou script n’est nécessaire pour consulter ces pages.

Ces seules pages peuvent être publiées avec **GitHub Pages** depuis la branche contenant les fichiers et le dossier **`/docs`**, sans mettre en ligne l’application bancaire ni ses secrets. GitHub Pages est un hébergement statique et ne peut pas exécuter le serveur bancaire. Vérifier les conditions et la disponibilité de GitHub Pages selon la visibilité et l’offre du dépôt. Une publication peut rendre publics le nom et l’adresse de contact figurant sur ces pages.

Ne pas saisir d’URL provisoire ou inaccessible dans le formulaire Enable Banking. Après publication autorisée, utiliser l’adresse réelle de chaque document et vérifier qu’elle répond publiquement. La publication des pages légales ne remplace pas l’URL de retour bancaire, qui reste celle du serveur de l’application.

## Mise en ligne HTTPS

Le dépôt inclut `vercel.json` et une fonction Node.js `/api/bank/[...path]`. Consulter [le guide Vercel](DEPLOYMENT.md). Le site peut être publié avant toute configuration bancaire pour obtenir les trois URL HTTPS du formulaire Enable Banking. Les fonctions bancaires sont alors désactivées jusqu’à la configuration des clés, du mot de passe et de Redis.

## Solde bancaire et résultat du mois

Le bloc Revolut appelle `/api/bank/balances` après déverrouillage et lors des synchronisations. Chaque compte autorisé est lu séparément via `/accounts/{uid}/balances`. L’interface privilégie le disponible intrajournalier (`ITAV`), puis le comptabilisé intrajournalier (`ITBD`), puis les soldes de clôture `CLAV`/`CLBD` explicitement libellés. Elle affiche l’heure de consultation et la date bancaire si fournie ; aucun solde n’est recalculé à partir des opérations, aucun solde de plusieurs comptes n’est additionné. Seuls les soldes EUR exploitables sont affichés.

Le sélecteur conserve uniquement l’identifiant dérivé du compte dans le navigateur, pas son solde. Le compte courant EUR est choisi par défaut s’il est identifié de façon unique ; sinon l’utilisateur choisit. Les identifiants serveur et l’IBAN complet ne sont pas renvoyés par ce nouvel endpoint. Un échec du solde n’empêche pas l’import d’opérations, et un échec de l’import ne supprime pas le solde récupéré. Une lecture précédente conservée à l’écran est explicitement signalée comme ancienne si l’actualisation échoue. Verrouiller ou déconnecter masque ce solde en mémoire. La variation du mois conserve toutes les entrées et sorties des comptes importés et des saisies manuelles. Les revenus et dépenses hors virements et les budgets de consommation excluent les quatre catégories de virements ; les mouvements classés comme virements restent affichés séparément. Ces calculs sont distincts du solde du compte sélectionné.

## Lecture, catégorisation et diagnostic

- `server/transactions.js` lit les écritures sans arrondi : les montants signés cohérents débit/crédit et les décimales supplémentaires nulles sont acceptés ; les fractions de centime ou signes contradictoires sont signalés. Une date de valeur n’est utilisée que si la date comptable est absente, avec un marqueur visible. Une référence stable reste obligatoire pour éviter les doublons. Deux montants différents pour une même référence pendant un import interrompent la lecture plutôt que de s’écraser.
- `src/categorization.js` propose une catégorie à partir du code commerçant (si transmis), puis de règles documentées dans ce fichier. Exemples : Utile, Carrefour et Café Bibal en alimentation ; Oqoro en logement. « Uber Payments » sans code ni précision reste ambigu : aucune catégorie certaine n’est inventée. Le classement n’est pas une copie garantie des catégories natives de Revolut et ne modifie aucun montant.
- `categorySource` distingue code commerçant, suggestion, à classer, revenu et correction manuelle. Le filtre « Dépenses à classer » isole les dépenses encore incertaines. Les choix manuels sont prioritaires lors des synchronisations suivantes. Les catégories de dépenses ne sont pas imposées aux revenus.
- `diagnostics` récapitule les raisons exactes et jusqu’à 100 lignes non importées. Les compteurs couvrent toute la période de 90 jours ; ils ne représentent pas seulement le mois affiché. L’interface explique les provisoires, montants nuls, devises, références/dates/sens absents, et affiche les statuts reçus. Les détails sont accessibles seulement après déverrouillage et sont masqués avec le solde bancaire lors du verrouillage. Aucun journal de relevé brut n’est créé.
- Le cache de synchronisation porte `schemaVersion: 3` afin de relire les données lors de la mise à jour de cet importeur. Les compteurs « nouvelles », « actualisées », « déjà à jour » et « catégories attribuées » distinguent lecture répétée et changement réel. Aucun nombre d’écritures précédemment ignorées n’est expliqué rétroactivement sans les relire.

## Virements et comptes épargne

Les catégories `Virement entrant`, `Virement sortant`, `Vers l’épargne` et `Depuis l’épargne` sont disponibles selon le sens crédit/débit. Les libellés explicites `From…`, `To…`, `Virement…` et les familles bancaires ICDT/RCDT servent de suggestions. Les libellés d’épargne doivent aussi correspondre au sens de l’écriture. Un salaire identifié reste un revenu ; un commerçant ou un loyer identifié reste dans sa catégorie de dépense. Un nom de bénéficiaire n’est jamais une preuve qu’il s’agit de votre propre compte. Les corrections manuelles restent prioritaires.

Ces quatre catégories sont hors budgets de consommation et hors cartes de revenus/dépenses ordinaires. Elles restent dans la variation de tous les flux du mois et possèdent des compteurs séparés (entrants/sortants généraux, puis vers/depuis l’épargne, sans double comptage). Si un virement règle une dépense, lui donner sa vraie catégorie pour l’inclure dans le budget.

« Actualiser les comptes » appelle `/api/bank/accounts` pour relire la session autorisée chez le prestataire, puis lire le solde de chaque compte transmis. Les identités des écritures existantes sont préservées lorsque des métadonnées de compte s’ajoutent. Cette opération n’étend pas le consentement. « Modifier les comptes autorisés » révoque l’ancienne connexion, après confirmation, puis ouvre un nouveau parcours de consentement en conservant l’historique local. Les comptes doivent aussi être liés chez Enable Banking dans le cadre de son accès personnel restreint.

Un compte épargne ne peut être lu que si Revolut l’expose à cette API et qu’il fait partie des comptes autorisés. Il n’est pas déduit des transferts et son solde n’est jamais reconstitué à partir des seules opérations d’épargne. Les produits non exposés (selon la banque et le type d’épargne) restent indisponibles dans cette connexion. Une présence dans l’application Revolut ne prouve pas une disponibilité via Open Banking.
