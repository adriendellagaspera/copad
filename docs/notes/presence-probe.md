# Sonde de présence Copad — vérification de faisabilité

Rapport de vérification. Toutes les affirmations sont soit **citées** depuis les sources réelles
installées (`npm install` a réussi, versions résolues : `y-webrtc@10.3.0`, `y-websocket@3.0.0`,
`@y/websocket-server@0.1.5`, `lib0@0.2.x`, `y-protocols@1.x`), soit **mesurées** par un prototype
qui tourne (`scratchpad/probe/`, serveurs stock lancés localement, participants réels en
Chromium 1194 via Playwright).

Le dépôt n'a **pas** été modifié : `git status --short` est vide en fin de mission
(`dist/` et `node_modules/` sont dans `.gitignore`, `package-lock.json` intact).

---

## 0. Verdict en une page

| Transport | Verdict | Mécanisme qui marche vraiment | Serveur patché ? |
|---|---|---|---|
| **WebRTC (signaling)** | **Faisable avec réserves** | **PAS** l'observation passive des `announce` (l'hypothèse est fausse) — mais l'annotation `message.clients` que le serveur stock colle sur chaque `publish` relayé | **Non**, binaire stock |
| **Hub WebSocket** | **Faisable, sans réserve technique** | Le serveur pousse tout l'awareness de la room **à la connexion, sans qu'on demande rien** | **Non**, binaire stock |

**L'hypothèse WebRTC est vraie sur ses conclusions et fausse sur son mécanisme.** Il n'existe
**aucun heartbeat `announce`** dans y-webrtc 10.3.0. Une sonde purement passive ne détecte que
les **arrivées**, jamais les gens **déjà présents**, et jamais les départs. Mesuré : **0 `announce`
observé en 45 s** sur un mesh réel de 4 onglets Chromium stabilisés.

La conclusion « la présence fuit, le contenu non » est en revanche **confirmée et même
meilleure qu'annoncé** : elle tient sans la clé, et elle tient aussi pour les gens déjà présents.

**L'hypothèse hub est vraie sur les deux points** (détection instantanée, sonde invisible) —
avec un coût et une fuite de confidentialité bien plus lourds que suggéré.

---

## 1. WebRTC — protocole de signaling

### 1.1 Format exact des messages

Source : `node_modules/y-webrtc/bin/server.js` (le binaire `y-webrtc-signaling`, vérifié :
`node_modules/.bin/y-webrtc-signaling -> ../y-webrtc/bin/server.js`, c'est bien ce que lance
`npm run signaling`). Tout est du **JSON sur WebSocket**, pas de binaire.

État serveur, en tout et pour tout (`server.js:26`) :

```js
/** Map froms topic-name to set of subscribed clients. @type {Map<string, Set<any>>} */
const topics = new Map()
```

Les 4 messages (`server.js:87-119`) :

| Message client → serveur | Effet |
|---|---|
| `{ type:'subscribe', topics:[string] }` | `topics.get(t).add(conn)` pour chaque `t`. **Aucune auth, aucune validation** au-delà de `typeof topicName === 'string'` |
| `{ type:'unsubscribe', topics:[string] }` | retire `conn` du/des Set |
| `{ type:'publish', topic, data? }` | relais (voir ci-dessous) |
| `{ type:'ping' }` | → `{ type:'pong' }` |

Le cœur, `server.js:107-117` :

```js
case 'publish':
  if (message.topic) {
    const receivers = topics.get(message.topic)
    if (receivers) {
      message.clients = receivers.size          // ← LE POINT CLÉ
      receivers.forEach(receiver => send(receiver, message))
    }
  }
  break
```

Deux propriétés décisives, toutes deux vérifiées par le proto :

1. **Le relais va à TOUS les abonnés du topic** — `receivers.forEach`, sans filtrage sur
   `data.to`, **y compris l'émetteur lui-même et y compris un abonné qui n'a jamais rien publié**.
   → réponse à la question 3 : **oui**.
