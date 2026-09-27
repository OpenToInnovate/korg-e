<div align="center">

# Korg-e

**A web cockpit for OpenClaw, built for a household rather than a single operator.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.50.0-0A84FF?style=for-the-badge)](CHANGELOG.md)

</div>

Korg-e is a fork of [Nerve](https://github.com/daggerhashimoto/openclaw-nerve) (MIT). Nerve is a
solid OpenClaw web interface; this fork exists because operating agents for a family raises
requirements Nerve does not address — chiefly **isolation between people**, and **letting agents
from different people talk to each other on purpose** rather than by accident.

Those two problems drove nearly every change in this fork, and they are what the rest of this
document is about.

---

## What this fork adds

### Per-person profiles with hard privacy boundaries

The central addition. A household does not share one account.

Each profile owns an independent set of bots and groups, and the active profile is held in a
cookie so **every** roster response is filtered server-side. The boundaries are enforced rather
than cosmetic:

- **An agent belongs to exactly one profile.** There is no shared ownership, and no "visible to
  both" state.
- **Ownership fails closed.** An agent that no profile owns is reachable only from the default
  profile — never from a family member's. A family profile showing an unowned agent is treated as
  a bug, not a default.
- **Cross-profile reads are refused at the route.** A cross-profile memory read over HTTP returns
  `403 cross_profile_forbidden`, asserted in tests against the real route rather than the library,
  so a future refactor cannot quietly reopen it.
- **The sidebar never renders another profile's agents**, and the open conversation is closed if
  it points at an agent the active profile does not own.

The session list is fetched from the gateway over WebSocket and is therefore *not* profile-scoped
upstream. Korg-e filters those surfaces client-side and fails closed, which is why a roster
endpoint that is briefly unreachable results in an empty list rather than someone else's chats.

### Cross-agent bridges, deliberately

With people isolated, agents on opposite sides sometimes legitimately need to talk — a bot
assisting one person consulting another. A bridge makes that an explicit, revocable, logged
decision rather than ambient cross-talk.

```
POST   /api/bridges          create a bridge
GET    /api/bridges          list bridges for the active profile
POST   /api/bridges/:id/accept   accept (remote profile only)
POST   /api/bridges/:id/revoke   revoke, immediate from either side
POST   /api/bridges/:id/messages send a message
```

Rules the implementation enforces:

- **Dual approval.** Nothing is sent until *both* sides have approved; otherwise
  `403 bridge_not_fully_approved`.
- **Acceptance cannot be self-granted.** The creating profile cannot accept its own bridge
  (`403 bridge_accept_requires_remote_profile`).
- **Pair-scoped.** An agent not listed on the bridge is refused (`403 bridge_pair_forbidden`).
- **Expiry is a real transition**, persisted and logged — not a filter applied at read time.
- **Creating a bridge changes nothing about ownership.** A test asserts no agent changes profile
  and no cross-profile group appears. A bridge is a conversation, never a capability change.
- Every create, accept, send, revoke, and expire is logged.

The bridge code never calls the guard-relaxing paths. It only opens `/messages`.

### Smaller things that matter in daily use

- **Prompt cards** render OpenClaw `secrets` / `ask_user` prompts above the composer instead of
  burying them in the transcript, so a blocking question is something you answer, not something
  you scroll back to find.
- **Working-paws signal** — an activity indicator driven by a shared `useWorkingSignal` hook
  across the chat surface and roster, so you can tell an agent is mid-turn without reading text.
- **Roster sidebar redesign** — collapsible groups above bots, activity sorting, persisted
  collapse state, an explicit unassigned group.
- **Core-update guard** (`server/lib/core-update-guard.ts`) — Korg-e is a UI layer sitting next to
  a live gateway. The guard is a single choke point that blocks this app from performing
  gateway-lifecycle mutations (`update`, `doctor`, `triage`, `gateway install/uninstall`) and from
  writing agent-delegation subtrees, so a bad or malicious agent prompt cannot escalate into
  mutating the engine underneath. The gateway also refuses to be bounced mid-update, because that
  is what produced a real outage during a failed core upgrade.
- **A stable open conversation.** The 30-second session poll no longer re-picks your current
  session. It used to silently move you to another chat whenever the list lagged mid-sentence,
  remounting the composer and losing your draft. Polling should never change where you are.

### Rebrand and design work

Korg-e carries a distinct visual identity: an openbot-style design port (Inter, radius scale,
thin scrollbars, streamdown transcript, tool shimmer, day separators), a dark theme, animated
agent avatars that reflect working state, sub-agent tether elbows, and a login screen with its
own mascot. Model, effort, theme, font, and font-size controls are all hot-reloadable.

---

## Capability snapshot

Inherited from Nerve and still supported:

| Area | Highlights |
|---|---|
| **Agent fleet** | Multiple agents from one control plane, each with its own workspace, subagents, memory, identity, soul, and skills |
| **Interaction** | Streaming chat, markdown, syntax highlighting, diff views, image paste, file previews, voice input, TTS, live transcription |
| **Workspace** | Per-agent file browser, tabbed editor, memory editing, config editing, skills browser |
| **Operations** | Session tree, subagents, cron scheduling, kanban task board, review flow, proposal inbox, model overrides |
| **Observability** | Token usage, cost tracking, context meter, agent logs, event logs |
| **Polish** | Command palette, responsive UI, themes, font family and size controls, mobile-safe input sizing, updater with rollback |

Added by this fork:

| Area | Highlights |
|---|---|
| **Privacy** | Independent per-person profiles, single-owner agents, fail-closed ownership, cross-profile reads refused at the route |
| **Interop** | Cross-agent bridges with dual approval, pair scoping, expiry, and full audit logging |
| **Safety** | Core-update guard preventing UI-layer mutation of the live gateway |
| **Signals** | Working-paws activity indicator, prompt cards for blocking questions, stable open conversation |

---

## Get started

### One command

```bash
curl -fsSL https://raw.githubusercontent.com/OpenToInnovate/korg-e/main/install.sh | bash
```

The installer handles dependencies, clone, build, and then usually hands off into the setup wizard.
Guided access modes include localhost, LAN, Tailscale tailnet IP, and Tailscale Serve.

> **Existing Nerve installs:** operational identifiers are deliberately unchanged — the
> `nerve.service` unit, `~/nerve` install directory, `~/.nerve` state directory, and the
> `NERVE_INSTALL_DIR` variable all keep working. Point your existing checkout at this repository
> and the built-in updater will move you onto Korg-e releases without reinstalling.

### Manual install

```bash
git clone https://github.com/OpenToInnovate/korg-e.git
cd korg-e
npm install
npm run setup
npm run prod
```

### Pick your setup

- **[Local](docs/DEPLOYMENT-A.md)** — Korg-e and the gateway on one machine. *Recommended default.*
- **[Hybrid](docs/DEPLOYMENT-B.md)** — Korg-e local, gateway in the cloud.
- **[Cloud](docs/DEPLOYMENT-C.md)** — Korg-e and gateway in the cloud.

### Updating

```bash
npm run update -- --yes
```

Fetches the latest release, rebuilds, restarts, verifies health, and rolls back automatically on
failure. Releases are tagged `vX.Y.Z`; the updater selects the highest published Korg-e tag.

### Development

```bash
npm run dev          # frontend — Vite on :3080
PORT=3081 npm run dev:server   # backend — explicit split-port dev setup
```

**Requires:** Node.js 22+ and a running OpenClaw gateway.

---

## How it fits with OpenClaw

Korg-e sits in front of the gateway and gives it a richer operating surface in the browser.

```text
Browser ─── Korg-e (:3080) ─── OpenClaw Gateway (:18789)
  │           │
  ├─ WS ──────┤ proxied to gateway
  ├─ SSE ─────┤ file watchers, real-time sync
  └─ REST ────┘ files, memories, TTS, models, profiles, bridges
```

OpenClaw remains the engine. Korg-e gives it a cockpit.

**Frontend:** React 19 · Tailwind CSS 4 · shadcn/ui · Vite 7
**Backend:** Hono 4 on Node.js

## Security

Korg-e binds to `127.0.0.1` by default, so it stays local unless you choose otherwise.

When bound to the network (`HOST=0.0.0.0`), built-in password authentication protects the UI and
its endpoints. Sessions use signed cookies, passwords are stored as hashes, WebSocket upgrades are
authenticated, and trusted connections can use server-side gateway token injection.

Profile isolation is treated as a security boundary throughout, not a display preference. When
reviewing a change that touches profiles, ownership, bridges, or memories, the question to ask is
"can this expose one person's data to another", not "does the UI look right".

For the full threat model and hardening details, see **[docs/SECURITY.md](docs/SECURITY.md)**.

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** — codebase structure and system design
- **[Configuration](docs/CONFIGURATION.md)** — `.env` variables and setup behavior
- **[Deployment Guides](docs/README.md)** — local, hybrid, and cloud setups
- **[Agent Markers](docs/AGENT-MARKERS.md)** — TTS, charts, kanban markers, and rich UI output
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — common issues and fixes
- **[Tailscale Guide](docs/TAILSCALE.md)** — private remote access
- **[Contributing](CONTRIBUTING.md)** — development workflow and pull requests
- **[Changelog](CHANGELOG.md)** — release notes and shipped changes

## Contributing

Issues and pull requests are welcome. Please read **[CONTRIBUTING.md](CONTRIBUTING.md)** first.
Changes touching profiles, ownership, bridges, or memories need tests that fail without them — see
the existing cross-profile assertions for the expected shape.

## Attribution

Korg-e is a derivative work of **[Nerve](https://github.com/daggerhashimoto/openclaw-nerve)**, by
the Nerve contributors, used under the MIT License. The original copyright and permission notice
are retained in [LICENSE](LICENSE); modifications are the work of the Korg-e contributors.

This is an independent project. It is not affiliated with, endorsed by, or supported by the Nerve
project, and issues here should be raised here. The vast majority of the underlying interface —
chat, voice, workspace, sessions, kanban, and the updater — is Nerve's work, and this fork is
indebted to it.

## License

[MIT](LICENSE)
