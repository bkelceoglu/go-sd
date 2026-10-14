// Model & GPU Memory Manager (Lifecycle, Hot-Swap & Memory Reclamation)

import { fetchModels, loadModelStream, unloadModelStream } from './api.js?v=6';
import { state } from './state.js?v=6';

let isBusy = false;

export function initModelManager(onStatusUpdated, showToastFn) {
  const modal = document.getElementById('modelModal');
  const openGearBtn = document.getElementById('modelSettingsBtn');
  const closeBtn = document.getElementById('closeModelModalBtn');
  const headerActionBtn = document.getElementById('modelActionBtn');
  const modalLoadBtn = document.getElementById('modalLoadBtn');
  const modalUnloadBtn = document.getElementById('modalUnloadBtn');
  const modelSelect = document.getElementById('modelSelect');
  const customInput = document.getElementById('customModelInput');

  // Open modal
  if (openGearBtn) {
    openGearBtn.addEventListener('click', () => {
      openModelModal();
      refreshModelsList();
    });
  }

  // Close modal
  if (closeBtn) {
    closeBtn.addEventListener('click', closeModelModal);
  }

  // Backdrop click closes modal
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal && !isBusy) {
        closeModelModal();
      }
    });
  }

  // Header quick Load / Unload action button
  if (headerActionBtn) {
    headerActionBtn.addEventListener('click', async () => {
      if (isBusy) return;
      if (state.status && state.status.ready) {
        // Unload
        await handleUnload(onStatusUpdated, showToastFn);
      } else {
        // Load
        const targetModel = modelSelect ? modelSelect.value : '';
        await handleLoad(targetModel, onStatusUpdated, showToastFn);
      }
    });
  }

  // Modal Load Button
  if (modalLoadBtn) {
    modalLoadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      const customVal = customInput ? customInput.value.trim() : '';
      const selectedVal = modelSelect ? modelSelect.value : '';
      const targetModel = customVal || selectedVal;
      await handleLoad(targetModel, onStatusUpdated, showToastFn);
    });
  }

  // Modal Unload Button
  if (modalUnloadBtn) {
    modalUnloadBtn.addEventListener('click', async () => {
      if (isBusy) return;
      await handleUnload(onStatusUpdated, showToastFn);
    });
  }
}

export function openModelModal() {
  const modal = document.getElementById('modelModal');
  if (modal) modal.classList.remove('hidden');
}

export function closeModelModal() {
  const modal = document.getElementById('modelModal');
  if (modal && !isBusy) modal.classList.add('hidden');
}

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
  if (!select) return;

  select.innerHTML = '';
  if (!models || models.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No safetensors found in default paths';
    select.appendChild(opt);
    return;
  }

  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.path;
    opt.textContent = `${m.name} (${m.size_gb} GB)${m.is_active ? ' — Active' : ''}`;
    if (m.is_active) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

export function updateModelUI(status) {
  const deviceBadge = document.getElementById('deviceBadge');
  const deviceText = document.getElementById('deviceText');
  const modelText = document.getElementById('modelText');
  const headerActionBtn = document.getElementById('modelActionBtn');
  const headerActionIcon = document.getElementById('modelActionIcon');
  const headerActionText = document.getElementById('modelActionText');

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
      (resData) => {
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
  const modalProgressContainer = document.getElementById('modelProgressContainer');
  const headerProgressStrip = document.getElementById('headerProgressStrip');

  if (modalProgressContainer) {
    if (show) modalProgressContainer.classList.remove('hidden');
    else modalProgressContainer.classList.add('hidden');
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
