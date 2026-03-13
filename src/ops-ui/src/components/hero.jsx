import { h } from "preact";
import { useState } from "preact/hooks";

const STORAGE_KEY = "clasper-ops-hero-dismissed";

function getDismissed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistDismissed(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function Hero() {
  const [dismissed, setDismissedState] = useState(getDismissed);

  const dismiss = () => {
    setDismissedState(true);
    persistDismissed(true);
  };

  const showAgain = () => {
    setDismissedState(false);
    persistDismissed(false);
  };

  if (dismissed) {
    return (
      <div class="hero-banner-show-again">
        <button type="button" class="hero-banner-show-again-link" onClick={showAgain}>
          Show Banner
        </button>
      </div>
    );
  }

  return (
    <div class="hero-banner">
      <button
        type="button"
        class="hero-banner-dismiss"
        onClick={dismiss}
        aria-label="Dismiss hero banner"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <div class="hero-banner-bg"></div>
      <div class="hero-banner-orb"></div>
      <div class="hero-banner-grid"></div>
      
      <div class="hero-banner-content">
        <div class="hero-banner-badge">
          <span class="hero-banner-badge-dot"></span>
          <span>Governance Engine Active</span>
        </div>
        
        <h1 class="hero-banner-title">
          The governance authority
          <br />
          <span class="hero-banner-title-accent">for AI execution.</span>
        </h1>
        
        <p class="hero-banner-subtitle">
          Decide what AI is allowed to do — and prove what actually happened.
          <br />
          Enforce policies, trace execution, and generate self-attested evidence.
        </p>
        
        <div class="hero-banner-actions">
          <a href="https://clasper.ai/docs" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-lg btn-glow">
            Read the Documentation
          </a>
          <a href="https://github.com/clasper-ai/clasper-core" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
            </svg>
            Star on GitHub
          </a>
        </div>
      </div>
      
      <div class="hero-banner-visual">
        <div class="hero-shape shape-primary"></div>
        <div class="hero-shape shape-secondary"></div>
      </div>
    </div>
  );
}
