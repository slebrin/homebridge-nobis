# homebridge-nobis

Plugin Homebridge pour les poeles Nobis-Fi, communiquant directement avec
le cloud Agua-IoT. Premier appareil teste : **Nobis A8 V Round**.
Pas de MQTT, Home Assistant, conteneur ou passerelle supplementaire requis.

**Version experimentale : `0.1.0-beta.28`. Ce plugin n'est pas Verified by
Homebridge.** Les retours sur un A8 ne garantissent pas la compatibilite
avec les autres modeles. Utiliser les commandes sous surveillance et suivre
les consignes du fabricant ; ne pas utiliser le plugin comme dispositif
de securite ou pour des automatismes critiques.

## Fonctions dans Apple Maison

| Fonction | Comportement |
| --- | --- |
| Temperature ambiante | Lecture cloud ; tuile separee seulement sans Chauffage |
| Marche/arret | Commande reelle du poele, avec etat confirme par lecture |
| Chauffage et consigne | Thermostat, ou HeaterCooler si ventilation activee ; consigne 7-40 C |
| Ventilation | Niveau demande 1-7, pas une mesure de debit |
| Auto / Powerful | Interrupteurs de modes, pas commandes de marche/arret |
| Programme / Chrono | Active/desactive les horaires existants, sans les editer |
| En chauffe | Option transformant le switch Marche en indicateur de TRAVAIL |
| Eco Stop | Capteur de contact optionnel en lecture seule |

L'utilisateur a confirme sur son A8 la temperature, les commandes
marche/arret et consigne, Auto, Powerful, Programme, l'affichage de
ventilation et les indicateurs En chauffe et Eco Stop. Cela ne valide pas
tous les niveaux de ventilation, toutes les phases ou l'execution des
horaires. Les preuves detaillees figurent dans l'[etude API](docs/ETUDE-API.md).

### Etats et limites

Les phases reconnues sont OFF, DEBUT, TRAVAIL, ARRET et ECO STOP. Le plugin
ne deduit jamais un etat de la seule commande envoyee.

- ECO STOP conserve l'activation : le poele peut reprendre. En chauffe
  indique uniquement TRAVAIL, pas la presence de flamme ou de chaleur residuelle.
- Le contact Eco Stop est **ouvert** uniquement en ECO STOP, **ferme**
  dans une autre phase reconnue. Ferme ne signifie pas poele eteint.
  Inconnu ou lecture en echec : indisponible, pas faussement ferme.
- Maison utilise ses propres libelles, regroupements et curseurs. Le
  curseur de consigne peut etre grise poele eteint ; ne pas allumer
  le poele uniquement pour le debloquer.
- La fraicheur des mesures cloud est inconnue : la reception d'une
  reponse n'est pas l'heure de mesure. Pas de mise a jour instantanee garantie.

| Commande | Phases actuellement autorisees |
| --- | --- |
| ON | OFF |
| OFF | TRAVAIL / ECO STOP |
| Consigne | OFF / TRAVAIL, consigne initiale numerique |
| Ventilation | OFF / TRAVAIL, Auto et Powerful OFF, niveau initial 1-7 |
| Auto | OFF / TRAVAIL / ECO STOP, Powerful OFF |
| Powerful | OFF / TRAVAIL / ECO STOP, Auto OFF |
| Programme | OFF / ECO STOP, sans condition Auto/Powerful |

Les autres phases et interactions restent refusees par precaution, pas
selon une interdiction constructeur demontree. En ECO STOP, Nobis-Fi
autorise Auto, Powerful et Programme d'apres le retour utilisateur ;
les ecritures du plugin dans cette phase restent a confirmer.
La ventilation OFF/0 est lisible si son encodage est reconnu, mais pas
modifiable ; PS n'est pas converti en vitesse. MAN/41 n'est pas une
temperature : la consigne numerique devient indisponible, sans interdire
a lui seul un ON/OFF autrement valide.

## Installation

Prerequis :

- Homebridge `^1.8.0` ou `^2.0.0` ; tests sur 1.11.4 et 2.4.0.
- Node.js `^22.10.0` ou `^24.0.0`, selon la version Homebridge installee.
- Compte Nobis-Fi et poele accessible dans l'application officielle.
- Acces Internet au cloud Nobis-Fi / Agua-IoT.

Verifier d'abord la version beta publiee ; la version du depot n'est pas
une preuve de publication npm :

```sh
npm view homebridge-nobis dist-tags --json
```

Dans l'interface Homebridge, installer la version beta si cette selection
est disponible. Sinon, utiliser le terminal de cette installation :

```sh
npm install --global homebridge-nobis@beta
```

