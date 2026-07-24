/* =================================
   Online Go Game - script.js
   Version avec Matchmaking, Spectateur et Tailles dynamiques
================================= */

/* ========== Firebase config & initialisation ========== */
const firebaseConfig = {
    apiKey: "AIzaSyBUHwlZP9skcvX4lYwtWzNkuoI2Gc5FqFg",
    authDomain: "gogame-6fcc9.firebaseapp.com",
    databaseURL: "https://gogame-6fcc9-default-rtdb.firebaseio.com",
    projectId: "gogame-6fcc9",
    storageBucket: "gogame-6fcc9.appspot.com",
    messagingSenderId: "489232590919",
    appId: "1:489232590919:web:ecc32c7aeeaffe7e9e2962",
    measurementId: "G-Q7XJMBB0WK"
};
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();
const auth = firebase.auth();

/* ========== Éléments du DOM ========== */
const authScreen = document.getElementById("authScreen");
const nicknameScreen = document.getElementById("nicknameScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const mainPageLink = document.getElementById("mainPageLink");
const logoutBtn = document.getElementById("logoutBtn");
const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const authMessage = document.getElementById("authMessage");
const nicknameInput = document.getElementById("nicknameInput");
const saveNicknameBtn = document.getElementById("saveNicknameBtn");
const nicknameMessage = document.getElementById("nicknameMessage");
const createGameBtn = document.getElementById("createGameBtn");
const joinGameBtn = document.getElementById("joinGameBtn");
const gameIdInput = document.getElementById("gameIdInput");
const gameLinkDisplay = document.getElementById("gameLinkDisplay");
const gameLinkSection = document.getElementById("gameLinkSection");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const lobbyMessage = document.getElementById("lobbyMessage");
const canvas = document.getElementById("goBoard");
const ctx = canvas.getContext("2d");
const boardWrapper = document.getElementById("boardWrapper");
const passButton = document.getElementById("passButton");
const forfeitButton = document.getElementById("forfeitButton");
const gameMessage = document.getElementById("gameStatus");
const playerInfo = document.getElementById("playerInfo");
const endGameOverlay = document.getElementById("endGameOverlay");
const endGameMessageEl = document.getElementById("endGameMessage");
const endGameCountdownEl = document.getElementById("endGameCountdown");

// Player panels
const blackPlayerNameEl = document.getElementById("blackPlayerName");
const whitePlayerNameEl = document.getElementById("whitePlayerName");
const blackCapturesEl = document.getElementById("blackCapturesText");
const whiteCapturesEl = document.getElementById("whiteCapturesText");
const blackTurnDot = document.getElementById("blackTurnDot");
const whiteTurnDot = document.getElementById("whiteTurnDot");
const blackPanel = document.getElementById("blackPanel");
const whitePanel = document.getElementById("whitePanel");

// Confirm move UI (mobile)
const confirmMoveUI = document.getElementById("confirmMoveUI");
const confirmMoveBtn = document.getElementById("confirmMoveBtn");
const cancelMoveBtn = document.getElementById("cancelMoveBtn");

// Resign modal
const resignModal = document.getElementById("resignModal");
const confirmResignBtn = document.getElementById("confirmResignBtn");
const cancelResignBtn = document.getElementById("cancelResignBtn");

const boardSizeSelect = document.getElementById("boardSizeSelect");
const publicGameCheckbox = document.getElementById("publicGameCheckbox");
const waitingGamesList = document.getElementById("waitingGamesList");
const activeGamesList = document.getElementById("activeGamesList");
const refreshListBtn = document.getElementById("refreshListBtn");
const publicGameNote = document.getElementById("publicGameNote");


/* ========== Variables d'état & Constantes ========== */
let BOARD_SIZE = 19;
const KOMI = 7.5;
let CELL_SIZE;
const BOARD_MARGIN = 30; // Espace pour les coordonnées

let board = [];
let history = [];
let currentPlayer = 1;
let myColor = null;
let myUid = null;
let myNickname = null;
let myStats = { wins: 0, losses: 0, totalPoints: 0, level: 1, currentXP: 0, gamesPlayed: 0,
    rating: 1500, ratingDeviation: 350, ratingVolatility: 0.06 };
let gameId = null;
let consecutivePasses = 0;
let gameOver = false;
let gameRef = null;
let hoverPoint = null;
let gameListener = null;
let moveInProgress = false;
// Vrai quand le même compte occupe les deux couleurs (partie créée puis
// rejointe soi-même, typiquement pour tester seul en deux fenêtres). On autorise
// alors à jouer les deux camps — mode « hot-seat ». Sans ça, la reconnexion du
// même compte retombe toujours sur Noir et Blanc devient injouable.
let ownBothSides = false;
let lastMove = null; // {x, y}
let prisoners = { black: 0, white: 0 };
let pendingMove = null; // {x, y} — coup en attente de confirmation (mobile)

// ========== Son (AudioContext) ==========
let _audioCtx = null;
function playStoneSound() {
    try {
        if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const sr = _audioCtx.sampleRate;
        const buf = _audioCtx.createBuffer(1, Math.floor(sr * 0.07), sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.5);
        }
        const src = _audioCtx.createBufferSource();
        src.buffer = buf;
        const bp = _audioCtx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.7;
        const gain = _audioCtx.createGain();
        gain.gain.value = 0.45;
        src.connect(bp); bp.connect(gain); gain.connect(_audioCtx.destination);
        src.start();
    } catch(e) {}
}

// ========== Timer ==========
let gameTimerInitialSec = 0;          // 0 = sans limite
let localTimers = { black: 0, white: 0 }; // millisecondes restantes
let timerLastMoveAtLocal = 0;
let timerInterval = null;

