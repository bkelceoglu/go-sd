// Model & GPU Memory Manager (Lifecycle, Hot-Swap, Memory Reclamation & HuggingFace Hub)

import {
  fetchModels,
  loadModelStream,
  unloadModelStream,
  searchHFModels,
  downloadHFModel,
  fetchHFDownloadStatus,
  cancelHFDownload
} from './api.js?v=8';
import { state } from './state.js?v=8';

let isBusy = false;
let activeTab = 'local';
let hfQuery = '';
let hfPage = 1;
const hfLimit = 10;
let hfTotalPages = 1;
let hfHasLoaded = false;
let downloadPollTimer = null;
let activeDownloadsMap = {};

let toastCallback = null;
let statusUpdateCallback = null;

export function initModelManager(onStatusUpdated, showToastFn) {
  toastCallback = showToastFn;
  statusUpdateCallback = onStatusUpdated;

  // Tab Navigation Buttons
  const tabBtnLocal = document.getElementById('tabBtnLocal');
  const tabBtnHF = document.getElementById('tabBtnHF');

  if (tabBtnLocal) {
    tabBtnLocal.addEventListener('click', () => switchTab('local'));
  }
  if (tabBtnHF) {
    tabBtnHF.addEventListener('click', () => switchTab('hf'));
  }

  // Header quick Load / Unload action button
  const headerActionBtn = document.getElementById('modelActionBtn');
  if (headerActionBtn) {
    headerActionBtn.addEventListener('click', async () => {
      if (isBusy) return;
      if (state.status && state.status.ready) {
        await handleUnload(onStatusUpdated, showToastFn);
      } else {
        const modelSelect = document.getElementById('modelSelect');
        const customInput = document.getElementById('customModelInput');
        const customVal = customInput ? customInput.value.trim() : '';
        const targetModel = customVal || (modelSelect ? modelSelect.value : '');
        await handleLoad(targetModel, onStatusUpdated, showToastFn);
      }
    });
  }

  // Header Settings Button: switches to and highlights model panel
  const modelSettingsBtn = document.getElementById('modelSettingsBtn');
  if (modelSettingsBtn) {
    modelSettingsBtn.addEventListener('click', () => {
      switchTab('local');
      const panel = document.querySelector('.model-panel');
      if (panel) {
        panel.scrollIntoView({ behavior: 'smooth' });
        panel.style.boxShadow = '0 0 25px rgba(99, 102, 241, 0.4)';
        setTimeout(() => { panel.style.boxShadow = ''; }, 1200);
      }
    });
  }

  // Tab 1: Local Model Actions
  const modalLoadBtn = document.getElementById('modalLoadBtn');
  const modalUnloadBtn = document.getElementById('modalUnloadBtn');
  const customInput = document.getElementById('customModelInput');
  const modelSelect = document.getElementById('modelSelect');
  const refreshLocalBtn = document.getElementById('refreshLocalModelsBtn');

  if (modalLoadBtn) {
    modalLoadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      const customVal = customInput ? customInput.value.trim() : '';
      const selectedVal = modelSelect ? modelSelect.value : '';
      const targetModel = customVal || selectedVal;
      await handleLoad(targetModel, onStatusUpdated, showToastFn);
    });
  }

  if (modalUnloadBtn) {
    modalUnloadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      await handleUnload(onStatusUpdated, showToastFn);
    });
  }

  if (refreshLocalBtn) {
    refreshLocalBtn.addEventListener('click', () => {
      refreshModelsList();
      if (showToastFn) showToastFn('Local checkpoints rescanned', 'info', 3000);
    });
  }

  // Tab 2: HuggingFace Hub Search & Controls
  initHFHubControls();
}

