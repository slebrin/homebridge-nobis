# homebridge-nobis

Plugin Homebridge open source en cours de developpement pour les poeles
Nobis-Fi / Agua-IoT. Premier modele cible : Nobis A8 V Round.

**Etat actuel : client en lecture seule et capteur HomeKit de temperature
experimental, optionnel. Aucun controle ni etat de chauffage expose.
La temperature a ete comparee sur l'appareil cible ; la compatibilite complete
et la fraicheur des mesures ne sont pas garanties.
Ce plugin n'est pas Verified by Homebridge.**

## Architecture

Socle derive du [template officiel Homebridge](https://github.com/homebridge/homebridge-plugin-template/tree/ab217b1ff36fbbf69931822324e1986113cd9d81),
sous forme de Dynamic Platform TypeScript. Les accessoires d'exemple et la
dependance aux services personnalises du template ne sont pas repris.

- `src/index.ts` : enregistrement de la plateforme.
- `src/settings.ts` : identifiants stables et constantes.
- `src/config.ts` : configuration typee et validation.
- `src/platform.ts` : cycle Homebridge et cache des accessoires.
- `src/agua/client.ts` : operations en lecture seule, mutualisation et jobs.
- `src/agua/auth.ts` : inscription d'application, login et renouvellement.
- `src/agua/transport.ts` : HTTPS, timeout, taille bornee, erreurs et diagnostic.
- `src/agua/models.ts` : validation des reponses inconnues.
- `src/agua/temperature.ts` : decodage pur de la temperature ambiante observee,
  sans garantie de fraicheur ni exposition HomeKit.
- `src/temperature-accessory.ts` : capteur TemperatureSensor, GET local et
  defaut de communication explicite.
- `src/agua/errors.ts` : erreurs explicites sans valeurs sensibles.
- `src/agua/identity.ts` : UUID d'application prive et persistant.
- `src/diagnostic.ts` et `src/diagnostic-cli.ts` : diagnostic local autonome,
  hors ligne par defaut, sans dependance runtime a Homebridge.
- `src/diagnostic-browser.ts`, `src/diagnostic-browser-cli.ts` et
  `src/diagnostic-page.ts` : interface navigateur locale du diagnostic.
- `config.schema.json` : interface Plugin Settings GUI.
- `test/` : tests fictifs, sans connexion a un poele.

Le controle HomeKit attend la validation des commandes et etats du modele cible.
Voir [l'etude API](docs/ETUDE-API.md) pour les preuves et inconnues.

## Developpement local

Node.js 22 (>= 22.13 pour les outils de developpement) ou 24, npm et Homebridge
sont necessaires. Le plugin compile cible Node 22 >= 22.10 ou 24.

```sh
npm ci
npm run check
```

Les tests utilisent le code compile : lancer `npm run build` avant `npm test`
apres une modification TypeScript. `npm run check` le fait automatiquement.

Pour essayer la version en lecture seule dans une instance Homebridge de developpement :

```sh
npm run build
npm link
```

Puis configurer la plateforme Nobis dans les reglages du plugin de l'interface
Homebridge et redemarrer cette instance. Aucune modification manuelle de la
configuration n'est necessaire. La communication cloud est desactivee par
defaut ; elle exige une activation explicite dans la GUI.

Le package est prepare pour une publication publique experimentale
`0.1.0-beta.0`, sous le tag npm `beta`, pas `latest`. Cela ne constitue
ni une publication effective ni une validation de production.

## Publication beta et installation sur NAS

Avant publication, verifier le contenu avec `npm pack --dry-run`, les tests
avec `npm run check`, et renseigner les liens reels du depot public et des
issues dans les metadonnees du paquet. Aucun lien de depot n'est invente.
La publication exige les droits sur le nom npm ; un resultat 404 ne les
garantit pas. Les versions publiees ne peuvent pas etre reutilisees.

Sur le Mac de developpement, s'authentifier localement via le navigateur :

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --dry-run --tag beta --access public
npm publish --tag beta --access public
```

Ne transmettre aucun jeton, mot de passe ou code de validation dans une
conversation. La derniere commande rend le paquet public : ne la lancer
qu'apres la revue du contenu et des metadonnees. `prepublishOnly` execute
compilation, lint et tests ; `prepack` recompile les fichiers distribues.
Le tag et le registre sont aussi fixes dans `publishConfig`.

**Seulement apres confirmation de la publication**, dans le terminal de
l'interface Homebridge du NAS :

```sh
npm install --global homebridge-nobis@beta
```

Le tag explicite est necessaire pour cette prerelease ; ne pas supposer
que la recherche ou l'installation standard de la GUI choisira la beta.
Actualiser la page Plugins puis configurer Nobis via ses reglages GUI,
activer les deux options cloud/capteur et redemarrer Homebridge.
Si le pont est deja associe a Apple Maison, ne pas l'associer une seconde fois.
Le capteur apparait apres une lecture valide. L'affichage reel dans Maison
reste a valider ; aucune commande de poele n'est disponible.

## Configuration

L'interface prevoit l'e-mail et le mot de passe Nobis-Fi, le nom d'affichage du
poele, un identifiant optionnel, l'intervalle et un diagnostic sans secrets.
**Les tests automatises n'utilisent jamais de vrais identifiants.**
La case "Enable read-only cloud discovery" (`enableCloud`, false par defaut)
active uniquement inscription d'application, authentification, liste des
appareils et lecture de la carte. Elle ne declenche pas de lecture de buffer,
de commande de poele, d'appairage ou de modification de sa configuration.
Seule, cette case ne declenche pas de mesure periodique de temperature.

Pour le capteur experimental, activer aussi **Expose experimental read-only
temperature sensor** (`enableTemperatureSensor`, false par defaut), puis
redemarrer Homebridge. Le validateur refuse cette option si `enableCloud`
est desactive. Aucun changement manuel de configuration n'est necessaire.
Une lecture valide du profil observe est requise avant la creation du
capteur. La carte est reverifiee et le buffer 1 lu a chaque cycle acheve,
avec l'intervalle configure, sans requetes de lecture lors d'un GET HomeKit.

Le service **TemperatureSensor** est retenu plutot que HeaterCooler ou
Thermostat : seule la temperature ambiante est suffisamment etayee.
Le capteur n'expose ni Active, ni etat de chauffage, ni consigne modifiable.
Son UUID derive des identifiants produit/appareil, pas du nom ni de la
temperature. Le cache est reutilise sans doublons ; un ancien appareil
est retire apres selection et lecture valides du nouveau. Desactiver
l'option retire les capteurs caches au prochain demarrage.

Au demarrage, en cas d'erreur ou a l'arret, le capteur est en defaut :
`StatusFault` signale le probleme et le GET de temperature renvoie
`SERVICE_COMMUNICATION_FAILURE`, sans zero fictif ni succes avec une
ancienne valeur. Une lecture valide retablit le service. Une valeur hors
des bornes HAP est refusee, jamais tronquee. Le backoff et l'arret sur
erreur de protocole restent applicables.

**Limite importante :** une reponse cloud reussie ne prouve pas que la
telecommande mesure actuellement. Apple Maison ne peut pas afficher notre
avertissement de fraicheur inconnue dans la valeur de temperature.
Ne pas utiliser ce capteur experimental pour une automatisation critique.
L'affichage dans Apple Maison et la compatibilite complete restent a
valider dans une instance Homebridge de developpement.

Pour une validation manuelle locale : saisir les identifiants uniquement dans
la GUI, activer cette case, puis redemarrer l'instance de developpement.
Desactiver la case et redemarrer pour arreter cette validation.
Ne pas effectuer cette procedure dans les tests ou en CI.

Il faut exactement un appareil non supprime, ou un `deviceId` explicite. Les
erreurs de schema, identifiants refuses et selections ambigues arretent la
decouverte jusqu'a correction/redemarrage, sans choisir un poele au hasard.
Un appareil hors ligne declenche une temporisation, pas un etat OFF.

Le nom du poele sert au nom du capteur optionnel, pas a son identite. Le diagnostic
utilise le niveau debug Homebridge pour les durees/statuts, jamais les reponses
brutes. Les definitions ne sont pas imprimees dans les journaux.

Configuration incomplete/invalide : avertissement sans valeurs sensibles et
aucune tache de demarrage. Le mot de passe est conserve exactement, espaces
compris. Le champ masque de la GUI ne chiffre pas les fichiers de configuration
Homebridge : proteger leur stockage et leurs sauvegardes.

L'intervalle se saisit dans un champ numerique : entier de 30 a 3600 secondes,
60 par defaut. Il est obligatoire dans la GUI afin qu'une valeur invalide ne
soit pas simplement omise lors de la sauvegarde. Le validateur runtime conserve
le defaut de 60 secondes pour une ancienne configuration sans ce champ.

Ne jamais partager mot de passe, jetons, cookies ou captures privees dans une
conversation, une issue ou un depot. Aucune telemetrie n'est ajoutee.

## Client independant de HomeKit

Le client exporte `getDevices()`, `getRegisterMap(device)`, `readBuffer(device,
bufferId?)` et `close()`. Il recoit une identite d'application UUID v4 et les
identifiants localement ; `loadAppIdentity(storagePath)` peut fournir cet UUID
dans le stockage Homebridge. Il ne contient aucune methode de commande. `inspectBufferConfiguration(device)`
demande seulement la configuration existante et renvoie un resultat de job
non interprete, reserve au diagnostic experimental.

`readBuffer` omet `BufferId` si non fourni (defaut 0 selon le Swagger), sans
supposer que le buffer communautaire 1 convient a l'A8. Cette methode reste
utilisee par la plateforme uniquement lorsque le capteur experimental est
explicitement active, avec le buffer 1. Elle renvoie des entiers bruts par adresse
et l'heure de reception locale, pas une temperature, un etat thermique ou une
preuve de fraicheur de la mesure.

Le client accepte `refreshToken` ou `refresh_token` seulement s'ils sont valides
et non contradictoires. Il accepte le format communautaire `jobAnswerData`
avec tableaux `Items`/`Values` valides. Un `jobAnswerPayload` supplementaire
reste opaque et n'est ni interprete ni utilise comme source de valeurs.
Une reponse contenant uniquement ce payload reste refusee.
Les etats de job inconnus sont des erreurs,
pas une reussite fictive.

Les formules, encodages et limites sont conserves comme metadonnees validees,
sans evaluation, troncature ou conversion HomeKit. Les commandes et la lecture
explicite `deviceRequestReading` ne sont pas implementees : le protocole et la
semantique de `Freq: 0` du modele cible restent a valider.

`decodeNobisAmbientTemperature(map, reading, bufferId)` est un decodeur
independant, sans reseau. Il exige le buffer 1 et le profil observe de
`temp_air2_get` (GET, adresse 103, masque 65535, formule `#`, mot little-endian
non signe). Il utilise l'entier fourni par l'API, sans assembler des adresses
voisines ni executer de formule. Une valeur absente, un profil different ou un
entier hors du domaine du mot provoque une erreur explicite, pas un repli.
Le resultat contient `celsius`, `receivedAt` et `freshness: 'unknown'` :
l'heure de reception n'est jamais une heure de mesure. Le domaine du mot
n'est pas une plage de temperatures physiques ou HomeKit.
La concordance avec la telecommande a ete observee sur l'appareil cible,
pas certifiee pour tous les modeles Nobis. Le decodeur est utilise uniquement
par le mode temperature du diagnostic navigateur et le capteur HomeKit
optionnel. Le diagnostic brut et le CLI restent sans conversion ; aucune
lecture de temperature n'est activee par defaut.

Chaque requete est bornee a 10 secondes, lecture du corps comprise, et 2 Mo.
Le suivi du buffer a un budget global de 30 secondes et une attente de
1 seconde avant la premiere consultation du job puis entre consultations.
L'attente initiale suit une pratique du client communautaire Go ; ce n'est
pas une exigence fournisseur ni une resolution prouvee des reponses manquantes.
Le budget global inclut cette attente et les statuts indisponibles restent
des erreurs terminales. Les appels identiques sont mutualises ; un
401 provoque au maximum un renouvellement et une repetition de la lecture.
Un refus de renouvellement HTTP 401/403/422 permet une seule nouvelle connexion ;
une panne reseau/serveur ne provoque pas de boucle de login.

La decouverte s'execute apres chaque cycle acheve, au minimum toutes les
30 secondes (60 par defaut). Le backoff progressif est plafonne a 15 minutes
sans raccourcir un intervalle utilisateur plus long, et `Retry-After` est
respecte. Ce sont des politiques du plugin, pas des quotas cloud documentes.
L'arret annule les requetes et timers, sans appel de logout cloud.

Seul l'UUID d'application est persiste : sous-dossier `homebridge-nobis` du
stockage Homebridge en 0700, fichier `app-id` en 0600. Les jetons restent en
memoire. Une identite corrompue ou un lien symbolique est refuse explicitement,
pas remplace silencieusement.

## Diagnostic local sans Homebridge

### Interface simple dans le navigateur

Depuis le projet compile, lancer :

```sh
npm run build
npm run diagnostic:browser
```

Ouvrir l'adresse `http://127.0.0.1:...` affichee dans le terminal. Le port est
choisi automatiquement ; le serveur ecoute uniquement sur la boucle locale.
Saisir les identifiants dans le formulaire et cliquer sur le bouton de test.
Le lancement de l'interface ne contacte pas Agua-IoT. Le clic autorise une
seule decouverte des appareils et definitions, sans commande ni buffer.
Une selection ambigue ou un poele hors ligne provoque un echec explicite.

Le selecteur propose aussi « Structure de la configuration des buffers ».
Ce mode appelle l'endpoint documente `deviceGetConfigBuffer`, puis suit son
job pendant au maximum 30 secondes (budget global de session : deux minutes).
Il ne modifie pas les buffers et ne lit pas leurs valeurs. Le navigateur
affiche les noms/types des champs, sans leurs valeurs scalaires, sauf le
seul code numerique `jobAnswerData.NackErrCode` s'il est un entier sur ;
les champs sensibles connus sont exclus. La structure est bornee et signale
ses troncatures. Une chaine JSON reste opaque, sans decodage suppose.
Un code absent ou malforme est indique explicitement, sans conversion de
chaine ni valeur par defaut. La signification de ce code reste inconnue :
meme 0 n'est pas assimile a une reussite. Un job termine est affiche comme
**configuration non validee**, pas comme
un buffer identifie.
Le selecteur propose aussi l'inspection de l'identifiant de buffer configure,
via l'endpoint exact `devicegetBufferId`. Son resultat final n'est pas
documente : le diagnostic expose uniquement sa structure et NackErrCode,
avec observation ciblee de `jobAnswerData.BufferCnt` et `Indexes` si leur
format est coherent : entiers surs non negatifs, indices distincts, au maximum
256 elements et nombre egal a la longueur du tableau. Sinon les valeurs sont
masquees et le format indique invalide ; aucun champ absent n'est invente.
Ces regles sont des garde-fous de diagnostic, pas un contrat fournisseur.
Les indices observes ne sont pas automatiquement identifies au buffer adapte
aux mesures du modele. Aucun enchainement automatique
vers une lecture de mesures n'est effectue. Les memes budgets, protections
et erreurs de job s'appliquent aux deux modes experimentaux.
Ces modes ne recuperent pas la carte des registres et ne choisissent pas un buffer.
Le mode « Lecture brute unique du buffer 1 » est distinct et experimental,
prepare apres observation locale de l'indice 1 dans la liste des buffers.
Un clic demande seulement `deviceGetBufferReading` avec `BufferId: 1`,
puis suit son job. Il ne consulte ni ne scanne les indices 130/131/132 et
ne modifie aucun buffer. Les autres modes ne declenchent pas cette lecture.
Le resultat affiche les couples adresse/entier brut valides et l'heure de
reception locale, sans preuve de fraicheur ni conversion thermique.
Le format `jobAnswerData.Items/Values` est le seul pris en charge ; la
presence d'un `jobAnswerPayload` supplementaire ne bloque pas les tableaux
valides de jobAnswerData, mais son contenu n'est jamais interprete.
Un format inconnu, un job manquant ou une erreur arrete l'essai, sans repli
sur un autre indice. Les valeurs restent en memoire dans la page et sont
effacees au rechargement, a une nouvelle tentative ou par le bouton dedie.
Elles ne sont ni enregistrees ni certifiees anonymes.

Le mode distinct **Temperature ambiante du profil valide (experimental)**
recupere la carte puis demande une seule lecture du buffer 1. Il verifie
le profil observe de `temp_air2_get` et affiche seulement sa temperature
en degres Celsius et l'heure de reception, sans transmettre les autres
valeurs, la carte ou les identifiants a la page. Une carte differente ou
une mesure absente/invalide produit une erreur explicite, sans repli.
La fraicheur reste **inconnue**, notamment lorsque la telecommande est
deconnectee : une reponse cloud reussie n'atteste pas une mesure actuelle.
Le resultat est efface par le bouton dedie, une nouvelle tentative ou un
rechargement. Ce mode ne lance ni lecture periodique ni commande ni
exposition HomeKit. Les modes brut et definitions conservent leur comportement.

Une lecture terminee mais refusee par le parseur expose un diagnostic limite
aux types des enveloppes et des tableaux Items/Values et a leurs longueurs.
L'erreur distingue enveloppe non prise en charge et valeurs invalides.
Aucune reponse brute, chaine serveur ou valeur de mesure n'est extraite de
ce resultat refuse. Cela ne desactive pas la validation et ne relance pas
la lecture ; le diagnostic structurel est effacable dans la page.
Si le job devient indisponible, le diagnostic distingue les statuts connus
`terminated`, `Missing job` et `Missing job answer`. Aucun de ces statuts
ne permet de deduire la cause, l'etat du poele ou un code NackErrCode.
La requete de configuration n'est pas relancee automatiquement.
Le bouton d'effacement retire la structure de la page ; aucun rapport
n'est ecrit. Les noms de champs ne sont pas certifies anonymes.

L'e-mail et le mot de passe ne sont ni journalises ni enregistres par l'outil.
Le champ mot de passe est vide apres lancement ; le navigateur peut toutefois
proposer son propre gestionnaire de mots de passe. Seul l'UUID d'application
est conserve dans `~/.homebridge-nobis-diagnostic/browser-storage/homebridge-nobis/app-id`
avec permissions privees. Cette interface affiche les compteurs et les
definitions validees des registres, sans identifiants d'appareil ni de carte.
Un tableau filtrable montre `reg_key`, `reg_type`, `offset`, `mask`, `formula`
et tous les autres champs disponibles dans le detail de chaque ligne :
bornes, encodages, flags et enumerations sont conserves exactement.
Les formules sont du texte, jamais du code execute ; les definitions ne sont
pas des mesures actuelles et ne suffisent pas a choisir un buffer.
Le filtre fonctionne localement sans requete cloud supplementaire.
Les definitions restent en memoire dans la page, sans rapport enregistre :
le bouton d'effacement, une nouvelle tentative ou un rechargement les retire.
Ces chaines issues du serveur ne sont pas certifiees anonymes : ne pas les
partager sans revue locale. Elle n'atteste pas la
compatibilite thermique. Un test a un budget de deux minutes et les tests
concurrents sont refuses. Ctrl+C arrete le serveur et annule le client.

L'interface refuse les origines et noms d'hote externes et exige un jeton
local pour le test. Elle n'est pas destinee a etre exposee sur le reseau,
via un proxy ou sur Internet. Ne pas partager les identifiants ou captures.

### Diagnostic en ligne de commande

L'outil est prepare pour macOS/Linux. Les tests utilisent des reponses fictives.
Le mode par defaut affiche seulement l'aide, sans lire
de fichier, creer de stockage ou contacter Agua-IoT :

```sh
npm run build
npm run diagnostic
```

Le diagnostic est distinct de la procedure normale du plugin via GUI. Il
n'exige ni instance Homebridge ni modification de sa configuration.
Il n'envoie jamais de commande de controle et ne fonctionne pas en boucle.

### Procedure future, a executer uniquement apres decision de validation locale

1. Creer un dossier prive dedie hors du projet (permissions 0700).
2. Avec un editeur local, y creer `credentials.json`, permissions 0600,
   contenant uniquement les champs JSON `email` et `password` du compte
   Nobis-Fi. Ne jamais saisir le mot de passe dans une commande shell,
   transmettre ce fichier ici, le publier ou le committer.
3. Fournir des chemins absolus a l'outil et autoriser explicitement la connexion :

```sh
npm run diagnostic -- --connect \
  --credentials /chemin/prive/credentials.json \
  --storage /chemin/prive/diagnostic-storage
```

Ces chemins sont des exemples a remplacer, pas des fichiers fournis.
Le fichier d'identifiants doit appartenir a l'utilisateur courant et ne pas
etre un lien symbolique. Le stockage dedie doit etre prive : l'outil refuse
un dossier existant public au lieu de modifier ses permissions.
Le fichier d'identifiants reste local : l'outil ne le supprime pas. Le supprimer
manuellement apres les essais s'il n'est plus necessaire.

Sans `--buffer`, cette commande ne lit que les appareils et la carte.
`--device-id` permet une selection locale en presence de plusieurs poeles ;
sans selection univoque, l'outil s'arrete avant de lire une carte.

**Ne pas ajouter `--buffer` avant d'avoir determine le buffer pertinent pour
le modele.** L'option `--buffer ID` demandera une seule lecture brute du buffer
explicitement choisi. Aucun choix automatique du buffer 1, aucune modification
de sa configuration, aucune conversion ni interpretation d'un etat thermique.

Le resultat est ecrit dans `diagnostic-storage/reports/diagnostic-<UUID>.json`,
avec repertoire 0700 et fichier 0600. Chaque essai reussi cree un nouveau
rapport, sans ecraser un precedent. La console n'imprime que des compteurs.
Le rapport conserve les definitions de registres et, si demandees, les
valeurs brutes, mais pas l'e-mail, le mot de passe, les jetons, l'UUID
d'application, les noms/identifiants d'appareil, l'identifiant de carte ou les
reponses HTTP brutes. Les chaines issues des registres restent des donnees du
serveur : **ce rapport n'est pas certifie anonyme et ne doit pas etre publie ou
partage sans inspection locale prealable.**

L'outil conserve les blocages du client : un payload seul sans Items/Values valides,
un etat inconnu ou une carte incompatible provoque un echec explicite, pas
un rapport de succes. Une lecture du buffer ne prouve pas sa fraicheur.
Ctrl-C/SIGTERM ferment le client et annulent les requetes ; les operations
reseau du diagnostic ont un budget global de deux minutes, en plus des
timeouts du client. Aucun logout cloud automatique.

## Limites et prochaines etapes

- Aucun controle de poele ; polling thermique et capteur HomeKit experimentaux
  uniquement sur activation explicite.
- Aucun etat ou capteur HomeKit invente.
- Les formats de session et de jobs du Swagger et des clients tiers divergent.
- Les registres, phases, limites et commandes de l'A8 V Round restent a valider
  localement pendant la phase de lecture seule.
- Aucun fallback local : l'integration prevue depend du service cloud.
- Le nom npm est provisoire ; disponibilite et absence de conflit a revalider.

CI configuree pour compiler, linter et tester sur Node 22/24. Node 26 est a
ajouter lorsqu'il devient LTS et pris en charge par Homebridge. La compatibilite
Homebridge 2 devra etre verifiee avant publication, et pas seulement declaree
dans les metadonnees.

La validation du client et de la plateforme utilise exclusivement des mocks,
dont des tests d'expiration, erreurs, timeout du corps, budget de job,
reconnexion, Retry-After, concurrence, arret et persistance privee. Un test
d'enregistrement utilise l'API reelle de Homebridge 1.11.4, sans reseau.
Compilation, lint et tests reussis sous Node 22 et 24, diagnostic autonome
compris. L'aide `npm run diagnostic` a ete executee en mode hors ligne uniquement.
Le contenu npm a ete examine avec `npm pack --dry-run --ignore-scripts`,
sans publication.

Le formulaire a aussi ete verifie dans Homebridge Config UI X 5.29.0, avec
Homebridge 1.11.4 installe, sous Node 24 sur macOS. Cette UI temporaire a tourne
seule sur localhost, sans demarrer le bridge, avec des identifiants fictifs et
le cloud desactive. Les identifiants manquants, e-mail invalide et mot de passe
compose d'espaces bloquent la sauvegarde. Le champ mot de passe est masque ;
ses espaces significatifs sont conserves dans la configuration sauvegardee.
Les intervalles 29, 3601, 30.5 et vide bloquent la sauvegarde ; 30, 3600 et 60
sont sauvegardes exactement puis retrouves a la reouverture. Le nom optionnel
et le diagnostic sont conserves, et un identifiant de poele vide est omis.
La configuration produite a ete validee par le runtime et aucun appel Agua-IoT
n'a ete declenche avec le cloud desactive.

Ces essais navigateur sont une verification locale, pas une suite GUI en CI
ni une validation Homebridge 2 ou materielle.

L'interface navigateur autonome a ete verifiee localement : affichage,
refus d'un mot de passe compose d'espaces, affichage du resultat avec une
reponse simulee et effacement du champ mot de passe. Aucun compte reel n'a
ete utilise. Ses tests automatises simulent le cloud et couvrent aussi le
refus des acces externes, les corps invalides, les erreurs sans secrets,
la concurrence, le timeout et la fermeture.

Avant HomeKit, il faut confirmer localement le format du login, l'identite du
produit, sa carte, le buffer adapte, la forme du resultat de job et la fraicheur
des mesures. Il faut ensuite valider les codes d'etat, unites et formules.
Un succes de decouverte des definitions n'est pas une preuve de compatibilite
thermique ou de controle. En cas de format inconnu, arreter ce point et examiner
le contrat localement, sans essayer des commandes alternatives.

Avant publication : definir auteur, depot GitHub public, homepage et URL
d'issues avec le mainteneur ; activer les issues ; publier des releases et
notes ; verifier les criteres Verified alors applicables. Les mots-cles
`homebridge-plugin` et `supports-hap` sont declares, pas `supports-matter`.

## Licence

Apache-2.0. Voir [LICENSE](LICENSE) et [NOTICE](NOTICE).
L'etude cite aussi un ancien plugin AGPL ; son code n'est pas reutilise.
