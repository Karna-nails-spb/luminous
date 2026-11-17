// Karna Nails: состояние, расчёты, синхронизация и события интерфейса.
const GOOGLE_CLIENT_ID="625823076976-h393alfat9afn1k239udolvna9i8je1q.apps.googleusercontent.com";
const SCRIPT_URL="https://script.google.com/macros/s/AKfycbyHKb4QKnoBrtZPRBL8necjn8G0iuEo6W49OyRk2omf8ghS4HLGVEjt_E2cKOkla24eJw/exec";
// ==================== БАЗОВЫЕ ДАННЫЕ ПРАЙСА ====================
const SERVICES = [
  { id: 'coat', name: 'Маникюр с покрытием', price: 2000, oldPrice: 1650, dur: '2 ч', matType: 'gel' },
  { id: 'ext', name: 'Наращивание', price: 2700, oldPrice: 1800, dur: '2.5 ч', matType: 'ext' },
  { id: 'clean', name: 'Маникюр без покрытия', price: 1000, oldPrice: 650, dur: '1 ч', matType: 'clean' },
  { id: 'french', name: '+ Френч', price: 300, oldPrice: 200, dur: '+20 мин', matType: 'addon' },
  { id: 'repair', name: '+ Ремонт 1 ногтя', price: 100, oldPrice: 50, dur: '+10 мин', matType: 'addon' },
  { id: 'design', name: '+ Дизайн (от 1 ногтя)', price: 100, oldPrice: 50, dur: '+15 мин', matType: 'addon' }
];

// Never load personal data from the old public browser cache.
try { localStorage.removeItem('karna_crm_v2'); } catch (_) {}
let state = {
  appointments: [],
  clients: {},
  expenses: [],
  settings: { costDisposable: 65, costGel: 85, costExt: 160, costGift: 50, gasUrl: '' }
};

let selectedClientServices = ['coat'];
let selectedClientSlot = '';
let lastClientDate = '';
let isAdmin = false;