function switchTab(tab) {
  activeTab = tab;
  const tabBtnLocal = document.getElementById('tabBtnLocal');
  const tabBtnHF = document.getElementById('tabBtnHF');
  const tabContentLocal = document.getElementById('tabContentLocal');
  const tabContentHF = document.getElementById('tabContentHF');

  if (tab === 'local') {
    if (tabBtnLocal) tabBtnLocal.classList.add('active');
    if (tabBtnHF) tabBtnHF.classList.remove('active');
    if (tabContentLocal) tabContentLocal.classList.add('active');
    if (tabContentHF) tabContentHF.classList.remove('active');
  } else {
    if (tabBtnHF) tabBtnHF.classList.add('active');
    if (tabBtnLocal) tabBtnLocal.classList.remove('active');
    if (tabContentHF) tabContentHF.classList.add('active');
    if (tabContentLocal) tabContentLocal.classList.remove('active');

    if (!hfHasLoaded) {
      loadHFModels();
    }
  }
}

// ==========================================
// LOCAL MODELS (TAB 1)
// ==========================================

export async function refreshModelsList() {
  try {
    const models = await fetchModels();
    populateModelsDropdown(models);
  } catch (err) {
    console.warn('[MODEL MGR] Failed to scan models:', err);
  }
}

export function populateModelsDropdown(models) {
  const select = document.getElementById('modelSelect');
  const countBadge = document.getElementById('installedCountBadge');
  const container = document.getElementById('installedModelsList');

  if (countBadge) {
    countBadge.textContent = `${models ? models.length : 0} detected`;
  }

  if (select) {
    select.innerHTML = '';
    if (!models || models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No safetensors found in models folders';
      select.appendChild(opt);
    } else {
      models.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.path;
        opt.textContent = `${m.name} (${m.size_gb} GB)${m.is_active ? ' — Active' : ''}`;
        if (m.is_active) opt.selected = true;
        select.appendChild(opt);
      });
    }
  }

  // Render cards in installed models list
  if (container) {
    container.innerHTML = '';
    if (!models || models.length === 0) {
      container.innerHTML = `
        <div class="empty-state-subtle" style="padding: 16px; text-align: center; color: var(--text-dim); font-size: 11px;">
          No local safetensors checkpoints found.<br>Use <strong>HuggingFace Hub</strong> tab to download one!
        </div>`;
      return;
    }

    models.forEach((m) => {
      const card = document.createElement('div');
      card.className = `installed-card ${m.is_active ? 'active-model' : ''}`;

      const origin = m.path.includes('sdnext') ? 'SD.Next' : 'models/Stable-diffusion';

      card.innerHTML = `
        <div class="installed-card-info">
          <span class="installed-card-title" title="${m.path}">${m.name}</span>
          <div class="installed-card-meta">
            <span class="meta-pill">${m.size_gb} GB</span>
            <span class="meta-pill">${origin}</span>
          </div>
        </div>
        <div class="installed-card-action">
          ${m.is_active
            ? `<span class="card-badge-active">● Active</span>`
            : `<button type="button" class="btn-card-load" data-path="${m.path}">⚡ Load</button>`
          }
        </div>
      `;

      const loadBtn = card.querySelector('.btn-card-load');
      if (loadBtn) {
        loadBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isBusy) return;
          await handleLoad(m.path, statusUpdateCallback, toastCallback);
        });
      }

      container.appendChild(card);
    });
  }
}

