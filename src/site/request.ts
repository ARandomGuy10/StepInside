/** The "send your plan" page: a picture of the plan, a name and some notes. */
import { requests, requireAccount } from './common';
import { StoreError, type PlanImage } from './store';

const account = requireAccount();
const page = document.getElementById('request')!;
const form = document.getElementById('request-form') as HTMLFormElement;
const error = document.getElementById('form-error')!;
const drop = document.getElementById('drop')!;
const file = document.getElementById('plan-file') as HTMLInputElement;
const preview = document.getElementById('drop-preview') as HTMLImageElement;
const field = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T;

let plan: PlanImage | null = null;

/**
 * Scales the picture down and re-saves it as a JPEG, so it fits in the
 * browser's small store. A real backend would take the file as it is.
 */
async function shrink(picture: File): Promise<PlanImage> {
  const bitmap = await createImageBitmap(picture);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { name: picture.name, dataUrl: canvas.toDataURL('image/jpeg', 0.8) };
}

async function choose(picture: File | undefined): Promise<void> {
  if (!picture) return;
  error.hidden = true;
  if (!picture.type.startsWith('image/')) {
    showError('That file is not a picture. Send a JPG or PNG of the plan.');
    return;
  }
  try {
    plan = await shrink(picture);
  } catch {
    showError('That picture could not be opened. Try saving it as a JPG or PNG first.');
    return;
  }
  preview.src = plan.dataUrl;
  preview.hidden = false;
  field('drop-empty').hidden = true;
  drop.classList.add('has-file');
  const name = field('drop-name');
  name.textContent = `${plan.name}. Choose again to replace it.`;
  name.hidden = false;
}

function showError(message: string): void {
  error.textContent = message;
  error.hidden = false;
}

if (account) {
  page.hidden = false;
  file.addEventListener('change', () => void choose(file.files?.[0]));
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    void choose(e.dataTransfer?.files[0]);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const send = field<HTMLButtonElement>('send');
    send.disabled = true;
    try {
      await requests.submit(account.id, {
        title: field('title').value,
        notes: field<HTMLTextAreaElement>('notes').value,
        plot: field('plot').value,
        floors: Number(field('floors').value),
        plan: plan ?? { name: '', dataUrl: '' },
      });
      window.location.assign('account.html?sent=1');
    } catch (problem) {
      showError(problem instanceof StoreError ? problem.message : 'Something went wrong. Try again.');
      send.disabled = false;
    }
  });
}
