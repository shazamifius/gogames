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
let hoverPoint = null;

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
        ctx.strokeStyle = "#000"; // Changé de "#fff" à "#000"
        ctx.lineWidth = 1;
        ctx.stroke();
    }));
}
/* ========== GESTION DU SURVOL (OVER POINT) ========== */

function drawHoverPoint() {
    if (hoverPoint) {
        const [x, y, isLegal] = hoverPoint;

        if (isLegal) {
            // Dessine le pion de survol
            ctx.beginPath();
            ctx.fillStyle = myColor === 1 ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
            ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, CELL_SIZE / 2.2, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = myColor === 1 ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            // Dessine la croix
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Couleur rouge pour la croix
            ctx.lineWidth = 4;
            ctx.beginPath();
            // Première ligne de la croix
            ctx.moveTo((x + 1) * CELL_SIZE - CELL_SIZE / 3, (y + 1) * CELL_SIZE - CELL_SIZE / 3);
            ctx.lineTo((x + 1) * CELL_SIZE + CELL_SIZE / 3, (y + 1) * CELL_SIZE + CELL_SIZE / 3);
            // Deuxième ligne de la croix
            ctx.moveTo((x + 1) * CELL_SIZE + CELL_SIZE / 3, (y + 1) * CELL_SIZE - CELL_SIZE / 3);
            ctx.lineTo((x + 1) * CELL_SIZE - CELL_SIZE / 3, (y + 1) * CELL_SIZE + CELL_SIZE / 3);
            ctx.stroke();
        }
    }
}

// Fonction pour mettre à jour la position du point de survol
function updateHoverPoint(e) {
    if (gameOver || myColor !== currentPlayer) {
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

    const x = Math.round(((clientX - rect.left) * scaleX) / CELL_SIZE) - 1;
    const y = Math.round(((clientY - rect.top) * scaleY) / CELL_SIZE) - 1;

    // On vérifie si le coup est légal avant de dessiner
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        const isLegal = isLegalMove(x, y, currentPlayer, board);
        if (isLegal) {
            if (!hoverPoint || hoverPoint[0] !== x || hoverPoint[1] !== y || hoverPoint[2] !== true) {
                hoverPoint = [x, y, true]; // Ajout d'un 3e élément pour dire que c'est un point
                renderBoard();
            }
        } else {
            if (!hoverPoint || hoverPoint[0] !== x || hoverPoint[1] !== y || hoverPoint[2] !== false) {
                hoverPoint = [x, y, false]; // Ajout d'un 3e élément pour dire que c'est une croix
                renderBoard();
            }
        }
    } else {
        if (hoverPoint) {
            hoverPoint = null;
            renderBoard();
        }
    }
}


function drawStones() {
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 || board[y][x] === 2) {
                ctx.beginPath();
                ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, CELL_SIZE / 2.2, 0, 2 * Math.PI);
                
                // On réinitialise l'ombre juste au cas où une autre fonction l'aurait activée
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;

                // On dessine le pion sans ombre
                if (board[y][x] === 1) { // Pion noir
                    ctx.fillStyle = "#000";
                } else { // Pion blanc
                    ctx.fillStyle = "#fff";
                }
                ctx.fill();

                // Dessine le contour après
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
    drawHoverPoint();
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
async function saveGameToFirebase(dataToUpdate) {
    if (!gameRef || !gameId) return;
    try {
        await gameRef.update({
            ...dataToUpdate,
            lastUpdateBy: myUid || "unknown",
            lastUpdateAt: Date.now(), // C'est l'horodatage qu'on va utiliser !
            status: gameOver ? "finished" : "playing"
        });
    } catch (err) {
        console.error("Erreur de sauvegarde Firebase:", err);
    }
}

