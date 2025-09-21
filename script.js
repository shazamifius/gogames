/* ================================
   Online Go Game - script.js
   
   Version nettoyée et optimisée.
   - WebRTC pour le temps réel (prioritaire)
   - Firebase comme sauvegarde / fallback
   - Synchronisation automatique après chaque action
   - Meilleure gestion des déconnexions et des écouteurs
================================= */

/* ========== Firebase config ========== */
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
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

/* ========== DOM Elements ========== */
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

/* ========== Game constants ========== */
const BOARD_SIZE = 19;
const KOMI = 7.5;
const CELL_SIZE = canvas.width / (BOARD_SIZE + 1);

/* ========== State ========== */
let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
let history = [];
let currentPlayer = 1; // 1: black, 2: white
let myColor = null;
let myUid = null;
let myNickname = null;
let gameId = null;
let consecutivePasses = 0;
let gameOver = false;
let gameRef = null;

/* ========== WebRTC ========== */
let peerConnection = null;
let dataChannel = null;
const iceServers = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

/* ========== Helpers UI ========== */
function showScreen(screen) {
    [authScreen, nicknameScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
    screen.classList.add("active");
}
function showMessage(el, text, color = "#bbb") {
    el.innerText = text;
    el.style.color = color;
}

/* ========== Board drawing ========== */
function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1.5;
    for (let i = 1; i <= BOARD_SIZE; i++) {
        ctx.beginPath();
        ctx.moveTo(i * CELL_SIZE, CELL_SIZE);
        ctx.lineTo(i * CELL_SIZE, BOARD_SIZE * CELL_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(CELL_SIZE, i * CELL_SIZE);
        ctx.lineTo(BOARD_SIZE * CELL_SIZE, i * CELL_SIZE);
        ctx.stroke();
    }
    const star = [3, 9, 15];
    star.forEach(x => star.forEach(y => {
        ctx.beginPath();
        ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, 4, 0, 2 * Math.PI);
        ctx.fillStyle = "#000";
        ctx.fill();
    }));
}
function drawStones() {
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 || board[y][x] === 2) {
                ctx.beginPath();
                ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, CELL_SIZE / 2.2, 0, 2 * Math.PI);
                ctx.fillStyle = board[y][x] === 1 ? "#000" : "#fff";
                ctx.fill();
                ctx.strokeStyle = board[y][x] === 1 ? "#fff" : "#000";
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }
}
function renderBoard() {
    drawGrid();
    drawStones();
}

/* ========== Rules helpers ========== */
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
                visited.add(`${nx},${y}`);
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
function placeStone(x, y, color, state) {
    const newState = copyBoard(state);
    newState[y][x] = color;
    const opponent = color === 1 ? 2 : 1;
    for (let [nx, ny] of getNeighbors(x, y)) {
        if (newState[ny][nx] === opponent) {
            const chain = getChain(nx, ny, opponent, new Set(), newState);
            if (getLiberties(chain, newState) === 0) chain.forEach(([cx, cy]) => (newState[cy][cx] = 0));
        }
    }
    const chain = getChain(x, y, color, new Set(), newState);
    if (getLiberties(chain, newState) === 0) return null;
    return { newState };
}
function isLegalMove(x, y, color, state) {
    if (state[y][x] !== 0) { showMessage(gameMessage, "Cette case est déjà prise.", "orange"); return false; }
    const result = placeStone(x, y, color, state);
    if (!result) { showMessage(gameMessage, "Les coups suicides ne sont pas autorisés.", "orange"); return false; }
    const newStateStr = boardToString(result.newState);
    if (history.includes(newStateStr)) { showMessage(gameMessage, "Violation de la règle du Superko.", "orange"); return false; }
    return true;
}

/* ========== Scoring ========== */
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
    blackScoreEl.textContent = `Noir: ${black}`;
    whiteScoreEl.textContent = `Blanc: ${white.toFixed(1)}`;
}

/* ========== Firebase sync helpers ========== */
async function saveGameToFirebase(reason = "update") {
    if (!gameRef || !gameId) return;
    try {
        await gameRef.update({
            board: board,
            currentPlayer: currentPlayer,
            history: history,
            lastUpdateBy: myUid || "unknown",
            lastUpdateAt: Date.now(),
            status: gameOver ? "finished" : "playing",
            lastReason: reason
        });
    } catch (err) {
        console.error("Erreur de sauvegarde Firebase:", err);
    }
}

