// OAuth popup landing page. Handles both flows on the same redirect URL:
//   - Authorization-code (Dropbox): ?code=... → post it back to the opener.
//   - pCloud token flow: handled by the pCloud SDK.
import * as pcloudSdk from "pcloud-sdk-js";

const params = new URLSearchParams(location.search);
const code = params.get("code");

if (code) {
  window.opener?.postMessage(
    { type: "oauth-code", code, state: params.get("state") },
    location.origin,
  );
  window.close();
} else {
  pcloudSdk.oauth.popup();
}
