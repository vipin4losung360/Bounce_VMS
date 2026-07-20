// ============================================================================
// receive.js — New shipment, active shipments, scanning, POD upload.
// Ported 1:1 from the original Portal's logic — same actions, same flow,
// only the transport call (api()) changed underneath.
// ============================================================================

const RS = {
  fcs: [],
  activeShipment: null,
  scannedItems: []
};

async function loadMasterData() {
  const [fcs, partners] = await Promise.all([
    api("getFulfillmentCenters", {}),
    api("getLogisticsPartners", {})
  ]);

  if (fcs.success) {
    RS.fcs = fcs.data;
    document.getElementById("receiveFC").innerHTML =
      '<option value="">Select</option>' + fcs.data.map(f => `<option value="${f.fc_code}">${f.fc_code}</option>`).join("");
  }
  if (partners.success) {
    document.getElementById("receivePartner").innerHTML =
      '<option value="">Select</option>' + partners.data.map(p => `<option value="${p.partner_code}">${p.partner_code}</option>`).join("");
  }

  loadActiveShipments();
}

document.getElementById("receiveFC").addEventListener("change", async function () {
  const fc = this.value;
  const clientSel = document.getElementById("receiveClient");
  const mpSel = document.getElementById("receiveMarketplace");
  clientSel.innerHTML = '<option value="">Select</option>';
  clientSel.disabled = true;
  mpSel.innerHTML = '<option value="">Select</option>';
  mpSel.disabled = true;
  if (!fc) return;

  const r = await api("getClientsByFC", { fcCode: fc });
  if (r.success && r.data.length) {
    clientSel.innerHTML = '<option value="">Select</option>' + r.data.map(c => `<option value="${c.client_code}">${c.client_code}</option>`).join("");
    clientSel.disabled = false;
  } else {
    toast("No clients mapped to this FC.", "error");
  }
});

document.getElementById("receiveClient").addEventListener("change", async function () {
  const fc = document.getElementById("receiveFC").value;
  const client = this.value;
  const mpSel = document.getElementById("receiveMarketplace");
  mpSel.innerHTML = '<option value="">Select</option>';
  mpSel.disabled = true;
  if (!fc || !client) return;

  const r = await api("getMarketplacesByFCClient", { fcCode: fc, clientCode: client });
  if (r.success && r.data.length) {
    mpSel.innerHTML = '<option value="">Select</option>' + r.data.map(m => `<option value="${m.marketplace_code}">${m.marketplace_code}</option>`).join("");
    mpSel.disabled = false;
  }
});

document.getElementById("createShipmentBtn").addEventListener("click", async function () {
  const fc = document.getElementById("receiveFC").value;
  const client = document.getElementById("receiveClient").value;
  const mp = document.getElementById("receiveMarketplace").value;
  const partner = document.getElementById("receivePartner").value;
  const claimed = document.getElementById("receiveClaimed").value;
  const vehicle = document.getElementById("receiveVehicle").value;
  const date = document.getElementById("receiveActualDate").value;
  const time = document.getElementById("receiveActualTime").value;

  if (!fc || !client || !mp || !partner || !claimed || !vehicle || !date || !time) {
    toast("Fill in every field before creating the shipment.", "error");
    return;
  }

  const btn = this;
  btn.disabled = true;

  const r = await api("createShipment", {
    fcCode: fc, clientCode: client, marketplaceCode: mp, partnerCode: partner,
    claimedCount: parseInt(claimed), vehicleNumber: vehicle,
    actualReceivedAt: date + "T" + time + ":00"
  });

  btn.disabled = false;

  if (r.success) {
    toast("Shipment created: " + r.data.documentId, "success");
    ["receiveFC","receiveClient","receiveMarketplace","receivePartner","receiveClaimed","receiveVehicle","receiveActualDate","receiveActualTime"]
      .forEach(id => document.getElementById(id).value = "");
    document.getElementById("receiveClient").innerHTML = '<option value="">Select</option>';
    document.getElementById("receiveClient").disabled = true;
    document.getElementById("receiveMarketplace").innerHTML = '<option value="">Select</option>';
    document.getElementById("receiveMarketplace").disabled = true;
    openScanning(r.data.documentId, r.data.claimedCount, [], false, null);
  } else {
    toast(r.error, "error");
  }
});

