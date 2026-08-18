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
let carteEnCoursDeDrag = null;
let indexZoneSelectionnee = null;
let carteInspectee = null;
let carteRepereInitiale = null;
let modeSoloNoHit = false;
let noHitCompteurActuel = 0;

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
  { id: 'cinema', label: 'Cinéma', emoji: '🎬' },
  { id: 'television', label: 'Télévision', emoji: '📺' },
  { id: 'jeuxvideo', label: 'Jeux vidéo', emoji: '🎮' },
  { id: 'architecture', label: 'Architecture', emoji: '🏛️' },
  { id: 'nature', label: 'Nature', emoji: '🌿' },
  { id: 'guerre', label: 'Guerre', emoji: '⚔️' },
  { id: 'exploration', label: 'Exploration', emoji: '🧭' },
  { id: 'mythologie', label: 'Mythologie', emoji: '🐉' },
  { id: 'sport', label: 'Sport', emoji: '🏅' }
];
// Meme principe que FAMILLES_FILTRABLES, mais pour le filtre de difficulte
// (carte.difficulte genere par generer_cartes.py a partir de la colonne
// xlsx du meme nom).
const DIFFICULTES_FILTRABLES = [
  { id: 'facile', label: 'Facile', emoji: '🟢' },
  { id: 'moyenne', label: 'Moyenne', emoji: '🟡' },
  { id: 'difficile', label: 'Difficile', emoji: '🔴' }
];
const DIFFICULTE_INFO = Object.fromEntries(DIFFICULTES_FILTRABLES.map((d) => [d.id, d]));
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
    label.className = 'filtre-famille';
    const coche = ensembleActif.has(f.id) ? 'checked' : '';
    label.innerHTML = `<input type="checkbox" ${coche}><span>${f.emoji} ${f.label}</span>`;
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
    n + (famillesActives.has(c.famille) && difficultesActives.has(c.difficulte) ? 1 : 0), 0);
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

// Filtres actifs en solo : toutes les familles / difficultes cochees par defaut.
let filtresSoloActifs = new Set(FAMILLES_FILTRABLES.map((f) => f.id));
let filtresDifficulteSoloActifs = new Set(DIFFICULTES_FILTRABLES.map((d) => d.id));

function initPartie() {
  const pool = BASE_CARTES.filter((c) => filtresSoloActifs.has(c.famille) && filtresDifficulteSoloActifs.has(c.difficulte));
  const source = pool.length >= CARTES_MIN_PARTIE ? pool : BASE_CARTES;
  const toutes = melanger(source);
  carteRepereInitiale = toutes[0];
  timeline = [carteRepereInitiale];
  main = toutes.slice(1, 6);
  pioche = toutes.slice(6);
  erreurs = [];
  carteChoisie = null;
  carteEnCoursDeDrag = null;
  indexZoneSelectionnee = null;
  carteInspectee = null;
  noHitCompteurActuel = 0;
  document.getElementById('ecran-fin-container').innerHTML = '';
  render();
}

