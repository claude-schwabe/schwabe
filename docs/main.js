/* schwabe docs — copy-to-clipboard, no dependencies. */
(function () {
  "use strict";

  function flash(btn, ok) {
    var prev = btn.textContent;
    btn.textContent = ok ? "Copied ✓" : "Copy ⌘C";
    btn.classList.toggle("copied", ok);
    setTimeout(function () {
      btn.textContent = prev;
      btn.classList.remove("copied");
    }, 1600);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback for older / insecure contexts.
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("execCommand failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  document.querySelectorAll(".copy-btn[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      copyText(btn.getAttribute("data-copy")).then(
        function () { flash(btn, true); },
        function () { flash(btn, false); }
      );
    });
  });
})();
