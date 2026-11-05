# Mon Budget

Application web en français pour gérer son budget étudiant : revenus, dépenses, catégories, plafonds mensuels et solde. Les opérations sont conservées dans le stockage local du navigateur. Les plafonds sont communs à tous les mois ; le solde est le revenu moins les dépenses du mois, sans report ni équivalence avec le solde bancaire.

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

- Lecture des **90 derniers jours**, avec pagination, pour les comptes autorisés. Seules les opérations `BOOK` en **EUR**, avec une référence stable, sont importées. Les opérations en attente, autres devises et données invalides sont comptées et ignorées ; aucun taux de conversion n’est inventé.
- Synchronisation à l’ouverture d’une connexion existante, puis toutes les **15 minutes tant que la page est visible**. Le bouton permet aussi une actualisation manuelle ; le serveur conserve une réponse 60 secondes pour éviter les requêtes répétées. Il n’y a pas de synchronisation lorsque le site est fermé.
- Les identifiants sont dérivés du compte (IBAN ou identifiant stable si fourni, sinon identifiant de session) et de la référence fournie par le prestataire. En l’absence d’identifiant de compte stable, un avertissement invite à vérifier les doublons après une nouvelle connexion. Répéter la synchronisation met à jour les opérations existantes sans les dupliquer et conserve les catégories choisies. Les nouvelles opérations sont classées « Autres » ; la catégorie est modifiable dans le tableau.
- Les virements entre comptes, remboursements et mouvements d’épargne restent inclus selon leur sens débit/crédit. Les totaux de budget peuvent donc nécessiter une interprétation. Les absences d’une fenêtre de synchronisation ne suppriment pas l’historique déjà importé.
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
