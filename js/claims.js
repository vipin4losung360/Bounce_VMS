// ============================================================================
// claims.js — Claims summary, chunked CSV upload, error reporting.
// ============================================================================

const CLAIMS_CHUNK_SIZE = 200;
const Claims = { csvData: [], uploadErrors: [] };

async function loadClaimsPage() {
  await refreshClaimsSummary();
  document.getElementById("claimsFileInput").value = "";
  document.getElementById("uploadClaimsBtn").disabled = true;
  document.getElementById("claimsUploadProgress").classList.add("hidden");
  Claims.csvData = [];
}

async function refreshClaimsSummary() {
  const r = await api("getClaimsSummary", {});
  if (!r.success) return;
  document.getElementById("claimsPendingCount").textContent = r.data.pending_claim || 0;
  document.getElementById("claimsInProgressCount").textContent = r.data.in_progress || 0;
  document.getElementById("claimsApprovedCount").textContent = r.data.approved || 0;
  document.getElementById("claimsRejectedCount").textContent = r.data.rejected || 0;
  document.getElementById("claimsTotalReimbursement").textContent =
    (r.data.total_reimbursement || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCSVLine(line) {
  const values = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuotes) { inQuotes = true; }
    else if (ch === '"' && inQuotes) { if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; } }
    else if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  values.push(current.trim());
  return values;
}

document.getElementById("claimsFileInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) { Claims.csvData = []; document.getElementById("uploadClaimsBtn").disabled = true; return; }

  const reader = new FileReader();
  reader.onload = function (ev) {
    const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) { toast("CSV must have a header row and data.", "error"); return; }

    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
    const required = ["tracking_id", "ticket_id", "claim_status", "reimbursement_amount"];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) { toast("Missing columns: " + missing.join(", "), "error"); return; }

    Claims.csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0) continue;
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
      if (row.tracking_id || row.ticket_id) { row._originalRow = i + 1; Claims.csvData.push(row); }
    }
    if (Claims.csvData.length === 0) { toast("No valid data rows found.", "error"); return; }

    document.getElementById("uploadClaimsBtn").disabled = false;
    toast("Loaded " + Claims.csvData.length + " rows.", "success");
  };
  reader.readAsText(file);
});

document.getElementById("uploadClaimsBtn").addEventListener("click", async function () {
  if (Claims.csvData.length === 0) { toast("No data to upload.", "error"); return; }
  Claims.uploadErrors = [];

  const totalChunks = Math.ceil(Claims.csvData.length / CLAIMS_CHUNK_SIZE);
  let processedRows = 0, successful = 0, failed = 0;

  const btn = this;
  btn.disabled = true;
  document.getElementById("claimsUploadProgress").classList.remove("hidden");
  document.getElementById("claimsResultCard").classList.add("hidden");

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CLAIMS_CHUNK_SIZE;
    const chunk = Claims.csvData.slice(start, start + CLAIMS_CHUNK_SIZE);

    const r = await api("uploadClaimsChunk", { rows: chunk, chunkIndex: i + 1, totalChunks: totalChunks });

    if (!r.success) {
      toast("Upload failed at chunk " + (i + 1) + ": " + r.error, "error");
      btn.disabled = false;
      return;
    }

    successful += r.data.successful;
    failed += r.data.failed;
    processedRows += chunk.length;
    if (r.data.errors && r.data.errors.length) Claims.uploadErrors.push(...r.data.errors);

    const pct = Math.round((processedRows / Claims.csvData.length) * 100);
    document.getElementById("claimsProgressBar").style.width = pct + "%";
    document.getElementById("claimsProgressText").textContent =
      "Chunk " + (i + 1) + " of " + totalChunks + " — " + processedRows + "/" + Claims.csvData.length + " rows";

    await new Promise(r => setTimeout(r, 250));
  }

  btn.disabled = false;
  document.getElementById("claimsResultTotal").textContent = Claims.csvData.length;
  document.getElementById("claimsResultSuccess").textContent = successful;
  document.getElementById("claimsResultFailed").textContent = failed;
  document.getElementById("claimsResultCard").classList.remove("hidden");

  if (Claims.uploadErrors.length) {
    document.getElementById("claimsErrorsBody").innerHTML = Claims.uploadErrors.slice(0, 100).map(e =>
      `<tr><td>${e.row}</td><td>${e.tracking_id}</td><td>${e.ticket_id}</td><td>${e.errors.join("; ")}</td></tr>`
    ).join("") + (Claims.uploadErrors.length > 100 ? `<tr><td colspan="4">…and ${Claims.uploadErrors.length - 100} more</td></tr>` : "");
    document.getElementById("claimsErrorsContainer").classList.remove("hidden");
  } else {
    document.getElementById("claimsErrorsContainer").classList.add("hidden");
  }

  toast(successful + " claims uploaded" + (failed ? ", " + failed + " failed" : ""), failed ? "error" : "success");
  refreshClaimsSummary();
});

document.getElementById("downloadClaimsTemplateBtn").addEventListener("click", function () {
  const headers = ["tracking_id", "ticket_id", "claim_status", "reimbursement_amount"];
  const samples = [
    ["ABC123456789", "TKT-2026-001", "In Progress", "0"],
    ["XYZ987654321", "TKT-2026-002", "Approved", "1500.00"],
    ["DEF555555555", "TKT-2026-003", "Rejected", "0"]
  ];
  let csv = headers.join(",") + "\n";
  samples.forEach(row => { csv += row.join(",") + "\n"; });
  downloadTextFile(csv, "claims_template.csv", "text/csv");
});

document.getElementById("downloadClaimsErrorsBtn").addEventListener("click", function () {
  if (Claims.uploadErrors.length === 0) { toast("No errors to download.", "error"); return; }
  let csv = "Row,Tracking ID,Ticket ID,Errors\n";
  Claims.uploadErrors.forEach(e => {
    csv += e.row + ',"' + (e.tracking_id || "").replace(/"/g, '""') + '","' + (e.ticket_id || "").replace(/"/g, '""') + '","' +
      (Array.isArray(e.errors) ? e.errors.join("; ") : String(e.errors || "")).replace(/"/g, '""') + '"\n';
  });
  downloadTextFile(csv, "claims_errors.csv", "text/csv;charset=utf-8;");
});

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}
