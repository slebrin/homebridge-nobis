# Changelog

Les mentions « preparee, non publiee » decrivent la preparation locale,
pas un inventaire a jour de npm. Verifier les tags et versions publies
avant une release ; aucune publication n'est realisee par ces notes.

## 0.1.0-beta.28 — publiee sur npm le 2026-11-03

- Nouveau numero pour publier l'etat actuel du depot : npm contient deja
  0.1.0-beta.27 et interdit de remplacer une version publiee.
- Aucun changement fonctionnel par rapport au commit 7804229 de la release
  GitHub v0.1.0-beta.27 ; fonctions et validations detaillees ci-dessous.
- Publication npm verifiee : le tag beta pointe sur 0.1.0-beta.28.
  Le gitHead declare par npm est 7804229 ; les changements de version et
  de documentation sont enregistres dans le commit de release suivant.

## 0.1.0-beta.27 — preparee le 2026-11-03, non publiee

- Ajoute uniquement un ContactSensor Eco Stop optionnel, desactive par
  defaut, au meme accessoire. Ouvert pour ECO STOP relu, ferme pour les
  autres phases reconnues ; inconnu ou echec de lecture indisponible.
- Aucun switch, commande, UUID nouveau ou requete cloud supplementaire.
  Cloud et lecture de temperature requis, sans obligation d'activer
  les commandes. Lectures de polling et de confirmation partagees.
- Cache, retrait du service, arret et recuperation geres ; fonctionnement
  dans Maison confirme par l'utilisateur le 3 novembre. Les capteurs demarrage/arret ne sont
  pas ajoutes.
- 143 tests cibles passes sous Node 22 et 24 avec Homebridge 2,
  dont 177147 combinaisons GUI/runtime, phases, defauts, cache,
  retrait et coexistence avec les commandes. Compilation/lint et paquet
  de 109 fichiers verifies. Aucun test n'envoie de commande reelle.
- Guide utilisateur recentre sur les fonctions actuelles, installation
  GUI et depannage ; ancien guide conserve dans docs/HISTORIQUE-DEVELOPPEMENT.md.
  Preuves API conservees separement, sans revendiquer de certification.
- Validation enableEcoStopSensor hors de la boucle des champs optionnels :
  une configuration invalide ne repete plus ce nom de champ dans l'erreur.
- Preparation de release du 3 novembre : 337 tests complets passes dans
  chacune des quatre combinaisons Node 22/24 et Homebridge 1.11.4/2.4.0 ;
  compilation/lint valides avec les deux Homebridge. Paquet de 110 fichiers,
  archive documentaire incluse. Aucun push ni publication durant ces checks.
- npm signale 12 avis moderes dans l'arbre de developpement verrouille ;
  le controle npm excluant les devDependencies ne signale aucun avis.
  Aucune mise a jour forcee appliquee ; ce controle ne vaut pas audit
  de securite du plugin ni garantie d'absence de vulnerabilites.

## 0.1.0-beta.26 — preparee le 2026-10-17, non publiee

- Une mesure ambiante hors de la plage HomeKit ne stoppe plus definitivement
  la decouverte : elle reste indisponible sans clamp ni valeur de remplacement,
  puis le polling reprend avec temporisation progressive. Une mesure valide
  restaure le service. Les autres erreurs de protocole restent fatales.
- Diagnostic du 16 octobre : Agua-IoT a aussi termine plusieurs jobs de
  lecture, suivis de rafraichissements reussis. A 22:12, l'erreur
  `homekit-temperature-range` a provoque l'arret permanent. Valeur recue
  absente du journal ; cause physique de la lecture hors plage inconnue.
- Test de regression : sensor cache fault puis recupere a 23 C, sans
  publication duplicate, clamp ou commande. Compilation/lint et 331 tests
  passes sous Node 22 et 24, Homebridge 2 ; paquet de 106 fichiers verifie.

## 0.1.0-beta.25 — preparee le 2026-10-16, non publiee

- Autorise Auto, Powerful et Chrono en ECO STOP, dans Maison et via
  les apercus API partages avec le diagnostic. L'utilisateur confirme
  que Nobis-Fi permet ces trois changements dans cette phase sur son A8.
  L'ecriture du plugin en ECO STOP reste a confirmer sur appareil.
