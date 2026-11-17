// The floating ball's pets: drawn on one 100×100 grid, each with a face for
// every mood. An element shows in the moods its data-m lists, and the
// element with data-mood around it (the ball, or the svg itself in a
// preview) picks one: idle, happy (the pointer is over it), alert (a todo
// rings, a service is down), drag or sleep (nobody at the computer).

export type Mood = "idle" | "happy" | "alert" | "drag" | "sleep";

export const pets = [
  { id: "ball", name: "悬浮球" },
  { id: "cat", name: "橘猫" },
  { id: "ghost", name: "小幽灵" },
  { id: "slime", name: "史莱姆" },
  { id: "bot", name: "机器人" },
  { id: "custom", name: "自定义" },
] as const;

// zz floats over a sleeping pet.
const zz = `<g class="p-zz" data-m="sleep" fill="#8ea2cc" font-family="Segoe UI, sans-serif" font-weight="700"><text class="p-z1" x="68" y="30" font-size="17">z</text><text class="p-z2" x="80" y="17" font-size="13">z</text></g>`;

// sweat drops beside an alarmed or carried pet.
const sweat = (x: number, y: number) =>
  `<path data-m="alert drag" class="p-sweat" d="M${x} ${y}c-2.6 3.6-3.8 5.8-3.8 7.4a3.8 3.8 0 0 0 7.6 0c0-1.6-1.2-3.8-3.8-7.4z" fill="#8fd3ff" stroke="#4aa8e0" stroke-width="1"/>`;

const cat = `
  <path class="p-tail" d="M66 86c18 2 26-10 20-26" fill="none" stroke="#e8954a" stroke-width="7" stroke-linecap="round"/>
  <g class="p-fig">
    <ellipse cx="50" cy="79" rx="24" ry="15" fill="#f6b26b"/>
    <ellipse cx="41" cy="92" rx="7" ry="4.2" fill="#fff3e2"/>
    <ellipse cx="59" cy="92" rx="7" ry="4.2" fill="#fff3e2"/>
    <path d="M23 40 27 13l18 17zM77 40 73 13 55 30z" fill="#f6b26b" stroke="#f6b26b" stroke-width="2" stroke-linejoin="round"/>
    <path d="m29 32 1.6-11.5 8.4 8.2zM71 32l-1.6-11.5-8.4 8.2z" fill="#ffadad"/>
    <ellipse cx="50" cy="50" rx="31" ry="25" fill="#f6b26b"/>
    <path d="M50 26v7M43 27.5l1.8 6M57 27.5l-1.8 6" stroke="#e08a3c" stroke-width="2.6" stroke-linecap="round"/>
    <ellipse cx="50" cy="61" rx="12" ry="8" fill="#fff3e2"/>
    <g stroke="#c98a5a" stroke-width="1.2" stroke-linecap="round"><path d="M37 59l-12-2M37 62.5l-12 1.5M63 59l12-2M63 62.5l12 1.5"/></g>
    <ellipse cx="30" cy="57" rx="4.6" ry="2.6" fill="#ff8f8f" opacity=".55"/>
    <ellipse cx="70" cy="57" rx="4.6" ry="2.6" fill="#ff8f8f" opacity=".55"/>
    <path d="M47.6 55.6h4.8L50 58.4z" fill="#ff7f8a" stroke="#ff7f8a" stroke-linejoin="round"/>
    <g fill="none" stroke="#6b3f22" stroke-width="1.6" stroke-linecap="round">
      <path data-m="idle happy sleep" d="M46 61q2 2.4 4 0 2 2.4 4 0"/>
      <ellipse data-m="alert drag" cx="50" cy="62.5" rx="2.4" ry="3" fill="#6b3f22"/>
    </g>
    <g class="p-eyes" data-m="idle" fill="#3a2618"><ellipse cx="38" cy="47" rx="3.8" ry="5"/><ellipse cx="62" cy="47" rx="3.8" ry="5"/><circle cx="39.3" cy="45.2" r="1.3" fill="#fff"/><circle cx="63.3" cy="45.2" r="1.3" fill="#fff"/></g>
    <g data-m="happy" fill="none" stroke="#3a2618" stroke-width="2.4" stroke-linecap="round"><path d="M33.5 48.5q4.5-6 9 0M57.5 48.5q4.5-6 9 0"/></g>
    <g data-m="alert drag"><circle cx="38" cy="47" r="6.2" fill="#fff" stroke="#3a2618" stroke-width="1.4"/><circle cx="62" cy="47" r="6.2" fill="#fff" stroke="#3a2618" stroke-width="1.4"/><circle cx="38" cy="47.5" r="3" fill="#3a2618"/><circle cx="62" cy="47.5" r="3" fill="#3a2618"/></g>
    <g data-m="sleep" fill="none" stroke="#3a2618" stroke-width="2.2" stroke-linecap="round"><path d="M33.5 47q4.5 3.6 9 0M57.5 47q4.5 3.6 9 0"/></g>
  </g>
  ${sweat(84, 30)}`;