function formatTimer(ms) {
    if (ms <= 0) return '0:00';
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function updateTimerDisplay() {
    const bEl = document.getElementById('blackTimer');
    const wEl = document.getElementById('whiteTimer');
    if (!bEl || !wEl || gameTimerInitialSec === 0) return;
    const elapsed = timerLastMoveAtLocal ? Date.now() - timerLastMoveAtLocal : 0;
    let bMs = localTimers.black;
    let wMs = localTimers.white;
    if (!gameOver && elapsed > 0) {
        if (currentPlayer === 1) bMs = Math.max(0, bMs - elapsed);
        else                     wMs = Math.max(0, wMs - elapsed);
    }
    bEl.textContent = formatTimer(bMs);
    wEl.textContent = formatTimer(wMs);
    bEl.classList.toggle('low-time', bMs > 0 && bMs < 30000);
    wEl.classList.toggle('low-time', wMs > 0 && wMs < 30000);
    // Timeout : seul le joueur dont c'est le tour déclenche la fin
    if (!gameOver && !moveInProgress) {
        if (currentPlayer === 1 && bMs <= 0 && myColor === 1) {
            clearInterval(timerInterval);
            saveGameToFirebase({ lastReason: "Blanc gagne : Noir a dépassé le temps !", status: "finished" });
        } else if (currentPlayer === 2 && wMs <= 0 && myColor === 2) {
            clearInterval(timerInterval);
            saveGameToFirebase({ lastReason: "Noir gagne : Blanc a dépassé le temps !", status: "finished" });
        }
    }
}

function startTimerTick() {
    if (timerInterval) clearInterval(timerInterval);
    if (gameTimerInitialSec === 0) return;
    timerInterval = setInterval(updateTimerDisplay, 500);
}

function stopTimerTick() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ========== Numéros de coups ==========
let showMoveNumbers = false;
let moveList = []; // [{x, y}] dans l'ordre joué

function drawMoveNumbers() {
    if (!showMoveNumbers || !moveList || moveList.length === 0) return;
    const halfCell = CELL_SIZE / 2;
    const ox = BOARD_MARGIN + halfCell;
    const oy = BOARD_MARGIN + halfCell;
    ctx.font = `bold ${Math.floor(CELL_SIZE * 0.36)}px 'Outfit'`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    moveList.forEach(({ x, y }, i) => {
        if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return;
        if (!board[y] || board[y][x] === 0) return; // pierre capturée
        const cx = ox + x * CELL_SIZE;
        const cy = oy + y * CELL_SIZE;
        ctx.fillStyle = board[y][x] === 1 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
        ctx.fillText((i + 1).toString(), cx, cy);
    });
}

// ========== Chat ==========
let chatListener = null;

function setupChatListener() {
    if (!gameId) return;
    if (chatListener) db.ref(`games/${gameId}/chat`).off('child_added', chatListener);
    const chatEl = document.getElementById('chatMessages');
    if (!chatEl) return;
    chatEl.innerHTML = '';
    chatListener = db.ref(`games/${gameId}/chat`).limitToLast(60).on('child_added', snap => {
        const msg = snap.val();
        if (!msg) return;
        const div = document.createElement('div');
        const isSelf = msg.uid === myUid;
        const isSystem = msg.uid === 'system';
        if (isSystem) {
            div.className = 'chat-msg chat-msg-system';
            div.textContent = msg.text;
        } else {
            div.className = 'chat-msg' + (isSelf ? ' chat-msg-self' : '');
            // Le texte était déjà échappé, mais pas le pseudo de l'expéditeur.
            div.innerHTML = `<span class="chat-msg-name">${escapeHtml(msg.nickname)}:</span>${escapeHtml(msg.text)}`;
        }
        chatEl.appendChild(div);
        chatEl.scrollTop = chatEl.scrollHeight;
        // Badge non-lu si le chat est fermé
        const btn = document.getElementById('chatToggleBtn');
        const panel = document.getElementById('chatPanel');
        if (btn && panel && panel.style.display === 'none' && !isSelf) {
            btn.textContent = '💬●';
            btn.classList.add('active');
        }
    });
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    if (!input || !gameId) return;
    const text = input.value.trim();
    if (!text || text.length > 100) return;
    db.ref(`games/${gameId}/chat`).push({ uid: myUid, nickname: myNickname, text, ts: Date.now() });
    input.value = '';
}

function toggleChat() {
    const panel = document.getElementById('chatPanel');
    const btn = document.getElementById('chatToggleBtn');
    if (!panel) return;
    const open = panel.style.display === 'none';
    panel.style.display = open ? 'flex' : 'none';
    if (btn) {
        btn.textContent = '💬';
        btn.classList.toggle('active', open);
    }
    if (open) {
        const chatEl = document.getElementById('chatMessages');
        if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }
}

// ========== Annulation de coup (Undo) ==========
function requestUndo() {
    if (!gameRef || gameOver || moveList.length === 0 || myColor === 0) return;
    db.ref(`games/${gameId}/undoRequest`).set({ by: myUid, byNickname: myNickname, accepted: null });
    showMessage(gameMessage, "Demande d'annulation envoyée...", "lightblue");
}

function showUndoNotification(requesterNickname) {
    const notif = document.getElementById('undoNotification');
    const txt   = document.getElementById('undoNotificationText');
    if (!notif || !txt) return;
    txt.textContent = `${requesterNickname} demande l'annulation du dernier coup.`;
    notif.style.display = 'block';
}

function respondToUndo(accepted) {
    const notif = document.getElementById('undoNotification');
    if (notif) notif.style.display = 'none';
    if (!gameRef) return;
    if (accepted && history.length >= 1) {
        const newMoves     = moveList.slice(0, -1);
        const newHistory   = history.slice(0, -1);
        const prevBoard    = newHistory.length > 0
            ? JSON.parse(newHistory[newHistory.length - 1])
            : Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
        const prevPlayer   = currentPlayer === 1 ? 2 : 1;
        const restoredPrisoners = newMoves.length > 0
            ? (newMoves[newMoves.length - 1].prisonersAfter || { black: 0, white: 0 })
            : { black: 0, white: 0 };
        // Recalcul du timer : rendre le temps utilisé pour ce coup
        const timerUpdate = gameTimerInitialSec > 0 ? {
            timers: localTimers,
            timerLastMoveAt: Date.now(),
            timerActivePlayer: prevPlayer
        } : {};
        saveGameToFirebase({
            board: prevBoard,
            history: newHistory,
            currentPlayer: prevPlayer,
            consecutivePasses: 0,
            lastReason: "undo",
            lastMove: newMoves.length > 0 ? { x: newMoves[newMoves.length-1].x, y: newMoves[newMoves.length-1].y } : null,
            prisoners: restoredPrisoners,
            moves: newMoves,
            undoRequest: null,
            ...timerUpdate
        });
    } else {
        // Notifier le demandeur du refus (ou impossibilité) — il nettoiera lui-même
        db.ref(`games/${gameId}/undoRequest`).update({ accepted: false });
    }
}

// ========== Historique des parties ==========
async function saveGameHistory(result, opponentNickname, boardSz, ratingAfter) {
    if (!myUid || myColor === 0) return;
    try {
        // Entree d'historique. ratingAfter (classement apres la partie) et
        // moveCount alimenteront le graphe de progression et les statistiques.
        const entry = {
            date: Date.now(),
            result,          // 'win' | 'loss' | 'draw'
            opponent: opponentNickname || '?',
            boardSize: boardSz,
            gameId: String(gameId)
        };
        if (typeof ratingAfter === 'number') entry.ratingAfter = ratingAfter;
        if (Array.isArray(moveList)) entry.moveCount = Math.max(2, moveList.length);
        // Partie contre KataGo : on garde la force affrontee.
        if (typeof vsAI !== 'undefined' && vsAI && typeof aiVisits === 'number') {
            entry.aiVisits = aiVisits;
        }
        await db.ref(`users/${myUid}/history`).push(entry);
    } catch(e) { console.error("Erreur historique:", e); }
}

// ========== Viewport (Zoom / Pan) ==========
const viewport = { x: 0, y: 0, scale: 1, minScale: 1, maxScale: 5 };

function applyViewport() {
    canvas.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
}

function clampViewport() {
    // Ne pas laisser le plateau sortir du wrapper
    const ww = boardWrapper.offsetWidth;
    const wh = boardWrapper.offsetHeight;
    const scaledW = ww * viewport.scale;
    const scaledH = wh * viewport.scale;
    viewport.x = Math.min(0, Math.max(viewport.x, ww - scaledW));
    viewport.y = Math.min(0, Math.max(viewport.y, wh - scaledH));
}

function resetViewport() {
    viewport.x = 0;
    viewport.y = 0;
    viewport.scale = 1;
    applyViewport();
}

// Convertit des coordonnées écran (client) en coordonnées du plateau
function clientToBoard(clientX, clientY) {
    const wrapperRect = boardWrapper.getBoundingClientRect();
    const wx = clientX - wrapperRect.left;
    const wy = clientY - wrapperRect.top;
    // Inverse de la CSS transform (translate puis scale, origin 0,0)
    const cssX = (wx - viewport.x) / viewport.scale;
    const cssY = (wy - viewport.y) / viewport.scale;
    // CSS→résolution canvas (le canvas est width/height 100% du wrapper)
    const resX = canvas.width / wrapperRect.width;
    const resY = canvas.height / wrapperRect.height;
    const canvasX = cssX * resX;
    const canvasY = cssY * resY;
    const halfCell = CELL_SIZE / 2;
    return {
        x: Math.round((canvasX - BOARD_MARGIN - halfCell) / CELL_SIZE),
        y: Math.round((canvasY - BOARD_MARGIN - halfCell) / CELL_SIZE)
    };
}

// Sons (Base64 courtes pour ne pas dépendre de fichiers externes)
const soundClick = new Audio("data:audio/mp3;base64,//uQRAAAAWMSLwUIYAAsYkXgoQwAEaYLWfkWgAI0wWs/ItAAAG1xUAALD+AAXG1lQiNzY0E0UAAQAAgAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAg");
const soundStart = new Audio("data:audio/mp3;base64,//uQRAAAAWMSLwUIYAAsYkXgoQwAEaYLWfkWgAI0wWs/ItAAAG1xUAALD+AAXG1lQiNzY0E0UAAQAAgAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAgAAAAAAg");
// Note: Placeholder base64, real sounds would be better, but avoiding huge strings here. 
// Using silent placeholders to avoid breaking code if user doesn't strictly need high-def audio. 
// Actually, I will use a simple "beep" trick or just valid empty mp3s to not error out, 
// and rely on the fact that simple 'click' is better implemented via a VERY short url or just no sound if assets missing.
// Let's assume the user accepts "visual" perfection first. I'll put a real short 'pop' sound data uri if I can.
// Reverting to empty because valid base64 is long. I will implement the logic and leave a comment.

/* ========== WebRTC - Conservé pour l'initialisation ========== */
let peerConnection = null;
let dataChannel = null;
const iceServers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
function setupDataChannelLocal(channel) {
    dataChannel = channel;
    dataChannel.onmessage = e => {
        try { JSON.parse(e.data); }
        catch (err) { console.error("Message invalide sur le dataChannel", err); }
    };
    dataChannel.onopen = () => { showMessage(gameMessage, "Connexion établie (WebRTC).", "lightgreen"); };
    dataChannel.onclose = () => {
        showMessage(gameMessage, "Connexion WebRTC fermée — fallback à Firebase.", "orange");
        dataChannel = null;
    };
    dataChannel.onerror = err => console.error("Erreur DataChannel:", err);
}
function setupIceAndCandidates(isCreator) {
    const myCandidatesPath = isCreator ? "creatorCandidates" : "joinerCandidates";
    const opponentCandidatesPath = isCreator ? "joinerCandidates" : "creatorCandidates";
    peerConnection.onicecandidate = e => {
        if (e.candidate) {
            db.ref(`games/${gameId}/${myCandidatesPath}`).push(e.candidate).catch(console.error);
        }
    };
    const oppRef = db.ref(`games/${gameId}/${opponentCandidatesPath}`);
    oppRef.on("child_added", snap => {
        const cand = snap.val();
        if (cand) {
            peerConnection.addIceCandidate(new RTCIceCandidate(cand)).catch(err => console.error("addIceCandidate failed:", err));
        }
    });
}
async function startSignaling(isCreator) {
    peerConnection = new RTCPeerConnection(iceServers);
    setupIceAndCandidates(isCreator);
    if (isCreator) {
        const localChannel = peerConnection.createDataChannel("game");
        setupDataChannelLocal(localChannel);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await db.ref(`games/${gameId}`).update({ offer: offer }).catch(console.error);
        const answerRef = db.ref(`games/${gameId}/answer`);
        const answerListener = answerRef.on("value", async snap => {
            const ans = snap.val();
            if (ans && peerConnection && !peerConnection.remoteDescription) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(ans));
                answerRef.off("value", answerListener);
                showScreen(gameScreen);
                showMessage(gameMessage, "L'adversaire a rejoint ! La partie commence (WebRTC).", "lightgreen");
            }
        });
    } else {
        peerConnection.ondatachannel = e => setupDataChannelLocal(e.channel);
        const offerRef = db.ref(`games/${gameId}/offer`);
        const offerListener = offerRef.on("value", async snap => {
            const offer = snap.val();
            if (offer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                await db.ref(`games/${gameId}`).update({ answer: answer });
                offerRef.off("value", offerListener);
                showScreen(gameScreen);
                showMessage(gameMessage, "Partie rejointe ! En attente de coups (WebRTC).", "lightgreen");
            }
        });
    }
    peerConnection.onconnectionstatechange = () => {
        const s = peerConnection.connectionState;
        if (s === "failed" || s === "disconnected" || s === "closed") {
            console.warn("État PeerConnection:", s);
            showMessage(gameMessage, "Connexion WebRTC perdue — utilisation de Firebase comme fallback.", "orange");
        }
    };
}

