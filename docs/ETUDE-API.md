# homebridge-nobis — Phase 1 : étude technique

Date de consultation : 9 octobre 2026.

### Indicateur Eco Stop dans Maison — beta.27, 3 novembre 2026

A la demande de l'utilisateur, un seul ContactSensor optionnel represente
la phase ECO STOP, sans switch supplementaire. Le profil status_get deja
valide est reutilise : code 8 et libelle FRE ECO STOP donnent contact
ouvert ; les autres phases reconnues donnent ferme. Cela ne represente
pas un contact physique et ferme ne signifie pas poele eteint. Phase
inconnue ou lecture en echec : indisponibilite explicite.

Le service conserve l'UUID du poele et utilise les lectures existantes,
polling et relectures de commande, sans ecriture ni requete supplementaire.
L'option exige cloud et temperature, pas les commandes ; desactiver
retire seulement le service. Le 3 novembre 2026 a 19:01, l'utilisateur
confirme son fonctionnement dans Maison sur son installation. Ce retour
ne valide pas tous les scenarios de panne ni la fraicheur cloud, qui
reste inconnue. Aucun indicateur DEBUT/ARRET n'est ajoute.

### Incident « Sans réponse » du 17 octobre 2026

Journal transmis par l'utilisateur : les 16 octobre a 15:02, 16:51,
19:37, 21:17, 22:00 et 22:05, `deviceJobStatus: unavailable
[job status: terminated]` est suivi chaque fois d'un
`Cloud refresh successful` environ 97-120 secondes plus tard. Ces erreurs
intermittentes ont donc recupere. A 22:12:21, le plugin signale
`homekit-temperature-range: protocol`, puis
`Automatic discovery stopped`. Le code validait la temperature lue contre
les limites HomeKit et classait toute erreur `protocol` comme fatale,
sans autre polling. C'est la cause immediate documentee de l'accessoire
indisponible le lendemain ; la valeur ambiante recue et sa cause restent
inconnues, car elles ne figurent pas au journal.

Beta.26 traite uniquement `homekit-temperature-range` comme echec de mesure
recuperable : pas de temperature clamp, pas d'etat simule, service marque
indisponible, reconnexion progressive puis restauration a une lecture valide.
Les erreurs de profil/enveloppe/configuration restent fatales. Test de
regression avec une lecture fictive 65535 puis 23, aucune commande. Un
redemarrage Homebridge peut relancer le plugin beta.25 momentanement, mais
tant que la mesure hors plage revient, il s'arretera de nouveau ; la
correction beta.26 exige installation/republication par l'utilisateur.

### Modes en ECO STOP — beta.25, 16 octobre 2026

L'utilisateur confirme : « dans nobis-fi, le mode eco stop n'empeche en
rien la modification de auto, powerful ou chrono ». C'est un retour
d'utilisation de l'application officielle sur son A8, pas une capture
de nouvelles ecritures API ni une validation de tous les effets physiques.
Les interdictions ECO STOP precedentes etaient des precautions du plugin.

Beta.25 autorise donc les cibles ON et OFF de ces trois modes en ECO STOP,
dans les setters Maison et les validations API partagees. Auto/Powerful
conservent OFF/TRAVAIL et exigent toujours l'autre mode OFF ; aucune
interaction supplementaire n'est deduite de ce retour. Chrono conserve
OFF, sans condition sur les deux autres modes. TRAVAIL pour Chrono,
transitions et phases inconnues restent exclus, sans pretendre a une
interdiction fabricant. Aucun changement de consigne, ventilation,
puissance ou phase n'est envoye implicitement. Les anciens passages
chronologiques decrivent les restrictions des betas anterieures.
Le fonctionnement des ecritures du plugin en ECO STOP reste a confirmer
dans Maison ; les tests utilisent uniquement des reponses fictives.

### Reponse HomeKit locale — beta.24, 15 octobre 2026

L'utilisateur approuve explicitement la prise en charge asynchrone :
repondre rapidement a Maison, conserver les etats confirmes et signaler
les erreurs tardives dans les logs. Les sept chemins HAP (Switch power,
activation Chauffage, consigne, ventilation, Auto, Powerful, Chrono)
acquittent localement sans attendre le cloud. Aucun nouvel endpoint ni
format API, aucune garantie de fraicheur ou d'execution n'en decoule.

Le verrou global est pris avant le premier await du traitement, sans
file de commandes. Les refus locaux restent immediats ; un echec apres
acquittement ne peut plus etre rapporte au clic initial. Chaque promesse
de traitement a un gestionnaire de rejet explicite et journalise.
Les verifications de phase/profil en ligne, le stockage prive avant
POST, les budgets reseau/job, le non-rejeu et les relectures restent
inchanges. Un arret avant envoi ne doit pas provoquer d'envoi au redemarrage ;
un arret apres POST conserve l'incertitude et son marqueur.

Les tests interceptent les requetes : reponse locale exigee sous 1000 ms
pour chaque chemin alors que le cloud est bloque 9500 ms de temps simule,
etats inchanges, toutes les ecritures concurrentes refusees. La cible
n'est affichee qu'apres relecture. Erreurs tardives, timeout avant POST,
arret avant/apres POST et conservation des marqueurs sont couverts sans
commande reelle. Ce correctif reste a confirmer dans Maison sur le NAS.

### Chrono : comparaison en lecture seule — 14 octobre 2026

L'utilisateur demande le bouton Nobis-Fi « Abiliter chrono », sans edition
des horaires/programmes. La carte de son A8 expose chrono_week_enable_set :
SET, offset 33162, mask 65535, readonly false, formule/inverse #,
set_min 0, set_max 1, step 1, is_word false, big_endian false,
with_sign false, aucun libelle OFF/ON fourni. Aucun lien avec
fun_pwf_set=2/CRONO n'est deduit.

Trois lectures uniques du buffer 1, chacune avec les memes 76 adresses,
encadrent les changements effectues uniquement par l'utilisateur dans
Nobis-Fi :

| Reception locale (UTC+2) | Etat confirme par l'utilisateur | Valeur 33162 |
| --- | --- | --- |
| 23:29:47.626 | Desactive | 0 |
| 23:35:38.570 | Active | 1 |
| 23:39:24.050 | Desactive | 0 |

Seules les adresses 33162 et 34049 changent a chaque comparaison :
33162 suit 0/1/0, 34049 suit 38/44/48. La fonction de 34049 n'a pas
ete verifiee ; aucune interpretation ne lui est attribuee. Les 74 autres
valeurs restent identiques sur ces lectures. Reception ne signifie pas
heure de mesure et la fraicheur reste inconnue.

La correspondance de lecture 33162=0/desactive et 1/active est ainsi
comparee dans les deux sens sur l'A8 cible. Lors de cette comparaison,
aucun POST de commande chrono par le plugin/diagnostic n'avait ete teste
ou envoye. Le 15 octobre 2026, apres integration, l'utilisateur confirme :
« le switch programme fonctionne ». Ce retour valide le fonctionnement
du switch dans Maison sur son poele, sans etablir les details de chaque
sens teste, la phase exacte du test, l'execution des horaires ou la
fraicheur des reponses. A la demande explicite de
l'utilisateur, beta.23 integre directement un Switch HomeKit experimental
desactive par defaut, avec suivi de confirmation et verrou durable. Les
ecritures sont initialement limitees a OFF par precaution ; aucune
restriction constructeur de phase n'est etablie. Seul 33162/65535=0/1
est ecrit via le chemin RWMSmaster deja utilise, sans retry ni edition
des 100 champs chrono_p1..p4. Activer chrono peut permettre des
allumages programmes : aucun effet de securite ou horaire n'est suppose.

### Separation optionnelle commande/activite — beta.21, 14 octobre 2026

Observation du 14 octobre 2026 : une commande ON depuis OFF est acceptee,
puis le poele atteint directement ECO STOP lorsque l'ambiante depasse la
consigne. L'ancien verrou exigeait TRAVAIL et restait donc bloque, bien que
le modele HomeKit et le Switch historique traitent deja ECO STOP comme
activation avec reprise possible. Beta.22 resout une cible ON sur TRAVAIL
ou ECO STOP ; l'indicateur En chauffe reste OFF en ECO STOP. Une cible OFF
exige toujours OFF. Cette observation ne transforme pas ECO STOP en chauffe.

Choix utilisateur : commandes ON/OFF dans le service Chauffage existant,
Switch power converti optionnellement en indicateur TRAVAIL. Meme UUID et
subtype, migration desactivee par defaut, exige service Chauffage.
Le Switch est actif uniquement pour phase 5/TRAVAIL valide ; OFF,
ECO STOP, DEBUT, ARRET indiquent aucune phase TRAVAIL confirmee. Ce n'est
pas un detecteur de flamme ni une mesure de chaleur. Code inconnu et erreur
restent indisponibles. Tout SET du Switch est refuse sans requete cloud.
Le service Chauffage conserve activation en ECO STOP et commandes reelles,
sans deduction depuis le seul accuse du job. ON/OFF ne depend plus de la
presence d'une consigne numerique (MAN), contrairement aux changements de
consigne. Les gardes de phase et les marqueurs restent inchanges.
Maison peut conserver le nom utilisateur et afficher Allume/Eteint ;
aucune garantie de rendu ou validation physique NAS n'est deduite des tests.

### Correctif de disponibilite HomeKit — beta.18

Beta.20 ajoute une confirmation locale GUI d'abandon des cibles en attente,
distincte de toute commande Agua-IoT. OFF relu, profils et reglages valides
exiges ; aucune commande ni modification des valeurs observees. Marqueurs
et contexte sont retires explicitement. Confirmation 0600 synchronisee
avant suppression, consommee meme sans cible, non rejouee apres restart.
Rearmement par option desactivee/enregistrement/redemarrage puis nouvelle
confirmation. Corruption/echec de lecture refuses ; echec partiel apres
consommation ne provoque aucune nouvelle suppression automatique.
Un ordre deja transmis au cloud n'est pas annule et peut encore s'executer.
Cette procedure ne prouve ni fraicheur, ni annulation distante.

Depuis beta.19, TemperatureSensor est retire quand le service Chauffage
expose deja CurrentTemperature. Sans Chauffage, la tuile Ambiante demeure.
Lecture 103, validation, dependances des controles et UUID restent inchanges.
Les refus locaux Marche/Auto/Powerful sont journalises avant requete,
notamment le nom d'un verrou en attente. L'utilisateur rapporte un refus
d'arret en ECO STOP sans journal sur son installation : cause non etablie,
pas de nouvelle preuve API ni de suppression de verrou. L'arret depuis
ECO STOP reste autorise hors verrou ; Auto/Powerful ECO STOP non valides.

Les sections chronologiques ci-dessous decrivent aussi des comportements
anterieurs. Depuis beta.18, une cible encore en attente apres un job reussi
ne rend plus les lectures valides indisponibles : les setters HAP
WRITE_RESPONSE retournent la derniere valeur relue, sans etat optimiste.
Les marqueurs prives et le verrou de toutes les ecritures restent inchanges.
Au plus trois lectures rapides espacees de cinq secondes, puis polling
normal, recherchent la cible ; une seule minuterie, aucune nouvelle ecriture.
Les erreurs reelles et la corruption de stockage restent explicites.

Demarrage/arret connus conservent uniquement les dernieres observations
confirmees depuis le lancement, avec ecritures refusees. Au premier
lancement en transition sans observation stable, activation/etat chauffage
restent inconnus. Aucune deduction a partir de status_managed_get=0.
OFF/0 demande de ventilation avec libelle exact peut etre lu comme zero ;
PS n'a toujours pas de representation numerique fiable.

Ambiante 103 et consigne 33122 restent deux caracteristiques distinctes.
Powerful ecrit uniquement 33154. Les consignes 33120/33132 sont restees 5/4
pendant l'essai ON valide ; les lectures de fonctionnement 11/16 n'ont pas
ete relevees dans cet essai. Le 12 octobre 2026, l'utilisateur confirme
que Powerful agit sur la puissance et la ventilation effectives sans
modifier les valeurs demandees sur son A8. Confirmation utilisateur,
pas un releve chiffre des codes 11/16 ni une mesure en watts/debit.
Aucun comportement au retour OFF ou sur un autre modele n'est deduit ;
aucune ecriture supplementaire 7/7 ne doit remplacer l'effet du mode.

Ce correctif beta.18 est local et necessitait confirmation dans Maison sur le NAS.
Avant beta.24, les transactions cloud longues pouvaient encore exceder le delai HAP :
les handlers ne sont pas une file de commandes asynchrone, et aucune
reponse de succes n'est fabriquee pour une erreur ou un timeout.

## 1. Périmètre et niveau de preuve

Cette étude prépare un plugin TypeScript Homebridge Dynamic Platform pour
Nobis-Fi, avec le Nobis A8 V Round comme premier appareil cible.

Aucun client API, plugin, dépendance ou dépôt Git n'a été créé à ce stade.
Aucun compte utilisateur n'a été utilisé. Seules les ressources publiques de
documentation et de code ont été lues ; aucune commande n'a été envoyée.

Les niveaux de preuve sont distingués dans tout le document :

- **D — Documenté** : présent dans le Swagger servi par le domaine Nobis.
  Cela atteste le contrat publié, pas son comportement actuel sur un appareil.
- **C — Communautaire** : présent dans le code des projets étudiés.
  Cela atteste une implémentation, pas une capacité du Nobis A8 V Round.
- **P — Proposition** : décision envisagée pour le plugin, non implémentée.
- **V — À valider** : information absente, ambiguë ou contradictoire.

La recherche web initiale n'avait pas identifié la documentation publique.
Le README de py-agua-iot a permis de la trouver ; son accès a été vérifié
directement. Il serait donc incorrect d'affirmer qu'aucune documentation
publique Agua-IoT n'existe.

## 2. Sources examinées

### Documentation Agua-IoT

