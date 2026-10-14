// Model & GPU Memory Manager (Lifecycle, Hot-Swap, Memory Reclamation & HuggingFace Hub)

import {
  fetchModels,
  loadModelStream,
  unloadModelStream,
  searchHFModels,
  downloadHFModel,
  fetchHFDownloadStatus,
  cancelHFDownload,
  fetchHFModelInfo
} from './api.js?v=12';
import { state } from './state.js?v=12';

let isBusy = false;
let activeEngine = 'ipex'; // "ipex" | "openvino"
let activeTab = 'local';
let selectedModelPath = '';
let installedModelsCache = [];

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

  // Direct Tab Button Click Handlers
  const tabBtnLocal = document.getElementById('tabBtnLocal');
  const tabBtnHF = document.getElementById('tabBtnHF');

  if (tabBtnLocal) {
    tabBtnLocal.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('local');
    });
  }
  if (tabBtnHF) {
    tabBtnHF.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('hf');
    });
  }

  // Delegated fallback for Tab Bar
  const tabsNav = document.querySelector('.model-tabs-nav');
  if (tabsNav) {
    tabsNav.addEventListener('click', (e) => {
      const btn = e.target.closest('.model-tab-btn');
      if (btn) {
        const tab = btn.getAttribute('data-tab');
        if (tab) switchTab(tab);
      }
    });
  }

  // Header Settings Button: switches to and highlights model panel
  const modelSettingsBtn = document.getElementById('modelSettingsBtn');
  if (modelSettingsBtn) {
    modelSettingsBtn.addEventListener('click', () => {
      focusModelPanel();
    });
  }

  // Inference Engine Selector (IPEX vs OpenVINO)
  const engineSelect = document.getElementById('engineSelect');
  if (engineSelect) {
    engineSelect.value = activeEngine;
    engineSelect.addEventListener('change', () => {
      activeEngine = engineSelect.value || 'ipex';
      onEngineChanged();
    });
  }

  // Tab 1: Local Model Actions
  const modalLoadBtn = document.getElementById('modalLoadBtn');
  const modalUnloadBtn = document.getElementById('modalUnloadBtn');
  const customInput = document.getElementById('customModelInput');
  const modelSelect = document.getElementById('modelSelect');
  const refreshLocalBtn = document.getElementById('refreshLocalModelsBtn');

  // Dropdown change syncs selected card
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      selectedModelPath = modelSelect.value;
      if (customInput) customInput.value = '';
      updateCardsSelection();
    });
  }

  // Custom path input change syncs selection
  if (customInput) {
    customInput.addEventListener('input', () => {
      if (customInput.value.trim().length > 0) {
        selectedModelPath = customInput.value.trim();
        updateCardsSelection();
      }
    });
  }

  // Load Model Action (Auto-unloads previous model if one is active)
  if (modalLoadBtn) {
    modalLoadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      const customVal = customInput ? customInput.value.trim() : '';
      const selectedVal = modelSelect ? modelSelect.value : '';
      const targetModel = customVal || selectedModelPath || selectedVal;
      await handleLoad(targetModel, onStatusUpdated, showToastFn);
    });
  }

  // Manual Unload Action
  if (modalUnloadBtn) {
    modalUnloadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      await handleUnload(onStatusUpdated, showToastFn);
    });
  }

  // Refresh Local Models
  if (refreshLocalBtn) {
    refreshLocalBtn.addEventListener('click', () => {
      refreshModelsList();
      if (showToastFn) showToastFn('Local checkpoints rescanned', 'info', 3000);
    });
  }

  // Tab 2: HuggingFace Hub Search & Controls
  initHFHubControls();
}

