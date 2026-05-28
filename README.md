# Watchman

Full-screen, browser-based camera wall for TP-Link VIGI (and any RTSP source).  
Password-protected, persistent login, zero re-encoding — built to run on low-power hardware.

## How it works

```
Browser ──► Node/Express (auth + proxy) ──► mediamtx (HLS) ──► cameras (RTSP)
```

[mediamtx](https://github.com/bluenviron/mediamtx) pulls RTSP from each camera and serves HLS segments. Express checks the session cookie before forwarding any stream request, so mediamtx is never exposed to the network. No video is re-encoded — the H.264 stream from the camera is re-segmented as-is, which is why this runs fine on a Raspberry Pi or mini PC.

## Requirements

- Docker + Docker Compose

## Quick start

```bash
cp .env.example .env
# Edit .env — set PASSWORD and add your camera RTSP URLs
docker compose up -d
```

Open `http://<host-ip>:3000`, enter your password.  
The login cookie lasts one year. Clear cookies or hit `/logout` to sign out.

## Configuration

All configuration is done through environment variables — either in `.env` or directly in `docker-compose.yml`.

### App variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PASSWORD` | yes | — | Password for the camera wall |
| `CAMERAS` | yes | — | Comma-separated list of `pathId:Label` pairs |
| `MEDIAMTX_URL` | no | `http://mediamtx:8888` | HLS server URL (internal) |
| `SESSION_SECRET` | no | random | HMAC secret for signing cookies. Set a fixed value to survive restarts. |
| `PORT` | no | `3000` | Port the app listens on |

**`CAMERAS` format:**
```
CAMERAS=cam1:Front Door,cam2:Back Yard,cam3:Garage
```
The `pathId` (e.g. `cam1`) must match the mediamtx path name used in `MTX_PATHS_CAM1_SOURCE`.

### Camera (mediamtx) variables

Add one per camera in the mediamtx service environment:

```yaml
MTX_PATHS_CAM1_SOURCE: "rtsp://admin:password@192.168.1.101/stream2"
MTX_PATHS_CAM2_SOURCE: "rtsp://admin:password@192.168.1.102/stream2"
```

Use `/stream2` (sub-stream) for the wall — it's lower resolution and saves bandwidth. Reserve `/stream1` for recording.

### TP-Link VIGI RTSP URL format

```
rtsp://<camera-user>:<camera-password>@<camera-ip>/stream1   # main stream
rtsp://<camera-user>:<camera-password>@<camera-ip>/stream2   # sub-stream
```

The camera user/password is the account you created in the VIGI app, not the admin panel password.

### Changing the port

To expose on a different host port (e.g. 8080), edit `docker-compose.yml`:

```yaml
ports:
  - "8080:3000"
```

## Adding or removing cameras

Edit `docker-compose.yml` (or `.env`), then:

```bash
docker compose up -d
```

No rebuild required — configuration is env-only. The grid layout adjusts automatically:
- 1 camera → 1 column
- 2–4 cameras → 2 columns
- 5+ cameras → 3 columns

## Local development

See the [Local dev](#local-dev) section below.

---

## Local dev

You need Node.js ≥ 18 and Docker (to run mediamtx only).

**1. Start mediamtx only:**

```bash
docker compose up mediamtx
```

**2. Install dependencies:**

```bash
npm install
```

**3. Set environment variables and start the app:**

```bash
cp .env.example .env
# Edit .env with your camera URLs and password

export $(grep -v '^#' .env | xargs)
node --watch server.js
```

Or with a tool like [`dotenv-cli`](https://github.com/entropitor/dotenv-cli):

```bash
npx dotenv-cli -e .env -- node --watch server.js
```

`--watch` (Node 18+) restarts on file changes — no nodemon needed.

Open `http://localhost:3000`.

**Testing without real cameras:**

You can feed mediamtx a test pattern using ffmpeg:

```bash
# Sends a colour-bar test stream to mediamtx as "cam1"
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=15 \
  -vcodec libx264 -tune zerolatency -preset ultrafast \
  -f rtsp rtsp://localhost:8554/cam1
```

Then set `CAMERAS=cam1:Test` and the wall will show the test pattern.
