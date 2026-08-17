/* ================= MULTIJOUEUR (Firebase Realtime Database) =================
   Modele de donnees sous /parties/{code} :
   {
     hote: "<joueurId>",
     cree_le: <timestamp serveur>,
     statut: "lobby" | "en_cours" | "termine",
     joueurs: {
       "<joueurId>": { pseudo, hote: bool, rejoint_le: <timestamp>, nb_cartes }
     }
   }
   La distribution des cartes / tours / timer (statut "en_cours") arrive dans
   une prochaine etape ; pour l'instant le lobby (creation, code, liste des
   joueurs synchronisee, demarrage par l'hote) est deja pleinement fonctionnel
   et temps reel entre plusieurs appareils. */

let dbRef = null;
try {
  if (typeof firebase !== 'undefined' && typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey !== 'REMPLACE_MOI') {
    firebase.initializeApp(FIREBASE_CONFIG);
    dbRef = firebase.database();
  }
} catch (e) {
  console.warn('Firebase non initialise :', e);
}

function firebasePret() {
  if (!dbRef) {
    afficherErreurMulti("Le multijoueur n'est pas encore configuré : renseigne tes clés Firebase dans firebase-config.js.");
    return false;
  }
  return true;
}

/* Identifiant de joueur qui survit a un rafraichissement de la page */
function obtenirJoueurId() {
  let id = localStorage.getItem('timeline_joueur_id');
  if (!id) {
    id = 'j' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('timeline_joueur_id', id);
  }
  return id;
}
const JOUEUR_ID = obtenirJoueurId();

let codePartieActuelle = null;
let estHote = false;

function genererCodePartie() {
  // Sans 0/O/1/I pour eviter les confusions a l'oral/a l'ecrit.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function afficherErreurMulti(msg) {
  const el = document.getElementById('multi-erreur');
  el.textContent = msg;
  el.hidden = false;
}
function cacherErreurMulti() {
  document.getElementById('multi-erreur').hidden = true;
}

function pseudoSaisi() {
  const val = document.getElementById('multi-pseudo').value.trim();
  return val.slice(0, 16) || 'Joueur';
}

/* ================= OUVERTURE / FERMETURE DU PANNEAU DE CREATION ================= */
document.getElementById('btn-multi').addEventListener('click', () => {
  const panneau = document.getElementById('accueil-multi-panneau');
  panneau.hidden = !panneau.hidden;
  // Repart sur un reglage neutre a chaque ouverture du panneau, pour qu'un
  // "illimite" choisi lors d'une partie precedente (dans la meme session)
  // ne reste pas colle silencieusement a la partie suivante.
  dureeIllimitee = false;
  const btnIllimite = document.getElementById('btn-duree-illimitee');
  const inputDuree = document.getElementById('multi-duree-tour');
  if (btnIllimite) btnIllimite.classList.remove('actif');
  if (inputDuree) { inputDuree.disabled = false; inputDuree.value = 20; }
  modeLongueurChoisi = 'illimite';
  document.getElementById('btn-mode-illimite').classList.add('actif');
  document.getElementById('btn-mode-cible').classList.remove('actif');
  document.getElementById('lobby-cible-ligne').hidden = true;
  filtresMultiActifs = new Set(FAMILLES_FILTRABLES.map((f) => f.id));
  creerGrilleFiltres('lobby-filtres-grille-multi', filtresMultiActifs, majCompteFiltresMulti);
  majCompteFiltresMulti();
});

/* ================= CREER UNE PARTIE ================= */
document.getElementById('btn-creer-partie').addEventListener('click', async () => {
  if (!firebasePret()) return;
  cacherErreurMulti();
  const pseudo = pseudoSaisi();
  const code = genererCodePartie();
  try {
    await dbRef.ref('parties/' + code).set({
      hote: JOUEUR_ID,
      cree_le: firebase.database.ServerValue.TIMESTAMP,
      statut: 'lobby',
      joueurs: {
        [JOUEUR_ID]: { pseudo, hote: true, rejoint_le: firebase.database.ServerValue.TIMESTAMP }
      }
    });
    entrerDansLobbyMulti(code, true);
  } catch (e) {
    afficherErreurMulti("Impossible de créer la partie : " + e.message);
  }
});

/* ================= REJOINDRE UNE PARTIE ================= */
document.getElementById('btn-rejoindre-partie').addEventListener('click', async () => {
  if (!firebasePret()) return;
  cacherErreurMulti();
  const pseudo = pseudoSaisi();
  const code = document.getElementById('multi-code-input').value.trim().toUpperCase();
  if (code.length < 4) {
    afficherErreurMulti('Entre le code de la partie (5 caractères).');
    return;
  }
  try {
    const snap = await dbRef.ref('parties/' + code).get();
    if (!snap.exists()) {
      afficherErreurMulti('Aucune partie ne correspond à ce code.');
      return;
    }
    const partie = snap.val();
    if (partie.statut !== 'lobby') {
      afficherErreurMulti('Cette partie a déjà commencé.');
      return;
    }
    const joueursActuels = partie.joueurs ? Object.keys(partie.joueurs) : [];
    if (!joueursActuels.includes(JOUEUR_ID) && joueursActuels.length >= 8) {
      afficherErreurMulti('Ce salon est complet (8 joueurs maximum).');
      return;
    }
    await dbRef.ref(`parties/${code}/joueurs/${JOUEUR_ID}`).set({
      pseudo, hote: false, rejoint_le: firebase.database.ServerValue.TIMESTAMP
    });
    entrerDansLobbyMulti(code, joueursActuels.includes(JOUEUR_ID) ? !!partie.joueurs[JOUEUR_ID].hote : false);
  } catch (e) {
    afficherErreurMulti("Impossible de rejoindre cette partie : " + e.message);
  }
});

