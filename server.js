const express = require('express');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

// ── Platform-aware binary names ────────────────────────────────────────────────
const isWin = process.platform === 'win32';
const YTDLP_BIN  = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const FFMPEG_BIN = isWin ? 'ffmpeg.exe' : 'ffmpeg';

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// Global download state
let currentDownloadProgress = 0;
let downloadIsCompleted    = false;  // FIX: renamed (was "downloadCompleted", clashed with client fn name)
let downloadFilename       = '';
let currentStage           = 'Preparing';
let downloadStartTime      = null;
let currentDownloadProcess = null;
let downloadPaused         = false;

// ── Helpers ────────────────────────────────────────────────────────────────────
function resetDownloadState() {
    currentDownloadProgress = 0;
    downloadIsCompleted     = false;
    downloadFilename        = '';
    currentStage            = 'Preparing';
    downloadStartTime       = Date.now();
    downloadPaused          = false;
}

function getYtdlpPath() {
    // On Linux/Mac: prefer local ./yt-dlp, then fall back to system PATH
    const local = path.join(__dirname, YTDLP_BIN);
    if (fs.existsSync(local)) return local;
    return YTDLP_BIN; // rely on system PATH (e.g. apt-installed yt-dlp)
}

function getFfmpegPath() {
    const local = path.join(__dirname, FFMPEG_BIN);
    if (fs.existsSync(local)) return local;
    return null; // null = rely on system PATH (apt/brew ffmpeg)
}

// ── Normalise URL — converts Shorts URLs to standard watch URLs ───────────────
function normaliseYoutubeUrl(url) {
    // https://www.youtube.com/shorts/VIDEOID  →  https://www.youtube.com/watch?v=VIDEOID
    const shortsMatch = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]+)/);
    if (shortsMatch) {
        return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
    }
    return url;
}

// ── Test endpoint ──────────────────────────────────────────────────────────────
app.get('/api/test', (req, res) => {
    res.json({ status: 'Server is running', timestamp: new Date().toISOString() });
});

// ── Progress endpoint (was MISSING — client polls this every second) ──────────
app.get('/api/progress', (req, res) => {
    res.json({
        progress:  currentDownloadProgress,
        stage:     currentStage,
        completed: downloadIsCompleted,
        filename:  downloadFilename,
        paused:    downloadPaused
    });
});

// ── Formats endpoint ───────────────────────────────────────────────────────────
app.post('/api/formats', (req, res) => {
    const { url } = req.body;

    if (!url) return res.status(400).json({ error: 'URL is required' });

    const normalisedUrl = normaliseYoutubeUrl(url);
    const ytdlpPath = getYtdlpPath();
    if (!fs.existsSync(ytdlpPath) && ytdlpPath === YTDLP_BIN) {
        // might still be in PATH; spawn will error if not
    } else if (!fs.existsSync(ytdlpPath)) {
        return res.status(500).json({ error: `${YTDLP_BIN} not found. Run install.sh or download from https://github.com/yt-dlp/yt-dlp/releases` });
    }

    const ytdlp = spawn(ytdlpPath, ['-J', '--no-playlist', normalisedUrl], {
        windowsHide: true,
        cwd: __dirname
    });

    let output = '';
    let errorOutput = '';

    ytdlp.stdout.on('data', d => { output += d.toString(); });
    ytdlp.stderr.on('data', d => { errorOutput += d.toString(); });

    ytdlp.on('close', code => {
        if (code !== 0) {
            let msg = errorOutput || `yt-dlp exited with code ${code}`;
            if (errorOutput.includes('Video unavailable')) msg = 'Video is unavailable or private';
            else if (errorOutput.includes('network'))      msg = 'Network error – check your internet connection';
            else if (errorOutput.includes('regex'))        msg = 'Invalid YouTube URL format';
            return res.status(500).json({ error: msg });
        }

        try {
            const videoInfo = JSON.parse(output);

            const formats = videoInfo.formats.map(f => ({
                format_id:  f.format_id,
                ext:        f.ext,
                resolution: f.height ? `${f.height}p` : null,
                fps:        f.fps,
                filesize:   f.filesize,
                vcodec:     f.vcodec,
                acodec:     f.acodec
            }));

            const availableQualities = checkAvailableQualities(videoInfo.formats);

            const videoData = {
                title:       videoInfo.title        || 'Unknown Title',
                thumbnail:   videoInfo.thumbnail    || videoInfo.thumbnails?.[videoInfo.thumbnails.length - 1]?.url || null,
                duration:    videoInfo.duration     || 0,
                uploader:    videoInfo.uploader     || 'Unknown',
                view_count:  videoInfo.view_count   || 0,
                description: videoInfo.description  || '',
                upload_date: videoInfo.upload_date  || '',
                id:          videoInfo.id           || ''
            };

            res.json({ formats, videoInfo: videoData, availableQualities });
        } catch (e) {
            res.status(500).json({ error: 'Failed to parse video information' });
        }
    });

    ytdlp.on('error', err => {
        res.status(500).json({ error: `Failed to start yt-dlp: ${err.message}` });
    });
});

