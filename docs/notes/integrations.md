# Copad × rendez-vous existants — étude d'options d'intégration

> Étude seule. Aucun fichier du repo n'a été modifié.
> Date : 2026-08-03. Contrainte pilote : **idéalement une seule personne installe quelque chose** ;
> les autres reçoivent un lien et cliquent. Contrainte secondaire : **préserver le serverless**.

---

## 0. Note de méthode et statut de vérification

L'egress de cette session **bloque `developers.google.com`, `learn.microsoft.com`,
`developer.zoom.us`, `api.slack.com`, `developer.chrome.com`, `docs.discord.com` en fetch direct**
(403 de la passerelle, cf. `curl "$HTTPS_PROXY/__agentproxy/status"`). J'ai contourné de deux façons :

- **Lecture directe des sources officielles miroir sur GitHub** (`raw.githubusercontent.com` passe) :
  la doc Teams est écrite dans `MicrosoftDocs/msteams-docs`, la doc Chrome dans
  `GoogleChrome/developer.chrome.com`. Ces éléments sont marqués **[V-doc]** — j'ai lu le texte.
- **Résumés de recherche web portant sur les pages officielles** : marqués **[V-recherche]** —
  la citation vient de la page officielle mais je n'ai pas pu ouvrir la page moi-même.
- Ce que je n'ai **pas** pu confirmer est marqué **[NON VÉRIFIÉ]** et listé en §8.

---

## 1. TL;DR — le classement

| Rang | Option | Pourquoi |
|---|---|---|
| **1** | **Room dérivée du lien de réunion** (pur client, dans Copad) | **Zéro installation pour tout le monde, y compris le propriétaire.** Le lien de réunion est le seul identifiant que *tous* les participants possèdent déjà. Serveur : aucun. |
| **2** | **Extension MV3 Chrome/Edge, non packagée** | Une seule personne installe (`Load unpacked`, 0 €, 0 revue). Automatise le geste du #1. Ne casse rien : Copad reste un onglet normal → P2P/E2E/cache intacts. |
| **3** | **Google Calendar via Apps Script (déclencheur ou conferencing add-on)** | Une seule personne installe (`Test deployments` → son propre compte). Les invités reçoivent le lien **dans l'invitation** : rien à installer, et le rendez-vous *est* le canal de notification. Serveur : aucun de notre côté (Apps Script tourne chez Google). |
| **4** | **Lien collé à la main** dans le chat de réunion / Slack / Discord | Zéro install, zéro dev. C'est le baseline honnête contre lequel tout le reste doit se justifier. |
| **5** | **Teams meeting app (tab)** | Le seul hôte « propre » où **une seule personne** ajoute l'app et **tous les participants la voient**. Mais : sideload = *toggle admin du tenant*. Et l'embed iframe dégrade l'architecture. |
| 6 | **Zoom App (privée, Collaborate + Guest mode)** | Les participants n'installent rien et sont *invités* par le client Zoom. Mais serveur OAuth requis, et app privée = utilisateurs du compte du dev seulement. |
| 7 | **.ics / Outlook** | Marche partout, mais c'est du « lien collé » avec plus de plomberie. |
| 8 | **Google Meet Add-ons SDK** | **Disqualifié par la contrainte** : les autres participants sont explicitement *« invités à lancer ou installer l'add-on »*. |
| 9 | **Slack (app)** | Tout ce qui est intéressant (slash command, unfurl, huddle) exige un endpoint HTTP. Sans serveur : rien au-delà du copier-coller. |
| 10 | **Discord Activities** | **WebRTC non supporté** dans les Activities et tout le réseau passe par le proxy Discord → casse le transport par défaut de Copad. |
| 11 | **Bookmarklet / userscript** | Le bookmarklet meurt sur les CSP des grosses apps ; le userscript exige… d'installer Tampermonkey (donc une extension, mais celle de quelqu'un d'autre). |
| 12 | **Web Share Target / PWA / protocol handler** | Exige que **le destinataire** installe la PWA. Inverse exactement la contrainte. |

**La conclusion structurante** est en §2 : les options qui *embarquent* Copad dans l'hôte (Meet
add-on, Teams tab, Zoom App, Discord Activity) sont celles qui **abîment le plus l'architecture**
(iframe tiers ⇒ stockage partitionné, WebRTC contraint ou interdit, CSP de l'hôte). Les options qui
*lancent* Copad (extension, calendrier, lien) le laissent dans un onglet de premier niveau, où
P2P + chiffrement + cache local fonctionnent tels quels. **Copad doit être un lanceur, pas un embed.**

---

## 2. Le mécanisme commun : la room dérivée du lien de réunion

Avant de comparer les hôtes, il faut voir que **le problème d'identité est déjà résolu sans aucun SDK**.

Copad n'a pas d'identité — mais il n'en a pas besoin. Il lui faut seulement que N personnes calculent
**le même `RoomId`** au même moment. Or ces N personnes partagent déjà un secret de faible entropie
que personne d'autre n'a : **le lien de la réunion**.

```
canonical  = normalise(lien de réunion)        // ex. "meet:abc-defg-hij"
room       = base32( SHA-256("copad/room|" + canonical) ).slice(0, 16)
key        = base64url( SHA-256("copad/key|"  + canonical) )
URL Copad  = https://<deploy>/?room=<room>#k=<key>
```

Propriétés :

- **Zéro serveur, zéro install, zéro compte.** C'est du `crypto.subtle` côté client.
- **Rien de nouveau à ajouter à Copad pour que ça marche** : `App.svelte:273 roomFromUrl()` lit déjà
  `?room=`, et `App.svelte:95 roomCipher` a déjà la précédence `currentSecretKey() (#k=) → mot de
  passe de room → stratégie VITE_ROOM_AUTH`. Une URL `?room=X#k=Y` fonctionne **telle quelle sur le
  déploiement `public` par défaut**. N'importe quel générateur externe (extension, bookmarklet,
  Apps Script) produit donc un lien Copad standard — aucun changement de code requis pour le jalon 1.
