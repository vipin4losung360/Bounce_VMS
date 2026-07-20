// ============================================================================
// qc.js — QC screen with continuous live-camera recording.
//
// Recording starts the moment the operator clicks "Start camera" (right
// after the item loads, before the label photo) and runs unbroken through
// every snapshot until Submit (uploads) or Cancel (discards). This is the
// actual VMS feature — everything else in the Portal is a straight port.
// ============================================================================

const QC = {
  item: null,
  marketplace: null,
  fcCode: null,
  clientCode: null,
  damageReasons: [],
  stream: null,
  mediaRecorder: null,
  chunks: [],
  recordedBlob: null,
  startedAt: null,
  images: {},       // type -> base64 (local, for the thumbnail)
  imageUrls: {},     // type -> {imageUrl, fileId, imageType} (uploaded)
  isBoxDamaged: null,
  isProductGood: null,
  damageReasonCodes: [],
  skuDetails: null,
  saleOrderCode: null,
  returnType: null,
  expectedQty: 1,
  apiFetched: false
};

const PRODUCT_IMAGE_TYPES = [
  ["PROD_TOP", "Top"], ["PROD_FRONT", "Front"], ["PROD_LEFT", "Left"],
  ["PROD_RIGHT", "Right"], ["PROD_DAMAGE", "Damage close-up"], ["PROD_LABEL", "Label"]
];
const REASON_NAMES = {
  PRODUCT_DAMAGE: "Product damage", WRONG_PRODUCT: "Wrong product", SHORTAGE: "Shortage",
  PARTS_MISSING: "Parts missing", USED_PRODUCT: "Used product", BOX_DAMAGE: "Box damage"
};

// ---------- Accordion control ----------
const STEP_ORDER = ["label", "product", "reasons", "photos", "qty"];

function unlockStep(name) {
  document.getElementById("stepItem-" + name).classList.remove("hidden");
}

function openStep(name) {
  STEP_ORDER.forEach(function (s) {
    const body = document.getElementById("body-" + s);
    const item = document.getElementById("stepItem-" + s);
    const active = s === name;
    body.classList.toggle("collapsed", !active);
    item.classList.toggle("active", active);
  });
}

function toggleStep(name) {
  const item = document.getElementById("stepItem-" + name);
  if (item.classList.contains("hidden")) return; // not unlocked yet, ignore
  const body = document.getElementById("body-" + name);
  if (body.classList.contains("collapsed")) {
    openStep(name);
  } else {
    body.classList.add("collapsed");
    item.classList.remove("active");
  }
}

function markDone(name, summaryText) {
  document.getElementById("stepItem-" + name).classList.add("done");
  document.getElementById("check-" + name).innerHTML = '<i class="ti ti-circle-check-filled"></i>';
  document.getElementById("summary-" + name).textContent = summaryText;
}

function markPending(name) {
  document.getElementById("stepItem-" + name).classList.remove("done");
  document.getElementById("check-" + name).innerHTML = '<i class="ti ti-circle-dashed"></i>';
  document.getElementById("summary-" + name).textContent = "";
}

// ---------- Load item ----------
document.getElementById("qcLoadBtn").addEventListener("click", loadItemForQC);
document.getElementById("qcScanInput").addEventListener("keydown", function (e) {
  if (e.key === "Enter") { e.preventDefault(); loadItemForQC(); }
});

