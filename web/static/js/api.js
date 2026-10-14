// API Client for Studio backend communications

export async function fetchStatus() {
  const res = await fetch('/api/status');
  if (!res.ok) throw new Error('Failed to fetch status');
  return res.json();
}

export async function fetchPresets() {
  const res = await fetch('/api/presets');
  if (!res.ok) throw new Error('Failed to fetch presets');
  return res.json();
}

export async function fetchGallery() {
  const res = await fetch('/api/gallery');
  if (!res.ok) throw new Error('Failed to fetch gallery');
  return res.json();
}

export async function fetchModels(engine = 'ipex') {
  const res = await fetch(`/api/models?engine=${encodeURIComponent(engine)}`);
  if (!res.ok) throw new Error('Failed to fetch models');
  return res.json();
}

export async function loadModelStream(modelPath, engine = 'ipex', onProgress, onComplete, onError) {
  const res = await fetch('/api/model/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_path: modelPath || '', engine: engine || 'ipex' })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Model load failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        if (data.status === 'loading' && onProgress) {
          onProgress(data);
        } else if (data.status === 'ready' && onComplete) {
          onComplete(data);
        } else if (data.status === 'error' && onError) {
          onError(data.error || data.message);
        }
      } catch (e) {
        console.error('Failed to parse SSE payload:', e, trimmed);
      }
    }
  }
}

export async function unloadModel() {
  const res = await fetch('/api/model/unload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Unload failed with status ${res.status}`);
  }
  return res.json();
}

export async function unloadModelStream(onProgress, onComplete, onError) {
  const res = await fetch('/api/model/unload?stream=true', {
    method: 'POST',
    headers: { 'Accept': 'text/event-stream' }
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Unload failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        if (data.status === 'unloading' && onProgress) {
          onProgress(data);
        } else if ((data.status === 'unloaded' || data.status === 'ready') && onComplete) {
          onComplete(data);
        } else if (data.status === 'error' && onError) {
          onError(data.error || data.message);
        }
      } catch (e) {
        console.error('Failed to parse unload SSE payload:', e, trimmed);
      }
    }
  }
}

export async function generateArtStream(payload, onProgress, onComplete, onError) {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Generation failed with status ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(trimmed.slice(6));
        if (data.status === 'progress' && onProgress) {
          onProgress(data);
        } else if (data.status === 'complete' && onComplete) {
          onComplete(data.image, data);
        } else if (data.status === 'error' && onError) {
          onError(data.error);
        }
      } catch (e) {
        console.error('Failed to parse SSE payload:', e, trimmed);
      }
    }
  }
}

export async function deleteGalleryImages(filenames) {
  const res = await fetch('/api/gallery/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filenames })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Delete failed with status ${res.status}`);
  }
  return res.json();
}

export async function exportBundle(payload) {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Export failed with status ${res.status}`);
  }
  return res.json();
}

export async function searchHFModels(query = '', page = 1, limit = 10, engine = 'ipex') {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit),
    engine: engine || 'ipex'
  });
  const res = await fetch(`/api/hf/search?${params.toString()}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HuggingFace search failed with status ${res.status}`);
  }
  return res.json();
}

export async function downloadHFModel(repoId, filename, engine = 'ipex') {
  const res = await fetch('/api/hf/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo_id: repoId, filename, engine: engine || 'ipex' })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `HuggingFace download failed with status ${res.status}`);
  }
  return res.json();
}

export async function fetchHFDownloadStatus() {
  const res = await fetch('/api/hf/download/status');
  if (!res.ok) throw new Error('Failed to fetch download status');
  return res.json();
}

export async function cancelHFDownload(taskId) {
  const res = await fetch('/api/hf/download/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId })
  });
  if (!res.ok) throw new Error('Failed to cancel download');
  return res.json();
}

export async function fetchHFModelInfo(repoId) {
  const res = await fetch(`/api/hf/model/info?id=${encodeURIComponent(repoId)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to fetch model info: ${res.status}`);
  }
  return res.json();
}