export function switchTab(tab) {
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

export function focusModelPanel() {
  switchTab('local');
  const panel = document.querySelector('.model-panel');
  if (panel) {
    panel.scrollIntoView({ behavior: 'smooth' });
    panel.style.boxShadow = '0 0 25px rgba(99, 102, 241, 0.4)';
    setTimeout(() => { panel.style.boxShadow = ''; }, 1200);
  }
}

// Backwards compatibility alias for generator and modal references
export const openModelModal = focusModelPanel;

// ==========================================
// ENGINE SWITCHING & DUAL-ENGINE COORDINATION
// ==========================================

function onEngineChanged() {
  const badge = document.getElementById("activeEngineBadge");
  if (badge) {
    badge.className = `engine-badge ${activeEngine}`;
    badge.textContent = activeEngine === "openvino" ? "Intel OpenVINO" : "Intel IPEX";
  }

  const deviceTag = document.getElementById("panelModelDeviceTag");
  if (deviceTag) {
    deviceTag.textContent = activeEngine === "openvino" ? "Intel Arc XPU (OpenVINO)" : "Intel Arc XPU (IPEX)";
  }

  const sectionSub = document.getElementById("installedSectionSubtitle");
  if (sectionSub) {
    sectionSub.textContent = activeEngine === "openvino" ? "Installed OpenVINO Models" : "Installed Safetensors";
  }

  const selectLabel = document.getElementById("modelSelectLabel");
  if (selectLabel) {
    selectLabel.textContent = activeEngine === "openvino" ? "Select OpenVINO Model" : "Select Checkpoint Model";
  }

  const hintText = document.getElementById("hfStorageHintText");
  if (hintText) {
    const folder = activeEngine === "openvino" ? "models/OpenVINO/" : "models/Stable-diffusion/";
    hintText.innerHTML = `📁 Target Folder: <code>${folder}</code>`;
  }

  selectedModelPath = "";
  refreshModelsList();
  renderCategoryChips();

  if (activeTab === "hf" || hfHasLoaded) {
    hfQuery = "";
    hfPage = 1;
    const searchInput = document.getElementById("hfSearchInput");
    const clearBtn = document.getElementById("hfClearSearchBtn");
    if (searchInput) searchInput.value = "";
    if (clearBtn) clearBtn.classList.add("hidden");
    loadHFModels();
  }
}

function renderCategoryChips() {
  const container = document.getElementById("hfFilterChips");
  if (!container) return;

  if (activeEngine === "openvino") {
    container.innerHTML = `
      <button type="button" class="chip active" data-query="">⚡ Latest</button>
      <button type="button" class="chip" data-query="xl-base">🖼️ SDXL FP16</button>
      <button type="button" class="chip" data-query="xl-base-1.0-int8">🚀 SDXL INT8</button>
      <button type="button" class="chip" data-query="stable-diffusion-v1-5">🎨 SD 1.5</button>
      <button type="button" class="chip" data-query="flux">✨ FLUX Schnell</button>
    `;
  } else {
    container.innerHTML = `
      <button type="button" class="chip active" data-query="">⚡ Latest</button>
      <button type="button" class="chip" data-query="sdxl lightning">⚡ Lightning</button>
      <button type="button" class="chip" data-query="sdxl turbo">🚀 Turbo</button>
      <button type="button" class="chip" data-query="realistic sdxl">📸 Photo</button>
      <button type="button" class="chip" data-query="animagine xl">🎨 Anime</button>
    `;
  }

  const chips = container.querySelectorAll(".chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const q = chip.getAttribute("data-query") || "";
      const searchInput = document.getElementById("hfSearchInput");
      const clearBtn = document.getElementById("hfClearSearchBtn");
      if (searchInput) {
        searchInput.value = q;
        if (clearBtn) {
          if (q) clearBtn.classList.remove("hidden");
          else clearBtn.classList.add("hidden");
        }
      }
      triggerHFSearch(q);
    });
  });
}

// ==========================================
// LOCAL MODELS (TAB 1)
// ==========================================

export async function refreshModelsList() {
  try {
    const models = await fetchModels(activeEngine);
    installedModelsCache = models || [];
    populateModelsDropdown(installedModelsCache);
  } catch (err) {
    console.warn('[MODEL MGR] Failed to scan models:', err);
  }
}

