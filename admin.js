/* ================= PANNEAU ADMIN (edition des cartes en direct) =================
   Accessible depuis la frise chronologique (clic sur le logo de l'accueil),
   via un bouton "Admin" protege par un mot de passe cote client. Ce n'est PAS
   une vraie authentification (le mot de passe est visible dans ce fichier
   source, comme n'importe quel code cote client) : ca sert juste a eviter
   qu'un visiteur ne tombe par hasard sur les commandes d'edition, pas a
   empecher une personne qui lirait le code de les utiliser.

   Persistance : les modifications (cartes existantes ou nouvelles) sont
   ecrites dans Firebase Realtime Database, sous les memes cles que le
   multijoueur (voir multi.js / firebase-config.js) :
     admin_overrides/cartes/<id>      -- ecrase les champs d'une carte existante
     admin_overrides/nouvelles/<id>   -- carte entierement nouvelle (id > 524)
   Au chargement (et en continu via onValue/on child_*), CHAQUE visiteur du
   site recupere ces overrides et les fusionne dans BASE_CARTES -- c'est ce qui
   rend l'edition "temps reel" : nul besoin de regenerer cartes.js ni de
   republier le site pour qu'un changement apparaisse. */

const ADMIN_MDP = 'timeline';
let adminActif = false;
try { adminActif = localStorage.getItem('timeline_admin_actif') === '1'; } catch (e) { /* stockage indisponible (navigation privee, etc.) : tant pis, admin desactive */ }

/* ================= DEDUCTION DE LA FAMILLE (miroir cote client de
   normalise_famille() dans generer_cartes.py, pour les cartes creees/editees
   ici sans passer par le pipeline Python) ================= */
const FAMILLE_SLUG_ADMIN = {
  'Histoire': 'histoire', 'Science': 'science', 'Invention': 'inventions', 'Inventions': 'inventions',
  'Culture': 'culture', 'Architecture': 'architecture', 'Nature': 'nature', 'Guerre': 'guerre',
  'Exploration': 'exploration', 'Mythologie': 'mythologie', 'Sport': 'sport', 'Manga': 'manga',
};
function deduireFamilleAdmin(categorie) {
  categorie = (categorie || '').trim();
  if (categorie.startsWith('Jeu vidéo') || categorie.startsWith('Jeu video')) return 'jeuxvideo';
  if (categorie.startsWith('Culture / Cinéma') || categorie.startsWith('Culture / Cinema')) return 'cinema';
  if (categorie.startsWith('Culture / Télévision') || categorie.startsWith('Culture / Television')) return 'television';
  const famille = categorie.split('/')[0].trim();
  return FAMILLE_SLUG_ADMIN[famille] || 'culture';
}

/* ================= ETAT DU BOUTON / DE LA FRISE ================= */
function appliquerEtatBoutonAdmin() {
  const bouton = document.getElementById('btn-admin');
  const boutonAjouter = document.getElementById('btn-admin-ajouter');
  const boutonClassement = document.getElementById('btn-admin-classement');
  const vueFrise = document.getElementById('vue-frise');
  if (!bouton) return;
  if (adminActif) {
    bouton.textContent = '🔓 Admin actif';
    bouton.classList.add('actif');
    if (boutonAjouter) boutonAjouter.hidden = false;
    if (boutonClassement) boutonClassement.hidden = false;
    if (vueFrise) vueFrise.classList.add('frise-admin-actif');
  } else {
    bouton.textContent = '🔒 Admin';
    bouton.classList.remove('actif');
    if (boutonAjouter) boutonAjouter.hidden = true;
    if (boutonClassement) boutonClassement.hidden = true;
    if (vueFrise) vueFrise.classList.remove('frise-admin-actif');
  }
}

