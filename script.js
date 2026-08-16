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

/* ================= INITIALISATION ================= */
function melanger(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function initPartie() {
  const toutes = melanger(BASE_CARTES);
  carteRepereInitiale = toutes[0];
  timeline = [carteRepereInitiale];
  main = toutes.slice(1, 6);
  pioche = toutes.slice(6);
  erreurs = [];
  carteChoisie = null;
  carteEnCoursDeDrag = null;
  indexZoneSelectionnee = null;
  carteInspectee = null;
  document.getElementById('ecran-fin-container').innerHTML = '';
  render();
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

/* ================= UTILITAIRES ================= */
function formaterDate(date) {
  const abs = Math.abs(date);
  if (date < 0) {
    if (abs >= 1000000) {
      const millions = abs / 1000000;
      const arrondi = Number.isInteger(millions) ? millions : Math.round(millions * 10) / 10;
      return `il y a ${arrondi.toLocaleString('fr-FR')} millions d'années`;
    }
    return `${abs.toLocaleString('fr-FR')} av. J.-C.`;
  }
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
   images/id-<id>.png puis .jpg/.jpeg/.webp avant de retomber sur l'emoji. Il
   suffit donc de nommer un fichier "id-47.png" et de le deposer dans images/
   pour qu'il s'affiche, sans toucher au xlsx ni au code. */
function candidatsImage(carte) {
  if (carte.image) return [`images/${carte.image}`];
  return ['png', 'jpg', 'jpeg', 'webp'].map(ext => `images/id-${carte.id}.${ext}`);
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

  document.getElementById('btn-valider').disabled = (indexZoneSelectionnee === null || carteChoisie === null);

  if (main.length === 0) {
    afficherEcranFin();
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
      <div>${carteChoisie.emoji}</div>
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
    <span class="badge-fiabilite ${badgeClass}">${badgeTexte}</span>
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
    if (correct) {
      timeline.splice(indexResolu, 0, carteResolue);
    } else {
      erreurs.push(carteResolue);
    }
    main = main.filter((c) => c !== carteResolue);

    // MODE SOLO ILLIMITE : on repioche systématiquement, même en cas de bonne
    // réponse, jusqu'à épuisement des 137 cartes. C'est le mode par défaut
    // voulu pour l'instant. Le mode multijoueur (lobby, règles, le premier
    // qui vide sa main gagne) sera un mode séparé, ajouté plus tard.
    if (pioche.length > 0) {
      main.push(pioche.shift());
    }

    carteChoisie = null;
    indexZoneSelectionnee = null;
    render();
  }, 450);
}

function afficherMessage(correct) {
  const msg = document.createElement('div');
  msg.className = 'message-resultat ' + (correct ? 'bon' : 'mauvais');
  msg.textContent = correct ? '✅ Bonne réponse !' : '❌ Mauvaise réponse !';
  document.body.appendChild(msg);
  setTimeout(() => msg.remove(), 1300);
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

/* ================= TOGGLE INSPECTEUR (droite) ================= */
document.getElementById('btn-toggle-inspecteur').addEventListener('click', () => {
  const inspecteur = document.getElementById('inspecteur');
  inspecteur.classList.toggle('replie');
  const btn = document.getElementById('btn-toggle-inspecteur');
  btn.textContent = inspecteur.classList.contains('replie') ? '◀' : '▶';
});

/* ================= TOGGLE LOBBY (gauche) ================= */
document.getElementById('btn-toggle-lobby').addEventListener('click', () => {
  const lobby = document.getElementById('lobby');
  lobby.classList.toggle('replie');
  const btn = document.getElementById('btn-toggle-lobby');
  btn.textContent = lobby.classList.contains('replie') ? '▶' : '◀';
});

/* ================= NAVIGATION ACCUEIL <-> JEU ================= */
function afficherAccueil() {
  document.getElementById('vue-accueil').style.display = 'flex';
  document.getElementById('vue-jeu').style.display = 'none';
}
function afficherJeu() {
  document.getElementById('vue-accueil').style.display = 'none';
  document.getElementById('vue-jeu').style.display = 'flex';
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
  afficherJeu();
  initPartie();
});

document.getElementById('logo-jeu').addEventListener('click', afficherAccueil);
// Le logo de la page d'accueil est purement decoratif (deja sur l'accueil),
// mais reste cliquable sans effet pour rester coherent visuellement.
document.getElementById('logo-accueil').addEventListener('click', afficherAccueil);

/* ================= DEMARRAGE ================= */
afficherAccueil();
