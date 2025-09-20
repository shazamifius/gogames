/* ================================
   Firebase configuration
================================= */
const firebaseConfig = {
  apiKey: "AIzaSyBUHwlZP9skcvX4lYwtWzNkuoI2Gc5FqFg",
  authDomain: "gogame-6fcc9.firebaseapp.com",
  databaseURL: "https://gogame-6fcc9-default-rtdb.firebaseio.com",
  projectId: "gogame-6fcc9",
  storageBucket: "gogame-6fcc9.appspot.com", // FIXED
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
const lobbyScreen = document.getElementById("lobbyScreen");
const gameScreen = document.getElementById("gameScreen");

const emailInput = document.getElementById("emailInput");
const passwordInput = document.getElementById("passwordInput");
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const authMessage = document.getElementById("authMessage");

const createGameBtn = document.getElementById("createGameBtn");
const joinGameBtn = document.getElementById("joinGameBtn");
const gameIdInput = document.getElementById("gameIdInput");
const joinGameSection = document.getElementById("joinGameSection");
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
  [authScreen, lobbyScreen, gameScreen].forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

function showMessage(el, text, color = "#bbb") {
  el.innerText = text;
  el.style.color = color;
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

  // Star points
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

  // Capture opponent chains
  const opponent = color === 1 ? 2 : 1;
  for (let [nx, ny] of getNeighbors(x, y)) {
    if (newState[ny][nx] === opponent) {
      const chain = getChain(nx, ny, opponent, new Set(), newState);
      if (getLiberties(chain, newState) === 0) {
        chain.forEach(([cx, cy]) => (newState[cy][cx] = 0));
      }
    }
  }

  // Check suicide
  const chain = getChain(x, y, color, new Set(), newState);
  if (getLiberties(chain, newState) === 0) return null;

  return newState;
}

function boardToString(state) {
  return state.map(r => r.join("")).join("|");
}

function isLegalMove(x, y, color, state) {
  if (state[y][x] !== 0) return false;
  const newState = placeStone(x, y, color, state);
  if (!newState) return false;

  // Superko: check against history
  const newStateStr = boardToString(newState);
  if (history.includes(newStateStr)) return false;

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
  if (myColor !== currentPlayer) return;
  consecutivePasses++;
  currentPlayer = currentPlayer === 1 ? 2 : 1;

  if (consecutivePasses >= 2) endGame();
  else broadcast({ type: "pass", currentPlayer });
}

function resign() {
  if (gameOver) return;
  endGame(myColor === 1 ? "White wins by resignation" : "Black wins by resignation");
}

function endGame(message) {
  gameOver = true;
  const { black, white } = computeScore(board);
  let result = message || (black > white ? "Black wins!" : "White wins!");
  showMessage(gameMessage, result, "lightgreen");
  broadcast({ type: "end", message: result });
}

/* ================================
   WebRTC functions
================================= */
function broadcast(msg) {
  if (dataChannel && dataChannel.readyState === "open") {
    dataChannel.send(JSON.stringify(msg));
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
    }
  };
}

/* ================================
   Firebase signaling
================================= */
async function startSignaling(gameId, isCreator) {
  peerConnection = new RTCPeerConnection(iceServers);

  if (isCreator) {
    dataChannel = peerConnection.createDataChannel("game");
    setupDataChannel(dataChannel);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await db.ref("games/" + gameId).update({ offer: offer });
  } else {
    peerConnection.ondatachannel = e => setupDataChannel(e.channel);
  }

  peerConnection.onicecandidate = e => {
    if (e.candidate) {
      const path = isCreator ? "creatorCandidates" : "joinerCandidates";
      db.ref(`games/${gameId}/${path}`).push(e.candidate);
    }
  };

  if (!isCreator) {
    const snap = await db.ref("games/" + gameId).once("value");
    const data = snap.val();
    if (data && data.offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await db.ref("games/" + gameId).update({ answer: answer });
    }
    db.ref("games/" + gameId + "/creatorCandidates").on("child_added", s => {
      peerConnection.addIceCandidate(new RTCIceCandidate(s.val()));
    });
  } else {
    db.ref("games/" + gameId + "/joinerCandidates").on("child_added", s => {
      peerConnection.addIceCandidate(new RTCIceCandidate(s.val()));
    });
    db.ref("games/" + gameId + "/answer").on("value", async s => {
      const answer = s.val();
      if (answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });
  }
}

/* ================================
   Auth events
================================= */
registerBtn.onclick = () => {
  auth.createUserWithEmailAndPassword(emailInput.value, passwordInput.value)
    .then(() => showMessage(authMessage, "Account created", "lightgreen"))
    .catch(err => showMessage(authMessage, err.message, "red"));
};

loginBtn.onclick = () => {
  auth.signInWithEmailAndPassword(emailInput.value, passwordInput.value)
    .then(() => showMessage(authMessage, "Logged in", "lightgreen"))
    .catch(err => showMessage(authMessage, err.message, "red"));
};

logoutBtn.onclick = () => auth.signOut();

/* ================================
   Auth state change
================================= */
auth.onAuthStateChanged(user => {
  if (user) {
    myUid = user.uid;
    showScreen(lobbyScreen);
  } else {
    showScreen(authScreen);
  }
});

/* ================================
   Lobby
================================= */
createGameBtn.onclick = () => {
  const gameId = Math.random().toString(36).substring(2, 9);
  myColor = 1;
  startSignaling(gameId, true);
  showMessage(lobbyMessage, "Game created. Waiting for opponent...", "lightgreen");
  gameLinkSection.style.display = "block";
  gameLinkDisplay.textContent = window.location.origin + window.location.pathname + "?gameId=" + gameId;
};

joinGameBtn.onclick = () => {
  const gameId = gameIdInput.value.trim();
  if (!gameId) return;
  myColor = 2;
  startSignaling(gameId, false);
  showMessage(lobbyMessage, "Joining game...", "lightgreen");
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

/* ================================
   Init
================================= */
renderBoard();
updateScore();