function ouvrirLoginAdmin() {
  document.getElementById('admin-login-mdp').value = '';
  document.getElementById('admin-login-erreur').hidden = true;
  document.getElementById('admin-login-modal').hidden = false;
  document.getElementById('admin-login-mdp').focus();
}
function fermerLoginAdmin() {
  document.getElementById('admin-login-modal').hidden = true;
}
function tenterLoginAdmin() {
  const valeur = document.getElementById('admin-login-mdp').value;
  if (valeur === ADMIN_MDP) {
    adminActif = true;
    try { localStorage.setItem('timeline_admin_actif', '1'); } catch (e) {}
    appliquerEtatBoutonAdmin();
    fermerLoginAdmin();
  } else {
    document.getElementById('admin-login-erreur').hidden = false;
  }
}

document.getElementById('btn-admin').addEventListener('click', () => {
  if (adminActif) {
    if (confirm('Quitter le mode admin ?')) {
      adminActif = false;
      try { localStorage.removeItem('timeline_admin_actif'); } catch (e) {}
      appliquerEtatBoutonAdmin();
    }
    return;
  }
  ouvrirLoginAdmin();
});
document.getElementById('admin-login-valider').addEventListener('click', tenterLoginAdmin);
document.getElementById('admin-login-annuler').addEventListener('click', fermerLoginAdmin);
document.getElementById('admin-login-fond').addEventListener('click', fermerLoginAdmin);
document.getElementById('admin-login-mdp').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tenterLoginAdmin();
});

/* ================= FORMULAIRE D'EDITION / CREATION ================= */
const ADMIN_LIENS_TYPES = ['youtube', 'wikipedia', 'publication', 'livre', 'autre'];

function echapperAttributAdmin(texte) {
  return String(texte == null ? '' : texte).replace(/"/g, '&quot;');
}

/* Copie titre + description courte + contexte approfondi dans le
   presse-papiers (les trois blocs separes par une ligne vide), pour coller
   directement ce texte ailleurs (traduction, relecture, etc.) sans avoir a
   selectionner/copier chaque champ un par un. */
function copierTexteCarteAdmin(bouton) {
  const titre = document.getElementById('admin-champ-titre').value.trim();
  const courte = document.getElementById('admin-champ-courte').value.trim();
  const longue = document.getElementById('admin-champ-longue').value.trim();
  const texte = [titre, courte, longue].filter(Boolean).join('\n\n');
  navigator.clipboard.writeText(texte).then(() => {
    const original = bouton.textContent;
    bouton.textContent = '✓ Copié !';
    setTimeout(() => { bouton.textContent = original; }, 1500);
  }).catch(() => {
    bouton.textContent = '⚠️ Échec de la copie';
    setTimeout(() => { bouton.textContent = '📋 Copier le texte (titre + descriptions)'; }, 1500);
  });
}

function construireLigneLienAdminHTML(lien) {
  lien = lien || { type: 'wikipedia', label: '', url: '' };
  const options = ADMIN_LIENS_TYPES.map((t) => `<option value="${t}" ${t === lien.type ? 'selected' : ''}>${t}</option>`).join('');
  return `
    <div class="admin-lien-ligne">
      <select class="admin-lien-type">${options}</select>
      <input type="text" class="admin-lien-label" placeholder="Libellé" value="${echapperAttributAdmin(lien.label)}">
      <input type="url" class="admin-lien-url" placeholder="https://..." value="${echapperAttributAdmin(lien.url)}">
      <button type="button" class="btn-admin-retirer-lien" onclick="this.closest('.admin-lien-ligne').remove()" title="Retirer ce lien">×</button>
    </div>`;
}
function ajouterLigneLienAdmin() {
  document.getElementById('admin-liens-liste').insertAdjacentHTML('beforeend', construireLigneLienAdminHTML());
}
function lireLiensFormulaireAdmin() {
  return Array.from(document.querySelectorAll('.admin-lien-ligne'))
    .map((ligne) => ({
      type: ligne.querySelector('.admin-lien-type').value,
      label: ligne.querySelector('.admin-lien-label').value.trim(),
      url: ligne.querySelector('.admin-lien-url').value.trim(),
    }))
    .filter((l) => l.url);
}

/* ================= LISTE D'IMAGES (ordonnee, plusieurs par carte) =================
   Meme principe que la liste de liens (construireLigneLienAdminHTML plus
   haut) : chaque ligne porte sa propre image en data-URL dans son attribut
   data-url, lu a la soumission par lireImagesFormulaireAdmin(). L'ORDRE des
   lignes dans le DOM EST l'ordre d'affichage (voir les boutons monter/
   descendre) -- pas besoin d'un champ cache separe. */
function construireLigneImageAdminHTML(url) {
  return `
    <div class="admin-image-ligne" data-url="${echapperAttributAdmin(url)}">
      <img class="admin-image-ligne-apercu" src="${url}">
      <div class="admin-image-ligne-boutons">
        <button type="button" onclick="deplacerImageAdmin(this, -1)" title="Monter (affichée plus tôt)">▲</button>
        <button type="button" onclick="deplacerImageAdmin(this, 1)" title="Descendre (affichée plus tard)">▼</button>
        <button type="button" class="btn-admin-retirer-lien" onclick="this.closest('.admin-image-ligne').remove()" title="Retirer cette image">×</button>
      </div>
    </div>`;
}

/* Lit le fichier choisi, le redimensionne (comme le pipeline de sourcing
   d'images cote Python) et l'ajoute comme DERNIERE image de la liste --
   remplacer une image existante se fait en la retirant (×) puis en en
   ajoutant une nouvelle, plutot que d'ecraser en place. */
function ajouterImageAdmin(input) {
  const fichier = input.files && input.files[0];
  if (!fichier) return;
  const lecteur = new FileReader();
  lecteur.onload = (evenement) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width >= height) { height = Math.round((height * MAX) / width); width = MAX; }
        else { width = Math.round((width * MAX) / height); height = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      document.getElementById('admin-images-liste').insertAdjacentHTML('beforeend', construireLigneImageAdminHTML(dataUrl));
    };
    img.src = evenement.target.result;
  };
  lecteur.readAsDataURL(fichier);
  input.value = ''; // permet de re-choisir le meme fichier une seconde fois si besoin
}
function deplacerImageAdmin(bouton, direction) {
  const ligne = bouton.closest('.admin-image-ligne');
  if (direction < 0 && ligne.previousElementSibling) {
    ligne.parentElement.insertBefore(ligne, ligne.previousElementSibling);
  } else if (direction > 0 && ligne.nextElementSibling) {
    ligne.parentElement.insertBefore(ligne.nextElementSibling, ligne);
  }
}
function lireImagesFormulaireAdmin() {
  return Array.from(document.querySelectorAll('.admin-image-ligne')).map((ligne) => ligne.dataset.url);
}