/* ========== Fonctions Utilitaires & UI ========== */
function showScreen(screen) {
    [authScreen, nicknameScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
    screen.classList.add("active");
    // La modale « code de partie » ne doit jamais survivre a un changement d'ecran.
    if (gameLinkSection) gameLinkSection.classList.remove("visible");
    if (screen === lobbyScreen) {
        fetchPublicGames();
    }
    if (screen === gameScreen) {
        resetViewport();
        renderBoard();
    }
}
/* Échappe une valeur avant insertion dans du HTML.
   Les pseudos sont choisis librement par les joueurs et se retrouvent dans le
   lobby, le chat et l'historique : sans échappement, un pseudo comme
   <img src=x onerror=…> s'exécute chez tous ceux qui l'affichent. */
function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function showMessage(el, text, color = "#bbb") {
    el.innerText = text;
    el.style.color = color;
}

function updatePlayerInfoDisplay() {
    if (!myNickname) {
        playerInfo.innerHTML = "Non connecté";
        return;
    }
    const xpNeeded = myStats.level * 100;
    playerInfo.innerHTML = `
        <div class="profile-display">
            <span class="profile-name">${escapeHtml(myNickname)}</span>
            <div class="profile-stats">
                <span class="stat-badge rating-badge" title="Classement Glicko-2">◈ ${Math.round(myStats.rating || 1500)}</span>
                <span class="stat-badge level-badge">Niv. ${myStats.level}</span>
                <span class="stat-badge win-badge">🏆 ${myStats.wins}</span>
            </div>
            <div class="xp-bar-container" title="XP: ${Math.floor(myStats.currentXP)} / ${xpNeeded}">
                <div class="xp-bar-fill" style="width: ${(myStats.currentXP / xpNeeded) * 100}%"></div>
            </div>
        </div>
    `;
    // Refresh stats panel content if it's currently open
    const panel = document.getElementById('statsPanel');
    if (panel && panel.style.display !== 'none') {
        renderStatsPanelContent(panel);
    }
}

function renderStatsPanelContent(panel) {
    const xpNeeded = myStats.level * 100;
    const xpPct = Math.round((myStats.currentXP / xpNeeded) * 100);
    const rating = Math.round(myStats.rating || 1500);
    const rd = Math.round(myStats.ratingDeviation || 350);
    // RD élevé = note encore incertaine : on le dit clairement.
    const provisoire = rd > 150 ? ' <span class="rating-prov">(provisoire)</span>' : '';
    panel.innerHTML = `
        <div class="stats-panel-title">Profil joueur</div>
        <div class="stats-rating">
            <div class="stats-rating-value">◈ ${rating} <span class="stats-rating-rd">± ${rd}</span></div>
            <div class="stats-rating-label">Classement Glicko-2${provisoire}</div>
        </div>
        <div id="ratingChart" class="rating-chart"></div>
        <div class="stats-xp">
            <div class="stats-xp-label">
                <span>Niveau ${myStats.level}</span>
                <span>${Math.floor(myStats.currentXP)} / ${xpNeeded} XP</span>
            </div>
            <div class="xp-bar-container">
                <div class="xp-bar-fill" style="width: ${xpPct}%"></div>
            </div>
        </div>
        <div class="stats-row">
            <span class="stats-label">Victoires</span>
            <span class="stats-value green">🏆 ${myStats.wins}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">Défaites</span>
            <span class="stats-value red">✗ ${myStats.losses || 0}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">Parties jouées</span>
            <span class="stats-value">${myStats.gamesPlayed || 0}</span>
        </div>
        <div class="stats-row">
            <span class="stats-label">Points totaux</span>
            <span class="stats-value gold">★ ${Math.floor(myStats.totalPoints)}</span>
        </div>
        <div id="statsPanelHistory" class="stats-history-section">
            <div class="stats-panel-title" style="margin-top:12px;">Dernières parties</div>
            <p class="stats-label" style="font-size:0.72rem;">Chargement...</p>
        </div>
    `;
    // Charger l'historique de manière asynchrone
    if (myUid) {
        db.ref(`users/${myUid}/history`).limitToLast(30).once('value').then(snap => {
            const histSection = document.getElementById('statsPanelHistory');
            const chartEl = document.getElementById('ratingChart');

            // Ordre chronologique (le plus ancien en premier) pour la courbe.
            const chrono = [];
            snap.forEach(child => chrono.push(child.val()));
            renderRatingChart(chartEl, chrono);

            if (!histSection) return;
            const entries = chrono.slice(-5).reverse(); // 5 plus récentes, récent en premier
            if (entries.length === 0) {
                histSection.innerHTML = `
                    <div class="stats-panel-title" style="margin-top:12px;">Dernières parties</div>
                    <p class="stats-label" style="font-size:0.72rem;font-style:italic;">Aucune partie enregistrée.</p>`;
                return;
            }
            const rows = entries.map(e => {
                const icon = e.result === 'win' ? '🏆' : e.result === 'loss' ? '✗' : '—';
                const color = e.result === 'win' ? 'green' : e.result === 'loss' ? 'red' : '';
                const date = new Date(e.date).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
                return `<div class="stats-row">
                    <span class="stats-value ${color}" style="font-size:0.8rem;">${icon} vs ${escapeHtml(e.opponent || '?')}</span>
                    <span class="stats-label" style="font-size:0.72rem;">${e.boardSize}×${e.boardSize} · ${date}</span>
                </div>`;
            }).join('');
            histSection.innerHTML = `
                <div class="stats-panel-title" style="margin-top:12px;">Dernières parties</div>
                ${rows}`;
        }).catch(() => {});
    }
}

/* Courbe de progression du classement : une seule serie (ma note au fil des
   parties classees), donc pas de legende — le titre suffit. Ligne doree (accent
   du site) sur fond sombre, aire degradee, dernier point mis en valeur, repere
   au niveau de depart, et survol pour lire chaque point. */
function renderRatingChart(el, chrono) {
    if (!el) return;
    const pts = (chrono || [])
        .filter(e => e && typeof e.ratingAfter === 'number')
        .map(e => ({ r: e.ratingAfter, date: e.date, result: e.result }));

    if (pts.length < 2) {
        // On distingue « rien » de « une seule » pour ne pas laisser croire a un bug.
        const msg = pts.length === 1
            ? 'Encore une partie classée et ta courbe apparaît !'
            : 'Aucune partie classée pour l\'instant. Affronte KataGo (connecté) ou un ami : les parties contre toi-même (hot-seat) ne comptent pas.';
        el.innerHTML = '<p class="rating-chart-empty">' + msg + '</p>';
        return;
    }

    const W = 300, H = 120, padL = 8, padR = 8, padT = 22, padB = 18;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = pts.length;
    const ratings = pts.map(p => p.r);
    const minR = Math.min(...ratings), maxR = Math.max(...ratings);
    const range = maxR - minR;
    const pad = Math.max(12, range * 0.2);
    const lo = minR - pad, hi = maxR + pad;

    const x = i => padL + (n === 1 ? plotW / 2 : plotW * i / (n - 1));
    const y = r => padT + plotH * (1 - (r - lo) / (hi - lo));
    const base = padT + plotH;

    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
    const area = `M ${padL},${base} L ${pts.map((p, i) => `${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' L ')} L ${x(n - 1).toFixed(1)},${base} Z`;

    const startY = y(pts[0].r).toFixed(1);
    const delta = Math.round(pts[n - 1].r - pts[0].r);
    const deltaTxt = delta >= 0 ? `+${delta}` : `${delta}`;
    const deltaClass = delta >= 0 ? 'up' : 'down';
    const last = pts[n - 1];

    el.innerHTML = `
        <div class="rating-chart-head">
            <span class="rating-chart-title">Progression · ${n} partie${n > 1 ? 's' : ''} classée${n > 1 ? 's' : ''}</span>
            <span class="rating-chart-delta ${deltaClass}">${deltaTxt}</span>
        </div>
        <svg class="rating-chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
             aria-label="Courbe du classement : de ${Math.round(pts[0].r)} à ${Math.round(last.r)}">
            <defs>
                <linearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--primary-wood)" stop-opacity="0.28"/>
                    <stop offset="100%" stop-color="var(--primary-wood)" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <line class="rating-chart-baseline" x1="${padL}" y1="${startY}" x2="${W - padR}" y2="${startY}"/>
            <path class="rating-chart-area" d="${area}" fill="url(#ratingFill)"/>
            <polyline class="rating-chart-line" points="${line}"/>
            <circle class="rating-chart-end" cx="${x(n - 1).toFixed(1)}" cy="${y(last.r).toFixed(1)}" r="3.5"/>
            <g class="rating-chart-hover" style="display:none;">
                <line class="rating-chart-guide" y1="${padT}" y2="${base}"/>
                <circle class="rating-chart-dot" r="3.5"/>
            </g>
            <text class="rating-chart-max" x="${padL}" y="${padT - 8}">${Math.round(maxR)}</text>
            <text class="rating-chart-min" x="${padL}" y="${H - 6}">${Math.round(minR)}</text>
        </svg>
        <div class="rating-chart-tip" style="display:none;"></div>
    `;

    // Survol : point le plus proche horizontalement.
    const svg = el.querySelector('.rating-chart-svg');
    const hover = el.querySelector('.rating-chart-hover');
    const guide = el.querySelector('.rating-chart-guide');
    const dot = el.querySelector('.rating-chart-dot');
    const tip = el.querySelector('.rating-chart-tip');

    svg.addEventListener('mousemove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const i = Math.round(frac * (n - 1));
        const p = pts[i];
        const px = x(i), py = y(p.r);
        hover.style.display = '';
        guide.setAttribute('x1', px); guide.setAttribute('x2', px);
        dot.setAttribute('cx', px); dot.setAttribute('cy', py);
        const d = p.date ? new Date(p.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '';
        const icon = p.result === 'win' ? '🏆' : p.result === 'loss' ? '✗' : '—';
        tip.style.display = 'block';
        tip.textContent = `${Math.round(p.r)} · ${icon} ${d}`;
        tip.style.left = (frac * 100) + '%';
    });
    svg.addEventListener('mouseleave', () => {
        hover.style.display = 'none';
        tip.style.display = 'none';
    });
}

/* Met a jour ma note Glicko-2 apres une partie classee, contre la note (et
   l'incertitude) de l'adversaire. Ecrit dans Firebase et renvoie la nouvelle
   note arrondie, ou null si la partie n'est pas classee. */
function updateMyRating(result, oppRating, oppRD) {
    if (!myUid || myColor === 0 || typeof Glicko2 === 'undefined') return null;
    const score = result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    const current = {
        rating: myStats.rating || Glicko2.DEFAULT_RATING,
        rd: myStats.ratingDeviation || Glicko2.DEFAULT_RD,
        vol: myStats.ratingVolatility || Glicko2.DEFAULT_VOL
    };
    const next = Glicko2.update(current, [{ rating: oppRating, rd: oppRD, score }]);
    myStats.rating = next.rating;
    myStats.ratingDeviation = next.rd;
    myStats.ratingVolatility = next.vol;
    db.ref(`users/${myUid}`).update({
        rating: next.rating,
        ratingDeviation: next.rd,
        ratingVolatility: next.vol
    }).catch((e) => console.error('Sauvegarde classement :', e));
    updatePlayerInfoDisplay();
    return Math.round(next.rating);
}

function toggleStatsPanel() {
    if (!myNickname) return;
    const panel = document.getElementById('statsPanel');
    if (!panel) return;
    if (panel.style.display === 'none') {
        renderStatsPanelContent(panel);
        panel.style.display = 'block';
    } else {
        panel.style.display = 'none';
    }
}

// Ferme le panneau stats si on clique en dehors
document.addEventListener('click', e => {
    const panel = document.getElementById('statsPanel');
    const headerRight = document.querySelector('.header-right');
    if (panel && panel.style.display !== 'none' && headerRight && !headerRight.contains(e.target)) {
        panel.style.display = 'none';
    }
});

playerInfo.addEventListener('click', toggleStatsPanel);

async function updateMyStats(isWinner, points) {
    if (!myUid) return;

    // Gain d'XP : Simple (100 pour win, 25 pour défaite) + points du jeu
    let xpGain = isWinner ? 100 : 25;
    xpGain += Math.max(0, Math.floor(points / 2)); // 1 XP pour 2 points de territoire

    myStats.gamesPlayed = (myStats.gamesPlayed || 0) + 1;
    if (isWinner) myStats.wins = (myStats.wins || 0) + 1;
    else myStats.losses = (myStats.losses || 0) + 1;

    myStats.totalPoints = (myStats.totalPoints || 0) + points;
    myStats.currentXP = (myStats.currentXP || 0) + xpGain;

    // Level Up Loop
    let leveledUp = false;
    let xpNeeded = myStats.level * 100;
    while (myStats.currentXP >= xpNeeded) {
        myStats.currentXP -= xpNeeded;
        myStats.level++;
        xpNeeded = myStats.level * 100;
        leveledUp = true;
    }

    if (leveledUp) {
        showMessage(gameMessage, `Niveau Supérieur ! Vous êtes maintenant niveau ${myStats.level} !`, "gold");
        // Petit effet confetti supplémentaire pour le level up ?
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 }, colors: ['#FFD700', '#FFA500'] });
    }

    updatePlayerInfoDisplay();

    try {
        await db.ref(`users/${myUid}`).update({
            wins: myStats.wins,
            losses: myStats.losses,
            totalPoints: myStats.totalPoints,
            level: myStats.level,
            currentXP: myStats.currentXP,
            gamesPlayed: myStats.gamesPlayed
        });
    } catch (e) {
        console.error("Erreur sauvegarde stats:", e);
    }
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => showMessage(lobbyMessage, "Code de la partie copié !", "lightgreen"))
        .catch(err => {
            console.error("Erreur de copie :", err);
            showMessage(lobbyMessage, "Impossible de copier. Veuillez le faire manuellement.", "orange");
        });
}

function updateBoardSize(size) {
    BOARD_SIZE = parseInt(size);
    // Canvas est toujours 600×600 en résolution interne ; CSS gère l'affichage
    CELL_SIZE = (canvas.width - 2 * BOARD_MARGIN) / BOARD_SIZE;
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
}

function getNeighbors(x, y) {
    return [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE);
}
function getChain(x, y, color, visited, state) {
    const chain = [];
    const stack = [[x, y]];
    visited.add(`${x},${y}`);
    while (stack.length) {
        const [cx, cy] = stack.pop();
        chain.push([cx, cy]);
        for (let [nx, ny] of getNeighbors(cx, cy)) {
            if (!visited.has(`${nx},${ny}`) && state[ny][nx] === color) {
                visited.add(`${nx},${ny}`);
                stack.push([nx, ny]);
            }
        }
    }
    return chain;
}
function getLiberties(chain, state) {
    const libs = new Set();
    for (let [x, y] of chain) {
        for (let [nx, ny] of getNeighbors(x, y)) if (state[ny][nx] === 0) libs.add(`${nx},${ny}`);
    }
    return libs.size;
}
function copyBoard(state) {
    return state.map(r => [...r]);
}
function boardToString(state) {
    return JSON.stringify(state);
}

/* ========== Logique du jeu & règles ========== */
function computeScore(state) {
    let black = 0, white = 0;
    const visited = new Set();
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (state[y][x] === 1) black++;
            else if (state[y][x] === 2) white++;
            else if (state[y][x] === 0 && !visited.has(`${x},${y}`)) {
                const queue = [[x, y]];
                const territory = [];
                const borders = new Set();
                visited.add(`${x},${y}`);
                while (queue.length) {
                    const [cx, cy] = queue.pop();
                    territory.push([cx, cy]);
                    for (let [nx, ny] of getNeighbors(cx, cy)) {
                        if (state[ny][nx] === 0 && !visited.has(`${nx},${ny}`)) { visited.add(`${nx},${ny}`); queue.push([nx, ny]); }
                        else if (state[ny][nx] !== 0) borders.add(state[ny][nx]);
                    }
                }
                if (borders.size === 1) {
                    const owner = [...borders][0];
                    if (owner === 1) black += territory.length;
                    else if (owner === 2) white += territory.length;
                }
            }
        }
    }
    white += KOMI;
    return { black, white };
}
function updateScore() {
    const { black, white } = computeScore(board);
    const bCap = prisoners.black;
    const wCap = prisoners.white;
    if (blackCapturesEl) blackCapturesEl.textContent =
        `${bCap} cap. · ~${Math.floor(black)} pts`;
    if (whiteCapturesEl) whiteCapturesEl.textContent =
        `${wCap} cap. · ~${white.toFixed(1)} pts (komi ${KOMI})`;
}

function updatePlayerPanels(gameData) {
    if (!gameData || !gameData.players) return;
    const blackNick = gameData.players.black ? gameData.players.black.nickname : "Noir";
    const whiteNick = gameData.players.white ? gameData.players.white.nickname : "En attente...";
    if (blackPlayerNameEl) blackPlayerNameEl.textContent = blackNick;
    if (whitePlayerNameEl) whitePlayerNameEl.textContent = whiteNick;
}

function updateTurnIndicators() {
    if (!blackTurnDot || !whiteTurnDot) return;
    if (gameOver || myColor === 0) {
        blackTurnDot.classList.remove('active');
        whiteTurnDot.classList.remove('active');
        blackPanel.classList.remove('active-turn');
        whitePanel.classList.remove('active-turn');
        return;
    }
    if (currentPlayer === 1) {
        blackTurnDot.classList.add('active');
        whiteTurnDot.classList.remove('active');
        blackPanel.classList.add('active-turn');
        whitePanel.classList.remove('active-turn');
    } else {
        whiteTurnDot.classList.add('active');
        blackTurnDot.classList.remove('active');
        whitePanel.classList.add('active-turn');
        blackPanel.classList.remove('active-turn');
    }
}
function canPlay(playerColor, boardState) {
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (isLegalMove(x, y, playerColor, boardState)) return true;
        }
    }
    return false;
}

// Fonction utilitaire pour simuler un coup et obtenir le nouvel état
function placeStone(x, y, color, state) {
    const newState = copyBoard(state);
    newState[y][x] = color;
    const opponent = color === 1 ? 2 : 1;
    let capturedStones = 0;

    for (let [nx, ny] of getNeighbors(x, y)) {
        if (newState[ny][nx] === opponent) {
            const chain = getChain(nx, ny, opponent, new Set(), newState);
            if (getLiberties(chain, newState) === 0) {
                capturedStones += chain.length;
                chain.forEach(([cx, cy]) => (newState[cy][cx] = 0));
            }
        }
    }

    // Vérification suicide
    const myChain = getChain(x, y, color, new Set(), newState);
    if (getLiberties(myChain, newState) === 0) {
        return { error: "suicide" };
    }

    return { newState, capturedStones };
}

function isLegalMove(x, y, color, state) {
    if (state[y][x] !== 0) { showMessage(gameMessage, "Cette case est déjà prise.", "orange"); return false; }

    const result = placeStone(x, y, color, state);
    if (result.error === "suicide") {
        showMessage(gameMessage, "Les coups suicides ne sont pas autorisés.", "orange");
        return false;
    }

    const newStateStr = boardToString(result.newState);
    if (history.includes(newStateStr)) { showMessage(gameMessage, "Violation de la règle du Superko.", "orange"); return false; }

    return true;
}

function playMove(x, y) {
    if (gameOver || moveInProgress) return;
    if (myColor === 0) { showMessage(gameMessage, "Mode Spectateur : Vous ne pouvez pas jouer.", "orange"); return; }
    if (myColor !== currentPlayer && !ownBothSides) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }

    // On vérifie d'abord la légalité
    if (board[y][x] !== 0) { showMessage(gameMessage, "Cette case est déjà prise.", "orange"); return; }

    const result = placeStone(x, y, currentPlayer, board);
    if (result.error === "suicide") {
        showMessage(gameMessage, "Les coups suicides ne sont pas autorisés.", "orange");
        return;
    }

    const newStateStr = boardToString(result.newState);
    if (history.includes(newStateStr)) {
        showMessage(gameMessage, "Violation de la règle du Superko.", "orange");
        return;
    }

    // Si on arrive ici, le coup est valide
    moveInProgress = true;
    playStoneSound();

    // Mise à jour des prisonniers
    prisoners[currentPlayer === 1 ? 'black' : 'white'] += result.capturedStones;

    // Calcul du temps utilisé pour ce coup
    const timeUsed = timerLastMoveAtLocal ? Date.now() - timerLastMoveAtLocal : 0;
    const colorKey = currentPlayer === 1 ? 'black' : 'white';
    if (gameTimerInitialSec > 0) {
        localTimers[colorKey] = Math.max(0, localTimers[colorKey] - timeUsed);
    }

    const newMove = { x, y, prisonersAfter: { ...prisoners } };
    const newMoves = [...moveList, newMove];
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
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
}

function passTurn() {
    if (gameOver || moveInProgress) return;
    if (myColor === 0) return; // Spectator
    if (myColor !== currentPlayer && !ownBothSides) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }
    moveInProgress = true;
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    const nextPasses = consecutivePasses + 1;

    if (nextPasses >= 2) {
        const { black, white } = computeScore(board);
        let winnerMsg;
        if (black > white) {
            winnerMsg = `Noir gagne avec ${(black - white).toFixed(1)} pts d'avance !`;
        } else if (white > black) {
            winnerMsg = `Blanc gagne avec ${(white - black).toFixed(1)} pts d'avance !`;
        } else {
            winnerMsg = "Partie nulle !";
        }
        const endReason = `Double passe. ${winnerMsg}`;
        saveGameToFirebase({
            consecutivePasses: nextPasses,
            board: board,
            lastReason: endReason,
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

function resign() {
    if (gameOver || !gameRef || moveInProgress) return;
    if (myColor === 0) return; // Spectator
    moveInProgress = true;

    // L'autre joueur gagne
    const winner = myColor === 1 ? "Blanc" : "Noir";
    const message = `Le joueur ${winner} gagne par abandon.`;

    saveGameToFirebase({
        gameOver: true,
        lastReason: message,
        status: "finished"
    });
}



function animateWin(winnerNickname, message, winnerColor) {
    endGameOverlay.classList.add("active");
    endGameMessageEl.textContent = message || `${winnerNickname} a gagné !`;

    // Confettis uniquement pour le joueur gagnant (comparaison par couleur, pas par pseudo)
    const iAmWinner = winnerColor !== 0 && myColor === winnerColor;
    if (iAmWinner) {
        const duration = 5 * 1000;
        const end = Date.now() + duration;

        (function frame() {
            confetti({
                particleCount: 2,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
            });
            confetti({
                particleCount: 2,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    }

    let countdown = 5;
    endGameCountdownEl.textContent = `Retour au menu dans ${countdown} secondes...`;

    const countdownInterval = setInterval(() => {
        countdown--;
        if (countdown > 0) {
            endGameCountdownEl.textContent = `Retour au menu dans ${countdown} secondes...`;
        } else {
            clearInterval(countdownInterval);
            endGameOverlay.classList.remove("active");
            resetGame();
            showScreen(lobbyScreen);
            showMessage(lobbyMessage, "La partie est terminée.", "green");
        }
    }, 1000);
}

async function endGame(message) {
    if (gameOver) return;
    gameOver = true;

    try {
        const snapshot = await gameRef.once("value");
        const gameData = snapshot.val();

        if (!gameData || !gameData.players) {
            resetGame();
            showScreen(lobbyScreen);
            return;
        }

        const blackNickname = gameData.players.black ? gameData.players.black.nickname : "Joueur Noir";
        const whiteNickname = gameData.players.white ? gameData.players.white.nickname : "Joueur Blanc";

        let winnerNickname = "";
        let winnerColor = 0; // 0 = nul, 1 = noir, 2 = blanc
        let finalMessage = "";

        // Logique de détermination du message final
        if (message && message.includes("gagne par abandon")) {
            winnerColor = message.includes("Blanc") ? 2 : 1;
            winnerNickname = winnerColor === 2 ? whiteNickname : blackNickname;
            finalMessage = message;

        } else if (message && message.includes("Double passe")) {
            finalMessage = message;
            if (message.includes("Noir gagne")) { winnerColor = 1; winnerNickname = blackNickname; }
            else if (message.includes("Blanc gagne")) { winnerColor = 2; winnerNickname = whiteNickname; }

        } else {
            const { black, white } = computeScore(board);
            if (black > white) {
                winnerColor = 1;
                winnerNickname = blackNickname;
                finalMessage = `${winnerNickname} gagne avec ${(black - white).toFixed(1)} points d’avance !`;
            } else if (white > black) {
                winnerColor = 2;
                winnerNickname = whiteNickname;
                finalMessage = `${winnerNickname} gagne avec ${(white - black).toFixed(1)} points d’avance !`;
            } else {
                finalMessage = "La partie est nulle !";
            }
        }

        animateWin(winnerNickname, finalMessage, winnerColor);

        passButton.disabled = true;
        forfeitButton.disabled = true;
        stopTimerTick();
        updateTurnIndicators();

        // Revanche — visible pour les joueurs (pas les spectateurs)
        if (myColor === 1 || myColor === 2) {
            const rematchBtn = document.getElementById('rematchBtn');
            if (rematchBtn) rematchBtn.style.display = 'inline-block';
        }

        // Analyse — dès qu'il y a assez de coups (nécessite le moteur local).
        const analyzeBtn = document.getElementById('analyzeGameBtn');
        if (analyzeBtn && Array.isArray(moveList) && moveList.length >= 2) {
            analyzeBtn.style.display = 'inline-block';
        }

        // Mise à jour des stats + historique si on est un joueur — mais JAMAIS
        // en hot-seat : jouer les deux camps contre soi-même ne doit compter ni
        // en victoire/défaite, ni au classement, ni dans l'historique (sinon on
        // gonfle artificiellement son palmarès en testant tout seul).
        if ((myColor === 1 || myColor === 2) && !ownBothSides) {
            const { black, white } = computeScore(board);
            let myScore = (myColor === 1) ? black : white;
            const isWinner = myColor === winnerColor;
            if (isWinner && message && message.includes("gagne par abandon")) {
                myScore += 20;
            }
            updateMyStats(isWinner, myScore);
            const opponentNickname = myColor === 1 ? whiteNickname : blackNickname;
            const result = winnerColor === 0 ? 'draw' : (isWinner ? 'win' : 'loss');
            // Classement Glicko-2. Contre KataGo : note de reference selon la
            // force. En multijoueur : note de depart de l'adversaire, enregistree
            // dans la partie a la creation / jonction.
            let ratingAfter;
            if (typeof vsAI !== 'undefined' && vsAI) {
                const opp = (typeof KATAGO_RATINGS !== 'undefined' && KATAGO_RATINGS[aiVisits]) || { rating: 2600, rd: 80 };
                ratingAfter = updateMyRating(result, opp.rating, opp.rd);
            } else {
                const oppColor = myColor === 1 ? 'white' : 'black';
                const oppData = (gameData.players && gameData.players[oppColor]) || {};
                const oppRating = typeof oppData.rating === 'number' ? oppData.rating : 1500;
                ratingAfter = updateMyRating(result, oppRating, 80);
            }
            saveGameHistory(result, opponentNickname, BOARD_SIZE, ratingAfter);
        }

    } catch (err) {
        console.error("Erreur dans endGame:", err);
        // En cas d'erreur, on ramène simplement au lobby
        resetGame();
        showScreen(lobbyScreen);
        showMessage(lobbyMessage, "Une erreur est survenue lors de la fin de partie.", "red");
    }
}



async function saveGameToFirebase(dataToUpdate) {
    if (!gameRef || !gameId) return;
    try {
        await gameRef.update({
            lastUpdateBy: myUid || "unknown",
            lastUpdateAt: Date.now(),
            status: gameOver ? "finished" : "playing",
            ...dataToUpdate
        });
    } catch (err) {
        console.error("Erreur de sauvegarde Firebase:", err);
        moveInProgress = false;
    }
}
async function generateGameId() {
    let newId, isUnique = false;
    while (!isUnique) {
        newId = Math.floor(1000 + Math.random() * 9000);
        const snapshot = await db.ref(`games/${newId}`).once('value');
        if (!snapshot.exists()) {
            isUnique = true;
        }
    }
    return newId.toString();
}
async function cleanUpOldGames() {
    const FORTY_TWO_HOURS = 42 * 60 * 60 * 1000;
    const cutoff = Date.now() - FORTY_TWO_HOURS;
    const cutoffDate = new Date(cutoff).toLocaleString('fr-FR');
    const authUser = auth.currentUser;
    console.log(`%c[Cleanup] Démarrage — seuil: ${cutoffDate} — uid: ${authUser ? authUser.uid : 'NON CONNECTÉ'}`, 'color: #c5a065');

    try {
        const snapshot = await db.ref('games').once('value');

        if (!snapshot.exists()) {
            console.log('[Cleanup] Aucune partie en base.');
            return;
        }

        const toDelete = [];
        snapshot.forEach(snap => {
            const g = snap.val();
            const createdAt = g.createdAt || 0;
            const lastUpdateAt = g.lastUpdateAt || 0;
            const ageCreated = ((Date.now() - createdAt) / 3600000).toFixed(0);
            const ageUpdated = lastUpdateAt ? ((Date.now() - lastUpdateAt) / 3600000).toFixed(0) : 'N/A';
            const shouldDelete = createdAt > 0 && createdAt < cutoff;
            console.log(
                `[Cleanup] Partie ${snap.key}: créé il y a ${ageCreated}h, màj il y a ${ageUpdated}h (status: ${g.status}) → ${shouldDelete ? '🗑 à supprimer' : '✓ garde'}`,
                shouldDelete ? 'color: #ff5252' : 'color: #aaa', ''
            );
            if (shouldDelete) toDelete.push({ key: snap.key, createdAt });
        });

        console.log(`[Cleanup] ${toDelete.length} à supprimer sur ${snapshot.numChildren()} total.`);

        let deleted = 0, blocked = 0;
        for (const { key, createdAt } of toDelete) {
            console.log(`[Cleanup] Tentative suppression ${key} (createdAt=${createdAt}, seuil=${cutoff}, delta=${cutoff - createdAt}ms)...`);
            try {
                await db.ref(`games/${key}`).set(null);
                deleted++;
                console.log(`%c[Cleanup] ✓ Partie ${key} supprimée`, 'color: #4caf50');
            } catch (err) {
                blocked++;
                console.error(`[Cleanup] ✗ Partie ${key} BLOQUÉE — code: ${err.code} — msg: ${err.message}`);
                // Vérifier si la partie existe encore
                const check = await db.ref(`games/${key}`).once('value');
                console.log(`[Cleanup]   ↳ La partie existe encore: ${check.exists()}`);
            }
        }

        console.log(`%c[Cleanup] Terminé: ${deleted} supprimée(s), ${blocked} bloquée(s)`, 'color: #c5a065; font-weight: bold');

    } catch (err) {
        console.error('[Cleanup] Erreur fatale:', err.code, err.message);
    }
}

// Expose dans la console du navigateur pour tests manuels
window.goCleanup = cleanUpOldGames;


/* ========== Gestion du Canvas (Dessin et Événements) ========== */
function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dessin du fond (déjà fait par CSS, mais on peut ajouter une teinte si besoin)

    ctx.strokeStyle = "#5d5d5a"; // Couleur des lignes (Pierre/Encre)
    ctx.lineWidth = 1;

    const halfCell = CELL_SIZE / 2;
    const offsetX = BOARD_MARGIN + halfCell;
    const offsetY = BOARD_MARGIN + halfCell;

    ctx.beginPath();
    // Lignes verticales
    for (let i = 0; i < BOARD_SIZE; i++) {
        ctx.moveTo(offsetX + i * CELL_SIZE, offsetY);
        ctx.lineTo(offsetX + i * CELL_SIZE, offsetY + (BOARD_SIZE - 1) * CELL_SIZE);
    }
    // Lignes horizontales
    for (let i = 0; i < BOARD_SIZE; i++) {
        ctx.moveTo(offsetX, offsetY + i * CELL_SIZE);
        ctx.lineTo(offsetX + (BOARD_SIZE - 1) * CELL_SIZE, offsetY + i * CELL_SIZE);
    }
    ctx.stroke();

    // Etoiles (Hoshi)
    let starPoints = [];
    if (BOARD_SIZE === 19) starPoints = [3, 9, 15];
    else if (BOARD_SIZE === 13) starPoints = [3, 6, 9];
    else if (BOARD_SIZE === 9) starPoints = [2, 4, 6];

    starPoints.forEach(x => starPoints.forEach(y => {
        ctx.beginPath();
        ctx.arc(offsetX + x * CELL_SIZE, offsetY + y * CELL_SIZE, 3, 0, 2 * Math.PI);
        ctx.fillStyle = "#5d5d5a";
        ctx.fill();
    }));

    // Coordonnées (1-19, A-T sans I)
    ctx.fillStyle = "#d4af37"; // Couleur Or pour le thème sombre
    ctx.font = "12px 'Outfit'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const letters = "ABCDEFGHJKLMNOPQRST".split(""); // Pas de I

    for (let i = 0; i < BOARD_SIZE; i++) {
        // Chiffres (Gauche et Droite) - Inversés pour le Go (1 en bas) habituellement, 
        // mais ici on garde 1 en haut par simplicité standard array, ou on inverse pour faire "Pro".
        // Standard Go : 1 en bas. On va rester simple : 1 en haut correspond à l'index 0.
        // Si on veut faire "Pro", 19 est en haut (index 0).
        // Faisons le mapping : Index 0 -> 1 (ou 19).
        // Pour ne pas embrouiller l'utilisateur qui clique sur (0,0), affichons 1.

        let numLabel = (i + 1).toString();

        // Gauche
        ctx.fillText(numLabel, BOARD_MARGIN / 2, offsetY + i * CELL_SIZE);
        // Droite
        ctx.fillText(numLabel, canvas.width - BOARD_MARGIN / 2, offsetY + i * CELL_SIZE);

        // Lettres (Haut et Bas)
        let charLabel = letters[i] || "";
        // Haut
        ctx.fillText(charLabel, offsetX + i * CELL_SIZE, BOARD_MARGIN / 2);
        // Bas
        ctx.fillText(charLabel, offsetX + i * CELL_SIZE, canvas.height - BOARD_MARGIN / 2);
    }
}
function drawStones() {
    const halfCell = CELL_SIZE / 2;
    const offsetX = BOARD_MARGIN + halfCell;
    const offsetY = BOARD_MARGIN + halfCell;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 || board[y][x] === 2) {
                const cx = offsetX + x * CELL_SIZE;
                const cy = offsetY + y * CELL_SIZE;
                const radius = CELL_SIZE / 2.15;

                // Ombre portée réaliste
                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = radius / 2;
                ctx.shadowOffsetX = radius / 5;
                ctx.shadowOffsetY = radius / 5;

                ctx.beginPath();
                ctx.arc(cx, cy, radius, 0, 2 * Math.PI);

                if (board[y][x] === 1) {
                    // Pierre Noire (Slate) - Mat avec léger reflet diffus
                    const grad = ctx.createRadialGradient(cx - radius / 3, cy - radius / 3, radius / 10, cx, cy, radius);
                    grad.addColorStop(0, "#444"); // Reflet
                    grad.addColorStop(0.3, "#000"); // Corps
                    grad.addColorStop(1, "#000");   // Bord
                    ctx.fillStyle = grad;
                } else {
                    // Pierre Blanche (Shell) - Brillante/Nacrée
                    const grad = ctx.createRadialGradient(cx - radius / 3, cy - radius / 3, radius / 5, cx, cy, radius);
                    grad.addColorStop(0, "#fff"); // Highlight puissant
                    grad.addColorStop(0.1, "#fff");
                    grad.addColorStop(0.9, "#ddd"); // Corps nacré
                    grad.addColorStop(1, "#bbb");   // Bord ombré
                    ctx.fillStyle = grad;
                }
                ctx.fill();

                // Reset Ombre pour ne pas polluer les autres dessins
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                // Marqueur dernier coup (subtil point coloré pour contraste)
                if (lastMove && lastMove.x === x && lastMove.y === y) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, radius / 4, 0, 2 * Math.PI);
                    if (board[y][x] === 1) {
                        ctx.fillStyle = "rgba(255, 255, 255, 0.4)"; // Blanc transp sur noir
                        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
                    } else {
                        ctx.fillStyle = "rgba(0, 0, 0, 0.4)"; // Noir transp sur blanc
                        ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
                    }
                    ctx.fill();
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        }
    }
}
function drawHoverPoint() {
    const halfCell = CELL_SIZE / 2;
    const offsetX = BOARD_MARGIN + halfCell;
    const offsetY = BOARD_MARGIN + halfCell;

    // Dessin du coup en attente de confirmation (mobile) — prioritaire
    if (pendingMove) {
        const cx = offsetX + pendingMove.x * CELL_SIZE;
        const cy = offsetY + pendingMove.y * CELL_SIZE;
        const radius = CELL_SIZE / 2.15;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
        // En hot-seat, la couleur affichée suit le camp au trait, pas myColor.
        const previewColor = ownBothSides ? currentPlayer : myColor;
        if (previewColor === 1) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        }
        ctx.fill();
        // Halo pulsant pour indiquer l'attente
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = myColor === 1 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
    }

    if (hoverPoint) {
        const [x, y, isLegal] = hoverPoint;
        const cx = offsetX + x * CELL_SIZE;
        const cy = offsetY + y * CELL_SIZE;

        if (isLegal) {
            ctx.beginPath();
            const hoverColor = ownBothSides ? currentPlayer : myColor;
            ctx.fillStyle = hoverColor === 1 ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';
            ctx.arc(cx, cy, CELL_SIZE / 2.2, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            ctx.strokeStyle = 'rgba(200, 50, 50, 0.6)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const s = CELL_SIZE / 4;
            ctx.moveTo(cx - s, cy - s);
            ctx.lineTo(cx + s, cy + s);
            ctx.moveTo(cx + s, cy - s);
            ctx.lineTo(cx - s, cy + s);
            ctx.stroke();
        }
    }
}
function renderBoard() {
    drawGrid();
    drawStones();
    drawMoveNumbers();
    drawHoverPoint();
}
function updateHoverPoint(e) {
    if (gameOver || myColor === 0 || (myColor !== currentPlayer && !ownBothSides)) {
        hoverPoint = null;
        renderBoard();
        return;
    }
    const clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
    const clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : undefined);
    if (clientX === undefined || clientY === undefined) return;

    const { x, y } = clientToBoard(clientX, clientY);
    let isLegal;
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        isLegal = isLegalMove(x, y, currentPlayer, board);
        if (!hoverPoint || hoverPoint[0] !== x || hoverPoint[1] !== y || (hoverPoint[2] !== isLegal)) {
            hoverPoint = [x, y, isLegal];
            renderBoard();
        }
    } else {
        if (hoverPoint) {
            hoverPoint = null;
            renderBoard();
        }
    }
}
function resetGame() {
    if (gameRef) {
        try { gameRef.off(); } catch (e) { }
        gameRef = null;
    }
    if (dataChannel) try { dataChannel.close(); } catch (e) { }
    if (peerConnection) try { peerConnection.close(); } catch (e) { }
    dataChannel = null;
    peerConnection = null;
    if (chatListener && gameId) {
        try { db.ref(`games/${gameId}/chat`).off('child_added', chatListener); } catch(e) {}
        chatListener = null;
    }
    stopTimerTick();
    updateBoardSize(BOARD_SIZE);
    history = [];
    currentPlayer = 1;
    myColor = null;
    gameId = null;
    consecutivePasses = 0;
    lastMove = null;
    prisoners = { black: 0, white: 0 };
    gameOver = false;
    ownBothSides = false;
    pendingMove = null;
    moveList = [];
    gameTimerInitialSec = 0;
    localTimers = { black: 0, white: 0 };
    timerLastMoveAtLocal = 0;
    const bEl = document.getElementById('blackTimer');
    const wEl = document.getElementById('whiteTimer');
    if (bEl) bEl.textContent = '';
    if (wEl) wEl.textContent = '';
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) chatPanel.style.display = 'none';
    const chatToggle = document.getElementById('chatToggleBtn');
    if (chatToggle) { chatToggle.textContent = '💬'; chatToggle.classList.remove('active'); }
    const undoNotif = document.getElementById('undoNotification');
    if (undoNotif) undoNotif.style.display = 'none';
    if (confirmMoveUI) confirmMoveUI.style.display = 'none';
    const analyzeBtn = document.getElementById('analyzeGameBtn');
    if (analyzeBtn) analyzeBtn.style.display = 'none';
    const analysisOverlay = document.getElementById('analysisOverlay');
    if (analysisOverlay) analysisOverlay.classList.remove('visible');
    resetViewport();
    renderBoard();
    updateScore();
}

