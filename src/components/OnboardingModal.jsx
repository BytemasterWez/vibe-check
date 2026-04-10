import { useExperienceMode } from './ExperienceModeContext';

export default function OnboardingModal() {
  const { selectMode } = useExperienceMode();

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        <div className="onboarding-icon">👁</div>
        <h1>Welcome to Vibe Check</h1>
        <p className="onboarding-subtitle">
          Watch your AI codebase grow in real time.
        </p>

        <p className="onboarding-question">
          How experienced are you with code?
        </p>

        <div className="onboarding-options">
          <button
            className="onboarding-option"
            onClick={() => selectMode('simple')}
          >
            <div className="option-title">Simple View</div>
            <div className="option-desc">
              Plain English summaries. Tells you what happened, whether to worry,
              and what to ask the AI next.
            </div>
            <div className="option-tag recommended">Recommended for vibe coders</div>
          </button>

          <button
            className="onboarding-option"
            onClick={() => selectMode('builder')}
          >
            <div className="option-title">Builder View</div>
            <div className="option-desc">
              Full technical detail. Import counts, diffs, export analysis,
              and raw metrics.
            </div>
            <div className="option-tag">For experienced developers</div>
          </button>
        </div>

        <p className="onboarding-footnote">
          You can switch between views anytime in the toolbar.
        </p>
      </div>
    </div>
  );
}
