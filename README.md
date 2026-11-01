# Taskly — Production-Ready Task Manager

Taskly is a modern, responsive, and minimalist task management web application designed for high-focus daily productivity. Built with Node.js and vanilla web technologies, Taskly delivers a lightweight, zero-bloat user experience alongside clean RESTful backend APIs and multi-environment data persistence:
- **Local Development**: Zero-setup local JSON file storage (`data/todos.json`) with atomic write protection.
- **Vercel Production**: High-performance, serverless PostgreSQL persistence via **Supabase**.
- **Container / GCP Cloud Run**: Cloud Firestore Native support.

---

## Features

- 📝 **Task Management**: Create, view, update, and delete tasks with real-time UI feedback.
- 📊 **Interactive Statistics Dashboard**: Real-time 4-card overview metrics (Total, Completed with %, Pending, and Overdue) with an interactive segmented progress bar.
- 🔍 **Dynamic Filtering**: Filter tasks by All, Pending, Overdue, and Done states with bidirectional synchronization between stat cards and filter tabs.
- ⏰ **Deadline & Due Date Tracking**: Assign due dates with automatic detection of overdue, due-today, and upcoming tasks.
- 🔤 **Live Character Counter**: Real-time title character counter that warns in bold red when titles exceed 50 characters.
- 🌓 **Adaptive Light & Dark Themes**: Modern White & Brightened Green light theme and a high-contrast Midnight Obsidian & Neon Green dark theme with persistent local storage.
- ⚡ **Lightweight Architecture**: Zero frontend bundle overhead—pure HTML5, modern CSS custom properties, and native ES6+ JavaScript.
- 🛡️ **Vercel Serverless & Supabase Ready**: Engineered for serverless environments where local filesystems are read-only (`/var/task`). Automatically routes through Supabase PostgreSQL over HTTPS.

---

## Technology Stack

- **Runtime**: Node.js (v20+ / v24+)
- **Backend Framework**: Express.js (v5.3.0)
- **Frontend**: Vanilla HTML5, CSS3 (Custom Design Tokens), JavaScript (ES6+ Fetch & DOM APIs)
- **Production Database**: Supabase PostgreSQL (via `@supabase/supabase-js`)
- **Local Database**: Local JSON (`data/todos.json`) with atomic write protection
- **Hosting & Serverless**: Vercel Serverless Functions (`api/index.js`, `vercel.json`) / Docker & Google Cloud Run ready
- **CI/CD**: GitHub Actions automated lint, syntax validation, and test runner

---

## Project Structure

```
ToDo/
├── .env.example                     # Environment variable template
├── .github/
│   └── workflows/
│       ├── ci.yml                   # CI pipeline (lint, automated test suite, Docker verify)
│       └── deploy-gcp.yml           # CD pipeline for Google Cloud Run
├── .gitignore                       # Git exclusion rules for node_modules, secrets, and backups
├── api/
│   └── index.js                     # Vercel Serverless Function entrypoint
├── vercel.json                      # Vercel URL rewrite rules for /api and static routes
├── Dockerfile                       # Multi-stage production container definition
├── .dockerignore                    # Container build exclusion rules
├── data/
│   ├── todos.json                   # Local development task storage (git-ignored)
│   └── todos.backup.json            # Permanent backup of initial tasks
├── public/
│   ├── index.html                   # Semantic single-page application markup
│   ├── styles.css                   # Theme variables, responsive styles, and animations
│   └── app.js                       # Client-side reactivity, optimistic UI, and API sync
├── scripts/
│   ├── supabase-schema.sql          # Copy-pasteable SQL schema for Supabase
│   ├── migrate-to-supabase.js       # Safe, idempotent Supabase migration utility
│   └── migrate-to-firestore.js      # Safe, idempotent Firestore migration utility
├── storage/
│   └── taskStore.js                 # Unified storage adapter (File, Supabase, Firestore)
├── tests/
│   ├── api.test.js                  # Production API & health check test suite (File & Supabase)
│   ├── storage.test.js              # Unit tests for all storage adapters
│   ├── supabase_migration.test.js   # Supabase migration test suite
│   └── migration.test.js            # Firestore migration idempotency test suite
├── server.js                        # Hardened Express.js REST API and static asset server
├── package.json                     # Dependencies, metadata, and lifecycle scripts
├── package-lock.json                # Deterministic dependency tree
└── README.md                        # Project documentation
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 20.0.0 or higher)
- [npm](https://www.npmjs.com/) (version 9.0.0 or higher)
- [Git](https://git-scm.com/)

### Local Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/vimaljayganthan/taskly-todo-app.git
   cd taskly-todo-app
   ```

2. **Install project dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```

4. **Start the local development server:**
   ```bash
   npm run dev
   ```
   Navigate to [http://localhost:3000](http://localhost:3000) in your browser. Tasks are saved locally to `data/todos.json`.

---

## Deploying to Vercel with Supabase PostgreSQL

### Step 1: Set Up Supabase Database

1. Sign in to [Supabase](https://supabase.com/) and create a new project.
2. In the Supabase Dashboard, open the **SQL Editor** from the left sidebar.
3. Open [`scripts/supabase-schema.sql`](scripts/supabase-schema.sql), copy its contents, paste them into the SQL Editor, and click **Run**.
4. Navigate to **Project Settings** -> **API** in Supabase and copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **anon / public key** (`eyJhbGciOi...`)

### Step 2: Configure Environment Variables in Vercel

In your [Vercel Project Dashboard](https://vercel.com/dashboard):
1. Navigate to **Settings** -> **Environment Variables**.
2. Add the following two variables (for `Production`, `Preview`, and `Development` environments):

| Variable Name | Value | Purpose |
| :--- | :--- | :--- |
| `SUPABASE_URL` | `https://<your-project-ref>.supabase.co` | Supabase API URL |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1Ni...` | Supabase Public / Anon API Key |

