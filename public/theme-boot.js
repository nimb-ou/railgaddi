// Day or night, before the first paint (a night visitor shouldn't see a flash of day). Tiny and
// synchronous on purpose; the app takes over from here.
try {
  var t = localStorage.getItem("railgaddi.theme");
  if (t === "day" || t === "night") document.documentElement.setAttribute("data-theme", t);
} catch (e) {
  /* storage blocked: day */
}
