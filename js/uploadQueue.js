// ============================================================================
// uploadQueue.js — background video upload tracking, sent in small chunks.
//
// A whole video sent as one request risks Apps Script or the network
// stalling silently with no error at all (exactly what happened with a
// 3+ minute recording). Splitting it into small pieces means every single
// request is small and fast — nothing left to hang on — and since each
// chunk completing is a real signal, this also gives back a genuine,
// accurate progress percentage (not an indeterminate bar).
// ============================================================================

const VIDEO_CHUNK_SIZE = 800 * 1024; // 800KB raw bytes per chunk (~1.06MB base64)

const UploadQueue = {
  items: []   // { id, trackingId, itemId, documentId, status, progress, blob, fileName }
};

function queueVideoUpload(trackingId, itemId, documentId, blob, fileName) {
  const entry = {
    id: trackingId + "_" + Date.now(),
    trackingId: trackingId,
    itemId: itemId,
    documentId: documentId,
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
  renderUploadsTab();

  const totalChunks = Math.ceil(entry.blob.size / VIDEO_CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const chunkBlob = entry.blob.slice(i * VIDEO_CHUNK_SIZE, (i + 1) * VIDEO_CHUNK_SIZE);
    const chunkBase64 = await blobToRawBase64(chunkBlob);

    const r = await api("uploadVideoChunk", {
      itemId: entry.itemId,
      documentId: entry.documentId,
      uploadId: entry.id,
      chunkIndex: i,
      totalChunks: totalChunks,
      chunkData: chunkBase64,
      fileName: entry.fileName
    });

    if (!r.success) {
      entry.status = "failed";
      entry.error = r.error || "Upload failed";
      renderUploadsTab();
      toast("Video upload failed for " + entry.trackingId + " (chunk " + (i + 1) + "/" + totalChunks + ") — retry from the Uploads tab.", "error");
      return;
    }

    entry.progress = Math.round(((i + 1) / totalChunks) * 100);
    renderUploadsTab();

    if (r.data.complete) {
      entry.status = "done";
      entry.blob = null; // free the memory, we don't need it anymore
      toast("Video uploaded for " + entry.trackingId, "success");
      renderUploadsTab();
      return;
    }
  }
}

// Raw base64 only — no "data:...;base64," prefix — since each chunk is
// just a slice of bytes, not a self-describing file.
function blobToRawBase64(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const commaIdx = reader.result.indexOf(",");
      resolve(reader.result.slice(commaIdx + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
        <div class="upload-row-top"><span>${entry.trackingId}</span><span class="upload-status-done">${ICONS["circle-check"]} Uploaded</span></div>
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
