import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SettingsPanel.css";

type Provider = "claude" | "gemini";

interface ApiKeyStatus { provider: Provider; configured: boolean; source: "keychain" | "environment" | "none" }
interface VerdictAliases { clean: string[]; flawed: string[]; failed: string[] }

export interface SettingsSnapshot {
  theme: "auto" | "dark" | "light";
  tts_provider: "auto" | "gemini" | "say";
  tts_voice: string;
  brain_provider: "auto" | "claude" | "gemini" | "offline";
  wake_word_enabled: boolean;
  wake_word: string;
  metronome_sound: string;
  metronome_boost: boolean;
  metronome_boost_level: number;
  ladder_default_reps: number;
  ladder_bpm_step: number;
  calendar_capacity_minutes: number;
  vault_pieces_dir: string;
  verdict_aliases: VerdictAliases;
  api_keys: ApiKeyStatus[];
}

export interface SettingsApi {
  snapshot: () => Promise<SettingsSnapshot>;
  update: (patch: Partial<Omit<SettingsSnapshot, "api_keys">>) => Promise<SettingsSnapshot>;
  saveKey: (provider: Provider, key: string) => Promise<ApiKeyStatus>;
  clearKey: (provider: Provider) => Promise<ApiKeyStatus>;
}

const defaultApi: SettingsApi = {
  snapshot: () => invoke("settings_snapshot"),
  update: (patch) => invoke("settings_update", { patch }),
  saveKey: (provider, key) => invoke("api_key_save", { provider, key }),
  clearKey: (provider) => invoke("api_key_clear", { provider }),
};

