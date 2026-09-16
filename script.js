/* ================= ETAT DU JEU ================= */
// 'solo' ou 'multi' : quel moteur de jeu possede actuellement les zones
// partagees (timeline-container, main-joueur, btn-valider, ...). Change par
// script.js (solo) et multi.js (multijoueur) selon le mode actif, pour que
// le bouton Valider (entre autres) sache a qui delegue l'action.
let modeActuel = 'solo';
let pioche = [];
let main = [];
let timeline = [];
let erreurs = [];
let carteChoisie = null;
let indexZoneSelectionnee = null;
let carteInspectee = null;
let carteRepereInitiale = null;
let modeSoloNoHit = false;
let noHitCompteurActuel = 0;

/* Cache des <div class="carte"> deja crees, par objet carte (cle) : evite de
   detruire/recreer (donc de refaire charger l'image depuis zero) une carte
   deja affichee a chaque fois que render() est appele. Avant ce cache,
   TOUTE la timeline/la main/la poubelle etait reconstruite du neant a
   chaque placement de carte (via innerHTML = ''), ce qui relancait le
   chargement de CHAQUE image deja affichee : un scintillement visible,
   parfois meme un texte alt agrandi le temps du rechargement sur Firefox
   (voir aussi le font-size:0 sur .decor img dans style.css). Reinitialise a
   chaque nouvelle partie (voir initPartie()). */
let cacheCartesTimeline = new Map();
let cacheCartesMain = new Map();
let cacheCartesErreurs = new Map();

/* Le badge "En main" de l'entete de partie n'affiche plus qu'une icone (plus
   de mot, cf. demande utilisateur) : le texte descriptif (utile en
   multijoueur quand on regarde la main d'un autre joueur en tant que
   spectateur, cf. multi.js) reste porte par #label-main, mais uniquement
   pour les lecteurs d'ecran et comme infobulle au survol du badge. */
function majLabelEnMain(texte) {
  const label = document.getElementById('label-main');
  if (label) label.textContent = texte;
  const badge = document.getElementById('badge-en-main');
  if (badge) badge.title = texte;
}

/* Ouvre le panneau inspecteur (utile sur mobile, ou il est replie par
   defaut) : appele au double-clic/double-tap sur une carte pour montrer sa
   fiche complete sans etape supplementaire. */
function ouvrirPanneauInspecteur() {
  const inspecteur = document.getElementById('inspecteur');
  if (inspecteur) inspecteur.classList.remove('replie');
}

/* Detection manuelle de double-tap, en complement de l'evenement 'dblclick'
   natif : sur certains navigateurs/webview mobiles (notamment iOS, encore
   plus en PWA installee), deux taps rapproches ne declenchent pas toujours
   un 'dblclick' fiable. Branchee sur chaque 'click' (souris ET tactile,
   les deux le declenchent), c'est un filet de securite independant du
   natif -- partagee entre script.js et multi.js. */
let dernierTapCarte = null;
let dernierTapTs = 0;
function estDoubleTapSur(carte, delaiMs = 400) {
  const maintenant = Date.now();
  const estDouble = dernierTapCarte === carte && (maintenant - dernierTapTs) < delaiMs;
  dernierTapCarte = estDouble ? null : carte;
  dernierTapTs = estDouble ? 0 : maintenant;
  return estDouble;
}

/* ================= FILTRES PAR CATEGORIE =================
   Liste partagee entre solo (ci-dessous) et multijoueur (multi.js) pour
   construire les cases a cocher "quelles categories inclure dans la
   partie". Les id doivent correspondre exactement aux valeurs de
   carte.famille generees par generer_cartes.py (EMOJI_PAR_FAMILLE). */
const FAMILLES_FILTRABLES = [
  { id: 'histoire', label: 'Histoire', emoji: '📜' },
  { id: 'science', label: 'Science', emoji: '🔬' },
  { id: 'inventions', label: 'Inventions', emoji: '⚙️' },
  { id: 'culture', label: 'Culture', emoji: '🎭' },
  { id: 'architecture', label: 'Architecture', emoji: '🏛️' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
  { id: 'guerre', label: 'Guerre', emoji: '⚔️' },
  { id: 'exploration', label: 'Exploration', emoji: '🧭' },
  { id: 'mythologie', label: 'Mythologie', emoji: '🐉' },
  { id: 'sport', label: 'Sport', emoji: '🏅' },
  // Categories "bonus" : oeuvres de fiction sous droits d'auteur, placees a
  // part (a la fin, en dore) et decochees par defaut -- a l'utilisateur de
  // les activer volontairement s'il veut les inclure dans sa partie.
  { id: 'cinema', label: 'Cinéma', emoji: '🎬', bonus: true },
  { id: 'television', label: 'Télévision', emoji: '📺', bonus: true },
  { id: 'jeuxvideo', label: 'Jeux vidéo', emoji: '🎮', bonus: true },
  { id: 'manga', label: 'Manga', emoji: '🎴', bonus: true }
];
// Selection de depart (chargement de la page, ouverture du panneau multi) :
// tout sauf les categories bonus, qui restent une option volontaire. Le
// bouton "Tout" reste le seul moyen d'activer aussi les categories bonus
// d'un coup.
const FAMILLES_PAR_DEFAUT = FAMILLES_FILTRABLES.filter((f) => !f.bonus).map((f) => f.id);
// Meme principe que FAMILLES_FILTRABLES, mais pour le filtre de difficulte
// (carte.difficulte genere par generer_cartes.py a partir de la colonne
// xlsx du meme nom).
const DIFFICULTES_FILTRABLES = [
  { id: 'facile', label: 'Facile', couleur: '#2ecc71' },
  { id: 'moyenne', label: 'Moyenne', couleur: '#f39c12' },
  { id: 'difficile', label: 'Difficile', couleur: '#e74c3c' }
];
const DIFFICULTE_INFO = Object.fromEntries(DIFFICULTES_FILTRABLES.map((d) => [d.id, d]));
// Petite icone SVG "recommencer" reutilisee sur les boutons Rejouer/Retenter.
const ICONE_RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
// Nombre minimum de cartes necessaires pour qu'une partie soit jouable
// (1 carte repere + au moins une main complete) ; sert a bloquer un
// lancement de partie si le joueur a trop filtre les categories.
const CARTES_MIN_PARTIE = 6;

/* Construit une grille de cases a cocher dans #conteneurId, une par entree
   de `liste` (FAMILLES_FILTRABLES ou DIFFICULTES_FILTRABLES), cochee si
   presente dans ensembleActif (un Set modifie sur place). onChange est
   appele apres chaque clic (utile pour desactiver un bouton "Demarrer" si
   plus assez de cartes ne restent, par ex.). */
function creerGrilleFiltres(conteneurId, ensembleActif, onChange, liste = FAMILLES_FILTRABLES) {
  const conteneur = document.getElementById(conteneurId);
  if (!conteneur) return;
  conteneur.innerHTML = '';
  liste.forEach((f) => {
    const label = document.createElement('label');
    label.className = 'filtre-famille' + (f.bonus ? ' filtre-famille--bonus' : '');
    const coche = ensembleActif.has(f.id) ? 'checked' : '';
    const puce = f.couleur
      ? `<span class="pastille-diff" style="background:${f.couleur}"></span>`
      : `${f.emoji} `;
    label.innerHTML = `<input type="checkbox" ${coche}><span>${puce}${f.label}</span>`;
    const checkbox = label.querySelector('input');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) ensembleActif.add(f.id); else ensembleActif.delete(f.id);
      if (onChange) onChange();
    });
    conteneur.appendChild(label);
  });
}

function compterCartesFiltrees(famillesActives, difficultesActives) {
  return BASE_CARTES.reduce((n, c) =>
    n + (!c.cachee && famillesActives.has(c.famille) && difficultesActives.has(c.difficulte) ? 1 : 0), 0);
}

/* Ouverture/fermeture des blocs de filtres repliables ("onglets") : clic sur
   le bouton-titre pour montrer/cacher la grille de cases a cocher en
   dessous. Purement visuel (CSS), independant du solo/multi. */
function initAccordeonsFiltres() {
  document.querySelectorAll('.lobby-filtres-titre-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.lobby-filtres').classList.toggle('ouverte');
    });
  });
}
initAccordeonsFiltres();

