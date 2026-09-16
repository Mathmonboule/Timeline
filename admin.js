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
  const vueFrise = document.getElementById('vue-frise');
  if (!bouton) return;
  if (adminActif) {
    bouton.textContent = '🔓 Admin actif';
    bouton.classList.add('actif');
    if (boutonAjouter) boutonAjouter.hidden = false;
    if (vueFrise) vueFrise.classList.add('frise-admin-actif');
  } else {
    bouton.textContent = '🔒 Admin';
    bouton.classList.remove('actif');
    if (boutonAjouter) boutonAjouter.hidden = true;
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

function construireFormulaireAdminHTML(carte, estNouvelle) {
  const liens = carte.liens || [];
  // Compat : une carte editee avant l'ajout du multi-images n'a qu'un seul
  // carte.image -- on la reprend comme premiere (et unique) image de depart.
  const imagesActuelles = Array.isArray(carte.images) && carte.images.length > 0
    ? carte.images
    : (carte.image && /^(data:|https?:\/\/)/.test(carte.image) ? [carte.image] : []);
  const idAttr = estNouvelle ? 'null' : carte.id;
  return `
    <form class="formulaire-admin" onsubmit="return soumettreFormulaireAdmin(event, ${idAttr}, ${estNouvelle ? 'true' : 'false'})">
      <h3>${estNouvelle ? 'Nouvelle carte' : `Modifier « ${echapperAttributAdmin(carte.titre)} »`}</h3>
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

  const vueFrise = document.getElementById('vue-frise');
  if (vueFrise && vueFrise.style.display !== 'none' && typeof construireFrise === 'function') {
    construireFrise();
  }
}

function initSyncAdmin() {
  if (typeof dbRef === 'undefined' || !dbRef) return;
  dbRef.ref('admin_overrides/cartes').on('child_added', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), false));
  dbRef.ref('admin_overrides/cartes').on('child_changed', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), false));
  dbRef.ref('admin_overrides/nouvelles').on('child_added', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), true));
  dbRef.ref('admin_overrides/nouvelles').on('child_changed', (snap) => appliquerCarteDepuisFirebase(snap.key, snap.val(), true));
}

appliquerEtatBoutonAdmin();
initSyncAdmin();
