# Taskly — Production-Ready Task Manager

Taskly is a modern, responsive, and minimalist task management web application designed for high-focus daily productivity. Built with Node.js and vanilla web technologies, Taskly delivers a lightweight, zero-bloat user experience alongside clean RESTful backend APIs.

---

## Features

- 📝 **Task Management**: Create, view, update, and delete tasks with real-time UI feedback.
- 📊 **Interactive Statistics Dashboard**: Real-time 4-card overview metrics (Total, Completed with %, Pending, and Overdue) with an interactive segmented progress bar.
- 🔍 **Dynamic Filtering**: Filter tasks by All, Pending, Overdue, and Done states with bidirectional synchronization between stat cards and filter tabs.
- ⏰ **Deadline & Due Date Tracking**: Assign due dates with automatic detection of overdue, due-today, and upcoming tasks.
- 🔤 **Live Character Counter**: Real-time title character counter that warns in bold red when titles exceed 50 characters.
- 🌓 **Adaptive Light & Dark Themes**: Modern White & Brightened Green light theme and a high-contrast Midnight Obsidian & Neon Green dark theme with persistent local storage.
- ⚡ **Lightweight Architecture**: Zero frontend bundle overhead—pure HTML5, modern CSS custom properties, and native ES6+ JavaScript.

---

## Technology Stack

- **Runtime**: Node.js (v18+ / v20+ / v24+)
- **Backend Framework**: Express.js (v5.3.0)
- **Frontend**: Vanilla HTML5, CSS3 (Custom Design Tokens), JavaScript (ES6+ Fetch & DOM APIs)
- **Data Persistence**: JSON-based storage (`data/todos.json`)
- **Containerization**: Docker (multi-stage build ready)
- **Cloud Deployment**: Google Cloud Run / Google Cloud Platform (GCP)

---

## Project Structure

```
ToDo/
├── .env.example          # Sample environment variable template
├── .gitignore            # Git exclusion rules for node_modules, secrets, and logs
├── data/
│   └── todos.json        # Persistent task data (auto-seeded if missing)
├── public/
│   ├── index.html        # Semantic single-page application markup
│   ├── styles.css        # Theme variables, responsive styles, and animations
│   └── app.js            # Client-side reactivity, optimistic UI, and API sync
├── server.js             # Express.js REST API and static asset server
├── package.json          # Dependencies, metadata, and lifecycle scripts
├── package-lock.json     # Deterministic dependency tree
└── README.md             # Project documentation
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18.0.0 or higher)
- [npm](https://www.npmjs.com/) (version 9.0.0 or higher)
- [Git](https://git-scm.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/<repository-name>.git
   cd <repository-name>
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
| `PORT` | `3000` | Port on which the HTTP server listens (Cloud Run automatically sets this to `8080`) |
| `NODE_ENV` | `development` | Runtime environment (`development` or `production`) |

---

## Local Development

Start the server with Node's native file watcher for live reloading on file changes:

```bash
npm run dev
```

For standard production execution:

```bash
npm start
```

Once running, navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## Testing & Code Verification

Validate the JavaScript syntax and integrity of the application:

```bash
# Verify backend server syntax
node -c server.js

# Verify client-side application syntax
node -c public/app.js
```

---

## REST API Specification

| Method | Endpoint | Description | Request Body | Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/todos` | Fetch all tasks | None | `Array<Todo>` |
| `POST` | `/api/todos` | Create a new task | `{"title": "string", "dueDate": "YYYY-MM-DD"}` | `201 Created` with new Todo |
| `PATCH` | `/api/todos/:id` | Update task status or fields | `{"completed": boolean, "title": "string", "dueDate": "string"}` | `200 OK` with updated Todo |
| `DELETE` | `/api/todos/:id` | Delete an individual task | None | `200 OK` `{"success": true, "id": "..."}` |
| `DELETE` | `/api/todos` | Bulk-delete completed tasks | None | `200 OK` `{"success": true, "count": N}` |

---

## Google Cloud Platform (GCP) Deployment

This application is architected for frictionless containerized deployment to **Google Cloud Run**:

1. **Build Container Image:**
   ```bash
   gcloud builds submit --tag gcr.io/<PROJECT_ID>/taskly-app
   ```

2. **Deploy to Cloud Run:**
   ```bash
   gcloud run deploy taskly-app \
     --image gcr.io/<PROJECT_ID>/taskly-app \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated
   ```

3. **Production URL:**
   Google Cloud Run provides a managed HTTPS endpoint with automated TLS termination and auto-scaling to zero.

---

## License

ISC License. See [package.json](package.json) for details.