/* ================= INITIALISATION ================= */
function melanger(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Filtres actifs en solo : toutes les familles (hors bonus) / difficultes cochees par defaut.
let filtresSoloActifs = new Set(FAMILLES_PAR_DEFAUT);
let filtresDifficulteSoloActifs = new Set(DIFFICULTES_FILTRABLES.map((d) => d.id));

function initPartie() {
  // Une carte marquee "cachee" par l'admin (voir admin.js) est exclue de
  // TOUTE partie tant qu'elle n'est pas reactivee -- y compris du repli
  // ci-dessous (source = ... : BASE_CARTES), qui ignorerait sinon
  // completement le filtre en cas de pool trop petit.
  const cartesJouables = BASE_CARTES.filter((c) => !c.cachee);
  const pool = cartesJouables.filter((c) => filtresSoloActifs.has(c.famille) && filtresDifficulteSoloActifs.has(c.difficulte));
  const source = pool.length >= CARTES_MIN_PARTIE ? pool : cartesJouables;
  const toutes = melanger(source);
  carteRepereInitiale = toutes[0];
  timeline = [carteRepereInitiale];
  main = toutes.slice(1, 6);
  pioche = toutes.slice(6);
  erreurs = [];
  carteChoisie = null;
  indexZoneSelectionnee = null;
  carteInspectee = null;
  noHitCompteurActuel = 0;
  cacheCartesTimeline = new Map();
  cacheCartesMain = new Map();
  cacheCartesErreurs = new Map();
  document.getElementById('ecran-fin-container').innerHTML = '';
  render();
}

/* ================= FILTRES SOLO (panneau Lobby) ================= */
function majCompteFiltresSolo() {
  const n = compterCartesFiltrees(filtresSoloActifs, filtresDifficulteSoloActifs);
  const texte = n < CARTES_MIN_PARTIE
    ? `Seulement ${n} carte${n > 1 ? 's' : ''} avec ce filtre (minimum ${CARTES_MIN_PARTIE}) — toutes les catégories seront utilisées à la place.`
    : `${n} carte${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''} avec ce filtre.`;
  ['lobby-filtres-compte-solo', 'lobby-filtres-compte-solo-difficulte'].forEach((id) => {
    const zone = document.getElementById(id);
    if (zone) zone.textContent = texte;
  });
}
creerGrilleFiltres('lobby-filtres-grille-solo', filtresSoloActifs, majCompteFiltresSolo);
creerGrilleFiltres('lobby-filtres-difficulte-grille-solo', filtresDifficulteSoloActifs, majCompteFiltresSolo, DIFFICULTES_FILTRABLES);
majCompteFiltresSolo();

document.getElementById('btn-filtres-solo-tout').addEventListener('click', () => {
  filtresSoloActifs = new Set(FAMILLES_FILTRABLES.map((f) => f.id));
  creerGrilleFiltres('lobby-filtres-grille-solo', filtresSoloActifs, majCompteFiltresSolo);
  majCompteFiltresSolo();
});
document.getElementById('btn-filtres-solo-aucun').addEventListener('click', () => {
  filtresSoloActifs.clear();
  creerGrilleFiltres('lobby-filtres-grille-solo', filtresSoloActifs, majCompteFiltresSolo);
  majCompteFiltresSolo();
});
document.getElementById('btn-filtres-difficulte-solo-tout').addEventListener('click', () => {
  filtresDifficulteSoloActifs = new Set(DIFFICULTES_FILTRABLES.map((d) => d.id));
  creerGrilleFiltres('lobby-filtres-difficulte-grille-solo', filtresDifficulteSoloActifs, majCompteFiltresSolo, DIFFICULTES_FILTRABLES);
  majCompteFiltresSolo();
});
document.getElementById('btn-filtres-difficulte-solo-aucun').addEventListener('click', () => {
  filtresDifficulteSoloActifs.clear();
  creerGrilleFiltres('lobby-filtres-difficulte-grille-solo', filtresDifficulteSoloActifs, majCompteFiltresSolo, DIFFICULTES_FILTRABLES);
  majCompteFiltresSolo();
});

/* ================= MODE NO HIT RUN =================
   Variante solo : la moindre erreur relance aussitot une nouvelle partie.
   Le score (nombre de cartes placees sans faute) est sauvegarde dans
   Firebase sous le pseudo du panneau Lobby, un seul enregistrement par
   pseudo (ecrase seulement si le nouveau score est meilleur). */
document.getElementById('btn-solo-mode-normal').addEventListener('click', () => {
  modeSoloNoHit = false;
  document.getElementById('btn-solo-mode-normal').classList.add('actif');
  document.getElementById('btn-solo-mode-nohit').classList.remove('actif');
  document.getElementById('nohit-explication').hidden = true;
  document.getElementById('lobby-classement-nohit').hidden = true;
});
document.getElementById('btn-solo-mode-nohit').addEventListener('click', () => {
  modeSoloNoHit = true;
  document.getElementById('btn-solo-mode-nohit').classList.add('actif');
  document.getElementById('btn-solo-mode-normal').classList.remove('actif');
  document.getElementById('nohit-explication').hidden = false;
  document.getElementById('lobby-classement-nohit').hidden = false;
  chargerClassementNoHit();
});

// Cle Firebase valide (pas de . # $ [ ] /) derivee du pseudo : un pseudo =
// une entree, la reecrire remplace l'ancienne au lieu d'en creer une autre.
function clePseudoNoHit(pseudo) {
  const nettoye = (pseudo || '').trim().toLowerCase().replace(/[.#$\[\]/]/g, '_');
  return nettoye || 'anonyme';
}

function chargerClassementNoHit() {
  const zone = document.getElementById('classement-nohit-liste');
  if (typeof dbRef === 'undefined' || !dbRef) {
    zone.innerHTML = '<div class="info-bloc lobby-note">Classement indisponible (Firebase non configuré).</div>';
    return;
  }
  dbRef.ref('classementNoHit').on('value', (snap) => {
    const data = snap.val() || {};
    const liste = Object.values(data).sort((a, b) => b.score - a.score).slice(0, 20);
    if (liste.length === 0) {
      zone.innerHTML = '<div class="info-bloc lobby-note">Aucun record pour l\'instant. Sois le premier !</div>';
      return;
    }
    zone.innerHTML = liste.map((entree, i) => `
      <div class="classement-ligne ${i === 0 ? 'classement-ligne--or' : ''}">
        <span class="classement-rang">${i + 1}</span>
        <span class="classement-pseudo">${entree.pseudo}</span>
        <span class="classement-score">${entree.score}</span>
      </div>
    `).join('');
  });
}

async function enregistrerScoreNoHit(score) {
  if (typeof dbRef === 'undefined' || !dbRef) return;
  if (score <= 0) return;
  const champPseudo = document.getElementById('pseudo-joueur');
  const pseudo = (champPseudo && champPseudo.value.trim()) || 'Toi';
  const cle = clePseudoNoHit(pseudo);
  try {
    const ref = dbRef.ref('classementNoHit/' + cle);
    const snap = await ref.once('value');
    const existant = snap.val();
    if (!existant || score > existant.score) {
      await ref.set({ pseudo, score, maj_le: Date.now() });
    }
  } catch (e) {
    console.warn('Enregistrement du score No Hit Run impossible :', e);
  }
}

function terminerNoHitRun(parfait) {
  const score = noHitCompteurActuel;
  enregistrerScoreNoHit(score);
  document.getElementById('btn-valider').disabled = true;

  const container = document.getElementById('ecran-fin-container');
  container.innerHTML = parfait ? `
    <div class="ecran-fin ecran-fin--nohit-parfait">
      <h2>Sans-faute total !</h2>
      <p>Tu as placé les <strong>${score}</strong> cartes sans une seule erreur !</p>
      <button class="btn-rejouer" id="btn-rejouer-nohit">${ICONE_RESTART} Rejouer</button>
    </div>
  ` : `
    <div class="ecran-fin ecran-fin--nohit-echec">
      <h2>Erreur fatale !</h2>
      <p>Cartes placées sans faute : <strong>${score}</strong></p>
      <p style="opacity:0.6; font-size:13px;">En mode No Hit Run, la moindre erreur relance une nouvelle partie.</p>
      <button class="btn-rejouer" id="btn-rejouer-nohit">${ICONE_RESTART} Retenter</button>
    </div>
  `;
  document.getElementById('btn-rejouer-nohit').addEventListener('click', initPartie);
}

/* ================= AUDIO (synthétisé, pas de fichier externe) ================= */
function jouerSonBonneReponse() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.1;
      gain.gain.setValueAtTime(0.15, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (e) { /* audio indisponible, on ignore */ }
}

/* Petite fanfare jouee quand le premier joueur d'une partie multijoueur
   termine sa main (voir multi.js : afficherMessagePremierFini). */
function jouerSonVictoire() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  } catch (e) { /* audio indisponible, on ignore */ }
}

function jouerSonErreur() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) { /* audio indisponible, on ignore */ }
}