const ghost = `
  <ellipse class="p-shadow" cx="50" cy="95" rx="20" ry="3.2" fill="#000" opacity=".16"/>
  <g class="p-fig">
    <ellipse cx="18.5" cy="60" rx="5" ry="8.5" transform="rotate(28 18.5 60)" fill="#f7f8ff" stroke="#c7cce6" stroke-width="1.5"/>
    <ellipse cx="81.5" cy="60" rx="5" ry="8.5" transform="rotate(-28 81.5 60)" fill="#f7f8ff" stroke="#c7cce6" stroke-width="1.5"/>
    <path d="M50 11C29 11 20 28 20 48v36q5-6 10 0t10 0 10 0 10 0 10 0 10 0V48c0-20-9-37-30-37z" fill="#f7f8ff" stroke="#c7cce6" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M30 28q6-9 15-10" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>
    <ellipse cx="33" cy="56" rx="5" ry="2.8" fill="#ffb3c4" opacity=".7"/>
    <ellipse cx="67" cy="56" rx="5" ry="2.8" fill="#ffb3c4" opacity=".7"/>
    <g class="p-eyes" data-m="idle" fill="#2c2f48"><ellipse cx="40" cy="46" rx="4.2" ry="5.8"/><ellipse cx="60" cy="46" rx="4.2" ry="5.8"/><circle cx="41.5" cy="43.8" r="1.5" fill="#fff"/><circle cx="61.5" cy="43.8" r="1.5" fill="#fff"/></g>
    <g data-m="happy" fill="none" stroke="#2c2f48" stroke-width="2.6" stroke-linecap="round"><path d="M35 47.5q5-6.5 10 0M55 47.5q5-6.5 10 0"/></g>
    <g data-m="alert drag" fill="#2c2f48"><ellipse cx="40" cy="46" rx="5.5" ry="7"/><ellipse cx="60" cy="46" rx="5.5" ry="7"/><circle cx="41.8" cy="43.4" r="2.2" fill="#fff"/><circle cx="61.8" cy="43.4" r="2.2" fill="#fff"/></g>
    <g data-m="sleep" fill="none" stroke="#2c2f48" stroke-width="2.4" stroke-linecap="round"><path d="M35 46q5 4 10 0M55 46q5 4 10 0"/></g>
    <path data-m="idle sleep" d="M46.5 58q3.5 3.2 7 0" fill="none" stroke="#2c2f48" stroke-width="1.8" stroke-linecap="round"/>
    <path data-m="happy" d="M45 57h10q-1 6.5-5 6.5T45 57z" fill="#ff7a93" stroke="#2c2f48" stroke-width="1.6" stroke-linejoin="round"/>
    <ellipse data-m="alert drag" cx="50" cy="60" rx="3.2" ry="4" fill="#2c2f48"/>
  </g>
  ${sweat(84, 26)}`;

const slime = `
  <defs><linearGradient id="pet-slime-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7ee8bb"/><stop offset="1" stop-color="#2fb07f"/></linearGradient></defs>
  <ellipse class="p-shadow" cx="50" cy="93" rx="34" ry="3.6" fill="#000" opacity=".14"/>
  <g class="p-fig">
    <path d="M50 30c-1.5-7 3-13 10-12-4 2.5-5.5 6.5-4 12z" fill="#53cf9c"/>
    <path d="M13 86c-3-27 15-56 37-56s40 29 37 56q-37 7-74 0z" fill="url(#pet-slime-g)" stroke="#239469" stroke-width="1.5" stroke-linejoin="round"/>
    <ellipse cx="31" cy="50" rx="5.5" ry="9" transform="rotate(28 31 50)" fill="#fff" opacity=".55"/>
    <circle cx="38" cy="40" r="2.6" fill="#fff" opacity=".7"/>
    <ellipse cx="30" cy="72" rx="5" ry="2.8" fill="#ff8fa3" opacity=".5"/>
    <ellipse cx="70" cy="72" rx="5" ry="2.8" fill="#ff8fa3" opacity=".5"/>
    <g class="p-eyes" data-m="idle" fill="#123528"><ellipse cx="39" cy="63" rx="4" ry="5.6"/><ellipse cx="61" cy="63" rx="4" ry="5.6"/><circle cx="40.4" cy="60.8" r="1.5" fill="#fff"/><circle cx="62.4" cy="60.8" r="1.5" fill="#fff"/></g>
    <g data-m="happy" fill="none" stroke="#123528" stroke-width="2.6" stroke-linecap="round"><path d="M34 64q5-6.5 10 0M56 64q5-6.5 10 0"/></g>
    <g data-m="alert drag" fill="none" stroke="#123528" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m35 59 7 4-7 4M65 59l-7 4 7 4"/></g>
    <g data-m="sleep" fill="none" stroke="#123528" stroke-width="2.4" stroke-linecap="round"><path d="M34 63q5 4 10 0M56 63q5 4 10 0"/></g>
    <path data-m="idle happy sleep" d="M46 71q4 3.6 8 0" fill="none" stroke="#123528" stroke-width="1.8" stroke-linecap="round"/>
    <path data-m="alert drag" d="M45 74q2.5-3 5 0t5 0" fill="none" stroke="#123528" stroke-width="1.8" stroke-linecap="round"/>
  </g>
  ${sweat(86, 40)}`;

