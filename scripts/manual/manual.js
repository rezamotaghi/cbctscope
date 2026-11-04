// The manual's search box (scripts/manual-html.mjs): filters search-index.json, a file next
// to this one, in the page. Same origin, fetched once on the first keystroke; nothing else
// leaves the page and nothing is sent anywhere.
(function () {
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
        var href = page.p + (e.id ? '#' + e.id : '');
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
})();