export function updateModelUI(status) {
  const deviceBadge = document.getElementById('deviceBadge');
  const deviceText = document.getElementById('deviceText');
  const modelText = document.getElementById('modelText');
  const headerActionBtn = document.getElementById('modelActionBtn');
  const headerActionIcon = document.getElementById('modelActionIcon');
  const headerActionText = document.getElementById('modelActionText');

  const panelStatusDot = document.getElementById('panelModelStatusDot');
  const panelStatusText = document.getElementById('panelModelStatusText');
  const modalStatusBadge = document.getElementById('modalStatusBadge');
  const modalDeviceText = document.getElementById('modalDeviceText');
  const modalActiveModelText = document.getElementById('modalActiveModelText');
  const genBtnText = document.getElementById('genBtnText');
  const genBtn = document.getElementById('generateBtn');

  if (status.ready) {
    // Loaded State
    if (deviceBadge) {
      deviceBadge.className = 'status-badge xpu';
      if (deviceText) deviceText.textContent = `Online: ${status.device.toUpperCase()}`;
    }
    if (modelText) modelText.textContent = status.model || 'SDXL Active';

    if (panelStatusDot) {
      panelStatusDot.className = 'status-indicator active';
      if (panelStatusText) panelStatusText.textContent = 'Active (In VRAM)';
    }

    if (headerActionBtn) {
      headerActionBtn.className = 'btn-model-action unload';
      headerActionBtn.title = 'Unload model & free GPU memory';
      if (headerActionIcon) headerActionIcon.textContent = '🧹';
      if (headerActionText) headerActionText.textContent = 'Unload';
    }

    if (modalStatusBadge) {
      modalStatusBadge.className = 'telemetry-badge active';
      modalStatusBadge.textContent = 'Active / In Memory';
    }
    if (modalDeviceText) modalDeviceText.textContent = `Intel Arc ${status.device.toUpperCase()} (bfloat16)`;
    if (modalActiveModelText) modalActiveModelText.textContent = status.model || 'SDXL Loaded';

    if (genBtn) {
      genBtn.disabled = state.isGenerating;
      genBtn.classList.remove('standby');
      genBtn.classList.add('ready');
    }
    if (genBtnText && !state.isGenerating) {
      genBtnText.textContent = '✨ Generate Artwork';
    }
  } else {
    // Standby / Unloaded State
    if (deviceBadge) {
      deviceBadge.className = 'status-badge standby';
      if (deviceText) deviceText.textContent = `Standby: ${status.device.toUpperCase()}`;
    }
    if (modelText) modelText.textContent = 'Standby (No Model)';

    if (panelStatusDot) {
      panelStatusDot.className = 'status-indicator standby';
      if (panelStatusText) panelStatusText.textContent = 'Standby (0 MB)';
    }

    if (headerActionBtn) {
      headerActionBtn.className = 'btn-model-action load';
      headerActionBtn.title = 'Load model into GPU VRAM';
      if (headerActionIcon) headerActionIcon.textContent = '⚡';
      if (headerActionText) headerActionText.textContent = 'Load Model';
    }

    if (modalStatusBadge) {
      modalStatusBadge.className = 'telemetry-badge standby';
      modalStatusBadge.textContent = 'Standby (0 MB VRAM)';
    }
    if (modalDeviceText) modalDeviceText.textContent = `Intel Arc ${status.device.toUpperCase()} (Ready)`;
    if (modalActiveModelText) modalActiveModelText.textContent = 'None (Memory Cleared)';

    if (genBtn) {
      genBtn.disabled = false;
      genBtn.classList.remove('ready');
      genBtn.classList.add('standby');
    }
    if (genBtnText && !state.isGenerating) {
      genBtnText.textContent = '⚡ Load Model to Generate';
    }
  }
}

async function handleLoad(modelPath, onStatusUpdated, showToastFn) {
  isBusy = true;
  setControlsBusy(true, 'Loading Model...');
  showProgressBars(true, 'Initializing diffusion worker...', 5);

  try {
    await loadModelStream(
      modelPath,
      (prog) => {
        const pct = prog.percentage || 10;
        const msg = prog.message || 'Loading checkpoint components...';
        updateProgressDisplay(msg, pct);
      },
      (readyData) => {
        updateProgressDisplay('Engine active on GPU!', 100);
        setTimeout(() => {
          showProgressBars(false);
          isBusy = false;
          setControlsBusy(false);

          state.status.ready = true;
          state.status.model = readyData.model || 'SDXL Model';
          state.status.device = readyData.device || 'xpu';

          updateModelUI(state.status);
          refreshModelsList();
          if (onStatusUpdated) onStatusUpdated(state.status);
          if (showToastFn) {
            showToastFn(`Model loaded successfully on ${readyData.device.toUpperCase()}!`, 'success', 6000);
          }
        }, 600);
      },
      (errMsg) => {
        showProgressBars(false);
        isBusy = false;
        setControlsBusy(false);
        if (showToastFn) showToastFn(`Model load failed: ${errMsg}`, 'error', 15000);
      }
    );
  } catch (err) {
    showProgressBars(false);
    isBusy = false;
    setControlsBusy(false);
    if (showToastFn) showToastFn(err.message || 'Model load failed', 'error', 15000);
  }
}