/* ========== Écouteurs & Initialisation ========== */
function setupGameListener() {
    if (!gameRef) {
        console.error("gameRef n'est pas défini. Impossible de configurer l'écouteur.");
        return;
    }
    if (gameListener) {
        gameRef.off("value", gameListener);
    }
    gameListener = gameRef.on('value', snapshot => {
        moveInProgress = false;
        const gameData = snapshot.val();
        if (!gameData) {
            resetGame();
            showScreen(lobbyScreen);
            showMessage(lobbyMessage, "La partie a été supprimée.", "red");
            return;
        }

        // Mise à jour de la taille du plateau si nécessaire
        if (gameData.boardSize && gameData.boardSize !== BOARD_SIZE) {
            updateBoardSize(gameData.boardSize);
        }

        board = gameData.board || board;
        currentPlayer = parseInt(gameData.currentPlayer) || currentPlayer;
        history = gameData.history || [];
        consecutivePasses = gameData.consecutivePasses || 0;
        lastMove = gameData.lastMove || null;
        prisoners = gameData.prisoners || { black: 0, white: 0 };
        moveList = gameData.moves || [];

        // Est-ce que je tiens les deux camps ? (même compte des deux côtés)
        const pl = gameData.players || {};
        ownBothSides = myColor !== 0 && !!pl.black && !!pl.white &&
            pl.black.uid === myUid && pl.white.uid === myUid;

        // Timer — synchroniser depuis Firebase
        if (gameData.timerInitialSec > 0) {
            gameTimerInitialSec = gameData.timerInitialSec;
            if (gameData.timers) {
                localTimers.black = gameData.timers.black || 0;
                localTimers.white = gameData.timers.white || 0;
            }
            timerLastMoveAtLocal = gameData.timerLastMoveAt || 0;
            if (gameData.status === 'playing') startTimerTick();
        } else {
            stopTimerTick();
        }

        // Undo request — afficher la notification à l'adversaire
        const undo = gameData.undoRequest;
        const undoNotif = document.getElementById('undoNotification');
        if (undo && undo.accepted == null && undo.by !== myUid && myColor !== 0) {
            showUndoNotification(undo.byNickname);
        } else if (undoNotif) {
            undoNotif.style.display = 'none';
        }
        // Si ma demande a été traitée
        if (undo && undo.by === myUid && undo.accepted != null) {
            showMessage(gameMessage, undo.accepted ? "Annulation acceptée !" : "Annulation refusée.", undo.accepted ? "lightgreen" : "orange");
            db.ref(`games/${gameId}/undoRequest`).set(null);
        }

        renderBoard();
        updateScore();
        updateTurnIndicators();
        updatePlayerPanels(gameData);
        if (gameData.status === 'playing' && !document.getElementById("gameScreen").classList.contains("active")) {
            showScreen(gameScreen);
            showMessage(gameMessage, "Un adversaire a rejoint ! La partie commence.", "lightgreen");
        }
        // Activer le chat dès que la partie est active ou en spectateur
        if ((gameData.status === 'playing' || gameData.status === 'finished') && !chatListener) {
            setupChatListener();
        }
        if (gameData.status === "finished" && !gameOver) {
            endGame(gameData.lastReason || "La partie est terminée.");
            return;
        }
        if (gameData.status === "playing") {
            // Filet de sécurité : double passe pas encore traitée côté serveur
            if (consecutivePasses >= 2 && !gameOver && myColor !== 0) {
                const { black, white } = computeScore(board);
                let winnerMsg;
                if (black > white) winnerMsg = `Noir gagne avec ${(black - white).toFixed(1)} pts d'avance !`;
                else if (white > black) winnerMsg = `Blanc gagne avec ${(white - black).toFixed(1)} pts d'avance !`;
                else winnerMsg = "Partie nulle !";
                saveGameToFirebase({
                    board: board,
                    lastReason: `Double passe. ${winnerMsg}`,
                    status: "finished"
                });
                return;
            }
            const blackCanPlay = canPlay(1, board);
            const whiteCanPlay = canPlay(2, board);
            if (!blackCanPlay && !whiteCanPlay) {
                saveGameToFirebase({
                    lastReason: "La partie est bloquée. Aucun joueur ne peut plus jouer.",
                    status: "finished"
                });
                return;
            }
        }

        // Affichage des statuts
        if (myColor === 0) {
            // Mode Spectateur
            passButton.disabled = true;
            forfeitButton.disabled = true;
            showMessage(gameMessage, `Mode Spectateur. Tour : ${currentPlayer === 1 ? "Noir" : "Blanc"}.`, "lightblue");
        } else {
            // Mode Joueur
            passButton.disabled = false;
            forfeitButton.disabled = false;

            if (gameData.status === 'waiting') {
                showMessage(gameMessage, "En attente d'un adversaire...", "lightblue");
            } else if (!gameOver) {
                const currentPlayerNickname = (currentPlayer === 1 && gameData.players.black) ? gameData.players.black.nickname : (currentPlayer === 2 && gameData.players.white) ? gameData.players.white.nickname : '';
                showMessage(gameMessage, `C'est au tour de ${currentPlayerNickname}.`, "lightgreen");

                // Notification Tab
                if (myColor === currentPlayer) {
                    document.title = "(!!!) À vous de jouer - Online Go";
                    // Jouer son "À vous" si on veut
                } else {
                    document.title = "Online Go Game";
                }
            }
        }
    });
}
function setupClipboardDetection() {
    window.addEventListener('paste', async () => {
        if (!lobbyScreen.classList.contains("active")) return;
        try {
            const clipboardText = await navigator.clipboard.readText();
            const gameIdPattern = /^\d{4}$/;
            if (gameIdPattern.test(clipboardText)) {
                showMessage(lobbyMessage, "Code de partie détecté dans le presse-papiers. Connexion automatique...", "lightblue");
                gameIdInput.value = clipboardText;
                await joinGame();
            }
        } catch (err) {
            console.error("Impossible de lire le presse-papiers :", err);
        }
    });
}
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    if (gameIdFromUrl) {
        gameIdInput.value = gameIdFromUrl;
    }
    setupClipboardDetection();
    renderBoard();
    updateScore();
    fetchPublicGames();
}

