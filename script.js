// Ton code Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBUHwlZP9skcvX4lYwtWzNkuoI2Gc5FqFg",
    authDomain: "gogame-6fcc9.firebaseapp.com",
    databaseURL: "https://gogame-6fcc9-default-rtdb.firebaseio.com",
    projectId: "gogame-6fcc9",
    storageBucket: "gogame-6fcc9.firebasestorage.app",
    messagingSenderId: "489232590919",
    appId: "1:489232590919:web:ecc32c7aeeaffe7e9e2962",
    measurementId: "G-Q7XJMBB0WK"
};

// Initialise Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const auth = firebase.auth();

// Éléments du DOM
const authScreen = document.getElementById('authScreen');
const welcomeScreen = document.getElementById('welcomeScreen');
const gameScreen = document.getElementById('gameScreen');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const registerBtn = document.getElementById('registerBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');
const statusText = document.getElementById('statusText');
const createGameBtn = document.getElementById('createGameBtn');
const joinGameBtn = document.getElementById('joinGameBtn');
const gameIdInput = document.getElementById('gameIdInput');
const joinGameSection = document.getElementById('joinGameSection');
const gameLinkDisplay = document.getElementById('gameLinkDisplay');
const gameLinkSection = document.getElementById('gameLinkSection');
const canvas = document.getElementById('goBoard');
const ctx = canvas.getContext('2d');

const boardSize = 19;
const cellSize = canvas.width / (boardSize + 1);

let board = [];
for (let i = 0; i < boardSize; i++) {
    board[i] = new Array(boardSize).fill(0);
}

let currentPlayer = 1; // 1 pour le noir, 2 pour le blanc
let lastMove = null;
let currentHover = null;
let myPlayerColor = null;
let myUid = null;

let blackStonesCount = 0;
let whiteStonesCount = 0;
let blackTerritory = 0;
let whiteTerritory = 0;
const KOMI = 7.5;

const stoneBlack = new Image();
stoneBlack.src = 'stone_black.png';
const stoneWhite = new Image();
stoneWhite.src = 'stone_white.png';
const lastMoveMarker = new Image();
lastMoveMarker.src = 'last_move_marker.png';
const hoverMarker = new Image();
hoverMarker.src = 'hover_marker.png';
const impossibleMarker = new Image();
impossibleMarker.src = 'impossible.png';

let isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let lastTouchTime = 0;

// WebRTC variables
let peerConnection;
let dataChannel;
const iceServers = {
    'iceServers': [
        { 'urls': 'stun:stun.l.google.com:19302' },
        { 'urls': 'stun:stun1.l.google.com:19302' }
    ]
};

// Fonctions de dessin et de règles de jeu
const drawGrid = () => {
    ctx.beginPath();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;

    for (let i = 1; i <= boardSize; i++) {
        ctx.moveTo(i * cellSize, cellSize);
        ctx.lineTo(i * cellSize, boardSize * cellSize);
        ctx.moveTo(cellSize, i * cellSize);
        ctx.lineTo(boardSize * cellSize, i * cellSize);
    }
    ctx.stroke();

    const starPoints = [
        [3, 3], [3, 9], [3, 15],
        [9, 3], [9, 9], [9, 15],
        [15, 3], [15, 9], [15, 15]
    ];
    starPoints.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc((x + 1) * cellSize, (y + 1) * cellSize, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
    });
};

const drawBoard = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            const stoneX = (x + 1) * cellSize;
            const stoneY = (y + 1) * cellSize;

            if (board[y][x] === 1) {
                ctx.drawImage(stoneBlack, stoneX - cellSize / 2, stoneY - cellSize / 2, cellSize, cellSize);
            } else if (board[y][x] === 2) {
                ctx.drawImage(stoneWhite, stoneX - cellSize / 2, stoneY - cellSize / 2, cellSize, cellSize);
            }
        }
    }

    if (lastMove) {
        const [x, y] = lastMove;
        const markerX = (x + 1) * cellSize;
        const markerY = (y + 1) * cellSize;
        ctx.drawImage(lastMoveMarker, markerX - cellSize / 2, markerY - cellSize / 2, cellSize, cellSize);
    }

    if (currentHover) {
        const [x, y] = currentHover;
        const isIllegal = isMoveIllegal(x, y, currentPlayer);
        const marker = isIllegal ? impossibleMarker : hoverMarker;
        const markerX = (x + 1) * cellSize;
        const markerY = (y + 1) * cellSize;
        ctx.drawImage(marker, markerX - cellSize / 2, markerY - cellSize / 2, cellSize, cellSize);
    }
};

