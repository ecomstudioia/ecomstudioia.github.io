/**
 * Liste d'attente E-COM Studio IA
 * - enregistre chaque inscription dans la feuille « Inscriptions » (sans doublon) ;
 * - envoie l'e-mail de bienvenue via Brevo ;
 * - gère la désinscription (lien dans chaque e-mail) ;
 * - envoie l'e-mail d'accès J-7, à lancer à la main.
 *
 * Réglages (Paramètres du projet > Propriétés du script) :
 *   BREVO_API_KEY      clé API Brevo (obligatoire pour envoyer) — ne jamais l'écrire dans ce code
 *   EXPEDITEUR_EMAIL   adresse validée dans Brevo (par défaut ecomstudioia@gmail.com)
 *   LIEN_ACCES         lien d'accès au Studio, seulement pour l'e-mail J-7
 *
 * Après chaque modification : Déployer > Gérer les déploiements > crayon >
 * Version : Nouvelle version > Déployer (l'adresse /exec reste la même).
 */

var URL_APPLI = "https://script.google.com/macros/s/AKfycbx4xzjt6DTdE3cvD8bjL5LN2BFOytNvyRtv_kKxt8moZPkEQa8DE5hcCl054mx4KAADZQ/exec";
var URL_SITE = "https://ecomstudioia.github.io";
var EXPEDITEUR_NOM = "E-COM Studio IA";
var EMAIL_CONTACT = "ecomstudioia@gmail.com";
var TEXTE_CONSENTEMENT = "J’accepte de recevoir des e-mails d’E-COM Studio IA sur le lancement. Désinscription à tout moment.";

var NOM_FEUILLE = "Inscriptions";
var COL = {
  date: "Date d'inscription",
  email: "E-mail",
  prenom: "Prénom",
  type: "Produits ou services",
  projet: "Ce qu'il veut vendre",
  accord: "Consentement (case cochée)",
  texte: "Texte du consentement affiché",
  origine: "Page d'origine",
  statut: "Statut",
  dateStatut: "Date du statut",
  note: "Note",
};
var ORDRE = [COL.date, COL.email, COL.prenom, COL.type, COL.projet, COL.accord, COL.texte, COL.origine, COL.statut, COL.dateStatut, COL.note];
// Noms de la première version, renommés automatiquement.
var ANCIENS_NOMS = { "Date et heure": COL.date, "Accord": COL.accord };

var STATUT = {
  inscrit: "inscrit",
  bienvenue: "bienvenue envoyée",
  j7: "accès J-7 envoyé",
  abonne: "abonné",
  desinscrit: "désinscrit",
};
var STATUTS = [STATUT.inscrit, STATUT.bienvenue, STATUT.j7, STATUT.abonne, STATUT.desinscrit];

var TYPES = ["Des produits", "Des services", "Je ne sais pas encore"];
var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ---------- À lancer une fois depuis l'éditeur ---------- */

function installer() {
  preparerFeuille();
  secretDesinscription();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "envoyerBienvenues") ScriptApp.deleteTrigger(t);
  });
  // Rattrapage toutes les 10 minutes si un envoi a échoué.
  ScriptApp.newTrigger("envoyerBienvenues").timeBased().everyMinutes(10).create();
  envoyerBienvenues();
}

/* ---------- Formulaire et désinscription ---------- */

