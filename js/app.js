// ============================================================================
// app.js — bootstrap only, for this first step. Login + session check +
// logout. Later screens (QC, Receive, etc.) get added here incrementally.
// ============================================================================

function showLogin() {
  document.getElementById("loadingPage").classList.add("hidden");
  document.getElementById("appContainer").classList.add("hidden");
  document.getElementById("loginPage").classList.remove("hidden");
}

function showApp(user) {
  document.getElementById("loadingPage").classList.add("hidden");
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("appContainer").classList.remove("hidden");

  window.CURRENT_USER = user;
  document.getElementById("welcomeMsg").textContent = user.fullName;
  document.getElementById("userAvatar").textContent = (user.fullName || "?").charAt(0).toUpperCase();

  applyRoleVisibility(user.role);
  loadMasterData();
}

function applyRoleVisibility(role) {
  const usersTab = document.querySelector('.nav-item[data-page="users"]');
  const claimsTab = document.querySelector('.nav-item[data-page="claims"]');

  if (usersTab) usersTab.classList.toggle("hidden", role !== "PTC_USER");
  if (claimsTab) claimsTab.classList.toggle("hidden", role !== "PTC_USER");

  if (role === "VIEWER") {
    // Viewers only see Reports, matching the original Portal's restriction.
    ["receive", "qc", "cbp", "claims", "uploads"].forEach(function (p) {
      const el = document.querySelector('.nav-item[data-page="' + p + '"]');
      if (el) el.classList.add("hidden");
    });
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
    document.querySelector('.nav-item[data-page="reports"]').classList.add("active");
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.getElementById("page-reports").classList.add("active");
    loadReportFilters();
  }
}

function setStatus(msg, type) {
  const el = document.getElementById("loginStatus");
  el.textContent = msg;
  el.className = "status-msg " + (type || "");
}

document.getElementById("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  if (!username || !password) { setStatus("Enter your username and password.", "error"); return; }

  const btn = document.getElementById("loginBtn");
  btn.disabled = true;
  setStatus("Signing in…", "pending");

  const r = await apiPublic("login", { username: username, password: password });

  btn.disabled = false;

  if (r.success) {
    saveSession(r.data.sessionToken, r.data.user);
    setStatus("", "");
    showApp(r.data.user);
  } else {
    setStatus(r.error || "Sign in failed.", "error");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async function () {
  await api("logout", {});
  clearSession();
  showLogin();
});

// ---------- User menu dropdown ----------
document.getElementById("userMenuBtn").addEventListener("click", function (e) {
  e.stopPropagation();
  document.getElementById("userMenuDropdown").classList.toggle("hidden");
});
document.addEventListener("click", function () {
  document.getElementById("userMenuDropdown").classList.add("hidden");
});

// ---------- Change password ----------
document.getElementById("changePasswordMenuItem").addEventListener("click", function () {
  document.getElementById("userMenuDropdown").classList.add("hidden");
  document.getElementById("currentPassword").value = "";
  document.getElementById("newPassword").value = "";
  document.getElementById("confirmNewPassword").value = "";
  document.getElementById("changePasswordStatus").textContent = "";
  document.getElementById("changePasswordModal").classList.remove("hidden");
});
document.getElementById("changePasswordCancelBtn").addEventListener("click", function () {
  document.getElementById("changePasswordModal").classList.add("hidden");
});
document.getElementById("changePasswordSaveBtn").addEventListener("click", async function () {
  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmNewPassword").value;
  const statusEl = document.getElementById("changePasswordStatus");

  if (!currentPassword || !newPassword || !confirmPassword) {
    statusEl.textContent = "All fields are required.";
    statusEl.className = "status-msg error";
    return;
  }
  if (newPassword !== confirmPassword) {
    statusEl.textContent = "New passwords do not match.";
    statusEl.className = "status-msg error";
    return;
  }
  if (newPassword.length < 6) {
    statusEl.textContent = "Password must be at least 6 characters.";
    statusEl.className = "status-msg error";
    return;
  }

  const btn = this;
  btn.disabled = true;
  statusEl.textContent = "Changing…";
  statusEl.className = "status-msg pending";

  const r = await api("changePassword", { currentPassword, newPassword, confirmPassword });

  btn.disabled = false;

  if (r.success) {
    toast("Password changed.", "success");
    document.getElementById("changePasswordModal").classList.add("hidden");
  } else {
    statusEl.textContent = r.error || "Couldn't change password.";
    statusEl.className = "status-msg error";
  }
});

// ---------- Forgot password ----------
function setForgotStatus(msg, type) {
  const el = document.getElementById("forgotStatus");
  el.textContent = msg;
  el.className = "status-msg " + (type || "");
}

document.getElementById("forgotPasswordLink").addEventListener("click", function (e) {
  e.preventDefault();
  document.getElementById("forgotUsername").value = "";
  setForgotStatus("", "");
  document.getElementById("forgotPasswordModal").classList.remove("hidden");
});

document.getElementById("forgotCancelBtn").addEventListener("click", function () {
  document.getElementById("forgotPasswordModal").classList.add("hidden");
});

document.getElementById("forgotSendBtn").addEventListener("click", async function () {
  const username = document.getElementById("forgotUsername").value.trim();
  if (!username) { setForgotStatus("Enter your username.", "error"); return; }

  const btn = document.getElementById("forgotSendBtn");
  btn.disabled = true;
  setForgotStatus("Sending…", "pending");

  const r = await apiPublic("forgotPassword", { username: username });

  btn.disabled = false;

  if (r.success) {
    setForgotStatus(r.message || "Reset email sent.", "");
    setTimeout(() => document.getElementById("forgotPasswordModal").classList.add("hidden"), 2000);
  } else {
    setForgotStatus(r.error || "Couldn't send reset email.", "error");
  }
});

// On load: if there's a saved session, verify it's still valid before
// trusting it (same behavior as the original Portal's checkSession()).
(async function init() {
  const token = getSessionToken();
  if (!token) { showLogin(); return; }

  const r = await api("checkSession", {});
  if (r.success) {
    showApp(r.data.user);
  } else {
    clearSession();
    showLogin();
  }
})();
