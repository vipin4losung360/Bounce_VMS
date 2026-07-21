// ============================================================================
// users.js — User management (PTC_USER only). Ported from the original
// Portal's user admin logic — same backend calls, same data shape.
// ============================================================================

const US = {
  users: [],
  allFCs: [],
  allClients: [],
  viewerAccessList: [],   // [{clientId, clientCode, clientName, fcs:[{fcId,fcCode,fcName}]}]
  viewerFCsForClient: []
};

async function loadUsers() {
  const r = await api("getUsers", {});
  const list = document.getElementById("userList");
  if (!r.success) { list.innerHTML = '<div class="empty-state">' + r.error + "</div>"; return; }
  US.users = r.data;
  renderUsers();
}

function renderUsers() {
  const list = document.getElementById("userList");
  if (!US.users.length) { list.innerHTML = '<div class="empty-state">No users found</div>'; return; }

  list.innerHTML = US.users.map(function (u) {
    const roleText = u.role === "PTC_USER" ? "Admin" : (u.role === "FC_USER" ? "FC user" : "Viewer");
    let accessInfo = "";
    if (u.role === "FC_USER" && u.fcAccess && u.fcAccess.length) {
      accessInfo = "FCs: " + u.fcAccess.map(f => f.fc_code).join(", ");
    } else if (u.role === "VIEWER" && u.viewerAccess && u.viewerAccess.length) {
      const byClient = {};
      u.viewerAccess.forEach(v => { (byClient[v.client_code] = byClient[v.client_code] || []).push(v.fc_code); });
      accessInfo = "Access: " + Object.keys(byClient).map(c => c + " [" + byClient[c].join(", ") + "]").join(" · ");
    }

    const reactivateBtn = !u.is_active
      ? `<button class="btn btn-secondary" style="min-height:28px; padding:5px 10px;" onclick="reactivateUser('${u.user_id}','${escUsr(u.full_name)}')">Reactivate</button>` : "";
    const deleteBtn = u.is_active && u.user_id !== window.CURRENT_USER.userId
      ? `<button class="btn btn-secondary" style="min-height:28px; padding:5px 10px; color:var(--danger);" onclick="deleteUser('${u.user_id}','${escUsr(u.full_name)}')">Delete</button>` : "";

    return `<div class="user-card ${u.is_active ? "" : "inactive"}">
      <div class="user-card-top">
        <div>
          <div class="user-card-name">${escUsr(u.full_name)}</div>
          <div class="user-card-username">@${escUsr(u.username)}</div>
        </div>
        <span class="role-badge ${u.role}">${roleText}</span>
      </div>
      ${accessInfo ? '<div class="user-card-access">' + accessInfo + "</div>" : ""}
      <div class="user-card-actions">
        <button class="btn btn-secondary" style="min-height:28px; padding:5px 10px;" onclick="editUser('${u.user_id}')">Edit</button>
        ${reactivateBtn}${deleteBtn}
      </div>
    </div>`;
  }).join("");
}

