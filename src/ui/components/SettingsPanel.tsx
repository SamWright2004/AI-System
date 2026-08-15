import { useEffect, useState, type FormEvent } from "react";
import type { HomeState } from "../../core/chat/types.js";
import type { PersonalisationProfile } from "../../core/settings/types.js";

export function SettingsPanel({
  profile,
  runtime,
  sendOnEnter,
  onSendOnEnterChange,
  onSave,
}: {
  profile: PersonalisationProfile;
  runtime: HomeState["runtime"];
  sendOnEnter: boolean;
  onSendOnEnterChange: (value: boolean) => void;
  onSave: (profile: PersonalisationProfile) => Promise<void>;
}) {
  const [form, setForm] = useState(profile);
  const [tone, setTone] = useState(profile.assistant.tone.join(", "));
  const [instructions, setInstructions] = useState(profile.pinnedInstructions.join("\n"));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setForm(profile);
    setTone(profile.assistant.tone.join(", "));
    setInstructions(profile.pinnedInstructions.join("\n"));
  }, [profile]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("saving");
    setSaveError(null);
    try {
      await onSave({
        ...form,
        assistant: {
          ...form.assistant,
          tone: tone
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        },
        pinnedInstructions: instructions
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1_800);
    } catch (error) {
      setStatus("idle");
      setSaveError(error instanceof Error ? error.message : "The settings could not be saved.");
    }
  }

  return (
    <form className="settings-panel" onSubmit={(event) => void submit(event)}>
      <section className="settings-section">
        <div className="settings-section__heading">
          <span className="eyebrow">Identity</span>
          <p>Private local settings used by both the interface and model context.</p>
        </div>
        <div className="settings-grid">
          <label>
            <span>Your name</span>
            <input
              value={form.owner.displayName}
              onChange={(event) =>
                setForm({
                  ...form,
                  owner: { ...form.owner, displayName: event.target.value },
                })
              }
              maxLength={120}
              placeholder="Sam"
            />
          </label>
          <label>
            <span>Assistant name</span>
            <input
              value={form.assistant.displayName}
              onChange={(event) =>
                setForm({
                  ...form,
                  assistant: { ...form.assistant, displayName: event.target.value },
                })
              }
              maxLength={120}
              placeholder="Local mind"
            />
          </label>
          <label>
            <span>Locale</span>
            <input
              value={form.owner.locale}
              onChange={(event) =>
                setForm({ ...form, owner: { ...form.owner, locale: event.target.value } })
              }
              maxLength={120}
              placeholder="en-GB"
            />
          </label>
          <label>
            <span>Timezone</span>
            <input
              value={form.owner.timezone}
              onChange={(event) =>
                setForm({ ...form, owner: { ...form.owner, timezone: event.target.value } })
              }
              maxLength={120}
              placeholder="Europe/London"
            />
          </label>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-section__heading">
          <span className="eyebrow">Working style</span>
          <p>How the collaborator should think, challenge and present its work.</p>
        </div>
        <label>
          <span>Tone, comma separated</span>
          <input value={tone} onChange={(event) => setTone(event.target.value)} maxLength={960} />
        </label>
        <div className="settings-grid">
          <label>
            <span>Response detail</span>
            <select
              value={form.assistant.responseDetail}
              onChange={(event) =>
                setForm({
                  ...form,
                  assistant: {
                    ...form.assistant,
                    responseDetail: event.target
                      .value as PersonalisationProfile["assistant"]["responseDetail"],
                  },
                })
              }
            >
              <option value="concise">Concise</option>
              <option value="adaptive">Adaptive</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label>
            <span>Initiative</span>
            <select
              value={form.workingStyle.initiative}
              onChange={(event) =>
                setForm({
                  ...form,
                  workingStyle: {
                    ...form.workingStyle,
                    initiative: event.target
                      .value as PersonalisationProfile["workingStyle"]["initiative"],
                  },
                })
              }
            >
              <option value="low">Low</option>
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={form.workingStyle.challengeAssumptions}
            onChange={(event) =>
              setForm({
                ...form,
                workingStyle: {
                  ...form.workingStyle,
                  challengeAssumptions: event.target.checked,
                },
              })
            }
          />
          <span>Challenge weak assumptions</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={form.workingStyle.surfaceUncertainty}
            onChange={(event) =>
              setForm({
                ...form,
                workingStyle: {
                  ...form.workingStyle,
                  surfaceUncertainty: event.target.checked,
                },
              })
            }
          />
          <span>Surface meaningful uncertainty</span>
        </label>
        <label>
          <span>Pinned instructions, one per line</span>
          <textarea
            rows={5}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Keep the resting interface calm."
            maxLength={30_000}
          />
        </label>
      </section>

      <section className="settings-section">
        <div className="settings-section__heading">
          <span className="eyebrow">Interface</span>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={sendOnEnter}
            onChange={(event) => onSendOnEnterChange(event.target.checked)}
          />
          <span>Send with Enter; use Shift+Enter for a new line</span>
        </label>
      </section>

      <section className="runtime-card">
        <span>
          <small>Provider</small>
          {runtime.provider}
        </span>
        <span>
          <small>Model</small>
          {runtime.model}
        </span>
        <span>
          <small>Context budget</small>
          {runtime.contextInputTokenBudget.toLocaleString()} tokens
        </span>
      </section>

      <footer className="settings-footer">
        <span className={saveError ? "settings-footer__error" : ""} role="status">
          {saveError || (status === "saved" ? "Saved locally" : null)}
        </span>
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save settings"}
        </button>
      </footer>
    </form>
  );
}
