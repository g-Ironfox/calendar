const $ = (selector) => document.querySelector(selector);
const today = new Date();
const state = { year: today.getFullYear(), month: today.getMonth(), selectedDate: formatDate(today), events: [], editingId: null, enabledColors: new Set() };
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const colorNames = {};
const defaultColors = { blue: '#5684E8', green: '#45A783', orange: '#E29A43', pink: '#D96884', purple: '#9071C8' };
const colorPresets = ['#5684E8', '#3478C8', '#35A783', '#21A69A', '#E29A43', '#D97836', '#D96884', '#BE5E9B', '#9071C8', '#685CB5', '#65758B', '#3C8C78'];
const savedColors = (() => { try { const value = JSON.parse(localStorage.getItem('dayline-calendar-colors') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } })();
const savedCategories = (() => { try { const value = JSON.parse(localStorage.getItem('dayline-calendar-categories') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } })();
const calendarCategories = [];
const calendarColors = { ...defaultColors };
const colorSaveTimers = new Map();
let editingCategoryId = null;
let deletingCategoryId = null;

function applyCalendarColor(category, color, persist = false) {
  calendarColors[category] = color;
  document.documentElement.style.setProperty(`--calendar-${category}`, color);
  document.querySelector(`[data-palette-toggle="${category}"]`).style.backgroundColor = color;
  document.querySelectorAll(`[data-palette="${category}"] .palette-swatch`).forEach((swatch) => {
    swatch.setAttribute('aria-pressed', String(swatch.dataset.color.toLowerCase() === color.toLowerCase()));
  });
  document.querySelectorAll(`.event-chip.${category}, .agenda-item.${category}`).forEach((event) => {
    event.style.setProperty('--event-color', color);
    event.style.setProperty('--event-tint', `color-mix(in srgb, ${color} 14%, white)`);
  });
  if (persist) {
    localStorage.setItem('dayline-calendar-colors', JSON.stringify(calendarColors));
    const categoryInfo = calendarCategories.find((item) => item.id === category);
    if (categoryInfo) {
      window.clearTimeout(colorSaveTimers.get(category));
      colorSaveTimers.set(category, window.setTimeout(() => fetch(`/api/categories/${encodeURIComponent(category)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: categoryInfo.name, color }),
      }).catch(() => showToast('颜色已保存在本机，暂未同步到服务器')), 300));
    }
  }
}
async function refreshCategories() {
  const response = await fetch('/api/categories');
  if (!response.ok) throw new Error('类型加载失败');
  const items = await response.json();
  const previousIds = new Set(calendarCategories.map((category) => category.id));
  calendarCategories.splice(0, calendarCategories.length, ...items);
  const activeIds = new Set(items.map((category) => category.id));
  [...state.enabledColors].forEach((id) => { if (previousIds.has(id) && !activeIds.has(id)) state.enabledColors.delete(id); });
  items.forEach((category) => {
    colorNames[category.id] = category.name;
    calendarColors[category.id] = category.color;
    state.enabledColors.add(category.id);
  });
  setupColorPalettes();
}
async function initializeCategories() {
  try {
    let response = await fetch('/api/categories');
    if (!response.ok) throw new Error('类型加载失败');
    let existing = await response.json();
    const existingIds = new Set(existing.map((category) => category.id));
    for (const legacy of savedCategories) {
      if (!legacy || !/^custom-[a-z0-9-]{1,32}$/.test(legacy.id) || !legacy.name || existingIds.has(legacy.id)) continue;
      const result = await fetch('/api/categories', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: legacy.id, name: legacy.name.trim().slice(0, 24), color: savedColors[legacy.id] || colorPresets[0] }),
      });
      if (result.ok) existingIds.add(legacy.id);
    }
    if (localStorage.getItem('dayline-category-colors-migrated') !== '1') {
      for (const category of existing) {
        const oldColor = savedColors[category.id];
        if (!oldColor || !/^#[0-9a-f]{6}$/i.test(oldColor) || oldColor.toUpperCase() === category.color.toUpperCase()) continue;
        await fetch(`/api/categories/${encodeURIComponent(category.id)}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: category.name, color: oldColor }),
        });
      }
      localStorage.setItem('dayline-category-colors-migrated', '1');
    }
    await refreshCategories();
    localStorage.removeItem('dayline-calendar-categories');
    render();
    await loadEvents();
  } catch (error) {
    showToast(error.message);
  }
}
function renderCategoryOptions() {
  const select = $('#event-color');
  const selected = select.value;
  select.replaceChildren();
  if (!calendarCategories.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = '请先新增类型'; option.disabled = true; select.append(option);
  }
  calendarCategories.forEach((category) => {
    const option = document.createElement('option'); option.value = category.id; option.textContent = category.name; select.append(option);
  });
  select.value = calendarCategories.some((category) => category.id === selected) ? selected : (calendarCategories[0]?.id || '');
}
function setupColorPalettes() {
  document.querySelectorAll('.color-palette').forEach((palette) => palette.remove());
  const container = $('#category-list'); container.replaceChildren();
  if (!calendarCategories.length) {
    const empty = document.createElement('p'); empty.className = 'category-empty'; empty.textContent = '还没有类型'; container.append(empty);
  }
  calendarCategories.forEach((category) => {
    const row = document.createElement('div'); row.className = 'calendar-row';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.enabledColors.has(category.id); checkbox.dataset.filter = category.id;
    checkbox.setAttribute('aria-label', `显示${category.name}日程`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.enabledColors.add(category.id); else state.enabledColors.delete(category.id);
      render();
    });
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = `dot ${category.id}`;
    toggle.dataset.paletteToggle = category.id; toggle.setAttribute('aria-label', `自定义${category.name}颜色`); toggle.title = '自定义颜色';
    const name = document.createElement('span'); name.textContent = category.name;
    name.addEventListener('click', () => { checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event('change')); });
    const actions = document.createElement('div'); actions.className = 'category-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'category-action'; edit.textContent = '✎';
    edit.title = '编辑类型'; edit.setAttribute('aria-label', `编辑${category.name}`);
    edit.addEventListener('click', () => openCategoryEditor(category)); actions.append(edit);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'category-action delete-category-action'; remove.textContent = '×';
    remove.title = '删除类型'; remove.setAttribute('aria-label', `删除${category.name}`);
    remove.addEventListener('click', () => openCategoryDelete(category)); actions.append(remove);
    const palette = document.createElement('div'); palette.className = 'color-palette hidden'; palette.dataset.palette = category.id;
    palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', `${category.name}配色`);
    row.append(checkbox, toggle, name, actions, palette); container.append(row);
    colorPresets.forEach((preset) => {
      const swatch = document.createElement('button'); swatch.type = 'button'; swatch.className = 'palette-swatch';
      swatch.dataset.color = preset; swatch.style.backgroundColor = preset; swatch.setAttribute('aria-label', `${preset} 配色`);
      swatch.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); applyCalendarColor(category.id, preset, true); });
      palette.append(swatch);
    });
    const custom = document.createElement('div'); custom.className = 'custom-color'; custom.title = '选择自定义颜色';
    custom.innerHTML = '<span aria-hidden="true">＋</span><input type="color" aria-label="自定义颜色">';
    const picker = custom.querySelector('input'); picker.value = calendarColors[category.id] || defaultColors.blue;
    picker.addEventListener('click', (event) => event.stopPropagation());
    picker.addEventListener('input', () => applyCalendarColor(category.id, picker.value, true));
    custom.addEventListener('click', (event) => event.stopPropagation()); palette.append(custom);
    toggle.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      const wasOpen = !palette.classList.contains('hidden');
      document.querySelectorAll('.color-palette').forEach((other) => other.classList.add('hidden'));
      if (wasOpen) return;
      document.body.append(palette);
      palette.classList.remove('hidden');
      const anchor = toggle.getBoundingClientRect();
      const panel = palette.getBoundingClientRect();
      const left = anchor.right + panel.width + 12 <= window.innerWidth
        ? anchor.right + 8
        : Math.max(8, anchor.left - panel.width - 8);
      const top = anchor.top + panel.height + 8 <= window.innerHeight
        ? anchor.top
        : Math.max(8, anchor.bottom - panel.height);
      palette.style.position = 'fixed';
      palette.style.zIndex = '1000';
      palette.style.left = `${Math.min(left, window.innerWidth - panel.width - 8)}px`;
      palette.style.top = `${Math.min(top, window.innerHeight - panel.height - 8)}px`;
    });
    applyCalendarColor(category.id, calendarColors[category.id] || defaultColors.blue);
  });
  renderCategoryOptions();
}
function formatDate(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function monthBounds(year, month) {
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  const end = new Date(start); end.setDate(start.getDate() + 41);
  return [formatDate(start), formatDate(end)];
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
async function loadEvents() {
  const [start, end] = monthBounds(state.year, state.month);
  try {
    const response = await fetch(`/api/events?start=${start}&end=${end}`);
    if (!response.ok) throw new Error('日程加载失败');
    state.events = await response.json();
    render();
  } catch (error) { showToast(error.message); }
}
function render() {
  $('.sidebar').classList.add('has-main-month');
  $('#month-heading').textContent = `${state.year}年 ${monthNames[state.month]}`;
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
  renderMonthGrid();
  renderAgenda();
}
function visibleEvents(date) { return state.events.filter((event) => event.date === date && state.enabledColors.has(event.color)); }
function assignOverlapColumns(events) {
  const sorted = events.map((event) => {
    const start = timeToMinutes(event.start_time);
    let end = event.end_time ? timeToMinutes(event.end_time) : start + 60;
    if (end <= start) end = start + 60;
    return { event, start, end };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const groups = [];
  let group = [];
  let groupEnd = -1;
  sorted.forEach((item) => {
    if (group.length && item.start >= groupEnd) {
      groups.push(group); group = []; groupEnd = -1;
    }
    group.push(item); groupEnd = Math.max(groupEnd, item.end);
  });
  if (group.length) groups.push(group);

  groups.forEach((items) => {
    const laneEnds = [];
    items.forEach((item) => {
      let lane = laneEnds.findIndex((end) => end <= item.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = item.end;
      item.lane = lane;
    });
    const laneCount = laneEnds.length;
    items.forEach((item) => {
      let columns = 1;
      for (let lane = item.lane + 1; lane < laneCount; lane += 1) {
        const blocked = items.some((other) => other.lane === lane && item.start < other.end && other.start < item.end);
        if (blocked) break;
        columns += 1;
      }
      item.laneCount = laneCount;
      item.columns = columns;
    });
  });
  return new Map(sorted.map((item) => [item.event, item]));
}
function timeToMinutes(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
function makeEventChip(event) {
  const item = document.createElement('button');
  item.type = 'button'; item.className = `event-chip ${event.color}`;
  item.style.setProperty('--event-color', calendarColors[event.color] || defaultColors.blue);
  item.style.setProperty('--event-tint', `color-mix(in srgb, ${calendarColors[event.color] || defaultColors.blue} 14%, white)`);
  item.innerHTML = `<span class="event-time">${event.start_time ? `${escapeHtml(event.start_time)} ` : ''}</span>${escapeHtml(event.title)}`;
  item.title = `${event.title}${event.notes ? ` · ${event.notes}` : ''}`;
  item.addEventListener('click', (e) => { e.stopPropagation(); openDialog(event.date, event); });
  return item;
}
function renderMonthGrid() {
  const [start] = monthBounds(state.year, state.month);
  const startDate = new Date(`${start}T12:00:00`);
  const grid = $('#month-day-grid');
  grid.replaceChildren();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate); date.setDate(startDate.getDate() + i);
    const key = formatDate(date);
    const cell = document.createElement('div');
    cell.className = `day-cell${date.getMonth() !== state.month ? ' outside' : ''}${key === formatDate(today) ? ' is-today' : ''}${key === state.selectedDate ? ' is-selected' : ''}`;
    cell.dataset.date = key;
    const dayNumber = document.createElement('button');
    dayNumber.type = 'button'; dayNumber.className = 'day-number'; dayNumber.textContent = date.getDate();
    dayNumber.setAttribute('aria-label', `查看 ${key} 日程`);
    dayNumber.addEventListener('click', () => {
      state.selectedDate = key; state.year = date.getFullYear(); state.month = date.getMonth();
      loadEvents();
    });
    cell.append(dayNumber);
    const list = document.createElement('div'); list.className = 'day-events';
    visibleEvents(key).slice(0, 2).forEach((event) => list.append(makeEventChip(event)));
    const remaining = visibleEvents(key).length - 2;
    if (remaining > 0) { const more = document.createElement('span'); more.className = 'more-events'; more.textContent = `+${remaining} 个`; list.append(more); }
    cell.append(list);
    cell.addEventListener('dblclick', () => { state.selectedDate = key; state.year = date.getFullYear(); state.month = date.getMonth(); loadEvents(); });
    grid.append(cell);
  }
}
function renderAgenda() {
  const date = new Date(`${state.selectedDate}T12:00:00`);
  $('#agenda-date').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
  const eventsForDay = visibleEvents(state.selectedDate).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  const allDay = $('#agenda-all-day-events'); allDay.replaceChildren();
  const allDayEvents = eventsForDay.filter((event) => !event.start_time);
  if (!allDayEvents.length) {
    const empty = document.createElement('span'); empty.className = 'agenda-time-empty'; empty.textContent = '无'; allDay.append(empty);
  } else allDayEvents.forEach((event) => allDay.append(makeAgendaItem(event)));

  const hours = $('#agenda-hours'); hours.replaceChildren();
  const timedEvents = eventsForDay.filter((event) => event.start_time);
  for (let hour = 0; hour < 24; hour += 1) {
    const row = document.createElement('div'); row.className = 'agenda-hour-row';
    const label = document.createElement('span'); label.className = 'agenda-hour-label'; label.textContent = `${String(hour).padStart(2, '0')}:00`;
    const slot = document.createElement('div'); slot.className = 'agenda-hour-slot';
    slot.setAttribute('role', 'button'); slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-label', `${state.selectedDate} ${String(hour).padStart(2, '0')}:00 新建日程`);
    const create = () => openDialog(state.selectedDate, null, `${String(hour).padStart(2, '0')}:00`);
    slot.addEventListener('click', create);
    slot.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); create(); } });
    row.append(label, slot); hours.append(row);
  }

  const hourHeight = Number.parseFloat(getComputedStyle(hours).getPropertyValue('--agenda-hour-height')) || 42;
  const layouts = assignOverlapColumns(timedEvents);
  const layer = document.createElement('div'); layer.className = 'agenda-timed-event-layer';
  timedEvents.forEach((event) => {
    const item = makeAgendaItem(event);
    const { start, end, lane, laneCount, columns } = layouts.get(event);
    const duration = end - start;
    item.classList.add('agenda-timed-event');
    if (duration < 60) item.classList.add('agenda-short-event');
    item.style.top = `${start / 60 * hourHeight + 2}px`;
    item.style.height = `${Math.max(16, duration / 60 * hourHeight - 4)}px`;
    item.style.left = `calc(${lane * 100 / laneCount}% + 3px)`;
    item.style.width = `calc(${columns * 100 / laneCount}% - 6px)`;
    layer.append(item);
  });
  hours.append(layer);
  if ($('#agenda-scroll').dataset.date !== state.selectedDate) {
    $('#agenda-scroll').scrollTop = 0;
    $('#agenda-scroll').dataset.date = state.selectedDate;
  }
}
function makeAgendaItem(event) {
  const item = document.createElement('button');
  item.type = 'button'; item.className = `agenda-item ${event.color}`;
  item.style.setProperty('--event-color', calendarColors[event.color] || defaultColors.blue);
  item.style.setProperty('--event-tint', `color-mix(in srgb, ${calendarColors[event.color] || defaultColors.blue} 14%, white)`);
  const time = event.start_time ? `${event.start_time}${event.end_time ? ` - ${event.end_time}` : ''}` : '全天';
  item.innerHTML = `<span class="agenda-time">${escapeHtml(time)}</span><span class="agenda-title">${escapeHtml(event.title)}</span>${event.notes ? `<span class="agenda-notes">${escapeHtml(event.notes)}</span>` : ''}`;
  item.addEventListener('click', (e) => { e.stopPropagation(); openDialog(event.date, event); });
  return item;
}
function shiftMonth(amount) {
  const next = new Date(state.year, state.month + amount, 1);
  const selected = new Date(`${state.selectedDate}T12:00:00`);
  state.year = next.getFullYear(); state.month = next.getMonth();
  const day = Math.min(selected.getDate(), new Date(state.year, state.month + 1, 0).getDate());
  state.selectedDate = formatDate(new Date(state.year, state.month, day));
  loadEvents();
}
function openDialog(date = state.selectedDate, event = null, startTime = '') {
  if (!calendarCategories.length) { showToast('请先新增一个日历类型'); return; }
  state.editingId = event?.id ?? null;
  $('#event-form').reset(); $('#form-error').textContent = '';
  $('#event-date').value = date; $('#event-color').value = event?.color || 'blue';
  $('#event-title').value = event?.title || ''; $('#event-start').value = event?.start_time || startTime; $('#event-end').value = event?.end_time || ''; $('#event-notes').value = event?.notes || '';
  $('#dialog-eyebrow').textContent = event ? `${date} · ${colorNames[event.color] || '其他'}` : '新日程';
  $('#dialog-title').textContent = event ? '编辑日程' : '安排一件事';
  $('#save-event').textContent = event ? '保存更改' : '保存日程';
  $('#delete-event').classList.toggle('hidden', !event);
  $('#event-dialog').showModal();
  $('#event-title').focus();
}
function openCategoryEditor(category = null) {
  editingCategoryId = category?.id || null;
  $('#category-form').reset(); $('#category-error').textContent = '';
  $('#category-name').value = category?.name || '';
  $('#category-color').value = category?.color || colorPresets[Math.floor(Math.random() * 5)];
  $('#category-dialog-title').textContent = category ? '编辑类型' : '新增类型';
  $('#category-form button[type=submit]').textContent = category ? '保存修改' : '创建类型';
  $('#category-dialog').showModal(); $('#category-name').focus();
}
function openCategoryDelete(category) {
  deletingCategoryId = category.id;
  $('#category-delete-form').reset(); $('#category-delete-error').textContent = '';
  $('#category-delete-title').textContent = `删除“${category.name}”`;
  $('#category-delete-summary').textContent = category.event_count
    ? `此类型关联了 ${category.event_count} 个日程，删除前请选择迁移目标。`
    : '此类型目前没有关联日程。';
  const select = $('#category-replacement'); select.replaceChildren();
  calendarCategories.filter((item) => item.id !== category.id).forEach((item) => {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.append(option);
  });
  $('#category-migration-field').classList.toggle('hidden', !category.event_count);
  $('#category-delete-form button[type=submit]').textContent = category.event_count ? '删除并迁移日程' : '删除类型';
  $('#category-delete-dialog').showModal();
}
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

