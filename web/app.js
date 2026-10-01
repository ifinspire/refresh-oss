/* Plain browser code. No third-party scripts, trackers or sign-in widgets. */
const $ = (selector) => document.querySelector(selector);
const state = { photos: [], selected: null, crop: null, image: null, jobsText: '', poll: null };
const names = { natural: 'Natural', balanced: 'Balanced', reimagined: 'Reimagined' };
const statuses = { queued: 'Waiting', running: 'Making images…', complete: 'Ready', partial: 'Some versions are ready', failed: 'Could not finish', uncertain: 'Check the image server before trying again' };
function element(tag, text, cls) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; }
function note(text) { $('#notice').textContent = text; }
async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'X-Refresh-Request': '1', ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail || 'Something went wrong. Please try again.');
  return value;
}
function button(text, action, cls = 'quiet') { const node = element('button', text, cls); node.type = 'button'; node.onclick = () => safely(action, node); return node; }
async function safely(action, node) { if (node) node.disabled = true; try { await action(); } catch (error) { note(error.message); } finally { if (node) node.disabled = false; } }
function photoImage(photo, kind = 'thumbnail.jpg') { const img = element('img'); img.src = `/api/photos/${photo.id}/${kind}`; img.alt = photo.name; img.loading = 'lazy'; return img; }
async function loadPhotos() {
  state.photos = await api('/photos');
  const library = $('#library'); library.replaceChildren();
  if (!state.photos.length) library.append(element('p', 'Add your own photo, or try an example below.', 'muted'));
  for (const photo of state.photos) {
    const card = element('article', null, 'photo-card'); const open = button('', () => selectPhoto(photo)); open.append(photoImage(photo)); open.setAttribute('aria-label', `Open ${photo.name}`);
    card.append(open, element('p', photo.name), button('Delete', async () => {
      if (!confirm('Delete this photo and all reconstructions that use it, including as a reference? This cannot be undone.')) return;
      await api(`/photos/${photo.id}`, { method: 'DELETE' });
      if (state.selected?.id === photo.id) { state.selected = null; $('#editor').hidden = true; }
      await loadPhotos(); await loadJobs();
    }, 'quiet danger')); library.append(card);
  }
}
async function selectPhoto(photo) {
  state.selected = photo; state.crop = null; $('#editor').hidden = false; $('#photo-title').textContent = photo.name;
  const image = new Image(); image.src = `/api/photos/${photo.id}/preview.png`; await image.decode(); state.image = image; drawCrop();
  $('#references').replaceChildren();
  for (const reference of state.photos.filter(p => p.id !== photo.id)) {
    const label = element('label'); const input = element('input'); input.type = 'checkbox'; input.value = reference.id;
    input.onchange = () => safely(async () => { if (references().length > 3) { input.checked = false; note('Choose up to three clear photos.'); } await loadPrompts(); });
    label.append(input, photoImage(reference), document.createTextNode(reference.name)); $('#references').append(label);
  }
  await loadPrompts(); $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function references() { return [...document.querySelectorAll('#references input:checked')].map(input => input.value); }
async function loadPrompts() {
  const prompts = await api(`/prompts?preset=${$('#preset').value}&references=${references().length}`);
  $('#prompts').replaceChildren();
  for (const [mode, prompt] of Object.entries(prompts)) $('#prompts').append(element('h3', names[mode]), element('pre', prompt));
}
function drawCrop(rect = state.crop) {
  if (!state.image) return;
  const canvas = $('#framing'), image = state.image; canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
  if (rect) { const sx = canvas.width / state.selected.width, sy = canvas.height / state.selected.height; ctx.strokeStyle = '#ff4fa0'; ctx.lineWidth = 4; ctx.strokeRect(rect[0]*sx, rect[1]*sy, rect[2]*sx, rect[3]*sy); }
  $('#crop-state').textContent = rect ? 'Using the area inside the pink outline.' : 'Using the whole photo.';
}
let start = null;
function point(event) { const box = $('#framing').getBoundingClientRect(); return [Math.round(Math.max(0, Math.min(1, (event.clientX-box.left)/box.width))*state.selected.width), Math.round(Math.max(0, Math.min(1, (event.clientY-box.top)/box.height))*state.selected.height)]; }
$('#framing').onpointerdown = event => { if (!state.selected) return; start = point(event); $('#framing').setPointerCapture(event.pointerId); };
$('#framing').onpointermove = event => { if (!start) return; const end = point(event); drawCrop([Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.abs(end[0]-start[0]),Math.abs(end[1]-start[1])]); };
$('#framing').onpointerup = event => { if (!start) return; const end = point(event); const rect = [Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.abs(end[0]-start[0]),Math.abs(end[1]-start[1])]; start = null; state.crop = rect[2] > 4 && rect[3] > 4 ? rect : null; drawCrop(); };
$('#framing').onpointercancel = () => { start = null; drawCrop(); };
$('#reset-crop').onclick = () => { state.crop = null; drawCrop(); };
$('#editor-close').onclick = () => { $('#editor').hidden = true; };
$('#preset').onchange = () => safely(loadPrompts);
$('#upload-open').onclick = () => $('#upload').click();
$('#upload').onchange = () => safely(async () => {
  const file = $('#upload').files[0]; if (!file) return;
  if (file.size > 20*1024*1024) throw new Error('Choose a photo smaller than 20 MB.');
  note('Adding your photo…'); const photo = await api(`/photos?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  $('#upload').value = ''; await loadPhotos(); await selectPhoto(photo); note('Photo added.');
});
$('#generate').onclick = () => safely(async () => {
  await api('/jobs', { method: 'POST', body: JSON.stringify({ photo_id: state.selected.id, references: references(), crop: state.crop, preset: $('#preset').value }) });
  note('Started. You can follow the progress below.'); await loadJobs();
}, $('#generate'));
async function loadSettings() { const settings = await api('/settings'); const form = $('#settings-form'); for (const field of ['base_url','model','timeout']) form.elements[field].value = settings[field]; form.elements.api_key.value = ''; form.elements.clear_key.checked = false; $('#key-state').textContent = settings.has_api_key ? 'A key is saved. Leave blank to keep it.' : 'No access key is saved.'; }
$('#settings-open').onclick = () => safely(async () => { await loadSettings(); $('#settings').hidden = false; $('#settings').scrollIntoView({ behavior: 'smooth' }); });
$('#settings-close').onclick = () => { $('#settings').hidden = true; };
$('#settings-form').onsubmit = event => { event.preventDefault(); safely(async () => { const form = event.target; await api('/settings', { method: 'PUT', body: JSON.stringify({ base_url: form.elements.base_url.value, model: form.elements.model.value, timeout: Number(form.elements.timeout.value), api_key: form.elements.clear_key.checked ? '' : form.elements.api_key.value || null }) }); await loadSettings(); $('#connection').textContent = 'Settings saved. Check the connection, then try a test image.'; }, event.submitter); };
$('#check').onclick = () => safely(async () => { $('#connection').textContent = 'Checking the saved server settings…'; try { const result = await api('/settings/check', { method: 'POST' }); $('#connection').textContent = result.detail; } catch (error) { $('#connection').textContent = error.message; } }, $('#check'));
$('#verify').onclick = () => safely(async () => { await api('/settings/verify', { method: 'POST' }); $('#connection').textContent = 'Test started. Look for “Image server test” in your reconstructions below.'; await loadPhotos(); await loadJobs(); }, $('#verify'));
function compare(before, after, label) {
  const wrapper = element('div'); const canvas = element('canvas'); canvas.setAttribute('aria-label', label); const slider = element('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = 50; slider.setAttribute('aria-label', 'Move between original and reconstruction'); const a = new Image(), b = new Image(); a.src = before; b.src = after;
  function draw() { if (!a.naturalWidth || !b.naturalWidth) return; canvas.width = b.naturalWidth; canvas.height = b.naturalHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(b,0,0,canvas.width,canvas.height); ctx.save(); ctx.beginPath(); ctx.rect(0,0,canvas.width*slider.value/100,canvas.height); ctx.clip(); ctx.drawImage(a,0,0,canvas.width,canvas.height); ctx.restore(); ctx.fillStyle = '#ff4fa0'; ctx.fillRect(canvas.width*slider.value/100-1,0,2,canvas.height); }
  a.onload = b.onload = draw; slider.oninput = draw; wrapper.append(canvas, slider, element('small','Original on the left · reconstruction on the right')); return wrapper;
}
async function loadJobs() {
  const jobs = await api('/jobs'), serialized = JSON.stringify(jobs);
  if (state.jobsText === serialized) return; state.jobsText = serialized;
  $('#jobs').replaceChildren();
  if (!jobs.length) $('#jobs').append(element('p', 'Your finished versions will appear here.', 'muted'));
  for (const job of jobs) {
    const card = element('article', null, 'job'); const head = element('div', null, 'row'); const photo = state.photos.find(p => p.id === job.photo_id);
    head.append(element('h3', job.kind === 'verification' ? 'Image server test' : `${photo?.name || 'Photo'}${job.parent_id ? ' · another pass' : ''}`), element('span', statuses[job.status], 'badge')); card.append(head);
    card.append(element('p', new Date(job.created*1000).toLocaleString(), 'muted'));
    if (job.error) card.append(element('p', job.error));
    for (const step of job.steps) if (step.error || step.status === 'running') card.append(element('p', `${names[step.mode]}: ${step.error || 'working…'}`));
    if (job.status === 'uncertain') card.append(button('I checked: the image server has stopped working on this', async () => { if (!confirm('Confirm that the image server has finished or stopped this request. This allows a new request; it does not recover missing results.')) return; await api(`/jobs/${job.id}/acknowledge`, { method: 'POST' }); await loadJobs(); }));
    const grid = element('div', null, 'result-grid');
    for (const [mode, result] of Object.entries(job.results)) {
      const item = element('div', null, 'result'); item.append(element('h3', names[mode]));
      // Prepared input preserves the selected framing. Preview comparison is shown below via a saved snapshot.
      item.append(compare(`/api/jobs/${job.id}/anchor.png`, `/api/jobs/${job.id}/${mode}.webp`, `${names[mode]} comparison`));
      if (mode === 'reimagined') item.append(element('small', 'May invent details or change likeness.'));
      const link = element('a', 'Download PNG'); link.href = `/api/jobs/${job.id}/${mode}.webp?download=true`; item.append(link);
      if (!['queued','running','uncertain'].includes(job.status)) item.append(button('Refine this version', async () => { if (!confirm('Make another pass with the same instructions? Repeated passes can change the face.')) return; await api('/jobs', { method:'POST', body: JSON.stringify({photo_id:job.photo_id,parent_id:job.id,parent_mode:mode}) }); await loadJobs(); }));
      const detail = element('details'); detail.append(element('summary','Instructions and image details'), element('p',`Model: ${result.model}. Time: ${result.elapsed} seconds. Brightness and color matched to the original.`), element('pre',result.prompt), element('pre', JSON.stringify(result,null,2))); item.append(detail); grid.append(item);
    }
    card.append(grid);
    const technical = element('details'); technical.append(element('summary','Full work record'),element('pre',JSON.stringify(job,null,2))); card.append(technical);
    if (!['queued','running','uncertain'].includes(job.status)) card.append(button('Delete this reconstruction', async () => { if (!confirm('Delete these versions? Other saved reconstructions will remain.')) return; await api(`/jobs/${job.id}`,{method:'DELETE'}); await loadJobs(); }, 'quiet danger'));
    $('#jobs').append(card);
  }
}
async function loadExamples() {
  for (const example of await api('/examples')) {
    const card = element('article'); card.append(element('h3', example.name)); const img = element('img'); img.src = `/examples/${example.name}-balanced.webp`; img.alt = `Saved reconstruction: ${example.name}`; img.loading = 'lazy'; card.append(img);
    const select = element('select'); select.setAttribute('aria-label', `View ${example.name} example version`); for (const [value,label] of [['before','Blurred original'],['natural','Natural'],['balanced','Balanced'],['crisp','Reimagined']]) { const option = element('option',label); option.value = value; select.append(option); } select.value = 'balanced'; select.onchange = () => { img.src = `/examples/${example.name}-${select.value}.webp`; }; card.append(select);
    const credit = element('a',example.credit); credit.href = example.page; credit.target = '_blank'; credit.rel = 'noreferrer'; const caption = element('p'); caption.append(credit,document.createTextNode(` · ${example.license}`)); card.append(caption,button('Try with this photo',async () => { const photo = await api(`/examples/${example.name}`,{method:'POST'}); await loadPhotos(); await selectPhoto(photo); })); $('#examples').append(card);
  }
}
(async () => { await safely(async () => { await loadPhotos(); await loadJobs(); await loadExamples(); }); async function poll() { await safely(loadJobs); state.poll = setTimeout(poll,2500); } state.poll = setTimeout(poll,2500); })();
