const managedUsersPageSize = 25;
const userManagementState = {
  users: [],
  stats: null,
  search: '',
  page: 1,
  pagination: { page: 1, pageSize: managedUsersPageSize, totalItems: 0, totalPages: 1 },
  loading: false,
  requestId: 0,
  searchTimer: null,
  message: '',
  tone: 'info',
  messageTimer: null
};

function hasUserManagementAccess() {
  return Boolean(communityState.me && !communityState.me.mustChangePassword && (communityState.me.role === 'owner' || communityState.me.role === 'admin'));
}

function formatManagementDate(value) {
  const stamp = Date.parse(value || '');
  if (!Number.isFinite(stamp)) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(stamp));
}

function managedAccountStatusMeta(user) {
  if (user?.passwordResetRequest) return { label: 'Minta reset password', tone: 'is-reset' };
  const accountStatus = String(user?.accountStatus || 'active');
  if (accountStatus === 'pending') return { label: 'Menunggu persetujuan', tone: 'is-warning' };
  if (accountStatus === 'suspended') return { label: 'Dinonaktifkan', tone: 'is-danger' };
  if (user?.mustChangePassword) return { label: 'Wajib ganti password', tone: 'is-warning' };
  return { label: user?.hasPassword ? 'Aktif' : 'Belum ada password', tone: 'is-active' };
}

function managedActionIcon(name) {
  const icons = {
    activate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    suspend: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>',
    reset: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/></svg>',
    delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>'
  };
  return icons[name] || '';
}

function setManagementMessage(message = '', tone = 'info', sticky = false) {
  if (userManagementState.messageTimer) {
    window.clearTimeout(userManagementState.messageTimer);
    userManagementState.messageTimer = null;
  }
  userManagementState.message = message;
  userManagementState.tone = tone;
  renderUserManagementPage();
  if (message && !sticky) {
    userManagementState.messageTimer = window.setTimeout(() => {
      userManagementState.message = '';
      renderUserManagementPage();
    }, 3600);
  }
}

function matchesManagedUserSearch(user, searchValue) {
  const search = String(searchValue || '').trim().toLocaleLowerCase('id-ID');
  if (!search) return true;
  const phoneSearch = search.replace(/\D/g, '');
  const name = String(user?.name || '').toLocaleLowerCase('id-ID');
  const phone = String(user?.phone || user?.phoneDisplay || '').replace(/\D/g, '');
  const localPhone = phone.startsWith('62') ? `0${phone.slice(2)}` : phone;
  return name.includes(search)
    || Boolean(phoneSearch && (phone.includes(phoneSearch) || localPhone.includes(phoneSearch)));
}

function applyManagementPayload(payload) {
  const receivedUsers = Array.isArray(payload?.users) ? payload.users : [];
  const matchingUsers = receivedUsers.filter((user) => matchesManagedUserSearch(user, userManagementState.search));
  const serverAlreadyFiltered = Boolean(payload?.pagination) && matchingUsers.length === receivedUsers.length;

  userManagementState.stats = payload?.stats || null;
  if (serverAlreadyFiltered) {
    userManagementState.users = matchingUsers;
    userManagementState.pagination = payload.pagination;
  } else {
    const totalItems = matchingUsers.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / managedUsersPageSize));
    const page = Math.min(Math.max(1, userManagementState.page), totalPages);
    userManagementState.users = matchingUsers.slice(
      (page - 1) * managedUsersPageSize,
      page * managedUsersPageSize
    );
    userManagementState.pagination = {
      page,
      pageSize: managedUsersPageSize,
      totalItems,
      totalPages
    };
  }
  userManagementState.page = userManagementState.pagination.page;
  renderUserManagementPage();
}

function managedUserQueryString() {
  const searchParams = new URLSearchParams({ page: String(userManagementState.page) });
  const search = userManagementState.search.trim();
  if (search) searchParams.set('q', search);
  return searchParams.toString();
}

