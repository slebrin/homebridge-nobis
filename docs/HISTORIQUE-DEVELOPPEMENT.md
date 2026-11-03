# Historique de developpement de homebridge-nobis

Archive du guide accumule pendant les betas jusqu'a beta.27 (3 novembre
2026). Ce document conserve les essais et restrictions de versions
anterieures : il ne constitue pas le guide d'installation actuel.
Voir le [guide utilisateur](../README.md), le [changelog](../CHANGELOG.md)
et l'[etude API](ETUDE-API.md). Les chemins de code cites dans l'archive
sont relatifs a la racine du depot.

Plugin Homebridge open source en cours de developpement pour les poeles
Nobis-Fi / Agua-IoT. Premier modele cible : Nobis A8 V Round.

**Capteur, interrupteur et tuile Chauffage avec consigne testes dans Maison.
Ventilation HeaterCooler optionnelle ; Powerful beta.16 verifie dans Maison
par l'utilisateur ; beta.17 ajoute Auto apres confirmation du cycle API
dans Nobis-Fi. L'utilisateur confirme aussi Auto dans Maison le 12 octobre.
Variante Thermostat beta.3 testee dans Maison :
le curseur reste grise a l'arret sur l'installation utilisateur.
Aucun etat de combustion mesure n'est expose.
La temperature a ete comparee sur l'appareil cible ; la compatibilite complete
et la fraicheur des mesures ne sont pas garanties.
Ce plugin n'est pas Verified by Homebridge.**

## Reponse rapide dans Maison — beta.24

### Capteur Eco Stop optionnel — beta.27

Dans les reglages graphiques Homebridge, activer **Enable read-only Eco Stop
contact sensor**, enregistrer et redemarrer. Cloud et lecture de temperature
doivent etre actives ; les commandes de puissance ne sont pas necessaires.
Un seul service ContactSensor est ajoute au meme accessoire Calcifer, sans
nouveau switch, changement d'UUID ni requete cloud supplementaire.

Dans Maison, **ouvert** signifie phase API ECO STOP. **Ferme** signifie une
autre phase reconnue (OFF, DEBUT, TRAVAIL ou ARRET), pas necessairement poele
eteint. Phase inconnue ou erreur de lecture : capteur indisponible, jamais
faussement ferme. Le capteur ne commande rien. Les mises a jour suivent
les lectures existantes ; fraicheur cloud inconnue, pas de temps reel garanti.
Le rendu ouvert/ferme, regroupement et resume des capteurs depend de Maison
et reste a confirmer sur l'installation. Desactiver l'option retire uniquement
ce service, sans modifier les autres commandes ou leurs verrous.

Marche/arret (interrupteur et Chauffage), consigne, ventilation, Auto,
Powerful et Chrono repondent a Maison des la prise en charge locale,
sans attendre les transactions cloud. La reponse conserve la derniere
valeur observee ; la tuile peut donc revenir temporairement a cette valeur.
Ce retour n'est ni l'acceptation par Agua-IoT ni la confirmation du poele.
Seule une lecture API met a jour l'etat affiche ; la fraicheur reste inconnue.

Un seul traitement est autorise a la fois, sans file d'attente ni retry
d'ecriture. Les autres commandes sont refusees pendant les verifications,
l'envoi et le suivi d'une cible en attente. Les controles locaux (valeur,
phase connue, disponibilite, verrou) restent immediats. Les verifications
cloud, le marqueur prive avant POST, les delais bornes et les relectures
sont conserves. Une demande acceptee localement mais non encore envoyee
peut etre annulee par l'arret de Homebridge ; elle n'est jamais rejouee.

Les logs distinguent `accepted locally`, `processing finished` (transaction
terminee, pas necessairement cible confirmee) et `processing failed`.
**Un echec tardif ne peut plus etre renvoye au clic initial dans Maison.**
Consulter les logs et Nobis-Fi avant toute nouvelle tentative. Une erreur
reelle peut rendre la commande indisponible jusqu'a une lecture valide ;
un marqueur existant reste verrouille jusqu'a confirmation ou abandon
explicite. La fermeture annule les requetes en cours, pas les commandes
deja recues par le cloud. Aucun changement d'UUID ni nouvelle option.

### Recuperation apres mesure hors plage — beta.26

Une lecture de temperature hors de la plage HAP est refusee sans clamp ni
substitution. La tuile devient indisponible et le plugin planifie une
reconnexion progressive ; une lecture valide restaure automatiquement
la tuile et la communication. Cette erreur de mesure ne doit plus arreter
definitivement la decouverte. Les autres erreurs de protocole/configuration
restent arretees pour eviter des interpretations hasardeuses.

## Architecture

### Chrono experimental — beta.23

Dans les reglages graphiques Homebridge, activer **Enable experimental
Chrono (scheduled programs) switch**, enregistrer puis redemarrer.
Cloud, lecture de temperature et commande de puissance doivent etre actives.
Un interrupteur **Chrono** apparait sur le meme poele dans Maison, sans
changer son UUID. Il active/desactive les programmes existants : il ne
modifie aucun horaire, jour ou programme.

La lecture 33162=0/desactive et 1/active a ete comparee avec Nobis-Fi
sur l'A8 cible (cycle OFF/ON/OFF). Le 15 octobre 2026, l'utilisateur
confirme que le switch Programme fonctionne dans Maison sur son poele.
Ce retour ne valide pas l'execution des horaires ni toutes les conditions
de fonctionnement. L'option reste desactivee par defaut. Pour le premier essai,
controler tous les horaires dans Nobis-Fi, rester present et mettre le
poele OFF. Depuis beta.25, les ecritures Chrono sont autorisees en
OFF ou ECO STOP, apres confirmation utilisateur que Nobis-Fi permet
de modifier Chrono en ECO STOP. TRAVAIL reste exclu par precaution :
ce n'est pas une restriction constructeur verifiee.
Activer Chrono peut permettre des allumages/arrets programmes ; le plugin
n'envoie pas de commande d'allumage implicite. Ne pas creer d'automatisation
non surveillee tant que ce comportement n'est pas valide.

Une ecriture cible uniquement 33162, masque 65535, valeur 0/1, sans retry.
La tuile conserve la derniere valeur relue jusqu'a confirmation API.
Le verrou Chrono est persistant meme si l'option est ensuite desactivee,
et bloque les autres commandes jusqu'a lecture de la cible ou abandon
explicite dans la GUI. La recuperation couvre aussi Chrono sans commande ;
elle ne desactive ni programmes ni commandes deja en attente dans le cloud.
La fraicheur des reponses et l'execution des horaires ne sont pas garanties.