- Auto/Powerful : OFF/TRAVAIL/ECO STOP, autre mode OFF toujours requis.
  Chrono : OFF/ECO STOP, sans condition Auto/Powerful ; TRAVAIL reste
  exclu par precaution, sans restriction constructeur demontree.
- Corrige le message Chrono qui mentionnait a tort un autre mode actif.
  Transitions, phases inconnues, profils stricts, verrous persistants,
  reponses locales et absence de retry restent inchanges. Pas de
  changement des commandes de consigne, ventilation ou puissance.
- 205 tests cibles reussis sous Node 22 et 24 avec Homebridge 2,
  dont les commandes Maison ON/OFF en ECO STOP des trois modes,
  persistance avant POST, reponse locale et confirmation par relecture.

## 0.1.0-beta.24 — preparee le 2026-10-15, non publiee

- Les handlers Maison repondent des la prise en charge locale, sans
  attendre les verifications, le job cloud ou la relecture. Marche/arret
  via Switch/Chauffage, consigne, ventilation, Auto, Powerful et Chrono
  conservent la derniere valeur observee, sans affichage optimiste.
- Verrou global immediat, aucune file ni repetition d'ecriture. Les
  marqueurs restent synchronises avant POST ; les cibles persistantes
  et les relectures ne changent pas. L'arret annule le traitement en cours,
  sans rejeu d'une demande non envoyee ni annulation d'un ordre deja distant.
- Les erreurs tardives sont explicites dans les logs mais ne peuvent plus
  etre renvoyees au clic initial. Les refus locaux restent immediats ;
  cette reponse ne garantit ni acceptation cloud ni changement physique.
- Compilation/lint et 324 tests reussis sous Node 22 et 24 avec Homebridge 2.
  Les sept chemins HAP repondent sous 1000 ms dans les tests avec cloud
  bloque 9500 ms simules ; erreurs tardives et arret avant/apres POST
  couverts. Aucun test automatise ne commande de poele reel. Comportement
  a confirmer dans Maison sur le NAS.

## 0.1.0-beta.23 — preparee le 2026-10-14, non publiee

- Ajoute directement dans Maison un Switch Chrono experimental, sur option
  GUI desactivee par defaut. Lecture 33162=0/1 comparee en OFF/ON/OFF
  avec Nobis-Fi. Le 15 octobre 2026, l'utilisateur confirme que le switch
  Programme fonctionne dans Maison sur son poele ; l'execution des
  horaires et les autres conditions de fonctionnement restent non validees.
- Controle uniquement le drapeau global, sans edition des programmes,
  commande de puissance implicite, retry ni restauration automatique.
  Ecritures initiales limitees a OFF par precaution.
- Verrou durable pendingChrono, lecture de confirmation, restauration des
  verrous meme option desactivee, abandon explicite couvrant Chrono.
- L'utilisateur confirme ON et OFF dans Maison avec beta.22 ; cela ne
  valide pas les commandes Chrono ni l'execution des horaires.
- Compilation/lint reussis ; 314 tests passes sous Node 22 et 24 avec
  Homebridge 2, dont 59049 combinaisons des options GUI. Paquet de 106
  fichiers verifie ; aucun essai automatise ne commande de poele reel.

## 0.1.0-beta.22 — preparee le 2026-10-14, non publiee

- Corrige le verrou ON lorsque l'allumage aboutit directement a ECO STOP
  parce que la temperature ambiante depasse la consigne. TRAVAIL ou
  ECO STOP confirment maintenant l'activation demandee ; OFF confirme
  toujours uniquement l'arret. ECO STOP reste au repos dans En chauffe.
- Cause observee sur le NAS : commande ON acceptee a 21:42:49, puis
  poele ECO STOP sans passage TRAVAIL et ancien code laissant
  pendingPowerAction bloque. Aucune nouvelle commande ni deduction
  de chauffe effective ajoutee.
- Compilation/lint et 299 tests reussis sur Node 22/24 avec Homebridge 2.

## 0.1.0-beta.21 — preparee le 2026-10-14, non publiee

