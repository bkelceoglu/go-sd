let currentImage = null;

export function initLightbox(onDeleteSingle) {
  const modal = document.getElementById('lightboxModal');
  const closeBtn = document.getElementById('closeLightboxBtn');
  const deleteBtn = document.getElementById('lightboxDeleteBtn');

  closeBtn.addEventListener('click', closeLightbox);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeLightbox();
  });

  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!currentImage || !currentImage.filename) return;
      if (!window.confirm('Are you sure you want to permanently delete this artwork?')) return;

      const filename = currentImage.filename;
      closeLightbox();
      if (onDeleteSingle) {
        await onDeleteSingle(filename);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeLightbox();
    }
  });
}

export function openLightbox(img) {
  currentImage = img;
  const modal = document.getElementById('lightboxModal');
  const imgEl = document.getElementById('lightboxImg');
  const promptEl = document.getElementById('lightboxPrompt');
  const resEl = document.getElementById('lightboxResolution');
  const seedEl = document.getElementById('lightboxSeed');
  const timeEl = document.getElementById('lightboxTime');
  const dlBtn = document.getElementById('lightboxDownloadBtn');

  imgEl.src = img.url;
  promptEl.textContent = img.prompt;
  resEl.textContent = `Dimensions: ${img.width}x${img.height}px`;
  seedEl.textContent = `Seed: ${img.seed}`;
  const elapsedStr = (typeof img.elapsed_seconds === 'number' && !isNaN(img.elapsed_seconds) && img.elapsed_seconds > 0)
    ? `Render time: ${img.elapsed_seconds.toFixed(1)}s`
    : '';
  timeEl.textContent = elapsedStr;

  dlBtn.href = img.url || '';
  dlBtn.download = img.filename || 'artwork.jpg';

  modal.classList.remove('hidden');
}

function closeLightbox() {
  const modal = document.getElementById('lightboxModal');
  modal.classList.add('hidden');
  currentImage = null;
}
