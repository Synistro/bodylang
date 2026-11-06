// Claude is told every number it states must come from the model. This checks that it did, so the page
// can mark any number the model never returned. A number it worked out itself counts as added, because
// nobody computed it.
const LOOSE_NUMBER = /\d+(?:\.\d+)?/g;
const CLOCK = /\b\d{1,2}:\d{2}\b/g;
const SAID_NUMBER = /(?<![\w.:,])(\d{1,2}:\d{2}|\d+(?:\.\d+)?)(%?)(?![\w:]|\.\d)/g;

const ROUNDED_WITHIN_SHARE = 0.05;

const minuteOf = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));

// A whole number said to its nearest ten or hundred is how a person says it, so 385 backs up "about 400". The cap keeps
// a round number from being backed up by anything nearby.
function roundedWithin(token: string, said: number): number {
  if (token.includes(".") || said < 10) return 0;
  const zeros = token.match(/0+$/)?.[0].length ?? 0;
  return zeros ? Math.min(0.5 * 10 ** zeros, said * ROUNDED_WITHIN_SHARE) : 0;
}

export class NumberBook {
  private readonly values = new Set<number>();
  private readonly clocks = new Set<string>();

  // Anything Claude was given or was told: readouts, the food table, the person's own words.
  add(text: string) {
    for (const clock of text.match(CLOCK) ?? []) this.clocks.add(clock.padStart(5, "0"));
    for (const number of text.replace(CLOCK, " ").match(LOOSE_NUMBER) ?? []) this.values.add(Number(number));
  }

  // A time rounded to the quarter hour is how a person says it, so 01:16 backs up "around 01:15".
  private knowsClock(clock: string): boolean {
    if (this.clocks.has(clock)) return true;
    const said = minuteOf(clock);
    if (said % 15 !== 0) return false;
    for (const known of this.clocks) {
      const apart = Math.abs(minuteOf(known) - said);
      if (Math.min(apart, 1440 - apart) <= 7) return true;
    }
    return false;
  }

  // A number said to fewer decimals still matches, so 6.31 backs up "6.3", and 0.65 backs up "65%".
  knows(token: string, percent: boolean): boolean {
    if (token.includes(":")) return this.knowsClock(token.padStart(5, "0"));
    const said = Number(token);
    const decimals = token.split(".")[1]?.length ?? 0;
    const within = Math.max(0.5 * 10 ** -decimals + 1e-9, roundedWithin(token, said));
    for (const value of this.values) {
      if (Math.abs(value - said) <= within) return true;
      if (percent && Math.abs(value * 100 - said) <= within) return true;
    }
    return false;
  }
}

export function unverifiedNumbers(text: string, book: NumberBook): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(SAID_NUMBER)) {
    if (!book.knows(match[1], match[2] === "%")) out.push(`${match[1]}${match[2]}`);
  }
  return out;
}
