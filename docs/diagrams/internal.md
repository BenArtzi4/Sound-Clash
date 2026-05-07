# Internal Architecture

What lives inside the running game: how the React frontend, FastAPI backend, and Supabase Postgres talk to each other, and what travels over each edge.

> **The single most important detail**: the buzzer (`buzz_in`) goes browser → Supabase **directly**, bypassing FastAPI entirely. That's how a <200ms hot path coexists with free-tier Python hosting that has 2–30s cold starts. See `realtime-design.md` for the full reasoning.

## Component map

```mermaid
flowchart TB
    subgraph BROWSER["Browser (React + Vite SPA)"]
        direction LR
        Mgr["Manager<br/>console"]
        Tm["Team<br/>buzzer"]
        Disp["Display<br/>screen"]
    end

    subgraph RENDER["FastAPI on Render"]
        direction TB
        Health["/health"]
        Games["/games/*<br/>create / join / select-song /<br/>award-points / bonus / end / kick"]
        Admin["/admin/songs<br/>CRUD + bulk-import"]
        Genres["/genres"]
    end

    subgraph SUPA["Supabase"]
        direction TB
        PostgREST["PostgREST<br/>HTTP → SQL"]
        Realtime["Realtime<br/>WebSocket"]
        subgraph PG["Postgres 15"]
            direction TB
            Tephem[("Ephemeral<br/>active_games /<br/>game_teams /<br/>game_rounds<br/>(4h TTL)")]
            Tdurable[("Durable<br/>songs /<br/>genres /<br/>song_genres")]
            RPC{{"PL/pgSQL<br/>buzz_in / start_round /<br/>award_points / award_bonus /<br/>end_game / cleanup_expired_games"}}
            Cron[/"pg_cron<br/>cleanup every hour"/]
            RLS[/"RLS policies<br/>anon SELECT only"/]
        end
    end

    Mgr -.->|"REST<br/>X-Manager-Token (per-game uuid)"| Games
    Mgr -.->|"REST<br/>X-Admin-Password"| Admin
    BROWSER -.->|"REST (open)"| Genres
    Tm ==>|"PostgREST RPC<br/>anon key<br/>buzz_in &lt;200ms"| PostgREST
    BROWSER ==>|"WSS subscribe<br/>active_games / game_teams /<br/>game_rounds for game_code"| Realtime

    Games -->|"service-role key"| Tephem
    Admin -->|"service-role key"| Tdurable
    Genres -->|"service-role key"| Tdurable
    PostgREST --> RPC
    RPC --> Tephem
    RPC --> Tdurable
    Cron --> Tephem
    Realtime -.->|"logical replication"| Tephem
    RLS -.- Tephem
    RLS -.- Tdurable

    classDef hot fill:#fff3cd,stroke:#cc6600,stroke-width:3px,color:#000
    classDef cold fill:#e8f0fe,stroke:#1a73e8,color:#000
    classDef store fill:#f1f8e9,stroke:#558b2f,color:#000
    class Tm,PostgREST,RPC hot
    class Games,Admin,Genres,Health cold
    class Tephem,Tdurable store
```

**Legend**

- **Yellow / thick edges** = the buzzer hot path. Browser fires `supabase.rpc('buzz_in', ...)` over PostgREST; Postgres does an atomic conditional `UPDATE`; Realtime fans the row change to all subscribers. No Python in the loop.
- **Blue / dashed edges** = REST traffic to FastAPI. Cold-start tolerant: game creation, song selection, scoring, admin CRUD. Always uses the service-role key server-side.
- **Solid arrows** = synchronous request/response. **Dashed arrows** = subscription / pub-sub.

## Auth surfaces (who can hit what)

| Caller | Path | Header / key | Why |
|---|---|---|---|
| Anonymous browser | `POST /games` | none | Open hosting; returns the per-game `manager_token` |
| Anonymous browser | `POST /games/{code}/teams` | none | Players just need to know the code |
| Anonymous browser | `supabase.rpc('buzz_in')` | anon JWT (RLS) | Hot path; the only RPC `anon` is `GRANT EXECUTE`d on |
| Anonymous browser | `SELECT` on game-scoped rows | anon JWT (RLS) | RLS allows SELECT, denies all writes |
| Manager browser | `POST /games/{code}/{select-song,award-points,bonus,end}` | `X-Manager-Token` | Per-game uuid stored on `active_games`, mirrored in localStorage |
| Manager browser | `DELETE /games/{code}/teams/{team_id}` | `X-Manager-Token` | Same |
| Admin browser | `/admin/songs/*` | `X-Admin-Password` | Single env-var password, constant-time compared |
| FastAPI itself | Anything via `supabase-py` | service-role key | Server-side only; never reaches the browser bundle |

The `manager_token` was added in 2026-05-06 (`migrations/012_manager_token.sql`) when the global manager-password gate was retired in favour of open hosting.

## Hot-path sequence: a buzz race

Two teams click the buzzer within ~50ms of each other. Postgres serializes them and exactly one wins. The other clients learn the result over Realtime.

```mermaid
sequenceDiagram
    autonumber
    participant T1 as Team 1 (browser)
    participant T2 as Team 2 (browser)
    participant PR as PostgREST
    participant PG as Postgres (buzz_in)
    participant RT as Realtime
    participant Mgr as Manager / Display

    par Concurrent buzzes
        T1->>PR: POST /rest/v1/rpc/buzz_in
        PR->>PG: SELECT buzz_in('A1B2C3', team1_uuid)
    and
        T2->>PR: POST /rest/v1/rpc/buzz_in
        PR->>PG: SELECT buzz_in('A1B2C3', team2_uuid)
    end

    Note over PG: UPDATE active_games<br/>SET buzzed_team_id = $2<br/>WHERE buzzed_team_id IS NULL<br/>RETURNING ...

    PG-->>PR: T1 result: locked=true
    PG-->>PR: T2 result: locked=false
    PR-->>T1: { locked: true, team_id: t1 }
    PR-->>T2: { locked: false, team_id: t1 }

    PG-)RT: WAL change on active_games
    RT-)Mgr: row update {buzzed_team_id: t1}
    RT-)T1: row update
    RT-)T2: row update

    Note over T1,Mgr: All four contexts agree on the winner<br/>within ~80–180ms total
```

Why this works: Postgres' `UPDATE ... WHERE buzzed_team_id IS NULL` is atomic at row level. The first call to land sets the field; the second sees zero rows affected and returns `locked=false`. There is no separate read-then-write that could lose to a race.

## What's deliberately **not** here

- No object storage. Audio is YouTube IFrame Player only; the catalog stores `youtube_id` + `start_time`.
- No state-management library. React local state + Supabase Realtime is the entire client model.
- No user accounts or JWT identity. The two credentials in the system (`X-Manager-Token`, `X-Admin-Password`) are scoped to specific surfaces; there is no profile, no login, no session.
- No WebSocket service in FastAPI. Supabase Realtime is the broadcast plane.
