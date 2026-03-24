import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

// ─── Custom Metrics ───────────────────────────────────────────────────────────
const lockSuccessRate  = new Rate("seat_lock_success_rate");
const lockConflictRate = new Rate("seat_lock_conflict_rate");
const lockDuration     = new Trend("seat_lock_duration_ms", true);
const searchDuration   = new Trend("search_duration_ms", true);
const racesWon         = new Counter("races_won");
const racesLost        = new Counter("races_lost");

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL  = "http://localhost:3000";
const JWT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNtbXV1dWRtbTAwMDA3YTdoZWVpY3Jtb3giLCJyb2xlIjoiVVNFUiIsImlhdCI6MTc3Mzc3MTM0NSwiZXhwIjoxNzczNzcyMjQ1fQ.55UfZrYxb970G-5zx3AkOazWvBoiSgJcdcgRn8e6rm8";
const SHOW_ID   = "cmmuulf4f0010axyliveaxkcm";
const SEAT_POOL = [
  "cmmuulf37000oaxyle4o4shhw",
  "cmmuulf3d000qaxylsrexdgn5",
  "cmmuulf3j000saxylg5i6fd1a",
  "cmmuulf3n000uaxylvsofn5il",
  "cmmuulf3t000waxyl3lmjwbzm",
];
const RACE_SEAT      = SEAT_POOL[0];
const SEARCH_QUERIES = ["batman", "action", "mumbai", "PVR", "avtar", "inox", "thriller"];

// ─── Test Scenarios ───────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Warmup — 10 users
    warmup: {
      executor: "constant-vus",
      vus: 10,
      duration: "20s",
      tags: { scenario: "warmup" },
    },
    // Normal load — 100 concurrent users
    normal_load: {
      executor: "constant-vus",
      vus: 100,
      duration: "30s",
      startTime: "25s",
      tags: { scenario: "normal_load" },
    },
    // Peak load — ramp up to 200 users
    peak_load: {
      executor: "ramping-vus",
      startVUs: 100,
      stages: [
        { duration: "15s", target: 200 },
        { duration: "30s", target: 200 },
        { duration: "15s", target: 0   },
      ],
      startTime: "60s",
      tags: { scenario: "peak_load" },
    },
    // Race condition — 100 users fight for 1 seat
    race_condition: {
      executor: "constant-vus",
      vus: 100,
      duration: "10s",
      startTime: "125s",
      tags: { scenario: "race_condition" },
    },
    // Search load — 100 concurrent search users
    search_load: {
      executor: "constant-vus",
      vus: 100,
      duration: "30s",
      startTime: "140s",
      tags: { scenario: "search_load" },
    },
  },
  thresholds: {
    http_req_duration:      ["p(95)<3000"],
    seat_lock_success_rate: ["rate>0.1"],
    http_req_failed:        ["rate<0.5"],
    search_duration_ms:     ["p(95)<2000"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getRandomSeat() {
  return SEAT_POOL[Math.floor(Math.random() * SEAT_POOL.length)];
}
function getRandomQuery() {
  return SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function () {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${JWT_TOKEN}`,
  };

  const isRace   = __VU % 5 === 0;
  const isSearch = __VU % 3 === 0;

  // ── Search ──────────────────────────────────────────────────────────────
  if (isSearch) {
    const query       = getRandomQuery();
    const searchStart = Date.now();
    const searchRes   = http.get(
      `${BASE_URL}/api/v1/search/movies?q=${query}`,
      { headers, tags: { name: "search_movies" } }
    );
    searchDuration.add(Date.now() - searchStart);

    check(searchRes, {
      "search status 200": (r) => r.status === 200,
      "search has data":   (r) => {
        try { return JSON.parse(r.body).data !== undefined; }
        catch { return false; }
      },
    });

    sleep(0.5);
    return;
  }

  // ── Seat Lock ────────────────────────────────────────────────────────────
  const seatId    = isRace ? RACE_SEAT : getRandomSeat();
  const payload   = JSON.stringify({ showId: SHOW_ID, seatId: seatId });
  const lockStart = Date.now();

  const lockRes = http.post(
    `${BASE_URL}/api/v1/seats/lock`,
    payload,
    { headers, tags: { name: "seat_lock" } }
  );

  const lockTime = Date.now() - lockStart;
  lockDuration.add(lockTime);

  const isSuccess  = lockRes.status === 200 || lockRes.status === 201;
  const isConflict = lockRes.status === 409 || lockRes.status === 423;

  lockSuccessRate.add(isSuccess);
  lockConflictRate.add(isConflict);

  if (isRace) {
    if (isSuccess)  racesWon.add(1);
    if (isConflict) racesLost.add(1);
  }

  check(lockRes, {
    "no server error":  (r) => r.status < 500,
    "lock under 3s":    () => lockTime < 3000,
  });

  if (lockRes.status >= 500) {
    console.error(`SERVER ERROR | status=${lockRes.status} | ${lockRes.body}`);
  }

  sleep(Math.random() * 1.5 + 0.5);
}

// ─── Resume-Ready Summary ─────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;

  const p95Lock   = m["seat_lock_duration_ms"]?.values?.["p(95)"]?.toFixed(0) ?? "N/A";
  const p95Search = m["search_duration_ms"]?.values?.["p(95)"]?.toFixed(0)    ?? "N/A";
  const avgLock   = m["seat_lock_duration_ms"]?.values?.["avg"]?.toFixed(0)   ?? "N/A";
  const totalReqs = m["http_reqs"]?.values?.count                              ?? 0;
  const rps       = m["http_reqs"]?.values?.rate?.toFixed(1)                  ?? "N/A";
  const successPc = ((m["seat_lock_success_rate"]?.values?.rate ?? 0) * 100).toFixed(1);
  const won       = m["races_won"]?.values?.count  ?? 0;
  const lost      = m["races_lost"]?.values?.count ?? 0;
  const winPct    = (won + lost) > 0 ? ((won / (won + lost)) * 100).toFixed(2) : "N/A";

  const summary = `
╔══════════════════════════════════════════════════════════════════╗
║                 TICKETBLITZ LOAD TEST RESULTS                    ║
╠══════════════════════════════════════════════════════════════════╣
║  SEAT LOCKING                                                    ║
║    Avg Response Time  : ${avgLock.padEnd(8)} ms                          ║
║    p95 Response Time  : ${p95Lock.padEnd(8)} ms                          ║
║    Lock Success Rate  : ${(successPc + "%").padEnd(8)}                          ║
╠══════════════════════════════════════════════════════════════════╣
║  ELASTICSEARCH SEARCH                                            ║
║    p95 Response Time  : ${p95Search.padEnd(8)} ms                          ║
╠══════════════════════════════════════════════════════════════════╣
║  THROUGHPUT                                                      ║
║    Total Requests     : ${String(totalReqs).padEnd(8)}                          ║
║    Requests/sec       : ${String(rps).padEnd(8)}                          ║
╠══════════════════════════════════════════════════════════════════╣
║  RACE CONDITION (100 users → 1 seat)                             ║
║    Locks Won          : ${String(won).padEnd(8)} (should be exactly 1)      ║
║    Locks Lost         : ${String(lost).padEnd(8)} (expected behaviour)      ║
║    Win Rate           : ${(winPct + "%").padEnd(8)} (should be ~1%)           ║
╚══════════════════════════════════════════════════════════════════╝


  console.log(summary);
  return { stdout: summary };
}
