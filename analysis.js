/* =================================
   Analyse de partie
   Charge APRES katago.js. Interroge le pont KataGo pour evaluer chaque
   position de la partie, puis calcule precision, classification des coups et
   graphe d'evaluation — a la chess.com, mais en points (plus parlant au go).
================================= */

/* Classification par POINTS perdus (pas par winrate : le winrate s'ecrase pres
   de 0 et 1, et sous-estime une gaffe commise quand on gagne/perd deja). */
const MOVE_CATEGORIES = [
    { key: 'top',     label: 'Excellent',   maxPts: 0.5,      color: '#7fbf5a' },
    { key: 'good',    label: 'Bon',         maxPts: 1.5,      color: '#9fb4cc' },
    { key: 'inacc',   label: 'Imprécision', maxPts: 3,        color: '#e0c060' },
    { key: 'mistake', label: 'Erreur',      maxPts: 6,        color: '#e0955a' },
    { key: 'blunder', label: 'Gaffe',       maxPts: Infinity, color: '#e57373' }
];
function categorize(pts) {
    return MOVE_CATEGORIES.find(c => pts < c.maxPts) || MOVE_CATEGORIES[MOVE_CATEGORIES.length - 1];
}
// Precision = 100 * exp(-pointsPerdusMoyens / K). K calibre l'echelle.
const ACCURACY_K = 6;

/* Reconstruit la sequence de coups au format KataGo [["B","E5"], ...]. */
function buildAnalysisMoves() {
    // Partie contre KataGo : gtpMoves est complet (couleurs et passes exacts).
    if (typeof vsAI !== 'undefined' && vsAI && typeof gtpMoves !== 'undefined' && gtpMoves.length) {
        return gtpMoves.map(m => [m[0], m[1]]);
    }
    // Multijoueur : moveList est [{x,y}] sans les passes ; on alterne B/W.
    // (Une partie avec des passes en cours de jeu peut donc se decaler ; rare.)
    if (typeof moveList !== 'undefined' && Array.isArray(moveList)) {
        return moveList
            .filter(m => m && typeof m.x === 'number')
            .map((m, i) => [i % 2 === 0 ? 'B' : 'W', boardToGtp(m.x, m.y, BOARD_SIZE)]);
    }
    return [];
}

async function analyzeCurrentGame() {
    const overlay = document.getElementById('analysisOverlay');
    const bodyEl = document.getElementById('analysisBody');
    if (!overlay || !bodyEl) return;

    // Ouvrir l'analyse doit stopper le retour automatique au menu, sinon le
    // minuteur de fin de partie referme tout au bout de quelques secondes.
    if (typeof cancelEndGameCountdown === 'function') cancelEndGameCountdown();

    const moves = buildAnalysisMoves();
    overlay.classList.add('visible');

    if (moves.length < 2) {
        bodyEl.innerHTML = '<p class="analysis-error">Pas assez de coups à analyser.</p>';
        return;
    }

    bodyEl.innerHTML = '<p class="analysis-loading">KataGo analyse la partie… ' +
        '<span class="analysis-spinner"></span><br><small>' + moves.length +
        ' coups · quelques secondes sur ta machine</small></p>';

    try {
        const res = await bridgeFetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ moves, boardSize: BOARD_SIZE, komi: KOMI, maxVisits: 200 })
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || ('HTTP ' + res.status));
        }
        const data = await res.json();
        const analysis = computeAnalysis(data.turns, moves);
        renderAnalysis(bodyEl, analysis);
    } catch (e) {
        console.error('Analyse :', e);
        bodyEl.innerHTML =
            '<p class="analysis-error">Analyse impossible.<br>' +
            'Elle a besoin du moteur KataGo local (le pont). Lance-le, puis réessaie.<br>' +
            '<small>' + escapeHtml(e.message) + '</small></p>';
    }
}

