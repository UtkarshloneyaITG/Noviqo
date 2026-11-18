# Noviqo

A real-time, multi-user session service: a FastAPI WebSocket backend that owns all
session state, a React + three.js web client, and MongoDB persistence so live
sessions survive a server restart.

## Stack

| Layer     | Technology                                   |
|-----------|----------------------------------------------|
| Backend   | Python 3.11+, FastAPI, WebSockets            |
| Storage   | MongoDB (via PyMongo async)                  |
| Frontend  | React 18, Vite, Zustand, React Three Fiber   |

## Project structure

```
├── backend/
│   ├── main.py                    # FastAPI app: WebSocket router, timers, reconnect handling
│   ├── storage.py                 # MongoDB persistence (live channels + history)
│   ├── core/                      # Session engine (pure logic, no I/O)
│   │   ├── session.py
│   │   ├── channel_manager.py
│   │   ├── member.py
│   │   ├── item.py
│   │   └── pool.py
│   ├── websocket/
│   │   └── connection_manager.py  # Socket ↔ member ↔ channel mapping, message delivery
│   └── tests/                     # pytest suites (engine, server, storage)
│
└── frontend/
    └── src/
        ├── App.jsx                # Root component
        ├── store/appStore.js      # Client state (Zustand)
        ├── hooks/useWebSocket.js  # Connection, offline queue, session resume
        ├── components/            # Screen-space UI
        ├── three/                 # 3D scene components
        └── styles/
```

## Getting started

Prerequisites: Python 3.11+, Node.js 18+.

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # macOS / Linux
pip install -r requirements.txt
cp .env.example .env           # then fill in DB (optional)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The server listens on `http://localhost:8000` with the WebSocket endpoint at `ws://localhost:8000/ws`.

### Frontend

```bash
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

## Configuration

| Variable      | Where             | Purpose |
|---------------|-------------------|---------|
| `DB`          | `backend/.env`    | MongoDB connection string. The database named in its path stores the `channels` (live state) and `history` collections. If unset, the server runs in memory only. |
| `VITE_WS_URL` | `frontend/.env`   | WebSocket URL of the backend, e.g. `ws://localhost:8000/ws` for local development or `wss://your-backend/ws` in production. |

`.env` files are gitignored; see the `.env.example` files.

## HTTP endpoints

| Method | Path      | Description                 |
|--------|-----------|-----------------------------|
| GET    | `/health` | Liveness check → `{"status": "ok"}` |
| GET    | `/rooms`  | Open channels that can be joined |

All other traffic is JSON messages over `/ws`.

## Tests

```bash
cd backend
pip install pytest httpx
python -m pytest tests/ -v
```

Tests run fully in memory and never connect to the configured database.

## Deployment

**Backend** (e.g. Render, Railway, Fly.io):

```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Set `DB` in the host's environment settings (`backend/render.yaml` declares it for Render).

**Frontend** (e.g. Vercel, Netlify): set `VITE_WS_URL`, run `npm run build`, and deploy `frontend/dist`.
