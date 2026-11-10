# Taskly v2.2.0 — Free-Tier Limits & Cost Boundary Reference

This document provides an exhaustive reference of all free-tier allowances, provider quotas, overage behaviors, and operational guardrails for the Taskly production stack.

---

## 1. Provider Quota & Policy Matrix

| Service | Free Plan Name | Hard Limit / Monthly Allowance | Overage Behavior | Credit Card Required? | Charge Risk |
|---|---|---|---|:---:|:---:|
| **Vercel** | Hobby | 100 GB bandwidth<br>100k serverless function invocations/day<br>100 GB-hours function execution<br>1M Edge requests<br>10s max function duration | **Hard Cut-off**: Returns `HTTP 429 Too Many Requests` or pauses function invocations. Never bills overages on Hobby. | **No** | **₹0.00** |
| **Supabase** | Free Plan | 500 MB PostgreSQL database<br>50,000 Monthly Active Users (MAU)<br>5 GB bandwidth / egress<br>1 GB file storage<br>2 active projects<br>Pauses after 7 days of inactivity | **Hard Cut-off**: Spend Cap enabled by default. Requests beyond quota return errors or 429s. Never auto-upgrades to Pro ($25/mo). | **No** | **₹0.00** |
| **Resend** | Free Plan | 3,000 emails / month<br>100 emails / day<br>2 emails / second sending rate<br>1 custom domain or `resend.dev` onboarding domain | **Hard Cut-off**: Returns `HTTP 429` with message `daily quota exceeded` or `monthly quota exceeded`. Never auto-upgrades to Pro ($20/mo). | **No** | **₹0.00** |
| **GitHub Actions** | GitHub Free | 2,000 runner minutes / month (private repos)<br>Unlimited minutes (public repos)<br>20 concurrent jobs | **Hard Cut-off**: Spending limit defaults to $0.00. Workflows fail closed when quota runs out. Never auto-bills. | **No** | **₹0.00** |
| **Google Cloud Platform** | Free Tier Allowance | 2M Cloud Run requests<br>360k vCPU-sec, 180k GiB-sec<br>1 GB network egress<br>3 Cloud Scheduler jobs | **Automatic Billing**: Requires linked Cloud Billing Account. Artifact Registry storage ($0.10/GB), Cloud Build minutes ($0.003/min), egress ($0.12/GB), and Scheduler jobs over 3 auto-bill. Budget alerts do NOT stop workloads. | **Yes** | **UNSAFE FOR ₹0** |

---

## 2. Deep-Dive: Vercel Hobby Limits

Taskly runs its frontend as static assets on Vercel's global Edge Network, and its Express backend via the serverless bridge in `api/index.js`.

### 2.1 Consumption Metrics & Thresholds
- **Bandwidth**: 100 GB/month.
  - Taskly HTML, CSS, and JS total $\approx 180\text{ KB}$ uncompressed ($\approx 45\text{ KB}$ gzipped).
  - 100 GB bandwidth supports over **2,200,000 page visits per month**.
- **Serverless Invocations**: 100,000 invocations per day ($\approx 3,000,000\text{/month}$).
  - API routes (`/api/todos`, `/api/support/tickets`, etc.) only invoke serverless functions on dynamic API requests.
  - Typical user session generates $\approx 15\text{ API requests}$. 100k daily invocations easily supports up to 6,600 daily active users.
- **Function Execution Duration**: 10 seconds timeout limit.
  - Normal Taskly database queries resolve in $10 - 45\text{ ms}$.
  - Longest asynchronous operations (e.g., outbox batch dispatch) process in batches of 5-10, taking $< 1.5\text{ seconds}$.

### 2.2 What Happens If Limits Are Hit?
- Vercel rejects subsequent serverless calls with `HTTP 429 Too Many Requests`.
- Static assets remain accessible from cache.
- **Zero financial charge**: Vercel Hobby accounts do not have a credit card on file and cannot bill financial penalties.

---

## 3. Deep-Dive: Supabase Free Tier Limits

Supabase hosts Taskly's PostgreSQL database, Row Level Security engine, and Supabase Auth JWT service.

### 3.1 Storage & Quotas
- **Database Size**: 500 MB PostgreSQL.
  - Current schema (Todos + Habits + Customer Support): $\approx 4.5\text{ MB}$.
  - Support ticket overhead: $\approx 4\text{ KB}$ per ticket with conversation history.
  - Capacity: Up to 100,000 support tickets can reside in the database before reaching 80% capacity.
