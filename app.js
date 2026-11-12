// Karna Nails: состояние, расчёты, синхронизация и события интерфейса.
const SCRIPT_URL="https://script.google.com/macros/s/AKfycbzAot_sRubAV7ATLG-o3G1oN8aQoFIt29aSk1B4wSLAVOaL9knpJFL4EHlviX2vFpA98w/exec";
// ==================== БАЗОВЫЕ ДАННЫЕ ПРАЙСА ====================
const SERVICES = [
  { id: 'coat', name: 'Маникюр с покрытием', price: 2000, oldPrice: 1650, dur: '2 ч', matType: 'gel' },
  { id: 'ext', name: 'Наращивание', price: 2700, oldPrice: 1800, dur: '2.5 ч', matType: 'ext' },
  { id: 'clean', name: 'Маникюр без покрытия', price: 1000, oldPrice: 650, dur: '1 ч', matType: 'clean' },
  { id: 'french', name: '+ Френч', price: 300, oldPrice: 200, dur: '+20 мин', matType: 'addon' },
  { id: 'repair', name: '+ Ремонт 1 ногтя', price: 100, oldPrice: 50, dur: '+10 мин', matType: 'addon' },
  { id: 'design', name: '+ Дизайн (от 1 ногтя)', price: 100, oldPrice: 50, dur: '+15 мин', matType: 'addon' }
];

let state = JSON.parse(localStorage.getItem('karna_crm_v2')) || {
  appointments: [],
  clients: {},
  expenses: [],
  settings: { costDisposable: 65, costGel: 85, costExt: 160, costGift: 50, gasUrl: '' }
};

let selectedClientServices = ['coat'];
let selectedClientSlot = '';
let isAdmin = false;

// ===== СКЛАД: НАЧАЛЬНЫЙ КАТАЛОГ И УЧЁТ =====
// Остаток: в штуках или миллилитрах. Цена упаковки хранится точно, без округления.
const INVENTORY_DEFAULTS = [
  ['kraft','Крафт-пакеты',100,250,'шт', {common:1}],
  ['brush','Щёточки для маникюра',10,160,'шт',{common:1}],
  ['buff','Бафы',10,97,'шт',{common:1}],
  ['degreaser','Обезжириватель',1000,560,'мл',{common:3}],
  ['wipes','Безворсовые салфетки',600,287,'шт',{common:10}],
  ['file100','Пилка 100 грит',100,547,'шт',{common:1}],
  ['file180','Пилка 180 грит',25,253,'шт',{common:1}],
  ['sticks','Апельсиновые палочки',350,297,'шт',{common:1}],
  ['bits','Набор фрез',1,1385,'набор',{common:0}],
  ['cutbit','Фреза для выпиливания',1,537,'шт',{common:0}],
  ['top','Топ',15,488,'мл',{coat:0.5,ext:0.5}],
  ['base','База',15,487,'мл',{coat:0.5}],
  ['primer','Праймер для ногтей',15,668,'мл',{coat:0.2,ext:0.2}],
  ['gel','Гель для наращивания',15,469,'мл',{ext:2,repair:0.2}],
  ['forms','Верхние формы (набор)',1,361,'набор',{common:0}],
  ['polish','Лак',15,469,'мл',{coat:0.5,ext:0.5,french:0.2,design:0.2}],
  ['remover','Ремувер для кутикулы',15,195,'мл',{common:0.5}],
  ['oil','Масло для кутикулы',15,210,'мл',{common:0.2}]
];
const INVENTORY_SERVICES = ['coat','ext','clean','french','repair','design'];

function ensureInventory() {
  if (!Array.isArray(state.inventory)) {
    state.inventory = INVENTORY_DEFAULTS.map(([id,name,packSize,packPrice,unit,norms]) => ({
      id,name,packSize,packPrice,unit,stock:0,norms:{...norms}
    }));
  }
  // Старые базы могут не содержать склада; уже созданный каталог не перезаписываем.
}

function inventoryUsage(serviceIds) {
  ensureInventory();
  const ids = Array.isArray(serviceIds) ? serviceIds : [];
  const hasMain = ids.some(x => ['coat','ext','clean'].includes(x));
  return state.inventory.map(item => {
    const norms = item.norms || {};
    let qty = hasMain ? (Number(norms.common) || 0) : 0;
    ids.forEach(id => { qty += Number(norms[id]) || 0; });
    return {item, qty:Math.round(qty * 1000) / 1000};
  }).filter(x => x.qty > 0);
}

function inventoryMaterialCost(serviceIds) {
  return inventoryUsage(serviceIds).reduce((sum,{item,qty}) =>
    sum + qty * (Number(item.packPrice) / Number(item.packSize)), 0);
}

