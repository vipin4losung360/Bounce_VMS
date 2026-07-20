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
  document.getElementById("welcomeMsg").textContent =
    "Signed in as " + user.fullName + " (" + user.role + ")";
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