- **Authentication**: 50,000 Monthly Active Users (MAU).
  - Taskly's active user base is well within this limit.
- **Egress**: 5 GB / month.
  - JSON API payloads are small (average payload $< 2\text{ KB}$).
  - 5 GB permits $\approx 2,500,000$ API response cycles per month.
- **Connection Limits**:
  - Direct PostgreSQL connection limit: 15 connections.
  - Supavisor connection pooler: Up to 200 pooled connections on port 6543 (`pgbouncer` compatible).
  - Vercel serverless connections use connection pooling to avoid exhausting connection slots.

### 3.2 Inactivity Pausing Policy
- **Policy**: If a Free project experiences no database queries for 7 consecutive days, Supabase pauses the compute instance.
- **Impact on Data**: All tables, schema definitions, and data are stored safely on persistent storage and are **never deleted**.
- **Unpausing Procedure**:
  1. Log into the Supabase Dashboard (`app.supabase.com`).
  2. Select the paused project.
  3. Click the green **Restore Project** button.
  4. The project reactivates within 60 to 90 seconds.
- **Automated Prevention**: The scheduled GitHub Actions outbox workflow pings the health endpoint periodically, generating database query traffic that naturally keeps the project warm.

---

## 4. Deep-Dive: Resend Free Tier Limits

Resend delivers email notifications from `support@taskly.app` (or `onboarding@resend.dev`) to the customer and developer.

### 4.1 Strict Quotas
- **Daily Quota**: 100 emails / day.
- **Monthly Quota**: 3,000 emails / month.
- **Rate Limit**: 2 emails / second.

### 4.2 Fail-Safe Handling on Quota Exhaustion
1. **Application-Level Trapping**:
   - When the 100-email daily limit is reached, Resend's API responds with:
     ```json
     { "statusCode": 429, "message": "Daily email limit reached." }
     ```
   - In `services/retryStrategy.js`:
     ```javascript
     if (statusCode === 429) {
       return {
         isRetryable: true,
         isAmbiguous: false,
         statusCode: 429,
         message: `Rate limited by email provider (HTTP 429): ${msg}`,
         retryAfterSeconds: 3600 // Defer next attempt
       };
     }
     ```
2. **Outbox Durability**:
   - The message remains safely in `support_email_outbox` with status `pending`.
   - **Zero dropped messages**: Delivery is deferred until the 24-hour quota resets.
3. **In-App Messaging Continuity**:
   - Support tickets and conversations do **not** depend on email delivery.
   - Customers and developers interact via the Customer Support Hub and Developer Dashboard in real-time, even when the email quota is exhausted.

---

## 5. Google Cloud Platform: Why It Fails the ₹0 Constraint

Although Google Cloud Run offers an attractive "free allowance", it violates the strict ₹0 constraint for the following reasons:

1. **Mandatory Credit Card / Billing Account Linkage**:
   - Creating a Google Cloud project with Cloud Run and Artifact Registry requires adding an active credit card or bank account.
2. **Hidden Overage Vectors**:
   - **Artifact Registry Storage**: Storing container images (`asia-south1-docker.pkg.dev/...`) charges $\$0.10\text{/GB/month}$ for storage exceeding 0.5 GB. Each Node.js container image is $\approx 150 - 250\text{ MB}$; 3 image versions exceed the free storage cap.
   - **Cloud Build**: GitHub Actions or local builds pushed to GCP consume Cloud Build compute, billed at $\$0.003\text{/minute}$ after 120 free minutes/day.
   - **Network Egress**: Outbound network egress to the internet is billed at $\$0.12\text{/GB}$ after the first 1 GB.
   - **Cloud Scheduler**: 3 jobs are free per billing account. A 4th job or jobs created across projects incur $\$0.10\text{/month/job}$.
3. **No Automatic Kill-Switch**:
   - Google Cloud Budget Alerts do **not** stop services when the budget is reached. They only deliver webhook or email alerts. A DDoS attack or traffic surge will bill the linked card immediately.

**Conclusion**: Google Cloud Run is excluded from the ₹0 architecture. Vercel Hobby is the designated zero-cost production host.

