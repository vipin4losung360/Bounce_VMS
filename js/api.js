// ============================================================================
// api.js — replaces google.script.run across the whole Portal.
//
// Every screen calls api(action, data) exactly like it called the old
// api() wrapper around google.script.run — same signature, same return
// shape ({success, data/error}). Only the transport underneath changed.
//
// WEB_APP_URL below must be your doPost deployment URL from Correction 3.
// ============================================================================

const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbzlgi4UVC6W8QCYeIX5RANJDkgMJUDiYlN2hNEhXR9g2u1QBMbw8SyO2BPtAArimWOK/exec";

const SESSION_KEY = "vms_session";

function getSessionToken() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  try { return JSON.parse(saved).token; } catch (e) { return null; }
}

function saveSession(token, user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getSavedUser() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (!saved) return null;
  try { return JSON.parse(saved).user; } catch (e) { return null; }
}

// Core call — one retry with backoff on network failure (not on a valid
// error response from the server, only on the request itself failing to
// complete, e.g. connection dropped mid-upload).
async function apiCall(action, data, attempt) {
  attempt = attempt || 1;
  const maxAttempts = 3;

  const payload = {
    action: action,
    data: data || {},
    sessionToken: getSessionToken()
  };

  try {
    const res = await fetch(WEB_APP_URL, {
      method: "POST",
      // Plain text content type deliberately — matches the backend's
      // text/plain response and avoids a CORS preflight on this request too.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    return JSON.parse(text);

  } catch (networkErr) {
    if (attempt < maxAttempts) {
      const delayMs = attempt * 1500;
      await new Promise(r => setTimeout(r, delayMs));
      return apiCall(action, data, attempt + 1);
    }
    // All retries exhausted — surface a clear, actionable error rather
    // than a raw exception. Caller (screen code) decides how to show it.
    return {
      success: false,
      error: "Couldn't reach the server after 3 tries. Check your connection and try again.",
      networkFailure: true
    };
  }
}

// Public entry point every screen uses.
async function api(action, data) {
  const result = await apiCall(action, data);

  // Session expired mid-use — clear it and bounce to login, same behavior
  // the old Portal had.
  if (!result.success && result.code === "SESSION_EXPIRED") {
    clearSession();
    showLogin();
  }

  return result;
}

// Upload with real progress reporting — fetch() can't report upload
// progress, so this uses XMLHttpRequest instead, same endpoint and payload
// shape as api(). Used for video uploads specifically, since that's the
// only payload large enough for a progress bar to matter.
function apiUpload(action, data, onProgress) {
  return new Promise(function (resolve) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", WEB_APP_URL, true);
    xhr.setRequestHeader("Content-Type", "text/plain;charset=utf-8");

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = function () {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (err) {
        resolve({ success: false, error: "Couldn't parse server response." });
      }
    };

    xhr.onerror = function () {
      resolve({ success: false, error: "Network error during upload.", networkFailure: true });
    };

    xhr.send(JSON.stringify({ action: action, data: data || {}, sessionToken: getSessionToken() }));
  });
}

// Public actions (login, forgotPassword) don't send a session token — the
// backend's handleApiRequest already treats these as public, and getSessionToken()
// returning null for a logged-out user is fine since sessionToken is simply
// null in the payload, matching what apiPublic() did before.
async function apiPublic(action, data) {
  return apiCall(action, data);
}
