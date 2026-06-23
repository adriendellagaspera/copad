import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

// Note: no <StrictMode> here on purpose. Its dev-only double-mount would make the
// y-webrtc provider connect, destroy, and reconnect, which spams warnings.
createRoot(document.getElementById("root")!).render(<App />);
