/* =================================
   Mode "Jouer contre KataGo"
   Charge APRES script.js : reutilise ses fonctions et ses variables globales.

   Principe : au lieu d'ajouter des branchements "si IA" partout dans script.js,
   on remplace simplement gameRef par un faux ref local qui expose la meme API
   que Firebase. Du coup playMove(), passTurn(), resign(), setupGameListener()
   et endGame() fonctionnent tels quels, sans aucune modification, et le code
   multijoueur existant n'est pas touche.
================================= */

// Si le jeu est deja servi depuis une origine loopback (le pont sert aussi le
// site, cf. server/bridge.js), on parle au pont sur cette meme origine : meme
// origine = pas de contenu mixte, pas de permission reseau local, et Safari
// fonctionne. Sinon on vise le pont local par defaut.
function isLoopbackOrigin() {
    const h = location.hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

const KATAGO_BRIDGE_URL = isLoopbackOrigin() ? location.origin : "http://127.0.0.1:8081";
const GTP_LETTERS = "ABCDEFGHJKLMNOPQRST"; // pas de I, convention go

let vsAI = false;
let aiColor = 2;              // couleur jouee par KataGo
let aiVisits = 500;           // force : nombre de visites MCTS par coup
let aiThinking = false;
let localGameRef = null;

// Journal des coups au format KataGo. Indispensable : moveList de script.js
// n'enregistre PAS les passes, donc l'alternance des couleurs y devient fausse
// des qu'un joueur passe. On tient donc notre propre journal, avec la couleur
// explicite pour chaque coup.
let gtpMoves = [];

// En dessous de ce taux de victoire (du point de vue de KataGo), l'IA abandonne.
const AI_RESIGN_WINRATE = 0.04;
const AI_RESIGN_MIN_MOVES = 30; // jamais d'abandon dans l'ouverture

// Note de reference de KataGo selon sa force (nombre de visites). Ces valeurs
// sont un point de depart a CALIBRER : elles fixent l'echelle du classement.
// RD faible : la force du moteur a un niveau donne est stable et bien connue.
const KATAGO_RATINGS = {
    100:   { rating: 2200, rd: 60 },
    500:   { rating: 2600, rd: 60 },
    2000:  { rating: 2900, rd: 60 },
    10000: { rating: 3200, rd: 60 }
};

/* Niveaux « humains ». Le reseau humanSL imite un joueur du rang demande au
   lieu de chercher le meilleur coup — c'est la seule facon d'avoir un
   adversaire abordable. Reduire les visites n'y suffit pas : la force de
   KataGo vient de son reseau, pas de la profondeur de recherche, et meme a une
   visite il joue au niveau dan.

   Correspondance rang -> note : un 20 kyu est autour de 700 Elo, un 1 dan
   autour de 2100, avec ~100 points par rang. Le classement Glicko-2 devient
   alors interpretable : gagner contre le 15 kyu veut dire quelque chose. */
const HUMAN_LEVELS = [
    { profile: 'rank_20k', label: '20 kyu — grand debutant', rating:  700 },
    { profile: 'rank_15k', label: '15 kyu — debutant',       rating: 1100 },
    { profile: 'rank_10k', label: '10 kyu — intermediaire',  rating: 1500 },
    { profile: 'rank_5k',  label: '5 kyu — confirme',        rating: 1900 },
    { profile: 'rank_1k',  label: '1 kyu — fort',            rating: 2200 },
    { profile: 'rank_5d',  label: '5 dan — expert',          rating: 2700 }
];
const HUMAN_RD = 90; // moins sur qu'un moteur : le rang imite est approximatif
// Assez de visites pour que le moteur propose toujours au moins un coup, meme
// si le pont ignore le profil humain. Reste rapide (~0,3 s par coup).
const HUMAN_FALLBACK_VISITS = 16;

let aiHumanProfile = null;    // null => moteur classique (recherche)
let bridgeVersionWarned = false;
let aiHandicap = 0;
let aiInitialStones = [];     // pierres de handicap, format GTP pour le moteur

/* Points de handicap : les hoshi, dans l'ordre conventionnel. Deux pierres se
   posent en diagonale, puis on complete les coins, puis les cotes, et le
   centre en dernier pour les nombres impairs. */
function handicapPoints(size, n) {
    if (n < 2) return [];
    const lo = size === 9 ? 2 : 3;             // 3-3 en 9x9, 4-4 au dela
    const hi = size - 1 - lo;
    const mid = (size - 1) / 2;
    if (!Number.isInteger(mid)) return [];     // plateau pair : pas de hoshi central

    const corners = [[lo, hi], [hi, lo], [hi, hi], [lo, lo]];      // {x, y}, y vers le bas
    const sides = [[lo, mid], [hi, mid], [mid, hi], [mid, lo]];
    const center = [mid, mid];

    const count = Math.max(2, Math.min(n, 9));
    const pts = corners.slice(0, Math.min(count, 4));
    if (count >= 6) pts.push(...sides.slice(0, count >= 8 ? 4 : 2));
    if (count % 2 === 1 && count >= 5) pts.push(center);

    return pts.slice(0, count).map(([x, y]) => ({ x, y }));
}

// La mise a jour du classement est centralisee dans updateMyRating (script.js),
// utilisee aussi bien contre KataGo qu'en multijoueur. KATAGO_RATINGS ci-dessus
// fournit la note de reference de l'adversaire quand c'est le moteur.

/* ========== Conversion de coordonnees ========== */
/* Valide par test exhaustif aller-retour sur les plateaux 9x9, 13x13 et 19x19. */

function boardToGtp(x, y, size) {
    return GTP_LETTERS[x] + (size - y);
}

function gtpToBoard(gtp, size) {
    if (typeof gtp !== "string") return null;
    const s = gtp.toUpperCase();
    if (s === "PASS") return "pass";
    if (s === "RESIGN") return "resign";
    // Regex stricte : un simple parseInt accepterait "K10x" en renvoyant 10.
    const m = /^([A-HJ-T])([0-9]{1,2})$/.exec(s);
    if (!m) return null;
    const x = GTP_LETTERS.indexOf(m[1]);
    const row = parseInt(m[2], 10);
    if (x < 0 || x >= size || row < 1 || row > size) return null;
    return { x, y: size - row };
}

/* ========== Faux gameRef local ========== */
/* Reproduit la petite portion de l'API Firebase que script.js utilise. */

class LocalGameRef {
    constructor(data) {
        this.data = data;
        this.listeners = [];
    }

    set(data) {
        this.data = data;
        this._emit();
        return Promise.resolve();
    }

    update(patch) {
        // On note qui vient de jouer AVANT d'appliquer le patch : a cet instant
        // currentPlayer designe encore l'auteur du coup (playMove et passTurn
        // transmettent le joueur suivant dans le patch sans toucher au global).
        const author = currentPlayer;
        if (patch.lastReason === "move" && patch.lastMove) {
            gtpMoves.push([
                author === 1 ? "B" : "W",
                boardToGtp(patch.lastMove.x, patch.lastMove.y, BOARD_SIZE)
            ]);
        } else if (patch.lastReason === "pass") {
            gtpMoves.push([author === 1 ? "B" : "W", "pass"]);
        }

        Object.assign(this.data, patch);
        this._emit();
        return Promise.resolve();
    }

    once() {
        return Promise.resolve({ val: () => this.data });
    }

    on(eventType, callback) {
        this.listeners.push(callback);
        this._emit();
        return callback;
    }

    // resetGame() appelle gameRef.off() sans argument : il faut alors tout retirer.
    off(eventType, callback) {
        if (!callback) this.listeners = [];
        else this.listeners = this.listeners.filter((cb) => cb !== callback);
    }

    _emit() {
        const snapshot = { val: () => this.data };
        this.listeners.forEach((cb) => cb(snapshot));
        // Le tour de l'IA est declenche apres le rendu, pas pendant.
        setTimeout(maybeAiMove, 30);
    }
}

/* ========== Boucle de l'IA ========== */

async function maybeAiMove() {
    if (!vsAI || gameOver || aiThinking) return;
    if (!localGameRef || localGameRef.data.status !== "playing") return;
    if (currentPlayer !== aiColor) return;

    aiThinking = true;
    setAiStatus(true);

    try {
        const response = await bridgeFetch("/genmove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                moves: gtpMoves,
                boardSize: BOARD_SIZE,
                komi: activeKomi,
                maxVisits: aiVisits,
                // Les pierres de handicap ne sont pas des coups joues : le
                // moteur les recoit a part, sinon l'alternance des couleurs
                // serait decalee de tout le handicap.
                initialStones: aiInitialStones,
                humanProfile: aiHumanProfile
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `bridge HTTP ${response.status}`);
        }

        const result = await response.json();

        /* On a demande un adversaire d'un rang donne et le pont a repondu sans
           l'appliquer : c'est une version anterieure, qui ignore humanProfile.
           Le joueur affronte alors le moteur a pleine force sous une etiquette
           « 15 kyu ». Il doit le savoir — et une seule fois, pas a chaque coup. */
        if (aiHumanProfile && !result.human && !bridgeVersionWarned) {
            bridgeVersionWarned = true;
            showMessage(gameMessage,
                "Ton moteur local est d'une version anterieure : il ignore le niveau " +
                "choisi et joue a pleine force. Relance le pont pour le mettre a jour.",
                "orange");
        }

        applyAiResult(result);
    } catch (e) {
        console.error("KataGo:", e);
        showMessage(
            gameMessage,
            "KataGo est injoignable. Le bridge local est-il lance ? (node server/bridge.js)",
            "red"
        );
    } finally {
        aiThinking = false;
        setAiStatus(false);
    }
}