const getNeighbors = (x, y) => {
    const neighbors = [];
    if (x > 0) neighbors.push([x - 1, y]);
    if (x < boardSize - 1) neighbors.push([x + 1, y]);
    if (y > 0) neighbors.push([x, y - 1]);
    if (y < boardSize - 1) neighbors.push([x, y + 1]);
    return neighbors;
};

const getChain = (x, y, color, visited, currentBoard) => {
    const chain = [];
    const queue = [[x, y]];
    visited.add(`${x},${y}`);

    while (queue.length > 0) {
        const [currX, currY] = queue.shift();
        chain.push([currX, currY]);

        for (const [nextX, nextY] of getNeighbors(currX, currY)) {
            if (!visited.has(`${nextX},${nextY}`) && currentBoard[nextY][nextX] === color) {
                visited.add(`${nextX},${nextY}`);
                queue.push([nextX, nextY]);
            }
        }
    }
    return chain;
};

const getLiberties = (chain, currentBoard) => {
    const liberties = new Set();
    for (const [x, y] of chain) {
        for (const [neighborX, neighborY] of getNeighbors(x, y)) {
            if (currentBoard[neighborY][neighborX] === 0) {
                liberties.add(`${neighborX},${neighborY}`);
            }
        }
    }
    return liberties.size;
};

const isMoveIllegal = (x, y, color) => {
    if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return true;
    if (board[y][x] !== 0) return true;

    let tempBoard = JSON.parse(JSON.stringify(board));
    tempBoard[y][x] = color;
    
    const opponentColor = color === 1 ? 2 : 1;
    let capturedStones = 0;
    const visited = new Set();
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (tempBoard[ny][nx] === opponentColor && !visited.has(`${nx},${ny}`)) {
            const chain = getChain(nx, ny, opponentColor, visited, tempBoard);
            if (getLiberties(chain, tempBoard) === 0) {
                capturedStones += chain.length;
            }
        }
    }
    
    const newChain = getChain(x, y, color, new Set(), tempBoard);
    if (getLiberties(newChain, tempBoard) === 0 && capturedStones === 0) {
        return true;
    }
    
    return false;
};

const captureStones = (lastX, lastY) => {
    const opponentColor = currentPlayer === 1 ? 2 : 1;
    const visited = new Set();
    let captured = 0;
    
    for (const [x, y] of getNeighbors(lastX, lastY)) {
        if (board[y][x] === opponentColor && !visited.has(`${x},${y}`)) {
            const chain = getChain(x, y, opponentColor, visited, board);
            if (getLiberties(chain, board) === 0) {
                for (const [stoneX, stoneY] of chain) {
                    board[stoneY][stoneX] = 0;
                    captured++;
                }
            }
        }
    }
    return captured;
};

const findTerritory = (x, y, visited) => {
    const territory = new Set();
    const queue = [[x, y]];
    visited.add(`${x},${y}`);
    let owner = 0; 
    let borders = new Set();

    while (queue.length > 0) {
        const [currX, currY] = queue.shift();
        territory.add(`${currX},${currY}`);

        for (const [nextX, nextY] of getNeighbors(currX, currY)) {
            if (board[nextY][nextX] === 0 && !visited.has(`${nextX},${nextY}`)) {
                visited.add(`${nextX},${nextY}`);
                queue.push([nextX, nextY]);
            } else if (board[nextY][nextX] !== 0) {
                borders.add(board[nextY][nextX]);
            }
        }
    }
    
    if (borders.size === 1) {
        owner = Array.from(borders)[0];
    }
    
    return { size: territory.size, owner };
};

