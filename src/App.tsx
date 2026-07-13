import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { useSettings } from "./state/settings";
import { watchTheme } from "./design/theme";

function App() {
  const { settings, setSetting } = useSettings();

  // Keep <html data-theme> in sync with the theme preference. 'auto' tracks the
  // OS scheme live via watchTheme's media-query subscription.
  useEffect(() => watchTheme(settings.theme), [settings.theme]);

  return <Shell onThemeChange={(theme) => setSetting("theme", theme)} />;
}

export default App;