function applyAiResult(result) {
    if (gameOver) return;

    /* Abandon : winrate renvoye du point de vue du joueur au trait, donc de l'IA.

       En partie a handicap, l'IA demarre structurellement perdue — c'est le
       principe meme du handicap. A 9 pierres elle s'estime a -108 points des le
       premier coup, et abandonnerait donc au coup 30 sans qu'on ait rien joue :
       une victoire creuse, qui n'apprend rien. Au go, le joueur fort joue au
       contraire la partie jusqu'au bout et compte sur les erreurs de l'autre.
       On repousse donc l'abandon a proportion des pierres rendues. */
    const resignMinMoves = AI_RESIGN_MIN_MOVES + (aiHandicap >= 2 ? aiHandicap * 20 : 0);
    if (
        typeof result.winrate === "number" &&
        result.winrate < AI_RESIGN_WINRATE &&
        gtpMoves.length >= resignMinMoves
    ) {
        const winner = aiColor === 1 ? "Blanc" : "Noir";
        saveGameToFirebase({
            gameOver: true,
            lastReason: `Le joueur ${winner} gagne par abandon.`,
            status: "finished"
        });
        return;
    }

    if (result.move === "pass" || result.move === "resign") {
        aiPass();
        return;
    }

    const point = gtpToBoard(result.move, BOARD_SIZE);
    if (!point || point === "pass" || point === "resign") {
        console.error("KataGo a renvoye un coup illisible :", result.move);
        aiPass();
        return;
    }

    aiPlaceStone(point.x, point.y, result);
}

