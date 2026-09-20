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

Every release is also mirrored to the GitHub Packages registry as `@exadev/cc-peer` (GitHub Packages requires owner-scoped names), and single-executable binaries ship as release assets for every platform/architecture pair Node's own SEA feature supports (see Limitations for the one exception).

The REST facade (`npx cc-peer`) serves `GET /sessions`, `POST /messages`, `POST /idle-subscriptions`, `GET /events` (SSE), and a self-describing `GET /openapi.json` on loopback with a bearer token.

### Session discovery and reply aliases

`CcPeer.roster()` already lists every live local Claude Code session, not just ones `cc-peer` itself registered — the registry it reads (`~/.claude/sessions/*.json`) is written by every interactive session on startup. A relay/front application that wants to discover every session to attach to needs nothing beyond `roster()`.

Giving a relayed session a name it can reply to natively for each of several correspondents is a different problem: the registry is one file per real OS pid with a single name each, so one process can only ever publish one discoverable name at a time (see [docs/PROTOCOL.md](docs/PROTOCOL.md#session-enumeration-and-reply-aliases-for-a-relayfront-building-on-this-sdk) for the empirical detail). `AliasPool`, exported from `cc-peer/alias-pool`, is the mechanism for this: it lazily forks one lightweight `CcPeer`-backed child process per correspondent name, and relays whatever that alias receives back to the parent.

```ts
import { AliasPool } from "cc-peer/alias-pool";

const aliases = AliasPool.create();

aliases.on("message", (m) => {
  // m.alias is the correspondent name the relayed session replied to;
  // forward m.body to that correspondent's own channel.
  console.log(`reply for ${m.alias}: ${m.body}`);
});

// Whenever a new correspondent messages the relayed session for the first
// time, give it a reply-able name (idempotent; a no-op if already active).
await aliases.ensure("alice");

// Deliver alice's message to the relayed session from alice's own alias
// (starting it if needed), so the session sees alice as the sender and its
// own reply-to-sender comes back on the "message" handler above rather than
// to the relay. Rejects if the alias cannot start, or if it cannot send.
const { msgId } = await aliases.send("alice", { pid: relayedSessionPid }, "ping");

// …later, once a correspondent is no longer relevant:
await aliases.retire("alice");
await aliases.stopAll();
```

Sending from the alias rather than from the relay's own peer is what makes a relayed session's natural reply reach the right correspondent: a session replies to whoever sent it a message, so a message delivered from the relay comes back to the relay with nothing to say which correspondent it answers.

## Limitations

- **Same-process constraint**: receipts and idle notices only reach the process that owns the peer's listening socket (the protocol verifies return addresses via kernel peer-pids). Do not split `CcPeer` listening and sending across processes or differently-owned workers.
- **Single machine**: the local protocol is Unix-socket only. Writing to cloud sessions directly is blocked by design (device-attestation-signed events); bridged sessions reachable locally still work via their local mirror.
- **Windows uses a named pipe, not a Unix socket**: Node's `net` module has no real AF_UNIX support on Windows (its local domain there is a named pipe, under `\\.\pipe\`, not an arbitrary filesystem path — [nodejs/node#55979](https://github.com/nodejs/node/issues/55979)), and Claude Code's own docs confirm it uses exactly that on native Windows. `cc-peer` branches to a named pipe there automatically; nothing to configure. Windows also requires a valid, matching auth line on every inbound connection (macOS and Linux tolerate an absent or foreign one). The exact `procStart` string format `cc-peer` computes on Windows is its own convention (PowerShell's process start time, ISO-8601) rather than a confirmed match for a real native-Windows Claude Code session's own registry entries, which is not publicly documented.
- **No single-executable binary for Intel macOS**: Node's own SEA feature doesn't support macOS x64 at all (its docs state plainly, under Platform Support, "macOS (arm64 only; x64 is not currently supported and is skipped in the tests)"; [nodejs/node#62893](https://github.com/nodejs/node/issues/62893) tracks the same crash). This is a gap in Node's own runtime, not in `cc-peer` — the regular npm package (and `npx cc-peer`) works fine on Intel macOS; only the standalone binary can't be built for it.
- **File transfers to Claude sessions** wait on an upstream feature flag (`tengu_send_file`) before Claude-side materialisation activates; peer-to-peer transfers work today.
- Verified against Claude Code 2.1.269; treat every Claude Code upgrade as a potential protocol change.