/* ================= ENTREE DANS LE LOBBY (creation ou jonction) ================= */
function entrerDansLobbyMulti(code, hote) {
  codePartieActuelle = code;
  estHote = hote;
  modeActuel = 'multi';
  enPartieMultiAnimeeDemarrage = false;
  premierFiniAnnonce = false;
  multiSpectateJoueurId = null;

  document.getElementById('lobby-mode-badge').textContent = 'Partie multijoueur';
  document.getElementById('btn-nouvelle-partie').hidden = true;
  document.getElementById('lobby-solo-zone').hidden = true;
  document.getElementById('lobby-multi-zone').hidden = false;
  document.getElementById('lobby-code-valeur').textContent = code;
  document.getElementById('multi-attente-code-valeur').textContent = code;
  document.getElementById('zone-jeu-solo').hidden = true;
  document.getElementById('multi-attente').hidden = false;
  document.getElementById('multi-spectateur-note').hidden = true;
  document.getElementById('label-main').textContent = '🃏 En main';
  document.getElementById('btn-valider').hidden = false;
  document.querySelector('.pioche-erreurs-section h3').textContent = '🗑️ Poubelle commune';

  // Si l'onglet se ferme pendant qu'on est dans le lobby, on se retire proprement
  // pour que la liste des joueurs reste correcte pour les autres.
  dbRef.ref(`parties/${code}/joueurs/${JOUEUR_ID}`).onDisconnect().remove();

  dbRef.ref('parties/' + code).on('value', (snap) => {
    const partie = snap.val();
    if (!partie) return; // partie supprimee entre-temps
    surMiseAJourPartie(partie);
  });

  afficherJeu();
}

/* ================= RENDU DU LOBBY (liste de joueurs temps reel) ================= */
function renderLobbyMulti(partie) {
  const liste = document.getElementById('lobby-joueurs-liste');
  const joueurs = partie.joueurs || {};
  const ids = Object.keys(joueurs).sort((a, b) => (joueurs[a].rejoint_le || 0) - (joueurs[b].rejoint_le || 0));

  const modeLongueur = partie.mode_longueur || 'illimite';
  liste.innerHTML = '';
  ids.forEach((id) => {
    const j = joueurs[id];
    const estTour = partie.tour_actuel === id;
    const enJeu = partie.statut === 'en_cours' || partie.statut === 'termine';
    const texteCartes = (enJeu && modeLongueur === 'cible')
      ? `${j.cartes_correctes || 0}/${partie.cible_cartes || 0} ✓`
      : (j.nb_cartes != null ? j.nb_cartes + ' cartes' : '');
    const texteErreurs = enJeu ? `❌ ${j.nb_erreurs || 0}` : '';
    const div = document.createElement('div');
    div.className = 'lobby-joueur'
      + (id === JOUEUR_ID ? ' lobby-joueur--actif' : '')
      + (estTour ? ' lobby-joueur--tour' : '');
    div.innerHTML = `
      <span class="lobby-joueur-tour">${estTour ? '🎯' : (j.hote ? '👑' : '👤')}</span>
      <span class="lobby-joueur-nom">${j.pseudo}${id === JOUEUR_ID ? ' (toi)' : ''}</span>
      <span class="lobby-joueur-erreurs">${texteErreurs}</span>
      <span class="lobby-joueur-cartes">${texteCartes}</span>
    `;
    liste.appendChild(div);
  });

  const note = document.getElementById('lobby-multi-note');
  const btnDemarrer = document.getElementById('btn-demarrer-partie');
  const btnNouvelleMulti = document.getElementById('btn-nouvelle-partie-multi');
  const parametres = document.getElementById('lobby-parametres');
  // Les parametres (duree, mode, filtres) restent modifiables par l'hote a
  // tout moment, y compris en cours de partie, pour preparer la manche
  // suivante sans avoir a quitter le salon.
  parametres.hidden = !estHote;

  if (partie.statut === 'lobby') {
    btnDemarrer.hidden = !estHote;
    btnDemarrer.disabled = ids.length < 2;
    btnNouvelleMulti.hidden = true;
    note.hidden = false;
    note.textContent = estHote
      ? (ids.length < 2 ? 'Il faut au moins 2 joueurs pour démarrer.' : `${ids.length} joueurs dans le salon — tu peux démarrer.`)
      : `En attente que l'hôte démarre la partie… (${ids.length} joueur${ids.length > 1 ? 's' : ''} dans le salon)`;
  } else {
    btnDemarrer.hidden = true;
    btnNouvelleMulti.hidden = !estHote;
    note.hidden = true;
  }
}

/* ================= DEMARRER LA PARTIE (hote uniquement) =================
   Distribue une main a chaque joueur (comme en solo), pose la 1ere carte
   restante comme repere sur la timeline commune, met le reste en pioche
   partagee, et fixe l'ordre des tours (tire au sort a chaque manche). */
const TAILLE_MAIN_DEFAUT = 5;

