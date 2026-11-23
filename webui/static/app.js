const $ = (selector) => document.querySelector(selector);
const today = new Date();
const state = { year: today.getFullYear(), month: today.getMonth(), miniYear: today.getFullYear(), miniMonth: today.getMonth(), selectedDate: formatDate(today), view: 'month', events: [], editingId: null, enabledColors: new Set(['blue', 'green', 'orange', 'pink', 'purple']) };
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const colorNames = { blue: '个人', green: '工作', orange: '重要日期', pink: '生活', purple: '其他' };
const defaultColors = { blue: '#5684E8', green: '#45A783', orange: '#E29A43', pink: '#D96884', purple: '#9071C8' };
const colorPresets = ['#5684E8', '#3478C8', '#35A783', '#21A69A', '#E29A43', '#D97836', '#D96884', '#BE5E9B', '#9071C8', '#685CB5', '#65758B', '#3C8C78'];
const savedColors = (() => { try { return JSON.parse(localStorage.getItem('dayline-calendar-colors') || '{}'); } catch { return {}; } })();
const calendarColors = { ...defaultColors, ...Object.fromEntries(Object.entries(savedColors).filter(([key, value]) => key in defaultColors && /^#[0-9a-f]{6}$/i.test(value))) };

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
  if (persist) localStorage.setItem('dayline-calendar-colors', JSON.stringify(calendarColors));
}
function setupColorPalettes() {
  Object.entries(defaultColors).forEach(([category, color]) => {
    const palette = document.querySelector(`[data-palette="${category}"]`);
    colorPresets.forEach((preset) => {
      const swatch = document.createElement('button');
      swatch.type = 'button'; swatch.className = 'palette-swatch'; swatch.dataset.color = preset;
      swatch.style.backgroundColor = preset; swatch.setAttribute('aria-label', `${preset} 配色`);
      swatch.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); applyCalendarColor(category, preset, true); });
      palette.append(swatch);
    });
    const custom = document.createElement('div'); custom.className = 'custom-color'; custom.title = '选择自定义颜色';
    custom.innerHTML = '<span aria-hidden="true">＋</span><input type="color" aria-label="自定义颜色">';
    const picker = custom.querySelector('input'); picker.value = calendarColors[category];
    picker.addEventListener('click', (event) => event.stopPropagation());
    picker.addEventListener('input', () => applyCalendarColor(category, picker.value, true));
    custom.addEventListener('click', (event) => event.stopPropagation());
    palette.append(custom);
    const toggle = document.querySelector(`[data-palette-toggle="${category}"]`);
    toggle.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      document.querySelectorAll('.color-palette').forEach((other) => { if (other !== palette) other.classList.add('hidden'); });
      palette.classList.toggle('hidden');
    });
    applyCalendarColor(category, calendarColors[category]);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.calendar-row')) document.querySelectorAll('.color-palette').forEach((palette) => palette.classList.add('hidden'));
  });
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
  const [start, end] = state.view === 'day' ? [state.selectedDate, state.selectedDate] : monthBounds(state.year, state.month);
  try {
    const response = await fetch(`/api/events?start=${start}&end=${end}`);
    if (!response.ok) throw new Error('日程加载失败');
    state.events = await response.json();
    render();
  } catch (error) { showToast(error.message); }
}
function render() {
  const isDay = state.view === 'day';
  const isMonthDay = state.view === 'month-day';
  $('#month-view').classList.toggle('hidden', isDay || isMonthDay);
  $('#month-day-view').classList.toggle('hidden', !isMonthDay);
  $('#day-view').classList.toggle('hidden', !isDay);
  $('#view-select').value = state.view;
  $('#prev-month').setAttribute('aria-label', isDay ? '前一天' : '上个月');
  $('#next-month').setAttribute('aria-label', isDay ? '后一天' : '下个月');
  renderMini();
  if (isDay) {
    const date = new Date(`${state.selectedDate}T12:00:00`);
    $('#month-heading').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
    $('#today-label').textContent = `${date.getFullYear()}年`;
    renderDay();
  } else {
    $('#month-heading').textContent = `${state.year}年 ${monthNames[state.month]}`;
    $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
    if (isMonthDay) {
      renderMonthGrid('#month-day-grid', true);
      renderAgenda();
    } else renderMonth();
  }
}
function visibleEvents(date) { return state.events.filter((event) => event.date === date && state.enabledColors.has(event.color)); }
function renderDay() {
  const dateEvents = visibleEvents(state.selectedDate);
  const allDay = $('#all-day-events');
  allDay.replaceChildren();
  dateEvents.filter((event) => !event.start_time).forEach((event) => allDay.append(makeEventChip(event)));

  const grid = $('#time-grid');
  grid.replaceChildren();
  for (let hour = 0; hour < 24; hour += 1) {
    const row = document.createElement('div');
    row.className = 'hour-row';
    const label = document.createElement('span');
    label.className = 'hour-label'; label.textContent = `${String(hour).padStart(2, '0')}:00`;
    const slot = document.createElement('button');
    slot.type = 'button'; slot.className = 'hour-slot';
    slot.setAttribute('aria-label', `${state.selectedDate} ${String(hour).padStart(2, '0')}:00 新建日程`);
    slot.addEventListener('click', () => openDialog(state.selectedDate, null, `${String(hour).padStart(2, '0')}:00`));
    row.append(label, slot); grid.append(row);
  }

  const timedEvents = dateEvents.filter((event) => event.start_time).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const laneEnds = [];
  timedEvents.forEach((event) => {
    const start = timeToMinutes(event.start_time);
    let end = event.end_time ? timeToMinutes(event.end_time) : start + 60;
    if (end <= start) end = start + 60;
    event._layout = { start, end, lane: laneEnds.findIndex((laneEnd) => laneEnd <= start) };
    if (event._layout.lane === -1) event._layout.lane = laneEnds.length;
    laneEnds[event._layout.lane] = end;
  });
  const laneCount = Math.max(1, laneEnds.length);
  const layer = $('#timed-event-layer');
  layer.replaceChildren();
  timedEvents.forEach((event) => {
    const item = makeEventChip(event);
    const { start, end, lane } = event._layout;
    item.classList.add('timeline-event');
    item.style.top = `${start / 60 * 64 + 3}px`;
    item.style.height = `${Math.max(34, (end - start) / 60 * 64 - 6)}px`;
    item.style.left = `calc(${lane * 100 / laneCount}% + 4px)`;
    item.style.width = `calc(${100 / laneCount}% - 8px)`;
    layer.append(item);
    delete event._layout;
  });
  if ($('#day-scroll').dataset.date !== state.selectedDate) {
    $('#day-scroll').scrollTop = 6 * 64;
    $('#day-scroll').dataset.date = state.selectedDate;
  }
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
function renderMonth() { renderMonthGrid('#month-grid', false); }
function renderMonthGrid(selector, selectingOnly) {
  const [start] = monthBounds(state.year, state.month);
  const startDate = new Date(`${start}T12:00:00`);
  const grid = $(selector);
  grid.replaceChildren();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate); date.setDate(startDate.getDate() + i);
    const key = formatDate(date);
    const cell = document.createElement('div');
    cell.className = `day-cell${date.getMonth() !== state.month ? ' outside' : ''}${key === formatDate(today) ? ' is-today' : ''}${key === state.selectedDate ? ' is-selected' : ''}`;
    cell.dataset.date = key;
    const dayNumber = document.createElement('button');
    dayNumber.type = 'button'; dayNumber.className = 'day-number'; dayNumber.textContent = date.getDate();
    dayNumber.setAttribute('aria-label', selectingOnly ? `查看 ${key} 日程` : `${key}，新建日程`);
    dayNumber.addEventListener('click', () => {
      if (selectingOnly) {
        state.selectedDate = key; state.year = date.getFullYear(); state.month = date.getMonth();
        state.miniYear = state.year; state.miniMonth = state.month;
        loadEvents();
      } else openDialog(key);
    });
    cell.append(dayNumber);
    const list = document.createElement('div'); list.className = 'day-events';
    visibleEvents(key).slice(0, selectingOnly ? 2 : 3).forEach((event) => list.append(makeEventChip(event)));
    const remaining = visibleEvents(key).length - (selectingOnly ? 2 : 3);
    if (remaining > 0) { const more = document.createElement('span'); more.className = 'more-events'; more.textContent = `+${remaining} 个`; list.append(more); }
    cell.append(list);
    cell.addEventListener('dblclick', () => selectingOnly ? (state.selectedDate = key, loadEvents()) : openDialog(key));
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
  for (let hour = 0; hour < 24; hour += 1) {
    const row = document.createElement('div'); row.className = 'agenda-hour-row';
    const label = document.createElement('span'); label.className = 'agenda-hour-label'; label.textContent = `${String(hour).padStart(2, '0')}:00`;
    const slot = document.createElement('div'); slot.className = 'agenda-hour-slot';
    slot.setAttribute('role', 'button'); slot.setAttribute('tabindex', '0');
    slot.setAttribute('aria-label', `${state.selectedDate} ${String(hour).padStart(2, '0')}:00 新建日程`);
    const create = () => openDialog(state.selectedDate, null, `${String(hour).padStart(2, '0')}:00`);
    slot.addEventListener('click', create);
    slot.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); create(); } });
    eventsForDay.filter((event) => event.start_time && Number(event.start_time.slice(0, 2)) === hour)
      .forEach((event) => slot.append(makeAgendaItem(event)));
    row.append(label, slot); hours.append(row);
  }
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
function renderMini() {
  $('#mini-title').textContent = `${state.miniYear}年 ${monthNames[state.miniMonth]}`;
  const first = new Date(state.miniYear, state.miniMonth, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(state.miniYear, state.miniMonth, 1 - offset);
  const container = $('#mini-days'); container.replaceChildren();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(start); date.setDate(start.getDate() + i);
    const key = formatDate(date);
    const button = document.createElement('button'); button.type = 'button';
    button.className = `mini-day${date.getMonth() !== state.miniMonth ? ' muted' : ''}${key === formatDate(today) ? ' today' : ''}${key === state.selectedDate ? ' chosen' : ''}`;
    button.textContent = date.getDate(); button.setAttribute('aria-label', key);
    button.addEventListener('click', () => { state.selectedDate = key; state.year = date.getFullYear(); state.month = date.getMonth(); state.miniYear = date.getFullYear(); state.miniMonth = date.getMonth(); loadEvents(); });
    container.append(button);
  }
}
function shiftMonth(amount) {
  const next = new Date(state.year, state.month + amount, 1);
  state.year = next.getFullYear(); state.month = next.getMonth();
  if (state.view === 'month-day') {
    const selected = new Date(`${state.selectedDate}T12:00:00`);
    const day = Math.min(selected.getDate(), new Date(state.year, state.month + 1, 0).getDate());
    state.selectedDate = formatDate(new Date(state.year, state.month, day));
  }
  state.miniYear = state.year; state.miniMonth = state.month; loadEvents();
}
function shiftDate(amount) {
  const next = new Date(`${state.selectedDate}T12:00:00`);
  next.setDate(next.getDate() + amount);
  state.selectedDate = formatDate(next);
  state.year = next.getFullYear(); state.month = next.getMonth();
  state.miniYear = state.year; state.miniMonth = state.month;
  loadEvents();
}
function navigatePeriod(amount) { state.view === 'day' ? shiftDate(amount) : shiftMonth(amount); }
function openDialog(date = state.selectedDate, event = null, startTime = '') {
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
function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible');
  window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

$('#create-event').addEventListener('click', () => openDialog(state.selectedDate || formatDate(today)));
$('#close-dialog').addEventListener('click', () => $('#event-dialog').close());
$('#event-dialog').addEventListener('click', (event) => { if (event.target === $('#event-dialog')) $('#event-dialog').close(); });
$('#prev-month').addEventListener('click', () => navigatePeriod(-1));
$('#next-month').addEventListener('click', () => navigatePeriod(1));
$('#view-select').addEventListener('change', () => { state.view = $('#view-select').value; loadEvents(); });
$('#agenda-add').addEventListener('click', () => openDialog(state.selectedDate));
$('#mini-prev').addEventListener('click', () => { const date = new Date(state.miniYear, state.miniMonth - 1, 1); state.miniYear = date.getFullYear(); state.miniMonth = date.getMonth(); renderMini(); });
$('#mini-next').addEventListener('click', () => { const date = new Date(state.miniYear, state.miniMonth + 1, 1); state.miniYear = date.getFullYear(); state.miniMonth = date.getMonth(); renderMini(); });
$('#go-today').addEventListener('click', () => { state.selectedDate = formatDate(today); state.year = today.getFullYear(); state.month = today.getMonth(); state.miniYear = state.year; state.miniMonth = state.month; loadEvents(); });
document.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) state.enabledColors.add(input.dataset.filter); else state.enabledColors.delete(input.dataset.filter);
  render();
}));
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
    state.miniYear = state.year; state.miniMonth = state.month;
    showToast(state.editingId ? '日程已更新' : '日程已创建'); await loadEvents();
  } catch (error) { $('#form-error').textContent = error.message; }
});
$('#delete-event').addEventListener('click', async () => {
  if (!state.editingId) return;
  try {
    const response = await fetch(`/api/events/${encodeURIComponent(state.editingId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('删除失败，请重试');
    $('#event-dialog').close(); showToast('日程已删除'); await loadEvents();
  } catch (error) { $('#form-error').textContent = error.message; }
});
document.addEventListener('keydown', (event) => {
  if ($('#event-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (event.key === 'ArrowLeft') navigatePeriod(-1);
  if (event.key === 'ArrowRight') navigatePeriod(1);
});
setupColorPalettes();
render(); loadEvents();