function renderManagementFlash() {
  const flash = document.getElementById('userManagementFlash');
  if (!flash) return;
  if (!userManagementState.message) {
    flash.hidden = true;
    flash.textContent = '';
    flash.className = 'status-message management-flash';
    return;
  }
  flash.hidden = false;
  flash.textContent = userManagementState.message;
  flash.className = `status-message management-flash is-${userManagementState.tone}`;
}

function renderManagedUsers() {
  const counter = document.getElementById('managedUserCount');
  const panel = document.getElementById('managedUsersPanel');
  if (!counter || !panel) return;

  const pagination = userManagementState.pagination;
  const resetRequestCount = Math.max(0, Number(userManagementState.stats?.passwordResetRequestCount || 0));
  counter.textContent = userManagementState.loading
    ? 'Memuat...'
    : `${pagination.totalItems} user${resetRequestCount ? ` · ${resetRequestCount} minta reset` : ''}`;
  if (userManagementState.loading && !userManagementState.users.length) {
    panel.innerHTML = '<div class="community-empty">Menyiapkan daftar user...</div>';
    return;
  }
  if (!userManagementState.users.length) {
    panel.innerHTML = `<div class="community-empty">${userManagementState.search.trim() ? 'User tidak ditemukan. Coba nama atau nomor HP lain.' : 'Belum ada user yang terdaftar.'}</div>`;
    return;
  }

  const firstItem = ((pagination.page - 1) * pagination.pageSize) + 1;
  const lastItem = firstItem + userManagementState.users.length - 1;

  panel.innerHTML = `
    <div class="managed-user-table-wrap">
      <table class="managed-user-table">
        <colgroup>
          <col class="managed-col-name">
          <col class="managed-col-phone">
          <col class="managed-col-status">
          <col class="managed-col-date">
          <col class="managed-col-login">
          <col class="managed-col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Nomor WhatsApp</th>
            <th>Status</th>
            <th>Terdaftar</th>
            <th>Login Terakhir</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${userManagementState.users.map((user) => {
            const isCurrentUser = user.id === communityState.me?.id;
            const accountStatus = String(user.accountStatus || 'active');
            const statusMeta = managedAccountStatusMeta(user);
            const nextAccountStatus = accountStatus === 'active' ? 'suspended' : 'active';
            const resetRequest = user.passwordResetRequest || null;
            return `
              <tr class="${resetRequest ? 'has-reset-request' : ''}">
                <td data-label="Nama">
                  <strong>${escapeHtml(user.name)}</strong>
                  ${resetRequest ? `<span class="managed-reset-request"><b>${escapeHtml(resetRequest.code)}</b> · ${escapeHtml(formatManagementDate(resetRequest.requestedAt))}</span>` : ''}
                </td>
                <td data-label="Nomor WhatsApp">${escapeHtml(user.phoneDisplay)}</td>
                <td data-label="Status"><span class="managed-status ${statusMeta.tone}">${statusMeta.label}</span></td>
                <td class="managed-date-cell" data-label="Terdaftar">${escapeHtml(formatManagementDate(user.createdAt))}</td>
                <td class="managed-date-cell" data-label="Login Terakhir">${escapeHtml(formatManagementDate(user.lastLoginAt))}</td>
                <td data-label="Aksi">
                  ${isCurrentUser ? `
                    <span class="managed-owner-note">Akun Anda</span>
                  ` : `
                    <div class="managed-table-actions">
                      <button class="btn-compact managed-icon-action managed-account-status-button ${nextAccountStatus === 'active' ? 'is-activate' : 'is-suspend'}" type="button" aria-label="${nextAccountStatus === 'active' ? 'Aktifkan' : 'Suspend'} akun ${escapeHtml(user.name)}" title="${nextAccountStatus === 'active' ? 'Aktifkan akun' : 'Suspend akun'}" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}" data-next-status="${nextAccountStatus}" onclick="requestManagedAccountStatus(this)">${managedActionIcon(nextAccountStatus === 'active' ? 'activate' : 'suspend')}</button>
                      ${accountStatus === 'active' ? `<button class="btn-compact btn-main managed-icon-action ${resetRequest ? 'managed-process-reset-button' : ''}" type="button" aria-label="${resetRequest ? 'Proses permintaan reset' : 'Reset password'} ${escapeHtml(user.name)}" title="${resetRequest ? 'Proses permintaan reset' : 'Reset password'}" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}" data-user-phone="${escapeHtml(user.phoneDisplay)}" onclick="requestManagedPasswordReset(this)">${managedActionIcon('reset')}</button>` : ''}
                      <button class="btn-compact managed-icon-action managed-delete-button" type="button" aria-label="Hapus akun ${escapeHtml(user.name)}" title="Hapus akun" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.name)}" onclick="requestManagedUserDelete(this)">${managedActionIcon('delete')}</button>
                    </div>
                  `}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="managed-user-pagination">
      <p>Menampilkan ${firstItem}-${lastItem} dari ${pagination.totalItems} user</p>
      <div class="managed-pagination-actions">
        <button class="btn-compact managed-pagination-button" type="button" aria-label="Halaman sebelumnya" title="Halaman sebelumnya" onclick="changeManagedUserPage(-1)" ${pagination.page <= 1 || userManagementState.loading ? 'disabled' : ''}><span aria-hidden="true">&#8592;</span></button>
        <span>Halaman ${pagination.page} dari ${pagination.totalPages}</span>
        <button class="btn-compact managed-pagination-button" type="button" aria-label="Halaman berikutnya" title="Halaman berikutnya" onclick="changeManagedUserPage(1)" ${pagination.page >= pagination.totalPages || userManagementState.loading ? 'disabled' : ''}><span aria-hidden="true">&#8594;</span></button>
      </div>
    </div>
  `;
}

