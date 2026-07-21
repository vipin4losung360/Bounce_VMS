// ============================================================================
// nav.js — sidebar page switching. Each nav-item's data-page attribute maps
// to a #page-<name> div. Only "receive" has real content right now; the
// rest are placeholders until we build them in later steps.
// ============================================================================

document.querySelectorAll(".nav-item").forEach(function (item) {
  item.addEventListener("click", function () {
    const target = item.dataset.page;
    const leavingQCMidSession = document.getElementById("page-qc").classList.contains("active")
      && target !== "qc" && typeof QC !== "undefined" && QC.stream;

    if (leavingQCMidSession) {
      if (!confirm("QC recording is still in progress. Leaving now discards it. Continue?")) return;
      stopCameraHard();
      resetQCState();
      document.getElementById("qcFormCard").classList.add("hidden");
      document.getElementById("qcScanCard").classList.remove("hidden");
    }

    document.querySelectorAll(".nav-item").forEach(function (n) { n.classList.remove("active"); });
    item.classList.add("active");

    document.querySelectorAll(".page").forEach(function (p) { p.classList.remove("active"); });
    document.getElementById("page-" + target).classList.add("active");

    if (target === "receive") loadActiveShipments();
    if (target === "users") loadUsers();
  });
});
