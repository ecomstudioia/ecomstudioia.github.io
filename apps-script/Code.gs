/**
 * Liste d'attente E-COM Studio IA — réception des inscriptions.
 * À coller dans : Google Sheets « Liste d'attente E-COM Studio IA » > Extensions > Apps Script.
 * Déployer : Déployer > Nouveau déploiement > Application web,
 *   Exécuter en tant que : Moi ; Qui a accès : Tout le monde.
 */

var NOM_FEUILLE = "Inscriptions";
var ENTETES = ["Date et heure", "Prénom", "E-mail", "Produits ou services", "Ce qu'il veut vendre", "Accord", "Page d'origine"];
var TYPES = ["Des produits", "Des services", "Je ne sais pas encore"];

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};
    // Corps JSON accepté aussi (envoi en text/plain).
    if (e && e.postData && e.postData.contents && e.postData.type !== "application/x-www-form-urlencoded") {
      try { p = JSON.parse(e.postData.contents); } catch (ignore) {}
    }

    // Piège à robots : ce champ caché doit rester vide.
    if (String(p.site_web || "").trim() !== "") return reponse({ ok: true });

    var email = nettoyer(p.email, 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reponse({ ok: false, erreur: "email" });

    var type = nettoyer(p.type, 40);
    if (TYPES.indexOf(type) === -1) return reponse({ ok: false, erreur: "type" });

    if (String(p.accord) !== "oui") return reponse({ ok: false, erreur: "accord" });

    var verrou = LockService.getScriptLock();
    verrou.waitLock(10000);
    try {
      var feuille = obtenirFeuille();
      feuille.appendRow([
        new Date(),
        nettoyer(p.prenom, 80),
        email,
        type,
        nettoyer(p.projet, 500),
        "Oui",
        nettoyer(p.origine, 300),
      ]);
    } finally {
      verrou.releaseLock();
    }
    return reponse({ ok: true });
  } catch (err) {
    return reponse({ ok: false, erreur: "serveur" });
  }
}

function doGet() {
  return reponse({ ok: true, service: "liste-attente" });
}

function obtenirFeuille() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = classeur.getSheetByName(NOM_FEUILLE) || classeur.insertSheet(NOM_FEUILLE);
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(ENTETES);
    feuille.setFrozenRows(1);
    feuille.getRange(1, 1, 1, ENTETES.length).setFontWeight("bold");
  }
  return feuille;
}

// Coupe la longueur et neutralise les formules (=, +, -, @) pour éviter l'injection dans le tableur.
function nettoyer(v, max) {
  var s = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