const updateScore = () => {
    blackStonesCount = 0;
    whiteStonesCount = 0;
    blackTerritory = 0;
    whiteTerritory = 0;
    
    const visited = new Set();

    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            const stone = board[y][x];
            if (stone === 1) {
                blackStonesCount++;
            } else if (stone === 2) {
                whiteStonesCount++;
            } else if (stone === 0 && !visited.has(`${x},${y}`)) {
                const { size, owner } = findTerritory(x, y, visited);
                if (owner === 1) {
                    blackTerritory += size;
                } else if (owner === 2) {
                    whiteTerritory += size;
                }
            }
        }
    }

    const blackScore = blackStonesCount + blackTerritory;
    const whiteScore = whiteStonesCount + whiteTerritory + KOMI;

    document.getElementById('blackScore').innerText = `Noir : ${blackScore}`;
    document.getElementById('whiteScore').innerText = `Blanc : ${whiteScore}`;
};

// Fonctions de jeu et de logique de coup
const placeStone = (event) => {
    if (currentPlayer !== myPlayerColor) {
        alert("Ce n'est pas votre tour !");
        return;
    }

    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX || event.touches[0].clientX;
    const clientY = event.clientY || event.touches[0].clientY;

    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const gridX = Math.round(mouseX / cellSize) - 1;
    const gridY = Math.round(mouseY / cellSize) - 1;

    if (isMoveIllegal(gridX, gridY, currentPlayer)) {
        return;
    }

    board[gridY][gridX] = currentPlayer;
    captureStones(gridX, gridY);
    
    lastMove = [gridX, gridY];
    
    dataChannel.send(JSON.stringify({ type: 'move', board: board, lastMove: lastMove }));
    
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    drawBoard();
    updateScore();
    if (isTouchDevice) currentHover = null;
};

const handlePointerMove = (event) => {
    if (isTouchDevice) return;
    if (currentPlayer !== myPlayerColor) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridX = Math.round(mouseX / cellSize) - 1;
    const gridY = Math.round(mouseY / cellSize) - 1;

    if (gridX >= 0 && gridX < boardSize && gridY >= 0 && gridY < boardSize) {
        currentHover = [gridX, gridY];
    } else {
        currentHover = null;
    }
    drawBoard();
};

const handlePointerDown = (event) => {
    if (isTouchDevice) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTouchTime;
        const rect = canvas.getBoundingClientRect();
        const touchX = event.touches[0].clientX - rect.left;
        const touchY = event.touches[0].clientY - rect.top;
        const gridX = Math.round(touchX / cellSize) - 1;
        const gridY = Math.round(touchY / cellSize) - 1;

        if (tapLength < 500 && tapLength > 0 && currentHover && currentHover[0] === gridX && currentHover[1] === gridY) {
            placeStone(event);
            lastTouchTime = 0;
            currentHover = null;
        } else {
            lastTouchTime = currentTime;
            if (gridX >= 0 && gridX < boardSize && gridY >= 0 && gridY < boardSize) {
                currentHover = [gridX, gridY];
                drawBoard();
            }
        }
    } else {
        placeStone(event);
    }
};

// Fonctions de connexion P2P
const createPeerConnection = async (isCreator) => {
    peerConnection = new RTCPeerConnection(iceServers);

    if (isCreator) {
        dataChannel = peerConnection.createDataChannel('game-channel');
        setupDataChannelEvents();
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        return offer;
    } else {
        peerConnection.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannelEvents();
        };
        return null;
    }
};

const setupDataChannelEvents = () => {
    dataChannel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'move') {
            board = message.board;
            lastMove = message.lastMove;
            currentPlayer = currentPlayer === 1 ? 2 : 1;
            drawBoard();
            updateScore();
        }
    };
    dataChannel.onopen = () => {
        alert("Connexion établie ! La partie peut commencer.");
        welcomeScreen.style.display = 'none';
        gameScreen.style.display = 'flex';
    };
};