function stockFormat(v) {
  return (Math.round((Number(v)||0)*1000)/1000).toLocaleString('ru-RU',{maximumFractionDigits:3});
}
function escapeInventoryText(str) {
  return String(str??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function inventoryItemById(id) { ensureInventory(); return state.inventory.find(x=>x.id===id); }

function renderInventory() {
  ensureInventory();
  const box = document.getElementById('inventoryCatalog');
  if (!box) return;
  box.innerHTML = state.inventory.map(item => {
    const pricePerUnit = Number(item.packPrice)/Number(item.packSize);
    const estimatedValue = (Number(item.stock)||0)*pricePerUnit;
    const unit = escapeInventoryText(item.unit);
    return `<div class="appt-item inventory-card">
      <div class="inventory-heading">
        <b class="text-body">${escapeInventoryText(item.name)}</b>
        <b class="inventory-stock ${Number(item.stock) < 0 ? 'text-danger' : 'text-accent'}">${stockFormat(item.stock)} ${unit}</b>
      </div>
      <div class="inventory-details">
        ${stockFormat(item.packSize)} ${unit} / упаковка · ${stockFormat(item.packPrice)} ₽ / упаковка<br>
        Цена за ${unit}: ${Math.ceil(pricePerUnit)} ₽ (округлённая) · Стоимость остатка ≈ ${Math.ceil(estimatedValue)} ₽
      </div>
      <div class="inventory-actions">
        <button class="btn btn-outline btn-sm" data-action="setInventoryStock" data-item-id="${escapeInventoryText(item.id)}">Остаток</button>
        <button class="btn btn-outline btn-sm" data-action="restockInventory" data-item-id="${escapeInventoryText(item.id)}">Закупить</button>
        <button class="btn btn-outline btn-sm" data-action="editInventoryItem" data-item-id="${escapeInventoryText(item.id)}">Изменить</button>
        <button class="btn btn-outline btn-sm" data-action="editInventoryNorms" data-item-id="${escapeInventoryText(item.id)}">Нормы</button>
        <button class="btn btn-outline btn-sm text-danger" data-action="removeInventoryItem" data-item-id="${escapeInventoryText(item.id)}">Удалить</button>
      </div>
    </div>`;
  }).join('') || '<p class="text-small">Материалов пока нет</p>';
}

function askInventoryNumber(label,oldValue,allowZero=true) {
  const input = prompt(label,String(oldValue));
  if (input===null) return null;
  const val = Number(input.trim().replace(',','.'));
  if (!input.trim() || !Number.isFinite(val) || val<0 || (!allowZero && val<=0)) {
    alert('Введите корректное неотрицательное число' + (allowZero?'':' больше нуля'));
    return null;
  }
  return Math.round(val*1000)/1000;
}
function addInventoryItem() {
  if (!isAdmin) return;
  ensureInventory();
  const name = prompt('Название нового материала:');
  if (name===null) return;
  if (!name.trim()) {alert('Введите название');return;}
  const unitInput = prompt('Единица измерения (шт, мл, набор):','шт');
  if (unitInput===null) return;
  const unit=unitInput.trim();
  if (!unit || !/^[а-яёa-z0-9 ]{1,15}$/i.test(unit)) {alert('Некорректная единица измерения');return;}
  const packSize=askInventoryNumber('Сколько единиц в упаковке?',1,false);
  if(packSize===null)return;
  const packPrice=askInventoryNumber('Стоимость упаковки, ₽:',0);
  if(packPrice===null)return;
  state.inventory.push({id:'custom_'+Date.now()+'_'+Math.floor(Math.random()*100000),name:name.trim(),packSize,packPrice,unit,stock:0,norms:{}});
  saveState();renderInventory();
}
function editInventoryItem(id) {
  if (!isAdmin) return;
  const item=inventoryItemById(id); if(!item)return;
  const name=prompt('Название материала:',item.name);if(name===null)return;
  if(!name.trim()){alert('Название не может быть пустым');return;}
  const packSize=askInventoryNumber('Количество в упаковке ('+item.unit+'):',item.packSize,false);
  if(packSize===null)return;
  const packPrice=askInventoryNumber('Цена упаковки, ₽:',item.packPrice);
  if(packPrice===null)return;
  item.name=name.trim();item.packSize=packSize;item.packPrice=packPrice;
  saveState();renderAllAdmin();
}
function setInventoryStock(id) {
  if (!isAdmin)return;
  const item=inventoryItemById(id);if(!item)return;
  const value=askInventoryNumber('Фактический остаток: '+item.name+' ('+item.unit+'):',Math.max(0,Number(item.stock)||0));
  if(value===null)return;
  item.stock=value;saveState();renderAllAdmin();
}
function restockInventory(id) {
  if(!isAdmin)return;
  const item=inventoryItemById(id);if(!item)return;
  const packs=askInventoryNumber('Сколько упаковок купили? '+item.name,1,false);
  if(packs===null)return;
  const total=askInventoryNumber('Фактическая сумма покупки, ₽:',Math.round(packs*item.packPrice*100)/100);
  if(total===null)return;
  if(!confirm('Добавить '+stockFormat(packs*item.packSize)+' '+item.unit+' на склад и записать расход '+total+' ₽?'))return;
  item.stock=Math.round(((Number(item.stock)||0)+packs*item.packSize)*1000)/1000;
  state.expenses.unshift({id:Date.now(),title:'Закупка: '+item.name,amount:total,cat:'Материалы (склад)',date:new Date().toISOString().slice(0,10)});
  saveState();renderAllAdmin();
}
function removeInventoryItem(id) {
  if(!isAdmin)return;
  const item=inventoryItemById(id);if(!item)return;
  if(!confirm('Удалить материал «'+item.name+'» из каталога? Остаток и нормы будут потеряны.'))return;
  state.inventory=state.inventory.filter(x=>x.id!==id);
  saveState();renderAllAdmin();
}
function editInventoryNorms(id) {
  if(!isAdmin)return;
  const item=inventoryItemById(id);if(!item)return;
  const updated={...(item.norms||{})};
  const labels=[['common','На одну основную процедуру (один раз)'],...SERVICES.map(s=>[s.id,'Дополнительно: '+s.name])];
  for(const [key,label] of labels) {
    const val=askInventoryNumber(item.name+' ('+item.unit+'). '+label+':',Number(updated[key])||0);
    if(val===null)return;
    updated[key]=val;
  }
  item.norms=updated;saveState();renderAllAdmin();
}

function saveState() {
  ensureInventory();
  localStorage.setItem('karna_crm_v2', JSON.stringify(state));
  if (typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL !== "") {
    fetch(SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).catch(error => console.error('Ошибка синхронизации:', error));
  }
}

function cleanPhone(p) {
  let digits = (p || '').replace(/\D/g, '');
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits ? '+' + digits : '';
}

function getLoyaltyInfo(totalStampsBeforeThisVisit) {
  const currentCycleVisit = (totalStampsBeforeThisVisit % 10) + 1;
  let discountPercent = 0;
  let hasGift = false;
  let label = `${currentCycleVisit}-й визит в карте`;

  if (currentCycleVisit === 3) { discountPercent = 10; label = '3-й визит: Скидка -10%!'; }
  else if (currentCycleVisit === 5) { discountPercent = 20; label = '5-й визит: Скидка -20%!'; }
  else if (currentCycleVisit === 8 || currentCycleVisit === 9) { hasGift = true; label = `${currentCycleVisit}-й визит: 🎁 Подарочек от мастера!`; }
  else if (currentCycleVisit === 10) { discountPercent = 30; label = '10-й юбилейный визит: Скидка -30%!'; }

  return { currentCycleVisit, discountPercent, hasGift, label };
}

function calculateVisitMath(serviceIds, phone, priceMode = 'new') {
  const normPhone = cleanPhone(phone);
  const client = state.clients[normPhone] || { visits: 0, bonusStamps: 0 };
  const totalStamps = (client.visits || 0) + (client.bonusStamps || 0);
  const loyalty = getLoyaltyInfo(totalStamps);

  let baseSum = 0;
  // Средняя себестоимость по точной стоимости упаковки и нормам склада.
  const matCost = inventoryMaterialCost(serviceIds);

  serviceIds.forEach(id => {
    const s = SERVICES.find(x => x.id === id);
    if (!s) return;
    baseSum += (priceMode === 'old' ? s.oldPrice : s.price);
  });

  const discountRub = Math.round(baseSum * (loyalty.discountPercent / 100));
  const finalPrice = baseSum - discountRub;
  const giftCost = loyalty.hasGift ? Number(state.settings.costGift || 50) : 0;
  const taxSelfEmployed = Math.round(finalPrice * 0.04);
  const netProfit = finalPrice - matCost - giftCost - taxSelfEmployed;

  return { baseSum, discountRub, finalPrice, matCost, giftCost, taxSelfEmployed, netProfit, loyalty };
}

function renderClientServices() {
  const grid = document.getElementById('clientServicesGrid');
  grid.innerHTML = SERVICES.map(s => {
    const sel = selectedClientServices.includes(s.id) ? 'selected' : '';
    return `
      <div class="service-item ${sel}" data-action="toggleClientService" data-service-id="${escapeInventoryText(s.id)}">
        <div class="service-name">${s.name}</div>
        <div class="service-price">${s.price} ₽</div>
        <div class="service-dur">⏱ ${s.dur}</div>
      </div>
    `;
  }).join('');
  updateClientSummary();
}

function toggleClientService(id) {
  const mainIds = ['coat', 'ext', 'clean'];
  if (mainIds.includes(id)) {
    selectedClientServices = selectedClientServices.filter(x => !mainIds.includes(x));
    selectedClientServices.unshift(id);
  } else {
    if (selectedClientServices.includes(id)) {
      selectedClientServices = selectedClientServices.filter(x => x !== id);
    } else {
      selectedClientServices.push(id);
    }
  }
  renderClientServices();
}

function renderClientLoyalty() {
  const rawPhone = document.getElementById('clientPhoneCheck').value;
  const normPhone = cleanPhone(rawPhone);
  const client = state.clients[normPhone] || { visits: 0, bonusStamps: 0 };
  const stamps = ((client.visits || 0) + (client.bonusStamps || 0)) % 10;
  const loyalty = getLoyaltyInfo((client.visits || 0) + (client.bonusStamps || 0));

  document.getElementById('clientLoyaltyStatus').innerText =
    normPhone.length >= 11 ? `${loyalty.label} (Отмечено щитов: ${stamps}/10)` : 'Введите свой номер для проверки накопленных щитов';

  const labels = ['1', '2', '-10%', '4', '-20%', '6', '7', '🎁', '🎁', '-30%'];
  document.getElementById('clientShieldsGrid').innerHTML = labels.map((text, idx) => {
    let cls = '';
    if (idx < stamps) cls = 'done';
    else if (idx === stamps) cls = 'next';
    return `<div class="shield ${cls}"><span>${idx < stamps ? '✓' : text}</span></div>`;
  }).join('');

  updateClientSummary();
}

// === ИДЕАЛЬНО РАБОЧАЯ ОТРИСОВКА СЛОТОВ ДЛЯ КЛИЕНТА ===
function renderClientSlots() {
  const container = document.getElementById('clientSlotsGrid'); // <-- Ошибка была здесь в ID!
  if (!container) return;
  container.innerHTML = '';

  const selectedDate = document.getElementById('clientDate').value;
  if (!selectedDate) return;

  let baseSlots = [];

  // Проверка плавающего графика
  if (state.customSchedule && state.customSchedule[selectedDate]) {
    baseSlots = state.customSchedule[selectedDate];
    if (baseSlots.length === 0) {
      container.innerHTML = '<div class="day-off">Мастер в этот день не принимает (Выходной)</div>';
      return;
    }
  } else {
    baseSlots = ['10:00', '12:30', '15:00', '17:30', '20:00'];
  }

  // Отрисовка кнопок времени
  baseSlots.forEach(time => {
    const isBooked = (state.appointments || []).some(a => a.date === selectedDate && a.time === time && a.status !== 'cancelled');

    const btn = document.createElement('button');
    btn.className = 'slot-btn';

    if (isBooked) {
      btn.disabled = true; // Кнопка блокируется, если время занято
    } else {
      if (selectedClientSlot === time) {
        btn.classList.add('selected'); // Подсвечиваем, если клиент выбрал это время
      }
      btn.addEventListener('click', () => {
        selectedClientSlot = time;
        renderClientSlots(); // Обновляем экран после клика
      });
    }

    btn.innerText = time;
    container.appendChild(btn);
  });

  updateClientSummary(); // Обновляем текст Итога
}

function updateClientSummary() {
  const phone = document.getElementById('clientPhoneCheck').value;
  const dateVal = document.getElementById('clientDate').value;
  const math = calculateVisitMath(selectedClientServices, phone, 'new');
  const names = selectedClientServices.map(id => SERVICES.find(s => s.id === id)?.name).join(', ');

  document.getElementById('clientSummaryBox').innerHTML = `
    <div><b>Услуги:</b> ${names || 'Не выбрано'}</div>
    <div><b>Дата и время:</b> ${dateVal} в ${selectedClientSlot || '—'}</div>
    <div><b>Бонус по карте:</b> <span class="loyalty-label">${math.loyalty.label}</span></div>
    <div class="summary-total"><b>Итого к оплате: ${math.finalPrice} ₽</b> ${math.discountRub > 0 ? `<s class="summary-original-price">${math.baseSum} ₽</s>` : ''}</div>
  `;
}

async function submitClientBooking() {
  const name = document.getElementById('clientName').value.trim();
  const phone = cleanPhone(document.getElementById('clientPhoneCheck').value);
  const date = document.getElementById('clientDate').value;
  const note = document.getElementById('clientNote').value.trim();

  if (!name || phone.length < 11) { alert('Пожалуйста, укажите ваше имя и корректный номер телефона!'); return; }
  if (!selectedClientSlot) { alert('Выберите свободное время!'); return; }

  if (state.settings.gasUrl) {
    document.getElementById('clientSummaryBox').innerHTML = '<i>Синхронизация с базой... Пожалуйста, подождите.</i>';
    try {
      const res = await fetch(state.settings.gasUrl);
      const cloudData = await res.json();
      if (cloudData && cloudData.appointments) { state = cloudData; }
    } catch (e) { console.error('Ошибка синхронизации', e); }
  }

  const isBooked = state.appointments.some(a => a.date === date && a.time === selectedClientSlot && a.status !== 'cancelled');
  if (isBooked) {
    alert('Извините, это время только что заняли. Пожалуйста, выберите другое.');
    renderClientSlots();
    return;
  }

  if (!state.clients[phone]) {
    state.clients[phone] = { name, phone, visits: 0, bonusStamps: 0, formula: '' };
  } else {
    state.clients[phone].name = name;
  }

  const newAppt = {
    id: Date.now(), name, phone, date, time: selectedClientSlot,
    serviceIds: [...selectedClientServices], priceMode: 'new', status: 'booked', note
  };

  state.appointments.push(newAppt);
  saveState();

  if (state.settings.gasUrl) {
     await syncToCloud();
  }

  alert(`Спасибо, ${name}! Вы успешно записаны на ${date} в ${selectedClientSlot}.`);
  selectedClientSlot = ''; // Сбрасываем выбранное время
  renderClientSlots();
}


async function toggleAdminMode() {
if (isAdmin) {
  isAdmin = false;
  document.getElementById('adminView').classList.add('hidden');
  document.getElementById('clientView').classList.remove('hidden');
  document.getElementById('adminBadge').classList.add('hidden');
  renderClientSlots();
  renderClientLoyalty();
  return;
}

const pin = prompt('Введите ПИН-код мастера:');
if (!pin) return;

const badge = document.getElementById('adminBadge');
badge.classList.remove('hidden');
badge.innerText = 'Проверка...';

try {
 const url = SCRIPT_URL;
  const data = await new Promise((resolve, reject) => {
    const callback = 'karnaPinCb_' + Date.now();
    const script = document.createElement('script');

    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete window[callback];
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Нет ответа от сервера'));
    }, 15000);

    window[callback] = (result) => {
      cleanup();
      resolve(result);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('Ошибка загрузки'));
    };

    script.src = url +
      '?action=verifyPin&pin=' +
      encodeURIComponent(pin) +
      '&callback=' + callback;

    document.head.appendChild(script);
  });

  if (!data.success) {
    badge.classList.add('hidden');
    alert('Неверный ПИН-код!');
    return;
  }

  isAdmin = true;
  document.getElementById('clientView').classList.add('hidden');
  document.getElementById('adminView').classList.remove('hidden');
  badge.innerText = 'Режим Мастера (Админ)';
  renderAllAdmin();

} catch (e) {
  badge.classList.add('hidden');
  alert('Ошибка соединения с сервером.');
  console.error(e);
}
}