/* Transforme les evaluations par tour en donnees exploitables. */
function computeAnalysis(turns, moves) {
    const byTurn = {};
    (turns || []).forEach(t => { byTurn[t.turn] = t; });

    const perMove = [];
    const pts = { B: [], W: [] };

    for (let t = 0; t < moves.length; t++) {
        const before = byTurn[t], after = byTurn[t + 1];
        if (!before || !after || before.winrate == null || after.winrate == null) continue;

        const color = moves[t][0];
        // Points jetes : lead(trait) + lead(adversaire au tour suivant).
        const ptsLost = Math.max(0, (before.scoreLead || 0) + (after.scoreLead || 0));
        const winLost = Math.max(0, before.winrate + after.winrate - 1);
        perMove.push({
            n: t + 1, color, played: moves[t][1],
            ptsLost, winLost, cat: categorize(ptsLost), best: before.bestMove
        });
        (pts[color] || (pts[color] = [])).push(ptsLost);
    }

    // Winrate de Noir a chaque tour, pour le graphe de momentum.
    const blackCurve = (turns || [])
        .filter(t => t.winrate != null)
        .map(t => ({ turn: t.turn, w: (t.turn % 2 === 0) ? t.winrate : 1 - t.winrate }));

    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const acc = a => a.length ? Math.round(100 * Math.exp(-mean(a) / ACCURACY_K)) : null;
    const total = a => Math.round(a.reduce((s, x) => s + x, 0) * 10) / 10;
    const counts = (colorLetter) => {
        const c = {};
        MOVE_CATEGORIES.forEach(cat => { c[cat.key] = 0; });
        perMove.filter(m => m.color === colorLetter).forEach(m => { c[m.cat.key]++; });
        return c;
    };

    // Evaluation par tour, du point de vue de Noir, pour l'affichage sous le
    // plateau (winrate + ecart de score, ecart signe positif = Noir mene).
    const evalByTurn = {};
    (turns || []).forEach(t => {
        if (t.winrate == null) return;
        const blackWin = (t.turn % 2 === 0) ? t.winrate : 1 - t.winrate;
        const blackScore = (t.turn % 2 === 0) ? (t.scoreLead || 0) : -(t.scoreLead || 0);
        evalByTurn[t.turn] = { blackWin, blackScore };
    });

    return {
        perMove, blackCurve, moves, evalByTurn,
        black: { accuracy: acc(pts.B || []), totalPts: total(pts.B || []), counts: counts('B') },
        white: { accuracy: acc(pts.W || []), totalPts: total(pts.W || []), counts: counts('W') }
    };
}

/* ========== Reconstruction des positions ========== */
/* Rejoue la partie pour obtenir le plateau apres chaque coup. states[t] = etat
   apres t coups. Reutilise placeStone (regles + captures) de script.js. */
function reconstructStates(moves, size) {
    const empty = () => Array.from({ length: size }, () => Array(size).fill(0));
    const snapshot = b => b.map(r => r.slice());
    const states = [empty()];
    let cur = empty();
    for (let i = 0; i < moves.length; i++) {
        const gtp = moves[i][1];
        const pt = gtpToBoard(gtp, size);
        if (pt && pt !== 'pass' && pt !== 'resign' && cur[pt.y] && cur[pt.y][pt.x] === 0) {
            const color = moves[i][0] === 'B' ? 1 : 2;
            const res = placeStone(pt.x, pt.y, color, cur);
            if (res && res.newState) cur = res.newState;
        }
        states.push(snapshot(cur));
    }
    return states;
}

/* ========== Rendu ========== */

function playerName(color) {
    const el = document.getElementById(color === 'B' ? 'blackPlayerName' : 'whitePlayerName');
    const n = el && el.textContent ? el.textContent.trim() : '';
    return n || (color === 'B' ? 'Noir' : 'Blanc');
}

function accuracyCard(color, side) {
    const name = escapeHtml(playerName(color));
    const acc = side.accuracy == null ? '—' : side.accuracy;
    const c = side.counts;
    const chips = MOVE_CATEGORIES.map(cat =>
        `<span class="cat-chip" style="--c:${cat.color}">${c[cat.key]} ${cat.label}</span>`
    ).join('');
    return `
        <div class="acc-card">
            <div class="acc-head">
                <span class="acc-stone ${color === 'B' ? 'black' : 'white'}"></span>
                <span class="acc-name">${name}</span>
            </div>
            <div class="acc-value">${acc}<span class="acc-pct">%</span></div>
            <div class="acc-label">Précision · ${side.totalPts} pts perdus</div>
            <div class="acc-chips">${chips}</div>
        </div>`;
}