/* Reglage du temps de tour par l'hote, avant le lancement de la partie. */
let dureeIllimitee = false;
document.getElementById('btn-duree-illimitee').addEventListener('click', () => {
  dureeIllimitee = !dureeIllimitee;
  document.getElementById('btn-duree-illimitee').classList.toggle('actif', dureeIllimitee);
  document.getElementById('multi-duree-tour').disabled = dureeIllimitee;
});

/* Filtres de categories (hote uniquement, avant le lancement). */
let filtresMultiActifs = new Set(FAMILLES_FILTRABLES.map((f) => f.id));
function majCompteFiltresMulti() {
  const n = compterCartesFiltrees(filtresMultiActifs);
  const zone = document.getElementById('lobby-filtres-compte-multi');
  if (!zone) return;
  zone.textContent = `${n} carte${n > 1 ? 's' : ''} disponible${n > 1 ? 's' : ''} avec ce filtre.`;
}
document.getElementById('btn-filtres-multi-tout').addEventListener('click', () => {
  filtresMultiActifs = new Set(FAMILLES_FILTRABLES.map((f) => f.id));
  creerGrilleFiltres('lobby-filtres-grille-multi', filtresMultiActifs, majCompteFiltresMulti);
  majCompteFiltresMulti();
});
document.getElementById('btn-filtres-multi-aucun').addEventListener('click', () => {
  filtresMultiActifs.clear();
  creerGrilleFiltres('lobby-filtres-grille-multi', filtresMultiActifs, majCompteFiltresMulti);
  majCompteFiltresMulti();
});

/* Mode de partie (hote uniquement) : "illimite" (comportement d'origine,
   on joue jusqu'a epuisement naturel de la main) ou "cible" (chacun doit
   reussir un nombre choisi de cartes ; sa main est alors redessinee apres
   CHAQUE coup, correct ou pas, jusqu'a avoir atteint l'objectif). */
let modeLongueurChoisi = 'illimite';
document.getElementById('btn-mode-illimite').addEventListener('click', () => {
  modeLongueurChoisi = 'illimite';
  document.getElementById('btn-mode-illimite').classList.add('actif');
  document.getElementById('btn-mode-cible').classList.remove('actif');
  document.getElementById('lobby-cible-ligne').hidden = true;
});
document.getElementById('btn-mode-cible').addEventListener('click', () => {
  modeLongueurChoisi = 'cible';
  document.getElementById('btn-mode-cible').classList.add('actif');
  document.getElementById('btn-mode-illimite').classList.remove('actif');
  document.getElementById('lobby-cible-ligne').hidden = false;
});

/* Distribue une nouvelle manche a la partie en cours : reutilise le meme
   salon/code/joueurs, mais remet a zero timeline/mains/pioche/scores. Sert
   au demarrage initial (bouton "Demarrer") ET a "Nouvelle partie" (rejouer
   sans quitter le salon), avec les reglages actuels de l'hote. */
async function lancerNouvelleManche() {
  if (!codePartieActuelle || !estHote) return;
  const snap = await dbRef.ref(`parties/${codePartieActuelle}/joueurs`).get();
  const joueurs = snap.val() || {};
  // Ordre des tours tire au sort a chaque manche (au lieu de toujours suivre
  // l'ordre d'arrivee dans le salon, qui donnait toujours la main a l'hote
  // en premier).
  const ids = melanger(Object.keys(joueurs));
  if (ids.length < 2) return;

  const dureeSaisie = parseInt(document.getElementById('multi-duree-tour').value, 10);
  const dureeTourMs = dureeIllimitee ? 0 : Math.max(5, dureeSaisie || 20) * 1000;

  const cibleSaisie = parseInt(document.getElementById('multi-cible-cartes').value, 10);
  const cibleCartes = modeLongueurChoisi === 'cible' ? Math.max(5, cibleSaisie || 10) : null;

  const minimumRequis = 1 + TAILLE_MAIN_DEFAUT * ids.length;
  const pool = BASE_CARTES.filter((c) => filtresMultiActifs.has(c.famille));
  const source = pool.length >= minimumRequis ? pool : BASE_CARTES;
  const toutes = melanger(source);
  const carteRepere = toutes[0];
  let curseur = 1;
  const mains = {};
  ids.forEach((id) => {
    mains[id] = toutes.slice(curseur, curseur + TAILLE_MAIN_DEFAUT).map((c) => c.id);
    curseur += TAILLE_MAIN_DEFAUT;
  });
  const pioche = toutes.slice(curseur).map((c) => c.id);

  premierFiniAnnonce = false;
  enPartieMultiAnimeeDemarrage = false;

  const maj = {
    statut: 'en_cours',
    ordre_tours: ids,
    tour_index: 0,
    tour_actuel: ids[0],
    duree_tour_ms: dureeTourMs,
    tour_fin_a: dureeTourMs ? Date.now() + dureeTourMs : null,
    mode_longueur: modeLongueurChoisi,
    cible_cartes: cibleCartes,
    familles_actives: source === pool ? Array.from(filtresMultiActifs) : null,
    carte_repere: carteRepere.id,
    timeline: [carteRepere.id],
    pioche,
    mains,
    erreurs: Object.fromEntries(ids.map((id) => [id, []])),
    premier_fini: null,
    derniere_carte_jouee: null
  };
  ids.forEach((id) => {
    maj[`joueurs/${id}/nb_cartes`] = mains[id].length;
    maj[`joueurs/${id}/nb_erreurs`] = 0;
    maj[`joueurs/${id}/cartes_correctes`] = 0;
  });

  await dbRef.ref('parties/' + codePartieActuelle).update(maj);
}

