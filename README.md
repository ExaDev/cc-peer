# cc-peer

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/cc-peer) [![npm](https://img.shields.io/npm/v/cc-peer)](https://www.npmjs.com/package/cc-peer) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/cc-peer/ci.yml?branch=main)](https://github.com/ExaDev/cc-peer/actions)

Talk to the Claude Code instances running on your machine, from any Node application: send messages, register as a named peer other sessions can discover and message, receive replies and delivery receipts, and subscribe to idle notifications. Ships a REST facade you can run with `npx cc-peer`.

> **Unofficial.** This SDK speaks Claude Code's local cross-session peer protocol, which was reverse-engineered and verified against Claude Code 2.1.269. It is not affiliated with or endorsed by Anthropic, and the protocol may change without notice between Claude Code releases.

## Why

Claude Code sessions are isolated: each interactive session binds a private Unix socket, and the only first-party way in is another Claude Code session's `SendMessage`. `cc-peer` opens that door to everything else — build tooling, agents in other harnesses, dashboards, shell scripts — with the protocol's own consent model intact (permission-mode attestation, hold-for-review, delivery receipts).

## How it works

- **Discovery**: live sessions publish a registry at `~/.claude/sessions/<pid>.json`; `cc-peer` reads it, verifies each entry's socket and process, and can register itself there so real Claude sessions see it by name in `ListAgents`.
- **Transport**: per-exchange Unix-socket connections carrying two newline-delimited JSON lines (a bearer-token auth line, then the frame), authenticated with per-session key files.
- **Consent**: unattested messages land in the recipient's hold-for-review dialog; attested ones deliver directly. Delivery status comes back as receipts (`held`, `delivered`, `denied`, `expired`, `dropped` with reasons).
- **Idle subscriptions**: ask any session to notify you when it next goes idle (or exits).

The full wire reference for implementing the protocol yourself lives in [docs/PROTOCOL.md](docs/PROTOCOL.md), with machine-readable JSON Schemas published alongside the package (`cc-peer/schemas/*.schema.json`).

## Install

```bash
npm install cc-peer
```

Or run the REST facade with no install:

```bash
npx cc-peer
```

## Usage

```ts
import { CcPeer } from "cc-peer";

const peer = await CcPeer.create({ name: "my-app" });

peer.on("message", (m) => console.log(`${m.fromName ?? m.from}: ${m.body}`));
peer.on("receipt", (r) => console.log(`status: ${r.status}`));

const sessions = await peer.roster();
const first = sessions.find((s) => s.name === "claude");
if (first !== undefined) {
  const { msgId } = await peer.send({ pid: first.pid }, "hello from my app");
  await peer.subscribeIdle({ pid: first.pid });
}
peer.on("idle", (n) => console.log(`session ${n.state}`));

// …later
await peer.stop();
```

Every release is also mirrored to the GitHub Packages registry as `@exadev/cc-peer` (GitHub Packages requires owner-scoped names), and single-executable binaries for every platform/architecture pair ship as release assets.

The REST facade (`npx cc-peer`) serves `GET /sessions`, `POST /messages`, `POST /idle-subscriptions`, `GET /events` (SSE), and a self-describing `GET /openapi.json` on loopback with a bearer token.

## Limitations

- **Same-process constraint**: receipts and idle notices only reach the process that owns the peer's listening socket (the protocol verifies return addresses via kernel peer-pids). Do not split `CcPeer` listening and sending across processes or differently-owned workers.
- **Single machine**: the local protocol is Unix-socket only. Writing to cloud sessions directly is blocked by design (device-attestation-signed events); bridged sessions reachable locally still work via their local mirror.
- **File transfers to Claude sessions** wait on an upstream feature flag (`tengu_send_file`) before Claude-side materialisation activates; peer-to-peer transfers work today.
- Verified against Claude Code 2.1.269; treat every Claude Code upgrade as a potential protocol change.