- Migration optionnelle useHeatingActivityIndicator, desactivee par defaut,
  exige Chauffage et ses prerequis. Transforme le Switch power existant
  en indicateur « En chauffe », meme UUID/subtype, sans nouvelle tuile.
  ON uniquement TRAVAIL relu ; OFF pour OFF/ECO STOP/DEBUT/ARRET signifie
  absence de TRAVAIL confirme, pas absence de flamme/chaleur residuelle.
  Etat inconnu/erreur cloud indisponible. Tous les clics refuses sans POST.
- Les commandes reelles restent sur Chauffage : Chauffer depuis OFF,
  Eteint depuis TRAVAIL/ECO STOP, verification API avant POST, verrous
  conserves. Corrige la dependance inutile a une consigne numerique pour
  les commandes ON/OFF : MAN ne doit pas empecher un arret reel.
  Journalise les refus locaux et les demandes ON/OFF depuis Chauffage.
- Desactivation restaure le Switch Marche sans doublon. Revoir les
  automatisations existantes avant activation ; Maison peut conserver
  un nom personnalise et les libelles Allume/Eteint. Aucun rendu Apple
  ni commande physique sur NAS valide par ces tests.
- Compilation/lint et 299 tests reussis sur Node 22/24 avec Homebridge 2.
  Homebridge 1 : compilation et 55 tests cibles reussis sur les deux Node,
  dont ON depuis OFF et OFF depuis ECO STOP via Thermostat/HeaterCooler.
  Schema/runtime compares sur 19683 combinaisons ; paquet verifie.

## 0.1.0-beta.20 — correction locale, non publiee

- L'utilisateur confirme le 2026-10-12 que Powerful agit sur la puissance
  et la ventilation effectives sans toucher aux valeurs demandees sur
  son A8. Confirmation qualitative, sans codes API effectifs chiffres
  ni mesures watts/debit ; aucune nouvelle commande ou conversion ajoutee.

- Ajoute une confirmation GUI temporaire pour abandonner explicitement
  toutes les cibles en attente du poele selectionne, meme controle desactive.
  Exige cloud, lecture temperature et marche/arret, API OFF et lecture
  valide des reglages. Aucun POST de commande ni changement de consigne.
- Retire marqueurs prives et copies en contexte Homebridge, conserve UUID
  et actualise depuis les observations courantes. Une commande deja recue
  par le cloud n'est pas annulee et peut encore s'executer plus tard.
- Confirmation privee 0600 synchronisee avant suppression, consommee meme
  sans cible, non rejouee au polling/redemarrage. Pour re-armer : decocher,
  enregistrer et redemarrer, puis nouvelle confirmation explicite.
  Echec partiel/stockage ne relance pas automatiquement la suppression.
- Erreur de lecture, phase non OFF ou stockage corrompu ne sont jamais
  contournes. Refus et abandons journalises sans identifiants ni secrets.
- Compilation/lint et 291 tests reussis sous Homebridge 2 sur Node 22/24.
  Homebridge 1 : compilation et 23 tests cibles (abandon, stockage,
  migration Ambiante, GUI, paquet) reussis sur les deux Node.
  Schema/runtime compares sur 6561 combinaisons ; aucun test physique
  ni commande au poele par l'assistant.

## 0.1.0-beta.19 — correction locale, non publiee

- Retire automatiquement TemperatureSensor quand Chauffage est active.
  Temperature ambiante toujours lue et affichee dans Thermostat/HeaterCooler,
  consigne distincte. Sans Chauffage, conserve la tuile Ambiante.
  Meme accessoire/UUID, aucune commande ou nouvelle option.
- Migration des accessoires en cache au lancement, sans reappairage.
  La lecture de temperature reste necessaire aux controles.
- Journalise les refus avant requete des boutons Marche, Auto et Powerful :
  commande/verrou en attente, valeur indisponible ou phase/mode refuse.
  Arret depuis ECO STOP toujours autorise hors verrou ; aucune extension
  des commandes Auto/Powerful a ECO STOP sans validation physique.
- Compilation/lint, paquet de 103 fichiers et 273 tests reussis sur
  Node 22/24 avec Homebridge 2. Migration/recreation de la tuile et refus
  locaux testes avec HAP reel et cloud fictif ; aucune commande physique.
  Le refus rapporte sur le NAS reste a identifier avec les nouveaux logs.