document.getElementById('btn-demarrer-partie').addEventListener('click', lancerNouvelleManche);
document.getElementById('btn-nouvelle-partie-multi').addEventListener('click', lancerNouvelleManche);

/* ================= QUITTER LA PARTIE ================= */
document.getElementById('btn-quitter-partie').addEventListener('click', async () => {
  if (codePartieActuelle && dbRef) {
    try {
      await dbRef.ref(`parties/${codePartieActuelle}/joueurs/${JOUEUR_ID}`).remove();
    } catch (e) { /* tant pis, on quitte quand meme localement */ }
    dbRef.ref('parties/' + codePartieActuelle).off();
  }
  arreterTimerMulti();
  codePartieActuelle = null;
  estHote = false;
  modeActuel = 'solo';
  dernierePartieMulti = null;
  multiSpectateJoueurId = null;

  document.getElementById('lobby-mode-badge').textContent = 'Partie solo';
  document.getElementById('btn-nouvelle-partie').hidden = false;
  document.getElementById('lobby-solo-zone').hidden = false;
  document.getElementById('lobby-multi-zone').hidden = true;
  document.getElementById('zone-jeu-solo').hidden = false;
  document.getElementById('multi-attente').hidden = true;
  document.getElementById('multi-tour-banner').hidden = true;
  document.getElementById('multi-spectateur-note').hidden = true;
  document.getElementById('derniere-carte-multi').hidden = true;
  document.getElementById('label-main').textContent = '🃏 En main';
  document.getElementById('btn-valider').hidden = false;
  document.querySelector('.pioche-erreurs-section h3').textContent = '🗑️ Poubelle';

  afficherAccueil();
});

/* ================= MOTEUR DE PARTIE MULTIJOUEUR (statut "en_cours") =================
   Reutilise les helpers generiques de script.js (creerCarteHTML, elementDecorHTML,
   formaterDate, melanger, jouerSonBonneReponse/Erreur, construireDetailCarteHTML)
   mais avec son propre etat local (prefixe "multi") pour ne jamais toucher aux
   variables globales du mode solo. */
const CARTE_PAR_ID = Object.fromEntries(BASE_CARTES.map((c) => [c.id, c]));

let dernierePartieMulti = null;
let enPartieMultiAnimeeDemarrage = false;
let multiTimeline = [];
let multiMain = [];
let multiErreurs = [];
let multiPiocheCount = 0;
let multiCarteChoisie = null;
let multiCarteEnDrag = null;
let multiIndexZoneSelectionnee = null;
let multiCarteInspectee = null;
let timerMultiHandle = null;
let premierFiniAnnonce = false;
let multiSpectateJoueurId = null;

function surMiseAJourPartie(partie) {
  dernierePartieMulti = partie;
  renderLobbyMulti(partie);

  if (partie.statut === 'lobby') {
    document.getElementById('multi-attente').hidden = false;
    document.getElementById('zone-jeu-solo').hidden = true;
    document.getElementById('multi-tour-banner').hidden = true;
    arreterTimerMulti();
    return;
  }

  document.getElementById('multi-attente').hidden = true;
  document.getElementById('zone-jeu-solo').hidden = false;

  if (!enPartieMultiAnimeeDemarrage) {
    enPartieMultiAnimeeDemarrage = true;
    animerDistributionCartes();
  }

  if (partie.premier_fini && !premierFiniAnnonce) {
    premierFiniAnnonce = true;
    const pseudoGagnant = ((partie.joueurs || {})[partie.premier_fini] || {}).pseudo || '?';
    afficherMessagePremierFini(partie.premier_fini === JOUEUR_ID, pseudoGagnant);
  }

  mettreAJourEtatLocalMulti(partie);
  renderJeuMulti(partie);

  if (partie.statut === 'termine') {
    arreterTimerMulti();
    document.getElementById('multi-tour-banner').hidden = true;
    // Une fois la partie terminee, plus personne n'est "en train de regarder
    // la main de X pendant son tour" : sans ca, ce badge (et le texte perime
    // qu'il affiche) restait visible pour tous les joueurs indefiniment.
    document.getElementById('multi-spectateur-note').hidden = true;
    document.getElementById('btn-valider').hidden = true;
    afficherEcranFinMulti(partie);
  } else {
    document.getElementById('ecran-fin-container').innerHTML = '';
    demarrerTimerMulti(partie);
  }
}