function doPost(e) {
  try {
    var p = lireParametres(e);
    if (p.action === "desinscription") {
      return json({ ok: desinscrire(p.email, p.jeton) });
    }

    // Piège à robots : ce champ caché doit rester vide.
    if (String(p.site_web || "").trim() !== "") return json({ ok: true });

    var email = nettoyer(p.email, 254).toLowerCase();
    if (!EMAIL_OK.test(email)) return json({ ok: false, erreur: "email" });
    var type = nettoyer(p.type, 40);
    if (TYPES.indexOf(type) === -1) return json({ ok: false, erreur: "type" });
    if (String(p.accord) !== "oui") return json({ ok: false, erreur: "accord" });

    var verrou = LockService.getScriptLock();
    verrou.waitLock(20000);
    try {
      enregistrer({
        email: email,
        prenom: nettoyer(p.prenom, 80),
        type: type,
        projet: nettoyer(p.projet, 500),
        texte: nettoyer(p.accord_texte, 400) || TEXTE_CONSENTEMENT,
        origine: nettoyer(p.origine, 300),
      });
    } finally {
      verrou.releaseLock();
    }

    try { envoyerBienvenues(); } catch (ignore) {} // sinon le rattrapage s'en charge
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ ok: false, erreur: "serveur" });
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === "desinscription") {
    var ok = desinscrire(p.email, p.jeton);
    var message = ok
      ? "<h1>C’est fait.</h1><p>Tu ne recevras plus d’e-mails d’E-COM Studio IA.</p>"
      : "<h1>Ce lien ne fonctionne pas.</h1><p>Écris-nous à <a href=\"mailto:" + EMAIL_CONTACT + "\">" + EMAIL_CONTACT + "</a> et on te désinscrit à la main.</p>";
    return HtmlService.createHtmlOutput(
      "<div style=\"font:17px/1.6 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#142246\">" + message +
      "<p><a href=\"" + URL_SITE + "\">E-COM Studio IA</a></p></div>"
    ).setTitle("Désinscription · E-COM Studio IA").addMetaTag("viewport", "width=device-width, initial-scale=1");
  }
  return json({ ok: true, service: "liste-attente" });
}

/** Ajoute l'inscription, ou met à jour la ligne existante : jamais de doublon. */
function enregistrer(ins) {
  var s = preparerFeuille();
  var maintenant = new Date();
  var lignes = lignesDe(s, ins.email);

  if (lignes.length === 0) {
    var valeurs = {};
    valeurs[COL.date] = maintenant;
    valeurs[COL.email] = ins.email;
    valeurs[COL.prenom] = ins.prenom;
    valeurs[COL.type] = ins.type;
    valeurs[COL.projet] = ins.projet;
    valeurs[COL.accord] = "Oui";
    valeurs[COL.texte] = ins.texte;
    valeurs[COL.origine] = ins.origine;
    valeurs[COL.statut] = STATUT.inscrit;
    valeurs[COL.dateStatut] = maintenant;
    var rangee = [];
    for (var c = 1; c <= s.feuille.getLastColumn(); c++) rangee.push("");
    Object.keys(valeurs).forEach(function (nom) { rangee[s.idx[nom] - 1] = valeurs[nom]; });
    s.feuille.appendRow(rangee);
    return "nouveau";
  }

  var ligne = lignes[0];
  var statut = lire(s, ligne, COL.statut);
  if (statut === STATUT.desinscrit) {
    // Nouvelle inscription volontaire après une désinscription : nouveau consentement.
    ecrire(s, ligne, COL.date, maintenant);
    ecrire(s, ligne, COL.prenom, ins.prenom);
    ecrire(s, ligne, COL.type, ins.type);
    ecrire(s, ligne, COL.projet, ins.projet);
    ecrire(s, ligne, COL.accord, "Oui");
    ecrire(s, ligne, COL.texte, ins.texte);
    ecrire(s, ligne, COL.origine, ins.origine);
    ecrire(s, ligne, COL.statut, STATUT.inscrit);
    ecrire(s, ligne, COL.dateStatut, maintenant);
    ecrire(s, ligne, COL.note, "Réinscription");
    return "reinscription";
  }

  // Déjà inscrit : on complète seulement ce qui manquait.
  if (!lire(s, ligne, COL.prenom) && ins.prenom) ecrire(s, ligne, COL.prenom, ins.prenom);
  if (!lire(s, ligne, COL.projet) && ins.projet) ecrire(s, ligne, COL.projet, ins.projet);
  if (lire(s, ligne, COL.accord).toLowerCase() !== "oui") {
    ecrire(s, ligne, COL.accord, "Oui");
    ecrire(s, ligne, COL.texte, ins.texte);
  }
  return "deja";
}