let adminToken='', revision='', dirty=false, blocked=false, uiBusy=false, publicReady=false;
const ADMIN_ACTIONS = new Set(['saveScheduleForDate','addAdminBooking','addInventoryItem','addExpense','setInventoryStock','restockInventory','editInventoryItem','editInventoryNorms','removeInventoryItem','completeAppt','editAppointmentPayment','deleteAppt','giveOldClientBonus','editClient','deleteClient','saveSettings','uploadGalleryPhoto','unpublishGalleryPhoto']);
const API_ERRORS = {
  UNAUTHORIZED:'Нет доступа или сеанс истёк. Войдите снова.', SETUP_REQUIRED:'На сервере ещё не настроен новый пароль мастера.',
  LOGIN_LIMIT:'Слишком много попыток входа. Повторите через 15 минут.', CONFLICT:'База уже изменилась. Загрузите свежие данные и повторите изменение.',
  DATE_OUT_OF_RANGE:'Онлайн-запись доступна только на текущий и следующий месяц.',
  SLOT_TAKEN:'Это время уже занято. Выберите другое.', SLOT_UNAVAILABLE:'Это время отсутствует в расписании.', PAST_SLOT:'Нельзя записаться на прошедшее время.',
  INVALID_BOOKING:'Проверьте данные записи и длину комментария (до 1000 символов).', INVALID_APPOINTMENT:'Проверьте дату, время, телефон и услуги записей.',
  INVALID_CLIENT:'Проверьте имена, телефоны, визиты и щиты клиентов.', INVALID_SCHEDULE:'В расписании нужны уникальные часы в формате ЧЧ:ММ.',
  DATABASE_TOO_LARGE:'База достигла допустимого размера ячейки. Изменение не сохранено.', BOOKING_LIMIT:'Слишком много записей с этого номера. Свяжитесь с мастером.',
  BUSY:'Сервер занят. Повторите действие позже.'
};
function salonNow() {
  const parts = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  return parts.replace(',', '');
}
function clientBookingWindow() {
  const today=salonNow().slice(0,10);
  const [year,month]=today.slice(0,7).split('-').map(Number);
  const lastDay=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
  return {today,lastDay};
}
function dateOpenForClient(date) {
  const window=clientBookingWindow();
  return !!date && date>=window.today && date<=window.lastDay;
}
function showSync(text) { const el=document.getElementById('syncStatus'); if(el) el.textContent=text; if(isAdmin) document.getElementById('adminBadge').textContent=text; }
async function api(action, fields={}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),35000);
  try {
    const response=await fetch(action==='public'?SCRIPT_URL+'?action=public':SCRIPT_URL, action==='public' ?
      {signal:controller.signal,credentials:'omit',cache:'no-store',redirect:'follow'} :
      {method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...fields}),signal:controller.signal,credentials:'omit',redirect:'follow'});
    if(!response.ok) throw new Error('HTTP');
    const result=await response.json();
    if(typeof result.ok!=='boolean') throw new Error('PROTOCOL');
    if(!result.ok) { const error=new Error(API_ERRORS[result.error] || 'Сервер отклонил запрос: '+result.error); error.code=result.error; throw error; }
    return result;
  } catch(error) {
    if(error.code) throw error;
    const uncertain=new Error('Нет подтверждения сервера. Результат неизвестен. Для записи повторите те же данные; мастер — сначала загрузите базу заново.');
    uncertain.code='NETWORK'; throw uncertain;
  } finally { clearTimeout(timer); }
}
function clearAdmin() {
  adminToken=''; revision=''; isAdmin=false; dirty=false; blocked=false; publicReady=false;
  state={appointments:[],clients:{},expenses:[],settings:{}};
  document.getElementById('adminView').classList.add('hidden');
  document.getElementById('clientView').classList.remove('hidden');
  document.getElementById('adminBadge').classList.add('hidden');
  for(const id of ['adminAppointmentsList','adminClientsList','expensesList','inventoryCatalog','finGross','finNetOp','finExpenses','finCashFlow']) {
    const node=document.getElementById(id); if(node) node.textContent='';
  }
  for (const id of ['admClientName','admClientPhone','admDate','admTime','adminScheduleSlots']) { const node=document.getElementById(id); if(node) node.value=''; }
  renderClientSlots(); renderClientLoyalty(); renderGallery();
}
async function runUI(action, work) {
  if(uiBusy) return;
  const mutation=ADMIN_ACTIONS.has(action);
  if(mutation && (!isAdmin || !adminToken)) { alert('Войдите как мастер.'); return; }
  if(mutation && blocked) { alert('Сначала нажмите «Загрузить из Таблицы».'); return; }
  const before=mutation?JSON.stringify(state):null;
  uiBusy=true;
  try {
    await work();
    if(mutation && dirty) await syncToCloud();
  } catch(error) {
    if(mutation) { state=JSON.parse(before); dirty=false; blocked=true; renderAllAdmin(); }
    if(error.code==='UNAUTHORIZED' && adminToken) clearAdmin();
    showSync(error.message); alert(error.message);
  } finally { uiBusy=false; }
}


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
  if (!isAdmin || !adminToken) throw new Error('Войдите как мастер.');
  ensureInventory();
  dirty = true;
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