function mettreAJourEtatLocalMulti(partie) {
  multiTimeline = (partie.timeline || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
  multiPiocheCount = (partie.pioche || []).length;

  // Mode spectateur : une fois qu'on a soi-meme termine (plus de cartes a
  // jouer, ou objectif atteint en mode "cible"), on n'a plus de main a
  // afficher -- a la place on regarde la main du joueur dont c'est le tour,
  // pour pouvoir suivre la fin de partie au lieu de fixer un ecran vide.
  const jeSuisTermine = estJoueurTermine(partie, JOUEUR_ID);
  if (jeSuisTermine && partie.statut === 'en_cours' && partie.tour_actuel) {
    multiMain = (((partie.mains || {})[partie.tour_actuel]) || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
    multiSpectateJoueurId = partie.tour_actuel;
  } else {
    multiMain = (((partie.mains || {})[JOUEUR_ID]) || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
    multiSpectateJoueurId = null;
  }

  // Poubelle commune : toutes les cartes en erreur de TOUS les joueurs,
  // visibles par tout le monde pendant toute la partie, avec le pseudo de
  // qui s'est trompe pour chaque carte (pour savoir qui a rate quoi).
  const joueursPartie = partie.joueurs || {};
  const erreursParJoueur = partie.erreurs || {};
  multiErreurs = Object.keys(erreursParJoueur).flatMap((id) => {
    const pseudo = (joueursPartie[id] || {}).pseudo || '?';
    return (erreursParJoueur[id] || [])
      .map((cardId) => ({ carte: CARTE_PAR_ID[cardId], pseudo }))
      .filter((e) => e.carte);
  });
}

/* Petit son + animation de "distribution" jouee une seule fois quand la
   partie passe de "lobby" a "en_cours". */
function animerDistributionCartes() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [392, 493.88, 587.33, 698.46].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.12, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  } catch (e) { /* audio indisponible, on ignore */ }
  const main = document.getElementById('main-joueur');
  main.classList.remove('anim-distribution');
  void main.offsetWidth; // relance l'animation meme si la classe etait deja posee
  main.classList.add('anim-distribution');
}

/* ---- Rendu ---- */
function renderJeuMulti(partie) {
  const monTour = partie.statut === 'en_cours' && partie.tour_actuel === JOUEUR_ID;
  renderTimelineMulti(monTour);
  renderMainMulti(monTour);
  renderErreursMulti();
  renderInspecteurMulti();

  document.getElementById('nb-main').textContent = multiMain.length;
  document.getElementById('nb-erreurs').textContent = multiErreurs.length;
  document.getElementById('nb-pioche').textContent = multiPiocheCount;
  // Le mode No Hit Run (solo uniquement) peut avoir laisse ce badge cache :
  // on le remet dans l'etat normal des qu'une partie multi s'affiche.
  document.getElementById('badge-erreurs').hidden = false;
  document.getElementById('badge-nohit').hidden = true;
  document.getElementById('btn-valider').disabled = !(monTour && multiIndexZoneSelectionnee !== null && multiCarteChoisie);
  document.getElementById('main-joueur').classList.toggle('pas-mon-tour', !monTour);

  const labelMain = document.getElementById('label-main');
  const noteSpectateur = document.getElementById('multi-spectateur-note');
  if (multiSpectateJoueurId) {
    const pseudoRegarde = ((partie.joueurs || {})[multiSpectateJoueurId] || {}).pseudo || '?';
    labelMain.textContent = `🃏 Main de ${pseudoRegarde}`;
    noteSpectateur.hidden = false;
    noteSpectateur.textContent = `👀 Tu as fini ! Tu regardes la main de ${pseudoRegarde} pendant son tour.`;
  } else {
    labelMain.textContent = '🃏 En main';
    noteSpectateur.hidden = true;
  }
  document.getElementById('btn-valider').hidden = !!multiSpectateJoueurId;
}

function renderTimelineMulti(monTour) {
  const container = document.getElementById('timeline-container');
  container.innerHTML = '';
  container.appendChild(creerZoneDepotMulti(0, monTour));
  multiTimeline.forEach((carte, i) => {
    const div = creerCarteHTML(carte, {
      repere: dernierePartieMulti && carte.id === dernierePartieMulti.carte_repere,
      inspectee: multiCarteInspectee === carte,
      derniereJouee: dernierePartieMulti && carte.id === dernierePartieMulti.derniere_carte_jouee
    });
    div.addEventListener('click', () => {
      multiCarteInspectee = carte;
      renderJeuMulti(dernierePartieMulti);
    });
    container.appendChild(div);
    container.appendChild(creerZoneDepotMulti(i + 1, monTour));
  });
}

function creerZoneDepotMulti(index, monTour) {
  const zone = document.createElement('div');
  zone.className = 'zone-depot';

  if (multiIndexZoneSelectionnee === index && multiCarteChoisie) {
    zone.classList.add('attente');
    zone.innerHTML = `<div class="decor">${elementDecorHTML(multiCarteChoisie)}</div><div class="attente-titre">${multiCarteChoisie.titre}</div>`;
  } else {
    zone.textContent = '+';
  }

  if (!monTour) return zone;

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (multiCarteEnDrag) zone.classList.add('survol');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('survol'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('survol');
    if (multiCarteEnDrag) {
      multiCarteChoisie = multiCarteEnDrag;
      multiIndexZoneSelectionnee = index;
      renderJeuMulti(dernierePartieMulti);
    }
  });
  zone.addEventListener('click', () => {
    if (multiCarteChoisie) {
      multiIndexZoneSelectionnee = index;
      renderJeuMulti(dernierePartieMulti);
    }
  });

  return zone;
}

