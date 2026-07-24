#!/bin/sh
#
# Installeur KataGo pour Online Go Game — Linux et macOS
#
# Usage (une seule ligne a coller dans un terminal) :
#     curl -fsSL https://shazamifius.github.io/gogames/install/install.sh | sh
#
# Ce script ne demande AUCUN prerequis sous Linux : si Node.js est absent, il
# telecharge une version portable dans son propre dossier au lieu d'installer
# quoi que ce soit sur le systeme. Tout tient dans ~/.gogames-katago et se
# desinstalle en supprimant ce dossier.
#
# Options (variables d'environnement) :
#     CPU=1     force la version CPU (pas de GPU ou OpenCL indisponible)
#     STRONG=1  telecharge le gros reseau (271 Mo au lieu de 98 Mo)
#
# Sous macOS, KataGo ne publie aucun binaire : on passe par Homebrew.

set -eu

SITE_URL="https://shazamifius.github.io/gogames"
ROOT="$HOME/.gogames-katago"
ENGINE_DIR="$ROOT/katago"

say()  { printf '  %s\n' "$1"; }
step() { printf '\n\033[36m[*] %s\033[0m\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m[X] %s\033[0m\n' "$1" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "'$1' est requis mais introuvable."; }

# Telecharge vers un nom temporaire et ne renomme qu'une fois complet : un
# transfert interrompu ne doit pas passer pour un fichier valide.
fetch() {
  url="$1"; dest="$2"; label="$3"
  if [ -f "$dest" ]; then say "$label deja present, telechargement ignore."; return; fi
  say "$label ..."
  curl -fL --progress-bar -o "$dest.partial" "$url"
  mv "$dest.partial" "$dest"
}

printf '\n\033[36m  Installation de KataGo pour Online Go Game\033[0m\n'
printf '  ------------------------------------------\n'

need curl

# ---------- Detection de la plateforme ----------

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux)  PLATFORM="linux-x64" ;;
  Darwin) PLATFORM="darwin" ;;
  *) die "Systeme non supporte : $OS" ;;
esac

if [ "$PLATFORM" = "linux-x64" ] && [ "$ARCH" != "x86_64" ]; then
  die "Architecture $ARCH non supportee : KataGo ne publie que des binaires Linux x86_64.
      Il faudrait compiler KataGo depuis les sources."
fi

mkdir -p "$ENGINE_DIR"

# ---------- Manifeste ----------

step "Lecture du manifeste"
MANIFEST="$ROOT/manifest.json"
curl -fsSL -o "$MANIFEST" "$SITE_URL/install/manifest.json"

# Petit extracteur JSON : evite d'imposer jq comme dependance.
jget() { sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$MANIFEST" | head -n1; }

KATAGO_VERSION="$(jget katagoVersion)"
NODE_VERSION="$(jget nodeVersion)"
NET_BASE="$(jget networkBaseUrl)"
[ -n "$KATAGO_VERSION" ] || die "Manifeste illisible."
say "KataGo $KATAGO_VERSION"

# Le manifeste comporte deux blocs "file" (reseau normal / reseau fort) : on
# prend le premier ou le second selon STRONG.
if [ "${STRONG:-0}" = "1" ]; then
  NET_FILE="$(grep -o '"file": *"[^"]*"' "$MANIFEST" | sed -n '2s/.*"file": *"\([^"]*\)".*/\1/p')"
  NET_LABEL="reseau fort (~271 Mo)"
else
  NET_FILE="$(grep -o '"file": *"[^"]*"' "$MANIFEST" | sed -n '1s/.*"file": *"\([^"]*\)".*/\1/p')"
  NET_LABEL="reseau (~98 Mo)"
fi
[ -n "$NET_FILE" ] || die "Nom du reseau introuvable dans le manifeste."

# ---------- Moteur ----------

if [ "$PLATFORM" = "darwin" ]; then
  step "Installation du moteur via Homebrew"
  say "KataGo ne publie aucun binaire macOS : Homebrew fournit une version precompilee."
  command -v brew >/dev/null 2>&1 || die "Homebrew est requis sous macOS. Voir https://brew.sh"
  if command -v katago >/dev/null 2>&1; then
    say "katago deja installe : $(katago version 2>/dev/null | head -n1)"
  else
    brew install katago
  fi
  KATAGO_BIN="$(command -v katago)"
  # Les fichiers d'exemple sont livres dans le partage Homebrew.
  EXAMPLE_CFG="$(brew --prefix katago)/share/katago/configs/analysis_example.cfg"
  [ -f "$EXAMPLE_CFG" ] || EXAMPLE_CFG="$(find "$(brew --prefix katago)" -name 'analysis_example.cfg' 2>/dev/null | head -n1)"