2. **Le serveur annote le message avec le nombre d'abonnés** (`message.clients = receivers.size`).
   → **c'est l'oracle de présence réel.** Il ne dépend d'aucun `announce`, d'aucun timing, et
   **ne dépend pas du chiffrement** (le Set d'abonnés est de la comptabilité serveur en clair).

Côté client, `publishSignalingMessage` (`y-webrtc.js:466-474`) :

```js
if (room.key) {
  cryptoutils.encryptJson(data, room.key).then(data => {
    conn.send({ type: 'publish', topic: room.name, data: buffer.toBase64(data) })
  })
} else {
  conn.send({ type: 'publish', topic: room.name, data })
}
```

→ **seul `data` est chiffré. `topic` — le nom de la room — part toujours en clair.**

### 1.2 Intervalle d'`announce` : il n'y en a pas

`announceSignalingInfo` (`y-webrtc.js:269-279`) n'est appelé que depuis **4 endroits**
(`grep -n` exhaustif sur le fichier) :

| Ligne | Déclencheur |
|---|---|
| `y-webrtc.js:385` | `Room.connect()` — on rejoint la room |
| `y-webrtc.js:226` | `WebrtcConn` peer `'close'` — un pair tombe |
| `y-webrtc.js:230` | `WebrtcConn` peer `'error'` |
| `y-webrtc.js:488` | `SignalingConn.on('connect')` — la socket de signaling (re)monte |

**Aucun `setInterval`, aucun timer.** Le seul timer périodique de la couche est celui de
`lib0/websocket.js` : `messageReconnectTimeout = 30000`, un `{type:'ping'}` applicatif toutes
les 15 s **sur la connexion**, jamais diffusé sur le topic.

Mesuré, contre le vrai Copad (`run-browser.mjs`, 4 onglets Chromium réels dans un mesh WebRTC établi) :

```json
"settled_mesh_watch_ms": 45000,
"announces_seen_while_settled": 0,
"heartbeat_exists": false
```

Et le cas décisif (`run-webrtc-hard.mjs`, sonde qui arrive **après** les participants) :

```json
"A_late_probe": {
  "polled_first_reading_ms": 116,          // le compteur `clients` répond tout de suite
  "passive_watch_ms": 40000,
  "passive_announces_observed": 0,
  "verdict_passive_only": "FAILS (no announce heartbeat)"
}
```

**Conséquence de conception : une sonde passive seule est inutilisable.** La latence de détection
au pire cas de l'approche passive n'est pas « un intervalle d'announce », elle est **infinie**.
Il faut le compteur `clients`, donc un *poll*.

### 1.3 La sonde qui marche

Deux canaux combinés (`webrtc-probe.mjs`) :

* **Push (arrivées, instantané, sans timer)** — tout `publish` relayé sur le topic. Une arrivée
  émet toujours un `announce`.
* **Poll (occupation absolue, y compris silencieux et départs)** — la sonde publie un message
  **sans clé `data`** ; le serveur lui renvoie l'écho annoté `clients`. Occupation = `clients − 1`.

Le poll est **inoffensif et invisible** : un pair y-webrtc stock reçoit le message et sort
immédiatement au garde `data == null` (`y-webrtc.js:502`) ; en room chiffrée il n'y arrive même
pas (`typeof m.data === 'string'` échoue, `y-webrtc.js:549`). Aucun `WebrtcConn` créé, aucun
événement `peers`, rien dans l'UI.

Vérifié dans le **vrai Copad** (`run-browser.mjs` → `probe_visibility`, et
`run-contamination.mjs` → `G2`) :

```json
"peers_before_probe": {"a":1,"b":1}, "peers_during_probe": {"a":1,"b":1},
"probe_changed_peer_count": false
```

(Les 2 erreurs console relevées sont le keep-alive HTTP de signaling de Copad qui se prend un
CORS — comportement préexistant du dépôt, sans rapport avec la sonde.)

### 1.4 Chiffrement : la sonde marche sans la clé

`run-webrtc.mjs`, room chiffrée avec `password: 'super-secret-room-key'` que la sonde n'a pas :

| | room claire | room chiffrée |
|---|---|---|
| détection arrivée (push) | **270 ms** | **260 ms** |
| détection arrivée (poll) | 270 ms | 260 ms |
| détection départ (poll, gracieux) | 341 ms | 412 ms |
| contenu du message vu | `announce`, `from: 4fe453ba-…` | `<encrypted>` (blob base64) |
| la sonde est visible du participant | **non** | **non** |

**Confirmé : la présence fuit, le contenu non.** Et le comptage `clients` est *identique* en
chiffré, puisqu'il ne lit pas le payload.

### 1.5 Comptage : 1 pair vs 5 ?

**Oui**, exactement — mesuré avec de **vrais onglets Chromium** exécutant la vraie app
(`run-browser.mjs`) ; la colonne de droite est la propre UI de présence de Copad, qui concorde :

| onglets réels | lecture sonde | l'onglet 0 voit |
|---|---|---|
| 1 | 1 | 0 pairs |
| 2 | 2 | 1 |
| 3 | 3 | 2 |
| 4 | 4 | 3 |

⚠️ **`clients` compte des *sockets*, pas des humains.** Un onglet = une `SignalingConn` (le
`Map` module-level de y-webrtc est par realm JS). Deux onglets du même utilisateur sur la même
room = 2. C'est en pratique la bonne sémantique pour « y a-t-il quelqu'un ? », pas pour « combien
de personnes ? ».

### 1.6 N topics sur UNE connexion : oui, et c'est gratuit

`{type:'subscribe', topics:[…]}` prend un tableau (`server.js:89`). Mesuré (`run-limits.mjs`) :

```json
"E_webrtc_scale": {
  "rooms_watched_on_one_socket": 200,
  "connections_used": 1,
  "first_full_sweep_ms": 130,
  "rooms_reported_occupied": ["scale-113","scale-7"],   // exact
  "correct": true,
  "bytes_per_poll_per_room": 38
}
```

**200 rooms, 1 socket, balayage complet en 130 ms, 38 octets montants par room et par poll.**
Un « hall » de 10 rooms à 10 s de poll = ~76 o/s aller-retour. Négligeable.

### 1.7 Faut-il patcher le serveur ? Non

Tout ci-dessus tourne sur `node_modules/y-webrtc/bin/server.js` **non modifié**, c'est-à-dire
exactement ce que lance `npm run signaling` et ce que le README dit de déployer. Le principe
« aucun serveur ne vit dans ce dépôt » est **préservé**.

---

## 2. Hub WebSocket

Source : `node_modules/@y/websocket-server/src/utils.js`, `setupWSConnection`.

### 2.1 Ce qui se passe exactement à la connexion

```js
export const setupWSConnection = (conn, req,
    { docName = (req.url || '').slice(1).split('?')[0], gc = true } = {}) => {
  const doc = getYDoc(docName, gc)
  doc.conns.set(conn, new Set())
  …
  // send sync step 1
  syncProtocol.writeSyncStep1(encoder, doc);  send(doc, conn, …)
  const awarenessStates = doc.awareness.getStates()
  if (awarenessStates.size > 0) {
    …encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
    send(doc, conn, …)                        // ← TOUT l'awareness, non sollicité
  }
}
```

→ **la room est le *path* de l'URL** ; → le serveur **offre spontanément** le sync step 1 **et
l'état d'awareness complet de la room**, avant que le client ait dit un mot.

Mesuré (`run-ws.mjs`), sonde arrivant sur une room **déjà occupée et silencieuse**, ayant envoyé
**0 octet** :

```json
"B_already_occupied": {
  "unprompted_awareness_ms": 170,
  "occupancy_read": 2,
  "leaked_states": [
    {"client":2590603864,"state":{"user":{"name":"node-24087","color":"#2563eb"}}},
    {"client":2793569069,"state":{"user":{"name":"node-24086","color":"#2563eb"}}}
  ],
  "probe_bytes_sent": 0,
  "participant_max_peers_seen": 1,
  "probe_invisible": true
}
```

Le problème du « late probe » du WebRTC **n'existe pas ici** : le hub sert l'occupation d'emblée.

### 2.2 Invisibilité : confirmée, et structurelle

Le client y-websocket ne publie son awareness que si un état local existe
(`y-websocket.js:210` : `if (provider.awareness.getLocalState() !== null)`). Une sonde qui
n'appelle jamais `setLocalState` n'émet rien ; côté serveur son `doc.conns.get(conn)` reste un
`Set` vide, donc `awarenessChangeHandler` ne la diffuse jamais. Mesuré : `probe_invisible: true`,
les 2 participants voient 1 pair (l'autre), jamais 3.

La sonde **ne lit pas non plus le document** : elle ne répond jamais au sync step 1, donc ne
reçoit aucun contenu. (Elle *pourrait* — voir §3.)

### 2.3 Latences et comptage

```json
"C_live": { "join_push_ms": 171, "graceful_leave_push_ms": 2, "probe_bytes_sent": 0,
            "counting": [1→1, 2→2, 3→3, 4→4, 5→5] }
```

**Départ gracieux poussé en 2 ms** (`closeConn` → `removeAwarenessStates` → rebroadcast). Rien à
poller : tout est en push.

### 2.4 Comptage par room côté serveur : non exposé

`docs` (`Map<string, WSSharedDoc>`) et `doc.conns` existent et sont **exportés**
(`export const docs`), mais le binaire stock `src/server.js` ne sert qu'un
`response.end('okay')` sur n'importe quelle requête HTTP. **Aucune API de comptage.** On n'en a
pas besoin — l'awareness à la connexion suffit.

### 2.5 Coût : 1 connexion par room, et une fuite mémoire serveur

`docName` vient du path → **pas de multiplexage possible**, aucun message du protocole ne le
permet. Mesuré : `25 rooms → 25 connexions`.

Pire, testé directement (`hubdoc.mjs`) :

```
docs before: 0
docs after passive probe connect:    1  [ 'ghost-room-nobody-uses' ]
docs after probe disconnect:         1  [ 'ghost-room-nobody-uses' ]   ← jamais libéré
```

`closeConn` ne fait `docs.delete(doc.name)` que **si `persistence !== null`** — or le binaire
stock ne configure aucune persistence. **Sonder une room sur le hub alloue un `Y.Doc` serveur
permanent.** Un hall qui surveille 50 rooms fait 50 connexions + 50 docs immortels ; un tiers
malveillant peut faire grossir la mémoire du hub à volonté. C'est une réserve sérieuse.

---

## 3. Ce qui fuit — analyse de confidentialité

### 3.1 Vers le serveur de signaling / le hub (l'opérateur)

| | WebRTC signaling | Hub |
|---|---|---|
| Nom de la room | **en clair, toujours**, même room chiffrée (`topic: room.name`) | **en clair, dans le path de l'URL** (donc aussi dans les logs d'accès de tout reverse-proxy) |
| Qui est dans quelle room, quand | oui (`topics` Map, join/leave) | oui (`doc.conns`) |
| Graphe social (mêmes sockets sur mêmes rooms dans le temps) | oui | oui |
| Contenu du document | **non** (P2P) | **oui, en clair** (le hub est dans le chemin de données) |
| Awareness (nom affiché, couleur, curseur) | non si room chiffrée | **oui, en clair, toujours** |

### 3.2 Vers un tiers qui sonde vos rooms

C'est le point le plus important, et il est asymétrique :

**WebRTC, room chiffrée** — le tiers apprend : *quelqu'un est là*, *combien de sockets*, *quand
ça arrive et repart*. Il n'apprend **rien d'autre** : ni le contenu, ni les noms, ni les
pseudos, ni les IP (le SDP est dans le blob chiffré). **C'est exactement la propriété idéale
annoncée par l'hypothèse, et elle est vérifiée.**

**WebRTC, room en clair** — beaucoup plus grave que « la présence ». Mesuré (`sdp-leak.mjs`,
2 onglets Copad réels) : **6 messages capturés — 2 `announce`, 4 `signal` — avec le SDP complet
en clair** :

```
"peer_ids": ["1258cb25-8653-4cfc-b5cc-a15207025bb4","3e7ac5f9-2b2c-45e6-af0f-db5973c580c0"],
"sdp_captured": true,
"sdp_first_lines": ["v=0","o=- 1511789269323333541 2 IN IP4 127.0.0.1","s=-", …]
```

Le SDP est intégralement lisible par n'importe quel abonné du topic. Dans ce bac à sable il n'y
avait pas d'interface réseau réelle donc `a=candidate:` était vide (seul `127.0.0.1` apparaît) —
mais **sur un vrai déploiement les lignes `a=candidate:` portent les IP LAN (host) et publiques
(srflx) de tous les participants**. Un simple abonné au topic les récolte sans jamais rejoindre.
Ce n'est pas nouveau (c'est la nature de WebRTC), mais ça change la lecture : **sonder une room
en clair, c'est déjà bien plus qu'une sonde de présence.** Argument fort pour chiffrer par défaut.

