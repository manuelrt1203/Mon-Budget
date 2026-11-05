// Applique le thème choisi avant le premier affichage (évite un flash clair).
// Fichier séparé (et non un script dans la page) pour permettre une Content-Security-Policy stricte.
try {
  var theme = localStorage.getItem('mon-budget-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch (e) { /* stockage indisponible : thème automatique */ }
