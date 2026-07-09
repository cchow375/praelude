import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./App.css";
import { applyTheme, getSystemTheme } from "./design/theme";

// Apply a concrete theme before first paint to avoid a flash. The real
// preference-driven sync happens in <App> once settings load; 'auto' is the
// safe default and matches the OS scheme immediately.
applyTheme(getSystemTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
