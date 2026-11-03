export const diagnosticPage = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nobis - diagnostic local</title><link rel="stylesheet" href="/style.css">
</head><body><main>
<h1>Nobis : test de connexion</h1>
<p>Interface locale, sans Homebridge. Les modes de lecture ne commandent pas le poele.
Les modes test de consigne, ventilation, puissance, Auto, Powerful et marche/arret commandent reellement le poele,
uniquement sur confirmation et clic explicites.
Lecture du buffer 1 uniquement dans les modes dedies, sur clic explicite.
Seul le bouton ci-dessous autorise la session cloud du mode selectionne.</p>
<form id="test">
<label for="email">E-mail Nobis-Fi</label>
<input id="email" name="email" type="email" required autocomplete="off">
<label for="password">Mot de passe Nobis-Fi</label>
<input id="password" name="password" type="password" required autocomplete="off">
<label for="device">Identifiant du poele (optionnel)</label>
<input id="device" name="deviceId" autocomplete="off">
<p>Laisser vide si un seul poele est associe au compte.</p>
<label for="operation">Lecture a effectuer</label>
<select id="operation">
<option value="definitions">Definitions des registres</option>
<option value="configuration">Structure de la configuration des buffers (experimental)</option>
<option value="buffer-id">Structure du resultat de l'identifiant de buffer configure (experimental)</option>
<option value="buffer-one">Lecture brute unique du buffer 1 (experimental)</option>
<option value="temperature">Temperature ambiante du profil valide (experimental)</option>
<option value="setpoint-read">Lire la consigne uniquement (aucune commande)</option>
<option value="status-read">Observer les codes d'etat (aucune commande)</option>
<option value="settings-read">Comparer puissance, ventilation, Auto et Powerful (lecture seule)</option>
<option value="power">Test manuel marche/arret reel (experimental)</option>
<option value="setpoint">Test manuel de consigne reelle (experimental)</option>
<option value="ventilation">Test manuel de ventilation avant reelle (experimental)</option>
<option value="power-level">Test manuel de puissance de chauffe reelle 1..7 (experimental)</option>
<option value="auto">Test manuel du mode Auto reel ON/OFF (experimental)</option>
<option value="powerful">Test manuel du mode Powerful reel ON/OFF (experimental)</option>
</select>
<section id="auto-controls" hidden>
<p>ATTENTION : Auto gere puissance ET ventilation ; Powerful peut forcer les
deux au maximum selon votre observation dans Nobis-Fi. Interaction entre modes
non validee : l'autre mode doit etre OFF. Notez les quatre reglages
dans Nobis-Fi avant le test. OFF/TRAVAIL/ECO STOP uniquement par
precaution experimentale. Aucun allumage, retry ou restauration automatique.
Une commande unique puis au plus trois relectures ; le job ne prouve pas l'application.
Apres verification, restaurez manuellement le mode et les reglages souhaites
dans Nobis-Fi. Ne changez pas la phase uniquement pour ce test.</p>
<label for="auto-target">Etat demande du mode selectionne ci-dessus (Auto ou Powerful)</label>
<select id="auto-target"><option value="">Choisir explicitement</option>
<option value="on">ON</option><option value="off">OFF</option></select>
<label for="auto-confirm">Je confirme le changement reel du mode selectionne et j'ai note les quatre reglages</label>
<input id="auto-confirm" type="checkbox">
</section>
<section id="ventilation-controls" hidden>
<p>ATTENTION : modification reelle du reglage selectionne : ventilation avant
OU puissance de chauffe (pas marche/arret). Relevez le niveau
initial dans Nobis-Fi pour le restaurer manuellement apres verification.
Essai limite a un niveau 1..7 different, poele OFF ou TRAVAIL, Auto et
Powerful OFF. Ce sont des precautions du test, pas des restrictions Nobis
etablies. OFF (0) et PS (8) exclus pour la ventilation ; la puissance
est limitee a 1..7 et sa commande n'est pas encore validee sur appareil.
Aucun allumage, aucun autre reglage.
Respectez les consignes fabricant ; ne changez pas la phase pour ce test.
Une commande unique puis une lecture, sans repetition ni restauration
automatiques. La relecture ne garantit pas l'effet physique.</p>
<label for="ventilation-target">Niveau du reglage selectionne : ventilation OU puissance (entier 1 a 7)</label>
<input id="ventilation-target" type="number" min="1" max="7" step="1">
<label for="ventilation-confirm">Je confirme la modification reelle et j'ai note le niveau initial</label>
<input id="ventilation-confirm" type="checkbox">
</section>
<section id="power-controls" hidden>
<p>ATTENTION : commande reelle du poele, masque candidat 255 non valide sur appareil.
Restez a proximite et respectez les conditions d'utilisation du fabricant.
Confirmez aussi l'etat actuel sur la telecommande : OFF pour allumer,
TRAVAIL ou ECO STOP pour arreter. La lecture cloud peut etre ancienne.
Aucun essai du masque 65535, nouvel envoi ou retour inverse automatiques.
Apres le test, verifiez et utilisez Nobis-Fi ou la telecommande pour toute correction.
N'allumez pas uniquement pour ce test si les conditions ne sont pas adaptees.</p>
<label for="power-action">Commande unique</label>
<select id="power-action"><option value="">Choisir explicitement</option>
<option value="on">Allumer (uniquement depuis OFF)</option>
<option value="off">Arreter (depuis TRAVAIL ou ECO STOP)</option></select>
<label for="power-confirm">Je confirme la commande reelle, l'etat physique requis et les conditions d'utilisation</label>
<input id="power-confirm" type="checkbox">
</section>
<section id="setpoint-controls" hidden>
<p>ATTENTION : ce test change reellement la consigne et peut agir sur la regulation.
Relevez d'abord la consigne dans Nobis-Fi pour pouvoir la restaurer.
Pas de commande ON/OFF. Aucun nouvel essai ni restauration automatiques.
Restaurez la consigne dans Nobis-Fi apres le test, meme en cas d'erreur.
Une relecture cloud ne garantit pas la fraicheur ni un effet physique.</p>
<label for="setpoint-target">Consigne de test (degres Celsius, entier 7 a 40 ; 41 MAN interdit)</label>
<input id="setpoint-target" type="number" min="7" max="40" step="1">
<label for="setpoint-confirm">Je confirme la modification reelle et j'ai note la consigne a restaurer</label>
<input id="setpoint-confirm" type="checkbox">
</section>
<p>Les lectures experimentales demandent la configuration existante ou l'identifiant de buffer configure.
Elle affiche les noms/types des champs et le seul code numerique NackErrCode,
ainsi que BufferCnt/Indexes numeriques valides dans le mode identifiant,
sans les autres valeurs. Elle ne choisit
aucun buffer et ne confirme pas que son format est compris.</p>
<p>Le mode buffer 1 demande une seule lecture brute, sans lecture des autres
indices ni modification de configuration. Valeurs non interpretees,
fraicheur non verifiee. Aucun essai suivant n'est lance automatiquement.</p>
<p>Le mode temperature verifie la carte puis lit une seule fois le buffer 1.
Seul temp_air2_get est interprete selon le profil compare a la telecommande.
L'heure de mesure et la fraicheur restent inconnues. Aucun etat de chauffage deduit.</p>
<button id="connect" type="submit">Recuperer les definitions en lecture seule</button>
</form>
<p id="result" role="status" aria-live="polite">Aucune connexion effectuee.</p>
<section id="ventilation-result" hidden>
<h2>Resultat du test de reglage (ventilation, puissance, Auto ou Powerful)</h2>
<pre id="ventilation-values"></pre>
<p>Valeurs de consigne cloud, pas vitesse effective, watts ni preuve de fraicheur.
Verifiez Nobis-Fi et le poele puis restaurez manuellement les reglages souhaites.
Une valeur inchangee ne justifie pas un nouvel envoi.
Aucune repetition ni restauration automatiques.</p>
<button id="clear-ventilation" type="button">Effacer le resultat du niveau</button>
</section>
<section id="power-result" hidden>
<h2>Resultat du test marche/arret</h2>
<pre id="power-values"></pre>
<p>Job termine, pas preuve d'effet physique. Relecture cloud unique,
fraicheur inconnue. Une phase identique ne justifie jamais un nouvel envoi.
Verifiez la telecommande et Nobis-Fi ; aucune repetition ni commande inverse automatiques.</p>
<button id="clear-power" type="button">Effacer le resultat marche/arret</button>
</section>
<section id="status-reading" hidden>
<h2>Codes d'etat recus du cloud — lecture seule</h2>
<pre id="status-reading-value"></pre>
<p>Les paires code/libelle OFF (0), DEBUT (2), TRAVAIL (5), ARRET (7) et ECO STOP (8)
ont ete comparees a l'appareil cible. Les autres phases restent non validees.
ARRET signifie arret en cours, pas deja eteint. Aucun Active ou etat HomeKit deduit.
ECO STOP est une pause avec activation conservee et reprise automatique
confirmee par l'utilisateur ; ce diagnostic ne commande pas cette reprise.
Libelles FRE fournis par la carte, pas une interpretation HomeKit.
Entiers bruts compares directement, sans conversion de mot ni correction de masque.
Une valeur inconnue reste inconnue. Fraicheur inconnue : reception locale,
pas heure de mesure. Aucun ON/OFF envoye, aucune combustion deduite.
Comparez avec l'etat affiche sur la telecommande ou dans Nobis-Fi,
sans allumer ni eteindre le poele pour ce diagnostic.</p>
<button id="clear-status-reading" type="button">Effacer les codes d'etat</button>
</section>
<section id="settings-reading" hidden>
<h2>Reglages candidats recus du cloud — lecture seule</h2>
<pre id="settings-reading-value"></pre>
<p>Comparez avec Nobis-Fi sans changer les reglages pour ce diagnostic.
Les valeurs 5, 4, 0, 0 ont ete comparees une fois ; les autres valeurs
et les commandes restent a valider. Libelles FRE de la carte, pas preuve
de correspondance physique. PS n'est pas une vitesse en pourcentage.
Ces consignes ne sont ni les vitesses effectives ni une puissance en watts.
Powerful CRONO (2) est hors du domaine annonce : lecture refusee,
aucune conversion en ON. Fraicheur inconnue, reception pas heure de mesure.
Aucune commande, aucun etat HomeKit ni allumage.</p>
<button id="clear-settings-reading" type="button">Effacer les reglages lus</button>
</section>
<section id="setpoint-reading" hidden>
<h2>Consigne recue du cloud — lecture seule</h2>
<p id="setpoint-reading-value"></p>
<p>Fraicheur inconnue. Reception locale, pas heure de mesure. Aucune ecriture,
aucun ON/OFF ni etat de chauffage deduit.</p>
<button id="clear-setpoint-reading" type="button">Effacer la consigne lue</button>
</section>
<section id="setpoint-result" hidden>
<h2>Resultat du test de consigne</h2>
<p id="setpoint-values"></p>
<p>Valeurs relues du cloud, fraicheur inconnue ; aucune preuve d'action physique.
Verifiez dans Nobis-Fi et sur la telecommande, puis restaurez la consigne initiale.
Aucune restauration ni repetition automatique.</p>
<p>Apres l'ecriture unique : au plus trois lectures, espacees de cinq secondes
si la valeur differe. Arret sur concordance ou erreur, dans le budget de deux minutes.</p>
<button id="clear-setpoint" type="button">Effacer le resultat de consigne</button>
</section>
<section id="temperature" hidden>
<h2>Temperature ambiante recue du cloud</h2>
<p id="temperature-value"></p>
<p id="temperature-received"></p>
<p>Fraicheur INCONNUE : l'heure de reception n'est pas l'heure de mesure.
Une telecommande deconnectee peut laisser une ancienne valeur dans le cloud.
Profil compare sur l'appareil cible, pas certifie pour tous les modeles Nobis.
Aucun etat de chauffage, aucune commande ni exposition HomeKit.
Donnees privees en memoire seulement.</p>
<button id="clear-temperature" type="button">Effacer la temperature</button>
</section>
<section id="reading-failure" hidden>
<h2>Structure de lecture refusee</h2>
<p>Types et tailles uniquement, pas de valeurs brutes. Aucune mesure validee.</p>
<pre id="reading-structure"></pre>
<button id="clear-failure" type="button">Effacer le diagnostic de lecture</button>
</section>
<section id="raw-reading" hidden>
<h2>Valeurs brutes du buffer 1</h2>
<p id="raw-received"></p>
<p>Entiers par adresse, sans conversion de mot, masque, signe, unite ou formule.
La reception n'est pas l'heure de mesure. Aucune temperature ou phase deduite.
Donnees privees en memoire seulement, non certifiees anonymes.</p>
<div class="table-scroll"><table>
<caption>Valeurs brutes retournees par le buffer 1</caption>
<thead><tr><th scope="col">Adresse (offset)</th><th scope="col">Entier brut</th></tr></thead>
<tbody id="raw-values"></tbody></table></div>
<button id="clear-raw" type="button">Effacer les valeurs brutes</button>
</section>
<section id="configuration" hidden>
<h2>Structure du resultat de metadonnees</h2>
<p>Job termine, mais configuration NON VALIDEE. Valeurs masquees sauf NackErrCode et
BufferCnt/Indexes dans le mode identifiant, aucun
buffer identifie. Les noms de champs ne sont pas certifies anonymes.
Les chaines JSON eventuelles restent opaques.</p>
<p id="nack-code"></p>
<p id="buffer-indexes"></p>
<pre id="configuration-shape"></pre>
<button id="clear-configuration" type="button">Effacer la structure de cette page</button>
</section>
<section id="inspection" hidden aria-labelledby="register-title">
<h2 id="register-title">Definitions de registres</h2>
<p>Metadonnees de l'API, pas des mesures actuelles. Les noms, types, formules et
enumerations ne prouvent pas leur correspondance avec l'A8 V Round.
Aucune formule n'est executee. Aucun buffer n'est choisi ou lu.</p>
<p>Donnees privees conservees uniquement dans cette page, non certifiees anonymes.
Ne partagez pas de capture ou de definitions sans verification locale.</p>
<label for="filter">Filtrer les definitions (nom, type ou metadonnees)</label>
<input id="filter" type="search" autocomplete="off">
<p id="register-count" aria-live="polite"></p>
<div class="table-scroll"><table>
<caption>Champs renvoyes par l'API ; un champ absent reste absent.</caption>
<thead><tr><th scope="col">reg_key</th><th scope="col">reg_type</th>
<th scope="col">offset</th><th scope="col">mask</th><th scope="col">formula</th>
<th scope="col">Definition complete</th></tr></thead>
<tbody id="registers"></tbody></table></div>
<button id="clear" type="button">Effacer les definitions de cette page</button>
</section>
<p>Le mot de passe n'est pas enregistre par cet outil et sera efface du champ au lancement.
Seul l'identifiant technique d'application est conserve localement.
Ne partagez jamais vos identifiants. Une reussite ne valide ni les temperatures ni HomeKit.</p>
<p>Pour arreter l'interface : Ctrl+C dans le terminal.</p>
</main><script src="/app.js" defer></script></body></html>`;

export const diagnosticStyle = `body{font:16px system-ui,sans-serif;background:#f3f5f7;color:#18212b;margin:0}
main{max-width:1000px;margin:40px auto;padding:24px;background:white;border-radius:12px}
label{display:block;font-weight:600;margin:18px 0 6px}
input,button,select{box-sizing:border-box;width:100%;padding:12px;font:inherit;border:1px solid #687889;border-radius:6px}
button{margin-top:12px;background:#1759ab;color:white;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
#result{padding:14px;background:#edf3fa;white-space:pre-wrap}p{line-height:1.5}
.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:10px;border-bottom:1px solid #d4dce5;vertical-align:top}
td{overflow-wrap:anywhere}pre{white-space:pre-wrap;min-width:220px}summary{cursor:pointer}
@media(max-width:680px){main{margin:12px;padding:18px}}`;

export function diagnosticScript(token: string): string {
  return `'use strict';
const form = document.getElementById('test');
const button = document.getElementById('connect');
const result = document.getElementById('result');
const inspection = document.getElementById('inspection');
const filter = document.getElementById('filter');
const rows = document.getElementById('registers');
const count = document.getElementById('register-count');
const operation = document.getElementById('operation');
const configuration = document.getElementById('configuration');
const configurationShape = document.getElementById('configuration-shape');
const nackCode = document.getElementById('nack-code');
const bufferIndexes = document.getElementById('buffer-indexes');
const rawReading = document.getElementById('raw-reading');
const rawValues = document.getElementById('raw-values');
const rawReceived = document.getElementById('raw-received');
const readingFailure = document.getElementById('reading-failure');
const readingStructure = document.getElementById('reading-structure');
const temperature = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperature-value');
const temperatureReceived = document.getElementById('temperature-received');
const setpointControls = document.getElementById('setpoint-controls');
const setpointTarget = document.getElementById('setpoint-target');
const setpointConfirm = document.getElementById('setpoint-confirm');
const setpointResult = document.getElementById('setpoint-result');
const setpointValues = document.getElementById('setpoint-values');
const setpointReading = document.getElementById('setpoint-reading');
const setpointReadingValue = document.getElementById('setpoint-reading-value');
const statusReading = document.getElementById('status-reading');
const statusReadingValue = document.getElementById('status-reading-value');
const settingsReading = document.getElementById('settings-reading');
const settingsReadingValue = document.getElementById('settings-reading-value');
function clearSettingsReading() {
  settingsReadingValue.textContent = '';
  settingsReading.hidden = true;
}
document.getElementById('clear-settings-reading').addEventListener('click', clearSettingsReading);
const powerControls = document.getElementById('power-controls');
const powerAction = document.getElementById('power-action');
const powerConfirm = document.getElementById('power-confirm');
const powerResult = document.getElementById('power-result');
const powerValues = document.getElementById('power-values');
const ventilationControls = document.getElementById('ventilation-controls');
const autoControls = document.getElementById('auto-controls');
const autoTarget = document.getElementById('auto-target');
const autoConfirm = document.getElementById('auto-confirm');
const ventilationTarget = document.getElementById('ventilation-target');
const ventilationConfirm = document.getElementById('ventilation-confirm');
const ventilationResult = document.getElementById('ventilation-result');
const ventilationValues = document.getElementById('ventilation-values');
function clearVentilation() {
  ventilationValues.textContent = '';
  ventilationResult.hidden = true;
}
document.getElementById('clear-ventilation').addEventListener('click', clearVentilation);
const settingsProfiles = [
  { key: 'power_set', offset: 33120, min: 1, max: 7, name: 'Puissance candidate' },
  { key: 'vent_front_set', offset: 33132, min: 0, max: 8, name: 'Ventilation avant candidate' },
  { key: 'fun_auto_set', offset: 33128, min: 0, max: 1, name: 'Auto candidat' },
  { key: 'fun_pwf_set', offset: 33154, min: 0, max: 1, name: 'Powerful candidat' },
];
function validSettings(value) {
  return value?.freshness === 'unknown' && value.controlValidated === false
    && Number.isSafeInteger(value.receivedAt) && value.receivedAt >= 0
    && Number.isFinite(new Date(value.receivedAt).getTime())
    && Array.isArray(value.registers) && value.registers.length === settingsProfiles.length
    && value.registers.every((entry, i) => entry?.key === settingsProfiles[i].key
      && entry.offset === settingsProfiles[i].offset && Number.isSafeInteger(entry.rawValue)
      && entry.rawValue >= settingsProfiles[i].min && entry.rawValue <= settingsProfiles[i].max
      && (entry.label === null || (typeof entry.label === 'string' && entry.label.trim())));
}
function clearPower() {
  powerValues.textContent = '';
  powerResult.hidden = true;
}
document.getElementById('clear-power').addEventListener('click', clearPower);
function clearStatusReading() {
  statusReadingValue.textContent = '';
  statusReading.hidden = true;
}
document.getElementById('clear-status-reading').addEventListener('click', clearStatusReading);
function clearSetpointReading() {
  setpointReadingValue.textContent = '';
  setpointReading.hidden = true;
}
document.getElementById('clear-setpoint-reading').addEventListener('click', clearSetpointReading);
function clearSetpoint() {
  setpointValues.textContent = '';
  setpointResult.hidden = true;
}
document.getElementById('clear-setpoint').addEventListener('click', clearSetpoint);
function clearTemperature() {
  temperatureValue.textContent = '';
  temperatureReceived.textContent = '';
  temperature.hidden = true;
}
document.getElementById('clear-temperature').addEventListener('click', clearTemperature);
function clearReadingFailure() {
  readingStructure.textContent = '';
  readingFailure.hidden = true;
}
document.getElementById('clear-failure').addEventListener('click', clearReadingFailure);
function clearRawReading() {
  rawValues.replaceChildren();
  rawReceived.textContent = '';
  rawReading.hidden = true;
}
document.getElementById('clear-raw').addEventListener('click', clearRawReading);
function clearConfiguration() {
  configurationShape.textContent = '';
  nackCode.textContent = '';
  bufferIndexes.textContent = '';
  configuration.hidden = true;
}
document.getElementById('clear-configuration').addEventListener('click', clearConfiguration);
operation.addEventListener('change', () => {
  autoControls.hidden = !['auto', 'powerful'].includes(operation.value);
  autoTarget.value = '';
  autoConfirm.checked = false;
  ventilationControls.hidden = !['ventilation', 'power-level'].includes(operation.value);
  ventilationConfirm.checked = false;
  setpointControls.hidden = operation.value !== 'setpoint';
  powerControls.hidden = operation.value !== 'power';
  powerConfirm.checked = false;
  setpointConfirm.checked = false;
  button.textContent = operation.value === 'powerful'
    ? 'Envoyer UN changement Powerful puis relire' : operation.value === 'auto'
    ? 'Envoyer UN changement Auto puis relire' : operation.value === 'power-level'
    ? 'Envoyer UN niveau de puissance puis relire' : operation.value === 'ventilation'
    ? 'Envoyer UN niveau de ventilation puis relire' : operation.value === 'setpoint'
    ? 'Envoyer UNE consigne reelle puis relire' : operation.value === 'power'
    ? 'Envoyer UNE commande marche/arret reelle' : operation.value === 'status-read'
    ? 'Lire les codes d\\'etat sans commande' : operation.value === 'settings-read'
    ? 'Lire les quatre reglages sans commande' : operation.value === 'setpoint-read'
    ? 'Lire la consigne sans commande' : operation.value === 'buffer-one'
    ? 'Lire une fois le buffer 1 (valeurs brutes)' : operation.value === 'temperature'
    ? 'Lire une fois la temperature ambiante' : operation.value === 'buffer-id'
    ? 'Inspecter l\\'identifiant de buffer en lecture seule' : operation.value === 'configuration'
    ? 'Inspecter la configuration en lecture seule' : 'Recuperer les definitions en lecture seule';
});
let registers = [];
function clearRegisters() {
  registers = [];
  rows.replaceChildren();
  filter.value = '';
  count.textContent = '';
  inspection.hidden = true;
}
function renderRegisters() {
  rows.replaceChildren();
  const query = filter.value.trim().toLowerCase();
  const selected = registers.filter(register => JSON.stringify(register).toLowerCase().includes(query));
  for (const register of selected) {
    const row = document.createElement('tr');
    for (const key of ['reg_key', 'reg_type', 'offset', 'mask', 'formula']) {
      const cell = document.createElement('td');
      cell.textContent = String(register[key]);
      row.appendChild(cell);
    }
    const cell = document.createElement('td');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Afficher les champs';
    const definition = document.createElement('pre');
    definition.textContent = JSON.stringify(register, null, 2);
    details.appendChild(summary);
    details.appendChild(definition);
    cell.appendChild(details);
    row.appendChild(cell);
    rows.appendChild(row);
  }
  count.textContent = selected.length + ' / ' + registers.length + ' definitions affichees';
}
filter.addEventListener('input', renderRegisters);
document.getElementById('clear').addEventListener('click', clearRegisters);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const device = document.getElementById('device');
  const writeSetpoint = operation.value === 'setpoint';
  const writePower = operation.value === 'power';
  const writeVentilation = operation.value === 'ventilation';
  const writePowerLevel = operation.value === 'power-level';
  const writeAuto = operation.value === 'auto';
  const writePowerful = operation.value === 'powerful';
  const modeName = writePowerful ? 'Powerful' : 'Auto';
  const autoEnabled = autoTarget.value === 'on';
  if ((writeAuto || writePowerful) && (!autoConfirm.checked || !['on', 'off'].includes(autoTarget.value))) {
    result.textContent = 'Choisissez ' + modeName + ' ON/OFF et confirmez le changement reel.';
    return;
  }
  const ventilationLevel = Number(ventilationTarget.value);
  if ((writeVentilation || writePowerLevel) && (!ventilationConfirm.checked || !ventilationTarget.value
    || !Number.isSafeInteger(ventilationLevel) || ventilationLevel < 1 || ventilationLevel > 7)) {
    result.textContent = 'Choisissez un niveau entier 1 a 7 et confirmez la modification reelle.';
    return;
  }
  if (writePower && (!powerConfirm.checked || !['on', 'off'].includes(powerAction.value))) {
    result.textContent = 'Choisissez une commande et confirmez l\\'etat physique et la modification reelle.';
    return;
  }
  const target = Number(setpointTarget.value);
  if (writeSetpoint && (!setpointConfirm.checked || !setpointTarget.value
    || !Number.isSafeInteger(target) || target < 7 || target > 40)) {
    result.textContent = 'Choisissez une consigne entiere de 7 a 40 et confirmez la modification reelle.';
    return;
  }
  if (!password.value.trim()) {
    result.textContent = 'Le mot de passe ne peut pas etre vide ou compose uniquement d\\'espaces.';
    return;
  }
  clearRegisters();
  clearConfiguration();
  clearRawReading();
  clearReadingFailure();
  clearTemperature();
  clearSetpoint();
  clearSetpointReading();
  clearStatusReading();
  clearSettingsReading();
  clearPower();
  clearVentilation();
  const readRaw = operation.value === 'buffer-one';
  const readTemperature = operation.value === 'temperature';
  const inspectConfiguration = operation.value === 'configuration' || operation.value === 'buffer-id';
  const path = writePowerful ? '/powerful-test' : writeAuto ? '/auto-test' : writePowerLevel ? '/power-level-test' : writeVentilation ? '/ventilation-test' : writePower ? '/power-test' : writeSetpoint ? '/setpoint-test' : operation.value === 'settings-read' ? '/settings-read' : operation.value === 'status-read' ? '/status-read' : operation.value === 'setpoint-read' ? '/setpoint-read' : readTemperature ? '/ambient-temperature' : readRaw ? '/buffer-one' : operation.value === 'buffer-id' ? '/buffer-id'
    : inspectConfiguration ? '/buffer-configuration' : '/discover';
  button.disabled = true;
  operation.disabled = true;
  powerAction.disabled = true;
  result.textContent = 'Connexion et lecture en cours (maximum 2 minutes)...';
  let body = JSON.stringify({ email: email.value, password: password.value,
    ...(writeSetpoint ? { celsius: target, confirmSetpointChange: true } : {}),
    ...(writePower ? { action: powerAction.value, confirmPowerChange: true } : {}),
    ...(writeVentilation ? { level: ventilationLevel, confirmVentilationChange: true } : {}),
    ...(writePowerLevel ? { level: ventilationLevel, confirmPowerLevelChange: true } : {}),
    ...(writeAuto ? { enabled: autoEnabled, confirmAutoChange: true } : {}),
    ...(writePowerful ? { enabled: autoEnabled, confirmPowerfulChange: true } : {}),
    ...(device.value.trim() ? { deviceId: device.value.trim() } : {}) });
  password.value = '';
  setpointConfirm.checked = false;
  powerConfirm.checked = false;
  ventilationConfirm.checked = false;
  autoConfirm.checked = false;
  try {
    const pending = fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nobis-Token': ${JSON.stringify(token)} },
      body, signal: AbortSignal.timeout(125000) });
    body = '';
    const response = await pending;
    const data = await response.json();
    const settingsHistory = (key, target, label) => {
      if (!Array.isArray(data.observations) || data.observations.length < 1 || data.observations.length > 3
        || !data.observations.every(validSettings)
        || JSON.stringify(data.observations[data.observations.length - 1]) !== JSON.stringify(data.after)
        || data.readbackMatches !== data.after.registers.some(entry =>
          entry.key === key && entry.rawValue === target && entry.label === label)
        || data.observations.slice(0, -1).some(settings => settings.registers.some(entry =>
          entry.key === key && entry.rawValue === target && entry.label === label))) {
        throw new Error('Invalid confirmation history');
      }
      return '\\nRelectures : ' + data.observations.map((settings, i) => {
        const entry = settings.registers.find(entry => entry.key === key);
        return '#' + (i + 1) + ' ' + entry.rawValue + ' (' + new Date(settings.receivedAt).toISOString() + ')';
      }).join(' ; ');
    };
    if (response.ok && (writeAuto || writePowerful)) {
      const modeIndex = writePowerful ? 3 : 2;
      const otherIndex = writePowerful ? 2 : 3;
      const modeKey = writePowerful ? 'fun_pwf_set' : 'fun_auto_set';
      if (!validSettings(data.before) || !validSettings(data.after)
        || typeof data.originalEnabled !== 'boolean' || data.requestedEnabled !== autoEnabled
        || data.originalEnabled === data.requestedEnabled
        || data.before.registers[modeIndex].rawValue !== Number(data.originalEnabled)
        || data.before.registers[modeIndex].label !== (data.originalEnabled ? 'ON' : 'OFF')
        || data.before.registers[otherIndex].rawValue !== 0
        || data.physicalEffectVerified !== false || data.freshnessVerified !== false) {
        throw new Error('Invalid operating mode result');
      }
      ventilationValues.textContent = 'Mode ' + modeName + ' : avant ' + (data.originalEnabled ? 'ON' : 'OFF')
        + ' ; demande ' + (autoEnabled ? 'ON' : 'OFF')
        + '\\nApres : ' + data.after.registers.map(entry => entry.key + '=' + entry.rawValue).join(', ')
        + '\\nReception : ' + new Date(data.after.receivedAt).toISOString() + '.'
        + settingsHistory(modeKey, Number(autoEnabled), autoEnabled ? 'ON' : 'OFF');
      ventilationResult.hidden = false;
      result.textContent = data.after.registers[modeIndex].rawValue === Number(autoEnabled)
        && data.after.registers[modeIndex].label === (autoEnabled ? 'ON' : 'OFF')
        ? modeName + ' relu concordant, effet physique NON confirme. Verifiez les quatre reglages dans Nobis-Fi.'
        : modeName + ' relu different : ne renvoyez pas. Verifiez les quatre reglages dans Nobis-Fi.';
      return;
    }
    if (response.ok && (writeVentilation || writePowerLevel)) {
      const index = writePowerLevel ? 0 : 1;
      if (!validSettings(data.before) || !validSettings(data.after)
        || !Number.isSafeInteger(data.originalLevel) || data.originalLevel < 1 || data.originalLevel > 7
        || data.requestedLevel !== ventilationLevel || data.originalLevel === data.requestedLevel
        || data.before.registers[index].rawValue !== data.originalLevel
        || data.before.registers[index].label !== null
        || data.before.registers[2].rawValue !== 0 || data.before.registers[3].rawValue !== 0
        || data.physicalEffectVerified !== false || data.freshnessVerified !== false) {
        throw new Error('Invalid level response');
      }
      const observed = data.after.registers[index].rawValue;
      ventilationValues.textContent = (writePowerLevel ? 'Puissance de chauffe' : 'Ventilation avant')
        + '\\nAvant : ' + data.originalLevel + ' ; demande : '
        + data.requestedLevel + ' ; relu : ' + observed + ' (libelle carte : '
        + (data.after.registers[index].label ?? 'aucun') + ').\\nReception : '
        + new Date(data.after.receivedAt).toISOString() + '.'
        + settingsHistory(writePowerLevel ? 'power_set' : 'vent_front_set', ventilationLevel, null);
      ventilationResult.hidden = false;
      result.textContent = observed === ventilationLevel && data.after.registers[index].label === null
        ? 'Consigne relue concordante, effet physique NON confirme. Verifiez et restaurez le niveau initial dans Nobis-Fi.'
        : 'Consigne relue differente : ne renvoyez pas la commande. Verifiez Nobis-Fi et restaurez le niveau initial.';
      return;
    }
    if (response.ok && writePower) {
      const phaseCodes = { off: 0, starting: 2, working: 5, stopping: 7, 'eco-stop': 8 };
      const validObservation = value => value?.freshness === 'unknown'
        && Number.isSafeInteger(value.receivedAt) && value.receivedAt >= 0
        && Number.isFinite(new Date(value.receivedAt).getTime())
        && Number.isSafeInteger(value.phase?.code) && value.phase.code >= 0 && value.phase.code <= 65535
        && (value.phase.kind === 'unknown'
          ? ['unvalidated-code', 'label-mismatch'].includes(value.phase.reason)
          : Object.hasOwn(phaseCodes, value.phase.kind) && phaseCodes[value.phase.kind] === value.phase.code);
      if (!['on', 'off'].includes(data.action) || data.action !== powerAction.value
        || data.mask !== 255 || data.physicalEffectVerified !== false || data.freshnessVerified !== false
        || !validObservation(data.before) || !validObservation(data.after)
        || (data.action === 'on' ? data.before.phase.kind !== 'off'
          : !['working', 'eco-stop'].includes(data.before.phase.kind))) {
        throw new Error('Invalid power result');
      }
      powerValues.textContent = 'Commande unique : ' + data.action + ' ; masque candidat : 255'
        + '\\nAvant : ' + data.before.phase.code + ' (' + data.before.phase.kind + ')'
        + '\\nApres : ' + data.after.phase.code + ' (' + data.after.phase.kind + ')'
        + '\\nReception apres : ' + new Date(data.after.receivedAt).toISOString();
      powerResult.hidden = false;
      result.textContent = 'Commande unique suivie d\\'une lecture. Effet physique NON confirme.';
      return;
    }
    if (response.ok && operation.value === 'settings-read') {
      const value = data.settings;
      if (data.bufferId !== 1 || !validSettings(value)) {
        throw new Error('Invalid operating settings');
      }
      settingsReadingValue.textContent = value.registers.map((entry, i) =>
        settingsProfiles[i].name + ' (' + entry.key + ', adresse ' + entry.offset + ') : '
        + entry.rawValue + ' ; libelle carte : ' + (entry.label ?? 'aucun')).join('\\n')
        + '\\nReception : ' + new Date(value.receivedAt).toISOString() + '.';
      settingsReading.hidden = false;
      result.textContent = 'Quatre reglages candidats lus. Aucune commande, fraicheur inconnue.';
      return;
    }
    if (response.ok && operation.value === 'status-read') {
      const value = data.status;
      const profiles = [{ key: 'status_get', offset: 8, max: 65535 },
        { key: 'status_managed_get', offset: 232, max: 255 }];
      if (data.bufferId !== 1 || value?.freshness !== 'unknown'
        || !Number.isSafeInteger(value.receivedAt) || value.receivedAt < 0
        || !Number.isFinite(new Date(value.receivedAt).getTime())
        || !Array.isArray(value.registers) || value.registers.length !== profiles.length
        || value.registers.some((entry, index) => entry?.key !== profiles[index].key
          || entry.offset !== profiles[index].offset || !Number.isSafeInteger(entry.rawValue)
          || entry.rawValue < 0 || entry.rawValue > profiles[index].max
          || (entry.label !== null && (typeof entry.label !== 'string' || !entry.label.trim())))) {
        throw new Error('Invalid status observation');
      }
      const phase = value.phase;
      const knownPhases = {
        off: { code: 0, label: 'OFF', text: 'Eteint (OFF)' },
        starting: { code: 2, label: 'D\\u00c9BUT', text: 'Demarrage en cours' },
        working: { code: 5, label: 'TRAVAIL', text: 'Travail' },
        stopping: { code: 7, label: 'ARR\\u00caT', text: 'Arret en cours (pas encore OFF)' },
        'eco-stop': { code: 8, label: 'ECO STOP', text: 'Pause ECO STOP (activation conservee)' },
      };
      const known = phase && Object.hasOwn(knownPhases, phase.kind) ? knownPhases[phase.kind] : undefined;
      const status = value.registers[0];
      const matchingPair = Object.values(knownPhases).some(pair =>
        pair.code === status.rawValue && pair.label === status.label);
      if (!phase || phase.code !== status.rawValue
        || (known ? phase.code !== known.code || status.label !== known.label || phase.reason !== undefined
          : phase.kind !== 'unknown' || !['unvalidated-code', 'label-mismatch'].includes(phase.reason)
            || (phase.reason === 'unvalidated-code' ? [0, 2, 5, 7, 8].includes(phase.code)
             : ![0, 2, 5, 7, 8].includes(phase.code)))) {
        throw new Error('Invalid phase observation');
      }
      if (phase.kind === 'unknown' && matchingPair) {
        throw new Error('Inconsistent phase observation');
      }
      statusReadingValue.textContent = value.registers.map(entry =>
        entry.key + ' (adresse ' + entry.offset + ') : ' + entry.rawValue
        + ' ; libelle carte : ' + (entry.label ?? 'INCONNU (aucun libelle FRE)')).join('\\n')
        + '\\nPhase observee : ' + (known ? known.text : phase.reason === 'label-mismatch'
          ? 'INCONNUE (libelle absent ou different du profil compare)'
          : 'NON VALIDEE SUR APPAREIL (code ' + phase.code + ')')
        + '\\nReception : ' + new Date(value.receivedAt).toISOString() + '.';
      statusReading.hidden = false;
      result.textContent = 'Codes cloud lus sans commande. Aucun etat de chauffage deduit.';
      return;
    }
    if (response.ok && operation.value === 'setpoint-read') {
      const value = data.setpoint;
      if (data.bufferId !== 1 || value?.freshness !== 'unknown'
        || !Number.isSafeInteger(value.receivedAt) || value.receivedAt < 0
        || !Number.isFinite(new Date(value.receivedAt).getTime())
        || !['temperature', 'manual'].includes(value.mode)
        || (value.mode === 'temperature' && (!Number.isSafeInteger(value.celsius)
          || value.celsius < 7 || value.celsius > 40))
        || (value.mode === 'manual' && value.celsius !== undefined)) {
        throw new Error('Invalid setpoint reading');
      }
      setpointReadingValue.textContent = (value.mode === 'manual' ? 'Mode MAN (pas 41 degres)'
        : 'Consigne : ' + value.celsius + ' degres Celsius')
        + '. Reception : ' + new Date(value.receivedAt).toISOString() + '.';
      setpointReading.hidden = false;
      result.textContent = 'Consigne cloud lue sans commande. Fraicheur inconnue.';
      return;
    }
    if (writeSetpoint) {
      if (!response.ok) {
        result.textContent = data.error;
        return;
      }
      if (![data.originalCelsius, data.requestedCelsius, data.observedCelsius]
        .every(value => Number.isSafeInteger(value) && value >= 7 && value <= 40)
        || data.requestedCelsius !== target || data.freshnessVerified !== false
        || data.readbackMatches !== (data.observedCelsius === target)) {
        throw new Error('Invalid setpoint response');
      }
      setpointValues.textContent = 'Avant : ' + data.originalCelsius + ' ; demandee : '
        + data.requestedCelsius + ' ; relue : ' + data.observedCelsius + ' degres Celsius.';
      if (Array.isArray(data.observations)) {
        setpointValues.textContent += ' Lectures successives : '
          + data.observations.map(entry => String(entry.celsius)).join(', ') + '.';
      }
      setpointResult.hidden = false;
      result.textContent = data.readbackMatches
        ? 'La consigne relue correspond a la demande. Verifiez physiquement et restaurez la consigne initiale.'
        : 'La consigne relue ne correspond PAS a la demande apres le suivi borne. Resultat physique non confirme par ces lectures ; ne renvoyez pas la commande, verifiez Nobis-Fi et restaurez.';
      return;
    }
    if (!response.ok && (readRaw || readTemperature) && data.readingStructure) {
      readingStructure.textContent = JSON.stringify(data.readingStructure, null, 2);
      readingFailure.hidden = false;
    }
    if (response.ok && readTemperature) {
      const value = data.temperature;
      if (data.bufferId !== 1 || value?.registerKey !== 'temp_air2_get'
        || value.freshness !== 'unknown' || !Number.isSafeInteger(value.celsius)
        || value.celsius < 0 || value.celsius > 65535
        || !Number.isSafeInteger(value.receivedAt) || value.receivedAt < 0
        || !Number.isFinite(new Date(value.receivedAt).getTime())) {
        throw new Error('Invalid temperature response');
      }
      temperatureValue.textContent = String(value.celsius) + ' degres Celsius (temp_air2_get)';
      temperatureReceived.textContent = 'Reception locale : ' + new Date(value.receivedAt).toISOString()
        + '. Heure de mesure inconnue.';
      temperature.hidden = false;
      result.textContent = 'Temperature cloud recue. Fraicheur inconnue, aucun etat de chauffage deduit.';
      return;
    }
    if (response.ok && readRaw) {
      if (data.bufferId !== 1 || data.freshnessVerified !== false
        || !Number.isSafeInteger(data.receivedAt) || !Number.isFinite(new Date(data.receivedAt).getTime())
        || !Array.isArray(data.values) || data.values.length === 0
        || !data.values.every(entry => Number.isSafeInteger(entry.offset) && entry.offset >= 0
          && Number.isSafeInteger(entry.value))
        || new Set(data.values.map(entry => entry.offset)).size !== data.values.length) {
        throw new Error('Invalid raw reading response');
      }
      for (const entry of data.values) {
        const row = document.createElement('tr');
        for (const value of [entry.offset, entry.value]) {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.appendChild(cell);
        }
        rawValues.appendChild(row);
      }
      rawReceived.textContent = 'Reception locale : ' + new Date(data.receivedAt).toISOString()
        + ' ; ' + data.values.length + ' valeurs. Fraicheur NON VERIFIEE.';
      rawReading.hidden = false;
      result.textContent = 'Lecture brute du buffer 1 recue. Aucune conversion, aucun controle. Fraicheur non verifiee.';
      return;
    }
    if (response.ok && inspectConfiguration) {
      if (data.configurationValidated !== false || !Array.isArray(data.shape?.fields)) {
        throw new Error('Invalid configuration response');
      }
      if (operation.value === 'buffer-id') {
        const observation = data.bufferIndexes;
        if (observation?.status === 'observed' && Number.isSafeInteger(observation.bufferCount)
          && observation.bufferCount >= 0 && Array.isArray(observation.indexes)
          && observation.indexes.length <= 256 && observation.bufferCount === observation.indexes.length
          && observation.indexes.every(value => Number.isSafeInteger(value) && value >= 0)
          && new Set(observation.indexes).size === observation.indexes.length) {
          bufferIndexes.textContent = 'BufferCnt observe : ' + observation.bufferCount
            + ' ; Indexes observes : ' + JSON.stringify(observation.indexes)
            + '. Correspondance avec les mesures non validee ; aucun index selectionne.';
        } else if (observation?.status === 'absent') {
          bufferIndexes.textContent = 'BufferCnt/Indexes absents : aucun index deduit.';
        } else if (observation?.status === 'invalid') {
          bufferIndexes.textContent = 'BufferCnt/Indexes presents mais format invalide ou incoherent ; valeurs non affichees.';
        } else {
          throw new Error('Invalid buffer indexes response');
        }
      }
      if (data.nack?.status === 'observed' && Number.isSafeInteger(data.nack.value)) {
        nackCode.textContent = 'NackErrCode observe : ' + data.nack.value
          + '. Signification non documentee : meme 0 ne confirme pas une configuration valide.';
      } else if (data.nack?.status === 'absent') {
        nackCode.textContent = 'NackErrCode absent : aucun code deduit.';
      } else if (data.nack?.status === 'invalid') {
        nackCode.textContent = 'NackErrCode present mais format numerique invalide ; valeur non affichee.';
      } else {
        throw new Error('Invalid diagnostic code response');
      }
      configurationShape.textContent = data.shape.fields.map(field => field.path + ' : ' + field.type).join('\\n')
        + (data.shape.truncated ? '\\nInspection partielle : limites de taille/profondeur atteintes.' : '');
      configuration.hidden = false;
      result.textContent = 'Resultat de job recu. Configuration non validee ; aucun buffer choisi ou lu.';
      return;
    }
    if (response.ok) {
      if (!Array.isArray(data.registers) || data.registerCount !== data.registers.length) {
        throw new Error('Invalid register response');
      }
      registers = data.registers;
      renderRegisters();
      inspection.hidden = false;
    }
    result.textContent = response.ok
      ? 'Connexion reussie : ' + data.deviceCount + ' appareil(s), ' + data.registerCount
        + ' definitions de registres. Aucune commande ni lecture de buffer. Compatibilite thermique non validee.'
      : data.error;
  } catch {
    clearRegisters();
    clearConfiguration();
    clearRawReading();
    clearReadingFailure();
    clearTemperature();
    clearSetpoint();
    clearSetpointReading();
    clearStatusReading();
    clearPower();
    clearVentilation();
    clearSettingsReading();
    result.textContent = 'Interface indisponible, reponse invalide ou delai depasse. Verifiez le terminal. Aucun succes confirme.';
    if (writeSetpoint) {
      result.textContent += ' Une commande peut avoir ete appliquee : verifiez Nobis-Fi et restaurez la consigne. Ne repetez pas automatiquement.';
    }
    if (writePower) {
      result.textContent += ' Une commande peut avoir ete appliquee : verifiez la telecommande et Nobis-Fi. Ne repetez pas automatiquement.';
    }
    if (writeVentilation || writePowerLevel) {
      result.textContent += ' Une commande peut avoir ete appliquee : verifiez Nobis-Fi et restaurez le niveau initial. Ne repetez pas automatiquement.';
    }
    if (writeAuto || writePowerful) {
      result.textContent += ' ' + modeName + ' peut avoir ete applique : verifiez les quatre reglages dans Nobis-Fi. Ne repetez pas automatiquement.';
    }
  } finally {
    body = '';
    password.value = '';
    button.disabled = false;
    operation.disabled = false;
    powerAction.disabled = false;
  }
});
`;
}
