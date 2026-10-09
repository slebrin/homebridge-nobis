# Changelog

## 0.1.0-beta.0 (publication en preparation)

- Etude du Swagger public Nobis et des implementations communautaires.
- Socle TypeScript Dynamic Platform adapte du template officiel Homebridge.
- Configuration GUI et validation sans journalisation des valeurs sensibles.
- Tests de configuration et du cycle de plateforme, CI Node 22/24.
- Client Agua-IoT HTTPS independant de HomeKit, authentification et renouvellement
  mutualises, lecture des appareils/cartes et lecture brute asynchrone de buffers.
- Timeouts, limite de taille des reponses, erreurs typees sans secrets, refus des
  endpoints de controle, annulation et fermeture.
- Identite d'application privee dans le stockage Homebridge, jetons en memoire.
- Decouverte cloud optionnelle via GUI, backoff et respect de Retry-After.
- Aucun controle de poele ni exposition HomeKit ; mesures periodiques suspendues
  jusqu'a validation du buffer et des conversions du modele cible.
- Diagnostic autonome hors ligne par defaut, connexion explicite seulement,
  fichiers d'identifiants et rapports prives, buffer sur demande et arret propre.
- Formulaire verifie dans Homebridge Config UI X 5.29.0 sur localhost avec
  identifiants fictifs, sans connexion Agua-IoT ni demarrage du bridge.
- Intervalle GUI numerique, entier et obligatoire : une saisie invalide bloque
  la sauvegarde au lieu d'etre omise avec retour silencieux au defaut runtime.
- Verification de la sauvegarde/reouverture, du masquage du mot de passe et
  de la conservation de ses espaces ; regressions de schema et configuration.
- Diagnostic autonome dans le navigateur, serveur limite a localhost et port
  automatique, sans fichier d'identifiants ni enregistrement du mot de passe.
- Decouverte sur clic explicite, resultat limite aux compteurs, protection
  d'origine/jeton, budget global et refus des tests concurrents.
- Inspection locale des definitions validees : tableau filtrable, champs
  complets et effacement en memoire, sans execution des formules ni lecture
  de buffer ; les identifiants d'appareil/carte ne sont pas transmis a la page.
- Inspection experimentale de la structure du job de configuration existante
  des buffers sur clic explicite : noms/types seulement, valeurs masquees,
  champs sensibles exclus, structure bornee et configuration non validee.
- Suivi de job partage avec la lecture brute, sans changer ses validations ;
  aucun choix de buffer ni endpoint de configuration en ecriture ajoute.
- Affichage limite au code numerique NackErrCode observe, sans interpretation,
  avec distinction entre absence, format invalide et valeur entiere.
- Erreurs de job indisponible precises : statut connu conserve sans identifiant
  de job ni reponse brute, explication locale et absence de nouvel essai automatique.
- Mode experimental distinct pour devicegetBufferId : structure du resultat
  inconnue inspectee sur clic, sans choix de buffer ni lecture automatique.
- Observation ciblee de BufferCnt/Indexes apres leur presence constatee :
  entiers bornes et coherents uniquement, sans selection ou interpretation.
- Premiere consultation de job apres le meme intervalle que les suivantes
  (1 seconde par defaut), selon la pratique du client Go ; attente bornee et
  annulable, sans convertir les reponses manquantes en attente ou reessai.
- Mode navigateur de lecture brute unique du buffer 1 sur clic explicite :
  couples adresse/entier, heure de reception et fraicheur non verifiee,
  sans conversion, scan d'autres indices ni modification de configuration.
- Diagnostic precis des lectures refusees : raison, types d'enveloppes et
  de tableaux, longueurs uniquement, sans assouplir le contrat Items/Values.
- Correction du refus systematique d'un payload supplementaire apres
  observation de sa coexistence avec Items/Values : seules les donnees
  strictement validees de jobAnswerData sont lues, payload toujours opaque.
- Decodeur pur type de temperature ambiante pour le profil observe du
  buffer 1 : contrat strict, erreurs explicites, aucune execution de formule
  ou reconstruction d'octets, fraicheur inconnue et tests fictifs.
- Mode navigateur distinct de temperature ambiante : verification de la carte,
  lecture unique du buffer 1, valeur et reception seulement, avertissement
  de fraicheur inconnue, effacement et refus explicite des profils incompatibles.
- TemperatureSensor HomeKit experimental sur option GUI explicite, desactive
  par defaut : profil valide uniquement, UUID stable, cache sans doublons,
  erreurs de communication au lieu de valeurs fictives, reprise et arret propres.
  Aucune commande, consigne modifiable ou phase de chauffage.
