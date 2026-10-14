import { fetchStatus, fetchPresets, fetchGallery, deleteGalleryImages } from './api.js?v=6';
import { state, clearSelection } from './state.js?v=6';
import { initGenerator, populatePresets } from './generator.js?v=6';
import { initGallery, renderGallery, createLiveCard, updateLiveProgress, removeLiveCard } from './gallery.js?v=6';
import { initExporter, openExportModal } from './exporter.js?v=6';
import { initLightbox, openLightbox } from './lightbox.js?v=6';
import { initModelManager, updateModelUI, populateModelsDropdown } from './model_manager.js?v=6';

function bootStudio() {
  console.log('[GO-SD] Initializing studio components...');
  initUIComponents();
  loadInitialData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootStudio);
} else {
  bootStudio();
}

function initUIComponents() {
  const handleImagesDeletion = async (filenames) => {
    try {
      const res = await deleteGalleryImages(filenames);
      clearSelection();
      const galleryItems = await fetchGallery();
      state.gallery = galleryItems || [];
      renderGallery(state.gallery, (img) => openLightbox(img));
      showToast(`${res.deleted_count || filenames.length} artwork(s) deleted.`, 'info', 5000);
    } catch (err) {
      console.error('Delete error:', err);
      showToast(err.message || 'Failed to delete images', 'error', 10000);
    }
  };

  initModelManager((updatedStatus) => {
    state.status = updatedStatus;
  }, showToast);

  initLightbox((filename) => handleImagesDeletion([filename]));

  initGallery(
    (img) => openLightbox(img),
    () => openExportModal(),
    handleImagesDeletion
  );

  initGenerator(
    (prompt) => {
      createLiveCard(prompt);
    },
    (progData) => {
      updateLiveProgress(progData);
    },
    async (completedImg) => {
      removeLiveCard();
      try {
        const galleryItems = await fetchGallery();
        state.gallery = galleryItems || [];
        renderGallery(state.gallery, (img) => openLightbox(img));
        showToast('Artwork generated and added to showcase!', 'success', 6000);
      } catch (err) {
        console.error('Failed to reload gallery:', err);
      }
    },
    (errMsg) => {
      removeLiveCard();
      showToast(errMsg, 'error', 15000);
    }
  );

  initExporter(
    (msg) => showToast(msg, 'success', 8000),
    (errMsg) => showToast(errMsg, 'error', 15000)
  );
}

async function loadInitialData() {
  try {
    // 1. Fetch Engine & GPU Status
    const status = await fetchStatus();
    state.status = status;
    updateModelUI(status);
    if (status.available_models) {
      populateModelsDropdown(status.available_models);
    }

    // 2. Fetch Style Presets
    const presets = await fetchPresets();
    state.presets = presets;
    populatePresets(presets);

    // 3. Fetch Existing Gallery Images
    const galleryItems = await fetchGallery();
    state.gallery = galleryItems || [];
    renderGallery(state.gallery, (img) => openLightbox(img));
  } catch (err) {
    console.error('Failed to load initial studio data:', err);
    showToast('Failed to initialize studio connection', 'error', 15000);
  }
}

export function showToast(message, type = 'info', duration = 6000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-msg';
  msgSpan.textContent = message;

  const closeBtn = document.createElement('span');
  closeBtn.className = 'toast-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Dismiss';

  toast.appendChild(msgSpan);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    toast.style.transition = '0.2s ease';
    setTimeout(() => toast.remove(), 250);
  };

  closeBtn.addEventListener('click', dismiss);
  timer = setTimeout(dismiss, duration);
}
