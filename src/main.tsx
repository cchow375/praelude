import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { applyTheme, getSystemTheme } from "./design/theme";

// Apply a concrete theme before first paint to avoid a flash. The real
// preference-driven sync happens in <App> once settings load; 'auto' is the
// safe default and matches the OS scheme immediately.
applyTheme(getSystemTheme());

async function bootstrap() {
  // DEV-ONLY: a flag-gated, backend-free render harness for visual/design
  // review (`npm run dev:mock`). The import is dynamic and behind this static
  // guard, so with the flag OFF the mock module is never fetched or executed —
  // a normal `vite` dev run and the real Tauri app are byte-for-byte unaffected.
  if (import.meta.env.VITE_DEV_MOCK) {
    const { installTauriDevMock } = await import("./devMock/tauriDevMock");
    installTauriDevMock();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
