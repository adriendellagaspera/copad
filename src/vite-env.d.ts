/// <reference types="vite/client" />

declare module 'pcloud-sdk-js' {
  interface OAuthCallbacks {
    (token: string, locationid?: number): void;
  }
  interface Sdk {
    oauth: {
      popup(
        clientId: string,
        onSuccess: OAuthCallbacks,
        onError?: (err: unknown) => void
      ): void;
    };
  }
  const sdk: Sdk;
  export default sdk;
}
