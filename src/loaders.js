import { loadUsers } from './users.js';
import { loadAutomations } from './automations.js';
import { loadHistory } from './history.js';
import { loadDevices } from './devices.js';

export async function loadAll() {
  await Promise.allSettled([loadUsers(), loadAutomations(), loadHistory(), loadDevices()]);
}
