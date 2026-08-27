import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReceipts } from "../receipts/ReceiptCenter";
import { ASSISTANT, HISTORY } from "../../shell/terms";
import { Button, Disclosure } from "../../ui";
import type { CommandInvoker } from "../../services/command";
import { BrainConnection } from "./BrainConnection";
import { BooksPanel, type BooksApi } from "./BooksPanel";
import { resetDockLayout } from "../dock/dockState";
import { hotkeyLabel } from "../rep/useVerdictHotkeys";
import { acceptCommittedSettings } from "../../state/settings";
import { TTS_DEGRADED_LABEL, useTtsDegraded } from "../voice/useTtsDegraded";
import { QUIET_SPEECH_NOTE } from "../voice/HeardPill";
import {
  AppearanceIcon,
  AssistantIcon,
  BooksIcon,
  CalendarIcon,
  FolderIcon,
  GuideIcon,
  LadderIcon,
  MetronomeSectionIcon,
  TagIcon,
  VoiceIcon,
} from "./SettingsIcons";
import "./settings.css";

type Provider = "claude" | "gemini";
const DEFAULT_KNOWLEDGE_DIR =
  "/Users/c3/Desktop/christian's universe/Piano Practice/Knowledge and Resources";

interface ApiKeyStatus {
  provider: Provider;
  configured: boolean;
  source: "keychain" | "environment" | "none";
}
interface VerdictAliases {
  clean: string[];
  flawed: string[];
  failed: string[];
}

export interface SettingsSnapshot {
  theme: "auto" | "dark" | "light";
  interface_scale: number;
  tts_provider: "auto" | "gemini" | "say";
  tts_voice: string;
  brain_provider: "auto" | "claude" | "gemini" | "offline";
  knowledge_dir: string;
  share_retrieved_knowledge: boolean;
  assistant_enabled: boolean;
  wake_word_enabled: boolean;
  wake_word: string;
  speak_acks: boolean;
  stt_settle_ms: number;
  metronome_sound: string;
  metronome_boost: boolean;
  metronome_boost_level: number;
  ladder_default_reps: number;
  practice_default_clean_streak: number;
  ladder_bpm_step: number;
  calendar_capacity_minutes: number;
  streak_threshold_minutes: number;
  vault_pieces_dir: string;
  hotkeys_enabled: boolean;
  hotkey_verdict_clean: string;
  hotkey_verdict_sloppy: string;
  hotkey_verdict_again: string;
  /** Tempo-ladder "punishment": sloppy-only automatic step-down. */
  demote_enabled: boolean;
  /** Consecutive sloppy attempts before the first demotion (2–10). */
  demote_first: number;
  /** Consecutive sloppy attempts before later demotions (1–10). */
  demote_repeat: number;
  verdict_aliases: VerdictAliases;
  api_keys: ApiKeyStatus[];
}