async function handleUnload(onStatusUpdated, showToastFn) {
  isBusy = true;
  setControlsBusy(true, 'Unloading...');
  showProgressBars(true, 'Stopping worker & flushing Intel Arc VRAM...', 20);

  try {
    await unloadModelStream(
      (prog) => {
        const pct = prog.percentage || 50;
        const msg = prog.message || 'Releasing GPU memory...';
        updateProgressDisplay(msg, pct);
      },
      () => {
        updateProgressDisplay('Memory released successfully!', 100);
        setTimeout(() => {
          showProgressBars(false);
          isBusy = false;
          setControlsBusy(false);

          state.status.ready = false;
          state.status.model = '';

          updateModelUI(state.status);
          refreshModelsList();
          if (onStatusUpdated) onStatusUpdated(state.status);
          if (showToastFn) {
            showToastFn('Model unloaded. GPU & System RAM completely cleared.', 'info', 6000);
          }
        }, 600);
      },
      (errMsg) => {
        showProgressBars(false);
        isBusy = false;
        setControlsBusy(false);
        if (showToastFn) showToastFn(`Unload failed: ${errMsg}`, 'error', 15000);
      }
    );
  } catch (err) {
    showProgressBars(false);
    isBusy = false;
    setControlsBusy(false);
    if (showToastFn) showToastFn(err.message || 'Model unload failed', 'error', 15000);
  }
}

function setControlsBusy(busy, text = '') {
  const headerActionBtn = document.getElementById('modelActionBtn');
  const headerActionText = document.getElementById('modelActionText');
  const modalLoadBtn = document.getElementById('modalLoadBtn');
  const modalUnloadBtn = document.getElementById('modalUnloadBtn');
  const genBtn = document.getElementById('generateBtn');

  if (headerActionBtn) {
    if (busy) {
      headerActionBtn.classList.add('loading');
      if (headerActionText) headerActionText.textContent = text;
    } else {
      headerActionBtn.classList.remove('loading');
    }
  }

  if (modalLoadBtn) modalLoadBtn.disabled = busy;
  if (modalUnloadBtn) modalUnloadBtn.disabled = busy;

  if (genBtn) {
    if (busy) {
      genBtn.disabled = true;
      genBtn.classList.remove('ready');
    } else {
      genBtn.disabled = state.isGenerating;
      if (state.status && state.status.ready) {
        genBtn.classList.remove('standby');
        genBtn.classList.add('ready');
      } else {
        genBtn.classList.remove('ready');
        genBtn.classList.add('standby');
      }
    }
  }
}

function showProgressBars(show, initialMsg = '', initialPct = 0) {
  const modelProgressContainer = document.getElementById('modelProgressContainer');
  const headerProgressStrip = document.getElementById('headerProgressStrip');

  if (modelProgressContainer) {
    if (show) modelProgressContainer.classList.remove('hidden');
    else modelProgressContainer.classList.add('hidden');
  }

  if (headerProgressStrip) {
    if (show) headerProgressStrip.classList.remove('hidden');
    else headerProgressStrip.classList.add('hidden');
  }

  if (show) {
    updateProgressDisplay(initialMsg, initialPct);
  }
}