const bot = `
  <g class="p-fig">
    <path d="M50 22V13" stroke="#7d8a99" stroke-width="3" stroke-linecap="round"/>
    <circle class="p-led" cx="50" cy="10" r="4.2" fill="#ff6b6b"/>
    <rect x="31" y="74" width="38" height="19" rx="8" fill="#c8d2dd" stroke="#93a1b0" stroke-width="1.5"/>
    <circle class="p-led2" cx="50" cy="83.5" r="3.2" fill="#5ef0ff"/>
    <rect x="9.5" y="38" width="9" height="19" rx="3.5" fill="#9eacbb"/>
    <rect x="81.5" y="38" width="9" height="19" rx="3.5" fill="#9eacbb"/>
    <rect x="17" y="21" width="66" height="52" rx="17" fill="#e4eaf1" stroke="#93a1b0" stroke-width="1.8"/>
    <rect x="25" y="30" width="50" height="33" rx="11" fill="#1d2735"/>
    <ellipse cx="27" cy="67" rx="4.5" ry="2.4" fill="#ff9aa8" opacity=".6"/>
    <ellipse cx="73" cy="67" rx="4.5" ry="2.4" fill="#ff9aa8" opacity=".6"/>
    <g class="p-eyes" data-m="idle" fill="#5ef0ff"><rect x="34.5" y="39" width="8" height="11" rx="4"/><rect x="57.5" y="39" width="8" height="11" rx="4"/></g>
    <g data-m="happy" fill="none" stroke="#5ef0ff" stroke-width="2.8" stroke-linecap="round"><path d="M34 47q4.5-6 9 0M57 47q4.5-6 9 0"/></g>
    <g data-m="alert drag" fill="none" stroke="#ffcf5e" stroke-width="2.4"><circle cx="38.5" cy="44.5" r="5.5"/><circle cx="61.5" cy="44.5" r="5.5"/><circle cx="38.5" cy="44.5" r="1.6" fill="#ffcf5e"/><circle cx="61.5" cy="44.5" r="1.6" fill="#ffcf5e"/></g>
    <g data-m="sleep" stroke="#5ef0ff" stroke-width="2.6" stroke-linecap="round"><path d="M34.5 45.5h8M57.5 45.5h8"/></g>
    <path data-m="idle happy sleep" d="M45.5 55q4.5 3.4 9 0" fill="none" stroke="#5ef0ff" stroke-width="2" stroke-linecap="round"/>
    <path data-m="alert drag" d="M44 56.5l2-2 2 2 2-2 2 2 2-2 2 2" fill="none" stroke="#ffcf5e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  ${sweat(87, 18)}`;

const bodies: Record<string, string> = { cat, ghost, slime, bot };

// isDrawn tells the pets drawn here from the ball and a picture.
export const isDrawn = (id: string) => id in bodies;

// petSVG draws a pet; a mood given makes it its own data-mood, as for a
// preview, rather than the ball's.
export function petSVG(id: string, mood?: Mood) {
  return `<svg class="pet-svg pet-${id}" viewBox="0 0 100 100"${mood ? ` data-mood="${mood}"` : ""} aria-hidden="true">${bodies[id] ?? ""}${zz}</svg>`;
}

// zzSVG floats over a sleeping picture.
export const zzSVG = `<svg class="pet-svg pet-zz" viewBox="0 0 100 100" aria-hidden="true">${zz}</svg>`;
