// Round flow catalog. Each flow is one realistic combination of the manager's
// buttons (Correct Song / Correct Artist / Wrong / Continue / Next / Bonus)
// plus team buzz behavior. Flows drive the game exclusively through the same
// wire calls real browsers make and keep a local expected-score ledger that
// mirrors the DB's authoritative scoring rules (mig 043):
//   title +10, artist +5, both +15, wrong -3 (0 if free-guess active).
// Correct awards KEEP the buzz lock; wrong awards auto-release it;
// release_buzz_lock is the explicit "Continue round".

import { pick } from "./util.mjs";

// ---- primitives (operate on a GameDriver `d`) ------------------------------

// All (or a subset of) teams press the buzzer as close to simultaneously as
// possible. Invariant: exactly one caller gets locked=true; losers see the
// winner's id. Returns the winning team.
export async function volleyBuzz(d, teams) {
  // The matcher must only accept THIS buzz's null->team transition: a correct
  // award later bumps locked_at with buzzed_team_id still set (an echo that
  // must not satisfy a stale expectation), and multi-buzz flows register
  // several lock_set expectations per round. REPLICA IDENTITY FULL (mig 009)
  // gives us the full old row to detect the fresh transition; the winner id
  // is bound as soon as the race resolves.
  const ref = { teamId: null };
  d.expectRt(
    "lock_set",
    (table, p) =>
      table === "active_games" &&
      p.eventType === "UPDATE" &&
      !!p.new?.buzzed_team_id &&
      !p.old?.buzzed_team_id &&
      (!ref.teamId || p.new.buzzed_team_id === ref.teamId),
  );
  const results = await Promise.all(
    teams.map((t) =>
      d
        .deviceFor(t)
        .rpc("buzz_in", { p_game_code: d.code, p_team_id: t.id })
        .catch((err) => ({ err })),
    ),
  );
  const rows = results.map((r) => (r.err ? null : Array.isArray(r.data) ? r.data[0] : r.data));
  results.forEach((r, i) => {
    if (r.err) d.error(`buzz_in threw for ${teams[i].name}: ${r.err.message}`);
  });
  const winners = teams.filter((_, i) => rows[i]?.locked === true);
  if (winners.length !== 1) {
    d.violation(`buzz race with ${teams.length} teams produced ${winners.length} winners (round ${d.roundNum})`);
    // Recover so the run can continue: adopt the DB's view of the lock holder.
    const winnerId = rows.find((r) => r?.locked_team_id)?.locked_team_id;
    const winner = teams.find((t) => t.id === winnerId) || null;
    ref.teamId = winner ? winner.id : null;
    d.lockHeld = winner ? winner.id : null;
    return winner;
  }
  const winner = winners[0];
  ref.teamId = winner.id;
  rows.forEach((row, i) => {
    if (row && row.locked === false && row.locked_team_id && row.locked_team_id !== winner.id) {
      d.anomaly(`loser ${teams[i].name} saw lock holder ${row.locked_team_id} != winner ${winner.id} (round ${d.roundNum})`);
    }
  });
  d.lockHeld = winner.id;
  return winner;
}

export async function singleBuzz(d, team) {
  const winner = await volleyBuzz(d, [team]);
  if (winner && winner.id !== team.id) d.violation(`single buzz by ${team.name} won by someone else`);
  return winner;
}

