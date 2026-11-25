# 🛡️ Phase 1: Stabilization, Connection Hygiene & Process Separation

> **Milestone:** Phase 1 of the TicketBlitz 1-to-1,000,000 Scale Transformation  
> **Target:** Establish a rock-solid, horizontally scalable architectural foundation by addressing database connection limits, multi-node WebSocket routing, and process lifecycle management.

---

## 📑 Table of Contents
1. [The 4 Core Architectural Problems Addressed](#1-the-4-core-architectural-problems-addressed)
   - [Problem 1: Database Connection Pool Exhaustion](#problem-1-database-connection-pool-exhaustion)
   - [Problem 2: Socket.IO Multi-Pod Isolation](#problem-2-socketio-multi-pod-isolation)
   - [Problem 3: Monolithic Event Loop Starvation & Process Coupling](#problem-3-monolithic-event-loop-starvation--process-coupling)
   - [Problem 4: Ungraceful Terminations & Traffic Drops](#problem-4-ungraceful-terminations--traffic-drops)
2. [Deep Dive 1: Database Connection Pooling & PgBouncer Mechanics](#2-deep-dive-1-database-connection-pooling--pgbouncer-mechanics)
   - [The Physical Reality of a PostgreSQL Connection](#the-physical-reality-of-a-postgresql-connection)
   - [Pool Sizing Formula (HikariCP / PostgreSQL Rule)](#pool-sizing-formula-hikaricp--postgresql-rule)
   - [Transaction Pooling Mode (`POOL_MODE=transaction`)](#transaction-pooling-mode-pool_modetransaction)
   - [Why MySQL Also Needs a Pooler at Scale](#why-mysql-also-needs-a-pooler-at-scale)
   - [The `directUrl` Migration Conflict & `?pgbouncer=true`](#the-directurl-migration-conflict--pgbouncertrue)
3. [Deep Dive 2: Non-Blocking Event-Driven I/O & `epoll`](#3-deep-dive-2-non-blocking-event-driven-io--epoll)
   - [What is "I/O"?](#what-is-io)
   - [Blocking I/O vs. Non-Blocking Event-Driven I/O](#blocking-io-vs-non-blocking-event-driven-io)
   - [How `epoll` Works (The Kernel Switchboard)](#how-epoll-works-the-kernel-switchboard)
4. [Deep Dive 3: Distributed WebSockets, Pub/Sub Limits & Lock System Design](#4-deep-dive-3-distributed-websockets-pubsub-limits--lock-system-design)
   - [The Multi-Pod Isolation Problem](#the-multi-pod-isolation-problem)
   - [The Redis Adapter Architecture](#the-redis-adapter-architecture)
   - [The Ghost Worker Problem & Redis Emitter](#the-ghost-worker-problem--redis-emitter)
   - [System Design: Why Broadcast if Redis Holds the Lock?](#system-design-why-broadcast-if-redis-holds-the-lock)
   - [Critical Limitations: Fire-and-Forget & Sharded Pub/Sub (Redis 7)](#critical-limitations-fire-and-forget--sharded-pubsub-redis-7)
5. [Deep Dive 4: WebSocket Production Tunings & DoS Hardening](#5-deep-dive-4-websocket-production-tunings--dos-hardening)
   - [`maxHttpBufferSize` Tuning (DoS Hardening)](#maxhttpbuffersize-tuning-dos-hardening)
   - [WebSocket Compression Defaults (`perMessageDeflate`)](#websocket-compression-defaults-permessagedeflate)
   - [Wire Payload Considerations](#wire-payload-considerations)
6. [Step-by-Step Implementation & Architecture](#6-step-by-step-implementation--architecture)
   - [Step 1: Global Prisma Client Singleton](#step-1-global-prisma-client-singleton)
   - [Step 2: PgBouncer Integration in Docker Compose](#step-2-pgbouncer-integration-in-docker-compose)
   - [Step 3: Horizontal Socket.IO with Redis Adapter & Tunings](#step-3-horizontal-socketio-with-redis-adapter--tunings)
   - [Step 4: Process Decoupling (`server.ts` vs. `worker.ts`)](#step-4-process-decoupling-serverts-vs-workerts)
   - [Step 5: Cloud-Native Health Probes with Caching & Proper Shutdown Order](#step-5-cloud-native-health-probes-with-caching--proper-shutdown-order)
7. [Verification & File Inventory](#7-verification--file-inventory)

---

## 1. The 4 Core Architectural Problems Addressed

```
                      PREVIOUS ARCHITECTURE (v1.0 Monolith)
   ┌─────────────────────────────────────────────────────────────┐
   │ Process: Node.js (Port 3000)                                 │
   │                                                             │
   │  [HTTP Routes]   [Socket.IO (Memory)]   [BullMQ Workers]    │
   │        │                  │                    │            │
   │   4x Prisma               │ (Isolated)         │            │
   │   Clients                 │                    │            │
   └────────┬──────────────────┼────────────────────┼────────────┘
            │                  │                    │
            ▼                  ▼                    ▼
   Postgres crashes!   Pod 2 never gets     Worker CPU stall
   (40 conns/pod)      seat updates!        kills HTTP server!
```

---

### Problem 1: Database Connection Pool Exhaustion
- **The Root Cause:** `new PrismaClient()` was instantiated across 4 separate files (`seat.service.ts`, `auth.controller.ts`, `sync.ts`, `config/prisma.ts`).
- **The Consequence:** Each instance created a pool of 10 connections = 40 connections in 1 server process. 3 pods opened 120 connections, exceeding PostgreSQL's default `max_connections = 100` and failing with `FATAL: sorry, too many clients already`.
- **The Fix:** Enforced a **Global Prisma Singleton** bound to `globalThis` and placed **PgBouncer** in front of PostgreSQL.

---

### Problem 2: Socket.IO Multi-Pod Isolation
- **The Root Cause:** Socket.IO's default `InMemoryAdapter` stores room subscribers strictly inside the local heap memory of a single Node.js process.
- **The Consequence:** User A on Pod 1 locks a seat. Pod 1 emits to its local memory room. User B on Pod 2 receives zero updates, still sees the seat as available, and tries to book it.
- **The Fix:** Mounted `@socket.io/redis-adapter` and `@socket.io/redis-emitter` via Redis Pub/Sub, enforcing pure WebSockets (`transports: ['websocket']`).

---

### Problem 3: Monolithic Event Loop Starvation & Process Coupling
- **The Root Cause:** BullMQ background workers (`seatUnlockWorker`, `notificationWorker`) ran in the same Node.js event loop as the HTTP API.
- **The Consequence:** Worker CPU work blocked HTTP handling. Uncaught worker exceptions crashed the web server. Auto-scaling the web API multiplied workers unintentionally.
- **The Fix:** Decoupled into two independent binaries: `src/server.ts` (API/WebSockets) and `src/worker.ts` (BullMQ workers).

---

### Problem 4: Ungraceful Terminations & Traffic Drops
- **The Root Cause:** Missing OS signal handlers (`SIGTERM`/`SIGINT`) caused containers to exit abruptly.
- **The Consequence:** Load balancers kept sending traffic for a few seconds after a container began stopping, causing `502 Bad Gateway` errors for active users.
- **The Fix:** Implemented a **multi-stage graceful shutdown**: fail readiness first, wait 5 seconds for load balancer deregistration, drain in-flight HTTP requests, and then disconnect database and queue pools.

---

## 2. Deep Dive 1: Database Connection Pooling & PgBouncer Mechanics

### The Physical Reality of a PostgreSQL Connection
A connection is **not a lightweight in-memory handle**.
1. **TCP Socket & TLS Handshake:** Negotiates encryption and transport.
2. **PostgreSQL Process Allocation (`fork()`):**
   PostgreSQL uses a process-based model. For **every single connection**, the PostgreSQL `postmaster` daemon executes an operating system `fork()` to spawn a dedicated backend OS process.
   - Each process consumes **5 MB to 15 MB of RAM** for session buffers (`work_mem`, connection state, local plan cache).
   - By default, PostgreSQL enforces `max_connections = 100` to prevent RAM exhaustion and OS thrashing.

---

### Pool Sizing Formula (HikariCP / PostgreSQL Rule)
A common mistake is assuming that "more connections = faster database." In reality, a database is bounded by CPU cores and I/O spindles.

The well-established formula for sizing a database connection pool is:
$$\text{Pool Size} = (\text{CPU Cores} \times 2) + \text{Effective Spindle Count}$$

- On an **8-core machine with fast SSD storage**, the optimal PostgreSQL pool is roughly:
  $$(8 \times 2) + 1 = \mathbf{17 \text{ connections}}$$
- Above this number, performance begins degrading due to CPU thread scheduling overhead, cache line invalidations, and lock contention.
- Setting a pool of 25–50 connections on PgBouncer is tailored for a dedicated multi-core database host (e.g. 16–24 cores), not a baseline laptop.

---

### Transaction Pooling Mode (`POOL_MODE=transaction`)
- In **Session Mode**, a client holds a connection from connect until disconnect, even when idle.
- In **Transaction Mode**, PgBouncer assigns a real PostgreSQL connection **only for the duration of a transaction (`BEGIN ... COMMIT`)**.
- As soon as the transaction commits (typically 2–5 ms), PgBouncer reclaims the connection and assigns it to another waiting client.
- **Result:** Hundreds of application threads can safely multiplex over a small, CPU-optimal pool of real PostgreSQL processes.

---

### Why MySQL Also Needs a Pooler at Scale
While MySQL uses one OS thread per connection instead of a full process fork, it still suffers from connection limits at high scale:
- 10,000 idle threads still consume memory (`thread_stack` $\approx$ 256 KB–1 MB per thread).
- Thousands of concurrent threads competing for internal InnoDB buffer pool mutexes and log write locks cause severe CPU thread contention.
- MySQL defaults to `max_connections = 151`.
- Production MySQL deployments at large scale use connection proxies (such as **ProxySQL** or YouTube's **Vitess**) to prevent connection saturation.

---

### The `directUrl` Migration Conflict & `?pgbouncer=true`
In [prisma/schema.prisma](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/prisma/schema.prisma):
```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")        // Port 6432 (PgBouncer) -> Used for runtime queries
  directUrl = env("DIRECT_DATABASE_URL") // Port 5432 (Direct Postgres) -> Used for migrations
}
```

#### Two Essential Configurations:
1. **`directUrl`:** Prisma migrations require session-level **advisory locks** (`pg_advisory_lock`). In transaction pooling mode, PgBouncer shuffles connections between queries, breaking advisory locks. `directUrl` points directly to PostgreSQL (Port 5432) for migration execution.
2. **`?pgbouncer=true` in `DATABASE_URL`:** In transaction pooling mode, named prepared statements fail because the prepared statement is only registered on the connection that created it. Adding `?pgbouncer=true` instructs Prisma to disable named prepared statements and use unnamed statements instead.

---

## 3. Deep Dive 2: Non-Blocking Event-Driven I/O & `epoll`

### What is "I/O"?
**I/O = Input / Output.** Waiting on disk reads/writes or network sockets. Network I/O is orders of magnitude slower than CPU cycle speeds.

### Blocking I/O vs. Non-Blocking Event-Driven I/O
- **Blocking (1 Thread per Client):** A thread reads from a socket. If no data is available, the thread is put to sleep by the kernel. Serving 10,000 connections requires 10,000 threads, causing massive memory overhead and scheduler thrashing.
- **Non-Blocking Event-Driven (Single Thread with Multiplexing):** The process asks the OS: *"Monitor these 10,000 sockets. Notify me when any socket has data ready."* The process sleeps until an event arrives, processes the ready socket in microseconds, and returns to listening.

### How `epoll` Works (The Kernel Switchboard)
- **`poll()` / `select()` ($O(N)$):** The application must loop through every file descriptor in an array to check if it's readable. At 10,000 sockets, this burns CPU in linear loops.
- **`epoll` on Linux / `kqueue` on macOS ($O(1)$):** The Linux kernel maintains an interest list. When a network packet arrives, a hardware interrupt places that socket into a ready list. The kernel returns only the active sockets to the application.
- **Why this matters:** PgBouncer, Node.js, Redis, and Nginx all use event multiplexing (`epoll`), allowing them to manage tens of thousands of idle connections with minimal memory.

---

## 4. Deep Dive 3: Distributed WebSockets, Pub/Sub Limits & Lock System Design

### The Multi-Pod Isolation Problem
In production, an Application Load Balancer (ALB) balances traffic across multiple instances:
- User A connects to Pod 1; User B connects to Pod 2.
- In-memory Socket.IO rooms exist only within that process heap.
- When User A locks a seat, Pod 1 emits to its local room. User B on Pod 2 never gets the update.

---

### The Redis Adapter Architecture
Mounting `@socket.io/redis-adapter`:
1. When Pod 1 emits an event, it publishes it to a Redis Pub/Sub channel.
2. Redis broadcasts the packet to all active server pods.
3. Pod 2 receives the message from Redis and pushes it down User 2's WebSocket.

---

### The Ghost Worker Problem & Redis Emitter
Because workers run in a separate process (`worker.ts`) without an HTTP or Socket.IO server:
- When a 10-minute seat lock expires, the BullMQ worker cleans up the database.
- How does it broadcast `seat_unlocked`?
- **The Solution:** `@socket.io/redis-emitter`. The worker writes directly into Redis Pub/Sub, which routes the message to the API pods holding active user sockets.

In [src/sockets/index.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/sockets/index.ts):
```typescript
export const broadcastToShow = (showId: string, event: string, data: any): void => {
  try {
    if (io) {
      io.to(`show_${showId}`).emit(event, data);
    } else {
      getEmitter().to(`show_${showId}`).emit(event, data);
    }
  } catch (err) {
    console.error(`Failed to broadcast event "${event}" to show_${showId}:`, err);
  }
};
```

---

### System Design: Why Broadcast if Redis Holds the Lock?
If Redis is the single source of truth and will reject double-booking attempts, why broadcast seat locks over WebSockets?

1. **User Experience (The "Phantom Seat" Problem):** 
   Without WebSockets, Seat A1 remains visually available on other users' screens. Users spend time selecting seats and filling out checkout forms, only to receive a `409 Conflict` at the final payment step.
2. **Server Protection (Thundering Herd Shield):** 
   During high-demand sales, if Seat A1 is not disabled in real time, thousands of users will click it within seconds. This floods the API and Redis with thousands of doomed lock attempts. Real-time updates disable the seat on the client, preventing redundant lock requests.

---

### Critical Limitations: Fire-and-Forget & Sharded Pub/Sub (Redis 7)

#### 1. Fire-and-Forget Semantics:
Redis standard Pub/Sub has **zero persistence or message buffering**. 
- If a client has a 2-second network disconnect (e.g. driving through a tunnel) and misses a `seat_locked` event, that event is lost forever.
- **The Rule:** Clients **must re-fetch full seat state via REST/GraphQL upon reconnect**. WebSockets provide real-time diffs, but the initial state must always be fetched over HTTP.

#### 2. Redis Cluster Overhead & Sharded Pub/Sub:
- In a multi-node Redis Cluster, classic Pub/Sub broadcasts every message to **every node in the cluster**, creating inter-node traffic overhead.
- In **Redis 7+**, **Sharded Pub/Sub (`SPUBLISH` / `SSUBSCRIBE`)** routes messages only to the node that owns the hash slot of the channel (e.g. `{show_101}`). 
- For massive horizontal scale, `@socket.io/redis-streams-adapter` or sharded pub/sub can be adopted to avoid cluster-wide gossip traffic.

---

## 5. Deep Dive 4: WebSocket Production Tunings & DoS Hardening

In [src/sockets/index.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/sockets/index.ts#L22-L28):

```typescript
  io = new Server(server, {
    cors: { origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] },
    adapter: createAdapter(pubClient, subClient),
    transports: ['websocket'], // Disable polling connection churn

    // High-Scale Performance & Security Tunings
    maxHttpBufferSize: 4096,   // 4 KB max incoming packet (DoS protection)
    perMessageDeflate: false,  // Explicitly disable compression on tiny packets
    pingInterval: 25000,       // Keep-alive heartbeat every 25s
    pingTimeout: 20000,        // Drop dead connections after 20s
  });
```

### `maxHttpBufferSize` Tuning (DoS Hardening)
- `maxHttpBufferSize` is the **maximum accepted payload size for incoming packets from client to server**.
- It does not pre-allocate 1 MB per socket. Instead, Socket.IO's default 1 MB (`1e6`) threshold allows a rogue client to stream up to 1 MB before being rejected.
- Because our clients only send small events like `join_show: "show_123"` (~60 bytes), setting `maxHttpBufferSize: 4096` (4 KB) hardens the server against buffer bloat and memory exhaustion attacks.

### WebSocket Compression Defaults (`perMessageDeflate`)
- In Socket.IO v4, `perMessageDeflate` is already `false` by default.
- Setting `perMessageDeflate: false` explicitly guarantees that compression remains disabled.
- On small micro-payloads (40 bytes), zlib compression consumes unnecessary CPU and can increase the packet size due to compression framing overhead.

### Wire Payload Considerations
- `maxHttpBufferSize` only regulates incoming packets, not server outbound egress.
- For outbound broadcasts, keeping event payloads concise (e.g. `{ seatIds: ["A1"], status: "LOCKED" }`) reduces network serialization overhead when fanning out to thousands of connected clients.

---

## 6. Step-by-Step Implementation & Architecture

### Step 1: Global Prisma Client Singleton
- Bound Prisma to `globalThis` in [src/config/prisma.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/config/prisma.ts).
- Refactored `seat.service.ts`, `auth.controller.ts`, `sync.ts`, and `seed.ts` to import the shared singleton.

### Step 2: PgBouncer Integration in Docker Compose
- Added `pgbouncer` service to [docker-compose.yml](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/docker-compose.yml) on port `6432` in transaction pooling mode.
- Configured [prisma/schema.prisma](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/prisma/schema.prisma) with `directUrl` for migrations on port `5432`.
- Included `?pgbouncer=true` in `DATABASE_URL` to disable named prepared statements.

### Step 3: Horizontal Socket.IO with Redis Adapter & Tunings
- Installed `@socket.io/redis-adapter` and `@socket.io/redis-emitter`.
- Hardened buffer size (4 KB), enforced WebSockets transport, and implemented `broadcastToShow()`.

### Step 4: Process Decoupling (`server.ts` vs. `worker.ts`)
- Created [src/server.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/server.ts) for HTTP/WebSockets.
- Created [src/worker.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/worker.ts) for BullMQ background workers.

### Step 5: Cloud-Native Health Probes with Caching & Proper Shutdown Order
In [src/server.ts](file:///Users/mac/Desktop/TicketBlitz/TicketBlitz/src/server.ts):
1. **Critical vs. Non-Critical Readiness:**
   - **PostgreSQL & Redis:** Critical dependencies. If either is down, `/health/ready` returns `503 Service Unavailable`.
   - **Elasticsearch:** Auxiliary read dependency. If Elasticsearch fails, the check is marked `DEGRADED`, but the pod remains ready so ticket checkout continues functioning.
2. **Readiness Probe Caching:**
   - Cached the readiness probe result for **2 seconds** (`READINESS_CACHE_TTL_MS = 2000`). This prevents Kubernetes probes across 50 pods from generating hundreds of redundant `SELECT 1` queries against PostgreSQL.
3. **Multi-Stage Graceful Shutdown Order:**
   ```
   [SIGTERM Received]
          │
          ▼
   1. Fail Readiness Immediately (isShuttingDown = true -> /health/ready returns 503)
          │
          ▼
   2. Sleep 5 seconds (Allows Ingress / ALB / EndpointSlice to de-register the pod)
          │
          ▼
   3. Close HTTP Server (Drains active in-flight user requests)
          │
          ▼
   4. Disconnect Pools (Close Prisma & Redis connections cleanly)
   ```

---

## 7. Verification & File Inventory

### Verification Checklist
- [x] `npx tsc --noEmit` exits with **code 0** (0 type errors).
- [x] `npm run build` cleanly outputs `dist/server.js`, `dist/worker.js`, etc.
- [x] Exactly 1 `new PrismaClient` exists across the repository.
- [x] Socket.IO configured with 4 KB buffer, pure WebSockets, and Redis pub/sub adapter.
- [x] Multi-stage shutdown and probe caching implemented in `src/server.ts`.

### File Modification Inventory
| File | Action | Details |
| :--- | :--- | :--- |
| `src/config/prisma.ts` | Modified | Lines 1–14 (Global singleton) |
| `src/services/seat.service.ts` | Modified | Lines 1–4 (Import shared prisma) |
| `src/controllers/auth.controller.ts` | Modified | Lines 1–8 (Import shared prisma) |
| `src/sync.ts` | Modified | Lines 1–5 (Import shared prisma) |
| `src/seed.ts` | Modified | Lines 1–3 (Import shared prisma) |
| `prisma/schema.prisma` | Modified | Lines 5–9 (Added directUrl) |
| `docker-compose.yml` | Modified | Lines 20–40 (PgBouncer service) |
| `package.json` | Modified | Lines 7–13, 19–20 (Decoupled scripts & packages) |
| `src/sockets/index.ts` | Modified | Lines 1–80 (Redis adapter, 4 KB buffer, Emitter) |
| `src/jobs/seatUnlockWorker.ts` | Modified | Lines 7–33 (Universal broadcast & worker return) |
| `src/jobs/notificationWorker.ts` | Modified | Lines 6–24 (Worker return for graceful shutdown) |
| `src/index.ts` | Modified | Lines 1–3 (Re-export server) |
| `src/server.ts` | **NEW** | Lines 1–180 (Dedicated API server with probe caching & shutdown delay) |
| `src/worker.ts` | **NEW** | Lines 1–64 (Dedicated worker runner) |
| `.env.example` | **NEW** | Lines 1–26 (PgBouncer vs Direct URLs) |

---
*Maintained with pride by the TicketBlitz Engineering Team. Built to scale.*