export interface SettingsApi {
  snapshot: () => Promise<SettingsSnapshot>;
  update: (
    patch: Partial<Omit<SettingsSnapshot, "api_keys">>,
  ) => Promise<SettingsSnapshot>;
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
  onInterfaceScaleSaved,
  onPracticeDefaultCleanStreakSaved,
  api = defaultApi,
  brainInvoker,
  booksApi,
}: {
  onInterfaceScaleSaved?: (scale: number) => void;
  onPracticeDefaultCleanStreakSaved?: (target: number) => void;
  api?: SettingsApi;
  brainInvoker?: CommandInvoker;
  booksApi?: BooksApi;
}) {
  const receipts = useReceipts();
  // Live state, not a setting: the cloud voice is on cooldown and utterances are
  // coming from the macOS voice. Clears itself when the cloud voice recovers.
  const ttsDegraded = useTtsDegraded();
  const [value, setValue] = useState<SettingsSnapshot | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aliasDrafts, setAliasDrafts] = useState({
    clean: "",
    flawed: "",
    failed: "",
  });

  useEffect(() => {
    let active = true;
    api
      .snapshot()
      .then((next) => {
        if (active) {
          const normalized = {
            ...next,
            theme: "dark" as const,
            interface_scale: Number.isFinite(next.interface_scale)
              ? next.interface_scale
              : 90,
            knowledge_dir: next.knowledge_dir || DEFAULT_KNOWLEDGE_DIR,
            share_retrieved_knowledge: next.share_retrieved_knowledge ?? true,
            hotkeys_enabled: next.hotkeys_enabled ?? true,
            hotkey_verdict_clean: next.hotkey_verdict_clean || "Space",
            hotkey_verdict_sloppy: next.hotkey_verdict_sloppy || "ShiftRight",
            hotkey_verdict_again: next.hotkey_verdict_again || "Enter",
            assistant_enabled: next.assistant_enabled ?? false,
            speak_acks: next.speak_acks ?? false,
            stt_settle_ms:
              Number.isInteger(next.stt_settle_ms) &&
              next.stt_settle_ms >= 300 &&
              next.stt_settle_ms <= 2000
                ? next.stt_settle_ms
                : 600,
            demote_enabled: next.demote_enabled ?? true,
            demote_first:
              Number.isInteger(next.demote_first) &&
              next.demote_first >= 2 &&
              next.demote_first <= 10
                ? next.demote_first
                : 3,
            demote_repeat:
              Number.isInteger(next.demote_repeat) &&
              next.demote_repeat >= 1 &&
              next.demote_repeat <= 10
                ? next.demote_repeat
                : 2,
            practice_default_clean_streak:
              Number.isInteger(next.practice_default_clean_streak) &&
              next.practice_default_clean_streak >= 1 &&
              next.practice_default_clean_streak <= 100
                ? next.practice_default_clean_streak
                : 5,
          };
          setValue(normalized);
          setAliasDrafts(aliasStrings(normalized.verdict_aliases));
        }
      })
      .catch((cause) => {
        if (active) setError(errorMessage(cause));
      });
    return () => {
      active = false;
    };
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
        interface_scale: value.interface_scale,
        tts_provider: value.tts_provider,
        tts_voice: value.tts_voice,
        brain_provider: value.brain_provider,
        knowledge_dir: value.knowledge_dir,
        share_retrieved_knowledge: value.share_retrieved_knowledge,
        assistant_enabled: value.assistant_enabled,
        wake_word_enabled: value.wake_word_enabled,
        wake_word: value.wake_word,
        speak_acks: value.speak_acks,
        stt_settle_ms: value.stt_settle_ms,
        metronome_sound: value.metronome_sound,
        metronome_boost: value.metronome_boost,
        metronome_boost_level: value.metronome_boost_level,
        practice_default_clean_streak: value.practice_default_clean_streak,
        ladder_bpm_step: value.ladder_bpm_step,
        calendar_capacity_minutes: value.calendar_capacity_minutes,
        streak_threshold_minutes: value.streak_threshold_minutes,
        vault_pieces_dir: value.vault_pieces_dir,
        hotkeys_enabled: value.hotkeys_enabled,
        hotkey_verdict_clean: value.hotkey_verdict_clean,
        hotkey_verdict_sloppy: value.hotkey_verdict_sloppy,
        hotkey_verdict_again: value.hotkey_verdict_again,
        demote_enabled: value.demote_enabled,
        demote_first: value.demote_first,
        demote_repeat: value.demote_repeat,
        verdict_aliases: {
          clean: parseAliases(aliasDrafts.clean),
          flawed: parseAliases(aliasDrafts.flawed),
          failed: parseAliases(aliasDrafts.failed),
        },
      });
      // The Rep HUD is mounted outside the Settings workspace and must adopt
      // committed hotkey changes without being torn down or reloaded.
      acceptCommittedSettings(next);
      setValue(next);
      setAliasDrafts(aliasStrings(next.verdict_aliases));
      onInterfaceScaleSaved?.(next.interface_scale);
      onPracticeDefaultCleanStreakSaved?.(next.practice_default_clean_streak);
      setMessage("Settings saved. Settle delay applies now; provider changes apply after relaunch.");
      receipts.committed("Settings saved.");
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      receipts.error(cause, message);
    } finally {
      setSaving(false);
    }
  };

  if (!value) {
    return (
      <div className="settings">
        <p role={error ? "alert" : "status"}>{error ?? "Loading settings…"}</p>
      </div>
    );
  }

  return (
    <form className="settings" aria-label="CodaKiller settings" onSubmit={save}>
      <header className="settings-head">
        <h2>Settings</h2>
        <div className="settings-head-actions">
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </header>
      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="settings-success" role="status">
          {message}
        </p>
      )}

      <Disclosure
        summary={
          <SectionLabel icon={<GuideIcon />}>
            How to use CodaKiller
          </SectionLabel>
        }
        defaultOpen
      >
        <section
          className="settings-guide"
          aria-labelledby="settings-guide-title"
        >
          <div className="settings-guide-intro">
            <p className="settings-guide-kicker">Start here</p>
            <h3 id="settings-guide-title">
              {value.assistant_enabled
                ? "One practice loop, two voice lanes"
                : "One hands-free practice loop"}
            </h3>
            {value.assistant_enabled ? (
              <p>
                Use short, exact commands for immediate practice control. Use
                the {ASSISTANT} for plain-English questions, screen-grounded
                help, and reviewable action drafts.
              </p>
            ) : (
              <p>
                Use short, exact commands to control practice without leaving
                the piano. You report each attempt; CodaKiller counts, times,
                and remembers it without grading the piano.
              </p>
            )}
          </div>

          <ol className="settings-guide-flow" aria-label="Golden practice flow">
            <li>
              <strong>Choose the music.</strong>
              <span>
                Select the piece and section in Score, then start a practice set
                from Score or Today. With a section selected, you can say{" "}
                <q>
                  I want to do dotted rhythms five times on the right hand at 80
                </q>
                . A page alone is not guessed into measures.
              </span>
            </li>
            <li>
              <strong>Report each attempt.</strong>
              <span>
                While the set is open, say <q>done</q> for clean, <q>sloppy</q>{" "}
                for flawed, or <q>again, missed the left-hand jump</q> for
                failed with a saved note. CodaKiller does not grade the piano.
              </span>
            </li>
            <li>
              <strong>Check, correct, finish.</strong>
              <span>
                Watch the HUD and heard-command toast. Say <q>where are we</q>{" "}
                for status, <q>close the block</q> when the set is done, and use{" "}
                {HISTORY} if an attempt needs correction.
              </span>
            </li>
          </ol>

          <div
            className={`settings-guide-lanes${
              value.assistant_enabled ? "" : " is-single"
            }`}
          >
            <section aria-labelledby="settings-guide-instant">
              <h4 id="settings-guide-instant">Instant commands</h4>
              <p>
                Exact commands run immediately and offline. They do not wait for
                confirmation, so check the toast or receipt if speech was
                misheard.
              </p>
              <dl className="settings-guide-commands">
                <div>
                  <dt>
                    <q>metronome 96</q>
                  </dt>
                  <dd>Start at 96 BPM</dd>
                </div>
                <div>
                  <dt>
                    <q>tempo 104</q>
                  </dt>
                  <dd>Set the running tempo</dd>
                </div>
                <div>
                  <dt>
                    <q>bump it up 4</q>
                  </dt>
                  <dd>Raise the tempo by 4 BPM</dd>
                </div>
                <div>
                  <dt>
                    <q>metronome off</q>
                  </dt>
                  <dd>Stop the metronome</dd>
                </div>
              </dl>
              <p className="settings-guide-note">
                Wake-word mode is {value.wake_word_enabled ? "on" : "off"}.
                {value.wake_word_enabled
                  ? ` Begin commands with “${value.wake_word.trim() || "your wake word"}”.`
                  : " Say exact commands without a wake word."}
              </p>
            </section>

            {value.assistant_enabled && (
              <section aria-labelledby="settings-guide-brain">
                <h4 id="settings-guide-brain">Plain-English {ASSISTANT}</h4>
                <p>
                  Type in the {ASSISTANT}, or ask an assistant-directed question
                  such as <q>Can you tell me what happened last session?</q>{" "}
                  without a wake phrase. The {ASSISTANT} receives the selected
                  Score piece, Region, page, edition, active set, and today's
                  written plan, plus grounded practice history and cited
                  references.
                </p>
                <p className="settings-guide-note">
                  The {ASSISTANT} may draft a verdict, tempo change, undo, or
                  streak restart. Coda reads the draft back; say <q>confirm</q>{" "}
                  or <q>cancel</q>. It still cannot hear or grade playing,
                  interpret a page without a selected section, or manage
                  Calendar and Goals by voice yet.
                </p>
              </section>
            )}
          </div>

          {value.assistant_enabled && (
            <aside
              className="settings-guide-safety"
              aria-label="Confirmation safety"
            >
              <strong>Before anything ambiguous changes</strong>
              <p>
                If CodaKiller shows a draft or confirmation card, review every
                field and choose or say Confirm or Cancel; nothing on that card
                runs first. Exact commands above are different: they run
                immediately. In a noisy room, use the HUD or Metronome button
                instead of repeating a command you are unsure it heard.
              </p>
            </aside>
          )}
        </section>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<AssistantIcon />}>{ASSISTANT}</SectionLabel>
        }
        defaultOpen
      >
        <div className="settings-group">
          <label className="settings-check settings-wide">
            <input
              type="checkbox"
              aria-label={ASSISTANT}
              checked={value.assistant_enabled}
              onChange={(event) =>
                setValue({
                  ...value,
                  assistant_enabled: event.target.checked,
                })
              }
            />
            <span>
              <strong>{ASSISTANT}</strong>
              <small>
                Answer open questions using an AI model. Off by default; the
                deterministic voice commands, metronome and rep tracking never
                use it.
              </small>
            </span>
          </label>
          {value.assistant_enabled && (
            <>
              <BrainConnection invoker={brainInvoker} />
              <Row label={`${ASSISTANT} provider`}>
                <select
                  aria-label={`${ASSISTANT} provider`}
                  value={value.brain_provider}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      brain_provider: event.target
                        .value as SettingsSnapshot["brain_provider"],
                    })
                  }
                >
                  <option value="auto">Auto (Claude → Gemini → offline)</option>
                  <option value="claude">Prefer Claude</option>
                  <option value="gemini">Gemini only</option>
                  <option value="offline">Offline library only</option>
                </select>
              </Row>
              <Row label="Knowledge folder" wide>
                <input
                  aria-label="Knowledge folder"
                  value={value.knowledge_dir}
                  onChange={(event) =>
                    setValue({ ...value, knowledge_dir: event.target.value })
                  }
                />
              </Row>
              <label className="settings-check settings-wide">
                <input
                  type="checkbox"
                  checked={value.share_retrieved_knowledge}
                  onChange={(event) =>
                    setValue({
                      ...value,
                      share_retrieved_knowledge: event.target.checked,
                    })
                  }
                />
                <span>
                  <strong>Share retrieved knowledge with Claude/Gemini</strong>
                  <small>
                    Only the retrieved passages, your question, and selected
                    practice facts may be sent. The full folder is never
                    uploaded.
                  </small>
                </span>
              </label>
              <div className="settings-keys" aria-label="API keys">
                {(["claude", "gemini"] as Provider[]).map((provider) => (
                  <KeyControl
                    key={provider}
                    provider={provider}
                    status={value.api_keys.find(
                      (item) => item.provider === provider,
                    )!}
                    api={api}
                    onStatus={(status) =>
                      setValue({
                        ...value,
                        api_keys: value.api_keys.map((item) =>
                          item.provider === provider ? status : item,
                        ),
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </Disclosure>

      {value.assistant_enabled && (
        <Disclosure
          summary={<SectionLabel icon={<BooksIcon />}>Books</SectionLabel>}
        >
          <BooksPanel {...(booksApi ? { api: booksApi } : {})} />
        </Disclosure>
      )}

      <Disclosure
        summary={
          <SectionLabel icon={<VoiceIcon />}>
            Voice &amp; wake-word
          </SectionLabel>
        }
      >
        <div className="settings-group">
          {ttsDegraded && (
            <p className="settings-pill" role="status">
              <span className="settings-pill-dot" aria-hidden="true" />
              {TTS_DEGRADED_LABEL}
            </p>
          )}
          {/* The honest limit (v6 S9). There is no sensitivity dial to offer:
              recognition happens inside the macOS speech engine, and the app
              only ever receives finished text. What it CAN do is show that
              text, which is what the heard pill does. Saying so here is
              cheaper than letting Christian hunt for a setting that cannot
              exist. */}
          <p className="settings-note">{QUIET_SPEECH_NOTE}</p>
          <NumberField
            label="Voice settle delay (ms)"
            value={value.stt_settle_ms}
            min={300}
            max={2000}
            onChange={(stt_settle_ms) => setValue({ ...value, stt_settle_ms })}
          />
          <p className="settings-note settings-wide">
            Lower is more responsive; too low can split a command at a short
            pause. Bare verdict words still wait for this safe finalization gap.
          </p>
          <label className="settings-check settings-wide">
            <input
              type="checkbox"
              checked={value.speak_acks}
              onChange={(event) =>
                setValue({ ...value, speak_acks: event.target.checked })
              }
            />
            <span>
              <strong>Speak confirmations aloud</strong>
              <small>
                Off: the app plays the short ack chime instead of talking.
              </small>
            </span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={value.wake_word_enabled}
              onChange={(event) =>
                setValue({ ...value, wake_word_enabled: event.target.checked })
              }
            />
            <span>Require wake word for commands</span>
          </label>
          <Row label="Wake word">
            <input
              aria-label="Wake word"
              value={value.wake_word}
              disabled={!value.wake_word_enabled}
              maxLength={24}
              onChange={(event) =>
                setValue({ ...value, wake_word: event.target.value })
              }
            />
          </Row>
          <Row label="Coach voice">
            <select
              aria-label="Coach voice"
              value={value.tts_voice}
              onChange={(event) =>
                setValue({ ...value, tts_voice: event.target.value })
              }
            >
              {[
                "Kore",
                "Puck",
                "Charon",
                "Fenrir",
                "Aoede",
                "Leda",
                "Orus",
                "Zephyr",
              ].map((voice) => (
                <option key={voice}>{voice}</option>
              ))}
            </select>
          </Row>
          <Row label="Speech provider">
            <select
              aria-label="Speech provider"
              value={value.tts_provider}
              onChange={(event) =>
                setValue({
                  ...value,
                  tts_provider: event.target
                    .value as SettingsSnapshot["tts_provider"],
                })
              }
            >
              <option value="auto">Auto (Gemini → Mac)</option>
              <option value="gemini">Gemini</option>
              <option value="say">Mac system voice</option>
            </select>
          </Row>
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<MetronomeSectionIcon />}>Metronome</SectionLabel>
        }
      >
        <div className="settings-group">
          <Row label="Click sound">
            <select
              aria-label="Default click sound"
              value={value.metronome_sound}
              onChange={(event) =>
                setValue({ ...value, metronome_sound: event.target.value })
              }
            >
              {["woodblock", "tick", "clave", "rim", "cowbell", "beep"].map(
                (sound) => (
                  <option key={sound}>{sound}</option>
                ),
              )}
            </select>
          </Row>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={value.metronome_boost}
              onChange={(event) =>
                setValue({ ...value, metronome_boost: event.target.checked })
              }
            />
            <span>Boost Mac volume while clicking</span>
          </label>
          <NumberField
            label="Boost level"
            value={value.metronome_boost_level}
            min={0}
            max={100}
            onChange={(metronome_boost_level) =>
              setValue({ ...value, metronome_boost_level })
            }
          />
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<LadderIcon />}>Ladder defaults</SectionLabel>
        }
      >
        <div className="settings-group">
          <p className="settings-note">
            Mastery uses consecutive clean attempts. Choose any optional attempt
            review boundary separately when you start a set.
          </p>
          <NumberField
            label="Default clean streak"
            value={value.practice_default_clean_streak}
            min={1}
            max={100}
            onChange={(practice_default_clean_streak) =>
              setValue({ ...value, practice_default_clean_streak })
            }
          />
          <NumberField
            label="BPM step"
            value={value.ladder_bpm_step}
            min={1}
            max={24}
            onChange={(ladder_bpm_step) =>
              setValue({ ...value, ladder_bpm_step })
            }
          />
          <label className="settings-check settings-wide">
            <input
              type="checkbox"
              aria-label="Automatically lower tempo after sloppy reps"
              checked={value.demote_enabled}
              onChange={(event) =>
                setValue({ ...value, demote_enabled: event.target.checked })
              }
            />
            <span>
              <strong>Lower tempo after repeated sloppy reps</strong>
              <small>
                Counts Sloppy only. Again neither counts nor clears the sloppy
                run; a Clean clears it. The tempo never drops below the set's
                starting BPM.
              </small>
            </span>
          </label>
          <NumberField
            label="First demotion after sloppy reps"
            value={value.demote_first}
            min={2}
            max={10}
            disabled={!value.demote_enabled}
            onChange={(demote_first) =>
              setValue({ ...value, demote_first })
            }
          />
          <NumberField
            label="Later demotions after sloppy reps"
            value={value.demote_repeat}
            min={1}
            max={10}
            disabled={!value.demote_enabled}
            onChange={(demote_repeat) =>
              setValue({ ...value, demote_repeat })
            }
          />
        </div>
      </Disclosure>

      {/* A6. Christian practises at a real piano: reaching for the mouse to
          record every rep is the friction this removes. The mapping is
          remappable here, and the HUD teaches it on its own line. */}
      <Disclosure
        summary={
          <SectionLabel icon={<TagIcon />}>Verdict hotkeys</SectionLabel>
        }
        defaultOpen
      >
        <div className="settings-group">
          <label className="settings-check settings-wide">
            <input
              type="checkbox"
              aria-label="Verdict hotkeys"
              checked={value.hotkeys_enabled}
              onChange={(event) =>
                setValue({ ...value, hotkeys_enabled: event.target.checked })
              }
            />
            <span>
              <strong>Record verdicts from the keyboard</strong>
              <small>
                During an active set, one key logs one rep so your hands never
                leave the piano. Ignored while you are typing an attempt note or
                a dialog is open.
              </small>
            </span>
          </label>
          <KeyBindingField
            label="Clean hotkey"
            code={value.hotkey_verdict_clean}
            disabled={!value.hotkeys_enabled}
            onChange={(hotkey_verdict_clean) =>
              setValue({ ...value, hotkey_verdict_clean })
            }
          />
          <KeyBindingField
            label="Sloppy hotkey"
            code={value.hotkey_verdict_sloppy}
            disabled={!value.hotkeys_enabled}
            onChange={(hotkey_verdict_sloppy) =>
              setValue({ ...value, hotkey_verdict_sloppy })
            }
          />
          <KeyBindingField
            label="Again hotkey"
            code={value.hotkey_verdict_again}
            disabled={!value.hotkeys_enabled}
            onChange={(hotkey_verdict_again) =>
              setValue({ ...value, hotkey_verdict_again })
            }
          />
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<CalendarIcon />}>Calendar capacity</SectionLabel>
        }
      >
        <div className="settings-group">
          <NumberField
            label="Calendar capacity"
            value={value.calendar_capacity_minutes}
            min={1}
            max={1440}
            onChange={(calendar_capacity_minutes) =>
              setValue({ ...value, calendar_capacity_minutes })
            }
          />
          <NumberField
            label="Streak threshold (minutes)"
            value={value.streak_threshold_minutes}
            min={1}
            max={240}
            onChange={(streak_threshold_minutes) =>
              setValue({ ...value, streak_threshold_minutes })
            }
          />
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<FolderIcon />}>Vault directory</SectionLabel>
        }
      >
        <div className="settings-group">
          <Row label="Pieces folder" wide>
            <input
              aria-label="Pieces folder"
              value={value.vault_pieces_dir}
              onChange={(event) =>
                setValue({ ...value, vault_pieces_dir: event.target.value })
              }
            />
          </Row>
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<TagIcon />}>Verdict aliases</SectionLabel>
        }
      >
        <div className="settings-group">
          <AliasField
            label="Clean verdict aliases"
            value={aliasDrafts.clean}
            onChange={(clean) => setAliasDrafts({ ...aliasDrafts, clean })}
          />
          <AliasField
            label="Flawed verdict aliases"
            value={aliasDrafts.flawed}
            onChange={(flawed) => setAliasDrafts({ ...aliasDrafts, flawed })}
          />
          <AliasField
            label="Failed verdict aliases"
            value={aliasDrafts.failed}
            onChange={(failed) => setAliasDrafts({ ...aliasDrafts, failed })}
          />
        </div>
      </Disclosure>

      <Disclosure
        summary={
          <SectionLabel icon={<AppearanceIcon />}>Appearance</SectionLabel>
        }
      >
        <div className="settings-group">
          <p className="settings-note">
            CodaKiller uses its dark practice-room interface.
          </p>
          <label className="settings-scale">
            <span>
              Interface scale <strong>{value.interface_scale}%</strong>
            </span>
            <input
              aria-label="Interface scale"
              type="range"
              min="75"
              max="125"
              step="5"
              value={value.interface_scale}
              onChange={(event) =>
                setValue({
                  ...value,
                  interface_scale: Number(event.target.value),
                })
              }
            />
          </label>
          {/* Real-use fix wave (item 4): the dock's freely-draggable panels
              have no other recovery path for "I dragged this somewhere
              silly" or "this got stuck minimized" — a plain button, not a
              nested <form>, per the removal of BooksPanel's nested form. */}
          <div className="settings-row">
            <span>Floating panels</span>
            <Button type="button" onClick={() => resetDockLayout()}>
              Reset panel layout
            </Button>
          </div>
        </div>
      </Disclosure>
    </form>
  );
}

