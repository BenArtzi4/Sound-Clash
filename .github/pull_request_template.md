<!--
This file goes in the new repo at: .github/pull_request_template.md
GitHub auto-loads it as the description when you open a PR.
-->

## What

<!-- One-paragraph summary of what this PR changes. Focus on user-visible or system-visible effects, not the diff. -->

## Why

<!-- The problem this solves. Link to the issue if there is one (e.g., "Closes #42"). -->

## How

<!-- Brief description of the approach. Especially helpful if the implementation isn't obvious from the diff. Skip if trivial. -->

## Test plan

<!-- Concrete steps a reviewer can run to verify this works. -->

- [ ] Unit tests pass: `pytest` and/or `vitest run`
- [ ] E2E tests pass (if applicable): `npm run test:e2e`
- [ ] Manual test: <describe what you clicked through>

## Docs

<!-- Tick all that apply. If you ticked "needed docs change", make sure the relevant doc is updated in this PR. -->

- [ ] No doc change needed
- [ ] Updated `docs/api-contracts.md` (new/changed endpoint)
- [ ] Updated `docs/data-model.md` (schema change)
- [ ] Updated `docs/rpc-functions.md` (PL/pgSQL function change)
- [ ] Updated `docs/game-rules.md` (gameplay rule)
- [ ] Updated `docs/runbook.md` (new env var, deployment step, alert)
- [ ] Updated `docs/local-development.md` (dev setup change)
- [ ] Updated `README.md`
- [ ] Other: <which>

## Risks & rollout

<!-- Is this a database migration? A breaking API change? Anything that could go wrong on deploy? Skip if low-risk. -->

## Screenshots / recordings

<!-- For UI changes. Drag-and-drop into the PR. -->

---

<sub>By submitting this PR I confirm I've read [CONTRIBUTING.md](../CONTRIBUTING.md) and my changes follow the project conventions.</sub>
