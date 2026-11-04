# Mon Budget

Une application web en français pour gérer son budget étudiant : revenus, dépenses, catégories, plafonds mensuels et solde.

## Développement

Node.js 22.12+ ou 24 recommandé.

```sh
npm ci
npm run dev
```

## Vérification

```sh
npm test
npm run build
npm run preview
```

Les données sont sauvegardées dans le stockage local du navigateur sur cet appareil. Aucun compte ni service externe n’est requis. Effacer les données du navigateur efface aussi les opérations. Les plafonds par catégorie sont communs à tous les mois. Le solde affiche les revenus moins les dépenses du mois, sans report du mois précédent.