**Hub** — le tiers reçoit spontanément l'awareness complète : **noms affichés et couleurs en
clair** (`leaked_states` ci-dessus). Et rien ne l'empêche de répondre au sync step 1 pour
**aspirer tout le document** : le hub n'a aucune notion d'autorisation. La sonde du proto ne le
fait pas — mais c'est un choix de politesse, pas une garantie.

### 3.3 Les noms de rooms sont-ils énumérables ?

**Il n'existe aucune primitive de listing** — ni le signaling ni le hub n'exposent « donne-moi
les topics/rooms ». Un tiers doit **deviner** un nom. Deux populations très inégales :

* `DEFAULT_ROOM_NAME = 'copad-demo'` (`collaboration/constants.ts:24`) et tout `?room=` tapé à la
  main → **trivialement devinable**.
* Rooms créées par `newRoom()` (`App.svelte:656`) :
  ```js
  const r = Math.random().toString(36).slice(2, 10);
  ```
  Mesuré sur 200 000 tirages : longueur 8 dans 199 998 cas. `36⁸ = 2,82·10¹²` → **≈ 41,4 bits**.
  Non brute-forçable en ligne (≈ 77 ans à 1 000 essais/s pour 50 %). **Mais `Math.random()`
  n'est pas un CSPRNG** (xorshift128+ en V8, état reconstructible à partir de quelques sorties) —
  un attaquant qui obtient plusieurs ids issus du même onglet peut prédire les suivants.