async function loadItemForQC() {
  const input = document.getElementById("qcScanInput");
  const trackingId = input.value.trim();
  if (!trackingId) { toast("Enter a tracking ID.", "error"); return; }

  const r = await api("loadItemForQC", { trackingId: trackingId });

  if (!r.success) {
    toast(r.error || "Item not found.", "error");
    return;
  }
  if (!r.skuFound && !r.data.item.sku_details) {
    toast("SKU details not found. Ask admin to sync the data.", "error");
    return;
  }

  resetQCState();
  QC.item = r.data.item;
  QC.marketplace = r.data.marketplaceCode;
  QC.fcCode = r.data.fcCode;
  QC.clientCode = r.data.clientCode;
  QC.damageReasons = r.data.damageReasons || [];

  document.getElementById("qcTrackingId").textContent = r.data.item.tracking_id;
  document.getElementById("qcDocId").textContent = r.data.item.document_id;
  document.getElementById("qcFCClient").textContent = r.data.fcCode + " / " + r.data.clientCode;
  document.getElementById("qcMarketplace").textContent = r.data.marketplaceCode;

  if (r.skuFound && r.data.skuData) displaySkuDetails(r.data.skuData);

  input.value = "";
  document.getElementById("qcScanCard").classList.add("hidden");
  document.getElementById("qcFormCard").classList.remove("hidden");
}

function displaySkuDetails(data) {
  QC.skuDetails = data.skuDetails;
  QC.saleOrderCode = data.saleOrderCode;
  QC.returnType = data.returnType;
  QC.expectedQty = data.expectedQty || 1;
  QC.apiFetched = true;

  document.getElementById("skuList").innerHTML = (data.skuDetails || []).map(s =>
    `<div class="sku-row"><span>${s.sku} &middot; ${s.name || ""}</span><span>&times;${s.qty}</span></div>`
  ).join("");
  document.getElementById("expectedQtyDisplay").textContent = data.expectedQty;
  const badge = document.getElementById("returnTypeBadge");
  badge.textContent = data.returnType;
  document.getElementById("skuBox").classList.remove("hidden");
}

// ---------- Camera + continuous recording ----------
document.getElementById("startCameraBtn").addEventListener("click", async function () {
  try {
    QC.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    toast("Camera access is required to start QC: " + err.message, "error");
    return;
  }

  document.getElementById("qcVideo").srcObject = QC.stream;
  document.getElementById("startCameraBtn").classList.add("hidden");
  document.getElementById("recBadge").classList.remove("hidden");

  QC.chunks = [];
  QC.mediaRecorder = new MediaRecorder(QC.stream);
  QC.mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) QC.chunks.push(e.data); };
  QC.mediaRecorder.start();
  QC.startedAt = Date.now();

  unlockStep("label");
  openStep("label");
});

function stopRecordingAndGetBlob() {
  return new Promise(function (resolve) {
    if (!QC.mediaRecorder || QC.mediaRecorder.state === "inactive") { resolve(null); return; }
    QC.mediaRecorder.onstop = function () {
      const type = QC.mediaRecorder.mimeType || "video/webm";
      resolve(new Blob(QC.chunks, { type: type }));
    };
    QC.mediaRecorder.stop();
  });
}

function stopCameraHard() {
  if (QC.stream) { QC.stream.getTracks().forEach(t => t.stop()); QC.stream = null; }
  document.getElementById("qcVideo").srcObject = null;
  document.getElementById("recBadge").classList.add("hidden");
}

