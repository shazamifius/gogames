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

    return {
        perMove,
        blackCurve,
        black: { accuracy: acc(pts.B || []), totalPts: total(pts.B || []), counts: counts('B') },
        white: { accuracy: acc(pts.W || []), totalPts: total(pts.W || []), counts: counts('W') }
    };
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

function renderAnalysis(el, a) {
    const worst = a.perMove
        .filter(m => m.cat.key === 'mistake' || m.cat.key === 'blunder')
        .sort((x, y) => y.ptsLost - x.ptsLost);

    el.innerHTML = `
        <div class="acc-grid">
            ${accuracyCard('B', a.black)}
            ${accuracyCard('W', a.white)}
        </div>
        <div class="analysis-section">
            <div class="analysis-section-title">Évaluation au fil de la partie</div>
            <div id="evalChart" class="eval-chart"></div>
            <div class="eval-legend"><span class="eval-legend-b">Noir mène</span><span class="eval-legend-w">Blanc mène</span></div>
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
    if (worst.length === 0) {
        worstEl.innerHTML = '<p class="analysis-none">Aucune erreur majeure — belle partie !</p>';
    } else {
        worstEl.innerHTML = worst.map(moveRow).join('');
    }

    const allEl = document.getElementById('allMoves');
    allEl.innerHTML = a.perMove.map(moveRow).join('');
    const toggle = document.getElementById('toggleAllMoves');
    if (toggle) toggle.onclick = () => {
        const shown = allEl.style.display !== 'none';
        allEl.style.display = shown ? 'none' : 'block';
        toggle.textContent = shown ? 'Afficher' : 'Masquer';
    };
}

function moveRow(m) {
    const suggestion = (m.cat.key === 'inacc' || m.cat.key === 'mistake' || m.cat.key === 'blunder') && m.best
        ? `<span class="move-best">→ ${escapeHtml(m.best)}</span>` : '';
    const ptsTxt = m.ptsLost >= 0.5 ? `<span class="move-pts">−${m.ptsLost.toFixed(1)}</span>` : '';
    return `
        <div class="move-row">
            <span class="move-num">${m.n}</span>
            <span class="acc-stone ${m.color === 'B' ? 'black' : 'white'} tiny"></span>
            <span class="move-coord">${escapeHtml(m.played)}</span>
            <span class="move-cat" style="--c:${m.cat.color}">${m.cat.label}</span>
            ${suggestion}
            ${ptsTxt}
        </div>`;
}

/* Graphe d'evaluation : winrate de Noir (0 en bas, 100% en haut), ligne de
   partage a 50%. Une seule serie, donc pas de legende de couleur ; le titre et
   les reperes 50 % / haut-bas suffisent. */
function renderEvalChart(el, curve) {
    if (!el) return;
    if (!curve || curve.length < 2) {
        el.innerHTML = '<p class="analysis-none">Partie trop courte pour un graphe.</p>';
        return;
    }
    const W = 320, H = 120, padL = 4, padR = 4, padT = 6, padB = 6;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = curve.length;
    const x = i => padL + plotW * i / (n - 1);
    const y = w => padT + plotH * (1 - w); // w dans [0,1]
    const mid = y(0.5);

    const line = curve.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
    const areaTop = `M ${padL},${mid} L ${curve.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L ')} L ${x(n - 1).toFixed(1)},${mid} Z`;

    el.innerHTML = `
        <svg class="eval-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
             aria-label="Winrate de Noir au fil de la partie">
            <defs>
                <linearGradient id="evalFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#7fbf5a" stop-opacity="0.30"/>
                    <stop offset="100%" stop-color="#7fbf5a" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <rect x="${padL}" y="${padT}" width="${plotW}" height="${mid - padT}" fill="rgba(255,255,255,0.02)"/>
            <path d="${areaTop}" fill="url(#evalFill)"/>
            <line class="eval-mid" x1="${padL}" y1="${mid}" x2="${W - padR}" y2="${mid}"/>
            <polyline class="eval-line" points="${line}"/>
            <g class="eval-hover" style="display:none;">
                <line class="eval-guide" y1="${padT}" y2="${padT + plotH}"/>
                <circle class="eval-dot" r="3.5"/>
            </g>
        </svg>
        <div class="eval-tip" style="display:none;"></div>`;

    const svg = el.querySelector('.eval-svg');
    const hover = el.querySelector('.eval-hover');
    const guide = el.querySelector('.eval-guide');
    const dot = el.querySelector('.eval-dot');
    const tip = el.querySelector('.eval-tip');
    svg.addEventListener('mousemove', (ev) => {
        const rect = svg.getBoundingClientRect();
        const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const i = Math.round(frac * (n - 1));
        const p = curve[i];
        hover.style.display = '';
        guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i));
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(p.w));
        tip.style.display = 'block';
        tip.textContent = `Coup ${p.turn} · Noir ${Math.round(p.w * 100)}%`;
        tip.style.left = (frac * 100) + '%';
    });
    svg.addEventListener('mouseleave', () => { hover.style.display = 'none'; tip.style.display = 'none'; });
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