function renderMainMulti(monTour) {
  const container = document.getElementById('main-joueur');
  container.innerHTML = '';

  multiMain.forEach((carte) => {
    const div = creerCarteHTML(carte, {
      cacherDate: true,
      selectionnee: multiCarteChoisie === carte,
      inspectee: multiCarteInspectee === carte
    });

    div.addEventListener('click', () => {
      multiCarteInspectee = carte;
      if (monTour) {
        if (multiCarteChoisie !== carte) multiIndexZoneSelectionnee = null;
        multiCarteChoisie = carte;
      }
      renderJeuMulti(dernierePartieMulti);
    });

    if (monTour) {
      div.draggable = true;
      div.addEventListener('dragstart', () => {
        multiCarteEnDrag = carte;
        div.classList.add('dragging');
      });
      div.addEventListener('dragend', () => {
        div.classList.remove('dragging');
        multiCarteEnDrag = null;
      });
    }

    container.appendChild(div);
  });
}

function renderErreursMulti() {
  const container = document.getElementById('pioche-erreurs');
  container.innerHTML = '';

  if (multiErreurs.length === 0) {
    const vide = document.createElement('div');
    vide.className = 'carte-erreur-vide';
    vide.textContent = 'Aucune erreur pour le moment — tant mieux !';
    container.appendChild(vide);
    return;
  }

  multiErreurs.forEach(({ carte, pseudo }) => {
    const groupe = document.createElement('div');
    groupe.className = 'carte-erreur-groupe';

    const div = document.createElement('div');
    div.className = 'carte-erreur' + (multiCarteInspectee === carte ? ' inspectee' : '');
    div.innerHTML = `
      <div class="decor">${elementDecorHTML(carte)}</div>
      <div class="titre-carte">${carte.titre}</div>
      <div class="date-carte">${formaterDate(carte.date)}</div>
    `;
    div.addEventListener('click', () => {
      multiCarteInspectee = carte;
      renderJeuMulti(dernierePartieMulti);
    });

    const auteur = document.createElement('div');
    auteur.className = 'carte-erreur-auteur';
    auteur.textContent = `🙈 ${pseudo}`;

    groupe.appendChild(div);
    groupe.appendChild(auteur);
    container.appendChild(groupe);
  });
}

function renderInspecteurMulti() {
  const zone = document.getElementById('contenu-inspecteur');
  const carte = multiCarteInspectee;
  const dansMain = carte && multiMain.includes(carte);
  const dansTimeline = carte && multiTimeline.includes(carte);
  const dansErreurs = carte && multiErreurs.some((e) => e.carte === carte);

  if (!carte || (!dansMain && !dansTimeline && !dansErreurs)) {
    multiCarteInspectee = null;
    zone.innerHTML = `<div class="placeholder-inspecteur">Clique sur une carte (main, timeline ou pioche d'erreurs) pour voir ses détails complets ici.</div>`;
    return;
  }
  zone.innerHTML = construireDetailCarteHTML(carte, !dansMain);
}

/* ---- Validation d'un placement (mon tour uniquement) ---- */
function validerPlacementMulti() {
  if (multiIndexZoneSelectionnee === null || !multiCarteChoisie) return;
  if (!dernierePartieMulti || dernierePartieMulti.tour_actuel !== JOUEUR_ID) return;

  const avant = multiTimeline[multiIndexZoneSelectionnee - 1];
  const apres = multiTimeline[multiIndexZoneSelectionnee];
  const okAvant = !avant || avant.date <= multiCarteChoisie.date;
  const okApres = !apres || multiCarteChoisie.date <= apres.date;
  const correct = okAvant && okApres;

  document.getElementById('btn-valider').disabled = true;
  afficherMessage(correct);
  if (correct) jouerSonBonneReponse(); else jouerSonErreur();

  const zones = document.querySelectorAll('#timeline-container .zone-depot');
  const zoneActive = zones[multiIndexZoneSelectionnee];
  if (zoneActive) zoneActive.classList.add(correct ? 'anim-pop' : 'anim-shake');

  const carteResolue = multiCarteChoisie;
  const indexResolu = multiIndexZoneSelectionnee;
  multiCarteChoisie = null;
  multiIndexZoneSelectionnee = null;

  setTimeout(() => appliquerResolutionTour(correct, carteResolue, indexResolu), 450);
}

/* ---- Aides "qui a fini ?" / "qui joue apres ?" (mode-aware) =================
   Un joueur est "termine" :
   - mode illimite : sa main est vide
   - mode cible : il a reussi au moins "cible_cartes" placements corrects
   Utilise a la fois pour sauter les joueurs finis quand on cherche le
   prochain tour, ET pour savoir quand la partie entiere est terminee. C'est
   le coeur du correctif du bug ou la partie restait bloquee sur un joueur
   qui n'avait plus de carte a jouer. */
function estJoueurTermine(partie, id) {
  const mode = partie.mode_longueur || 'illimite';
  if (mode === 'cible') {
    const cc = ((partie.joueurs || {})[id] || {}).cartes_correctes || 0;
    return cc >= (partie.cible_cartes || 0);
  }
  const m = ((partie.mains || {})[id]) || [];
  return m.length === 0;
}

/* Cherche le prochain joueur non-termine a partir de idxDepart (exclu). Si
   surchargeLocale est fourni ({id, termine}), remplace la valeur stockee
   (pas encore ecrite en base) pour ce joueur — utile pour se juger soi-meme
   juste apres avoir joue, avant l'ecriture Firebase. */