// ---------- Snapshot capture ----------
function takeSnapshot() {
  const video = document.getElementById("qcVideo");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

async function uploadSnapshot(type, base64) {
  const r = await api("uploadImageToDrive", {
    itemId: QC.item.item_id,
    imageData: base64,
    imageType: type,
    fileName: QC.item.tracking_id + "_" + type + ".jpg",
    documentId: QC.item.document_id,
    trackingId: QC.item.tracking_id
  });
  if (r.success) {
    QC.images[type] = base64;
    QC.imageUrls[type] = { imageUrl: r.data.imageUrl, fileId: r.data.fileId, imageType: type };
    return true;
  }
  toast("Upload failed for " + type + ": " + r.error, "error");
  return false;
}

// ---------- Step: label ----------
document.getElementById("captureLabelBtn").addEventListener("click", async function () {
  const base64 = takeSnapshot();
  const btn = this;
  btn.disabled = true;
  const ok = await uploadSnapshot("LABEL", base64);
  btn.disabled = false;
  if (ok) {
    document.getElementById("labelThumb").innerHTML =
      `<div class="snap-thumb"><img src="${base64}"><button class="snap-remove" onclick="removeLabel()"><i class="ti ti-x"></i></button></div>`;
    markDone("label", "Captured");
    unlockStep("product");
    openStep("product");
  }
});

function removeLabel() {
  delete QC.imageUrls.LABEL;
  delete QC.images.LABEL;
  document.getElementById("labelThumb").innerHTML = "";
  markPending("label");
  openStep("label");
}

function renderSnapshotStrip(types) {
  const strip = document.getElementById("productImagesStrip");
  strip.innerHTML = types.map(([type, label]) =>
    `<div class="snap-thumb" id="pstrip-${type}"><div class="snap-placeholder">${label}</div></div>`
  ).join("");
  updateCaptureBtnLabel();
}

function nextUncapturedType(types) {
  return types.find(([type]) => !QC.imageUrls[type]);
}

function updateCaptureBtnLabel() {
  const count = PRODUCT_IMAGE_TYPES.filter(([type]) => !!QC.imageUrls[type]).length;
  const btn = document.getElementById("capturePhotoBtn");
  const next = nextUncapturedType(PRODUCT_IMAGE_TYPES);
  btn.textContent = count >= 6 ? "All 6 photos captured" : `Capture photo (${count}/6)${next ? " — " + next[1] : ""}`;
  btn.disabled = count >= 6;
}

document.getElementById("capturePhotoBtn").addEventListener("click", async function () {
  const next = nextUncapturedType(PRODUCT_IMAGE_TYPES);
  if (!next) return;
  const [type] = next;
  const base64 = takeSnapshot();
  const btn = this;
  btn.disabled = true;

  const ok = await uploadSnapshot(type, base64);
  if (ok) {
    document.getElementById("pstrip-" + type).innerHTML =
      `<img src="${base64}"><button class="snap-remove" onclick="removeStripSnapshot('${type}')"><i class="ti ti-x"></i></button>`;
  }
  updateCaptureBtnLabel();

  if (allCaptured(PRODUCT_IMAGE_TYPES)) {
    markDone("photos", "6/6 captured");
    afterProductImages();
  } else {
    btn.disabled = false;
  }
});

function removeStripSnapshot(type) {
  delete QC.imageUrls[type];
  delete QC.images[type];
  const match = PRODUCT_IMAGE_TYPES.find(t => t[0] === type);
  document.getElementById("pstrip-" + type).innerHTML = `<div class="snap-placeholder">${match ? match[1] : ""}</div>`;
  markPending("photos");
  openStep("photos");
  updateCaptureBtnLabel();
}

function allCaptured(types) { return types.every(([type]) => !!QC.imageUrls[type]); }

// ---------- Step: product condition ----------
document.getElementById("productGoodBtn").addEventListener("click", function () { setProductCondition(true); });
document.getElementById("productBadBtn").addEventListener("click", function () { setProductCondition(false); });

function setProductCondition(isGood) {
  QC.isProductGood = isGood;
  document.getElementById("productGoodBtn").classList.toggle("selected-success", isGood === true);
  document.getElementById("productBadBtn").classList.toggle("selected-danger", isGood === false);

  if (isGood) {
    markDone("product", "Good");
    finishSteps();
  } else {
    markDone("product", "Damaged");
    renderDamageReasons();
    unlockStep("reasons");
    openStep("reasons");
  }
}

function renderDamageReasons() {
  document.getElementById("damageReasonsList").innerHTML = QC.damageReasons.map(r =>
    `<div class="reason-checkbox" data-code="${r.reason_code}" onclick="toggleReason(this)">${r.reason_name}</div>`
  ).join("");
}

function toggleReason(el) {
  el.classList.toggle("checked");
  const code = el.dataset.code;
  if (el.classList.contains("checked")) {
    if (!QC.damageReasonCodes.includes(code)) QC.damageReasonCodes.push(code);
  } else {
    QC.damageReasonCodes = QC.damageReasonCodes.filter(c => c !== code);
  }
}

document.getElementById("reasonsNextBtn").addEventListener("click", function () {
  if (QC.damageReasonCodes.length === 0) { toast("Select at least one reason.", "error"); return; }
  markDone("reasons", QC.damageReasonCodes.length + " reason" + (QC.damageReasonCodes.length > 1 ? "s" : "") + " selected");
  renderSnapshotStrip(PRODUCT_IMAGE_TYPES);
  unlockStep("photos");
  openStep("photos");
});

function afterProductImages() {
  if (QC.expectedQty > 1) {
    renderQtyBreakdown();
    unlockStep("qty");
    openStep("qty");
  }
  finishSteps();
}

function renderQtyBreakdown() {
  const rows = QC.damageReasonCodes.map(code =>
    `<div class="qty-row"><label>${REASON_NAMES[code] || code}</label><input type="number" class="form-input damage-qty" data-code="${code}" value="0" min="0" max="${QC.expectedQty}" onchange="updateGoodQty()"></div>`
  ).join("");
  document.getElementById("qtyBreakdownList").innerHTML = rows +
    `<div class="qty-row" style="border-top:1px solid var(--border); padding-top:8px; margin-top:4px;"><label style="color:var(--success); font-weight:500;">Good qty</label><input type="number" class="form-input" id="qcGoodQty" value="${QC.expectedQty}" readonly style="background:var(--bg-page);"></div>`;
}

function updateGoodQty() {
  let damaged = 0;
  document.querySelectorAll(".damage-qty").forEach(i => damaged += parseInt(i.value) || 0);
  document.getElementById("qcGoodQty").value = Math.max(0, QC.expectedQty - damaged);
}

function finishSteps() {
  document.getElementById("submitQCBtn").classList.remove("hidden");
}

// ---------- Cancel ----------
document.getElementById("qcCancelBtn").addEventListener("click", async function () {
  if (QC.mediaRecorder && QC.mediaRecorder.state !== "inactive") await stopRecordingAndGetBlob();
  stopCameraHard();
  resetQCState();
  document.getElementById("qcFormCard").classList.add("hidden");
  document.getElementById("qcScanCard").classList.remove("hidden");
});

// ---------- Submit ----------
document.getElementById("submitQCBtn").addEventListener("click", async function () {
  const btn = this;
  btn.disabled = true;
  btn.textContent = "Uploading video…";

  const blob = await stopRecordingAndGetBlob();
  stopCameraHard();

  let durationSec = QC.startedAt ? Math.round((Date.now() - QC.startedAt) / 1000) : 0;

  if (blob) {
    const base64Video = await blobToBase64(blob);
    const vr = await api("uploadVideo", {
      itemId: QC.item.item_id,
      videoData: base64Video,
      fileName: QC.item.tracking_id + "_VIDEO.webm"
    });
    if (!vr.success) {
      toast("Video upload failed: " + vr.error + " — you can retry Submit, the recording is still held.", "error");
      btn.disabled = false;
      btn.textContent = "Complete QC";
      return;
    }
  }

  btn.textContent = "Saving…";

  const expectedQty = QC.expectedQty;
  let damageDetails = null;
  let receivedQty = expectedQty;
  let missingQty = 0;

  // No separate box-condition step anymore — box damage is derived from
  // whether the operator checked "Box damage" among the reason checkboxes.
  QC.isBoxDamaged = QC.damageReasonCodes.includes("BOX_DAMAGE");

  if (QC.isProductGood === false) {
    damageDetails = { product_damage: 0, wrong_product: 0, shortage: 0, parts_missing: 0, used_product: 0, box_damage: 0, good: 0 };
    if (expectedQty > 1) {
      let totalDamaged = 0;
      document.querySelectorAll(".damage-qty").forEach(i => {
        const code = i.dataset.code, qty = parseInt(i.value) || 0;
        totalDamaged += qty;
        const key = code.toLowerCase();
        if (damageDetails.hasOwnProperty(key)) damageDetails[key] = qty;
      });
      damageDetails.good = Math.max(0, expectedQty - totalDamaged);
      missingQty = damageDetails.shortage;
    } else {
      const primary = QC.damageReasonCodes[0];
      const key = primary ? primary.toLowerCase() : null;
      if (key && damageDetails.hasOwnProperty(key)) damageDetails[key] = 1;
      missingQty = QC.damageReasonCodes.includes("SHORTAGE") ? 1 : 0;
    }
    receivedQty = expectedQty - missingQty;
  }

  const calculatedTag = calculateTag();

  const r = await api("saveQCData", {
    itemId: QC.item.item_id,
    isBoxDamaged: QC.isBoxDamaged,
    isProductGood: QC.isProductGood,
    expectedQty: expectedQty,
    receivedQty: receivedQty,
    missingQty: missingQty,
    marketplaceDamageTag: calculatedTag,
    damageReasonIds: QC.damageReasons.filter(r => QC.damageReasonCodes.includes(r.reason_code)).map(r => r.reason_id),
    damageReasonCodes: QC.damageReasonCodes,
    saleOrderCode: QC.saleOrderCode,
    skuDetails: QC.skuDetails,
    returnType: QC.returnType,
    apiFetched: QC.apiFetched,
    damageDetails: damageDetails,
    imageUrls: QC.imageUrls
  });

  btn.disabled = false;
  btn.textContent = "Complete QC";

  if (r.success) {
    toast("QC complete: " + r.data.qcStatus + " (" + durationSec + "s recorded)", "success");
    resetQCState();
    document.getElementById("qcFormCard").classList.add("hidden");
    document.getElementById("qcScanCard").classList.remove("hidden");
    document.getElementById("qcScanInput").focus();
  } else {
    toast(r.error, "error");
  }
});

function calculateTag() {
  if (QC.isProductGood && !QC.isBoxDamaged) return null;
  if (QC.isProductGood && QC.isBoxDamaged) return "BOX_DAMAGE";
  const priority = ["WRONG_PRODUCT", "PRODUCT_DAMAGE", "SHORTAGE", "PARTS_MISSING", "BOX_DAMAGE", "USED_PRODUCT"];
  for (const tag of priority) { if (QC.damageReasonCodes.includes(tag)) return tag; }
  if (QC.isBoxDamaged) return "BOX_DAMAGE";
  return "DAMAGED";
}

function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      // MediaRecorder often reports a mimeType like
      // "video/webm;codecs=vp9,opus" — the backend's stripping regex only
      // matches a plain "data:video/webm;base64," prefix, so normalize it
      // here rather than touching Code.gs. Codec info isn't needed for
      // storage; the container (webm) is all that matters downstream.
      const commaIndex = reader.result.indexOf(",");
      const rawBase64 = reader.result.slice(commaIndex + 1);
      resolve("data:video/webm;base64," + rawBase64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function resetQCState() {
  QC.item = null; QC.marketplace = null; QC.fcCode = null; QC.clientCode = null;
  QC.damageReasons = []; QC.stream = null; QC.mediaRecorder = null; QC.chunks = [];
  QC.recordedBlob = null; QC.startedAt = null; QC.images = {}; QC.imageUrls = {};
  QC.isBoxDamaged = null; QC.isProductGood = null; QC.damageReasonCodes = [];
  QC.skuDetails = null; QC.saleOrderCode = null; QC.returnType = null;
  QC.expectedQty = 1; QC.apiFetched = false;

  document.getElementById("skuBox").classList.add("hidden");
  document.getElementById("labelThumb").innerHTML = "";
  STEP_ORDER.forEach(function (s) {
    const item = document.getElementById("stepItem-" + s);
    item.classList.add("hidden");
    item.classList.remove("done", "active");
    document.getElementById("body-" + s).classList.add("collapsed");
    document.getElementById("check-" + s).innerHTML = '<i class="ti ti-circle-dashed"></i>';
    document.getElementById("summary-" + s).textContent = "";
  });
  document.getElementById("submitQCBtn").classList.add("hidden");
  document.getElementById("startCameraBtn").classList.remove("hidden");
  document.querySelectorAll(".qc-toggle-btn").forEach(b => b.classList.remove("selected-danger","selected-success"));
}
