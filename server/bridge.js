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

/* Reseau « humanSL » : imite un joueur d'un rang donne (20 kyu a 9 dan) au lieu
   de chercher le meilleur coup. C'est ce qui rend un adversaire ABORDABLE.
   Baisser maxVisits ne suffit pas : meme a une seule visite, le reseau normal
   joue au niveau dan, parce que sa force vient du reseau lui-meme et non de la
   recherche. Le fichier est optionnel — absent, le pont fonctionne comme avant. */
const HUMAN_MODEL_NAMES = ['human.bin.gz', 'b18c384nbt-humanv0.bin.gz', 'humanv0.bin.gz'];
const KATAGO_HUMAN_MODEL = process.env.KATAGO_HUMAN_MODEL ||
  HUMAN_MODEL_NAMES.map((n) => path.join(KATAGO_DIR, n)).find((p) => fs.existsSync(p)) || null;
const HAS_HUMAN_MODEL = Boolean(KATAGO_HUMAN_MODEL && fs.existsSync(KATAGO_HUMAN_MODEL));

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
// Requetes d'analyse : KataGo repond UNE ligne PAR tour demande (meme id,
// champ turnNumber). On collecte jusqu'a avoir tous les tours attendus.
const pendingMulti = new Map();
let nextQueryId = 0;

const engineArgs = [
  'analysis',
  '-config', KATAGO_CONFIG,
  '-model', KATAGO_MODEL
];
if (HAS_HUMAN_MODEL) {
  engineArgs.push('-human-model', KATAGO_HUMAN_MODEL);
  console.log(`[bridge] reseau humain detecte : ${path.basename(KATAGO_HUMAN_MODEL)}`);
  console.log('[bridge] les niveaux debutants (25k a 1d) sont disponibles.');
} else {
  console.log('[bridge] pas de reseau humain : seuls les niveaux « moteur » sont proposes.');
  console.log('[bridge] pour jouer contre un vrai debutant : node server/get-human-model.js');
}

const engine = spawn(KATAGO_EXE, engineArgs,
  // KataGo ecrit son cache de calibration GPU dans le repertoire courant : on
  // le place a cote du modele, pas la ou l'utilisateur a lance la commande.
  { cwd: fs.existsSync(KATAGO_DIR) ? KATAGO_DIR : path.dirname(KATAGO_CONFIG) });

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
    // Banniere volontairement voyante : c'est LE signal que l'utilisateur attend.
    console.log('');
    console.log('  ============================================');
    console.log('   [OK]  MOTEUR PRET');
    console.log('');
    console.log('   Retourne sur le site et clique');
    console.log('   « J\'ai lance le moteur - reverifier ».');
    console.log('   (Le site peut aussi basculer au vert tout seul.)');
    console.log('');
    console.log('   Laisse CETTE fenetre ouverte pendant que tu joues.');
    console.log('  ============================================');
    console.log('');
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

  // Reponse d'analyse multi-tours ?
  const multi = pendingMulti.get(msg.id);
  if (multi) {
    if (msg.error) {
      pendingMulti.delete(msg.id);
      multi.reject(new Error(msg.field ? `${msg.error} (champ ${msg.field})` : msg.error));
      return;
    }
    multi.results.push(msg);
    if (multi.results.length >= multi.expected) {
      pendingMulti.delete(msg.id);
      multi.resolve(multi.results);
    }
    return;
  }

  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.error) {
    waiter.reject(new Error(msg.field ? `${msg.error} (champ ${msg.field})` : msg.error));
  } else {
    waiter.resolve(msg);
  }
});

function askEngineAnalysis(query, expectedCount, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const id = `a${nextQueryId++}`;
    query.id = id;
    const timer = setTimeout(() => {
      pendingMulti.delete(id);
      reject(new Error('delai depasse pendant l\'analyse'));
    }, timeoutMs);
    pendingMulti.set(id, {
      expected: expectedCount,
      results: [],
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); }
    });
    engine.stdin.write(JSON.stringify(query) + '\n');
  });
}

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

