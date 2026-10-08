/* ДРЦ «Рябинка» — поведение страницы. Без зависимостей.
   Каждая функция независима: ошибка в одной не ломает другие. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var motionOK = !reduceMotion;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- Дорога и машинка ---------- */
  function initRoad() {
    var rug = $('#rug');
    var svg = $('#road');
    var path = $('#road-path');
    var car = $('#car');
    if (!rug || !svg || !path) return;

    var drawn = $('#road-drawn');
    var points = [];
    var cum = [];          // длина пути до каждой точки
    var sy = [];           // высота прокрутки, на которой машинка проходит точку
    var parkLen = 0;
    var parkIdx = 0;
    var homeLen = 0;       // с этого места машинка съезжает на подъезд домика и едет поверх картинки
    var rugTop = 0;
    var current = null;
    var target = 0;
    var raf = 0;
    var buildRaf = 0;

    function roadWidth() {
      var w = parseFloat(getComputedStyle(rug).getPropertyValue('--road-w'));
      return isFinite(w) && w > 0 ? w : 40;
    }

    function stopIsActive(el) {
      if (!el.getClientRects().length) return false;
      var media = el.getAttribute('data-road-media');
      if (media && window.matchMedia && !window.matchMedia(media).matches) return false;
      return true;
    }

    // minX..maxX — полоса, за которую дорога не выходит: кривая Безье лежит внутри своих опорных точек,
    // поэтому опорные точки зажаты в эту полосу — и сплайн не вылетает за край окна
    function segment(p0, p1, p2, p3, minX, maxX) {
      // Catmull-Rom → кубическая Безье
      var c1x = clamp(p1.x + (p2.x - p0.x) / 6, minX, maxX), c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = clamp(p2.x - (p3.x - p1.x) / 6, minX, maxX), c2y = p2.y - (p3.y - p1.y) / 6;
      return 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
    }

    // положение без учёта transform: анимации появления не сдвигают дорогу
    function box(el) {
      var x = 0, y = 0, e = el;
      while (e && e !== rug) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
      return { left: x, top: y, width: el.offsetWidth, height: el.offsetHeight };
    }

    function build() {
      buildRaf = 0;
      var r = rug.getBoundingClientRect();
      var W = rug.clientWidth;
      var H = rug.offsetHeight;
      var rw = roadWidth();
      var gap = rw / 2 + 22;
      var wrap = $('.wrap', rug);
      var contentLeft = wrap ? box(wrap).left : 16;
      // ось крайней полосы: на телефоне дорога прижата к краю (бордюр по краю окна), на широком — посреди поля
      var lane = Math.max(rw / 2 + 6, contentLeft / 2);
      var minX = lane, maxX = W - lane;
      rugTop = r.top + window.pageYOffset;

      var stops = $$('[data-road-stop]', rug).filter(stopIsActive).map(function (el) {
        var b = box(el);
        var x = b.left + b.width / 2;
        var y = b.top + b.height / 2;
        var laneSide = el.getAttribute('data-road-lane');
        var side = el.getAttribute('data-road-side');
        if (laneSide === 'left') x = lane;
        else if (laneSide === 'right') x = W - lane;
        else if (side === 'left') x = b.left - gap;
        else if (side === 'right') x = b.left + b.width + gap;
        x = clamp(x, minX, maxX);
        return {
          x: x, y: y,
          end: el.hasAttribute('data-road-end'),
          park: el.hasAttribute('data-road-park'),
          tail: el.hasAttribute('data-road-tail') || el.hasAttribute('data-road-end') || el.hasAttribute('data-road-park')
        };
      });
      // хвост (подъезд к домику) идёт в порядке разметки после всех остальных точек
      var list = stops.filter(function (p) { return !p.tail; }).sort(function (a, b) { return a.y - b.y; });
      var tail = stops.filter(function (p) { return p.tail; });

      // точки с почти одинаковой высотой мешают привязке к прокрутке
      points = [];
      list.forEach(function (p) {
        var last = points[points.length - 1];
        if (last && p.y - last.y < 8) { p.y = last.y + 8; }
        points.push(p);
      });
      points = points.concat(tail);
      if (points.length < 2) return;

      var endIdx = points.length - 1;
      for (var q = 0; q < points.length; q++) { if (points[q].end) { endIdx = q; break; } }

      var d = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
      var dd = d;
      var segs = [];
      for (var i = 0; i < points.length - 1; i++) {
        var p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
        var s = segment(p0, p1, p2, p3, minX, maxX);
        segs.push('M' + p1.x.toFixed(1) + ' ' + p1.y.toFixed(1) + s);
        d += s;
        if (i < endIdx) dd += s;
      }
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      path.setAttribute('d', d);
      if (drawn) drawn.setAttribute('d', dd);

      // длины по отрезкам — меряем отдельным путём
      var probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.appendChild(probe);
      cum = [0];
      for (var k = 0; k < segs.length; k++) {
        probe.setAttribute('d', segs[k]);
        cum.push(cum[k] + probe.getTotalLength());
      }
      svg.removeChild(probe);

      parkIdx = points.length - 1;
      for (var j = 0; j < points.length; j++) { if (points[j].park) { parkIdx = j; break; } }
      parkLen = cum[parkIdx];
      homeLen = cum[Math.max(0, endIdx - 1)];

      // высота прокрутки для каждой точки; хвост может идти вверх — ему свой отрезок прокрутки
      sy = [points[0].y];
      for (var k2 = 1; k2 < points.length; k2++) {
        // хвост проходится за короткий отрезок прокрутки: машинка паркуется, пока домик на экране
        sy.push(points[k2].tail
          ? sy[k2 - 1] + clamp((cum[k2] - cum[k2 - 1]) * 0.35, 24, 60)
          : Math.max(points[k2].y, sy[k2 - 1]));
      }

      root.classList.add('road-ready');
      // без движения едущую машинку не ставим: на старте стоит неподвижная .start-car (одна на странице)
      if (!motionOK) return;
      target = targetLength();
      if (current === null) current = target;
      current = clamp(current, 0, parkLen);
      place(current);
      tick();
    }

    function targetLength() {
      var ty = window.pageYOffset + window.innerHeight * 0.62 - rugTop;
      if (ty <= sy[0]) return 0;
      for (var i = 0; i < parkIdx; i++) {
        if (ty < sy[i + 1]) {
          var t = (ty - sy[i]) / Math.max(1, sy[i + 1] - sy[i]);
          return cum[i] + (cum[i + 1] - cum[i]) * t;
        }
      }
      return parkLen;
    }

    function place(len) {
      if (!car) return;
      var total = cum[cum.length - 1] || 0;
      var l = clamp(len, 0, total);
      var p = path.getPointAtLength(l);
      var a = path.getPointAtLength(clamp(l + 3, 0, total));
      var b = path.getPointAtLength(clamp(l - 3, 0, total));
      var ang = Math.atan2(a.y - b.y, a.x - b.x) * 180 / Math.PI;
      car.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + ang.toFixed(1) + 'deg)';
      car.classList.toggle('is-parked', Math.abs(l - parkLen) < 1);
      car.classList.toggle('is-home', l > homeLen + 1);
    }

    function tick() {
      if (raf) return;
      raf = requestAnimationFrame(function step() {
        raf = 0;
        if (document.hidden) return;
        var diff = target - current;
        if (Math.abs(diff) < 0.4) { current = target; place(current); return; }
        current += diff * 0.14;
        place(current);
        raf = requestAnimationFrame(step);
      });
    }

    function schedule() {
      if (buildRaf) return;
      buildRaf = requestAnimationFrame(build);
    }

    if (motionOK) {
      window.addEventListener('scroll', function () {
        if (!points.length) return;
        target = targetLength();
        tick();
      }, { passive: true });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    }
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(rug);
    build();
  }

  /* ---------- Появления по сценам ---------- */
  function initReveals() {
    var els = $$('[data-reveal]');
    if (!els.length) return;
    if (!motionOK || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    els.forEach(function (el) {
      var scene = el.closest('section[data-scene]');
      if (scene) el.setAttribute('data-fx', scene.getAttribute('data-scene'));
      io.observe(el);
    });
    root.classList.add('reveals');
  }

  /* ---------- Всплывающие блоки ---------- */
  function initDialogs() {
    var buttons = $$('button[data-dialog]');
    if (!buttons.length) return;
    var opener = null;
    var pushed = false;
    var skipPop = false;

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dlg = document.getElementById('dialog-' + btn.getAttribute('data-dialog'));
        if (!dlg || dlg.open || typeof dlg.showModal !== 'function') return;
        opener = btn;
        dlg.showModal();
        root.classList.add('is-locked');
        try { history.pushState({ sheet: dlg.id }, ''); pushed = true; } catch (_) { pushed = false; }
      });
    });

    $$('dialog.sheet').forEach(function (dlg) {
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
      $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
      dlg.addEventListener('close', function () {
        root.classList.remove('is-locked');
        if (pushed) {
          pushed = false;
          if (history.state && history.state.sheet === dlg.id) { skipPop = true; history.back(); }
        }
        if (opener) { try { opener.focus({ preventScroll: true }); } catch (_) { opener.focus(); } opener = null; }
      });
    });

    window.addEventListener('popstate', function () {
      if (skipPop) { skipPop = false; return; }
      var open = $('dialog.sheet[open]');
      if (open) { pushed = false; open.close(); }
    });
  }

  /* ---------- Цифры цен: спидометр ---------- */
  function initCounters() {
    var els = $$('[data-count-to]');
    if (!els.length || !motionOK || !('IntersectionObserver' in window)) return;
    function run(el) {
      var to = parseInt(el.getAttribute('data-count-to'), 10) || 0;
      var final = el.getAttribute('data-final') || String(to);
      var t0 = performance.now();
      var dur = 1100;
      function step(t) {
        var p = Math.min(1, (t - t0) / dur);
        var e = 1 - Math.pow(1 - p, 4);
        el.textContent = p < 1 ? String(Math.round(to * e)) : final;
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.6 });
    els.forEach(function (el) {
      var b = el.getBoundingClientRect();
      if (b.top < window.innerHeight && b.bottom > 0) return; // уже на экране — не трогаем
      el.setAttribute('data-final', el.textContent);
      el.textContent = '0';
      io.observe(el);
    });
  }

  /* ---------- Отзывы: карусель (scroll-snap + точки, стрелки, автопрокрутка) ---------- */
  function initReviews() {
    var box = $('.carousel');
    if (!box) return;
    var track = $('.carousel__track', box);
    var dotsBox = $('.carousel__dots', box);
    var prev = $('.carousel__prev', box);
    var next = $('.carousel__next', box);
    var slides = track ? $$('.review', track) : [];
    if (!track || !dotsBox || slides.length < 2) return;

    var stops = [];        // положения прокрутки, до которых лента реально доезжает
    var dots = [];
    var idx = 0;
    var hover = false, focus = false, visible = true, held = false;
    var holdTimer = 0, markRaf = 0;

    function slideLeft(i) { return slides[i].offsetLeft - slides[0].offsetLeft; }

    function renderDots() {
      if (dots.length === stops.length) return;
      dotsBox.textContent = '';
      dots = stops.map(function (_, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'carousel__dot';
        b.setAttribute('aria-label', 'Отзывы: ' + (i + 1) + ' из ' + stops.length);
        b.addEventListener('click', function () { go(i); hold(); });
        dotsBox.appendChild(b);
        return b;
      });
    }

    function measure() {
      var max = track.scrollWidth - track.clientWidth;
      stops = [];
      slides.forEach(function (_, i) {
        var p = Math.min(slideLeft(i), max);
        if (!stops.length || p - stops[stops.length - 1] > 4) stops.push(p);
      });
      renderDots();
      mark();
    }

    function mark() {
      markRaf = 0;
      var x = track.scrollLeft, best = 0, bd = Infinity;
      stops.forEach(function (p, i) { var d = Math.abs(p - x); if (d < bd) { bd = d; best = i; } });
      idx = best;
      dots.forEach(function (d, i) { d.setAttribute('aria-current', i === idx ? 'true' : 'false'); });
    }

    function go(i) {
      if (!stops.length) return;
      i = (i + stops.length) % stops.length;
      track.scrollTo({ left: stops[i], behavior: motionOK ? 'smooth' : 'auto' });
    }

    // касание, стрелка или точка — автопрокрутка ждёт, пока человек читает
    function hold() {
      held = true;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(function () { held = false; }, 12000);
    }

    track.addEventListener('scroll', function () { if (!markRaf) markRaf = requestAnimationFrame(mark); }, { passive: true });
    if (prev) prev.addEventListener('click', function () { go(idx - 1); hold(); });
    if (next) next.addEventListener('click', function () { go(idx + 1); hold(); });
    track.addEventListener('pointerdown', hold, { passive: true });
    track.addEventListener('touchstart', hold, { passive: true });
    track.addEventListener('wheel', hold, { passive: true });
    box.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') hover = true; });
    box.addEventListener('pointerleave', function () { hover = false; });
    box.addEventListener('focusin', function () { focus = true; });
    box.addEventListener('focusout', function (e) { focus = !!(e.relatedTarget && box.contains(e.relatedTarget)); });

    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(track);
    window.addEventListener('load', measure);
    measure();

    if (!motionOK) return; // без автопрокрутки
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { visible = !!(entries[0] && entries[0].isIntersecting); }, { threshold: 0.4 }).observe(track);
    }
    setInterval(function () {
      if (held || hover || focus || !visible || document.hidden) return;
      go(idx + 1);
    }, 6000);
  }

  /* ---------- Живые картинки (анимированный WebP) ----------
     <picture data-live="assets/img/<name>">: в разметке — только первый кадр <name>.webp (без JS страница статична),
     цикл <name>-480/-960.webp ставит JS. data-live-wait="load" (hero) — цикл после события load.
     Остальные — своим IntersectionObserver: до первой прокрутки играют только те, что видны на экране наполовину,
     после неё цикл начинает грузиться, когда до картинки остаётся не больше высоты экрана.
     На телефоне (≤ 719 px) — только -480, при любом DPR. При reduced-motion и saveData — первый кадр. */
  function initLiveImages() {
    var pics = $$('picture[data-live]');
    if (!pics.length) return;
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (reduceMotion || (conn && conn.saveData)) return;
    var narrow = window.matchMedia ? window.matchMedia('(max-width: 719px)') : null;
    var playing = [];

    function loopSet(base) {
      return narrow && narrow.matches ? base + '-480.webp' : base + '-480.webp 480w, ' + base + '-960.webp 960w';
    }

    function play(pic) {
      var base = pic.getAttribute('data-live');
      var source = $('source:not([media])', pic);
      var img = $('img', pic);
      if (!base || !source || !img || pic._live) return;
      pic._live = true;
      function swap() {
        // браузер без WebP показывает .jpg — тогда цикл не нужен
        if (!/\.webp(\?|$)/.test(img.currentSrc || '')) return;
        var sizes = source.getAttribute('sizes') || '100vw';
        var loop = loopSet(base);
        var pre = new Image();
        pre.decoding = 'async';
        pre.sizes = sizes;
        pre.srcset = loop;
        // подмена только когда цикл уже скачан: первый кадр цикла совпадает со статичным, скачка нет
        function apply() {
          source.setAttribute('sizes', sizes);
          source.setAttribute('srcset', loop);
          playing.push(pic);
        }
        if (typeof pre.decode === 'function') pre.decode().then(apply, function () {});
        else pre.onload = apply;
      }
      // первый кадр ещё не скачан (ленивый) — ждём его, чтобы знать, что браузер взял WebP
      if (img.complete && img.currentSrc) swap();
      else img.addEventListener('load', swap, { once: true });
    }

    var lazy = [];
    pics.forEach(function (pic) {
      if (pic.getAttribute('data-live-wait') === 'load') {
        if (document.readyState === 'complete') play(pic);
        else window.addEventListener('load', function () { play(pic); });
      } else lazy.push(pic);
    });

    // поворот экрана через 720 px: телефон переходит на -480, планшет — на набор 480w/960w
    if (narrow) {
      var onNarrow = function () {
        playing.forEach(function (pic) {
          var source = $('source:not([media])', pic);
          if (source) source.setAttribute('srcset', loopSet(pic.getAttribute('data-live')));
        });
      };
      if (narrow.addEventListener) narrow.addEventListener('change', onNarrow);
      else if (narrow.addListener) narrow.addListener(onNarrow);
    }

    if (!lazy.length || !('IntersectionObserver' in window)) return;
    function watch(options) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          play(e.target.parentNode);
        });
      }, options);
      lazy.forEach(function (pic) { if (!pic._live) io.observe($('img', pic)); });
      return io;
    }
    // до прокрутки — только картинки, видимые хотя бы наполовину (первый экран не качает анимаций ниже)
    var first = watch({ threshold: 0.5 });
    function armed() {
      window.removeEventListener('scroll', armed);
      first.disconnect();
      watch({ rootMargin: '100% 0px 100% 0px' });
    }
    // картинка в закрытом <dialog> не видна наблюдателю — оживает, когда окно открыли
    window.addEventListener('scroll', armed, { passive: true });
  }

  /* ---------- Игрушки откатываются от пальца ---------- */
  function initToyNudge() {
    var pile = $('[data-toys]');
    if (!pile || !motionOK) return;
    var toys = $$('.toy', pile);
    if (!toys.length) return;
    var R = 120;
    function push(cx, cy) {
      toys.forEach(function (toy) {
        var body = toy.firstElementChild;
        if (!body) return;
        var b = toy.getBoundingClientRect();
        var dx = b.left + b.width / 2 - cx;
        var dy = b.top + b.height / 2 - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > R || dist < 0.01) return;
        var f = (R - dist) / R;
        var mx = dx / dist * f * 80;
        var my = dy / dist * f * 30;
        body.style.translate = mx.toFixed(1) + 'px ' + my.toFixed(1) + 'px';
        body.style.rotate = (mx * 2.2).toFixed(1) + 'deg';
        clearTimeout(body._back);
        body._back = setTimeout(function () { body.style.translate = ''; body.style.rotate = ''; }, 900);
      });
    }
    pile.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') push(e.clientX, e.clientY); }, { passive: true });
    pile.addEventListener('pointerdown', function (e) { push(e.clientX, e.clientY); }, { passive: true });
    pile.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) push(t.clientX, t.clientY); }, { passive: true });
  }

  /* ---------- Картинки, которых ещё нет: без значка поломки ---------- */
  function initImageFallbacks() {
    $$('img').forEach(function (img) {
      function mark() { img.classList.add('is-missing'); }
      if (img.complete && img.naturalWidth === 0 && img.currentSrc) mark();
      img.addEventListener('error', mark);
      img.addEventListener('load', function () { img.classList.remove('is-missing'); });
    });
  }

  /* ---------- Полоска звонка: после первого экрана сжимается (на широком экране — в столбик у края) ---------- */
  function initDock() {
    var hero = $('.hero');
    if (!hero) return;
    var on = null;
    function update() {
      var next = window.pageYOffset > hero.offsetHeight * 0.55;
      if (next !== on) { on = next; root.classList.toggle('dock-compact', on); }
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function init() {
    [initLiveImages, initImageFallbacks, initReveals, initCounters, initRoad, initDialogs, initReviews, initToyNudge, initDock].forEach(function (fn) {
      try { fn(); } catch (err) { if (window.console && console.warn) console.warn('[rug]', fn.name, err); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