function escUsr(s) { return (s || "").replace(/'/g, "&#39;").replace(/"/g, "&quot;"); }

document.getElementById("addUserBtn").addEventListener("click", async function () {
  US.viewerAccessList = [];
  document.getElementById("userModalTitle").textContent = "Add user";
  document.getElementById("editUserId").value = "";
  document.getElementById("userUsername").value = "";
  document.getElementById("userUsername").disabled = false;
  document.getElementById("userFullName").value = "";
  document.getElementById("userEmail").value = "";
  document.getElementById("userPassword").value = "";
  document.getElementById("userPasswordLabel").textContent = "Password";
  document.getElementById("userRole").value = "";
  document.getElementById("fcSelectionGroup").classList.add("hidden");
  document.getElementById("viewerAccessGroup").classList.add("hidden");
  document.getElementById("viewerFCSection").classList.add("hidden");
  renderViewerAccessList();
  await Promise.all([loadFCsForModal(), loadClientsForModal()]);
  document.getElementById("userModal").classList.remove("hidden");
});

async function loadFCsForModal() {
  const r = await api("getFulfillmentCenters", {});
  if (r.success) {
    US.allFCs = r.data;
    document.getElementById("fcCheckboxList").innerHTML = r.data.map(f =>
      `<label class="checkbox-item"><input type="checkbox" value="${f.fc_id}" class="fc-check"> ${f.fc_code} — ${f.fc_name}</label>`
    ).join("");
  }
}

async function loadClientsForModal() {
  const r = await api("getClients", {});
  if (r.success) {
    US.allClients = r.data;
    document.getElementById("viewerClientSelect").innerHTML = '<option value="">Select client</option>' +
      r.data.map(c => `<option value="${c.client_id}" data-code="${c.client_code}" data-name="${escUsr(c.client_name)}">${c.client_code} — ${c.client_name}</option>`).join("");
  }
}

document.getElementById("userRole").addEventListener("change", function () {
  document.getElementById("fcSelectionGroup").classList.toggle("hidden", this.value !== "FC_USER");
  document.getElementById("viewerAccessGroup").classList.toggle("hidden", this.value !== "VIEWER");
});

document.getElementById("viewerClientSelect").addEventListener("change", async function () {
  const clientId = this.value;
  const fcSection = document.getElementById("viewerFCSection");
  if (!clientId) { fcSection.classList.add("hidden"); return; }

  const matches = [];
  for (const fc of US.allFCs) {
    const r = await api("getClientsByFC", { fcCode: fc.fc_code });
    if (r.success && r.data.some(c => c.client_id === clientId)) matches.push(fc);
  }
  if (matches.length === 0) { toast("No FCs mapped to this client.", "error"); fcSection.classList.add("hidden"); return; }

  US.viewerFCsForClient = matches;
  document.getElementById("viewerFCCheckboxList").innerHTML = matches.map(fc =>
    `<label class="checkbox-item"><input type="checkbox" value="${fc.fc_id}" class="viewer-fc-check"> ${fc.fc_code} — ${fc.fc_name}</label>`
  ).join("");
  fcSection.classList.remove("hidden");
});

document.getElementById("addViewerAccessBtn").addEventListener("click", function () {
  const sel = document.getElementById("viewerClientSelect");
  const clientId = sel.value;
  if (!clientId) { toast("Select a client first.", "error"); return; }

  const checkedFCIds = Array.from(document.querySelectorAll(".viewer-fc-check:checked")).map(c => c.value);
  if (checkedFCIds.length === 0) { toast("Select at least one FC.", "error"); return; }

  const opt = sel.options[sel.selectedIndex];
  const fcs = checkedFCIds.map(id => {
    const fc = US.viewerFCsForClient.find(f => f.fc_id === id);
    return { fcId: id, fcCode: fc ? fc.fc_code : "", fcName: fc ? fc.fc_name : "" };
  });

  const existingIdx = US.viewerAccessList.findIndex(a => a.clientId === clientId);
  const entry = { clientId: clientId, clientCode: opt.dataset.code, clientName: opt.dataset.name, fcs: fcs };
  if (existingIdx >= 0) US.viewerAccessList[existingIdx] = entry; else US.viewerAccessList.push(entry);

  renderViewerAccessList();
  sel.value = "";
  document.getElementById("viewerFCSection").classList.add("hidden");
  toast("Client access added.", "success");
});

function renderViewerAccessList() {
  document.getElementById("viewerAccessList").innerHTML = US.viewerAccessList.map((a, idx) =>
    `<div class="access-chip">${a.clientCode} [${a.fcs.map(f => f.fcCode).join(", ")}] <span class="remove-chip" onclick="removeViewerAccess(${idx})">×</span></div>`
  ).join("");
}

function removeViewerAccess(idx) {
  US.viewerAccessList.splice(idx, 1);
  renderViewerAccessList();
}

document.getElementById("userModalCancelBtn").addEventListener("click", function () {
  document.getElementById("userModal").classList.add("hidden");
});

async function editUser(userId) {
  const r = await api("getUser", { userId: userId });
  if (!r.success) { toast(r.error, "error"); return; }

  US.viewerAccessList = [];
  document.getElementById("userModalTitle").textContent = "Edit user";
  document.getElementById("editUserId").value = userId;
  document.getElementById("userUsername").value = r.data.username;
  document.getElementById("userUsername").disabled = true;
  document.getElementById("userFullName").value = r.data.full_name;
  document.getElementById("userEmail").value = r.data.email || "";
  document.getElementById("userPassword").value = "";
  document.getElementById("userPasswordLabel").textContent = "New password (leave blank to keep)";
  document.getElementById("userRole").value = r.data.role;

  await Promise.all([loadFCsForModal(), loadClientsForModal()]);

  document.querySelectorAll(".fc-check").forEach(cb => {
    cb.checked = !!(r.data.fcIds && r.data.fcIds.includes(cb.value));
  });

  if (r.data.viewerAccess && r.data.viewerAccess.length) {
    const grouped = {};
    r.data.viewerAccess.forEach(v => {
      if (!grouped[v.client_id]) grouped[v.client_id] = { clientId: v.client_id, clientCode: v.client_code, clientName: v.client_name || v.client_code, fcs: [] };
      grouped[v.client_id].fcs.push({ fcId: v.fc_id, fcCode: v.fc_code, fcName: v.fc_name || v.fc_code });
    });
    US.viewerAccessList = Object.values(grouped);
  }
  renderViewerAccessList();

  document.getElementById("fcSelectionGroup").classList.toggle("hidden", r.data.role !== "FC_USER");
  document.getElementById("viewerAccessGroup").classList.toggle("hidden", r.data.role !== "VIEWER");
  document.getElementById("viewerFCSection").classList.add("hidden");

  document.getElementById("userModal").classList.remove("hidden");
}

document.getElementById("userModalSaveBtn").addEventListener("click", async function () {
  const userId = document.getElementById("editUserId").value;
  const username = document.getElementById("userUsername").value.trim();
  const fullName = document.getElementById("userFullName").value.trim();
  const email = document.getElementById("userEmail").value.trim();
  const password = document.getElementById("userPassword").value;
  const role = document.getElementById("userRole").value;

  if (!username || !fullName || !role) { toast("Fill in username, full name, and role.", "error"); return; }
  if (!userId && !password) { toast("Password is required for a new user.", "error"); return; }

  const fcIds = role === "FC_USER" ? Array.from(document.querySelectorAll(".fc-check:checked")).map(c => c.value) : [];
  if (role === "FC_USER" && fcIds.length === 0) { toast("Select at least one FC.", "error"); return; }
  if (role === "VIEWER" && US.viewerAccessList.length === 0) { toast("Add at least one client access.", "error"); return; }

  const btn = this;
  btn.disabled = true;

  let r;
  if (userId) {
    r = await api("updateUser", { userId, email, fullName, role, newPassword: password || null });
  } else {
    r = await api("createUser", { username, email, password, fullName, role });
  }

  if (!r.success) { btn.disabled = false; toast(r.error, "error"); return; }

  const targetUserId = userId || r.data.userId;
  const viewerAccessForBackend = [];
  US.viewerAccessList.forEach(entry => entry.fcs.forEach(fc => viewerAccessForBackend.push({ fcId: fc.fcId, clientId: entry.clientId })));

  const r2 = await api("saveUserAccess", { userId: targetUserId, role, fcIds, viewerAccess: viewerAccessForBackend });

  btn.disabled = false;

  if (r2.success) {
    toast(userId ? "User updated." : "User created.", "success");
    document.getElementById("userModal").classList.add("hidden");
    loadUsers();
  } else {
    toast("User saved but access update failed: " + r2.error, "error");
  }
});

async function deleteUser(userId, name) {
  if (!confirm('Delete user "' + name + '"?')) return;
  const r = await api("deleteUser", { userId: userId });
  if (r.success) { toast("User deleted.", "success"); loadUsers(); } else { toast(r.error, "error"); }
}

async function reactivateUser(userId, name) {
  if (!confirm('Reactivate user "' + name + '"?')) return;
  const r = await api("reactivateUser", { userId: userId });
  if (r.success) { toast("User reactivated.", "success"); loadUsers(); } else { toast(r.error, "error"); }
}
