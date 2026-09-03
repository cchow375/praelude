import { useEffect } from "react";
import { Shell } from "./shell/Shell";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { useSettings } from "./state/settings";
import { applyTheme } from "./design/theme";
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

  // Praelude is dark by default and by design.
  useEffect(() => {
    applyTheme("dark");
  }, []);

  useEffect(() => {
    void applyInterfaceScale(settings.interface_scale);
  }, [settings.interface_scale]);

  return (
    <Shell
      defaultCleanStreak={settings.practice_default_clean_streak}
      settingsContent={
        <SettingsPanel
          onInterfaceScaleSaved={(scale) => {
            void applyInterfaceScale(scale);
          }}
          onPracticeDefaultCleanStreakSaved={(target) => {
            acceptSetting("practice_default_clean_streak", target);
          }}
        />
      }
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
