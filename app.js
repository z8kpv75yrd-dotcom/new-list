/* ============================================================
   Вишлист на GitHub Pages
   Данные лежат в items.json в репозитории. Страница читает их
   напрямую через GitHub API, поэтому изменения видны по той же
   ссылке сразу, без пересборки сайта.
   ============================================================ */
(function () {
  'use strict';

  // --- Настройки -------------------------------------------------------
  // Обычно ничего менять не нужно: репозиторий определяется по адресу
  // https://ВАШ-ЛОГИН.github.io/НАЗВАНИЕ-РЕПОЗИТОРИЯ/
  // Если сайт открывается на своём домене — впишите repo: 'логин/репозиторий'.
  var CONFIG = {
    repo: '',          // 'логин/репозиторий' (необязательно)
    branch: 'main',    // ветка, где лежит items.json
    file: 'items.json',
    pollSeconds: 120   // как часто проверять обновления, пока вкладка открыта
  };

  var TOKEN_KEY = 'wishlist_gh_token';
  var API = 'https://api.github.com';

  var $ = function (id) { return document.getElementById(id); };
  var state = { data: { title: 'Вишлист', owner: '', description: '', updatedAt: '', items: [] },
                admin: false, etag: '', loadedFrom: '' };

  // --- Утилиты ---------------------------------------------------------
  function detectRepo() {
    if (CONFIG.repo) return CONFIG.repo;
    var q = new URLSearchParams(location.search).get('repo');
    if (q && /^[\w.-]+\/[\w.-]+$/.test(q)) return q;
    var m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
    if (m) {
      var seg = location.pathname.split('/').filter(Boolean)[0];
      return m[1] + '/' + (seg || (m[1] + '.github.io'));
    }
    return '';
  }
  var REPO = detectRepo();

  function safeUrl(u) {
    if (!u) return '';
    try {
      var x = new URL(String(u).trim());
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '';
    } catch (e) { return ''; }
  }
  function el(tag, props, children) {
    var n = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function fmtPrice(p, cur) {
    if (p === '' || p == null || isNaN(Number(p))) return '';
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(p)) + ' ' + (cur || '₽');
  }
  var toastTimer;
  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function b64decode(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    var items = Array.isArray(d.items) ? d.items : (Array.isArray(d) ? d : []);
    return {
      title: String(d.title || 'Вишлист'),
      owner: String(d.owner || ''),
      description: String(d.description || ''),
      updatedAt: String(d.updatedAt || ''),
      eventName: String(d.eventName || ''),
      eventDate: /^\d{4}-\d{2}-\d{2}$/.test(String(d.eventDate || '')) ? String(d.eventDate) : '',
      items: items.filter(function (i) { return i && i.title; }).map(function (i) {
        return {
          id: String(i.id || uid()),
          title: String(i.title),
          url: String(i.url || ''),
          image: String(i.image || ''),
          price: (i.price === '' || i.price == null || isNaN(Number(i.price))) ? '' : Number(i.price),
          currency: String(i.currency || '₽'),
          category: String(i.category || ''),
          priority: [1, 2, 3].indexOf(Number(i.priority)) >= 0 ? Number(i.priority) : 2,
          note: String(i.note || ''),
          reserved: !!i.reserved,
          addedAt: String(i.addedAt || '')
        };
      })
    };
  }

  // --- Загрузка данных -------------------------------------------------
  function token() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }

  function ghHeaders(extra) {
    var h = { 'Accept': 'application/vnd.github+json' };
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }

  // Свежие данные напрямую из репозитория (без задержки сборки Pages).
  function fetchFromApi() {
    var url = API + '/repos/' + REPO + '/contents/' + CONFIG.file + '?ref=' + encodeURIComponent(CONFIG.branch);
    var h = ghHeaders({ 'Accept': 'application/vnd.github.raw+json' });
    if (state.etag) h['If-None-Match'] = state.etag;
    return fetch(url, { headers: h, cache: 'no-store' }).then(function (r) {
      if (r.status === 304) return null;
      if (!r.ok) throw new Error('api ' + r.status);
      state.etag = r.headers.get('ETag') || '';
      return r.text();
    }).then(function (txt) { return txt == null ? null : normalize(JSON.parse(txt)); });
  }
  // Запасной вариант: файл с самого сайта (обновляется после сборки Pages).
  function fetchFromSite() {
    return fetch(CONFIG.file + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('site ' + r.status);
      return r.json();
    }).then(normalize);
  }

  function load(silent) {
    var p = REPO ? fetchFromApi().then(function (d) { state.loadedFrom = 'api'; return d; })
                     .catch(function () { state.etag = ''; return fetchFromSite().then(function (d) { state.loadedFrom = 'site'; return d; }); })
                 : fetchFromSite().then(function (d) { state.loadedFrom = 'site'; return d; });
    return p.then(function (d) {
      if (d) { state.data = d; render(); }
    }).catch(function () {
      if (!silent) {
        $('empty').hidden = false;
        $('empty').innerHTML = '';
        $('empty').appendChild(el('div', { class: 'big', text: '😕' }));
        $('empty').appendChild(el('p', { text: 'Не удалось загрузить список. Проверьте, что в репозитории есть файл items.json.' }));
      }
    });
  }

  // --- Отрисовка -------------------------------------------------------
  function render() {
    var d = state.data;
    document.title = d.title + (d.owner ? ' — ' + d.owner : '');
    $('title').textContent = d.title;
    $('owner').hidden = !d.owner; $('owner').textContent = d.owner ? 'Вишлист · ' + d.owner : '';
    $('desc').hidden = !d.description; $('desc').textContent = d.description;
    $('updated').textContent = d.updatedAt ? 'Обновлено: ' + new Date(d.updatedAt).toLocaleString('ru-RU', { dateStyle: 'long', timeStyle: 'short' }) : '';
    if (REPO) { $('repoLink').hidden = false; $('repoLink').href = 'https://github.com/' + REPO; }

    // категории
    var cats = {};
    d.items.forEach(function (i) { if (i.category) cats[i.category] = 1; });
    var sel = $('catFilter'), cur = sel.value;
    sel.innerHTML = '';
    sel.appendChild(el('option', { value: '', text: 'Все категории' }));
    Object.keys(cats).sort().forEach(function (c) { sel.appendChild(el('option', { value: c, text: c })); });
    sel.value = cats[cur] ? cur : '';
    var dl = $('catList'); dl.innerHTML = '';
    Object.keys(cats).forEach(function (c) { dl.appendChild(el('option', { value: c })); });

    var q = $('search').value.trim().toLowerCase();
    var cat = sel.value, hide = $('hideReserved').checked, sort = $('sort').value;
    var list = d.items.filter(function (i) {
      if (cat && i.category !== cat) return false;
      if (hide && i.reserved) return false;
      if (q && (i.title + ' ' + i.note + ' ' + i.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (sort === 'price-asc') return (a.price === '' ? 1e15 : a.price) - (b.price === '' ? 1e15 : b.price);
      if (sort === 'price-desc') return (b.price === '' ? -1 : b.price) - (a.price === '' ? -1 : a.price);
      if (sort === 'new') return String(b.addedAt).localeCompare(String(a.addedAt));
      return a.priority - b.priority || String(b.addedAt).localeCompare(String(a.addedAt));
    });

    var total = d.items.length, given = d.items.filter(function (i) { return i.reserved; }).length;
    $('progress').hidden = !total;
    $('stats').innerHTML = '';
    if (total) {
      $('stats').appendChild(document.createTextNode('Подарено '));
      $('stats').appendChild(el('b', { text: given + ' из ' + total }));
      $('stats').appendChild(document.createTextNode(' · осталось ' + (total - given)));
    }
    $('progBar').style.width = total ? Math.round(given / total * 100) + '%' : '0';
    tick();

    var grid = $('grid'); grid.innerHTML = '';
    list.forEach(function (i) { grid.appendChild(card(i)); });

    var empty = $('empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      empty.innerHTML = '';
      empty.appendChild(el('div', { class: 'big', text: total ? '🔍' : '🎁' }));
      empty.appendChild(el('p', { text: total ? 'Ничего не найдено — измените фильтры.' : (state.admin ? 'Список пуст. Нажмите «+ Добавить».' : 'Список пока пуст.') }));
    }
  }

  // Обратный отсчёт до события
  function tick() {
    var d = state.data, box = $('countdown');
    if (!d.eventDate) { box.hidden = true; return; }
    var p = d.eventDate.split('-').map(Number);
    var target = new Date(p[0], p[1] - 1, p[2], 0, 0, 0);
    var now = new Date(), diff = target - now;
    var endOfDay = new Date(p[0], p[1] - 1, p[2], 23, 59, 59);
    if (now > endOfDay) { box.hidden = true; return; }
    box.hidden = false;
    $('cdLabel').textContent = d.eventName ? 'До события «' + d.eventName + '» осталось' : 'До события осталось';
    var today = diff <= 0;
    $('cdBoxes').hidden = today;
    $('cdToday').hidden = !today;
    if (today) { $('cdLabel').textContent = d.eventName || 'Событие'; return; }
    var s = Math.floor(diff / 1000);
    $('cdD').textContent = Math.floor(s / 86400);
    $('cdH').textContent = Math.floor(s % 86400 / 3600);
    $('cdM').textContent = Math.floor(s % 3600 / 60);
    $('cdS').textContent = s % 60;
  }
  setInterval(tick, 1000);

  var PRIO = { 1: '🔥 Очень хочу', 2: '⭐ Хочу', 3: '✨ Было бы здорово' };

  function card(i) {
    var pic = el('div', { class: 'pic' });
    var img = safeUrl(i.image);
    if (img) {
      var im = el('img', { src: img, alt: i.title, loading: 'lazy', referrerpolicy: 'no-referrer' });
      im.addEventListener('error', function () { pic.textContent = '🎁'; });
      pic.appendChild(im);
    } else { pic.textContent = '🎁'; }

    var chips = el('div', { class: 'chips' }, [
      el('span', { class: 'chip p' + i.priority, text: PRIO[i.priority] }),
      i.category ? el('span', { class: 'chip', text: i.category }) : null
    ]);
    var body = el('div', { class: 'body' }, [
      el('h3', { text: i.title }),
      i.price !== '' ? el('div', { class: 'price', text: fmtPrice(i.price, i.currency) }) : null,
      chips,
      i.note ? el('p', { class: 'note', text: i.note }) : null
    ]);

    var actions = el('div', { class: 'actions' });
    var link = safeUrl(i.url);
    if (link) actions.appendChild(el('a', { class: 'btn small brown', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть товар' }));
    if (state.admin) {
      var e = el('button', { class: 'btn small', type: 'button', text: 'Изменить' });
      e.addEventListener('click', function () { openEditor(i); });
      var r = el('button', { class: 'btn small', type: 'button', text: i.reserved ? 'Снять бронь' : 'Отметить подаренным' });
      r.addEventListener('click', function () { toggleReserved(i.id); });
      var x = el('button', { class: 'btn small danger', type: 'button', text: 'Удалить' });
      x.addEventListener('click', function () { removeItem(i); });
      actions.appendChild(e); actions.appendChild(r); actions.appendChild(x);
    }
    return el('article', { class: 'card' + (i.reserved ? ' reserved' : '') }, [
      i.reserved ? el('span', { class: 'ribbon', text: '✓ Уже подарено' }) : null,
      pic, body, actions
    ]);
  }

  // --- Запись в репозиторий (режим редактирования) ---------------------
  // Каждая правка: берём свежий файл → применяем изменение → коммитим.
  // Так не теряются правки, сделанные с другого устройства.
  function commit(mutator, message) {
    if (!REPO) return Promise.reject(new Error('Не удалось определить репозиторий'));
    var url = API + '/repos/' + REPO + '/contents/' + CONFIG.file;
    return fetch(url + '?ref=' + encodeURIComponent(CONFIG.branch), { headers: ghHeaders(), cache: 'no-store' })
      .then(function (r) {
        if (r.status === 404) return { sha: undefined, data: normalize({}) };
        if (r.status === 401 || r.status === 403) throw new Error('Нет доступа: проверьте токен');
        if (!r.ok) throw new Error('GitHub ответил ' + r.status);
        return r.json().then(function (j) {
          var txt = j.content ? b64decode(j.content) : '{}';
          return { sha: j.sha, data: normalize(JSON.parse(txt)) };
        });
      })
      .then(function (cur) {
        var next = mutator(cur.data) || cur.data;
        next.updatedAt = new Date().toISOString();
        var body = { message: message, branch: CONFIG.branch, content: b64encode(JSON.stringify(next, null, 2) + '\n') };
        if (cur.sha) body.sha = cur.sha;
        return fetch(url, { method: 'PUT', headers: ghHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
          .then(function (r) {
            if (r.status === 409 || r.status === 422) throw new Error('Файл изменился параллельно — повторите действие');
            if (r.status === 401 || r.status === 403 || r.status === 404) throw new Error('Нет прав на запись: проверьте токен');
            if (!r.ok) throw new Error('Не удалось сохранить (' + r.status + ')');
            return r.json();
          }).then(function () { state.etag = ''; state.data = next; render(); });
      });
  }
  function run(btn, promise, okMsg) {
    if (btn) btn.disabled = true;
    return promise.then(function () { if (okMsg) toast(okMsg); return true; })
      .catch(function (e) { toast(e.message || 'Ошибка', true); return false; })
      .then(function (ok) { if (btn) btn.disabled = false; return ok; });
  }

  function toggleReserved(id) {
    return run(null, commit(function (d) {
      d.items.forEach(function (i) { if (i.id === id) i.reserved = !i.reserved; });
    }, 'Вишлист: изменён статус подарка'), 'Сохранено');
  }
  function removeItem(item) {
    if (!confirm('Удалить «' + item.title + '»?')) return;
    run(null, commit(function (d) {
      d.items = d.items.filter(function (i) { return i.id !== item.id; });
    }, 'Вишлист: удалён «' + item.title.slice(0, 60) + '»'), 'Удалено');
  }

  // --- Диалоги ---------------------------------------------------------
  function openDlg(dlg) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
  function closeDlg(dlg) { if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  document.querySelectorAll('dialog [data-close]').forEach(function (b) {
    b.addEventListener('click', function () { closeDlg(b.closest('dialog')); });
  });

  function openEditor(item) {
    var f = $('editForm'); f.reset();
    $('editTitle').textContent = item ? 'Изменить подарок' : 'Новый подарок';
    f.elements.id.value = item ? item.id : '';
    if (item) {
      ['title', 'url', 'image', 'price', 'currency', 'category', 'priority', 'note'].forEach(function (k) {
        f.elements[k].value = item[k] === undefined ? '' : item[k];
      });
      f.elements.reserved.checked = !!item.reserved;
    }
    openDlg($('editorDlg'));
  }

  $('editForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, g = function (k) { return f.elements[k].value.trim(); };
    var url = g('url'), image = g('image');
    if (url && !safeUrl(url)) return toast('Ссылка на товар должна начинаться с http:// или https://', true);
    if (image && !safeUrl(image)) return toast('Ссылка на картинку должна начинаться с http:// или https://', true);
    var id = g('id');
    var rec = {
      id: id || uid(), title: g('title'), url: url, image: image,
      price: g('price') === '' ? '' : Number(g('price')),
      currency: f.elements.currency.value, category: g('category'),
      priority: Number(f.elements.priority.value), note: g('note'),
      reserved: f.elements.reserved.checked
    };
    var btn = $('editSubmit');
    run(btn, commit(function (d) {
      if (id) {
        d.items = d.items.map(function (i) { return i.id === id ? Object.assign({}, i, rec) : i; });
      } else {
        rec.addedAt = new Date().toISOString();
        d.items.unshift(rec);
      }
    }, (id ? 'Вишлист: изменён «' : 'Вишлист: добавлен «') + rec.title.slice(0, 60) + '»'),
      id ? 'Сохранено' : 'Добавлено').then(function (ok) { if (ok) closeDlg($('editorDlg')); });
  });

  $('settingsForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var t = f.elements.title.value.trim(), o = f.elements.owner.value.trim(), ds = f.elements.description.value.trim();
    var en = f.elements.eventName.value.trim(), ed = f.elements.eventDate.value;
    run($('settingsSubmit'), commit(function (d) { d.title = t || 'Вишлист'; d.owner = o; d.description = ds; d.eventName = en; d.eventDate = ed; },
      'Вишлист: обновлено описание'), 'Сохранено').then(function (ok) { if (ok) closeDlg($('settingsDlg')); });
  });

  // --- Вход / выход ----------------------------------------------------
  function setAdmin(on) {
    state.admin = on;
    $('adminBar').hidden = !on;
    $('adminBtn').textContent = on ? '✏️ Режим редактирования включён' : '🔒 Редактировать';
    render();
  }
  $('adminBtn').addEventListener('click', function () {
    if (state.admin) return window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!REPO) return toast('Редактирование работает на адресе вида логин.github.io/репозиторий', true);
    $('loginErr').hidden = true; $('tokenInput').value = '';
    openDlg($('loginDlg'));
  });
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var t = $('tokenInput').value.trim();
    var btn = $('loginSubmit'); btn.disabled = true;
    fetch(API + '/repos/' + REPO, { headers: { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + t }, cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('Токен не подошёл (' + r.status + ')'); return r.json(); })
      .then(function (j) {
        if (!j.permissions || !j.permissions.push) throw new Error('У токена нет права на запись в этот репозиторий');
        try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
        closeDlg($('loginDlg')); setAdmin(true); toast('Режим редактирования включён');
      })
      .catch(function (e) { $('loginErr').textContent = e.message; $('loginErr').hidden = false; })
      .then(function () { btn.disabled = false; });
  });
  $('logoutBtn').addEventListener('click', function () {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    setAdmin(false); toast('Вы вышли');
  });
  $('addBtn').addEventListener('click', function () { openEditor(null); });
  $('settingsBtn').addEventListener('click', function () {
    var f = $('settingsForm');
    f.elements.title.value = state.data.title; f.elements.owner.value = state.data.owner;
    f.elements.description.value = state.data.description;
    f.elements.eventName.value = state.data.eventName; f.elements.eventDate.value = state.data.eventDate;
    openDlg($('settingsDlg'));
  });

  // --- Поделиться ------------------------------------------------------
  $('shareBtn').addEventListener('click', function () {
    var url = location.origin + location.pathname;
    if (navigator.share) {
      navigator.share({ title: state.data.title, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована'); }, function () { toast(url); });
    } else { toast(url); }
  });

  ['search', 'catFilter', 'sort', 'hideReserved'].forEach(function (id) {
    $(id).addEventListener(id === 'search' ? 'input' : 'change', render);
  });

  // --- Кнопка «Наверх» -------------------------------------------------
  window.addEventListener('scroll', function () {
    $('toTop').classList.toggle('show', window.scrollY > 500);
  }, { passive: true });
  $('toTop').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });

  // --- Автообновление --------------------------------------------------
  var polling;
  function startPolling() {
    clearInterval(polling);
    polling = setInterval(function () {
      if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) load(true);
    }, CONFIG.pollSeconds * 1000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) load(true);
  });

  // --- Старт -----------------------------------------------------------
  if (token() && REPO) setAdmin(true);
  load(false).then(startPolling);
})();