async function loadActiveShipments() {
  const r = await api("getActiveShipments", {});
  const list = document.getElementById("activeShipmentsList");
  if (r.success && r.data.length) {
    list.innerHTML = r.data.map(s => {
      const pct = s.claimedCount > 0 ? Math.round((s.scannedCount / s.claimedCount) * 100) : 0;
      return `<div class="shipment-card" onclick="selectShipment('${s.document_id}')">
        <div class="shipment-doc">${s.document_id}${s.needsPOD ? ' <span style="color:var(--danger); font-size:10px;">POD needed</span>' : ''}</div>
        <div class="shipment-meta"><span>${s.fc_code}</span><span>${s.client_code}</span><span>${s.marketplace_code}</span></div>
        <div class="progress-bar" style="margin:8px 0 0;"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">${s.scannedCount}/${s.claimedCount} scanned</div>
      </div>`;
    }).join("");
  } else {
    list.innerHTML = '<div class="empty-state">No active shipments</div>';
  }
}
document.getElementById("refreshShipmentsBtn").addEventListener("click", loadActiveShipments);

async function selectShipment(docId) {
  const r = await api("getShipmentDetails", { documentId: docId });
  if (r.success) {
    openScanning(docId, r.data.claimedCount, r.data.items, r.data.podUploaded, r.data.podUrl);
  } else {
    toast(r.error, "error");
  }
}

function openScanning(docId, claimed, items, podUploaded, podUrl) {
  RS.activeShipment = { documentId: docId, claimedCount: claimed, podUploaded: podUploaded || false, podUrl: podUrl || null };
  RS.scannedItems = items || [];
  document.getElementById("currentDocId").textContent = docId;
  updateCounters();
  renderItems();
  document.getElementById("podFileInput").value = "";
  document.getElementById("podStatus").textContent = podUploaded ? "POD already uploaded — select a file to replace it." : "";
  document.getElementById("newShipmentCard").classList.add("hidden");
  document.getElementById("activeShipmentsCard").classList.add("hidden");
  document.getElementById("scanningCard").classList.remove("hidden");
  document.getElementById("scanInput").focus();
}

function closeScanning() {
  RS.activeShipment = null;
  RS.scannedItems = [];
  document.getElementById("scanningCard").classList.add("hidden");
  document.getElementById("newShipmentCard").classList.remove("hidden");
  document.getElementById("activeShipmentsCard").classList.remove("hidden");
  loadActiveShipments();
}
document.getElementById("closeScanningBtn").addEventListener("click", closeScanning);
document.getElementById("saveCloseScanBtn").addEventListener("click", function () {
  toast("Progress saved.", "success");
  closeScanning();
});

function updateCounters() {
  const claimed = RS.activeShipment ? RS.activeShipment.claimedCount : 0;
  const scanned = RS.scannedItems.length;
  document.getElementById("counterScanned").textContent = scanned;
  document.getElementById("counterClaimed").textContent = claimed;
  document.getElementById("counterPending").textContent = Math.max(0, claimed - scanned);
  document.getElementById("scanProgress").style.width = (claimed > 0 ? Math.min(100, Math.round((scanned/claimed)*100)) : 0) + "%";
  document.getElementById("itemCount").textContent = scanned;
}

function renderItems() {
  const list = document.getElementById("scannedList");
  if (!RS.scannedItems.length) { list.innerHTML = '<div class="empty-state" style="padding:14px;">No items scanned yet</div>'; return; }
  list.innerHTML = [...RS.scannedItems].reverse().slice(0, 50).map((item, i) => {
    const status = item.qc_status || "PENDING";
    const isPending = status === "PENDING";
    const actions = isPending
      ? `<span class="item-actions">
          <button class="btn-icon" onclick="editTrackingId('${item.item_id}','${item.tracking_id}')" title="Edit"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" onclick="deleteTrackingId('${item.item_id}','${item.tracking_id}')" title="Delete"><i class="ti ti-trash"></i></button>
         </span>` : "";
    return `<div class="item-row">
      <span class="item-number">#${RS.scannedItems.length - i}</span>
      <span class="item-tracking">${item.tracking_id}</span>
      <span class="item-status ${status}">${status}</span>
      ${actions}
    </div>`;
  }).join("");
}

