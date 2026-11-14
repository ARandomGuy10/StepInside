/**
 * Accounts and plan requests.
 *
 * There is no backend yet, so everything here is kept in the visitor's own
 * browser (localStorage). Nothing leaves the machine. The pages only talk to
 * the two interfaces below, `Accounts` and `PlanRequests`, so a real backend
 * can replace `LocalAccounts` and `LocalPlanRequests` without touching them.
 *
 * (For a Java reader: `Storage` is the browser's small key-value store,
 * a `Map<String, String>` that survives page reloads.)
 */

export interface Account {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export type RequestStatus = 'received' | 'building' | 'needs-info' | 'ready';

/** The order a request moves through. `needs-info` is a side step from `building`. */
export const STATUS_STEPS: readonly RequestStatus[] = ['received', 'building', 'ready'];

export const STATUS_TEXT: Record<RequestStatus, { label: string; about: string }> = {
  received: { label: 'Received', about: 'We have your plan and will start on it.' },
  building: { label: 'Being built', about: 'We are building your home in 3D.' },
  'needs-info': { label: 'We have a question', about: 'We need something from you before we can go on.' },
  ready: { label: 'Ready', about: 'Your home is ready to walk through.' },
};

export interface PlanImage {
  name: string;
  /** The picture itself, as a data: address, scaled down to fit in the browser's store. */
  dataUrl: string;
}

export interface PlanRequest {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  /** Plot size as the visitor typed it, such as "35 x 55 ft". */
  plot: string;
  floors: number;
  plan: PlanImage;
  status: RequestStatus;
  /** A note from us to the owner, shown with the status. */
  message?: string;
  /** The finished model: the `id` of a home in `src/homes.ts`. Set when ready. */
  modelHomeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewPlanRequest {
  title: string;
  notes: string;
  plot: string;
  floors: number;
  plan: PlanImage;
}

/** What building a model from a request comes back with. */
export interface BuildResult {
  status: RequestStatus;
  message?: string;
  modelHomeId?: string;
}

/**
 * Whoever turns a request into a model. Today that is a person, so
 * `ManualBuilder` only acknowledges the request. An on-demand generator
 * driven by an API key implements this same interface: its `start` sends
 * the plan to the server (the key stays on the server, never in the page)
 * and returns `building`, or `ready` with the model once it is done.
 */
export interface ModelBuilder {
  start(request: PlanRequest): Promise<BuildResult>;
}

export class ManualBuilder implements ModelBuilder {
  async start(): Promise<BuildResult> {
    return { status: 'received' };
  }
}

export interface Accounts {
  signUp(name: string, email: string, password: string): Promise<Account>;
  logIn(email: string, password: string): Promise<Account>;
  logOut(): void;
  current(): Account | null;
}

export interface PlanRequests {
  list(ownerId: string): PlanRequest[];
  submit(ownerId: string, request: NewPlanRequest): Promise<PlanRequest>;
  /** Our side of the work: move a request on, leave a note, attach the model. */
  update(id: string, change: Partial<Pick<PlanRequest, 'status' | 'message' | 'modelHomeId'>>): PlanRequest;
  remove(id: string): void;
}

/** A problem the visitor can fix, with a message fit to show them. */
export class StoreError extends Error {}

const ACCOUNTS = 'stepinside.accounts';
const SESSION = 'stepinside.session';
const REQUESTS = 'stepinside.requests';

interface StoredAccount extends Account {
  salt: string;
  hash: string;
}

function read<T>(storage: Storage, key: string): T[] {
  try {
    const list = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(storage: Storage, key: string, list: unknown[]): void {
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch {
    throw new StoreError('This browser has no room left to save that. Try a smaller picture of the plan.');
  }
}

const newId = (): string => crypto.randomUUID();

/** A one-way fingerprint of the password, so the password itself is never stored. */
async function fingerprint(password: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const tidyEmail = (email: string): string => email.trim().toLowerCase();

export class LocalAccounts implements Accounts {
  constructor(private readonly storage: Storage) {}

  async signUp(name: string, email: string, password: string): Promise<Account> {
    const cleanName = name.trim();
    const cleanEmail = tidyEmail(email);
    if (!cleanName) throw new StoreError('Tell us your name.');
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new StoreError('That email address does not look right.');
    if (password.length < 6) throw new StoreError('Use a password of at least 6 characters.');
    const accounts = read<StoredAccount>(this.storage, ACCOUNTS);
    if (accounts.some((a) => a.email === cleanEmail)) {
      throw new StoreError('There is already an account with that email. Log in instead.');
    }
    const salt = newId();
    const account: StoredAccount = {
      id: newId(),
      name: cleanName,
      email: cleanEmail,
      createdAt: new Date().toISOString(),
      salt,
      hash: await fingerprint(password, salt),
    };
    write(this.storage, ACCOUNTS, [...accounts, account]);
    this.storage.setItem(SESSION, account.id);
    return strip(account);
  }

  async logIn(email: string, password: string): Promise<Account> {
    const account = read<StoredAccount>(this.storage, ACCOUNTS).find((a) => a.email === tidyEmail(email));
    // One message for both cases, so the form does not reveal which emails have accounts.
    if (!account || (await fingerprint(password, account.salt)) !== account.hash) {
      throw new StoreError('That email and password do not match an account in this browser.');
    }
    this.storage.setItem(SESSION, account.id);
    return strip(account);
  }

  logOut(): void {
    this.storage.removeItem(SESSION);
  }

  current(): Account | null {
    const id = this.storage.getItem(SESSION);
    const account = id ? read<StoredAccount>(this.storage, ACCOUNTS).find((a) => a.id === id) : undefined;
    return account ? strip(account) : null;
  }
}

function strip({ id, name, email, createdAt }: StoredAccount): Account {
  return { id, name, email, createdAt };
}

export class LocalPlanRequests implements PlanRequests {
  constructor(
    private readonly storage: Storage,
    private readonly builder: ModelBuilder = new ManualBuilder(),
  ) {}

  list(ownerId: string): PlanRequest[] {
    return read<PlanRequest>(this.storage, REQUESTS)
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async submit(ownerId: string, request: NewPlanRequest): Promise<PlanRequest> {
    const title = request.title.trim();
    if (!title) throw new StoreError('Give the plan a name, such as "Our new house".');
    if (!request.plan.dataUrl) throw new StoreError('Add a picture of your plan.');
    if (!Number.isInteger(request.floors) || request.floors < 1 || request.floors > 6) {
      throw new StoreError('Floors should be a number from 1 to 6.');
    }
    const now = new Date().toISOString();
    const saved: PlanRequest = {
      id: newId(),
      ownerId,
      title,
      notes: request.notes.trim(),
      plot: request.plot.trim(),
      floors: request.floors,
      plan: request.plan,
      status: 'received',
      createdAt: now,
      updatedAt: now,
    };
    write(this.storage, REQUESTS, [...read<PlanRequest>(this.storage, REQUESTS), saved]);
    // Hand it to whoever builds the model. A person today; a generator later.
    const result = await this.builder.start(saved);
    return result.status === saved.status && !result.message && !result.modelHomeId ? saved : this.update(saved.id, result);
  }

  update(id: string, change: Partial<Pick<PlanRequest, 'status' | 'message' | 'modelHomeId'>>): PlanRequest {
    const all = read<PlanRequest>(this.storage, REQUESTS);
    const found = all.find((r) => r.id === id);
    if (!found) throw new StoreError('That request is no longer here.');
    const next: PlanRequest = { ...found, ...change, updatedAt: new Date().toISOString() };
    write(this.storage, REQUESTS, all.map((r) => (r.id === id ? next : r)));
    return next;
  }

  remove(id: string): void {
    write(this.storage, REQUESTS, read<PlanRequest>(this.storage, REQUESTS).filter((r) => r.id !== id));
  }
}

/** The services the pages use. Swap these two lines when a backend exists. */
export function services(): { accounts: Accounts; requests: PlanRequests } {
  return { accounts: new LocalAccounts(window.localStorage), requests: new LocalPlanRequests(window.localStorage) };
}
