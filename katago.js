/* =================================
   Mode "Jouer contre KataGo"
   Charge APRES script.js : reutilise ses fonctions et ses variables globales.

   Principe : au lieu d'ajouter des branchements "si IA" partout dans script.js,
   on remplace simplement gameRef par un faux ref local qui expose la meme API
   que Firebase. Du coup playMove(), passTurn(), resign(), setupGameListener()
   et endGame() fonctionnent tels quels, sans aucune modification, et le code
   multijoueur existant n'est pas touche.
================================= */

const KATAGO_BRIDGE_URL = "http://127.0.0.1:8081";
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
        const response = await fetch(KATAGO_BRIDGE_URL + "/genmove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                moves: gtpMoves,
                boardSize: BOARD_SIZE,
                komi: KOMI,
                maxVisits: aiVisits
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `bridge HTTP ${response.status}`);
        }

        const result = await response.json();
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

    // Abandon : winrate renvoye du point de vue du joueur au trait, donc de l'IA.
    if (
        typeof result.winrate === "number" &&
        result.winrate < AI_RESIGN_WINRATE &&
        gtpMoves.length >= AI_RESIGN_MIN_MOVES
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
    if (!auth.currentUser) {
        showMessage(lobbyMessage, "Connectez-vous d'abord.", "red");
        return;
    }

    // Verifier que le bridge repond avant d'ouvrir le plateau.
    try {
        const health = await fetch(KATAGO_BRIDGE_URL + "/health").then((r) => r.json());
        if (!health.ok) {
            showMessage(lobbyMessage, "KataGo demarre encore (calibration OpenCL). Reessayez dans un instant.", "orange");
            return;
        }
    } catch (e) {
        showMessage(lobbyMessage, "Bridge KataGo injoignable. Lancez : node server/bridge.js", "red");
        return;
    }

    const size = parseInt(document.getElementById("aiBoardSizeSelect").value);
    const humanColor = parseInt(document.getElementById("aiColorSelect").value);
    aiVisits = parseInt(document.getElementById("aiStrengthSelect").value);
    aiColor = humanColor === 1 ? 2 : 1;

    resetGame();
    updateBoardSize(size);

    vsAI = true;
    gtpMoves = [];
    myColor = humanColor;
    gameId = "KATAGO";
    // Empeche setupChatListener() d'aller ouvrir un listener Firebase sur une
    // partie qui n'existe pas cote serveur.
    chatListener = function noChatInAiMode() {};

    const aiName = `KataGo (${aiVisits} visites)`;
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
        currentPlayer: 1,
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
    showMessage(gameMessage, `Partie contre KataGo (${size}x${size}). A vous de jouer.`, "lightgreen");
}

/* Nettoyage : resetGame() est appele depuis plusieurs endroits de script.js,
   on s'y accroche pour eteindre proprement le mode IA. */
const _resetGameWithoutAi = resetGame;
resetGame = function () {
    vsAI = false;
    aiThinking = false;
    localGameRef = null;
    gtpMoves = [];
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

/* script.js appelle init() directement en fin de fichier, sans attendre
   DOMContentLoaded : on s'aligne, tout en restant correct si ce fichier venait
   a etre charge plus tot. */
function bindKataGoButton() {
    const btn = document.getElementById("playKataGoBtn");
    if (btn) btn.onclick = startKataGoGame;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindKataGoButton);
} else {
    bindKataGoButton();
}
