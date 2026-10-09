export const diagnosticPage = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nobis - diagnostic local</title><link rel="stylesheet" href="/style.css">
</head><body><main>
<h1>Nobis : test de connexion</h1>
<p>Interface locale, sans Homebridge. Aucune commande de controle au poele.
Lecture du buffer 1 uniquement dans les modes dedies, sur clic explicite.
Seul le bouton ci-dessous autorise une session cloud en lecture seule.</p>
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
</select>
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
  button.textContent = operation.value === 'buffer-one'
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
  if (!password.value.trim()) {
    result.textContent = 'Le mot de passe ne peut pas etre vide ou compose uniquement d\\'espaces.';
    return;
  }
  clearRegisters();
  clearConfiguration();
  clearRawReading();
  clearReadingFailure();
  clearTemperature();
  const readRaw = operation.value === 'buffer-one';
  const readTemperature = operation.value === 'temperature';
  const inspectConfiguration = operation.value === 'configuration' || operation.value === 'buffer-id';
  const path = readTemperature ? '/ambient-temperature' : readRaw ? '/buffer-one' : operation.value === 'buffer-id' ? '/buffer-id'
    : inspectConfiguration ? '/buffer-configuration' : '/discover';
  button.disabled = true;
  operation.disabled = true;
  result.textContent = 'Connexion et lecture en cours (maximum 2 minutes)...';
  let body = JSON.stringify({ email: email.value, password: password.value,
    ...(device.value.trim() ? { deviceId: device.value.trim() } : {}) });
  password.value = '';
  try {
    const pending = fetch(path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Nobis-Token': ${JSON.stringify(token)} },
      body, signal: AbortSignal.timeout(125000) });
    body = '';
    const response = await pending;
    const data = await response.json();
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
    result.textContent = 'Interface indisponible, reponse invalide ou delai depasse. Verifiez le terminal. Aucun succes confirme.';
  } finally {
    body = '';
    password.value = '';
    button.disabled = false;
    operation.disabled = false;
  }
});
`;
}
