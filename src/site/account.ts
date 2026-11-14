/** The account page: the visitor's plans and where each one stands. */
import { HOMES } from '../homes';
import { accounts, formatDate, requests, requireAccount, toast } from './common';
import sketchData from './plan-sketch.json';
import { sketchSvg, type SketchData } from './sketch';
import { STATUS_STEPS, STATUS_TEXT, type PlanRequest, type RequestStatus } from './store';

const account = requireAccount();
const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** A new element with a class and text, the way `document.createElement` should have been. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The tape with its three marks; the pink block sits on the one the plan has reached. */
function progress(status: RequestStatus): HTMLElement {
  const at = STATUS_STEPS.indexOf(status === 'needs-info' ? 'building' : status);
  const bar = el('div', 'progress');
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Status: ${STATUS_TEXT[status].label}`);
  STATUS_STEPS.forEach((step, i) => {
    bar.append(el('span', i < at ? 'done' : i === at ? 'now' : '', STATUS_TEXT[step].label));
  });
  return bar;
}

function planRow(request: PlanRequest): HTMLLIElement {
  const row = el('li', 'sheet plan');
  const thumb = el('img', 'thumb');
  thumb.src = request.plan.dataUrl;
  thumb.alt = `The plan sent for ${request.title}`;

  const body = el('div');
  body.append(el('h2', '', request.title));
  const details = [`Sent ${formatDate(request.createdAt)}`, `${request.floors} ${request.floors === 1 ? 'floor' : 'floors'}`];
  if (request.plot) details.push(`plot ${request.plot}`);
  body.append(el('p', 'meta', details.join(' · ')));
  body.append(progress(request.status));
  if (request.status === 'needs-info') body.append(el('span', 'status-ask', STATUS_TEXT['needs-info'].label));
  body.append(el('p', 'message', request.message || STATUS_TEXT[request.status].about));

  const acts = el('div', 'acts');
  if (request.status === 'ready' && request.modelHomeId) {
    const open = el('a', 'btn btn-line', 'Step inside');
    open.href = `studio.html?home=${encodeURIComponent(request.modelHomeId)}`;
    acts.append(open);
  }
  const withdraw = el('button', 'text-btn', 'Withdraw this plan');
  withdraw.type = 'button';
  withdraw.addEventListener('click', () => {
    // Asked twice in place, rather than in a dialog: the second click does it.
    if (withdraw.dataset.sure) {
      requests.remove(request.id);
      render();
      toast(`"${request.title}" was withdrawn.`);
    } else {
      withdraw.dataset.sure = '1';
      withdraw.textContent = 'Click again to withdraw';
      window.setTimeout(() => {
        delete withdraw.dataset.sure;
        withdraw.textContent = 'Withdraw this plan';
      }, 4000);
    }
  });
  acts.append(withdraw);
  row.append(thumb, body, acts);
  return row;
}

/** Our side, until there is a backend: a status and a model per plan. */
function deskRow(request: PlanRequest): HTMLTableRowElement {
  const row = el('tr');
  row.append(el('td', '', request.title));

  const status = el('select');
  status.setAttribute('aria-label', `Status of ${request.title}`);
  for (const value of ['received', 'building', 'needs-info', 'ready'] as const) {
    const option = el('option', '', STATUS_TEXT[value].label);
    option.value = value;
    option.selected = value === request.status;
    status.append(option);
  }

  const model = el('select');
  model.setAttribute('aria-label', `Model for ${request.title}`);
  for (const home of HOMES) {
    const option = el('option', '', home.design ? `${home.title}, ${home.design.name}` : home.title);
    option.value = home.id;
    option.selected = home.id === (request.modelHomeId ?? 'villa-d');
    model.append(option);
  }

  const save = (): void => {
    const next = status.value as RequestStatus;
    requests.update(request.id, {
      status: next,
      modelHomeId: next === 'ready' ? model.value : undefined,
      message: next === 'needs-info' ? 'Which floor is this drawing, and which way does the plot face? Reply and we will carry on.' : undefined,
    });
    render();
  };
  status.addEventListener('change', save);
  model.addEventListener('change', save);

  const statusCell = el('td');
  statusCell.append(status);
  const modelCell = el('td');
  modelCell.append(model);
  row.append(statusCell, modelCell);
  return row;
}

function render(): void {
  if (!account) return;
  const list = requests.list(account.id);
  byId('plans').replaceChildren(...list.map(planRow));
  byId('empty').hidden = list.length > 0;
  byId('desk').hidden = list.length === 0;
  byId('desk-rows').replaceChildren(...list.map(deskRow));
}

if (account) {
  byId('account').hidden = false;
  byId('hello').textContent = `${account.name.split(' ')[0]}'s plans`;
  byId('who').textContent = `Logged in as ${account.email}`;
  byId('empty-sketch').innerHTML = sketchSvg(sketchData as unknown as SketchData, {
    paper: '#fff', ink: '#27324f', note: '#b3123f', hand: 'Kalam, cursive', sheet: false,
  });
  byId('log-out').addEventListener('click', () => {
    accounts.logOut();
    window.location.assign('./');
  });
  render();
  if (new URLSearchParams(window.location.search).has('sent')) {
    toast('Your plan is in. This page shows where it stands.');
    window.history.replaceState(null, '', 'account.html');
  }
}