function SectionLabel({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="settings-section-label">
      <span className="settings-section-icon" aria-hidden="true">
        {icon}
      </span>
      {children}
    </span>
  );
}

function Row({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`settings-row${wide ? " settings-wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * Remap one verdict hotkey by pressing the key you want. The stored value is
 * `KeyboardEvent.code`, never `key` — `key` reads "Shift" for BOTH shift keys,
 * so only `code` can tell Right-Shift from Left-Shift.
 */
function KeyBindingField({
  label,
  code,
  disabled,
  onChange,
}: {
  label: string;
  code: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const [listening, setListening] = useState(false);
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        type="text"
        aria-label={label}
        readOnly
        disabled={disabled}
        value={listening ? "Press any key…" : hotkeyLabel(code)}
        onFocus={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={(event) => {
          // Tab must still move focus out; Escape abandons the remap.
          if (event.key === "Tab") return;
          event.preventDefault();
          if (event.key === "Escape") {
            event.currentTarget.blur();
            return;
          }
          if (!/^[A-Za-z0-9]{1,24}$/.test(event.code)) return;
          onChange(event.code);
          setListening(false);
        }}
      />
    </label>
  );
}

function AliasField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="settings-row">
      <span>{label}</span>
      <input
        aria-label={label}
        placeholder="comma separated"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function KeyControl({
  provider,
  status,
  api,
  onStatus,
}: {
  provider: Provider;
  status: ApiKeyStatus;
  api: SettingsApi;
  onStatus: (status: ApiKeyStatus) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = provider === "claude" ? "Claude" : "Gemini";
  const save = async () => {
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    const secret = key;
    setKey("");
    try {
      onStatus(await api.saveKey(provider, secret));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const clear = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.clearKey(provider));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label={`${label} API key`}>
      <header>
        <strong>{label}</strong>
        <span className={status.configured ? "is-configured" : ""}>
          {status.configured
            ? `Configured (${status.source})`
            : "Not configured"}
        </span>
      </header>
      <label>
        <span className="sr-only">New {label} API key</span>
        <input
          type="password"
          aria-label={`New ${label} API key`}
          autoComplete="off"
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <div className="settings-key-actions">
        <Button
          variant="text"
          type="button"
          disabled={busy || !key.trim()}
          onClick={() => void save()}
        >
          Save key
        </Button>
        <Button
          variant="text"
          type="button"
          disabled={busy || !status.configured}
          onClick={() => void clear()}
        >
          Clear
        </Button>
      </div>
      {error && (
        <p className="ck-inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function errorMessage(cause: unknown) {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  if (
    cause != null &&
    typeof cause === "object" &&
    typeof (cause as { message?: unknown }).message === "string"
  )
    return (cause as { message: string }).message;
  return "Settings could not be updated.";
}
function parseAliases(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
function aliasStrings(value: VerdictAliases) {
  return {
    clean: value.clean.join(", "),
    flawed: value.flawed.join(", "),
    failed: value.failed.join(", "),
  };
}