const startSignaling = async (gameId) => {
    const gameRef = database.ref('games/' + gameId);
    
    // Joueur 1 (créateur)
    if (myPlayerColor === 1) {
        const offer = await createPeerConnection(true);
        gameRef.set({ offer: offer });
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                gameRef.child('creatorCandidates').push(event.candidate);
            }
        };

        gameRef.child('joinerCandidates').on('child_added', (snapshot) => {
            peerConnection.addIceCandidate(new RTCIceCandidate(snapshot.val()));
        });
        
        gameRef.child('answer').on('value', async (snapshot) => {
            const answer = snapshot.val();
            if (answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
                welcomeScreen.style.display = 'none';
                gameScreen.style.display = 'flex';
            }
        });
    } 
    // Joueur 2 (joiner)
    else {
        gameRef.once('value', async (snapshot) => {
            const data = snapshot.val();
            if (data.offer) {
                await createPeerConnection(false);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                gameRef.update({ answer: answer });
            }
        });

        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                gameRef.child('joinerCandidates').push(event.candidate);
            }
        };

        gameRef.child('creatorCandidates').on('child_added', (snapshot) => {
            peerConnection.addIceCandidate(new RTCIceCandidate(snapshot.val()));
        });
    }
};

// Fonctions d'authentification
const updateUI = (user) => {
    if (user) {
        authScreen.style.display = 'none';
        welcomeScreen.style.display = 'flex';
        logoutBtn.style.display = 'block';
        authStatus.style.display = 'flex';
        statusText.innerText = `Connecté : ${user.email}`;
    } else {
        authScreen.style.display = 'flex';
        welcomeScreen.style.display = 'none';
        logoutBtn.style.display = 'none';
        authStatus.style.display = 'none';
    }
};

registerBtn.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    auth.createUserWithEmailAndPassword(email, password)
        .then((userCredential) => {
            alert("Compte créé avec succès !");
            // L'écouteur onAuthStateChanged s'occupe de l'affichage
        })
        .catch(error => {
            alert(error.message);
        });
});

loginBtn.addEventListener('click', () => {
    const email = emailInput.value;
    const password = passwordInput.value;
    auth.signInWithEmailAndPassword(email, password)
        .then((userCredential) => {
            alert("Connexion réussie !");
            // L'écouteur onAuthStateChanged s'occupe de l'affichage
        })
        .catch(error => {
            alert(error.message);
        });
});

logoutBtn.addEventListener('click', () => {
    auth.signOut();
});

// NOUVELLE LOGIQUE DE DÉMARRAGE : Gérer l'état de la page après que Firebase a chargé l'état de l'utilisateur
auth.onAuthStateChanged(user => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdFromUrl = urlParams.get('gameId');

    // On vérifie le lien en premier pour éviter le flash
    if (gameIdFromUrl) {
        authScreen.style.display = 'none';
        welcomeScreen.style.display = 'flex';
        joinGameSection.style.display = 'flex';
        createGameBtn.style.display = 'none';
        gameIdInput.value = gameIdFromUrl;
        // Si l'utilisateur est aussi connecté, on affiche son email
        if (user) {
            updateUI(user);
        }
    } else {
        // Si pas de lien de partie, on utilise la fonction updateUI pour afficher l'écran correct
        updateUI(user);
    }
});

// Logique pour les boutons de jeu
createGameBtn.addEventListener('click', () => {
    if (!auth.currentUser) {
        alert("Vous devez être connecté pour créer une partie.");
        return;
    }
    const gameId = Math.random().toString(36).substring(2, 9);
    myPlayerColor = 1;
    startSignaling(gameId);
    
    gameLinkSection.style.display = 'block';
    gameLinkDisplay.innerText = window.location.href.split('?')[0] + '?gameId=' + gameId;
    createGameBtn.style.display = 'none';
    joinGameSection.style.display = 'none';
});

joinGameBtn.addEventListener('click', () => {
    if (!auth.currentUser) {
        alert("Vous devez être connecté pour rejoindre une partie.");
        return;
    }
    const gameId = gameIdInput.value;
    myPlayerColor = 2;
    startSignaling(gameId);
});

canvas.addEventListener('mousemove', handlePointerMove);
canvas.addEventListener('mousedown', handlePointerDown);
canvas.addEventListener('touchstart', handlePointerDown);

stoneBlack.onload = () => {
    stoneWhite.onload = () => {
        lastMoveMarker.onload = () => {
            hoverMarker.onload = () => {
                impossibleMarker.onload = () => {
                    drawBoard();
                    updateScore();
                };
            };
        };
    };
};