// Optional actual payment is stored per appointment, never as a client discount.
function hasManualPayment(appt) {
  return typeof appt.paidAmount === 'number' && Number.isFinite(appt.paidAmount)
    && appt.paidAmount >= 0 && appt.paidAmount <= 1000000;
}
function withActualPayment(math, amount) {
  const finalPrice = Math.round(amount * 100) / 100;
  const taxSelfEmployed = Math.round(finalPrice * 0.04);
  const netProfit = finalPrice - (Number(math.matCost) || 0)
    - (Number(math.giftCost) || 0) - taxSelfEmployed;
  return {...math, finalPrice, taxSelfEmployed, netProfit, paidManually:true};
}
function appointmentMath(appt) {
  if (appt.status === 'completed' && appt.financialSnapshot) return appt.financialSnapshot;
  const result = calculateVisitMath(appt.serviceIds, appt.phone, appt.priceMode);
  // Старые визиты не имеют сохранённой цены: не выдаём оценку за чек.
  if (appt.status === 'completed') result.legacyEstimate = true;
  return hasManualPayment(appt) ? withActualPayment(result, appt.paidAmount) : result;
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
  document.getElementById('clientLoyaltyStatus').textContent = 'Щиты и скидку проверит мастер. Здесь показаны правила бонусной карты.';
  const labels = ['1', '2', '-10%', '4', '-20%', '6', '7', '🎁', '🎁', '-30%'];
  document.getElementById('clientShieldsGrid').innerHTML = labels.map(text => `<div class="shield"><span>${text}</span></div>`).join('');
  updateClientSummary();
}

function renderClientSlots() {
  const container = document.getElementById('clientSlotsGrid'); // <-- Ошибка была здесь в ID!
  if (!container) return;
  container.innerHTML = '';

  const input=document.getElementById('clientDate');
  const window=clientBookingWindow();
  input.min=window.today;
  input.max=window.lastDay;
  const selectedDate=input.value;
  if (selectedDate!==lastClientDate) {
    selectedClientSlot='';
    lastClientDate=selectedDate;
  }
  if (!selectedDate) return;
  if (!dateOpenForClient(selectedDate)) {
    container.textContent='Выберите дату в текущем или следующем месяце.';
    updateClientSummary();
    return;
  }
  if (!publicReady && !isAdmin) { container.textContent = 'Расписание не загружено. Нажмите «Обновить расписание».'; return; }

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

    if (isBooked || selectedDate + ' ' + time <= salonNow()) {
      btn.disabled = true; // Кнопка блокируется, если время занято
    } else {
      if (selectedClientSlot === time) {
        btn.classList.add('selected'); // Подсвечиваем, если клиент выбрал это время
      }
      btn.addEventListener('click', () => {
        if (uiBusy) return;
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
  const date = document.getElementById('clientDate').value;
  const services = SERVICES.filter(s=>selectedClientServices.includes(s.id));
  const total = services.reduce((sum,s)=>sum+s.price,0);
  document.getElementById('clientSummaryBox').innerHTML = `
    <div><b>Услуги:</b> ${escapeInventoryText(services.map(s=>s.name).join(', '))}</div>
    <div><b>Дата и время:</b> ${escapeInventoryText(date)} в ${escapeInventoryText(selectedClientSlot || '—')}</div>
    <div class="summary-total"><b>До скидки: ${escapeInventoryText(total)} ₽</b></div>
    <div>Личную скидку и бонусы уточнит мастер.</div>`;
}

async function submitClientBooking() {
  const booking = {
    name: document.getElementById('clientName').value.trim(),
    phone: cleanPhone(document.getElementById('clientPhoneCheck').value),
    date: document.getElementById('clientDate').value,
    time: selectedClientSlot,
    note: document.getElementById('clientNote').value.trim(),
    serviceIds: [...selectedClientServices]
  };
  if (!booking.name || !/^\+\d{10,15}$/.test(booking.phone) || !booking.time || !booking.date) {
    alert('Укажите имя, телефон, дату и свободное время.'); return;
  }
  if (!dateOpenForClient(booking.date)) {
    alert('Онлайн-запись доступна только на текущий и следующий месяц.'); return;
  }
  if (!publicReady) throw new Error('Сначала обновите расписание.');
  const fingerprint = JSON.stringify(booking);
  // Persist only a hash and random request ID, never name, phone or note.
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
  const key = Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem('karna_pending_booking')); } catch (_) {}
  if (!pending || pending.key!==key) pending = {key,id:crypto.randomUUID()};
  try { sessionStorage.setItem('karna_pending_booking',JSON.stringify(pending)); } catch (_) {}
  const result = await api('book',{booking,requestId:pending.id});
  try { sessionStorage.removeItem('karna_pending_booking'); } catch (_) {}
  alert(`Спасибо, ${booking.name}! Сервер подтвердил запись на ${booking.date} в ${booking.time}.`);
  selectedClientSlot = '';
  // A refresh failure cannot change an already confirmed booking into a failure.
  try { await syncFromCloud(); } catch (_) { publicReady=false; renderClientSlots(); }
}

function askAdminGoogleCode() {
  const dialog=document.getElementById('adminLoginDialog');
  if (!window.google?.accounts?.oauth2?.initCodeClient) {
    throw new Error('Вход Google ещё не загрузился. Проверьте интернет и обновите страницу.');
  }
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(code,error)=>{
      if(settled) return;
      settled=true;
      dialog.removeEventListener('close',onCancel);
      if(dialog.open) dialog.close();
      if(error) reject(error); else resolve(code);
    };
    const onCancel=()=>finish(null);
    dialog.addEventListener('close',onCancel,{once:true});
    dialog.showModal();
    const box=document.getElementById('googleSignInButton');
    box.replaceChildren();
    const button=document.createElement('button');
    button.type='button';
    button.className='btn';
    button.textContent='Войти через Google';
    button.addEventListener('click',()=>{
      button.disabled=true;
      try {
        const client=google.accounts.oauth2.initCodeClient({
          client_id:GOOGLE_CLIENT_ID,
          scope:'openid email profile',
          ux_mode:'popup',
          callback:response=>{
            if(response?.code) finish(response.code);
            else finish(null,new Error('Google не предоставил код входа.'));
          },
          error_callback:error=>{
            if(error?.type==='popup_closed') {button.disabled=false; return;}
            finish(null,new Error('Не удалось открыть окно Google. Попробуйте ещё раз.'));
          }
        });
        client.requestCode({prompt:'select_account'});
      } catch(error) {finish(null,error);}
    });
    box.append(button);
  });
}