export function populateModelsDropdown(models) {
  installedModelsCache = models || [];
  const select = document.getElementById('modelSelect');
  const countBadge = document.getElementById('installedCountBadge');
  const container = document.getElementById('installedModelsList');

  if (countBadge) {
    countBadge.textContent = `${models ? models.length : 0} detected`;
  }

  // Populate Select Dropdown
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
        opt.textContent = `${m.name} (${m.size_gb} GB)${m.is_active ? ' — In VRAM' : ''}`;
        if (m.is_active) {
          opt.selected = true;
          selectedModelPath = m.path;
        }
        select.appendChild(opt);
      });

      // Default selection if none active
      if (!selectedModelPath && models.length > 0) {
        selectedModelPath = models[0].path;
        select.value = models[0].path;
      }
    }
  }

  // Render clickable model cards
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
      const isSelected = (selectedModelPath === m.path);
      const card = document.createElement('div');
      card.className = `installed-card ${m.is_active ? 'active-model' : ''} ${isSelected ? 'selected-model' : ''}`;
      card.setAttribute('data-path', m.path);

      const origin = m.path.includes('models') ? 'models/Stable-diffusion' : 'Custom Checkpoint';

      card.innerHTML = `
        <div class="installed-card-left">
          <span class="selection-indicator ${isSelected ? 'checked' : ''}">${isSelected ? '◉' : '○'}</span>
          <div class="installed-card-info">
            <span class="installed-card-title" title="${m.path}">${m.name}</span>
            <div class="installed-card-meta">
              <span class="meta-pill">${m.size_gb} GB</span>
              <span class="meta-pill">${origin}</span>
            </div>
          </div>
        </div>
        <div class="installed-card-action">
          ${m.is_active
            ? `<span class="card-badge-active">● In VRAM</span>`
            : isSelected
              ? `<span class="card-badge-selected">Selected</span>`
              : `<span class="card-badge-idle">Select</span>`
          }
        </div>
      `;

      // Clicking any card selects it
      card.addEventListener('click', () => {
        selectedModelPath = m.path;
        if (select) select.value = m.path;
        const customInput = document.getElementById('customModelInput');
        if (customInput) customInput.value = '';
        updateCardsSelection();
      });

      container.appendChild(card);
    });
  }
}

function updateCardsSelection() {
  const container = document.getElementById('installedModelsList');
  if (!container) return;

  const cards = container.querySelectorAll('.installed-card');
  cards.forEach((card) => {
    const path = card.getAttribute('data-path');
    const isSelected = (path === selectedModelPath);
    const indicator = card.querySelector('.selection-indicator');
    const actionEl = card.querySelector('.installed-card-action');

    if (isSelected) {
      card.classList.add('selected-model');
      if (indicator) {
        indicator.textContent = '◉';
        indicator.classList.add('checked');
      }
      if (actionEl && !card.classList.contains('active-model')) {
        actionEl.innerHTML = `<span class="card-badge-selected">Selected</span>`;
      }
    } else {
      card.classList.remove('selected-model');
      if (indicator) {
        indicator.textContent = '○';
        indicator.classList.remove('checked');
      }
      if (actionEl && !card.classList.contains('active-model')) {
        actionEl.innerHTML = `<span class="card-badge-idle">Select</span>`;
      }
    }
  });
}

