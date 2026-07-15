import { useEffect } from "react";
import { Shell } from "./components/Shell";
import { useSettings } from "./state/settings";
import { watchTheme } from "./design/theme";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ReceiptCenterProvider } from "./features/receipts/ReceiptCenter";

async function applyInterfaceScale(percent: number) {
  try {
    await getCurrentWebview().setZoom(percent / 100);
  } catch {
    // Plain Vite/test environments do not expose a Tauri webview.
  }
}

function AppContent() {
  const { settings, acceptSetting } = useSettings();

  // Keep <html data-theme> in sync with the theme preference. 'auto' tracks the
  // OS scheme live via watchTheme's media-query subscription.
  useEffect(() => watchTheme(settings.theme), [settings.theme]);

  useEffect(() => {
    void applyInterfaceScale(settings.interface_scale);
  }, [settings.interface_scale]);

  return (
    <Shell
      defaultCleanStreak={settings.practice_default_clean_streak}
      onThemeChange={(theme) => {
        acceptSetting("theme", theme);
      }}
      onInterfaceScaleChange={(scale) => {
        acceptSetting("interface_scale", scale);
      }}
      onPracticeDefaultCleanStreakChange={(target) => {
        acceptSetting("practice_default_clean_streak", target);
      }}
    />
  );
}

function App() {
  return (
    <ReceiptCenterProvider>
      <AppContent />
    </ReceiptCenterProvider>
  );
}

export default App;
