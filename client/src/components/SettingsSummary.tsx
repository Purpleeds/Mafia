import { OPTIONAL_ROLES, type GameSettings } from "@mafia/shared";
import { Icon } from "../art/icons";
import { MODE_INFO } from "../lib/copy";
import { fill, tieRuleLabel, wordsFor } from "../lib/wording";
import { formatSeconds } from "../lib/labels";
import { OPTIONAL_ROLE_INFO, TIMER_KEYS, TIMER_LABEL, mafiaCountLabel } from "../lib/settings";

/** Read-only settings for everyone who isn't the host. */
export function SettingsSummary({ settings, playerCount }: { settings: GameSettings; playerCount: number }) {
  const extras = OPTIONAL_ROLES.filter((r) => settings.optionalRoles[r]).map((r) => OPTIONAL_ROLE_INFO[r].label);
  return (
    <section className="card" aria-labelledby="summary-title">
      <h2 id="summary-title" className="card-title">
        Game settings
      </h2>
      <dl className="summary">
        <div>
          <dt>Mode</dt>
          <dd>
            <Icon name={MODE_INFO[settings.contentMode].icon} size={16} />{" "}
            {settings.contentMode === "safe" ? "Safe (family-friendly)" : "Normal (crime drama)"}
          </dd>
        </div>
        <div>
          <dt>{fill("{gang}", settings)}</dt>
          <dd>{mafiaCountLabel(settings.mafiaCount, playerCount)}</dd>
        </div>
        <div>
          <dt>Extra roles</dt>
          <dd>{extras.length > 0 ? extras.join(", ") : "None"}</dd>
        </div>
        <div>
          <dt>Tied vote</dt>
          <dd>{tieRuleLabel(settings.tieRule, settings)}</dd>
        </div>
        <div>
          <dt>{wordsFor(settings).revealSummary}</dt>
          <dd>{settings.revealRoleOnDeath ? "Revealed" : "Kept secret"}</dd>
        </div>
        <div>
          <dt>Chat filter</dt>
          <dd>{settings.contentMode === "safe" ? "On (always in Safe Mode)" : settings.profanityFilter ? "On" : "Off"}</dd>
        </div>
        <div>
          <dt>AI narrator</dt>
          <dd>{settings.aiNarrator ? "On (the host's AI writes the news)" : "Off (ready-made narration)"}</dd>
        </div>
        <div>
          <dt>Doctor saves</dt>
          <dd>{settings.announceSaves ? "Announced (without saying who)" : "Kept secret"}</dd>
        </div>
        <div>
          <dt>Votes</dt>
          <dd>{settings.showVotes ? "Everyone sees who voted for whom" : "Only the counts are shown"}</dd>
        </div>
        <div>
          <dt>Timers</dt>
          <dd>{TIMER_KEYS.map((k) => `${TIMER_LABEL[k]} ${formatSeconds(settings.timers[k])}`).join(" · ")}</dd>
        </div>
      </dl>
    </section>
  );
}
