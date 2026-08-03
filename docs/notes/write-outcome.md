# Copad — le contrat de résultat d'écriture du port `Storage`, et son effet sur le verrou

> Note de design. **Aucun code écrit, aucun fichier du repo modifié** (`git status` : working tree clean).
> Chaque affirmation sur le comportement actuel porte une référence `fichier:ligne` réellement lue.
> Ce qui relève de ma connaissance des APIs fournisseurs (codes HTTP que Dropbox/Graph/Drive renvoient
> réellement) et non du code de ce repo est marqué **[API, non lu ici]**. Les incertitudes sont
> marquées **[non vérifié]**.
> Complète `01-contract.md` (contrats de transport, branche « un pair est là ») ; ne le duplique pas.
> Ma portée est la **branche (b)** : « ton backend garde tes octets ».

---

## 0. Deux corrections factuelles au brief, avant tout

Le brief affirme deux choses que le code contredit. Elles changent le point de départ, pas la conclusion.

**0.1 — Il existe déjà un suivi de résultat d'écriture, partiel.**
Le grep du brief (`saveError|lastSave|persistError|saveFailed|PersistState|saveState`) est passé à côté du
nom réellement employé : **`SaveStatus`** (`src/ui/types.ts:12`), `{ Idle, Saving, Saved, Error }`. Il est
produit dans `flush()` (`Editor.svelte:288, 297, 304`), poussé sur le pont réactif (`Editor.svelte:203` →
`sessionState.svelte.ts:68`), et déjà rendu en « Save failed » par `StatusPill.svelte:113-114` et
`ConnectionDialog.svelte:99-106`.

Le trou n'est donc pas « rien n'est observé ». Il est plus précis, et plus grave :

| | ce qui existe | ce qui manque |
|---|---|---|
| Observation | `SaveStatus.Error` sur rejet de `save()` | rien ne distingue les **rejets bénins des rejets terminaux** |
| Rémanence | `Saved` **s'efface après 2,5 s** → `Idle` (`Editor.svelte:299-301`) | `Idle` conflate **« jamais tenté »** et **« réussi il y a 3 s »** |
| Portée | statut d'UI transitoire | **aucun consommateur décisionnel** — `gateEligible` (`App.svelte:466-473`) ne le lit pas |
| Fiabilité | `save()` résolu ⟹ `Saved` | **`save()` peut résoudre sans rien écrire** (§A.0) |

`SaveStatus` est le germe du contrat, pas le contrat. Il faut le promouvoir d'*événement* en *fait*, et le
brancher sur le verrou.

