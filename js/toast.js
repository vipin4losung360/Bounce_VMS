// ============================================================================
// toast.js — shared feedback helper, used by every screen from here on.
// ============================================================================

function toast(msg, type) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast " + (type || "info");
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function () { el.remove(); }, 3500);
}
