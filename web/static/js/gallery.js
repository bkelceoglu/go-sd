import { state, toggleSelection, selectAll, clearSelection, subscribe } from './state.js?v=6';

export function initGallery(onOpenLightbox, onOpenExport, onDeleteSelected) {
  const grid = document.getElementById('galleryGrid');
  const countBadge = document.getElementById('galleryCount');
  const emptyState = document.getElementById('emptyGallery');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  const deleteLabel = document.getElementById('deleteBtnLabel');
  const exportBtn = document.getElementById('openExportBtn');
  const exportLabel = document.getElementById('exportBtnLabel');

  selectAllBtn.addEventListener('click', () => {
    const allFiles = state.gallery.map(img => img.filename);
    selectAll(allFiles);
  });

  deselectAllBtn.addEventListener('click', () => {
    clearSelection();
  });

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const selected = Array.from(state.selectedFiles);
      if (selected.length === 0) return;

      const confirmMsg = selected.length === 1
        ? `Are you sure you want to permanently delete this artwork?`
        : `Are you sure you want to permanently delete ${selected.length} selected artworks?`;

      if (!window.confirm(confirmMsg)) return;

      if (onDeleteSelected) {
        deleteBtn.disabled = true;
        if (deleteLabel) deleteLabel.textContent = 'Deleting...';
        try {
          await onDeleteSelected(selected);
        } finally {
          updateSelectionUI(Array.from(state.selectedFiles));
        }
      }
    });
  }

  exportBtn.addEventListener('click', () => {
    if (state.selectedFiles.size > 0) {
      onOpenExport();
    }
  });

  subscribe('selectionChanged', (selectedFiles) => {
    updateSelectionUI(selectedFiles);
  });

  function updateSelectionUI(selected) {
    const count = selected.length;
    exportBtn.disabled = count === 0;
    exportLabel.textContent = `Package Selected (${count})`;

    if (deleteBtn) {
      deleteBtn.disabled = count === 0;
    }
    if (deleteLabel) {
      deleteLabel.textContent = count > 0 ? `Delete (${count})` : 'Delete';
    }

    // Update active class on cards
    document.querySelectorAll('.gallery-card').forEach(card => {
      const filename = card.dataset.filename;
      if (selected.includes(filename)) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }
    });
  }
}

export function renderGallery(images, onOpenLightbox) {
  const grid = document.getElementById('galleryGrid');
  const countBadge = document.getElementById('galleryCount');
  const emptyState = document.getElementById('emptyGallery');

  if (!images || images.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (countBadge) countBadge.textContent = '0 items';
    if (grid) grid.innerHTML = '';
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (countBadge) countBadge.textContent = `${images.length} items`;
  if (grid) grid.innerHTML = '';

  images.forEach(img => {
    const card = document.createElement('div');
    const filename = img.filename || '';
    card.className = `gallery-card ${state.selectedFiles.has(filename) ? 'selected' : ''}`;
    card.dataset.filename = filename;

    const width = img.width || 1024;
    const height = img.height || 1024;
    const prompt = img.prompt || 'Artwork';
    const url = img.url || '';
    const elapsedText = (typeof img.elapsed_seconds === 'number' && !isNaN(img.elapsed_seconds) && img.elapsed_seconds > 0)
      ? `${img.elapsed_seconds.toFixed(1)}s`
      : 'Done';

    card.innerHTML = `
      <div class="card-img-wrap">
        <div class="card-checkbox" title="Select for packaging">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        <img class="card-img" src="${url}" alt="${prompt}" loading="lazy">
      </div>
      <div class="card-info">
        <div class="card-prompt" title="${prompt}">${prompt}</div>
        <div class="card-meta">
          <span>${width}x${height}</span>
          <span>${elapsedText}</span>
        </div>
      </div>
    `;

    // Checkbox click
    const checkbox = card.querySelector('.card-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelection(img.filename);
    });

    // Card click opens Lightbox
    card.addEventListener('click', () => {
      onOpenLightbox(img);
    });

    grid.appendChild(card);
  });
}

export function createLiveCard(prompt) {
  const grid = document.getElementById('galleryGrid');
  const emptyState = document.getElementById('emptyGallery');
  if (emptyState) emptyState.classList.add('hidden');

  removeLiveCard();

  const card = document.createElement('div');
  card.id = 'liveGeneratingCard';
  card.className = 'gallery-card live-generating';

  card.innerHTML = `
    <div class="live-preview-wrap">
      <img id="liveImg" class="live-preview-img" src="" alt="Live generation preview" style="display: none;">
      <div class="live-overlay">
        <div class="live-badge-top">
          <span id="liveStepBadge" class="live-badge-step">Initializing...</span>
          <span id="livePctBadge" class="live-badge-pct">0%</span>
        </div>
        <div class="live-progress-container">
          <div id="liveProgressBar" class="live-progress-bar"></div>
        </div>
      </div>
    </div>
    <div class="card-info">
      <div class="card-prompt" title="${prompt}">Rendering: ${prompt}</div>
      <div class="card-meta">
        <span>SDXL Pipeline</span>
        <span id="liveStatusText">Intel Arc GPU</span>
      </div>
    </div>
  `;

  grid.prepend(card);
}

export function updateLiveProgress(data) {
  const card = document.getElementById('liveGeneratingCard');
  if (!card) return;

  const stepBadge = document.getElementById('liveStepBadge');
  const pctBadge = document.getElementById('livePctBadge');
  const bar = document.getElementById('liveProgressBar');
  const img = document.getElementById('liveImg');
  const statusText = document.getElementById('liveStatusText');

  if (stepBadge) stepBadge.textContent = `Step ${data.step} / ${data.total_steps}`;
  if (pctBadge) pctBadge.textContent = `${data.percentage}%`;
  if (bar) bar.style.width = `${Math.max(5, data.percentage)}%`;
  if (statusText) statusText.textContent = `Denoising (${data.percentage}%)`;

  if (data.preview && img) {
    img.src = data.preview;
    img.style.display = 'block';
  }
}

export function removeLiveCard() {
  const existing = document.getElementById('liveGeneratingCard');
  if (existing) existing.remove();
}

