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

### Jouer contre un adversaire a sa taille

**Le point le plus important pour progresser.** Baisser le nombre de visites ne
rend pas KataGo faible : sa force vient de son reseau, pas de la profondeur de
recherche. Meme reduit a une seule visite, il joue au niveau dan. Un debutant
qui l'affronte perd donc 100 % de ses parties, quel que soit le reglage.

Deux mecanismes existent pour corriger ca.

**1. Le reseau « humanSL ».** Il imite un joueur d'un rang donne au lieu de
chercher le meilleur coup. C'est un second reseau, a telecharger une fois :

```bash
node server/get-human-model.js   # ~94 Mo, dans katago/human.bin.gz
node server/bridge.js            # relancer le pont
```

Les niveaux **20 kyu a 5 dan** apparaissent alors dans le menu « Niveau de
l'adversaire ». Le pont les detecte tout seul (`/health` renvoie `human: true`)
et le site ne les affiche jamais sans le reseau : annoncer « 20 kyu » en faisant
jouer un dan serait pire que de ne rien proposer.

Le coup joue est **tire au sort** dans la distribution du rang imite, pas pris
au maximum : un humain d'un rang donne ne joue pas toujours le meme coup, et un
adversaire deterministe s'apprend par coeur au lieu de se comprendre.

**2. Le handicap.** De 2 a 9 pierres posees sur les hoshi avant le debut, selon
la convention habituelle. Chaque pierre vaut environ un rang d'ecart. Le komi
tombe alors a 0,5 : rendre 7,5 points a Blanc annulerait le handicap.

Les deux se combinent, et le classement Glicko-2 en tient compte — battre un
10 kyu simule a 9 pierres ne rapporte pas autant que le battre a egalite.

### Reglages

| Reglage | Effet |
| --- | --- |
| Niveau | Un rang imite (20k a 5d, reseau humain) **ou** un nombre de visites MCTS. |
| Handicap | 2 a 9 pierres d'avance pour Noir. Komi ramene a 0,5. |
| Couleur | Noir joue en premier — sauf a handicap, ou Blanc ouvre. |
| Taille | 9x9, 13x13 ou 19x19. Commencer en 9x9 : les parties sont courtes et les erreurs se voient. |

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
- Les rangs du reseau humain sont approximatifs : un « 15 kyu » simule joue comme
  un 15 kyu *en moyenne*, avec des coups parfois bien meilleurs ou bien pires.
- **Les regles de securite Firebase vivent dans la console, pas dans le depot.**
  `firebase-rules.json` sert de reference : apres toute modification, il faut le
  republier a la main. Le noeud `history` refuse tout champ non declare
  (`"$other": {".validate": false}`) et rejette alors l'entree **entiere**, tandis
  que les compteurs et le classement, sur d'autres chemins, passent sans erreur.
  Symptome : les statistiques montent mais l'historique et la courbe restent
  vides. Depuis juillet 2026, `saveGameHistory` reessaie sans les champs recents
  et affiche ce qu'il a du sacrifier, au lieu de tout perdre en silence.

## Structure

| Fichier | Role |
| --- | --- |
| `index.html` | Structure des ecrans |
| `script.js` | Regles du go, rendu du plateau, multijoueur Firebase |
| `katago.js` | Mode solo : substitue un faux `gameRef` local et pilote l'IA |
| `analysis.js` | Revue de partie : precision, coups a revoir, ou l'on perd ses points |
| `glicko2.js` | Classement Glicko-2 (autonome, testable hors du jeu) |
| `style.css` | Theme |
| `server/bridge.js` | Pont HTTP vers le moteur KataGo |
| `server/get-human-model.js` | Telecharge le reseau « humanSL » (adversaires debutants) |
