<#
  Installeur KataGo pour Online Go Game — Windows

  Usage (une seule ligne a coller dans PowerShell) :
      irm https://shazamifius.github.io/gogames/install/install.ps1 | iex

  Ce script ne demande AUCUN prerequis : si Node.js est absent, il telecharge
  une version portable dans son propre dossier plutot que d'installer quoi que
  ce soit sur le systeme. Tout tient dans %LOCALAPPDATA%\gogames-katago et se
  desinstalle en supprimant ce dossier.

  Options :
      -Cpu        force la version CPU (si pas de GPU ou OpenCL indisponible)
      -Strong     telecharge le gros reseau (271 Mo au lieu de 98 Mo)
      -AutoStart  lance le pont a l'ouverture de session
#>

[CmdletBinding()]
param(
    [switch]$Cpu,
    [switch]$Strong,
    [switch]$AutoStart
)

$ErrorActionPreference = 'Stop'
# Sans ca, la barre de progression d'Invoke-WebRequest divise le debit par dix.
$ProgressPreference = 'SilentlyContinue'

$SiteUrl  = 'https://shazamifius.github.io/gogames'
$Root     = Join-Path $env:LOCALAPPDATA 'gogames-katago'
$EngineDir = Join-Path $Root 'katago'

function Say([string]$msg)  { Write-Host "  $msg" }
function Step([string]$msg) { Write-Host "`n[*] $msg" -ForegroundColor Cyan }
function Warn([string]$msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }

function Get-File([string]$Url, [string]$Dest, [string]$Label) {
    if (Test-Path $Dest) {
        Say "$Label deja present, telechargement ignore."
        return
    }
    Say "$Label ..."
    $tmp = "$Dest.partial"
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    # On ne publie le nom final qu'une fois le transfert complet : un
    # telechargement interrompu ne doit pas passer pour un fichier valide.
    Move-Item -Path $tmp -Destination $Dest -Force
}

Write-Host ""
Write-Host "  Installation de KataGo pour Online Go Game" -ForegroundColor Cyan
Write-Host "  ------------------------------------------"

# ---------- Verifications prealables ----------

if ([Environment]::Is64BitOperatingSystem -eq $false) {
    Write-Host "`n[X] Windows 32 bits n'est pas supporte : KataGo ne publie que des binaires 64 bits." -ForegroundColor Red
    return
}

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -eq 'ARM64') {
    Write-Host "`n[X] Windows ARM64 n'est pas supporte : KataGo ne publie pas de binaire ARM." -ForegroundColor Red
    Say "Il faudrait compiler KataGo depuis les sources."
    return
}

New-Item -ItemType Directory -Force -Path $EngineDir | Out-Null

# ---------- Manifeste ----------

Step "Lecture du manifeste"
$manifest = Invoke-RestMethod -Uri "$SiteUrl/install/manifest.json" -UseBasicParsing
$plat = $manifest.platforms.'windows-x64'
Say "KataGo $($manifest.katagoVersion)"

if ($Strong) { $net = $manifest.networks.strong } else { $net = $manifest.networks.default }
if ($Cpu)    { $asset = $plat.cpu }              else { $asset = $plat.gpu }
if ($Cpu)    { Say "Version CPU demandee." }     else { Say "Version GPU (OpenCL)." }

# ---------- Node portable si besoin ----------

Step "Recherche de Node.js"
$nodeCmd = $null
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if ($sysNode) {
    $nodeCmd = $sysNode.Source
    Say "Node.js du systeme : $(& $nodeCmd -v)"
} else {
    Say "Node.js absent : installation d'une version portable, locale a ce dossier."
    $nv      = $manifest.nodeVersion
    $nodeZip = Join-Path $Root "node-$nv-win-x64.zip"
    $nodeDir = Join-Path $Root "node-$nv-win-x64"
    Get-File "https://nodejs.org/dist/$nv/node-$nv-win-x64.zip" $nodeZip "Node.js $nv (~30 Mo)"
    if (-not (Test-Path $nodeDir)) {
        Expand-Archive -Path $nodeZip -DestinationPath $Root -Force
    }
    $nodeCmd = Join-Path $nodeDir 'node.exe'
    if (-not (Test-Path $nodeCmd)) { throw "Node portable introuvable apres extraction." }
    Say "Node.js portable pret."
}