function applyRemoteGameData(data) {
    if (!data) return;
    if (!data.board || typeof data.currentPlayer === "undefined") return;
    if (data.lastUpdateBy === myUid) return;

    const remoteBoardStr = JSON.stringify(data.board);
    const localBoardStr = JSON.stringify(board);

    if (remoteBoardStr !== localBoardStr || data.currentPlayer !== currentPlayer || JSON.stringify(data.history) !== JSON.stringify(history)) {
        board = data.board;
        currentPlayer = data.currentPlayer;
        history = data.history || [];
        consecutivePasses = 0;
        renderBoard();
        updateScore();
        showMessage(gameMessage, "Synchronisé depuis le serveur (fallback).", "lightblue");
    }
}

/* ========== WebRTC helpers ========== */
function setupDataChannelLocal(channel) {
    dataChannel = channel;
    dataChannel.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            handleIncomingMessage(msg);
        } catch (err) {
            console.error("Message invalide sur le dataChannel", err);
        }
    };
    dataChannel.onopen = () => { showMessage(gameMessage, "Connexion établie (WebRTC).", "lightgreen"); };
    dataChannel.onclose = () => {
        showMessage(gameMessage, "Connexion WebRTC fermée — fallback à Firebase.", "orange");
        dataChannel = null;
    };
    dataChannel.onerror = err => console.error("Erreur DataChannel:", err);
}

function handleIncomingMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === "move") {
        board = msg.board;
        currentPlayer = msg.currentPlayer;
        history = msg.history || [];
        renderBoard();
        updateScore();
        showMessage(gameMessage, "L'adversaire a joué. C'est votre tour !", "lightgreen");
        saveGameToFirebase("move-received");
    } else if (msg.type === "pass") {
        currentPlayer = msg.currentPlayer;
        consecutivePasses++;
        if (consecutivePasses >= 2) endGame();
        renderBoard();
        updateScore();
        showMessage(gameMessage, "L'adversaire a passé. C'est votre tour !", "lightgreen");
        saveGameToFirebase("pass-received");
    } else if (msg.type === "end") {
        endGame(msg.message);
        saveGameToFirebase("end-received");
    }
}

function broadcast(msg) {
    if (dataChannel && dataChannel.readyState === "open") {
        try { dataChannel.send(JSON.stringify(msg)); }
        catch (err) { console.error("Erreur d'envoi du data channel:", err); }
    }
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
                const gameSnap = await db.ref(`games/${gameId}`).once("value");
                const gameData = gameSnap.val();
                if (gameData && gameData.board) {
                    board = gameData.board;
                    currentPlayer = gameData.currentPlayer || 1;
                    history = gameData.history || [];
                    renderBoard();
                    updateScore();
                }
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

/* ========== Game actions ========== */
function playMove(x, y) {
    if (gameOver) return;
    if (myColor !== currentPlayer) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }
    if (!isLegalMove(x, y, currentPlayer, board)) return;
    const result = placeStone(x, y, currentPlayer, board);
    board = result.newState;
    history.push(boardToString(board));
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    consecutivePasses = 0;
    renderBoard();
    updateScore();
    const msg = { type: "move", board: board, currentPlayer: currentPlayer, history: history };
    broadcast(msg);
    saveGameToFirebase("move");
}
function passTurn() {
    if (gameOver) return;
    if (myColor !== currentPlayer) { showMessage(gameMessage, "Ce n'est pas votre tour !", "orange"); return; }
    consecutivePasses++;
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    renderBoard();
    updateScore();
    const msg = { type: "pass", currentPlayer: currentPlayer };
    broadcast(msg);
    saveGameToFirebase("pass");
    if (consecutivePasses >= 2) {
        endGame();
        saveGameToFirebase("end-by-passes");
    }
}
function resign() {
    if (gameOver) return;
    const winner = myColor === 1 ? "White" : "Black";
    const message = `${winner} gagne par abandon.`;
    endGame(message);
    const msg = { type: "end", message: message };
    broadcast(msg);
    saveGameToFirebase("resign");
    handleFinalRedirect();
}
function endGame(message) {
    gameOver = true;
    const { black, white } = computeScore(board);
    let result = message || (black > white ? "Le joueur Noir gagne !" : "Le joueur Blanc gagne !");
    showMessage(gameMessage, result, "lightgreen");
}