Puis ouvrir **Plugins > Nobis > Reglages**, remplir la configuration,
enregistrer et redemarrer Homebridge. Aucun fichier de configuration a
modifier manuellement. Conserver le pont deja associe a Maison ; ne pas
le supprimer ou le reappairer pour une mise a jour.

## Configuration graphique

Toutes les options de communication et de controle sont **desactivees
par defaut**. Sans configuration valide, aucune communication cloud ne demarre.

1. Saisir l'e-mail et le mot de passe Nobis-Fi **uniquement dans la GUI locale**.
2. Activer **Enable read-only cloud discovery**, puis
   **Expose experimental read-only temperature sensor**.
3. Donner un nom au poele. Si plusieurs appareils sont lies au compte,
   selectionner son identifiant localement ; le plugin ne choisit pas au hasard.
4. Choisir l'intervalle : entier de **30 a 3600 secondes**, **60** par defaut.
   Ce sont des bornes du plugin, pas un quota Agua-IoT documente.
5. Activer uniquement les fonctions souhaitees, enregistrer et redemarrer.

| Option | Prerequis |
| --- | --- |
| Lecture de temperature | Cloud |
| Marche/arret | Cloud et temperature |
| Chauffage / consigne | Marche/arret et ses prerequis |
| Ventilation | Chauffage et ses prerequis |
| Auto, Powerful, Programme | Marche/arret et ses prerequis ; Chauffage non requis |
| En chauffe | Chauffage ; remplace la fonction du switch Marche existant |
| Eco Stop | Cloud et temperature ; aucune commande requise |

**Programme :** les jours et horaires se configurent dans Nobis-Fi.
Maison active ou desactive cette programmation. Verifier les horaires
existants avant activation : ils peuvent permettre des allumages/arrets.

**En chauffe :** revoir les automatisations de l'ancien switch avant de
changer son usage. Il devient un indicateur : ses clics sont refuses.
Desactiver l'option restaure sa commande Marche. Maison peut conserver
un nom personnalise ; le renommer si necessaire.

**Eco Stop :** activer **Enable read-only Eco Stop contact sensor**.
Il ajoute un seul ContactSensor au meme poele, sans switch supplementaire
ni nouvelle requete cloud. Desactiver l'option retire seulement ce service.
Son fonctionnement dans Maison a ete confirme le 3 novembre 2026.

## Commandes et confirmation

Maison recoit une reponse des la **prise en charge locale**, sans attendre
le cloud. Cette reponse ne garantit ni acceptation par Agua-IoT ni execution
par le poele. La tuile conserve le dernier etat observe et peut revenir
temporairement a cette valeur ; seule une lecture API confirme le changement.

Une seule commande peut etre traitee a la fois, sans file d'attente.
Un marqueur prive est synchronise avant le POST. Une cible en attente
bloque les autres ecritures, mais pas les lectures valides. Les marqueurs
survivent au redemarrage, meme si l'option de controle est desactivee.
Pas de retry d'ecriture, commande inverse ou restauration automatique.

Les relectures recherchent la cible, avec au plus trois rafraichissements
rapides espaces de cinq secondes, puis le polling normal. Un job cloud
termine n'est pas une confirmation physique ; ON est confirme par
TRAVAIL ou ECO STOP, OFF uniquement par OFF.

Les logs distinguent `accepted locally`, `processing finished` et
`processing failed`. Un echec apres la reponse locale **ne peut plus etre
renvoye au clic initial**. Consulter les logs et Nobis-Fi avant de reessayer.

## Depannage

### « Sans reponse »

Consulter les lignes `[Nobis]` du journal Homebridge :

- `deviceJobStatus ... terminated` : job indisponible. Le plugin marque
  les lectures en defaut puis reessaie avec temporisation progressive.
- `homekit-temperature-range` : mesure refusee, sans clamp ni substitution.
  Depuis beta.26, le polling reprend et une mesure valide restaure les services.
- `Automatic discovery stopped` : configuration, permissions, profil ou
  reponse API incompatible. Corriger la cause avant de redemarrer ; ne pas
  effacer les verrous pour contourner le probleme.
- `pendingPowerAction`, `pendingSetpoint`, `pendingVentilation`, `pendingAuto`,
  `pendingPowerful`, `pendingChrono` : resultat de commande encore incertain.
  Verifier Nobis-Fi et attendre la relecture.
- `write refused before cloud request` : phase, mode ou disponibilite non
  autorise ; aucune commande n'a ete envoyee.

Verifier aussi que Nobis-Fi communique avec le poele et que Homebridge est
accessible. Un poele hors ligne n'est jamais declare OFF. Une panne cloud
ne peut pas etre contournee par ce plugin : pas de solution locale integree.

### Abandon explicite des cibles en attente

