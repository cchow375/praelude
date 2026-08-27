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
    // Fix wave item 12: seed deterministic yesterday/today day-sheet fixtures
    // so carry-forward, plan totals, and pin-from-day-sheet are all
    // QA-able in this interactive harness — the test suite's own
    // `installTauriDevMock()` calls do not opt in, so nothing here changes
    // any test's behavior.
    // Keep the interactive QA harness aligned with the shipped product:
    // Christian asked for the optional Assistant to stay out of the way, so
    // it starts off here just as it does in the native backend. Tests that
    // exercise Assistant surfaces opt in explicitly through the mock seam.
    installTauriDevMock({ seedQaFixtures: true, assistantEnabled: false });
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