// ── Quality helpers ────────────────────────────────────────────────────────────
function checkAvailableQualities(formats) {
    const q = { '8k-hdr': false, '8k': false, '4k-hdr': false, '4k': false, fhd: false, hd: false, sd: false, audio: false };

    formats.forEach(f => {
        if (f.acodec && f.acodec !== 'none') q.audio = true;

        if (f.height) {
            if (f.height >= 4320) {
                q['8k'] = true;
                if (f.dynamic_range === 'hdr') q['8k-hdr'] = true;
            } else if (f.height >= 2160) {
                q['4k'] = true;
                if (f.dynamic_range === 'hdr') q['4k-hdr'] = true;
            } else if (f.height >= 1080) {
                q.fhd = true;
            } else if (f.height >= 720) {
                q.hd = true;
            } else if (f.height >= 480) {
                q.sd = true;
            }
        }
    });

    return q;
}

function getFormatString(quality, merge) {
    const m = !!merge;
    const map = {
        '8k-hdr': m ? 'bestvideo[height>=4320][dynamic_range=hdr]+bestaudio/bestvideo[height>=4320]+bestaudio/best[height>=4320]' : 'best[height>=4320][dynamic_range=hdr]/best[height>=4320]',
        '8k':     m ? 'bestvideo[height>=4320]+bestaudio/best[height>=4320]' : 'best[height>=4320]',
        '4k-hdr': m ? 'bestvideo[height>=2160][dynamic_range=hdr]+bestaudio/bestvideo[height>=2160]+bestaudio/best[height>=2160]' : 'best[height>=2160][dynamic_range=hdr]/best[height>=2160]',
        '4k':     m ? 'bestvideo[height>=2160]+bestaudio/best[height>=2160]' : 'best[height>=2160]',
        'fhd':    m ? 'bestvideo[height<=1080][height>=720]+bestaudio/best[height<=1080][height>=720]' : 'best[height<=1080][height>=720]',
        'hd':     m ? 'bestvideo[height<=720][height>=480]+bestaudio/best[height<=720][height>=480]'  : 'best[height<=720][height>=480]',
        'sd':     m ? 'bestvideo[height<=480]+bestaudio/best[height<=480]' : 'best[height<=480]',
        'audio':  'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio'
    };
    return map[quality] || 'best';
}

// ── Download endpoint ──────────────────────────────────────────────────────────
app.post('/api/download-quality', (req, res) => {
    const { url, quality, merge } = req.body;

    if (!url || !quality) return res.status(400).json({ error: 'URL and quality are required' });

    const normalisedUrl = normaliseYoutubeUrl(url);
    const ytdlpPath = getYtdlpPath();
    if (!fs.existsSync(ytdlpPath)) {
        return res.status(500).json({ error: `${YTDLP_BIN} not found. Please run setup first.` });
    }

    resetDownloadState();

    // FIX: pass `merge` correctly into checkQualityAvailability
    checkQualityAvailability(normalisedUrl, quality, merge, ytdlpPath)
        .then(({ isAvailable, availableQualities, formatString }) => {
            if (!isAvailable) {
                return res.status(400).json({
                    error: 'Requested quality not available for this video',
                    availableQualities
                });
            }
            startDownloadProcess(normalisedUrl, formatString, ytdlpPath, res);
        })
        .catch(err => {
            console.error('Quality check error:', err);
            res.status(500).json({ error: 'Failed to check quality availability' });
        });
});

