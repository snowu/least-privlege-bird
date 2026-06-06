# Anti-cheat architecture & flow

The leaderboard is **server-authoritative**. The browser is the attacker's machine and
cannot be trusted, so a claimed score is never stored as-is — the client sends the
*inputs* of the run, and a Supabase Edge Function re-simulates the game server-side and
stores only a score it independently reproduces.

## The whole flow

1. **Registration** — On a new name (when `LIVE_DB` is on), the client generates a
   48-hex token, stores it in localStorage (**token only, never the score**), shows the
   token modal, and POSTs an empty run `{seed, flapTicks:[], claimedScore:0}` to the edge
   function. This registers the row at score 0 — the account is real the moment the token
   exists.
2. **Gameplay (deterministic)** — `initGame` picks a random `seed`, seeds the mulberry32
   PRNG, resets `flapTicks=[]`. The loop is fixed-timestep: physics advance in 1/60s ticks
   via an accumulator, independent of monitor refresh rate. Pipe heights come from the
   seeded PRNG. Every flap is logged as the tick number it occurred on. The whole run is
   reproducible from `{seed, flapTicks}` alone.
3. **Death → submit** — Client captures `{seed, flapTicks}` (before `initGame` wipes them)
   and POSTs `{name, token, seed, flapTicks, claimedScore}` to the edge function.
4. **Edge function (server-side)** — Validates payload shape → **replays** via `sim.ts`
   → if `recomputed !== claimedScore` rejects (`422`) → token-hash verify → max-only write
   with the service-role key (bypasses RLS).
5. **Leaderboard read** — Client reads `scores` directly (anon SELECT), filtered
   `score > 0`.

## The four security locks

Break any one and it leaks; all four hold:

1. **RLS** — anon can't write `scores` directly → can't skip the function.
2. **Server-side code** — the function runs on Supabase, not the browser → logic
   unalterable.
3. **Replay** — claimed score is recomputed from inputs → a forged number is rejected.
4. **Service-role secrecy** — the write key lives only in the function's env → an
   attacker can't impersonate the function.

---

## Architecture

```mermaid
graph TB
    subgraph BROWSER["🌐 BROWSER — untrusted (attacker's machine)"]
        direction TB
        GAME["game.js<br/>fixed-timestep loop<br/>seeded PRNG · logs flapTicks"]
        SCORES["scores.js<br/>token in localStorage<br/>(never the score)"]
        SIMCLIENT["sim logic<br/>(readable, but harmless)"]
    end

    subgraph SUPABASE["☁️ SUPABASE — trusted (server-side)"]
        direction TB
        EDGE["submit-score Edge Function<br/>validate → replay → verify → write"]
        SIMTS["sim.ts<br/>authoritative physics<br/>(mirror of game.js)"]
        DB[("scores table<br/>name · token_hash · score")]
        RLS{{"RLS: anon = SELECT only<br/>NO direct writes"}}
        EDGE --> SIMTS
        EDGE -->|"service-role key<br/>(bypasses RLS)"| DB
        RLS -.guards.-> DB
    end

    GAME --> SCORES
    SCORES -->|"POST {name, token,<br/>seed, flapTicks, claimedScore}"| EDGE
    SCORES -->|"GET scores?score=gt.0<br/>(anon SELECT)"| DB
    SIMCLIENT -.identical to.-> SIMTS

    EDGE -->|"422 if recomputed ≠ claimed"| SCORES

    style BROWSER fill:#3a1f1f,stroke:#c0392b,color:#fff
    style SUPABASE fill:#1f3a2a,stroke:#27ae60,color:#fff
    style EDGE fill:#27ae60,stroke:#fff,color:#fff
    style DB fill:#2980b9,stroke:#fff,color:#fff
    style RLS fill:#e67e22,stroke:#fff,color:#fff
```

---

## Submit sequence (the anti-cheat moment)

```mermaid
sequenceDiagram
    participant P as Player
    participant G as game.js (browser)
    participant E as Edge Function (Supabase)
    participant S as sim.ts (replay)
    participant DB as scores table

    Note over G: run records {seed, flapTicks}<br/>during fixed-timestep play
    P->>G: dies (or forges a request)
    G->>E: POST {name, token, seed,<br/>flapTicks, claimedScore}

    E->>E: validate payload shape
    alt malformed (bad ticks/token/seed)
        E-->>G: 400 bad inputs
    end

    E->>S: simulate(seed, flapTicks)
    S-->>E: recomputed score

    alt recomputed ≠ claimedScore
        E-->>G: 422 score mismatch ❌<br/>(forgery dies here)
    else recomputed = claimedScore
        E->>DB: SELECT token_hash, score
        alt token_hash mismatch
            E-->>G: 403 token mismatch
        else valid + new high
            E->>DB: write GREATEST(old, new)<br/>(service-role)
            E-->>G: 200 ok ✅
        end
    end
```

---

## Why reading the client's sim doesn't help an attacker

```mermaid
graph LR
    A["Attacker reads<br/>game.js physics"] --> B{"Wants score 9999"}
    B --> C["Forge claimedScore=9999<br/>with fake/empty inputs"]
    C --> D["Server replays inputs"]
    D --> E["Recomputes real score = 0"]
    E --> F["422 — rejected ❌"]
    B --> G["Submit inputs that<br/>genuinely reach 9999"]
    G --> H["= actually playing<br/>9999 pipes 🎮"]
    H --> I["Accepted ✅<br/>(not cheating — just good)"]

    style F fill:#c0392b,color:#fff
    style I fill:#27ae60,color:#fff
```

**Knowing the rules ≠ being able to fake the inputs.** The claimed number is worthless
because the server recomputes it; the only inputs that yield score N are inputs that
legitimately survive N pipes.

> Remaining caveat (out of scope): a bot that programmatically plays well produces
> *valid* inputs — that's "being good at the game," not forging. Defending against it
> needs behavioral/timing heuristics.