Utiliser cette recuperation seulement pour conserver les reglages actuels
et abandonner toutes les anciennes cibles, pas comme commande d'arret :

1. Arreter le poele dans Nobis-Fi ou avec sa telecommande.
2. Dans la GUI, cocher **Confirm one-time abandonment of ALL pending commands**,
   enregistrer et redemarrer le pont. Cloud, temperature et Marche doivent
   rester actives pour le poele selectionne.
3. Attendre `Pending-command abandonment complete`. Le plugin exige une
   lecture valide OFF, temperature, consigne et reglages ; un verrou Chrono
   exige aussi une lecture Chrono valide. Le stockage corrompu n'est pas contourne.
4. Decocher la confirmation, enregistrer et redemarrer pour rearmer une
   future confirmation explicite.

La confirmation est consommee durablement une seule fois, meme sans cible.
La laisser cochee ne supprime pas les futurs verrous. Les six types de
cibles sont concernes, y compris les controles desactives. Un echec partiel
ne provoque pas de nouvelle suppression automatique.
**Aucun ordre n'est envoye et aucune commande deja distante n'est annulee** :
elle peut encore s'executer. Ne pas supprimer manuellement le stockage.

### Diagnostic et confidentialite

L'option diagnostic ajoute des durees, statuts et codes utiles, sans
mot de passe, jeton, cookie, identifiant d'appareil ou reponse brute.
Les etats receptionnes ne prouvent pas la fraicheur de la mesure.

Pour une investigation locale depuis les sources :

```sh
npm run build
npm run diagnostic:browser
```

L'adresse locale affichee ouvre un formulaire. Aucune connexion avant
une action explicite. Choisir les lectures pour diagnostiquer ; les
essais d'ecriture demandent une confirmation et commandent un vrai poele.
Arreter avec Ctrl+C.

Ne jamais publier de credentials, captures privees ou reponses brutes dans
une issue. Le champ masque ne chiffre pas la configuration Homebridge :
proteger son stockage et ses sauvegardes. Identite d'application et marqueurs
sont conserves dans le stockage prive Homebridge ; aucune telemetrie,
TLS non desactive et aucune transmission non necessaire ajoutee.

## Developpement et publication

Dynamic Platform TypeScript derivee du [template officiel Homebridge](https://github.com/homebridge/homebridge-plugin-template/tree/ab217b1ff36fbbf69931822324e1986113cd9d81).
Client Agua-IoT, modeles et validations sont separes des accessoires HomeKit.
Node 22 >= 22.13 ou Node 24 pour les outils de developpement.

```sh
npm ci
npm run check
npm run check:package
```

Les tests importent le code compile : recompiler avant `npm test`.
Ils utilisent des mocks et le vrai HAP, jamais un poele reel.
La CI verifie Node 22/24 avec Homebridge 1.11.4/2.4.0, compilation,
lint, tests et contenu npm, y compris le chargement d'une archive isolee.
Preparation du 3 novembre 2026 : **337 tests reussis dans chacune des
quatre combinaisons**, compilation/lint verifies avec les deux Homebridge.
Ces checks locaux ne prouvent pas l'execution de la CI sur GitHub, la
publication npm ou la certification. Les essais GUI/bridge appaire sous
Homebridge 2 et la stabilite prolongee sur appareil restent a confirmer.

Avant publication, verifier les versions deja publiees et les tags npm,
la coherence package/lockfile, les notes de release, le contenu du paquet
et les tests sur les quatre combinaisons. Les versions npm ne sont pas reutilisables.
Authentification npm uniquement localement, sans communiquer de jeton :

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org/
npm publish --dry-run --tag beta --access public
# Publication publique, uniquement apres validation et accord du mainteneur :
npm publish --tag beta --access public
```

`prepublishOnly` execute les checks ; `prepack` compile. La preparation
locale et un dry-run ne publient rien. Aucun statut stable ni Verified
n'est revendique. Avant une demande Verified, reexaminer les criteres
officiels en vigueur, les versions Node/Homebridge prises en charge,
les metadonnees et les validations sur installation reelle.

## Documentation et support

- [Etude API, sources, licences, preuves et inconnues](docs/ETUDE-API.md)
- [Historique des betas](CHANGELOG.md)
- [Archive de developpement](docs/HISTORIQUE-DEVELOPPEMENT.md) :
  anciennes procedures et restrictions, pas le guide actuel.
- [Depot et issues](https://github.com/slebrin/homebridge-nobis)

Licence Apache-2.0 : [LICENSE](LICENSE), [NOTICE](NOTICE).
Les projets communautaires cites dans l'etude ont servi de sources
d'analyse ; leurs fonctions generiques ne prouvent pas le support Nobis.