/* ========== Fonctions d'authentification et de lobby ========== */
registerBtn.onclick = () => {
    auth.createUserWithEmailAndPassword(emailInput.value, passwordInput.value)
        .then(() => showMessage(authMessage, "Compte créé. Vous êtes connecté.", "lightgreen"))
        .catch(err => showMessage(authMessage, err.message, "red"));
};
loginBtn.onclick = () => {
    auth.signInWithEmailAndPassword(emailInput.value, passwordInput.value)
        .then(() => showMessage(authMessage, "Connecté avec succès !", "lightgreen"))
        .catch(err => showMessage(authMessage, err.message, "red"));
};
logoutBtn.onclick = () => {
    auth.signOut().then(() => {
        showMessage(authMessage, "Déconnecté.", "lightgreen");
    }).catch(err => showMessage(authMessage, err.message, "red"));
};
saveNicknameBtn.onclick = async () => {
    const nickname = nicknameInput.value.trim();
    if (nickname.length < 3) { showMessage(nicknameMessage, "Le pseudo doit avoir au moins 3 caractères.", "red"); return; }
    myNickname = nickname;

    // Le pseudo n'était pas persisté : à la reconnexion, userData.nickname
    // valait undefined, l'écran de pseudo réapparaissait, et cette fonction
    // remettait les statistiques à zéro. La progression ne pouvait donc
    // jamais s'accumuler d'une session à l'autre.
    const snap = await db.ref(`users/${myUid}`).once("value");
    const existing = snap.val() || {};

    if (existing.level === undefined) {
        // Compte réellement neuf : on initialise.
        myStats = { wins: 0, losses: 0, totalPoints: 0, level: 1, currentXP: 0, gamesPlayed: 0,
            rating: 1500, ratingDeviation: 350, ratingVolatility: 0.06 };
        await db.ref(`users/${myUid}`).update({ nickname, ...myStats });
    } else {
        // Compte existant : on ne touche qu'au pseudo.
        await db.ref(`users/${myUid}`).update({ nickname });
    }

    updatePlayerInfoDisplay();
    showScreen(lobbyScreen);
};
auth.onAuthStateChanged(async user => {
    if (user) {
        myUid = user.uid;
        logoutBtn.style.display = "block";
        const snap = await db.ref(`users/${myUid}`).once("value");
        const userData = snap.val();
        if (userData) {
            myNickname = userData.nickname;
            myStats = {
                wins: userData.wins || 0,
                losses: userData.losses || 0,
                totalPoints: userData.totalPoints || 0,
                level: userData.level || 1,
                currentXP: userData.currentXP || 0,
                gamesPlayed: userData.gamesPlayed || 0,
                rating: userData.rating || 1500,
                ratingDeviation: userData.ratingDeviation || 350,
                ratingVolatility: userData.ratingVolatility || 0.06
            };
        } else {
            myNickname = null;
        }

        if (!myNickname) showScreen(nicknameScreen);
        else {
            updatePlayerInfoDisplay();
            showScreen(lobbyScreen);
            cleanUpOldGames();
        }
    } else {
        // Le mode invité (partie locale contre KataGo) n'utilise aucun compte :
        // la résolution asynchrone de l'état Firebase ne doit pas l'éjecter.
        if (document.body.classList.contains("guest-mode")) return;
        myUid = null;
        myNickname = null;
        playerInfo.textContent = "Non connecté";
        logoutBtn.style.display = "none";
        showScreen(authScreen);
    }
});