- [Interface Swagger Nobis](https://nobis.agua-iot.com/api-docs/).
- [Document Swagger Nobis](https://nobis.agua-iot.com/api-docs/swagger.json).
- Titre : `AGUA Inventory API` ; version déclarée : `2.1.0.0`.
- Swagger `2.0` ; `host: nobis.agua-iot.com` ; `basePath: /`.
- Contact déclaré : Micronova srl ; mention de copyright 2017–2022.
- Le document ne déclare pas de `schemes` ; il a été récupéré en HTTPS.
- Empreinte SHA-256 du document consulté :
  `e0c738a01c7b36fd22659028fd9702a55b32d1f42d76101e6315c9cc25b99370`.

Le Swagger décrit souvent les réponses en texte libre plutôt qu'avec un schéma
JSON exploitable. Sa version ne démontre ni sa fraîcheur ni celle du backend.
Les exemples de réponse ci-dessous décrivent des champs documentés, et ne
constituent pas des captures d'un compte ou d'un poêle.

### Projets communautaires

- [py-agua-iot](https://github.com/fredericvl/py-agua-iot/tree/db3dd530772b68b67473432301f2b8635c13dc19),
  révision `db3dd530772b68b67473432301f2b8635c13dc19` :
  README, client, parseur de formules, dépendances et licence.
- [micronova2mqtt](https://github.com/Legobas/micronova2mqtt/tree/38ff4071f9bbbcc753378dff8f1d9cee7261352c),
  révision `38ff4071f9bbbcc753378dff8f1d9cee7261352c` :
  marques, authentification, renouvellement, appareils, registres,
  buffers, lecture, écriture, tâches, conversion, test de construction
  d'une requête de tâche, dépendances et licence.
- [Ancien plugin Homebridge Agua-IoT](https://github.com/securechicken/homebridge-micronova-agua-iot-stove) :
  README, métadonnées et licence. Projet archivé et non maintenu ;
  les modèles annoncés comme testés sont Piazzetta et Jolly Mec, pas Nobis.

Les deux premiers projets associent Nobis-Fi à
`https://nobis.agua-iot.com` et `customer_code: "700700"` (**C**).
Les clients utilisent `id_brand: "1"` (**C**) ; le Swagger expose cet en-tête
mais ne fournit pas une valeur Nobis spécifique (**V**).

La recherche ciblée d'issues Nobis/A8 n'a pas fourni de preuve supplémentaire
de compatibilité. Ce résultat n'établit pas l'absence de retours ailleurs.

### Homebridge et HomeKit

- [Template officiel](https://github.com/homebridge/homebridge-plugin-template/tree/ab217b1ff36fbbf69931822324e1986113cd9d81),
  révision `ab217b1ff36fbbf69931822324e1986113cd9d81` :
  métadonnées, Dynamic Platform et licence.
- [Critères Verified actuels](https://github.com/homebridge/plugins/wiki/Verified-Plugins),
  page déclarant une mise à jour au 5 mai 2026.
- [Programme et transports](https://github.com/homebridge/plugins).
- [Versions Node prises en charge](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js).
- [Calendrier officiel Node.js](https://github.com/nodejs/Release/blob/main/schedule.json).
- [Définitions des services HAP](https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/ServiceDefinitions.ts).

L'ancienne page Verified du wiki homebridge conserve des mentions Node 18/20
et une date de 2023 : elle ne doit pas supplanter les critères actuels du wiki
homebridge/plugins.

## 3. Authentification

### Séquence attestée

1. **D/C** — Enregistrer une identité d'application avec `POST /appSignup`.
2. **D/C** — Authentifier l'utilisateur avec `POST /userLogin`.
3. **D/C** — Utiliser le JWT obtenu dans l'en-tête `Authorization`,
   avec `local: "false"`, pour les appels du compte.
4. **D/C** — Renouveler le JWT avec `POST /refreshToken`.

Les clients ne préfixent pas le JWT par `Bearer` (**C**).
Le Swagger décrit un JWT dans l'en-tête sans imposer ce préfixe (**D**).
Aucun mécanisme de cookie n'est utilisé par les clients examinés.
Cela ne démontre pas l'absence de cookies dans tous les usages du service.

Les requêtes JSON utilisent `Content-Type: application/json`. Les deux clients
utilisent `Accept: application/json, text/javascript, */*; q=0.01`.
Python ajoute `Origin: file://` ; Go ne le fait pas. Le caractère obligatoire
de cet en-tête n'est pas établi ; il ne faut pas le recopier sans nécessité.

### Enregistrement de l'application

**D** — En-tête obligatoire : `customer_code`. `id_brand` est décrit sans être
marqué obligatoire.

Corps documenté :

| Champ | Type | Obligatoire dans le Swagger |
|---|---|---|
| `phone_type` | string | oui |
| `phone_id` | string | oui |
| `phone_version` | string | non |
| `language` | string | oui |
| `id_app` | string | oui |
| `push_notification_token` | string | oui |
| `push_notification_active` | boolean | oui |

**C** — Les clients utilisent un UUID pour `phone_id`, `id_app` et
`push_notification_token`, ainsi que `Android`, `1.0`, `en` et
`push_notification_active: false`.

**D** — Réponse attendue : HTTP 201, `Success: true`, `id_app`.
Il s'agit d'un enregistrement d'application, pas d'une création de compte
Nobis-Fi ni d'un appairage de poêle.

**P** — Générer un UUID local une seule fois, le conserver dans un sous-dossier
privé du stockage Homebridge et désactiver les notifications push. Ne pas
utiliser de service externe pour générer cet UUID.

### Connexion

**D** — Corps : `email` et `password`, chaînes obligatoires.
Le mot de passe est une valeur JSON non chiffrée au niveau applicatif ;
le transport doit rester HTTPS avec vérification TLS.

En-têtes : `customer_code`, `authorization` et `local` obligatoires ;
`local: "true"` signifie que l'autorisation est l'identifiant d'application.
Les clients envoient leur UUID dans `Authorization`.

**D** — HTTP 200 avec `Success`, `token`, `refreshToken` et `roles`
dans la description de réponse du Swagger.
**C** — Les deux clients lisent au contraire `refresh_token`.
**V** — Le nom effectivement retourné par Nobis-Fi doit être vérifié.
Ne pas inventer un format unique ni déclarer l'authentification validée.

Le client Python propose un serveur de connexion alternatif pour certaines
autres marques. Son README ne déclare pas d'URL de connexion séparée pour
Nobis-Fi ; aucune raison vérifiée d'en utiliser une ici.

### Renouvellement et fermeture

**D** — `POST /refreshToken` reçoit `{"refresh_token": ...}`.
Réponse HTTP 201 : `Success: true`, nouveau `token`.
Le Swagger ne documente pas de durée de validité ni de rotation du refresh
token dans cette réponse.

**C** — Python lit le claim JWT `exp`, renouvelle à expiration ou après un
HTTP 401, puis refait une connexion si le renouvellement échoue.
Go inspecte aussi l'expiration du refresh token pour décider d'une connexion.
Le décodage local de `exp` sans validation de signature sert uniquement à
planifier le renouvellement ; il ne constitue pas une preuve d'autorisation.

**V** — Durées réelles, rotation, sessions simultanées et effets d'une nouvelle
connexion sur Nobis-Fi non établis.

**D** — `POST /userLogout` est documenté : corps `refresh_token`, autorisation
JWT et `local: false`, HTTP 200 `Success: true`, `Text: LOGOUT`.
Il invalide le refresh token selon sa description.
**P** — L'arrêt du plugin doit d'abord annuler ses tâches et requêtes locales ;
ne pas ajouter une déconnexion cloud systématique tant que ses effets sur les
autres sessions ne sont pas vérifiés.

## 4. Endpoints et lecture des appareils

Pour les appels authentifiés ci-dessous : `customer_code`, `Authorization`
et `local: "false"` ; `id_brand` est également envoyé par les clients.
Les noms et la casse des champs doivent être conservés.

| Méthode et chemin | Paramètres JSON ou URL | Réponse documentée / observation |
|---|---|---|
| `POST /deviceList` | pas de corps défini ; `{}` dans les clients | **D** HTTP 200, `Success`, tableau `device` |
| `POST /deviceGetInfo` | `id_device`, `id_product` | **D** HTTP 200, `Value`, `device_info`, pouvant être `null` |
| `POST /deviceGetRegistersMap` | `id_device`, `id_product` ; `fw_version`, `last_update` optionnels | **D** HTTP 200, `device_registers_map`, pouvant être absent/non modifié |
| `POST /deviceGetLastUpdateRegistersMap` | mêmes identifiants ; `fw_version` optionnel | **D** endpoint d'information sur la carte, réponse décrite sans schéma complet |
| `POST /deviceGetBufferReading` | `id_device`, `id_product` ; `BufferId` optionnel | **D** HTTP 200, `idRequest` ; buffer par défaut 0 |
| `POST /deviceRequestReading` | identifiants, `Protocol`, `BitData`, `Endianess`, `Freq`, `Items` ; `Masks` optionnel | **D** HTTP 200, `idRequest` ; lecture explicite de registres |
| `GET /deviceJobStatus/{idRequest}` | identifiant de tâche dans l'URL | **D** HTTP 200, statuts et résultat de tâche |
| `POST /deviceRequestWriting` | identifiants, `Protocol`, `BitData`, `Endianess`, `Items`, `Values` ; `Masks` optionnel | **D** HTTP 200, `idRequest` ; écriture, exclue de la première version |

### Appareils et carte de registres

**C** — Les clients exploitent notamment `id`, `id_device`, `id_product`,
`product_serial`, `name`, `name_product` et `is_online`.
Go modélise aussi `deleted` ; Python avertit explicitement que son fonctionnement
avec plusieurs appareils n'est pas garanti.

**C** — `device_info` donne aux clients l'`id_registers_map`.
Go modélise des bornes de température/puissance et des indicateurs de capacités.
Leur présence ne garantit pas que ces fonctions existent sur le modèle cible.

**C** — La carte est parcourue via
`device_registers_map.registers_map[].registers[]`.
Les champs exploités incluent `reg_key`, `reg_type`, `offset`, `mask`,
`formula`, `formula_inverse`, `set_min`, `set_max`, `format_string`, `enc_val`.
Go modélise également `readonly`, `step`, `is_word`, `big_endian` et `with_sign`.

**V** — Il faut vérifier la carte correspondant réellement au produit et au
firmware A8 V Round. Une carte par défaut du produit n'est pas nécessairement
la bonne carte pour chaque firmware.

Les clients envoient un `last_update` historique constant :
`2018-06-03T08:59:54.043`. Cette valeur est une pratique communautaire, pas une
exigence du protocole. Le Swagger déclare ce champ optionnel.
**P** — Tester d'abord la récupération sans ce champ ; utiliser ensuite une
date réellement retournée si la sémantique de cache est confirmée.

### Lecture asynchrone et fraîcheur

**C** — Python lit le buffer 1 et suit l'`idRequest`.
Go lit aussi ce buffer pour découvrir les adresses puis effectue une lecture
explicite avec `deviceRequestReading`.

**D** — `BitData` est un entier (8, 16 ou 32), `Endianess` une chaîne (`B` ou
`L`), `Items` et `Masks` des tableaux d'entiers ; `Freq` est exprimé en secondes.
**C** — Go utilise `RWMSmaster`, `BitData: 8`, `Endianess: "L"`, `Freq: 0`.
La sémantique exacte de `Freq: 0` n'est pas expliquée par le Swagger.

**V** — Le choix du buffer 1 n'est pas validé pour l'A8 V Round.
Le Swagger documente également `POST /deviceGetConfigBuffer` et
`POST /devicegetBufferId`, avec les deux identifiants et une réponse `idRequest`.
Ils peuvent aider à examiner la configuration, sans autoriser à la modifier.
Aucun appel `deviceSetConfigBuffer` ou équivalent ne doit être fait dans la
version initiale.

**D** — Le Swagger décrit le résultat de tâche comme `jobAnswerPayload`.
**C** — Les clients lisent `jobAnswerData`, avec `Items` et `Values`.
Python vérifie `Cmd` après une écriture ; Go modélise `cmd`.
**V** — Ces formats ne doivent pas être considérés interchangeables sans
validation. Les tableaux, types, longueurs et champs réellement retournés
doivent être contrôlés explicitement.

**C** — Les clients attendent `jobAnswerStatus: "completed"`.
Go mentionne aussi `waiting` et `terminated`.
**D** — Le Swagger mentionne notamment `Missing job` et
`Missing job answer`, parfois avec `Success: true`.
Ni HTTP 200 ni `Success: true` ne suffisent donc à établir la réussite d'une
lecture ou l'achèvement d'une commande.

**V** — Aucun âge maximum des données ou horodatage de mesure exploitable n'est
établi. L'heure de réception locale n'est pas l'heure de mesure du poêle.
`is_online` décrit une connectivité, pas un feu allumé.

## 5. Informations et commandes : ne pas confondre les niveaux

| Fonction | Indice communautaire | Statut pour Nobis A8 V Round |
|---|---|---|
| Température ambiante | `temp_air_get`, repli Python `temp_air2_get` | **V** présence, sonde, unité, formule et précision |
| Consigne ambiante | `temp_air_set` | **V** lecture, écriture, bornes et pas |
| État de fonctionnement | `status_get` | **V** codes, phases et sens exact |
| Alarmes | `alarms_get` | **V** codes et fonctionnement sans alarme |
| Marche/arrêt | `status_managed_get`, valeurs `ON`/`OFF` de la carte | **V** autorisation et comportement du modèle |
| Niveau de puissance | `power_set`, `real_power_get` | **V** présence et différence consigne/puissance effective |
| Mode naturel | `natural_mode_manual_set` | **V**, hors première version |
| Économie d'énergie | `es_air_start_set`, `es_air_stop_set` | **V**, hors première version |
| Canalisations / eau / fumées | propriétés génériques du client | pas de support A8 V Round démontré ; hors périmètre initial |

Le mécanisme d'écriture de registres est documenté (**D**).
Aucune commande de contrôle spécifique A8 V Round n'est validée dans cette
étude. La liste ci-dessus est une liste de candidats, pas un engagement de
prise en charge.

Go code en dur l'adresse 232 et les valeurs 85/170 pour marche/arrêt.
Python tire les valeurs de la carte. Ne pas recopier les constantes Go :
elles ne démontrent pas le fonctionnement du Nobis cible.

Autre divergence : Python envoie `[8]` et `["L"]` pour `BitData` et
`Endianess` lors d'une écriture ; Go et le Swagger utilisent des scalaires.
Il faut retenir le contrat documenté comme point de départ, mais suspendre
l'écriture réelle jusqu'à sa validation, sans essayer des formats alternatifs
sur un poêle en fonctionnement.

La table d'états Python (`0 = OFF`, `4 = ON`, etc.) est générique.
Elle ne constitue pas une table Nobis validée. Aucun état inconnu ne doit
devenir automatiquement « éteint », « en chauffe » ou « en attente ».

## 6. Erreurs, fréquence et risques cloud

### Erreurs attestées dans le Swagger

| Situation | HTTP / code métier / texte documenté |
|---|---|
| Mot de passe refusé | 403 / `1104` / `LOGIN_INVALID_PASSWORD` |
| Utilisateur absent | 404 / `1103` / `LOGIN_USER_NOT_FOUND` |
| Identifiants manquants | 422 / `1105` / `LOGIN_EMAIL_PASSWORD_REQUIRED` |
| Compte non actif | 422 / `1134` / `LOGIN_USER_NOT_ACTIVE` |
| Non autorisé | 401 / `1106` / `UNAUTHORIZED` |
| En-tête d'autorisation manquant | 401 / `1120` / `UNAUTHORIZED_PARAMETER_HEADER_NOT_PRESENT` |
| Refresh token manquant | 422 / `1116` / `REFRESH_TOKEN_REQUIRED` |
| Appareil absent | 422 / `1204` / `DEVICE_NOT_FOUND` |
| Code d'enregistrement refusé | 422 / `1205` / `REG_CODE_ERROR` |
| Paramètres d'écriture manquants | 422 / `1281` / `DEVICE_REQUEST_WRITING_PARAMETER_NOT_PRESENT` |
| Paramètres de lecture manquants | 422 / `1286` / `DEVICE_REQUEST_READING_PARAMETER_NOT_PRESENT` |
| Inscription d'application invalide | 412 / `1138` / `SIGNUP_APP_ERROR_VALIDATE_VALUE` |
| Échec serveur | 500 / codes et textes spécifiques à chaque endpoint |

Cette liste n'est pas exhaustive. Le comportement exact d'un refresh token
expiré n'est pas complètement documenté.

**P** — Ajouter des erreurs internes typées pour réseau/DNS, TLS, délai dépassé,
annulation, JSON invalide, schéma incompatible, absence de carte, données
indisponibles, tâche expirée et commande non autorisée.
Ne pas recopier les `log.Fatal`, récursions de retry ou replis silencieux des
clients tiers. Intercepter les erreurs aux frontières Homebridge et les
signaler sans arrêter le processus.

### Limites de fréquence

**D** — Aucune limite chiffrée n'a été trouvée dans le Swagger consulté :
pas de quota, de réponse 429 décrite ou de `Retry-After`.
Cela ne signifie pas qu'aucune limite n'est appliquée.

**C** — Go utilise un cycle actif de 30 secondes et trois tentatives de tâche
séparées d'une seconde. Python effectue un premier suivi puis jusqu'à dix
nouvelles tentatives séparées d'une seconde.
Ces valeurs ne sont pas des quotas officiels ni des délais garantis.
Chaque tentative peut aussi prendre le temps du timeout HTTP.

**P** — Point de départ conservateur à valider : polling de 60 secondes,
minimum configurable de 30 secondes, requêtes bornées à 10 secondes,
budget global de suivi de tâche de 30 secondes, backoff progressif
avec jitter plafonné à 15 minutes. Ce sont des choix du plugin, pas des
exigences Agua-IoT. Ne pas les adopter sans validation de l'analyse.

Un seul cycle de lecture à la fois ; programmer le prochain après la fin du
précédent ; mutualiser les demandes concurrentes de lecture et de session.
Respecter `Retry-After` s'il apparaît. Ne pas répéter automatiquement une
écriture après un timeout : la commande peut déjà avoir été reçue.
Ne pas tenter continuellement une connexion avec des identifiants refusés.

### Risques techniques

- Dépendance à Internet, au cloud, au compte et à l'offre Nobis-Fi :
  aucune voie locale de secours ne serait fournie par ce plugin.
- Documentation ancienne/incomplète, changement de backend sans garantie
  publique de stabilité ou de préavis.
- Cartes dépendant du produit/firmware, formules, valeurs signées,
  masques et précision pouvant différer.
- Résultats asynchrones, buffers éventuellement anciens, connectivité
  différente de l'état thermique.
- Politique de sessions multiples et compatibilité simultanée avec
  l'application Nobis-Fi non établies.
- Conditions d'utilisation du cloud et autorisation des clients tiers non
  établies ; la licence des projets ne règle pas ce point.
- Maintien des versions Node/Homebridge et absence de preuve matérielle :
  des tests mockés ne constituent pas une certification de compatibilité.

## 7. Architecture proposée — pas encore implémentée

Partir du template officiel, conserver son cycle Dynamic Platform et retirer
les accessoires d'exemple ainsi que les services personnalisés inutiles.
Pas de MQTT, conteneur, Home Assistant ni passerelle.

```text
src/
  index.ts             enregistrement de la plateforme
  settings.ts          noms plugin/plateforme constants
  config.ts            types et validation de configuration
  platform.ts          découverte, cache, polling et arrêt
  agua/
    client.ts          transport HTTPS borné et opérations de lecture
    auth.ts            identité d'application et cycle de session
    models.ts          modèles et validation des réponses inconnues
    errors.ts          erreurs métier/transport/protocole
  stoveAccessory.ts    adaptation HomeKit après validation matérielle
  stoveState.ts        conversion des registres validés
test/
  fixtures/            données entièrement fictives, sans secrets
  *.test.ts            tests client, configuration, états et plateforme
config.schema.json     Plugin Settings GUI
```

Ce sont des chemins prévus, pas des fichiers existants.
Le client et l'authentification ne dépendent pas de HomeKit.
Privilégier le `fetch` natif de Node et les outils de test du projet ;
ne pas ajouter de bibliothèque uniquement pour reproduire les clients tiers.

Les réponses réseau sont `unknown` jusqu'à validation. Ne pas présumer le
contenu d'une réponse parce qu'un type TypeScript le décrit.
N'interpréter que les formules réellement rencontrées, avec une grammaire
arithmétique restreinte, sans `eval` et sans tronquer les décimales.
Une formule non prise en charge devient une erreur explicite.

### Sessions, journaux et stockage

- Pas de journalisation de configuration complète, corps de login,
  cookies, jetons, e-mails ou réponses privées brutes.
- Diagnostic limité à opération, durée, statut HTTP et code métier autorisé,
  sans messages serveur arbitraires susceptibles de contenir des données.
- Jetons en mémoire par défaut. Si une persistance devient nécessaire,
  stockage Homebridge privé, fichiers en mode 0600 et répertoire en 0700.
- Aucun secret dans le contexte des accessoires ou les fixtures.
- Fermeture : annulation des requêtes et attentes, timers supprimés,
  absence de nouveaux cycles ou de promesses rejetées non prises en charge.
- TLS vérifié, redirections d'authentification refusées, aucune télémétrie.

### Identité et cache des accessoires

**P/V** — Construire l'UUID HAP à partir d'une identité API stable, envisagée
comme un tuple préfixé Nobis / `id_device` / `id_product`, dont la stabilité
doit être vérifiée sur l'appareil et après reconnexion.
Ne pas dépendre du nom, de l'e-mail, du jeton ou de l'UUID d'application.

Réutiliser les accessoires restaurés par `configureAccessory`, puis
découvrir après `didFinishLaunching`. Une indisponibilité cloud ne doit pas
faire supprimer les accessoires du cache. Ne pas choisir silencieusement le
premier poêle quand plusieurs appareils correspondent.

## 8. Choix HomeKit provisoire

| Service | Caractéristiques requises par HAP | Conséquence |
|---|---|---|
| `HeaterCooler` | `Active`, `CurrentHeaterCoolerState`, `TargetHeaterCoolerState`, `CurrentTemperature` | adaptation possible chauffage seul ; consigne via `HeatingThresholdTemperature` optionnelle |
| `Thermostat` | `CurrentHeatingCoolingState`, `TargetHeatingCoolingState`, `CurrentTemperature`, `TargetTemperature`, `TemperatureDisplayUnits` | adapté si le poêle expose réellement une consigne et un mode thermostat |

**P** — Préférence conditionnelle pour `HeaterCooler` limité au chauffage,
si l'API permet de distinguer activation, chauffe et attente et de lire la
température réelle. Il représente mieux un appareil de chauffage activable
sans imposer une fonction de refroidissement.

Ne pas exposer de mode AUTO/COOL fictif. Ne pas dériver « en chauffe » du seul
écart consigne/température. Les phases d'allumage, extinction, nettoyage,
éco-stop et alarme exigent une correspondance validée ; « actif » ne signifie
pas automatiquement « brûle actuellement ».

`Thermostat` reste un choix possible si la régulation et ses modes sont
effectivement présents. La décision définitive doit attendre les données A8.
L'affichage, les contrôles et les automatismes Apple Maison doivent aussi être
vérifiés sur iOS ; le choix d'un service HAP ne prouve pas tous les détails UI.

La première version indépendante de HomeKit reste en lecture seule. Si une
étape HomeKit en lecture seule est validée ensuite, exposer uniquement les
capteurs réellement lisibles, sans caractéristiques de contrôle simulées.
Ne pas utiliser `RotationSpeed` pour la puissance du feu : ce n'est pas une
vitesse de ventilateur attestée.

Après une future écriture, l'acquittement du job ne vaut pas confirmation
thermique. Relire le poêle ; n'actualiser les caractéristiques qu'avec des
retours API validés. Données absentes/inconnues/périmées : signaler
l'indisponibilité, jamais remplacer par une température zéro ou un état OFF.

## 9. Configuration et préparation Verified

**P** — GUI Homebridge : adresse e-mail, mot de passe masqué, nom d'affichage,
identifiant de poêle optionnel, intervalle d'actualisation et diagnostic sûr.
Valider aussi à l'exécution, pas seulement dans le schéma GUI.

Le nom d'affichage n'est pas une identité. L'identifiant doit être proposé
ou expliqué après découverte et nécessaire seulement pour désambiguïser.
Configuration absente/incomplète : aucune requête Agua-IoT.
Ne pas supprimer les espaces du mot de passe sous prétexte de normalisation.

Un champ GUI masqué n'est pas un chiffrement du fichier de configuration.
Documenter la protection du stockage Homebridge et de ses sauvegardes.
Ne jamais demander le mot de passe dans une conversation, une issue ou un
dépôt ; il sera saisi uniquement dans la configuration locale.

Les critères Verified consultés imposent notamment :

- Dynamic Platform ; pas une duplication à fonctionnalités égales ou
  inférieures d'un plugin déjà vérifié.
- Publication npm, sources GitHub accessibles, issues activées.
- Release GitHub et notes pour chaque version.
- Toutes les versions LTS Node prises en charge, installation sans démarrage
  non configuré, pas de post-install modifiant le système, pas de TTY requis.
- Plugin Settings GUI, pas d'analyse d'utilisation, données dans le stockage
  Homebridge, pas d'exception non prise en charge.

Au 9 octobre 2026 : Node **22** (Maintenance LTS) et **24** (Active LTS).
Selon le calendrier consulté, Node **26** entre en LTS le **28 octobre 2026**,
pas encore le jour de cette étude ; l'ajouter lorsque son support LTS
Homebridge s'applique. Node 20 a atteint sa fin de vie le 30 avril 2026.
Revalider cette matrice lors de l'implémentation et de la publication.

La recherche de Nobis/Agua/Micronova/Piazzetta dans la liste Verified consultée
n'a pas identifié un concurrent vérifié. Cette vérification devra être refaite
avant toute soumission.

Prévoir `homebridge-nobis`, `homebridge-plugin`, `supports-hap`, sans
`supports-matter`, métadonnées complètes, README, changelog et SemVer.
L'auteur et l'URL du futur dépôt public restent à définir : ne pas les inventer.
Une version de développement en lecture seule ne doit pas se présenter comme
un plugin de contrôle complet ou comme déjà Verified.

## 10. Licences

| Ressource étudiée | Licence vérifiée | Conséquence prévue |
|---|---|---|
| py-agua-iot | Apache-2.0 | respecter licence, attribution et notices applicables si réutilisation |
| micronova2mqtt | Apache-2.0 | même obligation ; pas de dépendance runtime Go/MQTT envisagée |
| homebridge-plugin-template | Apache-2.0 | conserver les obligations du template utilisé |
| HAP-NodeJS | Apache-2.0 | respecter la licence de la bibliothèque Homebridge |
| Requests, dépendance Python étudiée | Apache-2.0 | pas de dépendance Python envisagée |
| PyJWT, dépendance Python étudiée | MIT | pas de dépendance Python envisagée |
| Ancien plugin securechicken | AGPL-3.0-only selon ses métadonnées, licence AGPL v3 fournie | ne pas copier son code dans un projet sous licence permissive sans décision compatible |
| Swagger Agua-IoT | aucune licence de réutilisation explicitée dans le document consulté | référence documentaire, pas autorisation générale de redistribution |

**P** — Apache-2.0 est un choix cohérent pour le nouveau plugin issu du template,
à confirmer lors de la création du projet. Aucun code du plugin AGPL n'a été
copié ni examiné pour être transposé.
Les licences des dépendances futures, y compris transitives, devront être
contrôlées une fois les versions sélectionnées.

## 11. Plan de tests

Tous les tests automatisés utiliseront un transport mocké et des données
fictives. Un scénario synthétique ne sera jamais décrit comme une capture
Nobis validée. Aucun identifiant réel, accès cloud ni contrôle de poêle en CI.

| Domaine | Assertions attendues |
|---|---|
| Inscription / login | méthodes, chemins, champs et en-têtes attestés ; secrets absents des logs ; échecs explicites |
| Formats de session | fixture documentée `refreshToken`, fixture communautaire `refresh_token` ; rejet d'un format ambigu/incomplet selon le contrat finalement retenu |
| Réponses de lecture | listes et cartes valides ; `null`, liste vide, plusieurs appareils et carte non correspondante |
| HTTP / métier | 401, 403, 404, 412, 422, 500 ; HTTP 200 avec erreur métier ; 429 simulé comme robustesse, pas comme fait API |
| JSON / schémas | JSON invalide, champs absents, mauvais types, corps trop volumineux |
| Sessions expirées | expiration, refresh refusé, nouvelle connexion bornée ; un seul refresh pour des appels concurrents |
| Délais | timeout requête, corps lent, budget global du job, annulation et absence de retries après arrêt |
| Jobs | pending, completed, terminated, missing, état inconnu ; tableaux Items/Values incohérents |
| Conversions | masques, signes, décimales, bornes, pas, formules non prises en charge ; aucun état de repli fictif |
| Configuration | e-mail invalide, valeurs non finies, intervalle invalide, mot de passe conservé, aucune requête sans configuration |
| Lecture seule | zéro appel d'écriture/configuration/appairage même sous erreur ou reconnexion |
| Commandes futures | refus si mode lecture seule, registre inconnu/readonly, valeur hors borne ; pas de retry aveugle ni mise à jour optimiste |
| Reconnexion | backoff/jitter bornés, aucune boucle serrée, pas de cycles qui se chevauchent, récupération après panne |
| Identité / cache | UUID inchangé au redémarrage/renommage/refresh, pas de doublons, pas de retrait sur panne cloud |
| HomeKit futur | uniquement données mesurées, indisponibilité explicite, confirmation par relecture après écriture |

CI proposée : compilation TypeScript stricte, lint et tests sur Node 22/24,
puis ajout des LTS nouvellement prises en charge. Vérifier également le contenu
du package npm et l'installation sans configuration.
Ne pas prétendre avoir exécuté ces tests : aucun code n'est encore développé.

## 12. Points bloquants et progression soumise à validation

### Points à vérifier localement, sans partager de secrets

1. Login Nobis-Fi réel : hôte, code client et id_brand ; nom du refresh token,
   expiration et compatibilité avec l'application officielle simultanée.
2. Appareil : IDs stables, modèle/firmware et carte correspondante.
3. Résultat de lecture : `jobAnswerPayload` ou `jobAnswerData`,
   forme effective du résultat et états de job.
4. Buffer approprié et fraîcheur ; signification de `Freq: 0` avant toute
   éventuelle lecture explicite et sans modification de configuration.
5. Registres de température, consigne, états et alarmes ; formules, unités,
   résolution et phases de fonctionnement.
6. Seulement dans une phase ultérieure autorisée : registres réellement
   inscriptibles, valeurs marche/arrêt, bornes, pas, refus et confirmation.
7. Quotas et conditions d'utilisation : documentation ou confirmation
   fournisseur, sans stress test du service.

Les données nécessaires seront examinées localement. Seuls des contrats
anonymisés explicitement contrôlés pourront alimenter la documentation ; aucune
capture brute contenant e-mail, jetons, MAC, numéros de série ou codes de
sécurité ne doit être publiée.

### Ordre proposé

1. Validation de cette étude par l'utilisateur.
2. Création du socle officiel TypeScript et du client indépendant en lecture
   seule : inscription d'application, authentification, découverte et carte.
3. Validation locale des formes de réponse et lecture du buffer, sans écriture
   de registres ni modification de configuration du poêle.
4. Choix définitif des conversions et de l'exposition HomeKit avec les
   capacités réellement observées.
5. Commandes ajoutées séparément, seulement après validation spécifique et
   activation explicite ; tests simulés avant tout essai manuel supervisé.
6. Documentation de compatibilité réelle, CI, publication et demande Verified.

**Arrêt actuel : Phase 1 livrée.** La documentation permet de préparer le
transport et la découverte, mais ne permet pas encore de déclarer compatible
le contrôle ou le modèle d'états du Nobis A8 V Round.
La Phase 2 et tout code de communication restent en attente de validation.

### Suivi apres validation de la Phase 1

L'utilisateur a autorise la poursuite le 9 octobre 2026. Le socle de Phase 2
est maintenant cree : Dynamic Platform TypeScript, configuration GUI,
validation, tests de configuration et de plateforme, workflow CI Node 22/24.
Voir le [README](../README.md) pour l'etat courant.

Le texte de l'etude ci-dessus conserve son statut de photographie de Phase 1.
La plateforme de developpement ne communique pas encore avec Agua-IoT et ne
cree aucun accessoire fictif. Le client, la session et les convertisseurs
seront ajoutes en Phase 3, avec les points bloquants documentes toujours
applicables.

### Phase 3 — implementation en lecture seule

Le client independant de HomeKit est maintenant implemente et teste avec des
reponses fictives. Les deux noms attestes du refresh token sont valides
explicitement ; leur conflit est refuse. Le resultat communautaire
`jobAnswerData.Items/Values` est pris en charge sans conversion thermique.
La structure de `jobAnswerPayload` reste inconnue et ce format est refuse
explicitement, sans supposer qu'il ressemble au format communautaire.

La plateforme propose une activation `enableCloud` false par defaut pour
authentification, appareils et definitions de registres uniquement. Elle ne
lit aucun buffer automatiquement, ne modifie pas sa configuration et ne cree
aucun accessoire. Cette restriction conserve le point bloquant sur le buffer
A8 V Round et la fraicheur des mesures. La methode de lecture de buffer du
client reste disponible pour une validation locale explicite ulterieure.

Les formules, flags de codage, bornes et enumerations sont des metadonnees,
pas encore des etats convertis. `deviceRequestReading` n'est pas implemente
tant que le protocole du modele et la semantique de Freq ne sont pas verifies.
Aucune commande n'est exposee ; le transport refuse les endpoints d'ecriture,
configuration et appairage.

Timeouts, corps de reponse borne, session mutualisee, backoff, Retry-After et
arret sont couverts par les tests. Seul l'UUID d'application est persiste dans
un emplacement prive Homebridge. Aucune connexion utilisateur ni verification
sur poele reel n'a ete effectuee pendant le developpement.

### Preparation d'une validation autonome

L'utilisateur a choisi un outil local sans Homebridge, sans connexion reelle
pour le moment. `npm run diagnostic` affiche une aide hors ligne. Une future
session necessite `--connect`, un fichier d'identifiants prive et un stockage
dedie, tous deux locaux. Par defaut elle s'arrete aux definitions ; `--buffer`
exige un identifiant choisi explicitement apres verification.

Le rapport prive conserve seulement les donnees validees necessaires au
diagnostic, sans reponses HTTP brutes ni identifiants de session/appareil.
Les chaines de registres ne sont pas certifiees anonymes : aucun rapport ne
doit etre partage sans revue locale. Les tests du diagnostic utilisent des
fixtures fictives, jamais un compte ou poele reel. La decision HomeKit et les
commandes restent bloquees jusqu'aux validations materielles listees ci-dessus.

### Validation du formulaire Homebridge GUI sans poele

L'utilisateur a choisi une verification locale de la GUI, sans connexion au
poele. Le formulaire officiel a ete teste dans Homebridge Config UI X 5.29.0,
avec Homebridge 1.11.4 installe, sous Node 24 sur macOS. L'UI seule a tourne
sur localhost dans une installation temporaire isolee, sans demarrer le
bridge, avec des identifiants fictifs et `enableCloud` desactive.

Deux comportements du rendu ont necessite une correction du schema :
l'intervalle borne etait rendu comme un curseur ; un intervalle invalide mais
optionnel pouvait etre omis lors de la sauvegarde, laissant le runtime revenir
a 60 secondes. Le layout utilise desormais un champ numerique, avec entier
obligatoire et `multipleOf: 1`. Les valeurs 29, 3601, 30.5 et vide bloquent
effectivement Save ; 30, 3600 et 60 sont sauvegardees sans alteration puis
retrouvees apres rechargement. Une configuration sans intervalle existant
recoit le defaut 60 dans la GUI ; le runtime reste retrocompatible.

Les identifiants incomplets, e-mail invalide et mot de passe compose d'espaces
bloquent Save. Le mot de passe est masque et ses espaces significatifs sont
preserves dans le fichier sauvegarde. Le nom et le diagnostic sont conserves ;
les champs optionnels vides sont omis. La configuration effectivement
produite a ete acceptee par le validateur runtime et le demarrage de plateforme
simule avec cette configuration a confirme zero appel cloud.

Cette verification n'ajoute aucune preuve sur les contrats API du compte
Nobis-Fi ou les etats de l'A8 V Round. Elle ne valide ni Homebridge 2, ni le
bridge HomeKit, ni le controle. Les tests navigateur restent manuels ; la CI
couvre le schema et la validation de configuration avec des donnees fictives.

### Diagnostic autonome avec interface navigateur

A la demande de l'utilisateur, un formulaire local evite la creation manuelle
d'un fichier d'identifiants. `npm run diagnostic:browser` ouvre un serveur sur
127.0.0.1 avec port automatique ; le terminal affiche l'adresse a ouvrir.
Seul le clic explicite autorise la decouverte, via les memes operations et
validations que le diagnostic CLI. Aucun buffer, commande, conversion
thermique ou accessoire HomeKit n'est ajoute.

Les identifiants ne sont pas enregistres ; le champ mot de passe est efface au
lancement. Seul l'UUID d'application est persiste dans un stockage prive de
l'utilisateur. Le resultat navigateur expose des compteurs, sans rapport
ni identifiants d'appareil. Origine/hote locaux, jeton par lancement, CSP,
corps bornes, timeouts et refus de concurrence limitent les acces et appels.
Ctrl+C ferme le serveur et annule les requetes.

L'affichage et le resultat ont ete verifies dans le navigateur avec une
reponse simulee, sans connexion Agua-IoT. Les tests du serveur utilisent des
reponses fictives. Ces essais ne modifient pas les inconnues materielles et
les contrats du compte reel restent a valider par l'utilisateur localement.

### Premier retour utilisateur et inspection des definitions

Le 9 octobre 2026, l'utilisateur a rapporte une connexion reussie via
l'interface locale : un appareil et 181 definitions de registres. C'est un
retour d'essai reel, pas une fixture ni une validation de compatibilite
thermique. Le chemin de succes exige un appareil signale en ligne et une
carte validee. Aucun buffer ni commande n'a ete demande. Les definitions
n'ont pas ete examinees pendant cet essai et le renouvellement de session,
les mesures, les etats et leur fraicheur restent a valider.

L'interface permet maintenant de consulter les definitions validees lors
du prochain clic explicite. Elle affiche un tableau, un filtre local et les
champs complets de chaque registre, sans identifiants d'appareil ou de carte.
Les champs absents ne sont pas completes par des hypotheses ; les formules
et enumerations restent des metadonnees non interpretees. Aucun buffer n'est
selectionne d'apres un nom de registre. Les chaines sont affichees comme
texte et ne sont jamais executees.

Les definitions restent uniquement dans la page et peuvent etre effacees.
Elles ne sont pas certifiees anonymes et ne doivent pas etre partagees sans
inspection locale. Aucun nouveau test cloud n'est lance automatiquement.

Le tableau a ete verifie dans le navigateur avec 181 definitions fictives :
nombre de lignes, filtre sur les metadonnees, champs optionnels et enumerations
fractionnaires preserves, chaines HTML affichees comme texte, et effacement.
La reponse du test etait interceptee localement ; aucun appel Agua-IoT n'a
ete declenche. Les tests automatises couvrent aussi la suppression des
anciennes definitions lors d'une nouvelle tentative et le refus d'un
resultat incoherent.

### Inspection locale de la carte retournee par le compte

Le 9 octobre 2026, les definitions affichees dans la page partagee ont ete
examinees localement, sans lire les champs d'identifiants ni lancer de
nouvelle requete cloud. Le tableau contenait 181 definitions, dont 28 de type
`GET`. Les observations ci-dessous concernent cette carte retournee par le
compte : elles ne certifient pas le modele ou le firmware et ne constituent
pas des mesures du poele. Aucune capture brute ni identifiant d'appareil/carte
n'est ajoute au depot.

| Registre observe | Type | Offset | Masque | Formule | Interpretation encore a valider |
|---|---|---|---|---|---|
| `temp_air2_get` | GET | 103 | 65535 | `#` | Candidat temperature d'air ; unite et echelle non etablies |
| `temp_gas_flue_get` | GET | 2 | 65535 | `#` | Candidat temperature des fumees |
| `temp_probe_k_get` | GET | 0 | 65535 | `#` | Candidat sonde K |
| `status_get` | GET | 8 | 65535 | `#` | Phases de fonctionnement selon les libelles de la carte |
| `status_managed_get` | GET | 232 | 255 | `#` | ON/OFF gere ; ne prouve pas une combustion en cours |
| `real_power_get` | GET | 11 | 255 | `#` | Niveau de puissance ; aucune conversion en watts etablie |
| `alarms_get` | GET | 34 | 255 | `#` | Enumeration d'alarmes, sans alarme actuelle lue |
| `temp_air_set` | SET | 33122 | 65535 | `#` | Candidat consigne, pas une autorisation d'ecriture |
| `power_set` | SET | 33120 | 65535 | `#` | Candidat reglage de puissance, pas une commande validee |

Pour `status_get`, les libelles FRE sont : 0 OFF, 1 ATTEN., 2/3/4 DEBUT,
5 TRAVAIL, 6 NETTOY., 7 ARRET, 8 ECO STOP, 9 STAND BY, 10 ALARME,
11 MEM.ALM. Ce sont des enumerations fournies par la carte, pas des etats
observes ni une correspondance HomeKit approuvee.
`status_managed_get` fournit 85 ON et 170 OFF. La relation temporelle et
fonctionnelle entre ces deux registres reste inconnue.

`temp_air_set` annonce des bornes 7 a 41, un pas de 1 et une enumeration
41 MAN. Il serait incorrect de traiter automatiquement 41 comme une
temperature cible de 41 degres. `power_set` annonce 1 a 7, alors que
`real_power_get` enumere notamment 8 PWR-FULL : ces domaines ne doivent
pas etre assimiles. Les champs SET n'attestent ni la disponibilite effective
d'une commande pour cet appareil ni son protocole.

Les flags de `temp_air2_get` indiquent un mot, little-endian et non signe.
`status_get` associe en revanche un masque 65535 a `is_word: false` :
ne pas corriger cette combinaison ni deviner son decodage.
La carte contient aussi des noms de canalisation et ventilateurs ; leur
presence n'atteste pas que le modele physique possede ces fonctions.

Aucune reference a un buffer n'a ete trouvee dans les definitions validees
affichees. Cela ne prouve pas l'absence de metadonnees ailleurs dans l'API.
Le buffer adapte, la correspondance offset/valeurs, les unites et la fraicheur
restent bloquants. Avant toute lecture brute, il faut etablir le choix du
buffer a partir d'une preuve documentaire ou d'une observation locale
autorisee du protocole officiel, sans choix automatique de 0 ou 1.

### Recherche complementaire sur la selection du buffer

Le Swagger public Nobis a ete relu le 9 octobre 2026, sans appel au compte
utilisateur. Il documente deux operations de lecture supplementaires :

| Endpoint exact | Corps obligatoire | Retour HTTP 200 documente |
|---|---|---|
| `POST /deviceGetConfigBuffer` | `id_product`, `id_device` | `Success: true`, `Text: DEVICE_ENQUEUE_MESSAGE_OK`, `idRequest` |
| `POST /devicegetBufferId` | `id_product`, `id_device` | `Success: true`, `Text: DEVICE_ENQUEUE_MESSAGE_OK`, `idRequest` |

La casse inhabituelle `devicegetBufferId` est celle du Swagger. La premiere
operation est decrite comme une lecture de l'ensemble des configurations
de buffers ; la seconde comme une lecture de l'identifiant de buffer
configure. Ce sont des requetes asynchrones : aucune des deux reponses
initiales ne documente directement la configuration ou l'identifiant.
Le format de leur resultat de job n'est pas specifie. Le parseur actuel
`jobReading` ne doit pas etre reutilise pour ces resultats : son contrat
`Items`/`Values` concerne uniquement une lecture de valeurs brutes.

Sources consultees :
[Swagger Nobis](https://nobis.agua-iot.com/api-docs/swagger.json),
[client Python](https://github.com/fredericvl/py-agua-iot/blob/db3dd530772b68b67473432301f2b8635c13dc19/py_agua_iot/__init__.py),
[lecture de buffer Go](https://github.com/Legobas/micronova2mqtt/blob/38ff4071f9bbbcc753378dff8f1d9cee7261352c/micronova/readDeviceBuffer.go).
Les deux clients consultes utilisent explicitement `BufferId: 1` ; cela
reste une pratique communautaire, pas une preuve specifique a l'A8 V Round.
Le Swagger de `/deviceGetBufferReading` annonce toujours 0 si le champ
est absent. Le chemin distinct `/GetBufferReading` annonce 1, mais ne doit
pas etre confondu avec l'endpoint appareil utilise par le plugin.

Les recherches GitHub par noms exacts de ces deux operations n'ont retourne
aucun exemple indexe ; les recherches d'issues Nobis/buffer dans les deux
projets n'ont pas apporte de preuve. Cela n'etablit pas l'absence d'exemples
ailleurs. Aucun appel a ces endpoints n'a ete ajoute au client ou effectue.

Point d'arret : pour poursuivre sans inventer un format, il faut obtenir
la structure du resultat de job, soit par documentation fournisseur,
soit par une inspection locale explicitement autorisee de ces lectures
de metadonnees. Cette inspection doit distinguer reception et validation,
rester bornee, ne pas enregistrer ni publier de reponse brute contenant
des secrets, et ne jamais appeler `/deviceSetConfigBuffer`,
`/deviceSetConfigBufferDefault` ou un endpoint d'ecriture.
Un resultat inconnu ne doit pas conduire a choisir un buffer automatiquement.

L'utilisateur a ensuite autorise la preparation du diagnostic local de
metadonnees. Seul `/deviceGetConfigBuffer` a ete ajoute a l'allowlist de
lecture ; `/devicegetBufferId` reste non implemente. Le suivi de job utilise
le meme budget de 30 secondes et les memes validations d'identifiant/statut
que la lecture brute, mais ne reutilise pas son parseur `Items`/`Values`.
Un job termine est conserve comme structure inconnue, sans interpretation.
La page ne recoit que les chemins et types des champs, pas leurs valeurs
scalaires. Les cles sensibles connues sont exclues ; profondeur, nombre de
champs et echantillon des tableaux sont bornes avec indication de troncature.
Les chaines restent opaques, meme si elles contiennent du JSON.
Le resultat porte explicitement `configurationValidated: false`.

Ce diagnostic est une etape d'observation du contrat, pas une preuve du
numero de buffer. La page demande un clic specifique et de nouveaux
identifiants locaux, sans connexion automatique, stockage de reponse brute,
lecture de mesures ou modification du poele.

Validation de cette implementation : compilation, lint et 89 tests reussis
sous Node 24 ; compilation, lint et tests des surfaces modifiees sous Node 22.
Le mode navigateur a ete verifie avec une reponse simulee : selecteur,
affichage de la structure, mention non validee, mot de passe efface et
effacement du resultat. Aucun appel reel de configuration n'a ete effectue
pendant ces validations.

### Premier resultat de l'inspection de configuration

Le 9 octobre 2026, la structure affichee apres l'essai utilisateur a ete
examinee localement, sans nouvelle requete. Le job avait termine, mais le
diagnostic conservait explicitement `configurationValidated: false`.
La structure visible contient `jobAnswerPayload` avec `id`, `jid`, `pl.cmd`
et `type`, ainsi que `jobAnswerData` avec `Cmd`, `NackErrCode` et `cmd`.
Les valeurs de ces champs n'ont pas ete exposees par le diagnostic.

Aucun champ de configuration de buffer, identifiant de buffer, liste
d'adresses, frequence ou encodage n'apparait dans cette structure.
La presence de `NackErrCode` suggere une information de refus/acquittement
negatif, mais son nom seul ne permet ni d'affirmer un refus ni d'en determiner
la cause. Sa valeur et sa semantique restent inconnues. Un job termine
ne doit donc pas etre presente comme une lecture de configuration reussie.

Il faut maintenant etablir la signification du resultat de commande avant
de tirer une conclusion sur le support de cette lecture. Ne pas selectionner
un buffer, reconfigurer l'appareil ou repeter les requetes automatiquement
sur la base de ce resultat.

### Observation ciblee de NackErrCode

Le diagnostic expose maintenant uniquement l'entier sur situe exactement
dans `jobAnswerData.NackErrCode`. Les codes absents et les valeurs malformees
sont distingues ; aucune chaine n'est convertie et aucun code par defaut
n'est ajoute. Les valeurs des champs Cmd/cmd, jetons, identifiants et payload
restent masquees. Le code est affiche comme observation sans interpretation,
y compris pour 0 ; `configurationValidated` reste false.

Les recherches exactes de NackErrCode dans les deux clients etudies n'ont
fourni aucun contrat. Le
[suivi de job Go](https://github.com/Legobas/micronova2mqtt/blob/38ff4071f9bbbcc753378dff8f1d9cee7261352c/micronova/deviceJob.go)
ne modele pas ce champ. Aucun tableau de signification des codes n'a donc
ete verifie. La suite depend du code reel et d'une source permettant de
l'interpreter, pas de son nom ou d'une convention supposee.

L'ancien diagnostic ne conservait pas la reponse brute ni le code numerique.
Un nouvel essai utilisateur explicite est necessaire pour cette observation.
Le plugin n'ajoute ni memorisation des identifiants, ni nouvel essai cloud
automatique, ni selection speculative de buffer.

L'essai utilisateur suivant a renvoye `deviceJobStatus: unavailable`.
Dans la version utilisee, ce message regroupait `terminated`, `Missing job`
et `Missing job answer` ; le statut exact n'a pas ete conserve et ne peut
pas etre reconstitue. Cela ne prouve ni un poele hors ligne, ni un refus de
commande, ni une erreur d'identifiants. Aucun code NackErrCode n'a ete obtenu.
Le client conserve desormais le statut exact parmi ces trois valeurs connues,
sans journaliser d'identifiant de job ou de reponse brute, et la GUI explique
le cas sans deduire sa cause. Les valeurs inconnues restent des erreurs
de protocole sans etre imprimees. Aucun nouvel essai automatique n'est ajoute.

L'essai utilisateur avec le diagnostic precis a ensuite renvoye
`Missing job answer` pour la lecture de configuration. Cela atteste que le
service n'a pas fourni de reponse de job exploitable a cet instant, pas que
l'appareil est hors ligne ou que cette operation est definitivement non
supportee. Aucun code NackErrCode ni configuration n'a ete obtenu.
Ne pas repeter les essais a l'identique, transformer ce statut en `waiting`
sans preuve, augmenter arbitrairement le budget ou choisir un buffer par
defaut. La decouverte de l'appareil et de sa carte reste le seul succes
materiel rapporte ; les lectures de configuration ne sont pas validees.

Pour debloquer ce point, il faut une preuve du buffer et du format de lecture
adaptes au modele/firmware : confirmation technique Nobis/Micronova ou
observation locale autorisee d'une lecture de l'application officielle.
Une telle observation ne doit pas desactiver TLS ni conduire a partager
des identifiants, jetons ou captures reseau brutes. Aucun acces supplementaire
au compte ni nouvelle lecture du poele n'est lance a partir de ce message.

### Preparation de la lecture de l'identifiant de buffer configure

Apres autorisation utilisateur, l'endpoint exact `POST /devicegetBufferId`
est ajoute au client et au diagnostic navigateur dans un mode distinct.
Le corps contient seulement `id_device` et `id_product`. Le suivi de job
partage les validations, erreurs precises, mutualisation et budget de
30 secondes des autres lectures, dans une session bornee a deux minutes.
Il n'y a pas de repli automatique depuis une lecture de configuration
en echec, ni d'enchainement vers `/deviceGetBufferReading`.

Le format final restant inconnu, le resultat est explicitement non valide :
la page recoit la structure bornee et l'observation ciblee de NackErrCode,
sans valeurs d'identifiant ou de payload. Aucun nom de champ ni numero de
buffer n'est suppose. La prochaine etape depend de la structure effectivement
observee ; sa reception ne suffira pas a declarer le buffer adapte.

Validation : compilation, lint et 95 tests sous Node 24, compilation/lint
et tests des surfaces modifiees sous Node 22. Le mode navigateur a ete
verifie avec une reponse fictive interceptee localement : route distincte,
structure affichee, mention non validee, effacement et mot de passe vide.
Aucun appel reel a devicegetBufferId n'a ete effectue pendant la validation.

### Structure observee du resultat devicegetBufferId

Lors de l'essai utilisateur suivant, le job a termine et la page montre
`jobAnswerData.BufferCnt` de type number et `jobAnswerData.Indexes` de type
array avec des elements number. NackErrCode est absent. La structure etait
partielle parce que l'inspection ne parcourt que trois elements de tableau ;
cela n'atteste pas le nombre exact d'indices. Les valeurs n'etaient pas
conservees par cette version, et aucun numero de buffer n'est donc etabli.

Le diagnostic expose maintenant uniquement ces deux champs numeriques exacts
dans le mode devicegetBufferId, s'ils passent des garde-fous : entiers surs
non negatifs, tableau de maximum 256 elements, sans doublon et BufferCnt
egal a sa longueur. Ces contraintes sont une politique conservatrice locale,
pas une semantique fabricant verifiee. Un format absent ou incoherent est
indique sans afficher les valeurs ni corriger la reponse.
L'observation ne choisit aucun index et ne prouve pas la correspondance avec
les mesures courantes. Aucun endpoint ni champ supplementaire n'est invente.

Le 10 octobre 2026, apres un nouvel echec `Missing job answer` de cette
lecture, l'utilisateur confirme que le poele est alimente electriquement
et que l'application officielle actualise ses informations alors que le
poele est arrete. Il n'est donc pas justifie d'attribuer ces echecs a une
coupure d'alimentation ou d'exiger un allumage pour poursuivre.
Ce retour ne prouve toutefois pas que l'application utilise les memes
endpoints, ni que ses informations constituent des mesures fraiches.
La lecture devicegetBufferId a produit une structure BufferCnt/Indexes lors
d'un essai precedent, puis des reponses de job indisponibles : la cause
de cette intermittence reste inconnue.

### Investigation de la premiere consultation des jobs

Le client Go etudie attend une seconde avant chaque consultation, y compris
la premiere :
[getJobResult](https://github.com/Legobas/micronova2mqtt/blob/38ff4071f9bbbcc753378dff8f1d9cee7261352c/micronova/deviceJob.go).
Le client Python consulte immediatement, puis attend une seconde entre ses
tentatives :
[client Python](https://github.com/fredericvl/py-agua-iot/blob/db3dd530772b68b67473432301f2b8635c13dc19/py_agua_iot/__init__.py).
Ces sources divergent et ne prouvent pas une contrainte Nobis. Notre
consultation immediate peut etre une piste d'intermittence, pas une cause
etablie. La politique du client est maintenant d'attendre l'intervalle de
polling avant chaque consultation (une seconde par defaut), dans le budget
existant de 30 secondes. L'attente est annulee a la fermeture ou au timeout.

Les statuts Missing job/Missing job answer/terminated restent terminaux :
aucune reinterpretation en waiting, repetition de la demande initiale,
extension du budget ou selection de buffer. Les tests verifies avec horloge
simulee imposent zero poll a 999 ms et un premier poll a 1000 ms ; la fermeture
pendant cette attente interdit toute consultation. L'effet sur les essais
materiels reste a verifier par un clic utilisateur explicite.

### Identifiants de buffers observes

Le 10 octobre 2026, l'essai utilisateur apres ajout de l'attente initiale
a fourni `BufferCnt: 4` et `Indexes: [1, 131, 132, 130]`, sans NackErrCode.
Ces valeurs ont ete lues uniquement dans le resultat affiche, sans nouvelle
requete cloud. Les quatre indices ont passe les garde-fous numeriques du
diagnostic ; ils sont observes pour ce compte/appareil, sans generalisation
a tous les A8 ou firmwares.

Un succes apres changement de temporisation n'etablit pas sa causalite :
le service avait deja fourni une structure exploitable lors d'un essai
anterieur. L'intermittence ne peut pas etre declaree resolue.
La mention de structure partielle concerne l'echantillonnage de trois
elements dans la vue des types ; la liste numerique ciblee contient ici
les quatre indices observes.

L'indice 1 constitue maintenant un candidat de lecture etaye a la fois par
sa presence dans la liste retournee et par l'usage des deux clients
communautaires. Cela ne prouve pas qu'il contient les mesures utiles, ni
leur fraicheur, ni leur encodage. Les indices 130/131/132 ne sont pas
interpretes comme temperatures, configuration ou historique.
Une prochaine lecture brute de 1 doit etre autorisee explicitement, sans
scan des autres indices, modification de configuration ou conversion
thermique automatique. Le format de job reel reste a verifier.

L'utilisateur a autorise la preparation d'une lecture brute unique du
buffer 1. Le mode navigateur dedie utilise le client existant, un BufferId
fixe a 1 et la selection non ambigue d'un appareil signale en ligne.
Il n'effectue aucune lecture d'un autre index ni ecriture de configuration.
Les couples offset/valeur sont affiches sans traitement des mots, masques,
signes ou formules ; l'heure de reception ne devient pas une heure de mesure.
La plateforme Homebridge ne lance toujours aucune lecture automatique.

Le contrat de lecture existant n'est pas assoupli : seul jobAnswerData
Items/Values est valide, sans jobAnswerPayload. Un resultat reel divergent
reste une erreur explicite avant toute conversion. L'autorisation porte
sur la preparation de ce mode ; aucun essai reel n'est lance par l'assistant.

Validation : compilation/lint et 101 tests sous Node 24 ; compilation/lint
et tests du diagnostic navigateur sous Node 22. Deux tests du diagnostic
precedemment imbriques ont ete rendus independants apres detection
d'annulations sous Node 22. Le tableau brut a ete verifie dans le navigateur
avec une reponse fictive interceptee : valeurs inchangees, avertissement
de fraicheur, mot de passe efface et nettoyage des lignes. Aucun appel
Agua-IoT n'a ete effectue durant cette verification.

### Premier essai de lecture brute : format refuse

L'utilisateur a rapporte `deviceJobStatus: protocol` lors de la lecture
du buffer 1 le 10 octobre 2026. Ce message ne distingue pas la presence
de jobAnswerPayload, un format Items/Values incompatible ou un autre statut
inconnu. Il serait donc injustifie d'attribuer cet echec a l'une de ces
causes sans observation supplementaire.

Pour les jobs completed refuses, le parseur expose maintenant seulement
une raison predeterminee (enveloppe non prise en charge ou valeurs invalides),
les types de jobAnswerData/jobAnswerPayload/Items/Values et les longueurs
des tableaux presents. Aucune valeur, cle dynamique ou reponse brute n'est
conservee dans cette erreur. Les autres erreurs restent explicites.
Le diagnostic navigateur montre ces observations sur la meme requete
echouee, sans nouvelle lecture automatique. Le contrat strict n'est pas
assoupli et aucune temperature, phase ou fraicheur n'est deduite.
L'essai precedent ne conservait pas cette structure : elle ne peut pas
etre reconstituee sans nouvel essai utilisateur.

### Coexistence observee des enveloppes de lecture

Le nouvel essai du 10 octobre 2026 montre un job completed refuse pour
`unsupported-envelope` : jobAnswerData et jobAnswerPayload sont tous deux
des objets ; Items et Values sont des tableaux de 76 elements chacun.
Ces observations ne prouvent pas encore que les elements sont des entiers,
que les adresses sont uniques ou que les mesures sont fraiches.
Le refus provenait cependant de notre restriction systematique sur la
presence du payload, avant validation des tableaux.

Cette restriction est corrigee : le payload supplementaire reste opaque,
n'est pas expose et ne fournit aucune valeur de remplacement. Seul le
contrat communautaire jobAnswerData.Items/Values est parse, avec tableaux
non vides de longueurs egales, entiers surs, adresses non negatives uniques.
Un payload seul reste refuse, tout comme des tableaux malformes meme si
un payload contient des valeurs plausibles. Aucune semantique du payload,
conversion thermique ou fraicheur n'est inventee.

Cette section actualise les restrictions historiques mentionnees plus haut :
la coexistence des deux enveloppes n'est plus interdite ; l'utilisation du
payload comme source de mesures reste non prise en charge.

### Premiere lecture brute valide du buffer 1

Le 10 octobre 2026, l'essai manuel suivant a abouti : 76 couples
adresse/valeur ont passe les validations du client. L'heure de reception
locale est le 9 octobre 2026 a 22:54:10 UTC ; ce n'est pas une heure de
mesure fournie par le poele. Aucune requete supplementaire n'a ete lancee
pour examiner ce resultat.

En rapprochant uniquement les adresses des definitions deja observees :

| Registre candidat | Adresse | Entier recu | Limite d'interpretation |
|---|---|---|---|
| `temp_air2_get` | 103 | 26 | Temperature ambiante candidate, unite et fraicheur a comparer |
| `temp_gas_flue_get` | 2 | 22 | Temperature des fumees candidate, non validee |
| `temp_probe_k_get` | 0 | 19 | Sonde candidate, role et unite non valides |
| `status_get` | 8 | 0 | Libelle OFF selon la carte ; observation cloud, pas preuve de fraicheur |
| `status_managed_get` | 232 | 0 | Ni 85 ON ni 170 OFF ; aucune correspondance validee |
| `real_power_get` | 11 | 5 | Niveau brut ; ne prouve pas une combustion ou une puissance en watts |
| `alarms_get` | 34 | 0 | Code brut ; absence d'alarme non deduite sans enumeration validee |
| `temp_air_set` | 33122 | 20 | Consigne candidate lue, aucune commande envoyee |

Ces valeurs ne sont pas des fixtures ni des constantes de fonctionnement.
La capture complete, les identifiants et les enveloppes cloud ne sont pas
enregistres. Il reste notamment a comparer la temperature candidate avec
l'affichage officiel, puis a etablir la fraicheur et les transitions.
Aucun assemblage d'octets, formule, etat HomeKit ou commande de controle
n'est introduit sur la seule base de cette lecture.

L'utilisateur a ensuite confirme une temperature ambiante affichee de 26,
apres une demande de comparaison avec l'application Nobis-Fi ou l'ecran du
poele (hors consigne). La source exacte de cet affichage reste a preciser.
Cette concordance ponctuelle soutient l'interpretation directe du registre
103 comme temperature ambiante, sans etablir une fraicheur garantie, une
precision ou le comportement sur plusieurs temperatures.

La relecture du client Python a la revision citee plus haut confirme que
`get_item_value` prend directement l'entier associe a l'offset, applique
le masque puis la formule. Il n'assemble pas deux adresses voisines pour
les flags de mot/endianness. Pour la formule `#` et le masque 65535 de
`temp_air2_get`, cette pratique communautaire donne 26 pour l'entier recu.
Cela ne justifie pas une conversion generale de tous les registres ni
l'execution de formules arbitraires dans le plugin.

L'utilisateur a precise que les 26 sont affiches dans l'application seule :
la telecommande servant de thermostat n'est pas encore rebranchee.
La concordance porte donc sur deux lectures possiblement issues du meme
cache cloud, pas sur une mesure physique independante. La valeur peut etre
ancienne ; sa source exacte et son age ne sont pas etablis. Elle ne doit pas
etre exposee comme une temperature ambiante actuelle dans HomeKit.
La validation physique et temporelle attend le retablissement normal de la
telecommande et une comparaison avec son affichage apres actualisation.

Vers 01:00 heure locale le 10 octobre, l'utilisateur a indique avoir
reallume la telecommande : elle affiche une temperature ambiante de 21.
La page contient encore la lecture recue a 00:54:10 heure locale, avant
ce retablissement, avec 26 a l'adresse 103. Cette ancienne lecture ne
constitue pas une comparaison simultanee ni la preuve d'un mauvais
registre. Une nouvelle lecture manuelle est necessaire pour comparer
le retour cloud apres le retablissement de la telecommande.

### Concordance avec la telecommande apres retablissement

Le 10 octobre 2026, l'utilisateur a rapporte une temperature ambiante de
22 sur la telecommande et a relance manuellement le diagnostic. La lecture
recue a 01:01:34 heure locale (23:01:34 UTC le 9 octobre) contient encore
76 couples valides ; l'adresse 103 renvoie maintenant 22, au lieu de 26
dans la lecture precedente. Les valeurs aux adresses 0 et 2 restent
respectivement 19 et 22 ; l'adresse 8 reste a 0.

Cette concordance avec l'affichage physique, associee au changement du
registre 103 apres retablissement de la telecommande, soutient sur cet
appareil l'interpretation de `temp_air2_get` comme temperature ambiante
en degres Celsius, directement apres masque et formule `#`. Elle montre
que la valeur cloud peut evoluer et n'est pas restee bloquee a 26.
Elle ne donne pas l'heure de mesure, le delai de propagation, une garantie
de fraicheur future ou une precision inferieure au degre. La valeur 21
precedemment annoncee sur la telecommande n'a pas fait l'objet d'une
lecture cloud simultanee ; aucun echantillon a 21 n'est donc revendique.

Les transitions de fonctionnement, le code 0 de `status_managed_get`,
les commandes et les modes de consigne restent non valides. La concordance
thermique n'autorise pas a deduire Active, Heating ou une absence d'alarme.

### Decodeur thermique borne au profil observe

Un decodeur pur independant du reseau et de HomeKit est ajoute pour le
profil observe : buffer 1, `temp_air2_get`, GET, offset 103, masque 65535,
formule `#`, mot little-endian non signe. Tout autre profil est refuse
explicitement, sans selection d'une sonde de remplacement. L'entier API
est deja une valeur de registre selon la pratique Python examinee :
aucun assemblage d'adresses voisines ni execution de formule n'est fait.
Le domaine accepte est celui d'un mot non signe (0 a 65535), pas une plage
physique validee ; aucune saturation ni troncature ne masque une erreur.

Le resultat conserve l'heure de reception et indique une fraicheur inconnue.
Il ne fournit aucun etat thermique ni date de mesure. Les tests utilisent
uniquement des valeurs fictives et couvrent les profils modifies, les
valeurs manquantes/invalides et l'absence de repli ou de reconstruction.
Ni la plateforme ni le diagnostic brut n'appellent ce decodeur a ce stade.

Le diagnostic navigateur dispose ensuite d'un mode temperature distinct :
sur clic explicite, il recupere la carte, lit une fois le buffer 1 puis
applique ce decodeur. La page recoit uniquement le resultat thermique,
sans identifiants, carte ou autres valeurs brutes. Les erreurs de profil
ou de valeur ne deviennent pas des reussites et n'entrainent aucun repli
ou nouvel essai. L'avertissement de fraicheur inconnue reste visible.
Le CLI brut et la plateforme restent inchanges, sans exposition HomeKit.

Compilation et lint reussis ; 111 tests passent sous Node 22 et Node 24.
Le nouveau mode a aussi ete verifie dans le navigateur avec une reponse
fictive interceptee avant tout appel serveur : affichage de la valeur,
heure de reception distincte de la mesure, avertissement et effacement.
L'interception a ete retiree et la page rechargee apres cette verification.
Aucune nouvelle session Agua-IoT reelle n'a ete lancee par l'assistant.

### Premiere exposition HomeKit experimentale en lecture seule

Une option GUI distincte, desactivee par defaut et exigeant enableCloud,
active un TemperatureSensor. Thermostat et HeaterCooler ne sont pas retenus
a ce stade : ils exigeraient des consignes/modes ou etats de chauffage
qui ne sont pas encore valides. Aucun Active, Heating ou controle n'est
deduit des registres observes.

Chaque cycle verifie la carte, lit le buffer 1 et decode le profil strict.
Seule une valeur dans les bornes HAP permet de publier/actualiser le capteur.
Son UUID derive des identifiants produit/appareil, pas de son nom ; le cache
est restaure sans doublons et retire si l'option est desactivee.
Les GET HomeKit sont locaux. Une erreur, le demarrage ou l'arret invalide
la valeur exposee : StatusFault et SERVICE_COMMUNICATION_FAILURE, sans
temperature fictive ni lecture reseau declenchee par Apple Maison.

L'age de mesure cloud reste inconnu, meme lorsque les requetes reussissent.
HomeKit ne transporte pas cette nuance dans CurrentTemperature ; l'option
et la documentation l'annoncent explicitement. Cette exposition est
experimentale, inadaptee aux automatisations critiques. Les tests emploient
l'API Homebridge et les services HAP reels avec reponses cloud fictives ;
ils ne valident pas l'affichage dans Apple Maison ou un appareil reel.

Validation : compilation et lint reussis, 121 tests passent sous Node 22 et
Node 24. Les nouvelles regressions couvrent la publication du service HAP
reel, le GET sans reseau, le cache/UUID, la panne et la reprise, le profil
incompatible, le refus hors bornes sans saturation, la desactivation,
le retrait d'un ancien appareil et l'arret pendant un job. Un capteur
restaure est mis en defaut des configureAccessory, meme lorsque la
configuration est invalide : aucune ancienne temperature n'est servie
comme mesure actuelle apres redemarrage.

### Premier retour utilisateur dans Apple Maison

Le 10 octobre 2026 vers 01:37 heure locale, apres installation de la beta
sur Homebridge dans un conteneur du NAS et configuration du capteur,
l'utilisateur a confirme une temperature remontee de 21, identique a celle
de la telecommande. Ce retour valide une premiere concordance de la chaine
cloud, decodage, Homebridge et affichage Maison sur cette installation.
Il s'agit d'un retour utilisateur, pas d'une observation directe de Maison
par l'assistant ni d'un test automatise.

Ce resultat ne valide pas les commandes, les phases de chauffage, les
redemarrages/reconnexions reels ou une garantie de fraicheur. Les valeurs
comparees physiquement incluent maintenant 22 puis 21, sans heure de mesure
fournie par l'API. La limite de cache cloud reste applicable.

### Redemarrage et reprise apres job termine sans resultat

Le 10 octobre 2026 vers 01:44, l'utilisateur a confirme que le capteur
fonctionne apres redemarrage de Homebridge. Il a ensuite fait monter la
temperature de la telecommande en la tenant dans sa main. Maison a
temporairement signale l'impossibilite de recuperer la temperature, puis
affiche la nouvelle valeur apres fermeture et reouverture de l'application.
Les temperatures exactes de cette transition n'ont pas ete communiquees.

Les deux lignes de journal fournies indiquent :

- 01:39:48 : deviceJobStatus indisponible, statut `terminated` ;
- 01:41:49 : lecture reussie, 181 definitions.

Le delai observe de 121 secondes est compatible avec la temporisation
progressive du plugin et le temps des requetes ; il ne mesure pas le delai
de propagation de la temperature. Le statut `terminated` ne fournit pas
de cause et ne prouve ni une extinction du poele ni une expiration de
session. Le plugin met le capteur en defaut puis retablit sa valeur lors
d'un cycle valide, sans conserver une ancienne valeur comme succes.

La reouverture de Maison n'est pas une cause etablie de la reprise :
les GET HomeKit ne lancent pas de lecture cloud. Ce retour soutient le
fonctionnement apres redemarrage, l'evolution de la temperature et une
reprise reelle apres erreur de job, sans certifier tous les scenarios
de panne, l'absence de doublons ou la fraicheur de chaque mesure.

### Finalisation locale de la beta en lecture seule

Apres ces retours, les journaux distinguent une actualisation du capteur
de la seule decouverte des definitions et annoncent le delai du prochain
cycle apres erreur, sans valeur privee. La regression appareil hors ligne
confirme un defaut de communication sans lecture de buffer ni etat OFF.
Compilation et lint reussis ; 122 tests passent sur Node 22 et Node 24.

Le paquet npm a aussi ete genere et extrait dans un dossier temporaire :
son point d'entree est charge hors du projet, l'enregistrement de la
plateforme et la presence de l'option GUI desactivee par defaut verifies.
Les 61 fichiers distribues restent limites au code compile, au schema et
aux documents publics, sans dependance runtime ni hook d'installation.
Le dossier temporaire est retire apres verification.

Ces modifications sont locales et non publiees, listees dans Unreleased.
La version 0.1.0-beta.0 deja publiee ne doit pas etre reutilisee.
Le capteur lecture seule est fonctionnel sur l'installation utilisateur ;
le plugin pilotable complet reste bloque par les commandes et transitions
non validees. Aucun appel de controle ni nouvelle lecture cloud reelle
n'a ete effectue pendant cette finalisation.

### Reexamen des commandes de l'ancien plugin Homebridge

Le code public de securechicken/homebridge-micronova-agua-iot-stove a ete
reexamine a la revision `fa02345cd83d1b151220d3df09d249964fb3f525`.
Le README annonce seulement Piazzetta et Jolly Mec comme testes, et indique
que le projet n'est plus maintenu. La table des marques de cette revision
ne contient pas Nobis : ne pas confondre compatibilite generique annoncee
avec validation Nobis. Un autre fork peut avoir ajoute cette marque.

Son ecriture utilise POST `deviceRequestWriting`, avec id_device,
id_product, Protocol `RWMSmaster`, BitData 8, Endianess `L`, et tableaux
Items, Masks, Values d'un element. Offset et masque proviennent de la
carte ; la valeur passe par formula_inverse et les bornes du registre.
Le code utilise temp_air_set pour la consigne, power_set pour le niveau,
et status_managed_get pour les demandes ON/OFF, dont les valeurs sont
derivees des metadonnees. Ce sont des faits d'implementation communautaire,
pas des commandes validees sur l'A8.

Il suit idRequest via deviceJobStatus et considere la presence de
NackErrCode comme erreur, quelle que soit sa valeur. L'absence de ce champ
ne prouve pas a elle seule un changement physique. Le code met notamment
Active a jour apres acquittement d'ecriture : ce comportement optimiste
ne sera pas repris. Notre lecture reelle de status_managed_get a donne 0,
hors des libelles ON/OFF observes ; ses semantiques restent bloquees.

Le package declare AGPL-3.0-only. Aucun code n'est copie dans notre projet
Apache-2.0 ; l'inspection renseigne uniquement le protocole et les limites.
Sources : [code](https://github.com/securechicken/homebridge-micronova-agua-iot-stove/blob/fa02345cd83d1b151220d3df09d249964fb3f525/index.js),
[README](https://github.com/securechicken/homebridge-micronova-agua-iot-stove/blob/fa02345cd83d1b151220d3df09d249964fb3f525/README.md),
[package](https://github.com/securechicken/homebridge-micronova-agua-iot-stove/blob/fa02345cd83d1b151220d3df09d249964fb3f525/package.json).

### Commandes du projet Legobas vise par l'utilisateur

L'utilisateur a precise qu'il visait Legobas/micronova2mqtt. La revision
actuelle examinee est `c977ea09b41d66f720338963e8f5d2c8376f61a4`,
distincte de celle de l'etude initiale. Son brands.yml contient explicitement
Nobis-Fi, customer-code 700700, domaine nobis.agua-iot.com.
Il s'agit d'une configuration de marque, pas d'une preuve de tests sur A8.

Dans micronova.go, SetPower utilise des constantes communes aux marques :
adresse 232, valeur 85 pour ON, 170 pour OFF, masque 65535. Ce masque
differe du masque 255 de status_managed_get dans la carte inspectee sur
notre appareil. Ne pas les substituer automatiquement : une difference
lecture/ecriture est possible, mais non etablie.

writeDevice.go construit POST deviceRequestWriting avec Protocol RWMSmaster,
BitData 8, Endianess L, id_device/id_product et tableaux Items/Values/Masks
d'un element. SetParameterByRegKey trouve le parametre puis verifie minimum
et maximum ; setParameter envoie directement l'entier demande, sans
appliquer formula_inverse dans cette fonction. Les parametres sont
dynamiques : ce code ne fournit pas une table de commandes propre a l'A8.

deviceJob.go suit le job et reconnait completed, mais son modele de
jobAnswerData ne declare pas NackErrCode. Ce code n'etablit donc pas
une verification explicite du refus de commande par ce champ. Une
reponse completed ne sera pas assimilee au nouvel etat physique.
parameters.go deduit aussi actif de tout libelle non vide different de
`Off` ; ce comportement generique ne doit pas etre repris pour les
libelles FRE de notre carte.

Ces sources etablissent des candidats concrets d'ecriture ON/OFF et
de parametres, pas leur validation materielle. Aucun appel d'ecriture
n'a ete ajoute au transport ni effectue sur l'appareil.
Sources a cette revision :
[marques](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/brands.yml),
[commandes](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/micronova/micronova.go),
[ecriture](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/micronova/writeDevice.go),
[jobs](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/micronova/deviceJob.go),
[etats](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/micronova/parameters.go).

### Verification reelle des metadonnees de consigne

Le 10 octobre 2026 vers 10:24, apres une lecture manuelle des definitions,
la carte validee affiche pour temp_air_set : SET, offset 33122, masque
65535, formula et formula_inverse `#`, readonly false, minimum 7,
maximum 41, pas 1, is_word true, big_endian false, with_sign false.
La seule valeur enumeree est 41, avec le libelle FRE MAN.
Le profil exige par previewSetpoint est donc confirme dans cette carte.
Une verification hors ligne avec ces metadonnees et des identifiants
fictifs accepte une consigne candidate de 20 et refuse 41, sans reseau.
Cela valide la construction du candidat, pas son execution sur le poele.

power_set annonce SET, offset 33120, masque 65535, formules `#`,
readonly false, minimum 1, maximum 7, pas 1 et les memes flags de mot.
status_managed_get annonce GET, mais readonly false et formula_inverse
`#`, offset 232, masque 255, domaine 0 a 255, pas 1, is_word false,
big_endian false et with_sign false ; FRE enumere 85 ON et 170 OFF.
Cette observation precise la carte sans resoudre la difference avec le
masque ON/OFF 65535 constant dans micronova2mqtt. Aucun test d'ecriture,
changement de consigne ou allumage/extinction n'a ete effectue.

### Preparation autorisee du test manuel de consigne

Apres confirmation des metadonnees, l'utilisateur a autorise la preparation
d'un mode de test de consigne reelle. La route navigateur locale dediee
exige une confirmation booleenne et une consigne entiere de 7 a 40,
verifie la carte et la consigne initiale, puis envoie une seule requete
deviceRequestWriting selon le candidat communautaire. Une relecture
independante du buffer suit le job ; sa concordance ne prouve ni l'effet
physique ni la fraicheur. Un champ NackErrCode present bloque le test,
sans interpretation de sa valeur, meme 0.

La capacite d'ecriture est desactivee par defaut, jamais activee dans la
plateforme Homebridge. Le client ne repete pas l'ecriture sur HTTP 401,
timeout ou panne ; seules les consultations de job waiting sont suivies
dans le budget borne. Le navigateur exige une confirmation par tentative.
Le resultat incertain et l'obligation de verifier/restaurer manuellement
la consigne sont affiches. Il n'existe pas de commande ON/OFF ni de
restauration automatique. Aucun essai reel n'a ete effectue par l'assistant.

### Premier test utilisateur de consigne avec confirmation physique

Le 10 octobre 2026 vers 10:34, l'utilisateur a execute le test manuel :
consigne initiale relue 20, demande 28, consigne relue apres le job 20.
Il a confirme que la telecommande affiche bien la valeur demandee, 28.
Le resultat visible dans le navigateur confirme les trois valeurs du test.
La confirmation physique est un retour utilisateur, pas une observation
directe de la telecommande par l'assistant.

Ce test soutient le fonctionnement de l'ecriture du registre 33122 avec
le profil observe sur cet appareil. Il montre aussi que la relecture
immediate du buffer ne suffit pas a confirmer le nouvel etat : son retour
peut rester different alors que la telecommande affiche la demande.
Une actualisation differee du buffer est une hypothese plausible, mais
ni sa cause ni son delai ne sont etablis. Aucune commande supplementaire
ne doit etre envoyee pour corriger cette seule discordance.

La restauration manuelle de la consigne initiale reste a confirmer.
Le test ne valide pas ON/OFF, une transition de combustion, toutes les
consignes ou une garantie d'acquittement. HomeKit ne doit pas actualiser
optimistement la consigne sur la seule base de l'ecriture ou du job.

Le suivi du test est ensuite borne a trois lectures au maximum : premiere
lecture apres le job, puis cinq secondes d'attente avant chacune des deux
lectures supplementaires si la cible ne correspond pas. Arret sur
concordance, erreur ou budget global de deux minutes. Les observations
successives sont affichees ; aucune ecriture n'est repetee. Ces delais
sont une politique de diagnostic, pas un delai fournisseur valide.
Compilation et lint reussis, 133 tests passent sur Node 24 ; les 33 tests
cibles du suivi/diagnostic passent aussi sur Node 22. Une verification
mesure une attente reelle d'au moins cinq secondes sur les deux runtimes.
Aucun nouvel essai reel de commande n'a ete lance par l'assistant.

Vers 10:40, l'utilisateur a explicitement confirme la restauration de la
consigne initiale a 20 dans Nobis-Fi et son affichage a 20 sur la
telecommande. Le premier essai a 28 est donc clos avec restauration
physique confirmee par l'utilisateur. La page partagee montre seulement
une nouvelle lecture des definitions, pas un essai du suivi a trois
lectures ; aucun resultat materiel de ce nouveau suivi n'est revendique.

### Lecture de consigne sans nouvelle ecriture

Un mode distinct setpoint-read permet une lecture unique du buffer 1 apres
verification du profil reel de consigne. Il n'active pas les ecritures,
meme si la requete contient une cible ou une confirmation d'ecriture.
Le decodeur partage distingue temperature (7 a 40) et MAN (41 enumere
comme MAN en FRE), sans exposer ce dernier comme temperature. Le test
d'ecriture utilise aussi ce decodeur avant l'envoi, et refuse une
consigne initiale manuelle au lieu de supposer une valeur a restaurer.

Compilation et lint reussis, 136 tests passent sur Node 22 et Node 24.
L'affichage MAN et l'effacement ont ete verifies dans le navigateur avec
une reponse fictive interceptee ; interception retiree, page rechargee.
Aucun nouvel appel cloud reel ni ecriture n'a ete lance par l'assistant.
Les changements restent locaux, non publies sur le NAS.

Le 10 octobre 2026, l'utilisateur rapporte ensuite une lecture seule de
consigne a 20 degres Celsius, recue a 08:45:15.215Z (10:45:15.215 locale).
Cette valeur correspond aux 20 precedemment confirmes sur la telecommande
apres restauration. Cela valide cette lecture sur le profil reel, mais
ne mesure ni la fraicheur du buffer ni le delai de propagation d'une
ecriture : la valeur intermediaire 28 n'a pas ete observee dans le buffer.
Aucune nouvelle ecriture n'est necessaire pour constater cette concordance.

### Observation des codes d'etat, sans commande

Le diagnostic status-read verifie les profils GET observes : status_get
adresse 8, masque 65535, formule # ; status_managed_get adresse 232,
masque 255, formule #. Il lit une seule fois le buffer 1 et compare les
entiers bruts aux enumerations FRE de la carte. Il n'assemble pas de mot,
ne corrige pas la combinaison is_word/masque de status_get et n'applique
ni formule ni masque. Ce n'est donc pas un decodeur de phase HomeKit.
Une valeur hors du domaine du masque est refusee, pas tronquee.
Le libelle est absent explicitement pour une valeur sans enumeration FRE ;
notamment, 0 ne devient pas OFF pour status_managed_get.
Une carte incompatible, des valeurs absentes ou des libelles ambigus
font echouer la lecture. Aucun essai de transition ni commande ON/OFF
n'est ajoute. La correspondance physique et la fraicheur restent a valider.

Validation locale : compilation et lint reussis ; 141 tests passent
sous Node 24, et les 36 tests de diagnostic navigateur et observation
d'etat passent aussi sous Node 22. Les fixtures verifient notamment
la conservation du code gere 0 comme inconnu, les profils incompatibles,
les valeurs manquantes, l'affichage texte et l'effacement des resultats.

Lecture declenchee manuellement par l'utilisateur le 10 octobre 2026,
recue a 08:50:31.509Z : status_get = 0, libelle FRE OFF ;
status_managed_get = 0, sans libelle FRE. Le diagnostic conserve ce
second code comme inconnu. Aucune commande n'a ete envoyee.
La comparaison avec l'affichage physique actuel reste a recueillir ;
ce resultat seul ne valide ni une transition ni la fraicheur.

L'utilisateur confirme ensuite l'affichage actuel OFF / eteint.
Le code status_get 0 concorde donc avec cet affichage sur l'appareil
cible. Il s'agit d'un point de comparaison a l'arret, pas d'une
validation des phases de chauffe ou du registre gere, qui reste a 0.

### Integration des diagnostics dans Homebridge

Avec diagnostic et enableTemperatureSensor actives, la plateforme observe
les deux codes depuis la lecture de buffer deja effectuee pour la
temperature. Aucune requete supplementaire n'est ajoutee. Les messages
debug ne contiennent que les deux codes et la presence/absence d'un
libelle FRE, jamais les libelles libres, identifiants ou reponses completes.
Seuls les changements sont journalises ; une erreur de communication
efface la comparaison pour signaler de nouveau la premiere lecture valide.

Un echec de profil ou de valeur d'etat est signale explicitement, sans
faire echouer une temperature ambiante correctement validee. Les autres
erreurs restent soumises a la gestion normale du cycle. Aucun etat,
Active, Thermostat ou HeaterCooler n'est ajoute a HomeKit. Diagnostic
desactive ou decouverte seule : aucune observation de codes d'etat.

Compilation et lint reussis. Les 144 tests complets passent sur Node 22
et Node 24, notamment changements/suppression des messages identiques,
profil d'etat absent, reprise de temperature apres erreur, absence de
secrets dans les logs, maintien des UUID et arret des requetes au shutdown.
Le dry-run npm inclut les nouveaux modules compiles, le schema et la
documentation (70 fichiers), sans publication. La version npm et le
plugin installe sur le NAS restent inchanges.

### Observation au demarrage du poele

Le 10 octobre 2026, apres utilisation normale declenchee par l'utilisateur,
une lecture recue a 09:04:22.914Z (11:04:22.914 locale) donne status_get = 2,
avec le libelle FRE de debut fourni par la carte. status_managed_get reste
a 0 sans libelle. L'utilisateur indique que cela correspond au poele qui
commence son fonctionnement. Bien qu'il ait precedemment choisi TRAVAIL
dans la question de comparaison, cette lecture ne contient pas le code 5 :
elle documente le demarrage, pas la phase de travail etabli. Le code 2
ne doit pas etre converti en chauffe active HomeKit sur cette seule base.
Aucune ecriture n'a ete envoyee par l'assistant.

### Observation en phase TRAVAIL

Le 10 octobre 2026, la lecture declenchee par l'utilisateur et recue a
09:20:01.599Z (11:20:01.599 locale) donne status_get = 5, libelle FRE
TRAVAIL. L'utilisateur confirme simultanement l'affichage TRAVAIL.
Cela ajoute une concordance sur l'appareil cible apres les observations
OFF (0) et debut (2). status_managed_get reste a 0 sans libelle, y compris
en fonctionnement : ce code ne peut donc pas servir de booleen marche/arret.
La lecture ne mesure pas la fraicheur, ne valide pas les autres phases
et ne resout pas le masque d'ecriture ON/OFF. Aucune commande n'a ete
envoyee par l'assistant pour cette observation.

### Observation en phase d'arret

Le 10 octobre 2026, la lecture declenchee par l'utilisateur et recue a
09:22:09.396Z (11:22:09.396 locale) donne status_get = 7, avec le libelle
FRE d'arret fourni par la carte. L'utilisateur confirme que le poele
est en train de s'arreter et que l'affichage correspond.
La sequence observee est donc 0 OFF, 2 debut, 5 TRAVAIL, puis 7 arret.
Le code 7 decrit une phase d'arret, pas un appareil deja eteint :
aucun retour final a OFF n'est revendique pour cette sequence.
status_managed_get reste a 0 sans libelle dans cette phase aussi.
La fraicheur et le masque de commande ON/OFF restent non valides.
Aucune ecriture n'a ete envoyee par l'assistant.

### Modele des phases observees

Le modele independant de HomeKit distingue off (0/OFF), starting
(2/libelle FRE de debut accentue), working (5/TRAVAIL) et stopping
(7/libelle FRE d'arret accentue). Il exige une correspondance exacte de
la paire code/libelle pour le profil de lecture deja verifie. Les codes
non compares deviennent unknown/unvalidated-code ; un libelle absent
ou different pour les quatre codes devient unknown/label-mismatch.
Les deux raisons sont explicites et conservees dans le diagnostic.
Le code gere n'est pas utilise pour choisir la phase.

Les phases sont affichees dans le diagnostic existant et les logs
Homebridge sans nouvelle requete. Stopping n'est jamais off.
Il n'y a aucune inference de combustion, de valeur Active ni de
caracteristique HomeKit de chauffage. Les phases restantes, la fraicheur
et le masque d'ecriture restent non valides. Le retour final OFF de
la sequence demarree le matin n'est pas encore observe.

Validation : compilation/lint reussis, 147 tests complets sous Node 24
et 62 tests des surfaces modifiees sous Node 22. Les tests couvrent
les quatre paires, les autres codes, les libelles modifies/absents,
l'absence d'Active, ainsi que les reponses UI incoherentes (par exemple
code 7 presente comme off), refusees avec effacement de l'ancien affichage.
Le rendu arret en cours a aussi ete verifie dans le navigateur avec
une reponse fictive interceptee, puis interception retiree et page
rechargee sans identifiants. Aucun nouvel appel cloud reel n'a ete
declenche par l'assistant. Les changements restent locaux non publies.

### Nouvelle verification du masque de commande

Le 10 octobre 2026, le Swagger public Nobis a de nouveau ete consulte
(version 2.1.0.0). deviceRequestWriting decrit Masks comme un tableau
de masques de variables, sans valeur par defaut, regle de largeur ni
explication propre a Nobis. Masks n'est pas dans la liste required.
Son caractere optionnel n'autorise pas a l'omettre arbitrairement.
BitData est un entier et Endianess une chaine dans ce contrat.

Dans py-agua-iot a la revision db3dd530772b68b67473432301f2b8635c13dc19,
__request_writing prend le masque directement dans la carte du registre.
turn_on et turn_off appellent cette methode pour status_managed_get :
ce chemin utiliserait donc 255 avec la carte observee, contrairement au
65535 fixe de SetPower dans micronova2mqtt. Le Python construit toutefois
BitData et Endianess comme des tableaux, contrairement au Swagger et au
Go ; cette difference ne sera pas copiee dans notre transport.
Il expose aussi status_managed_on_enable en lecture, mais son existence
et sa signification sur l'appareil cible n'ont pas ete verifiees.

Le test Go buildWriteDeviceRequest emploie un masque fictif 255 et
verifie sa conservation dans le JSON. Ce n'est pas un test de SetPower
ni un essai materiel Nobis. Le corps Go transmet le masque tel quel ;
SetPower impose separement 65535 sans adaptation de marque. Une recherche
ciblee des issues du projet n'a apporte aucune justification du choix.

Conclusion : 255 n'est plus un candidat sans source, puisqu'il provient
de la carte reelle et du chemin d'ecriture Python. Cela ne prouve toujours
pas que cette commande fonctionne sur l'A8. Aucun essai automatique des
deux masques, retrait du masque ou ecriture a 65535 n'est autorise.
Une commande unique candidate a 255 necessite encore un test manuel
explicitement autorise, une verification physique et une relecture de
phase ; completed ou status_managed_get=0 ne valideraient pas l'effet.

Sources supplementaires :
[ecritures Python](https://github.com/fredericvl/py-agua-iot/blob/db3dd530772b68b67473432301f2b8635c13dc19/py_agua_iot/__init__.py),
[test de construction Go](https://github.com/Legobas/micronova2mqtt/blob/c977ea09b41d66f720338963e8f5d2c8376f61a4/micronova/writeDevice_test.go),
[Swagger Nobis](https://nobis.agua-iot.com/api-docs/swagger.json).

### Preparation autorisee du test manuel marche/arret

L'utilisateur a explicitement autorise la preparation d'un test manuel
le 10 octobre 2026, sans declenchement par l'assistant.
La route locale power-test exige action on/off et confirmation booleenne
avant authentification. La capacite experimentale est distincte de la
consigne et desactivee dans Homebridge et dans toutes les routes de lecture.

Le candidat exige les metadonnees reelles completes de status_managed_get
(GET, readonly false, 232/255, #/#, 0..255/pas 1, octet/little/non signe,
enumerations FRE exactes 85 ON et 170 OFF). La lecture initiale exige
off pour on ou working pour off. Ces conditions cloud ne remplacent
pas la verification physique, explicitement demandee par la case UI.
Les phases transitoires ou inconnues bloquent l'envoi.

Le client reutilise la gestion de job d'ecriture unique : jamais de retry
du POST sur 401/reseau/timeout. Tout NackErrCode, meme zero, est refuse.
Un verrou commun interdit les ecritures concurrentes consigne/marche.
Apres completed exploitable, une seule relecture de phase est effectuee :
physicalEffectVerified et freshnessVerified restent false, meme si la
phase a change. Un echec apres envoi signifie resultat potentiellement
indetermine, avec notification explicite, sans commande inverse.
Le masque 65535 n'est ni propose ni essaye automatiquement.

Compilation/lint reussis ; 154 tests complets sous Node 24 et 69 tests
cibles commandes/diagnostic/Homebridge sous Node 22. Les tests verifient
les corps exacts on et off, la confirmation obligatoire, les phases et
masques refuses, Nack zero, 401/reseau sans repetition, echec de relecture,
concurrence entre ecritures et annulation a l'arret. L'interface a ete
verifiee avec une reponse fictive interceptee ; interception retiree et
page rechargee, sans action choisie ni confirmation cochee.
Aucune nouvelle commande reelle n'a ete envoyee par l'assistant.
Cette preparation ne valide pas le masque sur appareil et reste locale,
non publiee et non activee dans Homebridge.

### Premier essai manuel ON avec masque 255

Le 10 octobre 2026, l'utilisateur a lance le test manuel ON. Le resultat
affiche une commande unique avec masque 255, une phase initiale 0/off
et une relecture 1/unknown recue a 09:43:05.662Z (11:43:05.662 locale).
L'utilisateur confirme ensuite que le poele a commence son demarrage.
Cela constitue un premier effet physique confirme pour ON avec ce masque
sur l'appareil cible, pas une validation universelle ni celle de OFF.
Le code 1 reste non valide dans le modele : aucun libelle exact affiche
sur la telecommande n'a ete recueilli pour cette phase.
La proximite temporelle ne prouve pas la fraicheur de tous les buffers
ni l'absence d'autres causes. Aucune repetition de commande n'est requise.
L'assistant a uniquement inspecte le resultat, sans cliquer ni commander.

Apres cet essai, vers 11:44 locale, l'utilisateur rapporte que
l'application affiche la phase debut et que son bouton d'arret est
desactive. Ce comportement de l'interface officielle est rapporte,
pas observe directement par l'assistant. Aucune nouvelle lecture ne
permet d'associer cet affichage au code 1 plutot qu'a un code ulterieur.
Il ne valide donc pas une nouvelle paire code/libelle. Le test local
conserve son interdiction d'arret depuis une phase de demarrage :
OFF experimental n'est autorise que depuis working/TRAVAIL.
Ne pas contourner le bouton desactive ni envoyer une commande inverse
pendant cette transition.

### Premier essai manuel OFF avec masque 255

Le 10 octobre 2026, l'utilisateur confirme que l'arret fonctionne apres
le test manuel OFF. Le resultat de la page affiche une commande unique
off, masque 255, phase initiale 5/working et relecture 5/working recue
a 10:03:49.334Z (12:03:49.334 locale). La confirmation physique provient
du retour utilisateur ; la relecture immediate ne montre pas encore
une transition vers 7/arret ni 0/off. La cause et le delai de cette
discordance ne sont pas etablis.

Les premiers essais ON et OFF avec masque 255 ont maintenant chacun
un effet physique confirme par l'utilisateur sur l'A8 cible. Cela ne
valide pas toutes les conditions de fonctionnement ni la fraicheur
du buffer. Aucune repetition de OFF n'est justifiee par le code 5 relu.
Le modele reste working pour cette lecture, sans mise a jour optimiste
vers stopping ou off. L'assistant a uniquement inspecte le resultat.

### Integration locale de l'interrupteur HomeKit experimental

Apres les confirmations manuelles ON/OFF, l'utilisateur a demande de
poursuivre et precise le modele de l'application : interrupteur separe
de la consigne, ventilation/auto et programmes. La premiere integration
locale conserve un Switch separe du TemperatureSensor, meme accessoire
et UUID. enablePowerSwitch est false par defaut, exige cloud et capteur
et s'active dans la GUI. Consigne HomeKit, ventilation, auto et programmes
restent hors de cette implementation faute de validation complete.

Le booleen On n'est expose que pour les phases stables working/TRAVAIL
et off/OFF. Les transitions et autres codes rendent le GET indisponible.
Il ne s'agit pas d'un etat de combustion ni du registre gere toujours a 0.
Les SET identiques ne commandent rien. Un SET different reverifie appareil,
carte et phase via l'API avant l'envoi unique. Aucun effet physique n'est
deduit du job et aucune valeur demandee n'est appliquee de facon optimiste.
HAP assigne normalement la valeur demandee apres un setter reussi :
le setter ne reussit donc que si sa cible a effectivement ete relue.
Sinon il signale une erreur HAP et laisse le Switch indisponible.
Un SERVICE Switch n'a pas StatusFault standard : aucun champ supplementaire
non standard n'est ajoute ; l'erreur est portee par On/GET.

Une commande en attente bloque tout nouveau SET, y compris inverse.
Avant l'envoi, un marqueur on/off est cree exclusivement en 0600 dans
le dossier prive Homebridge, synchronise ainsi que son repertoire.
Ce stockage explicite est necessaire car Homebridge journalise mais
absorbe les erreurs de sauvegarde de cache : le seul contexte accessoire
ne garantirait pas un echec avant envoi en cas de panne disque.
La lecture du marqueur refuse fichiers invalides/symboliques et ne
rejoue jamais la commande. La phase cible working pour ON ou off pour
OFF efface le marqueur, avec notification. Une commande sans cible
observee peut rester bloquee, y compris apres redemarrage/desactivation ;
aucun timeout n'efface artificiellement cette incertitude.

La fraicheur n'est pas garantie ; utilisation supervisee uniquement.
Le fonctionnement de cette integration dans Apple Maison sur le NAS
reste a verifier : seuls les tests manuels du diagnostic et les tests
HAP automatises ont ete effectues. Aucune publication nouvelle.

Validation finale de cette integration : compilation, lint et diff-check
reussis ; 166 tests complets passent sous Node 22 et Node 24. Les tests
HAP et plateforme verifient ON et OFF, relecture immediate inchangee,
transitions, confirmation ulterieure depuis le polling, verrou conserve
au redemarrage meme sans contexte accessoire, absence de replay, services
sans doublon et retrait de l'interrupteur si l'option est desactivee.
Les tests de stockage verifient 0600, ecriture exclusive, conservation
du marqueur et refus des fichiers corrompus/symboliques.
Le dry-run du paquet contient les modules de controle et le schema
(79 fichiers), sans tests ni marqueurs prives. La version locale porte
encore beta.0 : une nouvelle version est obligatoire avant publication,
puisque beta.0 est deja publiee. Aucun test automatise ne commande le poele.

### Premier retour ON depuis Apple Maison, beta.1

Le 10 octobre 2026 vers 14:58 locale, l'utilisateur rapporte que le
bouton Maison a lance le poele, maintenant en phase debut. Apres le
clic, l'interrupteur est redescendu et affiche sans reponse.
Ce comportement correspond au setter HAP qui refuse de confirmer
la cible tant que TRAVAIL n'a pas ete relu ; la position visuelle
redescendue ne constitue pas une observation OFF de l'API.
La reprise de disponibilite une fois TRAVAIL atteint reste a confirmer
pour cet essai reel depuis Maison. Aucun nouvel ON ne doit etre envoye.

L'utilisateur indique aussi que l'application officielle permet
maintenant de lancer l'extinction pendant la phase debut, contrairement
au bouton desactive rapporte a 11:44. La restriction ne peut donc pas
etre presentee comme une regle generale Nobis. Les conditions exactes
(sous-phase, code actuel, permissions ou delai) ne sont pas etablies.
La beta.1 conserve par politique experimentale son refus OFF depuis
le demarrage et son verrou de commande pending ; ce n'est pas une
preuve d'interdiction par l'API. Aucun essai OFF pendant debut ni
nouvelle paire code/libelle n'est valide par cette seule disponibilite UI.

### Confirmation du cycle depuis Apple Maison, beta.1

Le 10 octobre 2026 vers 15:27 locale, l'utilisateur confirme que tout
a fonctionne comme prevu : une fois le poele en TRAVAIL, l'interrupteur
Maison est redevenu active, puis il a pu eteindre le poele depuis Maison.
Ce retour confirme la reprise apres le pending ON et un premier effet
physique OFF depuis l'integration HomeKit beta.1 sur son installation.
Les heures exactes des lectures, le delai de propagation et le retour
final du Switch a OFF apres refroidissement ne sont pas fournis :
ils ne sont pas revendiques. Aucun test d'arret pendant debut,
redemarrage avec commande pending ou autre modele n'est valide par ce
cycle. Le controle reste experimental, opt-in et supervise.

Le 10 octobre 2026 vers 15:28 locale, l'utilisateur confirme aussi
le retour final de l'interrupteur a OFF. Le cycle complet depuis Maison
sur beta.1 est donc rapporte, sans mesure de son delai exact.

### Tuile Chauffage et consigne beta.2

L'utilisateur a valide le maintien de l'interrupteur et l'ajout d'une
tuile HeaterCooler. Ce service standard permet l'affichage d'un seuil
de chauffage dans Maison, contrairement a un curseur custom Celsius.
Le mode cible HEAT seul exprime la capacite de chauffage. Il ne simule
ni regulation AUTO ni programmation Nobis. Le CurrentHeaterCoolerState
HEATING correspond a la phase TRAVAIL validee, INACTIVE a OFF ;
les autres phases sont indisponibles, sans deduction de combustion,
IDLE ou etat depuis comparaison temperature/consigne.

enableSetpointControl exige toutes les activations precedentes et reste
false par defaut. La temperature, le Switch et HeaterCooler partagent le
meme UUID. Les services caches sont mis en erreur avant premiere lecture
et retires si leur option est desactivee, sans effacer l'incertitude
d'une commande. Les caracteristiques de controle sont locales au GET ;
les SET reverifient appareil, carte, phase et consigne avant envoi.

La consigne exige le profil reel temp_air_set, 7..40 entiers, et bloque
MAN plutot que l'afficher en Celsius. Une ecriture unique n'est suivie
que de lectures : immediatement, puis au polling normal. Jamais de retry
ou restauration de commande. Un marqueur setpoint-pending-UUID, prive
0600, synchronise avant l'envoi, conserve la cible jusqu'a relecture
concordante et survit au redemarrage. Le stockage de commande est partage
avec le verrou power existant sans modifier ses fichiers ni leur format.
Toutes les commandes des deux services partagent un verrou d'execution
et refusent l'ecriture tant qu'une cible est incertaine.
Un SET n'est acquitte par HAP qu'apres concordance avec la valeur relue,
pas d'assignation optimiste de la cible demandee.
Les absences de relecture et les erreurs de stockage sont explicites.

Cette tuile n'a pas encore ete testee sur le poele via Apple Maison.
La verification se fait par mocks/HAP reels, sans commandes physiques.
La ventilation, la puissance, le mode auto et les programmes restent
a etudier ; aucun registre n'est assimile a ces fonctions sans preuve.

Validation du lot beta.2 : compilation/lint et diff-check reussis,
175 tests complets passent sur Node 22 et Node 24. Les tests HAP
verifient le seuil Celsius, HEAT seul, MAN sans valeur fictive, les
transitions, les setters sans mise a jour optimiste et le cache.
Le test de plateforme verifie l'ecriture de consigne unique puis
confirmation au polling, le blocage du Switch pendant pending et la
conservation de sa temperature/UUID. Un marqueur de consigne restaure
bloque aussi le Switch lorsque la tuile Chauffage est desactivee.
Les fichiers de stockage power existants restent compatibles.

La version 0.1.0-beta.2 est preparee dans package.json et le lockfile,
apres verification que le registre ne contient que beta.0/beta.1.
Le dry-run npm inclut 82 fichiers, les nouveaux modules compiles et
le schema, sans marqueurs prives. Aucune publication ni commande
reelle n'a ete effectuee par l'assistant pour ce lot.

Le 10 octobre 2026 vers 20:33 locale, l'utilisateur rapporte que tout
fonctionne apres le lot de consigne beta.2. Il indique aussi que
l'application officielle permet de modifier la consigne poele eteint.
Le code beta.2 autorise deja les ecritures de consigne depuis off/OFF
comme working/TRAVAIL, sans envoyer ON pour une modification de seuil.
Le retour ne precise pas encore si le curseur Maison est accessible
lorsque la tuile est inactive ; cette disponibilite UI ne doit pas
etre confondue avec une restriction du client ou de l'API.

### Variante Thermostat beta.3 : validation UI a effectuer

L'utilisateur confirme ensuite que le curseur Maison est masque ou grise
quand le poele est eteint, puis autorise une variante Thermostat a tester.
Le service HeaterCooler beta.2 est retire et remplace par Thermostat sur
le meme accessoire, subtype heating et UUID ; Switch et capteur restent.
Les caracteristiques standard utilisees sont CurrentTemperature,
TargetTemperature (7..40, pas 1), CurrentHeatingCoolingState,
TargetHeatingCoolingState (OFF/HEAT uniquement) et TemperatureDisplayUnits
Celsius. Les deux etats sont OFF depuis la phase OFF validee et HEAT depuis
TRAVAIL ; aucune mesure de combustion ou regulation AUTO n'est revendiquee.
Transitions, MAN et commandes incertaines restent indisponibles.
Modifier TargetTemperature ne change pas le mode et n'envoie jamais ON.
Les commandes, profils API, verrous persistants et absence de retry restent
inchanges. Aucun endpoint ni format cloud n'est ajoute.

L'acces au curseur Thermostat en OFF dans Apple Maison est une hypothese
de presentation a verifier sur le NAS, pas un fait etabli par HAP ou
les tests automatises. Le plugin ne force pas HEAT pour contourner l'UI.
Le registre npm contient beta.0, beta.1 et beta.2 lors de la preparation ;
beta.3 est un nouveau numero, sans publication par l'assistant.

Validation beta.3 : compilation et lint reussis ; 176 tests fictifs
reussis sous Node 24 et Node 22. Le test d'ecriture depuis OFF confirme
TargetTemperature relue, deux etats Thermostat OFF et Switch false.
La migration de service conserve UUID, capteur, Switch et commandes
incertaines sans replay. Le dry-run npm contient 82 fichiers,
modules compiles et schema compris, aucun etat prive ; manifestes
package et lockfile sont synchronises en 0.1.0-beta.3.

Le 10 octobre 2026 a 22:08 locale, l'utilisateur rapporte que le curseur
est reste grise apres l'essai de la variante Thermostat. L'hypothese
d'un acces au seuil en OFF via ce changement de service n'est donc pas
confirmee sur son installation. Ce resultat concerne le rendu Maison,
pas un refus API d'ecriture a l'arret ; aucun nouveau test cloud n'est
effectue. Ne pas forcer HEAT ni inventer un etat actif pour contourner
le rendu. Nobis-Fi reste le moyen confirme par l'utilisateur pour regler
la consigne a l'arret. Aucun autre contournement HomeKit n'est valide ici.

### Reglages puissance et ventilation : definitions et interface officielle

Le 10 octobre 2026, apres une nouvelle decouverte en lecture seule lancee
par l'utilisateur dans le diagnostic local, les definitions affichees sont
examinees sans lire les champs d'identifiants ni envoyer de commande.
L'utilisateur confirme que Nobis-Fi propose sur son appareil :
puissance 1..7, ventilation avant 0..7 et 8 pour PS, Auto ON/OFF,
Powerful ON/OFF. Cela confirme la presence des reglages dans l'interface,
pas encore leur correspondance avec des valeurs de buffer ou une ecriture.

| Candidat de la carte | Offset | Masque | Domaine annonce | Enumerations FRE |
|---|---|---|---|---|
| power_set | 33120 | 65535 | 1..7 | aucune |
| vent_front_set | 33132 | 65535 | 0..8 | 0 OFF, 8 PS |
| fun_auto_set | 33128 | 65535 | 0..1 | 0 OFF, 1 ON |
| fun_pwf_set | 33154 | 65535 | 0..1 | 0 OFF, 1 ON, 2 CRONO |

Ces quatre definitions sont SET, readonly false, formule et inverse #,
pas 1, is_word true, big_endian false et with_sign false.
fun_pwf_set est un candidat pour Powerful, pas une correspondance validee.
Sa valeur enumeree 2 CRONO est hors du domaine set_max 1 : ne pas elargir
la plage ni envoyer 2 sur la seule base de l'enumeration.

vent_front2_get (16, masque 255) annonce 0 OFF, 1 RIS puis 2..8
libelles 1..7 ; il n'est donc pas interchangeable avec vent_front_set.
real_power_get (11, masque 255) annonce 8 PWR-FULL, pas des watts
ni une preuve suffisante de l'etat du bouton Powerful.
Les registres de canalisation/arriere et de programmation ne sont pas
actives du seul fait de leur presence dans cette carte partagee.
Prochaine validation : comparer les quatre consignes brutes du buffer 1
aux valeurs affichees dans Nobis-Fi, sans changement de reglage ni ON/OFF.

L'utilisateur lance ensuite une lecture brute unique du buffer 1.
Valeurs observees : 33120 = 5, 33132 = 4, 33128 = 0, 33154 = 0.
Il confirme exactement puissance 5, ventilation 4, Auto OFF et Powerful
OFF dans Nobis-Fi. La correspondance est comparee pour ces quatre valeurs
uniquement ; aucun changement de reglage n'est demande ni envoye.
La meme lecture donne 16 = 0 et 11 = 5 : distinguer ventilation reglee 4
et lecture de fonctionnement 0, sans deduire pourquoi elles different.

Beta.4 ajoute /settings-read au diagnostic local protege : selection
appareil en ligne, carte puis un seul buffer 1. Les profils SET, bornes,
flags, masque et formules sont verifies exactement ; seules les quatre
consignes sont retournees, avec libelles FRE, reception, fraicheur unknown
et controlValidated false. Aucun flag d'ecriture n'est active sur cette
route, meme si les options du client ou champs du POST tentent de l'activer.
Powerful 2 CRONO reste refuse car set_max annonce 1. Les valeurs ne sont
pas mappees a HomeKit ni converties en vitesses, watts ou etats actifs.
L'interface efface les anciennes observations avant tentative et en cas
d'erreur ; les libelles sont rendus comme texte, jamais comme HTML.

Validation beta.4 : build/lint et 181 tests fictifs reussis sous Node 22
et 24, dont route protegee sans ecriture meme avec flags experimentaux,
profils incompatibles, valeurs hors domaine et affichage efface sur erreur.
Le registre contient beta.0 a beta.3 avant changement de numero.
package.json et lockfile passes en 0.1.0-beta.4 ; dry-run npm de 85 fichiers,
nouveau module compile compris, sans identite ni marqueur prive.
Aucune publication ni commande reelle par l'assistant.

### ECO STOP observe et activation conservee — beta.5

Le 11 octobre 2026, l'utilisateur signale ECO STOP dans Nobis-Fi et
indisponibilite dans Maison. Il lance le diagnostic d'etat en lecture
seule et confirme que Nobis-Fi affiche toujours ECO STOP a la reception.
Lecture recue le 10 octobre a 22:18:51.816 UTC (11 octobre 00:18 locale) :
status_get (8) = 8, libelle FRE exact ECO STOP ;
status_managed_get (232) = 0, sans libelle FRE correspondant.
L'utilisateur confirme que le poele reste active avec bouton d'arret
et reprise automatique attendue lorsque la temperature baisse.
La reprise elle-meme n'est pas observee dans ce test. Aucune commande.

Le decodeur ajoute uniquement la paire exacte 8/ECO STOP a eco-stop.
Beta.5 projette cette pause sur Switch ON et Thermostat cible HEAT,
CurrentHeatingCoolingState OFF (aucun chauffage courant), sans transformer
le mode en AUTO HomeKit ni deduire une temperature seuil ou combustion.
Le rendu Maison reste a tester. Les phases inconnues ou libelles differents,
MAN, erreurs et commandes incertaines restent indisponibles.
Les SET differents depuis ECO STOP sont refuses localement avant reseau ;
les verifications de phase API restent OFF pour ON, TRAVAIL pour OFF
et OFF/TRAVAIL pour consigne. Aucun elargissement implicite des commandes.
Une commande ON incertaine n'est toujours levee que par TRAVAIL, jamais
ECO STOP. Le diagnostic d'etat affiche la nouvelle phase explicitement.

Validation beta.5 : compilation/lint et 184 tests fictifs reussis sous
Node 22/24. Regression du polling sur accessoire cache : Switch true,
Thermostat cible HEAT/etat courant OFF, consigne relue ; changements
refuses sans requete. Un marqueur ON persistant reste present et rend les
tuiles indisponibles malgre ECO STOP. Libelles incorrects restent inconnus.
Paquet npm de 85 fichiers verifie, modules compiles inclus et etat prive
absent, version/lockfile 0.1.0-beta.5. Aucune publication par l'assistant.

### Extinction depuis ECO STOP — beta.6

Le 11 octobre 2026 a 00:24 locale, l'utilisateur precise qu'il peut arreter
le poele pendant ECO STOP. Interroge sur disponibilite UI ou effet constate,
il confirme avoir deja utilise l'arret depuis ECO STOP et constate
l'extinction reelle dans Nobis-Fi. Aucun nouveau test physique n'est demande.
Cela valide le comportement officiel rapporte, pas une capture de la
requete ni une nouvelle commande Agua-IoT envoyee par ce plugin.

Beta.6 elargit uniquement la condition initiale d'OFF a la paire validee
ECO STOP, sans changer le profil ni l'encodage deja utilise : registre
232, masque 255, valeur 170. ON exige toujours OFF, la consigne HomeKit
exige OFF/TRAVAIL. Les deux tuiles partagent les protections et le verrou
persistant ; une lecture ECO STOP apres OFF n'est pas une confirmation.
Seule la phase OFF leve ce verrou, jamais le job termine ou ARRET.
Le diagnostic manuel accepte aussi OFF depuis ECO STOP sur confirmation
explicite. Aucun retry, inverse automatique, elargissement aux phases
inconnues ou nouvelle commande reelle par l'assistant.
L'arret depuis ECO STOP via Maison reste a valider sur installation.

Validation beta.6 : compilation/lint et 187 tests fictifs reussis Node
22/24. Arret depuis code 8 teste via Switch et Thermostat avec job
termine/relecture ECO STOP puis ARRET puis OFF : aucun nouvel envoi,
verrou conserve jusqu'a OFF et aucune mise a jour optimiste.
Diagnostic manuel code 8 teste avec succes de job, 401, reseau et Nack :
une seule ecriture. Consigne ECO STOP toujours refusee sans reseau.
Paquet npm de 85 fichiers verifie, modules compiles inclus, etat prive
absent, version et lockfile 0.1.0-beta.6. Registre verifie avant preparation :
beta.0 a beta.3 seulement ; beta.4/beta.5 incluses dans ce nouveau lot.
Aucune publication ni commande de poele par l'assistant.

### Candidat de test manuel de ventilation avant — beta.7

Apres validation d'une premiere consigne brute 4 correspondant a Nobis-Fi,
preparation d'un test dedie sans envoi reel. Le format RWMSmaster,
BitData 8, Endianess L et tableaux Items/Masks/Values reprend le contrat
Swagger deja etudie et utilise pour la consigne. L'offset 33132, masque
65535, formule/inverse #, bornes 0..8, pas 1 et flags mot/little/non signe
proviennent de la carte observee, avec FRE 0 OFF et 8 PS.
Cela ne valide pas encore une ecriture vent_front_set sur l'appareil.

La route locale /ventilation-test exige confirmVentilationChange true et
level entier 1..7 avant toute communication. Elle selectionne un appareil
en ligne, lit la carte et un buffer 1, verifie la phase OFF/TRAVAIL, la
ventilation initiale 1..7, Auto/Powerful bruts 0 et une cible differente.
Ces conditions sont une politique experimentale prudente, pas une
contrainte API/manufacturier prouvee. ECO STOP, OFF/PS et mode automatique
restent exclus ; aucun ON n'est envoye pour rendre le test possible.

Capacite enableExperimentalVentilation separee, false par defaut et false
sur les routes de lecture, sans option Homebridge. Meme writeOnce et
verrou global que les commandes existantes ; un seul POST avec
Items [33132], Masks [65535], Values [level], aucun changement des autres
consignes, aucun retry de POST sur expiration, reseau, Nack ou timeout.
Un job termine autorise une relecture unique des quatre consignes.
La reponse conserve effet physique non confirme et fraicheur non verifiee,
meme sur concordance. Aucun mode PS, vitesse effective ou pourcentage deduit.
L'utilisateur releve puis restaure manuellement le niveau initial dans
Nobis-Fi ; aucun nouvel essai ni restauration automatiques.
La commande et l'effet physique restent a verifier, hors tests automatises.

Validation beta.7 : compilation/lint et 194 tests fictifs reussis Node
22/24 ; garde de phase/modes et cible identique, profils/encodages,
route protegee, confirmation par clic, POST unique, 401/reseau/Nack et
relecture ambigue couverts. Un test HTTP initialement imbrique dans un
test UI a provoque une annulation et attente Node 22 ; corrige en test
independant, puis suite Node 22 complete reexecutee avec succes.
Paquet npm de 88 fichiers verifie, module ventilation compile inclus,
sans etat prive. Version package/lockfile 0.1.0-beta.7 ; numero absent du
registre lors de la preparation. Aucune publication par l'assistant.

Interface beta.7 verifiee dans un navigateur sur un nouveau serveur local :
sans confirmation, aucun POST ; confirmation puis un POST intercepte
avec donnees fictives, relecture differente explicitement signalee,
mot de passe et confirmation effaces. Interception retiree et page rechargee.
Aucune requete Agua-IoT ni commande reelle pendant cette validation.

Le 11 octobre 2026 a 00:48 locale, l'utilisateur rapporte le succes du
test manuel de ventilation. Le resultat affiche indique avant 4, demande
6, relu 6, reception 10 octobre 22:48:29.053 UTC. Il confirme explicitement
Nobis-Fi a 6 et un changement de ventilation physique sur le poele,
puis restauration manuelle du niveau initial 4 dans Nobis-Fi.
L'assistant ne lit que les elements de resultat et ne commande pas le poele.
Premier succes physique de vent_front_set (33132), masque 65535, valeur
6 depuis 4 ; aucune validation generale des niveaux 1..7, OFF/PS,
ECO STOP, interactions Auto/Powerful ou autres modeles. La phase initiale
exacte n'est pas incluse dans le resultat affiche et n'est pas attribuee
retroactivement. La restauration a 4 est un retour utilisateur, pas une
nouvelle relecture API. Fraicheur, vitesse effective et delais non etablis.

### Etude de la tuile Ventilateur HomeKit

L'utilisateur prefere etudier une tuile Ventilateur avec echelle documentee
plutot que sept boutons de niveaux. Inspection du service Fanv2 fourni par
la dependance HAP installee : Active est obligatoire, lisible et inscriptible ;
RotationSpeed est optionnel, format float, unite percentage, bornes 0..100.
CurrentFanState est optionnel (INACTIVE, IDLE, BLOWING_AIR), comme
TargetFanState (MANUAL/AUTO). Ces definitions ne prouvent pas le rendu
Maison ni une correspondance des modes Nobis avec ceux de HomeKit.

Une echelle envisageable serait round(niveau * 100 / 7) :
1..7 correspondent a 14, 29, 43, 57, 71, 86, 100 pour cent.
C'est une normalisation de consigne, pas un pourcentage de debit, de
vitesse mesuree ou de puissance. Elle n'est pas implementee ni validee.
PS (8) ne doit pas etre sature a 100 ni converti en niveau 7.
L'arrondi inverse et les valeurs arbitraires envoyees par Maison devraient
etre testes ; une echelle documentee ne suffit pas a etablir la semantique.

Active pourrait representer l'activation de ventilation demandee, distincte
de CurrentFanState. Il ne doit pas etre fixe a 1 pour debloquer un curseur
ni derive de la seule phase TRAVAIL. La lecture observee vent_front_set = 4
avec vent_front2_get = 0 montre justement la difference entre consigne et
fonctionnement, sans etablir a elle seule le decodage du second registre.
Ne pas declarer BLOWING_AIR ou IDLE sans comparaison physique correspondante.
Le SET Active OFF demanderait vraisemblablement un niveau 0, encore non
valide ; Active ON ne doit pas allumer le poele, choisir un niveau arbitraire
ou restaurer automatiquement un niveau precedent.

Le signalement public Homebridge #3645 rapporte des SET RotationSpeed a
100 apres activation, dans un cas de Fanv2 detourne pour du volume.
Les commentaires indiquent un lien avec vitesse 0 puis activation et
une condition de concurrence. Ce n'est pas une preuve de comportement
sur toutes les versions de Maison/Homebridge ni une regle HAP ; un futur
test devrait couvrir les SET Active/RotationSpeed couples sans doublon.
Source : https://github.com/homebridge/homebridge/issues/3645

Conclusion : echelle possible comme convention explicite, mais tuile
pilotable pas encore justifiee par le seul essai 4 vers 6. Il reste a
valider OFF (0), PS (8), semantique d'activation et lecture de fonctionnement.
Le changement etudie n'ajoute aucun service ni commande, aucune nouvelle
version npm et aucun essai physique.

### Variante HeaterCooler avec ventilation integree (beta.8)

L'utilisateur propose HeaterCooler puis approuve cette variante.
Inspection des definitions HAP installees : Active,
CurrentHeaterCoolerState, TargetHeaterCoolerState et CurrentTemperature
sont obligatoires ; HeatingThresholdTemperature et RotationSpeed
sont optionnels. RotationSpeed est un pourcentage, pas un niveau Nobis.
La presence effective du curseur dans Maison n'est pas prouvee par HAP.

Implementation opt-in enableVentilationControl, false par defaut,
avec les quatre opt-ins precedents requis. Thermostat conserve sans
l'option ; migration HeaterCooler chauffage seul avec meme UUID/subtype,
capteur/interrupteur conserves. Active represente l'activation du poele,
pas une activation du ventilateur. Aucun Fanv2, CurrentFanState,
debit mesure ou commande OFF/PS nouveaux. OFF INACTIVE, TRAVAIL
ACTIVE/HEATING, ECO STOP ACTIVE/IDLE depuis les seules phases comparees.
La consigne peut toujours rester grisee dans Maison lorsque OFF.

Echelle conventionnelle round(niveau * 100 / 7), soit
14/29/43/57/71/86/100 pour cent. Inverse pour valeurs positives :
max(1, round(pourcentage * 7 / 100)). PS n'est pas sature a 100.
Le code HAP handleSetRequest installe confirme qu'un setter reussi
assigne normalement la valeur demandee. L'ajout de Perms.WRITE_RESPONSE
et le retour du pourcentage effectivement relu evitent ce comportement :
60 demande 4, puis 57 est conserve uniquement si la relecture confirme 4.
Sans concordance, erreur HAP et verrou ; pas de valeur optimiste.
Ce mecanisme est teste avec le vrai runtime HAP et des donnees fictives,
pas avec Maison ou une commande physique dans ce lot.

Les ecritures reutilisent previewFrontVentilation et le POST unique
33132/65535 deja essaye manuellement 4 vers 6. Frais appareil/carte/buffer
relus avant envoi, Auto/Powerful OFF, initial 1..7, phase OFF/TRAVAIL.
Les restrictions ECO STOP/transitions/OFF/PS restent des precautions,
pas des impossibilites fabricant. Relecture immediate puis polling
habituel, aucun retry/restauration/allumage associe.

VentilationCommandState conserve uniquement la cible 1..7 dans
ventilation-pending-UUID, permissions 0600, creation exclusive et
synchronisation avant POST. Verrou commun marche/arret/consigne/
ventilation, persistant sans cache Homebridge ; jamais rejoue ni efface
par desactivation de l'option. Suppression seulement apres niveau
exact relu sans libelle special, pas apres le job termine.
Les erreurs de profil ventilation sont isolees des temperatures et
etats valides ; un verrou incertain reste prioritaire.

Tests fictifs couvrant echelle/bornes, migration sans doublon, phases,
modes automatiques, libelles speciaux, arrondi HAP, corps POST exact,
persistance avant envoi, relecture ambigue, resolution par polling,
redemarrage option desactivee et 401/reseau/Nack sans retry.
Aucune requete Agua-IoT ni commande reelle par l'assistant pour beta.8.
Le rendu Maison, tous les niveaux et autres conditions restent a valider.

Validation beta.8 : compilation/lint et 207 tests fictifs reussis sous
Node 24 puis Node 22. Un fixture Nack mal nomme a ete corrige en
NackErrCode, conforme au contrat existant, puis les suites reexecutees.
Une execution Node 22 concomitante a la recompilation a lu un module
partiellement reecrit ; suite complete reexecutee apres compilation,
sans modification concurrente des modules, avec 207 succes.
Paquet npm de 91 fichiers verifie : module d'echelle et schema inclus,
aucun etat prive. Package/lockfile 0.1.0-beta.8, numero absent du registre
lors de la preparation. Aucune publication par l'assistant.

Retour utilisateur du 11 octobre 2026 a 16:41 locale : le curseur de
vitesse de ventilation est present dans Maison, mais grise alors que
le poele est eteint. L'utilisateur suppose un lien avec cet etat ;
la cause exacte n'est pas verifiee (aucun diagnostic HAP fourni).
Ce retour valide la presence du controle, pas une commande depuis Maison
ni sa disponibilite poele actif. Aucun Active fictif ni allumage de test
n'est ajoute pour contourner l'interface. Aucun changement de code ou
nouvelle version npm pour cette observation.

### Preparation du test manuel de puissance de chauffe (beta.9)

L'utilisateur choisit la verification du contrat puis un essai manuel
protege de puissance 1..7. Preuves deja acquises : carte Nobis power_set
SET 33120, mask 65535, formula/formula_inverse #, readonly false,
set_min 1, set_max 7, step 1, is_word true, big_endian false,
with_sign false, aucune enumeration ; lecture brute 5 comparee a
Nobis-Fi. Le candidat communautaire RWMSmaster/BitData 8/Endianess L
est documente plus haut et deja utilise pour les autres registres.
Cela justifie la preparation du candidat, pas sa validation physique.

previewPowerLevel exige exactement ces metadonnees via la lecture des
quatre reglages existante ; refuse les enumerations de la cible ou
du niveau initial, les doublons et valeurs invalides. Precautions du
premier essai : OFF/TRAVAIL, Auto/Powerful bruts 0, niveau different 1..7.
ECO STOP et transitions sont exclus par politique experimentale,
sans affirmer une interdiction fabricant.

Capacite enableExperimentalPowerLevel independante, desactivee par
defaut. Route locale /power-level-test exige autorisation et confirmation
confirmPowerLevelChange true avec cible entiere. Lecture appareil/carte/
buffer avant un POST unique : Items [33120], Masks [65535], Values
[niveau]. Job termine autorise une seule relecture du buffer des quatre
reglages, sans affirmation d'effet physique. NackErrCode meme 0, HTTP,
reseau, JSON invalide et timeout ne declenchent aucun retry d'ecriture.
Verrou commun a toutes les commandes du client. Aucun allumage,
reglage Auto/Powerful, retour automatique ou controle HomeKit ajoute.

Interface reutilisant le champ/confirmation/resultat des niveaux, mais
mode puissance nomme explicitement, route et confirmation distinctes
de la ventilation et de marche/arret. Resultat precisant Puissance de
chauffe, valeur avant/demandee/relue ; pas watts ou puissance mesuree.
Relever le niveau initial puis verifier Nobis-Fi et restaurer manuellement
apres l'essai, sans nouveau POST automatique en cas d'erreur.
Aucune commande physique ni requete Agua-IoT lancee par l'assistant.
Version beta.8 constatee sur npm ; beta.9 absente lors de la preparation.

Validation beta.9 : compilation/lint et 213 tests fictifs reussis sous
Node 24 et Node 22. Tests du corps exact 33120/65535, sept niveaux,
profils/modes/phases refuses, confirmation/autorisation, cible identique,
relecture concordante ou differente, 401/reseau/NackErrCode 0/JSON
invalide/timeout sans retry, verrou commun et fermeture.
Interface navigateur verifiee sur un nouveau serveur local : aucun
POST sans confirmation, puis un seul POST intercepte avec identifiants
fictifs, resultat different sans faux succes, mot de passe et confirmation
effaces. Interception retiree et page rechargee, aucun acces Agua-IoT.
Paquet npm de 94 fichiers verifie sans etat prive ; version package/
lockfile 0.1.0-beta.9. Aucune publication par l'assistant.

Retour utilisateur du 11 octobre 2026 a 17:04 locale : la demande de
puissance a fonctionne et est confirmee dans l'application Nobis-Fi.
Lecture des seuls elements de resultat du navigateur : puissance avant
5, demande 3, relecture 5, reception 2026-10-11T15:04:01.247Z.
Premier changement de consigne 5 vers 3 confirme cote application ;
ce n'est pas une relecture API concordante ni une mesure de puissance
thermique. Le delai et la cause de la difference ne sont pas etablis.
La phase exacte de l'essai n'est pas affichee et n'est pas attribuee
retroactivement. Aucun nouvel envoi par l'assistant. Les autres niveaux,
conditions, concordance ulterieure et restauration a 5 restent a confirmer.

L'utilisateur confirme ensuite avoir remis manuellement la puissance a 5
dans Nobis-Fi. Restauration confirmee par son retour, pas par une nouvelle
lecture API. Aucun test ni commande supplementaire lance automatiquement.

### Etude des representations HomeKit pour la puissance 1..7

Apres le premier essai, l'utilisateur choisit une etude avant decision
d'interface. Inspection des definitions du runtime HAP installe :
HeaterCooler n'a aucune caracteristique standard de niveau de puissance
de chauffe ; RotationSpeed est deja utilise pour la consigne ventilation.
HeatingThresholdTemperature reste une temperature, pas un niveau.
PowerManagement concerne WakeConfiguration et les configurations de
veille, pas une puissance de chauffage.

Options et limites :
- HeaterCooler existant : conserver chauffage/consigne/ventilation ;
  ne pas reutiliser RotationSpeed pour une seconde grandeur.
- Fanv2 : Active obligatoire, RotationSpeed optionnel ; detournement
  trompeur pour une puissance de feu, activation sans semantique propre
  et couplages UI possibles. Non recommande.
- Lightbulb : On obligatoire, Brightness optionnel ; un curseur de
  luminosite ne represente pas une puissance de chauffe. Faux appareil
  et activation ambigue. Non recommande.
- Switch : On obligatoire, Name optionnel ; sept services nommes
  Puissance 1..7 peuvent servir de selecteurs explicites, pas de boutons
  d'allumage du poele. Seul le niveau demande effectivement relu serait
  ON, les six autres OFF. Aucun niveau 0 de puissance n'etant etabli,
  eteindre le selecteur actif devrait etre refuse, jamais commander
  l'extinction, restaurer une valeur arbitraire ou simuler une impulsion.
  Sept services encombrent l'interface ; regroupement et rendu restent
  a tester dans Maison. Un changement exige les memes gardes et un
  verrou prive persistant, sans ON optimiste apres le job.
- Caracteristique/service personnalise de niveau entier : semantique
  correcte pour un client compatible, mais aucun rendu ou controle
  natif Maison garanti ; ne resout pas l'objectif sans validation du
  client cible. Pas de dependance externe ajoutee.

Conclusion : aucun curseur natif dedie etabli dans ces services.
Pour Maison, sept selecteurs de niveau sont le compromis explicite
envisageable ; garder la puissance dans Nobis-Fi reste plus simple.
Choix utilisateur requis avant implementation. Aucun nouveau service,
version npm, commande ou essai physique ajoute par cette etude.

### Puissance hors Maison et poursuite Auto/Powerful

Le 11 octobre 2026, l'utilisateur choisit de conserver la puissance
hors Maison pour le moment. Aucun des sept selecteurs proposes n'est
implemente ; le diagnostic manuel de puissance reste disponible.

L'etude suivante concerne Auto et Powerful. Acquis : boutons ON/OFF
dans Nobis-Fi, profils de carte fun_auto_set 33128 et fun_pwf_set 33154,
masque 65535, valeurs annoncees 0/1, comparaison initiale 0 = OFF pour
les deux. Non acquis : comparaison de 1 = ON sur cet appareil, ecritures,
effets exacts sur regulation/puissance/ventilation, interactions et
conditions de phase. L'enumeration Powerful 2 CRONO reste hors bornes
et exclue ; real_power_get 8 PWR-FULL ne prouve pas Powerful active.
Auto Nobis ne sera pas assimile au mode AUTO HeaterCooler.
Comprendre le comportement officiel precede la preparation d'un essai ;
aucune commande Auto/Powerful ni activation automatique n'est ajoutee.

L'utilisateur indique que le mode Auto regle la puissance ET la
ventilation. C'est une information fonctionnelle utilisateur, pas une
validation API ni une specification de l'algorithme de regulation.
Cela conforte le blocage existant des ecritures manuelles de niveaux
lorsque fun_auto_set vaut 1 ; aucune modification de code necessaire.
Un eventuel controle HomeKit serait un mode Nobis distinct de
TargetHeaterCoolerState.AUTO, sans deduire ses effets depuis les niveaux.

Pour Powerful, l'utilisateur indique qu'il force puissance et ventilation
au maximum pour atteindre rapidement la temperature demandee, et
desactive Auto. Information fonctionnelle utilisateur ; duree, sortie
du mode, restauration des niveaux et valeurs API apres activation non
observees. Ne pas deduire que le registre se remet automatiquement a 0
au seuil ni qu'Auto revient apres desactivation. Ne pas envoyer une
seconde commande Auto OFF pour reproduire l'interaction : elle doit
d'abord etre observee dans les retours de l'appareil.
Ces interactions justifient de lire les quatre reglages ensemble avant/
apres un eventuel essai manuel et de ne pas restaurer Auto ou des niveaux
automatiquement. Aucun essai Powerful ni commande physique dans ce lot.

Le 11 octobre 2026, l'utilisateur confirme Auto OFF et Powerful OFF
dans Nobis-Fi puis lance la lecture seule des quatre reglages.
Resultat recu a 2026-10-11T17:08:11.256Z : power_set 5,
vent_front_set 4, fun_auto_set 0 (FRE OFF), fun_pwf_set 0 (FRE OFF).
Nouvelle comparaison OFF concordante pour les deux modes. La puissance
5 est aussi relue apres restauration manuelle confirmee plus tot ;
cela ne confirme pas retroactivement une lecture API du niveau 3.
Les valeurs 1 = ON, interactions apres activation, fraicheur et delais
restent non valides. Lecture lancee par l'utilisateur ; aucune commande
ou requete cloud declenchee par l'assistant.

L'utilisateur active ensuite Auto lui-meme dans Nobis-Fi et lance une
nouvelle lecture seule. Resultat recu a 2026-10-11T17:14:29.811Z :
power_set 5, vent_front_set 4, fun_auto_set 1 (FRE ON),
fun_pwf_set 0 (FRE OFF). A 19:16 locale, il confirme Auto ON et
les reglages de puissance/ventilation devenus inaccessibles dans
l'application. La correspondance fun_auto_set 1 = Auto ON est donc
comparee sur cet appareil, en complement de 0 = OFF.

Les consignes 5/4 restent presentes dans le buffer alors que leurs
controles manuels sont desactives : ne pas les presenter comme puissance
ou ventilation effectives pilotees par Auto. Cela conforte les gardes
existantes refusant les ecritures manuelles lorsque Auto vaut 1.
La phase exacte n'est pas affichee ; aucun allumage, algorithme,
variation physique ni effet thermique n'est deduit. Aucune ecriture API
Auto n'a ete testee, aucune commande envoyee par l'assistant.

L'utilisateur confirme avoir remis Auto OFF puis relance la lecture
seule. Resultat recu a 2026-10-11T17:51:18.725Z : power_set 5,
vent_front_set 4, fun_auto_set 0 (FRE OFF), fun_pwf_set 0 (FRE OFF).
Le cycle Auto OFF/ON/OFF via Nobis-Fi est compare aux valeurs API
0/1/0 sur cet appareil. Les consignes relues restent 5/4 ; aucune
restauration automatique des niveaux ni variation effective n'est deduite.
Le retour d'accessibilite des reglages manuels dans Nobis-Fi n'a pas
ete explicitement confirme. Toujours aucune ecriture API Auto testee,
aucune commande ou lecture cloud declenchee par l'assistant.

### Preparation uniquement de l'essai API Auto (beta.10)

L'utilisateur choisit explicitement de preparer un essai protege sans
encore l'executer. Contrat candidat fonde sur le profil Nobis observe
fun_auto_set SET 33128/65535, formules #/#, bornes 0..1, pas 1,
word/little/unsigned et libelles FRE exacts 0 OFF/1 ON ; cycle 0/1/0
compare via Nobis-Fi. Encodage RWMSmaster/BitData 8/Endianess L repris
du contrat d'ecriture existant, pas d'endpoint invente.

previewAuto exige ce profil via observeOperatingSettings, les libelles
exacts sans doublon, une cible booleenne differente et une phase
OFF/TRAVAIL avec Powerful 0. Politique experimentale : ECO STOP,
transitions et Powerful actif refuses sans pretendre une interdiction
fabricant. Capacite enableExperimentalAuto desactivee par defaut,
independante des autres commandes et partageant leur verrou client.

Route locale /auto-test, autorisation locale et confirmAutoChange true,
enabled booleen obligatoire. Appareil en ligne/carte/buffer relus ;
un POST unique Items [33128], Masks [65535], Values [0 ou 1], puis
une relecture des quatre reglages. Aucun retry 401/reseau/NackErrCode/
JSON invalide/timeout, aucune restauration/allumage/commande de niveau.
Auto peut lui-meme modifier le fonctionnement puissance/ventilation ;
le plugin ne tente pas de reproduire ces effets par des commandes.
Powerful n'est pas commande et ne devient pas un mode HomeKit.

Interface avec choix ON/OFF initialement vide et confirmation propre,
effaces selon les memes gardes que les tests existants. Resultat
avant/demande et quatre valeurs apres, concordance API distinguee
de l'effet physique et de la fraicheur. Erreur ou lecture differente :
verifier Nobis-Fi sans renvoyer automatiquement ni restaurer Auto.
Mode PowerManagement/AUTO HeaterCooler non utilise. Aucun test reel
ni commande cloud lance par l'assistant.

Validation beta.10 : compilation/lint et 219 tests fictifs reussis Node
22/24 ; corps ON/OFF exact, profils/libelles/valeurs invalides,
conditions initiales/cible identique, capacite independante/verrou,
401/reseau/NackErrCode 0/JSON invalide/timeout sans retry et relectures
concordante/differente. Interface navigateur : aucun POST sans choix
ou sans confirmation ; un POST intercepte fictif, relecture differente
sans faux succes, mot de passe et confirmation effaces. Interception
retiree, page rechargee puis laissee en lecture seule des reglages.
Nouveau serveur local verifie responsive, aucune requete Agua-IoT.
Paquet de 97 fichiers sans etat prive verifie ; package/lockfile beta.10,
numero absent du registre lors de preparation, aucune publication.

Premier essai API Auto lance par l'utilisateur le 11 octobre 2026 :
avant OFF, demande ON ; relecture recue a 2026-10-11T18:59:16.469Z,
power_set 5, vent_front_set 4, fun_auto_set 0, fun_pwf_set 0.
L'utilisateur confirme explicitement Auto passe ON dans Nobis-Fi apres
cet envoi. Premier succes cote application de la commande 33128/65535/1,
pas de concordance dans la relecture immediate, ni mesure thermique.
Cause et delai de la difference inconnus ; phase exacte non affichee,
aucune attribution retroactive. Aucun nouvel envoi par l'assistant.
Commande API OFF, concordance ulterieure et restauration apres cet essai
restent a confirmer.

L'utilisateur confirme ensuite avoir remis Auto OFF manuellement dans
Nobis-Fi apres cet essai. Retour rapporte, sans nouvelle lecture API ;
ne valide pas la commande API OFF. Aucun autre reglage restaure n'est
deduit de cette confirmation.

### Fiabilisation apres report de l'essai Auto OFF

L'utilisateur prefere reporter la commande API Auto OFF et poursuivre
la fiabilisation. Aucun cycle Auto ni essai Powerful ajoute.
Quatre regressions plateforme avec reseau fictif verifient les protections
existantes : pour chacun des marqueurs power/setpoint/ventilation
corrompus au redemarrage, tous les controles refusent les ecritures,
le fichier est conserve, l'erreur de stockage est journalisee sans
contenu prive, et la temperature ambiante valide reste accessible.

Le quatrieme test injecte un marqueur ventilation existant apres une
lecture valide, avant le changement : la creation exclusive echoue,
aucun POST d'ecriture ne part, le marqueur precedent reste intact et
les commandes suivantes sont bloquees. Pas de suppression/repli silencieux.
Les quatre tests cibles passent sous Node 24 et Node 22, lint reussi.
La suite complete de 219 tests precedemment validee n'est pas relancee
pour ce lot uniquement tests/documentation. Aucun changement runtime,
nouvelle version npm ou publication. Diagnostic replace en lecture seule,
confirmation Auto decochee ; aucune requete cloud declenchee.

### Livraison beta.11 : confirmation differee des essais de reglages

Les essais de puissance et Auto ON ont ete confirmes dans Nobis-Fi alors
que leur relecture immediate retournait la valeur initiale. Cause
inconnue : ne pas affirmer un cache serveur ou un delai de propagation.
Pour ne plus conclure sur une seule lecture, les tests locaux Auto,
puissance et ventilation utilisent la confirmation bornee deja presente
pour la consigne : un POST unique, au plus trois lectures du buffer 1,
cinq secondes d'attente apres une lecture differente avant la suivante.
Arret au premier resultat concordant, sur erreur ou annulation ; session
globale 120 secondes et jobs 30 secondes inchanges. Aucune relance
d'ecriture, restauration automatique ou commande supplementaire.

confirmReading extrait le mecanisme commun ; confirmSetpoint conserve
son contrat public et sa validation MAN. Les profils de quatre reglages
sont valides a chaque relecture, pas uniquement avant POST.
Confirmation Auto exige valeur cible et libelle exact ON/OFF ;
puissance/ventilation exigent niveau cible sans enumeration speciale.
Le resultat retourne observations (1..3), derniere observation et
readbackMatches ; l'interface exige un historique coherent, ne contenant
pas une concordance anterieure ignoree, et affiche chaque valeur/reception.
Les observations ne prouvent ni fraicheur ni effet physique.

La cadence bornee n'est pas une limite constructeur documentee, ni une
garantie de resultat sous dix secondes (les lectures prennent du temps).
Pas de changement du polling Homebridge : une attente additionnelle dans
le setter risquerait un timeout HAP ; le marqueur prive et les verrous
restent conserves jusqu'a la concordance par polling. Marche/arret garde
la relecture unique puis son suivi habituel, sans esperer une extinction
ou un allumage physique dans cette courte fenetre. Aucun nouveau controle
Maison, Auto OFF et Powerful toujours non testes sur appareil.

Validation beta.11 : compilation/lint et 225 tests reussis Node 22/24,
dont confirmation premiere/deuxieme/troisieme lecture, absence de
concordance, erreurs/annulation sans relecture suivante, arret sur profil
invalide et historique incoherent refuse par l'interface.
Scenario API fictif Auto 0 puis 1 valide avec un seul POST ; interface
verifiee dans le navigateur par interception, affichage des deux lectures
et aucune affirmation d'effet thermique. Interception retiree puis page
rechargee en lecture seule. Aucun acces Agua-IoT ni commande reelle.

### Beta.12 : dependances de configuration dans le GUI

Le schema GUI n'exprimait pas les dependances booleennes pourtant
exigees par parseConfig. Ajout de contraintes JSON Schema if/then/allOf
avec const true et champs requis explicites ; conditions applicables
uniquement aux options presentes et activees. Aucun changement du
parseur runtime, des valeurs par defaut, commandes ou identifiants.
Desactiver un prerequis exige de desactiver les options dependantes,
sans activer automatiquement une capacite d'ecriture.

Descriptions actualisees : cloud prerequisite, curseurs consigne et
ventilation grises en OFF dans Maison, HEAT/Active commandant le poele,
ECO STOP et commandes encore hors Maison. Ajv dev-only valide le schema
et compare ses resultats au runtime pour les 243 combinaisons d'options
absentes/false/true et des valeurs non booleennes. Aucun ajout de
dependance runtime. Le comportement visuel des erreurs sur le GUI NAS
reste a verifier, sans promettre un rendu specifique.
Sources publiques consultees pour le mecanisme de validation stricte :
homebridge-config-ui-x plugin-config.component et schema-form.component
(latest) ; strictValidation utilise l'etat valide du formulaire.
Pas de commande physique, lecture cloud ni changement de mode du poele.

Validation beta.12 : compilation/lint et 226 tests reussis Node 24 et
Node 22, schema compile par Ajv sans erreur. Version package/lockfile
0.1.0-beta.12, numero absent du registre au moment de preparation.
Aucune publication par l'assistant.

### Powerful : preparation d'un essai local protege (beta.15)

L'utilisateur demande le bouton Powerful et approuve un essai protege
avant exposition Maison. Profil candidat deja observe : fun_pwf_set,
33154/65535, SET non readonly, mot non signe little-endian, formules #,
pas 1, bornes 0..1, FRE OFF/ON ; 2 CRONO hors bornes et exclu.
Lecture initiale OFF et presence du bouton dans Nobis-Fi connues.
ON, commande OFF et effets sur Auto ne sont pas encore valides sur appareil.

Preparation uniquement : choix booleen explicite et confirmation
confirmPowerfulChange distincte d'Auto ; lecture initiale des quatre
reglages et de la phase. OFF/TRAVAIL et Auto OFF par precaution,
cible differente et profil exact requis. Une ecriture du seul 33154,
aucun POST Auto, niveau ou marche/arret, aucune restauration ni retry.
Trois relectures maximum, cinq secondes apres une difference, historique
strict et arret sur concordance, erreur ou annulation.

Le rapport utilisateur selon lequel Powerful force puissance et
ventilation et desactive Auto reste un rapport fonctionnel, pas un
algorithme ou effet API demontre. Les niveaux demandes ne prouvent pas
les sorties effectives. Aucun etat Maison Powerful expose ou simule
tant que le cycle reel n'est pas valide. Aucun envoi physique par
l'assistant dans cette preparation.

### Premier essai Powerful ON confirme (12 octobre 2026)

L'utilisateur execute l'essai local ON. Resultat consulte sans nouvel
appel cloud : fun_pwf_set initial OFF, demande ON ; premiere relecture
0 a 2026-10-12T05:37:23.274Z, deuxieme 1 a
2026-10-12T05:37:29.420Z (07:37:29 locale). Il confirme ensuite
explicitement que Powerful est ON dans Nobis-Fi.
Les autres reglages relus sont power_set 5, vent_front_set 4 et
fun_auto_set 0. Les niveaux demandes ne prouvent ni puissance effective
ni ventilation effective. La phase n'est pas presente dans ce resultat ;
aucune phase precise n'est attribuee retrospectivement.
La commande OFF, les interactions avec Auto actif et les effets physiques
restent non valides. Aucun nouvel envoi par l'assistant.

### Retour Powerful OFF et bouton HomeKit (12 octobre 2026, beta.16)

L'utilisateur execute puis valide le retour OFF dans Nobis-Fi.
Resultat local consulte : avant ON, demande OFF ; premiere relecture 1
a 2026-10-12T05:40:06.907Z, deuxieme 0 a
2026-10-12T05:40:13.050Z. Auto reste 0, puissance demandee 5,
ventilation demandee 4. Heure de reception, pas de mesure ;
aucune phase precise ni sortie physique n'est deduite.

Ce cycle valide le controle du mode OFF/ON sur l'A8 cible. Ajout d'un
Switch Powerful optionnel, sous-type distinct, meme accessoire et UUID.
Ne represente ni combustion ni marche/arret. Valeur uniquement relue
depuis fun_pwf_set avec label OFF/ON ; CRONO n'est pas converti.
Revalidation avant SET, Auto OFF et phase OFF/TRAVAIL par precaution.
Pas de commande implicite Auto ou marche/arret. Interaction entre modes
et effet physique restent non valides. Affichage et commande depuis
Maison restent a confirmer apres installation.

Marqueur prive powerful-pending-UUID de 0/1 synchronise avant POST,
verrou commun a tous les services ; persistance chargee meme option
Powerful desactivee. Relecture immediate puis polling habituel pour
resolution sur valeur et label cibles. Aucun etat simule, retry,
restauration ou attente ajoutee au setter. Corruption et echec de
persistance bloquent l'envoi. Aucun essai reel par l'assistant.

### Auto OFF confirme par l'utilisateur et integration Maison (beta.17)

Le 12 octobre 2026, l'utilisateur declare Powerful verifie dans Maison
et demande Auto. Interroge explicitement sur un envoi Auto OFF depuis
le diagnostic (distinct d'une modification directe dans Nobis-Fi), il
confirme l'envoi et le retour OFF dans Nobis-Fi. Le resultat detaille de
cet essai n'a pas ete consulte : aucune valeur de relecture, phase ou
heure n'est inventee. Cette preuve utilisateur complete l'envoi Auto ON
precedemment confirme et le cycle officiel OFF/ON/OFF observe 0/1/0.

Ajout d'un Switch Auto optionnel sur le meme accessoire/UUID, sous-type
auto distinct de powerful et power. Reutilise l'implementation du mode
Powerful et la commande previewAuto existante. Revalidation de l'appareil,
carte, phase OFF/TRAVAIL et Powerful OFF avant une ecriture 33128/65535.
Pas de changement implicite d'autre mode ou activation du poele.
L'affichage depend exclusivement de fun_auto_set relu et du label exact.

Marqueur auto-pending-UUID contenant 0/1 synchronise avant envoi,
verrou transversal et charge meme option Auto desactivee. Aucun retry
ni rejeu au redemarrage. Relecture immediate puis polling habituel ;
pas d'attente ajoutee au setter. A la preparation, controle depuis Maison, fraicheur,
sorties physiques et interactions avec Powerful actif restent a verifier.

### Validation Auto dans Maison rapportee (12 octobre 2026)

Apres livraison beta.17 et instructions de verification dans Maison,
l'utilisateur confirme « c'est valide ». Ce retour confirme l'usage
Auto dans Maison ; aucun delai, phase exacte, historique de relecture
ou effet thermique supplementaire n'est attribue a cette confirmation.
Les interactions entre modes actifs et la fraicheur restent inconnues ;
les gardes et restrictions existantes sont conservees.