/* Meme comptabilite que playMove(), mais pour la couleur de l'IA :
   playMove() refuse de jouer quand myColor !== currentPlayer. */
function aiPlaceStone(x, y, info) {
    if (board[y][x] !== 0) { aiPass(); return; }

    const result = placeStone(x, y, aiColor, board);
    if (result.error === "suicide") { aiPass(); return; }

    const newStateStr = boardToString(result.newState);
    if (history.includes(newStateStr)) { aiPass(); return; }

    playStoneSound();
    prisoners[aiColor === 1 ? "black" : "white"] += result.capturedStones;

    const timeUsed = timerLastMoveAtLocal ? Date.now() - timerLastMoveAtLocal : 0;
    const colorKey = aiColor === 1 ? "black" : "white";
    if (gameTimerInitialSec > 0) {
        localTimers[colorKey] = Math.max(0, localTimers[colorKey] - timeUsed);
    }

    const newMoves = [...moveList, { x, y, prisonersAfter: { ...prisoners } }];
    const nextPlayer = aiColor === 1 ? 2 : 1;
    const timerUpdate = gameTimerInitialSec > 0 ? {
        timers: { black: localTimers.black, white: localTimers.white },
        timerLastMoveAt: Date.now(),
        timerActivePlayer: nextPlayer
    } : {};

    saveGameToFirebase({
        board: result.newState,
        currentPlayer: nextPlayer,
        history: [...history, newStateStr],
        consecutivePasses: 0,
        lastReason: "move",
        lastMove: { x, y },
        prisoners: prisoners,
        moves: newMoves,
        ...timerUpdate
    });

    showAiEvaluation(info);
}

