# Taskly v2.2.0 (Build 14) — Zero-Cost Architecture Specification

## 1. Architectural Philosophy

The Taskly Customer Support & Productivity System is engineered to operate reliably at production scale with **zero monthly cloud expenditure (₹0 / month)**. 

To achieve this, the architecture leverages:
1. **Zero-Billing Providers**: Platforms (Vercel Hobby, Supabase Free, Resend Free, GitHub Actions Free) that enforce hard execution caps rather than billing overages.
2. **Transactional Outbox Pattern**: Decoupling user actions from external email delivery, preventing slow API timeouts and guaranteeing at-least-once delivery.
3. **Dual-Trigger Asynchronous Processing**: Combining real-time opportunistic event execution with scheduled GitHub Actions cron jobs to eliminate the need for paid cloud scheduler instances.
4. **Autonomous In-App Support Chat**: Decoupling customer-developer communication from third-party email providers, ensuring zero loss of support capability when email quotas are depleted.

---

## 2. End-to-End System Topology

```mermaid
graph TB
    subgraph Clients ["Client Surfaces"]
        WebUser["Web App User<br/>(Desktop / Mobile Safari / Chrome)"]
        MobileUser["Mobile App User<br/>(Capacitor Android / iOS)"]
        DeveloperUser["Support Developer<br/>(tasklypets@gmail.com)"]
    end

    subgraph VercelEdge ["Vercel Edge Network (₹0)"]
        EdgeCDN["Edge Global Cache<br/>(index.html, styles.css, app.js)"]
        ServerlessApp["Serverless Node.js Express 5<br/>(api/index.js -> server.js)"]
    end

    subgraph SupabaseCloud ["Supabase PostgreSQL & Auth (₹0)"]
        AuthService["Supabase Auth<br/>(JWT Tokens, 50k MAU)"]
        PostgresDB[("PostgreSQL 15+<br/>(500 MB Storage, RLS Enforced)")]
        TableTickets["support_tickets"]
        TableMessages["support_ticket_messages"]
        TableOutbox["support_email_outbox"]
        TableEvents["inbound_webhook_events"]
    end

    subgraph EmailInfrastructure ["Resend Platform (₹0)"]
        ResendSend["Resend API<br/>(Outbound HTTPS Dispatch)"]
        ResendHook["Resend Inbound Webhook<br/>(Svix Signed POST)"]
    end

    subgraph AutomationRunner ["GitHub Free Infrastructure (₹0)"]
        GHACron["GitHub Actions Workflow<br/>(outbox-worker.yml - Every 30m)"]
    end

    WebUser -->|1. GET Static Assets| EdgeCDN
    WebUser -->|2. POST /api/support/tickets| ServerlessApp
    MobileUser -->|2. POST /api/support/tickets| ServerlessApp
    DeveloperUser -->|3. POST /api/support/developer/*| ServerlessApp

    ServerlessApp -->|Validate JWT| AuthService
    ServerlessApp -->|Atomic Stored Procedures| PostgresDB
    PostgresDB --- TableTickets
    PostgresDB --- TableMessages
    PostgresDB --- TableOutbox
    PostgresDB --- TableEvents

    ServerlessApp -->|4. Dispatch Outbox Batch| ResendSend
    ResendSend -->|5. Deliver Notification Email| DeveloperUser
    DeveloperUser -.->|6. Optional: Email Reply| ResendHook
    ResendHook -->|7. POST /api/support/resend-inbound| ServerlessApp

    GHACron -->|Periodic Wakeup: POST /outbox/process| ServerlessApp
```

---

## 3. Core Component Workflows

### 3.1 Ticket Creation & Transactional Enqueueing
```mermaid
sequenceDiagram
    autonumber
    actor Customer as Customer (In-App)
    participant API as Vercel Express API
    participant DB as Supabase PostgreSQL
    participant Outbox as support_email_outbox

    Customer->>API: POST /api/support/tickets (Bearer JWT)
    Note over API: Authenticates user identity via Supabase JWT
    API->>DB: CALL create_support_ticket_atomic(...)
    activate DB
    DB->>DB: Verify auth.uid() == p_user_id
    DB->>DB: INSERT INTO support_tickets (code: TK-XXXXXXXX)
    DB->>DB: INSERT INTO support_ticket_messages (sender: user)
    DB->>DB: INSERT INTO support_ticket_routing (routing_token)
    DB->>Outbox: INSERT INTO support_email_outbox (status: 'pending')
    DB-->>API: RETURN { success: true, ticket: {...} }
    deactivate DB
    API-->>Customer: 201 Created { ticket: {...} }
    
    Note over API: Asynchronous opportunistic trigger (setImmediate)
    API-)API: Trigger processOutboxBatch()
```

