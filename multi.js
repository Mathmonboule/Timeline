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

  document.getElementById('lobby-mode-badge').textContent = 'Partie multijoueur';
  document.getElementById('btn-nouvelle-partie').hidden = true;
  document.getElementById('lobby-solo-zone').hidden = true;
  document.getElementById('lobby-multi-zone').hidden = false;
  document.getElementById('lobby-code-valeur').textContent = code;
  document.getElementById('multi-attente-code-valeur').textContent = code;
  document.getElementById('zone-jeu-solo').hidden = true;
  document.getElementById('multi-attente').hidden = false;
  document.querySelector('.pioche-erreurs-section h3').textContent = '🗑️ Mes cartes en erreur (scroll pour tout voir)';

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

  liste.innerHTML = '';
  ids.forEach((id) => {
    const j = joueurs[id];
    const estTour = partie.tour_actuel === id;
    const div = document.createElement('div');
    div.className = 'lobby-joueur'
      + (id === JOUEUR_ID ? ' lobby-joueur--actif' : '')
      + (estTour ? ' lobby-joueur--tour' : '');
    div.innerHTML = `
      <span class="lobby-joueur-tour">${estTour ? '🎯' : (j.hote ? '👑' : '👤')}</span>
      <span class="lobby-joueur-nom">${j.pseudo}${id === JOUEUR_ID ? ' (toi)' : ''}</span>
      <span class="lobby-joueur-cartes">${j.nb_cartes != null ? j.nb_cartes + ' cartes' : ''}</span>
    `;
    liste.appendChild(div);
  });

  const note = document.getElementById('lobby-multi-note');
  const btnDemarrer = document.getElementById('btn-demarrer-partie');
  const parametres = document.getElementById('lobby-parametres');
  if (partie.statut === 'lobby') {
    btnDemarrer.hidden = !estHote;
    btnDemarrer.disabled = ids.length < 2;
    parametres.hidden = !estHote;
    note.hidden = false;
    note.textContent = estHote
      ? (ids.length < 2 ? 'Il faut au moins 2 joueurs pour démarrer.' : `${ids.length} joueurs dans le salon — tu peux démarrer.`)
      : `En attente que l'hôte démarre la partie… (${ids.length} joueur${ids.length > 1 ? 's' : ''} dans le salon)`;
  } else {
    btnDemarrer.hidden = true;
    parametres.hidden = true;
    note.hidden = true;
  }
}

/* ================= DEMARRER LA PARTIE (hote uniquement) =================
   Distribue 5 cartes a chaque joueur (comme en solo), pose la 1ere carte
   restante comme repere sur la timeline commune, met le reste en pioche
   partagee, et fixe l'ordre des tours = ordre d'arrivee dans le salon. */
const TAILLE_MAIN_INITIALE = 5;
const TAILLE_MAIN_MAX = 10;

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

