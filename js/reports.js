// ============================================================================
// reports.js — Master report: filters, results table, image/video viewer,
// Excel export. Matches the original Portal's full column and filter set.
// ============================================================================

const RPT = { allFCs: [], allClients: [], data: [], currentViewerRow: null };

async function loadReportFilters() {
  const fcResult = await api("getAccessibleFCs", {});
  if (fcResult.success) {
    RPT.allFCs = fcResult.data;
    document.getElementById("list-fc").innerHTML = fcResult.data.map(f =>
      `<label class="checkbox-item"><input type="checkbox" class="rf-check rf-fc" value="${f.fc_id}" data-code="${f.fc_code}" onchange="onFilterCheck(this,'fc')"> ${f.fc_code} — ${f.fc_name}</label>`
    ).join("");
  }

  const clientResult = await api("getAccessibleClients", {});
  if (clientResult.success) {
    RPT.allClients = clientResult.data;
    renderClientCheckboxes(clientResult.data);
  }
}

function renderClientCheckboxes(clients) {
  document.getElementById("list-client").innerHTML = clients.map(c =>
    `<label class="checkbox-item"><input type="checkbox" class="rf-check rf-client" value="${c.client_id}" onchange="onFilterCheck(this,'client')"> ${c.client_code} — ${c.client_name}</label>`
  ).join("");
  updateFilterBadge("client");
}

function toggleFilterSection(id) {
  document.getElementById(id).classList.toggle("collapsed");
}

function onFilterCheck(el, group) {
  if (el.value === "ALL") {
    if (el.checked) document.querySelectorAll(".rf-" + group).forEach(cb => { if (cb.value !== "ALL") cb.checked = false; });
  } else if (el.checked) {
    const allCb = document.querySelector('.rf-' + group + '[value="ALL"]');
    if (allCb) allCb.checked = false;
  }
  updateFilterBadge(group);
  if (group === "fc") updateClientFilterList();
}

function updateFilterBadge(group) {
  const count = document.querySelectorAll(".rf-" + group + ":checked").length;
  const badge = document.getElementById("badge-" + group);
  if (badge) badge.textContent = count;
}

function selectAllFilter(group) {
  document.querySelectorAll(".rf-" + group).forEach(cb => cb.checked = true);
  updateFilterBadge(group);
  if (group === "fc") updateClientFilterList();
}

function clearAllFilter(group) {
  document.querySelectorAll(".rf-" + group).forEach(cb => cb.checked = false);
  updateFilterBadge(group);
  if (group === "fc") updateClientFilterList();
}

async function updateClientFilterList() {
  const checkedFCs = Array.from(document.querySelectorAll(".rf-fc:checked"));
  const previouslyChecked = new Set(Array.from(document.querySelectorAll(".rf-client:checked")).map(c => c.value));

  let clients;
  if (checkedFCs.length === 0) {
    clients = RPT.allClients;
  } else {
    const seen = {};
    for (const cb of checkedFCs) {
      const r = await api("getClientsByFC", { fcCode: cb.dataset.code });
      if (r.success) r.data.forEach(c => { seen[c.client_id] = c; });
    }
    clients = Object.values(seen);
  }

  document.getElementById("list-client").innerHTML = clients.map(c =>
    `<label class="checkbox-item"><input type="checkbox" class="rf-check rf-client" value="${c.client_id}" ${previouslyChecked.has(c.client_id) ? "checked" : ""} onchange="onFilterCheck(this,'client')"> ${c.client_code} — ${c.client_name}</label>`
  ).join("") || '<div style="padding:16px; text-align:center; color:var(--text-muted); font-size:11px;">No clients for selected FCs</div>';
  updateFilterBadge("client");
}

