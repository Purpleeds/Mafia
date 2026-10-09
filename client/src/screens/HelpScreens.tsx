import type { ReactNode } from "react";
import { Icon } from "../art/icons";
import { AccessibilitySettings } from "../components/AccessibilitySettings";
import { FxSettings } from "../components/FxSettings";
import { PersonalSettings } from "../components/PersonalSettings";
import { SoundButton, SoundPanel } from "../components/SoundControls";
import { HowToPlayContent, RoleGuideContent } from "../components/RulesContent";
import { HOW_TO_PLAY_PATH, ROLE_GUIDE_PATH, goHome, navigate } from "../lib/router";

function HelpPage({ title, other, children }: { title: string; other: { label: string; path: string }; children: ReactNode }) {
  return (
    <div className="screen help-page">
      <div className="help-nav">
        <button type="button" className="btn btn-ghost" onClick={() => (window.history.length > 1 ? window.history.back() : goHome())}>
          <Icon name="back" />
          Back
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(other.path)}>
          {other.label}
          <Icon name="forward" className="icon-after" />
        </button>
        <SoundButton />
      </div>
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}

export function HowToPlayScreen() {
  return (
    <HelpPage title="How to play" other={{ label: "Role guide", path: ROLE_GUIDE_PATH }}>
      <section className="card">
        <HowToPlayContent />
      </section>
      <section className="card" aria-labelledby="display-title">
        <h2 id="display-title" className="card-title">
          Display and sound
        </h2>
        <PersonalSettings />
        <AccessibilitySettings idPrefix="page-a11y" />
        <FxSettings idPrefix="page-fx" />
        <SoundPanel idPrefix="page-sound" />
      </section>
    </HelpPage>
  );
}

export function RoleGuideScreen() {
  return (
    <HelpPage title="Role guide" other={{ label: "How to play", path: HOW_TO_PLAY_PATH }}>
      <RoleGuideContent />
    </HelpPage>
  );
}