function applyRemoteGameData(data) {
    // Cette fonction n'est plus utilisée, car tout passe par l'écouteur
    // pour une logique unifiée.
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
    // Cette fonction n'est plus utilisée, tout est géré par l'écouteur Firebase
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
    // WebRTC n'est plus la méthode de synchronisation principale. 
    // On conserve le code pour l'établissement de la connexion,
    // mais la logique de jeu est maintenant centralisée sur Firebase.
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



/* ========== Game actions ========== */
function playMove(x, y) {
    if (gameOver) return;
    if (myColor !== currentPlayer) {
        showMessage(gameMessage, "Ce n'est pas votre tour !", "orange");
        return;
    }
    
    if (!isLegalMove(x, y, currentPlayer, board)) {
        return;
    }

    const { newState: proposedBoardState } = placeStone(x, y, currentPlayer, board);
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    
    saveGameToFirebase({
        board: proposedBoardState,
        currentPlayer: nextPlayer,
        history: [...history, boardToString(proposedBoardState)],
        consecutivePasses: 0,
        lastReason: "move"
    });
}
function passTurn() {
    if (gameOver) return;
    if (myColor !== currentPlayer) {
        showMessage(gameMessage, "Ce n'est pas votre tour !", "orange");
        return;
    }
    
    const nextPlayer = currentPlayer === 1 ? 2 : 1;
    const nextPasses = consecutivePasses + 1;
    
    saveGameToFirebase({
        currentPlayer: nextPlayer,
        consecutivePasses: nextPasses,
        lastReason: "pass"
    });
}
function resign() {
    if (gameOver) return;
    const winner = myColor === 1 ? "Blanc" : "Noir";
    const message = `Le joueur ${winner} gagne par abandon.`;
    
    saveGameToFirebase({
        gameOver: true,
        lastReason: message
    });
}
function endGame(message) {
    gameOver = true;
    const { black, white } = computeScore(board);
    let result = message || (black > white ? "Le joueur Noir gagne !" : "Le joueur Blanc gagne !");
    showMessage(gameMessage, result, "lightgreen");

    // **NOUVEAU** : Suppression de la partie après 5 secondes.
    setTimeout(async () => {
        if (gameRef && myColor) {
            try {
                // On vérifie le statut pour s'assurer que la partie est bien terminée
                const snap = await gameRef.once("value");
                if (snap.val() && snap.val().status === 'finished') {
                    // Vérifier si je suis l'un des joueurs avant de tenter de la supprimer
                    if (snap.val().players.black.uid === myUid || snap.val().players.white.uid === myUid) {
                        await gameRef.remove();
                        console.log(`Partie ${gameId} supprimée après 5 secondes.`);
                        resetGame();
                        showScreen(lobbyScreen);
                        showMessage(lobbyMessage, "La partie est terminée et a été supprimée.", "green");
                    }
                }
            } catch (err) {
                console.error("Erreur de suppression de la partie:", err);
            }
        }
    }, 5000); // 5000 ms = 5 secondes
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

// Fonction pour gérer toutes les mises à jour de la partie
function setupGameListener() {
    if (!gameRef) {
        console.error("gameRef n'est pas défini. Impossible de configurer l'écouteur.");
        return;
    }
    
    gameRef.on('value', snapshot => {
        const gameData = snapshot.val();
        
        if (!gameData) {
            resetGame();
            showScreen(lobbyScreen);
            showMessage(lobbyMessage, "La partie a été supprimée.", "red");
            return;
        }

        // On ne met à jour les variables que si l'état du jeu est valide
        board = gameData.board || board;
        currentPlayer = gameData.currentPlayer || currentPlayer;
        history = gameData.history || [];
        consecutivePasses = gameData.consecutivePasses || 0;
        
        // Met à jour l'affichage
        renderBoard();
        updateScore();
        
        // Si le statut passe à "playing", on change d'écran
        if (gameData.status === 'playing' && document.getElementById("gameScreen").classList.contains("active") === false) {
             showScreen(gameScreen);
             showMessage(gameMessage, "Un adversaire a rejoint ! La partie commence.", "lightgreen");
        }
        
        // La fin de la partie est gérée par la base de données
        if (gameData.status === "finished" && !gameOver) {
            gameOver = true;
            endGame(gameData.lastReason || "La partie est terminée.");
        }
        
        // Affiche un message de statut
        else if (gameData.status === 'waiting') {
             showMessage(gameMessage, "En attente d'un adversaire...", "lightblue");
        } else if (!gameOver) {
             showMessage(gameMessage, `C'est au tour de ${currentPlayer === 1 ? 'Noir' : 'Blanc'}.`, "lightgreen");
        }
    });
}


// Fonction pour gérer le clean des parties anciennes
async function cleanUpOldGames() {
    const gamesRef = db.ref('games');
    const now = Date.now();
    const fortyEightHoursInMs = 48 * 60 * 60 * 1000;

    try {
        const snapshot = await gamesRef.once('value');
        if (snapshot.exists()) {
            const games = snapshot.val();
            const updates = {};
            let gamesDeletedCount = 0;

            for (const gameId in games) {
                const game = games[gameId];
                const lastActivity = game.lastUpdateAt || game.createdAt;
                
                if (game.status === 'finished' || game.status === 'expired') {
                    continue;
                }

                // La condition utilise maintenant 48 heures
                if (now - lastActivity > fortyEightHoursInMs) {
                    updates[`${gameId}/status`] = 'expired';
                    console.log(`Partie ${gameId} marquée comme expirée.`);
                    gamesDeletedCount++;
                }
            }

            if (Object.keys(updates).length > 0) {
                await gamesRef.update(updates);
                console.log(`${gamesDeletedCount} parties expirées mises à jour.`);
            }
        }
    } catch (error) {
        console.error("Erreur lors du nettoyage des parties:", error);
    }
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

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showMessage(lobbyMessage, "Code de la partie copié !", "lightgreen");
    } catch (err) {
        console.error("Erreur de copie :", err);
        showMessage(lobbyMessage, "Impossible de copier. Veuillez le faire manuellement.", "orange");
    }
}

copyLinkBtn.onclick = () => {
    const gameIdText = gameLinkDisplay.textContent;
    if (gameIdText) {
        copyToClipboard(gameIdText);
    }
};

createGameBtn.onclick = async () => {
    try {
        gameId = await generateGameId();
        gameRef = db.ref('games/' + gameId);
        
        if (!auth.currentUser) {
            showMessage(lobbyMessage, "Vous devez être connecté pour créer une partie.", "red");
            return;
        }

        const gameData = {
            status: "waiting",
            players: {
                black: { uid: myUid, email: auth.currentUser.email, nickname: myNickname }
            },
            board: board,
            currentPlayer: currentPlayer,
            history: history,
            createdAt: Date.now(),
            expiresAt: Date.now() + 2 * 60 * 60 * 1000,
            consecutivePasses: 0
        };

        await gameRef.set(gameData);
        myColor = 1;

        showMessage(lobbyMessage, `Partie créée. Code : ${gameId}. Partagez-le avec votre adversaire.`, 'lightgreen');
        gameLinkDisplay.textContent = gameId;
        gameLinkSection.style.display = 'block';

        await copyToClipboard(gameId);
        
        setupGameListener();

    } catch (e) {
        console.error("Erreur lors de la création de la partie :", e);
        showMessage(lobbyMessage, "Erreur lors de la création de la partie.", "red");
    }
};


/* ========== Game creation / joining ========== */
// (Le reste de ton code reste le même, y compris la fonction createGameBtn.onclick)

async function joinGame() {
    const gameIdInputVal = gameIdInput.value.trim();
    if (gameIdInputVal.length !== 4) {
        showMessage(lobbyMessage, "Veuillez entrer un code de partie à 4 chiffres.", "red");
        return;
    }

    gameRef = db.ref('games/' + gameIdInputVal);
    showMessage(lobbyMessage, "Partie rejointe. Connexion en cours...", "lightgreen");

    try {
        const snapshot = await gameRef.once('value');
        const gameData = snapshot.val();

        if (!gameData || gameData.status !== 'waiting' || gameData.players.white) {
            showMessage(lobbyMessage, "Partie introuvable ou déjà en cours.", "red");
            return;
        }

        await gameRef.update({
            'players/white': { uid: myUid, email: auth.currentUser.email, nickname: myNickname },
            status: 'playing'
        });
        
        gameId = gameIdInputVal;
        myColor = 2;

        setupGameListener();
        
        showScreen(gameScreen);
        showMessage(gameMessage, "Partie rejointe. En attente du coup de l'adversaire...", "lightgreen");

    } catch (error) {
        console.error("Erreur lors de la jonction de la partie:", error);
        showMessage(lobbyMessage, "Erreur lors de la jonction. Veuillez réessayer.", "red");
    }
}

// Maintenant, le bouton d'adhésion appelle simplement la fonction
joinGameBtn.onclick = joinGame;



/* ========== Canvas events ========== */

// Fonction pour dessiner le point de survol
function drawHoverPoint() {
    if (hoverPoint) {
        const [x, y, isLegal] = hoverPoint;

        if (isLegal) {
            // Dessine le pion de survol
            ctx.beginPath();
            ctx.fillStyle = currentPlayer === 1 ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.4)';
            ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, CELL_SIZE / 2.2, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = currentPlayer === 1 ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            // Dessine la croix
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)'; // Couleur rouge pour la croix
            ctx.lineWidth = 4;
            ctx.beginPath();
            // Première ligne de la croix
            ctx.moveTo((x + 1) * CELL_SIZE - CELL_SIZE / 3, (y + 1) * CELL_SIZE - CELL_SIZE / 3);
            ctx.lineTo((x + 1) * CELL_SIZE + CELL_SIZE / 3, (y + 1) * CELL_SIZE + CELL_SIZE / 3);
            // Deuxième ligne de la croix
            ctx.moveTo((x + 1) * CELL_SIZE + CELL_SIZE / 3, (y + 1) * CELL_SIZE - CELL_SIZE / 3);
            ctx.lineTo((x + 1) * CELL_SIZE - CELL_SIZE / 3, (y + 1) * CELL_SIZE + CELL_SIZE / 3);
            ctx.stroke();
        }
    }
}