*(Optional)* You can also set `DATA_STORE=supabase`, though Taskly automatically detects Supabase when deployed on Vercel.

### Step 3: (Optional) Migrate Local Tasks to Supabase

To copy your initial tasks from `data/todos.json` into your Supabase database:

```bash
# Preview actions without writing (dry-run)
SUPABASE_URL="https://<ref>.supabase.co" SUPABASE_ANON_KEY="..." npm run migrate:supabase -- --dry-run

# Execute idempotent migration
SUPABASE_URL="https://<ref>.supabase.co" SUPABASE_ANON_KEY="..." npm run migrate:supabase
```

*Note: The migration script checks document IDs before inserting and never overwrites existing records.*

### Step 4: Deploy to Vercel

Push your code to your GitHub repository connected to Vercel, or deploy using the Vercel CLI:

```bash
vercel --prod
```

Vercel will build the project using [`vercel.json`](vercel.json) and serve API requests through [`api/index.js`](api/index.js).

---

## Environment Variable Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for local HTTP server (Cloud Run automatically sets `8080`) |
| `NODE_ENV` | `development` | Runtime environment (`development` or `production`) |
| `DATA_STORE` | `file` | Storage adapter mode: `file`, `supabase`, or `firestore` |
| `SUPABASE_URL` | None | Supabase project URL (Required in Vercel production) |
| `SUPABASE_ANON_KEY` | None | Supabase anon key (Required in Vercel production) |
| `GOOGLE_CLOUD_PROJECT` | `taskly-prod-202611` | GCP Project ID (Only needed if using Cloud Run) |

---

## Testing & Verification

Run the complete automated test suite across all storage adapters (File, Supabase, Firestore) and API routes:

```bash
npm test
```

Validate JavaScript syntax across all files:

```bash
node -c server.js
node -c api/index.js
node -c public/app.js
node -c storage/taskStore.js
node -c scripts/migrate-to-supabase.js
```

---

## REST API Specification

| Method | Endpoint | Description | Request Body | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/healthz` | Health check probe | None | `200 OK` `{"status":"UP", ...}` |
| `GET` | `/api/todos` | Retrieve all tasks | None | `Array<Todo>` |
| `POST` | `/api/todos` | Create a new task | `{"title": "string", "dueDate": "YYYY-MM-DD"}` | `201 Created` with new Todo |
| `PATCH` | `/api/todos/:id` | Update task status or fields | `{"completed": boolean, "title": "string", "dueDate": "string"}` | `200 OK` with updated Todo |
| `DELETE` | `/api/todos/:id` | Delete an individual task | None | `200 OK` `{"success": true, "id": "..."}` |
| `DELETE` | `/api/todos` | Bulk-delete completed tasks | None | `200 OK` `{"success": true, "count": N}` |

---

## Mobile Applications (Android & iOS with Capacitor)

Taskly can be built and run as native **Android** and **iOS** mobile applications using Capacitor. The mobile apps reuse the identical frontend and communicate directly with the live production backend (`https://taskly-todo-app-4z1c.vercel.app`), preserving all CRUD functionality and Supabase persistence without exposing any database secrets inside the client apps.

### Mobile Features
- **App Name**: `Taskly`
- **Application ID**: `com.taskly.app`
- **Branded App Icon & Splash Screen**: Emerald Green checkmark branding (`#10b981`) on Midnight Obsidian (`#0f172a`).
- **Safe Area Inset Support**: Full notch and dynamic island compatibility for iPhone and modern Android devices (`viewport-fit=cover`).
- **Dynamic Status Bar Styling**: Automatically switches between dark and light status bar themes to match the in-app theme toggle.
- **Native Android Back Button**: Navigates back in browser history or cleanly exits app.

### Building & Running on Android

1. **Prerequisites**: Install [Android Studio](https://developer.android.com/studio) and ensure the Android SDK is installed.
2. **Sync Web Assets & Plugins**:
   ```bash
   npm run cap:sync
   ```
3. **Open Android Project in Android Studio**:
   ```bash
   npm run cap:open:android
   ```
4. **Build & Run**:
   - In Android Studio, connect a physical device via USB or start an Android Virtual Device (AVD).
   - Click the green **Run (▶)** button or build an APK via **Build** -> **Build Bundle(s) / APK(s)** -> **Build APK(s)**.

### Building & Running on iOS

1. **Prerequisites**: macOS with [Xcode](https://developer.apple.com/xcode/) installed.
2. **Sync Web Assets & Plugins**:
   ```bash
   npm run cap:sync
   ```
3. **Open iOS Project in Xcode**:
   ```bash
   npm run cap:open:ios
   ```
4. **Build & Run**:
   - In Xcode, select your target simulator (e.g. iPhone 16 Pro) or your connected iPhone.
   - Select your Development Team under **Signing & Capabilities** in the target settings.
   - Click **Run (⌘ + R)**.

### Regenerating App Icons & Splash Screens
To recreate all multi-density native icons and splash screens:
```bash
npm run cap:assets
npm run cap:sync
```

---

## License

ISC License. See [package.json](package.json) for details.