### 3.2 Outbox Processing & Delivery
```mermaid
sequenceDiagram
    autonumber
    participant Worker as Outbox Worker
    participant DB as Supabase PostgreSQL
    participant Resend as Resend API (Free Tier)
    actor Developer as Developer Inbox

    Worker->>DB: CALL claim_support_email_outbox_batch(batch_size=10, lease=60s)
    activate DB
    Note over DB: SELECT FOR UPDATE SKIP LOCKED
    DB-->>Worker: Return claimed batch (status: 'sending')
    deactivate DB

    loop For Each Email in Batch
        Worker->>Resend: POST /emails (Idempotency-Key: outbox_id)
        alt Success (200 OK)
            Resend-->>Worker: { id: "resend_msg_123" }
            Worker->>DB: CALL mark_outbox_success(id, "resend_msg_123")
            Resend->>Developer: Deliver Notification Email
        else Rate Limited (429)
            Resend-->>Worker: 429 Daily Quota Exceeded
            Note over Worker: classifyError() -> isRetryable: true
            Worker->>DB: CALL mark_outbox_failure(id, delay=3600s, permanent=false)
            Note over DB: Preserved in outbox for next quota window
        else Hard Reject (400 / Invalid Recipient)
            Resend-->>Worker: 400 Bad Request
            Note over Worker: classifyError() -> isRetryable: false
            Worker->>DB: CALL mark_outbox_failure(id, permanent=true)
            Note over DB: Dead-lettered (status: 'failed')
        end
    end
```

### 3.3 Inbound Email & In-App Dual Channels
```mermaid
flowchart TD
    subgraph InAppChannel ["Channel A: In-App Direct Support (100% Guaranteed ₹0)"]
        CustApp["Customer in Taskly Hub"]
        DevDash["Developer in Taskly Dashboard"]
        CustApp <-->|POST /api/support/tickets/:id/messages| DevDash
    end

    subgraph EmailChannel ["Channel B: Email Reply Pathway (Resend Free Tier)"]
        DevEmail["Developer Mailbox"]
        ResendWebhook["Resend Inbound Webhook"]
        SvixCheck{"Svix Signature<br/>& SPF/DKIM Valid?"}
        TokenCheck{"Routing Token Valid?"}
        IngestRPC["ingest_developer_reply_atomic()"]
        Quarantine["quarantined_inbound_messages"]

        DevEmail -->|Reply to notification| ResendWebhook
        ResendWebhook -->|POST /api/support/resend-inbound| SvixCheck
        SvixCheck -->|Yes| TokenCheck
        SvixCheck -->|No| Quarantine
        TokenCheck -->|Valid| IngestRPC
        TokenCheck -->|Invalid| Quarantine
    end

    IngestRPC --> TableMessages
```

---

## 4. Operational Guardrails

### 4.1 Memory & Execution Duration Bounds
- Node.js heap limit within Vercel Serverless Function: Default 1024 MB.
- Outbox batch size is hard-capped at **10 emails per run**.
- Database connection limits: Uses `@supabase/supabase-js` HTTP API and connection pooling, completely eliminating connection leaks.

### 4.2 Deduplication & Anti-Replay
- **Outbound Emails**: Uses a cryptographic SHA-256 deduplication key (`ticket-created-<ticketId>`) stored in `support_email_outbox.deduplication_key`. Unique index prevents duplicate rows.
- **Inbound Webhooks**: Uses `inbound_webhook_events.event_id` with atomic database claiming (`claim_inbound_webhook_event`). Replayed webhooks receive HTTP 200 with `{ status: "already_processed" }`.

### 4.3 Resilience to External Outages
- If Resend experiences downtime or revokes API access, the application remains fully functional.
- Customers can create tickets, view history, and exchange messages. Developers can view, filter, assign, and reply to tickets from the Developer Dashboard.
- Neither customer support nor core task management ever stops due to third-party email failures.