function aiPass() {
    const nextPasses = consecutivePasses + 1;
    const nextPlayer = aiColor === 1 ? 2 : 1;

    if (nextPasses >= 2) {
        const { black, white } = computeScore(board);
        let winnerMsg;
        if (black > white) winnerMsg = `Noir gagne avec ${(black - white).toFixed(1)} pts d'avance !`;
        else if (white > black) winnerMsg = `Blanc gagne avec ${(white - black).toFixed(1)} pts d'avance !`;
        else winnerMsg = "Partie nulle !";

        saveGameToFirebase({
            consecutivePasses: nextPasses,
            board: board,
            lastReason: `Double passe. ${winnerMsg}`,
            status: "finished"
        });
    } else {
        saveGameToFirebase({
            currentPlayer: nextPlayer,
            consecutivePasses: nextPasses,
            lastReason: "pass"
        });
    }
}

/* ========== Retour visuel ========== */

function setAiStatus(thinking) {
    const panel = aiColor === 1 ? blackPanel : whitePanel;
    if (panel) panel.classList.toggle("ai-thinking", thinking);
    if (thinking) showMessage(gameMessage, "KataGo reflechit...", "lightblue");
}

function showAiEvaluation(info) {
    if (!info || typeof info.winrate !== "number") return;
    // winrate est du point de vue de l'IA : on l'affiche du point de vue du joueur.
    const myWinrate = (1 - info.winrate) * 100;
    const lead = -info.scoreLead;
    const leadTxt = lead >= 0 ? `+${lead.toFixed(1)}` : lead.toFixed(1);
    const el = document.getElementById("aiEvalBar");
    if (el) {
        el.style.display = "block";
        el.textContent =
            `Vos chances : ${myWinrate.toFixed(1)} %  ·  ecart estime ${leadTxt}  ` +
            `·  ${info.visits} visites en ${(info.elapsedMs / 1000).toFixed(1)} s`;
    }
}

/* ========== Demarrage d'une partie contre KataGo ========== */

