# homebridge-nobis — Phase 1 : étude technique

Date de consultation : 9 octobre 2026.

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