// Manager scores the held buzz. Cross-checks the RPC's returned delta and
// running total against the local ledger (immediate corruption detection).
export async function award(d, team, { title = false, artist = false, wrong = false }) {
  const delta = wrong ? (d.freeGuess ? 0 : -3) : (title ? 10 : 0) + (artist ? 5 : 0);
  const expectedTotal = d.ledger.get(team.id) + delta;
  if (delta !== 0) {
    d.expectRt(
      "score_update",
      (table, p) => table === "game_teams" && p.eventType === "UPDATE" && p.new?.id === team.id && p.new?.score === expectedTotal,
    );
  }
  const { data } = await d.mgr.rpc("award_attempt", {
    p_game_code: d.code,
    p_round_id: d.roundId,
    p_correct_title: title,
    p_correct_artist: artist,
    p_wrong: wrong,
    p_manager_token: d.managerToken,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    d.violation(`award_attempt returned no row (team ${team.name}, round ${d.roundNum})`);
    return;
  }
  if (row.points_delta !== delta) {
    d.violation(`award delta ${row.points_delta} != expected ${delta} (team ${team.name}, round ${d.roundNum})`);
  }
  if (row.team_total_score !== expectedTotal) {
    d.violation(`running total ${row.team_total_score} != ledger ${expectedTotal} (team ${team.name}, round ${d.roundNum})`);
  }
  d.ledger.set(team.id, row.team_total_score);
  if (wrong) {
    d.freeGuess = false; // waiver consumed (or was never armed)
    d.lockHeld = null; // wrong auto-releases the lock
  } else {
    d.freeGuess = true; // any correct claim arms the free guess
  }
}

// "Continue round": release the lock with no score.
export async function release(d) {
  await d.mgr.rpc("release_buzz_lock", { p_game_code: d.code, p_manager_token: d.managerToken });
  d.lockHeld = null;
}

// ---- the catalog -----------------------------------------------------------

const otherThan = (d, ...exclude) => {
  const ids = new Set(exclude.map((t) => t.id));
  return d.roster.filter((t) => !ids.has(t.id));
};

export const FLOWS = [
  {
    name: "race_title",
    weight: 18,
    minTeams: 2,
    async run(d) {
      const winner = await volleyBuzz(d, d.roster);
      await d.think("think");
      if (winner) await award(d, winner, { title: true });
    },
  },
  {
    name: "race_both",
    weight: 12,
    minTeams: 2,
    async run(d) {
      const winner = await volleyBuzz(d, d.roster);
      await d.think("think");
      if (winner) await award(d, winner, { title: true, artist: true });
    },
  },
  {
    name: "single_title",
    weight: 10,
    minTeams: 1,
    async run(d) {
      const team = pick(d.rng, d.roster);
      await singleBuzz(d, team);
      await d.think("think");
      await award(d, team, { title: true });
    },
  },
  {
    name: "single_artist",
    weight: 8,
    minTeams: 1,
    async run(d) {
      const team = pick(d.rng, d.roster);
      await singleBuzz(d, team);
      await d.think("think");
      await award(d, team, { artist: true });
    },
  },
  {
    name: "split_title_artist",
    weight: 12,
    minTeams: 2,
    async run(d) {
      const a = pick(d.rng, d.roster);
      await singleBuzz(d, a);
      await d.think("think");
      await award(d, a, { title: true });
      await d.think("think");
      await release(d);
      const b = pick(d.rng, otherThan(d, a));
      await singleBuzz(d, b);
      await d.think("think");
      await award(d, b, { artist: true });
    },
  },
  {
    name: "wrong_then_title",
    weight: 14,
    minTeams: 2,
    async run(d) {
      const a = pick(d.rng, d.roster);
      await singleBuzz(d, a);
      await d.think("think");
      await award(d, a, { wrong: true }); // -3, lock auto-released
      await d.think("think");
      const b = pick(d.rng, otherThan(d, a));
      await singleBuzz(d, b);
      await d.think("think");
      await award(d, b, { title: true });
    },
  },
  {
    name: "wrong_chain",
    weight: 8,
    minTeams: 3,
    async run(d) {
      const a = pick(d.rng, d.roster);
      await singleBuzz(d, a);
      await d.think("think");
      await award(d, a, { wrong: true });
      const b = pick(d.rng, otherThan(d, a));
      await singleBuzz(d, b);
      await d.think("think");
      await award(d, b, { wrong: true });
      const c = pick(d.rng, otherThan(d, a, b));
      await singleBuzz(d, c);
      await d.think("think");
      await award(d, c, { title: true, artist: true });
    },
  },
  {
    name: "free_guess_waiver",
    weight: 8,
    minTeams: 3,
    async run(d) {
      // A claims the title (+10, arms free guess), manager continues, B answers
      // wrong for 0 (waived), C takes the artist (+5). Exercises mig 017.
      const a = pick(d.rng, d.roster);
      await singleBuzz(d, a);
      await d.think("think");
      await award(d, a, { title: true });
      await release(d);
      const b = pick(d.rng, otherThan(d, a));
      await singleBuzz(d, b);
      await d.think("think");
      await award(d, b, { wrong: true }); // delta 0: free guess waives the -3
      const c = pick(d.rng, otherThan(d, a, b));
      await singleBuzz(d, c);
      await d.think("think");
      await award(d, c, { artist: true });
    },
  },
  {
    name: "race_wrong_race",
    weight: 5,
    minTeams: 2,
    async run(d) {
      const w1 = await volleyBuzz(d, d.roster);
      await d.think("think");
      if (w1) await award(d, w1, { wrong: true });
      await d.think("think");
      const w2 = await volleyBuzz(d, d.roster);
      await d.think("think");
      if (w2) await award(d, w2, { artist: true });
    },
  },
  {
    name: "no_buzz_skip",
    weight: 3,
    minTeams: 1,
    async run(d) {
      await d.think("between"); // song plays, nobody buzzes, manager moves on
    },
  },
  {
    name: "bonus_after_title",
    weight: 5,
    minTeams: 1,
    async run(d) {
      const team = pick(d.rng, d.roster);
      await singleBuzz(d, team);
      await d.think("think");
      await award(d, team, { title: true });
      const lucky = pick(d.rng, d.roster);
      await d.bonusTo(lucky, 4); // manager's default bonus button
    },
  },
];

export function pickFlow(d) {
  const eligible = FLOWS.filter((f) => d.roster.length >= f.minTeams && (d.bonusEnabled || f.name !== "bonus_after_title"));
  const total = eligible.reduce((s, f) => s + f.weight, 0);
  let roll = d.rng() * total;
  for (const f of eligible) {
    roll -= f.weight;
    if (roll <= 0) return f;
  }
  return eligible[eligible.length - 1];
}

// The smoke run forces every flow once, deterministically.
export const SMOKE_FLOW_SEQUENCE = FLOWS.map((f) => f.name);