function updateProgressDisplay(msg, pct) {
  const modalMsg = document.getElementById('modelProgressMsg');
  const modalPct = document.getElementById('modelProgressPct');
  const modalBar = document.getElementById('modelProgressBar');
  const headerBar = document.getElementById('headerProgressBar');

  if (modalMsg) modalMsg.textContent = msg;
  if (modalPct) modalPct.textContent = `${pct}%`;
  if (modalBar) modalBar.style.width = `${pct}%`;
  if (headerBar) headerBar.style.width = `${pct}%`;
}

// ==========================================
// HUGGINGFACE HUB SEARCH & DOWNLOADER (TAB 2)
// ==========================================

function initHFHubControls() {
  const searchInput = document.getElementById('hfSearchInput');
  const searchBtn = document.getElementById('hfSearchBtn');
  const clearBtn = document.getElementById('hfClearSearchBtn');
  const prevBtn = document.getElementById('hfPrevPageBtn');
  const nextBtn = document.getElementById('hfNextPageBtn');
  const filterChips = document.querySelectorAll('.hf-filter-chips .chip');

  // Search input typing
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      if (clearBtn) {
        if (searchInput.value.trim().length > 0) clearBtn.classList.remove('hidden');
        else clearBtn.classList.add('hidden');
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        triggerHFSearch(searchInput.value.trim());
      }
    });
  }

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      clearBtn.classList.add('hidden');
      triggerHFSearch('');
    });
  }

  // Search button
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const q = searchInput ? searchInput.value.trim() : '';
      triggerHFSearch(q);
    });
  }

  // Category chips
  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const q = chip.getAttribute('data-query') || '';
      if (searchInput) {
        searchInput.value = q;
        if (clearBtn) {
          if (q) clearBtn.classList.remove('hidden');
          else clearBtn.classList.add('hidden');
        }
      }
      triggerHFSearch(q);
    });
  });

  // Pagination
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (hfPage > 1) {
        hfPage--;
        loadHFModels();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (hfPage < hfTotalPages) {
        hfPage++;
        loadHFModels();
      }
    });
  }
}

function triggerHFSearch(query) {
  hfQuery = query;
  hfPage = 1;
  loadHFModels();
}

async function loadHFModels() {
  hfHasLoaded = true;
  const listEl = document.getElementById('hfModelList');
  const prevBtn = document.getElementById('hfPrevPageBtn');
  const nextBtn = document.getElementById('hfNextPageBtn');
  const pageIndicator = document.getElementById('hfPageIndicator');

  if (listEl) {
    listEl.innerHTML = `
      <div class="hf-loading-state">
        <div class="btn-spinner"></div>
        <span>Searching HuggingFace Hub...</span>
      </div>`;
  }

  try {
    const data = await searchHFModels(hfQuery, hfPage, hfLimit);
    hfTotalPages = data.total_pages || 1;

    if (pageIndicator) {
      pageIndicator.textContent = `Page ${data.page} of ${hfTotalPages}`;
    }
    if (prevBtn) prevBtn.disabled = !data.has_prev;
    if (nextBtn) nextBtn.disabled = !data.has_next;

    renderHFModelCards(data.items);
  } catch (err) {
    console.error('HF Search error:', err);
    if (listEl) {
      listEl.innerHTML = `
        <div class="hf-empty-state">
          <span>Failed to connect to HuggingFace Hub: ${err.message}</span>
        </div>`;
    }
  }
}