document.getElementById("scanAddBtn").addEventListener("click", scanTracking);
document.getElementById("scanInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") { e.preventDefault(); scanTracking(); }
});

async function scanTracking() {
  const input = document.getElementById("scanInput");
  const trackingId = input.value.trim();
  if (!trackingId) { toast("Enter a tracking ID.", "error"); return; }
  if (!RS.activeShipment) { toast("No active shipment.", "error"); return; }

  const r = await api("scanTrackingId", { documentId: RS.activeShipment.documentId, trackingId: trackingId });
  if (r.success) {
    RS.scannedItems.push({ item_id: r.data.itemId, tracking_id: r.data.trackingId, qc_status: "PENDING" });
    updateCounters();
    renderItems();
    toast("Added: " + r.data.trackingId, "success");
    input.value = "";
    input.focus();
  } else {
    toast(r.error, "error");
    input.select();
  }
}

async function editTrackingId(itemId, current) {
  const next = prompt("Edit tracking ID:", current);
  if (!next || next.trim() === current) return;
  const r = await api("editTrackingId", { itemId: itemId, newTrackingId: next.trim() });
  if (r.success) {
    const idx = RS.scannedItems.findIndex(i => i.item_id === itemId);
    if (idx >= 0) RS.scannedItems[idx].tracking_id = r.data.trackingId;
    renderItems();
    toast("Updated to: " + r.data.trackingId, "success");
  } else {
    toast(r.error, "error");
  }
}

async function deleteTrackingId(itemId, tracking) {
  if (!confirm("Delete tracking ID " + tracking + "?")) return;
  const r = await api("deleteTrackingId", { itemId: itemId, documentId: RS.activeShipment.documentId });
  if (r.success) {
    RS.scannedItems = RS.scannedItems.filter(i => i.item_id !== itemId);
    updateCounters();
    renderItems();
    toast("Deleted.", "success");
  } else {
    toast(r.error, "error");
  }
}

document.getElementById("podFileInput").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== "application/pdf") { toast("Only PDF files allowed.", "error"); this.value = ""; return; }
  if (file.size > 10 * 1024 * 1024) { toast("File too large (max 10MB).", "error"); this.value = ""; return; }
  if (!RS.activeShipment) { toast("No active shipment.", "error"); return; }

  const statusEl = document.getElementById("podStatus");
  statusEl.textContent = "Uploading…";
  statusEl.className = "status-msg pending";

  const reader = new FileReader();
  reader.onload = async function (ev) {
    const r = await api("uploadPOD", {
      documentId: RS.activeShipment.documentId,
      fileData: ev.target.result,
      fileName: RS.activeShipment.documentId + "_POD.pdf"
    });
    if (r.success) {
      RS.activeShipment.podUploaded = true;
      statusEl.textContent = "POD uploaded.";
      statusEl.className = "status-msg";
      toast("POD uploaded.", "success");
    } else {
      statusEl.textContent = "Upload failed.";
      statusEl.className = "status-msg error";
      toast(r.error, "error");
    }
    e.target.value = "";
  };
  reader.readAsDataURL(file);
});

document.getElementById("completeShipmentBtn").addEventListener("click", async function () {
  if (!RS.activeShipment) return;
  if (!RS.activeShipment.podUploaded) { toast("Upload POD before completing.", "error"); return; }

  const claimed = RS.activeShipment.claimedCount;
  const scanned = RS.scannedItems.length;
  if (scanned < claimed) {
    if (!confirm(`Only ${scanned} of ${claimed} scanned. Complete anyway?`)) return;
    await doComplete(true);
  } else {
    await doComplete(false);
  }
});

async function doComplete(force) {
  const r = await api("completeShipment", { documentId: RS.activeShipment.documentId, forceComplete: force });
  if (r.success) {
    toast("Shipment completed.", "success");
    closeScanning();
  } else {
    toast(r.error, "error");
  }
}
