# Règles de sécurité Firebase

Coller le contenu de [`firebase-rules.json`](firebase-rules.json) dans la console
Firebase → Realtime Database → Règles → Publier.

Le fichier est du **JSON pur** : `"rules"` doit être la première clé de l'objet
racine. Toute clé placée avant elle (y compris un commentaire `"//": "..."`) fait
échouer l'enregistrement avec « Expected 'rules' property ». C'est pourquoi les
explications sont ici et non dans le fichier.

## Ce que ces règles corrigent

| Faille | Correctif |
|---|---|
| `games` lisible **sans authentification** (e-mails exposés publiquement) | `.read` exige un compte ; les e-mails ne sont plus écrits par le client |
| Cascade `.write` : historique « append-only » décoratif, profil entier supprimable | Aucun `.write` au niveau `users/$uid` ; il descend feuille par feuille |
| Historique réécrivable | `history/$entry` : `.write` exige `!data.exists()` — écriture unique, jamais modifiable |
| Compteurs gonflables | `wins`/`losses`/`gamesPlayed` : +1 maximum par écriture, suppression interdite |
| Clé `$gameId` arbitraire (XSS via la clé) | `$gameId.matches(/^[0-9]{4}$/)` dans le `.write` |
| N'importe qui écrasait une partie en attente | Écriture scopée aux transitions d'état et aux participants |
| `expiresAt` modifiable = porte dérobée | La suppression s'appuie sur `createdAt` (fixé à la création), pas sur une valeur contrôlable |
| Identité de joueur remplaçable | `players/*/uid` immuable une fois posé |

## Changements de comportement assumés

- **Les spectateurs ne peuvent plus écrire dans le chat.** L'alternative — autoriser
  tout compte à écrire dans n'importe quelle partie — rouvrait le spam.
- **Un profil n'est lisible que par son propriétaire.** L'application ne lit jamais
  le profil d'un autre joueur (le pseudo de l'adversaire vient du nœud `games`),
  donc aucune fonctionnalité n'est perdue.

## Ce que ces règles ne peuvent PAS faire

Elles **ne peuvent pas vérifier qu'une partie a réellement eu lieu**. Le jeu tourne
chez le joueur, avec son propre moteur ; le serveur n'a aucun témoin indépendant.
Un joueur déterminé peut, depuis la console du navigateur, incrémenter ses
statistiques une unité à la fois. Les règles rendent cette triche **lente et
bornée**, pas impossible — et elle ne nuit qu'à sa propre progression.

Pour un **classement public** défendable, il faudra archiver la partie complète
(le SGF, prévu par le champ `sgf`) et pouvoir la rejouer côté serveur. Ce n'est pas
faisable avec les seules règles de sécurité.

## Vérification restante

Le tableau de correspondance écritures-légitimes ↔ règles a été tracé à la main,
pas prouvé automatiquement. Avant de considérer ces règles comme définitives,
il reste à les tester dans le simulateur de règles de la console Firebase (onglet
« Simulateur ») sur chaque scénario : créer, rejoindre, jouer, passer, chatter,
demander une annulation, et tenter chaque écriture interdite.
