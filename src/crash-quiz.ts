// ─── CRASH QUIZ (multiplayer respawn) ─────────────────────────────────────────
// What you answer to respawn after crashing in a race. Deliberately NOT the Clave
// AWS bank: mid-race it has to be readable in a glance and answerable in a couple
// of seconds — one short line, three one-or-two-word answers, nothing technical.
// Half the cards are generated arithmetic so the pool never runs dry.

export interface CrashQuestion {
  prompt: string;
  options: Array<{ text: string; correct: boolean }>;
}

// [prompt, correct answer, wrong, wrong]
const BANK: Array<[string, string, string, string]> = [
  ['Capital of France?', 'Paris', 'Rome', 'Madrid'],
  ['🐄 says…', 'Moo', 'Woof', 'Quack'],
  ['Days in a week?', '7', '5', '10'],
  ['Opposite of hot?', 'Cold', 'Warm', 'Spicy'],
  ['Biggest planet?', 'Jupiter', 'Mars', 'Earth'],
  ['🍕 comes from…', 'Italy', 'Japan', 'Peru'],
  ['Fastest land animal?', 'Cheetah', 'Horse', 'Snail'],
  ['Spider legs?', '8', '6', '10'],
  ['Frozen water is…', 'Ice', 'Steam', 'Soup'],
  ['Which is a fruit?', 'Banana', 'Carrot', 'Potato'],
  ['Penguins can…', 'Swim', 'Fly', 'Knit'],
  ['Months in a year?', '12', '10', '13'],
  ['1kg feathers vs 1kg bricks?', 'Same', 'Bricks', 'Feathers'],
  ['Tallest animal?', 'Giraffe', 'Elephant', 'Moose'],
  ['Opposite of up?', 'Down', 'Left', 'Sideways'],
  ['Biggest ocean?', 'Pacific', 'Atlantic', 'Arctic'],
  ['Which one meows?', '🐱', '🐶', '🐟'],
  ['Half of 10?', '5', '2', '20'],
  ['Day after Sunday?', 'Monday', 'Friday', 'Tuesday'],
  ['Sides on a triangle?', '3', '4', '5'],
  ['Which is NOT a colour?', 'Tuesday', 'Purple', 'Orange'],
  ['🍣 comes from…', 'Japan', 'Brazil', 'Iceland'],
  ['Baby dog?', 'Puppy', 'Kitten', 'Calf'],
  ['Bees make…', 'Honey', 'Milk', 'Silk'],
  ['Opposite of fast?', 'Slow', 'Quick', 'Loud'],
  ['On your feet?', 'Socks', 'Hats', 'Gloves'],
  ['Snow is…', 'Cold', 'Hot', 'Crunchy soup'],
  ['Moons of Earth?', '1', '2', '0'],
  ['Which one flies?', '🦅', '🐢', '🐌'],
  ['Wheels on a bike?', '2', '3', '4'],
  ['Shrek is…', 'Green', 'Blue', 'Pink'],
  ['Bananas are…', 'Yellow', 'Purple', 'Blue'],
  ['Which is a vegetable?', 'Carrot', 'Grape', 'Cherry'],
  ['Cows drink…', 'Water', 'Milk', 'Coffee'],
  ['Which is round?', '⚽', '📦', '📐'],
  ['Rhymes with cat?', 'Hat', 'Dog', 'Cow'],
  ['First letter?', 'A', 'Z', 'M'],
  ['Opposite of yes?', 'No', 'Maybe', 'Yep'],
  ['Minutes in an hour?', '60', '100', '30'],
  ['Which one barks?', '🐶', '🐱', '🐠'],
  ['Fish live in…', 'Water', 'Trees', 'Clouds'],
  ['Big Ben is in…', 'London', 'Paris', 'Berlin'],
  ['Colour of grass?', 'Green', 'Red', 'Blue'],
  ['Sun rises in the…', 'East', 'West', 'Basement'],
  ['Hours in a day?', '24', '12', '48'],
  ['Which is cold?', '🧊', '🔥', '☕'],
  ['Retro looks back at the…', 'Sprint', 'Future', 'Lunch'],
  ['Standups are for…', 'Updates', 'Naps', 'Karaoke'],
  ['Mario wears a…', 'Cap', 'Crown', 'Helmet'],
  ['Pikachu is…', 'Yellow', 'Green', 'Black'],
  ['Which is a bird?', '🐧', '🐙', '🦀'],
  ['Legs on a dog?', '4', '2', '6'],
  ['Opposite of night?', 'Day', 'Dark', 'Moon'],
  ['Honey comes from…', '🐝', '🐄', '🐔'],
  ['Eggs come from…', '🐔', '🐟', '🐄'],
  ['Which melts?', '🍦', '🪨', '🔩'],
];

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function card(prompt: string, right: string, wrong: string[]): CrashQuestion {
  return { prompt, options: shuffle([right, ...wrong].map((text, i) => ({ text, correct: i === 0 }))) };
}

// Small sums/products with two near-miss decoys.
function arithmetic(): CrashQuestion {
  const r = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
  const mul = Math.random() < 0.4;
  const a = mul ? r(2, 9) : r(2, 15), b = mul ? r(2, 9) : r(2, 15);
  const ans = mul ? a * b : a + b;
  const decoys = new Set<number>();
  while (decoys.size < 2) {
    const d = ans + (Math.random() < 0.5 ? -1 : 1) * r(1, mul ? 6 : 3);
    if (d !== ans && d > 0) decoys.add(d);
  }
  return card(`${a} ${mul ? '×' : '+'} ${b} = ?`, String(ans), [...decoys].map(String));
}

let bag: number[] = [];
export function nextCrashQuestion(): CrashQuestion {
  if (Math.random() < 0.5) return arithmetic();
  if (!bag.length) bag = shuffle(BANK.map((_, i) => i));
  const [prompt, right, ...wrong] = BANK[bag.pop()!];
  return card(prompt, right, wrong);
}