function switchAdminTab(tabName, btn) {
  ['Schedule', 'Clients', 'Inventory', 'Finance'].forEach(t => {
    document.getElementById('tab' + t).classList.add('hidden');
  });
  document.getElementById('tab' + tabName).classList.remove('hidden');
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAllAdmin();
}

function renderAllAdmin() {
  renderAdminSchedule();
  renderAdminClients();
  renderAdminExpenses();
  renderInventory();
  renderAdminFinance();
}

function showAllDates() {
  document.getElementById('adminDateFilter').value = '';
  renderAdminSchedule();
}

function renderAdminSchedule() {
  const filterDate = document.getElementById('adminDateFilter').value;
  const list = document.getElementById('adminAppointmentsList');
  let appts = [...state.appointments].sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
  if (filterDate) appts = appts.filter(a => a.date === filterDate);

  if (appts.length === 0) {
    list.innerHTML = `<p class="empty-schedule">На выбранную дату записей пока нет</p>`;
    return;
  }

  list.innerHTML = appts.map(a => {
    const math = calculateVisitMath(a.serviceIds, a.phone, a.priceMode);
    const srvNames = a.serviceIds.map(id => SERVICES.find(s => s.id === id)?.name).join(', ');
    const isDone = a.status === 'completed';

    return `
      <div class="appt-item ${isDone ? 'completed' : ''}">
        <div class="item-heading">
          <b>📅 ${a.date} в ${a.time} — ${a.name}</b>
          <span class="badge badge-profit">Чистыми: +${math.netProfit} ₽</span>
        </div>
        <div class="appointment-details">📞 ${a.phone} • ${srvNames}</div>
        ${a.note ? `<div class="appointment-note">💬 ${a.note}</div>` : ''}
        <div class="appointment-footer">
          <span class="badge badge-bonus">${math.loyalty.label} • К оплате: ${math.finalPrice} ₽</span>
          <div class="compact-actions">
            ${!isDone ? `<button class="btn btn-sm complete-appointment-button" data-action="completeAppt" data-appointment-id="${escapeInventoryText(a.id)}">✓ Визит проведен (+щит)</button>` : `<span class="payment-status">✓ Оплачено</span>`}
            <button class="btn btn-outline btn-sm danger-button" data-action="deleteAppt" data-appointment-id="${escapeInventoryText(a.id)}">✕</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function completeAppt(id) {
  const appt = state.appointments.find(a => a.id === id);
  if (!appt || appt.status === 'completed') return;
  ensureInventory();
  const used = inventoryUsage(appt.serviceIds);
  const shortages = used.filter(({item,qty}) => Number(item.stock)<qty).map(({item})=>item.name);
  if(shortages.length && !confirm('Некоторых материалов недостаточно на складе: '+shortages.join(', ')+'.\nЕсли продолжить, остаток станет отрицательным. Провести визит?'))return;
  // Списание только при первом завершении записи.
  used.forEach(({item,qty}) => {item.stock=Math.round(((Number(item.stock)||0)-qty)*1000)/1000;});
  appt.stockDeducted = true;
  appt.materialCostAtCompletion = Math.round(inventoryMaterialCost(appt.serviceIds)*100)/100;
  appt.status = 'completed';
  if (!state.clients[appt.phone]) {
    state.clients[appt.phone] = { name: appt.name, phone: appt.phone, visits: 0, bonusStamps: 0, formula: '' };
  }
  state.clients[appt.phone].visits = (state.clients[appt.phone].visits || 0) + 1;
  saveState();
  renderAllAdmin();
}

function deleteAppt(id) {
  state.appointments = state.appointments.filter(a => a.id !== id);
  saveState();
  renderAllAdmin();
}

function addAdminBooking() {
  const name = document.getElementById('admClientName').value.trim();
  const phone = cleanPhone(document.getElementById('admClientPhone').value);
  const date = document.getElementById('admDate').value;
  const time = document.getElementById('admTime').value;
  const srv = document.getElementById('admService').value;
  const priceMode = document.getElementById('admPriceMode').value;

  if (!name || !phone || !date) { alert('Заполните имя, телефон и дату!'); return; }
  if (!state.clients[phone]) {
    state.clients[phone] = { name, phone, visits: 0, bonusStamps: 0, formula: '' };
  }
  state.appointments.push({
    id: Date.now(), name, phone, date, time, serviceIds: [srv], priceMode, status: 'booked', note: ''
  });
  saveState();
  renderAllAdmin();
  alert('Запись добавлена!');
}

function renderAdminClients() {
  const container = document.getElementById('adminClientsList');
  const clientsArr = Object.entries(state.clients);
  const labels = ['1', '2', '-10%', '4', '-20%', '6', '7', '🎁', '🎁', '-30%'];

 container.innerHTML = clientsArr.map(([phone, c]) => {
    const total = (c.visits || 0) + (c.bonusStamps || 0);
    const stampsInCard = total % 10;
    const loyalty = getLoyaltyInfo(total);

    const shieldsHtml = labels.map((txt, idx) => {
      const cls = idx < stampsInCard ? 'done' : (idx === stampsInCard ? 'next' : '');
      return `<div class="shield ${cls}"><span>${idx < stampsInCard ? '✓' : txt}</span></div>`;
    }).join('');

    return `
      <div class="appt-item">
        <div class="item-heading">
          <b>${c.name} (${c.phone})</b>
          <button class="btn btn-outline btn-sm" data-action="giveOldClientBonus" data-phone="${escapeInventoryText(c.phone)}">+2 щита (Старичку)</button>
        </div>
        <div class="client-next-visit">
          Следующий визит: ${loyalty.label} (Всего визитов: ${total})
        </div>
        <div class="shields-grid">${shieldsHtml}</div>
        <div class="client-actions">
<button class="btn btn-outline btn-sm"
  data-action="editClient" data-phone="${escapeInventoryText(phone)}">
  ✏️ Изменить
</button>

<button class="btn btn-outline btn-sm danger-button"

  data-action="deleteClient" data-phone="${escapeInventoryText(phone)}">
  🗑️ Удалить
</button>
</div>
      </div>
    `;
  }).join('');
}

function giveOldClientBonus(phone) {
  if (state.clients[phone]) {
    state.clients[phone].bonusStamps = (state.clients[phone].bonusStamps || 0) + 2;
    saveState();
    renderAdminClients();
  }
}

function editClient(oldPhone) {
if (!isAdmin) return;

const client = state.clients[oldPhone];
if (!client) return;

const name = prompt('Имя клиента:', client.name || '');
if (name === null) return;
if (!name.trim()) {
  alert('Имя не может быть пустым');
  return;
}

const phoneInput = prompt('Телефон:', client.phone || oldPhone);
if (phoneInput === null) return;

const phone = cleanPhone(phoneInput);
if (!/^\+\d{10,15}$/.test(phone)) {
  alert('Введите корректный телефон');
  return;
}

if (phone !== oldPhone && state.clients[phone]) {
  alert('Клиент с таким телефоном уже существует');
  return;
}

const visitsInput = prompt('Количество визитов:', client.visits || 0);
if (visitsInput === null) return;

const bonusInput = prompt('Дополнительные бонусные щиты:', client.bonusStamps || 0);
if (bonusInput === null) return;

const visits = Number(visitsInput);
const bonusStamps = Number(bonusInput);

if (
  !visitsInput.trim() || !bonusInput.trim() ||
  !Number.isSafeInteger(visits) ||
  !Number.isSafeInteger(bonusStamps) ||
  visits < 0 || bonusStamps < 0
) {
  alert('Количество визитов и щитов должно быть целым неотрицательным числом');
  return;
}

const formula = prompt('Формула ногтей:', client.formula || '');
if (formula === null) return;

const updatedClient = {
  ...client,
  name: name.trim(),
  phone,
  visits,
  bonusStamps,
  formula: formula.trim()
};

if (phone !== oldPhone) {
  delete state.clients[oldPhone];

  state.appointments.forEach(a => {
    if (a.phone === oldPhone) {
      a.phone = phone;
    }
  });
}

state.clients[phone] = updatedClient;

saveState();
renderAllAdmin();
alert('Карточка клиента обновлена!');
}

function deleteClient(phone) {
if (!isAdmin) return;

const client = state.clients[phone];
if (!client) return;

const linkedAppointments = state.appointments.filter(
  a => a.phone === phone
).length;

const warning = linkedAppointments
  ? `\nСвязанных записей: ${linkedAppointments}. Они останутся в истории.`
  : '';

if (!confirm(
  `Удалить карточку клиента "${client.name}"?` +
  warning +
  '\nБонусы и данные карточки будут удалены.'
)) return;

delete state.clients[phone];

saveState();
renderAllAdmin();
alert('Карточка клиента удалена!');
}

function addExpense() {
  const title = document.getElementById('expTitle').value.trim();
  const amount = Number(document.getElementById('expAmount').value);
  const cat = document.getElementById('expCat').value;
  if (!title || !amount) return;
  state.expenses.unshift({ id: Date.now(), title, amount, cat, date: new Date().toISOString().slice(0,10) });
  document.getElementById('expTitle').value = '';
  document.getElementById('expAmount').value = '';
  saveState();
  renderAllAdmin();
}

function renderAdminExpenses() {
  const box = document.getElementById('expensesList');
  box.innerHTML = state.expenses.map(e => `
    <div class="expense-row">
      <div><b>${e.title}</b> <span class="expense-category">(${e.cat})</span></div>
      <div class="expense-amount">-${e.amount} ₽</div>
    </div>
  `).join('');
}

function renderAdminFinance() {
  let gross = 0;
  let netOp = 0;
  state.appointments.forEach(a => {
    if (a.status === 'cancelled') return;
    const m = calculateVisitMath(a.serviceIds, a.phone, a.priceMode);
    gross += m.finalPrice;
    netOp += m.netProfit;
  });
  const totalExp = state.expenses.reduce((acc, x) => acc + Number(x.amount || 0), 0);
  const cashFlow = gross - totalExp;

  document.getElementById('finGross').innerText = gross + ' ₽';
  document.getElementById('finNetOp').innerText = '+' + netOp + ' ₽';
  document.getElementById('finExpenses').innerText = '-' + totalExp + ' ₽';
  document.getElementById('finCashFlow').innerText = (cashFlow >= 0 ? '+' : '') + cashFlow + ' ₽';
}

function saveSettings() {
  state.settings.costDisposable = Number(document.getElementById('costDisposable').value);
  state.settings.costGel = Number(document.getElementById('costGel').value);
  state.settings.costExt = Number(document.getElementById('costExt').value);
  state.settings.costGift = Number(document.getElementById('costGift').value);
  state.settings.gasUrl = document.getElementById('gasUrlInput').value.trim();
  saveState();
  renderAllAdmin();
}

async function syncToCloud() {
  const url = state.settings.gasUrl;
  if (!url) { alert('Укажите URL скрипта Google Таблицы во вкладке Прибыль!'); return; }
  document.getElementById('syncStatus').innerText = 'Сохранение в Google Таблицу...';
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(state)
    });
    document.getElementById('syncStatus').innerText = '✅ Данные успешно отправлены в Google Таблицу!';
  } catch (e) {
    document.getElementById('syncStatus').innerText = 'Ошибка синхронизации: ' + e.message;
  }
}

async function syncFromCloud() {
  const url = state.settings.gasUrl;
  if (!url) { alert('Укажите URL скрипта Google Таблицы!'); return; }
  document.getElementById('syncStatus').innerText = 'Загрузка расписания из Таблицы...';
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.appointments) {
      state = data;
      ensureInventory();
      saveState();
      renderClientSlots();
      renderClientLoyalty();
      if (isAdmin) renderAllAdmin();
      document.getElementById('syncStatus').innerText = '✅ Расписание и карты синхронизированы!';
    }
  } catch (e) {
    document.getElementById('syncStatus').innerText = 'Ошибка загрузки: проверьте доступ "Все" в Apps Script.';
  }
}

// === ПЛАВАЮЩИЙ ГРАФИК ===
function loadScheduleForDate() {
  const date = document.getElementById('adminScheduleDate').value;
  if (!date) return;

  if (!state.customSchedule) state.customSchedule = {};

  const slotsInput = document.getElementById('adminScheduleSlots');
  if (state.customSchedule[date] && state.customSchedule[date].length > 0) {
    slotsInput.value = state.customSchedule[date].join(', ');
  } else {
    slotsInput.value = '';
  }
}

function saveScheduleForDate() {
  const date = document.getElementById('adminScheduleDate').value;
  if (!date) {
    alert('Сначала выберите дату!');
    return;
  }

  const rawText = document.getElementById('adminScheduleSlots').value;
  const slotsArray = rawText.split(',').map(s => s.trim()).filter(s => s !== '');

  if (!state.customSchedule) state.customSchedule = {};
  state.customSchedule[date] = slotsArray;

  const status = document.getElementById('scheduleSaveStatus');
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 2000);

  saveState();
  syncToCloud();
}

function initApp() {
  ensureInventory();
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('clientDate').value = today;
  document.getElementById('admDate').value = today;
  document.getElementById('admService').innerHTML = SERVICES.map(s => `<option value="${s.id}">${s.name} (${s.price} ₽)</option>`).join('');

  if (typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL !== '') {
    state.settings.gasUrl = SCRIPT_URL;
  }
  document.getElementById('gasUrlInput').value = state.settings.gasUrl || '';

  renderClientServices();
  renderClientLoyalty();
  renderClientSlots();
  if (state.settings.gasUrl) syncFromCloud();
}

// Делегирование сохраняет работу кнопок после перерисовки innerHTML.
// В разметке хранятся только имена действий и данные, исполняемого кода нет.
function bindUIEvents() {
  const clickActions = {
    toggleAdminMode,
    submitClientBooking,
    saveScheduleForDate,
    showAllDates,
    addAdminBooking,
    addInventoryItem,
    addExpense,
    syncFromCloud,
    syncToCloud,
    switchAdminTab: element => switchAdminTab(element.dataset.tab, element),
    toggleClientService: element => toggleClientService(element.dataset.serviceId),
    setInventoryStock: element => setInventoryStock(element.dataset.itemId),
    restockInventory: element => restockInventory(element.dataset.itemId),
    editInventoryItem: element => editInventoryItem(element.dataset.itemId),
    editInventoryNorms: element => editInventoryNorms(element.dataset.itemId),
    removeInventoryItem: element => removeInventoryItem(element.dataset.itemId),
    completeAppt: element => completeAppt(Number(element.dataset.appointmentId)),
    deleteAppt: element => deleteAppt(Number(element.dataset.appointmentId)),
    giveOldClientBonus: element => giveOldClientBonus(element.dataset.phone),
    editClient: element => editClient(element.dataset.phone),
    deleteClient: element => deleteClient(element.dataset.phone)
  };
  const changeActions = {
    renderClientSlots,
    loadScheduleForDate,
    renderAdminSchedule,
    saveSettings
  };
  const inputActions = { renderClientLoyalty };

  const delegate = (eventName, attribute, actions) => {
    document.addEventListener(eventName, event => {
      const element = event.target.closest(`[${attribute}]`);
      if (!element) return;
      const action = element.getAttribute(attribute);
      if (Object.prototype.hasOwnProperty.call(actions, action)) {
        actions[action](element);
      }
    });
  };

  delegate('click', 'data-action', clickActions);
  delegate('change', 'data-change-action', changeActions);
  delegate('input', 'data-input-action', inputActions);
}

document.addEventListener('DOMContentLoaded', () => {
  bindUIEvents();
  initApp();
});