else
  step "Telechargement du moteur KataGo"
  if [ "${CPU:-0}" = "1" ]; then
    ASSET="katago-${KATAGO_VERSION}-eigenavx2-linux-x64.zip"; say "Version CPU demandee."
  else
    ASSET="katago-${KATAGO_VERSION}-opencl-linux-x64.zip";     say "Version GPU (OpenCL)."
  fi
  need unzip
  fetch "https://github.com/lightvector/KataGo/releases/download/$KATAGO_VERSION/$ASSET" \
        "$ROOT/$ASSET" "Moteur (~5 Mo)"
  if [ ! -x "$ENGINE_DIR/katago" ]; then
    say "Extraction ..."
    unzip -oq "$ROOT/$ASSET" -d "$ENGINE_DIR"
    chmod +x "$ENGINE_DIR/katago" 2>/dev/null || true
  fi
  [ -x "$ENGINE_DIR/katago" ] || die "katago introuvable apres extraction."
  KATAGO_BIN="$ENGINE_DIR/katago"
  EXAMPLE_CFG="$ENGINE_DIR/analysis_example.cfg"
fi

# ---------- Node portable si besoin ----------

step "Recherche de Node.js"
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  say "Node.js du systeme : $($NODE_BIN -v)"
elif [ "$PLATFORM" = "darwin" ]; then
  say "Node.js absent : installation via Homebrew."
  brew install node
  NODE_BIN="$(command -v node)"
else
  say "Node.js absent : installation d'une version portable, locale a ce dossier."
  NODE_DIR="$ROOT/node-$NODE_VERSION-linux-x64"
  NODE_TAR="$ROOT/node-$NODE_VERSION-linux-x64.tar.xz"
  fetch "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" \
        "$NODE_TAR" "Node.js $NODE_VERSION (~30 Mo)"
  [ -d "$NODE_DIR" ] || tar -xJf "$NODE_TAR" -C "$ROOT"
  NODE_BIN="$NODE_DIR/bin/node"
  [ -x "$NODE_BIN" ] || die "Node portable introuvable apres extraction."
  say "Node.js portable pret."
fi

# ---------- Reseau de neurones ----------

step "Telechargement du reseau de neurones"
fetch "${NET_BASE}${NET_FILE}" "$ENGINE_DIR/net.bin.gz" "$NET_LABEL"

# ---------- Configuration ----------

step "Configuration du moteur"
[ -f "$EXAMPLE_CFG" ] || die "analysis_example.cfg introuvable."
# reportAnalysisWinratesAs vaut BLACK par defaut : le taux de victoire serait
# alors toujours donne du point de vue de Noir, ce qui fausse la logique
# d'abandon de l'IA des qu'elle joue Blanc.
sed -e 's/^reportAnalysisWinratesAs = BLACK/reportAnalysisWinratesAs = SIDETOMOVE/' \
    -e 's/^numAnalysisThreads = 2/numAnalysisThreads = 1/' \
    "$EXAMPLE_CFG" > "$ENGINE_DIR/analysis.cfg"
say "analysis.cfg ecrit."

# ---------- Pont + jeu (repli local) ----------

step "Telechargement du pont"
rm -f "$ROOT/bridge.js"   # toujours reprendre la derniere version
fetch "$SITE_URL/server/bridge.js" "$ROOT/bridge.js" "bridge.js"

# Le pont sert aussi le jeu : ainsi, meme sous Safari (qui refuse le loopback
# depuis une page HTTPS distante), on peut jouer en ouvrant http://127.0.0.1:8081.
step "Telechargement du jeu (pour jouer aussi en local)"
for f in index.html script.js katago.js style.css; do
  rm -f "$ROOT/$f"
  fetch "$SITE_URL/$f" "$ROOT/$f" "$f"
done

# ---------- Lanceur ----------

LAUNCHER="$ROOT/demarrer-katago.sh"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
cd "$ROOT"
KATAGO_BIN="$KATAGO_BIN" exec "$NODE_BIN" bridge.js
EOF
chmod +x "$LAUNCHER"

printf '\n\033[32m  Installation terminee.\033[0m\n'
say "Dossier : $ROOT"
say "Relancer plus tard : $LAUNCHER"
printf '\n\033[33m  Le tout premier demarrage calibre votre GPU et prend plusieurs\n'
printf '  minutes. Les suivants sont immediats.\033[0m\n\n'
say "Ouvrez ensuite $SITE_URL et cliquez sur Jouer contre KataGo."
printf '\n'

exec "$LAUNCHER"