- **Le serveur de signaling ne voit qu'un hash.** Il n'apprend ni le code de réunion ni le contenu :
  la clé `#k=` n'est jamais envoyée (fragment), et elle chiffre déjà le room côté y-webrtc.
- **Deux dérivations convergent** : celui qui clique sur le lien partagé et celui qui colle le lien de
  réunion dans Copad atterrissent dans la même room. Ça donne un plan B naturel quand le lien se perd.

Limites à documenter :

- **Entropie du lien de réunion.** Code Meet = 10 lettres minuscules ≈ 26¹⁰ ≈ 1,4·10¹⁴ → hors de portée
  d'une énumération. **ID Zoom = 10–11 chiffres ≈ 10¹⁰–10¹¹ → énumérable** par un attaquant motivé :
  il faut **inclure le `pwd=` dans le canonical** pour Zoom, sinon la room est devinable.
- **Le modèle de confiance est exactement celui de la réunion** : qui a le lien de réunion a le pad.
  C'est le bon défaut (personne ne rejoint le pad sans pouvoir rejoindre la visio), mais un lien de
  réunion qui traîne dans un ticket public expose aussi le pad. À écrire noir sur blanc.
- **Normalisation** : c'est là que sont les bugs. `meet.google.com/abc-defg-hij?authuser=1`,
  `.../abc-defg-hij#`, le lien Teams `…/l/meetup-join/19%3ameeting_XXX%40thread.v2/0?context=…`
  (percent-encodé, avec un `context` volatile) — il faut extraire l'**identifiant stable** par hôte,
  pas hasher l'URL brute. Un test par hôte, sinon deux participants divergent silencieusement.

---

## 3. Tableau comparatif

### 3a. Installation, serveur, distribution

