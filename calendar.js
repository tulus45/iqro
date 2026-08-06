(function setupDualCalendar() {
  'use strict';

  const primaryStorageKey = 'iqro_calendar_primary';
  const offsetStorageKey = 'iqro_hijri_offset';
  const hijriMonthNames = [
    'Muharam', 'Safar', 'Rabiulawal', 'Rabiulakhir',
    'Jumadilawal', 'Jumadilakhir', 'Rajab', 'Syakban',
    'Ramadan', 'Syawal', 'Zulkaidah', 'Zulhijah'
  ];
  const gregorianObservances = {
    '01-01': 'Tahun Baru Masehi',
    '04-21': 'Hari Kartini',
    '05-01': 'Hari Buruh Internasional',
    '05-20': 'Hari Kebangkitan Nasional',
    '06-01': 'Hari Lahir Pancasila',
    '08-17': 'Hari Kemerdekaan Republik Indonesia',
    '10-01': 'Hari Kesaktian Pancasila',
    '10-28': 'Hari Sumpah Pemuda',
    '11-10': 'Hari Pahlawan',
    '12-25': 'Hari Raya Natal'
  };
  const hijriObservances = {
    '1-1': 'Tahun Baru Islam',
    '1-10': 'Hari Asyura',
    '3-12': 'Maulid Nabi Muhammad saw.',
    '7-27': 'Isra Mikraj',
    '9-1': 'Awal Ramadan',
    '9-17': 'Nuzululquran',
    '10-1': 'Idulfitri',
    '12-10': 'Iduladha'
  };
  const gregorianMonthFormatter = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
  const fullGregorianFormatter = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const shortGregorianFormatter = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short'
  });

  function localNoon(year, month, day) {
    return new Date(year, month, day, 12, 0, 0, 0);
  }

  function normalizeDate(date) {
    return localNoon(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function shiftDate(date, amount) {
    return localNoon(date.getFullYear(), date.getMonth(), date.getDate() + amount);
  }

  function dateKey(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function readOffset() {
    const parsed = Number(window.localStorage.getItem(offsetStorageKey));
    return [-1, 0, 1].includes(parsed) ? parsed : 0;
  }

  const today = normalizeDate(new Date());
  const calendarState = {
    primary: window.localStorage.getItem(primaryStorageKey) === 'hijri' ? 'hijri' : 'gregorian',
    offset: readOffset(),
    viewDate: localNoon(today.getFullYear(), today.getMonth(), 1),
    selectedDate: today
  };

  let hijriFormatter = null;
  try {
    hijriFormatter = new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura-nu-latn', {
      day: 'numeric', month: 'long', year: 'numeric'
    });
  } catch (_) {
    try {
      hijriFormatter = new Intl.DateTimeFormat('id-ID-u-ca-islamic-nu-latn', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (_) {
      hijriFormatter = null;
    }
  }

  function civilHijri(date) {
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    const day = date.getDate();
    if (month <= 2) {
      year -= 1;
      month += 12;
    }
    const century = Math.floor(year / 100);
    const correction = 2 - century + Math.floor(century / 4);
    const julianDay = Math.floor(365.25 * (year + 4716)) + Math.floor(30.6001 * (month + 1)) + day + correction - 1524;
    const days = julianDay - 1948440 + 10632;
    const cycle = Math.floor((days - 1) / 10631);
    let remainder = days - 10631 * cycle + 354;
    const adjustment = Math.floor((10985 - remainder) / 5316) * Math.floor((50 * remainder) / 17719)
      + Math.floor(remainder / 5670) * Math.floor((43 * remainder) / 15238);
    remainder = remainder - Math.floor((30 - adjustment) / 15) * Math.floor((17719 * adjustment) / 50)
      - Math.floor(adjustment / 16) * Math.floor((15238 * adjustment) / 43) + 29;
    const hijriMonth = Math.floor((24 * remainder) / 709);
    const hijriDay = remainder - Math.floor((709 * hijriMonth) / 24);
    return { day: hijriDay, month: hijriMonth, year: 30 * cycle + adjustment - 30 };
  }

  function hijriParts(sourceDate) {
    const date = shiftDate(sourceDate, calendarState.offset);
    if (hijriFormatter?.formatToParts) {
      try {
        const parts = hijriFormatter.formatToParts(date);
        const values = {};
        parts.forEach((part) => {
          if (part.type !== 'literal') values[part.type] = part.value;
        });
        const day = Number(values.day);
        const year = Number(values.year);
        if (Number.isFinite(day) && Number.isFinite(year)) {
          const monthName = values.month || '';
          const month = hijriMonthNames.findIndex((name) => name.toLocaleLowerCase('id-ID') === monthName.toLocaleLowerCase('id-ID')) + 1;
          return { day, month: month || null, monthName, year };
        }
      } catch (_) {
        // Continue with the deterministic offline fallback.
      }
    }
    const civil = civilHijri(date);
    return { day: civil.day, month: civil.month, monthName: hijriMonthNames[civil.month - 1] || '', year: civil.year };
  }

  function formatHijri(date, includeDay) {
    const parts = hijriParts(date);
    return `${includeDay ? `${parts.day} ` : ''}${parts.monthName} ${parts.year} H`;
  }

  function sameDate(first, second) {
    return dateKey(first) === dateKey(second);
  }

  function observancesForDate(date) {
    const events = [];
    const gregorianKey = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (gregorianObservances[gregorianKey]) {
      events.push({ name: gregorianObservances[gregorianKey], calendar: 'Masehi' });
    }
    const hijri = hijriParts(date);
    const hijriName = hijriObservances[`${hijri.month}-${hijri.day}`];
    if (hijriName) events.push({ name: hijriName, calendar: 'Hijriah' });
    return events;
  }

  function observancesInPeriod(firstDate, lastDate) {
    const notes = [];
    for (let date = normalizeDate(firstDate); date <= lastDate; date = shiftDate(date, 1)) {
      const events = observancesForDate(date);
      if (events.length) notes.push({ date, events });
    }
    return notes;
  }

  function calendarDayDistance(date) {
    const targetUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((targetUtc - todayUtc) / 86400000);
  }

  function relativeDayLabel(date) {
    const distance = calendarDayDistance(date);
    if (distance === 0) return 'Hari ini';
    if (distance > 0) return `${distance} hari lagi`;
    return `${Math.abs(distance)} hari lalu`;
  }

  function renderHolidayNote(period, monthLabel) {
    const label = document.getElementById('calendarHolidayMonthLabel');
    const list = document.getElementById('calendarHolidayList');
    if (!label || !list) return;
    label.textContent = monthLabel;
    const notes = observancesInPeriod(period.first, period.last);
    list.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'calendar-holiday-empty';
      empty.textContent = 'Tidak ada catatan hari besar pada bulan ini.';
      list.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    notes.forEach((note) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'calendar-holiday-item';
      item.innerHTML = `
        <span class="calendar-holiday-date"><strong>${shortGregorianFormatter.format(note.date)}</strong><small>${hijriParts(note.date).day} ${hijriParts(note.date).monthName}</small></span>
        <span class="calendar-holiday-event"><strong>${note.events.map((event) => event.name).join(' / ')}</strong><small>${relativeDayLabel(note.date)}</small></span>
        <span class="calendar-holiday-badge">${[...new Set(note.events.map((event) => event.calendar))].join(' & ')}</span>
      `;
      item.addEventListener('click', () => {
        calendarState.selectedDate = note.date;
        renderCalendar();
      });
      fragment.appendChild(item);
    });
    list.appendChild(fragment);
  }

  function hijriMonthRange(firstDate, lastDate) {
    const first = hijriParts(firstDate);
    const last = hijriParts(lastDate);
    const firstLabel = `${first.monthName} ${first.year} H`;
    const lastLabel = `${last.monthName} ${last.year} H`;
    return firstLabel === lastLabel ? firstLabel : `${firstLabel} - ${lastLabel}`;
  }

  function hijriMonthKey(date) {
    const parts = hijriParts(date);
    return `${parts.monthName}|${parts.year}`;
  }

  function hijriPeriod(date) {
    const targetKey = hijriMonthKey(date);
    let first = normalizeDate(date);
    let last = normalizeDate(date);
    let guard = 0;
    while (guard < 32 && hijriMonthKey(shiftDate(first, -1)) === targetKey) {
      first = shiftDate(first, -1);
      guard += 1;
    }
    guard = 0;
    while (guard < 32 && hijriMonthKey(shiftDate(last, 1)) === targetKey) {
      last = shiftDate(last, 1);
      guard += 1;
    }
    return { first, last, key: targetKey };
  }

  function gregorianPeriodLabel(firstDate, lastDate) {
    const first = gregorianMonthFormatter.format(firstDate);
    const last = gregorianMonthFormatter.format(lastDate);
    return first === last ? first : `${first} - ${last}`;
  }

  function renderCalendar() {
    const grid = document.getElementById('dualCalendarGrid');
    if (!grid) return;

    const year = calendarState.viewDate.getFullYear();
    const month = calendarState.viewDate.getMonth();
    const gregorianFirst = localNoon(year, month, 1);
    const gregorianLast = localNoon(year, month + 1, 0);
    const period = calendarState.primary === 'hijri'
      ? hijriPeriod(calendarState.viewDate)
      : { first: gregorianFirst, last: gregorianLast, key: `${year}-${month}` };
    const startOffset = (period.first.getDay() + 6) % 7;
    const gridStart = shiftDate(period.first, -startOffset);
    const gregorianTitle = calendarState.primary === 'hijri'
      ? gregorianPeriodLabel(period.first, period.last)
      : gregorianMonthFormatter.format(gregorianFirst);
    const hijriTitle = calendarState.primary === 'hijri'
      ? formatHijri(period.first, false)
      : hijriMonthRange(gregorianFirst, gregorianLast);
    const title = document.getElementById('calendarMonthTitle');
    const subtitle = document.getElementById('calendarMonthSubtitle');
    if (title) title.textContent = calendarState.primary === 'hijri' ? hijriTitle : gregorianTitle;
    if (subtitle) subtitle.textContent = calendarState.primary === 'hijri' ? gregorianTitle : hijriTitle;

    document.getElementById('calendarGregorianToggle')?.classList.toggle('is-active', calendarState.primary === 'gregorian');
    document.getElementById('calendarHijriToggle')?.classList.toggle('is-active', calendarState.primary === 'hijri');
    document.querySelectorAll('[data-calendar-offset]').forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.calendarOffset) === calendarState.offset);
    });

    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 42; index += 1) {
      const date = shiftDate(gridStart, index);
      const hijri = hijriParts(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dual-calendar-day';
      button.dataset.date = dateKey(date);
      button.setAttribute('role', 'gridcell');
      button.setAttribute('aria-label', `${fullGregorianFormatter.format(date)}, ${formatHijri(date, true)}`);
      const isOutside = calendarState.primary === 'hijri'
        ? hijriMonthKey(date) !== period.key
        : date.getMonth() !== month || date.getFullYear() !== year;
      button.classList.toggle('is-outside', isOutside);
      button.classList.toggle('is-today', sameDate(date, today));
      button.classList.toggle('is-selected', sameDate(date, calendarState.selectedDate));
      button.classList.toggle('is-hijri-primary', calendarState.primary === 'hijri');
      button.innerHTML = `<span class="calendar-gregorian-number">${date.getDate()}</span><span class="calendar-hijri-number">${hijri.day}</span>`;
      button.addEventListener('click', () => {
        calendarState.selectedDate = date;
        if (isOutside) {
          calendarState.viewDate = calendarState.primary === 'hijri'
            ? normalizeDate(date)
            : localNoon(date.getFullYear(), date.getMonth(), 1);
        }
        renderCalendar();
      });
      fragment.appendChild(button);
    }
    grid.replaceChildren(fragment);
    renderHolidayNote(period, calendarState.primary === 'hijri' ? hijriTitle : gregorianTitle);
  }

  function openDualCalendar(primary) {
    if (primary === 'gregorian' || primary === 'hijri') calendarState.primary = primary;
    window.localStorage.setItem(primaryStorageKey, calendarState.primary);
    setActivePage('calendar', 'calendar');
    renderCalendar();
  }

  function setCalendarPrimary(primary) {
    calendarState.primary = primary === 'hijri' ? 'hijri' : 'gregorian';
    calendarState.viewDate = calendarState.primary === 'hijri'
      ? normalizeDate(calendarState.selectedDate)
      : localNoon(calendarState.selectedDate.getFullYear(), calendarState.selectedDate.getMonth(), 1);
    window.localStorage.setItem(primaryStorageKey, calendarState.primary);
    renderCalendar();
  }

  function changeCalendarMonth(amount) {
    const direction = Number(amount || 0) < 0 ? -1 : 1;
    if (calendarState.primary === 'hijri') {
      const period = hijriPeriod(calendarState.viewDate);
      calendarState.viewDate = direction < 0 ? shiftDate(period.first, -1) : shiftDate(period.last, 1);
    } else {
      calendarState.viewDate = localNoon(
        calendarState.viewDate.getFullYear(),
        calendarState.viewDate.getMonth() + direction,
        1
      );
    }
    renderCalendar();
  }

  function goToCalendarToday() {
    calendarState.selectedDate = today;
    calendarState.viewDate = calendarState.primary === 'hijri'
      ? today
      : localNoon(today.getFullYear(), today.getMonth(), 1);
    renderCalendar();
  }

  function setHijriCalendarOffset(offset) {
    calendarState.offset = Math.max(-1, Math.min(1, Number(offset) || 0));
    window.localStorage.setItem(offsetStorageKey, String(calendarState.offset));
    renderCalendar();
  }

  window.openDualCalendar = openDualCalendar;
  window.setCalendarPrimary = setCalendarPrimary;
  window.changeCalendarMonth = changeCalendarMonth;
  window.goToCalendarToday = goToCalendarToday;
  window.setHijriCalendarOffset = setHijriCalendarOffset;
  renderCalendar();
})();