document.getElementById("generateReportBtn").addEventListener("click", async function () {
  const documentId = document.getElementById("reportDocumentId").value.trim().toUpperCase();
  const dateFrom = document.getElementById("reportDateFrom").value;
  const dateTo = document.getElementById("reportDateTo").value;

  if (!documentId) {
    if (!dateFrom || !dateTo) { toast("Enter a document ID or select a date range.", "error"); return; }
    if (new Date(dateFrom) > new Date(dateTo)) { toast("Date from cannot be after date to.", "error"); return; }
  }

  const fcIds = Array.from(document.querySelectorAll(".rf-fc:checked")).map(c => c.value);
  const clientIds = Array.from(document.querySelectorAll(".rf-client:checked")).map(c => c.value);
  const qcStatuses = Array.from(document.querySelectorAll(".rf-qcStatus:checked")).map(c => c.value).filter(v => v !== "ALL");
  const qcReadyChecked = Array.from(document.querySelectorAll(".rf-qcReady:checked")).map(c => c.value);
  const returnTypes = Array.from(document.querySelectorAll(".rf-returnType:checked")).map(c => c.value).filter(v => v !== "ALL");

  const btn = this;
  btn.disabled = true;

  const r = await api("getReportData", {
    documentId: documentId || null,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    fcIds: fcIds.length ? fcIds : null,
    clientIds: clientIds.length ? clientIds : null,
    qcStatuses: qcStatuses.length ? qcStatuses : null,
    returnTypes: returnTypes.length ? returnTypes : null
  });

  btn.disabled = false;

  if (!r.success) { toast(r.error, "error"); return; }

  let rows = r.data.rows;
  // QC Ready Tag filter is applied client-side, same as the original —
  // it's not part of the backend request.
  const qcReadyValues = qcReadyChecked.filter(v => v !== "ALL");
  if (qcReadyValues.length && !qcReadyChecked.includes("ALL")) {
    rows = rows.filter(row => qcReadyValues.includes(row.qc_ready_tag || "N"));
  }

  RPT.data = rows;
  renderReportTable(rows);
  document.getElementById("reportRowCount").textContent = rows.length;
  document.getElementById("reportResultsCard").classList.remove("hidden");
  document.getElementById("exportReportBtn").disabled = rows.length === 0;
  toast(rows.length ? "Found " + rows.length + " records." : "No data found for these filters.", rows.length ? "success" : "error");
});

function formatDateDisplay(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = ("0" + d.getDate()).slice(-2), month = months[d.getMonth()], year = d.getFullYear();
  const h = ("0" + d.getHours()).slice(-2), m = ("0" + d.getMinutes()).slice(-2), s = ("0" + d.getSeconds()).slice(-2);
  if (h === "00" && m === "00" && s === "00") return day + "-" + month + "-" + year;
  return day + "-" + month + "-" + year + " " + h + ":" + m + ":" + s;
}