| Option | Serveur requis | Qui installe quoi | Les autres : un lien suffit ? | Friction de distribution |
|---|---|---|---|---|
| **Room dérivée du lien** (in-app) | **Non** | **Personne** | **Oui** (ou ils collent le lien de réunion) | Aucune |
| **Extension MV3 non packagée** | **Non** | 1 personne : `chrome://extensions` → Developer mode → **Load unpacked** | **Oui** | Aucune (0 €, aucune revue). Chrome Web Store *unlisted* possible plus tard (5 $ à vie, revue de qq h à qq jours) [V-recherche] |
| **Bookmarklet** | Non | 1 personne : glisse un favori | Oui | Aucune — mais CSP casse l'injection [V-recherche] |
| **Userscript** | Non | 1 personne : **Tampermonkey/Violentmonkey** (donc une extension tierce) + le script | Oui | Aucune |
| **Calendar / Apps Script** | Non (exécution chez Google) | 1 personne : `Deploy → Test deployments → Install` sur **son** projet Apps Script [V-recherche] | **Oui** (le lien est dans l'invitation) | Aucune tant qu'on reste en test deployment ; Marketplace requis pour diffuser à d'autres |
| **Calendar conferencing add-on** | Non (idem) | 1 personne (l'organisateur) | **Oui** — l'entrée « conférence » de l'événement est visible de tous les invités | Marketplace (privé = pas de revue Google, **mais domaine Workspace requis**) [V-recherche] |
| **.ics / Outlook** | Non | Personne | Oui | Aucune |
| **Google Meet add-on** | Non (front statique en iframe) mais **projet GCP + Marketplace SDK obligatoires** | **Tout le monde** : *« other users in the call are prompted to either launch or install the add-on »* [V-recherche] | **Non** | Publication Marketplace (privée = domaine Workspace, publique = revue Google) |
| **Teams meeting app (tab)** | **Non** pour un tab pur (page statique HTTPS + manifeste) | 1 personne (organisateur/présentateur) ajoute l'app à la réunion ; **le tab s'affiche ensuite pour tous les contextes de cette réunion** [V-doc] | **Oui, dans Teams** | **Toggle admin du tenant** « Upload custom apps » [V-doc] — c'est le vrai mur |
| **Zoom App (privée)** | **Oui** : endpoint de redirect OAuth + client secret [V-recherche] | 1 personne installe l'app privée ; participants et **invités non authentifiés** entrent via Collaborate/Guest mode [V-recherche] | Oui, dans Zoom | App privée = pas de revue, mais **réservée aux utilisateurs du compte du dev** [V-recherche] |
| **Slack (app)** | **Oui** dès qu'on veut mieux qu'un copier-coller (slash command, unfurl, workflow webhook) | 1 personne crée l'app ; installation dans le workspace = souvent **approbation admin** | Oui | Revue Slack seulement pour la distribution publique |
| **Discord Activity** | **Oui** (échange de code OAuth avec secret) + tout le trafic via le proxy Discord | Personne côté participants (l'Activity se lance dans le salon vocal) | Oui | App en dev mode limitée ; publication pour aller plus loin |
| **Web Share Target / PWA** | Non | **Le destinataire** doit installer la PWA [V-recherche] | Non | — |

### 3b. Ce que l'hôte fournit, effort, réversibilité

| Option | Identité fournie par l'hôte | Présence fournie | Canal de notification | Effort dev | Réversibilité si l'hôte change les règles |
|---|---|---|---|---|---|
| Room dérivée du lien | Non (mais le lien *est* le jeton d'appartenance) | Non (celle de Copad suffit) | Aucun — l'humain colle | **~2–4 h** | **Totale** : rien ne dépend d'un hôte |
| Extension MV3 | Indirecte (URL de la réunion) | Non | Presse-papier + collage manuel ; injection DOM dans le chat = fragile | **~1 j** pour un MVP | Bonne : le sélecteur DOM casse, le calcul du lien non |
| Bookmarklet | Idem | Non | Idem | ~2 h | Bonne mais fragile aux CSP |
| Calendar / Apps Script | **Oui** : liste des invités = identités Google | **Non** (asynchrone), mais le RDV *est* la promesse de présence | **Oui, excellent** : l'invitation + les rappels calendrier | ~0,5–1 j | Bonne (API Calendar très stable) |
| Conferencing add-on | Oui | Oui (au moment du join) | **Oui** : bouton de conférence dans l'événement | ~1–2 j | Moyenne (manifeste Workspace + politique Marketplace) |
| .ics | Partielle (ATTENDEE) | Non | L'invitation | ~2 h | Totale (RFC 5545) |
| Meet add-on | Oui (compte Google) | **Oui** (participants de l'appel) | **Oui** : `startActivity()` invite tout le monde [V-recherche] | ~3–5 j + cycle Marketplace | **Faible** : dépendance totale au SDK + au Marketplace |
| Teams tab | Oui (`getContext()` : meetingId, user, tenant ; identité *vérifiée* = SSO Entra) [V-doc] | **Oui** | Partage sur la **meeting stage** ; poster dans le chat exige un **bot** (donc serveur) | ~3–5 j | Faible : manifeste + politiques admin |
| Zoom App | Oui | **Oui** | **Oui** : Collaborate Mode invite les participants ; dégrade en partage d'écran si refus [V-recherche] | ~4–6 j + serveur | Faible |
| Slack | Oui | Non (pas de notion de présence exploitable sans serveur) | Message dans le canal — **serveur requis** | ~2 j + hébergement | Moyenne |
| Discord Activity | Oui | Oui (salon vocal) | Oui (l'activité s'affiche dans le salon) | **Élevé** : il faut aussi remplacer WebRTC | Faible |
| PWA / protocol handler | Non | Non | Non | ~0,5 j | Bonne mais sans intérêt ici |

---

## 4. Fiches par option

### 4.1 — Room dérivée du lien de réunion *(le socle)*

**Le geste.** Je suis en réunion. J'ouvre Copad. Un champ en page d'accueil : *« Collez le lien de
votre réunion »*. Je colle `https://meet.google.com/abc-defg-hij`. Copad calcule la room + la clé et
m'y emmène. Je copie l'URL Copad et je la colle dans le chat de la réunion. Les autres cliquent :
ils sont dedans, avec le contenu chiffré sous une clé que le serveur de signaling n'a jamais vue.
Celui qui a raté le lien colle simplement le lien de réunion dans le même champ — il arrive au même endroit.

**Coût.** ~2–4 h. Un module `src/collaboration/meetingLink.ts` : un parser
`parseMeetingLink(raw: string): MeetingRef | null` (au sens « parse, don't validate » du repo, avec un
type nommé par hôte), puis `roomFromMeeting(ref): Promise<{ room: RoomId; key: RoomCredential }>` qui
fait deux SHA-256 domain-separated via `crypto.subtle` (déjà le seul site crypto autorisé :
`src/collaboration/roomCrypto.ts`). Plus un petit composant d'accueil. Aucun serveur, aucune dépendance.

**Ce que ça ne fait pas.** Ça ne supprime pas le collage manuel du lien dans le chat. C'est
précisément ce que l'extension automatise.

---

### 4.2 — Extension navigateur MV3 *(la recommandation court terme)*

**Le geste.** Je suis dans l'onglet Google Meet. Je clique l'icône Copad dans la barre d'outils. Une
popup : *« Pad pour cette réunion »* + le lien déjà copié dans le presse-papier + un bouton
« Ouvrir ». Je colle dans le chat Meet. Fin.

**Ce qu'on peut faire sans serveur — beaucoup :**

- **Lire l'identifiant de la réunion : trivial et sans permission effrayante.** Pas besoin de scraper le
  DOM ni d'API d'hôte : le code de réunion **est dans l'URL** (`meet.google.com/abc-defg-hij`, le
  `19:meeting_…@thread.v2` de Teams, `/j/<id>` chez Zoom). Et la permission **`activeTab`** suffit :
  elle donne *« the URL, title, and favicon for that tab »* après un geste utilisateur explicite, et
  **ne déclenche aucun avertissement de permission** [V-recherche]. Une extension de ~50 lignes,
  sans `host_permissions`, sans avertissement à l'installation.
- **Injecter un bouton dans l'UI de la réunion** : oui, via un content script — qui tourne dans un
  *monde isolé* et n'est donc pas soumis à la CSP de la page pour son propre code (contrairement au
  bookmarklet, cf. 4.3). Coût : un `host_permissions` par hôte + des sélecteurs DOM fragiles.
  **À éviter au jalon 1**, à garder pour le confort plus tard.
- **Poster dans le chat de la réunion** : aucune API. Il faut simuler la saisie dans un champ contrôlé
  par React (setter natif + événement `input`) — ça marche, ça casse à chaque refonte UI. **Fragile,
  pas au jalon 1.** [NON VÉRIFIÉ sur Meet/Teams en 2026]
- **Bonus non évident : poster dans Slack/Discord sans serveur.** Un service worker MV3 avec
  `host_permissions` **n'est pas soumis à la same-origin policy** : *« a script executing in an
  extension service worker can talk to remote servers outside of its origin, as long as the extension
  requests host permissions »* [V-recherche]. Un `POST` direct vers un **Incoming Webhook Slack** ou un
  webhook de Workflow devient possible **sans backend** — ce que la page web de Copad, elle, ne peut
  pas faire (préflight CORS bloqué [V-recherche]). C'est le seul chemin « Slack sans serveur » qui tienne.

**Distribution — le point crucial.** Oui, `Load unpacked` en mode développeur, sans passer par le
store, c'est le mode d'emploi officiel : `chrome://extensions/` → Developer mode → Load unpacked
[V-recherche]. 0 €, aucune revue, aucun admin. Deux réserves :

- Chrome affiche historiquement le bandeau *« Disable developer mode extensions »* au démarrage, et
  des sources 2026 (de qualité SEO médiocre) affirment que **Chrome 149+ désactive une extension après
  une mise à jour** notamment quand elle est chargée non packagée. **[NON VÉRIFIÉ — à confirmer sur la
  machine cible avant de s'engager.]** Parade documentée : publier en **unlisted** sur le Chrome Web
  Store (5 $ une fois, revue de quelques heures à quelques jours) — l'extension reste invisible et
  n'est installable que par lien [V-recherche].
- **Edge** : même `Load unpacked` en mode développeur [V-recherche]. **Firefox** : signature AMO
  **obligatoire** en release/beta ; l'auto-distribution existe (signé mais non listé) ; le non signé
  n'est possible qu'en Developer Edition / Nightly / ESR [V-recherche]. Donc : Chrome/Edge d'abord.

**Contraintes MV3 à connaître** : service worker (pas de page de fond persistante), **pas de code
distant** — tout le JS doit être dans le paquet ; donc la dérivation de room doit être **dupliquée**
dans l'extension, ou l'extension se contente d'ouvrir `https://<copad>/?meet=<lien encodé>` et laisse
Copad faire le calcul. **La seconde option est meilleure** : une seule implémentation du hash, et
l'extension devient un lanceur de 30 lignes qu'on n'a jamais à re-publier quand la dérivation évolue.

---

### 4.3 — Bookmarklet / userscript

**Bookmarklet.** Zéro installation formelle, mais : *« Bookmarklets fail to run if the page has a
restrictive CSP »*, et l'exemption prévue par la spec CSP n'est pas implémentée uniformément — Chrome
laisse en général le bookmarklet s'exécuter mais bloque ce qu'il **injecte** dans la page ; c'est la
raison pour laquelle des produits entiers ont migré du bookmarklet vers l'extension [V-recherche].

**Conséquence pratique** : un bookmarklet *auto-suffisant* (`javascript:` qui lit `location.href`,
calcule et fait `window.open`) a de bonnes chances de marcher sur Chrome ; un bookmarklet qui
**injecte un `<script>` ou un bouton stylé** dans Meet/Teams sera bloqué. Autre limite : sur mobile,
les bookmarklets sont pénibles voire impossibles.

**Verdict** : excellent **prototype d'une heure** pour valider la dérivation de room en conditions
réelles, mauvais produit final. Le userscript (Tampermonkey) est plus robuste que le bookmarklet…
au prix d'installer une extension tierce, ce qui est *pire* qu'installer la nôtre.

---

### 4.4 — Google Calendar (trois variantes)

C'est l'option **la plus sous-estimée**, exactement comme le suggère le brief.

**(a) Le lien collé à la main dans l'invitation.** Zéro install, zéro dev, marche avec Meet, Zoom,
Teams, une salle physique. L'invitation est **le meilleur canal de notification qui existe** : elle
arrive dans la boîte de tous, elle a des rappels natifs, elle survit au fait que personne ne lise le
chat. À proposer dans le README avant toute intégration.

**(b) Apps Script : un déclencheur qui pose le lien tout seul.** L'organisateur installe **son**
script (`Deploy → Test deployments → Install`, sur son propre compte) [V-recherche]. Le déclencheur
`onEventUpdated()` se déclenche à toute création/modification d'événement [V-recherche] ; le script
lit les événements changés et **ajoute une ligne « Pad Copad : <lien> » dans la description**. Les
invités ne font rien : ils ouvrent l'invitation, le lien y est.

- Piège documenté : *« These triggers do not tell you which event changed »* — il faut faire un
  **sync incrémental** avec `Events.list()` + `nextSyncToken` (service Calendar avancé) [V-recherche].
  C'est ~50 lignes, mais ce n'est pas trivial.
- Alternative plus bête et plus robuste : **un déclencheur horaire** (toutes les 15 min) qui scanne les
  événements des prochaines 24 h et complète ceux qui n'ont pas encore de lien. Idempotent, pas de
  token de sync, ~20 lignes.
- « Serveur » : le code tourne chez Google, gratuitement, sans infra à nous. Ce n'est pas *notre*
  serveur — mais c'est du code côté serveur, et c'est un arbitrage à assumer explicitement, pas à
  masquer : le script a accès en écriture au calendrier de la personne qui l'installe.

**(c) Conferencing add-on** : un add-on Workspace peut déclarer une **solution de conférence tierce**,
c'est-à-dire ajouter « Copad » à côté de « Google Meet » dans le sélecteur de conférence d'un
événement [V-recherche]. L'événement porte alors nativement l'entrée de conférence, visible de tous
les invités. C'est la version la plus élégante — mais la publication (même privée) passe par le
Workspace Marketplace, et le publication privée est *restreinte au domaine Workspace* [V-recherche].
Sur un compte Gmail personnel, cette variante est probablement hors d'atteinte **[NON VÉRIFIÉ]** ;
la variante (b) reste, elle, accessible.

**(d) `.ics` / Outlook** : générer un `.ics` avec `URL:` + `DESCRIPTION:` contenant le lien Copad se
fait en pur client. Mais quelqu'un doit quand même envoyer le fichier — donc c'est (a) avec plus
d'étapes. Utile seulement pour un futur bouton « Ajouter au calendrier » depuis Copad.

---

### 4.5 — Google Meet Add-ons SDK

Le SDK existe bien, il est **GA depuis septembre 2024**, la doc est à jour (dernière révision
avril 2026) [V-recherche]. Modèle : **un front statique chargé en iframe** dans le side panel ou la
main stage, déclaré via le **Marketplace SDK** d'un projet Google Cloud (champ `ADD_ON_ORIGINS`)
[V-recherche]. Pas de backend nécessaire côté nous — c'est le bon point.

**Mais la contrainte pilote le tue net** : quand un participant lance l'activité,
*« other users in the call are prompted to either launch or install the add-on »*, l'utilisateur
cliquant *« Install and join »* puis *« Install »* [V-recherche]. **Tout le monde installe.** Le
`startActivity()` / `ActivityStartingState` est par ailleurs un très joli mécanisme (l'état initial du
pad voyage avec l'invitation), et la présence + l'identité sont fournies par l'hôte — c'est
exactement le modèle visé par le brief. Mais il coûte : un projet GCP, une fiche Marketplace (privée
⇒ domaine Workspace, publique ⇒ revue Google), et une installation par participant.

**À garder en tête pour le moyen/long terme, à écarter aujourd'hui.**

---

### 4.6 — Microsoft Teams meeting app (tab)

C'est l'hôte où la contrainte « une seule personne » est la mieux servie — *à un mur près*.

Faits vérifiés dans la doc source [V-doc, `msteams-platform/apps-in-teams-meetings/*`, révision 05/2026] :

- Points d'extension : `meetingChatTab`, `meetingDetailsTab`, **`meetingSidePanel`**, **`meetingStage`**.
- **« After a meeting participant installs an app and configures the tab in meeting, all the targeted
  other contexts of the app for the given meeting starts to render the tab. »** → **une personne
  configure, tout le monde voit.**
- **« Only an organizer or presenter can add, remove, or uninstall apps. »**
- Les utilisateurs **anonymes** peuvent accéder aux apps dans la fenêtre de réunion (rôle présentateur
  ou participant) → les externes ne créent pas de compte.
- `getContext()` expose le `frameContext` et le contexte de réunion (meetingId, utilisateur, tenant).
  Une identité *vérifiée* exige le SSO Entra ; pour dériver une room, le contexte brut suffit.
- Un tab est **une page HTTPS + un manifeste** : **aucun bot, aucun backend requis** (un bot ne
  devient nécessaire que pour poster dans le chat ou recevoir les événements de réunion).
- Apps **non supportées** dans : les appels chiffrés de bout en bout, les réunions instantanées de
  canal, les réunions de canal partagé.

**Le mur** : le sideload (« custom app upload ») exige que **l'admin du tenant** active
`Teams apps → Setup Policies → Global → Upload custom apps`, plus les toggles `Org-wide app settings`
[V-doc]. Sur un tenant d'entreprise, c'est un ticket IT — exactement ce que la contrainte veut éviter.
Sur un tenant de dev (Microsoft 365 Developer Program), c'est activé par défaut [V-doc].

**Bonus repéré** : Microsoft fournit le **Live Share SDK**, décrit comme *« transform Teams apps into
collaborative multi-user experiences without writing any dedicated back-end code »*, adossé à un
**Azure Fluid Relay gratuit et entièrement managé par Teams** [V-doc]. Autrement dit, dans Teams,
l'hôte fournit gratuitement le serveur de collaboration. Séduisant — mais ce serait un **second
moteur CRDT** (Fluid) à côté de Yjs, donc un port `Collab` de plus et un modèle de document
parallèle : très cher, et la page de doc n'a pas été révisée depuis 2022 (aucune annonce de
dépréciation trouvée **[NON VÉRIFIÉ]**).

---

### 4.7 — Zoom Apps

- **Serveur : oui.** La création d'une « General App » impose une **OAuth redirect URL** — *« your
  development redirect URL or endpoint to set up OAuth »* — avec allowlist de domaines et validation
  automatique de domaine [V-recherche]. L'échange du code contre un jeton exige le client secret,
  donc un endpoint qui n'est pas une page statique.
- **App privée** : pas de revue Marketplace, mais *« access restricted to only users under the
  developer's Zoom account »* [V-recherche].
- **Le très bon point** : **Collaborate Mode** *« opens a web app for all meeting participants,
  including support for guest users who aren't signed in to the app »*, et les retardataires
  *« will see a prompt to join if there is a Collaborate session in progress »*. **Guest Mode** permet
  explicitement d'inviter des utilisateurs non authentifiés. Et quand un participant ne peut pas
  rejoindre, l'expérience *« gracefully degrades to a screen-share of the initiator's app view »*
  [V-recherche]. C'est le meilleur canal de notification/présence de toutes les options.
- **La réserve** : *« Unauthenticated users may only use an authenticated user's application »* — donc
  l'app privée n'est utilisable que dans le contexte d'une réunion animée par quelqu'un du compte du
  dev [V-recherche]. Pour un usage perso, ça colle ; pour diffuser, il faut publier.

**Verdict** : le meilleur modèle *fonctionnel*, le pire modèle *serverless*. À réserver au moyen
terme si Zoom est l'hôte dominant du contexte réel.

---

### 4.8 — Slack : où commence exactement l'obligation d'endpoint

**Strictement sans serveur, on peut :**

- Coller un lien dans un canal / un huddle. (C'est tout, honnêtement.)
- Créer un **Workflow Builder** qui poste un message contenant un lien — mais le lien est *statique*,
  donc pas de room par réunion.
- Depuis **une extension** (pas depuis la page web) : `POST` direct sur un **Incoming Webhook** →
  message posté sans backend, grâce à l'exemption CORS du service worker MV3 [V-recherche].
  Depuis le navigateur/la page Copad, c'est bloqué : *« Web-hooks are POST requests and will fail
  CORS pre-flight checks »* ; le contournement `application/x-www-form-urlencoded` existe mais
  n'est *« not idiomatic »* et sans garantie de support [V-recherche].

**L'endpoint devient obligatoire dès que** : slash command (`/copad` → Slack POSTe vers une URL),
link unfurling (Events API → une URL), shortcut/modal, Events API en général, OAuth d'installation
multi-workspace. Il n'y a **aucune** notion de « présence en huddle » exploitable sans serveur
**[NON VÉRIFIÉ : existence d'une API huddle publique en 2026]**.

**Verdict** : Slack n'est pas un hôte de *rendez-vous* pour nous, c'est un **canal de diffusion**. Le
traiter comme tel : le lien y est collé (à la main, ou par l'extension via webhook).

---

### 4.9 — Discord Activities / Embedded App SDK

Modèle : une app web en iframe lancée dans un salon vocal ; personne n'« installe » côté participants.
Sur le papier, idéal. En pratique, **deux blocages rédhibitoires pour Copad** :

- **« currently only WebSockets are supported […] and WebRTC is not supported »** dans les Activities
  [V-recherche, docs.discord.com/developers/activities/development-guides/networking]. Le transport
  **par défaut** de Copad est mort dans ce contexte ; il faudrait basculer sur le hub y-websocket →
  **serveur central dans le chemin des données, donc plus d'E2E**.
- **Tout le réseau passe par le proxy Discord** (`discordsays.com`) : les requêtes externes échouent
  en `blocked:csp` si elles ne sont pas déclarées en **URL Mappings**, et les requêtes relatives
  doivent être préfixées `/.proxy` [V-recherche]. Donc notre signaling/hub doit être déclaré, et
  Discord est en position de couper.
- Serveur requis de toute façon pour l'échange OAuth (client secret).

**Verdict** : le plus mauvais rapport coût/valeur des options « propres ». À écarter sauf si la
communauté cible *est* Discord.

---

### 4.10 — Web Share Target / PWA / protocol handler

- `share_target` **n'est disponible que pour une PWA installée** [V-recherche] — donc pour recevoir un
  lien de réunion « partagé » vers Copad, **c'est le destinataire qui doit installer**. Exactement
  l'inverse de la contrainte.
- `registerProtocolHandler()` : schéma custom obligatoirement préfixé `web+`, support Chrome/Edge 96+
  [V-recherche] ; enregistrement par utilisateur, donc même problème.

**Verdict** : marginal, comme annoncé. Une seule utilité crédible plus tard : sur Android, permettre à
l'utilisateur *déjà convaincu* de « partager » un lien de réunion vers Copad depuis Meet/Zoom mobile.
C'est du confort pour l'installeur, pas une voie de distribution.

---

## 5. Recommandation court terme — « une seule personne installe, aujourd'hui »

**Le combo gagnant : § 4.1 (dans Copad) + § 4.2 (extension lanceur) + § 4.4a (le lien dans l'invitation).**
Aucun serveur, aucun store, aucun admin, aucune dépendance à un SDK d'hôte.

### Jalon 1 — réalisable en quelques heures

**Étape A (~2–3 h) — la dérivation, dans Copad, testée.**
Nouveau module `src/collaboration/meetingLink.ts`, dans le style du repo (parse-don't-validate,
types criants) :

```ts
export type MeetingHost = 'meet' | 'teams' | 'zoom' | 'webex' | 'other';
export type MeetingRef  = { host: MeetingHost; id: string & { readonly _brand: 'MeetingRefId' } };

export function parseMeetingLink(raw: string): MeetingRef | null;         // parser d'IO
export async function roomFromMeeting(ref: MeetingRef):
  Promise<{ room: RoomId; key: RoomCredential }>;                          // 2× SHA-256 séparés
```

Le SHA-256 passe par `src/collaboration/roomCrypto.ts` (seul site `crypto.subtle` autorisé par
`CLAUDE.md`). Tests unitaires : une URL par hôte, plus les variantes bruitées (`?authuser=`, `#`,
majuscules, percent-encoding Teams) — c'est là que sont les divergences silencieuses.
**Pour Zoom, inclure `pwd=` dans le canonical** (entropie de l'ID insuffisante).

**Étape B (~1 h) — l'entrée utilisateur.** Un champ « Coller un lien de réunion » sur l'écran
d'accueil : parse → dérive → `location.assign('?room=' + room + '#k=' + key)`.
**Zéro modification du cœur** : `roomFromUrl()` et la précédence `currentSecretKey()` font déjà le
travail (`App.svelte:273` et `App.svelte:95`).

**Étape C (~1 h) — l'extension de 30 lignes.** MV3, **`activeTab` uniquement**, aucun
`host_permissions`, aucun content script, aucun avertissement à l'installation :

```json
{ "manifest_version": 3, "name": "Copad launcher", "version": "0.1",
  "permissions": ["activeTab"], "action": { "default_popup": "popup.html" } }
```

La popup lit `chrome.tabs.query({active:true, currentWindow:true})[0].url`, et ouvre
`https://<copad>/?meet=<encodeURIComponent(url)>`. **La dérivation reste dans Copad** (côté page) :
une seule implémentation, et l'extension n'a jamais besoin d'être remise à jour. Installation :
`chrome://extensions` → Developer mode → Load unpacked. 0 €, 0 revue, 0 admin.

**Étape D (~30 min) — le mode d'emploi.** Trois lignes dans le README : « en réunion, cliquez l'icône,
collez le lien obtenu dans le chat » + « sans l'extension : collez le lien de la réunion dans Copad ».

**Test de recette** : deux navigateurs, un vrai lien Meet, vérifier que les deux atterrissent dans la
même room, que le contenu se synchronise, et que le serveur de signaling ne voit qu'un identifiant
opaque.

### Jalon 2 (dans la foulée, ~0,5–1 j) — le calendrier

Un Apps Script personnel avec **déclencheur horaire** (plus simple que `onEventUpdated` + sync token)
qui ajoute « 📝 Pad : <lien> » dans la description des événements des prochaines 24 h qui n'en ont pas.
Installé en `Test deployments` par une seule personne. Les invités ne font rien : le lien est dans
l'invitation, et le rappel de calendrier devient le canal de notification du rendez-vous.

---

## 6. Recommandation moyen terme — si l'on accepte un serveur ou un store

Par ordre de rendement décroissant :

1. **Publier l'extension en *unlisted* sur le Chrome Web Store** (5 $ une fois). Supprime le bandeau
   dev-mode et le risque de désactivation après mise à jour, garde l'installation par simple lien, et
   ouvre Edge. **C'est le meilleur euro dépensé de toute la liste.**
2. **Teams meeting app (tab)**, *si* le contexte réel est un tenant Microsoft **et** que l'admin
   accepte d'activer l'upload d'apps custom. Une seule personne ajoute l'app à la réunion, tout le
   monde la voit, y compris les anonymes. Le tab reste une page statique : le serverless survit —
   à condition de vérifier d'abord le point de §7 sur l'iframe.
3. **Zoom App privée**, si Zoom domine : c'est le seul hôte qui *invite activement* les participants
   (Collaborate + Guest mode) avec dégradation gracieuse. Coût : un petit endpoint OAuth (une
   fonction Cloudflare Worker, dans l'esprit de `deploy/ice-worker/` qui existe déjà).
4. **Google Meet add-on**, seulement si la cible est un domaine Workspace où un admin peut
   *pré-installer* l'add-on pour tout le monde — ce qui transforme « chacun installe » en
   « l'admin installe une fois ». Sinon, non.
5. **Discord** : uniquement si la communauté est sur Discord, et en acceptant de basculer sur le hub
   y-websocket (donc perte d'E2E) pour ce contexte-là.

---

## 7. Pièges et angles morts

**L'embed casse l'architecture — le piège principal.** Meet add-on, Teams tab, Zoom App, Discord
Activity chargent tous Copad **dans une iframe tierce**. Conséquences, à vérifier avant tout
engagement : (a) le stockage est **partitionné par le top-level site** → le cache local IndexedDB
(`src/collaboration/cache.ts`) et tout le `localStorage` (tokens OAuth de stockage, mots de passe de
room, `savedRooms`) sont dans un silo distinct, voire bloqués ; (b) **WebRTC** peut être restreint par
la `Permissions-Policy` de l'hôte — Discord l'interdit explicitement ; (c) la **CSP** de l'hôte peut
bloquer le WebSocket de signaling ; (d) les popups OAuth des backends de stockage sont souvent
bloquées en iframe. **[NON VÉRIFIÉ pour Teams et Meet — c'est le premier test à faire avant d'écrire
la moindre ligne de ces intégrations.]** Le lanceur (extension/calendrier) n'a aucun de ces problèmes.

**Ce qui exige un admin IT** : Teams (toggle `Upload custom apps` du tenant), Meet add-on privé
(domaine Workspace + éventuellement l'allowlist Marketplace), Slack (installation d'app dans beaucoup
de workspaces), et — en entreprise — les **politiques d'extension Chrome** (`ExtensionInstallBlocklist`,
blocage du mode développeur) qui peuvent interdire le `Load unpacked` sur un poste managé. Une
extension unlisted au Web Store contourne le premier problème, pas le second.

**Ce qui casse quand l'hôte change ses règles** : les sélecteurs DOM d'un content script (à chaque
refonte UI) ; les formats d'URL de réunion (si Meet change son format de code, la dérivation change →
**deux versions de Copad ne se rejoignent plus dans la même room**). Parade : **versionner la
dérivation** (`copad/room/v1|…`) et, à la lecture, tolérer plusieurs versions pendant une transition.
Sinon, une mise à jour silencieuse scinde une réunion en deux pads.

**Ce qui fuite vers l'hôte.** Dans un embed, l'hôte voit tout ce que fait l'iframe (et Discord proxifie
littéralement chaque requête, IP comprise). Un content script sur Meet/Teams voit toute la page.
Un Apps Script installé a accès en écriture au calendrier de son propriétaire. Le lanceur `activeTab`
est le seul qui ne voie **que l'URL de l'onglet actif, uniquement après un clic** — c'est aussi le
plus facile à défendre auprès d'un utilisateur méfiant, et ça mérite d'être dit dans le README.

**Ce qui fuite vers nous / vers le signaling.** Rien de nouveau : le serveur de signaling voit un
`RoomId` — ici un hash du lien de réunion. Il n'apprend pas le code de réunion (préimage), et pas le
contenu (clé dans le fragment). Mais **quiconque possède le lien de réunion possède le pad** : à
énoncer explicitement, parce que c'est un changement de modèle de menace par rapport au `#k=` aléatoire
actuel (une clé aléatoire ne peut pas être devinée à partir d'un lien qui circule dans un mail).

**Angle mort du produit synchrone.** Aucune de ces intégrations ne résout le cas « la réunion est
finie, le pad n'a pas de backend de stockage connecté » : le document devient live-only et disparaît
avec le dernier participant. Le geste d'intégration devrait donc *aussi* pousser vers la persistance —
c'est-à-dire vers le `PersistenceBadge` **Saved / Live-only** qui existe déjà. La bonne intégration
« rendez-vous » sans persistance produit surtout de la perte de travail bien synchronisée.

---

## 8. Ce que je n'ai pas pu vérifier (à confirmer avant de s'engager)

1. **Chrome 149+ désactive-t-il vraiment les extensions non packagées après une mise à jour ?** Seules
   des sources SEO l'affirment. Test réel sur la machine cible : charger une extension unpacked,
   redémarrer, attendre une mise à jour de Chrome.
2. **Iframe des hôtes** : WebRTC, WebSocket, IndexedDB et popups OAuth fonctionnent-ils dans un tab
   Teams et un add-on Meet en 2026 ? (Partitionnement du stockage + `Permissions-Policy` + CSP.)
3. **Meet add-ons et comptes Google personnels** : le Marketplace SDK et la publication privée
   supposent-ils un domaine Workspace ? Idem pour le **conferencing add-on** Calendar.
4. **Une app Teams sideloadée est-elle visible des participants externes/anonymes** d'une réunion, ou
   seulement des membres du tenant ? La doc dit que les anonymes accèdent « aux apps », sans préciser
   le cas d'une app custom uploadée.
5. **Live Share / Azure Fluid Relay** : toujours supporté en 2026 ? (page de doc non révisée depuis 2022,
   aucune annonce de dépréciation trouvée.)
6. **Zoom** : un flux **PKCE sans secret** est-il possible pour une Zoom App (ce qui rendrait
   l'endpoint OAuth superflu, comme pour Dropbox/Google Drive dans Copad) ?
7. **Slack huddles** : existe-t-il une API publique d'événement/présence de huddle en 2026 ?
8. **Injection dans le chat** de Meet/Teams par content script : encore faisable en 2026 ?

---

## 9. Sources

**Lues directement (miroir GitHub des docs officielles)**
- Teams — apps en réunion, rôles, types d'utilisateurs (rév. 05/2026) : https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/apps-in-teams-meetings/teams-apps-in-meetings.md
- Teams — tabs de réunion, contextes `meetingSidePanel` / `meetingStage`, manifeste : https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/apps-in-teams-meetings/build-tabs-for-meeting.md
- Teams — upload d'app custom (sideload) : https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/concepts/deploy-and-publish/apps-upload.md
- Teams — activation du tenant (toggle admin) : https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/concepts/build-and-test/prepare-your-o365-tenant.md
- Teams — Live Share SDK / Azure Fluid Relay gratuit : https://github.com/MicrosoftDocs/msteams-docs/blob/main/msteams-platform/apps-in-teams-meetings/teams-live-share-overview.md

**Via résumés de recherche sur les pages officielles (fetch direct bloqué par la politique d'egress)**
- Meet add-ons — vue d'ensemble / déploiement / collaboration / publication :
  https://developers.google.com/workspace/meet/add-ons/guides/overview ·
  https://developers.google.com/workspace/meet/add-ons/guides/deploy-add-on ·
  https://developers.google.com/workspace/meet/add-ons/guides/collaborate-in-the-add-on ·
  https://developers.google.com/meet/add-ons/guides/publish ·
  https://workspaceupdates.googleblog.com/2024/09/google-meet-add-ons-sdk-is-now-available.html
- Google Workspace add-ons — test deployments, conferencing :
  https://developers.google.com/workspace/add-ons/how-tos/testing-workspace-addons ·
  https://developers.google.com/workspace/add-ons/calendar/conferencing/overview ·
  https://developers.google.com/workspace/add-ons/calendar/conferencing/build-conference-addons
- Apps Script — déclencheur calendrier : https://developers.google.com/apps-script/reference/script/calendar-trigger-builder
- Chrome — `activeTab`, requêtes cross-origin, publication :
  https://developer.chrome.com/docs/extensions/develop/concepts/activeTab ·
  https://developer.chrome.com/docs/extensions/develop/concepts/network-requests ·
  https://developer.chrome.com/docs/webstore/register
- Chrome — pas de code distant en MV3 : https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/mv3/tut_analytics/index.md
- Edge — sideloading : https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading
- Firefox — signature et auto-distribution : https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/ · https://extensionworkshop.com/documentation/publish/self-distribution/
- Zoom — Collaborate Mode / Guest Mode / OAuth :
  https://developers.zoom.us/docs/zoom-apps/guides/collaborate-mode/ ·
  https://developers.zoom.us/docs/zoom-apps/guides/guest-mode/ ·
  https://developers.zoom.us/docs/build-flow/create-oauth-apps/ ·
  https://developers.zoom.us/docs/build-flow/basic-info/oauth-info/
- Slack — incoming webhooks (et CORS côté navigateur) : https://api.slack.com/incoming-webhooks · https://github.com/slackapi/node-slack-sdk/issues/1568
- Discord — networking des Activities (WebRTC non supporté, proxy) :
  https://docs.discord.com/developers/activities/development-guides/networking ·
  https://github.com/discord/embedded-app-sdk/blob/main/patch-url-mappings.md
- Bookmarklets et CSP : https://bugzilla.mozilla.org/show_bug.cgi?id=866522 · https://medium.com/making-instapaper/bookmarklets-are-dead-d470d4bbb626
- PWA — Web Share Target / protocol handler :
  https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target ·
  https://developer.chrome.com/docs/web-platform/best-practices/url-protocol-handler

**Code Copad référencé** (lecture seule)
- `/home/user/copad/src/App.svelte:273` — `roomFromUrl()` (`?room=` → `RoomId`)
- `/home/user/copad/src/App.svelte:95` — précédence du chiffrement : `currentSecretKey()` (`#k=`) → mot de passe de room → stratégie env
- `/home/user/copad/src/collaboration/secretLink.ts` — lecture/écriture de la clé `#k=`
- `/home/user/copad/src/collaboration/roomCrypto.ts` — seul site `crypto.subtle`