/** Passe toutes les lignes de cet e-mail en « désinscrit » et efface ce qui n'est plus utile. */
function desinscrire(email, jetonRecu) {
  email = String(email || "").trim().toLowerCase();
  if (!EMAIL_OK.test(email) || String(jetonRecu || "") !== jeton(email)) return false;
  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var s = preparerFeuille();
    var maintenant = new Date();
    lignesDe(s, email).forEach(function (ligne) {
      // On garde l'e-mail, la date et le consentement donné, pour ne plus jamais écrire à cette adresse.
      ecrire(s, ligne, COL.prenom, "");
      ecrire(s, ligne, COL.type, "");
      ecrire(s, ligne, COL.projet, "");
      ecrire(s, ligne, COL.origine, "");
      ecrire(s, ligne, COL.statut, STATUT.desinscrit);
      ecrire(s, ligne, COL.dateStatut, maintenant);
      ecrire(s, ligne, COL.note, "");
    });
    return true;
  } finally {
    verrou.releaseLock();
  }
}

/* ---------- Envois ---------- */

/** Envoie la bienvenue aux inscrits qui ne l'ont pas encore reçue (appelé après chaque inscription et toutes les 10 min). */
function envoyerBienvenues() {
  return envoyerA(
    "bienvenue",
    function (statut) { return statut === "" || statut === STATUT.inscrit; },
    STATUT.bienvenue,
    50
  );
}

/** À lancer à la main 7 jours avant l'ouverture. Relancer le lendemain s'il reste des personnes (limite Brevo gratuite : 300/jour). */
function envoyerAccesJ7() {
  if (!PropertiesService.getScriptProperties().getProperty("LIEN_ACCES")) {
    throw new Error("Ajoute d'abord LIEN_ACCES dans Paramètres du projet > Propriétés du script.");
  }
  var n = envoyerA(
    "j7",
    function (statut) { return statut === "" || statut === STATUT.inscrit || statut === STATUT.bienvenue; },
    STATUT.j7,
    250
  );
  console.log(n + " e-mail(s) d'accès J-7 envoyé(s).");
}

/**
 * Envoie le modèle aux lignes dont le statut convient, une seule fois par adresse.
 * Ne touche jamais aux « abonné » ni aux « désinscrit » : un statut ne revient pas en arrière.
 */
function envoyerA(modele, statutVise, nouveauStatut, maximum) {
  var props = PropertiesService.getScriptProperties();
  var cle = props.getProperty("BREVO_API_KEY");
  if (!cle) return 0; // Brevo pas encore configuré : les inscriptions attendent.

  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(15000)) return 0;
  try {
    var s = preparerFeuille();
    var f = s.feuille;
    var nb = f.getLastRow() - 1;
    if (nb < 1) return 0;
    var data = f.getRange(2, 1, nb, f.getLastColumn()).getValues();
    var val = function (r, nom) { return String(r[s.idx[nom] - 1] == null ? "" : r[s.idx[nom] - 1]).trim(); };

    // Une adresse déjà servie (ou désinscrite, ou abonnée) sur une autre ligne n'est pas relancée.
    var bloquees = {};
    data.forEach(function (r) {
      var st = val(r, COL.statut);
      if (st && !statutVise(st)) bloquees[val(r, COL.email).toLowerCase()] = true;
    });

    var envoyes = 0;
    var traitees = {};
    for (var i = 0; i < data.length && envoyes < maximum; i++) {
      var r = data[i], ligne = i + 2;
      var email = val(r, COL.email).toLowerCase();
      if (!EMAIL_OK.test(email) || val(r, COL.accord).toLowerCase() !== "oui") continue;
      if (!statutVise(val(r, COL.statut))) continue;
      if (bloquees[email] || traitees[email]) {
        if (!val(r, COL.note)) ecrire(s, ligne, COL.note, "Doublon : adresse déjà présente plus haut");
        continue;
      }
      traitees[email] = true;
      var res = envoyerEmail(cle, props, modele, email, val(r, COL.prenom));
      if (res.ok) {
        ecrire(s, ligne, COL.statut, nouveauStatut);
        ecrire(s, ligne, COL.dateStatut, new Date());
        ecrire(s, ligne, COL.note, "");
        envoyes++;
      } else {
        ecrire(s, ligne, COL.note, res.erreur);
        if (res.arret) break; // clé refusée ou quota atteint : inutile d'insister
      }
    }
    return envoyes;
  } finally {
    verrou.releaseLock();
  }
}

