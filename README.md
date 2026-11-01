# Taskly — Production-Ready Task Manager

Taskly is a modern, responsive, and minimalist task management web application designed for high-focus daily productivity. Built with Node.js and vanilla web technologies, Taskly delivers a lightweight, zero-bloat user experience alongside clean RESTful backend APIs and dual-mode data persistence (Local JSON for development, Google Cloud Firestore for production).

---

## Features

- 📝 **Task Management**: Create, view, update, and delete tasks with real-time UI feedback.
- 📊 **Interactive Statistics Dashboard**: Real-time 4-card overview metrics (Total, Completed with %, Pending, and Overdue) with an interactive segmented progress bar.
- 🔍 **Dynamic Filtering**: Filter tasks by All, Pending, Overdue, and Done states with bidirectional synchronization between stat cards and filter tabs.
- ⏰ **Deadline & Due Date Tracking**: Assign due dates with automatic detection of overdue, due-today, and upcoming tasks.
- 🔤 **Live Character Counter**: Real-time title character counter that warns in bold red when titles exceed 50 characters.
- 🌓 **Adaptive Light & Dark Themes**: Modern White & Brightened Green light theme and a high-contrast Midnight Obsidian & Neon Green dark theme with persistent local storage.
- ⚡ **Lightweight Architecture**: Zero frontend bundle overhead—pure HTML5, modern CSS custom properties, and native ES6+ JavaScript.
- 🛡️ **Dual-Mode Persistence & Enterprise Safety**: Local JSON files for offline development; Google Cloud Firestore Native for multi-instance production with zero data loss and automated health probes.

---

## Technology Stack

- **Runtime**: Node.js (v20+ / v24+)
- **Backend Framework**: Express.js (v5.3.0)
- **Frontend**: Vanilla HTML5, CSS3 (Custom Design Tokens), JavaScript (ES6+ Fetch & DOM APIs)
- **Database (Production)**: Google Cloud Firestore (Native Mode)
- **Database (Development)**: Local JSON (`data/todos.json`) with atomic write protection
- **Containerization**: Multi-stage Docker (`node:20-alpine`, non-root security)
- **Cloud Platform**: Google Cloud Run (`asia-south1`, Mumbai)
- **CI/CD**: GitHub Actions with Workload Identity Federation (Zero long-lived keys)

---

## Project Structure

```
ToDo/
├── .env.example                     # Environment variable template
├── .github/
│   └── workflows/
│       ├── ci.yml                   # CI pipeline (lint, automated test suite, Docker verify)
│       └── deploy-gcp.yml           # CD pipeline (WIF auth, Artifact Registry, Cloud Run)
├── .gitignore                       # Git exclusion rules for node_modules, secrets, and backups
├── Dockerfile                       # Multi-stage production container definition
├── .dockerignore                    # Build optimization rules
├── data/
│   ├── todos.json                   # Local development task storage (git-ignored)
│   └── todos.backup.json            # Permanent backup of initial tasks
├── public/
│   ├── index.html                   # Semantic single-page application markup
│   ├── styles.css                   # Theme variables, responsive styles, and animations
│   └── app.js                       # Client-side reactivity, optimistic UI, and API sync
├── scripts/
│   └── migrate-to-firestore.js      # Non-destructive, idempotent Firestore migration utility
├── storage/
│   └── taskStore.js                 # Dual-mode repository adapter (File vs. Firestore)
├── tests/
│   ├── api.test.js                  # Production API & health check test suite
│   ├── storage.test.js              # FileStorage and Firestore mock test suite
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

### Installation

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

---

## Environment Variable Configuration

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port on which the HTTP server listens (Cloud Run injects `8080`) |
| `NODE_ENV` | `development` | Runtime environment (`development` or `production`) |
| `DATA_STORE` | `file` | Storage adapter mode (`file` or `firestore`) |
| `GOOGLE_CLOUD_PROJECT` | `taskly-prod-202611` | GCP Project ID for Firestore connection |
| `FIRESTORE_DATABASE_ID` | `(default)` | Firestore database ID |

---

## Local Development & Testing

Start the server with Node's native file watcher for live reloading on file changes:

```bash
npm run dev
```

For standard execution:

```bash
npm start
```

Run the complete automated test suite (API, Storage Adapters, Migration engine):

```bash
npm test
```

---

## Data Migration to Firestore

To safely migrate local tasks from `data/todos.json` to Google Cloud Firestore:

1. **Simulate migration (dry-run mode):**
   ```bash
   GOOGLE_CLOUD_PROJECT=taskly-prod-202611 node scripts/migrate-to-firestore.js --dry-run
   ```

2. **Execute live idempotent migration:**
   ```bash
   GOOGLE_CLOUD_PROJECT=taskly-prod-202611 npm run migrate:firestore
   ```

*Safety guarantee:* The migration script checks document IDs before writing, skips existing documents, never overwrites records, and preserves `data/todos.json`.

---

## REST API Specification

| Method | Endpoint | Description | Request Body | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/healthz` | Container health probe | None | `200 OK` `{"status":"UP", ...}` |
| `GET` | `/api/todos` | Retrieve all tasks | None | `Array<Todo>` |
| `POST` | `/api/todos` | Create a new task | `{"title": "string", "dueDate": "YYYY-MM-DD"}` | `201 Created` with Todo |
| `PATCH` | `/api/todos/:id` | Update task status or fields | `{"completed": boolean, "title": "string", "dueDate": "string"}` | `200 OK` with updated Todo |
| `DELETE` | `/api/todos/:id` | Delete an individual task | None | `200 OK` `{"success": true, "id": "..."}` |
| `DELETE` | `/api/todos` | Bulk-delete completed tasks | None | `200 OK` `{"success": true, "count": N}` |

---

## Deployment Architecture

* **Region:** `asia-south1` (Mumbai, India) for minimal latency (<35ms).
* **Compute:** Google Cloud Run (Fully managed, scales 0 to 5 instances, 512MB RAM, 1 vCPU).
* **Database:** Cloud Firestore Native Mode with transactional persistence.
* **Security:** GitHub Actions Workload Identity Federation (WIF) — zero stored private keys. Separate deployment and runtime service accounts following least privilege.

---

## License

ISC License. See [package.json](package.json) for details.
