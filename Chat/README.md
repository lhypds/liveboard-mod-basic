
Chat
====


Talks to [simple-ai](https://simple-ai.io) through the `sc` CLI, not its web API.

The whole card is one terminal: type at the prompt, `Enter` runs the line, and the CLI's
output streams into the same box. Only the line after the prompt is editable — the
scrollback can be selected and copied but not changed. The **Reset** button in the card
header runs `:reset`, which starts a new session and clears the screen; the card gets that
button by registering a handler through the `_setReset` prop, so no config declares it.

Only the CLI's own output ever goes in the box. While `sc` is still coming up — or when
there is no bridge to reach at all — the card says so with a message in the middle of an
otherwise blank box, instead of writing a line into the session.


The bridge
----------

A browser cannot spawn a CLI, so the card talks to an **sc bridge**: a server that runs `sc`
and exposes it over HTTP. Nothing about the CLI runs on the machine serving the board.

`VITE_SC_BRIDGE_URL` in `.env` is the board's default bridge — every Chat card uses it unless
that card's own `bridgeUrl` config says otherwise, which lets one card talk to a bridge of its
own without touching the board's default. Changing it re-connects that card on the spot.
`setup.sh` asks for the default at deploy time and checks it answers on `/healthz`.

The card uses two endpoints of a bridge:

```
GET  /api/sc/stream?session=<id>       `chunk` events, and `ready` at every prompt
POST /api/sc/send   { session, text }  write one line to the CLI's stdin
```

One CLI per card: the `session` id is the card's own instance id, so two cards never share a
conversation, and duplicating a card gives the copy its own CLI.

Everything beyond typing is said in the CLI's own language — `:info` to read the session id
and model, `:session attach <id>` to resume, `:reset` to start over. `sc.ts` recognises that
output by shape and keeps it out of the box, using the bridge's `ready` events as the boundary
between one block of output and the next. Two wrinkles worth knowing, both handled there:
a line written before the CLI reaches its first prompt is dropped, so the opening `:info` is
asked again when the startup banner appears; and React mounts a component twice in dev, so a
duplicate answer is swallowed for a moment after the first.

The card is signed in as whoever the CLI is logged in as on the bridge. Type
`:login <username> <password>` into the card if it is not — any `:` command is forwarded to
the CLI as typed. Passwords are masked in the saved scrollback, never in the CLI.


Config
------

What the card keeps in its `comp` config, so it can come back as it was:

| key | what it is |
| --- | --- |
| `bridgeUrl` | this card's own bridge; empty means the board's default |
| `bridgeSession` | which CLI on the bridge the card owns |
| `scSession` | the simple-ai session id — the conversation itself |
| `model` | the model the CLI last reported, for the prompt after a refresh |
| `terminal` | the scrollback, trimmed from the top at `maxChars` |

`scSession` is the one that matters: bridges drop an idle CLI after a while, so when the card
comes back to a new one it re-attaches with `:session attach <id>` and the conversation carries
on where it left off. Reset stores the new id in its place.
