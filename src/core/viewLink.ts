/**
 * A view of a home written into the page address, so it can be shared as
 * a link or kept as a saved view: which view (whole house, a floor plan or
 * the walk), which floor, and where the camera is.
 *
 *   ?home=villa&view=walk&floor=1&at=4.2,7.9,90,-5
 *   ?home=villa&view=plan&floor=0&cam=0.3,0.5,24.1
 *
 * `at` is the walker's x, y (metres on the plan), facing and up/down look
 * (degrees). `cam` is the turntable camera's two angles (radians) and
 * distance (metres), then optionally how far the view is slid across the
 * ground (x, y in metres).
 */
export interface ViewState {
  view: 'whole' | 'plan' | 'walk';
  floor: number;
  at?: [number, number, number, number];
  cam?: number[];
}

const VIEWS = ['whole', 'plan', 'walk'] as const;

const numbers = (text: string | null, count: number): number[] | undefined => {
  if (!text) return undefined;
  const parts = text.split(',').map(Number);
  return parts.length === count && parts.every(Number.isFinite) ? parts : undefined;
};

const round = (v: number, places: number): string => String(Math.round(v * 10 ** places) / 10 ** places);

/** Reads a view from address parameters. Anything missing or broken falls back to the whole house. */
export function viewFromParams(params: URLSearchParams, floors: number): ViewState {
  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as ViewState['view']) : 'whole';
  const floor = Number(params.get('floor') ?? 0);
  const state: ViewState = { view, floor: Number.isInteger(floor) && floor >= 0 && floor < floors ? floor : 0 };
  const at = numbers(params.get('at'), 4);
  if (at) state.at = at as ViewState['at'];
  const cam = numbers(params.get('cam'), 3) ?? numbers(params.get('cam'), 5);
  if (cam) state.cam = cam;
  return state;
}

/** Writes a view into a copy of `base`, replacing any view already in it. */
export function viewToParams(state: ViewState, base: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of ['view', 'floor', 'at', 'cam']) params.delete(key);
  params.set('view', state.view);
  if (state.floor > 0) params.set('floor', String(state.floor));
  if (state.view === 'walk' && state.at) {
    const [x, y, yaw, pitch] = state.at;
    params.set('at', [round(x, 2), round(y, 2), round(yaw, 0), round(pitch, 0)].join(','));
  }
  if (state.view !== 'walk' && state.cam) {
    const [azimuth, polar, distance, ...slide] = state.cam;
    const parts = [round(azimuth, 3), round(polar, 3), round(distance, 2)];
    if (slide.length === 2) parts.push(...slide.map((v) => round(v, 2)));
    params.set('cam', parts.join(','));
  }
  return params;
}
