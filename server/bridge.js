/*
 * Bridge local entre le navigateur et le moteur d'analyse KataGo.
 *
 *   navigateur  --HTTP-->  bridge (127.0.0.1:8081)  --JSON/stdio-->  katago.exe analysis
 *
 * Le bridge est sans etat : chaque requete porte l'historique complet des coups,
 * donc le navigateur reste la seule source de verite et il n'y a aucun risque de
 * desynchronisation avec le moteur.
 *
 * Aucune dependance npm : uniquement les modules integres a Node.
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

const PORT = Number(process.env.BRIDGE_PORT) || 8081;
const HOST = '127.0.0.1';

/* Le meme fichier sert dans deux dispositions differentes :
     - depot cloné      : server/bridge.js  avec  ../katago/
     - installeur       : bridge.js         avec  ./katago/
   et sous macOS le binaire vient de Homebrew, hors de toute arborescence.
   KATAGO_BIN, s'il est defini, tranche. */

const CANDIDATE_DIRS = [
  process.env.KATAGO_DIR,
  path.resolve(__dirname, 'katago'),
  path.resolve(__dirname, '..', 'katago')
].filter(Boolean);

const KATAGO_DIR = CANDIDATE_DIRS.find((d) => fs.existsSync(d)) || CANDIDATE_DIRS[0];

const EXE_NAME = process.platform === 'win32' ? 'katago.exe' : 'katago';
const KATAGO_EXE = process.env.KATAGO_BIN || path.join(KATAGO_DIR, EXE_NAME);
const KATAGO_MODEL = process.env.KATAGO_MODEL || path.join(KATAGO_DIR, 'net.bin.gz');
const KATAGO_CONFIG = process.env.KATAGO_CONFIG || path.join(KATAGO_DIR, 'analysis.cfg');

// Le bridge n'ecoute que sur la boucle locale, mais on restreint quand meme les
// origines : sans ca, n'importe quel site ouvert dans le navigateur pourrait
// faire tourner le GPU.
const ALLOWED_ORIGINS = [
  'https://shazamifius.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

/* ========== Demarrage du moteur ========== */

for (const [label, file] of [['executable', KATAGO_EXE], ['reseau', KATAGO_MODEL], ['config', KATAGO_CONFIG]]) {
  if (!fs.existsSync(file)) {
    console.error(`[bridge] ${label} introuvable : ${file}`);
    process.exit(1);
  }
}

let engineReady = false;
const pending = new Map();
let nextQueryId = 0;

const engine = spawn(KATAGO_EXE, [
  'analysis',
  '-config', KATAGO_CONFIG,
  '-model', KATAGO_MODEL
  // KataGo ecrit son cache de calibration GPU dans le repertoire courant : on
  // le place a cote du modele, pas la ou l'utilisateur a lance la commande.
], { cwd: fs.existsSync(KATAGO_DIR) ? KATAGO_DIR : path.dirname(KATAGO_CONFIG) });

engine.on('error', (err) => {
  console.error('[bridge] impossible de lancer KataGo :', err.message);
  process.exit(1);
});

engine.on('exit', (code) => {
  console.error(`[bridge] KataGo s'est arrete (code ${code}). Arret du bridge.`);
  process.exit(1);
});

// Les logs du moteur passent par stderr. Le premier lancement declenche la
// calibration OpenCL, qui prend plusieurs minutes : on relaie tout pour que
// l'utilisateur voie la progression.
readline.createInterface({ input: engine.stderr }).on('line', (line) => {
  console.log('[katago]', line);
  if (!engineReady && /ready to begin handling requests/i.test(line)) {
    engineReady = true;
    console.log(`[bridge] moteur pret. En ecoute sur http://${HOST}:${PORT}`);
  }
});

readline.createInterface({ input: engine.stdout }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    console.error('[bridge] reponse illisible du moteur :', line.slice(0, 200));
    return;
  }
  // Le moteur peut emettre des rapports intermediaires pendant la recherche :
  // on ne resout la promesse que sur la reponse finale.
  if (msg.isDuringSearch) return;

  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) {
    waiter.reject(new Error(msg.field ? `${msg.error} (champ ${msg.field})` : msg.error));
  } else {
    waiter.resolve(msg);
  }
});

function askEngine(query, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = `q${nextQueryId++}`;
    query.id = id;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('delai depasse cote moteur'));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); }
    });
    engine.stdin.write(JSON.stringify(query) + '\n');
  });
}

/* ========== Generation d'un coup ========== */

/**
 * moves : [["B","D4"], ["W","Q16"], ...] en coordonnees GTP, "pass" pour un passe.
 * Renvoie le meilleur coup du point de vue du joueur au trait.
 */
async function genmove({ moves, boardSize, komi, maxVisits }) {
  const query = {
    rules: 'chinese',          // scoring par aires : correspond a computeScore() cote client
    komi: komi,
    boardXSize: boardSize,
    boardYSize: boardSize,
    moves: moves,
    maxVisits: maxVisits,
    analyzeTurns: [moves.length], // on analyse la position APRES tous les coups joues
    includeOwnership: false,
    includePolicy: false
  };

  const res = await askEngine(query);
  const infos = res.moveInfos || [];
  if (!infos.length) {
    // Aucun coup legal propose : le moteur estime qu'il faut passer.
    return { move: 'pass', winrate: null, scoreLead: null, visits: 0 };
  }

  let best = infos[0];
  for (const info of infos) {
    if (info.order === 0) { best = info; break; }
  }

  // winrate et scoreLead sont donnes du point de vue du joueur au trait
  // (reportAnalysisWinratesAs = SIDETOMOVE dans analysis.cfg).
  return {
    move: best.move,
    winrate: best.winrate,
    scoreLead: best.scoreLead,
    // visits = effort total de la recherche ; best.visits ne compte que la
    // branche du coup retenu et sous-estime largement le travail fourni.
    visits: (res.rootInfo && res.rootInfo.visits) || best.visits,
    moveVisits: best.visits,
    pv: best.pv || []
  };
}

/* ========== Serveur HTTP ========== */

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('corps de requete trop volumineux')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health') {
    sendJson(res, 200, { ok: engineReady, engine: 'katago v1.16.5', backend: 'opencl' });
    return;
  }

  if (req.url === '/genmove' && req.method === 'POST') {
    if (!engineReady) {
      sendJson(res, 503, { error: 'Le moteur demarre encore (calibration OpenCL au premier lancement).' });
      return;
    }
    try {
      const body = await readBody(req);
      const boardSize = [9, 13, 19].includes(body.boardSize) ? body.boardSize : 19;
      const komi = typeof body.komi === 'number' ? body.komi : 7.5;
      const maxVisits = Math.min(Math.max(parseInt(body.maxVisits, 10) || 500, 1), 50000);
      const moves = Array.isArray(body.moves) ? body.moves : [];

      const started = Date.now();
      const result = await genmove({ moves, boardSize, komi, maxVisits });
      result.elapsedMs = Date.now() - started;

      console.log(`[bridge] coup ${moves.length + 1} -> ${result.move} ` +
        `(${result.visits} visites, ${result.elapsedMs} ms)`);
      sendJson(res, 200, result);
    } catch (e) {
      console.error('[bridge] /genmove :', e.message);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'route inconnue' });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] HTTP en ecoute sur http://${HOST}:${PORT}`);
  console.log('[bridge] demarrage de KataGo... (le tout premier lancement calibre OpenCL, comptez plusieurs minutes)');
});

process.on('SIGINT', () => { engine.kill(); process.exit(0); });
