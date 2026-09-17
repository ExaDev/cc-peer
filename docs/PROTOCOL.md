# cc-peer protocol reference

This document is the implement-it-yourself reference for Claude Code's local cross-session peer messaging, reverse-engineered and live-verified against Claude Code 2.1.269 by the cc-peer project. Machine-readable companions ship with the package (`cc-peer/schemas/*.schema.json`, JSON Schema draft 2020-12, generated from the same Zod definitions the SDK uses).

Unofficial and unaffiliated with Anthropic; the protocol may change without notice between Claude Code releases.

# Claude Code — Cross-Session Messaging UDS Protocol

How `SendMessage` / `ListAgents` peer messaging actually travels between Claude Code processes: a per-session Unix domain socket with a file-backed bearer token, newline-delimited JSON framing, a permission-attestation consent model, and a receipted reverse channel — plus a cloud bridge leg for off-machine delivery. Reverse-engineered from the 2.1.269 binary and verified end to end with hand-rolled raw-socket clients (no harness tools): fresh Claude sessions received, held, and replied to injected messages; a standalone Python process registered as a named peer and exchanged messages, receipts, and subscriptions with real sessions.

The consent design parallels agent-comms (ExaDev's cross-harness mesh; its consent design parallels this protocol)' six-obligation room-token work: credential-gated transport, kernel peer-pid verification, permission-mode attestation, hold-for-review, and return-address verification.

## Transport and identity

- Each interactive session binds `/tmp/cc-socks/<pid>.sock` (Unix socket, same-uid peers only). The registry entry `~/.claude/sessions/<pid>.json` records `messagingSocketPath`, `sessionId`, `bridgeSessionId`, `peerProtocol`, `peerFeatures` (`notify_idle`, `reply_across_default_dirs`, `artifact_yield`), name, status, and `procStart`.
- On startup the session writes a key file `~/.claude/sessions/<pid>.<hash>.key` (mode 0600) where `<hash>` is `sha256` of the canonical socket path. Content: `{"peerToken":"<32 hex>","procStart":"...","pidDomain":"darwin"}`. A second in-process token, the `childToken`, is exported to subprocesses via `CLAUDE_CODE_MESSAGING_TOKEN` (with `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_CHILD_SESSION=1`) — the inbox's startup banner documents the official injection recipe: `echo '{"type":"auth","token":"'$CLAUDE_CODE_MESSAGING_TOKEN'"}'; echo '{"type":"user",...}' | socat - UNIX-CONNECT:$CLAUDE_CODE_MESSAGING_SOCKET`.
- Sender-side vetting (`Pe` in the uds-client chunk): the target's key file is read, its owning pid checked alive with a matching proc-start token (recycled-pid defence), and optionally the connected peer's pid/uid read from the kernel. A live socket with no vouching key is refused on platforms where auth is mandatory; on macOS auth is optional, and an unrecognised token degrades to the unauthenticated path rather than being rejected.
- Address schemes (`Jf`): `uds:<path>`, `bridge:<id>`, `did:<x>` (reserved — parsed as raw passthrough, no local resolution in 2.1.269), bare `*.sock` paths, and Windows named pipes.

## Wire protocol

One connection, one write, then close (~150 ms linger on macOS). Two newline-terminated JSON lines: auth, then the frame. Nothing is ever acknowledged on the same connection — delivery surfaces in the receiver's conversation, and status travels back as separate receipt connections.

**Line 1, auth** — the target's own `peerToken` (peer-class) or `childToken` (child-class):

```json
{"type":"auth","token":"<peerToken or childToken>"}
```

**Line 2, user message** (`hnt`):

```json
{
  "msgV": 1,
  "msg_id": "<uuid v4>",
  "type": "user",
  "message": {"role": "user", "content": "<cross-session-message envelope, below>"},
  "priority": "next",
  "from": "uds:/tmp/cc-socks/<sender pid>.sock",
  "file_attachments": [{"path": "...", "file_name": "...", "file_size": 0, "sha256": "...", "media_type": "..."}]
}
```

- `"type":"user"` is load-bearing: any other type value is silently dropped after auth, with the connection left open and no error — a wrong type is indistinguishable from a delivery that never happened.
- `msgV` is exactly `1` in genuine traffic and not strictly validated (`2` and absent both deliver). `msg_id` is a `randomUUID()`. `priority` is `"next"` on the SendMessage path; `"later"` is accepted identically. A `session_id` field, when present, must match the receiver's session id or the frame is silently dropped (no hold, no receipt, no trace).
- Control frames share the connection shape with `"type":"control"` plus an `action` field — see Receipts and Idle subscriptions.

## The envelope

`message.content` must be the tag-wrapped envelope built by `uGe`/`zfe` and round-trip-checked by `HB`:

```
<cross-session-message from="uds:..." from-session="..." hop-chain="..." from-name="..." from-mode="...">BODY</cross-session-message>
```

- Attribute **order is canonical and load-bearing**: `from, from-session, hop-chain, from-name, from-mode`. The parser regex matches that sequence only; a wrong order or an invalid attribute value fails the parse, the round-trip rebuild fails, and the entire envelope is treated as an opaque unattested body (held, raw tags shown in the preview).
- Grammar: `from` charset `[A-Za-z0-9%:_/.\-]`, max 300; `from-session` `[A-Za-z0-9_-]{1,80}`; `hop-chain` comma-joined 24-hex ids, max 32 entries at the grammar level; `from-name` free-ish text with `"` `<` `>` stripped and lookalikes normalised, max 80; `from-mode` one of the permission-mode enum (`bypass`, `prompting`, ...). Body: literal text, one newline inside each tag; occurrences of the closing tag are escaped to `<\`.

## Consent: holds, attestation, and the self-sent verdict

An unattested envelope arriving at a session that bypasses permission prompts is **held for human approval** ("The sender did not attest its permission mode and this session bypasses prompts"), with a Deny/Deliver dialog; `crossSessionInbound: accept` bypasses the hold. The setting's default (unset) is mode-parity: auto-deliver only on bypass↔bypass or prompting↔prompting; unattested senders are held only while the receiver bypasses.

The self-sent verdict (`ye`) short-circuits the hold entirely. A message is self-sent when the connecting process's **ancestry includes the target pid**, or it presents the target's **childToken** with no contrary evidence (macOS walks `ps` ancestry; the childToken sits in every subprocess env, which is precisely the supported injection path). Verified live: an unattested frame with the session's own childToken delivered straight into the sending session's conversation mid-turn; a *foreign* childToken grants nothing — it falls to the ordinary hold. So child parity is strictly per-parent.

## Registering a standalone peer and name discovery

A standalone process becomes a first-class peer with three artifacts, all self-writable:

1. Bind `/tmp/cc-socks/<pid>.sock`.
2. Write the key file with a self-generated `peerToken`.
3. Write the registry entry `<pid>.json` with `messagingSocketPath`, `name`, `status`, `peerFeatures`, and a correct `procStart`.

**`procStart` must byte-match `LC_ALL=C TZ=UTC ps -o lstart= -p <pid>` output** — the exact command Claude's own generators use, compared as a plain string. Two traps: macOS `ps` formats `lstart` per the locale (bare `ps` under en_GB emits day-before-month; `LC_ALL=C` emits ctime order), and the value is UTC, not local. A mismatch classifies the pid as `recycled` and the roster silently skips the entry. Store the forced-locale/UTC command's output verbatim.

The roster builder (`listLivePeerSessions`) reads all `~/.claude/sessions/<pid>.json` files — no daemon involvement; the filesystem is authoritative — and includes an entry when it has a `sock`, is not the caller's own, is not spare/parked, its socket accepts a live connect probe, and its pid is `present` (alive with matching `procStart`; `gone` entries are swept, `recycled` skipped). `nameSource` and `status` are whitelisted on read; out-of-list values parse harmlessly to undefined.

Verified chain: a Python peer registered this way appears in `ListAgents` within seconds and receives native `SendMessage` by bare name (`from-name` resolves from the sender's own registry entry).

### Session enumeration and reply aliases (for a relay/front building on this SDK)

Two capabilities a message relay ("front") needs from this protocol, gated on what it actually supports rather than assumed:

- **Session enumeration** — listing every live local Claude Code session, not just ones the relay itself registered — is already fully native. The roster builder above reads every `~/.claude/sessions/<pid>.json` file on disk, regardless of who wrote it; `cc-peer`'s own `CcPeer.roster()` (and the REST facade's `GET /sessions`) is exactly this roster builder, so a relay gets full session discovery for free, with no separate mechanism needed.
- **Reply aliases** — giving each correspondent that messages a relayed session its own natively-`SendMessage`-reachable name, so the session can reply to it directly by name — is **not** natively supported for more than one name per process. The registry is one file per real OS pid (`registryFilePath`: `<pid>.json`) and each entry carries a single optional `name` field; a process publishing a second name overwrites, rather than adds to, its own entry. This is directly observable in this SDK's own test suite: two `CcPeer` instances sharing one pid (unavoidable — both are the same OS process) leave only the last-registered name visible in the roster, because both wrote to the identical `<pid>.json` file. Native name resolution (`ListAgents`/`SendMessage(name=X)`) walks the registry directory exactly as it is on disk — it has no concept of "this one process answers to several names."

The practical consequence: a relay that wants N correspondents to each get their own reply-able name needs N distinct, genuinely live OS processes — one real pid, one registry file, one name, per correspondent — not a lighter-weight in-process mapping. `cc-peer`'s own `AliasPool` (see the root README) implements exactly this: it lazily forks one lightweight child process per correspondent name, each running an ordinary `CcPeer` instance under that name, and relays whatever the relayed session replies with back to the parent process for translation into whatever channel the correspondent actually lives on.

## Receipts and status

`peer_message_status` is pushed from receiver to sender over a fresh connection to the sender's socket, authenticated with the sender's own peerToken:

```json
{"type":"control","action":"peer_message_status","status":"held","reason":"<human-readable>","from":"uds:/tmp/cc-socks/<receiver>.sock","orig_msg_id":"<the send's msg_id>","msgV":1,"msg_id":"<receipt's own id>"}
```

All statuses verified on the wire:

| Status | When | Extra fields |
|---|---|---|
| `held` | unattested message entered the approval dialog | — |
| `delivered` | hold approved and released | — |
| `denied` | hold denied | — |
| `expired` | hold unapproved past TTL (~25 min; pending holds expire together) | `status_detail:"refused"` when the receiver refuses inbound |
| `dropped` | rejected at inbox admission | `drop_reason`, `dropped_msg_ids` |

Clean fire-and-forget delivery pushes no receipt — receipts exist for holds and failures.

Drop reasons (drop taxonomy): `duplicate` (same sender + same body hash within `dedupWindowMs` 30 s — **not** msg_id; identical msg_id with different bodies both deliver), `rate-limited` (token bucket below), `hop-loop` and `hop-runaway` (hop-chain guards below), `queue-full` (undelivered-queue cap). Verified live: `duplicate`, `rate-limited` (35-message burst against the 30-token bucket), `hop-runaway` (29-entry chain), `hop-loop` (12× target-own token). `queue-full` was attempted with 55 admitted messages queued behind a hold modal and did not fire — the effective cap is dynamically raised above the 50 code default (`tengu_harbor_kite_limits`, zod range 10-5000); it is the one code-verified variant, with a receipt frame identical to its captured siblings.

## Idle subscriptions

Subscribe: `{"type":"control","action":"notify_when_idle","from":"uds:...","from_mode":"bypass","msgV":1,"msg_id":"<uuid>"}`. The notice returns correlated by `orig_msg_id` = the subscription's `msg_id`:

```json
{"type":"control","action":"peer_idle_notice","orig_msg_id":"...","state":"idle","finished_at":1789216922033,"detail":"<preview of the target's last reply>","from":"uds:...","from_mode":"bypass","msgV":1,"msg_id":"..."}
```

`state` is `idle` (verified: fires immediately if the target is already idle) or `exited` (verified: fires on session shutdown, including a kill). `finished_at` is epoch-ms of the target's last turn end.

## Guard rails and admission semantics

Peer-guard defaults (`tengu_harbor_kite_limits`-overridable): `bucketCapacity:30, refillPerSecond:0.5, dedupWindowMs:30000, maxSelfHops:10, maxChainLength:28, maxTrackedSenders:256`.

**Return-address verification** — the load-bearing reverse-channel rule: the receiver records the kernel-reported peer pid of each inbound connection and pushes receipts/notices only if the claimed `from` socket is owned by that same live process. Messages from a throwaway client claiming another peer's address deliver fine but receive nothing back ("unvettable reply target"). A standalone peer must send from the process that binds its socket. (Trap: macOS Python launchers — Homebrew and Xcode `Python.app` shims — fork before exec; the surviving process owns the socket and must be the sender.)

**Hop tokens** — `ownUdsHopToken = HMAC-SHA256(key = randomBytes(32) at process init, msg = "uds:<canonical socket path>").hex().slice(0,24)`: per-boot ephemeral, not externally computable. The loop-detection self-token set also covers the bridge address and a bridge-identity id. The loop guard fires at ≥ `maxSelfHops` (10) occurrences of a self-token — a single occurrence is harmless and delivers. Outbound replies to peer-origin messages stamp `i_e(own address)` into the chain, so a target's token is **mintable** by asking it to reply once and reading the chain it emits; a 12×-token chain then triggers `hop-loop`. Chains over 32 entries fail envelope parsing (hold as unattested); 29-32-entry chains parse but trip `hop-runaway` at the > 28 guard.

Also enforced: a max line cap (`message_too_large`), symlink refusal on reply targets, and stale-socket refusal keyed to pid liveness plus proc-start tokens.

## artifact_yield (`yield_artifact_replies` family)

Same-conversation primitive: one live process of a conversation asks another to hand over in-flight artifact-reply generation.

- Request: `{action:"yield_artifact_replies", from, msg_id, session_id, slugs[<=16], reason:"resume"|"claim" (default), sent_at (epoch ms, ~4 s freshness window), claimed_at?, requester:{cwd?,tmux?}}`
- Answer: `{action:"artifact_replies_yielded", orig_msg_id, yielded?, not_held?, refused?}`
- Hand-back: `{action:"unyield_artifact_replies", orig_msg_id, slugs, stopped?}`

Admission (verified live, both directions): the target looks up the requester's registry record by socket and requires its `sessionId` to equal the target's own conversation id, plus pid match. With a random registry `sessionId` the request is refused silently; with the target's `sessionId` written into the registry, the target admitted the request and answered `artifact_replies_yielded {yielded:[], not_held:["probe-artifact"]}`. Trust boundary: the conversation gate reads the same-user-writable registry — it gates capability between processes, not identity against the local user.

## File transfer (`file_attachments`)

Sender stages each file into `~/.claude/file-transfers/<sha8>-<uuid8>-<name>` (0600) and attaches the descriptor array to the frame. Caps: 30 MiB per file, 16 per message, 1-day spool GC. Receiver validates each descriptor (absolute path, parent must be the spool, regular file, size, sha256 integrity), copies into `~/.claude/uploads/<receiving-session-id>/`, deletes the staged copy when spools are shared, and prepends `@"<uploads path>"` mentions plus `[SendFile: ... was not delivered — <reason>]` failure notes to the delivered body.

Staging and the descriptor-carrying frame replicate exactly, but receive-side materialisation never executes on this account: the `tengu_send_file` flag is absent from the served Statsig evaluations (never served on, not merely cached-off), proven by a deliberately sha-mismatched descriptor producing no inline failure note and no uploads directory. The gate is a server rollout decision; everything up to it is documented and the send-side gate (`A6e()`) is explicit in code.

## Cloud and bridge routing

Local UDS is one leg. Every signed-in session carries a `bridgeSessionId` in its registry (universally present), mirrored at `https://claude.ai/code/<bridgeSessionId>`. Roster candidates without a `sock` (cloud-session / bridge-session kinds) route over the first-party Sessions API at `https://api.anthropic.com`:

- `GET /v1/code/sessions`, `GET /v1/code/sessions/<id>` — roster and detail
- `POST /v1/code/sessions/<id>/events` — signed, batched turn events (`anthropic/ccr-turn-event-uuid`, `anthropic/ccr-turn-linked-event-uuids`, `traceparent` headers)
- `GET .../events` and `.../events/stream` — sequenced, redialling stream with liveness timeouts and service-clock drift checks
- `mark_read`, `archive`, title, `bridge`, `device` (attestation binding), `teleport-events`, `move-to-cloud`, `client/presence`, `synced_file/*`, self-hosted runner/worker endpoints
- Auth: OAuth bearer plus trusted-device headers; `isolatePeerMachines` gates cross-machine sends

Event signing: the payload is canonicalised with JCS (`claude-code-jcs@1`), signed with an external device key into an `anthropic.ccr.client_event.v1` attestation, and bound via `anthropic.ccr.create_session_bind.v1` / `session_bind.v1` messages carrying a `boundDeviceUuid`. Unattested events classify `bound_unattested` server-side. The device key is not extractable by design — the replication boundary for standalone cloud writes.

Delivery to cloud targets is best-effort: sessions report `acceptsPeerMessages`, and senders surface "accepted by the server ... but delivery is not confirmed" when unreported. Verified live: a `SendMessage` to a `bridge:<bridgeSessionId>` address was server-accepted with exactly that caveat and arrived in the target's local transcript (the bridge id maps back to the conversation via cloud ingest or local-sock mirroring; the code supports both legs).

## Adjacent: the daemon

`~/.claude/daemon` supervises background/scheduled agents, not interactive sessions: `roster.json` (v5) tracks workers (pid, procStart, sessionId, rendezvous socket under `/tmp/cc-daemon-501/<hash>/rv/`, pty socket), gated by `control.key` with uid-checked control connections.

## Reproduction

Minimal sender (auth + one user frame, single write):

```python
import socket, json, uuid, time
TOKEN = "<target peerToken from ~/.claude/sessions/<pid>.<hash>.key>"
SOCK, FROM = "/tmp/cc-socks/<target>.sock", "uds:/tmp/cc-socks/<sender>.sock"
wrapper = f'<cross-session-message from="{FROM}" from-name="<name>" from-mode="bypass">\n<body>\n</cross-session-message>'
frame = {"msgV": 1, "msg_id": str(uuid.uuid4()), "type": "user",
         "message": {"role": "user", "content": wrapper},
         "priority": "next", "from": FROM}
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(5)
s.connect(SOCK)
s.sendall((json.dumps({"type": "auth", "token": TOKEN}) + "\n" + json.dumps(frame) + "\n").encode())
time.sleep(0.2); s.close()
```

A receiving peer is the mirror: bind the socket, write key file and registry (procStart from `LC_ALL=C TZ=UTC ps -o lstart=` verbatim), accept connections, verify the auth line against the peerToken, parse frames, and — for receipts and notices to arrive — send only from the socket-owning process.

## Verification status

| Feature | Status |
|---|---|
| Transport, auth (peer/child/unauthenticated), user frames, envelope grammar | verified live, both directions |
| Holds, attestation, self-sent verdict, `crossSessionInbound` parity | verified live |
| Peer registration, roster admission, name discovery | verified live (standalone peer in `ListAgents`, named `SendMessage`) |
| Receipts: held / delivered / denied / expired / dropped{duplicate, rate-limited, hop-loop, hop-runaway} | verified live |
| `queue-full` | code-verified; trigger attempted (55 queued behind a hold dialog, no drop). The `tengu_harbor_kite_limits` dynamic override has never been served to this account (absent from the Statsig evaluations cache), so the effective cap is the code default of 50 — the non-firing therefore reflects queue accounting (messages parked behind the approval dialog do not count toward the undelivered-peer-message queue), not a raised cap |
| Idle subscriptions (`idle`, `exited`) | verified live |
| artifact_yield admission + answer | verified live (refused and admitted paths); populated handover not exercised |
| File transfer | staging + wire replicated; receive path behind a never-served server flag (evidenced) |
| Cloud/bridge routing | `bridge:` addressing verified live; sessions-API surface and event-signer envelope extracted; device key not extractable by design |

## Provenance

Recovered by live reverse-engineering of the 2.1.269 binary and verified with hand-rolled raw-socket clients against fresh Claude Code sessions and a registered standalone peer: injected messages delivered and answered, receipts captured for every status, drop reasons triggered on demand, idle notices observed in both states, and the same-conversation yield admission demonstrated in both directions. Boundaries (device-attestation signing, the upstream file-transfer flag, the dynamically raised queue cap) are stated where they apply.

The accompanying JSON Schemas are generated from the Zod definitions in `src/schemas/` — the same single source of truth the SDK runtime uses.
