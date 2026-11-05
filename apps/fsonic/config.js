// >>> METS ICI L'ADRESSE DE TON JEU (entre les guillemets) <<<
window.FSONIC = {
  url: 'https://fr.fsonic.net/',
  // 'frame'    : le jeu est affiché dans un cadre (pop-ups bloqués, ne peut pas sortir de l'app) — recommandé
  // 'redirect' : la page du jeu remplace l'app (Retour quitte l'app, aucun garde-fou)
  mode: 'frame',
  // Mode frame : true = tout changement de page dans le cadre ramène à l'adresse ci-dessus.
  // Laisse false si la vérification Cloudflare passe par une autre page puis revient (true l'interromprait).
  lockToHome: false
};
