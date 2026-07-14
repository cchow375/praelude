import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { useSettings } from "./state/settings";
import { watchTheme } from "./design/theme";
import { getCurrentWebview } from "@tauri-apps/api/webview";

async function applyInterfaceScale(percent: number) {
  try {
    await getCurrentWebview().setZoom(percent / 100);
  } catch {
    // Plain Vite/test environments do not expose a Tauri webview.
  }
}

function App() {
  const { settings, setSetting } = useSettings();

  // Keep <html data-theme> in sync with the theme preference. 'auto' tracks the
  // OS scheme live via watchTheme's media-query subscription.
  useEffect(() => watchTheme(settings.theme), [settings.theme]);

  useEffect(() => {
    void applyInterfaceScale(settings.interface_scale);
  }, [settings.interface_scale]);

  return (
    <Shell
      onThemeChange={(theme) => setSetting("theme", theme)}
      onInterfaceScaleChange={(scale) => setSetting("interface_scale", scale)}
    />
  );
}

export default App;
