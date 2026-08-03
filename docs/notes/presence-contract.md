# Copad — « seul = lecture seule » : contrats de transport, spec UI, plan d'implémentation

> Note de design. Aucun code écrit, aucun fichier du repo modifié.
> Toute affirmation est ancrée sur du code lu (`fichier:ligne`). Les incertitudes sont marquées **[non vérifié]**.
> L'UI existante est **en anglais** (vérifié : `WriteGateIntro.svelte`, `SyncBanner.svelte`, `StatusPill.svelte`, `RoomLock.svelte` — 100 % anglais ; `ui/language.svelte.ts` ne concerne que la langue *du document* et le spellcheck, pas l'UI). Les copies sont donc données **EN (à implémenter) / FR (référence)**.

---

## 0. Ce qui existe déjà — et le piège central

Il existe **déjà** un write-gate complet : `App.svelte:395-521`, `Editor.svelte:64-79 / 333-358`, `ui/WriteGateIntro.svelte`, `ui/SyncBanner.svelte`, clé `KEY_WRITE_GATE_SEEN` (`collaboration/constants.ts:76`). Ne pas réécrire : **repolariser**.

Le gate actuel s'arme sur (`App.svelte:466-473`) :

```
sessionRole === Writer && transport === P2P && !savedHere
  && sessionState.conn !== ConnStatus.Connected      // ← le point critique
  && !soloRooms.includes(room) && !collabUnavailable
```

Il inclut **délibérément** `Connecting` / `Unreachable` / `Offline`, et le commentaire `App.svelte:414-420` le justifie explicitement :

> « Crucially we key on "no peer", NOT on `ConnStatus.Waiting` […] Keying on Waiting alone made the gate invisible exactly when signaling is absent or cold […] i.e. **when protection matters most**. »

**Ce raisonnement est correct sous l'ancienne thèse et faux sous la nouvelle.**

| | Ancienne thèse (coffre-fort) | Nouvelle thèse (session) |
|---|---|---|
| Ce que le gate est | un **avertissement de durabilité** — « personne ne gardera ces octets » | un **verrou de contrat** — « écrire est un acte synchrone » |
| Coût d'un faux positif (« je crois qu'il est seul ») | un bandeau de trop | **l'utilisateur est enfermé hors de son document** |
| Donc l'incertitude doit… | **gater plus** | **gater moins** |

> **Changer de thèse inverse la polarité de la règle d'incertitude.** C'est la seule ligne vraiment importante de cette note. Le commentaire `App.svelte:395-433` devra être réécrit à l'envers, pas amendé.

Conséquence directe, non négociable : **on ne verrouille jamais sur `Connecting`, `Unreachable` ou `Offline`.** Ces états ne disent pas « je suis seul », ils disent « je ne sais pas ».

---

## A. Les deux contrats de transport, côte à côte

### A.1 Comment chaque adaptateur calcule réellement présence et attachement

**WebRTC / P2P** (`collaboration/webrtc.ts`)

- `peerCount()` — `webrtc.ts:92-98` : nombre de `webrtcConns` dont **le data channel est ouvert** (`c.connected === true`) **plus** `bcConns.size` (onglets du même navigateur, via BroadcastChannel). Les conns *découvertes mais non connectées* sont volontairement exclues (`webrtc.ts:86-91`, test `webrtc.test.ts:108`).
- `isAttached()` — `webrtc.ts:111-112` : au moins une socket de signaling `connected`, **ou** `peerCount() > 0`.

Ce que fait réellement le signaling y-webrtc (lu dans `node_modules/y-webrtc/src/y-webrtc.js`) :

- C'est un **pub/sub pur**. Le serveur **n'a aucun registre de salle**, il ne sait pas et ne peut pas dire combien de personnes sont dans une room. Il relaie des messages `announce` / `signal`.
- `announce` n'est publié que sur : connexion de la socket de signaling (`y-webrtc.js:482-489`), connexion de la room (`:385`), et changement de pair — connect / disconnect / close / error (`:226`, `:230`, `:225`, `:229`).
- **Il n'existe aucun ré-`announce` périodique.** Vérifié : aucun `setInterval` dans `y-webrtc.js`.
- La découverte est **unidirectionnelle par annonce** : recevoir un `announce` de B fait créer à A une `WebrtcConn(initiator=true)` vers B (`y-webrtc.js:516-519`). **B ne réannonce pas en retour.** Donc si l'annonce de B est perdue (hoquet serveur, cold start, A pas encore `subscribe`), personne ne réessaie tant qu'une socket ne flappe pas ou qu'un événement pair ne survient.
- Récupération partielle : `close` et `error` d'un pair rappellent `announceSignalingInfo(room)` (`:225`, `:229`) → une tentative de connexion *échouée* se re-annonce toute seule. C'est le seul auto-rétablissement.
- Chiffrement : la clé de room chiffre **aussi les messages de signaling**, `announce` compris (`y-webrtc.js:548-551`, `room.key` → `decryptJson`). Dans une room chiffrée, **la présence elle-même est verrouillée par la clé** : un pair sans clé est structurellement invisible (déjà documenté `CLAUDE.md:207`).

**WebSocket / hub** (`collaboration/websocket.ts`)

- `peerCount()` — `websocket.ts:34` : `awareness.getStates().size - 1`.
- `isAttached()` — `websocket.ts:43` : `provider.wsconnected`.
- L'awareness est **relayée par le serveur**, qui détient un registre autoritatif des sockets ouvertes de la room et diffuse l'awareness à tout le monde. Une fois `wsconnected` **et** l'échange initial fait, « 0 autre » est une affirmation d'origine serveur, pas une inférence locale.
- Mode de défaillance **inverse** : `y-protocols/awareness.js:13` fixe `outdatedTimeout = 30000`, balayé toutes les ~3 s (`:77`). Un pair qui meurt sans fermeture propre **reste listé jusqu'à 30 s**.

### A.2 Le tableau des contrats