**Enjeu de conception, pas détail** : la sonde met tout le monde à égalité — *quiconque connaît
le nom d'une room peut la sonder*, y compris chiffrée, y compris sans y avoir jamais mis les
pieds. Un lien de room partagé devient un *droit de surveillance permanent* sur cette room.
Deux recommandations qui découlent directement de ça :
1. passer `newRoom()` à `crypto.getRandomValues` (≥ 128 bits) — indépendamment de la sonde ;
2. **dire dans l'UI que la présence est observable** par quiconque a le lien. C'est déjà vrai
   aujourd'hui — la sonde ne crée pas la fuite, elle l'outille.

### 3.4 Le piège de conception : les sondes se comptent entre elles

`clients` compte les **abonnés**, et une sonde est un abonné. Mesuré (`run-contamination.mjs`) :

```json
"F_two_probes_empty_room": { "real_participants": 0, "naive_reading_others": 1,
                             "verdict": "FALSE POSITIVE — probes count each other" }
```

**Deux utilisateurs dont le hall surveille la même room se voient mutuellement comme « il y a
quelqu'un ».** Une implémentation naïve est donc structurellement fausse.

**Correctif validé** — les sondes se saluent en clair avec un `data.type` inconnu de y-webrtc.
Un pair stock exécute `execMessage`, ne matche ni `'announce'` ni `'signal'`
(`y-webrtc.js:515-545`) et **ne fait rien** ; en room chiffrée il ne déchiffre même pas.
Il faut donc que le salut soit **en clair** — c'est précisément ce qui le rend invisible.