/* Petit carillon joue en multijoueur quand la main revient a nous (voir
   multi.js : surMiseAJourPartie detecte la transition de tour pour n'appeler
   ceci qu'une seule fois par changement, pas a chaque tick du timer). */
function jouerSonTonTour() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.13;
      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
      osc.start(start);
      osc.stop(start + 0.35);
    });
  } catch (e) { /* audio indisponible, on ignore */ }
}

/* ================= INDICATEUR DE TOUR (multijoueur, reglage personnel) =================
   Prefererence individuelle (localStorage, pas synchronisee via Firebase --
   chacun choisit pour soi dans le lobby, voir #btn-indicateur-tour dans
   multi.js) : quand actif, une courte animation du logo (tourbillon qui
   tourne) apparait au centre de l'ecran des que c'est reellement notre
   tour, en plus du petit carillon sonore existant (jouerSonTonTour). En
   Mode Pro, precise aussi le numero du round en cours. */
// Etat garde en memoire (pas seulement relu depuis localStorage a chaque
// appel) : si l'ecriture localStorage echoue silencieusement (mode prive,
// stockage plein, etc.), le bouton se serait affiche "actif" sans que la
// preference soit reellement enregistree, et l'animation n'aurait alors
// jamais pu se declencher malgre un bouton visuellement coche.
let indicateurTourEtat = false;
try { indicateurTourEtat = localStorage.getItem('timeline_indicateur_tour') === '1'; } catch (e) {}
function indicateurTourActif() { return indicateurTourEtat; }
function definirIndicateurTour(actif) {
  indicateurTourEtat = actif;
  try { localStorage.setItem('timeline_indicateur_tour', actif ? '1' : '0'); } catch (e) {}
}
function afficherIndicateurTonTour(numeroRound) {
  if (!indicateurTourActif()) return;
  const el = document.createElement('div');
  el.className = 'indicateur-tour';
  el.innerHTML = `
    <div class="indicateur-tour-tourbillon">
      <img src="images/logo-vortex.svg?v=2" alt="">
      <div class="indicateur-tour-texte">${numeroRound ? `<span class="indicateur-tour-round">Round ${numeroRound}</span>` : ''}À toi de jouer !</div>
    </div>
  `;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('indicateur-tour--fermeture');
    setTimeout(() => el.remove(), 200);
  }, 900);
}

/* ================= UTILITAIRES ================= */
/* Formate une duree en "X millions/milliards d'annees" ou, au-dela de mille
   milliards, en notation "10^N ans" (seule maniere lisible d'exprimer des
   echelles comme la mort thermique de l'univers, ~10^100 ans). */
function formaterGrandeDuree(abs) {
  if (abs >= 1e12) return `10^${Math.round(Math.log10(abs))} ans`;
  if (abs >= 1e9) {
    const milliards = abs / 1e9;
    const arrondi = Number.isInteger(milliards) ? milliards : Math.round(milliards * 10) / 10;
    return `${arrondi.toLocaleString('fr-FR')} milliard${arrondi > 1 ? 's' : ''} d'années`;
  }
  const millions = abs / 1e6;
  const arrondi = Number.isInteger(millions) ? millions : Math.round(millions * 10) / 10;
  return `${arrondi.toLocaleString('fr-FR')} million${arrondi > 1 ? 's' : ''} d'années`;
}

function formaterDate(date) {
  const abs = Math.abs(date);
  if (abs >= 1000000) {
    return date < 0 ? `il y a ${formaterGrandeDuree(abs)}` : `dans ${formaterGrandeDuree(abs)}`;
  }
  if (date < 0) return `${abs.toLocaleString('fr-FR')} av. J.-C.`;
  // Dates futures exprimees comme une duree simple (ex: "100 000 ans"), pas
  // une annee calendaire : au-dela de l'horizon plausible d'une annee (~3000)
  // on l'affiche comme un delai plutot qu'un nombre brut.
  if (date >= 3000) return `dans ${abs.toLocaleString('fr-FR')} ans`;
  return `${date}`;
}

function localiserCarte(carte) {
  if (main.includes(carte)) return 'main';
  if (timeline.includes(carte)) return 'timeline';
  if (erreurs.includes(carte)) return 'erreurs';
  return null;
}

/* ================= ILLUSTRATION (image ou emoji de secours) =================
   Deux dossiers possibles pour l'illustration d'une carte :
   - images/       : illustrations personnelles de l'utilisateur (IA, style dessin) -- PRIORITAIRES.
   - images-claude/ : photos/oeuvres du domaine public recherchees par Claude pour les
     cartes que l'utilisateur n'a pas (encore) illustrees lui-meme, ou en complement.
   On essaie systematiquement id-<id>.<ext> dans images/ d'abord (l'utilisateur passe
   toujours devant), puis dans images-claude/, avant de retomber sur l'emoji. La colonne
   "image" du xlsx n'est plus utilisee pour construire le chemin (uniquement documentaire) :
   il suffit de deposer un fichier "id-47.png" dans l'un des deux dossiers pour qu'il
   s'affiche, sans toucher au xlsx ni au code. */
function candidatsImage(carte) {
  const extensions = ['jpg', 'png', 'jpeg', 'webp'];
  const dossiers = ['images', 'images-claude'];
  const base = dossiers.flatMap(dossier => extensions.map(ext => `${dossier}/id-${carte.id}.${ext}`));
  // Une carte editee depuis le panneau admin (admin.js) peut avoir plusieurs
  // images ordonnees a la main (carte.images) : toutes prioritaires, dans
  // l'ordre choisi. carte.image (singulier) reste gere pour les cartes
  // editees avant l'ajout de cette fonctionnalite (une seule image).
  if (Array.isArray(carte.images) && carte.images.length > 0) {
    return [...carte.images, ...base];
  }
  if (carte.image && /^(data:|https?:\/\/)/.test(carte.image)) {
    return [carte.image, ...base];
  }
  return base;
}