$('#create-event').addEventListener('click', () => openDialog(state.selectedDate || formatDate(today)));
$('#add-category').addEventListener('click', () => openCategoryEditor());
$('#close-category-dialog').addEventListener('click', () => $('#category-dialog').close());
$('#category-dialog').addEventListener('click', (event) => { if (event.target === $('#category-dialog')) $('#category-dialog').close(); });
$('#category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#category-name').value.trim();
  const color = $('#category-color').value;
  $('#category-error').textContent = '';
  if (!name) { $('#category-error').textContent = '请填写类型名称'; return; }
  if (calendarCategories.some((category) => category.id !== editingCategoryId && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    $('#category-error').textContent = '这个类型名称已存在'; return;
  }
  const url = editingCategoryId ? `/api/categories/${encodeURIComponent(editingCategoryId)}` : '/api/categories';
  try {
    const response = await fetch(url, {
      method: editingCategoryId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    });
    if (!response.ok) {
      const detail = await response.json();
      throw new Error(detail.detail || '保存类型失败');
    }
    $('#category-dialog').close();
    await refreshCategories(); render(); await loadEvents();
    showToast(editingCategoryId ? '类型已更新' : '类型已创建');
  } catch (error) { $('#category-error').textContent = error.message; }
});
$('#close-category-delete').addEventListener('click', () => $('#category-delete-dialog').close());
$('#category-delete-dialog').addEventListener('click', (event) => { if (event.target === $('#category-delete-dialog')) $('#category-delete-dialog').close(); });
$('#category-delete-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#category-delete-error').textContent = '';
  const replacement = $('#category-replacement').value;
  const query = replacement ? `?replacement_id=${encodeURIComponent(replacement)}` : '';
  try {
    const response = await fetch(`/api/categories/${encodeURIComponent(deletingCategoryId)}${query}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail || '删除类型失败');
    $('#category-delete-dialog').close();
    state.enabledColors.delete(deletingCategoryId);
    await refreshCategories(); render(); await loadEvents();
    showToast(result.migrated_events ? `类型已删除，${result.migrated_events} 个日程已迁移` : '类型已删除');
  } catch (error) { $('#category-delete-error').textContent = error.message; }
});
$('#close-dialog').addEventListener('click', () => $('#event-dialog').close());
$('#event-dialog').addEventListener('click', (event) => { if (event.target === $('#event-dialog')) $('#event-dialog').close(); });
$('#prev-month').addEventListener('click', () => shiftMonth(-1));
$('#next-month').addEventListener('click', () => shiftMonth(1));
$('#agenda-add').addEventListener('click', () => openDialog(state.selectedDate));
$('#go-today').addEventListener('click', () => { state.selectedDate = formatDate(today); state.year = today.getFullYear(); state.month = today.getMonth(); loadEvents(); });
$('#event-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#form-error').textContent = '';
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (payload.end_time && payload.start_time && payload.end_time < payload.start_time) { $('#form-error').textContent = '结束时间需要晚于开始时间'; return; }
  const endpoint = state.editingId ? `/api/events/${encodeURIComponent(state.editingId)}` : '/api/events';
  try {
    const response = await fetch(endpoint, { method: state.editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) { const result = await response.json(); throw new Error(result.detail?.[0]?.msg === 'String should have at least 1 character' ? '请填写日程标题' : '保存失败，请检查填写内容'); }
    $('#event-dialog').close(); state.selectedDate = payload.date;
    const savedDate = new Date(`${payload.date}T12:00:00`);
    state.year = savedDate.getFullYear(); state.month = savedDate.getMonth();
    showToast(state.editingId ? '日程已更新' : '日程已创建'); await loadEvents();
  } catch (error) { $('#form-error').textContent = error.message; }
});
  $('#delete-event').addEventListener('click', () => {
    if (!state.editingId) return;
    $('#event-delete-title').textContent = `删除“${$('#event-title').value.trim() || '未命名日程'}”？`;
    $('#event-delete-dialog').showModal();
  });
  $('#close-event-delete').addEventListener('click', () => $('#event-delete-dialog').close());
  $('#cancel-event-delete').addEventListener('click', () => $('#event-delete-dialog').close());
  $('#event-delete-dialog').addEventListener('click', (event) => { if (event.target === $('#event-delete-dialog')) $('#event-delete-dialog').close(); });
  $('#event-delete-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.editingId) return;
    const deleteButton = $('#event-delete-form button[type=submit]');
    deleteButton.disabled = true;
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(state.editingId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('删除失败，请重试');
      $('#event-delete-dialog').close(); $('#event-dialog').close();
      showToast('日程已删除'); await loadEvents();
    } catch (error) {
      $('#event-delete-dialog').close();
      $('#form-error').textContent = error.message;
    } finally { deleteButton.disabled = false; }
  });
document.addEventListener('click', (event) => {
  if (!event.target.closest('.calendar-row, .color-palette')) document.querySelectorAll('.color-palette').forEach((palette) => palette.classList.add('hidden'));
});
document.addEventListener('keydown', (event) => {
  if ($('#event-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'ArrowLeft') shiftMonth(-1);
  if (event.key === 'ArrowRight') shiftMonth(1);
});
setupColorPalettes();
render();
initializeCategories();
