import { beforeEach, describe, expect, it } from 'vitest';
import { LocalAccounts, LocalPlanRequests, StoreError, type ModelBuilder, type NewPlanRequest } from '../src/site/store';

/** A stand-in for the browser's localStorage. */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const plan: NewPlanRequest = {
  title: 'Our new house',
  notes: 'Two floors.',
  plot: '35 x 55 ft',
  floors: 2,
  plan: { name: 'plan.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' },
};

describe('accounts', () => {
  let storage: MemoryStorage;
  let accounts: LocalAccounts;
  beforeEach(() => {
    storage = new MemoryStorage();
    accounts = new LocalAccounts(storage);
  });

  it('signs up, and is then logged in', async () => {
    const account = await accounts.signUp(' Asha ', 'Asha@Example.com', 'secret1');
    expect(account).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    expect(accounts.current()?.id).toBe(account.id);
  });

  it('never stores the password itself', async () => {
    await accounts.signUp('Asha', 'asha@example.com', 'secret-password');
    expect(JSON.stringify([...Array(storage.length)].map((_, i) => storage.getItem(storage.key(i)!)))).not.toContain('secret-password');
  });

  it('refuses a second account with the same email', async () => {
    await accounts.signUp('Asha', 'asha@example.com', 'secret1');
    await expect(accounts.signUp('Other', 'ASHA@example.com', 'secret2')).rejects.toThrow(StoreError);
  });

  it('refuses a bad email, a short password and an empty name', async () => {
    await expect(accounts.signUp('Asha', 'not-an-email', 'secret1')).rejects.toThrow(/email/);
    await expect(accounts.signUp('Asha', 'asha@example.com', '123')).rejects.toThrow(/6 characters/);
    await expect(accounts.signUp('  ', 'asha@example.com', 'secret1')).rejects.toThrow(/name/);
  });

  it('logs out and back in with the right password only', async () => {
    const account = await accounts.signUp('Asha', 'asha@example.com', 'secret1');
    accounts.logOut();
    expect(accounts.current()).toBeNull();
    await expect(accounts.logIn('asha@example.com', 'wrong')).rejects.toThrow(StoreError);
    await expect(accounts.logIn('nobody@example.com', 'secret1')).rejects.toThrow(StoreError);
    expect((await accounts.logIn('asha@example.com', 'secret1')).id).toBe(account.id);
    expect(accounts.current()?.id).toBe(account.id);
  });
});

describe('plan requests', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('saves a request as received, for its owner only', async () => {
    const requests = new LocalPlanRequests(storage);
    const saved = await requests.submit('owner-1', plan);
    expect(saved.status).toBe('received');
    expect(requests.list('owner-1').map((r) => r.id)).toEqual([saved.id]);
    expect(requests.list('owner-2')).toEqual([]);
  });

  it('refuses a request with no name, no picture or a silly number of floors', async () => {
    const requests = new LocalPlanRequests(storage);
    await expect(requests.submit('o', { ...plan, title: ' ' })).rejects.toThrow(/name/);
    await expect(requests.submit('o', { ...plan, plan: { name: '', dataUrl: '' } })).rejects.toThrow(/picture/);
    await expect(requests.submit('o', { ...plan, floors: 0 })).rejects.toThrow(/Floors/);
  });

  it('moves a request on and attaches the model', async () => {
    const requests = new LocalPlanRequests(storage);
    const saved = await requests.submit('o', plan);
    requests.update(saved.id, { status: 'building' });
    const ready = requests.update(saved.id, { status: 'ready', modelHomeId: 'villa-d' });
    expect(ready).toMatchObject({ status: 'ready', modelHomeId: 'villa-d', title: 'Our new house' });
    expect(requests.list('o')[0].status).toBe('ready');
  });

  it('lets a generator finish a request on the spot', async () => {
    const instant: ModelBuilder = { start: async () => ({ status: 'ready', modelHomeId: 'villa-d' }) };
    const saved = await new LocalPlanRequests(storage, instant).submit('o', plan);
    expect(saved).toMatchObject({ status: 'ready', modelHomeId: 'villa-d' });
  });

  it('removes a request', async () => {
    const requests = new LocalPlanRequests(storage);
    const saved = await requests.submit('o', plan);
    requests.remove(saved.id);
    expect(requests.list('o')).toEqual([]);
  });
});
