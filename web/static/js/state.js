// Central State Store

export const state = {
  status: { ready: false, device: '', model: '' },
  presets: [],
  gallery: [],
  selectedFiles: new Set(),
  isGenerating: false,
  isExporting: false,
  listeners: new Map()
};

export function subscribe(event, callback) {
  if (!state.listeners.has(event)) {
    state.listeners.set(event, []);
  }
  state.listeners.get(event).push(callback);
}

export function emit(event, data) {
  if (state.listeners.has(event)) {
    state.listeners.get(event).forEach(cb => cb(data));
  }
}

export function toggleSelection(filename) {
  if (state.selectedFiles.has(filename)) {
    state.selectedFiles.delete(filename);
  } else {
    state.selectedFiles.add(filename);
  }
  emit('selectionChanged', Array.from(state.selectedFiles));
}

export function selectAll(filenames) {
  filenames.forEach(f => state.selectedFiles.add(f));
  emit('selectionChanged', Array.from(state.selectedFiles));
}

export function clearSelection() {
  state.selectedFiles.clear();
  emit('selectionChanged', []);
}