function envoyerEmail(cle, props, modele, email, prenom) {
  var lien = lienDesinscription(email);
  var m = MODELES[modele](prenom, lien, props.getProperty("LIEN_ACCES") || "");
  var destinataire = { email: email };
  if (prenom) destinataire.name = prenom;
  var corps = {
    sender: { name: EXPEDITEUR_NOM, email: props.getProperty("EXPEDITEUR_EMAIL") || EMAIL_CONTACT },
    replyTo: { email: EMAIL_CONTACT, name: EXPEDITEUR_NOM },
    to: [destinataire],
    subject: m.sujet,
    htmlContent: m.html,
    textContent: m.texte,
    headers: { "List-Unsubscribe": "<" + lien + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    tags: ["liste-attente", modele],
  };
  var r = UrlFetchApp.fetch("https://api.brevo.com/v3/smtp/email", {
    method: "post",
    contentType: "application/json",
    headers: { "api-key": cle, accept: "application/json" },
    payload: JSON.stringify(corps),
    muteHttpExceptions: true,
  });
  var code = r.getResponseCode();
  if (code >= 200 && code < 300) return { ok: true };
  return {
    ok: false,
    arret: code === 401 || code === 402 || code === 403 || code === 429,
    erreur: "Envoi refusé par Brevo (" + code + ") : " + String(r.getContentText()).slice(0, 180),
  };
}

/* ---------- Modèles d'e-mails ---------- */

var OFFRE = "−20 % chaque mois pendant 12 mois avec un forfait mensuel, ou −30 % sur le forfait annuel";

var MODELES = {
  bienvenue: function (prenom, lienDesinscr) {
    var salut = prenom ? "Salut " + prenom + "," : "Salut,";
    var lignes = [
      "Ton inscription à la liste d’attente E-COM Studio IA est bien enregistrée.",
      "Ce qui t’attend :",
      "• un accès au Studio avant l’ouverture au public : on t’écrit 7 jours avant, avec ton lien ;",
      "• ton offre de lancement : " + OFFRE + ".",
      "D’ici là, tu n’as rien à faire.",
    ];
    return {
      sujet: "Ta place est réservée sur E-COM Studio IA",
      texte: [salut, "", lignes[0], "", lignes[1], lignes[2], lignes[3], "", lignes[4], "", "À très vite,", "L’équipe E-COM Studio IA", "", piedTexte(lienDesinscr)].join("\n"),
      html: gabarit(salut, lignes, null, lienDesinscr),
    };
  },
  j7: function (prenom, lienDesinscr, lienAcces) {
    var salut = prenom ? "Salut " + prenom + "," : "Salut,";
    var lignes = [
      "E-COM Studio IA ouvre au public dans 7 jours. Comme tu es sur la liste d’attente, tu peux entrer dès maintenant.",
      "Ton offre de lancement est réservée : " + OFFRE + ".",
    ];
    return {
      sujet: "Ton accès à E-COM Studio IA est ouvert",
      texte: [salut, "", lignes.join("\n\n"), "", "Ton accès : " + lienAcces, "", "À tout de suite,", "L’équipe E-COM Studio IA", "", piedTexte(lienDesinscr)].join("\n"),
      html: gabarit(salut, lignes, { texte: "Ouvrir mon Studio", lien: lienAcces }, lienDesinscr),
    };
  },
};

function piedTexte(lienDesinscr) {
  return "Tu reçois cet e-mail parce que tu t’es inscrit sur " + URL_SITE.replace("https://", "") +
    ". Pour ne plus rien recevoir : " + lienDesinscr;
}

function gabarit(salut, lignes, bouton, lienDesinscr) {
  var p = function (t) { return "<p style=\"margin:0 0 16px\">" + echapper(t) + "</p>"; };
  return "<!doctype html><html lang=\"fr\"><body style=\"margin:0;background:#f3f6fd\">" +
    "<div style=\"max-width:560px;margin:0 auto;padding:28px 20px;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#142246\">" +
    "<div style=\"font-weight:800;letter-spacing:.04em;color:#264dd2;margin-bottom:20px\">E-COM STUDIO IA</div>" +
    "<div style=\"background:#fff;border-radius:18px;padding:28px\">" +
    p(salut) + lignes.map(p).join("") +
    (bouton ? "<p style=\"margin:24px 0\"><a href=\"" + echapper(bouton.lien) + "\" style=\"display:inline-block;background:#264dd2;color:#fff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px\">" + echapper(bouton.texte) + "</a></p>" : "") +
    "<p style=\"margin:0\">À très vite,<br>L’équipe E-COM Studio IA</p></div>" +
    "<p style=\"font-size:12px;color:#5b6886;margin:18px 4px 0\">Tu reçois cet e-mail parce que tu t’es inscrit sur " +
    "<a href=\"" + URL_SITE + "\" style=\"color:#5b6886\">" + URL_SITE.replace("https://", "") + "</a>. " +
    "<a href=\"" + echapper(lienDesinscr) + "\" style=\"color:#5b6886\">Se désinscrire</a></p>" +
    "</div></body></html>";
}

/* ---------- Désinscription : lien signé ---------- */

function lienDesinscription(email) {
  return URL_APPLI + "?action=desinscription&email=" + encodeURIComponent(email) + "&jeton=" + jeton(email);
}

function jeton(email) {
  var sig = Utilities.computeHmacSha256Signature(String(email).toLowerCase(), secretDesinscription());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, "").slice(0, 32);
}