/* ================= FILTRES SOLO (panneau Lobby) ================= */
function majCompteFiltresSolo() {
  const n = compterCartesFiltrees(filtresSoloActifs, filtresDifficulteSoloActifs);
  const texte = n < CARTES_MIN_PARTIE
    ? `⚠️ Seulement ${n} carte${n > 1 ? 's' : ''} avec ce filtre (minimum ${CARTES_MIN_PARTIE}) — toutes les catégories seront utilisées à la place.`
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
      <h2>🏆 Sans-faute total !</h2>
      <p>Tu as placé les <strong>${score}</strong> cartes sans une seule erreur !</p>
      <button class="btn-rejouer" id="btn-rejouer-nohit">🔄 Rejouer</button>
    </div>
  ` : `
    <div class="ecran-fin ecran-fin--nohit-echec">
      <h2>💥 Erreur fatale !</h2>
      <p>Cartes placées sans faute : <strong>${score}</strong></p>
      <p style="opacity:0.6; font-size:13px;">En mode No Hit Run, la moindre erreur relance une nouvelle partie.</p>
      <button class="btn-rejouer" id="btn-rejouer-nohit">🔄 Retenter</button>
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
   Convention : si la colonne "image" du xlsx est vide, on essaie automatiquement
   images-claude/id-<id>.png puis images/id-<id>.png (et leurs variantes .jpg/.jpeg/.webp)
   avant de retomber sur l'emoji. Il suffit donc de nommer un fichier "id-47.png" et de
   le deposer dans l'un de ces deux dossiers pour qu'il s'affiche, sans toucher au xlsx
   ni au code. images-claude/ contient des photos libres de droits recherchees par Claude
   pour les cartes que l'utilisateur n'a pas illustrees lui-meme. */
function candidatsImage(carte) {
  if (carte.image) return [`images/${carte.image}`];
  const extensions = ['png', 'jpg', 'jpeg', 'webp'];
  const dossiers = ['images-claude', 'images'];
  return dossiers.flatMap(dossier => extensions.map(ext => `${dossier}/id-${carte.id}.${ext}`));
}

function elementDecorHTML(carte) {
  const [premier, ...reste] = candidatsImage(carte);
  const resteAttr = JSON.stringify(reste).replace(/"/g, '&quot;');
  return `<img src="${premier}" alt="" data-reste='${resteAttr}' data-emoji="${carte.emoji}" onerror="essaierImageSuivante(this)">`;
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

/* ================= CREATION D'ELEMENTS CARTE ================= */
function creerCarteHTML(carte, options = {}) {
  const div = document.createElement('div');
  let classes = `carte famille-${carte.famille}`;
  if (options.repere) classes += ' repere';
  if (options.selectionnee) classes += ' selectionnee';
  if (options.inspectee) classes += ' inspectee';
  if (options.dragging) classes += ' dragging';
  if (options.derniereJouee) classes += ' derniere-jouee';
  div.className = classes;

  const dateTexte = options.cacherDate ? '?' : formaterDate(carte.date);
  div.innerHTML = `
    <div class="decor">${elementDecorHTML(carte)}</div>
    <div class="titre-carte">${carte.titre}</div>
    <div class="date-carte ${options.cacherDate ? 'cachee' : ''}">${dateTexte}</div>
  `;
  return div;
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
  container.innerHTML = '';

  container.appendChild(creerZoneDepot(0));

  timeline.forEach((carte, i) => {
    const carteDiv = creerCarteHTML(carte, {
      repere: carte === carteRepereInitiale,
      inspectee: carteInspectee === carte
    });
    carteDiv.addEventListener('click', () => selectionnerCartePourInspecteur(carte));
    container.appendChild(carteDiv);
    container.appendChild(creerZoneDepot(i + 1));
  });
}

function creerZoneDepot(index) {
  const zone = document.createElement('div');
  zone.className = 'zone-depot';

  if (indexZoneSelectionnee === index && carteChoisie) {
    zone.classList.add('attente');
    zone.innerHTML = `
      <div class="decor">${elementDecorHTML(carteChoisie)}</div>
      <div class="attente-titre">${carteChoisie.titre}</div>
    `;
  } else {
    zone.textContent = '+';
  }

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (carteEnCoursDeDrag) zone.classList.add('survol');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('survol');
    if (carteEnCoursDeDrag) {
      carteChoisie = carteEnCoursDeDrag;
      indexZoneSelectionnee = index;
      render();
    }
  });
  zone.addEventListener('click', () => {
    if (carteChoisie) {
      indexZoneSelectionnee = index;
      render();
    }
  });

  return zone;
}

function renderMain() {
  const container = document.getElementById('main-joueur');
  container.innerHTML = '';

  main.forEach((carte) => {
    const div = creerCarteHTML(carte, {
      cacherDate: true,
      selectionnee: carteChoisie === carte,
      inspectee: carteInspectee === carte
    });
    div.draggable = true;

    div.addEventListener('dragstart', () => {
      carteEnCoursDeDrag = carte;
      div.classList.add('dragging');
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      carteEnCoursDeDrag = null;
    });

    div.addEventListener('click', () => {
      selectionnerCartePourInspecteur(carte);
      if (carteChoisie !== carte) {
        indexZoneSelectionnee = null;
      }
      carteChoisie = carte;
      render();
    });

    container.appendChild(div);
  });
}

function renderPiocheErreurs() {
  const container = document.getElementById('pioche-erreurs');
  container.innerHTML = '';

  if (erreurs.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'carte-erreur-vide';
    vide.textContent = 'Aucune erreur pour le moment — tant mieux !';
    container.appendChild(vide);
    return;
  }

  erreurs.forEach((carte) => {
    const div = document.createElement('div');
    div.className = 'carte-erreur' + (carteInspectee === carte ? ' inspectee' : '');
    div.innerHTML = `
      <div class="decor">${elementDecorHTML(carte)}</div>
      <div class="titre-carte">${carte.titre}</div>
      <div class="date-carte">${formaterDate(carte.date)}</div>
    `;
    div.addEventListener('click', () => selectionnerCartePourInspecteur(carte));
    container.appendChild(div);
  });
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
}

/* Construit le HTML detaille d'une carte pour l'inspecteur. Partage entre le
   solo (renderInspecteur ci-dessus) et le multijoueur (multi.js), pour que
   les deux modes affichent exactement le meme contenu sans dupliquer le
   template. */
function construireDetailCarteHTML(carte, dateVisible) {
  const badgeClass = carte.fiabilite === 'avere' ? 'badge-avere'
                    : carte.fiabilite === 'debattu' ? 'badge-debattu'
                    : 'badge-legende';
  const badgeTexte = carte.fiabilite === 'avere' ? '✅ Avéré'
                    : carte.fiabilite === 'debattu' ? '⚠️ Débattu par les historiens'
                    : '📖 Légende populaire';
  const difficulteInfo = DIFFICULTE_INFO[carte.difficulte] || DIFFICULTE_INFO.moyenne;

  const iconesLiens = { youtube: '🎥', wikipedia: '📖', publication: '📄', livre: '📚', autre: '🔗' };
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
    : `<div class="placeholder-inspecteur placeholder-inspecteur--petit">🔒 Contexte, anecdote et liens se débloquent une fois la carte jouée.</div>`;

  return `
    <div class="carte-grande famille-${carte.famille}">
      <div class="decor-grand">${elementDecorHTML(carte)}</div>
      <div class="titre-grand">${carte.titre}</div>
      <div class="date-grand ${dateVisible ? '' : 'cachee'}">${dateVisible ? formaterDate(carte.date) : '?'}</div>
    </div>
    <div class="badges-inspecteur">
      <span class="badge-fiabilite ${badgeClass}">${badgeTexte}</span>
      <span class="badge-difficulte badge-difficulte--${carte.difficulte}">${difficulteInfo.emoji} ${difficulteInfo.label}</span>
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
  msg.textContent = correct ? '✅ Bonne réponse !' : '❌ Mauvaise réponse !';
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 1300);
}

/* Pop-up centrale montree apres une erreur (solo et multi), avant que la
   carte ne parte reellement en poubelle : on y voit la carte (decor + titre)
   et sa description courte, mais ni la date ni le contexte approfondi (pour
   ne pas transformer l'erreur en lecon d'histoire non demandee). Un clic
   n'importe ou dans la pop-up la ferme et declenche onFermeture, qui est
   responsable de faire effectivement passer la carte en poubelle. */
function afficherPopupErreur(carte, onFermeture) {
  const fond = document.createElement('div');
  fond.className = 'popup-erreur-fond';
  fond.innerHTML = `
    <div class="popup-erreur-boite">
      <div class="carte-grande famille-${carte.famille}">
        <div class="decor-grand">${elementDecorHTML(carte)}</div>
        <div class="titre-grand">${carte.titre}</div>
      </div>
      <div class="popup-erreur-description">${carte.description_courte}</div>
      <div class="popup-erreur-indice">❌ Clique n'importe où pour continuer</div>
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
      <h2>🎉 Partie terminée !</h2>
      <p>Cartes placées avec succès : <strong>${placees}</strong></p>
      <p>Erreurs commises : <strong>${erreurs.length}</strong></p>
      <p style="opacity:0.55; font-size:12px;">Pioche épuisée (${BASE_CARTES.length} cartes au total dans le jeu de base)</p>
      <button class="btn-rejouer" id="btn-rejouer">🔄 Rejouer</button>
    </div>
  `;
  document.getElementById('btn-rejouer').addEventListener('click', initPartie);
}

/* ================= TOGGLE INSPECTEUR (droite) =================
   L'icone du bouton (🔍) reste fixe : elle identifie le panneau, seul son
   etat ouvert/ferme change (classe .replie). */
document.getElementById('btn-toggle-inspecteur').addEventListener('click', () => {
  document.getElementById('inspecteur').classList.toggle('replie');
});

/* ================= TOGGLE LOBBY (gauche) ================= */
document.getElementById('btn-toggle-lobby').addEventListener('click', () => {
  document.getElementById('lobby').classList.toggle('replie');
});

/* ================= MISE EN PAGE MOBILE =================
   Sur petit ecran, lobby et inspecteur passent en panneaux superposes
   (voir media query dans style.css) : on les demarre fermes pour laisser
   toute la place au jeu, l'utilisateur les ouvre via les boutons ronds. */
if (window.matchMedia('(max-width: 860px)').matches) {
  document.getElementById('lobby').classList.add('replie');
  document.getElementById('inspecteur').classList.add('replie');
}

/* ================= VIDEO DE FOND DE L'ACCUEIL =================
   N'attache la source (donc ne declenche AUCUN telechargement) que sur
   grand ecran et si l'utilisateur n'a pas demande moins d'animations —
   display:none seul ne suffit pas a empecher le navigateur de charger une
   balise <video preload>, d'ou cette injection conditionnelle en JS. */
function initVideoAccueil() {
  const video = document.getElementById('accueil-video');
  if (!video) return;
  const veutVideo = window.matchMedia('(min-width: 641px)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  document.getElementById('label-main').textContent = '🃏 En main';
  document.getElementById('btn-valider').hidden = false;
  document.querySelector('.pioche-erreurs-section h3').textContent = '🗑️ Poubelle';
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

let friseConstruite = false;
function construireFrise() {
  const grille = document.getElementById('frise-grille');
  grille.innerHTML = '';

  const cartesTriees = [...BASE_CARTES].sort((a, b) => a.date - b.date);
  document.getElementById('frise-nb-cartes').textContent = cartesTriees.length;

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
    const div = creerCarteHTML(carte);
    div.classList.add('carte--frise');
    div.addEventListener('click', () => ouvrirModalCarte(carte));
    grille.appendChild(div);
  });

  friseConstruite = true;
}

function ouvrirModalCarte(carte) {
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

/* ================= DEMARRAGE ================= */
initVideoAccueil();
afficherAccueil();