## 0.1.0-beta.18 — correction locale, non publiee

- Corrige l'indisponibilite artificielle apres un job reussi dont la cible
  n'est pas encore relue : reponse HAP avec la derniere valeur confirmee
  (WRITE_RESPONSE), sans etat optimiste. Les lectures valides restent
  accessibles ; toutes les nouvelles ecritures restent verrouillees.
- Au plus trois relectures rapides espacees de cinq secondes apres une
  commande en attente, puis polling normal. Un seul timer, aucun retry
  d'ecriture, verrou persistant et erreurs cloud toujours explicites.
- Demarrage/arret connus conservent les dernieres observations confirmees,
  pas un nouvel etat suppose ; commandes bloquees dans ces phases.
  Sans observation stable depuis le lancement, l'activation reste inconnue.
- TemperatureSensor nomme « Ambiante » ; consigne separee, toujours lue
  depuis 33122. Ventilation demandee OFF/0 lisible comme zero, sans commande
  OFF ni conversion de PS en vitesse. Puissance effective non simulee.
- Powerful ecrit uniquement son mode : pas d'ecriture supplementaire des
  niveaux 7/7. L'effet maximal reel reste a verifier en lecture seule.
- Correction a confirmer dans Maison sur le NAS ; les longues transactions
  cloud peuvent encore exceder le delai HAP. Pas une version stable.
- Compilation/lint et 270 tests reussis sur Node 22/24 avec Homebridge 2.
  Homebridge 1 : compilation et 115 tests cibles (plateforme, HAP,
  configuration et installation du paquet) reussis sur les deux Node.
  Aucun test automatise ne commande un poele reel.

## 0.1.0-beta.17 — preparee le 2026-10-12, non publiee

- L'utilisateur confirme Powerful verifie dans Maison et Auto OFF envoye
  depuis le diagnostic puis confirme dans Nobis-Fi. Pas de relecture
  numerique ou d'heure attribuee au resultat Auto non consulte.
- Ajoute le Switch Auto sur le meme accessoire/UUID, option GUI desactivee
  par defaut ; exige cloud, capteur et marche/arret, independamment de Powerful.
  Schema/runtime compares sur 2187 combinaisons.
- Reutilise le service de mode et le pipeline persistant de Powerful :
  une ecriture 33128/65535, Powerful OFF et OFF/TRAVAIL, profil strict.
  Aucun changement implicite de Powerful, allumage, retry ou restauration.
- Cible 0/1 privee synchronisee avant POST ; verrou commun inclut Auto.
  Persistance au redemarrage meme option desactivee, aucune commande rejouee,
  resolution uniquement par relecture du mode cible. Pas d'etat optimiste.
- L'utilisateur confirme Auto valide dans Maison le 2026-10-12.
  Interactions entre modes actifs et effets physiques restent a valider ;
  autre mode actif refuse avant SET par precaution.
- Compilation/lint et 268 tests reussis sous Homebridge 2 sur Node 22/24.
  Homebridge 1 : compilation et 34 tests cibles (modes, GUI, persistance
  et chargement du paquet) reussis sur les deux versions Node.
  Matrice CI complete conservee ; aucune commande physique par l'assistant.

## 0.1.0-beta.16 — preparee le 2026-10-12, non publiee

- Ajoute le bouton Powerful optionnel dans Maison apres cycle ON/OFF
  confirme dans Nobis-Fi et relu depuis l'API. OFF relu a 07:40:13 locale
  au deuxieme essai de lecture ; Auto OFF, niveaux demandes 5/4 inchanges.
- Switch distinct de marche/arret, meme accessoire/UUID, desactive par
  defaut. GUI et runtime exigent cloud, capteur et marche/arret.
  Comparaison schema/runtime etendue a 729 combinaisons.
- Ecriture unique strictement 33154/65535, Auto OFF et OFF/TRAVAIL ;
  CRONO exclu, aucun etat optimiste ou commande Auto/marche/arret.
- Marqueur Powerful prive et synchronise avant envoi ; toute commande
  bloque les autres controles, cible persistante meme si option desactivee.
  Relecture immediate puis polling, aucune attente HomeKit supplementaire,
  aucun retry d'ecriture ni restauration. Corruption/echec stockage refuses.
