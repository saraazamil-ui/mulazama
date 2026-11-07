# MULAZAMA cloud development

- Use `https://github.com/saraazamil-ui/mulazama` and its current `main` as the source of truth. A prepared cloud checkout can be stale.
- Start a new task from a clean tree with `python3 scripts/cloud-start08a.py --branch codex/<unique-task>`. It fetches main without force, verifies the approved 06-L4 ancestor, and preserves existing branches. Do not reset or discard existing work to make the check pass.
- Work on a separate branch. Open a pull request; never push directly to main, merge, enable auto-merge, or deploy without explicit owner authorization.
- Do not rewrite Git history, change Quran source bytes, reinterpret learner events, or change FSRS behavior as part of environment maintenance.
- Keep `productionReady=false` and G01–G10 blocked until the separate scientific and engineering approvals are complete. Passing tests is not content or launch approval.
- Use `python3 scripts/verify-08a.py` to verify a committed snapshot without overwriting historical delivery evidence. In this cloud image, explicitly select `/usr/bin/chromium` with `MULAZAMA_CHROMIUM_EXECUTABLE_PATH`; GitHub CI retains the pinned Playwright browser.
- Report failed, skipped, blocked and unrun checks separately. Never weaken assertions or hide failures to obtain a green result.
- This file is agent guidance, not enforced GitHub branch protection. Reusable cloud environment publication and owner approval remain separate steps; see `docs/08a/Cloud-Readiness.md`.