/* ========== Création de partie ========== */
createGameBtn.onclick = async () => {
    try {
        gameId = await generateGameId();
        gameRef = db.ref('games/' + gameId);
        if (!auth.currentUser) { showMessage(lobbyMessage, "Vous devez être connecté pour créer une partie.", "red"); return; }

        const selectedSize = parseInt(boardSizeSelect.value);
        updateBoardSize(selectedSize);

        const isPublic = publicGameCheckbox.checked;
        const timerSel = document.getElementById('timerSelect');
        const chosenTimerSec = timerSel ? parseInt(timerSel.value) : 0;
        const initialTimerMs = chosenTimerSec * 1000;

        const gameData = {
            status: "waiting",
            // L'e-mail n'est jamais relu par l'application et le nœud games est
            // lisible sans authentification : le stocker exposait publiquement
            // l'adresse des joueurs. Le pseudo suffit à l'affichage.
            // On enregistre sa note AVANT la partie : a la fin, chaque joueur
            // met a jour son classement contre la note de depart de l'adversaire.
            players: { black: { uid: myUid, nickname: myNickname, rating: Math.round(myStats.rating || 1500) } },
            board: board,
            currentPlayer: currentPlayer,
            history: history,
            moves: [],
            createdAt: Date.now(),
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
            consecutivePasses: 0,
            boardSize: selectedSize,
            isPublic: isPublic,
            timerInitialSec: chosenTimerSec,
            timers: { black: initialTimerMs, white: initialTimerMs },
            timerLastMoveAt: 0,
            timerActivePlayer: 1
        };
        await gameRef.set(gameData);
        myColor = 1;

        showMessage(lobbyMessage, `Partie créée (${selectedSize}x${selectedSize}). Code : ${gameId}.`, 'lightgreen');
        gameLinkDisplay.textContent = gameId;
        gameLinkSection.classList.add('visible');
        if (isPublic) {
            publicGameNote.style.display = "block";
        } else {
            publicGameNote.style.display = "none";
        }

        copyToClipboard(gameId);
        setupGameListener();
    } catch (e) {
        console.error("Erreur lors de la création de la partie :", e);
        showMessage(lobbyMessage, "Erreur lors de la création de la partie.", "red");
    }
};