- Effets physiques, interaction Auto actif et pilotage dans Maison restent
  a valider ; aucune commande sur appareil par l'assistant dans ce lot.
- Compilation/lint et 256 tests reussis sous Homebridge 2 sur Node 22/24.
  Sous Homebridge 1, compilation et 21 tests cibles (Powerful, GUI et
  chargement du paquet) reussis sur Node 22/24. Matrice CI complete conservee.

## 0.1.0-beta.15 — preparee le 2026-10-11, non publiee

- Essai local protege Powerful ON/OFF, confirmation independante, candidat
  strict 33154/65535, libelles OFF/ON, CRONO exclu. Auto OFF et phase
  OFF/TRAVAIL par precaution ; cible identique refusee.
- Une seule ecriture puis au plus trois relectures des quatre reglages,
  sans commande Auto, marche/arret ou restauration, ni retry d'ecriture.
- Reutilise les gardes Auto et l'historique de confirmation existants ;
  changement de mode efface choix et confirmation dans le formulaire.
- Premier essai Powerful ON valide le 2026-10-12 : premiere relecture OFF,
  deuxieme ON a 07:37:29 locale, puis confirmation ON dans Nobis-Fi par
  l'utilisateur. Auto reste 0, niveaux demandes puissance 5 et ventilation 4.
  Commande OFF et effets physiques non encore valides ; bouton Maison
  reporte jusqu'a validation du cycle.
- Compilation/lint et 241 tests reussis sous Node 22/24 ; paquet de
  100 fichiers verifies. Formulaire Powerful affiche localement, choix vide
  et confirmation decochee ; aucun envoi cloud par l'assistant.

## 0.1.0-beta.14 — preparee le 2026-10-11, non publiee

- Compatibilite automatisee avec Homebridge 1.11.4 et 2.4.0 sur Node 22/24 :
  232 tests reussis sur chacune des quatre combinaisons.
- Adapte uniquement le chargement de l'API interne dans les tests :
  Homebridge 2 est ESM et refuse l'ancien sous-chemin lib/api.js.
  Aucun import runtime Homebridge ajoute ni comportement API/HomeKit modifie.
- Homebridge 2 devient la dependance de developpement ; matrice CI etendue
  aux deux versions avec compilation, lint, tests et controle du paquet.
- Pas d'essai de bridge appaire ou GUI Homebridge 2, pas de certification
  Verified revendiquee ; aucune commande envoyee sur appareil.
- Complete avec un test de la vraie archive npm chargee par le gestionnaire
  Homebridge, sans sources ni node_modules : configuration absente, cloud
  desactive et dependances invalides restent hors ligne sans creer d'identite.
  Lancement repete et arret verifies ; quatre tests supplementaires passes
  sous les quatre combinaisons Homebridge/Node. Archives temporaires nettoyees.
  Pas de nouvelle version pour cet ajout de validation.

## 0.1.0-beta.13 — preparee le 2026-10-11, non publiee

- Verification automatique du contenu npm en CI et avant publication :
  liste exacte des fichiers compiles et documents requis, points d'entree,
  fichiers manquants, supplementaires, vides ou dupliques.
- Refuse les anciens modules compiles restes dans dist et les fichiers
  prives hors liste autorisee ; verifie la synchronisation du lockfile.
  Ne pretend pas detecter des secrets dans le contenu des fichiers autorises.
- Ajoute six tests fictifs de la validation du paquet, sans reseau ni
  commande sur appareil. Aucun changement de comportement HomeKit/API.
- Compilation et lint reussis ; six nouveaux tests et controle du vrai
  paquet passes sous Node 22/24 : exactement 100 fichiers attendus.
  Suite fonctionnelle precedente non relancee pour ce changement d'outillage.

## 0.1.0-beta.12 — preparee le 2026-10-11, non publiee

- Ajoute les dependances des options au schema GUI, en accord avec
  la validation runtime existante. Aucun controle active automatiquement.
- Descriptions cloud, consigne et ventilation corrigees selon les
  observations Maison : curseurs presents mais grises en OFF,
  activation commandant le poele et controles non encore exposes.