function secretDesinscription() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty("SECRET_DESINSCRIPTION");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("SECRET_DESINSCRIPTION", s);
  }
  return s;
}

/* ---------- Feuille ---------- */

/** Crée la feuille et les colonnes manquantes, sans déplacer les données existantes. */
function preparerFeuille() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var f = classeur.getSheetByName(NOM_FEUILLE) || classeur.insertSheet(NOM_FEUILLE);
  var idx = indexColonnes(f);
  var change = false;
  Object.keys(ANCIENS_NOMS).forEach(function (ancien) {
    var nouveau = ANCIENS_NOMS[ancien];
    if (idx[ancien] && !idx[nouveau]) { f.getRange(1, idx[ancien]).setValue(nouveau); change = true; }
  });
  if (change) idx = indexColonnes(f);
  ORDRE.forEach(function (nom) {
    if (!idx[nom]) {
      var c = f.getLastColumn() + 1;
      f.getRange(1, c).setValue(nom);
      idx[nom] = c;
      change = true;
    }
  });
  if (change) {
    f.setFrozenRows(1);
    f.getRange(1, 1, 1, f.getLastColumn()).setFontWeight("bold");
    var regle = SpreadsheetApp.newDataValidation().requireValueInList(STATUTS, true).setAllowInvalid(false).build();
    f.getRange(2, idx[COL.statut], f.getMaxRows() - 1, 1).setDataValidation(regle);
  }
  return { feuille: f, idx: idx };
}

function indexColonnes(f) {
  var n = f.getLastColumn();
  var idx = {};
  if (n > 0) f.getRange(1, 1, 1, n).getValues()[0].forEach(function (h, i) { if (String(h).trim()) idx[String(h).trim()] = i + 1; });
  return idx;
}

function lignesDe(s, email) {
  var nb = s.feuille.getLastRow() - 1;
  if (nb < 1) return [];
  var col = s.feuille.getRange(2, s.idx[COL.email], nb, 1).getValues();
  var res = [];
  col.forEach(function (v, i) { if (String(v[0]).trim().toLowerCase() === email) res.push(i + 2); });
  return res;
}

function lire(s, ligne, nom) {
  return String(s.feuille.getRange(ligne, s.idx[nom]).getValue() || "").trim();
}

function ecrire(s, ligne, nom, valeur) {
  s.feuille.getRange(ligne, s.idx[nom]).setValue(valeur);
}

/* ---------- Outils ---------- */

function lireParametres(e) {
  var p = (e && e.parameter) || {};
  if (e && e.postData && e.postData.contents && e.postData.type !== "application/x-www-form-urlencoded") {
    try {
      var corps = JSON.parse(e.postData.contents);
      Object.keys(p).forEach(function (k) { if (!(k in corps)) corps[k] = p[k]; });
      return corps;
    } catch (ignore) {}
  }
  return p;
}

// Coupe la longueur et neutralise les formules (=, +, -, @) pour éviter l'injection dans le tableur.
function nettoyer(v, max) {
  var s = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function echapper(t) {
  return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