async function startKataGoGame() {
    // Aucun compte n'est requis : la partie est entierement locale. Les seules
    // ecritures Firebase sont les statistiques de fin de partie, et
    // updateMyStats() comme saveGameHistory() sortent deja tot si myUid est nul.
    if (!myNickname) myNickname = "Invite";

    // Verifier que le bridge repond avant d'ouvrir le plateau.
    try {
        const health = await bridgeFetch("/health").then((r) => r.json());
        if (!health.ok) {
            showMessage(lobbyMessage, "KataGo demarre encore (calibration OpenCL). Reessayez dans un instant.", "orange");
            return;
        }
    } catch (e) {
        showMessage(lobbyMessage, "Bridge KataGo injoignable. Lancez : node server/bridge.js", "red");
        return;
    }

    /* On LIT les reglages dans des variables locales, on ne les applique
       qu'apres resetGame(). Celui-ci remet aiHumanProfile et aiHandicap a zero
       pour ne pas laisser fuir la partie precedente : ecrire les reglages avant
       de l'appeler revenait a les effacer aussitot. La partie se jouait alors
       contre le moteur brut, sans handicap, quel que soit le menu. */
    const size = parseInt(document.getElementById("aiBoardSizeSelect").value);
    const humanColor = parseInt(document.getElementById("aiColorSelect").value);

    // Le selecteur porte soit un profil humain ("rank_10k"), soit un nombre de
    // visites : un seul menu, deux natures d'adversaire.
    const levelValue = document.getElementById("aiStrengthSelect").value;
    const humanLevel = HUMAN_LEVELS.find((l) => l.profile === levelValue);

    const handicapEl = document.getElementById("aiHandicapSelect");
    let handicap = handicapEl ? (parseInt(handicapEl.value, 10) || 0) : 0;
    // Le handicap se pose pour Noir ; il n'a de sens que si le joueur est Noir.
    if (humanColor !== 1) handicap = 0;

    stopBridgePolling();
    resetGame();
    updateBoardSize(size);

    // ---- A partir d'ici seulement, les reglages de CETTE partie ----
    aiColor = humanColor === 1 ? 2 : 1;
    aiHumanProfile = humanLevel ? humanLevel.profile : null;
    aiHandicap = handicap;
    /* Un adversaire humain choisit son coup dans la policy de son rang, pas par
       la recherche : une visite suffirait. Mais si le pont est d'une version
       anterieure, il ignore humanProfile et retombe sur la recherche — et a une
       seule visite KataGo ne developpe AUCUN coup, renvoie une liste vide, donc
       « pass ». L'IA passait alors a chaque tour pendant que le joueur
       remplissait le plateau tout seul. On garde donc de quoi produire un coup
       valable meme quand le pont ignore le profil. */
    aiVisits = humanLevel ? HUMAN_FALLBACK_VISITS : (parseInt(levelValue, 10) || 500);

    vsAI = true;
    gtpMoves = [];
    aiInitialStones = [];
    myColor = humanColor;
    gameId = "KATAGO";

    /* Handicap : Noir pose ses pierres avant le debut, puis c'est Blanc qui
       ouvre. Ces pierres ne passent pas par playMove() — elles ne capturent
       rien et ne sont pas des coups — d'ou la pose directe sur le plateau. */
    if (aiHandicap >= 2) {
        const pts = handicapPoints(size, aiHandicap);
        for (const p of pts) {
            board[p.y][p.x] = 1;
            aiInitialStones.push(["B", boardToGtp(p.x, p.y, size)]);
        }
        // Rendre 7,5 points a Blanc annulerait le handicap qu'on vient de poser.
        activeKomi = 0.5;
        currentPlayer = 2;
    } else {
        activeKomi = KOMI;
        currentPlayer = 1;
    }
    // Empeche setupChatListener() d'aller ouvrir un listener Firebase sur une
    // partie qui n'existe pas cote serveur.
    chatListener = function noChatInAiMode() {};

    // Un rang parle a un joueur ; « 500 visites » ne parle a personne.
    const aiName = humanLevel
        ? `KataGo — ${humanLevel.label.split(' — ')[0]}`
        : `KataGo (${aiVisits} visites)`;
    localGameRef = new LocalGameRef({
        status: "playing",
        players: {
            black: humanColor === 1
                ? { uid: myUid, nickname: myNickname }
                : { uid: "katago", nickname: aiName },
            white: humanColor === 2
                ? { uid: myUid, nickname: myNickname }
                : { uid: "katago", nickname: aiName }
        },
        board: board,
        currentPlayer: currentPlayer,
        history: [],
        moves: [],
        consecutivePasses: 0,
        boardSize: size,
        isPublic: false,
        timerInitialSec: 0,
        createdAt: Date.now()
    });
    gameRef = localGameRef;

    // L'annulation passe par une negociation Firebase entre deux joueurs :
    // sans second joueur humain, le bouton n'a pas de sens ici.
    const undoBtn = document.getElementById("undoBtn");
    if (undoBtn) undoBtn.style.display = "none";
    const chatBtn = document.getElementById("chatToggleBtn");
    if (chatBtn) chatBtn.style.display = "none";

    showScreen(gameScreen);
    setupGameListener();

    // Trace de ce qui part REELLEMENT au moteur. Le menu peut afficher « 20 kyu »
    // pendant que la partie se joue contre le moteur : cette ligne le montre.
    console.log('[KataGo] partie lancée —',
                'profil:', aiHumanProfile || 'aucun (moteur)',
                '· visites:', aiVisits,
                '· handicap:', aiHandicap,
                '· plateau:', size + 'x' + size,
                '· komi:', activeKomi);

    const who = humanLevel ? humanLevel.label : `KataGo (${aiVisits} visites)`;
    const hcap = aiHandicap >= 2 ? ` · handicap ${aiHandicap} pierres` : '';
    const turn = aiHandicap >= 2 ? 'KataGo ouvre.' : 'A vous de jouer.';
    showMessage(gameMessage, `${who} · ${size}x${size}${hcap}. ${turn}`, "lightgreen");

    // En handicap c'est Blanc (le moteur) qui commence : il faut l'amorcer,
    // sinon la partie attend un coup du joueur qui n'a pas le trait.
    if (aiHandicap >= 2 && aiColor === 2) setTimeout(maybeAiMove, 250);
}

