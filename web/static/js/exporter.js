import { exportBundle } from './api.js?v=8';
import { state } from './state.js?v=8';

export function initExporter(onSuccess, onError) {
  const modal = document.getElementById('exportModal');
  const closeBtn = document.getElementById('closeExportModalBtn');
  const cancelBtn = document.getElementById('cancelExportBtn');
  const form = document.getElementById('exportForm');
  const platformInput = document.getElementById('exportPlatformInput');
  const tabs = document.querySelectorAll('.tab-btn');
  const countBar = document.getElementById('exportSelectedCount');
  const titleInput = document.getElementById('exportTitleInput');
  const resultBox = document.getElementById('exportResultBox');
  const submitBtn = document.getElementById('submitExportBtn');
  const spinner = document.getElementById('exportSpinner');
  const submitText = document.getElementById('exportSubmitText');

  // Close handlers
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      platformInput.value = tab.dataset.platform;
    });
  });

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.selectedFiles.size === 0) return;

    const payload = {
      platform: platformInput.value,
      title: titleInput.value.trim(),
      selected_files: Array.from(state.selectedFiles),
      price: parseFloat(document.getElementById('exportPriceInput').value),
      custom_tags: document.getElementById('exportTagsInput').value.trim()
    };

    setExporting(true);
    try {
      const res = await exportBundle(payload);
      displayExportResults(res);
      onSuccess('Bundle packaged successfully!');
    } catch (err) {
      onError(err.message || 'Export packaging failed');
    } finally {
      setExporting(false);
    }
  });

  function setExporting(isExp) {
    state.isExporting = isExp;
    submitBtn.disabled = isExp;
    if (isExp) {
      spinner.classList.remove('hidden');
      submitText.textContent = 'Packaging Assets & Licenses...';
    } else {
      spinner.classList.add('hidden');
      submitText.textContent = '🚀 Generate & Package Bundle';
    }
  }

  function displayExportResults(res) {
    resultBox.classList.remove('hidden');
    document.getElementById('resultBundleName').textContent = res.bundle_name;

    const zipLink = document.getElementById('downloadZipLink');
    zipLink.href = res.zip_url;
    zipLink.download = res.zip_filename;

    const coverLink = document.getElementById('downloadCoverLink');
    if (res.cover_url) {
      coverLink.href = res.cover_url;
      coverLink.classList.remove('hidden');
    } else {
      coverLink.classList.add('hidden');
    }

    const csvLink = document.getElementById('downloadCsvLink');
    if (res.csv_url) {
      csvLink.href = res.csv_url;
      csvLink.classList.remove('hidden');
    } else {
      csvLink.classList.add('hidden');
    }

    const pills = document.getElementById('resultTagsPills');
    pills.innerHTML = '';
    (res.tags || []).forEach(t => {
      const span = document.createElement('span');
      span.className = 'tag-pill';
      span.textContent = t;
      pills.appendChild(span);
    });
  }

  function closeModal() {
    modal.classList.add('hidden');
  }
}

export function openExportModal() {
  const modal = document.getElementById('exportModal');
  const countBar = document.getElementById('exportSelectedCount');
  const titleInput = document.getElementById('exportTitleInput');
  const resultBox = document.getElementById('exportResultBox');

  resultBox.classList.add('hidden');
  const count = state.selectedFiles.size;
  countBar.textContent = `${count} high-resolution items selected for packaging`;

  if (!titleInput.value) {
    titleInput.value = 'Premium Digital Art Clipart Collection';
  }

  modal.classList.remove('hidden');
}