/* Beaucoup de cartes affichent deja une image sans qu'aucun admin n'ait
   jamais rien televerse : le repli automatique de candidatsImage() (voir
   script.js) sert un fichier images/id-<id>.* ou images-claude/id-<id>.*
   directement depuis le depot, sans jamais passer par carte.images. Sans
   ceci, le formulaire s'ouvrait avec une liste vide meme quand la carte a
   deja une (ou deux) illustrations bien visibles dans le jeu -- l'admin ne
   pouvait alors qu'en AJOUTER une, jamais retoucher celle en place. On
   sonde donc ici le systeme de fichiers (comme le fait deja l'inspecteur
   pour ses fleches de navigation) et on pre-remplit la liste si l'admin
   n'a pas deja sa propre liste ordonnee (sinon on melangerait deux
   systemes concurrents pour rien). */
async function completerImagesExistantesAdmin(carte) {
  if (Array.isArray(carte.images) && carte.images.length > 0) return;
  const [urlPerso, urlClaude] = await Promise.all([
    trouverImageDansDossier(carte.id, 'images'),
    trouverImageDansDossier(carte.id, 'images-claude'),
  ]);
  // Le formulaire peut avoir ete ferme (ou celui d'une AUTRE carte ouvert)
  // pendant l'attente : on abandonne plutot que de polluer le mauvais
  // formulaire, ou un formulaire disparu.
  const liste = document.getElementById('admin-images-liste');
  if (!liste) return;
  const form = liste.closest('form');
  if (!form || Number(form.dataset.carteId) !== carte.id) return;
  [urlPerso, urlClaude].filter(Boolean).forEach((url) => {
    liste.insertAdjacentHTML('beforeend', construireLigneImageAdminHTML(url));
  });
}