**0.2 — `PersistenceBadge` n'existe pas.**
Aucun fichier de `src/ui/` ne contient `persist` (vérifié). Le porteur réel est le **second segment de
`StatusPill.svelte`** (« axe B : durabilité », commenté `:105-107`), dont les libellés sont
`Conflict` (`:110`), `Save failed` (`:114`), `Saving…` (`:116`), `Saved` (`:118`), `Not saved` (`:126`).
`CLAUDE.md:203` (« the header's `PersistenceBadge` ») et `README.md:180-183` (« Saved / **Live-only** »)
sont **tous deux périmés** : le mot rendu à l'écran est `Not saved`, pas `Live-only`. Toute la §D vise
`StatusPill.svelte`.

**0.3 — Un troisième mensonge, à corriger au passage.**
`ConnectionDialog.svelte:104` affirme à l'utilisateur : *« Copad keeps retrying. »*
**C'est faux.** Le seul `setTimeout(flush, …)` du fichier est `Editor.svelte:313`, armé uniquement depuis
`collab.doc.on('update')` (`:310-314`). Après un échec, aucune nouvelle tentative n'est planifiée : la
suivante n'aura lieu qu'à la **prochaine modification du document**. Si l'échec survient sur la dernière
frappe d'une session — le cas exact où il compte — **il n'y a jamais de seconde tentative**.
(`window.addEventListener('beforeunload', flush)` (`:316`) ne rattrape rien : `flush` lance une chaîne de
promesses non attendue, que le déchargement de page interrompt.)

---

## A. Le contrat de résultat d'écriture du port `Storage`

### A.0 Pourquoi le type de retour doit changer (et pas seulement le `catch`)

`save(content: DocContent): Promise<void>` (`storage/types.ts:142`) est un **validateur**, pas un parseur
(CLAUDE.md §3) : il ne renvoie rien, donc l'appelant n'apprend qu'une chose — *ça a jeté / ça n'a pas jeté*.
Et « ça n'a pas jeté » **ne veut pas dire « les octets sont arrivés »**. Recensement des chemins où `save()`
résout **en n'écrivant rien** :

| Site | Code | Conséquence |
|---|---|---|
| `local.ts:150-152` | `case Imported: case New: return;` | **Structurel, pas un cas limite.** Hors Chrome/Edge (`hasFsAccessApi()` faux, `:35-37`), le backend Local est *toujours* dans un de ces deux modes (`:85-90`). La pastille affiche `Saved`, **rien n'est jamais écrit sur le disque**. |
| `github.ts:251` | `if (committing) return;` | Un commit concurrent fait **abandonner silencieusement** l'écriture appelante. |
| `gitlab.ts:273` | idem | idem |
| `gdrive.ts:182` | idem | idem |
| `pcloud.ts:165-169` | ne teste que `res.ok` | pCloud signale ses erreurs **dans le corps d'une 200**, via `result != 0`. Le code le sait : `load()` teste `meta.result !== 0` (`pcloud.ts:138`, via `parsePCloudFileLinkResponse`). `save()` ne le fait pas ⟹ **un échec applicatif pCloud résout comme un succès.** |

Cinq adaptateurs sur dix peuvent affirmer un succès qu'ils n'ont pas obtenu. Aucun `try/catch` mieux écrit ne
répare ça : il faut que `save()` puisse **dire ce qu'il a fait**.

### A.1 Signatures exactes

**Modification du port** — une seule ligne, `src/storage/types.ts:142` :

```ts
// AVANT
save(content: DocContent): Promise<void>;

// APRÈS
save(content: DocContent): Promise<WriteReceipt | void>;
```

`Promise<void>` est assignable à `Promise<WriteReceipt | void>` (`void` est un membre de l'union), et les dix
adaptateurs annotent explicitement `Promise<void>` (p. ex. `dropbox.ts:143`, `webdav.ts:94`, `s3.ts:236`,
`local.ts:141`). **Zéro adaptateur à modifier pour que ça compile.** L'absence de reçu (`void`) est un état
nommé du domaine, pas un oubli — voir A.3.

**Nouveau module `src/storage/writeOutcome.ts`** (nom fonctionnel : ce qu'est la chose, pas un `Manager`) :

```ts
/** Ce qu'une écriture a fait, quand l'adaptateur est capable de le dire. */
export const WriteLanding = { Landed: 'landed', Skipped: 'skipped' } as const;
export type WriteLanding = (typeof WriteLanding)[keyof typeof WriteLanding];

/** Pourquoi une écriture n'a délibérément rien écrit — sans être une erreur. */
export const WriteSkip = {
  /** Une écriture concurrente couvre déjà ces octets (les gardes `committing`). */
  Coalesced: 'coalesced',
  /** Ce backend n'a structurellement nulle part où écrire (local Imported/New). */
  NoSink: 'no-sink',
} as const;
export type WriteSkip = (typeof WriteSkip)[keyof typeof WriteSkip];

/** Union discriminée — même forme que StorageAvailability (`types.ts:40-42`) :
 *  l'appelant doit traiter chaque branche. */
export type WriteReceipt =
  | { readonly landing: typeof WriteLanding.Landed }
  | { readonly landing: typeof WriteLanding.Skipped; readonly why: WriteSkip };

/** Comment une écriture a échoué. Voir A.2 pour la sémantique de chaque arm. */
export const WriteFailureKind = {
  Denied:    'denied',
  Missing:   'missing',
  Rejected:  'rejected',
  Contended: 'contended',
  Transient: 'transient',
  Unknown:   'unknown',
} as const;
export type WriteFailureKind = (typeof WriteFailureKind)[keyof typeof WriteFailureKind];

export interface WriteFailure {
  readonly kind: WriteFailureKind;
  /** Message adaptateur, déjà destiné à l'humain — celui que `flush` remonte
   *  aujourd'hui dans son toast (`Editor.svelte:306`). */
  readonly detail: string;
}

/** Symbole porté par les erreurs que les adaptateurs classent eux-mêmes.
 *  Pas de classe, pas de `extends Error` : une factory qui décore un Error. */
declare const WRITE_FAILURE_KIND: unique symbol;
export type ClassifiedWriteError = Error & { readonly [WRITE_FAILURE_KIND]: WriteFailureKind };

/** Ce qu'un adaptateur jette au lieu de `new Error(...)` quand il connaît la cause. */
export function writeFailure(kind: WriteFailureKind, message: string): ClassifiedWriteError;
```

**Nouveau parseur, dans `src/storage/parse.ts`** (le `parse.ts` du vertical, conformément à CLAUDE.md §3) :

```ts
/** Le rejet d'un `save()` est une donnée de frontière IO : elle vient de `fetch`,
 *  d'un DOMException, ou d'un SDK tiers. Site de narrowing unique. */
export function parseWriteFailure(err: unknown): WriteFailure;
```

Ordre de résolution dans `parseWriteFailure` :
1. l'erreur porte `WRITE_FAILURE_KIND` (adaptateur migré) → ce `kind` ;
2. `err instanceof TypeError` → `Transient` (c'est la forme d'un échec réseau/CORS de `fetch`) ;
3. `err instanceof DOMException` → `NotAllowedError`/`SecurityError` → `Denied` ; `NotFoundError` →
   `Missing` ; `QuotaExceededError`/`NoModificationAllowedError` → `Rejected` ;
4. sinon → `Unknown`.

**Alternative écartée** : ajouter `classifyFailure?(err): WriteFailure` au port `Storage`. Rejetée — ça met
deux membres au port pour une seule idée, et ça laisse le site de `throw` mentir pendant que le classifieur
dit la vérité. Une erreur classée à sa source est plus dure à désynchroniser.

### A.2 Taxonomie des échecs, et lequel verrouille

Le seul but de la taxonomie est de répondre à : *est-ce que continuer à taper est encore honnête ?*

| Arm | Sens | Réversible par | Verrouille ? |
|---|---|---|---|
| **`Denied`** | Le credential ne suffit plus (mort, expiré, révoqué, permissions insuffisantes). | **une ré-authentification** — pas par le temps | **OUI** |
| **`Missing`** | La cible n'existe pas et n'a pas pu être créée (dossier absent, branche absente, fichier déplacé hors scope). | reconfiguration (Settings) | **OUI** |
| **`Rejected`** | Le backend refuse *ces octets-là* : quota plein, fichier trop gros, fichier verrouillé côté serveur. | action hors de Copad, puis retente | **OUI** |
| **`Contended`** | Concurrence bénigne : 409 sha périmé GitHub, POST-vs-PUT GitLab, `Coalesced`. | tout seul | **NON** |
| **`Transient`** | Pas de réponse ferme : erreur réseau, 5xx, 429, timeout. | tout seul, en général | **NON** — jusqu'à `WRITE_FAIL_STREAK` échecs consécutifs |
| **`Unknown`** | Non classable. | — | **NON** en isolé (voir B.2 et E.2) |

> **Règle de polarité, héritée de `01-contract.md` §0 et non négociable ici non plus :
> on ne verrouille jamais sur l'ignorance.** `Unknown` est l'arm par défaut d'un adaptateur non migré ; il ne
> verrouille pas. Chaque migration d'adaptateur *ajoute* de la protection, aucune n'en retire. C'est ce qui
> rend le déploiement incrémental sans risque de régression.

Note d'implémentation : le README (`:265`) qualifie le 409 GitHub d'auto-réparateur. **Dans ce code, il ne
l'est pas.** `fileSha` n'est réassigné qu'en cas de succès (`github.ts:154`) ; après un 409 il reste périmé,
donc la tentative suivante 409 de nouveau, indéfiniment. Classer `Contended` (donc ne pas verrouiller) est
juste ; mais l'arm doit **aussi** déclencher l'invalidation de `fileSha` côté adaptateur, sinon on ne
verrouille jamais sur un backend qui n'écrira plus jamais. Même remarque pour `gitlab.ts`, dont `fileExists`
(`:119, 168, 183`) reste `true` si le fichier est supprimé à distance : chaque PUT 404 alors, sans jamais
retomber sur le POST.

### A.3 Ce qui est obligatoire, ce qui est optionnel, et le défaut

| Élément | Statut | Défaut si absent |
|---|---|---|
| `save(): Promise<WriteReceipt \| void>` | **obligatoire** (élargissement de type — rétro-compatible, 0 adaptateur cassé) | — |
| Renvoyer un `WriteReceipt` | **optionnel** | `void` ⟹ **`Landed` présumé**. Comportement identique à aujourd'hui pour les six adaptateurs qui ne l'implémentent pas. |
| Jeter un `ClassifiedWriteError` | **optionnel** | `parseWriteFailure` retombe sur la forme de l'erreur, puis `Unknown` — qui ne verrouille pas. |
| `access?(): Promise<StorageAccess>` | **inchangé, déjà optionnel** (`types.ts:149`) | inchangé |

**Le reçu est obligatoire pour exactement cinq sites**, ceux du recensement A.0 — parce que là, le défaut
« résolu ⟹ atterri » est *faux* :

| Site | Doit renvoyer |
|---|---|
| `local.ts:150-152` (Imported/New) | `{ landing: Skipped, why: NoSink }` |
| `github.ts:251`, `gitlab.ts:273`, `gdrive.ts:182` (garde `committing`) | `{ landing: Skipped, why: Coalesced }` |
| `pcloud.ts:169` | doit d'abord **tester `result !== 0` dans le corps**, comme `load()` le fait déjà (`:138`), puis `Landed` |

C'est le minimum incompressible : cinq corrections, dont quatre d'une ligne.

### A.4 Adaptateur × modes d'échec réels

Colonne « code » = lu dans ce repo. Colonne « ce que ça produit » = sémantique fournisseur, **[API]** quand
elle ne vient pas du repo.

| Adaptateur | Site de rejet | Modes d'échec réels | Classement |
|---|---|---|---|
| **dropbox** (`dropbox.ts`) | `:162` `if (!res.ok) throw` | **Le token d'accès n'est jamais rafraîchi** : `:81` demande `token_access_type:'offline'` mais `:100` ne stocke que `access_token` — `grep refresh_token src/` → **0 occurrence dans tout le repo**. `isAuthenticated()` (`:63`) ne teste que la *présence* de la chaîne. ⟹ 401 après expiration **[API]** est le mode d'échec **nominal**, pas exceptionnel. 507 quota **[API]**. `TypeError` réseau. | `Denied` / `Rejected` / `Transient` |
| **pcloud** (`pcloud.ts`) | `:169` (HTTP seul) | Idem token non rafraîchi (`:94` ne stocke que `token`). **`load()` ne peut pas échouer** : `:148-151` avale *toute* exception et renvoie `null` — un 401 se lit « fichier vide ». Erreur applicative dans une 200 (§A.0). | `Denied` / **succès menteur** |
| **webdav** (`webdav.ts`) | `:108-109` (n'accepte que 200/201/204) | 401 mot de passe d'app révoqué ; 403 partage lecture seule ; 507 quota ; 409 collection parente absente **[API]**. **Le proxy CORS obligatoire (`VITE_PROXY_URL`, CLAUDE.md:209) est lui-même un point de panne** : proxy mort ⟹ `TypeError`. | `Denied` / `Rejected` / `Missing` / `Transient` |
| **github** (`github.ts`) | `:149-152` | 401 PAT expiré/révoqué ; 403 **ambigu** — PAT fine-grained sans `Contents: write` **ou** rate-limit (403 + `x-ratelimit-remaining: 0`) **[API]**, indistinguables sans lire les en-têtes ; 409 sha périmé (voir A.2 : ne s'auto-répare pas ici) ; 422 branche absente. `:251` no-op silencieux. **`access()` absent** ⟹ `canPersist = true` inconditionnel (`Editor.svelte:138-140`) : **un PAT lecture seule passe le pré-contrôle**. | `Denied` / `Transient`(à désambiguïser) / `Contended` / `Missing` |
| **gitlab** (`gitlab.ts`) | `:182` | Même forme PAT. **`fileExists` mis en cache et jamais invalidé sur échec** (`:119,168,183`) : fichier supprimé à distance ⟹ PUT 404 en boucle. `:273` no-op silencieux. 400 « file already exists » quand `fileExists` était à tort faux. | `Denied` / `Missing` / `Contended` |
| **s3** (`s3.ts`) | `:247` | 403 SignatureDoesNotMatch — **y compris par dérive d'horloge** : SigV4 signe `x-amz-date` (`:106`), une machine à l'heure fausse échoue *chaque* écriture ; 403 politique de bucket ; 404 NoSuchBucket. **CORS non configuré ⟹ `TypeError`** (le commentaire `:22` prévient que le bucket doit l'autoriser) : classé `Transient` alors que c'est **permanent** — piège assumé, voir E.4. | `Denied` / `Missing` / `Transient`(faux) |
| **sharepoint** (`sharepoint.ts`) | `:179` | **Token bearer collé à la main, aucun rafraîchissement** — le commentaire `:19-22` l'admet (« a pasted token is short-lived »). Le 401 sous ~1 h **[API]** est l'état terminal **normal** de ce backend. 423 Locked (fichier ouvert dans Office) ; 507 quota **[API]**. | `Denied` (nominal) / `Rejected` |
| **gdrive** (`gdrive.ts`) | `:211` | Token non rafraîchi (`:132`). 403 `storageQuotaExceeded` **[API]**. 404 si l'utilisateur met le fichier à la corbeille : **`load()` réinitialise `fileId` sur 404 (`:171`), `save()` ne le fait pas (`:211`)** ⟹ bloqué sur un `fileId` mort jusqu'au remount. Scope `drive.file` : un fichier sorti du périmètre de l'app devient 404 **définitivement**. `:182` no-op silencieux. | `Denied` / `Rejected` / `Missing` |
| **onedrive** (`onedrive.ts`) | `:190` | `ONEDRIVE_SCOPE` demande `offline_access` (`constants.ts:199`) mais `:130` ne stocke que `access_token` ⟹ 401 sous ~1 h **[API]**. 507 quota ; 423 Locked **[API]**. **Aucune garde `committing`** (contrairement à gdrive/github/gitlab) ⟹ PUT concurrents en course. | `Denied` / `Rejected` |
| **local** (`local.ts`) | `:137`, `:154` + le writable | **Modes très différents des backends HTTP.** `Imported`/`New` : **jamais d'écriture** (`:150-152`) → `NoSink`. `Native` : `createWritable()` (`:145`) jette un `DOMException` — `NotAllowedError` quand la permission du handle a été révoquée (un handle **ne survit pas à un redémarrage du navigateur**, et `state` est en mémoire de module `:33`, donc perdu au reload de toute façon) ; `NotFoundError` si le fichier a été déplacé/supprimé ; `NoModificationAllowedError` si un autre logiciel le verrouille ; `QuotaExceededError` sur disque plein. Pas de `access()` ⟹ `canPersist = true`. | `NoSink` / `Denied` / `Missing` / `Rejected` |

**Trois généralisations qui tombent de ce tableau :**

1. **Aucun des cinq backends OAuth ne rafraîchit son token** (vérifié : zéro `refresh_token` dans `src/`).
   Le `Denied` n'est donc pas un accident rare à couvrir « au cas où » : c'est **la fin de vie normale de
   chaque session OAuth**, à échéance d'une heure environ. Le trou décrit par le brief n'est pas un cas
   limite, c'est le cas médian.
2. **Cinq backends n'implémentent pas `access()`** (dropbox, pcloud, webdav, github, local) ⟹
   `canPersist = true` inconditionnellement (`Editor.svelte:138-140`). Le pré-contrôle de droit d'écriture
   existant ne couvre que la moitié du parc.
3. **Le contrat ne peut pas se contenter d'un `Denied` d'écriture pour Local**, dont le mode d'échec dominant
   est de *ne pas écrire du tout* sans jamais échouer.

---

## B. La machine à états de la santé de persistance

### B.1 États

Un fichier pur, `src/collaboration/persistHealth.ts` — précédents exacts dans le repo : `leader.ts:34`
(`isPersistLeader`, fonction pure d'un instantané, testée dans `leader.test.ts`) et `roomLock.ts`.
Pas de port : ce n'est pas une dépendance externe substituable, c'est de la logique de domaine.

```ts
export const PersistHealthKind = {
  /** Aucune écriture tentée, ou rien de concluant. L'état de départ. */
  Unproven: 'unproven',
  /** Au moins une écriture a atterri dans cette session. */
  Proven: 'proven',
  /** Échec(s) non terminaux consécutifs, sous le seuil. */
  Failing: 'failing',
  /** Cause terminale, ou série d'échecs au-delà du seuil. */
  Broken: 'broken',
} as const;
export type PersistHealthKind = (typeof PersistHealthKind)[keyof typeof PersistHealthKind];

export type PersistHealth =
  | { readonly kind: typeof PersistHealthKind.Unproven }
  | { readonly kind: typeof PersistHealthKind.Proven;  readonly at: EpochMs }
  | { readonly kind: typeof PersistHealthKind.Failing; readonly streak: number; readonly last: WriteFailure }
  | { readonly kind: typeof PersistHealthKind.Broken;  readonly since: EpochMs; readonly cause: WriteFailure }
```

`EpochMs = number & { readonly _brand: 'EpochMs' }` — brandé parce que `since` est **affiché à
l'utilisateur** (§D : « rien n'a été sauvegardé depuis 14:02 ») ; ce n'est pas une durée de configuration
comme `CONNECT_TIMEOUT_MS` (`constants.ts:64`), qui reste à juste titre un `number` nu.

Constantes, dans `src/storage/constants.ts` avec override `VITE_*` via `envInt` (`:67-70`) :

```
WRITE_FAIL_STREAK   // défaut 3   — VITE_WRITE_FAIL_STREAK
```

### B.2 Transitions

Fonction pure, horloge injectée :
`nextPersistHealth(current: PersistHealth, ev: WriteEvent, now: EpochMs): PersistHealth`

| Événement | Depuis | Vers |
|---|---|---|
| `save()` résout, reçu `Landed` **ou** `void` | tout | `Proven{ at: now }`, série remise à 0 |
| `save()` résout, reçu `Skipped{ Coalesced }` | tout | **inchangé** — ce n'était pas une tentative, l'écrivain concurrent tranchera |
| `save()` résout, reçu `Skipped{ NoSink }` | tout | `Broken{ cause: NoSink }` — un backend sans destination est cassé, pas neutre |
| `save()` rejette, `kind ∈ {Denied, Missing, Rejected}` | tout | `Broken{ since: now, cause }` |
| `save()` rejette, `kind = Contended` | tout | **inchangé** |
| `save()` rejette, `kind ∈ {Transient, Unknown}` | `Failing{streak}` | `streak+1 ≥ WRITE_FAIL_STREAK` ? `Broken` : `Failing{streak+1}` |
| `load()` rejette, `kind = Denied` | tout | `Broken` — voir B.6 |
| `auth.login()` réussit sur ce backend | tout | `Unproven` — **la seule sortie de `Broken`** |
| backend / room / filename changent | tout | `Unproven` |

Point à ne pas rater : **`Proven` ne décroît pas avec le temps.** Voir B.3.

### B.3 Pourquoi une machine, et pas un critère de fraîcheur — l'argument, pas le postulat

Le brief suggère qu'une machine est « probablement plus juste », en demandant l'argument. Le voici.

Un critère de fraîcheur (« la dernière écriture a réussi il y a moins de T ») a **deux modes de faux positif
asymétriques** :

- *Faux verrou par inactivité.* L'autosave est débouncée à 3 s (`Editor.svelte:81`) et n'est armée que par
  `doc.on('update')` (`:310`). Un utilisateur qui lit son document dix minutes ne produit **aucune** écriture.
  Sous un critère de fraîcheur, sa santé se dégrade toute seule et le verrou tombe **au moment précis où il
  recommence à écrire** — sans qu'aucun fait du monde n'ait changé.
- *Fausse confiance par expiration silencieuse.* Un token peut mourir pendant l'inactivité. La machine
  restera sur `Proven` jusqu'à la première écriture qui échoue.

Le second est un vrai coût de la machine, et il faut le nommer : **la machine ne prédit pas, elle constate**.
Sa promesse n'est pas « ton backend est sain » mais « **je n'affirmerai jamais une durabilité que je n'ai pas
observée** ». Le coût du second mode est **borné à une fenêtre de debounce d'écriture** (3 s de frappe entre
la mort du token et le premier échec constaté). Le coût du premier est **non borné et frappe un utilisateur
dont rien n'a échoué**. Sous un contrat dont le brief dit qu'il « n'est pas là pour punir la solitude », le
choix est net.

Corollaire concret : `SaveStatus.Saved` qui s'efface en 2,5 s (`Editor.svelte:299-301`) est exactement le
critère de fraîcheur à ne pas reproduire — il conflate « jamais tenté » et « réussi » sous `Idle`.
`PersistHealth` peut coexister avec lui (`SaveStatus` reste le clignotant d'activité) mais ne doit **pas**
en dériver.

### B.4 Régime démarrage vs milieu de session

La frontière doit être un **événement**, pas une horloge — une horloge est arbitraire et se re-discute à
chaque revue. L'événement juste est : **la première modification locale du document dans cette session.**
C'est lui qui crée quelque chose à perdre.

```ts
export const WriteRegime = { Cold: 'cold', Warm: 'warm' } as const;
export type WriteRegime = (typeof WriteRegime)[keyof typeof WriteRegime];
```

| | **Cold** — l'utilisateur n'a rien écrit dans cette session | **Warm** — il a écrit |
|---|---|---|
| `Broken` ⟹ | la branche (b) n'est **pas** satisfaite ⟹ le verrou peut se fermer (si la branche (a) ne le sauve pas) | la branche (b) n'est **pas** satisfaite, **mais le verrou ne se ferme jamais** |
| Justification | verrouiller ne coûte rien : il n'y a rien à confisquer, et on empêche l'illusion avant qu'elle serve | verrouiller ne dé-écrit pas les trois paragraphes ; ça ajoute l'humiliation à la perte |
| Ce qu'on fait à la place | — | **alerter fort et offrir les sorties** : `Reconnect`, `Export a copy` (§D) |
| Réversible ? | Cold → Warm, **une seule fois, sans retour** pour la session | — |

C'est la même hystérésis que `01-contract.md` §B.⑥ applique au départ d'un pair, dans l'autre vertical :
**le verrou protège le début d'une session, pas son milieu.**

**Signal d'implémentation.** Ne **pas** utiliser `collab.doc.on('update')` (`Editor.svelte:310`) : il se
déclenche aussi sur les mises à jour *distantes* (c'est voulu — un chargement distant doit déclencher une
sauvegarde). Le signal local fiable disponible ici est `dispatchTransaction` (`Editor.svelte:394-399`), avec
`tr.docChanged` : par construction, ProseMirror ne dispatche que des transactions locales.
**[non vérifié]** : je n'ai pas confirmé que `ySyncPlugin` ne fait pas transiter les mises à jour distantes
par `dispatchTransaction` ; à valider à l'implémentation — si c'est le cas, filtrer sur l'absence du meta de
`ySyncPlugin`.

### B.5 Le non-leader — et pourquoi il ne faut **pas** diffuser la santé dans l'awareness

Le brief propose comme piste de diffuser la santé du target dans l'awareness, comme `persistTargetKey`, en
s'inquiétant de ce que ça révélerait. **Cette piste est inutile ici**, et la raison est structurelle.

Chaîne de faits vérifiés :

1. `myPersistTarget()` = `persistTargetKey(browserId(), storage.id, filename)` (`Editor.svelte:270-273`).
2. `persistTargetKey` hache `${browser}:${storage}:${filename}` (`leader.ts:21-26`).
3. `browserId()` est un **UUID aléatoire par profil de navigateur**, minté une fois et persisté en
   localStorage (`browserId.ts:25-40`).
4. `isPersistLeader` ne compare que des pairs **partageant le même target** (`leader.ts:41-44`).

⟹ Deux personnes distinctes ont deux `browserId` distincts, donc deux `PersistTarget` distincts, donc
**chacune est toujours son propre leader**. Formellement :

> **Un pair non-leader est nécessairement un autre onglet du même profil de navigateur, dans la même room,
> vers le même backend et le même fichier.**

Ce qui change tout : le canal de partage de santé n'a **pas besoin d'être le réseau**. Il est
**same-origin, same-browser**.

**Solution retenue — `BroadcastChannel`.**

```ts
// src/storage/persistHealthChannel.ts
export function persistHealthChannel(target: PersistTarget): {
  publish(h: PersistHealth): void;
  subscribe(fn: (h: PersistHealth) => void): () => void;
  destroy(): void;
};
```

Un canal par `PersistTarget` (`copad:persist-health:<target>`). Le leader publie à chaque transition ; tout
onglet du même target adopte la santé publiée quand il n'est pas leader. Effet :

| | diffusion par awareness | `BroadcastChannel` (retenu) |
|---|---|---|
| Portée | tous les pairs de la room, y compris des inconnus | uniquement mes propres onglets |
| Fuite d'information | ajoute un signal *par pair* corrélable au `persistTarget` déjà diffusé — révèle « cette personne a un backend cassé » à toute la room | **aucune** |
| Exactitude | approximation relayée | exacte, c'est le même fait |
| Dépend de la connectivité collab ? | oui — inutilisable quand le WebRTC échoue | non |
| Modèle serverless | respecté | respecté |

Cas particuliers :
- **Aucun leader vivant** (l'onglet leader est fermé) : l'onglet restant devient leader dès le prochain
  balayage d'awareness (`leader.ts:42`, `min` initialisé à `selfId`) et repart de sa propre observation.
- **Pas encore de publication reçue** : `Unproven`. Ne verrouille pas. Polarité respectée.
- **`BroadcastChannel` indisponible** **[non vérifié : support à confirmer sur les cibles visées]** :
  dégrader vers `Unproven` permanent pour le non-leader. Ne verrouille jamais. Ne **pas** retomber sur
  `localStorage` + `storage` event : `localStore` avale silencieusement ses échecs (`persistence/local.ts:45-47,
  54-56`), et si localStorage est mort, `browserId()` re-minte un id à chaque appel (`browserId.ts:35-39`),
  ce qui fait déjà dériver `persistTargetKey` — l'élection de leader est alors elle-même non déterministe.
  Fragilité préexistante, à ne pas amplifier.

### B.6 Ce que `load()` prouve — et ce qu'il ne prouve pas

`load()` est appelé au démarrage (`Editor.svelte:245-265`). Évaluation demandée par le brief :

| | verdict |
|---|---|
| `load()` **réussit** ⟹ écriture saine ? | **NON.** Ça prouve joignabilité + autorisation **en lecture**. Un PAT GitHub `Contents: Read`, un partage WebDAV lecture seule, un fichier Drive passé en lecture seule, un bucket S3 avec `s3:GetObject` mais pas `s3:PutObject` : tous passent. Et le pré-contrôle existant ne les rattrape pas — cinq backends n'implémentent pas `access()` (A.4, généralisation 2). |
| `load()` **échoue avec `Denied`** ⟹ écriture cassée ? | **OUI.** Un credential refusé en lecture ne sera pas accepté en écriture. C'est un **falsificateur** valide, disponible **avant la première frappe** — donc pile dans le régime Cold, là où verrouiller est protecteur et gratuit. |

Asymétrie retenue : **`load()` peut faire entrer dans `Broken`, jamais dans `Proven`.**

Deux réserves, toutes deux vérifiées :
- **Inutilisable sur pCloud** : `load()` ne peut pas échouer (`pcloud.ts:148-151` avale tout et renvoie
  `null`). Il faut corriger l'adaptateur pour que la falsification marche là aussi.
- **Aujourd'hui, un `load()` échoué ne bloque même pas la sauvegarde.** `flush` ne consulte pas `loadedFrom`
  (`Editor.svelte:283-285`, il ne teste que `storage` et `isLeader()`), et le `catch` de `load` ne met pas
  `loadedFrom` (`:261-264`). Donc : chargement raté ⟹ le doc local ne contient pas le contenu distant ⟹ la
  première frappe déclenche un `flush` qui **écrase le fichier distant** avec un document qui n'a jamais vu
  son contenu. Pour `.yjs` le CRDT fusionne et ça reste bénin ; pour les codecs texte (`.md`, `.txt`,
  `.html`, `.json`), `encode` sérialise le document entier ⟹ **perte de données franche**. C'est un argument
  fort et indépendant pour traiter l'échec de `load()` comme un fait de santé plutôt que comme un toast.

### B.7 Récapitulatif : qui ouvre et qui ferme le verrou

Prédicat de la branche (b) — la seule chose que ma spec fournit à `gateEligible` :

```
durabilityHolds(health, regime) =
     health.kind === Proven
  || health.kind === Unproven      // on ne verrouille pas sur l'ignorance
  || health.kind === Failing       // transitoire, pas encore concluant
  || regime === Warm               // Broken en cours de session n'enferme jamais
```

Autrement dit : **`durabilityHolds` est faux dans un seul cas — `Broken` ∧ `Cold`.** Tout le reste ouvre.

| État | Cold | Warm |
|---|---|---|
| `Unproven` | ouvre (b) | ouvre (b) |
| `Proven` | ouvre (b) | ouvre (b) |
| `Failing` | ouvre (b) | ouvre (b) |
| **`Broken`** | **ferme (b)** → le verrou dépend alors de la branche (a) | ouvre (b), **alerte forte** (§D) |

Fermer la branche (b) **ne verrouille pas à soi seul** : le contrat a deux branches. Si un pair est présent,
la branche (a) tient et le document reste ouvert. Le verrou ne se ferme que si les deux branches tombent.

---

## C. Comment ça remplace `savedHere` dans `gateEligible`

### C.1 Le diff conceptuel

```
                     AUJOURD'HUI (App.svelte:365-370)
savedHere = storage != null && auth.isAuthenticated() && savedRoomsStore(id).saves(room)
          = « un backend est configuré, connecté, et revendique cette room »
```

Trois conjonctions, toutes **déclaratives** : de la configuration lue dans `localStorage`
(`savedRooms.ts:45`) et un booléen de présence de token (`dropbox.ts:63`, `gdrive.ts:95`, `onedrive.ts:95`,
`github.ts:166`…). **Aucune ne consulte le monde.** C'est pourquoi un token mort les laisse toutes vraies.

```
                              APRÈS
savedHere      — INCHANGÉ. « un backend à moi revendique cette room » (identité)
persistHealth  — NOUVEAU.  « mes octets sont-ils arrivés ? »          (fait)
durabilityHolds = !savedHere ? false : durabilityHolds(health, regime)   // B.7
```

Les deux notions **coexistent** ; elles répondent à deux questions différentes. `savedHere` reste correct
pour tout ce qui relève de l'identité et du routage. Il n'était faux que là où on lui faisait dire
« durable ».

### C.2 Le seul point de contact qui bascule

`App.svelte:466-473`, conjonction `!savedHere` en `:469` :

```diff
  const gateEligible = $derived(
    sessionRole === SessionRole.Writer &&
      sessionState.diagnostics.transport === Transport.P2P &&
-     !savedHere &&
+     !durabilityHolds &&
      sessionState.conn !== ConnStatus.Connected &&
      !soloRooms.includes(room) &&
      !collabUnavailable,
  );
```

Les autres conjonctions (transport, `conn`, `collabUnavailable`) relèvent de la branche (a) : elles sont
traitées par `01-contract.md` §C.3, je n'y touche pas.

Direction de l'effet : `durabilityHolds` est **strictement plus strict** que `savedHere`, donc le gate
devient éligible dans **plus** de cas. C'est la direction protectrice — et c'est précisément pourquoi le
régime Cold/Warm (§B.4) est indispensable pour en borner le rayon d'action.

### C.3 Le point de contact qui ne doit **surtout pas** basculer

`App.svelte:856` — `storage={savedHere ? storage!.storage : null}`.

**Garder `savedHere`.** Si une santé `Broken` retirait la prop `storage` à l'Editor :
- `flush` s'arrêterait (`Editor.svelte:284`), donc plus aucune écriture, donc **la santé ne pourrait plus
  jamais quitter `Broken`** — un état absorbant ;
- le `$effect` de `load` (`Editor.svelte:245-265`) ne se relancerait pas ;
- `canPersist` tomberait à `false` (`:134-136`), donc `myPersistTarget()` deviendrait `undefined` (`:270-273`),
  donc `isPersistLeader` renverrait `false` (`leader.ts:39`) — **la diffusion de santé de B.5 s'arrêterait
  aussi**, cassant les onglets non-leaders au passage.

La prop `storage` est le canal par lequel le système *ré-essaie et se répare*. On ne la coupe pas.

### C.4 Les quinze autres lectures de `savedHere`

| Ligne(s) | Consommateur | Décision |
|---|---|---|
| `:340` | commentaire | mettre à jour (mentionne `isAuthenticated`) |
| `:365-370` | définition | **inchangée** |
| `:380` | `fileConflict` | **garder `savedHere`.** Une collision de fichiers est un fait de *configuration* (`filename.ts:83-93`), pas de santé. Un backend cassé peut parfaitement avoir aussi une collision, et l'utilisateur doit la voir. |
| `:469` | **`gateEligible`** | **→ `durabilityHolds`** (C.2) |
| `:711-712`, `:771-772` | `StatusPill` ×2 (`hasStorage`, `storageLabel`) | **garder `savedHere`** pour ces deux props, et **ajouter une prop `health`**. `hasStorage` répond « y a-t-il un backend ici », ce qui reste vrai ; c'est le *libellé* de l'axe durabilité qui doit changer (§D). Le composant reçoit déjà `saveStatus` séparément (`StatusPill.svelte:22`) : même patron. |
| `:822` | `SyncBanner` (`storageLabel`) | **garder `savedHere`**, **ajouter `health`** — le tier a besoin de savoir s'il doit dire « kept for you in X » ou « can't save to X ». Attention : `SyncBanner.svelte:56` dérive `saved = storageLabel !== null`, et `:63` en tire le ton `strong`. Une santé `Broken` doit forcer le ton fort même quand `storageLabel` est non nul. |
| `:856` | **prop `storage` de l'Editor** | **garder `savedHere`** — impératif (C.3) |
| `:878-879` | `CollabUnavailableIntro` | **garder `savedHere`**, **ajouter `health`**. Son texte `SyncBanner.svelte:172-174` (« your own copy is safe ») est le mensonge le plus coûteux du lot sur un déploiement `collabUnavailable` : le stockage y est **la seule** histoire de durabilité. |
| `:891`, `:893` | `ConnectionDialog` | **garder `savedHere`**, **ajouter `health`**. C'est la feuille de détail : c'est là que la *cause* et le CTA de ré-auth doivent vivre. Corriger `:104` (§0.3). |
| `:928-929` | `ShareDialog` | **garder `savedHere`** tel quel. Partager un lien n'a rien à voir avec la santé de *mon* stockage. Aucun changement. |

Répartition : **1 bascule, 1 interdiction formelle de basculer, 2 conservations pures, 5 composants qui
reçoivent une prop *supplémentaire*.** Ce n'est effectivement pas du tout-ou-rien.

### C.5 Par où transite la santé — la frontière hexagonale ne bouge pas

La santé est **produite** dans l'Editor (qui possède `flush`) et **consommée** dans App (qui possède le
verrou et les backends). Le chemin existe déjà, à l'identique de `saveStatus` :

```
Editor.flush()                                    // appelle Storage.save(), seul détenteur du résultat
  └─ parseWriteFailure(err) / lecture du WriteReceipt   // fonctions pures de src/storage/
      └─ nextPersistHealth(...)                        // fonction pure de src/collaboration/
          └─ setSessionPersistHealth(h)                // sessionState.svelte.ts, à côté de setSessionSave:68
              └─ App.svelte lit sessionState.persistHealth → durabilityHolds → gateEligible
```

- L'Editor ne reçoit **que** le port `Storage` (`Editor.svelte:55`) — inchangé. Il ne voit jamais
  `StorageAuth`.
- Le **CTA de ré-authentification** a besoin de `StorageAuth.login()`. Il vit dans App/Settings, qui
  possède déjà `StorageBackend[]` (`App.svelte:292, 904`) — App lit la santé sur le pont et déclenche le
  login. La frontière tient.
- La **classification** d'une erreur d'adaptateur est faite par une fonction pure prenant `unknown`
  (`parseWriteFailure`), pas par l'Editor : aucune connaissance de backend ne remonte dans le domaine.

Ajouts à `sessionState.svelte.ts` : un `let persistHealth = $state<PersistHealth>({ kind: Unproven })`
(à côté de `:24`), son getter (à côté de `:45`), son setter (à côté de `:68`), sa réinitialisation
(`:88`). Exactement le patron existant.

---

## D. UX — ce que voit l'utilisateur

**Langue de l'UI : anglais.** Vérifié sur les fichiers que j'ai lus intégralement — `StatusPill.svelte`,
`SyncBanner.svelte`, `ConnectionDialog.svelte`, `WriteGateIntro.svelte` : 100 % anglais, aucune trace d'i18n
(`ui/language.svelte.ts` ne concerne que la langue *du document* et le spellcheck). **Les copies ci-dessous
sont donc à implémenter en EN** ; la glose FR est pour la relecture.

### D.1 Le porteur : le segment durabilité de `StatusPill.svelte`

Pas de nouveau composant. Le bloc `d = $derived.by(...)` (`StatusPill.svelte:108-132`) devient une fonction
de `PersistHealth` plutôt que de `SaveStatus` seul.

| Santé | Libellé | Ton | Icône | `title` (survol) |
|---|---|---|---|---|
| collision (inchangé, `:110`) | `Conflict` | danger | `warning` | inchangé |
| `Broken` | **`Not saving`** | danger | `cloudOff` | *Copad can't save to {X}. {cause}. Nothing has been saved since {HH:MM}.* |
| `Failing` | **`Save failed`** | warn | `cloudOff` | *The last save to {X} didn't go through. Copad will try again when you next type.* |
| en vol | `Saving…` (inchangé, `:116`) | muted | `spinner` | inchangé |
| `Proven` | `Saved` (inchangé, `:118`) | accent | `cloudCheck` | inchangé |
| `Unproven` **∧** `savedHere` | **`Not saved yet`** | muted | `cloudOff` | *{X} is connected, but nothing of yours has been written to it yet.* |
| `!savedHere` | `Not saved` (inchangé, `:126`) | muted | `cloudOff` | inchangé |

Deux ajouts, deux distinctions qui manquaient :
1. **`Not saving` vs `Save failed`.** L'un est un *état debout* (ça ne marchera pas tant que tu n'agis pas),
   l'autre un *événement* (un coup est passé à côté). Aujourd'hui les deux sont `Save failed` (`:114`), ce qui
   fait lire un blocage terminal comme un hoquet.
2. **`Not saved yet` vs `Saved`.** Aujourd'hui, un backend fraîchement connecté affiche `Saved` (`:118`
   est la branche par défaut de `hasStorage`) **avant qu'aucune écriture n'ait eu lieu**. C'est
   littéralement le contrat qu'on prétend faire respecter, violé au repos.

`Failing` doit dire *« Copad will try again when you next type »* et **pas** *« keeps retrying »* : le second
est faux (§0.3). Corriger aussi `ConnectionDialog.svelte:104`.

### D.2 Régime **Cold** — verrouillé, protecteur

Conditions : `Broken` ∧ `Cold` ∧ branche (a) également tombée. Le document s'ouvre en lecture seule.

Bande haute (tier fort de `SyncBanner`) :

> **EN** — **Copad can't save to your {Dropbox}.** {Your session has expired.} Until it can — or until
> someone joins — the document stays read-only, so it doesn't look saved when it isn't. You can still read,
> copy and export it.
>
> **FR** — *Copad ne peut pas enregistrer dans votre {Dropbox}. {Votre session a expiré.} Tant que ce n'est
> pas rétabli — ou que personne n'arrive — le document reste en lecture seule, pour ne pas paraître
> sauvegardé alors qu'il ne l'est pas. Vous pouvez toujours le lire, le copier et l'exporter.*

Actions : **`Reconnect {Dropbox}`** (primaire) · `Invite someone` · `Export a copy`.

L'action primaire est **`Reconnect`**, pas `Invite`. C'est la seule inversion de hiérarchie par rapport à
`01-contract.md` §B.3 (qui met `Copy invite link` en primaire pour l'état « seul ») — et elle est justifiée :
ici la branche (b) est tombée pour une cause **nommée et réparable en trois secondes**, alors que la branche
(a) dépend d'un tiers.

Phrases de cause `{...}`, une par `WriteFailureKind` :

| Kind | EN |
|---|---|
| `Denied` | *Your session has expired.* / *Copad no longer has permission to write there.* |
| `Missing` | *The file or folder it saves to is gone.* |
| `Rejected` | *Your {Dropbox} refused the file — it may be out of space.* |
| `NoSink` (Local) | *This browser can only read the file you opened, not write back to it.* |
| `Transient` ×N | *Copad hasn't been able to reach {Dropbox}.* |

### D.3 Régime **Warm** — jamais verrouillé, alerte forte

`Broken` ∧ `Warm`. Le document **reste éditable**. Bande haute, ton danger, **non masquable tant que
`Broken`** (exception documentée à `SyncBanner.svelte:71-85` — la bande est masquable partout ailleurs) :

> **EN** — **Nothing has been saved since {14:02}.** {Your Dropbox session has expired.} Your work is still
> here and cached on this device — but it isn't reaching your {Dropbox}. Reconnect to save it.
>
> **FR** — *Rien n'a été enregistré depuis {14:02}. {Votre session Dropbox a expiré.} Votre travail est
> toujours là, en cache sur cet appareil — mais il n'arrive pas jusqu'à votre {Dropbox}. Reconnectez-vous
> pour l'enregistrer.*

Actions : **`Reconnect {Dropbox}`** (primaire) · `Export a copy`.

L'heure `{14:02}` (le `since` de `Broken{since}`) est le détail qui porte : il dit à l'utilisateur
**exactement combien de travail est en jeu**. C'est ce qui rend l'alerte actionnable plutôt qu'anxiogène.

### D.4 Deux défauts de comportement à corriger en même temps

1. **Le toast se répète.** `Editor.svelte:306` émet `toasts.error(...)` à **chaque** `flush` échoué. Avec un
   debounce de 3 s et un utilisateur qui continue de taper, c'est un toast toutes les quelques secondes sur
   un backend cassé. Le toast doit être émis **une fois par transition vers `Broken`/`Failing`**, pas par
   tentative. La bande persistante remplace la répétition.
2. **La bande se ré-affiche à contretemps.** `SyncBanner.svelte:77-84` remet `dismissed = false` quand
   `reason` change. Il faut ajouter un tier `persist-broken` à l'échelle d'escalade (`:69`, `:78`) — et le
   placer **au-dessus** de `alone` : « ton stockage est mort » l'emporte sur « tu es seul ».

### D.5 Ce qui reste actif en lecture seule

Rien à ajouter à `01-contract.md` §B.4, avec deux points spécifiques à la branche (b) :

- **`Export a copy` devient une exigence dure ici aussi** — et pour une raison plus forte que dans le cas
  « seul » : quand le stockage est cassé, l'export est **la seule** issue de durabilité restante. Constat de
  `01-contract.md` §B.5 confirmé indépendamment : aucun bouton d'export n'existe.
- **L'autosave ne doit pas être coupée** en lecture seule (C.3), et un `load()` distant continue de
  déclencher un `flush` (`Editor.svelte:310-314`) — ce qui est exactement ce qui permet à la santé de
  repasser à `Proven` toute seule après une ré-authentification, sans que l'utilisateur ait à taper.

---

## E. Ce que je n'ai pas pu trancher

**E.1 — Une sonde d'écriture à la connexion ?**
`load()` ne peut pas prouver le droit d'écrire (B.6), donc en régime Cold on ne sait *rien* avant la première
frappe — précisément le moment où verrouiller serait le plus utile et le moins coûteux.
*Options* : **(a)** s'en tenir à la falsification par `load()` (ma spec ci-dessus) — honnête, mais un PAT
lecture seule n'est détecté qu'après la première frappe, en régime Warm, donc sans verrou ; **(b)** écrire
réellement le fichier une fois dans `afterConnect()` (`App.svelte:329-336`), ce qui prouve la branche (b) au
moment exact où l'utilisateur la revendique, pour une requête. Coût : ça **crée un fichier dans le cloud de
l'utilisateur avant qu'il ait tapé quoi que ce soit** — décision produit, pas technique ; **(c)** généraliser
`access()` aux cinq backends qui ne l'ont pas (dropbox, pcloud, webdav, github, local) — moins intrusif que
(b), mais `access()` est déclaratif et ne teste pas le chemin d'écriture réel (le `access()` S3 renvoie
`Write` en dur, `s3.ts:252-254`). **Ma préférence : (b), en écrivant le document *courant* et non un fichier
sonde** — mais je ne peux pas trancher un effet visible dans le Drive de quelqu'un.

**E.2 — `Unknown` doit-il pouvoir atteindre `Broken` par série ?**
Ma table B.2 le permet (`Transient` et `Unknown` partagent le compteur). Argument pour : trois échecs
consécutifs inexpliqués *sont* une preuve, quelle que soit la cause. Argument contre : ça viole la règle
« on ne verrouille jamais sur l'ignorance » à la lettre, et jusqu'à ce que les dix adaptateurs soient migrés,
`Unknown` est l'arm **majoritaire** — donc c'est en pratique le chemin de verrouillage principal, avec la
classification la plus faible. *Options* : **(a)** comme spécifié ; **(b)** `Unknown` ne verrouille jamais,
au prix d'aucune protection avant la migration complète ; **(c)** `Unknown` verrouille avec un seuil plus
haut que `Transient`. Je penche pour **(c)** mais c'est un réglage à valider sur du terrain, pas au clavier.

**E.3 — Faut-il un backoff sur `save()` quand la santé est `Broken` ?**
C.3 impose de garder la prop `storage`, donc `flush` continue d'appeler `save()` toutes les 3 s de frappe
vers un backend mort. Sur GitHub, c'est aussi une consommation de quota d'API. Un backoff exponentiel est la
réponse évidente, mais c'est de la machinerie neuve dans un chemin qui n'en a aujourd'hui aucune (§0.3 :
il n'y a même pas de retry). *Options* : **(a)** rien, accepter le bruit ; **(b)** un backoff dans `flush` ;
**(c)** un backoff **et** un vrai retry planifié — ce qui rendrait enfin vraie la phrase déjà affichée à
`ConnectionDialog.svelte:104`. **(c)** est le plus honnête et le plus gros ; hors périmètre de cette spec.

**E.4 — CORS mal configuré est classé `Transient` alors qu'il est permanent.**
Un bucket S3 sans CORS (`s3.ts:22`) et un proxy WebDAV absent produisent un `TypeError` indistinguable d'une
coupure réseau, côté navigateur — c'est une limite du `fetch` de la plateforme, pas du code. Conséquence : le
backend le plus définitivement cassé est classé dans l'arm qui ne verrouille pas. La série (`WRITE_FAIL_STREAK`)
finit par rattraper le cas, mais tardivement. *Options* : **(a)** accepter, la série suffit ; **(b)** faire
distinguer à l'adaptateur un `TypeError` **au tout premier appel** (probablement CORS) d'un `TypeError`
survenu après un succès (probablement réseau) — heuristique, pas une preuve. Pas d'option propre.

**E.5 — Le backend Local hors Chrome/Edge est structurellement `Broken`.**
`local.ts:150-152` ⟹ `NoSink` ⟹ `Broken` dès la première écriture, sur Firefox et Safari, **toujours**.
C'est factuellement exact et c'est tout l'intérêt du contrat. Mais ça revient à déclarer : *« hors Chrome/Edge,
le backend Local ne satisfait pas la branche (b) »* — une affirmation produit qui contredit son propre `blurb`
(`local.ts:104` : « Changes sync in real time and are preserved in the browser's local cache »). *Options* :
**(a)** l'assumer et réécrire le blurb ; **(b)** compter le cache local comme une destination durable et
classer `NoSink` en `Proven` — mais ça ré-ouvre exactement la question `D.1` de `01-contract.md` (le cache
est-il de la durabilité ?), qui n'est pas tranchée. **À trancher après elle, pas avant.**

**E.6 — Un onglet non-leader doit-il se verrouiller quand le leader est `Broken` ?**
Le canal de B.5 le rend *possible* et exact. Reste à savoir si c'est *souhaitable* : deux onglets qui passent
en lecture seule simultanément, dont un que l'utilisateur ne regardait pas, est un événement surprenant. Et le
non-leader ne peut pas se réparer lui-même — le CTA `Reconnect` y agit sur le même `localStorage` partagé,
donc il fonctionne, mais l'utilisateur ne sait pas lequel de ses onglets « possède » le problème. *Options* :
**(a)** verrouiller partout (cohérent) ; **(b)** ne verrouiller que l'onglet leader et afficher au non-leader
une bande *« Saving is failing in another tab »* sans verrou (moins surprenant, mais deux onglets avec deux
contrats). Je n'ai pas d'argument décisif.

**E.7 — Non vérifié, à confirmer à l'implémentation.**
- `dispatchTransaction` (`Editor.svelte:394-399`) ne voit-il *que* des transactions locales, ou `ySyncPlugin`
  y fait-il passer les mises à jour distantes ? Détermine le signal du flip Cold → Warm (B.4).
- Support de `BroadcastChannel` sur les cibles visées (B.5).
- Les codes HTTP marqués **[API]** en A.4 viennent de ma connaissance des fournisseurs, pas de ce repo :
  à confirmer contre un compte réel avant de figer les mappings dans chaque adaptateur.