async function checkQualityAvailability(url, quality, merge, ytdlpPath) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn(ytdlpPath, ['-J', '--no-playlist', url], {
            windowsHide: true,
            cwd: __dirname
        });

        let output = '';
        ytdlp.stdout.on('data', d => { output += d.toString(); });
        ytdlp.on('close', code => {
            if (code !== 0) { reject(new Error('Failed to get video info')); return; }
            try {
                const videoInfo = JSON.parse(output);
                const availableQualities = checkAvailableQualities(videoInfo.formats);
                const isAvailable  = availableQualities[quality] !== false;
                const formatString = getFormatString(quality, merge);  // FIX: was always `true`
                resolve({ isAvailable, availableQualities, formatString });
            } catch (e) { reject(e); }
        });
        ytdlp.on('error', reject);
    });
}

// ── Download process ───────────────────────────────────────────────────────────
function startDownloadProcess(url, formatString, ytdlpPath, res) {
    const downloadsPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });

    const ffmpegPath = getFfmpegPath();
    const args = [
        '-f', formatString,
        '-P', downloadsPath,
        '-o', '%(title)s.%(ext)s',
        '--merge-output-format', 'mp4',
        '--newline',
        '--no-playlist'
    ];

    // FIX: point yt-dlp at bundled ffmpeg if it exists
    if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));

    args.push(url);

    currentDownloadProcess = spawn(ytdlpPath, args, {
        windowsHide: true,
        cwd: __dirname
    });

    attachDownloadListeners();

    res.json({ success: true, message: 'Download started', processId: Date.now() });
}

function attachDownloadListeners() {
    if (!currentDownloadProcess) return;

    currentDownloadProcess.stdout.on('data', data => {
        const out = data.toString();

        if (downloadPaused) return;

        if (out.includes('[download]')) {
            if (out.includes('100%') || out.includes('100.0%')) {
                currentDownloadProgress = 100;
                currentStage = 'Download Complete';
            } else {
                currentStage = 'Downloading';
                const pct = out.match(/(\d+\.\d+)%/);
                if (pct) currentDownloadProgress = parseFloat(pct[1]);

                const spd = out.match(/at\s+([0-9.]+[KMGT]?iB\/s)/);
                if (spd) currentStage = `Downloading at ${spd[1]}`;
            }
        } else if (out.includes('[ffmpeg]') || out.includes('[Merger]')) {
            currentStage = 'Merging with ffmpeg';
            currentDownloadProgress = Math.max(currentDownloadProgress, 90);
        } else if (out.includes('has already been downloaded')) {
            downloadIsCompleted = true;
            currentStage = 'Complete';
            currentDownloadProgress = 100;
            const m = out.match(/\[download\] (.+) has already been downloaded/);
            if (m) downloadFilename = path.basename(m[1]);
        }
    });

    currentDownloadProcess.stderr.on('data', data => {
        const err = data.toString();
        if (err.includes('Deleting original file')) {
            currentStage = 'Finalizing';
            currentDownloadProgress = 95;
        }
    });

    currentDownloadProcess.on('close', code => {
        if (code === 0 && !downloadPaused) {
            setTimeout(findDownloadedFile, 1000);
        } else if (code !== 0 && !downloadPaused) {
            currentStage = 'Failed';
        }
        if (!downloadPaused) currentDownloadProcess = null;
    });

    currentDownloadProcess.on('error', () => {
        currentStage = 'Error';
        if (!downloadPaused) currentDownloadProcess = null;
    });
}