// Etat du lecteur de revue, partage entre le plateau, le graphe et les listes.
let review = null;

function renderAnalysis(el, a) {
    const size = BOARD_SIZE;
    const states = reconstructStates(a.moves, size);
    const perMoveByN = {};
    a.perMove.forEach(m => { perMoveByN[m.n] = m; });

    review = {
        moves: a.moves, states, size, perMoveByN, evalByTurn: a.evalByTurn,
        curve: a.blackCurve, current: a.moves.length
    };

    const worst = a.perMove
        .filter(m => m.cat.key === 'mistake' || m.cat.key === 'blunder')
        .sort((x, y) => y.ptsLost - x.ptsLost);

    el.innerHTML = `
        <div class="acc-grid">
            ${accuracyCard('B', a.black)}
            ${accuracyCard('W', a.white)}
        </div>

        <div class="review-board-wrap">
            <canvas id="reviewBoard" width="340" height="340" aria-label="Plateau de revue"></canvas>
        </div>
        <div class="review-nav">
            <button id="reviewFirst" class="review-btn" title="Début">⏮</button>
            <button id="reviewPrev" class="review-btn" title="Précédent">◀</button>
            <span id="reviewLabel" class="review-label"></span>
            <button id="reviewNext" class="review-btn" title="Suivant">▶</button>
            <button id="reviewLast" class="review-btn" title="Fin">⏭</button>
        </div>
        <div id="reviewEval" class="review-eval"></div>

        <div class="analysis-section">
            <div class="analysis-section-title">Évaluation au fil de la partie <small>(clique pour naviguer)</small></div>
            <div id="evalChart" class="eval-chart"></div>
            <div class="eval-legend"><span>Noir mène</span><span>Blanc mène</span></div>
        </div>

        <div class="analysis-section">
            <div class="analysis-section-title">Coups à revoir ${worst.length ? `(${worst.length})` : ''}</div>
            <div id="worstList" class="move-list"></div>
        </div>
        <div class="analysis-section">
            <div class="analysis-section-title toggle-all">
                Tous les coups <button id="toggleAllMoves" class="btn-guest">Afficher</button>
            </div>
            <div id="allMoves" class="move-list" style="display:none;"></div>
        </div>`;

    renderEvalChart(document.getElementById('evalChart'), a.blackCurve);

    const worstEl = document.getElementById('worstList');
    worstEl.innerHTML = worst.length
        ? worst.map(moveRow).join('')
        : '<p class="analysis-none">Aucune erreur majeure — belle partie !</p>';

    const allEl = document.getElementById('allMoves');
    allEl.innerHTML = a.perMove.map(moveRow).join('');
    const toggle = document.getElementById('toggleAllMoves');
    if (toggle) toggle.onclick = () => {
        const shown = allEl.style.display !== 'none';
        allEl.style.display = shown ? 'none' : 'block';
        toggle.textContent = shown ? 'Afficher' : 'Masquer';
    };

    // Cliquer un coup dans une liste amene le plateau a ce coup.
    el.querySelectorAll('.move-row').forEach(row => {
        row.addEventListener('click', () => goToMove(parseInt(row.dataset.move, 10)));
    });

    // Navigation du plateau.
    const first = document.getElementById('reviewFirst');
    const prev = document.getElementById('reviewPrev');
    const next = document.getElementById('reviewNext');
    const last = document.getElementById('reviewLast');
    if (first) first.onclick = () => goToMove(0);
    if (prev) prev.onclick = () => goToMove(review.current - 1);
    if (next) next.onclick = () => goToMove(review.current + 1);
    if (last) last.onclick = () => goToMove(review.moves.length);

    goToMove(review.moves.length); // on ouvre sur la position finale
}

