# IPTV webOS — Live TV · Films · Séries

Trois apps webOS indépendantes et épurées pour un abonnement **Xtream Codes**, installables via **Homebrew Channel**.
Aucune pub, aucun tracker, aucun identifiant dans le dépôt : tu les saisis sur la TV (une fois par app) et ils restent sur la TV.

| App | Rôle |
|---|---|
| **Live TV** | Chaînes en direct, zapping rapide, favoris, EPG (maintenant / ensuite), reprise de la dernière chaîne |
| **Films** | Catalogue par catégories, recherche, reprise de lecture |
| **Séries** | Saisons/épisodes, reprise, épisode suivant automatique |

## Connexions simultanées (anti-ban)
- Chaque app n'ouvre **qu'un seul flux à la fois**, et les appels API sont mis en file (1 à la fois, 150 ms d'écart).
- Dès que tu quittes l'app (Retour, Home, autre app, relance), le flux est **coupé** : l'écran est libéré chez le fournisseur, **sans te déconnecter** (identifiants conservés).
- Zapping : la chaîne n'est demandée au serveur qu'après 450 ms de stabilité → les chaînes survolées ne consomment rien.
- Catalogues en cache 12 h (pas de re-téléchargement à chaque ouverture).
- En cas de refus (connexions max), nouvel essai automatique après quelques secondes.

## Latence (Live)
Flux **MPEG-TS direct** en premier, repli **HLS** automatique si le TS ne démarre pas. Bouton rouge → bascule manuelle TS/HLS.

## Installation
1. Pousse ce dossier sur ton GitHub (dépôt public), puis crée un tag : `git tag v1.0.0 && git push --tags`.
   La GitHub Action construit les `.ipk` et publie `repo.json` dans la release.
2. Sur la TV : **Homebrew Channel → Paramètres → Ajouter un dépôt** :
   `https://github.com/<TON_USER>/<TON_DEPOT>/releases/latest/download/repo.json`
3. Installe *Live TV*, *Films*, *Séries* depuis Homebrew Channel.

## Télécommande
Flèches/OK · Retour · Rouge : réglages (rafraîchir, changer de compte) · Vert : favori (Live) · Haut/Bas ±60 s, Gauche/Droite ±10 s, OK pause (VOD).

## Développement
`npm ci && GITHUB_REPOSITORY=user/repo node scripts/build.mjs` → `dist/`.
Faux serveur Xtream pour tester l'UI : `node test/mock-server.mjs`.
Mise à jour d'une app : incrémente `version` dans son `appinfo.json`, crée un nouveau tag `vX.Y.Z`.