| | **WebRTC / P2P** (défaut) | **WebSocket / hub** (opt-in) |
|---|---|---|
| Source de la présence | inférence **locale** : data channels ouverts + onglets BroadcastChannel (`webrtc.ts:92-98`) | **registre serveur** relayé via awareness (`websocket.ts:34`) |
| Le serveur connaît-il la salle ? | **Non** — pub/sub sans registre | **Oui** — il tient les sockets de la room |
| Latence de détection d'arrivée | annonce → ICE → data channel : ~0,3 s (LAN) à plusieurs s (TURN), **sans borne supérieure** | 1 aller-retour serveur, ~100–300 ms |
| **Faux négatifs** (« seul » alors que non) | **Structurels et non bornés** : annonce perdue sans réémission ; TURN absent/en panne ; NAT symétrique ; room chiffrée + pair sans clé | Quasi nuls après sync : bornés par 1 RTT |
| **Faux positifs** (« accompagné » alors que non) | Rares : `connected` reflète un data channel réellement ouvert. **Mais** un 2ᵉ onglet du même navigateur compte comme pair (`webrtc.ts:97`, assert `webrtc.test.ts:161`) | **Jusqu'à 30 s** après un départ sale (`awareness.js:13`) |
| Quand `peerCount` devient-il fiable ? | **Jamais totalement.** Fiable *positivement* (>0 ⇒ quelqu'un est là et reçoit vraiment) ; jamais fiable *négativement* (0 ⇏ salle vide) | Après `wsconnected` + premier `sync` : fiable dans les deux sens, **sauf** fenêtre de départ de 30 s |
| Chiffrement E2E | **Oui** — AES par room (`webrtc.ts:61`) ; chiffre aussi le signaling | **Non** — par construction (`websocket.ts:17-18`) |
| Ce que le serveur voit | métadonnées de signaling ; **jamais le contenu**. En room chiffrée, même les `announce` sont opaques | **tout le document en clair** + l'awareness complète |
| NAT hostile (CGNAT / symétrique) | échec possible **sans échec visible** : conns créées, jamais `connected` → `Waiting` éternel alors que les deux pairs sont présents et le savent | une seule connexion sortante — fonctionne partout |
| Auto-rétablissement | flap de socket, ou `close`/`error` d'un pair (`y-webrtc.js:225,229`), ou `reconnect()` manuel (`webrtc.ts:156-167`) | reconnexion WebSocket avec backoff (`lib0/websocket.js`) |

### A.3 La ligne à retenir

> **Le P2P se trompe vers « seul ». Le hub se trompe vers « pas seul ».**
> Sous un contrat « seul = lecture seule », ces deux erreurs n'ont pas du tout le même coût :
> le faux négatif du P2P **enferme l'utilisateur hors de son document, pour une durée non bornée** ;
> le faux positif du hub **laisse écrire ≤ 30 s dans une salle qui vient de se vider** — un dommage borné et réparable (le CRDT converge à la reconnexion).

### A.4 Quelle promesse le verrou peut honnêtement tenir

**Sur le hub — contrat strict, et c'est honnête.**

> « Ce document ne s'ouvre à l'écriture que lorsque quelqu'un d'autre est là. Le serveur tient la liste des présents : quand il dit que vous êtes seul, vous l'êtes. »

Tenable parce que : registre autoritatif, une seule connexion sortante (pas de NAT à traverser), zéro faux négatif structurel. Le seul défaut connu — un départ signalé jusqu'à 30 s en retard — joue **en faveur** de l'utilisateur (on écrit trop longtemps, jamais trop peu). **Aucune échappatoire n'est nécessaire à la correction du contrat sur le hub.** Contrepartie assumée et à dire : le serveur voit tout.

**Sur le P2P — contrat par défaut, jamais absolu.**

> « Ce document s'ouvre quand quelqu'un arrive. En pair-à-pair, personne ne tient la liste des présents : Copad ne peut savoir que vous êtes seul qu'en n'entendant personne. Quand nous n'en sommes pas sûrs, nous vous laissons écrire. Et vous pouvez toujours passer outre. »

Promesses tenables :
1. On ne verrouille **jamais** sans être attaché au signaling et sans avoir *zéro conn découverte*.
2. Le **déverrouillage est optimiste** : le moindre signe de vie ouvre le document immédiatement (voir C.3).
3. Le **verrouillage est pessimiste** : il attend une fenêtre de grâce.
4. « Quelqu'un est là mais on ne l'atteint pas » est un **état distinct**, jamais présenté comme « seul », et **ne verrouille pas**.
5. Une **échappatoire explicite et nommée** existe toujours.

Promesse **impossible** en P2P, à ne jamais faire : « si vous êtes en lecture seule, c'est que la salle est vide ». Elle est fausse et le code le prouve (A.1).

**L'inversion qui donne sa forme au design :** le transport dont la détection est **la meilleure** reçoit le contrat **le plus strict** ; celui dont la détection est **la plus faible** reçoit **l'échappatoire**. Le hub n'est pas un P2P dégradé, et le P2P n'est pas un hub approximatif : chacun promet exactement ce que sa mécanique permet.

---

## B. Spec UI/UX des états

Principes hérités du codebase, à respecter (ce ne sont pas mes inventions) :
- **Jamais de scrim sur le texte.** `App.svelte:405-409` et `SyncBanner.svelte:129-136` : « the interface recedes in front of it ». Le document reste **visible, défilable, sélectionnable, copiable** dans tous les états ci-dessous.
- **Une seule bande de statut** en haut, qui escalade (`SyncBanner.svelte:66-69`). Ne pas ajouter une deuxième surface concurrente.
- **La pastille de statut** (`StatusPill.svelte`) reste la référence permanente et discrète, deux axes : connexion / durabilité.
- `prefers-reduced-motion` géré explicitement pour les transitions JS (`SyncBanner.svelte:90-91`).

### B.0 Le vocabulaire, d'abord

Trois mots à ne jamais confondre dans la copie :

| Concept | EN | FR | Réversible ? |
|---|---|---|---|
| Seul, confirmé → lecture seule | **Waiting for someone** | En attente de quelqu'un | oui, dès qu'on arrive |
| Lien view-only (`?role=reader`) | **View-only** | Lecture seule (lien) | non, fixé pour la session (`App.svelte:290`) |
| Room chiffrée sans clé | **Locked** | Verrouillée | oui, avec la clé |

Le verrou de solitude **n'est pas une permission**. Il ne doit jamais emprunter le vocabulaire ni l'iconographie du cadenas de `RoomLock.svelte` — sinon l'utilisateur lit « l'hôte m'a restreint » alors que la vraie phrase est « il n'y a personne ».

### B.1 État par état

Légende colonnes : ce qu'on voit / ce qu'on peut faire / ce qu'on dit.

---

**① `Connecting` — on ne sait rien**

- **Voit** : document visible et **éditable**. Pastille `Connecting…` avec spinner (`StatusPill.svelte:69-76`, inchangé). Aucune bande.
- **Peut** : tout. Écrire compris.
- **Dit** : rien de plus que la pastille.
- **Pourquoi** : ne pas verrouiller sur l'ignorance (§0). Un faux verrou de 2 s au chargement est exactement l'incident dur qu'on veut éviter.

---

**② Attaché, découverte en cours — « on ne sait pas encore »** *(fenêtre de grâce, P2P surtout)*

- **Voit** : identique à ①. Pastille `Alone`, ton neutre. Toujours pas de bande.
- **Peut** : tout.
- **Dit** : rien. Silence délibéré — c'est déjà le comportement actuel pendant la grâce (`SyncBanner.svelte:32-37`, `gateEligible` sans `gated`).

---

**③ Seul et attaché, confirmé → LECTURE SEULE** *(l'état-produit)*

- **Voit** : document intact, pleine visibilité, **caret absent**, curseur texte en `default` sur la zone d'édition. Bande haute, tier fort. La pastille passe à `Waiting` (nouveau libellé, remplace `Alone`).
- **Peut** : lire, défiler, **sélectionner et copier**, ouvrir l'outline, **exporter**, ouvrir Share, ouvrir Settings, connecter un backend, changer d'identité/couleur/thème. **Pas** : taper, coller dans le doc, formater, undo/redo.
- **Dit** :

  > **EN** — **You're the only one here.** Copad opens the document when someone joins. Until then you can read, copy and export it.
  > **FR** — **Vous êtes seul ici.** Copad ouvre le document quand quelqu'un arrive. En attendant, vous pouvez le lire, le copier et l'exporter.

- **Actions dans la bande** : `Copy invite link` (primaire) · `Export a copy` · *(P2P uniquement)* `Write alone anyway` (ghost, discret, jamais primaire) · `✕` (masque la bande, pas le verrou — comportement existant `SyncBanner.svelte:71-85`).
- **Bande masquable, verrou non.** Si masquée, la pastille `Waiting` reste et reste cliquable vers le même détail (`ConnectionDialog`).

---

**④ « Quelqu'un est là, on ne l'atteint pas »** *(P2P uniquement — état nouveau, le gain de sûreté principal)*

Condition : `webrtcConns.size > 0` mais aucun `connected` — cf. A.1.

- **Voit** : bande **ton neutre**, pas alarmiste. Document **éditable** (déverrouillé).
- **Peut** : tout.
- **Dit** :

  > **EN** — **Someone's here — still connecting to them.** Your network may be blocking the direct link. Edits will sync as soon as the connection opens.
  > **FR** — **Quelqu'un est là — connexion en cours.** Votre réseau bloque peut-être le lien direct. Vos modifications se synchroniseront dès l'ouverture de la connexion.

- **Actions** : `Retry` (→ `collab.reconnect()`, existe déjà `webrtc.ts:156-167`) · `Connection details` (→ `ConnectionDialog`, qui montre déjà Direct/Relayed via `getDiagnostics`).
- **Décision assumée : ④ ne verrouille pas.** Contre-argument valable — les octets n'atteignent effectivement personne, donc on écrit dans le vide. Je tranche quand même vers l'ouverture : la prémisse du contrat (« quelqu'un est là ») est *satisfaite et prouvée* — on a entendu son annonce ; la panne est **la nôtre** (NAT/TURN), pas la sienne. Enfermer quelqu'un parce que notre traversée NAT échoue est précisément l'incident dur que la mission demande d'éviter. **Signalé en D si l'on veut rediscuter.**

---

**⑤ `Connected` — déverrouillé**

- **Voit** : document éditable, caret, avatars dans la `PresenceBar`, pastille `Direct` / `Relay` avec point pulsant (`StatusPill.svelte:95-101`), pas de bande.
- **Peut** : tout.
- **Dit** : une seule ligne, une fois, puis plus rien (voir B.2).

---

**⑥ Un pair part en cours de session → HYSTÉRÉSIS**

Ne **jamais** reverrouiller instantanément. Deux paliers :

1. **Sursis (`LINGER_MS`, recommandé 25 s)** — le document **reste éditable**. Bande, ton doux :

   > **EN** — **Ada left.** You can keep writing for a moment — the room closes shortly.
   > **FR** — **Ada est partie.** Vous pouvez continuer un instant — la salle se referme bientôt.

   Un compte à rebours discret (`… 12s`) uniquement sur les 10 dernières secondes ; jamais de barre de progression anxiogène.

2. **Fermeture** — passage à ③, avec un mot qui reconnaît ce qui vient de se passer :

   > **EN** — **The room is empty again.** Your work is still here to read and export.
   > **FR** — **La salle est de nouveau vide.** Votre travail reste là, consultable et exportable.

- **Le sursis se réarme** si quelqu'un revient, et **est prolongé par la frappe** : tant que l'utilisateur tape, ne pas fermer au milieu d'une phrase — repousser la fermeture à *dernière frappe + LINGER_MS*, plafonné (recommandé 2 min) pour que le contrat ne s'évapore pas.
- **Sur le hub**, `LINGER_MS` doit **couvrir `outdatedTimeout`** : le départ est déjà annoncé jusqu'à 30 s en retard (A.1), donc au moment où le hub dit « parti », la personne est partie depuis un moment. 25 s de sursis y sont un confort, pas une correction. En P2P le départ est immédiat et fiable (`close` → `peers`), le sursis y est la vraie protection.

---

**⑦ `Unreachable` — le serveur ne répond pas**

- **Voit** : document **éditable**. Pastille `Can't connect`, ton danger (`StatusPill.svelte:77-86`, inchangé). Bande neutre.
- **Peut** : tout.
- **Dit** :

  > **EN** — **Can't reach the connection server.** We can't tell whether anyone else is here, so the document stays open. Your edits stay on this device until it comes back.
  > **FR** — **Serveur de connexion injoignable.** Impossible de savoir si quelqu'un d'autre est là : le document reste ouvert. Vos modifications restent sur cet appareil jusqu'au rétablissement.

- **Actions** : `Retry` · `Export a copy`.
- **Jamais verrouillé.** C'est le cœur du §0 : ne pas transformer notre panne en punition.

---

**⑧ `Offline`**

- Comme ⑦, éditable, message :

  > **EN** — **You're offline.** The document stays open; nothing syncs until you're back.
  > **FR** — **Vous êtes hors ligne.** Le document reste ouvert ; rien ne se synchronise avant votre retour.

- Note technique : `core.ts:102` court-circuite sur `navigator.onLine === false` **avant** de regarder les pairs — donc `Offline` masque même un pair BroadcastChannel. Raison de plus pour ne jamais verrouiller ici.

---

**⑨ `collabUnavailable`** (déploiement sans serveur de collab, `App.svelte:193`)

- **Jamais verrouillé**, comme aujourd'hui (`App.svelte:461-472`). Personne ne pourra *jamais* arriver : verrouiller serait une impasse.
- Tier existant de `SyncBanner` conservé (`SyncBanner.svelte:169-184`). **Mais voir D.8** — sous la nouvelle thèse, la légitimité même de ce déploiement est une question ouverte.

---

### B.2 Le moment du déverrouillage (le moment produit)

Déclencheur : première transition vers *accompagné*. Chorégraphie, dans cet ordre, ~450 ms au total :

1. **Le caret apparaît.** L'éditeur redevient éditable — déjà réactif via `Editor.svelte:333-336`, aucun remount. C'est le signal principal : il est physique et silencieux.
2. **La bande se replie.** Réutiliser `bannerOut` (`SyncBanner.svelte:100-126`), déjà réglé finement pour ne pas écraser le border-radius. Ne pas réinventer.
3. **L'avatar du pair entre** dans la `PresenceBar`, dans **sa** couleur (précédent : le flash de `jumpToPresence` utilise la couleur du pair, `Editor.svelte:198-201`).
4. **Une ligne, une fois** — toast auto-disparaissant via `createToasts()` (`App.svelte:71`) :

   > **EN** — **Ada is here. The document is open.**
   > **FR** — **Ada est là. Le document est ouvert.**

   Nom depuis `parsePeerAwarenessState` ; repli `FALLBACK_NAME` → *« Someone is here. »* / *« Quelqu'un est là. »*

**Interdits, explicitement** — pas de son, pas de confetti, pas de flash plein écran, pas de modale. Le contraste (rien → caret) fait tout le travail ; l'ajout le rendrait clinquant.

**Ne jamais voler le focus.** En ③ le contenu est `contentEditable=false`, donc l'utilisateur n'a pas de caret placé. Au déverrouillage : **ne pas appeler `view.focus()`**. Un onglet en arrière-plan qui volerait le focus au moment où quelqu'un rejoint est un bug hostile. Le caret se place au premier clic.

**`prefers-reduced-motion`** : sauter les étapes 2-3 (apparition/disparition instantanées), garder 1 et 4.

### B.3 Attendre doit être tenable

C'est ce qui permet à deux personnes de **se croiser** — l'attente est une fonctionnalité, pas une salle d'erreur.

- **Ne pas mettre de spinner en ③.** Un spinner promet l'imminence ; au bout de 30 s il ment. Préférer un **point calme** et un **temps écoulé** : *« Waiting since 14:02 »* / *« En attente depuis 14:02 »*.
- **Ne pas harceler.** La bande reste masquable (`SyncBanner.svelte:71-85`) et le reste dans une même « raison » ; réapparaît seulement quand la raison change.
- **L'action primaire de l'attente est `Copy invite link`** — pas `Connect storage`. Sous la thèse « session », inviter quelqu'un *est* la façon de débloquer ; le stockage est une sortie latérale. C'est une inversion nette de la hiérarchie actuelle (`SyncBanner.svelte:165-168` met `Invite` et `Connect storage` au même niveau).
- **L'attente survit à l'arrière-plan** : les keepalive de signaling tournent déjà en onglet caché, choix délibéré et documenté (`signalingKeepalive.ts:10-15`). Ne pas régresser là-dessus.
- Ajout recommandé : **le titre de l'onglet** reflète l'attente (`Copad — waiting…`) et repasse au nom du document au déverrouillage — c'est ce qui rend le fait d'attendre dans un onglet parmi vingt réellement praticable. **[non vérifié]** : aucun code de `document.title` trouvé dans `src/` ; à créer.

### B.4 Sort des contrôles en lecture seule

| Contrôle | En ③ | Pourquoi |
|---|---|---|
| **Export / téléchargement** | **ACTIF — exigence dure** | Voir B.5 : c'est la contrepartie du verrou. |
| Sélection + copie du texte | **ACTIF** | « On peut relire » est vide de sens sans copier. `contentEditable=false` le permet nativement. |
| Défilement, outline, recherche navigateur | **ACTIF** | Lecture. |
| **Share / `Copy invite link`** | **ACTIF, primaire** | C'est l'action qui lève le verrou. |
| **Settings** | **ACTIF** | Rendu hors du bloc `{#if}` (`App.svelte:903`) — rien à faire, ne pas régresser. |
| Connecter un backend de stockage | **ACTIF** | Chemin d'export. |
| Thème, identité, nom, couleur | **ACTIF** | Sans rapport avec le document. |
| **Toolbar de formatage** | **INACTIF** (grisée, présente) | Formater est écrire. La garder visible mais désactivée dit « ceci reviendra » ; la retirer ferait croire à une app différente. |
| Slash menu, input rules, raccourcis clavier | **INACTIFS** | ProseMirror les neutralise déjà via `editable: false`. **[non vérifié]** : confirmer que `slashMenuPlugin` (`Editor.svelte:370`) ne s'ouvre pas sur un `/` tapé en non-éditable — à tester. |
| Undo / redo | **INACTIFS** | `yUndoPlugin` (`Editor.svelte:369`). |
| **Renommer le document** (`DocTitle`) | **INACTIF** | Le nom vit dans le Y.Doc partagé (`Editor.svelte:103-111`) : le renommer est une écriture collaborative. |
| **Autosave vers le backend** | **ACTIF, inchangé** | Piloté par `doc.on('update')` (`Editor.svelte:310-314`). En lecture seule il n'y a pas d'update local, donc il ne se déclenche pas — mais un **chargement distant** en produit, et il doit continuer de sauver. Ne rien gater ici. |
| **Chargement depuis le backend** | **ACTIF** | `Editor.svelte:245-265`. C'est ce qui donne quelque chose à relire. |

### B.5 L'export — état des lieux et manque à combler

**Constat vérifié : il n'existe aucun bouton d'export/téléchargement.** Recherche de `download` / `createObjectURL` / `saveAs` / `showSaveFilePicker` sur `src/` → seules occurrences hors tests : `storage/local.ts:10-14,80` (File System Access API) et `storage/constants.ts:218` (URL de *download* Dropbox). Aujourd'hui « exporter » = *connecter un backend, laisser le codec encoder, laisser `save()` écrire* (`Editor.svelte:283-308`).

C'est insuffisant pour le nouveau contrat. « On peut relire, **exporter**, attendre » est une **capacité promise** ; elle ne peut pas être un effet de bord de la configuration d'un backend OAuth.

**À ajouter — la seule surface UI réellement neuve que le contrat exige** : une action `Export a copy` / `Exporter une copie`, présente dans la bande de ③ et dans Settings. Implémentation minimale, sans nouvelle dépendance :

`codecForFilename(name).encode(collab.doc)` → `Blob` → `URL.createObjectURL` → `<a download>` → `revokeObjectURL`.

Le choix du format sort gratuitement de l'extension demandée (`format/index.ts`, `codecForFilename`) : `.md`, `.txt`, `.html`, `.json`, `.yjs` sont **déjà tous implémentés**. Aucun codec à écrire.

---

## C. Plan d'implémentation

### C.1 Où vit la décision du verrou

**Pas un port.** Un port modélise une dépendance externe substituable (`CLAUDE.md` §2). Le verrou est de la logique de domaine pure : en faire un port serait de la sur-ingénierie.

**Pas un `$derived` brut dans `App.svelte`.** Il y a des timers, de l'hystérésis, une politique par transport et des cas limites : ça se teste unitairement, pas dans un composant.

**→ Un module pur dédié, plus une fine liaison réactive dans `App.svelte`.** C'est exactement la forme de deux précédents du repo :
- `collaboration/roomLock.ts` (module pur) + `$effect` de liaison (`App.svelte:577-623`) ;
- `collaboration/leader.ts:34` — `isPersistLeader(clientId, target, states)`, **fonction pure d'un instantané**, testée dans `leader.test.ts`.

Nouveau fichier : **`src/collaboration/writeGate.ts`**, exportant une fonction pure `writeGateFor(input): WriteGate`. Aucun timer, aucun état, aucun accès DOM à l'intérieur : les horloges sont injectées. Nom fonctionnel, pas de `Manager`/`Service` (`CLAUDE.md` §Naming).

### C.2 Types à introduire

**Dans `src/collaboration/types.ts`** (à côté de `ConnStatus`, `types.ts:131-138`, même idiome `as const` + union) :

```ts
/** Ce que la session sait de la présence d'autrui — distinct de ConnStatus,
 *  qui décrit le transport. La question porteuse du contrat n'est pas
 *  « suis-je connecté ? » mais « sais-je que je suis seul ? ». */
export const PresenceKind = {
  /** Pas attaché, ou registre pas encore stabilisé — on ne sait pas. */
  Unknown: 'unknown',
  /** Pairs découverts, aucun canal de données ouvert (P2P). Quelqu'un est là,
   *  on ne l'atteint pas. Ce n'est PAS de la solitude. */
  Reaching: 'reaching',
  /** Attaché, registre stabilisé, personne. Seul — et on le sait. */
  Alone: 'alone',
  /** Au moins un pair échange réellement des données. */
  Accompanied: 'accompanied',
} as const;
export type PresenceKind = (typeof PresenceKind)[keyof typeof PresenceKind];

/** Union discriminée — mêmes règles que StorageAvailability (CLAUDE.md §2) :
 *  l'appelant doit traiter chaque branche. */
export type RoomPresence =
  | { readonly kind: typeof PresenceKind.Unknown }
  | { readonly kind: typeof PresenceKind.Reaching; readonly discovered: number }
  | { readonly kind: typeof PresenceKind.Alone }
  | { readonly kind: typeof PresenceKind.Accompanied; readonly peers: number };
```

**Dans `src/collaboration/writeGate.ts`** :

```ts
export const WriteGate = { Open: 'open', Held: 'held' } as const;
export type WriteGate = (typeof WriteGate)[keyof typeof WriteGate];

/** Choix délibéré et nommé d'écrire seul — jamais un booléen anonyme.
 *  Branded : impossible de passer un booléen quelconque à sa place. */
export type SoloOptIn = boolean & { readonly _brand: 'SoloOptIn' };

export interface WriteGateInput {
  readonly presence: RoomPresence;
  readonly transport: Transport;
  readonly role: SessionRole;
  readonly soloOptIn: SoloOptIn;
  readonly collabUnavailable: boolean;
  /** Depuis quand la présence est-elle Alone sans interruption ? null si elle
   *  ne l'est pas. Injecté par l'appelant → la fonction reste pure. */
  readonly aloneSinceMs: number | null;
  /** Depuis quand le dernier pair est-il parti ? Alimente l'hystérésis. */
  readonly departedSinceMs: number | null;
}

export function writeGateFor(input: WriteGateInput): WriteGate;
```

Note de cohérence : les durées restent des `number` bruts, comme `CONNECT_TIMEOUT_MS` (`constants.ts:66`) et `presenceActivity.ts:60` (`idleMs(clientId): number`). Brander les millisecondes ici seul dénoterait par rapport à tout le vertical ; ce qui est brandé, ce sont les concepts neufs (`SoloOptIn`) et les états (`RoomPresence`, `WriteGate`).

**Dans `src/collaboration/constants.ts`** (à côté de `CONNECT_TIMEOUT_MS:66`, même forme `envInt`-like) :

```ts
GATE_SETTLE_HUB_MS      // défaut 1_500  — couvre 1 aller-retour + sync initial
GATE_SETTLE_P2P_MS      // défaut 6_000  — < CONNECT_TIMEOUT_MS (8_000) à dessein
GATE_LINGER_MS          // défaut 25_000 — hystérésis au départ
GATE_LINGER_MAX_MS      // défaut 120_000 — plafond de la prolongation par frappe
```

Chacune avec un override `VITE_*`, conformément à `CLAUDE.md` §Constants.

### C.3 La règle de décision (à implémenter telle quelle)

```
Ouvert (Open) si l'une de ces conditions tient :
  role === Reader                       → géré ailleurs (Editor.svelte:335), hors périmètre
  collabUnavailable                     → personne ne peut jamais arriver (App.svelte:461-472)
  soloOptIn                             → choix explicite de l'utilisateur
  presence.kind === Accompanied         → contrat satisfait
  presence.kind === Reaching            → quelqu'un est là (décision B.④)
  presence.kind === Unknown             → ON NE VERROUILLE JAMAIS SUR L'IGNORANCE (§0)
  presence.kind === Alone ET aloneSinceMs < settle(transport)   → fenêtre de grâce
  departedSinceMs !== null ET departedSinceMs < linger          → hystérésis

Retenu (Held) sinon.  ⟺ Alone, confirmé, au-delà de la grâce, hors hystérésis.
```

**Asymétrie fondatrice, à faire respecter par les tests :** *déverrouiller est optimiste et immédiat ; verrouiller est pessimiste et différé.* Tout signe de vie ouvre tout de suite ; seule une absence prolongée et confirmée ferme.

### C.4 Points de contact, fichier:ligne

| # | Fichier:ligne | Nature |
|---|---|---|
| 1 | `collaboration/types.ts:131-138` | **ajouter** `PresenceKind` + `RoomPresence` sous `ConnStatus` |
| 2 | `collaboration/types.ts:176-192` | **ajouter** `onPresence(fn): () => void` au port `Collab`, en miroir de `onStatus` (`:183`) |
| 3 | `collaboration/core.ts:18-30` | **ajouter** un 3ᵉ hook à `CollabCoreOptions`, à côté de `isAttached`/`peerCount` : `pendingPeerCount: () => number` et `rosterSettled: () => boolean` |
| 4 | `collaboration/core.ts:101-105` | **ajouter** `computePresence()` à côté de `computeStatus()` ; **ne pas** modifier `computeStatus` — la pastille garde sa sémantique actuelle |
| 5 | `collaboration/core.ts:107-111` | `emitStatus()` diffuse aussi la présence (un seul point d'émission, éviter la dérive) |
| 6 | `collaboration/webrtc.ts:92-98` | `pendingPeerCount = () => webrtcConns.size - connectedCount` ; `rosterSettled = isAttached` |
| 7 | `collaboration/websocket.ts:34-45` | `pendingPeerCount = () => 0` ; `rosterSettled = () => provider.wsconnected && provider.synced` **[non vérifié : confirmer que `WebsocketProvider` expose bien `synced`]** |
| 8 | **`collaboration/writeGate.ts`** | **nouveau** — module pur (C.2/C.3) |
| 9 | **`collaboration/writeGate.test.ts`** | **nouveau** — table de vérité complète |
| 10 | `collaboration/sessionState.svelte.ts:23-27` | **ajouter** `presence` au pont réactif + son setter (`:65-83`) et son reset (`:86-94`) |
| 11 | `Editor.svelte:202` | **ajouter** `$effect(() => setSessionPresence(presence))` à côté de `setSessionConn` |
| 12 | `App.svelte:395-521` | **remplacer** `gateEligible`/`gateArmed`/`writeLocked` par la sortie du module ; **réécrire le commentaire `:395-433`** (il argumente la polarité inverse, cf. §0) |
| 13 | `App.svelte:466-473` | **supprimer** `sessionState.conn !== ConnStatus.Connected` et **supprimer** `!savedHere` — sous D.2, à trancher |
| 14 | `Editor.svelte:345-358` | **supprimer** le yield-on-write silencieux (voir C.5) |
| 15 | `Editor.svelte:333-336` | **conserver tel quel** — c'est déjà le bon mécanisme de bascule réactive, sans remount |
| 16 | `ui/SyncBanner.svelte:51-79` | retravailler les tiers : `waiting` (③) / `reaching` (④) / `departing` (⑥) / `unreachable` (⑦) |
| 17 | `ui/StatusPill.svelte:87-94` | `Waiting` remplace `Alone` ; ajouter le cas `Reaching` |
| 18 | `ui/WriteGateIntro.svelte:25-38` | réécrire — enseigne aujourd'hui la durabilité, pas la synchronicité (voir D.6) |
| 19 | `ui/ExportButton.svelte` *(ou action dans `Settings.svelte`)* | **nouveau** — B.5 |
| 20 | `README.md:26-30` + `CLAUDE.md` | la thèse « the document is a file you own » contredit frontalement la nouvelle |

### C.5 L'échappatoire : ce qu'elle coûte au contrat

Aujourd'hui : **yield-on-write silencieux** (`Editor.svelte:345-358`) — le premier clic ou la première touche déverrouille sans rien dire.

**Incompatible avec la nouvelle thèse.** « Seul = lecture seule *jusqu'à ce que vous tapiez* » n'est pas un contrat, c'est un ralentisseur. Sous l'ancienne thèse (avertissement), c'était le bon geste : la friction minimale suffisait. Sous un contrat, la même mécanique le vide de son sens.

**Remplacement** : un bouton **explicite, nommé, énonçant son coût**, présent uniquement en ③, uniquement **P2P** :

> **EN** — `Write alone anyway` → *« Nothing you write will leave this device until someone joins. »*
> **FR** — `Écrire seul quand même` → *« Rien de ce que vous écrivez ne quittera cet appareil tant que personne n'arrive. »*

Portée : **par room, en mémoire, durée de session** — exactement la sémantique actuelle (`App.svelte:429-435`, `soloRooms`), à conserver. Tout rechargement réaffirme le contrat.

**Coût honnête, à écrire dans le README** : le contrat devient *« seul = lecture seule par défaut, contournable délibérément »*. C'est défendable — la version silencieuse ne l'était pas. Et c'est **asymétrique par transport, à dessein** : pas d'échappatoire sur le hub, où la détection est fiable ; échappatoire permanente sur le P2P, où elle ne l'est pas (A.4).

### C.6 Pièges connus

1. **`{#key room}` vs `rebuildCollab()`** — `CLAUDE.md:199` documente ce piège. ⚠️ **Cette note est partiellement périmée : il n'y a plus de `{#key room}` dans `App.svelte`** (vérifié — l'Editor est rendu sous `{:else if editorMounted}`, `App.svelte:848` ; `room` est fixé pour la durée de l'onglet, `App.svelte:286-289` ; « `{#key}` » n'apparaît plus que dans un commentaire, `:216`). **La règle vivante à respecter : rien dans le nouveau gate ne doit incrémenter `collabEpoch` ni appeler `rebuildCollab()`.** Verrouiller/déverrouiller est un simple changement de prop (`writeLocked`), jamais un remount — un remount détruit le Y.Doc et le provider, et en P2P **relance toute la course à la découverte**, c'est-à-dire exactement la mécanique dont on essaie de contenir l'incertitude. *Verrouiller ne doit jamais coûter une reconnexion.*

2. **L'identité des `$derived` et le timer de grâce.** Le code actuel repose sur un détail subtil (`App.svelte:475-479`) : `gateEligible` recalculé à la même valeur `true` ne relance pas l'`$effect`, donc le timer survit à la transition `Connecting → Waiting`. **Si `RoomPresence` est un objet littéral neuf à chaque émission, l'égalité `===` échoue à chaque fois et le timer redémarre en boucle.** Or l'awareness émet toutes les ~3 s (balayage `outdatedTimeout`, `awareness.js:77`) : le gate **ne s'armerait jamais**. C'est un bug réel que l'implémenteur rencontrera. Deux parades : mémoïser `RoomPresence` dans `core.ts` (ne réémettre que sur changement effectif de `kind`/compte), **ou** faire dépendre l'`$effect` de `presence.kind` seul, pas de l'objet. **Recommandé : les deux.**

3. **Nettoyage des timers** — tout `setTimeout` dans un `$effect` doit retourner son `clearTimeout` (précédent correct : `App.svelte:481-488`).

4. **`Offline` court-circuite tout** — `core.ts:102` renvoie `Offline` **avant** de consulter les pairs. `computePresence()` doit décider explicitement de son comportement hors ligne : recommandation → `Unknown` (donc jamais verrouillé, cf. B.⑧).

5. **Ne pas voler le focus au déverrouillage** (B.2).

6. **Gardes SSR/test** — reprendre `typeof navigator === 'undefined'` / `typeof window === 'undefined'` comme `core.ts:86,102,120`.

7. **Ne pas toucher `computeStatus`** — `ConnStatus` alimente la pastille, le `ConnectionDialog` et des tests existants (`core.test.ts:26-58`, `webrtc.test.ts:83-131`). `RoomPresence` s'ajoute **à côté**, ne remplace pas.

### C.7 Ordre des commits

| # | Commit | Contenu | Comportement visible |
|---|---|---|---|
| 1 | `presence: model what the session knows about others` | `PresenceKind`/`RoomPresence` ; hooks `pendingPeerCount`/`rosterSettled` ; `computePresence` + mémoïsation ; `onPresence` sur le port ; tests des 3 fichiers | **aucun** |
| 2 | `writeGate: pure lock decision` | `writeGate.ts` + `writeGate.test.ts`, table de vérité complète | **aucun** (non câblé) |
| 3 | `app: drive the write gate from presence` | Câblage `App.svelte` ; suppression du keying `!== Connected` ; réécriture du commentaire `:395-433` | **le verrou change de polarité** |
| 4 | `editor: make writing alone a deliberate choice` | Suppression du yield-on-write (`Editor.svelte:345-358`) ; bouton explicite | l'échappatoire devient visible |
| 5 | `ui: the waiting room` | Tiers `SyncBanner`, libellés `StatusPill`, état ④, hystérésis ⑥ | états lisibles |
| 6 | `ui: unlock moment` | Chorégraphie B.2, toast, reduced-motion | le moment produit |
| 7 | `export: download a copy` | B.5 | l'export devient une capacité de premier ordre |
| 8 | `hub: its own contract` | Réglages `settle`/`linger` par transport, copie dédiée, pas d'échappatoire | contrat hub distinct |
| 9 | `docs: session, not store` | `README.md`, `CLAUDE.md` | — |

Commits 1-2 sont sans risque et testables isolément : les faire relire séparément. Le commit 3 est celui qui inverse le comportement — c'est là que se joue la revue.

---

## D. Conséquences à trancher — **signalées, non arbitrées**

Sous « session, pas magasin », plusieurs mécanismes existants entrent en tension. Ci-dessous : la tension, puis les options. **La décision revient à l'utilisateur.**

**D.1 — Le cache local** (`collaboration/cache.ts`, actif par défaut)
*Tension* : c'est précisément lui qui rend possible « relire seul » après un rechargement. Or c'est aussi, littéralement, l'illusion asynchrone que la nouvelle thèse veut tuer : un document qui persiste hors session. Le contrat dit « on peut relire » — relire **quoi**, sans cache ?
*Options* : **(a)** garder tel quel — lire est explicitement autorisé, le cache sert le contrat ; **(b)** garder les octets mais les qualifier (« dernière session, en lecture seule jusqu'à ce que quelqu'un arrive ») — on abandonne la prétention de continuité, pas le contenu ; **(c)** cache à durée de session, purgé au départ du dernier pair — pureté maximale, détruit la relecture hors ligne.
*Coût caché de (c)* : `migrateRoomCache` (re-chiffrement au changement de clé) et le registre d'empreintes de `roomLock.ts` supposent tous deux un cache durable (`CLAUDE.md:204,206`).

**D.2 — Saved rooms + backends de stockage** ⚠️ **la décision structurante**
*Tension* : un magasin, par définition. Sous « session », le stockage devient une **cible d'export**, plus la colonne vertébrale du produit. Concrètement, la question est : **une room sauvegardée se verrouille-t-elle quand on est seul ?** Aujourd'hui non — `!savedHere` est une condition d'éligibilité (`App.svelte:469`), et `savedHere` conditionne aussi la prop `storage` de l'Editor (`App.svelte:856`).
*Options* : **(a)** oui, elle se verrouille — « sauvegardé » parle de durabilité, le contrat parle de présence ; deux axes indépendants, thèse pure. Casse frontalement l'usage « mes notes dans mon propre Dropbox », qui est l'usage d'origine du projet (`README.md:8`). **(b)** non — une room sauvegardée est votre document, y être seul est normal. Conserve l'ancien produit à l'intérieur du nouveau, au prix de deux contrats coexistants et d'un message plus flou.
*Portée* : cette décision détermine si la section « Where the file lives » du README (`README.md:19-26`) survit.

**D.3 — Filename par room + avertissement de collision** (`storage/filename.ts`, `firstFileCollision`)
*Tension* : machinerie dont la raison d'être est de garder des **magasins** distincts. Si le stockage devient une cible d'export, un fichier par room et la détection de collision deviennent du coût sans grand bénéfice.
*Options* : **(a)** garder — inoffensif, déjà écrit, et toujours juste pour des exports ; **(b)** réduire à une cible d'export choisie au moment de l'export — supprime `firstFileCollision`, l'état `Conflict` de la pastille (`StatusPill.svelte:110`) et le dérivé `conflictWarning` (`App.svelte:387-393`).

**D.4 — Élection de leader** (`collaboration/leader.ts`)
*Tension* : existe pour arbitrer des écrivains concurrents sur un même fichier. Si l'export est manuel et rare, c'est sur-dimensionné ; si l'autosave-pendant-la-session reste, c'est toujours nécessaire.
*Options* : dépend entièrement de D.2. À trancher **après** elle, pas avant.

**D.5 — `?role=reader` face au verrou de solitude**
*Tension* : deux sources de lecture seule, sémantiques et réversibilités différentes — `role` est fixé pour la session (`App.svelte:290`), la solitude est dynamique. Sans distinction explicite, l'utilisateur lira « vous êtes seul » comme « l'hôte m'a restreint ».
*Options* : **(a)** copie et iconographie strictement distinctes (recommandé en B.0) ; **(b)** fusionner en un seul concept « read-only » avec un sous-texte — plus simple à coder, mais brouille la promesse centrale, puisque l'un se lève tout seul et l'autre jamais.

**D.6 — Le `WriteGateIntro` une-fois-par-navigateur** (`KEY_WRITE_GATE_SEEN`, `constants.ts:76`)
*Tension* : la modale actuelle enseigne « les modifications solo sont éphémères » — une leçon de **durabilité**. La nouvelle leçon est autre : « écrire est un acte synchrone ». De plus, un contrat aussi central mérite-t-il d'être énoncé **une seule fois par navigateur** ?
*Options* : **(a)** réécrire la copie, garder la persistance une-fois ; **(b)** énoncer à la première visite **de chaque room** ; **(c)** supprimer la modale et faire porter l'enseignement par l'état d'attente lui-même (③) — cohérent avec « l'interface s'efface », et avec le fait que l'équipe a **déjà supprimé une modale d'intro** pour cette raison (`App.svelte:75-80`).

**D.7 — Les pairs BroadcastChannel comptent comme présence** (`webrtc.ts:97`, asserté `webrtc.test.ts:161`)
*Tension* : ouvrir un second onglet du même navigateur satisfait le contrat et déverrouille le document. Sous un avertissement souple, c'est une commodité anodine. Sous un contrat dur, c'est un **contournement trivial et vite découvert**, qui fait paraître la règle arbitraire.
*Options* : **(a)** garder — un second onglet *est* un autre client qui reçoit réellement les octets ; **(b)** exiger au moins un pair non-BC pour satisfaire le contrat — plus honnête vis-à-vis de la thèse (« quelqu'un d'autre »), casse le test existant et le développement local à deux onglets ; **(c)** garder mais le nommer dans l'UI (« Another tab of yours is here ») — ni mensonge ni faille silencieuse.

**D.8 — Les déploiements `collabUnavailable`** (`App.svelte:193`)
*Tension* : un déploiement sans serveur de signaling ne peut **jamais** avoir une seconde personne. Sous le nouveau contrat, il est donc en lecture seule permanente — c'est-à-dire que l'app y est une visionneuse.
*Options* : **(a)** ne pas gater là-bas, comme aujourd'hui (`App.svelte:472`), et assumer deux contrats selon le déploiement ; **(b)** dire franchement que Copad sans serveur de collaboration n'est pas Copad, et le signaler au déploiement plutôt que de dégrader silencieusement le contrat.

**D.9 — L'état ④ (« quelqu'un est là, injoignable ») déverrouille-t-il ?**
*Tension* : j'ai tranché « oui » en B.④, mais l'argument inverse tient : les octets n'atteignent effectivement personne, donc on écrit bien dans le vide — un absolutiste du contrat verrouillerait.
*Options* : **(a)** déverrouiller (ma recommandation — la prémisse du contrat est prouvée, la panne est la nôtre) ; **(b)** verrouiller mais avec un message et une échappatoire distincts de « seul » ; **(c)** déverrouiller en avertissant plus fort que ③.

---

## Annexe — Faits vérifiés qui portent tout le raisonnement

1. Le signaling y-webrtc n'a **aucun registre de salle** — pub/sub pur (`y-webrtc.js:476-556`).
2. **Aucun ré-`announce` périodique** — aucun `setInterval` dans `y-webrtc.js`.
3. La découverte est **unidirectionnelle par annonce** ; le récepteur n'annonce pas en retour (`y-webrtc.js:516-519`).
4. `close`/`error` d'un pair déclenchent une réannonce — seul auto-rétablissement (`y-webrtc.js:225,229`).
5. La clé de room chiffre **aussi** les messages de signaling (`y-webrtc.js:548-551`).
6. `outdatedTimeout = 30000`, balayé toutes les ~3 s (`y-protocols/awareness.js:13,77`).
7. `peerCount` P2P exige un data channel ouvert, et **compte les onglets BroadcastChannel** (`webrtc.ts:92-98`).
8. Le write-gate actuel s'arme délibérément sur `Connecting`/`Unreachable`/`Offline` (`App.svelte:466-473`, justifié `:414-420`) — polarité à inverser.
9. Le yield-on-write silencieux existe et déverrouille au premier geste (`Editor.svelte:345-358`).
10. `editable` est **déjà** réactif sans remount (`Editor.svelte:333-336`).
11. **Aucune fonction d'export/téléchargement n'existe** dans `src/` hors File System Access du backend Local (`storage/local.ts:10-14,80`).
12. `{#key room}` **n'existe plus** dans `App.svelte` — `CLAUDE.md:199` est périmé sur ce point.
13. `Settings` est rendu **hors** du bloc conditionnel de l'Editor (`App.svelte:903`) — accessible en lecture seule sans changement.
14. Toute l'UI est en **anglais** ; `ui/language.svelte.ts` ne concerne que le document.

**Points non vérifiés, à confirmer à l'implémentation** : `WebsocketProvider.synced` exposé publiquement (C.4 #7) ; comportement du `slashMenuPlugin` sur `/` en non-éditable (B.4) ; absence totale de gestion de `document.title` (B.3).
