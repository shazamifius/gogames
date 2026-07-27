/*
 * Telecharge le reseau « humanSL » de KataGo.
 *
 *   node server/get-human-model.js
 *
 * Ce reseau ne cherche pas le meilleur coup : il imite un joueur d'un rang
 * donne (25 kyu a 9 dan). C'est ce qui permet d'avoir enfin un adversaire a sa
 * taille. Sans lui, meme regle sur une seule visite, KataGo joue au niveau dan :
 * sa force vient du reseau, pas de la profondeur de recherche.
 *
 * Aucune dependance npm : uniquement les modules integres a Node.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_URL =
  'https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.bin.gz';
const EXPECTED_BYTES = 99066230; // ~94 Mo

const CANDIDATE_DIRS = [
  process.env.KATAGO_DIR,
  path.resolve(__dirname, 'katago'),
  path.resolve(__dirname, '..', 'katago')
].filter(Boolean);

const KATAGO_DIR = CANDIDATE_DIRS.find((d) => fs.existsSync(d));
if (!KATAGO_DIR) {
  console.error('[modele] dossier katago/ introuvable. Lance ce script depuis le depot.');
  process.exit(1);
}

const DEST = path.join(KATAGO_DIR, 'human.bin.gz');
const TMP = DEST + '.part';

if (fs.existsSync(DEST)) {
  const size = fs.statSync(DEST).size;
  if (size === EXPECTED_BYTES) {
    console.log('[modele] deja present et complet :', DEST);
    console.log('[modele] relance le pont : node server/bridge.js');
    process.exit(0);
  }
  console.log(`[modele] fichier existant incomplet (${size} octets), retelechargement.`);
}

function human(bytes) {
  return (bytes / 1048576).toFixed(1) + ' Mo';
}

/* Les releases GitHub redirigent vers un CDN signe : il faut suivre les 302,
   sans quoi on telecharge une reponse vide de 0 octet. */
function download(url, redirectsLeft = 5) {
  if (redirectsLeft < 0) {
    console.error('[modele] trop de redirections.');
    process.exit(1);
  }

  https.get(url, { headers: { 'User-Agent': 'gogames-model-fetch' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume(); // libere le socket avant de repartir
      download(res.headers.location, redirectsLeft - 1);
      return;
    }
    if (res.statusCode !== 200) {
      console.error(`[modele] echec HTTP ${res.statusCode}.`);
      console.error('[modele] telecharge-le a la main depuis :');
      console.error('   ' + MODEL_URL);
      console.error('   puis renomme-le en human.bin.gz dans le dossier katago/.');
      res.resume();
      process.exit(1);
    }

    const total = parseInt(res.headers['content-length'], 10) || EXPECTED_BYTES;
    let received = 0;
    let lastShown = 0;

    const out = fs.createWriteStream(TMP);
    res.pipe(out);

    res.on('data', (chunk) => {
      received += chunk.length;
      // Un point tous les 2 % : lisible dans un terminal, sans le noyer.
      const pct = Math.floor((received / total) * 100);
      if (pct >= lastShown + 2) {
        lastShown = pct;
        process.stdout.write(`\r[modele] ${pct} %  (${human(received)} / ${human(total)})   `);
      }
    });

    out.on('finish', () => {
      out.close(() => {
        process.stdout.write('\n');
        const size = fs.statSync(TMP).size;
        // Un fichier tronque ferait planter KataGo au demarrage avec un message
        // incomprehensible : on refuse de l'installer.
        if (size < total * 0.99) {
          fs.unlinkSync(TMP);
          console.error(`[modele] telechargement incomplet (${human(size)}). Relance la commande.`);
          process.exit(1);
        }
        fs.renameSync(TMP, DEST);
        console.log('[modele] installe :', DEST);
        console.log('');
        console.log('  ============================================');
        console.log('   [OK]  RESEAU HUMAIN PRET');
        console.log('');
        console.log('   Relance le pont :  node server/bridge.js');
        console.log('   Les niveaux 25 kyu a 1 dan apparaitront');
        console.log('   dans le menu « Niveau de l\'adversaire ».');
        console.log('  ============================================');
        console.log('');
      });
    });

    out.on('error', (err) => {
      console.error('\n[modele] ecriture impossible :', err.message);
      process.exit(1);
    });
  }).on('error', (err) => {
    console.error('[modele] telechargement impossible :', err.message);
    console.error('[modele] verifie ta connexion, ou telecharge a la main :');
    console.error('   ' + MODEL_URL);
    process.exit(1);
  });
}

console.log('[modele] reseau humain KataGo (~94 Mo)');
console.log('[modele] destination :', DEST);
download(MODEL_URL);