function renderHFModelCards(items) {
  const listEl = document.getElementById('hfModelList');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!items || items.length === 0) {
    listEl.innerHTML = `
      <div class="hf-empty-state">
        <span>No compatible single-file SDXL checkpoints found.</span>
        <span style="font-size: 11px; color: var(--text-dim); margin-top: 4px;">Try searching for "juggernaut", "lightning", "realvis", or "animagine".</span>
      </div>`;
    return;
  }

  items.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'hf-model-card';

    const formattedDl = m.downloads > 1000 ? `${(m.downloads / 1000).toFixed(1)}k` : m.downloads;
    const formattedLikes = m.likes > 1000 ? `${(m.likes / 1000).toFixed(1)}k` : m.likes;

    let filesHtml = '';
    m.files.forEach((f) => {
      const taskKey = `${m.id}/${f.filename}`;
      const activeTask = activeDownloadsMap[taskKey];

      if (f.is_installed) {
        filesHtml += `
          <div class="hf-file-row" id="row_${sanitizeDomId(taskKey)}">
            <span class="hf-file-name" title="${f.filename}">${f.filename}</span>
            <span class="hf-installed-badge">✓ Installed</span>
          </div>`;
      } else if (activeTask && activeTask.status === 'downloading') {
        filesHtml += renderProgressWidgetHtml(taskKey, f.filename, activeTask);
      } else {
        filesHtml += `
          <div class="hf-file-row" id="row_${sanitizeDomId(taskKey)}">
            <span class="hf-file-name" title="${f.filename}">${f.filename}</span>
            <button type="button" class="btn-hf-download" data-repo="${m.id}" data-file="${f.filename}">
              <span>⬇️ Download</span>
            </button>
          </div>`;
      }
    });

    card.innerHTML = `
      <div class="hf-card-header">
        <div class="hf-card-title-wrap">
          <span class="hf-card-title" title="${m.id}">${m.name}</span>
          <span class="hf-card-author">by ${m.author || 'community'}</span>
        </div>
        <a href="https://huggingface.co/${m.id}" target="_blank" rel="noopener noreferrer" class="hf-link-icon" title="View on HuggingFace Hub">
          ↗
        </a>
      </div>

      <div class="hf-card-stats">
        <span class="stat-chip">⬇️ ${formattedDl}</span>
        <span class="stat-chip">❤️ ${formattedLikes}</span>
        <span class="stat-chip">${m.pipeline_tag || 'SDXL'}</span>
      </div>

      <div class="hf-card-files">
        ${filesHtml}
      </div>
    `;

    // Attach download handlers
    const dlButtons = card.querySelectorAll('.btn-hf-download');
    dlButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const repo = btn.getAttribute('data-repo');
        const filename = btn.getAttribute('data-file');
        await handleStartHFDownload(repo, filename);
      });
    });

    listEl.appendChild(card);
  });
}

function renderProgressWidgetHtml(taskKey, filename, task) {
  const domId = sanitizeDomId(taskKey);
  const pct = task.percentage || 0;
  const dlMB = task.downloaded_bytes ? (task.downloaded_bytes / (1024 * 1024)).toFixed(0) : '0';
  const totalMB = task.total_bytes ? (task.total_bytes / (1024 * 1024)).toFixed(0) : '—';
  const speed = task.speed_mbps ? `${task.speed_mbps} MB/s` : 'Connecting...';
  const eta = task.eta_seconds ? `ETA: ${task.eta_seconds}s` : '';

  return `
    <div class="hf-card-progress" id="row_${domId}">
      <div class="hf-card-progress-header">
        <span class="hf-file-name" title="${filename}">${filename}</span>
        <span class="hf-card-progress-pct" id="pct_${domId}">${pct}%</span>
      </div>
      <div class="hf-card-progress-track">
        <div class="hf-card-progress-fill" id="bar_${domId}" style="width: ${pct}%"></div>
      </div>
      <div class="hf-card-progress-footer">
        <span id="speed_${domId}">${dlMB} MB / ${totalMB} MB · ${speed} ${eta}</span>
        <button type="button" class="btn-cancel-dl" data-task="${taskKey}">Cancel</button>
      </div>
    </div>`;
}

