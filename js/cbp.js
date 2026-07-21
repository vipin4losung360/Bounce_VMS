// ============================================================================
// cbp.js — Cancelled Before Pickup upload screen.
// ============================================================================

const CBP = { data: null, fcs: [] };

async function loadCBPPage() {
  const r = await api("getFulfillmentCenters", {});
  if (r.success) {
    CBP.fcs = r.data;
    document.getElementById("cbpFC").innerHTML = '<option value="">Select FC</option>' +
      r.data.map(f => `<option value="${f.fc_id}" data-code="${f.fc_code}">${f.fc_code} — ${f.fc_name}</option>`).join("");
  }
}

document.getElementById("cbpFC").addEventListener("change", async function () {
  const clientSel = document.getElementById("cbpClient");
  const mpSel = document.getElementById("cbpMarketplace");
  clientSel.innerHTML = '<option value="">Select client</option>'; clientSel.disabled = true;
  mpSel.innerHTML = '<option value="">Select marketplace</option>'; mpSel.disabled = true;
  if (!this.value) return;

  const fcCode = this.options[this.selectedIndex].dataset.code;
  const r = await api("getClientsByFC", { fcCode: fcCode });
  if (r.success && r.data.length) {
    clientSel.innerHTML = '<option value="">Select client</option>' +
      r.data.map(c => `<option value="${c.client_id}" data-code="${c.client_code}">${c.client_code} — ${c.client_name}</option>`).join("");
    clientSel.disabled = false;
  } else {
    toast("No clients mapped to this FC.", "error");
  }
});

document.getElementById("cbpClient").addEventListener("change", async function () {
  const fcSel = document.getElementById("cbpFC");
  const mpSel = document.getElementById("cbpMarketplace");
  mpSel.innerHTML = '<option value="">Select marketplace</option>'; mpSel.disabled = true;
  if (!this.value || !fcSel.value) return;

  const fcCode = fcSel.options[fcSel.selectedIndex].dataset.code;
  const clientCode = this.options[this.selectedIndex].dataset.code;
  const r = await api("getMarketplacesByFCClient", { fcCode: fcCode, clientCode: clientCode });
  if (r.success && r.data.length) {
    mpSel.innerHTML = '<option value="">Select marketplace</option>' +
      r.data.map(m => `<option value="${m.marketplace_id}">${m.marketplace_code} — ${m.marketplace_name}</option>`).join("");
    mpSel.disabled = false;
  }
});

document.getElementById("cbpFileInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (ev) {
    const lines = ev.target.result.split("\n").filter(l => l.trim());
    if (lines.length < 2) { toast("CSV must have a header row and at least one data row.", "error"); return; }

    const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/['"]/g, ""));
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map(v => v.trim().replace(/['"]/g, ""));
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
      if (row.tracking_id) rows.push(row);
    }
    if (rows.length === 0) { toast("No valid rows found in the CSV.", "error"); return; }

    CBP.data = rows;
    const uniqueTracking = new Set(rows.map(r => r.tracking_id.toUpperCase())).size;

    document.getElementById("cbpPreview").classList.remove("hidden");
    document.getElementById("cbpPreviewText").innerHTML =
      `<strong>${uniqueTracking}</strong> unique tracking IDs · <strong>${rows.length}</strong> total line items` +
      `<table class="preview-table"><tr><th>Tracking ID</th><th>Order ID</th><th>SKU</th><th>Qty</th></tr>` +
      rows.slice(0, 5).map(r => `<tr><td>${r.tracking_id}</td><td>${r.order_id || "-"}</td><td>${r.skucode || r.sku_code || "-"}</td><td>${r.quantity || "1"}</td></tr>`).join("") +
      (rows.length > 5 ? `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">…and ${rows.length - 5} more rows</td></tr>` : "") +
      `</table>`;
  };
  reader.readAsText(file);
});

document.getElementById("cbpSubmitBtn").addEventListener("click", async function () {
  const fcId = document.getElementById("cbpFC").value;
  const clientId = document.getElementById("cbpClient").value;
  const marketplaceId = document.getElementById("cbpMarketplace").value;

  if (!fcId || !clientId || !marketplaceId) { toast("Select FC, client, and marketplace.", "error"); return; }
  if (!CBP.data || CBP.data.length === 0) { toast("Upload a CSV file first.", "error"); return; }

  const btn = this;
  btn.disabled = true;

  const r = await api("uploadCBP", {
    csvData: CBP.data,
    fcId: fcId,
    clientId: clientId,
    marketplaceId: marketplaceId,
    userId: window.CURRENT_USER.userId
  });

  btn.disabled = false;

  if (r.success) {
    toast("CBP uploaded — " + r.data.documentId + " (" + r.data.itemCount + " items)" + (r.data.message ? ". " + r.data.message : ""), "success");
    document.getElementById("cbpFC").value = "";
    document.getElementById("cbpClient").innerHTML = '<option value="">Select client</option>';
    document.getElementById("cbpClient").disabled = true;
    document.getElementById("cbpMarketplace").innerHTML = '<option value="">Select marketplace</option>';
    document.getElementById("cbpMarketplace").disabled = true;
    document.getElementById("cbpFileInput").value = "";
    document.getElementById("cbpPreview").classList.add("hidden");
    CBP.data = null;
  } else {
    toast(r.error, "error");
  }
});
