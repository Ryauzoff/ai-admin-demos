/* Демо ИИ-администратора салона.
   Движок работает локально, без интернета и ключей.
   Логика: понимание намерения -> ответ по базе знаний -> запись по шагам. */

(() => {
  "use strict";

  const S = window.SALON;
  const $ = (sel) => document.querySelector(sel);

  // ---------- утилиты ----------

  const MONTHS = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря"
  ];
  const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
  const WEEKDAY_STEMS = ["воскресен", "понедельн", "вторник", "сред", "четверг", "пятниц", "суббот"];
  const WEEKDAY_SHORT = { "вс": 0, "пн": 1, "вт": 2, "ср": 3, "чт": 4, "пт": 5, "сб": 6 };
  const MONTH_STEMS = [
    "январ", "феврал", "март", "апрел", "ма", "июн",
    "июл", "август", "сентябр", "октябр", "ноябр", "декабр"
  ];

  const norm = (s) => String(s)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9:.,\s+\-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const money = (n) => n.toLocaleString("ru-RU") + " ₽";

  const pad = (n) => String(n).padStart(2, "0");

  const dayStart = (offset = 0) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  };

  const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const humanDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEKDAYS[d.getDay()]}`;

  const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

  const durationText = (min) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h && m) return `${h} ч ${m} мин`;
    if (h) return h === 1 ? "1 час" : `${h} часа`;
    return `${m} минут`;
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const plural = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  };

  // ---------- состояние ----------

  const state = {
    mode: "day",
    busy: false,
    queue: [],
    flow: null,
    bookings: [],
    escalated: false,
    messageCount: 0
  };

  // ---------- даты и слоты ----------

  const busyMap = {};
  Object.entries(S.busyOffsets || {}).forEach(([offset, times]) => {
    busyMap[dateKey(dayStart(Number(offset)))] = times.slice();
  });

  function isPastSlot(day, hour) {
    if (dateKey(day) !== dateKey(dayStart(0))) return false;
    const now = new Date();
    return hour <= now.getHours() + 1;
  }

  function freeSlots(day) {
    const key = dateKey(day);
    const busy = new Set(busyMap[key] || []);
    const list = [];
    for (let h = S.schedule.open; h < S.schedule.close; h += 1) {
      const label = `${pad(h)}:00`;
      if (busy.has(label) || isPastSlot(day, h)) continue;
      list.push(label);
    }
    return list;
  }

  function takeSlot(day, time) {
    const key = dateKey(day);
    busyMap[key] = busyMap[key] || [];
    if (!busyMap[key].includes(time)) busyMap[key].push(time);
  }

  function parseDate(text) {
    const t = norm(text);
    if (/послезавтра/.test(t)) return dayStart(2);
    if (/завтра/.test(t)) return dayStart(1);
    if (/сегодня|сейчас/.test(t)) return dayStart(0);

    const short = t.match(/(?:^|\s)(вс|пн|вт|ср|чт|пт|сб)(?=\s|$)/);
    if (short) return nextWeekday(WEEKDAY_SHORT[short[1]]);

    const stem = WEEKDAY_STEMS.findIndex((s) => t.includes(s));
    if (stem !== -1) return nextWeekday(stem);

    const dm = t.match(/(\d{1,2})\s*(?:го)?\s*(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/);
    if (dm) {
      let month = MONTH_STEMS.findIndex((m) => dm[2].startsWith(m.slice(0, 4)) || m.startsWith(dm[2].slice(0, 4)));
      if (dm[2].startsWith("ма")) month = 4;
      if (month === -1) month = 10;
      const year = new Date().getFullYear();
      let d = new Date(year, month, Number(dm[1]));
      if (d < dayStart(0)) d = new Date(year + 1, month, Number(dm[1]));
      return d;
    }

    const dotted = t.match(/\b(\d{1,2})[.](\d{1,2})\b/);
    if (dotted) {
      const d = new Date(new Date().getFullYear(), Number(dotted[2]) - 1, Number(dotted[1]));
      if (!isNaN(d)) return d;
    }

    return null;
  }

  function nextWeekday(target) {
    const today = dayStart(0);
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0 && freeSlots(today).length === 0) diff = 7;
    return dayStart(diff);
  }

  function parseTime(text, day) {
    const t = norm(text);
    const m = t.match(/\b([01]?\d|2[0-3])[:.](\d{2})\b/);
    if (m) return `${pad(Number(m[1]))}:${m[2]}`;
    const h = t.match(/\b(?:в|к|на)\s*([01]?\d|2[0-3])\b/);
    if (h) return `${pad(Number(h[1]))}:00`;
    const bare = t.match(/^([01]?\d|2[0-3])$/);
    if (bare) return `${pad(Number(bare[1]))}:00`;
    return null;
  }

  // ---------- поиск услуги и мастера ----------

  function findService(text) {
    const t = norm(text);
    let best = null;
    let bestLen = 0;
    for (const service of S.services) {
      const words = [service.name, ...(service.keywords || [])];
      for (const word of words) {
        const w = norm(word);
        if (w && t.includes(w) && w.length > bestLen) {
          best = service;
          bestLen = w.length;
        }
      }
    }
    return best;
  }

  function findMaster(text) {
    const t = norm(text);
    return S.masters.find((m) => t.includes(norm(m.name))) || null;
  }

  function primaryMaster(service) {
    return S.masters.find((m) => m.id === service.masters[0]) || S.masters[0];
  }

  // ---------- DOM ----------

  const els = {
    chat: $("#messages"),
    chips: $("#chips"),
    form: $("#chatForm"),
    input: $("#chatInput"),
    send: $("#sendBtn"),
    clock: $("#clock"),
    status: $("#chatStatus"),
    leadCard: $("#leadCard"),
    leadService: $("#leadService"),
    leadMaster: $("#leadMaster"),
    leadDate: $("#leadDate"),
    leadTime: $("#leadTime"),
    leadName: $("#leadName"),
    leadPhone: $("#leadPhone"),
    leadCount: $("#leadCount"),
    toast: $("#toast"),
    nightToggle: $("#nightToggle"),
    resetBtn: $("#resetBtn"),
    escalateBadge: $("#escalateBadge")
  };

  // ---------- визуал чата ----------

  function nowTime() {
    if (state.mode === "night") return "23:40";
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function scrollToBottom() {
    els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: "smooth" });
  }

  function addBubble(from, text) {
    const row = document.createElement("div");
    row.className = `msg msg--${from}`;

    if (from === "bot") {
      const avatar = document.createElement("div");
      avatar.className = "msg__avatar";
      avatar.textContent = S.adminName.slice(0, 1);
      row.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "msg__bubble";
    const p = document.createElement("span");
    p.className = "msg__text";
    p.textContent = text;
    bubble.appendChild(p);
    const time = document.createElement("span");
    time.className = "msg__time";
    time.textContent = nowTime();
    bubble.appendChild(time);

    row.appendChild(bubble);
    els.chat.appendChild(row);
    state.messageCount += 1;
    scrollToBottom();
  }

  function addSystem(text) {
    const el = document.createElement("div");
    el.className = "system-note";
    el.textContent = text;
    els.chat.appendChild(el);
    scrollToBottom();
  }

  function showTyping() {
    const row = document.createElement("div");
    row.className = "msg msg--bot msg--typing";
    row.id = "typing";
    const avatar = document.createElement("div");
    avatar.className = "msg__avatar";
    avatar.textContent = S.adminName.slice(0, 1);
    const bubble = document.createElement("div");
    bubble.className = "msg__bubble";
    bubble.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    row.appendChild(avatar);
    row.appendChild(bubble);
    els.chat.appendChild(row);
    scrollToBottom();
  }

  function hideTyping() {
    const el = $("#typing");
    if (el) el.remove();
  }

  function setChips(chips) {
    els.chips.innerHTML = "";
    if (!chips || !chips.length) return;
    for (const chip of chips) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = chip.label;
      btn.addEventListener("click", () => sendUser(chip.value));
      els.chips.appendChild(btn);
    }
  }

  async function botSay(text, chips) {
    showTyping();
    const delay = Math.min(1500, 450 + text.length * 12);
    await sleep(delay);
    hideTyping();
    addBubble("bot", text);
    setChips(chips);
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function updateClock() {
    els.clock.textContent = nowTime();
  }

  function toast(text) {
    els.toast.textContent = text;
    els.toast.classList.add("is-visible");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
  }

  // ---------- сценарии ----------

  async function route(text) {
    const t = norm(text);

    // Глобальные команды, работают на любом шаге.
    if (/человек|администратор|оператор|менеджер|живой|позов|соедин/.test(t) && !state.flow) {
      return escalate();
    }

    if (/спасибо|благодар|спс|спасиб/.test(t) && !state.flow) {
      return botSay(`Пожалуйста! Если понадобится записаться, просто напишите. Ждём вас в «${S.name}».`);
    }

    if (state.flow && state.flow.type === "booking") {
      return bookingStep(text);
    }

    if (state.flow && state.flow.type === "cancel") {
      return cancelStep(text);
    }

    if (/отмен|перенес|перезапис/.test(t)) return startCancel();

    if (/адрес|где вы|как добраться|находит|как доехать/.test(t)) {
      return botSay(`Мы в ${S.city}, ${S.address}. Вход со стороны улицы, вывеска «${S.name}». Парковка во дворе.`, [
        { label: "Свободное время", value: "когда есть свободное время" }
      ]);
    }

    if (/работаете|график|во сколько|до скольки|открыт|закрыт|выходн/.test(t)) {
      return botSay(`Работаем ${S.hours}. Запись ведём и после закрытия: сообщение оставьте здесь, и я оформлю запись на утро.`, [
        { label: "Записаться", value: "хочу записаться" }
      ]);
    }

    if (/услуг|что у вас|какие процедур|что делаете|прайс|какие.*цен|список цен|^цены$/.test(t)) {
      return showPriceList();
    }

    if (/сколько|цена|стоит|стоимость|почем/.test(t)) {
      return handlePrice(text);
    }

    if (/мастер|кто делает|специалист|к кому/.test(t)) {
      return botSay("У нас три мастера: Мария - стрижки, окрашивание и укладка; Алина - маникюр и педикюр; Ольга - брови, ресницы и макияж. На какую услугу хотите записаться?", [
        { label: "На маникюр", value: "хочу записаться на маникюр" },
        { label: "На стрижку", value: "хочу записаться на женскую стрижку" }
      ]);
    }

    if (/запис|свободн|окошк|есть время|можно на|прийти|приехать/.test(t)) {
      const service = findService(text);
      return startBooking(service);
    }

    if (/привет|здравств|добрый|доброе|хай|hello/.test(t)) {
      return botSay(`Здравствуйте! Я ${S.adminName}, администратор студии «${S.name}». Подскажу цены, свободное время и запишу вас. Что вас интересует?`, [
        { label: "Записаться", value: "хочу записаться" },
        { label: "Цены", value: "сколько стоит маникюр" }
      ]);
    }

    const faq = (S.faq || []).find((item) => item.match.some((m) => t.includes(m)));
    if (faq) return botSay(faq.answer);

    // Не поняли вопрос.
    await botSay("Не поняла вопрос, но это легко исправить. Могу назвать цены, показать свободное время или записать вас. Если нужно что-то особенное, передам администратору.", [
      { label: "Показать цены", value: "какие у вас цены" },
      { label: "Записаться", value: "хочу записаться" },
      { label: "Позвать администратора", value: "позовите администратора" }
    ]);
  }

  async function showPriceList() {
    const lines = S.services.map((s) => `${s.name} - ${money(s.price)}`).join("\n");
    return botSay(`Вот наш прайс:\n${lines}\n\nНа какую услугу хотите записаться?`, [
      { label: "Записаться", value: "хочу записаться" },
      { label: "Позвать администратора", value: "позовите администратора" }
    ]);
  }

  async function handlePrice(text) {
    const service = findService(text);
    if (service) {
      return botSay(`${service.name} - ${money(service.price)}, ${durationText(service.duration)}. Записать вас?`, [
        { label: "Записаться", value: `хочу записаться на ${service.name.toLowerCase()}` },
        { label: "Другие цены", value: "какие у вас цены" }
      ]);
    }
    return botSay("Подскажите услугу: стрижка, окрашивание, маникюр, педикюр, брови, ресницы или макияж. Назову цену и свободное время.", [
      { label: "Маникюр", value: "сколько стоит маникюр" },
      { label: "Стрижка", value: "сколько стоит женская стрижка" }
    ]);
  }

  // ---------- запись ----------

  async function startBooking(service) {
    state.flow = { type: "booking", step: "service", service: service || null };
    if (service) {
      state.flow.step = "master";
      return askMaster();
    }
    return askService();
  }

  async function askService() {
    const chips = S.services.slice(0, 5).map((s) => ({ label: s.name, value: s.name }));
    return botSay("Конечно! На какую услугу хотите записаться?", chips);
  }

  async function askMaster() {
    const service = state.flow.service;
    const master = primaryMaster(service);
    state.flow.master = master;
    state.flow.step = "master";
    return botSay(`${service.name} у нас делает ${master.name}, ${master.role}. Записать к ней или подобрать любого свободного мастера?`, [
      { label: `К ${master.name}`, value: `к ${master.name}` },
      { label: "Любой свободный", value: "любой свободный" }
    ]);
  }

  async function askDate() {
    state.flow.step = "date";
    const today = dayStart(0);
    const tomorrow = dayStart(1);
    const hasToday = freeSlots(today).length > 0;
    const chips = [];
    if (hasToday) chips.push({ label: "Сегодня", value: "сегодня" });
    chips.push({ label: "Завтра", value: "завтра" });
    chips.push({ label: "Послезавтра", value: "послезавтра" });
    const todayNote = hasToday
      ? `Сегодня ${shortDate(today)} ещё есть окна.`
      : `На сегодня, ${shortDate(today)}, мест уже нет.`;
    return botSay(`${todayNote} Завтра - ${shortDate(tomorrow)}, ${WEEKDAYS[tomorrow.getDay()]}. На какой день записать?`, chips);
  }

  async function askTime(day) {
    state.flow.step = "time";
    const slots = freeSlots(day);
    if (!slots.length) {
      await botSay(`На ${humanDate(day)} свободных окон нет. Давайте посмотрим другой день.`);
      return askDate();
    }
    const show = slots.slice(0, 6);
    const more = slots.length > show.length ? " Есть и другие окна, назовите удобное время." : "";
    return botSay(`${humanDate(day)} свободно: ${show.join(", ")}.${more} Какое время удобно?`, show.map((t) => ({ label: t, value: t })));
  }

  async function askName() {
    state.flow.step = "name";
    return botSay("Отлично. Как вас зовут?");
  }

  async function askPhone() {
    state.flow.step = "phone";
    return botSay(`Приятно познакомиться, ${state.flow.name}! Оставьте номер телефона, чтобы администратор подтвердила запись.`);
  }

  async function confirmBooking() {
    state.flow.step = "confirm";
    const f = state.flow;
    return botSay(
      `Записываю: ${f.service.name}, мастер ${f.master.name}, ${humanDate(f.date)} в ${f.time}. Всё верно?`,
      [{ label: "Да, подтверждаю", value: "да" }, { label: "Изменить", value: "изменить" }]
    );
  }

  async function bookingStep(text) {
    const t = norm(text);
    const flow = state.flow;

    // Прервать и передать человеку можно на любом шаге.
    if (/человек|администратор|оператор|живой/.test(t)) {
      state.flow = null;
      return escalate();
    }

    if (flow.step === "service") {
      const service = findService(text);
      if (!service) {
        return botSay("Не нашла такую услугу. Выберите из списка или напишите название, например «маникюр».", S.services.slice(0, 5).map((s) => ({ label: s.name, value: s.name })));
      }
      flow.service = service;
      return askMaster();
    }

    if (flow.step === "master") {
      if (/любой|все равно|все равно|не важно/.test(t)) {
        flow.master = primaryMaster(flow.service);
      } else {
        const master = findMaster(text);
        if (master) {
          flow.master = master;
        } else if (/да|ок|подходит|хорошо|давайте|конечно/.test(t)) {
          flow.master = primaryMaster(flow.service);
        } else {
          return botSay(`Не поняла, к кому записать. ${primaryMaster(flow.service).name} или любой свободный мастер?`, [
            { label: `К ${primaryMaster(flow.service).name}`, value: `к ${primaryMaster(flow.service).name}` },
            { label: "Любой свободный", value: "любой свободный" }
          ]);
        }
      }
      return askDate();
    }

    if (flow.step === "date") {
      const date = parseDate(text);
      if (!date) {
        return botSay("Не поняла дату. Можно сказать «завтра», «послезавтра» или «в субботу».", [
          { label: "Завтра", value: "завтра" },
          { label: "Послезавтра", value: "послезавтра" }
        ]);
      }
      if (date < dayStart(0)) {
        return botSay("Эта дата уже прошла. Выберите день начиная с сегодняшнего.", [
          { label: "Завтра", value: "завтра" }
        ]);
      }
      flow.date = date;
      return askTime(date);
    }

    if (flow.step === "time") {
      const time = parseTime(text, flow.date);
      const slots = freeSlots(flow.date);
      if (!time) {
        return botSay(`Не поняла время. Свободно: ${slots.slice(0, 6).join(", ")}. Назовите время, например «15:00».`, slots.slice(0, 6).map((s) => ({ label: s, value: s })));
      }
      if (!slots.includes(time)) {
        return botSay(`${time} уже занято. Свободные окна: ${slots.slice(0, 6).join(", ")}. Выберите другое время.`, slots.slice(0, 6).map((s) => ({ label: s, value: s })));
      }
      flow.time = time;
      return askName();
    }

    if (flow.step === "name") {
      const name = text.trim().replace(/^(меня зовут|это|я)\s+/i, "").replace(/[.,!]/g, "");
      if (name.length < 2) {
        return botSay("Напишите, пожалуйста, имя - так администратору будет проще вас встретить.");
      }
      flow.name = name.charAt(0).toUpperCase() + name.slice(1);
      return askPhone();
    }

    if (flow.step === "phone") {
      const digits = text.replace(/\D/g, "");
      if (digits.length < 10) {
        return botSay("Кажется, в номере не хватает цифр. Напишите телефон в формате +7 900 000-00-00.");
      }
      const last10 = digits.slice(-10);
      flow.phone = `+7 ${last10.slice(0, 3)} ${last10.slice(3, 6)}-${last10.slice(6, 8)}-${last10.slice(8, 10)}`;
      return confirmBooking();
    }

    if (flow.step === "confirm") {
      if (/^да|ага|конечно|верно|подтвержда|ок|окей|угу|да, подтверждаю/.test(t)) {
        return finalizeBooking();
      }
      if (/измен|друг|нет|не то/.test(t)) {
        state.flow = null;
        return botSay("Хорошо, начнём заново. На какую услугу записать?", S.services.slice(0, 5).map((s) => ({ label: s.name, value: s.name })));
      }
      return botSay("Подтвердите запись, пожалуйста: «да» или «изменить».", [
        { label: "Да", value: "да" },
        { label: "Изменить", value: "изменить" }
      ]);
    }
  }

  async function finalizeBooking() {
    const f = state.flow;
    const record = {
      service: f.service,
      master: f.master,
      date: f.date,
      time: f.time,
      name: f.name,
      phone: f.phone
    };
    state.flow = null;
    state.bookings.push(record);
    takeSlot(record.date, record.time);
    showLead(record);

    await botSay(`Готово, ${record.name}! Записала вас: ${record.service.name}, ${humanDate(record.date)} в ${record.time}, мастер ${record.master.name}. За час пришлю напоминание сюда. Если планы изменятся, просто напишите.`);
    addSystem(`Заявка передана администратору: ${record.name}, ${record.phone}`);
    setStatus("онлайн, ведёт запись");
    toast("Заявка ушла администратору (демо)");
  }

  // ---------- отмена ----------

  async function startCancel() {
    const last = state.bookings[state.bookings.length - 1];
    state.flow = { type: "cancel", step: "confirm", record: last || null };
    if (last) {
      return botSay(`Вижу вашу запись: ${last.service.name}, ${humanDate(last.date)} в ${last.time}. Отменить её?`, [
        { label: "Да, отменить", value: "да" },
        { label: "Оставить", value: "нет" }
      ]);
    }
    return botSay("Подскажите, на какое имя или телефон оформлена запись. Проверю и отменю.");
  }

  async function cancelStep(text) {
    const t = norm(text);
    const flow = state.flow;

    if (flow.record) {
      if (/^да|отмен|конечно|верно/.test(t)) {
        const key = dateKey(flow.record.date);
        const time = flow.record.time;
        busyMap[key] = (busyMap[key] || []).filter((x) => x !== time);
        state.bookings = state.bookings.filter((b) => b !== flow.record);
        state.flow = null;
        hideLead();
        await botSay(`Отменила запись на ${humanDate(flow.record.date)} в ${flow.record.time}. Если захотите выбрать другое время, я на связи.`);
        addSystem("Запись отменена, администратор уведомлена");
        return;
      }
      if (/нет|остав|не надо|оставить/.test(t)) {
        state.flow = null;
        return botSay("Хорошо, запись оставила без изменений. Ждём вас!");
      }
      return botSay("Отменить запись? Ответьте «да» или «нет».", [
        { label: "Да", value: "да" },
        { label: "Нет", value: "нет" }
      ]);
    }

    // Ищем запись по имени или телефону.
    const digits = text.replace(/\D/g, "");
    const found = state.bookings.find((b) =>
      (digits.length >= 10 && b.phone.replace(/\D/g, "").endsWith(digits.slice(-10))) ||
      t.includes(norm(b.name))
    );
    if (found) {
      flow.record = found;
      flow.step = "confirm";
      return botSay(`Нашла запись: ${found.service.name}, ${humanDate(found.date)} в ${found.time}, на имя ${found.name}. Отменить?`, [
        { label: "Да, отменить", value: "да" },
        { label: "Нет", value: "нет" }
      ]);
    }
    state.flow = null;
    return botSay(`Не нашла запись по этим данным. Передам ${S.adminName}, она проверит в журнале и вернётся с ответом.`);
  }

  // ---------- передача человеку ----------

  async function escalate() {
    state.flow = null;
    state.escalated = true;
    els.escalateBadge.hidden = false;
    setStatus("передано администратору");
    addSystem("Диалог передан живому администратору");
    return botSay(`Передаю ${S.adminName}. Она уже видит наш диалог и ответит в течение 10 минут. Если удобнее, напишите напрямую в Telegram: ${S.telegram}.`, [
      { label: "Спасибо", value: "спасибо" }
    ]);
  }

  // ---------- карточка заявки ----------

  function showLead(record) {
    const send = $("#sendTg");
    if (send) { send.disabled = false; send.textContent = "Отправить в Telegram"; }
    els.leadService.textContent = record.service.name;
    els.leadMaster.textContent = record.master.name;
    els.leadDate.textContent = humanDate(record.date);
    els.leadTime.textContent = record.time;
    els.leadName.textContent = record.name;
    els.leadPhone.textContent = record.phone;
    els.leadCount.textContent = `${state.bookings.length} ${plural(state.bookings.length, "заявка", "заявки", "заявок")} за демо`;
    els.leadCard.hidden = false;
    els.leadCard.classList.add("is-new");
    setTimeout(() => els.leadCard.classList.remove("is-new"), 1200);
  }

  function hideLead() {
    els.leadCard.hidden = true;
    const send = $("#sendTg");
    if (send) { send.disabled = true; send.textContent = "Отправить в Telegram"; }
  }

  // ---------- ввод ----------

  function addUser(text) {
    addBubble("user", text);
  }

  async function respond(text) {
    state.busy = true;
    els.input.disabled = true;
    try {
      await route(text);
    } catch (err) {
      console.error(err);
      await botSay("Что-то пошло не так. Передам администратору, она ответит вручную.");
    } finally {
      state.busy = false;
      els.input.disabled = false;
      if (window.innerWidth > 900) els.input.focus({ preventScroll: true });
    }
  }

  async function sendUser(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    if (state.busy) {
      state.queue.push(clean);
      return;
    }
    setChips([]);
    addUser(clean);
    await respond(clean);
    while (state.queue.length) {
      const next = state.queue.shift();
      setChips([]);
      addUser(next);
      await respond(next);
    }
  }

  // ---------- ночной режим и сброс ----------

  async function setNight(on) {
    state.mode = on ? "night" : "day";
    document.body.classList.toggle("is-night", on);
    els.nightToggle.setAttribute("aria-pressed", String(on));
    els.nightToggle.textContent = on ? "Ночь: 23:40" : "День: сейчас";
    updateClock();
    if (on) {
      setStatus("ночная смена, студия закрыта");
      addSystem("Сейчас 23:40. Студия закрыта, но администратор на связи");
      await botSay("Да, я на связи и ночью. Могу записать вас на завтра или ответить на вопрос. Что подсказать?", [
        { label: "Записаться на завтра", value: "хочу записаться на маникюр" },
        { label: "Цены", value: "какие у вас цены" }
      ]);
    } else {
      setStatus("онлайн, отвечает сразу");
      addSystem("Сейчас рабочее время студии");
    }
  }

  async function resetDemo() {
    state.flow = null;
    state.bookings = [];
    state.escalated = false;
    state.queue = [];
    state.messageCount = 0;
    els.chat.innerHTML = "";
    setChips([]);
    hideLead();
    els.escalateBadge.hidden = true;
    setStatus(state.mode === "night" ? "ночная смена, студия закрыта" : "онлайн, отвечает сразу");
    updateClock();
    await botSay(`Здравствуйте! Я ${S.adminName}, администратор студии «${S.name}». Подскажу по услугам, ценам и записи. Что вас интересует?`, [
      { label: "Записаться", value: "хочу записаться" },
      { label: "Цены", value: "какие у вас цены" },
      { label: "Адрес", value: "где вы находитесь" }
    ]);
  }

  // ---------- события ----------

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value;
    els.input.value = "";
    sendUser(text);
  });

  els.nightToggle.addEventListener("click", () => setNight(state.mode !== "night"));
  els.resetBtn.addEventListener("click", resetDemo);

  document.querySelectorAll("[data-scenario]").forEach((btn) => {
    btn.addEventListener("click", () => sendUser(btn.getAttribute("data-scenario")));
  });

  const leadSend = $("#sendTg");
  if (leadSend) {
    leadSend.addEventListener("click", () => {
      leadSend.textContent = "Отправлено";
      leadSend.disabled = true;
      toast("Заявка отправлена в Telegram (демо)");
      addSystem("Заявка отправлена в Telegram администратору");
    });
  }

  // ---------- старт ----------

  function applyBranding() {
    document.title = `ИИ-администратор — ${S.fullName}`;
    const name = $("#brandName");
    if (name) name.textContent = S.name;
    const tag = $("#brandTagline");
    if (tag) tag.textContent = S.tagline || "студия красоты";
    const av = $("#adminAvatar");
    if (av) av.textContent = S.adminName.slice(0, 1);
    const mark = $("#brandMark");
    if (mark) mark.textContent = S.name.slice(0, 1);
    const head = $("#adminNameHeader");
    if (head) head.textContent = S.adminName;
  }

  applyBranding();
  updateClock();
  setInterval(updateClock, 30000);
  if (window.innerWidth > 900) els.input.focus({ preventScroll: true });

  setTimeout(() => {
    botSay(`Здравствуйте! Я ${S.adminName}, администратор студии «${S.name}». Подскажу по услугам, ценам и записи. Что вас интересует?`, [
      { label: "Записаться", value: "хочу записаться" },
      { label: "Цены", value: "какие у вас цены" },
      { label: "Адрес", value: "где вы находитесь" }
    ]);
  }, 700);
})();



