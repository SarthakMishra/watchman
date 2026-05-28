# Watchman

Full-screen, browser-based camera wall for any RTSP source.  
Password-protected, persistent login — built to run on low-power hardware like a Raspberry Pi or mini PC.

<p align="center">
  <img src="docs/login.png" width="100%" alt="Login screen" />
  <img src="docs/watch.png" width="100%" alt="Camera wall" />
</p>

## How it works

```
Browser ──► Node/Express (auth + proxy) ──► mediamtx (HLS) ──► cameras (RTSP)
```

[mediamtx](https://github.com/bluenviron/mediamtx) pulls RTSP from each camera and serves HLS segments. Express validates the session cookie before forwarding any stream request, so mediamtx is never directly reachable from the network. When cameras output H.264, the stream is re-segmented as-is with no CPU cost. When cameras output H.265/HEVC, an ffmpeg transcoding step converts it to H.264 for browser compatibility — see [H.265 cameras](#h265-hevc-cameras) below.

## Requirements

- Docker + Docker Compose

## Quick start

```bash
cp .env.example .env
# Edit .env — set PASSWORD, PORT (optional), and add your camera RTSP URLs
docker compose up -d
```

Open `http://<host-ip>:3000` (or your custom port), enter your password.  
The login cookie lasts one year. Clear cookies or visit `/logout` to sign out.

## Configuration

All configuration is done through environment variables in `.env`. No rebuild is needed when changing `.env` — just run `docker compose up -d` to recreate the containers.

### App variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PASSWORD` | yes | — | Password to unlock the camera wall |
| `CAMERAS` | yes | — | Comma-separated `pathId:Label` pairs |
| `PORT` | no | `3000` | Host port exposed by the app |
| `MEDIAMTX_URL` | no | `http://mediamtx:8888` | HLS server URL (internal Docker address) |
| `SESSION_SECRET` | no | random | HMAC secret for signing cookies. Set a fixed value to keep sessions alive across container restarts. |

**`CAMERAS` format:**
```
CAMERAS=cam1:Front Door,cam2:Back Yard,cam3:Garage
```
The `pathId` (e.g. `cam1`) must match the mediamtx path name in your `MTX_PATHS_*` entries.

### Camera sources (mediamtx variables)

Add one entry per camera in `.env`. The path names (`CAM1`, `CAM2`, …) must match the ids used in `CAMERAS`.

**H.264 cameras** — pass-through, no transcoding:
```
MTX_PATHS_CAM1_SOURCE=rtsp://user:password@192.168.1.101/stream2
MTX_PATHS_CAM2_SOURCE=rtsp://user:password@192.168.1.102/stream2
```

**H.265/HEVC cameras** — see [H.265 cameras](#h265-hevc-cameras) below.

### RTSP URL format

```
rtsp://username:password@camera-ip/stream1   # main (high quality)
rtsp://username:password@camera-ip/stream2   # sub-stream (lower res, recommended for wall)
```

Use the sub-stream (`stream2`) for the camera wall — it uses far less bandwidth and CPU. Reserve the main stream for recording or NVR use.

> **Password contains `@`?** Percent-encode it as `%40` in the URL.  
> Example: `pass@word` → `rtsp://user:pass%40word@192.168.1.101/stream2`

### Grid layout

The grid adjusts automatically based on how many cameras are configured:
- 1 camera → 1 column
- 2–4 cameras → 2 columns
- 5+ cameras → 3 columns

---

## H.265 / HEVC cameras

Most browsers cannot decode H.265 streams. If your cameras output H.265 (common on many modern IP cameras), you need to transcode to H.264 using mediamtx's built-in ffmpeg support.

**Step 1** — switch the mediamtx image in `docker-compose.yml`:
```yaml
image: bluenviron/mediamtx:latest-ffmpeg
```

**Step 2** — in `.env`, use a `cam*src` / `cam*` path pair for each camera instead of a single `MTX_PATHS_CAM*_SOURCE` entry:

```
# cam1src = raw H.265 from camera (internal)
# cam1    = H.264 re-published by ffmpeg (what the browser plays)

MTX_PATHS_CAM1SRC_SOURCE=rtsp://user:password@192.168.1.101/stream2
MTX_PATHS_CAM1SRC_RUNONREADY=ffmpeg -loglevel error -rtsp_transport tcp -i rtsp://localhost:8554/cam1src -c:v libx264 -preset ultrafast -tune zerolatency -b:v 1000k -an -f rtsp rtsp://localhost:8554/cam1
MTX_PATHS_CAM1SRC_RUNONREADYRESTART=yes
```

Repeat for each camera, incrementing the number (`cam2src` → `cam2`, etc.). The `CAMERAS` env var and your browser-facing path names (`cam1`, `cam2`, …) stay the same — only the `.env` source entries change.

The `-preset ultrafast -b:v 1000k` flags keep CPU usage low on constrained hardware. Raise the bitrate if you need sharper image quality.

---

## Troubleshooting

### All cameras show "Offline" immediately

**Check mediamtx logs first:**
```bash
docker compose logs mediamtx
```

Common causes:

| Log message | Cause | Fix |
|---|---|---|
| `muxer instance crashed: Low-Latency HLS requires at least 7 segments` | `MTX_HLSSEGMENTCOUNT` set below 7 | Already fixed at 7 in `docker-compose.yml` — recreate the container: `docker compose up -d` |
| `RTSP source` connection errors | Wrong RTSP URL, credentials, or camera unreachable | Verify the URL with VLC before adding it |
| No `MTX_PATHS_*` entries in logs | Camera env vars not loaded | Run `docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}'` to check vars made it in |

### Cameras connect but browser still shows offline

The stream is likely H.265. Check the HLS playlist codec:
```bash
docker compose exec app wget -qO- http://mediamtx:8888/cam1/index.m3u8
```
If you see `hvc1` in the `CODECS=` field, the stream is H.265. Follow the [H.265 cameras](#h265-hevc-cameras) section above.

### Changes to `.env` not taking effect

Docker Compose bakes env vars into the container at start time. After editing `.env`, recreate the containers:
```bash
docker compose up -d
```
A plain `docker compose restart` does **not** re-read `.env`.

### Cookie-check redirect causes 404

mediamtx issues a `302` redirect on the first HLS playlist request with a `Location` header that omits the `/streams/` proxy prefix. The Express proxy rewrites this header automatically — this is already handled in `server.js` via `onProxyRes`. If you fork or modify the proxy, make sure this rewrite is preserved.

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

**3. Start the app with live reload:**
```bash
cp .env.example .env
# Edit .env with your camera URLs and password

export $(grep -v '^#' .env | xargs)
MEDIAMTX_URL=http://localhost:8888 node --watch server.js
```

Or using [`dotenv-cli`](https://github.com/entropitor/dotenv-cli):
```bash
npx dotenv-cli -e .env -- node --watch server.js
```

`--watch` (Node 18+) restarts on file changes — no nodemon needed.

> **Note:** Override `MEDIAMTX_URL` to `http://localhost:8888` when running the app outside Docker, since `http://mediamtx:8888` only resolves inside the Docker network.

**Testing without real cameras:**
```bash
# Push a test pattern into mediamtx as "cam1"
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=15 \
  -vcodec libx264 -tune zerolatency -preset ultrafast \
  -f rtsp rtsp://localhost:8554/cam1
```
Set `CAMERAS=cam1:Test` and the wall will show the colour-bar pattern.