/* Nettoyage : resetGame() est appele depuis plusieurs endroits de script.js,
   on s'y accroche pour eteindre proprement le mode IA. */
const _resetGameWithoutAi = resetGame;
resetGame = function () {
    vsAI = false;
    aiThinking = false;
    localGameRef = null;
    gtpMoves = [];
    aiInitialStones = [];
    aiHandicap = 0;
    aiHumanProfile = null;
    bridgeVersionWarned = false;   // reavertir si le pont perime sert la partie suivante
    const evalBar = document.getElementById("aiEvalBar");
    if (evalBar) evalBar.style.display = "none";
    const undoBtn = document.getElementById("undoBtn");
    if (undoBtn) undoBtn.style.display = "";
    const chatBtn = document.getElementById("chatToggleBtn");
    if (chatBtn) chatBtn.style.display = "";
    blackPanel.classList.remove("ai-thinking");
    whitePanel.classList.remove("ai-thinking");
    _resetGameWithoutAi();
};

/* ========== Detection du moteur local et aide a l'installation ========== */

const SITE_URL = "https://shazamifius.github.io/gogames";

const INSTALL_COMMANDS = {
    windows: {
        shell: "PowerShell",
        cmd: `irm ${SITE_URL}/install/install.ps1 | iex`,
        note: "Menu Démarrer → tapez « PowerShell » → collez la ligne → Entrée."
    },
    linux: {
        shell: "un terminal",
        cmd: `curl -fsSL ${SITE_URL}/install/install.sh | sh`,
        note: "Aucun prérequis : si Node.js manque, une version portable est installée dans le dossier du jeu."
    },
    mac: {
        shell: "un terminal",
        cmd: `curl -fsSL ${SITE_URL}/install/install.sh | sh`,
        note: "KataGo ne publie aucun binaire macOS : l'installation passe par Homebrew (brew.sh)."
    }
};

/* Depuis Chrome 142 (oct. 2025), Edge 143 et Firefox 153 (21 juil. 2026), une
   page d'origine publique qui joint une adresse loopback declenche une invite
   de permission « Local Network Access ». L'option targetAddressSpace annonce
   l'intention au navigateur : sans elle, la requete est rejetee au titre du
   contenu mixte AVANT meme que l'invite ne s'affiche.
   Les navigateurs qui ne la connaissent pas ignorent simplement l'option. */
function bridgeFetch(path, options) {
    return fetch(KATAGO_BRIDGE_URL + path, Object.assign({}, options, {
        targetAddressSpace: "loopback"
    }));
}

/* Safari ne propose aucune invite : il refuse purement et simplement le
   loopback depuis une page HTTPS (bug WebKit 171934, ouvert depuis 2017).
   Autant le dire clairement plutot que de laisser tourner un echec muet. */
function isSafari() {
    const ua = navigator.userAgent;
    return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
}

async function localNetworkPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return "unknown";
    // Chrome 145 a scinde la permission unique en deux ; l'ancien nom reste un
    // alias, mais on essaie le nom courant d'abord.
    for (const name of ["loopback-network", "local-network-access"]) {
        try {
            const status = await navigator.permissions.query({ name });
            if (status && status.state) return status.state;
        } catch (e) { /* nom inconnu de ce navigateur : on essaie le suivant */ }
    }
    return "unknown";
}

function detectPlatform() {
    // userAgentData est le mecanisme moderne ; userAgent reste le repli.
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    const ua = navigator.userAgent || "";
    const hay = (p + " " + ua).toLowerCase();
    if (hay.includes("win")) return "windows";
    if (hay.includes("mac") || hay.includes("iphone") || hay.includes("ipad")) return "mac";
    return "linux";
}

function showInstallFor(os) {
    const info = INSTALL_COMMANDS[os] || INSTALL_COMMANDS.linux;
    const cmdEl = document.getElementById("installCmd");
    const shellEl = document.getElementById("installShellName");
    const noteEl = document.getElementById("installNote");
    if (cmdEl) cmdEl.textContent = info.cmd;
    if (shellEl) shellEl.textContent = info.shell;
    if (noteEl) noteEl.textContent = info.note;
    document.querySelectorAll(".os-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.os === os);
    });
}

