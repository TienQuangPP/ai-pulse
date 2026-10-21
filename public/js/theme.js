// Applied synchronously in <head> so the saved theme is set before first paint (no flash).
// ?theme=dark|light (screenshots / kiosk displays) overrides the saved choice.
(function () {
  var p = new URLSearchParams(location.search).get('theme');
  if (p === 'dark' || p === 'light') localStorage.setItem('aip.theme', p);
  var t = localStorage.getItem('aip.theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
})();