export function updateModelUI(status) {
  const deviceBadge = document.getElementById('deviceBadge');
  const deviceText = document.getElementById('deviceText');
  const modelText = document.getElementById('modelText');

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

// Loads a model. If another model is already active in VRAM, it automatically unloads it first!
async function handleLoad(modelPath, onStatusUpdated, showToastFn) {
  if (!modelPath) {
    if (showToastFn) showToastFn('Please select a checkpoint first.', 'warning', 4000);
    return;
  }

  isBusy = true;
  setControlsBusy(true, 'Preparing Model...');
  showProgressBars(true, 'Preparing engine...', 5);

  // Auto-Unload: if a model is currently active, purge VRAM first before loading new checkpoint!
  if (state.status && state.status.ready) {
    updateProgressDisplay('Unloading previous model & purging GPU memory...', 15);
    try {
      await unloadModelStream(
        (prog) => updateProgressDisplay(prog.message || 'Flushing GPU VRAM...', 20),
        () => updateProgressDisplay('VRAM cleared. Loading selected model...', 30),
        (err) => console.warn('Pre-unload step warning:', err)
      );
      state.status.ready = false;
      state.status.model = '';
      updateModelUI(state.status);
    } catch (err) {
      console.warn('Pre-unload error, continuing with load:', err);
    }
  }

  // Load the newly selected model
  updateProgressDisplay('Initializing diffusion worker...', 35);

  try {
    await loadModelStream(
      modelPath,
      activeEngine,
      (prog) => {
        const pct = prog.percentage || 40;
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
  const modalLoadBtn = document.getElementById('modalLoadBtn');
  const modalLoadBtnText = document.getElementById('modalLoadBtnText');
  const modalUnloadBtn = document.getElementById('modalUnloadBtn');
  const genBtn = document.getElementById('generateBtn');

  if (modalLoadBtn) {
    modalLoadBtn.disabled = busy;
    if (modalLoadBtnText) {
      modalLoadBtnText.textContent = busy ? text : 'Load Model';
    }
  }
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

  // Category chips rendered dynamically based on active engine
  renderCategoryChips();

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
    const data = await searchHFModels(hfQuery, hfPage, hfLimit, activeEngine);
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
      const sizeTag = f.size_gb ? `<strong class="file-size-tag">(${f.size_gb} GB)</strong>` : '';

      if (f.is_installed) {
        filesHtml += `
          <div class="hf-file-row" id="row_${sanitizeDomId(taskKey)}">
            <span class="hf-file-name" title="${f.filename}">${f.filename} ${sizeTag}</span>
            <div class="hf-file-actions">
              <button type="button" class="btn-hf-info" data-repo="${m.id}" title="Model Details & Specs">
                <span>ℹ️ Info</span>
              </button>
              <span class="hf-installed-badge">✓ Installed</span>
            </div>
          </div>`;
      } else if (activeTask && activeTask.status === 'downloading') {
        filesHtml += renderProgressWidgetHtml(taskKey, f.filename, activeTask);
      } else {
        filesHtml += `
          <div class="hf-file-row" id="row_${sanitizeDomId(taskKey)}">
            <span class="hf-file-name" title="${f.filename}">${f.filename} ${sizeTag}</span>
            <div class="hf-file-actions">
              <button type="button" class="btn-hf-info" data-repo="${m.id}" title="Model Details & Specs">
                <span>ℹ️ Info</span>
              </button>
              <button type="button" class="btn-hf-download" data-repo="${m.id}" data-file="${f.filename}">
                <span>⬇️ Download</span>
              </button>
            </div>
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

      <div class="hf-card-info-drawer hidden" id="info_${sanitizeDomId(m.id)}"></div>
    `;

    // Attach info drawer toggle handlers
    const infoButtons = card.querySelectorAll('.btn-hf-info');
    infoButtons.forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const repo = btn.getAttribute('data-repo');
        const drawerId = `info_${sanitizeDomId(repo)}`;
        const drawer = document.getElementById(drawerId);
        if (!drawer) return;

        if (!drawer.classList.contains('hidden')) {
          drawer.classList.add('hidden');
          btn.classList.remove('active');
          return;
        }

        drawer.classList.remove('hidden');
        btn.classList.add('active');
        drawer.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--text-dim); padding: 6px 0;">
            <span class="btn-spinner" style="width: 12px; height: 12px;"></span>
            <span>Loading model specs & architecture...</span>
          </div>`;

        try {
          const info = await fetchHFModelInfo(repo);
          const baseModel = info.base_model || 'SDXL 1.0 (Text-to-Image)';
          const license = info.license || 'Open Community / Research';
          const tagsHtml = (info.tags && info.tags.length > 0)
            ? info.tags.map(t => `<span class="info-tag-pill">${t}</span>`).join('')
            : '<span class="info-tag-pill">sdxl</span>';

          drawer.innerHTML = `
            <div class="info-drawer-grid">
              <div class="info-drawer-item">
                <span class="info-drawer-label">Base Architecture</span>
                <span class="info-drawer-val">${baseModel}</span>
              </div>
              <div class="info-drawer-item">
                <span class="info-drawer-label">License</span>
                <span class="info-drawer-val" title="${license}">${license}</span>
              </div>
              <div class="info-drawer-item">
                <span class="info-drawer-label">Recommended VRAM</span>
                <span class="info-drawer-val" style="color: #38bdf8;">8GB - 16GB (bfloat16)</span>
              </div>
              <div class="info-drawer-item">
                <span class="info-drawer-label">Hardware Engine</span>
                <span class="info-drawer-val" style="color: #34d399;">Intel Arc XPU (IPEX)</span>
              </div>
            </div>
            ${info.summary ? `<div class="info-drawer-summary">${info.summary}</div>` : ''}
            <div class="info-drawer-tags">${tagsHtml}</div>
            <div class="info-drawer-footer">
              <a href="${info.hf_url || `https://huggingface.co/${repo}`}" target="_blank" rel="noopener noreferrer" class="info-drawer-link">
                Open Model Card on HuggingFace Hub ↗
              </a>
            </div>
          `;
        } catch (err) {
          drawer.innerHTML = `<span style="font-size: 11px; color: #f87171;">Failed to load model details: ${err.message}</span>`;
        }
      });
    });

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
    const task = await downloadHFModel(repoID, filename, activeEngine);
    activeDownloadsMap[taskKey] = task;

    const targetFolder = activeEngine === 'openvino' ? 'models/OpenVINO/' : 'models/Stable-diffusion/';
    if (toastCallback) {
      toastCallback(`Download started: ${filename} saving to ${targetFolder}`, 'info', 5000);
    }

    // Replace the row with progress widget
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