function prochainIndexActif(partie, idxDepart, surchargeLocale) {
  const ordre = partie.ordre_tours || [];
  for (let i = 1; i <= ordre.length; i++) {
    const idx = (idxDepart + i) % ordre.length;
    const id = ordre[idx];
    const termine = (surchargeLocale && surchargeLocale.id === id)
      ? surchargeLocale.termine
      : estJoueurTermine(partie, id);
    if (!termine) return idx;
  }
  return idxDepart;
}

/* Relit l'etat le plus frais depuis Firebase avant d'ecrire (defensif contre
   un decalage local), puis avance le tour vers le prochain joueur qui a
   encore des cartes a jouer. */
async function appliquerResolutionTour(correct, carte, indexResolu) {
  const refPartie = dbRef.ref('parties/' + codePartieActuelle);
  const snap = await refPartie.get();
  const partie = snap.val();
  if (!partie || partie.tour_actuel !== JOUEUR_ID || partie.statut !== 'en_cours') return;

  let timeline = partie.timeline || [];
  let main = ((partie.mains || {})[JOUEUR_ID]) || [];
  let erreurs = ((partie.erreurs || {})[JOUEUR_ID]) || [];
  let pioche = partie.pioche || [];
  let cartesCorrectes = ((partie.joueurs || {})[JOUEUR_ID] || {}).cartes_correctes || 0;

  main = main.filter((id) => id !== carte.id);

  if (correct) {
    timeline = [...timeline.slice(0, indexResolu), carte.id, ...timeline.slice(indexResolu)];
    cartesCorrectes += 1;
  } else {
    erreurs = [...erreurs, carte.id];
  }

  const modeLongueur = partie.mode_longueur || 'illimite';
  const cible = partie.cible_cartes || 0;
  const jeSuisTermine = modeLongueur === 'cible' ? cartesCorrectes >= cible : main.length === 0;

  // Redessine une carte pour rester a taille pleine apres CHAQUE coup,
  // correct ou pas (comme en solo "illimite"), tant que le joueur n'a pas
  // fini et qu'il reste des cartes en pioche commune. La main ne se met a
  // fondre qu'une fois la pioche epuisee. Les cartes repiochees suite a une
  // erreur ne comptent jamais dans cartes_correctes (seul un placement juste
  // l'incremente, cf. plus haut), donc la progression vers l'objectif
  // (mode cible) n'est pas faussee par ces repioches.
  const doitRedessiner = !jeSuisTermine;
  if (doitRedessiner && pioche.length > 0 && main.length < TAILLE_MAIN_DEFAUT) {
    const [pioch, ...reste] = pioche;
    main = [...main, pioch];
    pioche = reste;
  }

  const ordre = partie.ordre_tours || [];
  const idxActuel = ordre.indexOf(JOUEUR_ID);
  const prochainIndex = prochainIndexActif(partie, idxActuel, { id: JOUEUR_ID, termine: jeSuisTermine });

  let premierFini = partie.premier_fini || null;
  if (!premierFini && jeSuisTermine) premierFini = JOUEUR_ID;

  const tousTermines = ordre.every((id) => (
    id === JOUEUR_ID ? jeSuisTermine : estJoueurTermine(partie, id)
  ));

  const maj = {
    timeline,
    pioche,
    [`mains/${JOUEUR_ID}`]: main,
    [`erreurs/${JOUEUR_ID}`]: erreurs,
    [`joueurs/${JOUEUR_ID}/nb_cartes`]: main.length,
    [`joueurs/${JOUEUR_ID}/nb_erreurs`]: erreurs.length,
    [`joueurs/${JOUEUR_ID}/cartes_correctes`]: cartesCorrectes,
    premier_fini: premierFini,
    tour_index: prochainIndex,
    tour_actuel: ordre[prochainIndex],
    tour_fin_a: partie.duree_tour_ms ? Date.now() + partie.duree_tour_ms : null,
    statut: tousTermines ? 'termine' : 'en_cours'
  };
  // La timeline est triee par date, pas par ordre de jeu : on ne peut donc
  // pas deduire "la derniere carte jouee" de son dernier element, d'ou ce
  // champ dedie (mis a jour uniquement sur un placement correct, puisque
  // seules les cartes justes rejoignent la timeline).
  if (correct) maj.derniere_carte_jouee = carte.id;

  await refPartie.update(maj);
}

/* ---- Timer de tour (duree choisie par l'hote, ou illimite), gere par le
   client dont c'est le tour ---- */
function demarrerTimerMulti(partie) {
  arreterTimerMulti();
  if (!partie.duree_tour_ms) {
    majBanniereTour(partie, null); // temps illimite : pas de compte a rebours
    return;
  }
  const tick = () => {
    if (!dernierePartieMulti) return;
    if (!dernierePartieMulti.duree_tour_ms) { majBanniereTour(dernierePartieMulti, null); return; }
    const restant = Math.max(0, Math.round((dernierePartieMulti.tour_fin_a - Date.now()) / 1000));
    majBanniereTour(dernierePartieMulti, restant);
    if (restant <= 0 && dernierePartieMulti.tour_actuel === JOUEUR_ID && dernierePartieMulti.statut === 'en_cours') {
      passerTourParTimeout();
    }
  };
  tick();
  timerMultiHandle = setInterval(tick, 500);
}
function arreterTimerMulti() {
  if (timerMultiHandle) {
    clearInterval(timerMultiHandle);
    timerMultiHandle = null;
  }
}