function findDownloadedFile() {
    const downloadsPath = path.join(__dirname, 'downloads');
    try {
        const files = fs.readdirSync(downloadsPath)
            .map(f => ({
                name: f,
                time: fs.statSync(path.join(downloadsPath, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);

        if (files.length > 0) {
            // Prefer a file modified after the download started
            const recent = files.find(f => f.time > downloadStartTime) || files[0];
            downloadFilename    = recent.name;
            downloadIsCompleted = true;
            currentStage        = 'Complete';
            currentDownloadProgress = 100;
        }
    } catch (e) {
        console.error('Error finding downloaded file:', e);
    }
}

// ── Pause / Resume / Cancel ────────────────────────────────────────────────────
app.post('/api/pause-download', (req, res) => {
    if (!currentDownloadProcess || downloadPaused) {
        return res.status(400).json({ error: downloadPaused ? 'Already paused' : 'No active download' });
    }
    try {
        downloadPaused = true;
        currentStage   = 'Paused';
        currentDownloadProcess.kill(isWin ? 'SIGTERM' : 'SIGSTOP');
        res.json({ success: true, message: 'Download paused' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to pause: ' + e.message });
    }
});

app.post('/api/resume-download', (req, res) => {
    if (!downloadPaused) return res.status(400).json({ error: 'No paused download to resume' });

    const { url, quality, merge } = req.body;
    if (!url || !quality) return res.status(400).json({ error: 'URL and quality required for resume' });

    const ytdlpPath = getYtdlpPath();
    if (!fs.existsSync(ytdlpPath)) return res.status(500).json({ error: `${YTDLP_BIN} not found` });

    try {
        downloadPaused = false;
        currentStage   = 'Resuming';

        const downloadsPath = path.join(__dirname, 'downloads');
        const ffmpegPath    = getFfmpegPath();
        const formatString  = getFormatString(quality, merge);

        const args = [
            '-f', formatString,
            '-P', downloadsPath,
            '-o', '%(title)s.%(ext)s',
            '--merge-output-format', 'mp4',
            '--newline',
            '--continue',
            '--no-playlist'
        ];
        if (ffmpegPath) args.push('--ffmpeg-location', path.dirname(ffmpegPath));
        args.push(url);

        currentDownloadProcess = spawn(ytdlpPath, args, { windowsHide: true, cwd: __dirname });
        attachDownloadListeners();

        res.json({ success: true, message: 'Download resumed' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to resume: ' + e.message });
    }
});

app.post('/api/cancel-download', (req, res) => {
    try {
        if (currentDownloadProcess) {
            currentDownloadProcess.kill('SIGKILL');
            currentDownloadProcess = null;
        }
        resetDownloadState();
        currentStage = 'Cancelled';
        res.json({ success: true, message: 'Download cancelled' });
    } catch (e) {
        res.status(500).json({ error: 'Failed to cancel: ' + e.message });
    }
});

// ── Utility endpoints (were MISSING) ──────────────────────────────────────────
app.post('/api/open-folder', (req, res) => {
    const downloadsPath = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsPath)) fs.mkdirSync(downloadsPath, { recursive: true });

    const cmd = isWin
        ? `explorer "${downloadsPath}"`
        : process.platform === 'darwin'
            ? `open "${downloadsPath}"`
            : `xdg-open "${downloadsPath}"`;

    exec(cmd, err => {
        if (err) return res.status(500).json({ error: 'Could not open folder: ' + err.message });
        res.json({ success: true });
    });
});

app.post('/api/open-file', (req, res) => {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Filename required' });

    const filePath = path.join(__dirname, 'downloads', path.basename(filename)); // security: basename only
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

    const folderPath = path.dirname(filePath);
    const cmd = isWin
        ? `explorer /select,"${filePath}"`
        : process.platform === 'darwin'
            ? `open -R "${filePath}"`
            : `xdg-open "${folderPath}"`;

    exec(cmd, err => {
        if (err) return res.status(500).json({ error: 'Could not open file location: ' + err.message });
        res.json({ success: true });
    });
});

app.get('/api/check-update', (req, res) => {
    const ytdlpPath = getYtdlpPath();
    if (!fs.existsSync(ytdlpPath)) {
        return res.status(500).json({ error: `${YTDLP_BIN} not found` });
    }

    const proc = spawn(ytdlpPath, ['--update'], { windowsHide: true, cwd: __dirname });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
        const updateAvailable = out.toLowerCase().includes('updating') || out.toLowerCase().includes('updated');
        res.json({ updateAvailable, message: out.trim() });
    });
    proc.on('error', err => res.status(500).json({ error: err.message }));
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ── Start server (FIX: was duplicated — only ONE listen call) ─────────────────
app.listen(port, () => {
    console.log('\n=================================');
    console.log('YouTube Downloader Server Started');
    console.log(`URL: http://localhost:${port}`);
    console.log(`Platform: ${process.platform}`);
    console.log(`yt-dlp binary: ${YTDLP_BIN}`);
    console.log('=================================\n');

    if (!fs.existsSync(path.join(__dirname, YTDLP_BIN))) {
        console.warn(`WARNING: Local ${YTDLP_BIN} not found. Will try system PATH. Run install.sh if needed.\n`);
    }

    const url   = `http://localhost:${port}`;
    const start = isWin ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    exec(`${start} ${url}`);
});
