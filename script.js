/* ================================
   Firebase configuration
================================= */
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

/* ================================
   DOM elements
================================= */
const authScreen = document.getElementById("authScreen");
const nicknameScreen = document.getElementById("nicknameScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");
const mainPageLink = document.getElementById("mainPageLink");
const logoutBtn = document.getElementById("logoutBtn"); // <-- New element

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
const gameMessage = document.getElementById("gameMessage");

const blackScoreEl = document.getElementById("blackScore");
const whiteScoreEl = document.getElementById("whiteScore");

const playerInfo = document.getElementById("playerInfo");

/* ================================
   Game constants
================================= */
const BOARD_SIZE = 19;
const KOMI = 7.5;
const CELL_SIZE = canvas.width / (BOARD_SIZE + 1);

let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
let history = []; // for Superko rule
let currentPlayer = 1; // 1 = black, 2 = white
let myColor = null;
let myUid = null;
let myNickname = null;
let gameId = null;

let consecutivePasses = 0;
let gameOver = false;

/* ================================
   WebRTC setup
================================= */
let peerConnection;
let dataChannel;
const iceServers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

/* ================================
   Helpers
================================= */
function showScreen(screen) {
    [authScreen, nicknameScreen, lobbyScreen, gameScreen].forEach(s =>
        s.classList.remove("active")
    );
    screen.classList.add("active");
}

function showMessage(el, text, color = "#bbb") {
    el.innerText = text;
    el.style.color = color;
}

function resetGame() {
    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    history = [];
    currentPlayer = 1;
    myColor = null;
    gameId = null;
    consecutivePasses = 0;
    gameOver = false;
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (dataChannel) {
        dataChannel = null;
    }
    renderBoard();
    updateScore();
}

function handleFinalRedirect() {
    setTimeout(() => {
        resetGame();
        showScreen(lobbyScreen);
    }, 3000); // 3-second delay
}

/* ================================
   Board utilities
================================= */
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
    star.forEach(x => {
        star.forEach(y => {
            ctx.beginPath();
            ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, 4, 0, 2 * Math.PI);
            ctx.fill();
        });
    });
}

function drawStones() {
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 1 || board[y][x] === 2) {
                ctx.beginPath();
                ctx.arc((x + 1) * CELL_SIZE, (y + 1) * CELL_SIZE, CELL_SIZE / 2.2, 0, 2 * Math.PI);
                ctx.fillStyle = board[y][x] === 1 ? "#000" : "#fff";
                ctx.fill();
                ctx.stroke();
            }
        }
    }
}

function renderBoard() {
    drawGrid();
    drawStones();
}

/* ================================
   Rules: chains, liberties, captures
================================= */
function getNeighbors(x, y) {
    return [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
    ].filter(([nx, ny]) => nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE);
}

function getChain(x, y, color, visited, state) {
    const chain = [];
    const queue = [[x, y]];
    visited.add(`${x},${y}`);
    while (queue.length) {
        const [cx, cy] = queue.pop();
        chain.push([cx, cy]);
        for (let [nx, ny] of getNeighbors(cx, cy)) {
            if (!visited.has(`${nx},${ny}`) && state[ny][nx] === color) {
                visited.add(`${nx},${ny}`);
                queue.push([nx, ny]);
            }
        }
    }
    return chain;
}

function getLiberties(chain, state) {
    const libs = new Set();
    for (let [x, y] of chain) {
        for (let [nx, ny] of getNeighbors(x, y)) {
            if (state[ny][nx] === 0) libs.add(`${nx},${ny}`);
        }
    }
    return libs.size;
}

function copyBoard(state) {
    return state.map(r => [...r]);
}

function placeStone(x, y, color, state) {
    const newState = copyBoard(state);
    newState[y][x] = color;

    const opponent = color === 1 ? 2 : 1;
    for (let [nx, ny] of getNeighbors(x, y)) {
        if (newState[ny][nx] === opponent) {
            const chain = getChain(nx, ny, opponent, new Set(), newState);
            if (getLiberties(chain, newState) === 0) {
                chain.forEach(([cx, cy]) => (newState[cy][cx] = 0));
            }
        }
    }

    const chain = getChain(x, y, color, new Set(), newState);
    if (getLiberties(chain, newState) === 0) return null;

    return newState;
}

function boardToString(state) {
    return state.map(r => r.join("")).join("|");
}

function isLegalMove(x, y, color, state) {
    if (state[y][x] !== 0) {
        showMessage(gameMessage, "This spot is already taken.", "orange");
        return false;
    }
    const newState = placeStone(x, y, color, state);
    if (!newState) {
        showMessage(gameMessage, "Suicide moves are not allowed.", "orange");
        return false;
    }

    const newStateStr = boardToString(newState);
    if (history.includes(newStateStr)) {
        showMessage(gameMessage, "Superko rule violation: cannot repeat a previous board state.", "orange");
        return false;
    }

    return true;
}

