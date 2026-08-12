import pcloudSdk from 'pcloud-sdk-js';

const params = new URLSearchParams(location.search);
const code = params.get('code');

if (code) {
  // A `code` param means Dropbox PKCE; pCloud returns its token in the hash instead.
  window.opener?.postMessage(
    { type: 'oauth-code', code, state: params.get('state') },
    location.origin
  );
  window.close();
} else {
  // popup() takes no args in the redirect-receiver context; the SDK's types misdeclare its arity.
  // @ts-expect-error
  pcloudSdk.oauth.popup();
}