function syncManagedUserSearchControls() {
  const input = document.getElementById('managedUserSearchInput');
  const clearButton = document.getElementById('clearManagedUserSearchButton');
  if (input && document.activeElement !== input && input.value !== userManagementState.search) {
    input.value = userManagementState.search;
  }
  if (clearButton) clearButton.hidden = !userManagementState.search.trim();
}

function renderUserManagementPage() {
  renderManagementFlash();
  renderManagedUsers();
  syncManagedUserSearchControls();
}

function ensureUserManagementUi() {
  const nav = document.querySelector('.site-nav');
  const mobileManageButton = document.getElementById('mobileManageUsersButton');
  if (mobileManageButton) mobileManageButton.hidden = !hasUserManagementAccess();
  const existingButton = nav?.querySelector('[data-nav="manage-users"]');
  const existingPage = document.getElementById('userManagementPage');

  if (!hasUserManagementAccess()) {
    existingButton?.remove();
    if (existingPage?.classList.contains('is-active')) showHome();
    existingPage?.remove();
    delete pages.userManagement;
    userManagementState.users = [];
    userManagementState.stats = null;
    userManagementState.search = '';
    userManagementState.page = 1;
    userManagementState.pagination = { page: 1, pageSize: managedUsersPageSize, totalItems: 0, totalPages: 1 };
    if (userManagementState.searchTimer) {
      window.clearTimeout(userManagementState.searchTimer);
      userManagementState.searchTimer = null;
    }
    return;
  }

  if (nav && !existingButton) {
    const button = document.createElement('button');
    button.className = 'nav-chip';
    button.type = 'button';
    button.dataset.nav = 'manage-users';
    button.textContent = 'Kelola User';
    button.addEventListener('click', openUserManagement);
    nav.insertBefore(button, nav.querySelector('[data-nav=logout]'));
  }

  if (!existingPage) {
    const main = document.querySelector('.site-main');
    if (!main) return;
    const section = document.createElement('section');
    section.id = 'userManagementPage';
    section.className = 'page page-user-management';
    section.setAttribute('aria-label', 'Kelola user aplikasi');
    section.innerHTML = `
      <div class="management-shell community-shell">
        <div class="dashboard-hero management-hero">
          <div>
            <p class="section-kicker">Akses Pemilik</p>
            <h1 class="main-title"><span class="title-logo">IQ</span> Kelola User</h1>
          </div>
        </div>
        <div id="userManagementFlash" class="status-message management-flash" hidden></div>
        <section class="community-panel management-panel">
          <div class="community-panel-header">
            <div>
              <p class="section-kicker">Akun</p>
              <h2 class="community-panel-title">Daftar User Aplikasi</h2>
            </div>
            <span id="managedUserCount" class="community-panel-count">0 user</span>
          </div>
          <form class="management-toolbar" onsubmit="return submitManagedUserSearch(event)">
            <label class="management-search-field" for="managedUserSearchInput">
              <input id="managedUserSearchInput" class="community-input management-search-input" type="search" aria-label="Cari user berdasarkan nama atau nomor HP" placeholder="Cari nama atau nomor HP" autocomplete="off" oninput="scheduleManagedUserSearch(event)">
            </label>
            <button class="btn-compact btn-main management-search-button" type="submit">Cari</button>
            <button id="clearManagedUserSearchButton" class="btn-compact management-clear-search" type="button" onclick="clearManagedUserSearch()" hidden>Hapus Pencarian</button>
          </form>
          <div id="managedUsersPanel"></div>
        </section>
      </div>
    `;
    const mushafPage = document.getElementById('mushafPage');
    if (mushafPage) main.insertBefore(section, mushafPage);
    else main.appendChild(section);
    pages.userManagement = section;
  }
}

