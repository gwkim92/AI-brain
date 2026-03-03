import type { AuthUserWithPasswordRecord } from '../types';
import type { MemoryStoreState } from './state';

type InitializeMemoryStoreDeps = {
  state: MemoryStoreState;
  defaultUserId: string;
  defaultUserEmail: string;
  nowIso: () => string;
};

export async function initializeMemoryStore({
  state,
  defaultUserId,
  defaultUserEmail,
  nowIso
}: InitializeMemoryStoreDeps): Promise<void> {
  const now = nowIso();
  const existingDefault = state.users.get(defaultUserId);
  if (!existingDefault) {
    const defaultUser: AuthUserWithPasswordRecord = {
      id: defaultUserId,
      email: defaultUserEmail,
      displayName: 'Jarvis Local User',
      role: 'admin',
      passwordHash: null,
      createdAt: now,
      updatedAt: now
    };
    state.users.set(defaultUser.id, defaultUser);
    state.userIdByEmail.set(defaultUser.email, defaultUser.id);
  }
}