function construireFormulaireAdminHTML(carte, estNouvelle) {
  const liens = carte.liens || [];
  // Compat : une carte editee avant l'ajout du multi-images n'a qu'un seul
  // carte.image -- on la reprend comme premiere (et unique) image de depart.
  const imagesActuelles = Array.isArray(carte.images) && carte.images.length > 0
    ? carte.images
    : (carte.image && /^(data:|https?:\/\/)/.test(carte.image) ? [carte.image] : []);
  const idAttr = estNouvelle ? 'null' : carte.id;
  return `
    <form class="formulaire-admin" data-carte-id="${idAttr}" onsubmit="return soumettreFormulaireAdmin(event, ${idAttr}, ${estNouvelle ? 'true' : 'false'})">
      <h3>${estNouvelle ? 'Nouvelle carte' : `Modifier « ${echapperAttributAdmin(carte.titre)} »`}</h3>
      ${estNouvelle ? '' : `
      <button type="button" class="btn-admin-copier-texte" id="btn-admin-copier-texte" onclick="copierTexteCarteAdmin(this)">📋 Copier le texte (titre + descriptions)</button>
      `}
      <div class="admin-champ">
        <label>Titre</label>
        <input type="text" id="admin-champ-titre" required value="${echapperAttributAdmin(carte.titre)}">
      </div>
      <div class="admin-ligne-double">
        <div class="admin-champ">
          <label>Catégorie (ex : Histoire / Politique)</label>
          <input type="text" id="admin-champ-categorie" required value="${echapperAttributAdmin(carte.categorie)}">
        </div>
        <div class="admin-champ">
          <label>Date (année ; négatif = av. J.-C.)</label>
          <input type="number" id="admin-champ-date" required value="${carte.date === '' || carte.date == null ? '' : carte.date}">
        </div>
      </div>
      <div class="admin-champ">
        <label>Description courte (visible avant de jouer la carte)</label>
        <textarea id="admin-champ-courte" required>${carte.description_courte || ''}</textarea>
      </div>
      <div class="admin-champ">
        <label>Contexte approfondi (visible une fois la carte jouée)</label>
        <textarea id="admin-champ-longue">${carte.description_longue || ''}</textarea>
      </div>
      <div class="admin-champ">
        <label>Anecdote (« le saviez-vous ? »)</label>
        <textarea id="admin-champ-anecdote">${carte.anecdote || ''}</textarea>
      </div>
      <div class="admin-ligne-double">
        <div class="admin-champ">
          <label>Fiabilité</label>
          <select id="admin-champ-fiabilite">
            <option value="avere" ${carte.fiabilite === 'avere' ? 'selected' : ''}>Avéré</option>
            <option value="debattu" ${carte.fiabilite === 'debattu' ? 'selected' : ''}>Débattu par les historiens</option>
            <option value="legende" ${carte.fiabilite === 'legende' ? 'selected' : ''}>Légende populaire</option>
          </select>
        </div>
        <div class="admin-champ">
          <label>Difficulté</label>
          <select id="admin-champ-difficulte">
            ${DIFFICULTES_FILTRABLES.map((d) => `<option value="${d.id}" ${carte.difficulte === d.id ? 'selected' : ''}>${d.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="admin-champ">
        <label>Emoji de secours (si aucune image)</label>
        <input type="text" id="admin-champ-emoji" maxlength="4" value="${echapperAttributAdmin(carte.emoji || '🃏')}">
      </div>
      <div class="admin-champ">
        <label>Images (affichées dans cet ordre ; utilise les flèches sur la carte s'il y en a plusieurs)</label>
        <div class="admin-images-liste" id="admin-images-liste">
          ${imagesActuelles.map(construireLigneImageAdminHTML).join('')}
        </div>
        <input type="file" accept="image/*" onchange="ajouterImageAdmin(this)">
      </div>
      <div class="admin-champ">
        <label>Sources / liens</label>
        <div class="admin-liens-liste" id="admin-liens-liste">
          ${liens.length > 0 ? liens.map(construireLigneLienAdminHTML).join('') : construireLigneLienAdminHTML()}
        </div>
        <button type="button" class="btn-admin-ajouter-lien" onclick="ajouterLigneLienAdmin()">+ Ajouter un lien</button>
      </div>
      <div class="admin-champ admin-champ-case">
        <label class="admin-case-label">
          <input type="checkbox" id="admin-champ-cachee" ${carte.cachee ? 'checked' : ''}>
          Carte cachée (exclue de toutes les parties tant qu'elle est cochée, réactivable à tout moment)
        </label>
      </div>
      <div class="admin-formulaire-statut" id="admin-formulaire-statut"></div>
      <div class="admin-formulaire-boutons">
        <button type="button" class="btn-admin-secondaire" onclick="document.getElementById('frise-modal').hidden = true;">Annuler</button>
        <button type="submit" class="btn-admin-principal">${estNouvelle ? 'Créer la carte' : 'Enregistrer'}</button>
      </div>
    </form>
  `;
}

function ouvrirFormulaireNouvelleCarte() {
  const brouillon = {
    id: null, titre: '', categorie: '', date: '', description_courte: '', description_longue: '',
    anecdote: '', fiabilite: 'avere', difficulte: 'moyenne', emoji: '🃏', image: '', liens: [],
  };
  document.getElementById('frise-modal-contenu').innerHTML = construireFormulaireAdminHTML(brouillon, true);
  document.getElementById('frise-modal').hidden = false;
}
document.getElementById('btn-admin-ajouter').addEventListener('click', ouvrirFormulaireNouvelleCarte);

function soumettreFormulaireAdmin(event, id, estNouvelle) {
  event.preventDefault();
  const statut = document.getElementById('admin-formulaire-statut');
  statut.className = 'admin-formulaire-statut';
  statut.textContent = 'Enregistrement...';

  if (typeof dbRef === 'undefined' || !dbRef) {
    statut.textContent = "Le mode admin necessite Firebase (verifie firebase-config.js).";
    statut.className = 'admin-formulaire-statut erreur';
    return false;
  }

  const titre = document.getElementById('admin-champ-titre').value.trim();
  const categorie = document.getElementById('admin-champ-categorie').value.trim();
  const date = Number(document.getElementById('admin-champ-date').value);
  const description_courte = document.getElementById('admin-champ-courte').value.trim();
  const description_longue = document.getElementById('admin-champ-longue').value.trim();
  const anecdote = document.getElementById('admin-champ-anecdote').value.trim();
  const fiabilite = document.getElementById('admin-champ-fiabilite').value;
  const difficulte = document.getElementById('admin-champ-difficulte').value;
  const emoji = document.getElementById('admin-champ-emoji').value.trim() || '🃏';
  const images = lireImagesFormulaireAdmin();
  const liens = lireLiensFormulaireAdmin();
  const cachee = document.getElementById('admin-champ-cachee').checked;

  if (!titre || !categorie || Number.isNaN(date) || !description_courte) {
    statut.textContent = 'Titre, catégorie, date et description courte sont obligatoires.';
    statut.className = 'admin-formulaire-statut erreur';
    return false;
  }

  const famille = deduireFamilleAdmin(categorie);
  const donnees = { titre, categorie, famille, date, description_courte, description_longue, anecdote, fiabilite, difficulte, emoji, images, liens, cachee };

  let chemin;
  if (estNouvelle) {
    const idFinal = Math.max(0, ...BASE_CARTES.map((c) => c.id)) + 1;
    donnees.id = idFinal;
    chemin = 'admin_overrides/nouvelles/' + idFinal;
  } else {
    donnees.id = id;
    chemin = 'admin_overrides/cartes/' + id;
  }

  dbRef.ref(chemin).set(donnees).then(() => {
    statut.textContent = 'Enregistré !';
    statut.className = 'admin-formulaire-statut succes';
    setTimeout(() => { document.getElementById('frise-modal').hidden = true; }, 500);
    // BASE_CARTES et la frise se rafraichissent tout seuls via le listener
    // temps reel ci-dessous (appliquerCarteDepuisFirebase) : pas besoin de
    // dupliquer cette logique ici, et ca verifie au passage que l'ecriture a
    // vraiment abouti plutot que de supposer un succes optimiste.
  }).catch((e) => {
    statut.textContent = "Erreur d'enregistrement : " + e.message;
    statut.className = 'admin-formulaire-statut erreur';
  });

  return false;
}

/* ================= SYNCHRONISATION TEMPS REEL =================
   Tourne pour TOUS les visiteurs (pas seulement en mode admin) : c'est ce qui
   rend une modification visible partout sans regenerer cartes.js ni republier
   le site. On mute les objets carte EN PLACE (Object.assign) plutot que de
   remplacer l'entree dans BASE_CARTES : toute reference deja en main (main du
   joueur, timeline, poubelle...) voit alors l'edition immediatement, sans
   synchronisation manuelle supplementaire. */
function appliquerCarteDepuisFirebase(id, donnees, estNouvelle) {
  if (!donnees) return;
  const idNum = Number(id);
  let carte = BASE_CARTES.find((c) => c.id === idNum);
  if (!carte) {
    if (!estNouvelle) return; // override sur un id qui n'existe pas localement : ignore
    carte = { id: idNum, liens: [] };
    BASE_CARTES.push(carte);
  }
  Object.assign(carte, donnees, { id: idNum });
  if (!Array.isArray(carte.liens)) carte.liens = [];

  // Purge cette carte des caches de reconciliation (solo ET multi, cf.
  // script.js/multi.js) : ces caches REUTILISENT le <img> deja cree pour
  // chaque carte deja affichee (evite de recharger son image a chaque
  // rendu), donc sans ceci une carte deja presente dans la main/la
  // timeline/la poubelle AVANT que cette mise a jour Firebase n'arrive
  // (ex: partie demarree juste apres le chargement de la page, avant que
  // le listener admin_overrides n'ait eu le temps de synchroniser) restait
  // bloquee sur son ANCIENNE image (ou le repli generique) pour le reste
  // de la partie, meme apres correction cote admin.
  [cacheCartesTimeline, cacheCartesMain, cacheCartesErreurs,
   cacheCartesTimelineMulti, cacheCartesMainMulti, cacheCartesErreursMulti]
    .forEach((cache) => { if (cache) cache.delete(carte); });

  const vueFrise = document.getElementById('vue-frise');
  if (vueFrise && vueFrise.style.display !== 'none' && typeof construireFrise === 'function') {
    construireFrise();
  }
  // Redessine la partie en cours (solo ou multi) si elle est active, pour
  // que la carte fraichement purgee du cache ci-dessus soit immediatement
  // recreee avec ses donnees a jour, sans attendre le PROCHAIN coup joue.
  if (typeof modeActuel !== 'undefined') {
    if (modeActuel === 'solo' && typeof render === 'function') {
      render();
    } else if (modeActuel === 'multi' && typeof dernierePartieMulti !== 'undefined' && dernierePartieMulti && typeof renderJeuMulti === 'function') {
      renderJeuMulti(dernierePartieMulti);
    }
  }
}

function initSyncAdmin() {
  if (typeof dbRef === 'undefined' || !dbRef) return;
  dbRef.ref('admin_overrides/cartes').on('child_added', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), false));
  dbRef.ref('admin_overrides/cartes').on('child_changed', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), false));
  dbRef.ref('admin_overrides/nouvelles').on('child_added', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), true));
  dbRef.ref('admin_overrides/nouvelles').on('child_changed', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), true));
}

/* ================= CLASSEMENT NO HIT RUN (admin) =================
   Permet de corriger un score errone ou de supprimer une entree (pseudo
   abusif, score suspect...) directement depuis le panneau admin, sans avoir
   a intervenir dans la console Firebase. Le pseudo et le score affiches
   viennent d'un champ texte libre rempli par n'importe quel visiteur (voir
   #pseudo-joueur / enregistrerScoreNoHit dans script.js) : jamais fiables,
   donc jamais interpoles directement dans un attribut/onclick -- on relit
   toujours la donnee depuis dernierClassementAdminData via data-cle au clic. */
let dernierClassementAdminData = {};

function construireLigneClassementAdminHTML(cle, entree) {
  return `
    <div class="admin-classement-ligne" data-cle="${echapperAttributAdmin(cle)}">
      <span class="admin-classement-pseudo">${echapperHTML(entree.pseudo)}</span>
      <input type="number" class="admin-classement-score" value="${Number(entree.score) || 0}" min="0">
      <button type="button" class="admin-classement-btn admin-classement-btn--save" title="Enregistrer" onclick="enregistrerScoreClassementAdmin(this)">💾</button>
      <button type="button" class="admin-classement-btn admin-classement-btn--del" title="Supprimer" onclick="supprimerScoreClassementAdmin(this)">🗑️</button>
    </div>
  `;
}

function rafraichirClassementAdmin(data) {
  dernierClassementAdminData = data || {};
  const zone = document.getElementById('classement-admin-liste');
  if (!zone) return;
  const entrees = Object.entries(dernierClassementAdminData).sort((a, b) => (Number(b[1].score) || 0) - (Number(a[1].score) || 0));
  if (entrees.length === 0) {
    zone.innerHTML = '<div class="admin-formulaire-statut">Aucun score enregistré pour l\'instant.</div>';
    return;
  }
  zone.innerHTML = entrees.map(([cle, entree]) => construireLigneClassementAdminHTML(cle, entree)).join('');
}

let ecouteClassementAdminActive = false;
function ouvrirClassementAdmin() {
  document.getElementById('classement-admin-contenu').innerHTML = `
    <h3 class="admin-formulaire-titre">🏆 Classement No Hit Run</h3>
    <div class="admin-classement-liste" id="classement-admin-liste">Chargement...</div>
  `;
  document.getElementById('classement-admin-modal').hidden = false;
  if (typeof dbRef === 'undefined' || !dbRef) {
    document.getElementById('classement-admin-liste').innerHTML = '<div class="admin-formulaire-statut">Classement indisponible (Firebase non configuré).</div>';
    return;
  }
  // L'ecoute Firebase reste branchee en continu une fois demarree (comme
  // initSyncAdmin ci-dessus) : rouvrir la modale reaffiche juste l'etat
  // courant, deja tenu a jour par rafraichirClassementAdmin.
  if (!ecouteClassementAdminActive) {
    ecouteClassementAdminActive = true;
    dbRef.ref('classementNoHit').on('value', (snap) => rafraichirClassementAdmin(snap.val()));
  }
}
function fermerClassementAdmin() {
  document.getElementById('classement-admin-modal').hidden = true;
}

function enregistrerScoreClassementAdmin(bouton) {
  if (typeof dbRef === 'undefined' || !dbRef) return;
  const ligne = bouton.closest('.admin-classement-ligne');
  const cle = ligne.dataset.cle;
  const input = ligne.querySelector('.admin-classement-score');
  const score = Math.max(0, parseInt(input.value, 10) || 0);
  dbRef.ref('classementNoHit/' + cle).update({ score, maj_le: Date.now() });
}

function supprimerScoreClassementAdmin(bouton) {
  const ligne = bouton.closest('.admin-classement-ligne');
  const cle = ligne.dataset.cle;
  const entree = dernierClassementAdminData[cle];
  const pseudo = entree ? entree.pseudo : cle;
  if (!confirm(`Supprimer le score de ${pseudo} du classement ?`)) return;
  if (typeof dbRef === 'undefined' || !dbRef) return;
  dbRef.ref('classementNoHit/' + cle).remove();
}

document.getElementById('btn-admin-classement').addEventListener('click', ouvrirClassementAdmin);
document.getElementById('classement-admin-modal-fond').addEventListener('click', fermerClassementAdmin);
document.getElementById('btn-fermer-classement-admin').addEventListener('click', fermerClassementAdmin);

appliquerEtatBoutonAdmin();
initSyncAdmin();