- Compare schema et runtime sur 243 combinaisons d'options ; Ajv
  ajoute uniquement aux dependances de developpement pour ces tests.
- Aucun changement de commande ou nouvel essai sur appareil.
- Compilation/lint et 226 tests reussis sous Node 22/24, dont
  concordance GUI/runtime sur les 243 combinaisons. Version et
  lockfile synchronises en beta.12.

## 0.1.0-beta.11 — preparee le 2026-10-11, non publiee

- Confirmation differee des essais locaux Auto, puissance et ventilation :
  une ecriture, au plus trois relectures espacees de cinq secondes
  si la valeur reste differente. Arret des la concordance ou erreur.
- Historique des relectures affiche et valide strictement ; pas de
  faux succes apres un job termine ou une reponse incoherente.
- Reutilise la logique de confirmation consigne dans un helper partage.
  Pas d'attente supplementaire dans les setters HomeKit ; verrous et
  confirmation par polling Homebridge conserves.
- Inclut les regressions de stockage ajoutees apres beta.10.
  Auto OFF et Powerful restent non testes en ecriture sur appareil ;
  aucun nouveau controle Maison ni essai reel lance.
- Compilation/lint et 225 tests fictifs Node 22/24 reussis, avec
  confirmation differee sans nouvelle ecriture et historique invalide
  refuse. Interface verifiee avec POST intercepte, sans acces cloud.

## 0.1.0-beta.10 — preparee le 2026-10-11, non publiee

- Essai manuel local Auto ON/OFF, sans controle HomeKit ajoute.
  Premier envoi ON confirme dans Nobis-Fi par l'utilisateur ;
  relecture immediate encore OFF. Retour manuel Auto OFF confirme
  dans Nobis-Fi ; commande API OFF non encore validee.
- Carte stricte 33128/65535 et libelles OFF/ON, cible differente,
  OFF/TRAVAIL et Powerful OFF par precaution ; confirmation independante.
- Une seule ecriture puis lecture des quatre reglages, sans retry,
  activation du poele, restauration ou autre commande de niveau.
- Auto peut agir sur puissance/ventilation par son fonctionnement propre ;
  les retours cloud ne prouvent pas un effet physique.
- Compilation/lint et 219 tests fictifs Node 22/24 reussis.
  Interface validee par POST intercepte, sans requete cloud.
  Paquet de 97 fichiers sans etat prive, version et lockfile synchronises.
- Fiabilisation : quatre tests de regression supplementaires pour les
  marqueurs marche/arret, consigne et ventilation corrompus au redemarrage,
  et un echec de persistance ventilation avant POST. Tests cibles Node
  22/24 et lint reussis ; aucun changement de comportement runtime.

## 0.1.0-beta.9 — preparee le 2026-10-11, non publiee

- Test manuel local de puissance de chauffe 1..7, distinct de
  marche/arret et ventilation ; aucune nouvelle commande HomeKit.
- Profil strict power_set 33120/65535 ; OFF/TRAVAIL, Auto/Powerful OFF,
  cible differente sans enumeration speciale, confirmation par clic.
- Une ecriture puis une lecture des quatre reglages ; aucun retry,
  allumage ou retour automatique. Premier changement 5 vers 3 confirme
  dans Nobis-Fi par l'utilisateur ; relecture immediate encore a 5.
  Restauration manuelle a 5 confirmee dans Nobis-Fi ; effet thermique
  et delai de propagation non confirmes.
- Capacite API independante, verrou d'ecriture commun, route locale
  protegee et interface reutilisant les controles de niveau existants.
- Beta.8 constatee sur npm pendant la preparation de beta.9.
- Compilation/lint et 213 tests fictifs Node 22/24 reussis.
  Interface verifiee avec POST intercepte et donnees fictives,
  sans commande cloud. Paquet de 94 fichiers sans etat prive verifie ;
  version package/lockfile beta.9 synchronisee.

## 0.1.0-beta.8 — publiee le 2026-10-11

- Option GUI desactivee par defaut : remplace le Thermostat par un
  HeaterCooler chauffage seul avec ventilation avant integree.
  Meme UUID, capteur, interrupteur et verrous ; aucun Fanv2.
