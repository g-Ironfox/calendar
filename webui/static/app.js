const $ = (selector) => document.querySelector(selector);
const today = new Date();
const state = { year: today.getFullYear(), month: today.getMonth(), miniYear: today.getFullYear(), miniMonth: today.getMonth(), selectedDate: formatDate(today), events: [], editingId: null, enabledColors: new Set(['blue', 'green', 'orange', 'pink', 'purple']) };
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const colorNames = { blue: '个人', green: '工作', orange: '重要日期', pink: '生活', purple: '其他' };

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
  renderMonth(); renderMini();
  $('#month-heading').textContent = `${state.year}年 ${monthNames[state.month]}`;
  $('#today-label').textContent = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
}
function visibleEvents(date) { return state.events.filter((event) => event.date === date && state.enabledColors.has(event.color)); }
function renderMonth() {
  const [start] = monthBounds(state.year, state.month);
  const startDate = new Date(`${start}T12:00:00`);
  const grid = $('#month-grid');
  grid.replaceChildren();
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate); date.setDate(startDate.getDate() + i);
    const key = formatDate(date);
    const cell = document.createElement('div');
    cell.className = `day-cell${date.getMonth() !== state.month ? ' outside' : ''}${key === formatDate(today) ? ' is-today' : ''}${key === state.selectedDate ? ' is-selected' : ''}`;
    cell.dataset.date = key;
    const dayNumber = document.createElement('button');
    dayNumber.type = 'button'; dayNumber.className = 'day-number'; dayNumber.textContent = date.getDate();
    dayNumber.setAttribute('aria-label', `${key}，新建日程`);
    dayNumber.addEventListener('click', () => openDialog(key));
    cell.append(dayNumber);
    const list = document.createElement('div'); list.className = 'day-events';
    visibleEvents(key).slice(0, 3).forEach((event) => {
      const item = document.createElement('button'); item.type = 'button'; item.className = `event-chip ${event.color}`;
      item.innerHTML = `<span class="event-time">${event.start_time ? `${escapeHtml(event.start_time)} ` : ''}</span>${escapeHtml(event.title)}`;
      item.title = `${event.title}${event.notes ? ` · ${event.notes}` : ''}`;
      item.addEventListener('click', (e) => { e.stopPropagation(); openDialog(key, event); }); list.append(item);
    });
    const remaining = visibleEvents(key).length - 3;
    if (remaining > 0) { const more = document.createElement('span'); more.className = 'more-events'; more.textContent = `+${remaining} 个`; list.append(more); }
    cell.append(list);
    cell.addEventListener('dblclick', () => openDialog(key));
    grid.append(cell);
  }
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
  state.miniYear = state.year; state.miniMonth = state.month; loadEvents();
}
function openDialog(date = state.selectedDate, event = null) {
  state.editingId = event?.id ?? null;
  $('#event-form').reset(); $('#form-error').textContent = '';
  $('#event-date').value = date; $('#event-color').value = event?.color || 'blue';
  $('#event-title').value = event?.title || ''; $('#event-start').value = event?.start_time || ''; $('#event-end').value = event?.end_time || ''; $('#event-notes').value = event?.notes || '';
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
$('#prev-month').addEventListener('click', () => shiftMonth(-1));
$('#next-month').addEventListener('click', () => shiftMonth(1));
$('#mini-prev').addEventListener('click', () => { const date = new Date(state.miniYear, state.miniMonth - 1, 1); state.miniYear = date.getFullYear(); state.miniMonth = date.getMonth(); renderMini(); });
$('#mini-next').addEventListener('click', () => { const date = new Date(state.miniYear, state.miniMonth + 1, 1); state.miniYear = date.getFullYear(); state.miniMonth = date.getMonth(); renderMini(); });
$('#go-today').addEventListener('click', () => { state.year = today.getFullYear(); state.month = today.getMonth(); state.miniYear = state.year; state.miniMonth = state.month; state.selectedDate = formatDate(today); loadEvents(); });
document.querySelectorAll('[data-filter]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) state.enabledColors.add(input.dataset.filter); else state.enabledColors.delete(input.dataset.filter);
  renderMonth();
}));
$('#event-form').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#form-error').textContent = '';
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  if (payload.end_time && payload.start_time && payload.end_time < payload.start_time) { $('#form-error').textContent = '结束时间需要晚于开始时间'; return; }
  const endpoint = state.editingId ? `/api/events/${encodeURIComponent(state.editingId)}` : '/api/events';
  try {
    const response = await fetch(endpoint, { method: state.editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) { const result = await response.json(); throw new Error(result.detail?.[0]?.msg === 'String should have at least 1 character' ? '请填写日程标题' : '保存失败，请检查填写内容'); }
    $('#event-dialog').close(); state.selectedDate = payload.date; showToast(state.editingId ? '日程已更新' : '日程已创建'); await loadEvents();
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
  if (event.key === 'ArrowLeft') shiftMonth(-1);
  if (event.key === 'ArrowRight') shiftMonth(1);
});
render(); loadEvents();
