import { $, escapeHtml, state } from './state.js';
import { addLog } from './logger.js';
import { api, saveHistory } from './api.js';
import { hasPermission, roleLabel } from './auth.js';

export async function loadUsers() {
  if (!hasPermission('manage_users')) return;
  try {
    const data = await api('/users');
    state.users = data.users || [];
    if ($('user-total')) $('user-total').textContent = state.users.length;

    if (state.users.length === 0) {
      $('user-list').innerHTML = `<div class="empty-state">No hay operadores registrados</div>`;
      return;
    }

    $('user-list').innerHTML = state.users.map((user) => `
      <div class="item-row">
        <div><div class="row-title">${escapeHtml(user.username)}</div><div class="row-meta">${escapeHtml(roleLabel(user.role))} · ${user.active ? 'activo' : 'inactivo'}</div></div>
        <div class="flex-row">
          <button class="ghost-btn" data-toggle-user="${user.id}">${user.active ? 'Desactivar' : 'Activar'}</button>
          <button class="ghost-btn" style="color: var(--accent-offline-strong); padding: 4px;" data-delete-user="${user.id}"><span class="material-symbols-outlined" style="font-size: 18px;">delete</span></button>
        </div>
      </div>`).join('');
  } catch (err) {
    $('user-list').innerHTML = `<div class="empty-state" style="color: var(--accent-offline-strong);">Error al cargar operadores: ${escapeHtml(err.message)}</div>`;
  }
}

export async function createUser(event) {
  event.preventDefault();
  try {
    await api('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('new-username').value.trim(),
        password: $('new-password').value,
        role: $('new-role').value
      })
    });
    event.target.reset();
    await loadUsers();
    saveHistory('user', 'Usuario creado');
    addLog('Usuario creado exitosamente', 'ok');
  } catch (error) {
    addLog(`Error al crear usuario: ${error.message}`, 'err');
  }
}

export async function toggleUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  try {
    await api(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !user.active })
    });
    await loadUsers();
    addLog(`Usuario ${user.username} ${!user.active ? 'activado' : 'desactivado'}`, 'ok');
  } catch (error) {
    addLog(`Error al modificar usuario: ${error.message}`, 'err');
  }
}

export async function deleteUser(id) {
  if (!confirm('¿Seguro que deseas eliminar este operador permanentemente?')) return;
  try {
    await api(`/users/${id}`, { method: 'DELETE' });
    await loadUsers();
    saveHistory('user', 'Usuario eliminado');
    addLog('Operador eliminado', 'ok');
  } catch (error) {
    addLog(`Error al eliminar usuario: ${error.message}`, 'err');
  }
}
