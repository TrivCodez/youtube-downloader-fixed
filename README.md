# 📥 YouTube Downloader (Fixed)

> Based on [Dharaneesh20/Simple-Youtube-Downloader](https://github.com/Dharaneesh20/Simple-Youtube-Downloader)  
> Fixed by LavaDev — see **Bug Fixes** section below.

---

## 🚀 Quick Start

### Windows
1. Install [Node.js](https://nodejs.org)
2. Place `yt-dlp.exe` and `ffmpeg.exe` in this folder (download from their official repos)
3. Run: `npm install` then `npm start`

### macOS / Linux
1. Install [Node.js](https://nodejs.org)
2. Run: `chmod +x setup.sh && ./setup.sh`  
   *(downloads yt-dlp automatically)*

---

## 🐛 Bug Fixes Applied

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `server.js` | **Double `app.listen()`** — server crashed with "address already in use" | Removed duplicate call |
| 2 | `server.js` | **`/api/progress` endpoint missing** — client polled it every second but server never defined it | Added endpoint |
| 3 | `server.js` | **`/api/open-folder` endpoint missing** — "Open Downloads Folder" button did nothing | Added endpoint |
| 4 | `server.js` | **`/api/open-file` endpoint missing** — history "open location" button threw 404 | Added endpoint |
| 5 | `server.js` | **`/api/check-update` endpoint missing** — "Check for Updates" link threw 404 | Added endpoint |
| 6 | `server.js` | **`merge` param ignored in `checkQualityAvailability`** — always passed `true` regardless of toggle | Fixed to pass actual value |
| 7 | `server.js` | **Windows-only binaries** — hardcoded `.exe`, broke on macOS/Linux | Auto-detect platform; use `yt-dlp` / `ffmpeg` on Unix |
| 8 | `server.js` | **ffmpeg not found by yt-dlp** — bundled `ffmpeg.exe` was never referenced in yt-dlp args | Added `--ffmpeg-location` when bundled binary exists |
| 9 | `script.js` | **`downloadCompleted` name clash** — both a `let` boolean and a `function` with the same name; boolean check in `pollProgress` always evaluated the function (truthy) | Renamed boolean to `downloadIsCompleted`, function to `onDownloadComplete` |
| 10 | `index.html` | **Stray `</p>` tag** in footer causing invalid HTML | Removed extra tag |
| 11 | `package.json` | **Private GitHub registry** in `publishConfig` broke `npm install` for public users | Removed `publishConfig` and scoped name |

---

## 🌟 Features

- 8K / 4K / FHD / HD / SD / HDR downloads
- Audio-only (M4A/AAC)
- Video + Audio merge via ffmpeg
- Pause / Resume / Cancel downloads
- Download history (localStorage)
- Cross-platform: Windows, macOS, Linux

---

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| `node` not found | Install Node.js from https://nodejs.org |
| `yt-dlp` not found | Run `setup.sh` (Linux/Mac) or download manually from https://github.com/yt-dlp/yt-dlp/releases |
| `ffmpeg` missing | Install via `brew install ffmpeg` or `sudo apt install ffmpeg`, or place binary in this folder |
| Port 3000 in use | Kill the process: `lsof -ti:3000 | xargs kill` (Linux/Mac) |

---

## Credits

Original by [Dharaneesh R.S](https://github.com/Dharaneesh20) — MIT License  
Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) & [FFmpeg](https://ffmpeg.org)
