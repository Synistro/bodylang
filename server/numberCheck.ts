// Claude is told every number it states must come from the model. This checks that it did, so the page
// can mark any number the model never returned. A number it worked out itself counts as added, because
// nobody computed it.
const LOOSE_NUMBER = /\d+(?:\.\d+)?/g;
const CLOCK = /\b\d{1,2}:\d{2}\b/g;
const SAID_NUMBER = /(?<![\w.:,])(\d{1,2}:\d{2}|\d+(?:\.\d+)?)(%?)(?![\w:]|\.\d)/g;

export class NumberBook {
  private readonly values = new Set<number>();
  private readonly clocks = new Set<string>();

  // Anything Claude was given or was told: readouts, the food table, the person's own words.
  add(text: string) {
    for (const clock of text.match(CLOCK) ?? []) this.clocks.add(clock.padStart(5, "0"));
    for (const number of text.replace(CLOCK, " ").match(LOOSE_NUMBER) ?? []) this.values.add(Number(number));
  }

  // A number said to fewer decimals still matches, so 6.31 backs up "6.3", and 0.65 backs up "65%".
  knows(token: string, percent: boolean): boolean {
    if (token.includes(":")) return this.clocks.has(token.padStart(5, "0"));
    const said = Number(token);
    const decimals = token.split(".")[1]?.length ?? 0;
    const within = 0.5 * 10 ** -decimals + 1e-9;
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
