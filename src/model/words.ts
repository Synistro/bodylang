// How the model's numbers read in sentences.

export const formatClock = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

// A logged label as it reads inside a sentence: "Sugar bar" becomes "sugar bar", "IPA" stays.
export const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label);

export const joinAnd = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// Two names read well in a short reason; beyond that the food is simply the meal.
export const theFoods = (labels: string[]) => (labels.length > 2 || labels.length === 0 ? "the meal" : `the ${joinAnd(labels.map(inSentence))}`);

export const startCase = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// "9.5" and "10", never "10.0".
const hoursText = (hours: number) => String(Number(hours.toFixed(1)));

// "1 hour", "9.5 hours".
export function hoursWord(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${hoursText(hours)} ${Number(hours.toFixed(1)) === 1 ? "hour" : "hours"}`;
}

// A scale from 0 to 1 reaches a person as a word.
export const levelWord = (x: number) => (x < 0.1 ? "Quiet" : x < 0.35 ? "Mild" : x < 0.65 ? "Moderate" : "Strong");

const partOfDay = (minute: number) => {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m < 5 * 60) return "night";
  if (m < 12 * 60) return "morning";
  if (m < 17 * 60) return "afternoon";
  return m < 21 * 60 ? "evening" : "night";
};

// A time said the way it is meant: a clock today, a part of the day tomorrow, days after that.
export function whenWords(at: number, t: number): string {
  const days = Math.floor(at / 1440) - Math.floor(t / 1440);
  if (days <= 0) return `near ${formatClock(at)}`;
  return days === 1 ? `tomorrow ${partOfDay(at)}` : `in ${days} days`;
}