/* ================================
   Scoring
================================= */
function computeScore(state) {
    let black = 0;
    let white = 0;
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
                        if (state[ny][nx] === 0 && !visited.has(`${nx},${ny}`)) {
                            visited.add(`${nx},${ny}`);
                            queue.push([nx, ny]);
                        } else if (state[ny][nx] !== 0) {
                            borders.add(state[ny][nx]);
                        }
                    }
                }
                if (borders.size === 1) {
                    const owner = [...borders][0];
                    if (owner === 1) black += territory.length;
                    if (owner === 2) white += territory.length;
                }
            }
        }
    }

    white += KOMI;
    return { black, white };
}

/* ================================
   Game logic
================================= */
function playMove(x, y) {
    if (gameOver) return;
    if (myColor !== currentPlayer) {
        showMessage(gameMessage, "Not your turn!", "orange");
        return;
    }
    if (!isLegalMove(x, y, currentPlayer, board)) return;

    board = placeStone(x, y, currentPlayer, board);
    history.push(boardToString(board));
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    consecutivePasses = 0;
    renderBoard();
    updateScore();

    broadcast({ type: "move", board, currentPlayer, history });
}

function updateScore() {
    const { black, white } = computeScore(board);
    blackScoreEl.textContent = `Black: ${black}`;
    whiteScoreEl.textContent = `White: ${white.toFixed(1)}`;
}

function passTurn() {
    if (gameOver) return;
    if (myColor !== currentPlayer) {
        showMessage(gameMessage, "Not your turn!", "orange");
        return;
    }
    consecutivePasses++;
    currentPlayer = currentPlayer === 1 ? 2 : 1;

    if (consecutivePasses >= 2) endGame();
    else broadcast({ type: "pass", currentPlayer });
}

function resign() {
    if (gameOver) return;
    const winner = myColor === 1 ? "White" : "Black";
    endGame(`${winner} wins by resignation.`);
    broadcast({ type: "end", message: `${winner} wins by resignation.` });
    handleFinalRedirect();
}

function endGame(message) {
    gameOver = true;
    const { black, white } = computeScore(board);
    let result = message || (black > white ? "Black wins!" : "White wins!");
    showMessage(gameMessage, result, "lightgreen");
}

/* ================================
   WebRTC functions
================================= */
function broadcast(msg) {
    if (dataChannel && dataChannel.readyState === "open") {
        dataChannel.send(JSON.stringify(msg));
    } else {
        console.error("Data channel not open. Cannot send message.");
    }
}

function setupDataChannel(channel) {
    dataChannel = channel;
    dataChannel.onmessage = e => {
        const msg = JSON.parse(e.data);
        if (msg.type === "move") {
            board = msg.board;
            currentPlayer = msg.currentPlayer;
            history = msg.history;
            renderBoard();
            updateScore();
        } else if (msg.type === "pass") {
            currentPlayer = msg.currentPlayer;
            consecutivePasses++;
            if (consecutivePasses >= 2) endGame();
        } else if (msg.type === "end") {
            endGame(msg.message);
            handleFinalRedirect();
        }
    };
    dataChannel.onopen = () => {
        showMessage(gameMessage, "Connection established. Let's play!", "lightgreen");
    };
    dataChannel.onclose = () => {
        showMessage(gameMessage, "Opponent disconnected. Game over.", "red");
        gameOver = true;
        handleFinalRedirect();
    };
}

/* ================================
   Firebase signaling
================================= */
async function startSignaling(isCreator) {
    peerConnection = new RTCPeerConnection(iceServers);

    if (isCreator) {
        dataChannel = peerConnection.createDataChannel("game");
        setupDataChannel(dataChannel);
    } else {
        peerConnection.ondatachannel = e => setupDataChannel(e.channel);
    }

    peerConnection.onicecandidate = e => {
        if (e.candidate) {
            const path = isCreator ? "creatorCandidates" : "joinerCandidates";
            db.ref(`games/${gameId}/${path}`).push(e.candidate);
        }
    };

    if (isCreator) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await db.ref("games/" + gameId).update({ offer: offer });
    } else {
        const snap = await db.ref("games/" + gameId).once("value");
        const data = snap.val();
        if (data && data.offer) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            await db.ref("games/" + gameId).update({ answer: answer });
        }
    }
}

/* ================================
   Auth events
================================= */
registerBtn.onclick = () => {
    auth.createUserWithEmailAndPassword(emailInput.value, passwordInput.value)
        .then(() => showMessage(authMessage, "Account created. You are now logged in.", "lightgreen"))
        .catch(err => showMessage(authMessage, err.message, "red"));
};

loginBtn.onclick = () => {
    auth.signInWithEmailAndPassword(emailInput.value, passwordInput.value)
        .then(() => showMessage(authMessage, "Logged in successfully!", "lightgreen"))
        .catch(err => showMessage(authMessage, err.message, "red"));
};