async function loadManagedUsers() {
  if (!hasUserManagementAccess()) return;
  const requestId = ++userManagementState.requestId;
  userManagementState.loading = true;
  renderUserManagementPage();
  try {
    const payload = await apiFetch(`/manage/users?${managedUserQueryString()}`);
    if (requestId !== userManagementState.requestId) return;
    applyManagementPayload(payload);
  } catch (error) {
    if (requestId !== userManagementState.requestId) return;
    if (error.status === 401 || error.status === 403) {
      ensureUserManagementUi();
    }
    setManagementMessage(error.message || 'Daftar user belum bisa dimuat.', 'danger', true);
  } finally {
    if (requestId !== userManagementState.requestId) return;
    userManagementState.loading = false;
    renderUserManagementPage();
  }
}

function scheduleManagedUserSearch(event) {
  userManagementState.search = String(event?.currentTarget?.value || '');
  userManagementState.page = 1;
  syncManagedUserSearchControls();
  if (userManagementState.searchTimer) window.clearTimeout(userManagementState.searchTimer);
  userManagementState.searchTimer = window.setTimeout(() => {
    userManagementState.searchTimer = null;
    loadManagedUsers();
  }, 300);
}

function submitManagedUserSearch(event) {
  event.preventDefault();
  if (userManagementState.searchTimer) {
    window.clearTimeout(userManagementState.searchTimer);
    userManagementState.searchTimer = null;
  }
  userManagementState.page = 1;
  loadManagedUsers();
  return false;
}

function clearManagedUserSearch() {
  if (userManagementState.searchTimer) {
    window.clearTimeout(userManagementState.searchTimer);
    userManagementState.searchTimer = null;
  }
  userManagementState.search = '';
  userManagementState.page = 1;
  const input = document.getElementById('managedUserSearchInput');
  if (input) input.value = '';
  syncManagedUserSearchControls();
  loadManagedUsers();
}

function changeManagedUserPage(direction) {
  const nextPage = userManagementState.pagination.page + Number(direction || 0);
  if (nextPage < 1 || nextPage > userManagementState.pagination.totalPages || userManagementState.loading) return;
  userManagementState.page = nextPage;
  loadManagedUsers();
}

function openUserManagement() {
  if (!hasUserManagementAccess()) {
    showHome();
    return;
  }
  ensureUserManagementUi();
  setActivePage('userManagement', 'manage-users');
  loadManagedUsers();
}