function elementDecorHTML(carte) {
  const [premier, ...reste] = candidatsImage(carte);
  const resteAttr = JSON.stringify(reste).replace(/"/g, '&quot;');
  const altAttr = (carte.titre || '').replace(/"/g, '&quot;');
  // draggable="false" est essentiel : une <img> est intrinsequement
  // "draggable" dans tous les navigateurs (glisser une image de page web est
  // un comportement natif, independant de tout JS). Sans ca, demarrer un
  // drag exactement sur les pixels de l'image (la quasi-totalite d'une
  // carte) declenche le drag natif de l'IMG a la place du drag personnalise
  // pose sur la carte parente (.carte, draggable=true) : le fantome affiche
  // alors seulement l'image nue, sans bordure ni titre ni date.
  return `<img src="${premier}" alt="${altAttr}" loading="lazy" draggable="false" data-reste='${resteAttr}' data-emoji="${carte.emoji}" onerror="essaierImageSuivante(this)">`;
}

function essaierImageSuivante(img) {
  const reste = JSON.parse(img.dataset.reste.replace(/&quot;/g, '"'));
  if (reste.length > 0) {
    const [prochain, ...suite] = reste;
    img.dataset.reste = JSON.stringify(suite).replace(/"/g, '&quot;');
    img.src = prochain;
  } else {
    const span = document.createElement('span');
    span.textContent = img.dataset.emoji;
    img.replaceWith(span);
  }
}

/* Cherche la premiere extension existante pour id-<id> dans un dossier donne
   (par essai de chargement reel, pas de simple pari sur une extension) ;
   resout vers l'URL trouvee, ou null si aucune des extensions ne fonctionne. */
function trouverImageDansDossier(id, dossier) {
  const extensions = ['jpg', 'png', 'jpeg', 'webp'];
  return new Promise((resolve) => {
    let i = 0;
    function essayer() {
      if (i >= extensions.length) { resolve(null); return; }
      const url = `${dossier}/id-${id}.${extensions[i]}`;
      const test = new Image();
      test.onload = () => resolve(url);
      test.onerror = () => { i += 1; essayer(); };
      test.src = url;
    }
    essayer();
  });
}

/* Uniquement dans l'inspecteur (solo et multi, via #contenu-inspecteur) :
   si la carte dispose a la fois d'une illustration personnelle (images/) ET
   d'une photo trouvee par Claude (images-claude/), affiche deux petites
   fleches pour basculer de l'une a l'autre -- l'illustration personnelle
   reste prioritaire et s'affiche en premier. Ne fait rien si un seul des
   deux existe (rien a basculer). Asynchrone : le rendu initial (emoji ou
   premiere image trouvee via candidatsImage) reste instantane, les fleches
   n'apparaissent qu'une fois la verification terminee. */
function configurerNavigationIllustration(carte, zone) {
  const decor = zone.querySelector(`.decor-grand[data-carte-id="${carte.id}"]`);
  if (!decor) return;

  function activerNavigation(sources) {
    // La carte inspectee a pu changer pendant l'attente (cas du repli
    // asynchrone ci-dessous) : on abandonne si ce n'est plus la meme
    // (evite d'activer des fleches sur la mauvaise carte).
    if (!zone.contains(decor) || !decor.isConnected) return;
    if (zone.querySelector(`.decor-grand[data-carte-id="${carte.id}"]`) !== decor) return;
    if (sources.length < 2) return;
    let index = 0;
    const img = decor.querySelector('img');
    const btnGauche = decor.querySelector('.btn-decor-nav--gauche');
    const btnDroite = decor.querySelector('.btn-decor-nav--droite');
    if (!img || !btnGauche || !btnDroite) return;
    function majAffichage() {
      img.src = sources[index];
      btnGauche.hidden = index === 0;
      btnDroite.hidden = index === sources.length - 1;
    }
    majAffichage();
    btnGauche.addEventListener('click', () => { index = Math.max(0, index - 1); majAffichage(); });
    btnDroite.addEventListener('click', () => { index = Math.min(sources.length - 1, index + 1); majAffichage(); });
  }

  // Priorite : les images definies dans le panneau admin (carte.images,
  // ordonnees a la main) -- navigables directement, sans sondage du
  // systeme de fichiers.
  if (Array.isArray(carte.images) && carte.images.length > 1) {
    activerNavigation(carte.images);
    return;
  }

  // Sinon, comportement historique : si la carte dispose a la fois d'une
  // illustration personnelle (images/) ET d'une photo trouvee par Claude
  // (images-claude/), propose de basculer entre les deux. Asynchrone : le
  // rendu initial (emoji ou premiere image trouvee via candidatsImage)
  // reste instantane, les fleches n'apparaissent qu'une fois la
  // verification terminee.
  Promise.all([
    trouverImageDansDossier(carte.id, 'images'),
    trouverImageDansDossier(carte.id, 'images-claude'),
  ]).then(([urlPerso, urlClaude]) => activerNavigation([urlPerso, urlClaude].filter(Boolean)));
}

/* ================= CREATION D'ELEMENTS CARTE ================= */
function calculerClassesCarte(carte, options = {}) {
  let classes = `carte famille-${carte.famille}`;
  if (options.repere) classes += ' repere';
  if (options.selectionnee) classes += ' selectionnee';
  if (options.inspectee) classes += ' inspectee';
  if (options.derniereJouee) classes += ' derniere-jouee';
  return classes;
}

function creerCarteHTML(carte, options = {}) {
  const div = document.createElement('div');
  div.className = calculerClassesCarte(carte, options);

  const dateTexte = options.cacherDate ? '?' : formaterDate(carte.date);
  div.innerHTML = `
    <div class="decor">${elementDecorHTML(carte)}</div>
    <div class="titre-carte">${carte.titre}</div>
    <div class="date-carte ${options.cacherDate ? 'cachee' : ''}">${dateTexte}</div>
  `;
  return div;
}

/* ================= GLISSER-DEPOSER UNIFIE (souris + tactile) =================
   Remplace le Drag and Drop HTML5 natif (draggable + dragstart/dragover/drop),
   qui a deux defauts genants : son rendu de "fantome" est incoherent d'un
   navigateur a l'autre (Firefox l'affiche dans un style tres degrade par
   rapport a Chrome, sans qu'on puisse vraiment le controler), et il ne
   fonctionne tout simplement PAS au toucher sur mobile (les navigateurs
   mobiles n'emettent pas d'evenements dragstart/dragover pour un geste
   tactile). A la place, on gere nous-memes un fantome (clone DOM de la
   carte, position:fixed) pilote par les Pointer Events, qui unifient
   souris/tactile/stylet en une seule API geree pareil partout : ca resout
   les deux problemes d'un coup avec un seul mecanisme.

   Cette fonction NE remplace PAS le flux existant "cliquer la carte pour la
   selectionner, puis cliquer le + de la zone souhaitee" (toujours gere par
   onTap ci-dessous, appele pour un simple tap sans mouvement reel) : les deux
   cohabitent, le joueur choisit celui qu'il prefere. */
function rendreCarteInteractive(div, { onTap, onDepose, estActif }) {
  const SEUIL_DEPLACEMENT = 6; // px avant de considerer que c'est un glisser, pas un tap
  let origine = null;
  let pointerId = null;
  let dragActif = false;
  let venaitDeGlisser = false;
  let fantome = null;
  let zoneSurvolee = null;

  function nettoyerFantome() {
    if (fantome) { fantome.remove(); fantome = null; }
  }

  div.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // estActif() est reevalue a CHAQUE geste (pas fige a la creation de la
    // carte) : utile en multijoueur ou une carte peut etre re-servie par le
    // cache d'un rendu a l'autre alors que ce n'est plus/pas encore le tour
    // du joueur (voir renderMainMulti dans multi.js). Si absent, toujours actif.
    if (estActif && !estActif()) return;
    origine = { x: e.clientX, y: e.clientY };
    pointerId = e.pointerId;
    dragActif = false;
  });

  div.addEventListener('pointermove', (e) => {
    if (origine === null || e.pointerId !== pointerId) return;
    const dx = e.clientX - origine.x;
    const dy = e.clientY - origine.y;
    if (!dragActif) {
      if (Math.hypot(dx, dy) < SEUIL_DEPLACEMENT) return;
      dragActif = true;
      try { div.setPointerCapture(pointerId); } catch (err) { /* ignore : deja capture ou pointeur invalide */ }
      const rect = div.getBoundingClientRect();
      fantome = div.cloneNode(true);
      fantome.classList.add('carte-drag-fantome');
      fantome.style.width = rect.width + 'px';
      fantome.style.height = rect.height + 'px';
      fantome.style.left = rect.left + 'px';
      fantome.style.top = rect.top + 'px';
      document.body.appendChild(fantome);
      div.classList.add('carte-source-glissee');
    }
    e.preventDefault();
    const rect = fantome.getBoundingClientRect();
    fantome.style.left = (e.clientX - rect.width / 2) + 'px';
    fantome.style.top = (e.clientY - rect.height / 2) + 'px';
    const sousLePointeur = document.elementFromPoint(e.clientX, e.clientY);
    const zone = sousLePointeur ? sousLePointeur.closest('.zone-depot') : null;
    if (zone !== zoneSurvolee) {
      if (zoneSurvolee) zoneSurvolee.classList.remove('survol');
      if (zone) zone.classList.add('survol');
      zoneSurvolee = zone;
    }
  }, { passive: false }); // explicite : garantit que preventDefault() ci-dessus bloque bien le scroll tactile, meme si un navigateur mobile particulier traiterait pointermove comme passif par defaut

  function terminerGeste(e) {
    if (origine === null || (e && e.pointerId !== pointerId)) return;
    origine = null;
    if (!dragActif) return;
    dragActif = false;
    venaitDeGlisser = true;
    div.classList.remove('carte-source-glissee');
    const zoneCible = zoneSurvolee;
    if (zoneSurvolee) zoneSurvolee.classList.remove('survol');
    zoneSurvolee = null;

    if (zoneCible) {
      // Anime le fantome jusqu'a la position exacte de la zone cible avant de
      // le retirer : c'est ce petit "snap" final qui rend le geste fluide.
      const r = zoneCible.getBoundingClientRect();
      fantome.style.transition = 'left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease';
      fantome.style.left = r.left + 'px';
      fantome.style.top = r.top + 'px';
      fantome.style.width = r.width + 'px';
      fantome.style.height = r.height + 'px';
      setTimeout(() => { nettoyerFantome(); onDepose(zoneCible); }, 180);
    } else {
      // Aucune zone valide sous le doigt/curseur au relachement : la carte
      // revient a son point de depart avec un petit effet de rebond.
      const r = div.getBoundingClientRect();
      fantome.style.transition = 'left 0.22s cubic-bezier(.34,1.56,.64,1), top 0.22s cubic-bezier(.34,1.56,.64,1)';
      fantome.style.left = r.left + 'px';
      fantome.style.top = r.top + 'px';
      setTimeout(nettoyerFantome, 220);
    }
  }
  div.addEventListener('pointerup', terminerGeste);
  div.addEventListener('pointercancel', terminerGeste);

  // Un simple tap (sans depassement du seuil de deplacement) declenche le
  // clic normal ; un clic qui suit un VRAI glisser est ignore (sinon on
  // declencherait aussi une (re)selection de la carte en plus de son depot).
  div.addEventListener('click', () => {
    if (venaitDeGlisser) { venaitDeGlisser = false; return; }
    if (onTap) onTap();
  });
}

/* ================= RENDU PRINCIPAL ================= */
function render() {
  renderTimeline();
  renderMain();
  renderPiocheErreurs();
  renderInspecteur();

  document.getElementById('nb-main').textContent = main.length;
  const cartesLobby = document.getElementById('lobby-joueur-cartes');
  if (cartesLobby) cartesLobby.textContent = `${main.length} carte${main.length === 1 ? '' : 's'}`;
  document.getElementById('nb-erreurs').textContent = erreurs.length;
  document.getElementById('nb-pioche').textContent = pioche.length;

  document.getElementById('badge-erreurs').hidden = modeSoloNoHit;
  document.getElementById('badge-nohit').hidden = !modeSoloNoHit;
  if (modeSoloNoHit) document.getElementById('nb-nohit').textContent = noHitCompteurActuel;

  document.getElementById('btn-valider').disabled = (indexZoneSelectionnee === null || carteChoisie === null);

  if (main.length === 0) {
    if (modeSoloNoHit) terminerNoHitRun(true);
    else afficherEcranFin();
  }
}

function renderTimeline() {
  const container = document.getElementById('timeline-container');
  const nouveauCache = new Map();
  const nodes = [creerZoneDepot(0)];

  timeline.forEach((carte, i) => {
    const options = { repere: carte === carteRepereInitiale, inspectee: carteInspectee === carte };
    let carteDiv = cacheCartesTimeline.get(carte);
    if (!carteDiv) {
      carteDiv = creerCarteHTML(carte, options);
      carteDiv.addEventListener('click', () => {
        selectionnerCartePourInspecteur(carte);
        if (estDoubleTapSur(carte)) ouvrirPanneauInspecteur();
      });
      carteDiv.addEventListener('dblclick', () => {
        selectionnerCartePourInspecteur(carte);
        ouvrirPanneauInspecteur();
      });
    } else {
      carteDiv.className = calculerClassesCarte(carte, options);
    }
    nouveauCache.set(carte, carteDiv);
    nodes.push(carteDiv);
    nodes.push(creerZoneDepot(i + 1));
  });

  cacheCartesTimeline = nouveauCache;
  container.replaceChildren(...nodes);
}

function creerZoneDepot(index) {
  const zone = document.createElement('div');
  zone.className = 'zone-depot';
  zone.dataset.index = index;

  if (indexZoneSelectionnee === index && carteChoisie) {
    zone.classList.add('attente');
    zone.innerHTML = `
      <div class="decor">${elementDecorHTML(carteChoisie)}</div>
      <div class="attente-titre">${carteChoisie.titre}</div>
    `;
    // La carte deja placee dans cette zone (en attente de validation) reste
    // elle-meme glissable : on la reprend directement pour la deposer sur
    // une AUTRE zone-depot, sans devoir la retaper depuis la main.
    rendreCarteInteractive(zone, {
      onTap: () => {},
      onDepose: (zoneCible) => {
        indexZoneSelectionnee = Number(zoneCible.dataset.index);
        render();
      },
    });
  } else {
    zone.textContent = '+';
    zone.addEventListener('click', () => {
      if (carteChoisie) {
        indexZoneSelectionnee = index;
        render();
      }
    });
  }

  return zone;
}

function renderMain() {
  const container = document.getElementById('main-joueur');
  const nouveauCache = new Map();

  const nodes = main.map((carte) => {
    const options = { cacherDate: true, selectionnee: carteChoisie === carte, inspectee: carteInspectee === carte };
    let div = cacheCartesMain.get(carte);
    if (!div) {
      div = creerCarteHTML(carte, options);
      rendreCarteInteractive(div, {
        onTap: () => {
          selectionnerCartePourInspecteur(carte);
          if (carteChoisie !== carte) {
            indexZoneSelectionnee = null;
          }
          carteChoisie = carte;
          render();
          if (estDoubleTapSur(carte)) ouvrirPanneauInspecteur();
        },
        onDepose: (zoneCible) => {
          carteChoisie = carte;
          indexZoneSelectionnee = Number(zoneCible.dataset.index);
          render();
        },
      });
      div.addEventListener('dblclick', () => {
        selectionnerCartePourInspecteur(carte);
        ouvrirPanneauInspecteur();
      });
    } else {
      div.className = calculerClassesCarte(carte, options);
    }
    nouveauCache.set(carte, div);
    return div;
  });

  cacheCartesMain = nouveauCache;
  container.replaceChildren(...nodes);
}

function renderPiocheErreurs() {
  const container = document.getElementById('pioche-erreurs');

  if (erreurs.length === 0) {
    cacheCartesErreurs = new Map();
    const vide = document.createElement('div');
    vide.className = 'carte-erreur-vide';
    vide.textContent = 'Aucune erreur pour le moment — tant mieux !';
    container.replaceChildren(vide);
    return;
  }

  const nouveauCache = new Map();
  const nodes = erreurs.map((carte) => {
    let div = cacheCartesErreurs.get(carte);
    if (!div) {
      div = document.createElement('div');
      div.innerHTML = `
        <div class="decor">${elementDecorHTML(carte)}</div>
        <div class="titre-carte">${carte.titre}</div>
        <div class="date-carte">${formaterDate(carte.date)}</div>
      `;
      div.addEventListener('click', () => {
        selectionnerCartePourInspecteur(carte);
        if (estDoubleTapSur(carte)) ouvrirPanneauInspecteur();
      });
      div.addEventListener('dblclick', () => {
        selectionnerCartePourInspecteur(carte);
        ouvrirPanneauInspecteur();
      });
    }
    div.className = 'carte-erreur' + (carteInspectee === carte ? ' inspectee' : '');
    nouveauCache.set(carte, div);
    return div;
  });

  cacheCartesErreurs = nouveauCache;
  container.replaceChildren(...nodes);
}

/* ================= INSPECTEUR DE CARTE ================= */
function selectionnerCartePourInspecteur(carte) {
  carteInspectee = carte;
  render();
}

function renderInspecteur() {
  const zone = document.getElementById('contenu-inspecteur');

  if (!carteInspectee || !localiserCarte(carteInspectee)) {
    carteInspectee = null;
    zone.innerHTML = `<div class="placeholder-inspecteur">Clique sur une carte (main, timeline ou pioche d'erreurs) pour voir ses détails complets ici.</div>`;
    return;
  }

  const carte = carteInspectee;
  const localisation = localiserCarte(carte);
  const dateVisible = localisation !== 'main';
  zone.innerHTML = construireDetailCarteHTML(carte, dateVisible);
  configurerNavigationIllustration(carte, zone);
}

/* Construit le HTML detaille d'une carte pour l'inspecteur. Partage entre le
   solo (renderInspecteur ci-dessus) et le multijoueur (multi.js), pour que
   les deux modes affichent exactement le meme contenu sans dupliquer le
   template. */
function construireDetailCarteHTML(carte, dateVisible) {
  const badgeClass = carte.fiabilite === 'avere' ? 'badge-avere'
                    : carte.fiabilite === 'debattu' ? 'badge-debattu'
                    : 'badge-legende';
  const badgeTexte = carte.fiabilite === 'avere' ? 'Avéré'
                    : carte.fiabilite === 'debattu' ? 'Débattu par les historiens'
                    : 'Légende populaire';
  const difficulteInfo = DIFFICULTE_INFO[carte.difficulte] || DIFFICULTE_INFO.moyenne;

  const iconesLiens = {
    youtube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none"/></svg>',
    wikipedia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    publication: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>',
    livre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    autre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  };
  const liens = carte.liens || [];
  const blocLiens = liens.length > 0
    ? `<div class="info-bloc">
        <span class="info-bloc-titre">Pour aller plus loin</span>
        <div class="liste-liens">
          ${liens.map(l => `<a class="lien-externe" href="${l.url}" target="_blank" rel="noopener noreferrer">${iconesLiens[l.type] || iconesLiens.autre} ${l.label}</a>`).join('')}
        </div>
      </div>`
    : '';

  // Tant que la carte n'a pas ete jouee (encore en main), on ne montre que le
  // strict necessaire pour la placer : categorie, description courte, fiabilite.
  // Le contexte approfondi, l'anecdote et les liens ne sont reveles qu'une fois
  // la carte posee (dans la timeline ou la pioche d'erreurs), pour ne pas donner
  // d'indices supplementaires pendant la reflexion.
  const blocApprofondi = dateVisible
    ? `
    <div class="info-bloc"><span class="info-bloc-titre">Contexte approfondi</span>${carte.description_longue}</div>
    ${carte.anecdote ? `<div class="info-bloc"><span class="info-bloc-titre">Le saviez-vous ?</span>${carte.anecdote}</div>` : ''}
    ${blocLiens}`
    : `<div class="placeholder-inspecteur placeholder-inspecteur--petit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icone-cadenas"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        Contexte, anecdote et liens se débloquent une fois la carte jouée.
      </div>`;

  return `
    <div class="carte-grande famille-${carte.famille}">
      <div class="decor-grand" data-carte-id="${carte.id}">
        ${elementDecorHTML(carte)}
        <button type="button" class="btn-decor-nav btn-decor-nav--gauche" hidden title="Illustration précédente">◀</button>
        <button type="button" class="btn-decor-nav btn-decor-nav--droite" hidden title="Illustration suivante">▶</button>
      </div>
      <div class="titre-grand">${carte.titre}</div>
      <div class="date-grand ${dateVisible ? '' : 'cachee'}">${dateVisible ? formaterDate(carte.date) : '?'}</div>
    </div>
    <div class="badges-inspecteur">
      <span class="badge-fiabilite ${badgeClass}">${badgeTexte}</span>
      <span class="badge-difficulte badge-difficulte--${carte.difficulte}">${difficulteInfo.label}</span>
    </div>
    <div class="info-bloc"><span class="info-bloc-titre">Catégorie</span>${carte.categorie}</div>
    <div class="info-bloc"><span class="info-bloc-titre">Description</span>${carte.description_courte}</div>
    ${blocApprofondi}
  `;
}

/* ================= VALIDATION D'UN PLACEMENT ================= */
// Le bouton est partage avec le mode multijoueur (multi.js) : on ne delegue
// a la logique solo que si le mode solo est actif, pour eviter que les deux
// moteurs ne se marchent dessus sur les memes elements du DOM.
document.getElementById('btn-valider').addEventListener('click', () => {
  if (modeActuel === 'multi') {
    if (typeof validerPlacementMulti === 'function') validerPlacementMulti();
    return;
  }
  validerPlacementSolo();
});

function validerPlacementSolo() {
  if (indexZoneSelectionnee === null || !carteChoisie) return;

  const avant = timeline[indexZoneSelectionnee - 1];
  const apres = timeline[indexZoneSelectionnee];
  const okAvant = !avant || avant.date <= carteChoisie.date;
  const okApres = !apres || carteChoisie.date <= apres.date;
  const correct = okAvant && okApres;

  document.getElementById('btn-valider').disabled = true;
  afficherMessage(correct);
  if (correct) jouerSonBonneReponse(); else jouerSonErreur();

  const zones = document.querySelectorAll('.zone-depot');
  const zoneActive = zones[indexZoneSelectionnee];
  if (zoneActive) zoneActive.classList.add(correct ? 'anim-pop' : 'anim-shake');

  const carteResolue = carteChoisie;
  const indexResolu = indexZoneSelectionnee;

  setTimeout(() => {
    carteChoisie = null;
    indexZoneSelectionnee = null;

    if (correct) {
      timeline.splice(indexResolu, 0, carteResolue);
      if (modeSoloNoHit) noHitCompteurActuel++;
      main = main.filter((c) => c !== carteResolue);
      // MODE SOLO ILLIMITE : on repioche systématiquement, même en cas de
      // bonne réponse, jusqu'à épuisement de la pioche.
      if (pioche.length > 0) main.push(pioche.shift());
      render();
      return;
    }

    // Erreur : on montre d'abord la carte (description courte, sans date ni
    // contexte approfondi) dans une pop-up ; la carte ne part reellement en
    // poubelle (ou, en No Hit Run, ne met fin a la tentative) qu'une fois
    // cette pop-up fermee par un clic.
    afficherPopupErreur(carteResolue, () => {
      if (modeSoloNoHit) {
        terminerNoHitRun(false);
        return;
      }
      erreurs.push(carteResolue);
      main = main.filter((c) => c !== carteResolue);
      if (pioche.length > 0) main.push(pioche.shift());
      render();
    });
  }, 450);
}

function afficherMessage(correct) {
  const msg = document.createElement('div');
  msg.className = 'message-resultat ' + (correct ? 'bon' : 'mauvais');
  msg.textContent = correct ? 'Bonne réponse !' : 'Mauvaise réponse !';
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 1300);
}

