# Claude Fable 5 — Final Review: Share Cloak

**Verdict: APPROVED for submission** (final gate, after GPT-5.6 Sol PASS at round 10 — the most-contested plugin of the field)

Pipeline: Grok implemented → GPT-5.6 Sol gated (10 rounds) → Claude final review.

## What I verified independently
- **Protection mechanism is vanish-only (the tribunal contract):** marked windows move to `special:cloak` and the move is verified before protection is claimed; tiled marked windows that can't be losslessly restored are REFUSED rather than "protected" with transparency (the rejected alpha-0 approach is gone). A screencast cannot capture a window that isn't on a visible workspace.
- **Reliable, ownership-safe keybind teardown (r8–r9 blockers):** ownership is matched exactly on `{key, method}` + empty arg, so a user's own binding on a shared combo (e.g. a different `share-cloak` method) is never removed; teardown runs via a DETACHED helper (`compat/unbind-owned.sh`) so it completes even after the component unloads — not async work on a dying Process.
- **No stale distributable:** no archive is git-tracked (test-enforced: "dist tarball is not git-tracked"); the optional packer builds from HEAD with a divergence check.
- **Share detection:** Hyprland's `screencast` socket2 event (no external PipeWire watcher); auto-cloak default-on.
- **Tests:** 67/67 pass off-device (cloak transaction round-trip, workspace-leak guard, mako restore, bind ownership incl. mixed-method regression, packaging invariants).

## Accepted residual (non-blocking, from GPT's warning)
- README's "every marked window moves" sentence slightly overclaims given tiled refusal; honest limitation is documented elsewhere. Clean teardown depends on python3/sh present (documented, non-destructive fallback).

One key makes the desktop safe to share, uncloak restores exactly, and it never damages the user's config. Approved.
