# 🎟️ TicketBlitz

> A distributed movie ticket booking backend inspired by large-scale systems like **BookMyShow**.

TicketBlitz is a backend experiment focused on solving one core problem:

**How do you safely book seats when thousands of users try to reserve the same seat at the same time?**

The system combines **JWT Auth**,**Redis seat locking**, **transactional bookings**, **background workers**, **search indexing**, **email notifications**, and **real-time WebSocket updates**. 

--- 
## System Architecture 
```mermaid
flowchart LR

User --> API
API --> Redis
API --> Postgres
API --> WebSocket

Redis --> BullMQ
BullMQ --> Worker
Worker --> Redis

Postgres --> BookingDB[(Bookings)]
Redis --> SeatLocks[(Seat Locks)]
```
---
## Seat Lock / Unlock / Booking Flow Diagram
```mermaid
sequenceDiagram
    participant User
    participant API
    participant Postgres
    participant Redis
    participant BullMQ
    participant Worker
    participant WebSocket

    User->>API: POST /seats/lock

    API->>Postgres: Update ShowSeat (LOCKED, version++)
    API->>Redis: SET seat_lock NX EX 600
    API->>BullMQ: Schedule unlock job (10 min)
    API-->>User: Seat locked (10 min timer)

    Note over BullMQ,Worker: If user does NOT pay...

    BullMQ->>Worker: Trigger unlock job
    Worker->>Postgres: Check seat status

    alt Seat already BOOKED
        Worker->>Redis: Delete lock (cleanup)
    else Seat still LOCKED
        Worker->>Postgres: Update → AVAILABLE
        Worker->>Redis: Delete lock
        Worker->>WebSocket: Broadcast seat_unlocked
    end

    User->>API: POST /bookings/confirm

    API->>Postgres: Begin transaction
    API->>Postgres: Verify lock ownership
    API->>Postgres: Calculate price
    API->>Postgres: Create Booking + Payment
    API->>Postgres: Update seat → BOOKED
    API->>Redis: Delete lock
    API->>WebSocket: Broadcast seats_booked
    API-->>User: Booking confirmed 🎟️
```
---
# ✨ Key Features

### 🪑 Seat Locking Engine

Seats are locked in Redis when selected, preventing race conditions.

Lock flow:

```
User selects seat
        ↓
Seat locked in Redis
        ↓
Unlock job scheduled (BullMQ)
        ↓
User confirms booking
        ↓
Postgres transaction
        ↓
Seat marked BOOKED
```

---

### ⚡ Real-Time Seat Updates

Using **Socket.IO**, users viewing the same show receive instant updates when seat status changes.

Seat states:

```
AVAILABLE → LOCKED → BOOKED
```

---

### 📬 Email Notification System

Integrated using **Nodemailer**.

Email notifications can be sent for:

* booking confirmation
* booking failure
* ticket summary
* system notifications

Mail configuration lives in:

```
src/config/mail.ts
```

---

### 🔎 Search Engine

Movie and show searching is powered by **Elasticsearch**, enabling fast fuzzy searches.

---

### 🧠 Background Workers

Built using **BullMQ**.

Current jobs include:

* seat unlock worker
* notification worker
* async job processing

---

# 🏗 System Architecture

```
          Client
            │
            ▼
        API Server
            │
   ┌────────┼─────────┐
   ▼        ▼         ▼
Postgres   Redis   Elasticsearch
   │        │
   ▼        ▼
Bookings   Seat Locks
            │
            ▼
        BullMQ Workers
            │
            ▼
       Email Notifications
            │
            ▼
        WebSocket Events
```

---

# 🛠 Tech Stack

Backend
• Node.js
• TypeScript
• Express

Data Layer
• PostgreSQL
• Prisma ORM

Concurrency
• Redis
• BullMQ

Search
• Elasticsearch

Realtime
• Socket.IO

Notifications
• Nodemailer

Infrastructure
• Docker
• Docker Compose

Validation
• Zod

---

# 📂 Project Structure

```
src
├ config        infrastructure clients
├ controllers   HTTP request handlers
├ services      business logic
├ routes        API routing
├ jobs          queues + workers
├ sockets       websocket logic
├ middlewares   authentication
├ validators    request validation
└ utils         helper utilities
```

---

# 🚀 Project Initialization

### 1️⃣ Clone the repository

```
git clone https://github.com/Vishukaneki/ticketblitz.git
cd ticketblitz
```

---

### 2️⃣ Install dependencies

```
npm install
```

---

### 3️⃣ Setup environment variables

Create `.env`

Example:

```
PORT=3000

DATABASE_URL=postgresql://bms2:bms2password@localhost:5432/bms2db

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=bms2redis

JWT_SECRET=supersecret

ELASTIC_URL=http://localhost:9200

MAIL_HOST=smtp.example.com
MAIL_USER=user@example.com
MAIL_PASS=password
```

---

### 4️⃣ Start infrastructure services

```
docker compose up -d
```

Services started:

• PostgreSQL
• Redis
• Elasticsearch
• Kibana

---

### 5️⃣ Run Prisma migrations

```
npx prisma migrate dev
```

---

### 6️⃣ Seed the database

```
npx tsx src/seed.ts
```

---

### 7️⃣ Start the server

```
npm run dev
```

Server runs at:

```
http://localhost:3000
```

---

# 📡 API Examples

### Signup

```
POST /api/v1/auth/signup
```

Request

```json
{
  "email": "user@example.com",
  "password": "mypassword"
}
```

---

### Login

```
POST /api/v1/auth/login
```

Response

```json
{
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token"
}
```

---

### Lock Seats

```
POST /api/v1/seats/lock
```

Request

```json
{
  "showId": "show_123",
  "seatIds": ["A1","A2"]
}
```

---

### Confirm Booking

```
POST /api/v1/bookings/confirm
```

---

### Search Movies

```
GET /api/v1/search/movies?q=avatar
```

---

### Health Check

```
GET /health
```

---

# 📊 Load Testing (Example)

Simulated with **k6 / Artillery**.

Results sample:

```
Concurrent Users: 500
Average Response Time: 120ms
Seat Lock Success Rate: 99.8%
Failed Locks: 0.2%
```

The Redis lock system ensures minimal race conditions.

---

# 🧭 Roadmap

Planned expansions:

• React frontend
• Admin dashboard
• Venue owner panel
• Payment gateway integration
• analytics dashboards
• booking insights
• event driven architecture

---

# 🧩 Good First Issues

New contributors can start with:

• Add Swagger API documentation
• Add seat availability caching
• Implement booking cancellation flow
• Add email templates
• Improve search ranking
• Build frontend UI

---

# 🤝 Contributing

1 Fork the repo
2 Create a branch

```
git checkout -b feature/new-feature
```

3 Commit changes

```
git commit -m "Add new feature"
```

4 Push

```
git push origin feature/new-feature
```

5 Open Pull Request

---

# 🗺 Contribution Map

Future modules open for contributors:

Frontend
Admin Panel
Venue Dashboard
Analytics Service
Payment Integration
Load Testing Suite

---

# ⭐ Support

If this project helped you understand distributed backend systems, consider giving it a ⭐.