/* Pop-up centrale montree apres une erreur (solo et multi), avant que la
   carte ne parte reellement en poubelle : on y voit la date en grand (pour
   bien comprendre l'erreur), la carte (decor + titre) et sa description
   courte, mais pas le contexte approfondi (pour ne pas transformer l'erreur
   en lecon d'histoire non demandee). Un clic n'importe ou dans la pop-up la
   ferme et declenche onFermeture, qui est responsable de faire effectivement
   passer la carte en poubelle. */
function afficherPopupErreur(carte, onFermeture) {
  const fond = document.createElement('div');
  fond.className = 'popup-erreur-fond';
  fond.innerHTML = `
    <div class="popup-erreur-boite">
      <div class="popup-erreur-date">${formaterDate(carte.date)}</div>
      <div class="carte-grande famille-${carte.famille}">
        <div class="decor-grand">${elementDecorHTML(carte)}</div>
        <div class="titre-grand">${carte.titre}</div>
      </div>
      <div class="popup-erreur-description">${carte.description_courte}</div>
      <div class="popup-erreur-indice">Clique n'importe où pour continuer</div>
    </div>
  `;
  fond.addEventListener('click', () => {
    fond.remove();
    onFermeture();
  });
  document.body.appendChild(fond);
}

/* ================= ECRAN DE FIN ================= */
function afficherEcranFin() {
  const container = document.getElementById('ecran-fin-container');
  const placees = timeline.length - 1;
  container.innerHTML = `
    <div class="ecran-fin">
      <h2>Partie terminée !</h2>
      <p>Cartes placées avec succès : <strong>${placees}</strong></p>
      <p>Erreurs commises : <strong>${erreurs.length}</strong></p>
      <p style="opacity:0.55; font-size:12px;">Pioche épuisée (${BASE_CARTES.length} cartes au total dans le jeu de base)</p>
      <button class="btn-rejouer" id="btn-rejouer">${ICONE_RESTART} Rejouer</button>
    </div>
  `;
  document.getElementById('btn-rejouer').addEventListener('click', initPartie);
}

