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
const passButton = document.getElementById("passButton");
const forfeitButton = document.getElementById("forfeitButton");
const gameMessage = document.getElementById("gameStatus");
const blackScoreEl = document.getElementById("blackScore");
const whiteScoreEl = document.getElementById("whiteScore");
const playerInfo = document.getElementById("playerInfo");
const endGameOverlay = document.getElementById("endGameOverlay");
const endGameMessageEl = document.getElementById("endGameMessage");
const endGameCountdownEl = document.getElementById("endGameCountdown");

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
let gameId = null;
let consecutivePasses = 0;
let gameOver = false;
let gameRef = null;
let hoverPoint = null;
let gameListener = null;
let moveInProgress = false;
let lastMove = null; // {x, y}
let prisoners = { black: 0, white: 0 };

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
        try { const msg = JSON.parse(e.data); }
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
    if (screen === lobbyScreen) {
        fetchPublicGames(); // Rafraîchir la liste en arrivant sur le lobby
    }
}
function showMessage(el, text, color = "#bbb") {
    el.innerText = text;
    el.style.color = color;
}
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => showMessage(lobbyMessage, "Code de la partie copié !", "lightgreen"))
        .catch(err => {
            console.error("Erreur de copie :", err);
            showMessage(lobbyMessage, "Impossible de copier. Veuillez le faire manuellement.", "orange");
        });
}

// Mise à jour de la taille du plateau et des cellules
// Mise à jour de la taille du plateau et des cellules
function updateBoardSize(size) {
    BOARD_SIZE = parseInt(size);
    // On laisse de la place pour les coordonnées (BOARD_SIZE + 2 cases virtuelles)
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
    // Score Total = Territoire + Prisonniers + (Komi pour Blanc)
    // Ici calcul simplifié territoire uniquement, on ajoute l'affichage prisonniers
    blackScoreEl.innerHTML = `Noir<br><span style="font-size:0.8em">Captures: ${prisoners.black}</span>`;
    whiteScoreEl.innerHTML = `Blanc<br><span style="font-size:0.8em">Captures: ${prisoners.white} • Komi: ${KOMI}</span>`;
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
    if (myColor !== currentPlayer) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }

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
    
    // Jouer un son
    // soundClick.play().catch(e => {}); 

    // Mise à jour des prisonniers
    prisoners[currentPlayer === 1 ? 'black' : 'white'] += result.capturedStones;

    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    saveGameToFirebase({
        board: result.newState,
        currentPlayer: nextPlayer,
        history: [...history, newStateStr],
        consecutivePasses: 0,
        lastReason: "move",
        lastMove: { x, y },
        prisoners: prisoners
    });
}