document.getElementById('btn-demarrer-partie').addEventListener('click', async () => {
  if (!codePartieActuelle || !estHote) return;
  const snap = await dbRef.ref(`parties/${codePartieActuelle}/joueurs`).get();
  const joueurs = snap.val() || {};
  const ids = Object.keys(joueurs).sort((a, b) => (joueurs[a].rejoint_le || 0) - (joueurs[b].rejoint_le || 0));
  if (ids.length < 2) return;

  const dureeSaisie = parseInt(document.getElementById('multi-duree-tour').value, 10);
  const dureeTourMs = dureeIllimitee ? 0 : Math.max(5, dureeSaisie || 20) * 1000;

  const minimumRequis = 1 + TAILLE_MAIN_INITIALE * ids.length;
  const pool = BASE_CARTES.filter((c) => filtresMultiActifs.has(c.famille));
  const source = pool.length >= minimumRequis ? pool : BASE_CARTES;
  const toutes = melanger(source);
  const carteRepere = toutes[0];
  let curseur = 1;
  const mains = {};
  ids.forEach((id) => {
    mains[id] = toutes.slice(curseur, curseur + TAILLE_MAIN_INITIALE).map((c) => c.id);
    curseur += TAILLE_MAIN_INITIALE;
  });
  const pioche = toutes.slice(curseur).map((c) => c.id);

  const maj = {
    statut: 'en_cours',
    ordre_tours: ids,
    tour_index: 0,
    tour_actuel: ids[0],
    duree_tour_ms: dureeTourMs,
    tour_fin_a: dureeTourMs ? Date.now() + dureeTourMs : null,
    familles_actives: source === pool ? Array.from(filtresMultiActifs) : null,
    carte_repere: carteRepere.id,
    timeline: [carteRepere.id],
    pioche,
    mains,
    erreurs: Object.fromEntries(ids.map((id) => [id, []])),
    premier_fini: null
  };
  ids.forEach((id) => {
    maj[`joueurs/${id}/nb_cartes`] = mains[id].length;
    maj[`joueurs/${id}/nb_erreurs`] = 0;
  });

  await dbRef.ref('parties/' + codePartieActuelle).update(maj);
});

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

  document.getElementById('lobby-mode-badge').textContent = 'Partie solo';
  document.getElementById('btn-nouvelle-partie').hidden = false;
  document.getElementById('lobby-solo-zone').hidden = false;
  document.getElementById('lobby-multi-zone').hidden = true;
  document.getElementById('zone-jeu-solo').hidden = false;
  document.getElementById('multi-attente').hidden = true;
  document.getElementById('multi-tour-banner').hidden = true;
  document.querySelector('.pioche-erreurs-section h3').textContent = '🗑️ Cartes en erreur (scroll pour tout voir)';

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

  mettreAJourEtatLocalMulti(partie);
  renderJeuMulti(partie);

  if (partie.statut === 'termine') {
    arreterTimerMulti();
    document.getElementById('multi-tour-banner').hidden = true;
    afficherEcranFinMulti(partie);
  } else {
    demarrerTimerMulti(partie);
  }
}