/* ================= TOGGLE INSPECTEUR (droite) =================
   L'icone du bouton (loupe SVG) reste fixe : elle identifie le panneau, seul
   son etat ouvert/ferme change (classe .replie). */
document.getElementById('btn-toggle-inspecteur').addEventListener('click', () => {
  document.getElementById('inspecteur').classList.toggle('replie');
});

/* ================= TOGGLE LOBBY (gauche) ================= */
document.getElementById('btn-toggle-lobby').addEventListener('click', () => {
  document.getElementById('lobby').classList.toggle('replie');
});

/* ================= FERMER L'INSPECTEUR PAR GLISSEMENT (mobile) =================
   Sur mobile, l'inspecteur glisse par-dessus le jeu depuis la droite : on
   peut donc aussi le repousser hors de l'ecran en balayant de gauche a
   droite pour le refermer, en plus du bouton rond -- et ce depuis N'IMPORTE
   OU sur l'ecran (pas seulement en demarrant le geste sur l'inspecteur
   lui-meme : ecoute posee sur tout le document, activee uniquement pendant
   que l'inspecteur est reellement ouvert). Uniquement sur mobile (< 860px,
   meme seuil que la mise en page en panneaux superposes) : sur bureau
   l'inspecteur est une colonne fixe, un simple clic-glisser ne doit pas le
   fermer par accident. */