logoutBtn.onclick = () => {
    auth.signOut().then(() => {
        showMessage(authMessage, "Logged out successfully.", "lightgreen");
    }).catch(err => showMessage(authMessage, err.message, "red"));
};


saveNicknameBtn.onclick = async() => {
    const nickname = nicknameInput.value.trim();
    if (nickname.length < 3) {
        showMessage(nicknameMessage, "Nickname must be at least 3 characters long.", "red");
        return;
    }
    await db.ref("users/" + myUid).set({
        email: auth.currentUser.email,
        nickname: nickname
    });
    myNickname = nickname;
    playerInfo.textContent = `${myNickname} (${auth.currentUser.email})`;
    showScreen(lobbyScreen);
};

/* ================================
   Auth state change
================================= */
auth.onAuthStateChanged(async user => {
    if (user) {
        myUid = user.uid;
        logoutBtn.style.display = "block"; // Show logout button
        const snap = await db.ref("users/" + myUid).once("value");
        myNickname = snap.val() ? snap.val().nickname : null;

        if (!myNickname) {
            showScreen(nicknameScreen);
        } else {
            playerInfo.textContent = `${myNickname} (${user.email})`;
            showScreen(lobbyScreen);
        }
    } else {
        myUid = null;
        myNickname = null;
        playerInfo.textContent = "Not connected";
        logoutBtn.style.display = "none"; // Hide logout button
        showScreen(authScreen);
    }
});

/* ================================
   Lobby
================================= */
createGameBtn.onclick = async() => {
    gameId = Math.random().toString(36).substring(2, 9);
    myColor = 1;

    await db.ref("games/" + gameId).set({
        status: "waiting",
        players: {
            black: {
                uid: myUid,
                email: auth.currentUser.email,
                nickname: myNickname
            }
        }
    });

    gameLinkSection.style.display = "block";
    gameLinkDisplay.textContent = window.location.origin + window.location.pathname + "?gameId=" + gameId;
    showMessage(lobbyMessage, "Game created, waiting for opponent...", "lightgreen");

    db.ref("games/" + gameId + "/players/white").on("value", s => {
        const whitePlayer = s.val();
        if (whitePlayer && !peerConnection) {
            startSignaling(true);
            db.ref("games/" + gameId + "/answer").on("value", async s => {
                const answer = s.val();
                if (answer) {
                    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                    showScreen(gameScreen);
                    showMessage(gameMessage, "Opponent joined! Game starts.");
                    db.ref("games/" + gameId + "/answer").off("value");
                    db.ref("games/" + gameId + "/joinerCandidates").on("child_added", s => {
                        peerConnection.addIceCandidate(new RTCIceCandidate(s.val()));
                    });
                }
            });
        }
    });
};

joinGameBtn.onclick = async() => {
    gameId = gameIdInput.value.trim();
    if (!gameId) {
        showMessage(lobbyMessage, "Please enter a game ID.", "red");
        return;
    }

    const gameRef = db.ref("games/" + gameId);
    const gameSnap = await gameRef.once("value");
    const gameData = gameSnap.val();

    if (!gameSnap.exists()) {
        showMessage(lobbyMessage, "Game not found!", "red");
        return;
    }
    if (gameData.players.white) {
        showMessage(lobbyMessage, "This game is already full.", "red");
        return;
    }

    myColor = 2;
    await gameRef.child("players/white").set({
        uid: myUid,
        email: auth.currentUser.email,
        nickname: myNickname
    });
    await gameRef.update({ status: "playing" });

    startSignaling(false);
    showMessage(lobbyMessage, "Joined game!", "lightgreen");
    showScreen(gameScreen);

    // Add listeners for signaling
    db.ref("games/" + gameId + "/creatorCandidates").on("child_added", s => {
        peerConnection.addIceCandidate(new RTCIceCandidate(s.val()));
    });
};

copyLinkBtn.onclick = () => {
    navigator.clipboard.writeText(gameLinkDisplay.textContent);
    showMessage(lobbyMessage, "Link copied!", "lightgreen");
};

/* ================================
   Game events
================================= */
canvas.addEventListener("click", e => {
    if (gameOver) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / CELL_SIZE) - 1;
    const y = Math.round((e.clientY - rect.top) / CELL_SIZE) - 1;
    if (x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE) {
        playMove(x, y);
    }
});

passButton.onclick = passTurn;
forfeitButton.onclick = resign;
mainPageLink.onclick = () => {
    resetGame();
    showScreen(lobbyScreen);
};

/* ================================
   Init
================================= */
function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');
    if (gameIdFromUrl) {
        document.getElementById("joinGameSection").style.display = "flex";
        gameIdInput.value = gameIdFromUrl;
    }
    renderBoard();
    updateScore();
}

init();