/* Amene le lecteur au coup n (0 = plateau vide, n = apres le n-ieme coup). */
function goToMove(n) {
    if (!review) return;
    n = Math.max(0, Math.min(review.moves.length, n));
    review.current = n;

    const size = review.size;
    const state = review.states[n] || review.states[0];

    // Coup joue pour arriver ici, et le meilleur coup selon KataGo.
    let played = null, best = null, quality = null;
    if (n >= 1) {
        const mv = review.moves[n - 1];
        const p = gtpToBoard(mv[1], size);
        if (p && p !== 'pass' && p !== 'resign') played = { x: p.x, y: p.y, color: mv[0] };
        quality = review.perMoveByN[n] || null;
        if (quality && quality.best && (quality.cat.key === 'inacc' || quality.cat.key === 'mistake' || quality.cat.key === 'blunder')) {
            const b = gtpToBoard(quality.best, size);
            if (b && b !== 'pass' && b !== 'resign') best = { x: b.x, y: b.y };
        }
    }

    drawReviewBoard(document.getElementById('reviewBoard'), state, size, { played, best });

    // Libelle + evaluation sous le plateau.
    const label = document.getElementById('reviewLabel');
    if (label) label.textContent = n === 0 ? 'Départ' : `Coup ${n} / ${review.moves.length}`;

    const ev = review.evalByTurn[n];
    const evalEl = document.getElementById('reviewEval');
    if (evalEl) {
        let html = '';
        if (ev) {
            const wr = Math.round(ev.blackWin * 100);
            const sc = ev.blackScore >= 0 ? `Noir +${ev.blackScore.toFixed(1)}` : `Blanc +${(-ev.blackScore).toFixed(1)}`;
            html += `<div class="review-eval-line"><span>Noir ${wr}%</span><span>${sc} pts</span></div>`;
        }
        if (n >= 1 && quality && played) {
            const playedLabel = review.moves[n - 1][1];
            html += `<div class="review-eval-move">
                <span class="move-cat" style="--c:${quality.cat.color}">${quality.cat.label}</span>
                <span>${review.moves[n - 1][0] === 'B' ? 'Noir' : 'Blanc'} joue <strong>${escapeHtml(playedLabel)}</strong></span>
                ${best ? `<span class="review-best-hint">meilleur : <strong>${escapeHtml(quality.best)}</strong> (−${quality.ptsLost.toFixed(1)})</span>` : ''}
            </div>`;
        }
        evalEl.innerHTML = html;
    }

    // Surligne le coup courant dans les listes.
    document.querySelectorAll('.move-row').forEach(row => {
        row.classList.toggle('current', parseInt(row.dataset.move, 10) === n);
    });
    // Deplace le curseur du graphe.
    if (typeof moveEvalCursor === 'function') moveEvalCursor(n);
}

/* Dessine un plateau : bois, grille, hoshi, pierres, marque du coup joue et
   du meilleur coup suggere. */
function drawReviewBoard(canvas, state, size, opts) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const M = Math.round(W * 0.055);
    const usable = W - 2 * M;
    const step = usable / (size - 1);
    const pos = i => M + i * step;
    const r = step * 0.46;

    // Fond bois.
    ctx.clearRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#4a3c2a');
    grad.addColorStop(1, '#3a2f22');
    ctx.fillStyle = grad;
    roundRect(ctx, 0, 0, W, H, 8); ctx.fill();

    // Grille.
    ctx.strokeStyle = 'rgba(20,14,6,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < size; i++) {
        ctx.moveTo(pos(0), pos(i)); ctx.lineTo(pos(size - 1), pos(i));
        ctx.moveTo(pos(i), pos(0)); ctx.lineTo(pos(i), pos(size - 1));
    }
    ctx.stroke();

    // Hoshi.
    const stars = size === 19 ? [3, 9, 15] : size === 13 ? [3, 6, 9] : size === 9 ? [2, 4, 6] : [];
    ctx.fillStyle = 'rgba(20,14,6,0.7)';
    stars.forEach(sx => stars.forEach(sy => {
        ctx.beginPath(); ctx.arc(pos(sx), pos(sy), 2.5, 0, 2 * Math.PI); ctx.fill();
    }));

    // Pierres.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const v = state[y] && state[y][x];
        if (!v) continue;
        const cx = pos(x), cy = pos(y);
        const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        if (v === 1) { g.addColorStop(0, '#5a5a62'); g.addColorStop(1, '#101015'); }
        else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#d8d2c4'); }
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill();
    }

    // Meilleur coup suggere (anneau vert sur un point souvent vide).
    if (opts && opts.best) {
        const cx = pos(opts.best.x), cy = pos(opts.best.y);
        ctx.strokeStyle = '#7fbf5a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, 2 * Math.PI); ctx.stroke();
    }

    // Coup joue (petit repere contrastant au centre de la pierre).
    if (opts && opts.played) {
        const cx = pos(opts.played.x), cy = pos(opts.played.y);
        ctx.fillStyle = opts.played.color === 'B' ? '#e0c060' : '#c07020';
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, 2 * Math.PI); ctx.fill();
    }
}

