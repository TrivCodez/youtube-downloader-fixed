document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const urlInput       = document.getElementById('url-input');
    const fetchBtn       = document.getElementById('fetch-btn');
    const formatSelection = document.getElementById('format-selection');
    const qualityCards   = document.querySelectorAll('.quality-card');
    const mergeToggle    = document.getElementById('merge-toggle');
    const downloadProgress = document.getElementById('download-progress');
    const progressFill   = document.getElementById('progress-fill');
    const progressText   = document.getElementById('progress-text');
    const historyList    = document.getElementById('history-list');
    const updateBtn      = document.getElementById('update-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const openFolderBtn  = document.getElementById('open-folder-btn');

    let selectedQuality   = null;
    let videoFormats      = [];
    let currentVideoInfo  = null;
    let downloadInProgress = false;
    let isDownloadPaused  = false;
    let downloadProcessId = null;

    // FIX: renamed so it doesn't clash with the local function `onDownloadComplete`
    let progressPollInterval = null;

    testServerConnection();

    async function testServerConnection() {
        try {
            const r = await fetch('/api/test');
            if (!r.ok) throw new Error('Server returned ' + r.status);
        } catch (e) {
            showNotification('Server not responding. Please ensure the server is running.', 'error');
        }
    }

    // Ripple effect
    document.querySelectorAll('.btn').forEach(btn => btn.addEventListener('click', createRipple));

    function createRipple(e) {
        const button = e.currentTarget;
        const ripple = document.createElement('span');
        const rect   = button.getBoundingClientRect();
        const size   = Math.max(rect.width, rect.height);
        ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size/2}px;top:${e.clientY - rect.top - size/2}px`;
        ripple.classList.add('btn-ripple');
        button.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    }

    // Event listeners
    fetchBtn.addEventListener('click', fetchFormats);
    urlInput.addEventListener('keypress', e => { if (e.key === 'Enter') fetchFormats(); });
    qualityCards.forEach(card => card.addEventListener('click', () => selectQuality(card.dataset.quality, card)));
    if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);
    if (openFolderBtn)   openFolderBtn.addEventListener('click', openDownloadsFolder);
    if (updateBtn)       updateBtn.addEventListener('click', checkForUpdates);

    loadHistory();

    // ── Fetch formats ──────────────────────────────────────────────────────────
    async function fetchFormats() {
        const url = urlInput.value.trim();
        if (!url) { showNotification('Please enter a URL', 'error'); return; }
        if (!isValidYoutubeUrl(url)) { showNotification('Please enter a valid YouTube URL', 'error'); return; }

        const isShorts = /youtube\.com\/shorts\//i.test(url);
        if (isShorts) showNotification('YouTube Short detected — fetching formats...', 'info');

        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Fetching...</span>';

        try {
            const res  = await fetch('/api/formats', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await res.json();
            if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
            if (!Array.isArray(data.formats)) throw new Error('Invalid response format');

            videoFormats     = data.formats;
            currentVideoInfo = data.videoInfo;

            updateFormatSelectionWithVideo(currentVideoInfo, data.availableQualities);
            formatSelection.classList.remove('hidden');
            formatSelection.style.animation = 'slideInUp 0.8s ease';
            showNotification(`Found ${videoFormats.length} formats! Select quality to download.`, 'success');
        } catch (e) {
            showNotification('Error: ' + e.message, 'error');
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<i class="fas fa-search"></i> <span>Fetch Formats</span>';
        }
    }

    // ── Video info display ─────────────────────────────────────────────────────
    function updateFormatSelectionWithVideo(videoInfo, availableQualities = {}) {
        const titleEl = formatSelection.querySelector('h2');
        titleEl.textContent = 'Select Quality';

        let infoSection = formatSelection.querySelector('.video-info');
        if (!infoSection) {
            infoSection = document.createElement('div');
            infoSection.className = 'video-info';
            formatSelection.insertBefore(infoSection, formatSelection.querySelector('.quality-grid'));
        }

        const fmtDuration = s => {
            if (!s) return 'Unknown';
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
            return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
        };
        const fmtViews = n => {
            if (!n) return 'Unknown views';
            if (n >= 1e6) return `${(n/1e6).toFixed(1)}M views`;
            if (n >= 1e3) return `${(n/1e3).toFixed(1)}K views`;
            return `${n} views`;
        };

        infoSection.innerHTML = `
            <div class="video-thumbnail-container">
                ${videoInfo.thumbnail
                    ? `<img src="${videoInfo.thumbnail}" alt="thumbnail" class="video-thumbnail">
                       <div class="video-duration">${fmtDuration(videoInfo.duration)}</div>`
                    : `<div class="video-thumbnail-placeholder"><i class="fab fa-youtube"></i></div>`}
            </div>
            <div class="video-details">
                <h3 class="video-title">${videoInfo.title}</h3>
                <div class="video-meta">
                    <span class="video-uploader"><i class="fas fa-user"></i> ${videoInfo.uploader}</span>
                    <span class="video-views"><i class="fas fa-eye"></i> ${fmtViews(videoInfo.view_count)}</span>
                </div>
            </div>
        `;

        qualityCards.forEach(card => {
            const q = card.dataset.quality;
            const available = availableQualities[q];
            const unavail = (available === false);
            card.classList.toggle('unavailable', unavail);
            card.style.opacity = unavail ? '0.5' : '1';
            card.style.cursor  = unavail ? 'not-allowed' : 'pointer';

            let ind = card.querySelector('.unavailable-indicator');
            if (unavail && !ind) {
                ind = document.createElement('div');
                ind.className = 'unavailable-indicator';
                ind.innerHTML = '<i class="fas fa-times-circle"></i> Not Available';
                card.appendChild(ind);
            } else if (!unavail && ind) {
                ind.remove();
            }
        });
    }

    // ── Quality selection ──────────────────────────────────────────────────────
    function selectQuality(quality, cardElement) {
        if (cardElement.classList.contains('unavailable')) {
            showNotification('This quality is not available for this video.', 'warning');
            return;
        }
        if (downloadInProgress) {
            showNotification('Download already in progress', 'warning');
            return;
        }

        qualityCards.forEach(c => c.classList.remove('selected'));
        cardElement.classList.add('selected');
        selectedQuality    = quality;
        downloadInProgress = true;
        isDownloadPaused   = false;

        const msgs = {
            '8k-hdr': '8K HDR – Ultra Premium quality',
            '8k':     '8K – Maximum quality',
            '4k-hdr': '4K HDR – Premium HDR quality',
            '4k':     '4K – Ultra HD quality',
            'fhd':    'Full HD – 1080p quality',
            'hd':     'HD – 720p quality',
            'sd':     'SD – 480p quality',
            'audio':  'Audio Only – Best available audio'
        };
        showNotification(msgs[quality] || `Selected ${quality.toUpperCase()}`, 'info');
        setTimeout(startDownload, 1500);
    }

    // ── Start download ─────────────────────────────────────────────────────────
    async function startDownload() {
        if (!selectedQuality) { downloadInProgress = false; return; }

        formatSelection.style.animation = 'fadeOut 0.5s ease';
        setTimeout(() => {
            formatSelection.classList.add('hidden');
            downloadProgress.classList.remove('hidden');
            downloadProgress.style.animation = 'slideInUp 0.8s ease';
            setTimeout(addDownloadControls, 100);
        }, 500);

        progressFill.style.width = '0%';
        progressText.textContent = 'Preparing download...';

        try {
            const res  = await fetch('/api/download-quality', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url:     urlInput.value.trim(),
                    quality: selectedQuality,
                    merge:   mergeToggle.checked
                })
            });
            const data = await res.json();

            if (data.error) {
                if (data.error.includes('quality not available') || data.error.includes('No formats found')) {
                    showQualityUnavailableDialog(data.availableQualities);
                    return;
                }
                throw new Error(data.error);
            }

            downloadProcessId = data.processId;
            pollProgress();
        } catch (e) {
            showNotification('Download error: ' + e.message, 'error');
            downloadProgress.classList.add('hidden');
            formatSelection.classList.remove('hidden');
            downloadInProgress = false;
        }
    }

    // ── Progress polling ───────────────────────────────────────────────────────
    function pollProgress() {
        if (progressPollInterval) clearInterval(progressPollInterval);

        // Safety timeout: 10 minutes
        const safetyTimer = setTimeout(() => {
            clearInterval(progressPollInterval);
            showNotification('Download timeout – please check the downloads folder manually', 'warning');
            downloadProgress.classList.add('hidden');
            formatSelection.classList.remove('hidden');
            downloadInProgress = false;
        }, 600000);

        progressPollInterval = setInterval(async () => {
            try {
                const res  = await fetch('/api/progress');
                const data = await res.json();

                updateProgressUI(data.progress, data.stage || 'Downloading');

                if (data.completed && data.filename) {
                    clearInterval(progressPollInterval);
                    clearTimeout(safetyTimer);
                    onDownloadComplete(data.filename);  // FIX: renamed function (was "downloadCompleted")
                } else if (data.stage === 'Failed' || data.stage === 'Error') {
                    clearInterval(progressPollInterval);
                    clearTimeout(safetyTimer);
                    showNotification('Download failed. Please try again.', 'error');
                    downloadProgress.classList.add('hidden');
                    formatSelection.classList.remove('hidden');
                    downloadInProgress = false;
                }
            } catch (e) {
                clearInterval(progressPollInterval);
                clearTimeout(safetyTimer);
                showNotification('Lost connection to server', 'error');
                downloadInProgress = false;
            }
        }, 1000);
    }

    function updateProgressUI(pct, stage) {
        const safe = Math.min(Math.max(pct || 0, 0), 100);
        progressFill.style.width = `${safe}%`;

        const titleEl = downloadProgress.querySelector('.progress-container h2');
        if (stage.includes('Merg') || stage.includes('ffmpeg') || stage.includes('Finaliz')) {
            if (titleEl) titleEl.textContent = 'Processing Video...';
            progressText.textContent = `Merging: ${safe}%`;
        } else if (stage.includes('Complete')) {
            if (titleEl) titleEl.textContent = 'Download Complete!';
            progressText.textContent = 'Done!';
        } else if (stage.includes('Paused')) {
            progressText.textContent = 'Paused – click Resume to continue';
        } else {
            if (titleEl) titleEl.textContent = 'Downloading...';
            const spd = stage.match(/at\s+([0-9.]+[KMGT]?iB\/s)/);
            progressText.textContent = spd ? `Downloading: ${safe}% at ${spd[1]}` : `Downloading: ${safe}%`;
        }
    }

    // ── Download controls ──────────────────────────────────────────────────────
    function addDownloadControls() {
        const existing = downloadProgress.querySelector('.download-controls');
        if (existing) existing.remove();

        const ctrl = document.createElement('div');
        ctrl.className = 'download-controls';
        ctrl.innerHTML = `
            <button id="pause-btn"  class="btn secondary-btn control-btn"><i class="fas fa-pause"></i> <span>Pause</span></button>
            <button id="resume-btn" class="btn success-btn control-btn hidden"><i class="fas fa-play"></i> <span>Resume</span></button>
            <button id="cancel-btn" class="btn danger-btn control-btn"><i class="fas fa-times"></i> <span>Cancel</span></button>
        `;

        const anim = downloadProgress.querySelector('.download-animation');
        (anim || downloadProgress.querySelector('.progress-container')).insertAdjacentElement('afterend', ctrl);

        document.getElementById('pause-btn').addEventListener('click',  pauseDownload);
        document.getElementById('resume-btn').addEventListener('click', resumeDownload);
        document.getElementById('cancel-btn').addEventListener('click', cancelDownload);
    }

    async function pauseDownload() {
        const pauseBtn  = document.getElementById('pause-btn');
        const resumeBtn = document.getElementById('resume-btn');
        if (pauseBtn) pauseBtn.disabled = true;

        try {
            const res  = await fetch('/api/pause-download', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
                isDownloadPaused = true;
                pauseBtn?.classList.add('hidden');
                resumeBtn?.classList.remove('hidden');
                showNotification('Download paused', 'info');
            } else {
                throw new Error(data.error || 'Failed to pause');
            }
        } catch (e) {
            showNotification('Failed to pause: ' + e.message, 'error');
        } finally {
            if (pauseBtn) pauseBtn.disabled = false;
        }
    }

    async function resumeDownload() {
        const pauseBtn  = document.getElementById('pause-btn');
        const resumeBtn = document.getElementById('resume-btn');
        if (resumeBtn) resumeBtn.disabled = true;

        try {
            const res  = await fetch('/api/resume-download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: urlInput.value.trim(), quality: selectedQuality, merge: mergeToggle.checked })
            });
            const data = await res.json();
            if (data.success) {
                isDownloadPaused = false;
                resumeBtn?.classList.add('hidden');
                pauseBtn?.classList.remove('hidden');
                showNotification('Download resumed', 'info');
            } else {
                throw new Error(data.error || 'Failed to resume');
            }
        } catch (e) {
            showNotification('Failed to resume: ' + e.message, 'error');
        } finally {
            if (resumeBtn) resumeBtn.disabled = false;
        }
    }

    async function cancelDownload() {
        if (!confirm('Are you sure you want to cancel this download?')) return;

        const cancelBtn = document.getElementById('cancel-btn');
        if (cancelBtn) {
            cancelBtn.disabled = true;
            cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> <span>Cancelling...</span>';
        }

        try {
            const res  = await fetch('/api/cancel-download', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            if (data.success) {
                clearInterval(progressPollInterval);
                downloadInProgress = false;
                isDownloadPaused   = false;
                downloadProcessId  = null;
                downloadProgress.classList.add('hidden');
                formatSelection.classList.remove('hidden');
                selectedQuality = null;
                qualityCards.forEach(c => c.classList.remove('selected'));
                showNotification('Download cancelled', 'info');
            } else {
                throw new Error(data.error || 'Failed to cancel');
            }
        } catch (e) {
            showNotification('Failed to cancel: ' + e.message, 'error');
        } finally {
            if (cancelBtn) {
                cancelBtn.disabled = false;
                cancelBtn.innerHTML = '<i class="fas fa-times"></i> <span>Cancel</span>';
            }
        }
    }

    // ── On download complete (FIX: was named "downloadCompleted", conflicted with boolean var in original) ──
    function onDownloadComplete(filename) {
        if (progressPollInterval) clearInterval(progressPollInterval);

        updateProgressUI(100, 'Complete');

        downloadProgress.querySelector('.download-controls')?.remove();

        setTimeout(() => {
            downloadProgress.classList.add('hidden');
            showNotification(`Download complete: ${filename}`, 'success');

            if (filename && filename !== 'Download complete') {
                addToHistory(urlInput.value.trim(), selectedQuality, filename);
            }

            selectedQuality    = null;
            qualityCards.forEach(c => c.classList.remove('selected'));
            downloadInProgress = false;
            isDownloadPaused   = false;
            downloadProcessId  = null;

            createCelebrationParticles();
        }, 2000);
    }

    // ── Quality unavailable dialog ─────────────────────────────────────────────
    function showQualityUnavailableDialog(availableQualities) {
        const overlay = document.createElement('div');
        overlay.className = 'quality-dialog-overlay';
        overlay.innerHTML = `
            <div class="quality-dialog">
                <h3><i class="fas fa-exclamation-triangle"></i> Quality Not Available</h3>
                <p>The selected quality is not available for this video.</p>
                <p><strong>Available qualities:</strong></p>
                <div class="available-qualities">
                    ${Object.entries(availableQualities || {})
                        .filter(([,v]) => v)
                        .map(([k]) => `<button class="btn secondary-btn quality-option" data-quality="${k}">${k.toUpperCase()}</button>`)
                        .join('')}
                </div>
                <div class="dialog-actions">
                    <button class="btn danger-btn" id="dialog-cancel-btn">Cancel</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelectorAll('.quality-option').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedQuality = btn.dataset.quality;
                overlay.remove();
                startDownload();
            });
        });

        overlay.querySelector('#dialog-cancel-btn').addEventListener('click', () => {
            overlay.remove();
            resetDownloadState_client();
        });

        downloadInProgress = false;
        downloadProgress.classList.add('hidden');
        formatSelection.classList.remove('hidden');
    }

    function resetDownloadState_client() {
        downloadInProgress = false;
        isDownloadPaused   = false;
        selectedQuality    = null;
        qualityCards.forEach(c => c.classList.remove('selected'));
        downloadProgress.classList.add('hidden');
        formatSelection.classList.remove('hidden');
    }

    // expose for inline onclick fallback (not used but kept for safety)
    window.resetDownload = resetDownloadState_client;

    // ── History ────────────────────────────────────────────────────────────────
    function addToHistory(url, quality, filename) {
        let history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
        if (history.some(i => i.filename === filename && i.url === url)) return;

        const resMatch = filename.match(/(\d{3,4}p|\d+x\d+)/i);
        const actualQ  = resMatch ? `${quality} (${resMatch[1]})` : quality;

        history.unshift({
            url,
            quality: actualQ,
            filename,
            timestamp:    new Date().toLocaleString(),
            title:        currentVideoInfo?.title    || 'Unknown Title',
            thumbnail:    currentVideoInfo?.thumbnail || null,
            id:           Date.now() + Math.random(),
            duration:     currentVideoInfo?.duration  || 0,
            uploader:     currentVideoInfo?.uploader  || 'Unknown',
            downloadDate: new Date().toISOString()
        });

        if (history.length > 10) history = history.slice(0, 10);
        localStorage.setItem('downloadHistory', JSON.stringify(history));
        displayHistory();
    }

    function loadHistory() { displayHistory(); }

    function displayHistory() {
        const history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
        if (history.length === 0) {
            historyList.innerHTML = '<p class="empty-history">No downloads yet</p>';
            return;
        }

        historyList.innerHTML = '';
        history.forEach(item => {
            const fmtD = s => {
                if (!s) return '';
                const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
                return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
            };

            const el = document.createElement('div');
            el.className = 'history-item';
            el.innerHTML = `
                <div class="history-thumbnail">
                    ${item.thumbnail
                        ? `<img src="${item.thumbnail}" alt="Thumbnail">
                           ${item.duration ? `<div class="video-duration">${fmtD(item.duration)}</div>` : ''}`
                        : `<div class="history-placeholder"><i class="fab fa-youtube"></i></div>`}
                </div>
                <div class="history-info">
                    <strong class="history-title">${item.title || item.filename}</strong>
                    <div class="history-meta">
                        <span><i class="fas fa-video"></i> ${item.quality}</span>
                        <span><i class="fas fa-user"></i> ${item.uploader || 'Unknown'}</span>
                        <span><i class="fas fa-calendar"></i> ${new Date(item.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div class="history-filename">${item.filename}</div>
                </div>
                <div class="history-actions">
                    <button class="btn-small secondary-btn" title="Open file location" data-open="${item.filename}">
                        <i class="fas fa-folder-open"></i>
                    </button>
                    <button class="btn-small danger-btn" title="Remove from history" data-remove="${item.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;

            el.querySelector('[data-open]').addEventListener('click', () => openFileLocation(item.filename));
            el.querySelector('[data-remove]').addEventListener('click', () => removeFromHistory(item.id));

            historyList.appendChild(el);
        });
    }

    function openFileLocation(filename) {
        fetch('/api/open-file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        })
        .then(r => r.json())
        .then(d => showNotification(d.error || 'Opening file location', d.error ? 'error' : 'info'))
        .catch(() => showNotification('Error opening file location', 'error'));
    }

    function removeFromHistory(id) {
        if (!confirm('Remove this item from history?')) return;
        let history = JSON.parse(localStorage.getItem('downloadHistory') || '[]');
        history = history.filter(i => String(i.id) !== String(id));
        localStorage.setItem('downloadHistory', JSON.stringify(history));
        displayHistory();
        showNotification('Removed from history', 'info');
    }

    function clearHistory() {
        if (!confirm('Clear your entire download history?')) return;
        localStorage.removeItem('downloadHistory');
        displayHistory();
        showNotification('History cleared', 'success');
    }

    function openDownloadsFolder() {
        fetch('/api/open-folder', { method: 'POST' })
            .then(r => r.json())
            .then(d => showNotification(d.error || 'Opening downloads folder', d.error ? 'error' : 'info'))
            .catch(e => showNotification('Error: ' + e.message, 'error'));
    }

    function checkForUpdates() {
        fetch('/api/check-update')
            .then(r => r.json())
            .then(d => showNotification(
                d.error || (d.updateAvailable ? 'yt-dlp has been updated!' : 'yt-dlp is up to date!'),
                d.error ? 'error' : 'success'
            ))
            .catch(e => showNotification('Error checking for updates: ' + e.message, 'error'));
    }

    // ── Particles ──────────────────────────────────────────────────────────────
    function createCelebrationParticles() {
        for (let i = 0; i < 20; i++) {
            const p = document.createElement('div');
            Object.assign(p.style, {
                position: 'fixed', width: '6px', height: '6px',
                background: i % 2 === 0 ? 'var(--primary)' : 'var(--secondary)',
                borderRadius: '50%',
                left: Math.random() * window.innerWidth + 'px',
                top: window.innerHeight + 'px',
                pointerEvents: 'none', zIndex: '9999'
            });
            document.body.appendChild(p);
            p.animate([
                { transform: 'translateY(0) rotate(0deg)',       opacity: 1 },
                { transform: `translateY(-${window.innerHeight + 100}px) rotate(720deg)`, opacity: 0 }
            ], { duration: 3000 + Math.random() * 2000, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' })
            .onfinish = () => p.remove();
        }
    }

    // ── Notifications ──────────────────────────────────────────────────────────
    function showNotification(message, type = 'info') {
        const colors = { success: '#00e676', error: '#ff1744', warning: '#ff9800', info: '#0066ff' };
        const icons  = { success: 'check-circle', error: 'exclamation-circle', warning: 'exclamation-triangle', info: 'info-circle' };

        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.innerHTML = `<i class="fas fa-${icons[type] || icons.info}"></i><span>${message}</span>`;
        Object.assign(n.style, {
            position: 'fixed', bottom: '20px', right: '20px', padding: '1rem',
            borderRadius: '5px', color: 'white', boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            zIndex: '1000', transform: 'translateX(100%)', opacity: '0',
            transition: 'all 0.3s ease', display: 'flex', alignItems: 'center',
            gap: '0.5rem', backgroundColor: colors[type] || colors.info,
            maxWidth: '300px', wordWrap: 'break-word'
        });

        document.body.appendChild(n);
        requestAnimationFrame(() => { n.style.transform = 'translateX(0)'; n.style.opacity = '1'; });
        setTimeout(() => {
            n.style.transform = 'translateX(100%)'; n.style.opacity = '0';
            setTimeout(() => n.remove(), 300);
        }, 5000);
    }

    // ── URL validation ─────────────────────────────────────────────────────────
    function isValidYoutubeUrl(url) {
        return [
            /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/,
            /^(https?:\/\/)?(m\.)?youtube\.com\/.+/,
            /^(https?:\/\/)?youtu\.be\/.+/,
            /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/.+/   // YouTube Shorts
        ].some(p => p.test(url));
    }
});