function esc(v) { if (v === null || v === undefined) return ""; return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function renderReportTable(rows) {
  const tbody = document.getElementById("reportTableBody");
  if (!rows.length) { tbody.innerHTML = '<tr><td colspan="27" style="text-align:center; padding:20px; color:var(--text-secondary);">No data found</td></tr>'; return; }

  tbody.innerHTML = rows.map(function (row, idx) {
    const qcClass = row.qc_status === "GOOD" ? "status-good" : (row.qc_status === "BAD" ? "status-bad" : "status-pending");
    const hasImages = row.images && row.images.length > 0;
    const imageBtn = hasImages
      ? `<button class="btn btn-secondary" style="min-height:26px; padding:4px 10px; font-size:11px;" onclick="openImageViewer(${idx})">📷 ${row.images.length}</button>`
      : '<span style="color:var(--text-muted); font-size:11px;">-</span>';
    const qcReadyColor = row.qc_ready_tag === "Y" ? "var(--success)" : "var(--danger)";

    return `<tr>
      <td>${esc(row.document_id)}</td><td>${formatDateDisplay(row.shipment_report_date)}</td><td>${formatDateDisplay(row.shipment_received_date)}</td>
      <td>${formatDateDisplay(row.tracking_id_timestamp)}</td><td>${esc(row.fc_code)}</td><td>${esc(row.client_code)}</td>
      <td>${esc(row.marketplace_name)}</td><td>${esc(row.logistics_partner)}</td><td>${esc(row.vehicle_number)}</td>
      <td>${esc(row.claimed_shipment_count)}</td><td>${esc(row.actual_received_count)}</td><td>${esc(row.tracking_id)}</td>
      <td>${esc(row.order_id)}</td><td>${esc(row.return_type)}</td>
      <td style="font-weight:700; color:${qcReadyColor};">${row.qc_ready_tag || "N"}</td>
      <td class="${qcClass}">${esc(row.qc_status)}</td><td>${esc(row.marketplace_damage_tag)}</td>
      <td>${formatDateDisplay(row.qc_completed_at)}</td><td>${esc(row.qc_by_name)}</td><td>${esc(row.ticket_id)}</td>
      <td>${esc(row.claim_status)}</td><td>${esc(row.reimbursement_amount)}</td><td>${esc(row.shipment_status)}</td>
      <td>${imageBtn}</td>
      <td>${row.video_url ? `<a href="${row.video_url}" target="_blank" class="report-link">🎥 View</a>` : '<span style="color:var(--text-muted); font-size:11px;">-</span>'}</td>
      <td>${esc(row.damage_summary)}</td>
      <td>${row.pod_url ? `<a href="${row.pod_url}" target="_blank" class="report-link">📄 POD</a>` : '<span style="color:var(--text-muted); font-size:11px;">-</span>'}</td>
    </tr>`;
  }).join("");
}

function formatImageType(type) {
  const map = { LABEL:"Label", BOX_TOP:"Box top", BOX_FRONT:"Box front", BOX_LEFT:"Box left", BOX_RIGHT:"Box right",
    BOX_DAMAGE:"Box damage", BOX_LABEL:"Box label", PROD_TOP:"Product top", PROD_FRONT:"Product front",
    PROD_LEFT:"Product left", PROD_RIGHT:"Product right", PROD_DAMAGE:"Product damage", PROD_LABEL:"Product label", POD:"POD" };
  return map[type] || (type || "").replace(/_/g, " ");
}

function openImageViewer(idx) {
  const row = RPT.data[idx];
  if (!row || !row.images || !row.images.length) { toast("No images available.", "error"); return; }
  RPT.currentViewerRow = row;
  document.getElementById("imageViewerTitle").textContent = row.tracking_id + " · " + row.document_id;
  document.getElementById("imageViewerList").innerHTML = row.images.map((img, i) =>
    `<div class="image-viewer-row"><span>${i + 1}. ${formatImageType(img.type)}</span><a href="${img.url}" target="_blank" class="report-link">Open</a></div>`
  ).join("");
  document.getElementById("imageViewerModal").classList.remove("hidden");
}
document.getElementById("closeImageViewerBtn").addEventListener("click", function () {
  document.getElementById("imageViewerModal").classList.add("hidden");
});
document.getElementById("downloadAllImagesBtn").addEventListener("click", async function () {
  const row = RPT.currentViewerRow;
  if (!row) return;
  const btn = this;
  btn.disabled = true;
  const r = await api("createImageFolder", { trackingId: row.tracking_id, documentId: row.document_id });
  btn.disabled = false;
  if (!r.success) { toast(r.error || "Couldn't create download.", "error"); return; }

  const byteChars = atob(r.data.base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = r.data.fileName;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast("Downloading " + r.data.imageCount + " images…", "success");
});

document.getElementById("exportReportBtn").addEventListener("click", async function () {
  if (!RPT.data.length) { toast("No data to export.", "error"); return; }
  const btn = this;
  btn.disabled = true;
  const r = await api("exportReport", { rows: RPT.data });
  btn.disabled = false;
  if (r.success) {
    toast("Export ready — " + r.data.rowCount + " rows.", "success");
    window.open(r.data.downloadUrl, "_blank");
  } else {
    toast(r.error, "error");
  }
});

document.getElementById("clearReportFiltersBtn").addEventListener("click", function () {
  document.getElementById("reportDocumentId").value = "";
  document.getElementById("reportDateFrom").value = "";
  document.getElementById("reportDateTo").value = "";
  document.querySelectorAll(".rf-fc, .rf-client").forEach(cb => cb.checked = false);
  ["qcStatus","qcReady","returnType"].forEach(function (g) {
    document.querySelectorAll(".rf-" + g).forEach(cb => cb.checked = (cb.value === "ALL"));
    updateFilterBadge(g);
  });
  updateFilterBadge("fc"); updateFilterBadge("client");
  updateClientFilterList();
  document.getElementById("reportResultsCard").classList.add("hidden");
  document.getElementById("exportReportBtn").disabled = true;
  RPT.data = [];
});
