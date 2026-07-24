/* =================================
   Glicko-2 — systeme de classement (Mark Glickman)
   Implementation autonome : utilisable dans le navigateur (window.Glicko2)
   comme dans Node (module.exports), pour pouvoir la tester hors du jeu.

   Reference : « Example of the Glicko-2 system », Glickman 2013.
   L'exemple du papier sert de test de non-regression (glicko2.test.js).
================================= */

(function (global) {
    "use strict";

    // 1500 et 173.7178 : constantes de conversion entre l'echelle affichee
    // (facon Elo) et l'echelle interne de Glicko-2.
    const SCALE = 173.7178;
    const DEFAULT_RATING = 1500;
    const DEFAULT_RD = 350;      // incertitude d'un joueur inconnu
    const DEFAULT_VOL = 0.06;    // volatilite de depart
    const TAU = 0.5;             // contrainte systeme : bornes la volatilite
    const EPSILON = 0.000001;    // precision de l'iteration de volatilite

    function g(phi) {
        return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
    }

    /**
     * Met a jour un joueur apres une ou plusieurs parties.
     * @param {{rating:number, rd:number, vol:number}} player
     * @param {Array<{rating:number, rd:number, score:number}>} results
     *        score : 1 = victoire, 0.5 = nulle, 0 = defaite
     * @param {number} [tau]
     * @returns {{rating:number, rd:number, vol:number}}
     */
    function update(player, results, tau) {
        tau = (typeof tau === "number") ? tau : TAU;

        const mu = (player.rating - DEFAULT_RATING) / SCALE;
        const phi = player.rd / SCALE;
        const sigma = player.vol;

        // Aucune partie sur la periode : seule l'incertitude grandit (on est
        // moins sur du niveau d'un joueur inactif), bornee au defaut.
        if (!results || results.length === 0) {
            const phiStar = Math.sqrt(phi * phi + sigma * sigma);
            return {
                rating: player.rating,
                rd: Math.min(phiStar * SCALE, DEFAULT_RD),
                vol: sigma
            };
        }

        // Variance estimee (v) et somme des ecarts (dSum).
        let vInv = 0;
        let dSum = 0;
        for (const r of results) {
            const muJ = (r.rating - DEFAULT_RATING) / SCALE;
            const phiJ = r.rd / SCALE;
            const gj = g(phiJ);
            const Ej = 1 / (1 + Math.exp(-gj * (mu - muJ)));
            vInv += gj * gj * Ej * (1 - Ej);
            dSum += gj * (r.score - Ej);
        }
        const v = 1 / vInv;
        const delta = v * dSum;

        // Nouvelle volatilite : racine de f(x)=0 par la methode d'Illinois.
        const a = Math.log(sigma * sigma);
        const d2 = delta * delta;
        const phi2 = phi * phi;
        const f = function (x) {
            const ex = Math.exp(x);
            const num = ex * (d2 - phi2 - v - ex);
            const den = 2 * Math.pow(phi2 + v + ex, 2);
            return num / den - (x - a) / (tau * tau);
        };

        let A = a;
        let B;
        if (d2 > phi2 + v) {
            B = Math.log(d2 - phi2 - v);
        } else {
            let k = 1;
            while (f(a - k * tau) < 0) k++;
            B = a - k * tau;
        }
        let fA = f(A);
        let fB = f(B);
        while (Math.abs(B - A) > EPSILON) {
            const C = A + (A - B) * fA / (fB - fA);
            const fC = f(C);
            if (fC * fB <= 0) { A = B; fA = fB; }
            else { fA = fA / 2; }
            B = C;
            fB = fC;
        }
        const sigmaPrime = Math.exp(A / 2);

        // Nouvelle incertitude puis nouvelle note.
        const phiStar = Math.sqrt(phi2 + sigmaPrime * sigmaPrime);
        const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
        const muPrime = mu + phiPrime * phiPrime * dSum;

        return {
            rating: muPrime * SCALE + DEFAULT_RATING,
            rd: phiPrime * SCALE,
            vol: sigmaPrime
        };
    }

    const api = {
        update: update,
        defaultPlayer: function () {
            return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
        },
        SCALE: SCALE,
        DEFAULT_RATING: DEFAULT_RATING,
        DEFAULT_RD: DEFAULT_RD,
        DEFAULT_VOL: DEFAULT_VOL,
        TAU: TAU
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else global.Glicko2 = api;

})(typeof window !== "undefined" ? window : globalThis);