/* ========== Listeners + lifecycle ========== */
function resetGame() {
    if (gameRef) {
        try { gameRef.off(); } catch (e) { }
        gameRef = null;
    }
    if (dataChannel) try { dataChannel.close(); } catch (e) {}
    if (peerConnection) try { peerConnection.close(); } catch (e) {}
    dataChannel = null;
    peerConnection = null;
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    history = [];
    currentPlayer = 1;
    myColor = null;
    gameId = null;
    consecutivePasses = 0;
    gameOver = false;
    renderBoard();
    updateScore();
}

function handleFinalRedirect() {
    setTimeout(() => {
        resetGame();
        showScreen(lobbyScreen);
    }, 3000);
}

/* ========== Auth ========== */
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

/* ========== Game creation / joining ========== */
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

createGameBtn.onclick = async () => {
    try {
        showMessage(lobbyMessage, "Création de la partie...", "lightblue");
        await resetGame();
        gameId = await generateGameId();
        myColor = 1; // black player
        gameRef = db.ref(`games/${gameId}`);

        // Étape 1 : Créer la partie avec le joueur noir
        await gameRef.child('players/black').set({
            uid: myUid,
            email: auth.currentUser.email,
            nickname: myNickname
        });

        // Étape 2 : Mettre à jour les autres données de la partie
        await gameRef.update({
            status: "waiting",
            board: board,
            currentPlayer: currentPlayer,
            history: history,
            createdAt: Date.now(),
            expiresAt: Date.now() + 2 * 60 * 60 * 1000
        });

        gameLinkSection.style.display = "block";
        gameLinkDisplay.textContent = gameId;
        copyLinkBtn.textContent = "Copier le code";
        showMessage(lobbyMessage, `Partie créée. Code : ${gameId}. Partage-le avec ton adversaire.`, "lightgreen");

        const whiteRef = gameRef.child("players/white");
        whiteRef.on("value", snap => {
            if (snap.val() && !peerConnection) {
                startSignaling(true).catch(console.error);
            }
        });
    } catch (err) {
        console.error("Erreur lors de la création de la partie :", err);
        showMessage(lobbyMessage, "Erreur lors de la création de la partie.", "red");
    }
};

joinGameBtn.onclick = async () => {
    await resetGame();
    gameId = gameIdInput.value.trim();
    if (!gameId || isNaN(gameId)) { showMessage(lobbyMessage, "Entrez un code de partie valide.", "red"); return; }
    gameRef = db.ref(`games/${gameId}`);
    const gameSnap = await gameRef.once("value");
    const gameData = gameSnap.val();
    if (!gameSnap.exists()) { showMessage(lobbyMessage, "Partie introuvable !", "red"); return; }
    if (gameData.players && gameData.players.white) { showMessage(lobbyMessage, "Cette partie est déjà complète.", "red"); return; }
    if (gameData.status === "playing") { showMessage(lobbyMessage, "Cette partie est en cours.", "red"); return; }
    myColor = 2; // White
    await gameRef.child("players/white").set({ uid: myUid, email: auth.currentUser.email, nickname: myNickname });
    await gameRef.update({ status: "playing" });
    gameRef.on("value", snap => {
        const data = snap.val();
        if (!data) return;
        board = data.board;
        currentPlayer = data.currentPlayer;
        history = data.history || [];
        renderBoard();
        updateScore();
    });
    startSignaling(false).catch(console.error);
    showMessage(lobbyMessage, "Partie rejointe. Connexion en cours...", "lightgreen");
};

copyLinkBtn.onclick = () => {
    navigator.clipboard.writeText(gameLinkDisplay.textContent);
    showMessage(lobbyMessage, "Code copié !", "lightgreen");
};

/* ========== Canvas events ========== */
canvas.addEventListener("click", e => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / CELL_SIZE) - 1;
    const y = Math.round((e.clientY - rect.top) / CELL_SIZE) - 1;
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) playMove(x, y);
});
passButton.onclick = passTurn;
forfeitButton.onclick = resign;
mainPageLink.onclick = () => { resetGame(); showScreen(lobbyScreen); };

/* ========== Gestion des déconnexions et du nettoyage ========== */
window.addEventListener('beforeunload', (event) => {
    if (gameRef && myColor) {
        gameRef.child('status').set('disconnected').catch(e => console.error("Erreur de statut de déconnexion:", e));
    }
    resetGame();
});

/* ========== Initialisation ========== */
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    if (gameIdFromUrl) {
        try { document.getElementById("joinGameSection").style.display = "flex"; } catch(e){}
        gameIdInput.value = gameIdFromUrl;
    }
    renderBoard();
    updateScore();
}
init();