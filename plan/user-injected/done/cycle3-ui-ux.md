# User-injected TODOs — cycle 3 (pending)

These items were injected by the user mid-run between cycle 2 completion and
cycle 3 spawn. They MUST be honored in cycle 3:

1. **Priority: HIGH — Comprehensive UI/UX review (user request, verbatim intent)**
   - "Perform a comprehensive UI/UX review. Use playwright cli and/or agent
     browser skills to verify user interfaces. Please be deep and critical.
     Write the results into `./.context/reviews`."
   - Scope: the entire web app in `apps/web/` — every user-reachable
     route under `src/app/[locale]/` (home, photo viewer `p/[id]`, shared
     groups `g/[key]`, shared links `s/[key]`, admin dashboard + all
     protected sub-pages: images, tags, topics, users, settings, seo,
     sharing, db). Cover both public + authenticated flows, mobile +
     desktop breakpoints, dark/light mode, English + Korean locales.
   - Execution requirements for the designer lane in PROMPT 1:
     - Actually run the app. Either `npm run dev --workspace=apps/web`
       in the background or seed+build. Verify the dev server is live
       before interacting.
     - Use the `playwright` skill and/or the `agent-browser` family
       (`agent-browser-core`, `-interact`, `-query`, `-wait`,
       `-network`, `-visual`, `-debug`, `-state`, `-config`).
     - Do NOT rely only on screenshots (the reviewing model may not be
       multimodal). Capture accessibility snapshots, computed styles,
       DOM structure, ARIA state, keyboard focus order, WCAG 2.2
       contrast numbers, layout box metrics, and describe every
       finding with text-extractable evidence (selectors + values).
     - Cover: information architecture, affordances, focus management
       & keyboard navigation, WCAG 2.2 accessibility (contrast, ARIA,
       focus traps, reduced motion, prefers-color-scheme), responsive
       breakpoints (mobile ~375px, tablet ~768px, desktop ~1280px,
       large ~1920px), loading/empty/error states, form validation
       UX, dark/light mode parity, i18n/RTL behavior for Korean + any
       RTL edge cases, perceived performance (LCP, CLS, INP).
     - Exercise destructive/error flows: failed login, rate-limited
       login, upload failures, restore failures, session expiry,
       network offline.
   - Output: write per-specialist artifacts to `./.context/reviews/`
     with clear filenames (e.g. `designer-ui-ux-deep.md`,
     `designer-a11y-audit.md`, `designer-responsive.md`,
     `designer-admin-flow.md`) AND include the findings in the
     cycle-3 aggregate.
   - Plan rollup: PROMPT 2 must materialize these findings into the
     cycle-3 plan (schedule or deferred ledger — no silent drops).
     PROMPT 3 implements as usual.

Delete this file (or move it to `plan/user-injected/done/`) once cycle 3's
PROMPT 2 has consumed it.