const GTP_LETTERS = 'ABCDEFGHJKLMNOPQRST'; // pas de I, convention go

/* Le pont accepte des requetes du navigateur : tout ce qui est reinjecte dans
   le moteur est valide ici, jamais fait confiance tel quel. */

// Profils humanSL reconnus par KataGo : rank_20k..rank_9d, preaz_*, proyear_YYYY.
function sanitizeProfile(value) {
  if (typeof value !== 'string') return null;
  if (/^(rank|preaz)_([1-9]|1[0-9]|2[0-5])[kd]$/.test(value)) return value;
  if (/^proyear_(1[89]\d{2}|20[0-2]\d)$/.test(value)) return value;
  return null;
}

// Pierres de handicap : [["B","D4"], ...]. On refuse tout ce qui n'est pas une
// coordonnee GTP valide pour ce plateau, doublons compris.
function sanitizeStones(value, boardSize) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const s of value.slice(0, 9)) {
    if (!Array.isArray(s) || s.length < 2) continue;
    const color = String(s[0]).toUpperCase();
    const coord = String(s[1]).toUpperCase();
    if (color !== 'B' && color !== 'W') continue;
    const m = /^([A-HJ-T])([0-9]{1,2})$/.exec(coord);
    if (!m) continue;
    const x = GTP_LETTERS.indexOf(m[1]);
    const row = parseInt(m[2], 10);
    if (x < 0 || x >= boardSize || row < 1 || row > boardSize) continue;
    if (seen.has(coord)) continue;
    seen.add(coord);
    out.push([color, coord]);
  }
  return out;
}

/* Tire un coup au sort dans la distribution humaine plutot que de prendre le
   plus probable. Deux raisons : un humain d'un rang donne ne joue pas toujours
   le meme coup, et un adversaire deterministe s'apprend par coeur au lieu de
   se comprendre. On ignore les coups sous le seuil pour eviter les coups
   absurdes de la queue de distribution. */
function sampleHumanPolicy(policy, boardSize, floor = 0.005) {
  if (!Array.isArray(policy) || policy.length < boardSize * boardSize + 1) return null;

  const candidates = [];
  let total = 0;
  for (let i = 0; i < boardSize * boardSize; i++) {
    const p = policy[i];
    if (typeof p !== 'number' || p < floor) continue; // < 0 : coup illegal
    candidates.push({ i, p });
    total += p;
  }
  if (!candidates.length || total <= 0) return null;

  let r = Math.random() * total;
  let chosen = candidates[candidates.length - 1];
  for (const c of candidates) {
    r -= c.p;
    if (r <= 0) { chosen = c; break; }
  }

  // Policy indexee en y * boardXSize + x, origine en haut a gauche.
  const x = chosen.i % boardSize;
  const y = Math.floor(chosen.i / boardSize);
  return { move: GTP_LETTERS[x] + (boardSize - y), prob: chosen.p / total };
}

/**
 * moves : [["B","D4"], ["W","Q16"], ...] en coordonnees GTP, "pass" pour un passe.
 * initialStones : pierres posees avant la partie (handicap), meme format.
 * humanProfile : rang imite ("preaz_10k") si le reseau humain est charge.
 * Renvoie le coup a jouer du point de vue du joueur au trait.
 */
