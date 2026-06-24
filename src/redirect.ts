import pcloudSdk from 'pcloud-sdk-js';

const params = new URLSearchParams(location.search);
const code = params.get('code');

if (code) {
  // Dropbox PKCE — post the code back to the opener and close.
  window.opener?.postMessage(
    { type: 'oauth-code', code, state: params.get('state') },
    location.origin
  );
  window.close();
} else {
  // pCloud — let the SDK handle the token from the hash.
  // popup() with no args is correct in the redirect-receiver context; types misdeclare its arity.
  // @ts-expect-error
  pcloudSdk.oauth.popup();
}