/* Les niveaux « joueur simule » n'existent que si le reseau humain est installe.
   On ne les affiche jamais sans lui : un menu qui annonce « 20 kyu » et envoie
   un joueur dan est pire que pas de menu du tout. */
function applyHumanAvailability(hasHuman) {
    const group = document.getElementById("humanLevelGroup");
    const hint = document.getElementById("strengthHint");
    const select = document.getElementById("aiStrengthSelect");
    if (group) group.style.display = hasHuman ? "" : "none";
    if (hint) {
        hint.innerHTML = hasHuman
            ? "Choisis un rang proche du tien : c'est en gagnant parfois qu'on progresse."
            : "Le moteur joue au niveau dan même à 100 visites. " +
              "<a href=\"#\" id=\"humanModelHelp\">Jouer contre un débutant ?</a>";
        wireHumanModelHelp();
    }
    // Premiere detection : on pousse le debutant vers un adversaire jouable
    // plutot que de le laisser sur le moteur par defaut.
    if (hasHuman && select && !select.dataset.userPicked) {
        select.value = "rank_15k";
    }
}

function wireHumanModelHelp() {
    const link = document.getElementById("humanModelHelp");
    if (!link || link.dataset.wired) return;
    link.dataset.wired = "1";
    link.addEventListener("click", (e) => {
        e.preventDefault();
        window.alert(
            "Pour jouer contre un vrai débutant\n\n" +
            "KataGo peut imiter un joueur d'un rang donné (20 kyu, 15 kyu…) au lieu\n" +
            "de chercher le meilleur coup. Il faut pour cela un second réseau (94 Mo).\n\n" +
            "Dans le dossier du jeu, lance :\n\n" +
            "    node server/get-human-model.js\n\n" +
            "puis relance le moteur :\n\n" +
            "    node server/bridge.js\n\n" +
            "Les niveaux 20 kyu à 5 dan apparaîtront alors dans ce menu."
        );
    });
}

function setBridgeStatus(state, text) {
    const box = document.getElementById("bridgeStatus");
    const label = document.getElementById("bridgeStatusText");
    const playBtn = document.getElementById("playKataGoBtn");
    const panel = document.getElementById("installPanel");
    if (box) box.className = "bridge-status " + state;
    if (label) label.textContent = text;
    if (playBtn) playBtn.disabled = state !== "ready";
    if (panel) panel.style.display = state === "ready" ? "none" : "block";
}

// Revérification automatique : pendant que le moteur calibre (plusieurs
// minutes au premier lancement), le site se re-teste tout seul et bascule au
// vert dès qu'il répond. L'utilisateur n'a rien à cliquer.
let bridgePollTimer = null;
function stopBridgePolling() {
    if (bridgePollTimer) { clearTimeout(bridgePollTimer); bridgePollTimer = null; }
}
function scheduleBridgePoll() {
    stopBridgePolling();
    bridgePollTimer = setTimeout(checkBridge, 4000);
}

async function checkBridge() {
    setBridgeStatus("checking", "Recherche du moteur…");
    try {
        // Un moteur absent doit se voir vite : sans borne, la requete peut
        // trainer plusieurs secondes avant d'echouer.
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await bridgeFetch("/health", { signal: ctrl.signal });
        clearTimeout(timer);
        const health = await res.json();
        applyHumanAvailability(Boolean(health.human));
        if (health.ok) {
            setBridgeStatus("ready", `Moteur prêt — ${health.engine}`);
            stopBridgePolling();
        } else {
            setBridgeStatus("starting", "Le moteur démarre (calibration GPU)…");
            scheduleBridgePoll();
        }
        return health.ok;
    } catch (e) {
        // Un echec ici a trois causes possibles, et les confondre laisserait
        // l'utilisateur relancer un moteur qui tourne deja tres bien.
        // Safari ne bloque QUE depuis une page HTTPS distante. Si l'on est deja
        // sur localhost, l'echec vient d'un moteur absent, pas du navigateur.
        // Blocages durs (Safari, permission refusée) : inutile de re-tester en
        // boucle, on arrête le sondage. Moteur simplement absent : on continue.
        if (isSafari() && !isLoopbackOrigin()) {
            setBridgeStatus("blocked",
                "Safari ne peut pas joindre le moteur depuis ce site. Installez le moteur, " +
                "puis ouvrez http://127.0.0.1:8081 dans Safari pour jouer.");
            stopBridgePolling();
            return false;
        }
        const perm = await localNetworkPermission();
        if (perm === "denied") {
            setBridgeStatus("blocked",
                "Accès au réseau local refusé. Autorisez-le via l'icône à gauche de l'adresse.");
            stopBridgePolling();
        } else {
            setBridgeStatus("absent", "Moteur non détecté — lancez le pont, la détection est automatique.");
            scheduleBridgePoll();
        }
        return false;
    }
}