# ---------- Moteur ----------

Step "Telechargement du moteur KataGo"
$engineZip = Join-Path $Root $asset
Get-File "https://github.com/lightvector/KataGo/releases/download/$($manifest.katagoVersion)/$asset" $engineZip "Moteur (~5 Mo)"

$exePath = Join-Path $EngineDir $plat.exe
if (-not (Test-Path $exePath)) {
    Say "Extraction ..."
    Expand-Archive -Path $engineZip -DestinationPath $EngineDir -Force
}
if (-not (Test-Path $exePath)) { throw "katago.exe introuvable apres extraction." }

# ---------- Reseau de neurones ----------

Step "Telechargement du reseau de neurones"
Say $net.label
$netPath = Join-Path $EngineDir 'net.bin.gz'
$mb = [math]::Round($net.bytes / 1MB)
Get-File "$($manifest.networkBaseUrl)$($net.file)" $netPath "Reseau (~$mb Mo, soyez patient)"

# ---------- Configuration ----------

Step "Configuration du moteur"
$cfgPath = Join-Path $EngineDir 'analysis.cfg'
$example = Join-Path $EngineDir 'analysis_example.cfg'
if (-not (Test-Path $example)) { throw "analysis_example.cfg absent de l'archive KataGo." }

# reportAnalysisWinratesAs vaut BLACK par defaut : le taux de victoire serait
# alors toujours donne du point de vue de Noir, ce qui fausse la logique
# d'abandon de l'IA des qu'elle joue Blanc.
(Get-Content $example) `
    -replace '^reportAnalysisWinratesAs = BLACK', 'reportAnalysisWinratesAs = SIDETOMOVE' `
    -replace '^numAnalysisThreads = 2', 'numAnalysisThreads = 1' |
    Set-Content -Path $cfgPath -Encoding utf8
Say "analysis.cfg ecrit."

# ---------- Pont + jeu (repli local) ----------

Step "Telechargement du pont"
$bridgePath = Join-Path $Root 'bridge.js'
Remove-Item $bridgePath -ErrorAction SilentlyContinue  # toujours reprendre la derniere version
Get-File "$SiteUrl/server/bridge.js" $bridgePath "bridge.js"

# Le pont sert aussi le jeu : ainsi, meme sous Safari (qui refuse le loopback
# depuis une page HTTPS distante), on peut jouer en ouvrant http://127.0.0.1:8081.
Step "Telechargement du jeu (pour jouer aussi en local)"
foreach ($f in @('index.html', 'script.js', 'katago.js', 'style.css')) {
    $dest = Join-Path $Root $f
    Remove-Item $dest -ErrorAction SilentlyContinue
    Get-File "$SiteUrl/$f" $dest $f
}

# ---------- Lanceur ----------

$launcher = Join-Path $Root 'demarrer-katago.cmd'
@"
@echo off
title Pont KataGo - Online Go Game
cd /d "%~dp0"
"$nodeCmd" bridge.js
pause
"@ | Set-Content -Path $launcher -Encoding ascii

if ($AutoStart) {
    Step "Lancement automatique a l'ouverture de session"
    $startup = [Environment]::GetFolderPath('Startup')
    $lnk = Join-Path $startup 'Pont KataGo.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $launcher
    $sc.WorkingDirectory = $Root
    $sc.WindowStyle = 7   # reduit dans la barre des taches
    $sc.Save()
    Say "Raccourci cree. Retirez-le de '$startup' pour desactiver."
}

# ---------- Demarrage ----------

Write-Host ""
Write-Host "  Installation terminee." -ForegroundColor Green
Say "Dossier : $Root"
Say "Relancer plus tard : $launcher"
Write-Host ""
Write-Host "  Le tout premier demarrage calibre votre GPU et prend plusieurs" -ForegroundColor Yellow
Write-Host "  minutes. Les suivants sont immediats." -ForegroundColor Yellow
Write-Host ""
Say "Ouvrez ensuite $SiteUrl et cliquez sur Jouer contre KataGo."
Write-Host ""

Start-Process -FilePath $launcher -WorkingDirectory $Root