async function genmove({ moves, boardSize, komi, maxVisits, initialStones, humanProfile }) {
  const useHuman = Boolean(humanProfile && HAS_HUMAN_MODEL);

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
  if (Array.isArray(initialStones) && initialStones.length) {
    query.initialStones = initialStones;
  }
  if (useHuman) {
    // On veut la distribution du joueur imite, pas le meilleur coup du moteur.
    query.includePolicy = true;
    query.overrideSettings = { humanSLProfile: humanProfile };
  }

  const res = await askEngine(query);
  const infos = res.moveInfos || [];

  // Coup humain : echantillonne dans la policy du rang demande. En cas d'echec
  // (reseau absent, champ non renvoye par cette version du moteur), on retombe
  // silencieusement sur la recherche classique — jamais d'erreur pour le joueur.
  if (useHuman) {
    const humanPolicy = res.humanPolicy || res.policy;
    const picked = sampleHumanPolicy(humanPolicy, boardSize);
    if (picked) {
      const match = infos.find((m) => m.move === picked.move);
      const root = res.rootInfo || {};
      return {
        move: picked.move,
        // Evaluation objective de la position, pour la barre et l'abandon.
        winrate: typeof root.winrate === 'number' ? root.winrate : (match ? match.winrate : null),
        scoreLead: typeof root.scoreLead === 'number' ? root.scoreLead : (match ? match.scoreLead : null),
        visits: root.visits || 0,
        human: true,
        humanProb: picked.prob,
        pv: match ? (match.pv || []) : []
      };
    }
  }

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

/* ========== Analyse d'une partie complete ========== */

/**
 * Analyse toutes les positions de la partie en UNE requete (analyzeTurns).
 * Renvoie, pour chaque tour 0..n : le winrate et le scoreLead du joueur au
 * trait (avec le meilleur jeu), et le meilleur coup selon KataGo.
 *
 * Le cout d'un coup se calcule ensuite cote client :
 *   cout(t) = winrate[t] + winrate[t+1] - 1
 * (le winrate que le joueur au trait a jete en jouant autre chose que le
 * meilleur coup ; 0 si son coup etait optimal).
 */
async function analyzeGame({ moves, boardSize, komi, maxVisits, initialStones }) {
  const turns = [];
  for (let t = 0; t <= moves.length; t++) turns.push(t);

  const query = {
    rules: 'chinese',
    komi: komi,
    boardXSize: boardSize,
    boardYSize: boardSize,
    moves: moves,
    analyzeTurns: turns,
    maxVisits: maxVisits,
    includeOwnership: false,
    includePolicy: false
  };
  // Sans les pierres de handicap, l'analyse evaluerait une autre partie que
  // celle qui a ete jouee : chaque coup serait juge sur une position fausse.
  if (Array.isArray(initialStones) && initialStones.length) {
    query.initialStones = initialStones;
  }

  const responses = await askEngineAnalysis(query, turns.length);

  // Les reponses arrivent dans le desordre : on les range par turnNumber.
  const byTurn = new Map();
  for (const r of responses) {
    const infos = r.moveInfos || [];
    let best = infos[0];
    for (const info of infos) { if (info.order === 0) { best = info; break; } }
    const root = r.rootInfo || {};
    byTurn.set(r.turnNumber, {
      turn: r.turnNumber,
      // Point de vue du joueur au trait a ce tour (SIDETOMOVE).
      winrate: typeof root.winrate === 'number' ? root.winrate : (best ? best.winrate : null),
      scoreLead: typeof root.scoreLead === 'number' ? root.scoreLead : (best ? best.scoreLead : null),
      bestMove: best ? best.move : null,
      visits: root.visits || 0
    });
  }

  const out = [];
  for (const t of turns) if (byTurn.has(t)) out.push(byTurn.get(t));
  out.sort((a, b) => a.turn - b.turn);
  return out;
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

/* ========== Repli local : le pont sert aussi le jeu ==========
   Safari refuse tout appel loopback depuis une page HTTPS (bug WebKit 171934) :
   ses utilisateurs ne peuvent donc pas jouer depuis le vrai site. En servant le
   jeu lui-meme, le pont leur offre une porte de sortie : ils ouvrent
   http://127.0.0.1:8081 et la page comme le moteur sont sur la meme origine —
   ni contenu mixte, ni permission reseau local, ni CORS. */

const SITE_DIR = [__dirname, path.resolve(__dirname, '..')]
  .find((d) => fs.existsSync(path.join(d, 'index.html'))) || __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  // Garde anti-remontee : le chemin resolu doit rester sous SITE_DIR.
  const filePath = path.normalize(path.join(SITE_DIR, rel));
  if (!filePath.startsWith(SITE_DIR)) { res.writeHead(403); res.end(); return; }
  const ext = path.extname(filePath).toLowerCase();
  if (!MIME[ext]) { sendJson(res, 404, { error: 'type non servi' }); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { sendJson(res, 404, { error: 'introuvable' }); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/health' || req.url.startsWith('/health?')) {
    // « human » pilote l'affichage des niveaux debutants cote site : sans le
    // reseau humain, les proposer serait mentir sur la force de l'adversaire.
    sendJson(res, 200, {
      ok: engineReady,
      engine: 'katago v1.16.5',
      backend: 'opencl',
      human: HAS_HUMAN_MODEL
    });
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
      const initialStones = sanitizeStones(body.initialStones, boardSize);
      const humanProfile = sanitizeProfile(body.humanProfile);

      const started = Date.now();
      const result = await genmove({ moves, boardSize, komi, maxVisits, initialStones, humanProfile });
      result.elapsedMs = Date.now() - started;

      console.log(`[bridge] coup ${moves.length + 1} -> ${result.move} ` +
        `(${result.human ? `humain ${humanProfile}` : `${result.visits} visites`}, ${result.elapsedMs} ms)`);
      sendJson(res, 200, result);
    } catch (e) {
      console.error('[bridge] /genmove :', e.message);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  if (req.url === '/analyze' && req.method === 'POST') {
    if (!engineReady) {
      sendJson(res, 503, { error: 'Le moteur démarre encore.' });
      return;
    }
    try {
      const body = await readBody(req);
      const boardSize = [9, 13, 19].includes(body.boardSize) ? body.boardSize : 19;
      const komi = typeof body.komi === 'number' ? body.komi : 7.5;
      // Analyse : moins de visites que pour jouer (on en fait beaucoup), mais
      // borne haute pour ne pas bloquer le GPU trop longtemps.
      const maxVisits = Math.min(Math.max(parseInt(body.maxVisits, 10) || 100, 10), 2000);
      const moves = Array.isArray(body.moves) ? body.moves : [];
      if (moves.length === 0) { sendJson(res, 400, { error: 'aucun coup à analyser' }); return; }
      if (moves.length > 400) { sendJson(res, 400, { error: 'partie trop longue (max 400 coups)' }); return; }

      const started = Date.now();
      const initialStones = sanitizeStones(body.initialStones, boardSize);
      const turns = await analyzeGame({ moves, boardSize, komi, maxVisits, initialStones });
      console.log(`[bridge] analyse de ${moves.length} coups en ${((Date.now() - started) / 1000).toFixed(1)} s`);
      sendJson(res, 200, { turns, elapsedMs: Date.now() - started });
    } catch (e) {
      console.error('[bridge] /analyze :', e.message);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // Toute autre requete GET est servie comme fichier du jeu (repli local).
  if (req.method === 'GET') { serveStatic(req, res); return; }

  sendJson(res, 404, { error: 'route inconnue' });
});

// Un pont deja lance occupe le port : au lieu d'une stack trace, on l'explique
// et on sort proprement. C'est un cas normal (double lancement, fenetre restee
// ouverte), pas une erreur pour l'utilisateur.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('  ============================================');
    console.log(`   Un moteur tourne DEJA sur le port ${PORT}.`);
    console.log('');
    console.log('   C\'est sans doute une autre fenetre du pont,');
    console.log('   deja prete. Tu peux fermer celle-ci et');
    console.log('   retourner jouer sur le site.');
    console.log('  ============================================');
    console.log('');
    engine.kill();
    process.exit(0);
  }
  console.error('[bridge] erreur serveur :', err.message);
  engine.kill();
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] En ecoute sur http://${HOST}:${PORT}`);
  console.log('[bridge] Demarrage de KataGo...');
  console.log('[bridge] PREMIERE FOIS : calibration du GPU, quelques minutes. Patiente.');
});

process.on('SIGINT', () => { engine.kill(); process.exit(0); });