Socle derive du [template officiel Homebridge](https://github.com/homebridge/homebridge-plugin-template/tree/ab217b1ff36fbbf69931822324e1986113cd9d81),
sous forme de Dynamic Platform TypeScript. Les accessoires d'exemple et la
dependance aux services personnalises du template ne sont pas repris.

- `src/index.ts` : enregistrement de la plateforme.
- `src/settings.ts` : identifiants stables et constantes.
- `src/config.ts` : configuration typee et validation.
- `src/platform.ts` : cycle Homebridge et cache des accessoires.
- `src/agua/client.ts` : lectures, mutualisation, jobs et commandes experimentales sur activation explicite.
- `src/agua/auth.ts` : inscription d'application, login et renouvellement.
- `src/agua/transport.ts` : HTTPS, timeout, taille bornee, erreurs et diagnostic.
- `src/agua/models.ts` : validation des reponses inconnues.
- `src/agua/temperature.ts` : decodage pur de la temperature ambiante observee,
  sans garantie de fraicheur ni exposition HomeKit.
- `src/temperature-accessory.ts` : capteur TemperatureSensor, GET local et
  defaut de communication explicite.
- `src/power-accessory.ts` : interrupteur optionnel, etats relus uniquement.
- `src/powerful-accessory.ts` : implementation partagee des interrupteurs Auto/Powerful, distincts de l'activation du poele.
- `src/heating-accessory.ts` : tuile Thermostat, consigne et chauffage uniquement.
- `src/agua/power-command-state.ts` : verrou persistant des commandes incertaines.
- `src/agua/operating-settings.ts` : observation en lecture seule de quatre reglages candidats.
- `src/agua/ventilation-preview.ts` : candidat strict de test manuel de ventilation avant.
- `src/agua/errors.ts` : erreurs explicites sans valeurs sensibles.
- `src/agua/identity.ts` : UUID d'application prive et persistant.
- `src/diagnostic.ts` et `src/diagnostic-cli.ts` : diagnostic local autonome,
  hors ligne par defaut, sans dependance runtime a Homebridge.
- `src/diagnostic-browser.ts`, `src/diagnostic-browser-cli.ts` et
  `src/diagnostic-page.ts` : interface navigateur locale du diagnostic.
- `config.schema.json` : interface Plugin Settings GUI.
- `test/` : tests fictifs, sans connexion a un poele.

Les premiers tests manuels ON/OFF et consigne ont eu un effet physique
confirme par l'utilisateur sur l'A8 cible. L'interrupteur HomeKit reste
experimental ; un premier cycle ON, reprise en TRAVAIL et OFF depuis
Apple Maison, avec retour final a OFF, est confirme par l'utilisateur
sur beta.1. La consigne beta.2 est confirmee par l'utilisateur, mais
Maison masque/grise son curseur quand le HeaterCooler est inactif.
Ventilation, Powerful et Auto sont disponibles sur activation explicite.
Les programmes ne sont pas exposes dans Maison.
Voir [l'etude API](ETUDE-API.md) pour les preuves et inconnues.

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

La version experimentale `0.1.0-beta.2` est publiee sur npm. Lors de la
verification precedente du 10 octobre 2026, `latest` pointe
vers cette beta : cela ne constitue pas une version stable ni une
validation de production. Preferer explicitement `@beta` pour les essais.

## Publication beta et installation sur NAS

Avant toute nouvelle publication, augmenter la version, verifier le contenu avec `npm run check:package`, les tests
avec `npm run check`. Le depot public est
[slebrin/homebridge-nobis](https://github.com/slebrin/homebridge-nobis) ;
les signalements vont dans ses
[issues](https://github.com/slebrin/homebridge-nobis/issues).
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
compilation, lint, tests et verification du paquet ; `prepack` recompile les fichiers distribues.
Le tag et le registre sont aussi fixes dans `publishConfig`.

`check:package` compile puis inspecte la liste produite par npm sans creer
d'archive ni publier. Il exige tous les fichiers compiles correspondant aux
sources TypeScript, les documents distribues et les points d'entree declares.
Il refuse les fichiers supplementaires (y compris un ancien module dans
`dist`), manquants, vides ou dupliques, et une version de lockfile incoherente.
La CI Node 22/24 execute le meme controle. Cette liste stricte ne remplace
pas la revue du contenu : ne jamais mettre de secrets dans les sources ou
les documents autorises.

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
Le capteur apparait apres une lecture valide. L'affichage dans Maison,
le redemarrage et une reprise apres erreur ont fait l'objet de premiers
retours utilisateur positifs ; aucune commande de poele n'est disponible
tant que les options experimentales de controle restent desactivees.

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

### Interrupteur experimental (beta.1)

**Enable experimental real stove power control** (`enablePowerSwitch`,
false par defaut) ajoute un service Switch a l'accessoire existant, sans
changer son UUID ni creer un second poele. Il exige cloud et capteur de
temperature actives. Les installations existantes restent en lecture seule
tant que cette nouvelle option n'est pas explicitement activee.

ON est lu depuis TRAVAIL (5) ou ECO STOP (8), OFF uniquement depuis OFF (0).
ECO STOP conserve l'activation avec reprise automatique selon le retour
utilisateur : ce n'est pas un arret demande ni une combustion en cours.
Depuis beta.18, demarrage/arret connus conservent la derniere activation
confirmee depuis le lancement, sans inferer un nouvel etat. Les ecritures
restent refusees dans ces phases. Sans observation stable initiale, avec
un code inconnu ou une erreur, l'activation reste indisponible, pas
faussement eteinte. Le capteur de temperature continue
a fonctionner si seule la lecture d'etat est incompatible.
L'interrupteur n'est pas un etat de combustion ni une consigne de regulation.

Un SET different de l'etat lu reverifie l'appareil en ligne, la carte et
la phase avant une commande unique : ON depuis OFF, OFF depuis TRAVAIL
ou ECO STOP (depuis beta.6).
Masque 255, valeurs 85/170, profil strict compare sur l'A8. Aucun POST
d'ecriture repete sur 401, reseau ou timeout. Une relecture est effectuee
apres le job ; l'etat demande n'est jamais utilise comme nouvel etat.

Depuis beta.24, sans attendre le job ou la relecture, la reponse HAP
conserve la derniere valeur effectivement observee, sans erreur artificielle
ni affichage optimiste. Les lectures valides restent accessibles.
Ne pas repeter : les ecritures sont bloquees jusqu'a une phase TRAVAIL/ECO STOP
pour ON ou OFF pour OFF observee par l'API. Au plus trois relectures rapides
espacees de cinq secondes precedant le polling normal assurent cette
confirmation ; aucun job ne provoque une commande inverse. Les erreurs
cloud/stockage restent explicites dans les logs, mais ne peuvent plus etre
renvoyees au clic deja acquitte localement. Une transaction cloud lente
ne retient plus le handler HomeKit ; ne jamais renvoyer la commande en boucle.

Avant l'envoi, un marqueur on/off est ecrit et synchronise dans le dossier
prive `homebridge-nobis` du stockage Homebridge (fichier
`power-pending-<UUID>`, permissions 0600). Il survit au redemarrage et
n'est jamais rejoue comme commande. Une erreur de stockage empeche
l'envoi. Il est efface seulement apres observation de la phase cible.
Une commande ambigue peut rester bloquee indefiniment si la cible ne
remonte pas : verifier physiquement dans Nobis-Fi/la telecommande et
demander un diagnostic plutot que supprimer le marqueur ou repeter.
Desactiver l'option retire le service, sans effacer cette incertitude.

**Utilisation supervisee uniquement** : le cloud peut contenir une valeur
ancienne. Respecter les instructions du fabricant, ne pas utiliser
d'automatisations non surveillees. Le 10 octobre 2026, l'utilisateur a
confirme un premier cycle depuis Maison sur beta.1 : lancement, reprise
de disponibilite en TRAVAIL et extinction. Le retour final de
l'interrupteur a OFF apres refroidissement et les delais exacts ne sont
documentes. Le retour final a OFF a ensuite ete confirme par l'utilisateur.
Ce retour ne constitue pas une certification.

### Bouton Auto dans Maison (beta.17)

Dans Plugin Settings GUI, activer **Enable experimental Auto switch**
(`enableAutoControl`, false par defaut), puis redemarrer Homebridge.
Requiert cloud, capteur et marche/arret, mais pas Powerful, consigne ou
ventilation. Ajoute **Nom du poele Auto**, service Switch sous-type `auto`,
au poele existant sans changer son UUID ni dupliquer ses services.

Il represente Auto Nobis, qui regule puissance et ventilation, pas le
mode AUTO chauffage/refroidissement de HomeKit. ON n'allume pas le poele
et OFF ne l'eteint pas. Les niveaux demandes conserves ne sont pas des
sorties effectives. La ventilation manuelle reste refusee avec Auto ON.

La commande Auto ON etait confirmee dans Nobis-Fi ; le 12 octobre 2026
l'utilisateur confirme aussi avoir envoye Auto OFF depuis le diagnostic
et l'avoir constate dans Nobis-Fi. Aucune heure ou relecture numerique
non consultee n'est attribuee a cette confirmation.
Powerful dans Maison est egalement declare verifie par l'utilisateur.
Le 12 octobre 2026, l'utilisateur confirme la validation Auto dans Maison
apres installation. Aucun delai precis, phase ou effet thermique
supplementaire n'est deduit de ce retour.

Memes protections que Powerful : appareil en ligne, profil strict
33128/65535 et libelles OFF/ON, phase OFF/TRAVAIL/ECO STOP et Powerful OFF.
L'autre mode n'est jamais desactive implicitement ; si Powerful est ON,
le SET Auto est refuse. Relecture immediate puis polling sans etat
optimiste, aucun retry, activation du poele ou restauration automatique.

Marqueur prive synchronise `auto-pending-<UUID>` contenant 0/1 avant
l'unique POST. Toutes les commandes sont bloquees jusqu'a relecture
du mode cible exact, y compris Powerful et meme si Auto est desactive
apres redemarrage. Aucun rejeu. Corruption ou echec de stockage bloque
l'envoi ; la temperature ambiante n'est pas remplacee par une fausse valeur.
Desactiver l'option retire uniquement le service Auto.
Si Maison signale une erreur apres un envoi, verifier Nobis-Fi et attendre
le rafraichissement ; ne pas repeter. Utilisation supervisee uniquement.

### Bouton Powerful dans Maison (beta.16)

Dans Plugin Settings GUI, activer **Enable experimental Powerful switch**
(`enablePowerfulControl`, false par defaut), puis redemarrer Homebridge.
Cloud, capteur et interrupteur marche/arret doivent etre actives ;
consigne et ventilation ne sont pas des prerequis. Aucun fichier de
configuration a modifier manuellement.

Ajoute un service Switch **Nom du poele Powerful**, sous-type `powerful`,
au meme accessoire et au meme UUID, sans nouveau poele ni doublon.
Il indique le mode `fun_pwf_set` relu : ON ne signifie pas que le poele
est allume et OFF ne l'eteint pas. La presentation regroupee ou separee
des services depend d'Apple Maison ; son affichage reste a confirmer.
Un registre invalide, CRONO ou une erreur ne sont jamais convertis en OFF.

ON et OFF ont ete confirmes dans Nobis-Fi et par relecture API le
12 octobre 2026. Les effets thermiques et la fraicheur restent inconnus.
Avant chaque changement : appareil en ligne, carte exacte, phase OFF/TRAVAIL/ECO STOP
et Auto OFF requis par precaution. Le plugin ne commande ni Auto ni
marche/arret, mais Powerful peut agir sur puissance et ventilation par
son propre fonctionnement. Aucun retry ni restauration automatique.

L'ecriture unique est precedee d'un marqueur prive synchronise
`powerful-pending-<UUID>` contenant 0 ou 1 (permissions 0600).
Il bloque tous les controles et survit au redemarrage, meme avec
Powerful desactive. Seule une relecture du mode cible OFF/ON exact
permet de l'effacer ; aucune commande n'est rejouee.
Le setter effectue une relecture immediate, sans attente ajoutee ;
si elle est encore ancienne apres un job reussi, Maison conserve la derniere
valeur lue. Au plus trois relectures rapides puis le polling normal
confirment la cible et liberent les ecritures. Ne pas repeter la commande.
En cas de corruption ou d'echec de stockage, aucun POST n'est envoye.
Le capteur ambiant reste utilisable si seule cette lecture de mode echoue.

Utilisation supervisee uniquement, sans automatisation non surveillee.
Desactiver l'option retire seulement ce service, pas le poele ni son UUID.

### Tuile Chauffage et consigne (beta.3)

Activer **Enable experimental heating tile and temperature setpoint**
(`enableSetpointControl`, false par defaut), avec les options cloud,
capteur et interrupteur deja actives. Redemarrer Homebridge.
Maison expose un service **Thermostat** nomme
**Nom du poele Chauffage**, en plus de l'interrupteur.
Maison peut regrouper les services dans la meme fiche : aucun nouvel
identifiant de poele ni appairage n'est necessaire.

Beta.2 utilisait HeaterCooler, mais Maison masque/grise son curseur
quand le service est inactif selon le test utilisateur. Beta.3 remplace
uniquement ce service par Thermostat pour tester l'acces a la consigne
en OFF. Le 10 octobre 2026, l'utilisateur confirme que le curseur reste
grise : cette variante ne resout pas la limitation sur son installation.
Pour modifier la consigne poele eteint, utiliser Nobis-Fi pour le moment.
Ne pas choisir HEAT pour debloquer le curseur : ce mode commande
reellement l'allumage, il n'est pas un simple reglage d'affichage.
La migration retire l'ancien HeaterCooler et conserve UUID, capteur,
interrupteur et verrous ; ne pas supprimer/reappairer l'accessoire.
Les seuls modes proposes sont OFF et HEAT, pas AUTO.
Aucun refroidissement,
ventilation, puissance, calendrier ni mode MAN n'est simule.
En OFF, TargetHeatingCoolingState et CurrentHeatingCoolingState sont OFF.
En TRAVAIL, ils sont HEAT :
c'est la projection de la phase operationnelle comparee, pas une mesure
de flamme ou un calcul depuis temperature/consigne.
Depuis beta.5, ECO STOP (code 8 et libelle exact) conserve le mode cible
HEAT, mais CurrentHeatingCoolingState est OFF : chauffage en pause,
pas poele desactive. L'interrupteur reste ON. Le rendu exact de cette
combinaison dans Maison reste a confirmer sur l'installation.
Depuis beta.6, OFF est autorise depuis ECO STOP via l'interrupteur ou le
mode OFF du Thermostat : l'utilisateur a deja constate une extinction
reelle depuis cette phase dans Nobis-Fi. Le plugin reverifie la phase
et utilise la meme commande OFF (232, masque 255, valeur 170), une fois,
sans retry. Sa confirmation exige toujours OFF (0), pas le job termine
ni ECO STOP/ARRET. La commande depuis Maison dans cette phase reste a
tester ; ne pas eteindre uniquement pour valider ce lot.
Les changements de consigne depuis ECO STOP restent refuses avant requete
par les tuiles. Aucun nouvel ON depuis ECO STOP ni reprise automatique
n'est commande par le plugin.
Une commande deja incertaine reste prioritaire et bloque les ecritures,
sans invalider les autres lectures valides. Depuis beta.22, un verrou ON
est confirme par TRAVAIL **ou ECO STOP** : dans les deux cas le poele est
active et peut reprendre, meme si ECO STOP n'est pas une chauffe effective.
OFF exige toujours une phase OFF relue.
Demarrage/arret connus conservent les dernieres observations confirmees,
jamais un nouvel etat HEAT suppose. Sans observation stable depuis le
lancement, ou pour un code inconnu, l'etat reste indisponible.
Le service n'ajoute pas de StatusFault non
standard : les caracteristiques concernees renvoient l'erreur HAP.

TargetTemperature va de 7 a 40 degres Celsius avec un pas de 1.
Le poele reste OFF lorsqu'une consigne est modifiee a l'arret :
aucune commande d'allumage n'est associee au seuil.
L'ecriture exige une phase stable OFF/TRAVAIL et une consigne initiale
numerique relue. MAN (41) rend le controle indisponible, sans afficher
41 degres ni convertir le mode en temperature. Revenir a une consigne
numerique via Nobis-Fi si souhaite, pas automatiquement par le plugin.
La temperature ambiante continue a etre lue sans requete HomeKit.

Chaque changement reverifie l'appareil, la carte et le buffer puis
envoie au plus une commande. Une relecture est effectuee immediatement ;
la confirmation ulterieure utilise trois relectures rapides au maximum
puis le polling normal. Les commandes
identiques a la valeur relue ne sont pas envoyees.
Apres un job reussi, tant que la cible n'est pas relue, Maison conserve
la derniere consigne confirmee ; temperature ambiante et autres lectures
valides restent accessibles. **Ne pas repeter** : aucun retry d'ecriture
ni restauration automatiques. Les erreurs reelles restent explicites.
Toutes les ecritures des deux tuiles sont bloquees pendant une commande
incertaine. Le fichier prive `setpoint-pending-<UUID>` conserve uniquement
la cible numerique, en 0600, synchronisee avant envoi ; il survit au
redemarrage et n'est jamais rejoue. Il est retire apres concordance
API uniquement. Si la cible n'est jamais relue, verifier Nobis-Fi et
demander un diagnostic, pas supprimer le fichier pour forcer un essai.
Desactiver la tuile ne supprime pas un verrou existant.

Les activations ON/OFF de la tuile Chauffage utilisent exactement les
memes restrictions et commandes que l'interrupteur. La beta.1 n'est pas
modifiee par l'installation du code local ; publier/installer beta.3
explicitement pour tester cette nouvelle tuile. Usage supervise uniquement.

### HeaterCooler avec ventilation integree (beta.8, experimental)

Dans les reglages GUI, activer **Enable experimental HeaterCooler with
front ventilation** (`enableVentilationControl`), en conservant les
options cloud, capteur, marche/arret et consigne actives. Redemarrer
Homebridge apres installation de beta.8.

Cette option remplace uniquement le Thermostat par un **HeaterCooler**
chauffage seul, sur le meme accessoire : UUID, capteur et interrupteur
conserves, sans reappairage. Sans cette option, le Thermostat reste
inchange. Le 11 octobre 2026, l'utilisateur confirme la presence du
curseur ventilation dans Apple Maison, mais le constate grise poele
eteint. Sa disponibilite poele actif et une commande depuis Maison
restent a confirmer ; la cause exacte du grisage n'est pas etablie.

**Active commande le poele, pas uniquement son ventilateur.**
Il n'y a aucun service Fanv2 ni bouton d'activation independant du
ventilateur. OFF correspond a INACTIVE ; TRAVAIL a ACTIVE/HEATING ;
ECO STOP a ACTIVE/IDLE, sans deduire une combustion mesuree.
Le curseur consigne peut toujours rester grise poele eteint :
cette variante ne pretend pas corriger cette limitation de Maison.

RotationSpeed represente la **consigne** de ventilation avant, jamais
un debit ou une vitesse mesuree :

| Niveau Nobis | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| Pourcentage HomeKit | 14 | 29 | 43 | 57 | 71 | 86 | 100 |

Les pourcentages positifs intermediaires sont convertis au niveau le
plus proche (`max(1, round(pourcentage * 7 / 100))`). La reponse locale HAP
conserve la derniere valeur observee ; apres confirmation API, la tuile
affiche le pourcentage normalise : 60 demande le
niveau 4, puis affiche 57, pas une vitesse inventee de 60 %.
OFF (0) avec son libelle exact est lu comme une consigne de ventilation
nulle, pas comme une mesure de debit. Aucune commande OFF n'est ajoutee.
PS (8) et les libelles inconnus restent indisponibles ; PS n'est jamais
converti en 100 %.

L'ecriture est limitee aux phases OFF/TRAVAIL, ventilation initiale
1..7, Auto et Powerful OFF. ECO STOP, transitions et modes automatiques
refusent cette commande. Il s'agit de precautions experimentales,
pas de restrictions fabricant prouvees. Le premier essai physique
valide est uniquement **4 vers 6**, puis restauration manuelle a 4.
Les autres niveaux et le pilotage effectif depuis Maison restent a tester.

Chaque changement reverifie l'appareil, la carte et les reglages,
envoie au plus un POST (33132, masque 65535) puis relit.
Aucun allumage, retry ou retour automatique au niveau precedent.
Un job reussi sans niveau cible relu conserve les dernieres valeurs
observees ; seules les ecritures restent verrouillees jusqu'a relecture.
Le marqueur prive `ventilation-pending-<UUID>` (0600) est synchronise
avant envoi, survit au redemarrage et bloque toutes les commandes
marche/arret, consigne et ventilation jusqu'a concordance API.
Desactiver l'option ne supprime pas ce verrou et ne rejoue rien.
Une carte ventilation incompatible rend son curseur indisponible,
sans invalider les temperatures et l'etat du poele encore valides.
Usage supervise uniquement ; ne pas allumer pour tester l'affichage.

### Commander depuis Chauffage et afficher En chauffe (beta.21)

L'option **Use heating tile for ON/OFF and switch as En chauffe indicator**
est desactivee par defaut et exige la tuile Chauffage et ses prerequis.
Avant de l'activer, revoir les automatisations du Switch Marche/Arret :
son identifiant est conserve, mais sa signification change.

- La tuile temperature/consigne conserve les commandes reelles :
  **Chauffer** depuis OFF allume le poele ; **Eteint** depuis TRAVAIL ou
  ECO STOP l'arrete. En ECO STOP, le mode reste Chauffer puisqu'une reprise
  est possible. Ce n'est pas une commande de ventilateur independant.
- L'ancien Switch Marche/Arret devient **En chauffe** : actif uniquement
  pour TRAVAIL confirme par l'API ; inactif pour OFF, ECO STOP, DEBUT et ARRET.
  « Inactif » signifie absence de TRAVAIL confirme, pas absence de flamme
  au demarrage ou de chaleur residuelle. Erreurs/codes inconnus restent
  indisponibles. Les lectures restent possibles pendant un verrou.
- Cet indicateur utilise une tuile Switch : Maison peut afficher Allume/
  Eteint et le rendre cliquable. Les clics sont explicitement refuses,
  ne modifient pas la valeur lue et n'envoient aucune commande.
- Meme accessoire/UUID et subtype power, aucune nouvelle tuile. Maison peut
  conserver le nom personnalise : renommer l'ancienne tuile « En chauffe »
  dans Maison si necessaire. Le nom du poele reste inchange.

Activer l'option dans les reglages Homebridge, enregistrer et redemarrer
le pont suffit ; ne pas supprimer/reappairer le pont. La desactiver
restaure le controle Marche/Arret precedent. Tous les verrous et gardes
API restent applicables aux commandes Chauffage. Les refus sont journalises.
MAN rend la consigne non numerique, mais ne bloque plus a lui seul ON/OFF.
Le rendu actif/inactif sur l'installation Apple Maison reste a confirmer.

### Abandon explicite d'une commande en attente (beta.20)

Si un ancien verrou bloque les controles alors que tu souhaites conserver
les reglages courants, il n'est plus necessaire de modifier la ventilation
ou une autre consigne pour faire correspondre l'ancienne cible.

1. Arreter le poele avec Nobis-Fi ou la telecommande et verifier son arret.
2. Dans les reglages du plugin Homebridge, cocher **Confirm one-time
   abandonment of ALL pending commands**, enregistrer et redemarrer le
   pont Nobis. Cloud, lecture de temperature et marche/arret doivent rester
   actives ; selectionner le bon poele si le compte en contient plusieurs.
3. Attendre le journal **Pending-command abandonment complete**.
   Le plugin exige un retour API OFF, une temperature, un profil d'etat,
   une consigne et les quatre reglages valides avant d'abandonner les
   cibles marche/arret, consigne, ventilation, Auto et Powerful, meme si
   un de ces controles est desactive. Aucun ordre n'est envoye au poele.
4. Decocher la confirmation, enregistrer et redemarrer le pont.

La confirmation est consommee une seule fois, meme sans cible en attente,
et conservee dans le stockage prive Homebridge en 0600
(`abandon-confirmation-pending-<UUID>`). La laisser cochee ne supprime
pas les futurs verrous, meme apres redemarrage. Pour une autre operation,
il faut d'abord effectuer l'etape 4, puis confirmer de nouveau.
Les copies en cache sont retirees avec les marqueurs, sans changer l'UUID.

**Ce n'est pas une annulation de commande cloud.** Un ordre deja transmis
peut encore s'executer plus tard ; la fraicheur des lectures reste inconnue.
Garder un usage supervise, sans automatisation non surveillee.
Une lecture invalide, une phase autre que OFF ou un stockage corrompu
ne permettent pas cet abandon. En cas d'echec partiel apres consommation,
les cibles restantes restent verrouillees ; aucune suppression n'est
rejouee automatiquement. Consulter les logs avant toute nouvelle confirmation.
Ne pas effacer manuellement le stockage pour contourner une incertitude.

### Temperature ambiante, consigne et effets de Powerful

Depuis beta.19, la tuile Ambiante separee est retiree automatiquement
quand Chauffage est active : sa temperature actuelle affiche deja cette
mesure. Sans Chauffage, la tuile Ambiante reste presente. La lecture cloud,
les dependances des options et l'UUID du poele restent inchanges.
Conserver l'option de lecture de temperature activee ; aucune nouvelle
option ni suppression/reappairage du pont ne sont necessaires.

Les refus des boutons Marche, Auto et Powerful avant appel cloud sont
journalises : verrou en attente (nom du marqueur), valeur indisponible
ou phase/mode non autorise. OFF depuis ECO STOP reste autorise pour
Marche, sauf verrou en attente ; Auto/Powerful autorisent
OFF/TRAVAIL/ECO STOP depuis beta.25. Ne pas effacer un marqueur pour contourner un resultat
incertain ; utiliser Nobis-Fi/la telecommande pour un arret necessaire.

Le capteur **Ambiante** et la temperature actuelle du chauffage utilisent
`temp_air2_get` (103). La consigne du chauffage utilise `temp_air_set`
(33122), comme TargetTemperature (Thermostat) ou HeatingThresholdTemperature
(HeaterCooler). Ce sont deux valeurs distinctes, pas deux noms pour une
meme mesure. Maison decide de leur disposition et n'affiche pas toujours
les deux sur la vignette ; ouvrir le detail du chauffage. Le plugin ne
cree pas de faux capteur de temperature mesuree pour la consigne.

Puissance et ventilation ont egalement des registres distincts :

| Donnee | Consigne demandee | Lecture de fonctionnement |
| --- | --- | --- |
| Puissance | `power_set`, 33120 | `real_power_get`, 11 |
| Ventilation frontale | `vent_front_set`, 33132 | `vent_front2_get`, 16 |

Les codes des lectures de fonctionnement ne sont pas ceux des consignes :
notamment ventilation 16 = 0/OFF, 1/RIS, 2..8/niveaux 1..7.
Ce ne sont pas des mesures en watts ou de debit d'air.
Powerful envoie **uniquement le mode 33154**, jamais des commandes
supplementaires puissance 7 et ventilation 7. Pendant l'essai ON valide,
les consignes demandees sont restees 5/4. Le 12 octobre 2026, l'utilisateur
confirme sur son A8 que l'activation de Powerful agit sur la puissance et
la ventilation effectives sans modifier les valeurs demandees.
Il s'agit d'une confirmation utilisateur : les codes de fonctionnement
11/16, leurs valeurs exactes et des mesures en watts/debit n'ont pas ete
fournis pour cet essai. Aucun comportement supplementaire a l'arret du
mode ou sur un autre modele n'est deduit. Le plugin ne doit pas modifier
les consignes pour reproduire l'effet de Powerful.

### Puissance, ventilation, Auto et Powerful (diagnostic beta.4)

Le diagnostic navigateur propose **Comparer puissance, ventilation, Auto
et Powerful (lecture seule)**. Une session verifie la carte puis lit une
seule fois le buffer 1 ; aucune ecriture ni commande ON/OFF.
Il affiche les entiers des consignes power_set (33120), vent_front_set
(33132), fun_auto_set (33128) et fun_pwf_set (33154), avec leurs libelles
FRE de la carte et l'heure de reception, pas de mesure.

L'utilisateur a compare une premiere lecture a Nobis-Fi : puissance 5,
ventilation avant 4, Auto OFF, Powerful OFF. Les autres valeurs et toutes
les commandes restent a valider, sauf le premier essai de ventilation
4 vers 6 confirme ci-dessous. La ventilation reglee n'est pas sa vitesse
effective ; aucune conversion en pourcentage ou watts. PS (8) n'est pas
assimile a une vitesse normale. CRONO (2) de fun_pwf_set est hors des
bornes annoncees : le diagnostic refuse cette valeur, sans convertir en ON.
Un profil absent/incompatible ou une valeur invalide est un echec explicite.
Ce lot n'ajoute aucun nouveau controle dans Maison.

Apres mise a jour du code, relancer le diagnostic navigateur local pour
charger le nouveau mode ; un processus deja lance conserve l'ancien code.
Les valeurs sont en memoire uniquement et peuvent etre effacees via le
bouton dedie. Ne pas changer un reglage uniquement pour cette lecture.

### Confirmation differee des reglages (beta.11)

Les essais locaux Auto, puissance et ventilation ne s'arretent plus
sur la premiere ancienne valeur : apres **une seule ecriture**, ils
effectuent au maximum trois relectures, espacees de cinq secondes
apres reception d'une valeur differente. Arret des la concordance,
sur erreur, annulation ou expiration de la session (deux minutes).
Chaque job reste borne a 30 secondes. Aucun retry d'ecriture.

Le resultat affiche les valeurs et receptions de chaque relecture,
sans les assimiler a des heures de mesure. Trois valeurs differentes
laissent la confirmation non acquise ; verifier Nobis-Fi, ne pas renvoyer.
Cette cadence est une precaution bornee, pas une limite API connue
ni une garantie de propagation en dix secondes.

La consigne reutilise le meme mecanisme en conservant son resultat.
Marche/arret garde une seule relecture immediate : un allumage ou une
extinction peut durer beaucoup plus longtemps. Dans Homebridge,
confirmation et verrous restent traites par le polling habituel,
sans ajouter d'attente au setter HomeKit ni supprimer un verrou.

### Configuration coherente des options (beta.12)

Le schema GUI exprime les memes dependances que le plugin : connexion
cloud pour le capteur, cloud et capteur pour marche/arret, puis marche/
arret pour la consigne, Auto et Powerful, et consigne pour la ventilation integree.
Activer dans cet ordre ; pour desactiver le cloud, desactiver d'abord
les controles et le capteur. Aucune option n'est activee automatiquement.

Les dependances sont validees dans le schema avec validation stricte,
en plus des gardes au demarrage. Depuis beta.17, le test compare les 2187
combinaisons possibles (option absente, false, true) au parseur runtime.
Le rendu des erreurs sur la version du GUI installee reste a verifier ;
aucune modification manuelle du fichier de configuration n'est requise.
Les descriptions precisent que les curseurs Maison peuvent rester
grises en OFF et qu'Active/HEAT commande reellement le poele.

### Essai manuel du mode Auto (beta.10, hors HomeKit)

Mode **Test manuel du mode Auto reel ON/OFF**. Premier envoi ON confirme
dans Nobis-Fi par l'utilisateur le 11 octobre 2026 ; relecture immediate
encore OFF. Le retour initial etait effectue manuellement dans Nobis-Fi.
Le 12 octobre, l'utilisateur confirme ensuite un envoi Auto OFF depuis
le diagnostic avec verification OFF dans Nobis-Fi ; son resultat detaille
n'a pas ete consulte, aucune relecture ni heure n'est inventee.
Le cycle realise dans Nobis-Fi a confirme
`fun_auto_set` (33128) OFF/ON/OFF = 0/1/0. Auto gere puissance et
ventilation : ce n'est pas le mode AUTO de HeaterCooler.

Le test exige un choix explicite ON/OFF, confirmation par clic, carte
exacte (33128, masque 65535, domaine 0..1, libelles FRE OFF/ON),
cible differente, phase OFF/TRAVAIL/ECO STOP et Powerful OFF. Ces restrictions
de phase/interactions sont des precautions experimentales, pas des
interdictions fabricant prouvees. Transitions et phases inconnues refusees.
Relever les quatre reglages avant tout essai ; ne pas modifier la phase
uniquement pour ce test.

Une seule commande Auto, puis une lecture des quatre reglages.
Aucun ON/OFF du poele, changement explicite de puissance/ventilation,
retry ni restauration automatique. Auto peut cependant agir sur ces
grandeurs par le fonctionnement propre du poele. Job termine ou
relecture concordante ne prouvent ni fraicheur ni effet thermique.
Verifier Nobis-Fi et remettre manuellement les reglages souhaites ;
ne pas repeter une commande apres une erreur ou relecture differente.
Auto dispose depuis beta.17 d'un interrupteur Maison optionnel. Powerful
dispose d'un essai local protege et, depuis beta.16, d'un interrupteur Maison.

### Essai protege Powerful ON/OFF (beta.15)

Mode **Test manuel du mode Powerful reel ON/OFF** dans le diagnostic local.
Choisir explicitement ON ou OFF et confirmer le changement reel apres avoir
note les quatre reglages dans Nobis-Fi. Une confirmation Auto ne peut pas
autoriser Powerful et le choix est efface au changement de mode.

Candidat derive de la carte observee : `fun_pwf_set`, 33154/65535,
mot non signe little-endian, formules `#`, bornes 0..1, pas 1, libelles FRE
OFF/ON exacts. La valeur 2 CRONO reste exclue. Refus avant ecriture si
profil different, cible identique, Auto actif ou phase autre que OFF/TRAVAIL/ECO STOP.
Ces conditions sont des precautions experimentales, pas des limitations
Nobis documentees.

Une seule ecriture, aucun allumage, changement d'Auto ou restauration
envoyes par le diagnostic. Powerful peut lui-meme modifier puissance,
ventilation et Auto : son fonctionnement rapporte par l'utilisateur
ne constitue pas une interaction API validee. Au plus trois relectures
des quatre reglages, espacees de cinq secondes en cas de difference.
Un job termine ou une relecture concordante ne prouve pas l'effet physique.
En cas d'erreur, ne pas renvoyer automatiquement : verifier Nobis-Fi.

Premier essai ON le 12 octobre 2026 : premiere relecture encore OFF a
07:37:23 locale, deuxieme ON a 07:37:29, puis confirmation ON dans
Nobis-Fi par l'utilisateur. Auto relu OFF, puissance demandee 5 et
ventilation demandee 4 : ces niveaux ne prouvent pas les sorties effectives.
Le retour OFF est relu a la deuxieme observation le meme jour a 07:40:13
locale et confirme dans Nobis-Fi par l'utilisateur. Auto reste OFF,
niveaux demandes puissance 5 et ventilation 4 inchanges.
L'utilisateur confirme ensuite que Powerful agit sur les valeurs effectives
sans modifier les valeurs demandees ; aucun code effectif chiffre n'est
attribue a cette confirmation. L'interaction avec Auto actif reste a valider ;
Auto actif est donc refuse avant ecriture. Le bouton Maison beta.16
s'appuie uniquement sur le mode relu, jamais sur l'accuse du job.

### Essai manuel de puissance de chauffe (beta.9, hors HomeKit)

Le diagnostic navigateur propose **Test manuel de puissance de chauffe
reelle 1..7**. Il s'agit du niveau `power_set` (33120), pas de watts,
de puissance effective ni d'une commande marche/arret.
La carte et la lecture initiale 5 ont ete comparees a Nobis-Fi.
Le 11 octobre 2026, l'utilisateur confirme dans Nobis-Fi le succes
du premier changement demande de 5 vers 3. La relecture immediate du
diagnostic reste a 5 : concordance API ulterieure non encore observee,
delai de mise a jour inconnu. Aucun effet thermique mesure ni validation
generale des sept niveaux. L'utilisateur confirme ensuite la restauration
manuelle du niveau initial 5 dans Nobis-Fi, sans nouvelle relecture API.

Noter le niveau initial dans Nobis-Fi et choisir un niveau different
1..7, puis confirmer explicitement. L'essai exige un profil de carte
exact, une phase OFF/TRAVAIL et Auto/Powerful OFF ; ces precautions
ne prouvent pas une restriction fabricant. ECO STOP, transitions,
valeurs speciales et cible identique sont refuses avant envoi.
Ne pas changer la phase ou desactiver un mode uniquement pour ce test.

Un seul POST 33120/masque 65535, puis une lecture des quatre reglages.
Aucun allumage, retry, changement d'autre reglage ni restauration
automatique. Une concordance API ne prouve ni fraicheur ni effet
physique. Verifier Nobis-Fi, puis restaurer manuellement le niveau
initial ; en cas d'erreur ou de valeur differente, ne pas renvoyer.
Le mot de passe est efface de la page apres envoi et n'est pas persiste.
Ce lot n'ajoute aucun controle de puissance dans Maison.

### Essai manuel de ventilation avant (beta.7, hors HomeKit)

Le diagnostic navigateur propose un test de ventilation reelle, separe
des lectures et des commandes ON/OFF. Sur confirmation et clic explicites,
il reverifie appareil en ligne, carte, phase et quatre reglages, puis envoie
au plus une commande au registre vent_front_set (33132), masque 65535,
valeur entiere 1..7. Le profil little-endian/mot non signe et les libelles
OFF/PS doivent correspondre a la carte observee.
Le 11 octobre 2026, un premier essai 4 vers 6 est confirme : relecture API
a 6, affichage Nobis-Fi a 6 et changement physique constate par l'utilisateur.
Il confirme ensuite avoir restaure manuellement 4 dans Nobis-Fi.
Cela ne valide pas tous les niveaux, OFF/PS, les autres phases ou modeles ;
ni une vitesse mesuree ou un delai garanti. Aucun controle HomeKit ajoute.

Precautions de cet essai : phase OFF ou TRAVAIL, Auto et Powerful OFF,
ventilation initiale 1..7 et cible differente. ECO STOP, phases inconnues,
OFF (niveau 0) et PS (niveau 8) sont exclus ; ces limites ne constituent
pas des restrictions du fabricant demontrees.
Ne pas allumer le poele ni changer son mode uniquement pour ce test.
Relever et verifier le niveau initial dans Nobis-Fi avant confirmation,
puis le restaurer manuellement apres l'essai si necessaire.

Une seule relecture suit le job ; concordance de consigne ne prouve pas
une vitesse effective ou une fraicheur de mesure. Aucun retry d'ecriture
sur 401, timeout, reseau ou Nack, aucune restauration automatique.
Erreur ou valeur inchangee : verifier Nobis-Fi, ne pas renvoyer la commande.
Les autres reglages ne sont pas ecrits. Aucun service ventilation HomeKit,
controle Auto/Powerful ou commande de puissance n'est ajoute.
Relancer le diagnostic local apres mise a jour pour charger ce mode.

### Diagnostics du capteur

Avec **Safe diagnostic logging** (`diagnostic`) active et le capteur
de temperature active, les changements des codes `status_get` et
`status_managed_get` sont aussi journalises au niveau debug depuis la
meme lecture de buffer. Activer le mode debug de Homebridge pour les voir.
Il n'y a aucune requete supplementaire. Les messages ne contiennent
ni identifiants d'appareil ni libelles libres de la carte ; ils indiquent
seulement les deux codes numeriques et la presence ou l'absence d'un
libelle FRE, ainsi que la phase observee lorsque la paire code/libelle
correspond exactement au profil compare. Un profil d'etat incompatible est signale sans invalider
une temperature ambiante correctement decodee. Les messages identiques
ne sont pas repetes a chaque cycle. Une erreur de communication efface
cette comparaison ; la prochaine lecture valide est de nouveau signalee.
La fraicheur reste inconnue et aucun etat de chauffage HomeKit n'est deduit.

Le service **TemperatureSensor** est retenu plutot que HeaterCooler ou
Thermostat : seule la temperature ambiante est suffisamment etayee.
Le capteur n'expose ni Active, ni etat de chauffage, ni consigne modifiable.
L'interrupteur optionnel est un service separe, pas une modification
du service TemperatureSensor.
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
La compatibilite complete et les autres scenarios de panne restent a
valider dans une instance Homebridge de developpement.

Premier retour utilisateur : la beta installee sur Homebridge en conteneur
sur NAS remonte 21 degres dans Maison, comme la telecommande (10 octobre
2026). L'utilisateur a aussi confirme le fonctionnement apres redemarrage
et une temperature evolutive. Un job `terminated` a provoque un defaut
temporaire dans Maison, suivi d'un cycle reussi 121 secondes plus tard et
de l'affichage de la nouvelle temperature. Il n'est pas etabli que la
reouverture de Maison soit necessaire : le plugin actualise independamment
des GET HomeKit. Ces observations ne certifient pas la fraicheur, tous les
scenarios de reconnexion ou la compatibilite de tous les appareils.

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

### Observation des codes d'etat en lecture seule

Le mode **Observer les codes d'etat (aucune commande)** verifie la carte
et lit une seule fois le buffer 1. Il affiche les entiers bruts aux adresses
8 (`status_get`) et 232 (`status_managed_get`) et leur libelle FRE exact,
si la carte en fournit un. Aucun masque n'est corrige, aucune formule
n'est executee et aucun etat HomeKit n'est deduit. Une valeur sans libelle
reste **INCONNU**, notamment 0 pour le registre gere sur la carte observee.
Une definition incompatible ou une valeur absente/invalide fait echouer la
lecture. La reception n'atteste pas la fraicheur.
Les paires effectivement comparees sur l'A8 V Round sont maintenant :
0 / OFF (eteint), 2 / DEBUT (demarrage), 5 / TRAVAIL et 7 / ARRET
(arret en cours, pas deja eteint). Le decodeur exige les libelles FRE
exacts de la carte, accents compris pour DEBUT et ARRET. Un code non
compare reste non valide sur appareil ; un libelle different ou absent
donne une phase inconnue. Les codes 3/4, veille, nettoyage et alarmes ne
sont pas assimiles a une de ces quatre phases. Ces observations cloud
ne donnent toujours pas une valeur Active ni un etat de chauffage HomeKit.
Comparez avec l'affichage actuel Nobis-Fi ou telecommande sans changer
le fonctionnement du poele pour le diagnostic. Les resultats sont effaces
a chaque tentative, erreur, rechargement ou clic dedie.

### Test manuel experimental marche/arret

Le mode **Test manuel marche/arret reel** n'est disponible que dans le
diagnostic local, pas dans Homebridge. Il utilise un masque candidat 255
issu de la carte reelle et du chemin d'ecriture py-agua-iot, pas le 65535
fixe de micronova2mqtt. Ce candidat reste non valide sur appareil.
Choisir explicitement la commande, verifier l'etat physique et les
conditions d'utilisation du fabricant, puis cocher la confirmation.
L'allumage exige une phase cloud OFF ; l'arret exige TRAVAIL.
Les phases transitoires/inconnues ou une carte incompatible bloquent
l'ecriture. Le cloud pouvant etre ancien, ce garde-fou ne remplace
pas la verification physique de l'utilisateur.

Le test lit avant, envoie une seule ecriture et lit une seule fois apres.
Aucun nouvel envoi sur 401, erreur reseau, timeout, refus ou relecture
identique ; aucun essai d'un autre masque ni commande inverse.
Un job completed ne prouve pas l'effet physique et une erreur apres
envoi laisse le resultat indetermine. Verifier la telecommande et Nobis-Fi
avant toute autre action ; utiliser ces interfaces pour une correction.
Les clients ordinaires gardent cette capacite desactivee. Confirmation
et mot de passe sont effaces a chaque lancement ; resultats en memoire
seulement, effaces a chaque tentative ou clic dedie.

### Test manuel experimental de consigne

Le mode **Lire la consigne uniquement (aucune commande)** verifie la carte
et lit une seule fois le buffer 1, sans activer les ecritures, meme si
une cible est fournie dans la requete. Il affiche la consigne relue et
l'heure de reception, avec fraicheur inconnue. La valeur enumeree 41 est
affichee comme **mode MAN**, jamais comme 41 degres Celsius.
Ce mode permet une verification ulterieure sans renvoyer la commande.
La valeur est effacee a chaque tentative, erreur, rechargement ou clic dedie.

Le navigateur propose **Test manuel de consigne reelle** apres autorisation
de cette phase. Contrairement aux autres modes, il change la regulation.
Relever d'abord la consigne dans Nobis-Fi, choisir un entier de 7 a 40,
cocher la confirmation puis cliquer sur le bouton d'envoi unique.
Le serveur verifie la carte et lit la consigne initiale (adresse 33122)
avant l'ecriture, puis effectue une relecture du buffer 1.
Si la relecture differe, au plus deux lectures supplementaires sont
effectuees, espacees de cinq secondes, dans le budget global de deux minutes.
Le suivi s'arrete sur concordance, erreur ou limite. Seules les lectures
sont repetees, jamais l'ecriture. Une discordance persistante ne prouve
pas l'echec physique : la telecommande a deja confirme une commande alors
que le buffer renvoyait encore l'ancienne valeur.
Le resultat distingue une valeur relue conforme d'une valeur differente,
sans revendiquer une action physique ni une fraicheur garantie.
Verifier l'application et la telecommande puis restaurer manuellement
la consigne initiale, meme en cas d'erreur. Aucun ON/OFF, aucune
repetition ni restauration automatique. Une erreur apres envoi laisse
un resultat potentiellement indetermine ; ne pas renouveler aveuglement.

L'ecriture de consigne est desactivee par defaut dans le client/transport.
La route locale protegee du test l'active avec confirmation ; la tuile
HomeKit beta.2 l'active uniquement via enableSetpointControl. HTTP 401,
timeout ou panne reseau ne provoquent jamais une repetition d'ecriture.
Un NackErrCode present, meme 0, bloque le test sans lui inventer de semantique.
Les tests automatises utilisent exclusivement des mocks.
Ce mode est local et non publie ; la beta du NAS reste en lecture seule.

`previewSetpoint` prepare uniquement un corps de requete candidat hors ligne.
Il est aussi utilise par HomeKit beta.2 ; le mode experimental utilise ce validateur
avant l'envoi unique de sa commande.
Il exige notamment une formule inverse `#`, readonly false et les flags
d'encodage explicites : ces champs ont ete observes sur la carte reelle
de consigne le 10 octobre 2026. Aucun defaut n'est suppose en leur absence.
Les valeurs 7 a 40 sont admises pour ce profil ; 41 (MAN) et les valeurs
enumerees comme modes sont refusees. Le resultat indique toujours
`hardwareValidated: false`. Le transport habituel continue a refuser les ecritures.

- Version beta.1 avec interrupteur experimental sur activation explicite ;
  beta.2 ajoute la tuile Chauffage et la consigne, sans ventilation ni programmes.
- Aucun etat ou capteur HomeKit invente.
- Les formats de session et de jobs du Swagger et des clients tiers divergent.
- Seules les phases 0/2/5/7 et les premiers essais manuels ON/OFF et
  consigne sont etayes sur l'A8 cible ; les autres fonctions restent a valider.
- Aucun fallback local : l'integration prevue depend du service cloud.
- Le nom npm est provisoire ; disponibilite et absence de conflit a revalider.

CI configuree pour compiler, linter, tester et verifier le paquet sur les
quatre combinaisons Node 22/24 et Homebridge 1.11.4/2.4.0. Node 26 est a
ajouter lorsqu'il devient LTS et pris en charge par le plugin.
Les quatre combinaisons ont ete executees localement : 232 tests reussis
chacune. Les tests d'accessoires utilisent le vrai HAP fourni par chaque
version, notamment migration Thermostat/HeaterCooler, reponse normalisee de
ventilation, refus de commandes et identifiants stables.
La dependance Homebridge de developpement est desormais en version 2 ;
elle n'est pas embarquee comme dependance runtime du plugin.
Un test supplementaire fabrique une vraie archive npm, l'extrait dans un
repertoire temporaire sans sources ni node_modules et la charge avec le
gestionnaire de plugins Homebridge en resolution stricte. Il verifie
l'enregistrement de Nobis, les configurations absente, cloud desactive et
dependances invalides, ainsi que lancement repete et arret. Aucun appel cloud
ni fichier d'identite ne doit apparaitre. Ces quatre tests (parent et trois
cas) passent aussi sur chacune des quatre combinaisons ; ils sont inclus
dans `npm test`. Les archives et repertoires temporaires sont nettoyes.
Ce resultat ne constitue pas un essai de bridge appaire dans Maison ou de
GUI sous Homebridge 2, ni une certification Verified.

La validation du client et de la plateforme utilise exclusivement des mocks,
dont des tests d'expiration, erreurs, timeout du corps, budget de job,
reconnexion, Retry-After, concurrence, arret et persistance privee. Les tests
de plateforme et d'accessoires utilisent l'API de Homebridge, sans cloud reel.
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
ni une validation GUI Homebridge 2 ou materielle.

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

Apache-2.0. Voir [LICENSE](../LICENSE) et [NOTICE](../NOTICE).
L'etude cite aussi un ancien plugin AGPL ; son code n'est pas reutilise.
