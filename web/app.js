/* One local library, three focused screens. No external scripts or services. */
const $ = selector => document.querySelector(selector);
const names = { natural: 'Natural', balanced: 'Balanced', reimagined: 'Reimagined' };
const descriptions = {
  original: 'Your original photo stays unchanged.',
  natural: 'A gentle reconstruction, close to the original.',
  balanced: 'A second pass to bring out existing lines.',
  reimagined: 'More creative detail. May change the person’s likeness.'
};
const pending = job => ['queued', 'running', 'uncertain'].includes(job.status);
const state = {
  photos: [], jobs: [], examples: [], selected: null, screen: 'gallery', drafts: new Map(),
  jobId: null, mode: 'original', comparisonKey: '', image: null, cropDraft: null,
  routeToken: 0, jobText: '', noticeTimer: null, submitting: false, settingsLoaded: false
};
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
function note(text, error = false) {
  clearTimeout(state.noticeTimer);
  $('#notice span').textContent = text;
  $('#notice').dataset.error = String(error);
  $('#notice').hidden = false;
  if (!error) state.noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 4500);
}
$('#notice button').onclick = () => { $('#notice').hidden = true; };
async function safely(action, node) {
  if (node) node.disabled = true;
  try { return await action(); }
  catch (error) { note(error.message || 'Could not complete that action. Please try again.', true); }
  finally {
    if (node?.isConnected) node.disabled = false;
    if (node?.id === 'verify') renderVerification();
  }
}
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: { 'X-Refresh-Request': '1', ...(typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
  } catch { throw new Error('The app is not responding. Check that it is running, then try again.'); }
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail || 'Could not complete that action. Please try again.');
  return value;
}
function button(text, action, cls = 'quiet') {
  const node = el('button', text, cls);
  node.type = 'button';
  node.onclick = () => safely(action, node);
  return node;
}
function image(src, alt) { const node = el('img'); node.src = src; node.alt = alt; node.loading = 'lazy'; return node; }
function photoURL(photo, kind = 'preview.png') { return `/api/photos/${photo.id}/${kind}`; }
function resultURL(job, mode) { return `/api/jobs/${job.id}/${mode}.webp`; }
function photoJobs(id) { return state.jobs.filter(job => job.photo_id === id && job.kind !== 'verification'); }
function visiblePhotos() {
  const tests = new Set(state.jobs.filter(job => job.kind === 'verification').map(job => job.photo_id));
  return state.photos.filter(photo => !tests.has(photo.id) || photoJobs(photo.id).length);
}
function currentJob() { return state.jobs.find(job => job.id === state.jobId); }
function draft() {
  if (!state.selected) return null;
  if (!state.drafts.has(state.selected.id)) {
    const previous = photoJobs(state.selected.id)[0];
    state.drafts.set(state.selected.id, { crop: previous?.crop || null, preset: previous?.preset || 'unblur', references: [...(previous?.references || [])] });
  }
  return state.drafts.get(state.selected.id);
}
function resultMode(job) { return ['balanced', 'natural', 'reimagined'].find(mode => job?.results[mode]) || 'original'; }
function timeLabel(value) { return new Date(value * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function go(hash) { if (location.hash === hash) safely(route); else location.hash = hash; }
function showScreen(name) {
  state.screen = name;
  for (const node of document.querySelectorAll('.screen')) node.hidden = node.id !== `${name}-screen`;
  for (const [key, node] of [['gallery', $('#nav-gallery')], ['reconstruction', $('#nav-reconstruction')], ['settings', $('#nav-settings')]]) {
    if (key === (name === 'new' ? 'reconstruction' : name)) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
  document.title = `${name === 'gallery' ? 'Gallery' : name === 'settings' ? 'Settings' : 'Reconstruction'} · refresh`;
}
async function route() {
  const token = ++state.routeToken;
  const parts = location.hash.slice(1).split('/').filter(Boolean);
  if (parts[0] === 'settings') {
    showScreen('settings');
    if (!state.settingsLoaded) await loadSettings();
    renderVerification();
  } else if (parts[0] === 'photo' && parts[1]) {
    const photo = state.photos.find(item => item.id === parts[1]);
    if (!photo) { note('That photo is no longer in your library.', true); go('#/gallery'); return; }
    const changed = state.selected?.id !== photo.id;
    state.selected = photo;
    if (changed) {
      state.jobId = photoJobs(photo.id)[0]?.id || null;
      state.mode = resultMode(currentJob());
      state.image = null;
      state.comparisonKey = '';
    }
    $('#nav-reconstruction').href = `#/photo/${photo.id}`;
    $('#photo-title').textContent = photo.name;
    $('#source-preview').src = photoURL(photo);
    $('#source-preview').alt = photo.name;
    showScreen('reconstruction');
    $('#preset').value = draft().preset;
    renderReferences(); renderDraft(); renderReconstruction();
    const img = new Image(); img.src = photoURL(photo);
    try { await img.decode(); if (token === state.routeToken) { state.image = img; renderPreview(); } }
    catch { if (token === state.routeToken) note('The photo preview could not load. Try reopening the photo.', true); }
  } else if (parts[0] === 'new') showScreen('new');
  else { showScreen('gallery'); renderGallery(); }
  if (token === state.routeToken) window.scrollTo({ top: 0, behavior: 'instant' });
}
function renderGallery() {
  const photos = visiblePhotos();
  $('#photo-count').textContent = photos.length ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : '';
  $('#empty-gallery').hidden = photos.length > 0;
  $('#library').replaceChildren();
  for (const photo of photos) {
    const jobs = photoJobs(photo.id), versions = jobs.reduce((total, job) => total + Object.keys(job.results).length, 0);
    const latestResult = jobs.find(job => Object.keys(job.results).length);
    const card = el('article', null, 'photo-card');
    const open = button('', () => go(`#/photo/${photo.id}`), 'photo-open');
    open.setAttribute('aria-label', `Open ${photo.name}`);
    const frame = el('div', null, 'photo-image');
    frame.append(image(latestResult ? resultURL(latestResult, resultMode(latestResult)) : photoURL(photo), photo.name));
    const active = jobs.find(pending);
    if (active) frame.append(el('span', active.status === 'uncertain' ? 'Needs attention' : 'Making images…', 'photo-badge'));
    else if (versions) frame.append(el('span', `${versions} ${versions === 1 ? 'version' : 'versions'}`, 'photo-badge'));
    open.append(frame, el('h3', photo.name), el('p', versions ? 'Original & reconstructions' : 'Ready to reconstruct'));
    const remove = button('×', () => deletePhoto(photo), 'icon-button');
    remove.setAttribute('aria-label', `Delete ${photo.name}`); remove.title = 'Delete photo';
    card.append(open, remove); $('#library').append(card);
  }
}
async function refreshPhotos() { state.photos = await api('/photos'); if (state.screen === 'gallery') renderGallery(); }
async function deletePhoto(photo) {
  if (!confirm('Delete this photo and all reconstructions that use it? This cannot be undone.')) return;
  await api(`/photos/${photo.id}`, { method: 'DELETE' });
  state.drafts.delete(photo.id);
  if (state.selected?.id === photo.id) { state.selected = null; state.image = null; $('#nav-reconstruction').href = '#/new'; }
  await refreshPhotos(); await loadJobs();
  if (state.screen === 'reconstruction') go('#/gallery');
  else renderGallery();
  note('Photo deleted.');
}
$('#delete-photo').onclick = () => safely(() => deletePhoto(state.selected));
async function upload(file) {
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a photo smaller than 20 MB.');
  return api(`/photos?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
}
for (const id of ['upload-open', 'empty-upload', 'new-upload']) $(`#${id}`).onclick = () => $('#upload').click();
$('#upload').onchange = () => safely(async () => {
  const file = $('#upload').files[0]; $('#upload').value = '';
  if (!file) return;
  note('Adding photo…'); const photo = await upload(file); await refreshPhotos(); go(`#/photo/${photo.id}`); $('#notice').hidden = true;
});
let dragDepth = 0;
window.addEventListener('dragenter', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false;
});
window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
window.addEventListener('dragleave', event => { if (!event.dataTransfer?.types.includes('Files')) return; if (--dragDepth <= 0) $('#drop-overlay').hidden = true; });
window.addEventListener('drop', event => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true;
  safely(async () => { const photo = await upload(event.dataTransfer.files[0]); await refreshPhotos(); go(`#/photo/${photo.id}`); });
});
function renderDraft() {
  const value = draft();
  $('#crop-label').textContent = value.crop ? 'Cropped photo' : 'Whole photo';
  $('#options-summary').textContent = value.crop ? 'Cropped' : '';
  $('#reference-count').textContent = value.references.length ? `${value.references.length} selected` : 'Optional';
}
function renderReferences() {
  const container = $('#references'); container.replaceChildren();
  const value = draft(); value.references = value.references.filter(id => state.photos.some(photo => photo.id === id));
  for (const photo of visiblePhotos().filter(item => item.id !== state.selected.id)) {
    const label = el('label'), input = el('input'); input.type = 'checkbox'; input.value = photo.id;
    input.checked = value.references.includes(photo.id); input.setAttribute('aria-label', `Use ${photo.name} as a reference`);
    input.onchange = () => {
      if (input.checked && value.references.length >= 3) { input.checked = false; note('Choose up to three reference photos.'); return; }
      value.references = input.checked ? [...value.references, photo.id] : value.references.filter(id => id !== photo.id);
      renderDraft();
    };
    label.append(input, image(photoURL(photo, 'thumbnail.jpg'), ''), el('span', photo.name)); container.append(label);
  }
  if (!container.children.length) container.append(el('p', 'No other photos yet.', 'muted small'));
  renderDraft();
}
$('#preset').onchange = () => { draft().preset = $('#preset').value; };
$('#reference-upload').onclick = () => $('#reference-file').click();
$('#reference-file').onchange = () => safely(async () => {
  const file = $('#reference-file').files[0]; $('#reference-file').value = '';
  if (!file) return;
  const value = draft();
  if (value.references.length >= 3) throw new Error('Remove a reference before adding another.');
  const photo = await upload(file); value.references.push(photo.id); await refreshPhotos(); renderReferences();
});
function openDialog(id) { if (!$(`#${id}`).open) $(`#${id}`).showModal(); }
for (const close of document.querySelectorAll('.dialog-close')) close.onclick = () => close.closest('dialog').close();
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  const box = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) dialog.close();
});
$('#crop-open').onclick = () => safely(async () => {
  if (!state.image) throw new Error('Wait for the photo to load, then try again.');
  state.cropDraft = draft().crop ? [...draft().crop] : null; openDialog('crop-dialog'); drawCrop();
});
function cropFields(rect) {
  const values = rect || [0, 0, state.selected.width, state.selected.height];
  ['x', 'y', 'w', 'h'].forEach((key, index) => { $(`#crop-${key}`).value = values[index]; });
}
function drawCrop(updateFields = true) {
  if (!state.image) return;
  const canvas = $('#framing'), source = state.image, rect = state.cropDraft;
  canvas.width = source.naturalWidth; canvas.height = source.naturalHeight;
  const ctx = canvas.getContext('2d'); ctx.drawImage(source, 0, 0);
  if (rect) {
    const sx = canvas.width / state.selected.width, sy = canvas.height / state.selected.height;
    const [x, y, w, h] = [rect[0] * sx, rect[1] * sy, rect[2] * sx, rect[3] * sy];
    ctx.fillStyle = '#0007'; ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height); ctx.rect(x, y, w, h); ctx.fill('evenodd');
    ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h);
  }
  if (updateFields) cropFields(rect);
}
let cropStart = null;
function cropPoint(event) {
  const box = $('#framing').getBoundingClientRect();
  return [Math.round(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * state.selected.width), Math.round(Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) * state.selected.height)];
}
$('#framing').onpointerdown = event => { cropStart = cropPoint(event); $('#framing').setPointerCapture(event.pointerId); };
$('#framing').onpointermove = event => {
  if (!cropStart) return; const end = cropPoint(event);
  state.cropDraft = [Math.min(cropStart[0], end[0]), Math.min(cropStart[1], end[1]), Math.abs(end[0] - cropStart[0]), Math.abs(end[1] - cropStart[1])]; drawCrop();
};
$('#framing').onpointerup = () => { cropStart = null; if (state.cropDraft && (state.cropDraft[2] < 5 || state.cropDraft[3] < 5)) state.cropDraft = null; drawCrop(); };
$('#framing').onpointercancel = () => { cropStart = null; state.cropDraft = draft().crop; drawCrop(); };
for (const key of ['x', 'y', 'w', 'h']) $(`#crop-${key}`).oninput = () => {
  state.cropDraft = ['x', 'y', 'w', 'h'].map(k => Number($(`#crop-${k}`).value)); drawCrop(false);
};
$('#reset-crop').onclick = () => { state.cropDraft = null; drawCrop(); };
$('#save-crop').onclick = () => safely(async () => {
  const rect = state.cropDraft;
  if (rect) {
    const [x, y, w, h] = rect;
    if (!rect.every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > state.selected.width || y + h > state.selected.height) throw new Error('Choose an area inside the photo.');
  }
  draft().crop = rect; state.mode = 'original'; $('#crop-dialog').close(); renderDraft(); renderReconstruction();
});
function renderReconstruction() {
  if (!state.selected || state.screen !== 'reconstruction') return;
  const job = currentJob(), blocked = state.jobs.some(pending);
  $('#generate').disabled = blocked || state.submitting;
  $('#generate').textContent = blocked && job && ['queued', 'running'].includes(job.status) ? 'Making your versions…' : photoJobs(state.selected.id).length ? 'Make three new versions' : 'Make three versions';
  const modes = $('#mode-tabs'); modes.replaceChildren();
  if (state.mode !== 'original' && !job?.results[state.mode]) state.mode = resultMode(job);
  for (const mode of ['original', ...Object.keys(names)]) {
    const tab = button(mode === 'original' ? 'Original' : names[mode], () => { state.mode = mode; renderReconstruction(); }, '');
    tab.disabled = mode !== 'original' && !job?.results[mode]; tab.setAttribute('aria-pressed', String(state.mode === mode)); modes.append(tab);
  }
  renderPreview(); renderStatus(); renderHistory();
}
function renderPreview() {
  const job = currentJob(), mode = state.mode, showingResult = mode !== 'original' && Boolean(job?.results[mode]);
  $('#source-preview').hidden = showingResult;
  $('#comparison').hidden = !showingResult;
  $('#preview-labels').hidden = !showingResult;
  $('#comparison-control').hidden = !showingResult;
  $('#result-actions').hidden = !showingResult;
  $('#mode-description').textContent = descriptions[mode];
  if (!showingResult) {
    state.comparisonKey = '';
    const crop = draft().crop;
    if (crop && state.image) {
      const [x, y, w, h] = crop, source = state.image, canvas = $('#comparison');
      const sx = source.naturalWidth / state.selected.width, sy = source.naturalHeight / state.selected.height;
      canvas.width = Math.max(1, Math.round(w * sx)); canvas.height = Math.max(1, Math.round(h * sy));
      canvas.getContext('2d').drawImage(source, x * sx, y * sy, w * sx, h * sy, 0, 0, canvas.width, canvas.height);
      canvas.hidden = false; $('#source-preview').hidden = true;
    }
    return;
  }
  $('#result-label').textContent = names[mode];
  $('#download').href = `${resultURL(job, mode)}?download=true`;
  $('#refine').disabled = state.jobs.some(pending) || state.submitting;
  const key = `${job.id}/${mode}`;
  if (state.comparisonKey === key) return;
  state.comparisonKey = key;
  const before = new Image(), after = new Image();
  before.src = `/api/jobs/${job.id}/anchor.png`; after.src = resultURL(job, mode);
  const canvas = $('#comparison'); canvas.width = 1; canvas.height = 1;
  Promise.all([before.decode(), after.decode()]).then(() => {
    if (state.comparisonKey !== key) return;
    canvas.width = after.naturalWidth; canvas.height = after.naturalHeight;
    const ctx = canvas.getContext('2d');
    const draw = () => {
      if (state.comparisonKey !== key) return;
      const split = canvas.width * Number($('#compare-slider').value) / 100;
      ctx.drawImage(after, 0, 0, canvas.width, canvas.height); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, split, canvas.height); ctx.clip(); ctx.drawImage(before, 0, 0, canvas.width, canvas.height); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.fillRect(split - 1.5, 0, 3, canvas.height);
      ctx.beginPath(); ctx.arc(split, canvas.height / 2, 17, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#625766'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(split - 4, canvas.height / 2 - 6); ctx.lineTo(split - 4, canvas.height / 2 + 6); ctx.moveTo(split + 4, canvas.height / 2 - 6); ctx.lineTo(split + 4, canvas.height / 2 + 6); ctx.stroke();
    };
    $('#compare-slider').oninput = draw; draw();
  }).catch(() => { if (state.comparisonKey === key) { state.comparisonKey = ''; note('The comparison could not load. Select the version to try again.', true); } });
}
function renderStatus() {
  const node = $('#job-status'), job = currentJob(), other = state.jobs.find(pending);
  node.replaceChildren(); node.hidden = true;
  if (job && ['queued', 'running'].includes(job.status)) {
    node.hidden = false; const line = el('p', null, 'working'); line.append(el('span', '', 'spinner'), document.createTextNode('Making your images…')); node.append(line);
    const running = job.steps.find(step => step.status === 'running');
    node.append(el('p', running ? `${names[running.mode]} is in progress.` : 'Getting your photo ready.'));
  } else if (job && ['failed', 'partial', 'uncertain'].includes(job.status)) {
    node.hidden = false;
    node.append(el('p', job.status === 'uncertain' ? 'The image server stopped responding.' : job.status === 'partial' ? 'Some versions are ready. One or more could not finish.' : 'Could not make these images.'));
    if (job.error) node.append(el('p', job.error));
    else { const error = job.steps.find(step => step.error); if (error) node.append(el('p', error.error)); }
    const link = el('a', 'Open settings'); link.href = '#/settings'; node.append(link);
    if (job.status === 'uncertain') node.append(button('I checked: the server is idle', async () => {
      if (!confirm('Confirm the image server has finished or stopped this request. This allows you to try again.')) return;
      await api(`/jobs/${job.id}/acknowledge`, { method: 'POST' }); await loadJobs();
    }, 'secondary compact'));
  } else if (other) {
    node.hidden = false; node.append(el('p', other.status === 'uncertain' ? 'Another image request needs attention.' : 'Another photo is being processed.'));
    const link = el('a', 'View progress'); link.href = other.kind === 'verification' ? '#/settings' : `#/photo/${other.photo_id}`; node.append(link);
  }
}
function renderHistory() {
  const jobs = photoJobs(state.selected.id); $('#history-section').hidden = jobs.length < 2; $('#history').replaceChildren();
  for (const job of jobs) {
    const mode = resultMode(job);
    const item = button('', () => { state.jobId = job.id; state.mode = resultMode(job); renderReconstruction(); }, 'history-item');
    item.setAttribute('aria-pressed', String(job.id === state.jobId));
    item.append(image(mode === 'original' ? photoURL(state.selected, 'thumbnail.jpg') : resultURL(job, mode), ''));
    const label = el('span'); label.append(el('strong', timeLabel(job.created)), el('small', pending(job) ? job.status === 'uncertain' ? 'Needs attention' : 'In progress' : `${Object.keys(job.results).length} ${job.parent_id ? 'refined version' : 'versions'}`));
    item.append(label); $('#history').append(item);
  }
}
async function submitJob(spec) {
  state.submitting = true; renderReconstruction();
  try {
    const job = await api('/jobs', { method: 'POST', body: JSON.stringify(spec) });
    state.jobId = job.id; state.mode = 'original'; await loadJobs();
  } finally { state.submitting = false; renderReconstruction(); }
}
$('#generate').onclick = () => safely(async () => {
  const value = draft(); await submitJob({ photo_id: state.selected.id, ...value });
});
$('#refine').onclick = () => safely(async () => {
  const job = currentJob(), mode = state.mode;
  if (!confirm('Make another pass on this version? Repeated passes can change facial details.')) return;
  await submitJob({ photo_id: job.photo_id, parent_id: job.id, parent_mode: mode });
});
$('#prompts-open').onclick = () => safely(async () => {
  const value = draft(), prompts = await api(`/prompts?preset=${value.preset}&references=${value.references.length}`);
  $('#details-title').textContent = 'Model instructions'; $('#details-content').replaceChildren();
  for (const [mode, text] of Object.entries(prompts)) $('#details-content').append(el('h3', names[mode]), el('pre', text));
  openDialog('details-dialog');
});
$('#result-details-open').onclick = () => {
  const job = currentJob(), result = job.results[state.mode];
  $('#details-title').textContent = `${names[state.mode]} details`;
  const node = $('#details-content'); node.replaceChildren();
  node.append(el('p', `${result.model} · ${result.elapsed} seconds`), el('p', 'Brightness and color matched to the original.'), el('h3', 'Instructions'), el('pre', result.prompt));
  const full = el('details'); full.append(el('summary', 'Full work record'), el('pre', JSON.stringify(job, null, 2))); node.append(full);
  node.append(button('Delete this reconstruction', async () => {
    if (!confirm('Delete all versions in this reconstruction? Your original and other reconstructions will remain.')) return;
    await api(`/jobs/${job.id}`, { method: 'DELETE' }); $('#details-dialog').close(); state.jobId = null; await loadJobs(); note('Reconstruction deleted.');
  }, 'quiet danger'));
  openDialog('details-dialog');
};
async function loadSettings() {
  const config = await api('/settings'), form = $('#settings-form');
  for (const key of ['base_url', 'model', 'timeout']) form.elements[key].value = config[key];
  form.elements.api_key.value = ''; form.elements.clear_key.checked = false;
  $('#key-state').textContent = config.has_api_key ? 'A key is saved. Leave blank to keep it.' : '';
  state.settingsLoaded = true;
}
async function saveSettings() {
  const form = $('#settings-form');
  if (!form.reportValidity()) return false;
  await api('/settings', { method: 'PUT', body: JSON.stringify({ base_url: form.elements.base_url.value, model: form.elements.model.value, timeout: Number(form.elements.timeout.value), api_key: form.elements.clear_key.checked ? '' : form.elements.api_key.value || null }) });
  await loadSettings(); return true;
}
function connection(title, detail, status = '') { $('#connection-title').textContent = title; $('#connection').textContent = detail; $('#connection-dot').dataset.state = status; }
$('#settings-form').onsubmit = event => {
  event.preventDefault(); safely(async () => {
    if (!await saveSettings()) return;
    $('#settings-feedback').textContent = 'Settings saved.'; connection('Checking…', 'Contacting your image server.');
    try {
      const result = await api('/settings/check', { method: 'POST' });
      connection(result.available ? 'Connected' : 'Model not found', result.available ? 'Your model is available. Try a test image to check it works.' : result.detail, result.available ? 'ready' : 'error');
    } catch (error) { connection('Could not connect', error.message, 'error'); }
  }, $('#save-settings'));
};
$('#settings-form').addEventListener('input', () => connection('Unsaved changes', 'Save to check this connection.'));
$('#use-local').onclick = () => {
  const form = $('#settings-form'); form.elements.base_url.value = 'http://omni:8000/v1'; form.elements.model.value = 'black-forest-labs/FLUX.2-klein-4B'; $('#settings-feedback').textContent = 'Local preset selected. Save to use it.'; connection('Unsaved changes', 'Save to check this connection.');
};
$('#verify').onclick = () => safely(async () => {
  if (!await saveSettings()) return;
  await api('/settings/verify', { method: 'POST' }); await refreshPhotos(); await loadJobs();
}, $('#verify'));
function renderVerification() {
  const node = $('#verification'), job = state.jobs.find(item => item.kind === 'verification');
  node.replaceChildren(); $('#verify').disabled = state.jobs.some(pending);
  if (!job) return;
  if (['queued', 'running'].includes(job.status)) {
    const line = el('p', null, 'working'); line.append(el('span', '', 'spinner'), document.createTextNode('Creating a test image…')); node.append(line);
  } else if (job.status === 'complete') {
    node.append(image(resultURL(job, 'natural'), 'Image server test result'), el('p', 'Test image created. You’re ready to go.'));
  } else {
    node.append(el('p', 'The image test could not finish.'), el('p', job.error || job.steps.find(step => step.error)?.error || 'Check your connection and try again.'));
    if (job.status === 'uncertain') node.append(button('I checked: the server is idle', async () => {
      if (!confirm('Confirm the image server has finished or stopped the test request.')) return;
      await api(`/jobs/${job.id}/acknowledge`, { method: 'POST' }); await loadJobs();
    }, 'secondary compact'));
  }
  if (!pending(job)) node.append(button('Remove test image', async () => {
    await api(`/photos/${job.photo_id}`, { method: 'DELETE' }); await refreshPhotos(); await loadJobs();
  }, 'quiet'));
}
async function loadJobs() {
  const jobs = await api('/jobs'), serialized = JSON.stringify(jobs);
  if (serialized === state.jobText) return;
  const oldJob = currentJob(); state.jobText = serialized; state.jobs = jobs;
  if (state.selected) {
    if (!currentJob()) state.jobId = photoJobs(state.selected.id)[0]?.id || null;
    const job = currentJob();
    if (job && (!oldJob || pending(oldJob)) && !pending(job) && Object.keys(job.results).length) state.mode = resultMode(job);
    renderReconstruction();
  }
  if (state.screen === 'gallery') renderGallery();
  renderVerification();
}
function renderExamples() {
  const node = $('#examples'); node.replaceChildren();
  const labels = { man: 'Studio portrait', girl: 'Young girl', woman: 'Checked collar', elder: 'Cabinet portrait', youth: 'Irvine Smith' };
  for (const example of state.examples) {
    const card = el('article', null, 'example'), img = image(`/examples/${example.name}-before.webp`, labels[example.name]);
    const select = el('select'); select.setAttribute('aria-label', `Preview ${labels[example.name]}`);
    for (const [value, label] of [['before', 'Original'], ['natural', 'Natural'], ['balanced', 'Balanced'], ['crisp', 'Reimagined']]) { const option = el('option', label); option.value = value; select.append(option); }
    select.onchange = () => { img.src = `/examples/${example.name}-${select.value}.webp`; };
    const use = button('Use photo', async () => { const photo = await api(`/examples/${example.name}`, { method: 'POST' }); await refreshPhotos(); $('#examples-dialog').close(); go(`#/photo/${photo.id}`); }, 'primary');
    use.setAttribute('aria-label', `Use ${labels[example.name]}`);
    const credit = el('details'), link = el('a', example.credit); link.href = example.page; link.target = '_blank'; link.rel = 'noreferrer'; credit.append(el('summary', 'Source & credit'), link, document.createTextNode(example.license));
    card.append(img, el('h3', labels[example.name]), select, use, credit); node.append(card);
  }
}
for (const id of ['examples-open', 'new-example']) $(`#${id}`).onclick = () => openDialog('examples-dialog');
async function start() {
  const [photos, jobs, examples] = await Promise.all([api('/photos'), api('/jobs'), api('/examples')]);
  state.photos = photos; state.jobs = jobs; state.jobText = JSON.stringify(jobs); state.examples = examples;
  renderExamples();
  window.addEventListener('hashchange', () => safely(route));
  await route();
  async function poll() {
    try { await loadJobs(); } catch { /* Actions display connection failures; polling stays quiet. */ }
    setTimeout(poll, 2000);
  }
  setTimeout(poll, 2000);
}
safely(start);
