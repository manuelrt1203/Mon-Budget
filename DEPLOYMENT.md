# Déployer Mon Budget sur Vercel

## 1. Utiliser le projet Vercel existant

Projet indiqué par l’éditeur : **https://mon-budget-sand.vercel.app**. Ne pas créer de doublon.

Les URL à enregistrer chez le prestataire, une fois cette version réellement déployée et les documents accessibles, sont :

- **Redirect URL** : `https://mon-budget-sand.vercel.app/api/bank/callback`
- **Privacy URL** : `https://mon-budget-sand.vercel.app/privacy.html`
- **Terms URL** : `https://mon-budget-sand.vercel.app/terms.html`

1. Dans le projet existant, vérifier **Settings → Git** : dépôt **manuelrt1203/Mon-Budget**, branche de production `main`. Un push sur cette branche doit déclencher le déploiement si l’intégration GitHub est active. Sinon, utiliser **Deployments → Redeploy** après avoir relié le dépôt.
2. Conserver le preset **Vite** et les réglages du dépôt : `npm ci`, `npm run build`, sortie `dist`, Node.js **24.x**.
3. Attendre le déploiement du dernier commit, ou cliquer sur **Redeploy** si nécessaire. Aucun secret bancaire n’est nécessaire pour cette première publication : le suivi manuel et les pages légales fonctionnent ; la banque reste désactivée.
4. Ouvrir l’adresse **Production** réellement attribuée par Vercel. Si Vercel protège le déploiement par une connexion Vercel, autoriser l’accès public au domaine de production pour que le prestataire puisse consulter les documents.

À partir de cette adresse réelle, saisir dans Enable Banking :

- **Redirect URL** : l’origine HTTPS suivie de `/api/bank/callback`.
- **Privacy URL** : la même origine suivie de `/privacy.html`.
- **Terms URL** : la même origine suivie de `/terms.html`.

Ne pas utiliser l’adresse d’une prévisualisation temporaire. Ne pas inventer le domaine : copier celui affiché par Vercel. Vérifier les deux documents et `/api/bank/status` après publication. Ouvrir le callback sans autorisation doit renvoyer vers la page d’accueil avec une erreur de connexion ; ce n’est pas une page de saisie.

## 2. Activer ensuite la connexion bancaire

Dans le projet Vercel :

1. **Storage / Marketplace** : connecter une base **Upstash Redis**, de préférence dans une région européenne proche des fonctions (Paris, `cdg1`). Choisir une offre adaptée ; les tarifs et limites relèvent du prestataire. L’intégration fournit normalement `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` (les alias historiques `KV_REST_API_URL` et `KV_REST_API_TOKEN` sont aussi acceptés). Redis est indispensable pour que le retour bancaire puisse être reçu sur une autre instance serveur.
2. **Settings → Environment Variables**, portée **Production** :
   - `APP_ORIGIN` : l’origine HTTPS de production, sans slash final. Si omise, l’application utilise `VERCEL_PROJECT_PRODUCTION_URL`, puis `VERCEL_URL` fournie par Vercel. Utiliser explicitement `APP_ORIGIN` si vous ajoutez un domaine personnalisé.
   - `APP_PASSWORD` : un mot de passe applicatif aléatoire et unique, au moins 16 caractères (32 recommandés), distinct de Revolut. Le saisir uniquement dans les paramètres sécurisés de Vercel et dans le formulaire de déverrouillage du site. Il protège les fonctions bancaires et sert à dériver la clé de chiffrement des sessions. Ne pas le partager dans le chat.
   - `ENABLE_BANKING_APP_ID` : l’identifiant de l’application créée chez Enable Banking.
   - `ENABLE_BANKING_PRIVATE_KEY` : le contenu PEM complet de la clé RSA privée, avec ses vrais retours à la ligne, dans une variable sensible côté serveur. Ne pas utiliser `ENABLE_BANKING_PRIVATE_KEY_PATH` sur Vercel et ne pas ajouter le fichier au dépôt.
3. Redéployer après modification des variables.
4. Sur l’URL de production, déverrouiller l’accès bancaire, cliquer sur **Connecter Revolut**, terminer le consentement et vérifier la synchronisation.

Aucun nom de variable ne doit commencer par `VITE_` pour ces identifiants. Aucun secret ne doit apparaître dans une URL, un commit ou une capture partagée. Ne pas renseigner les identifiants bancaires dans le site : le mot de passe demandé est celui de **Mon Budget**.

## Fonctionnement et limites

- L’interface statique est publique, mais elle ne contient aucune donnée bancaire commune. Chaque navigateur conserve son propre historique local ; toute personne accédant à ce même profil de navigateur peut le consulter.
- Les fonctions `/api/bank/*` sont protégées par le mot de passe et un cookie signé, HttpOnly et Secure, sauf le statut de configuration non sensible. Les opérations de connexion refusent les autres origines. Le serveur n’accepte que le domaine de production configuré : les URLs de prévisualisation ne doivent pas servir à autoriser la banque.
- Les sessions et le cache d’opérations sont chiffrés avant écriture dans Redis, avec expiration après huit heures d’inactivité. Ils survivent aux changements d’instance. Les verrous partagés garantissent qu’un état OAuth n’est consommé qu’une fois. Les tentatives de déverrouillage et de création de connexion sont limitées.
- Un changement de `APP_PASSWORD` invalide les cookies et les anciennes sessions chiffrées. Effacer les données du site et reconnecter Revolut dans ce cas ; l’ancien stockage expire après sa durée de vie. Les opérations conservées dans le navigateur ne dépendent pas de cette clé.
- Les fonctions font confiance aux en-têtes d’adresse client ajoutés par Vercel uniquement lorsque l’environnement `VERCEL=1` l’annonce. Le serveur local ignore les en-têtes de proxy.
- La fonction bancaire est limitée à 180 secondes. Vérifier la compatibilité de cette durée avec l’offre Vercel choisie. Les sessions ne sont pas liées à un système de comptes utilisateurs : ce déploiement est destiné à un usage personnel, pas à un service bancaire ouvert au public.

Le déploiement ne prouve pas l’accès réel à Revolut : celui-ci nécessite l’activation de l’application en production chez Enable Banking et le consentement de son titulaire.

## Diagnostic de configuration

`/api/bank/status` expose `missingConfiguration` : uniquement les noms des variables absentes ou invalides, sans leur valeur. `diagnosticVersion: 1` permet de vérifier que ce diagnostic a été déployé. Si la liste indique `APP_PASSWORD`, vérifier le nom exact, au moins 16 caractères, la portée Production et redéployer. Les variables Redis `KV_REST_API_URL` et `KV_REST_API_TOKEN` fournies par l’intégration Vercel sont acceptées sans les renommer. Ce diagnostic vérifie la présence et le format local des réglages ; il ne prouve pas l’autorisation effective chez les prestataires.
