// The manual's search box (scripts/manual-html.mjs): filters search-index.json, a file next
// to this one, in the page. Same origin, fetched once on the first keystroke; nothing else
// leaves the page and nothing is sent anywhere.
// It also carries the drawer's theme: ?theme=dark marks the page dark before it paints (this
// script loads in <head>, without defer) and keeps the flag on every link to another page of
// the manual, so the drawer stays dark as the reader moves on; there it also drops the bar's
// "Open the viewer" link, since the viewer is already beside the drawer. And the phone-width
// "Contents" button opens and closes the list of chapters.
var DARK = /(?:^|[?&])theme=dark(?:&|$)/.test(location.search);
if (DARK) document.documentElement.classList.add('theme-dark');

/** a manual page address with the drawer's flag kept, the anchor after it */
function keepTheme(href) {
  if (!DARK || /^[a-z]+:|^\/\/|^#/i.test(href) || !/\.html(#|$)/.test(href)) return href;
  var at = href.indexOf('#');
  return at < 0 ? href + '?theme=dark' : href.slice(0, at) + '?theme=dark' + href.slice(at);
}

document.addEventListener('DOMContentLoaded', function () {
  if (DARK) {
    // the drawer sits beside the viewer: a link to it would load a second viewer into the drawer
    var viewer = document.querySelector('.bar .viewer');
    if (viewer) viewer.parentNode.removeChild(viewer);
    Array.prototype.forEach.call(document.querySelectorAll('a[href]'), function (a) {
      a.setAttribute('href', keepTheme(a.getAttribute('href')));
    });
  }
  var toggle = document.querySelector('.toc-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = toggle.parentNode.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
});

document.addEventListener('DOMContentLoaded', function () {
  var input = document.getElementById('q');
  var box = document.getElementById('results');
  if (!input || !box) return;
  var form = input.form;
  if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });

  var index = null;
  var loading = null;
  function load() {
    if (!loading) {
      loading = fetch('search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (j) { index = j; });
    }
    return loading;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** about 160 characters of text around the first match, the match marked */
  function snippet(text, word) {
    var at = text.toLowerCase().indexOf(word);
    if (at < 0) return esc(text.slice(0, 160)) + (text.length > 160 ? ' ...' : '');
    var start = Math.max(0, at - 60);
    var end = Math.min(text.length, at + word.length + 100);
    return (start ? '... ' : '') + esc(text.slice(start, at)) + '<mark>' + esc(text.slice(at, at + word.length)) + '</mark>' +
      esc(text.slice(at + word.length, end)) + (end < text.length ? ' ...' : '');
  }

  function render() {
    var term = input.value.trim().toLowerCase();
    if (!term) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var words = term.split(/\s+/);
    var hits = index.entries.filter(function (e) {
      var hay = (index.pages[e.i].t + ' ' + e.h + ' ' + e.x).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    var shown = hits.slice(0, 50);
    var html = '<p class="count">' + hits.length + (hits.length === 1 ? ' section matches' : ' sections match') + ' "' + esc(input.value.trim()) + '"' +
      (hits.length > shown.length ? ', the first ' + shown.length + ' shown' : '') + '</p>';
    if (shown.length) {
      html += '<ol>' + shown.map(function (e) {
        var page = index.pages[e.i];
        var href = keepTheme(page.p + (e.id ? '#' + e.id : ''));
        var where = page.t === e.h ? page.t : page.t + ': ' + e.h;
        return '<li><a class="where" href="' + esc(href) + '">' + esc(where) + '</a><p>' + snippet(e.x || e.h, words[0]) + '</p></li>';
      }).join('') + '</ol>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  input.addEventListener('input', function () {
    load().then(render, function () {
      box.textContent = 'The search index could not be read.';
      box.hidden = false;
    });
  });
});