/* ========== Rejoindre une partie ========== */
async function joinGame(targetGameId = null) {
    const gameIdInputVal = targetGameId || gameIdInput.value.trim();
    if (gameIdInputVal.length !== 4) { showMessage(lobbyMessage, "Veuillez entrer un code de partie à 4 chiffres.", "red"); return; }

    gameRef = db.ref('games/' + gameIdInputVal);
    showMessage(lobbyMessage, "Connexion à la partie...", "lightgreen");

    try {
        const snapshot = await gameRef.once('value');
        const gameData = snapshot.val();

        if (!gameData) {
            showMessage(lobbyMessage, "Partie introuvable.", "red");
            return;
        }

        gameId = gameIdInputVal;

        // Détection de la taille du plateau
        if (gameData.boardSize) updateBoardSize(gameData.boardSize);
        else updateBoardSize(19); // Fallback

        // Logique Joueur vs Spectateur
        if (gameData.status === 'waiting' && !gameData.players.white) {
            // Rejoindre en tant que joueur Blanc
            await gameRef.update({
                'players/white': { uid: myUid, nickname: myNickname, rating: Math.round(myStats.rating || 1500) },
                status: 'playing'
            });
            myColor = 2;
            showMessage(gameMessage, "Partie rejointe ! Vous êtes Blanc.", "lightgreen");
        } else if (gameData.players.black.uid === myUid) {
            // Reconnexion joueur Noir
            myColor = 1;
            showMessage(gameMessage, "Retour dans la partie (Noir).", "lightgreen");
        } else if (gameData.players.white && gameData.players.white.uid === myUid) {
            // Reconnexion joueur Blanc
            myColor = 2;
            showMessage(gameMessage, "Retour dans la partie (Blanc).", "lightgreen");
        } else {
            // Mode Spectateur
            myColor = 0;
            showMessage(gameMessage, "Mode Spectateur activé.", "lightblue");
        }

        setupGameListener();
        setupChatListener();
        showScreen(gameScreen);

    } catch (error) {
        console.error("Erreur lors de la jonction de la partie:", error);
        showMessage(lobbyMessage, "Erreur lors de la jonction. Veuillez réessayer.", "red");
    }
}
joinGameBtn.onclick = () => joinGame();

/* ========== Regarder une partie (mode spectateur uniquement) ========== */
async function spectateGame(targetGameId) {
    gameRef = db.ref('games/' + targetGameId);
    showMessage(lobbyMessage, "Connexion en mode spectateur...", "lightblue");

    try {
        const snapshot = await gameRef.once('value');
        const gameData = snapshot.val();

        if (!gameData) {
            showMessage(lobbyMessage, "Partie introuvable.", "red");
            gameRef = null;
            return;
        }

        gameId = targetGameId;
        if (gameData.boardSize) updateBoardSize(gameData.boardSize);
        else updateBoardSize(19);

        myColor = 0; // Toujours spectateur, jamais joueur
        setupGameListener();
        setupChatListener();
        showScreen(gameScreen);
        showMessage(gameMessage, "Mode Spectateur activé.", "lightblue");

    } catch (error) {
        console.error("Erreur spectateur:", error);
        showMessage(lobbyMessage, "Erreur de connexion spectateur.", "red");
    }
}

/* ========== Matchmaking & Liste des parties ========== */
function formatTime(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "à l'instant";
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    return `${hours} h`;
}

