# Online Go Game

Jeu de go en ligne : plateaux 9x9 / 13x13 / 19x19, multijoueur temps reel via
Firebase, mode spectateur, chat, minuteur, statistiques — et un mode solo contre
**KataGo**.

## Jouer contre KataGo

Le mode solo fait tourner le vrai moteur KataGo sur votre machine. Il n'existe
pas de portage WebAssembly officiel de KataGo : les versions « dans le
navigateur » n'executent que le reseau de neurones sans recherche MCTS, ce qui
est nettement plus faible. Ici le moteur natif tourne en local et le navigateur
lui parle par un petit pont HTTP.

```
navigateur  --HTTP-->  server/bridge.js  --JSON/stdio-->  katago.exe
```

Le mode solo ne passe pas par Firebase : la partie reste entierement locale.
Seul l'historique de fin de partie est enregistre sur votre compte.

### Installation (une seule fois)

1. **Recuperer le moteur.** Telecharger la derniere version depuis
   [les releases KataGo](https://github.com/lightvector/KataGo/releases) et
   decompresser dans `katago/`.
   Sous Windows, le build `opencl` est le plus simple : il est autonome et se
   contente des pilotes GPU, la ou les builds CUDA et TensorRT demandent
   d'installer separement CUDA, cuDNN ou TensorRT.

2. **Recuperer un reseau de neurones.** Prendre le reseau le plus fort sur
   [katagotraining.org/networks](https://katagotraining.org/networks/) et
   l'enregistrer sous `katago/net.bin.gz`.

3. **Creer la configuration** a partir de l'exemple fourni dans l'archive :

   ```bash
   cp katago/analysis_example.cfg katago/analysis.cfg
   ```

   Puis y regler `reportAnalysisWinratesAs = SIDETOMOVE`. Sans ca le taux de
   victoire est toujours renvoye du point de vue de Noir, ce qui fausse la
   logique d'abandon de l'IA.

Le dossier `katago/` est volontairement exclu du depot (`.gitignore`) : le
moteur et le reseau pesent plusieurs centaines de megaoctets.

### Lancer

```bash
node server/bridge.js
```

Aucune dependance npm. Le **tout premier** demarrage calibre OpenCL pour votre
GPU et prend plusieurs minutes ; les suivants sont immediats, le resultat etant
mis en cache dans `katago/KataGoData/`.

Ouvrir ensuite le site, puis l'encadre « Jouer contre KataGo » dans le lobby.

> Le site publie sur GitHub Pages est en HTTPS alors que le pont est en HTTP.
> Cela fonctionne malgre tout : les navigateurs considerent `127.0.0.1` comme une
> origine sure et n'appliquent pas le blocage de contenu mixte.

### Reglages

| Reglage | Effet |
| --- | --- |
| Force | Nombre de visites MCTS par coup. Plus haut = plus fort et plus lent. |
| Couleur | Noir joue en premier. |
| Taille | 9x9, 13x13 ou 19x19. |

Ordre de grandeur mesure sur une RTX 5070 Laptop en OpenCL : environ
**310 visites/seconde**, soit ~1,5 s par coup a 500 visites et ~6 s a 2000.

### Regles

KataGo est interroge en regles chinoises (comptage par aires, komi 7,5), ce qui
correspond a la fonction de comptage du client. Les deux comptages concordent
donc, a une reserve pres : le retrait des pierres mortes en fin de partie n'est
pas negocie, il faut jouer la position jusqu'au bout.

## Limites connues

- Le mode solo ne fonctionne que sur la machine qui fait tourner le pont.
- Le bouton d'annulation est masque contre l'IA : le mecanisme existant repose
  sur une negociation entre deux joueurs humains via Firebase.
- La force se regle en visites, pas en rang. Pour une IA calibree sur un niveau
  precis (par exemple 5 kyu), KataGo propose un reseau « human SL » dedie —
  voir `gtp_human5k_example.cfg` dans l'archive du moteur.

## Structure

| Fichier | Role |
| --- | --- |
| `index.html` | Structure des ecrans |
| `script.js` | Regles du go, rendu du plateau, multijoueur Firebase |
| `katago.js` | Mode solo : substitue un faux `gameRef` local et pilote l'IA |
| `style.css` | Theme |
| `server/bridge.js` | Pont HTTP vers le moteur KataGo |