/* ========== Mode invite ========== */
/* Une partie contre KataGo est entierement locale : exiger un compte Firebase
   n'apporte rien. On amene donc l'invite au lobby avec le multijoueur masque,
   ce qui reutilise l'encadre KataGo existant plutot que de dupliquer ses reglages. */

function enterGuestMode() {
    myUid = null;
    myNickname = "Invite";
    document.body.classList.add("guest-mode");
    playerInfo.textContent = "Invite — sans compte";
    logoutBtn.textContent = "Quitter";
    logoutBtn.style.display = "block";
    logoutBtn.onclick = exitGuestMode;
    showScreen(lobbyScreen);
    showMessage(lobbyMessage,
        "Mode invite : partie contre KataGo uniquement. Aucune statistique n'est enregistree.",
        "lightblue");
}

function exitGuestMode() {
    document.body.classList.remove("guest-mode");
    myNickname = null;
    playerInfo.textContent = "Non connecte";
    logoutBtn.textContent = "Deconnexion";
    logoutBtn.style.display = "none";
    // On rend la main au gestionnaire d'origine de script.js.
    logoutBtn.onclick = () => {
        auth.signOut()
            .then(() => showMessage(authMessage, "Deconnecte.", "lightgreen"))
            .catch((err) => showMessage(authMessage, err.message, "red"));
    };
    resetGame();
    showScreen(authScreen);
}

/* script.js appelle init() directement en fin de fichier, sans attendre
   DOMContentLoaded : on s'aligne, tout en restant correct si ce fichier venait
   a etre charge plus tot. */
function bindKataGoButton() {
    const btn = document.getElementById("playKataGoBtn");
    if (btn) btn.onclick = startKataGoGame;
    const guestBtn = document.getElementById("guestKataGoBtn");
    if (guestBtn) guestBtn.onclick = enterGuestMode;

    showInstallFor(detectPlatform());
    document.querySelectorAll(".os-tab").forEach((tab) => {
        tab.onclick = () => showInstallFor(tab.dataset.os);
    });

    const copyBtn = document.getElementById("copyInstallCmdBtn");
    if (copyBtn) copyBtn.onclick = () => {
        const cmd = document.getElementById("installCmd").textContent;
        copyToClipboard(cmd);
        copyBtn.textContent = "✓";
        setTimeout(() => { copyBtn.textContent = "⧉"; }, 1500);
    };

    const recheck = document.getElementById("recheckBridgeBtn");
    if (recheck) recheck.onclick = checkBridge;

    // Un choix explicite du joueur ne doit jamais etre ecrase par la selection
    // automatique du niveau debutant a la detection du reseau humain.
    const strength = document.getElementById("aiStrengthSelect");
    if (strength) strength.addEventListener("change", () => {
        strength.dataset.userPicked = "1";
    });

    // Le handicap ne se pose que pour Noir : le proposer a Blanc n'a pas de sens.
    const colorSel = document.getElementById("aiColorSelect");
    const hcapSel = document.getElementById("aiHandicapSelect");
    if (colorSel && hcapSel) {
        const syncHandicap = () => {
            const isBlack = colorSel.value === "1";
            hcapSel.disabled = !isBlack;
            if (!isBlack) hcapSel.value = "0";
            const group = hcapSel.closest(".form-group");
            if (group) group.style.opacity = isBlack ? "" : "0.5";
        };
        colorSel.addEventListener("change", syncHandicap);
        syncHandicap();
    }

    wireHumanModelHelp();
    checkBridge();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindKataGoButton);
} else {
    bindKataGoButton();
}