function mettreAJourEtatLocalMulti(partie) {
  multiTimeline = (partie.timeline || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
  multiMain = (((partie.mains || {})[JOUEUR_ID]) || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
  multiErreurs = (((partie.erreurs || {})[JOUEUR_ID]) || []).map((id) => CARTE_PAR_ID[id]).filter(Boolean);
  multiPiocheCount = (partie.pioche || []).length;
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
  document.getElementById('btn-valider').disabled = !(monTour && multiIndexZoneSelectionnee !== null && multiCarteChoisie);
  document.getElementById('main-joueur').classList.toggle('pas-mon-tour', !monTour);
}

function renderTimelineMulti(monTour) {
  const container = document.getElementById('timeline-container');
  container.innerHTML = '';
  container.appendChild(creerZoneDepotMulti(0, monTour));
  multiTimeline.forEach((carte, i) => {
    const div = creerCarteHTML(carte, {
      repere: dernierePartieMulti && carte.id === dernierePartieMulti.carte_repere,
      inspectee: multiCarteInspectee === carte
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
    zone.innerHTML = `<div>${multiCarteChoisie.emoji}</div><div class="attente-titre">${multiCarteChoisie.titre}</div>`;
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

  multiErreurs.forEach((carte) => {
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
    container.appendChild(div);
  });
}

function renderInspecteurMulti() {
  const zone = document.getElementById('contenu-inspecteur');
  const carte = multiCarteInspectee;
  const dansMain = carte && multiMain.includes(carte);
  const dansTimeline = carte && multiTimeline.includes(carte);
  const dansErreurs = carte && multiErreurs.includes(carte);

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

/* Relit l'etat le plus frais depuis Firebase avant d'ecrire (defensif contre
   un decalage local), puis avance le tour vers le joueur suivant. */
async function appliquerResolutionTour(correct, carte, indexResolu) {
  const refPartie = dbRef.ref('parties/' + codePartieActuelle);
  const snap = await refPartie.get();
  const partie = snap.val();
  if (!partie || partie.tour_actuel !== JOUEUR_ID || partie.statut !== 'en_cours') return;

  let timeline = partie.timeline || [];
  let main = ((partie.mains || {})[JOUEUR_ID]) || [];
  let erreurs = ((partie.erreurs || {})[JOUEUR_ID]) || [];
  let pioche = partie.pioche || [];

  main = main.filter((id) => id !== carte.id);

  if (correct) {
    timeline = [...timeline.slice(0, indexResolu), carte.id, ...timeline.slice(indexResolu)];
  } else {
    erreurs = [...erreurs, carte.id];
    if (pioche.length > 0 && main.length < TAILLE_MAIN_MAX) {
      const [pioch, ...reste] = pioche;
      main = [...main, pioch];
      pioche = reste;
    }
  }

  const ordre = partie.ordre_tours || [];
  const idxActuel = ordre.indexOf(JOUEUR_ID);
  const prochainIndex = ordre.length > 0 ? (idxActuel + 1) % ordre.length : 0;

  let premierFini = partie.premier_fini || null;
  if (!premierFini && main.length === 0) premierFini = JOUEUR_ID;

  const tousVides = ordre.every((id) => {
    if (id === JOUEUR_ID) return main.length === 0;
    const m = ((partie.mains || {})[id]) || [];
    return m.length === 0;
  });

  const maj = {
    timeline,
    pioche,
    [`mains/${JOUEUR_ID}`]: main,
    [`erreurs/${JOUEUR_ID}`]: erreurs,
    [`joueurs/${JOUEUR_ID}/nb_cartes`]: main.length,
    [`joueurs/${JOUEUR_ID}/nb_erreurs`]: erreurs.length,
    premier_fini: premierFini,
    tour_index: prochainIndex,
    tour_actuel: ordre[prochainIndex],
    tour_fin_a: partie.duree_tour_ms ? Date.now() + partie.duree_tour_ms : null,
    statut: tousVides ? 'termine' : 'en_cours'
  };

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
  const prochainIndex = ordre.length > 0 ? (idxActuel + 1) % ordre.length : 0;

  await refPartie.update({
    tour_index: prochainIndex,
    tour_actuel: ordre[prochainIndex],
    tour_fin_a: partie.duree_tour_ms ? Date.now() + partie.duree_tour_ms : null
  });

  multiCarteChoisie = null;
  multiIndexZoneSelectionnee = null;
}

/* ---- Ecran de fin (quand tous les joueurs ont la main vide) ---- */
function afficherEcranFinMulti(partie) {
  const container = document.getElementById('ecran-fin-container');
  const joueurs = partie.joueurs || {};
  const ordre = partie.ordre_tours || Object.keys(joueurs);
  const premierPseudo = partie.premier_fini && joueurs[partie.premier_fini] ? joueurs[partie.premier_fini].pseudo : null;

  const lignes = ordre.map((id) => {
    const j = joueurs[id] || { pseudo: '?' };
    const gagnant = id === partie.premier_fini;
    return `<li>${gagnant ? '🏆 ' : ''}${j.pseudo}${id === JOUEUR_ID ? ' (toi)' : ''} — ${j.nb_erreurs || 0} erreur${(j.nb_erreurs || 0) > 1 ? 's' : ''}</li>`;
  }).join('');

  container.innerHTML = `
    <div class="ecran-fin">
      <h2>🎉 Partie terminée !</h2>
      ${premierPseudo ? `<p><strong>${premierPseudo}</strong> a vidé sa main en premier 🏆</p>` : ''}
      <ul style="text-align:left; margin: 10px auto; max-width: 320px; opacity: 0.85; font-size: 13px;">${lignes}</ul>
      <button class="btn-rejouer" id="btn-quitter-fin-multi">🚪 Retour à l'accueil</button>
    </div>
  `;
  document.getElementById('btn-quitter-fin-multi').addEventListener('click', () => {
    document.getElementById('btn-quitter-partie').click();
  });
}