- Active commande le poele ; ECO STOP correspond a ACTIVE/IDLE.
  Curseur ventilation present dans Maison selon le retour utilisateur,
  mais grise poele eteint ; pilotage depuis Maison encore a confirmer.
- Niveaux 1..7 normalises en 14/29/43/57/71/86/100 %, pas un debit
  mesure. Reponse HAP normalisee exclusivement apres relecture API.
  OFF/PS et libelles speciaux ne deviennent pas des vitesses.
- Commande unique protegee OFF/TRAVAIL, Auto/Powerful OFF ; aucune
  activation de poele, retry ou restauration automatique.
  Marqueur ventilation prive persistant, partage des verrous entre
  tous les controles, reprise sans rejouer meme option desactivee.
- Le seul essai physique acquis reste 4 vers 6 hors HomeKit ;
  integration Maison et autres niveaux encore experimentaux.
- Compilation/lint et 207 tests fictifs Node 22/24 reussis.
  Paquet npm de 91 fichiers verifie, sans etat prive ;
  version package/lockfile synchronisee en beta.8.

## 0.1.0-beta.7 — preparee le 2026-10-11, non publiee

- Test manuel local de ventilation avant, confirmation explicite, profil
  strict de carte, commande unique puis relecture ; aucun controle HomeKit.
- Essai limite a niveaux 1..7, OFF/TRAVAIL, Auto et Powerful OFF.
  OFF/PS exclus ; ces precautions ne sont pas des restrictions API prouvees.
- Capacite independante des commandes consigne et marche/arret, partage
  du verrou d'ecriture et absence de retry/restauration automatiques.
- Premier essai utilisateur 4 vers 6 confirme : API et Nobis-Fi a 6,
  changement physique constate, puis retour manuel a 4 confirme.
  Autres niveaux et conditions non valides ; aucun envoi par l'assistant.
- Compilation/lint et 194 tests fictifs Node 22/24 reussis ; paquet npm
  de 88 fichiers verifie, version et lockfile synchronises.

## 0.1.0-beta.6 — preparee le 2026-10-11, non publiee

- Autorise l'arret depuis ECO STOP dans l'interrupteur, le Thermostat
  et le test manuel local, apres confirmation utilisateur d'une extinction
  reelle via Nobis-Fi dans cette phase.
- Meme commande OFF unique, verification de phase fraichement relue,
  aucun retry ni mise a jour optimiste. Confirmation exclusivement en OFF.
- Consigne depuis ECO STOP toujours bloquee ; activation et autres
  restrictions conservees. Test Maison depuis cette phase encore requis.
- Compilation/lint et 187 tests fictifs Node 22/24 reussis ; paquet npm
  verifie (85 fichiers), version et lockfile synchronises.

## 0.1.0-beta.5 — preparee le 2026-10-11, non publiee

- Phase ECO STOP validee par comparaison du code 8/libelle exact a
  Nobis-Fi. L'utilisateur confirme activation conservee et reprise
  automatique attendue. Switch ON, Thermostat cible HEAT/etat courant
  OFF (pause) ; aucun etat de combustion deduit.
- ECO STOP seul ne rend plus les tuiles indisponibles. Les verrous,
  erreurs, MAN et phases inconnues restent traites comme auparavant.
- Commandes depuis ECO STOP refusees sans requete par les tuiles ;
  restrictions API et confirmation ON exclusivement en TRAVAIL conservees.
- Inclut le diagnostic en lecture seule beta.4 non publie.
- Compilation/lint et 184 tests fictifs reussis sous Node 22/24, dont
  polling ECO STOP sans commande et conservation du verrou ON.
  Paquet de 85 fichiers verifie ; version et lockfile en beta.5.

## 0.1.0-beta.4 — preparee le 2026-10-10, non publiee

- Diagnostic navigateur dedie en lecture seule : puissance, ventilation
  avant, Auto et Powerful candidats, verification stricte de la carte
  et lecture unique du buffer 1. Aucun nouveau controle HomeKit.
- Comparaison utilisateur des valeurs 5 / 4 / OFF / OFF a Nobis-Fi.
  Autres valeurs et commandes non validees ; PS reste un libelle de carte,
  Powerful CRONO hors domaine refuse, aucune vitesse effective deduite.
