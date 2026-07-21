// ============================================================================
// uploadQueue.js — background video upload tracking.
//
// The QC record itself (photos, reasons, quantities) saves synchronously on
// Submit, same as before. The video is the one thing that's genuinely slow
// (large file, real network transfer time) — so it moves to this queue and
// uploads in the background while the operator moves straight to the next
// scan. This file renders the "Uploads" tab so that's not invisible.
// ============================================================================

const UploadQueue = {
  items: []   // { id, trackingId, itemId, status: 'uploading'|'done'|'failed', progress, blob, fileName }
};

function queueVideoUpload(trackingId, itemId, blob, fileName) {
  const entry = {
    id: trackingId + "_" + Date.now(),
    trackingId: trackingId,
    itemId: itemId,
    status: "uploading",
    progress: 0,
    blob: blob,
    fileName: fileName
  };
  UploadQueue.items.unshift(entry);
  renderUploadsTab();
  startUpload(entry);
  return entry.id;
}

async function startUpload(entry) {
  entry.status = "uploading";
  entry.progress = 0;
  renderUploadsTab();

  const base64Video = await blobToBase64(entry.blob);

  const result = await apiUpload("uploadVideo", {
    itemId: entry.itemId,
    videoData: base64Video,
    fileName: entry.fileName
  }, function (pct) {
    entry.progress = pct;
    renderUploadsTab();
  });

  if (result.success) {
    entry.status = "done";
    entry.blob = null; // free the memory, we don't need it anymore
    toast("Video uploaded for " + entry.trackingId, "success");
  } else {
    entry.status = "failed";
    entry.error = result.error || "Upload failed";
    toast("Video upload failed for " + entry.trackingId + " — retry from the Uploads tab.", "error");
  }
  renderUploadsTab();
}

function retryUpload(id) {
  const entry = UploadQueue.items.find(i => i.id === id);
  if (entry && entry.blob) startUpload(entry);
}

function renderUploadsTab() {
  const list = document.getElementById("uploadsList");
  if (!list) return; // tab not in DOM yet on first load, harmless

  const pendingCount = UploadQueue.items.filter(i => i.status === "uploading").length;
  const failedCount = UploadQueue.items.filter(i => i.status === "failed").length;
  const badge = document.getElementById("uploadsBadge");
  if (badge) {
    const active = pendingCount + failedCount;
    badge.textContent = active > 0 ? active : "";
    badge.classList.toggle("hidden", active === 0);
  }

  if (UploadQueue.items.length === 0) {
    list.innerHTML = '<div class="empty-state">No video uploads yet this session</div>';
    return;
  }

  list.innerHTML = UploadQueue.items.map(function (entry) {
    if (entry.status === "uploading") {
      return `<div class="upload-row">
        <div class="upload-row-top"><span>${entry.trackingId}</span><span>${entry.progress}%</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${entry.progress}%"></div></div>
      </div>`;
    }
    if (entry.status === "done") {
      return `<div class="upload-row">
        <div class="upload-row-top"><span>${entry.trackingId}</span><span class="upload-status-done"><i class="ti ti-circle-check-filled"></i> Uploaded</span></div>
      </div>`;
    }
    return `<div class="upload-row">
      <div class="upload-row-top"><span>${entry.trackingId}</span><span class="upload-status-failed">Failed</span></div>
      <button class="btn btn-secondary" style="margin-top:6px; min-height:30px; padding:6px 12px;" onclick="retryUpload('${entry.id}')">Retry upload</button>
    </div>`;
  }).join("");
}

// Warn before closing/refreshing the tab if anything is still uploading or
// has failed and not been retried — losing the recording at that point
// means the operator has to redo the whole QC.
window.addEventListener("beforeunload", function (e) {
  const pending = UploadQueue.items.some(i => i.status === "uploading" || i.status === "failed");
  if (pending) {
    e.preventDefault();
    e.returnValue = "";
  }
});