// Fonction pour mettre à jour la position du point de survol
function updateHoverPoint(e) {
    if (gameOver || myColor !== currentPlayer) {
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

    const x = Math.round(((clientX - rect.left) * scaleX) / CELL_SIZE) - 1;
    const y = Math.round(((clientY - rect.top) * scaleY) / CELL_SIZE) - 1;

    let isLegal; // La variable est déclarée ici !

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

// Écouteur pour le clic (pour placer un pion)
canvas.addEventListener("click", e => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.round(((e.clientX - rect.left) * scaleX) / CELL_SIZE) - 1;
    const y = Math.round(((e.clientY - rect.top) * scaleY) / CELL_SIZE) - 1;

    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        playMove(x, y);
    }
});

// Écouteurs pour le survol
canvas.addEventListener("mousemove", updateHoverPoint);
canvas.addEventListener("touchmove", updateHoverPoint);

// Écouteurs pour la sortie du canvas
canvas.addEventListener("mouseout", () => {
    hoverPoint = null;
    renderBoard();
});

canvas.addEventListener("touchend", () => {
    hoverPoint = null;
    renderBoard();
});



/* ========== Clipboard detection ========== */
function setupClipboardDetection() {
    window.addEventListener('paste', async (event) => {
        // S'assurer que nous sommes sur le bon écran (le salon de jeu)
        if (!lobbyScreen.classList.contains("active")) {
            return;
        }

        try {
            const clipboardText = await navigator.clipboard.readText();
            const gameIdPattern = /^\d{4}$/; // Regex pour 4 chiffres
            
            if (gameIdPattern.test(clipboardText)) {
                // Le texte est un code de partie valide, on tente de rejoindre
                showMessage(lobbyMessage, "Code de partie détecté dans le presse-papiers. Connexion automatique...", "lightblue");
                
                // On met à jour l'input pour que l'utilisateur le voie
                gameIdInput.value = clipboardText;

                // Lancement de la logique de connexion à la partie
                await joinGame();
            }
        } catch (err) {
            console.error("Impossible de lire le presse-papiers :", err);
            // On peut ne rien faire ici, car cela ne nuit pas à l'expérience
        }
    });
}

/* ========== Initialisation ========== */
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    if (gameIdFromUrl) {
        try { document.getElementById("joinGameSection").style.display = "flex"; } catch(e){}
        gameIdInput.value = gameIdFromUrl;
    }
    setupClipboardDetection();
    renderBoard();
    updateScore();
    
    // **NOUVEAU** : On appelle la fonction de nettoyage ici.
    cleanUpOldGames();
}
init();