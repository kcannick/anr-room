// k6 SPIKE test — reproduces the QR-scan signup burst (the exact load shape that caused
// the outage): everyone arrives synchronized in the same ~30s. This ramps request RATE
// (arrival rate), not just virtual users, so it models "N people scan at once" rather
// than steady traffic.
//
// Target: a READ endpoint (/api/session/info) — it exercises the outage MECHANISM
// (simultaneous cold starts + DB-connection acquisition) with ZERO side effects (no rows
// written, no OTP emails sent). That's the safe, faithful first test.
//
// Env vars:
//   SID       (required) — a throwaway test session id (node docs/loadtest/session.js create)
//   BASE_URL  (default https://anr.makinitmag.com)
//   PATH      (default /api/session/info?s=${SID}) — override to burst a different endpoint
//   PEAK      (default 100) — peak requests/sec (set comfortably above your expected crowd)
//
// Run:
//   k6 run -e SID=lt123abc docs/loadtest/spike.js
//   k6 run -e SID=lt123abc -e PEAK=200 docs/loadtest/spike.js
//
// Install k6: https://k6.io/docs/get-started/installation/  (mac: brew install k6)

import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'https://anr.makinitmag.com';
const SID  = __ENV.SID || '';
const PATH = __ENV.PATH || `/api/session/info?s=${SID}`;
const PEAK = parseInt(__ENV.PEAK || '100', 10);
const TARGET = `${BASE}${PATH}`;

export const options = {
  scenarios: {
    // Arrival-rate spike: 0 -> PEAK req/s over 10s (the scan rush), hold 30s, drain.
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: PEAK, duration: '10s' }, // the rush
        { target: PEAK, duration: '30s' }, // hold the crowd
        { target: 0,    duration: '5s'  }, // drain
      ],
    },
  },
  thresholds: {
    // These ARE the pass/fail criteria. k6 exits non-zero if either is breached.
    http_req_failed:   ['rate<0.01'],   // <1% non-2xx — a sustained 504 = the outage pattern
    http_req_duration: ['p(99)<10000'], // p99 under the 10s serverless function limit
  },
};

export function setup() {
  if (!SID && !__ENV.PATH) {
    throw new Error('Set SID=<test session id>. Create one:  node docs/loadtest/session.js create');
  }
  console.log(`Bursting ${TARGET} — peak ${PEAK} req/s`);
}

export default function () {
  const res = http.get(TARGET);
  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'under 10s':     (r) => r.timings.duration < 10000,
  });
}