(function initFermetureInspecteurParGlissement() {
  const inspecteur = document.getElementById('inspecteur');
  if (!inspecteur) return;
  let origine = null;
  let dernier = null; // derniere position pointermove connue -- voir pointercancel plus bas
  function evaluerFermeture(x, y, t) {
    if (!origine) return;
    const dx = x - origine.x;
    const dy = y - origine.y;
    const dt = t - origine.t;
    origine = null;
    dernier = null;
    if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 700) {
      inspecteur.classList.add('replie');
    }
  }
  document.addEventListener('pointerdown', (e) => {
    if (window.innerWidth > 860 || inspecteur.classList.contains('replie')) { origine = null; return; }
    origine = { x: e.clientX, y: e.clientY, t: Date.now() };
    dernier = origine;
  });
  // Suivi passif (pas de preventDefault : ne gene jamais le scroll vertical
  // natif de .inspecteur-contenu) uniquement pour garder une derniere
  // position connue en cas de pointercancel (voir plus bas).
  document.addEventListener('pointermove', (e) => {
    if (!origine) return;
    dernier = { x: e.clientX, y: e.clientY };
  });
  document.addEventListener('pointerup', (e) => {
    if (!origine) return;
    evaluerFermeture(e.clientX, e.clientY, Date.now());
  });
  // Sur un geste demarre dans une zone scrollable (.inspecteur-contenu), le
  // navigateur peut reclamer le toucher pour son propre scroll natif et
  // n'envoyer qu'un pointercancel (pas de pointerup) -- meme si touch-action:
  // pan-y (cf. style.css) limite deja beaucoup ce cas pour un balayage
  // horizontal, ce filet de securite evalue quand meme la derniere position
  // connue (via pointermove) plutot que d'abandonner silencieusement.
  document.addEventListener('pointercancel', () => {
    if (!origine || !dernier) { origine = null; dernier = null; return; }
    evaluerFermeture(dernier.x, dernier.y, Date.now());
  });
})();

/* ================= MISE EN PAGE MOBILE =================
   Sur petit ecran, lobby et inspecteur passent en panneaux superposes
   (voir media query dans style.css) : on les demarre fermes pour laisser
   toute la place au jeu, l'utilisateur les ouvre via les boutons ronds. */
if (window.matchMedia('(max-width: 860px)').matches) {
  document.getElementById('lobby').classList.add('replie');
  document.getElementById('inspecteur').classList.add('replie');
}

/* ================= VIDEO DE FOND DE L'ACCUEIL =================
   N'attache la source (donc ne declenche AUCUN telechargement) que si
   l'utilisateur n'a pas demande moins d'animations — display:none seul ne
   suffit pas a empecher le navigateur de charger une balise <video preload>,
   d'ou cette injection conditionnelle en JS. Affichee sur mobile comme sur
   desktop (plus de restriction de largeur d'ecran ici).*/
function initVideoAccueil() {
  const video = document.getElementById('accueil-video');
  if (!video) return;
  const veutVideo = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!veutVideo) return;
  const source = document.createElement('source');
  source.src = 'Video/portail-accueil.mp4?v=2';
  source.type = 'video/mp4';
  video.appendChild(source);
  video.load();
  video.play().catch(() => {});
}

/* ================= NAVIGATION ACCUEIL <-> JEU ================= */
function afficherAccueil() {
  document.getElementById('vue-accueil').style.display = 'flex';
  document.getElementById('vue-jeu').style.display = 'none';
  // Relance la video du portail (coupee pendant le jeu pour ne pas consommer
  // de ressources inutilement) ; catch silencieux car certains navigateurs
  // refusent play() avant une interaction utilisateur.
  const videoAccueil = document.getElementById('accueil-video');
  if (videoAccueil) videoAccueil.play().catch(() => {});
}
function afficherJeu() {
  document.getElementById('vue-accueil').style.display = 'none';
  const vueFrise = document.getElementById('vue-frise');
  if (vueFrise) vueFrise.style.display = 'none';
  document.getElementById('vue-jeu').style.display = 'flex';
  const videoAccueil = document.getElementById('accueil-video');
  if (videoAccueil) videoAccueil.pause();
}

document.getElementById('btn-solo').addEventListener('click', () => {
  // Si une partie multijoueur etait en cours de creation/jonction, on la quitte
  // proprement avant de repasser en solo (evite un etat d'affichage incoherent).
  const btnQuitter = document.getElementById('btn-quitter-partie');
  if (typeof codePartieActuelle !== 'undefined' && codePartieActuelle && btnQuitter) {
    btnQuitter.click();
  }
  modeActuel = 'solo';
  document.getElementById('lobby-mode-badge').textContent = 'Partie solo';
  document.getElementById('lobby-solo-zone').hidden = false;
  document.getElementById('lobby-multi-zone').hidden = true;
  document.getElementById('zone-jeu-solo').hidden = false;
  document.getElementById('multi-attente').hidden = true;
  document.getElementById('multi-tour-banner').hidden = true;
  // Repetes ici (en plus du handler de "Quitter la partie", qui est async et
  // termine APRES ce bloc) pour ne jamais laisser affiche un reste d'etat
  // "spectateur" multijoueur (main d'un autre joueur, note, bouton cache).
  document.getElementById('multi-spectateur-note').hidden = true;
  majLabelEnMain('En main');
  document.getElementById('btn-valider').hidden = false;
  document.querySelector('.pioche-erreurs-section h3').textContent = 'Poubelle';
  afficherJeu();
  initPartie();
});

/* Relance une partie solo sans quitter la page (bouton dans le panneau Lobby). */
document.getElementById('btn-nouvelle-partie').addEventListener('click', () => {
  if (modeActuel !== 'solo') return;
  initPartie();
});

document.getElementById('logo-jeu').addEventListener('click', afficherAccueil);
// Le logo de la page d'accueil ouvre la frise chronologique (toutes les
// cartes du jeu, triees par date) plutot que de rester purement decoratif.
document.getElementById('logo-accueil').addEventListener('click', afficherFrise);

/* ================= VUE FRISE (toutes les cartes, triees par date) =================
   Ouverte en cliquant sur le logo de l'accueil : une plongee chronologique
   dans l'integralite du jeu de cartes, du plus ancien evenement au plus
   recent, sans notion de partie ni de score. */
function etiquetteEre(date) {
  // Tout ce qui precede la Prehistoire (origine de la vie, extinctions,
  // evolution...) et tout ce qui suit 2040 (projections, echelles
  // cosmologiques) sont chacun regroupes dans UN seul repere : avec la
  // densite de cartes sur ces echelles, un repere par valeur de duree
  // rendait la frise illisible (trop de sous-categories).
  if (date < -1000000) return 'Avant la Préhistoire';
  if (date < -3000) return 'Préhistoire';
  if (date < 500) return 'Antiquité';
  if (date < 1500) return 'Moyen Âge';
  if (date < 1800) return 'Renaissance & Temps modernes';
  if (date < 1900) return 'XIXe siècle';
  if (date < 2040) {
    const decennie = Math.floor(date / 10) * 10;
    return `Années ${decennie}`;
  }
  return 'Futur';
}

// Regroupement plus large que etiquetteEre() (qui detaille chaque decennie
// entre 1900 et 2040) : sert a la barre de periodes en haut de la frise
// (voir construireBarrePeriodes), ou un segment par decennie serait
// illisible. Utilisee uniquement sur la version PC (bureau).
function etiquetteEreLarge(date) {
  if (date < -1000000) return 'Avant la Préhistoire';
  if (date < -3000) return 'Préhistoire';
  if (date < 500) return 'Antiquité';
  if (date < 1500) return 'Moyen Âge';
  if (date < 1800) return 'Renaissance & Temps modernes';
  if (date < 1900) return 'XIXe siècle';
  if (date < 2000) return 'XXe siècle';
  if (date < 2040) return 'XXIe siècle';
  return 'Futur';
}
const PALETTE_ERES_LARGE = {
  'Avant la Préhistoire': '#6b4226',
  'Préhistoire': '#8a6d3b',
  'Antiquité': '#c9a227',
  'Moyen Âge': '#7d5ba6',
  'Renaissance & Temps modernes': '#4a7dbd',
  'XIXe siècle': '#3aa6a6',
  'XXe siècle': '#e0663d',
  'XXIe siècle': '#e0417d',
  'Futur': '#2ecc71'
};

// Nombre de cartes empilees par colonne dans la grille "bureau" de la
// frise : plus une colonne est haute a l'ecran, moins on peut en voir cote
// a cote -- 4 est un compromis qui laisse une carte lisible tout en gardant
// plusieurs colonnes (donc plusieurs "tranches" de temps) visibles a la
// fois sans scroller.
const FRISE_CARTES_PAR_COLONNE = 4;