async function toggleAdminMode() {
  if (isAdmin) {
    try { await api('logout',{token:adminToken}); }
    finally { clearAdmin(); await syncFromCloud(); }
    return;
  }
  const code = await askAdminGoogleCode();
  if (!code) return;
  const login = await api('googleCodeLogin',{code});
  adminToken = login.token;
  try {
    const result = await api('adminRead',{token:adminToken});
    state=result.data; revision=result.revision; dirty=false; blocked=false;
    isAdmin=true;
    ensureInventory();
    document.getElementById('clientView').classList.add('hidden');
    document.getElementById('adminView').classList.remove('hidden');
    document.getElementById('adminBadge').classList.remove('hidden');
    document.getElementById('adminBadge').textContent='Режим мастера';
    renderAllAdmin();
  } catch (error) { clearAdmin(); throw error; }
}

function switchAdminTab(tabName, btn) {
  ['Schedule', 'Clients', 'Inventory', 'Finance', 'Gallery'].forEach(t => {
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
  renderGallery();
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

  const renderAppointment = a => {
    const math = appointmentMath(a);
    const srvNames = a.serviceIds.map(id => SERVICES.find(s => s.id === id)?.name).join(', ');
    const isDone = a.status === 'completed';
    const moneyLabel = isDone ? 'Получено' : 'К оплате';
    const manualPaymentLabel = hasManualPayment(a) ? ' • сумма указана мастером' : '';

    return `
      <div class="appt-item ${isDone ? 'completed' : ''}">
        <div class="item-heading">
          <b>📅 ${escapeInventoryText(a.date)} в ${escapeInventoryText(a.time)} — ${escapeInventoryText(a.name)}</b>
          <span class="badge badge-profit">Чистыми: ${math.netProfit >= 0 ? '+' : ''}${math.netProfit.toFixed(2)} ₽</span>
        </div>
        <div class="appointment-details">📞 ${escapeInventoryText(a.phone)} • ${srvNames}</div>
        ${a.note ? `<div class="appointment-note">💬 ${escapeInventoryText(a.note)}</div>` : ''}
        <div class="appointment-footer">
          <span class="badge badge-bonus">${math.legacyEstimate ? "Оценка: цена старого визита не сохранена" : escapeInventoryText(math.loyalty.label)} • ${moneyLabel}: ${math.finalPrice} ₽${manualPaymentLabel}</span>
          <div class="compact-actions">
            ${!isDone ? `<button class="btn btn-sm complete-appointment-button" data-action="completeAppt" data-appointment-id="${escapeInventoryText(a.id)}">✓ Визит проведен (+щит)</button>` : `<span class="payment-status">✓ Оплачено</span>`}
            ${a.status !== 'cancelled' ? `<button class="btn btn-outline btn-sm" data-action="editAppointmentPayment" data-appointment-id="${escapeInventoryText(a.id)}">💰 Изменить сумму</button>` : ''}
            <button class="btn btn-outline btn-sm danger-button" data-action="deleteAppt" data-appointment-id="${escapeInventoryText(a.id)}">✕</button>
          </div>
        </div>
      </div>
    `;
  };
  // Preserve user-expanded days when the list re-renders after an edit.
  const expanded=new Map(Array.from(list.querySelectorAll('details.booking-day'),node=>[node.dataset.date,node.open]));
  const grouped=new Map();
  appts.forEach(a=>{
    if (!grouped.has(a.date)) grouped.set(a.date,[]);
    grouped.get(a.date).push(a);
  });
  list.innerHTML=Array.from(grouped,([date,dayAppointments])=>{
    const defaultOpen=false;
    const isOpen=!!filterDate || (expanded.has(date)?expanded.get(date):defaultOpen);
    const dateLabel=date.split('-').reverse().join('.');
    return `<details class="booking-day" data-date="${escapeInventoryText(date)}" ${isOpen?'open':''}>
      <summary><span>📅 ${escapeInventoryText(dateLabel)}</span><span class="booking-day-count">Записей: ${dayAppointments.length}</span></summary>
      <div class="booking-day-list">${dayAppointments.map(renderAppointment).join('')}</div>
    </details>`;
  }).join('');
}

function completeAppt(id) {
  const appt = state.appointments.find(a => a.id === id);
  if (!appt || appt.status === 'completed') return;
  ensureInventory();
  const used = inventoryUsage(appt.serviceIds);
  const shortages = used.filter(({item,qty}) => Number(item.stock)<qty).map(({item})=>item.name);
  if(shortages.length && !confirm('Некоторых материалов недостаточно на складе: '+shortages.join(', ')+'.\nЕсли продолжить, остаток станет отрицательным. Провести визит?'))return;
  // Цена и скидка фиксируются ДО начисления следующего щита.
  appt.financialSnapshot = appointmentMath(appt);
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

function editAppointmentPayment(id) {
  if (!isAdmin) return;
  const appt = state.appointments.find(a => a.id === id);
  if (!appt || appt.status === 'cancelled') return;
  const current = appointmentMath(appt).finalPrice;
  const input = prompt('Сколько рублей фактически получили за эту запись?\nМожно указать 0, если визит был бесплатным.', String(current));
  if (input === null) return;
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    alert('Укажите сумму в рублях: 500 или 500,50. Отрицательная сумма недопустима.');
    return;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount > 1000000) {
    alert('Сумма должна быть от 0 до 1 000 000 ₽.');
    return;
  }
  if (hasManualPayment(appt) && appt.paidAmount === amount) return;
  // Editing an old completed visit must not deduct stock or award loyalty again.
  if (appt.status === 'completed') {
    const hadSnapshot = !!appt.financialSnapshot;
    const previous = hadSnapshot ? appt.financialSnapshot
      : calculateVisitMath(appt.serviceIds, appt.phone, appt.priceMode);
    appt.financialSnapshot = withActualPayment(previous, amount);
    if (!hadSnapshot) appt.financialSnapshot.legacyEstimate = true;
  }
  appt.paidAmount = amount;
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
          <b>${escapeInventoryText(c.name)} (${escapeInventoryText(c.phone)})</b>
          <button class="btn btn-outline btn-sm" data-action="giveOldClientBonus" data-phone="${escapeInventoryText(c.phone)}">+2 щита (Старичку)</button>
        </div>
        <div class="client-next-visit">
          Следующий визит: ${loyalty.label} (Всего визитов: ${escapeInventoryText(total)})
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
      <div><b>${escapeInventoryText(e.title)}</b> <span class="expense-category">(${escapeInventoryText(e.cat)})</span></div>
      <div class="expense-amount">-${escapeInventoryText(e.amount)} ₽</div>
    </div>
  `).join('');
}

function renderAdminFinance() {
  let gross = 0;
  let netOp = 0;
  state.appointments.forEach(a => {
    // Запись сама по себе не означает оплату. Учитываем только проведённые визиты.
    if (a.status !== 'completed') return;
    const m = appointmentMath(a);
    gross += m.finalPrice;
    netOp += m.netProfit;
  });
  const totalExp = state.expenses.reduce((acc, x) => acc + Number(x.amount || 0), 0);
  const cashFlow = gross - totalExp;

  const estimate = state.appointments.some(a => a.status === 'completed' && (!a.financialSnapshot || a.financialSnapshot.legacyEstimate)) ? ' (есть оценочные суммы)' : '';
  document.getElementById('finGross').innerText = gross.toFixed(2) + ' ₽' + estimate;
  document.getElementById('finNetOp').innerText = (netOp >= 0 ? '+' : '') + netOp.toFixed(2) + ' ₽' + estimate;
  document.getElementById('finExpenses').innerText = '-' + totalExp + ' ₽';
  document.getElementById('finCashFlow').innerText = (cashFlow >= 0 ? '+' : '') + cashFlow + ' ₽';
}

function saveSettings() {
  // The server address is fixed in app.js, never taken from database content.
  for (const id of ['costDisposable','costGel','costExt','costGift']) {
    const input=document.getElementById(id);
    if(input) state.settings[id]=Number(input.value);
  }
  saveState();
}

async function syncToCloud() {
  if (!isAdmin || !adminToken) throw new Error('Войдите как мастер.');
  if (blocked) throw new Error('Сначала загрузите свежие данные из таблицы.');
  if (!dirty) { showSync('Изменений для сохранения нет.'); return; }
  showSync('Сохранение…');
  const result=await api('adminSave',{token:adminToken,revision,data:state});
  revision=result.revision; dirty=false;
  showSync(result.warning ? 'База сохранена. Не удалось обновить вспомогательные листы.' : '✓ Сохранено в Google Таблице.');
}

async function syncFromCloud() {
  const result=isAdmin ? await api('adminRead',{token:adminToken}) : await api('public');
  state=result.data;
  if (isAdmin) { revision=result.revision; blocked=false; dirty=false; ensureInventory(); renderAllAdmin(); }
  publicReady=true;
  renderClientSlots(); renderClientLoyalty(); renderGallery();
  showSync('Данные загружены.');
}

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

  document.getElementById('scheduleSaveStatus').classList.add('hidden');

  saveState();
}



/* Портфолио: в базе только список публикаций, сами фотографии на Drive. */
const galleryPhotoCache = new Map();
const galleryPhotoPending = new Map();
let galleryObserver = null;
function publishedGallery() {
  return Array.isArray(state.gallery) ? state.gallery.filter(p=>p && /^[A-Za-z0-9_-]{10,120}$/.test(String(p.id||''))) : [];
}
function galleryTile(photo, master) {
  const id=escapeInventoryText(photo.id);
  const caption=escapeInventoryText(photo.caption||'');
  return '<article class="gallery-tile">' +
    '<button type="button" class="gallery-image-button" data-action="openGalleryPhoto" data-photo-id="'+id+'" aria-label="Посмотреть фотографию '+caption+'">' +
    '<span class="gallery-placeholder">📷</span>' +
    '<img class="gallery-image" data-gallery-image="'+id+'" alt="'+caption+'" loading="lazy">' +
    '</button>' +
    (caption ? '<p class="gallery-caption">'+caption+'</p>' : '') +
    (master ? '<button type="button" class="gallery-remove" data-action="unpublishGalleryPhoto" data-photo-id="'+id+'">Убрать из галереи</button>' : '') +
    '</article>';
}
function renderGallery() {
  const gallery=publishedGallery();
  const publicCard=document.getElementById('clientGalleryCard');
  const publicGrid=document.getElementById('clientGalleryGrid');
  const adminGrid=document.getElementById('adminGalleryGrid');
  if (!publicCard || !publicGrid || !adminGrid) return;
  publicCard.classList.toggle('hidden',gallery.length===0);
  publicGrid.innerHTML=gallery.map(p=>galleryTile(p,false)).join('');
  adminGrid.innerHTML=gallery.length ? gallery.map(p=>galleryTile(p,true)).join('') :
    '<p class="gallery-empty">Здесь пока нет фотографий. Добавьте первую работу выше.</p>';
  if (galleryObserver) galleryObserver.disconnect();
  const imgs=document.querySelectorAll('[data-gallery-image]');
  const loadImg=img => {
    getGalleryPhotoData(img.dataset.galleryImage).then(src=>{
      if (!img.isConnected) return;
      img.src=src; img.classList.add('loaded');
      const placeholder=img.parentElement.querySelector('.gallery-placeholder');
      if (placeholder) placeholder.classList.add('hidden');
    }).catch(()=>{
      if (img.isConnected) img.alt='Не удалось загрузить фото';
    });
  };
  if ('IntersectionObserver' in window) {
    galleryObserver=new IntersectionObserver(entries=>{
      entries.forEach(entry=>{
        if (!entry.isIntersecting) return;
        galleryObserver.unobserve(entry.target);
        loadImg(entry.target);
      });
    },{rootMargin:'250px'});
    imgs.forEach(img=>galleryObserver.observe(img));
  } else imgs.forEach(loadImg);
}
async function getGalleryPhotoData(id) {
  if (galleryPhotoCache.has(id)) return galleryPhotoCache.get(id);
  if (galleryPhotoPending.has(id)) return galleryPhotoPending.get(id);
  const task=(async()=>{
    const response=await fetch(SCRIPT_URL+'?action=photo&id='+encodeURIComponent(id),{
      credentials:'omit',cache:'no-store',redirect:'follow'
    });
    if (!response.ok) throw new Error('Фото временно недоступно');
    const result=await response.json();
    if (!result.ok || !['image/jpeg','image/png','image/webp'].includes(result.mime) ||
        typeof result.data!=='string' || result.data.length>1300000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(result.data)) throw new Error('Не удалось загрузить фотографию');
    const src='data:'+result.mime+';base64,'+result.data;
    galleryPhotoCache.set(id,src);
    return src;
  })();
  galleryPhotoPending.set(id,task);
  try { return await task; } finally { galleryPhotoPending.delete(id); }
}
async function openGalleryPhoto(id) {
  if (!publishedGallery().some(p=>p.id===id)) return;
  const photo=publishedGallery().find(p=>p.id===id);
  const dialog=document.getElementById('galleryLightbox');
  const img=document.getElementById('galleryLargeImage');
  img.removeAttribute('src');
  document.getElementById('galleryLargeCaption').textContent=photo.caption||'';
  if (!dialog.open) dialog.showModal();
  try { img.src=await getGalleryPhotoData(id); }
  catch (error) { dialog.close(); throw error; }
}
async function prepareGalleryImage(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>15000000)
    throw new Error('Выберите JPG, PNG или WebP размером до 15 МБ.');
  let image;
  if (typeof createImageBitmap==='function') image=await createImageBitmap(file);
  else {
    image=await new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Не удалось прочитать изображение'));};
      img.src=url;
    });
  }
  if (!image.width || !image.height || image.width>10000 || image.height>10000)
    throw new Error('Неподдерживаемый размер фотографии');
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,1200/Math.max(image.width,image.height));
  canvas.width=Math.max(1,Math.round(image.width*scale));
  canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  let data=canvas.toDataURL('image/jpeg',0.78).split(',')[1];
  if (data.length>1250000) {
    canvas.width=Math.max(1,Math.round(canvas.width*0.7));
    canvas.height=Math.max(1,Math.round(canvas.height*0.7));
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    data=canvas.toDataURL('image/jpeg',0.65).split(',')[1];
  }
  if (image.close) image.close();
  if (data.length>1250000) throw new Error('Фотография слишком большая. Выберите другой снимок.');
  return data;
}
async function uploadGalleryPhoto() {
  const input=document.getElementById('galleryPhotoFile');
  const file=input.files[0];
  if (!file) { alert('Сначала выберите фотографию.'); return; }
  const status=document.getElementById('galleryUploadStatus');
  status.textContent='Подготавливаю фотографию…';
  const data=await prepareGalleryImage(file);
  status.textContent='Загружаю в галерею…';
  const caption=document.getElementById('galleryPhotoCaption').value.trim();
  const result=await api('uploadGalleryPhoto',{token:adminToken,revision,mime:'image/jpeg',data,caption});
  revision=result.revision;
  state.gallery=[result.photo,...publishedGallery()];
  input.value='';
  document.getElementById('galleryPhotoCaption').value='';
  status.textContent='✓ Фотография опубликована.';
  renderGallery();
}
async function unpublishGalleryPhoto(id) {
  if (!confirm('Убрать фотографию из галереи? Файл останется в закрытой папке Drive.')) return;
  const result=await api('unpublishGalleryPhoto',{token:adminToken,revision,id});
  revision=result.revision;
  state.gallery=publishedGallery().filter(p=>p.id!==id);
  galleryPhotoCache.delete(id);
  renderGallery();
  document.getElementById('galleryUploadStatus').textContent='Фотография убрана из галереи.';
}

function initApp() {
  ensureInventory();
  const today = salonNow().slice(0,10);
  const clientDate=document.getElementById('clientDate');
  clientDate.value=today;
  clientDate.min=today;
  clientDate.max=clientBookingWindow().lastDay;
  document.getElementById('admDate').value = today;
  document.getElementById('admService').innerHTML = SERVICES.map(s => `<option value="${s.id}">${s.name} (${s.price} ₽)</option>`).join('');

  if (typeof SCRIPT_URL !== 'undefined' && SCRIPT_URL !== '') {
    state.settings.gasUrl = SCRIPT_URL;
  }
  document.getElementById('gasUrlInput').value = state.settings.gasUrl || '';

  renderClientServices();
  renderClientLoyalty();
  renderClientSlots();
  renderGallery();
  syncFromCloud().catch(error=>{ publicReady=false; renderClientSlots(); alert(error.message); });
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
    editAppointmentPayment: element => editAppointmentPayment(Number(element.dataset.appointmentId)),
    deleteAppt: element => deleteAppt(Number(element.dataset.appointmentId)),
    giveOldClientBonus: element => giveOldClientBonus(element.dataset.phone),
    editClient: element => editClient(element.dataset.phone),
    deleteClient: element => deleteClient(element.dataset.phone),
    uploadGalleryPhoto,
    unpublishGalleryPhoto: element => unpublishGalleryPhoto(element.dataset.photoId),
    openGalleryPhoto: element => openGalleryPhoto(element.dataset.photoId)
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
        runUI(action, () => actions[action](element));
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