async function requestManagedPasswordReset(button) {
  const userId = String(button?.dataset?.userId || '').trim();
  if (!userId) return;

  userManagementState.loading = true;
  renderUserManagementPage();
  try {
    const payload = await apiFetch(`/manage/users/${encodeURIComponent(userId)}/reset-password?${managedUserQueryString()}`, { method: 'POST' });
    applyManagementPayload(payload);
    openWhatsAppDelivery(null, payload.delivery);
    setManagementMessage(payload.message || 'WhatsApp sudah dibuka. Tekan Kirim untuk mengirim password sementara.', 'success', true);
  } catch (error) {
    setManagementMessage(error.message || 'Password sementara belum bisa dibuat.', 'danger', true);
  } finally {
    userManagementState.loading = false;
    renderUserManagementPage();
  }
}

async function requestManagedAccountStatus(button) {
  const userId = String(button?.dataset?.userId || '').trim();
  const userName = String(button?.dataset?.userName || 'user').trim();
  const nextStatus = String(button?.dataset?.nextStatus || '').trim();
  if (!userId || !['active', 'suspended'].includes(nextStatus)) return;

  const activating = nextStatus === 'active';
  if (!activating) {
    const confirmed = window.confirm(`Suspend akun ${userName}? Semua sesi aktif user akan dihentikan.`);
    if (!confirmed) return;
  }

  userManagementState.loading = true;
  renderUserManagementPage();
  try {
    const payload = await apiFetch(`/manage/users/${encodeURIComponent(userId)}/status?${managedUserQueryString()}`, {
      method: 'PUT',
      body: { accountStatus: nextStatus }
    });
    applyManagementPayload(payload);
    if (activating) openWhatsAppDelivery(null, payload.delivery);
    setManagementMessage(payload.message || (activating ? 'Akun berhasil diaktifkan.' : 'Akun berhasil dinonaktifkan.'), 'success', true);
  } catch (error) {
    setManagementMessage(error.message || 'Status akun belum berhasil diperbarui.', 'danger', true);
  } finally {
    userManagementState.loading = false;
    renderUserManagementPage();
  }
}

async function requestManagedUserDelete(button) {
  const userId = String(button?.dataset?.userId || '').trim();
  const userName = String(button?.dataset?.userName || 'user').trim();
  if (!userId) return;
  const confirmed = window.confirm(`Hapus akun ${userName}? Tindakan ini akan menghapus sesi, progress, pertemanan, dan keanggotaan group akun tersebut.`);
  if (!confirmed) return;

  userManagementState.loading = true;
  renderUserManagementPage();
  try {
    const payload = await apiFetch(`/manage/users/${encodeURIComponent(userId)}?${managedUserQueryString()}`, { method: 'DELETE' });
    applyManagementPayload(payload);
    setManagementMessage(payload.message || 'Akun berhasil dihapus.', 'success');
  } catch (error) {
    setManagementMessage(error.message || 'Akun belum bisa dihapus.', 'danger', true);
  } finally {
    userManagementState.loading = false;
    renderUserManagementPage();
  }
}

function syncUserManagementAccess() {
  ensureUserManagementUi();
  if (hasUserManagementAccess()) loadManagedUsers();
}

window.openUserManagement = openUserManagement;
window.requestManagedAccountStatus = requestManagedAccountStatus;
window.requestManagedPasswordReset = requestManagedPasswordReset;
window.requestManagedUserDelete = requestManagedUserDelete;
window.scheduleManagedUserSearch = scheduleManagedUserSearch;
window.submitManagedUserSearch = submitManagedUserSearch;
window.clearManagedUserSearch = clearManagedUserSearch;
window.changeManagedUserPage = changeManagedUserPage;
window.syncUserManagementAccess = syncUserManagementAccess;
window.localStorage.removeItem('iqro_admin_token');

syncUserManagementAccess();
