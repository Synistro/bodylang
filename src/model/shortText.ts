import { z } from "zod";

const wordsAtMost = (limit: number) => (text: string) => text.trim().split(/\s+/).length <= limit;

// Words on screen, held to a length the model can be told about and corrected on.
export const shortText = (limit: number) => z.string().min(1).refine(wordsAtMost(limit), `Keep this to ${limit} words or fewer`);