async function fetchPublicGames() {
    waitingGamesList.innerHTML = '<p class="loading-text">Chargement...</p>';
    activeGamesList.innerHTML = '<p class="loading-text">Chargement...</p>';

    try {
        // On récupère les parties publiques
        // Note: Firebase Query est limitée, on filtre côté client pour ce MVP simple
        const snapshot = await db.ref('games').orderByChild('isPublic').equalTo(true).limitToLast(50).once('value');

        const games = [];
        snapshot.forEach(childSnapshot => {
            games.push({ id: childSnapshot.key, ...childSnapshot.val() });
        });

        // Séparation Waiting / Playing
        const waitingGames = games.filter(g => g.status === 'waiting');
        const activeGames = games.filter(g => g.status === 'playing');

        // Tri Waiting: Plus long temps d'attente en premier (createdAt croissant)
        waitingGames.sort((a, b) => a.createdAt - b.createdAt);

        // Tri Active: Plus récent en premier
        activeGames.sort((a, b) => b.createdAt - a.createdAt);

        renderGameList(waitingGames, waitingGamesList, "Rejoindre");
        renderGameList(activeGames, activeGamesList, "Regarder");

    } catch (err) {
        console.error("Erreur lors du chargement des parties :", err);
        waitingGamesList.innerHTML = '<p class="error-text">Erreur de chargement.</p>';
        activeGamesList.innerHTML = '<p class="error-text">Erreur de chargement.</p>';
    }
}

function renderGameList(games, container, actionLabel) {
    container.innerHTML = '';
    if (games.length === 0) {
        container.innerHTML = '<p class="loading-text">Aucune partie trouvée.</p>';
        return;
    }

    // Construit avec les API DOM et non par innerHTML : le pseudo et la clé de
    // partie viennent d'utilisateurs arbitraires. Interpolés dans une chaîne
    // HTML, un pseudo tel que <img src=x onerror=…> s'exécutait chez tous les
    // visiteurs du lobby. textContent ne peut jamais produire de balisage.
    games.forEach(game => {
        const item = document.createElement('div');
        item.className = 'game-item';

        const player = (game.players && game.players.black && game.players.black.nickname) || "Inconnu";
        const size = game.boardSize || 19;
        const time = formatTime(game.createdAt);

        const info = document.createElement('div');
        info.className = 'game-item-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'game-item-player';
        nameEl.textContent = player;

        const detailsEl = document.createElement('div');
        detailsEl.className = 'game-item-details';
        detailsEl.textContent = `${size}x${size} • ${time}`;

        info.appendChild(nameEl);
        info.appendChild(detailsEl);

        const btn = document.createElement('button');
        btn.textContent = actionLabel;
        // Écouteur plutôt qu'attribut onclick : l'identifiant reste une valeur
        // et n'est jamais réinterprété comme du code.
        btn.addEventListener('click', () => {
            if (actionLabel === "Regarder") spectateGame(game.id);
            else joinGame(game.id);
        });

        item.appendChild(info);
        item.appendChild(btn);
        container.appendChild(item);
    });
}

refreshListBtn.onclick = fetchPublicGames;

// ========== Gestion Zoom/Pan + Interactions Plateau ==========

let _isDragging = false;
let _dragLastX = 0, _dragLastY = 0;
let _dragStartX = 0, _dragStartY = 0;
let _dragMoved = false;

let _isPinching = false;
let _lastPinchDist = 0;
let _isTouchDragging = false;
let _touchLastX = 0, _touchLastY = 0;
let _touchStartX = 0, _touchStartY = 0;
let _touchMoved = false;

function _pinchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function _zoomAround(wx, wy, factor) {
    const newScale = Math.max(viewport.minScale, Math.min(viewport.maxScale, viewport.scale * factor));
    viewport.x = wx - (wx - viewport.x) * (newScale / viewport.scale);
    viewport.y = wy - (wy - viewport.y) * (newScale / viewport.scale);
    viewport.scale = newScale;
    clampViewport();
    applyViewport();
}

// --- Mouse events (PC) ---
boardWrapper.addEventListener('mousedown', e => {
    _isDragging = true;
    _dragMoved = false;
    _dragStartX = _dragLastX = e.clientX;
    _dragStartY = _dragLastY = e.clientY;
});

window.addEventListener('mousemove', e => {
    if (_isDragging) {
        const dx = e.clientX - _dragLastX;
        const dy = e.clientY - _dragLastY;
        if (Math.abs(e.clientX - _dragStartX) > 4 || Math.abs(e.clientY - _dragStartY) > 4) {
            _dragMoved = true;
            viewport.x += dx;
            viewport.y += dy;
            clampViewport();
            applyViewport();
        }
        _dragLastX = e.clientX;
        _dragLastY = e.clientY;
    }
    // Hover preview
    if (document.getElementById("gameScreen").classList.contains("active")) {
        updateHoverPoint(e);
    }
});

window.addEventListener('mouseup', () => { _isDragging = false; });

boardWrapper.addEventListener('click', e => {
    if (_dragMoved || gameOver) return;
    const { x, y } = clientToBoard(e.clientX, e.clientY);
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        playMove(x, y);
    }
});

boardWrapper.addEventListener('mouseout', () => {
    hoverPoint = null;
    renderBoard();
});

// Scroll molette = zoom
boardWrapper.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = boardWrapper.getBoundingClientRect();
    const wx = e.clientX - rect.left;
    const wy = e.clientY - rect.top;
    _zoomAround(wx, wy, e.deltaY > 0 ? 0.85 : 1.18);
    updateHoverPoint(e);
}, { passive: false });

// --- Touch events (Mobile) ---
boardWrapper.addEventListener('touchstart', e => {
    e.preventDefault();
    if (e.touches.length === 2) {
        _isPinching = true;
        _isTouchDragging = false;
        _lastPinchDist = _pinchDist(e.touches);
    } else if (e.touches.length === 1) {
        _isPinching = false;
        _isTouchDragging = false;
        _touchMoved = false;
        _touchStartX = _touchLastX = e.touches[0].clientX;
        _touchStartY = _touchLastY = e.touches[0].clientY;
    }
}, { passive: false });

boardWrapper.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 2 && _isPinching) {
        const dist = _pinchDist(e.touches);
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect = boardWrapper.getBoundingClientRect();
        _zoomAround(cx - rect.left, cy - rect.top, dist / _lastPinchDist);
        _lastPinchDist = dist;
    } else if (e.touches.length === 1 && !_isPinching) {
        const tx = e.touches[0].clientX;
        const ty = e.touches[0].clientY;
        const dx = tx - _touchLastX;
        const dy = ty - _touchLastY;
        if (Math.abs(tx - _touchStartX) > 8 || Math.abs(ty - _touchStartY) > 8) {
            _touchMoved = true;
            _isTouchDragging = true;
        }
        if (_isTouchDragging) {
            viewport.x += dx;
            viewport.y += dy;
            clampViewport();
            applyViewport();
        }
        _touchLastX = tx;
        _touchLastY = ty;
    }
}, { passive: false });

boardWrapper.addEventListener('touchend', e => {
    e.preventDefault();
    if (_isPinching && e.touches.length < 2) {
        _isPinching = false;
        return;
    }
    // Tap (pas de déplacement) → coup en attente
    if (!_touchMoved && !gameOver && e.changedTouches.length === 1) {
        const touch = e.changedTouches[0];
        const { x, y } = clientToBoard(touch.clientX, touch.clientY);
        if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
            if (myColor === 0) {
                showMessage(gameMessage, "Mode Spectateur : vous ne pouvez pas jouer.", "orange");
            } else if (myColor !== currentPlayer && !ownBothSides) {
                showMessage(gameMessage, "Ce n'est pas votre tour !", "orange");
            } else {
                showPendingMove(x, y);
            }
        }
    }
    hoverPoint = null;
    if (!pendingMove) renderBoard();
}, { passive: false });
// ========== Coup en attente de confirmation (mobile) ==========
function showPendingMove(x, y) {
    if (!isLegalMove(x, y, currentPlayer, board)) return;
    pendingMove = { x, y };
    confirmMoveUI.style.display = 'flex';
    renderBoard();
}

function cancelPendingMove() {
    pendingMove = null;
    confirmMoveUI.style.display = 'none';
    renderBoard();
}

confirmMoveBtn.onclick = () => {
    if (pendingMove) {
        const { x, y } = pendingMove;
        pendingMove = null;
        confirmMoveUI.style.display = 'none';
        playMove(x, y);
    }
};

cancelMoveBtn.onclick = cancelPendingMove;

// ========== Boutons de contrôle ==========
passButton.onclick = () => {
    if (!passButton.disabled) {
        cancelPendingMove();
        passTurn();
    }
};

// Abandon : affiche la modal de confirmation
forfeitButton.onclick = () => {
    if (!forfeitButton.disabled) {
        resignModal.style.display = 'flex';
    }
};

confirmResignBtn.onclick = () => {
    resignModal.style.display = 'none';
    resign();
};

cancelResignBtn.onclick = () => {
    resignModal.style.display = 'none';
};
// FIX: Ajout de l'écouteur pour le bouton Copier
copyLinkBtn.onclick = () => {
    const code = gameLinkDisplay.textContent;
    copyToClipboard(code);
};

// Fermeture de la modale « code de partie » (la partie reste en attente).
const closeGameLinkBtn = document.getElementById('closeGameLinkBtn');
if (closeGameLinkBtn) closeGameLinkBtn.onclick = () => gameLinkSection.classList.remove('visible');
gameLinkSection.addEventListener('click', (e) => {
    // Clic sur le fond (hors carte) : on ferme.
    if (e.target === gameLinkSection) gameLinkSection.classList.remove('visible');
});

// ========== Nouveaux boutons de jeu ==========

// Numéros de coups
document.getElementById('toggleNumbersBtn').onclick = () => {
    showMoveNumbers = !showMoveNumbers;
    const btn = document.getElementById('toggleNumbersBtn');
    btn.classList.toggle('active', showMoveNumbers);
    renderBoard();
};

// Undo
document.getElementById('undoBtn').onclick = requestUndo;

// Undo réponse
document.getElementById('undoAcceptBtn').onclick = () => respondToUndo(true);
document.getElementById('undoRejectBtn').onclick  = () => respondToUndo(false);

// Chat toggle
document.getElementById('chatToggleBtn').onclick = toggleChat;

// Chat envoi : bouton + Entrée
document.getElementById('chatSendBtn').onclick = sendChatMessage;
document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); }
});

// Revanche
document.getElementById('rematchBtn').onclick = () => {
    const savedSize = BOARD_SIZE;
    const rematchBtn = document.getElementById('rematchBtn');
    if (rematchBtn) rematchBtn.style.display = 'none';
    endGameOverlay.classList.remove('active');
    resetGame();
    showScreen(lobbyScreen);
    const sel = document.getElementById('boardSizeSelect');
    if (sel) sel.value = savedSize.toString();
    showMessage(lobbyMessage, "Créez une partie pour la revanche — même taille, couleurs inversées !", "gold");
};

init();