- Tests de profils, valeurs, erreurs, absence d'ecritures et effacement
  de l'affichage, sans communication avec un appareil reel.
- Compilation/lint et 181 tests reussis sous Node 22/24 ; paquet npm
  de 85 fichiers verifie, version et lockfile synchronises.

## 0.1.0-beta.3 — 2026-10-10

- Remplacement du service HeaterCooler de la tuile Chauffage par Thermostat
  OFF/HEAT uniquement, pour tester l'acces au curseur de consigne a l'arret
  dans Maison. L'etat OFF n'est pas maquille et la consigne n'envoie pas ON.
- Migration automatique sur le meme accessoire/UUID, conservation du
  capteur, de l'interrupteur et des verrous de commandes incertaines.
- Confirmation utilisateur de la consigne beta.2 ; curseur HeaterCooler
  masque/grise quand le poele est eteint dans Maison.
- Retour utilisateur beta.3 : le curseur Thermostat reste grise en OFF.
  Le changement de service ne resout donc pas cette limitation UI.
- Compilation/lint, 176 tests fictifs Node 22/24 et paquet npm verifies.

## 0.1.0-beta.2 — preparee le 2026-10-10, non publiee

- Tuile HeaterCooler optionnelle en mode chauffage uniquement, conservant
  le capteur et l'interrupteur existants sur le meme accessoire.
- Consigne HomeKit 7–40 Celsius, pas entier, valeurs relues uniquement :
  aucune mise a jour optimiste ; MAN et phases non validees indisponibles.
- Commande de consigne unique, sans retry ni restauration automatique.
  Verrou prive persistant partage avec les controles marche/arret ;
  reprise depuis la relecture cible uniquement.
- Confirmation utilisateur du cycle complet ON/TRAVAIL/OFF depuis Maison
  sur beta.1, y compris retour final de l'interrupteur a OFF.

## 0.1.0-beta.1 — 2026-10-10

- Interrupteur HomeKit experimental sur activation GUI explicite :
  etats OFF/TRAVAIL relus uniquement, transitions indisponibles, commandes
  uniques et verrou prive persistant avant envoi, sans replay au redemarrage.
  Aucun changement de UUID du capteur existant ni thermostat invente.

- Test manuel local marche/arret, desactive dans Homebridge : masque
  candidat 255 derive de la carte, confirmation physique, phases initiales
  imposees et ecriture unique sans retry ni commande inverse.

- Phases typees pour les quatre paires code/libelle comparees sur appareil :
  OFF, debut, TRAVAIL et arret en cours. Autres codes ou libelles differents
  restent explicitement non valides/inconnus, sans conversion HomeKit.

- Diagnostic Homebridge des changements de codes d'etat depuis la lecture
  de temperature existante, sans requete supplementaire. Les erreurs de
  profil d'etat restent explicites sans invalider une temperature valide.

- Observation des codes d'etat en lecture seule : entiers bruts et libelles
  FRE de la carte, valeurs inconnues explicites, aucun etat HomeKit deduit.

- Mode de lecture seule de consigne, sans activation d'ecriture, avec
  distinction typee temperature/MAN et decodage partage avant/apres commande.

- Confirmation de consigne par au plus trois lectures espacees, sans
  repetition d'ecriture, avec arret sur concordance, erreur ou limite.

- Diagnostic manuel de consigne reelle sur confirmation et clic dedies :
  profil strict, lecture avant/apres, aucune repetition d'ecriture sur 401
  ou erreur, resultat incertain explicite et restauration manuelle uniquement.
  Ecriture desactivee dans les clients habituels et dans Homebridge.

- Preparation hors ligne d'une consigne candidate : profil strict, aucune
  transmission, refus du mode MAN et des metadonnees manquantes, tests fictifs.

- Journal de reprise precis pour le capteur et delai du prochain essai,
  sans temperature, identifiant ou autre donnee privee.
- Regression du capteur sur appareil hors ligne, sans lecture de buffer
  ni etat OFF invente.
- Documentation des premiers essais Maison, redemarrage et reprise reels,
  et du statut de publication npm.

## 0.1.0-beta.0

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