function passTurn() {
    if (gameOver || moveInProgress) return;
    if (myColor === 0) return; // Spectator
    if (myColor !== currentPlayer) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }
    moveInProgress = true;
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    const nextPasses = consecutivePasses + 1;

    if (nextPasses >= 2) {
        const message = "Les deux joueurs ont passé consécutivement.";
        saveGameToFirebase({
            gameOver: true,
            lastReason: message,
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



function animateWin(winnerNickname, message) {
    endGameOverlay.classList.add("active");
    endGameMessageEl.textContent = message || `${winnerNickname} a gagné !`;

    // Démarre l'animation de confettis uniquement pour le gagnant
    if (winnerNickname && myNickname === winnerNickname) {
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
        let finalMessage = "";

        // Logique de détermination du message final plus robuste
        if (message && message.includes("gagne par abandon")) {
            // Cas 1: Un joueur a abandonné
            winnerNickname = message.includes("Blanc") ? whiteNickname : blackNickname;
            finalMessage = message; // Le message est déjà complet (ex: "Le joueur Blanc gagne par abandon.")

        } else {
            // Cas 2: Double passe, blocage, ou autre fin par score
            const { black, white } = computeScore(board);

            if (black > white) {
                winnerNickname = blackNickname;
                finalMessage = `${winnerNickname} gagne avec ${(black - white).toFixed(1)} points d'avance !`;
            } else if (white > black) {
                winnerNickname = whiteNickname;
                finalMessage = `${winnerNickname} gagne avec ${(white - black).toFixed(1)} points d'avance !`;
            } else {
                finalMessage = "La partie est nulle !";
            }
        }

        // Lance l’animation avec le message final déterminé
        animateWin(winnerNickname, finalMessage);

        // Désactive les boutons de jeu
        passButton.disabled = true;
        forfeitButton.disabled = true;

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
    const gamesRef = db.ref('games');
    const now = Date.now();
    const fortyEightHoursInMs = 48 * 60 * 60 * 1000; // 48 heures

    try {
        const snapshot = await gamesRef.once('value');
        if (snapshot.exists()) {
            const games = snapshot.val();
            let gamesDeletedCount = 0;

            for (const gameId in games) {
                const game = games[gameId];
                const lastActivity = game.lastUpdateAt || game.createdAt;

                // La règle de sécurité est la source de vérité, mais on filtre ici pour l'affichage
                if (lastActivity && (now - lastActivity > fortyEightHoursInMs)) {
                    try {
                        await db.ref(`games/${gameId}`).remove();
                        console.log(`Partie ${gameId} supprimée (plus de 48h d'inactivité).`);
                        gamesDeletedCount++;
                    } catch (err) {
                        // Le client peut échouer si la règle de sécurité est plus stricte
                        // Ce n'est pas une erreur critique, juste une tentative de nettoyage
                        console.warn(`Nettoyage de la partie ${gameId} bloqué par les règles de sécurité (ce qui est normal si elle est active).`);
                    }
                }
            }

            if (gamesDeletedCount > 0) {
                console.log(`${gamesDeletedCount} vieilles parties ont été nettoyées.`);
            }
        }
    } catch (error) {
        console.error("Erreur lors du nettoyage des vieilles parties:", error);
    }
}


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
    ctx.fillStyle = "#8b5a2b"; // Couleur bois foncé
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

                ctx.beginPath();
                ctx.arc(cx, cy, CELL_SIZE / 2.1, 0, 2 * Math.PI);
                
                // Ombre portée légère pour effet 3D
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 4;
                ctx.shadowOffsetX = 2;
                ctx.shadowOffsetY = 2;

                if (board[y][x] === 1) { 
                    // Noir mat
                    ctx.fillStyle = "#111"; 
                } else { 
                    // Blanc coquillage (Shell)
                    ctx.fillStyle = "#fcfcfc"; 
                }
                ctx.fill();
                
                // Reset Ombre
                ctx.shadowColor = 'transparent';

                // Reflet sur pierre noire ou contour pierre blanche
                /*if (board[y][x] === 1) {
                     ctx.fillStyle = "rgba(255,255,255,0.1)";
                     ctx.beginPath();
                     ctx.arc(cx - CELL_SIZE/6, cy - CELL_SIZE/6, CELL_SIZE/6, 0, 2 * Math.PI);
                     ctx.fill();
                }*/

                ctx.strokeStyle = "rgba(0,0,0,0.1)";
                ctx.lineWidth = 1;
                ctx.stroke();

                // Marqueur dernier coup
                if (lastMove && lastMove.x === x && lastMove.y === y) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, CELL_SIZE / 5, 0, 2 * Math.PI);
                    ctx.fillStyle = (board[y][x] === 1) ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)";
                    ctx.fill();
                }
            }
        }
    }
}
function drawHoverPoint() {
    if (hoverPoint) {
        const [x, y, isLegal] = hoverPoint;
        const halfCell = CELL_SIZE / 2;
        const offsetX = BOARD_MARGIN + halfCell;
        const offsetY = BOARD_MARGIN + halfCell;
        const cx = offsetX + x * CELL_SIZE;
        const cy = offsetY + y * CELL_SIZE;

        if (isLegal) {
            ctx.beginPath();
            ctx.fillStyle = myColor === 1 ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.5)';
            ctx.arc(cx, cy, CELL_SIZE / 2.2, 0, 2 * Math.PI);
            ctx.fill();
        } else {
            // Croix rouge discrète
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
    drawHoverPoint();
}
function updateHoverPoint(e) {
    if (gameOver || myColor !== currentPlayer || myColor === 0) {
        hoverPoint = null;
        renderBoard();
        return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    if (clientX === undefined || clientY === undefined) return;
    
    // Correction coordonnées avec marge
    const halfCell = CELL_SIZE / 2;
    // (Mouse - CanvasRect.left) * scale = CanvasX
    // CanvasX - Margin - HalfCell = GridPixels
    // GridPixels / CELL_SIZE = GridIndex (approx)
    
    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    
    const x = Math.round((canvasX - BOARD_MARGIN - halfCell) / CELL_SIZE);
    const y = Math.round((canvasY - BOARD_MARGIN - halfCell) / CELL_SIZE);
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
    updateBoardSize(BOARD_SIZE); // Reset board
    history = [];
    currentPlayer = 1;
    myColor = null;
    gameId = null;
    consecutivePasses = 0;
    lastMove = null;
    prisoners = { black: 0, white: 0 };
    gameOver = false;
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
        currentPlayer = gameData.currentPlayer || currentPlayer;
        history = gameData.history || [];
        consecutivePasses = gameData.consecutivePasses || 0;
        lastMove = gameData.lastMove || null;
        prisoners = gameData.prisoners || { black: 0, white: 0 };
        renderBoard();
        updateScore();
        if (gameData.status === 'playing' && !document.getElementById("gameScreen").classList.contains("active")) {
             showScreen(gameScreen);
             showMessage(gameMessage, "Un adversaire a rejoint ! La partie commence.", "lightgreen");
        }
        if (gameData.status === "finished" && !gameOver) {
            endGame(gameData.lastReason || "La partie est terminée.");
        }
        if (gameData.status === "playing") {
             const blackCanPlay = canPlay(1, board);
             const whiteCanPlay = canPlay(2, board);
             if (!blackCanPlay && !whiteCanPlay) {
                saveGameToFirebase({
                    gameOver: true,
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
    window.addEventListener('paste', async (event) => {
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
    cleanUpOldGames();
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
    await db.ref(`users/${myUid}`).set({ email: auth.currentUser.email, nickname: nickname });
    myNickname = nickname;
    playerInfo.textContent = `${myNickname}`;
    showScreen(lobbyScreen);
};
auth.onAuthStateChanged(async user => {
    if (user) {
        myUid = user.uid;
        logoutBtn.style.display = "block";
        const snap = await db.ref(`users/${myUid}`).once("value");
        myNickname = snap.val() ? snap.val().nickname : null;
        if (!myNickname) showScreen(nicknameScreen);
        else {
            playerInfo.textContent = `${myNickname}`;
            showScreen(lobbyScreen);
        }
    } else {
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

        const gameData = {
            status: "waiting",
            players: { black: { uid: myUid, email: auth.currentUser.email, nickname: myNickname } },
            board: board,
            currentPlayer: currentPlayer,
            history: history,
            createdAt: Date.now(),
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
            consecutivePasses: 0,
            boardSize: selectedSize,
            isPublic: isPublic
        };
        await gameRef.set(gameData);
        myColor = 1;

        showMessage(lobbyMessage, `Partie créée (${selectedSize}x${selectedSize}). Code : ${gameId}.`, 'lightgreen');
        gameLinkDisplay.textContent = gameId;
        gameLinkSection.style.display = 'block';
        if (isPublic) {
            publicGameNote.style.display = "block";
        } else {
            publicGameNote.style.display = "none";
        }

        await copyToClipboard(gameId);
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
                'players/white': { uid: myUid, email: auth.currentUser.email, nickname: myNickname },
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
        showScreen(gameScreen);

    } catch (error) {
        console.error("Erreur lors de la jonction de la partie:", error);
        showMessage(lobbyMessage, "Erreur lors de la jonction. Veuillez réessayer.", "red");
    }
}
joinGameBtn.onclick = () => joinGame();

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

    games.forEach(game => {
        const item = document.createElement('div');
        item.className = 'game-item';

        const player = game.players.black.nickname || "Inconnu";
        const size = game.boardSize || 19;
        const time = formatTime(game.createdAt);

        item.innerHTML = `
            <div class="game-item-info">
                <div class="game-item-player">${player}</div>
                <div class="game-item-details">${size}x${size} • ${time}</div>
            </div>
            <button onclick="joinGame('${game.id}')">${actionLabel}</button>
        `;
        container.appendChild(item);
    });
}

refreshListBtn.onclick = fetchPublicGames;

canvas.addEventListener("click", e => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const halfCell = CELL_SIZE / 2;
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;
    
    const x = Math.round((canvasX - BOARD_MARGIN - halfCell) / CELL_SIZE);
    const y = Math.round((canvasY - BOARD_MARGIN - halfCell) / CELL_SIZE);
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        console.log("Clic sur le canvas:", { x, y });
        playMove(x, y);
    }
});
canvas.addEventListener("mousemove", updateHoverPoint);
canvas.addEventListener("touchmove", updateHoverPoint);
canvas.addEventListener("mouseout", () => {
    hoverPoint = null;
    renderBoard();
});
canvas.addEventListener("touchend", () => {
    hoverPoint = null;
    renderBoard();
});
passButton.onclick = () => {
    console.log("Bouton Passer cliqué.");
    if (!passButton.disabled) {
        passTurn();
    }
};
forfeitButton.onclick = () => {
    console.log("Bouton Abandonner cliqué.");
    if (!forfeitButton.disabled) {
        resign();
    }
};
init();