```json
"G_probe_hello": { "probes": 3, "real_participants": 1,
                   "raw_clients": 4, "other_probes_identified": ["p2","p3"],
                   "corrected_occupancy": 1, "correct": true }
```

Et vérifié invisible dans la vraie app (`G2` : 0 pair avant, 0 pendant, aucune erreur imputable).

---

## 4. Chiffres réels (synthèse)

| Mesure | WebRTC | Hub |
|---|---|---|
| Détection **arrivée** (push) | **260–270 ms** (clair *et* chiffré) | **171 ms** |
| Détection arrivée, gens **déjà présents** | **116 ms** (poll) — impossible en passif | **170 ms**, 0 octet envoyé |
| Détection **départ gracieux** | 341–716 ms, borné par l'intervalle de poll | **2 ms** (push) |
| Détection **départ brutal** (SIGKILL, socket fermée par l'OS) | 718 ms | — |
| Détection **client gelé** (SIGSTOP = capot rabattu) | **89 s** mesuré, borne **60–90 s** | **31,2 s** |
| Comptage exact 1→5 | oui (onglets Chromium réels) | oui |
| Rooms par connexion | **200 testées, pas de limite protocolaire** | **1** |
| Coût montant | **38 o / room / poll** | **0 octet** |
| Coût serveur imposé | 1 entrée de `Set` par room | **1 `Y.Doc` par room, jamais libéré** |
| Serveur patché requis | **non** | **non** |

**Décomposition du 89 s** (elle est entièrement explicable, donc fiable) — `server.js` :
`pingTimeout = 30000` ; tick *n* : envoie un ping ; tick *n+1* : pas de pong → `conn.close()` ;
puis `ws` attend son `closeTimeout` **de 30 s par défaut**
(`node_modules/ws/lib/websocket.js:639`) avant de détruire la socket et d'émettre `'close'` —
seul moment où le serveur retire la conn des topics.
**30 + 30 + 30 = jusqu'à 90 s.** Le 31,2 s du hub, lui, est l'`outdatedTimeout = 30000` de
`y-protocols/awareness` : le GC d'awareness du serveur tombe *avant* le ping WebSocket.

**À assumer : un participant dont le portable s'endort reste « présent » 60 à 90 s (WebRTC).**
Ce n'est pas réglable sans patcher le serveur.

---

## 5. Esquisse de design hexagonal

### 5.1 Le port

Un port **distinct** de `Collab` : `Collab` *rejoint* une room (Y.Doc + awareness), le port de
sonde *observe sans rejoindre*. Les mélanger casserait la propriété centrale.

`src/collaboration/presence.ts` :

```typescript
/** Combien de sockets sont attachées à une room, vu de l'extérieur sans y entrer.
 *  Ce n'est PAS un nombre de personnes : un onglet = une socket (cf. §1.5). */
export type RoomOccupancy = number & { readonly _brand: 'RoomOccupancy' };

/** Identité éphémère qu'une sonde publie pour que les autres sondes puissent se
 *  soustraire du comptage. Jamais persistée, jamais liée au browserId. */
export type ProbeId = string & { readonly _brand: 'ProbeId' };

/** Ce qu'on sait d'une room qu'on surveille. Union discriminée : `unknown` n'est
 *  pas « 0 », et l'UI ne doit pas pouvoir les confondre. */
export type RoomPresence =
  | { readonly state: 'unknown' }                                        // pas encore de lecture
  | { readonly state: 'empty';    readonly since: Timestamp }
  | { readonly state: 'occupied'; readonly occupancy: RoomOccupancy; readonly since: Timestamp };

/** Horodatage monotone d'observation (Date.now() au bord IO). */
export type Timestamp = number & { readonly _brand: 'Timestamp' };

/** PORT — observer l'occupation de rooms sans jamais les rejoindre. */
export interface PresenceWatch {
  /** Commence à surveiller `room`. Idempotent. */
  watch(room: RoomId): void;
  /** Arrête de surveiller `room`. */
  unwatch(room: RoomId): void;
  /** S'abonne à l'état d'une room. Émet immédiatement, puis à chaque changement.
   *  Retourne la fonction de désabonnement (même forme que `Collab.onStatus`). */
  onPresence(room: RoomId, fn: (presence: RoomPresence) => void): () => void;
  destroy(): void;
}

/** Fabrique — même forme que `CollabConnect`, sélectionnée par le même transport. */
export type PresenceConnect = () => PresenceWatch;
```

### 5.2 Les adaptateurs (un par transport, nommage fonctionnel)

`src/collaboration/presenceSignaling.ts` — **`signalingPresence(opts): PresenceConnect`**
*(pas `…Provider`/`…Monitor`)*

```typescript
export interface SignalingPresenceOptions {
  readonly signaling: SignalingUrl[];        // même liste que webrtcCollab
  readonly pollMs: PresencePollMs;           // constants.ts, VITE_PRESENCE_POLL_MS
}
```
* **une seule** `WebSocket` pour toutes les rooms (§1.6) ;
* `subscribe` en lot ; poll `{type:'publish', topic}` sans `data` ;
* push : tout `publish` reçu ⇒ `occupied` immédiat (arrivées) ;
* salut inter-sondes en clair pour la correction §3.4 ;
* **n'importe pas `y-webrtc`** — c'est un client WebSocket + un parseur. C'est ce qui garde
  l'adaptateur à ~100 lignes et sans dépendance au mesh.

`src/collaboration/presenceHub.ts` — **`hubPresence(opts): PresenceConnect`**
* une `WebSocket` par room (`${url}/${room}`), `binaryType='arraybuffer'` ;
* **ne fixe jamais d'état local d'awareness** → invisible (§2.2) ;
* **ne répond jamais au sync step 1** → ne détient aucun contenu. À écrire noir sur blanc dans
  le fichier : c'est une garantie de conception, pas un oubli ;
* décode uniquement les trames `messageAwareness`.

`src/collaboration/parse.ts` reçoit les parseurs de bord IO :
`parseSignalingRelay(raw: unknown): SignalingRelay | null` (le JSON du serveur, `clients` inclus)
et `parseAwarenessOccupancy(...)`. Aucun `as` ailleurs.

`src/collaboration/config.ts` gagne **`resolvePresence()`**, jumeau exact de `resolveCollab()` :
il lit le **même** `resolveTransport(VITE_COLLAB_TRANSPORT)` — la sonde suit toujours le
transport de l'app, jamais une seconde source de vérité.

`src/collaboration/constants.ts` gagne `PRESENCE_POLL_MS` (défaut 10 000, override
`VITE_PRESENCE_POLL_MS` via `envInt`) et `KEY_WATCHED_ROOMS = nsKey('watchedRooms')`.

### 5.3 Branchement dans `App.svelte`

`App.svelte` construit déjà tout ; on suit la même trajectoire que `resolveCollab()` :

```
resolvePresence()  →  PresenceConnect  →  un seul PresenceWatch au niveau App
                                          (pas dans Editor : l'Editor est par room)
```

* **La liste des rooms surveillées existe déjà** : `savedRoomsStore(id).all()` donne les rooms
  qu'un backend sauvegarde pour l'utilisateur — c'est exactement « tes rooms ». On les croise
  avec un opt-in explicite.
* La room **courante** ne se sonde jamais : `Collab` connaît déjà son `peerCount`. Le watch
  couvre `watched \ {room}`.
* L'affichage se pose là où l'app parle déjà de présence : à côté de `PersistenceBadge` /
  du pill de statut, plus une vue « hall » listant les rooms surveillées.
* Cycle de vie : `$effect` qui `watch`/`unwatch` sur changement de la liste, `destroy()` au
  démontage. **Pas** dans le `{#key room}` — la sonde doit survivre à un changement de room,
  sinon elle perd son état à chaque navigation.

### 5.4 Opt-in par room et mode invisible

**Opt-in par room** — un `localStore<RoomId[]>` dans `src/collaboration/watchedRooms.ts`, sous
`KEY_WATCHED_ROOMS`, API criante calquée sur `savedRoomsStore` : `watches(room)` / `add(room)` /
`remove(room)` / `all()`, avec `parseRoomList` (déjà écrit, `parse.ts`) comme parseur. Rien n'est
surveillé sans un geste explicite ; la valeur par défaut est la liste **vide**.

**Mode invisible** — c'est le défaut, et ce n'est pas un réglage : les deux adaptateurs sont
*structurellement* invisibles (WebRTC : aucun `announce`, poll à `data` absent ; hub : aucun état
local d'awareness). Ce qu'il faut, c'est le contraire — **rendre la sonde honnête** :

* un `PresenceVisibility = 'invisible' | 'announced'` en option d'adaptateur. `'announced'` fait
  publier à la sonde un `announce` normal pour apparaître dans la room qu'elle observe ;
* le salut inter-sondes reste **toujours** actif (correction du comptage), il est invisible des
  vrais pairs et ne révèle qu'aux autres sondes qu'une sonde est là ;
* et surtout : afficher dans l'UI que **votre propre présence est observable par quiconque a le
  lien** (§3.3). C'est déjà vrai sans la fonctionnalité ; l'ajouter sans le dire serait le
  vrai problème éthique.

---

## 6. La limite honnête : pas de serveur, pas de notification hors onglet

**Vérifié, et la réponse est non — un Service Worker ne change rien.** Trois voies, toutes
bloquées, et le dépôt n'a aujourd'hui **ni service worker, ni manifeste, ni usage de
`Notification`** (`grep` sur `src/`, `index.html`, `public/`) :

1. **Garder une WebSocket dans un SW** — impossible : un Service Worker est tué dès qu'il est
   inactif (~30 s dans Chromium, plafond dur de quelques minutes même avec `waitUntil`). Une
   socket ouverte ne le maintient pas en vie. Un SW ne peut pas être un démon.
2. **Web Push** — `PushManager.subscribe()` donne un endpoint chez le service de push du
   navigateur (FCM / Mozilla / Apple), et **seul un serveur applicatif détenant la clé privée
   VAPID peut y POSTer**. Sans serveur, personne ne peut déclencher le push. Le `push` event ne
   peut pas s'auto-émettre. → **Rédhibitoire, et c'est la voie qu'il fallait écarter.**
3. **Periodic Background Sync** — Chromium uniquement (absent de Firefox et Safari), exige une
   PWA installée + un « site engagement » suffisant, et le navigateur impose l'intervalle réel
   (de l'ordre de la demi-journée). Ça permettrait au mieux « vérifier l'occupation 1–2 fois par
   jour », pas une notification de présence. → inutilisable ici.

**Donc la forme réelle est la « page hall » : un onglet Copad laissé ouvert.**
Concrètement :

* un onglet (idéalement épinglé) tient l'unique WebSocket de sonde et la liste des rooms
  surveillées ; il notifie via l'API `Notification` (permission demandée au premier opt-in) et
  peut poser un `navigator.setAppBadge()` en PWA ;
* **une nuance de conception qui tombe bien** : dans un onglet d'arrière-plan, Chrome bride les
  timers (~1/min) mais **pas l'arrivée des messages**. Or côté WebRTC, les **arrivées** sont
  *push* (l'`announce` du nouvel entrant) et donc **non bridées** — c'est justement l'événement
  qu'on veut notifier. Seul le *poll* (départs, occupation absolue) se dégrade vers ~60 s en
  arrière-plan. Sur le hub, tout est push, donc rien ne se dégrade. *(Déduit du modèle de
  throttling des navigateurs — non mesuré par le proto, qui tourne en onglet actif.)*
* corollaire à assumer dans l'UI : **fermer l'onglet, c'est arrêter de surveiller.** Il faut le
  dire, pas le laisser découvrir — c'est le même contrat honnête que « Live-only » sur le
  `PersistenceBadge`.

---

## 7. Pièges rencontrés pendant le proto (ils informeront l'implémentation)

1. **L'hypothèse du heartbeat.** Le piège n°1. Une sonde passive passe tous les tests écrits par
   quelqu'un qui *démarre la sonde avant le participant*, et échoue à 100 % en vrai. **Tout test
   de non-régression doit démarrer la sonde APRÈS les participants.**
2. **Les sondes se comptent entre elles** (§3.4). Invisible en test à une seule sonde. À tester
   à ≥ 2 sondes systématiquement.
3. **`clients` compte des sockets, pas des personnes.** Deux onglets d'un même utilisateur = 2.
   L'UI doit dire « il y a quelqu'un », pas « 2 personnes ».
4. **Deux participants y-webrtc en Node pur font tout tomber** : dès qu'ils se découvrent,
   `simple-peer` s'instancie et explose (pas de `wrtc`). Node convient pour *1* participant ou
   pour la sonde ; **tout test multi-pairs exige un vrai navigateur.** C'est ce qui a invalidé
   ma première tentative de comptage (elle lisait « 1 » pour 5 participants — les autres avaient
   crashé) ; refaite en Chromium, elle donne 1→1 … 4→4.
5. **Playwright plus récent que les navigateurs préinstallés** (attend chromium-1228,
   `/opt/pw-browsers` a 1194) et `playwright install` interdit → lancer avec
   `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`.
6. **Le `closeTimeout` de `ws` (30 s) est le terme oublié** de la latence de départ brutal :
   `conn.close()` ne retire *pas* la connexion des topics, seul l'événement `'close'` le fait.
   C'est ce qui fait 90 s et non 60.
7. **Sonder le hub laisse des `Y.Doc` immortels** (§2.5) — un « ça ne coûte rien de regarder »
   qui coûte de la mémoire serveur pour toujours.
8. **`process.exit` avale la sortie bufferisée** : les scripts du proto écrivent en JSONL et les
   orchestrateurs relisent stdout ligne à ligne — sinon les dernières mesures disparaissent.

---

## 8. Fichiers du prototype

Tous dans `scratchpad/probe/` (dépôt intact) :

| Fichier | Rôle |
|---|---|
| `webrtc-probe.mjs` | **La sonde WebRTC** — WebSocket brut, subscribe + poll `clients`, N rooms/socket |
| `ws-probe.mjs` | **La sonde hub** — WebSocket brut, 0 octet envoyé, décode l'awareness seule |
| `webrtc-participant.mjs` / `ws-participant.mjs` | Participants stock (WebrtcProvider / WebsocketProvider) |
| `run-webrtc.mjs` | Scénario nominal, clair **et** chiffré → §1.4 |
| `run-webrtc-hard.mjs` | Sonde tardive (absence de heartbeat), comptage, départ brutal → §1.2 |
| `run-ws.mjs` | Room vide / déjà occupée / join-leave-comptage → §2 |
| `run-browser.mjs` | **Vrais onglets Copad en Chromium** : comptage 1→4, mesh stabilisé 45 s, invisibilité → §1.2, §1.5 |
| `run-limits.mjs` | Client gelé (SIGSTOP) des 2 transports, 200 rooms sur 1 socket → §4 |
| `run-contamination.mjs` | Sondes qui se comptent + correctif validé + coût hub → §3.4, §2.5 |
| `sdp-leak.mjs` | Ce qu'une room **en clair** livre à un abonné : SDP complet → §3.2 |
| `hubdoc.mjs` | Preuve de la fuite mémoire `docs` du hub → §2.5 |
| `webrtc-run.log`, `ws-run.log` | Journaux d'événements bruts horodatés |

Reproduire : `npm install` puis `npm run signaling` (4444) / `npm run collab` (1234) ;
`npm run build && npm run preview` (4173) pour les scénarios navigateur.
