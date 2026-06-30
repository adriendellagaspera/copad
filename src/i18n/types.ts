export enum LocaleCode {
  En = 'en',
  Fr = 'fr',
}

export interface Messages {
  app: {
    nameLabel: string;
    newDoc: string;
    newDocTitle: string;
    share: string;
    shareTitle: string;
    settingsTitle: string;
    bannerNoCollab: (warning: string) => string;
    bannerNoStoragePre: string;
    bannerSettingsLink: string;
    bannerNoStorageMid: string;
    bannerNoStorageBold: string;
    bannerNoStoragePost: string;
  };
  editor: {
    placeholder: string;
    peers: (n: number) => string;
    connectionDetails: string;
    loadError: (label: string, msg: string) => string;
    saveError: (label: string, msg: string) => string;
    localCopiesCleared: string;
    clearedLocalCopies: string;
  };
  toolbar: {
    label: string;
    bold: string;
    italic: string;
    strikethrough: string;
    code: string;
    linkTitle: string;
    linkLabel: string;
    h1: string;
    h2: string;
    h3: string;
    bulletList: string;
    orderedList: string;
    blockquote: string;
    codeBlock: string;
    divider: string;
    dividerLabel: string;
    undo: string;
    undoLabel: string;
    redo: string;
    redoLabel: string;
    copyMd: string;
    copyMdShort: string;
    copied: string;
    copyFailed: string;
  };
  status: {
    offline: string;
    offlineTitle: string;
    connecting: string;
    connectingP2P: string;
    connectingRelay: string;
    saveFailed: string;
    saveFailedTitle: (where: string) => string;
    saving: string;
    savingTitle: (where: string) => string;
    saved: string;
    savedTitle: (where: string) => string;
    noPeers: string;
    noPeersStorageTitle: (where: string) => string;
    synced: string;
    syncedTitle: (where: string) => string;
    noPeersTitle: (transportTitle: string) => string;
    live: string;
    liveTitle: (transportTitle: string) => string;
    p2p: string;
    relay: string;
    p2pTitle: string;
    relayTitle: string;
  };
  share: {
    title: string;
    hint: string;
    hintEncrypted: string;
    hintEncryptedSuffix: string;
    inviteLabel: string;
    copyLink: string;
    viewOnly: string;
    viewOnlyLabel: string;
    viewOnlyCaveat: string;
    viewOnlyCaveat2: string;
    privacy: string;
    encrypted: string;
    encryptedTitle: string;
    envOnlyNote: string;
    secureNote: string;
    secureNote2: string;
    secureNote3: string;
    removeEncryption: string;
    encryptNote: string;
    generateSecureLink: string;
    orRoomPassword: string;
    roomPasswordLabel: string;
    update: string;
    set: string;
    remove: string;
    passwordHelp: string;
    roomId: string;
    secureCreated: string;
    passwordApplied: string;
    passwordRemoved: string;
    encryptionRemoved: string;
    copyManual: string;
    inviteCopied: string;
    viewOnlyCopied: string;
  };
  connection: {
    title: string;
    transport: string;
    p2p: string;
    relay: string;
    signaling: string;
    signalingOk: string;
    signalingKo: string;
    peers: string;
    peerConnections: string;
    relayed: string;
    direct: string;
    negotiating: string;
    noPeers: string;
    turnHelp: string;
    reconnect: string;
    refreshing: string;
  };
  theme: {
    toLight: string;
    toDark: string;
    lightTitle: string;
    darkTitle: string;
  };
  wordcount: {
    characters: (n: number) => string;
    word: string;
    words: string;
  };
  outline: {
    buttonTitle: string;
    contents: string;
    menuLabel: string;
    untitled: string;
  };
  presence: {
    editing: (n: number) => string;
    more: (n: number, names: string) => string;
  };
  infobanner: {
    dismiss: string;
  };
  settings: {
    title: string;
    closeLabel: string;
    lead: string;
    editor: {
      title: string;
      blurb: string;
      language: string;
      langAuto: string;
      langCustom: string;
      langCustomPlaceholder: string;
      langHelp: (lang: string) => string;
      spellcheck: string;
      spellcheckHelp: string;
    };
    cache: {
      title: string;
      on: string;
      off: string;
      blurb: string;
      toggle: string;
      helpPrefix: string;
      helpUnencrypted: string;
      helpSuffix: string;
      clearing: string;
      clear: string;
    };
    turn: {
      title: string;
      blurb: string;
      fallbackToggle: string;
      urlLabel: string;
      urlPlaceholder: string;
      urlHelp: string;
      usernameLabel: string;
      credentialLabel: string;
      apply: string;
    };
    backends: {
      connected: string;
      ready: string;
      needsSetup: string;
      unavailable: string;
      managed: string;
      managedTitle: string;
      noConfigurable: string;
      disconnect: string;
      connecting: string;
      connect: (label: string) => string;
      opening: string;
      openFile: string;
      newFile: string;
      apply: string;
    };
    filename: {
      label: string;
      placeholder: string;
      help: string;
    };
  };
}
