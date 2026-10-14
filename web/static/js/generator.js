import { generateArtStream } from './api.js?v=9';
import { state, emit } from './state.js?v=9';
import { focusModelPanel, openModelModal } from './model_manager.js?v=9';

export function initGenerator(onStart, onProgress, onSuccess, onError) {
  const form = document.getElementById('generatorForm');
  const presetSelect = document.getElementById('presetSelect');
  const presetPreview = document.getElementById('presetSuffixPreview');
  const stepsInput = document.getElementById('stepsInput');
  const stepsVal = document.getElementById('stepsVal');
  const cfgInput = document.getElementById('cfgInput');
  const cfgVal = document.getElementById('cfgVal');
  const randomSeedBtn = document.getElementById('randomSeedBtn');
  const seedInput = document.getElementById('seedInput');
  const dimButtons = document.querySelectorAll('.dim-btn');
  const widthInput = document.getElementById('widthInput');
  const heightInput = document.getElementById('heightInput');
  const genBtn = document.getElementById('generateBtn');
  const genSpinner = document.getElementById('genSpinner');
  const genBtnText = document.getElementById('genBtnText');

  // Sliders
  stepsInput.addEventListener('input', (e) => stepsVal.textContent = e.target.value);
  cfgInput.addEventListener('input', (e) => cfgVal.textContent = parseFloat(e.target.value).toFixed(1));

  // Random Seed
  randomSeedBtn.addEventListener('click', () => {
    seedInput.value = Math.floor(Math.random() * 2147483647);
  });

  // Dimension buttons
  dimButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      dimButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      widthInput.value = btn.dataset.w;
      heightInput.value = btn.dataset.h;
    });
  });

  // Preset select preview
  presetSelect.addEventListener('change', () => {
    const selected = state.presets.find(p => p.id === presetSelect.value);
    if (selected && selected.positive_suffix) {
      presetPreview.textContent = `Applied suffix: "${selected.positive_suffix}"`;
    } else {
      presetPreview.textContent = '';
    }
  });

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.isGenerating) {
      console.warn('[STUDIO] Already generating, ignoring submit click');
      return;
    }

    if (!state.status || !state.status.ready) {
      if (onError) onError('Model is in standby mode. Please click "⚡ Load Model" to activate the GPU engine.');
      focusModelPanel();
      return;
    }

    setGenerating(true);

    try {
      const payload = {
        prompt: document.getElementById('promptInput').value.trim(),
        negative_prompt: document.getElementById('negativePromptInput').value.trim(),
        preset_id: presetSelect.value,
        width: parseInt(widthInput.value, 10),
        height: parseInt(heightInput.value, 10),
        steps: parseInt(stepsInput.value, 10),
        cfg_scale: parseFloat(cfgInput.value),
        seed: parseInt(seedInput.value, 10),
        batch_count: parseInt(document.getElementById('batchCountSelect').value, 10)
      };

      console.log('[STUDIO] Generate Artwork submitted with payload:', payload);

      if (onStart) {
        try {
          onStart(payload.prompt, payload.batch_count);
        } catch (uiErr) {
          console.warn('[STUDIO] onStart UI warning:', uiErr);
        }
      }

      await generateArtStream(
        payload,
        (progData) => {
          if (progData.batch_total && progData.batch_total > 1) {
            genBtnText.textContent = `Rendering (${progData.batch_index}/${progData.batch_total})...`;
          } else {
            genBtnText.textContent = 'Rendering on Intel Arc GPU...';
          }
          if (onProgress) onProgress(progData);
        },
        (completedImg, batchMeta) => {
          if (onSuccess) onSuccess(completedImg, batchMeta);
        },
        (errMsg) => {
          console.error('[STUDIO] Stream reported error:', errMsg);
          if (onError) onError(errMsg);
        }
      );
    } catch (err) {
      console.error('[STUDIO] Generation failed with exception:', err);
      if (onError) onError(err.message || 'Error occurred during generation');
    } finally {
      setGenerating(false);
    }
  });

  function setGenerating(isGen) {
    state.isGenerating = isGen;
    genBtn.disabled = isGen;
    if (isGen) {
      genSpinner.classList.remove('hidden');
      genBtnText.textContent = 'Rendering on Intel Arc GPU...';
      genBtn.classList.remove('ready');
    } else {
      genSpinner.classList.add('hidden');
      if (state.status && state.status.ready) {
        genBtnText.textContent = '✨ Generate Artwork';
        genBtn.classList.add('ready');
        genBtn.classList.remove('standby');
      } else {
        genBtnText.textContent = '⚡ Load Model to Generate';
        genBtn.classList.add('standby');
        genBtn.classList.remove('ready');
      }
    }
  }

  // Set initial button state
  if (state.status && state.status.ready) {
    genBtn.disabled = false;
    genBtn.classList.add('ready');
    genBtn.classList.remove('standby');
    genBtnText.textContent = '✨ Generate Artwork';
  } else {
    genBtn.disabled = false;
    genBtn.classList.add('standby');
    genBtn.classList.remove('ready');
    genBtnText.textContent = '⚡ Load Model to Generate';
  }
}

export function populatePresets(presets) {
  const select = document.getElementById('presetSelect');
  select.innerHTML = '';
  presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  if (presets.length > 0) {
    const preview = document.getElementById('presetSuffixPreview');
    if (presets[0].positive_suffix) {
      preview.textContent = `Applied suffix: "${presets[0].positive_suffix}"`;
    }
  }
}