export function SettingsPanel({
  onResetLayout,
  onThemeSaved,
  api = defaultApi,
}: {
  onResetLayout: () => void;
  onThemeSaved?: (theme: "auto" | "dark" | "light") => void;
  api?: SettingsApi;
}) {
  const [value, setValue] = useState<SettingsSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.snapshot().then((next) => { if (active) setValue(next); }).catch((cause) => {
      if (active) setError(errorMessage(cause));
    });
    return () => { active = false; };
  }, [api]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!value || saving) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.update({
        theme: value.theme,
        tts_provider: value.tts_provider,
        tts_voice: value.tts_voice,
        brain_provider: value.brain_provider,
        wake_word_enabled: value.wake_word_enabled,
        wake_word: value.wake_word,
        metronome_sound: value.metronome_sound,
        metronome_boost: value.metronome_boost,
        metronome_boost_level: value.metronome_boost_level,
        ladder_default_reps: value.ladder_default_reps,
        ladder_bpm_step: value.ladder_bpm_step,
        calendar_capacity_minutes: value.calendar_capacity_minutes,
        vault_pieces_dir: value.vault_pieces_dir,
        verdict_aliases: value.verdict_aliases,
      });
      setValue(next);
      onThemeSaved?.(next.theme);
      setMessage("Settings saved. Voice/provider changes apply after relaunch.");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  if (!value) {
    return <div className="deep-settings"><p role={error ? "alert" : "status"}>{error ?? "Loading settings…"}</p></div>;
  }

  return (
    <form className="deep-settings" aria-label="CodaKiller settings" onSubmit={save}>
      <header><div><p className="settings-eyebrow">Settings</p><h2>Make the defaults yours.</h2></div><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button></header>
      {error && <p className="ck-inline-error" role="alert">{error}</p>}
      {message && <p className="settings-success" role="status">{message}</p>}

      <fieldset><legend>Appearance</legend>
        <label><span>Theme</span><select aria-label="Theme" value={value.theme} onChange={(event) => setValue({ ...value, theme: event.target.value as SettingsSnapshot["theme"] })}><option value="auto">Follow Mac</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <button type="button" className="settings-secondary" onClick={onResetLayout}>Reset panel layout</button>
      </fieldset>

      <fieldset><legend>Voice + Brain</legend>
        <label className="settings-check"><input type="checkbox" checked={value.wake_word_enabled} onChange={(event) => setValue({ ...value, wake_word_enabled: event.target.checked })} /><span>Require wake word for commands</span></label>
        <label><span>Wake word</span><input aria-label="Wake word" value={value.wake_word} disabled={!value.wake_word_enabled} maxLength={24} onChange={(event) => setValue({ ...value, wake_word: event.target.value })} /></label>
        <label><span>Coach voice</span><select aria-label="Coach voice" value={value.tts_voice} onChange={(event) => setValue({ ...value, tts_voice: event.target.value })}>{["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"].map((voice) => <option key={voice}>{voice}</option>)}</select></label>
        <label><span>Speech provider</span><select aria-label="Speech provider" value={value.tts_provider} onChange={(event) => setValue({ ...value, tts_provider: event.target.value as SettingsSnapshot["tts_provider"] })}><option value="auto">Auto (Gemini → Mac)</option><option value="gemini">Gemini</option><option value="say">Mac system voice</option></select></label>
        <label><span>Brain provider</span><select aria-label="Brain provider" value={value.brain_provider} onChange={(event) => setValue({ ...value, brain_provider: event.target.value as SettingsSnapshot["brain_provider"] })}><option value="auto">Auto (Claude → Gemini → offline)</option><option value="claude">Prefer Claude</option><option value="gemini">Gemini only</option><option value="offline">Offline library only</option></select></label>
        <AliasField label="Clean verdict aliases" value={value.verdict_aliases.clean} onChange={(clean) => setValue({ ...value, verdict_aliases: { ...value.verdict_aliases, clean } })} />
        <AliasField label="Flawed verdict aliases" value={value.verdict_aliases.flawed} onChange={(flawed) => setValue({ ...value, verdict_aliases: { ...value.verdict_aliases, flawed } })} />
        <AliasField label="Failed verdict aliases" value={value.verdict_aliases.failed} onChange={(failed) => setValue({ ...value, verdict_aliases: { ...value.verdict_aliases, failed } })} />
        <div className="settings-keys" aria-label="API keys">{(["claude", "gemini"] as Provider[]).map((provider) => <KeyControl key={provider} provider={provider} status={value.api_keys.find((item) => item.provider === provider)!} api={api} onStatus={(status) => setValue({ ...value, api_keys: value.api_keys.map((item) => item.provider === provider ? status : item) })} />)}</div>
      </fieldset>

      <fieldset><legend>Practice defaults</legend>
        <label className="settings-wide"><span>Pieces folder</span><input aria-label="Pieces folder" value={value.vault_pieces_dir} onChange={(event) => setValue({ ...value, vault_pieces_dir: event.target.value })} /></label>
        <label><span>Click sound</span><select aria-label="Default click sound" value={value.metronome_sound} onChange={(event) => setValue({ ...value, metronome_sound: event.target.value })}>{["woodblock", "tick", "clave", "rim", "cowbell", "beep"].map((sound) => <option key={sound}>{sound}</option>)}</select></label>
        <label className="settings-check"><input type="checkbox" checked={value.metronome_boost} onChange={(event) => setValue({ ...value, metronome_boost: event.target.checked })} /><span>Boost Mac volume while clicking</span></label>
        <NumberField label="Boost level" value={value.metronome_boost_level} min={0} max={100} onChange={(metronome_boost_level) => setValue({ ...value, metronome_boost_level })} />
        <NumberField label="Default reps" value={value.ladder_default_reps} min={1} max={240} onChange={(ladder_default_reps) => setValue({ ...value, ladder_default_reps })} />
        <NumberField label="BPM step" value={value.ladder_bpm_step} min={1} max={24} onChange={(ladder_bpm_step) => setValue({ ...value, ladder_bpm_step })} />
        <NumberField label="Calendar capacity" value={value.calendar_capacity_minutes} min={1} max={1440} onChange={(calendar_capacity_minutes) => setValue({ ...value, calendar_capacity_minutes })} />
      </fieldset>
    </form>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return <label><span>{label}</span><input type="number" aria-label={label} value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function AliasField({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) {
  const [draft, setDraft] = useState(value.join(", "));
  return <label><span>{label}</span><input aria-label={label} placeholder="comma separated" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => onChange(parseAliases(draft))} /></label>;
}

function KeyControl({ provider, status, api, onStatus }: { provider: Provider; status: ApiKeyStatus; api: SettingsApi; onStatus: (status: ApiKeyStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = provider === "claude" ? "Claude" : "Gemini";
  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true); setError(null);
    const secret = key;
    setKey("");
    try { onStatus(await api.saveKey(provider, secret)); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  const clear = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { onStatus(await api.clearKey(provider)); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return <section aria-label={`${label} API key`}><header><strong>{label}</strong><span className={status.configured ? "is-configured" : ""}>{status.configured ? `Configured (${status.source})` : "Not configured"}</span></header><label><span className="sr-only">New {label} API key</span><input type="password" aria-label={`New ${label} API key`} autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} /></label><div><button type="button" disabled={busy || !key.trim()} onClick={() => void save()}>Save key</button><button type="button" disabled={busy || !status.configured} onClick={() => void clear()}>Clear</button></div>{error && <p className="ck-inline-error" role="alert">{error}</p>}</section>;
}

function errorMessage(cause: unknown) { if (typeof cause === "string") return cause; if (cause instanceof Error) return cause.message; return "Settings could not be updated."; }
function parseAliases(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