function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
}

function moveRow(m) {
    const suggestion = (m.cat.key === 'inacc' || m.cat.key === 'mistake' || m.cat.key === 'blunder') && m.best
        ? `<span class="move-best">→ ${escapeHtml(m.best)}</span>` : '';
    const ptsTxt = m.ptsLost >= 0.5 ? `<span class="move-pts">−${m.ptsLost.toFixed(1)}</span>` : '';
    return `
        <div class="move-row" data-move="${m.n}" role="button" tabindex="0">
            <span class="move-num">${m.n}</span>
            <span class="acc-stone ${m.color === 'B' ? 'black' : 'white'} tiny"></span>
            <span class="move-coord">${escapeHtml(m.played)}</span>
            <span class="move-cat" style="--c:${m.cat.color}">${m.cat.label}</span>
            ${suggestion}
            ${ptsTxt}
        </div>`;
}

// Curseur du graphe, deplace par la navigation.
let moveEvalCursor = null;

/* Graphe d'evaluation : winrate de Noir (0 en bas, 100% en haut), ligne de
   partage a 50%. Cliquable pour naviguer dans la partie. */
function renderEvalChart(el, curve) {
    if (!el) { moveEvalCursor = null; return; }
    if (!curve || curve.length < 2) {
        el.innerHTML = '<p class="analysis-none">Partie trop courte pour un graphe.</p>';
        moveEvalCursor = null;
        return;
    }
    const W = 320, H = 110, pad = 4;
    const plotW = W - 2 * pad, plotH = H - 2 * pad;
    const n = curve.length;
    const x = i => pad + plotW * i / (n - 1);
    const y = w => pad + plotH * (1 - w);
    const mid = y(0.5);

    const line = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
    const areaTop = `M ${pad},${mid} L ${curve.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L ')} L ${x(n - 1).toFixed(1)},${mid} Z`;

    el.innerHTML = `
        <svg class="eval-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
            <defs>
                <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#7fbf5a" stop-opacity="0.30"/>
                    <stop offset="100%" stop-color="#7fbf5a" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${areaTop}" fill="url(#evalFill)"/>
            <line class="eval-mid" x1="${pad}" y1="${mid}" x2="${W - pad}" y2="${mid}"/>
            <polyline class="eval-line" points="${line}"/>
            <line class="eval-cursor" y1="${pad}" y2="${pad + plotH}" style="display:none;"/>
        </svg>
        <div class="eval-tip" style="display:none;"></div>`;

    const svg = el.querySelector('.eval-svg');
    const cursor = el.querySelector('.eval-cursor');
    const tip = el.querySelector('.eval-tip');

    // Le curseur suit le coup courant de la revue.
    moveEvalCursor = (turnIndex) => {
        const i = Math.max(0, Math.min(n - 1, turnIndex));
        cursor.style.display = '';
        cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i));
    };

    function turnAt(clientX) {
        const rect = svg.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        return Math.round(frac * (n - 1));
    }
    svg.addEventListener('mousemove', (ev) => {
        const i = turnAt(ev.clientX);
        tip.style.display = 'block';
        tip.textContent = `Coup ${curve[i].turn} · Noir ${Math.round(curve[i].w * 100)}%`;
        tip.style.left = ((i / (n - 1)) * 100) + '%';
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
    // Clic : naviguer dans la revue.
    svg.style.cursor = 'pointer';
    svg.addEventListener('click', (ev) => { if (typeof goToMove === 'function') goToMove(curve[turnAt(ev.clientX)].turn); });
}

/* ========== Cablage ========== */
document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyzeGameBtn');
    if (analyzeBtn) analyzeBtn.onclick = analyzeCurrentGame;
    const closeBtn = document.getElementById('closeAnalysisBtn');
    const overlay = document.getElementById('analysisOverlay');
    if (closeBtn && overlay) closeBtn.onclick = () => overlay.classList.remove('visible');
    if (overlay) overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('visible');
    });
});