function majBanniereTour(partie, restant) {
  const banniere = document.getElementById('multi-tour-banner');
  const texte = document.getElementById('multi-tour-texte');
  const compte = document.getElementById('multi-tour-compte');
  if (partie.statut !== 'en_cours') {
    banniere.hidden = true;
    return;
  }
  banniere.hidden = false;
  const monTour = partie.tour_actuel === JOUEUR_ID;
  banniere.classList.toggle('multi-tour-banner--moi', monTour);
  const joueurActuel = (partie.joueurs || {})[partie.tour_actuel];
  const pseudoActuel = joueurActuel ? joueurActuel.pseudo : '…';
  texte.textContent = monTour ? '🎯 À toi de jouer !' : `⏳ Tour de ${pseudoActuel}`;
  compte.hidden = restant === null;

  const nomSuivant = document.getElementById('multi-tour-suivant-nom');
  const ordre = partie.ordre_tours || [];
  const idxActuel = ordre.indexOf(partie.tour_actuel);
  const idxSuivant = prochainIndexActif(partie, idxActuel);
  const idSuivant = ordre[idxSuivant];
  const estMemeJoueur = idSuivant === partie.tour_actuel;
  const joueurSuivant = (partie.joueurs || {})[idSuivant];
  nomSuivant.textContent = estMemeJoueur ? '—' : (joueurSuivant ? (idSuivant === JOUEUR_ID ? 'toi' : joueurSuivant.pseudo) : '…');

  const derniereCarteZone = document.getElementById('derniere-carte-multi');
  const derniereCarteTitre = document.getElementById('derniere-carte-titre');
  const derniereCarte = partie.derniere_carte_jouee != null ? CARTE_PAR_ID[partie.derniere_carte_jouee] : null;
  derniereCarteZone.hidden = !derniereCarte;
  if (derniereCarte) derniereCarteTitre.textContent = derniereCarte.titre;
  if (restant !== null) compte.textContent = restant + 's';
}

/* Quand le temps est ecoule, le joueur dont c'est le tour fait simplement
   passer la main au suivant (sans penalite : pas de regle explicite donnee
   pour un timeout, on reste sur l'option la moins punitive). */
async function passerTourParTimeout() {
  const refPartie = dbRef.ref('parties/' + codePartieActuelle);
  const snap = await refPartie.get();
  const partie = snap.val();
  if (!partie || partie.tour_actuel !== JOUEUR_ID || partie.statut !== 'en_cours') return;

  const ordre = partie.ordre_tours || [];
  const idxActuel = ordre.indexOf(JOUEUR_ID);
  const prochainIndex = prochainIndexActif(partie, idxActuel);

  await refPartie.update({
    tour_index: prochainIndex,
    tour_actuel: ordre[prochainIndex],
    tour_fin_a: partie.duree_tour_ms ? Date.now() + partie.duree_tour_ms : null
  });

  multiCarteChoisie = null;
  multiIndexZoneSelectionnee = null;
}

/* ---- Message "premier fini" (annonce immediate, avant la fin de partie) ----
   Affiche des que premier_fini passe de null a un joueur, sur TOUS les
   clients (pas seulement celui qui vient de finir) : chacun voit soit "tu as
   gagne la course" soit "X a fini le premier". La partie continue ensuite
   normalement pour les autres, comme demande. */
function afficherMessagePremierFini(cestMoi, pseudo) {
  const msg = document.createElement('div');
  msg.className = 'message-resultat bon message-premier-fini';
  msg.textContent = cestMoi ? '🎉 Bravo, tu as fini le premier !' : `🏆 ${pseudo} a fini le premier !`;
  document.body.appendChild(msg);
  jouerSonVictoire();
  setTimeout(() => msg.remove(), 2800);
}

/* ---- Ecran de fin (quand tous les joueurs ont fini, selon le mode) ---- */
function afficherEcranFinMulti(partie) {
  const container = document.getElementById('ecran-fin-container');
  const joueurs = partie.joueurs || {};
  const ordre = partie.ordre_tours || Object.keys(joueurs);
  const premierPseudo = partie.premier_fini && joueurs[partie.premier_fini] ? joueurs[partie.premier_fini].pseudo : null;
  const modeLongueur = partie.mode_longueur || 'illimite';
  const texteVictoire = modeLongueur === 'cible' ? 'a atteint son objectif en premier' : 'a vidé sa main en premier';

  const lignes = ordre.map((id) => {
    const j = joueurs[id] || { pseudo: '?' };
    const gagnant = id === partie.premier_fini;
    return `<li>${gagnant ? '🏆 ' : ''}${j.pseudo}${id === JOUEUR_ID ? ' (toi)' : ''} — ${j.nb_erreurs || 0} erreur${(j.nb_erreurs || 0) > 1 ? 's' : ''}</li>`;
  }).join('');

  container.innerHTML = `
    <div class="ecran-fin">
      <h2>🎉 Partie terminée !</h2>
      ${premierPseudo ? `<p><strong>${premierPseudo}</strong> ${texteVictoire} 🏆</p>` : ''}
      <ul style="text-align:left; margin: 10px auto; max-width: 320px; opacity: 0.85; font-size: 13px;">${lignes}</ul>
      <button class="btn-rejouer" id="btn-quitter-fin-multi">🚪 Retour à l'accueil</button>
    </div>
  `;
  document.getElementById('btn-quitter-fin-multi').addEventListener('click', () => {
    document.getElementById('btn-quitter-partie').click();
  });
}