/* Regroupe les cartes triees en segments par grande ere ET calcule combien
   de COLONNES (pas de cartes brutes) chaque segment occupe dans la grille
   "bureau" -- c'est cette meme info qui sert a la fois a construire la
   grille (construireFrise) et la barre de periodes (construireBarrePeriodes),
   pour qu'elles restent PARFAITEMENT synchronisees (le curseur de la barre
   ne peut plus se decaler des cartes reellement affichees, contrairement a
   une version precedente qui approximait via l'index brut des cartes). */
function calculerSegmentsEresFrise(cartesTriees) {
  const segments = [];
  cartesTriees.forEach((carte) => {
    const ere = etiquetteEreLarge(carte.date);
    let seg = segments[segments.length - 1];
    if (!seg || seg.ere !== ere) {
      seg = { ere, debut: carte.date, fin: carte.date, cartes: [] };
      segments.push(seg);
    }
    seg.fin = carte.date;
    seg.cartes.push(carte);
  });
  let colonneDebut = 0;
  segments.forEach((seg) => {
    seg.colonnes = Math.ceil(seg.cartes.length / FRISE_CARTES_PAR_COLONNE);
    seg.colonneDebut = colonneDebut;
    colonneDebut += seg.colonnes;
  });
  return { segments, totalColonnes: colonneDebut };
}

/* Barre de periodes (bureau uniquement, cf. CSS) : un segment par grande
   ere, largeur proportionnelle a son nombre de COLONNES dans la grille du
   dessous (donc a l'espace qu'elle y occupe reellement), avec ses dates de
   debut/fin. Un curseur suit le scroll horizontal et adopte la couleur de
   la periode actuellement affichee, pour materialiser concretement "plus on
   avance dans la frise, plus on avance dans le temps". */
function construireBarrePeriodes(segments, totalColonnes) {
  const barre = document.getElementById('frise-periodes');
  if (!barre || segments.length === 0) return;
  barre.innerHTML = '';

  const scrollZone = document.getElementById('frise-scroll');
  segments.forEach((seg) => {
    const el = document.createElement('div');
    el.className = 'frise-periode-segment';
    el.style.flexGrow = seg.colonnes;
    el.style.setProperty('--couleur-periode', PALETTE_ERES_LARGE[seg.ere] || '#555');
    el.innerHTML = `
      <span class="frise-periode-nom">${seg.ere}</span>
      <span class="frise-periode-dates">${formaterDate(seg.debut)} — ${formaterDate(seg.fin)}</span>
    `;
    // Clic sur un segment : saute directement au debut de cette periode,
    // plutot que de devoir scroller manuellement jusque-la.
    el.addEventListener('click', () => {
      const scrollable = scrollZone.scrollWidth - scrollZone.clientWidth;
      scrollZone.scrollLeft = totalColonnes > 1 ? (seg.colonneDebut / (totalColonnes - 1 || 1)) * scrollable : 0;
    });
    barre.appendChild(el);
  });

  const curseur = document.createElement('div');
  curseur.className = 'frise-periode-curseur';
  barre.appendChild(curseur);

  function segmentPourColonne(colonne) {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (colonne >= segments[i].colonneDebut) return segments[i];
    }
    return segments[0];
  }

  function majCurseur() {
    const scrollable = scrollZone.scrollWidth - scrollZone.clientWidth;
    const fraction = scrollable > 0 ? scrollZone.scrollLeft / scrollable : 0;
    curseur.style.left = (fraction * 100) + '%';
    const seg = segmentPourColonne(fraction * (totalColonnes - 1));
    curseur.style.background = PALETTE_ERES_LARGE[seg.ere] || '#fff';
  }
  scrollZone.addEventListener('scroll', majCurseur, { passive: true });
  majCurseur();
}

let friseConstruite = false;
function construireFrise() {
  const grille = document.getElementById('frise-grille');
  grille.innerHTML = '';

  const cartesTriees = [...BASE_CARTES].sort((a, b) => a.date - b.date);
  document.getElementById('frise-nb-cartes').textContent = cartesTriees.length;

  function creerCarteFrise(carte) {
    const div = creerCarteHTML(carte);
    div.classList.add('carte--frise');
    // .carte--cachee ne fait rien visuellement pour un visiteur normal (voir
    // CSS, gardee par .frise-admin-actif) : seul l'admin voit un badge sur
    // les cartes actuellement exclues des parties (carte.cachee).
    if (carte.cachee) div.classList.add('carte--cachee');
    div.addEventListener('click', () => ouvrirModalCarte(carte));
    return div;
  }

  // Bureau : grille en colonnes (voir CSS, grid-auto-flow:column) -- une
  // colonne par "tranche" de FRISE_CARTES_PAR_COLONNE cartes, plus ancien en
  // haut. Chaque ere demarre une NOUVELLE colonne (cellules invisibles en
  // complement si besoin) pour que ses limites correspondent exactement aux
  // segments de la barre de periodes au-dessus. Mobile : ancien defilement
  // vertical avec reperes de periode fins (etiquetteEre, par decennie).
  if (window.innerWidth > 860) {
    const { segments, totalColonnes } = calculerSegmentsEresFrise(cartesTriees);
    segments.forEach((seg) => {
      seg.cartes.forEach((carte) => grille.appendChild(creerCarteFrise(carte)));
      const vides = seg.colonnes * FRISE_CARTES_PAR_COLONNE - seg.cartes.length;
      for (let i = 0; i < vides; i++) {
        const vide = document.createElement('div');
        vide.className = 'frise-cellule-vide';
        grille.appendChild(vide);
      }
    });
    construireBarrePeriodes(segments, totalColonnes);
  } else {
    let ereActuelle = null;
    cartesTriees.forEach((carte) => {
      const ere = etiquetteEre(carte.date);
      if (ere !== ereActuelle) {
        ereActuelle = ere;
        const repere = document.createElement('div');
        repere.className = 'frise-ere';
        repere.textContent = ere;
        grille.appendChild(repere);
      }
      grille.appendChild(creerCarteFrise(carte));
    });
  }

  friseConstruite = true;
}

function ouvrirModalCarte(carte) {
  // En mode admin (admin.js), un clic sur une carte de la frise ouvre le
  // formulaire d'edition plutot que la fiche en lecture seule.
  if (typeof adminActif !== 'undefined' && adminActif && typeof construireFormulaireAdminHTML === 'function') {
    document.getElementById('frise-modal-contenu').innerHTML = construireFormulaireAdminHTML(carte, false);
    document.getElementById('frise-modal').hidden = false;
    // La carte peut deja afficher une image via le repli automatique
    // (images/ ou images-claude/, cf. candidatsImage) sans que l'admin ait
    // jamais rien televerse : on la retrouve et on la pre-remplit dans la
    // liste, pour que l'admin la voie et puisse la completer/reordonner au
    // lieu de partir d'une liste vide qui laisserait croire qu'il n'y a
    // rien. Asynchrone (sondage du systeme de fichiers), voir admin.js.
    if (typeof completerImagesExistantesAdmin === 'function') completerImagesExistantesAdmin(carte);
    return;
  }
  document.getElementById('frise-modal-contenu').innerHTML = construireDetailCarteHTML(carte, true);
  document.getElementById('frise-modal').hidden = false;
}
function fermerModalCarte() {
  document.getElementById('frise-modal').hidden = true;
}
document.getElementById('frise-modal-fond').addEventListener('click', fermerModalCarte);
document.getElementById('btn-fermer-modal').addEventListener('click', fermerModalCarte);

function afficherFrise() {
  if (!friseConstruite) construireFrise();
  document.getElementById('vue-accueil').style.display = 'none';
  document.getElementById('vue-frise').style.display = 'flex';
  const videoAccueil = document.getElementById('accueil-video');
  if (videoAccueil) videoAccueil.pause();
}
document.getElementById('btn-fermer-frise').addEventListener('click', () => {
  document.getElementById('vue-frise').style.display = 'none';
  afficherAccueil();
});

/* ================= SCROLL MOLETTE -> DEFILEMENT HORIZONTAL =================
   La timeline (et la poubelle) defilent horizontalement ; sur un ordinateur
   de bureau la molette ne produit que du scroll vertical par defaut. On
   convertit ce scroll vertical en scroll horizontal pour eviter d'avoir a
   utiliser la barre de defilement ou le shift+molette. Un seul listener
   suffit : les deux modes (solo/multi) reutilisent le meme element DOM. */
function activerScrollHorizontal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // deja un scroll horizontal (trackpad)
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
}
activerScrollHorizontal('timeline-container');
activerScrollHorizontal('pioche-erreurs');
activerScrollHorizontal('frise-scroll');

/* ================= DEMARRAGE ================= */
initVideoAccueil();
afficherAccueil();