async function handleStartHFDownload(repoID, filename) {
  const taskKey = `${repoID}/${filename}`;
  try {
    const task = await downloadHFModel(repoID, filename);
    activeDownloadsMap[taskKey] = task;

    if (toastCallback) {
      toastCallback(`Download started: ${filename} saving to models/Stable-diffusion/`, 'info', 5000);
    }

    // Replace the row with the progress widget immediately
    const rowEl = document.getElementById(`row_${sanitizeDomId(taskKey)}`);
    if (rowEl) {
      rowEl.outerHTML = renderProgressWidgetHtml(taskKey, filename, task);
      attachCancelHandler(taskKey);
    }

    startDownloadPolling();
  } catch (err) {
    console.error('Download start failed:', err);
    if (toastCallback) toastCallback(`Download failed: ${err.message}`, 'error', 12000);
  }
}

function attachCancelHandler(taskKey) {
  const domId = sanitizeDomId(taskKey);
  const rowEl = document.getElementById(`row_${domId}`);
  if (!rowEl) return;
  const cancelBtn = rowEl.querySelector('.btn-cancel-dl');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      try {
        await cancelHFDownload(taskKey);
        delete activeDownloadsMap[taskKey];
        if (toastCallback) toastCallback('Download cancelled', 'info', 4000);
        loadHFModels();
      } catch (e) {
        console.error('Cancel error:', e);
      }
    });
  }
}

function startDownloadPolling() {
  if (downloadPollTimer) return;

  downloadPollTimer = setInterval(async () => {
    try {
      const tasks = await fetchHFDownloadStatus();
      if (!tasks || tasks.length === 0) {
        stopDownloadPolling();
        return;
      }

      let hasActive = false;
      tasks.forEach((t) => {
        activeDownloadsMap[t.id] = t;
        const domId = sanitizeDomId(t.id);

        if (t.status === 'downloading') {
          hasActive = true;
          const bar = document.getElementById(`bar_${domId}`);
          const pct = document.getElementById(`pct_${domId}`);
          const speedEl = document.getElementById(`speed_${domId}`);

          if (bar) bar.style.width = `${t.percentage}%`;
          if (pct) pct.textContent = `${t.percentage}%`;
          if (speedEl) {
            const dlMB = (t.downloaded_bytes / (1024 * 1024)).toFixed(0);
            const totalMB = t.total_bytes ? (t.total_bytes / (1024 * 1024)).toFixed(0) : '—';
            const speed = t.speed_mbps ? `${t.speed_mbps} MB/s` : 'Downloading...';
            const eta = t.eta_seconds ? `· ETA: ${t.eta_seconds}s` : '';
            speedEl.textContent = `${dlMB} MB / ${totalMB} MB · ${speed} ${eta}`;
          }
        } else if (t.status === 'completed') {
          const rowEl = document.getElementById(`row_${domId}`);
          if (rowEl && !rowEl.querySelector('.hf-installed-badge')) {
            rowEl.outerHTML = `
              <div class="hf-file-row" id="row_${domId}">
                <span class="hf-file-name" title="${t.filename}">${t.filename}</span>
                <span class="hf-installed-badge">✓ Installed</span>
              </div>`;
            if (toastCallback) {
              toastCallback(`Download complete: ${t.filename} is now ready in Installed Models!`, 'success', 8000);
            }
            refreshModelsList();
          }
        } else if (t.status === 'error') {
          const rowEl = document.getElementById(`row_${domId}`);
          if (rowEl && !rowEl.querySelector('.hf-error-badge')) {
            rowEl.outerHTML = `
              <div class="hf-file-row" id="row_${domId}">
                <span class="hf-file-name" title="${t.filename}">${t.filename}</span>
                <span class="meta-pill" style="color: #f87171;">Error</span>
              </div>`;
            if (toastCallback) {
              toastCallback(`Download error for ${t.filename}: ${t.error}`, 'error', 12000);
            }
          }
        }
      });

      if (!hasActive) {
        stopDownloadPolling();
      }
    } catch (err) {
      console.warn('Download poll error:', err);
    }
  }, 1000);
}

function stopDownloadPolling() {
  if (downloadPollTimer) {
    clearInterval(downloadPollTimer);
    downloadPollTimer = null;
  }
}

function sanitizeDomId(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, '_');
}
