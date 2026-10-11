/** A drawing review separates visible writing from the questions it raises. */
export interface InkIssue {
  evidence: string;
  concern: string;
  question: string;
}
export interface InkAssessment {
  readback: string[];
  legibility: "readable" | "partial" | "unreadable";
  observations: string[];
  issues: InkIssue[];
  nextStep: string;
}
export interface InkReview extends InkAssessment {
  provider: string;
  source?: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
const texts = (value: unknown, count: number, maximum: number): value is string[] =>
  Array.isArray(value) && value.length <= count && value.every((entry) => text(entry, maximum));

/** Reject ungrounded issue excerpts and discard assessments of uncertain writing. */
export function parseInkAssessment(value: unknown): InkAssessment | null {
  if (!record(value) || !texts(value.readback, 60, 1000) ||
    !["readable", "partial", "unreadable"].includes(String(value.legibility)) ||
    !texts(value.observations, 4, 600) || !Array.isArray(value.issues) ||
    value.issues.length > 3 || !text(value.nextStep, 1000) ||
    !value.issues.every((issue) => record(issue) && text(issue.evidence, 1000) &&
      text(issue.concern, 600) && text(issue.question, 600))) return null;

  const readback = value.readback;
  if (value.legibility === "unreadable") return {
    readback: [], legibility: "unreadable", observations: [], issues: [],
    nextStep: "Make the writing larger or clearer, then check again.",
  };
  if (value.legibility === "partial") return {
    readback: [...readback], legibility: "partial", observations: [], issues: [],
    nextStep: "Compare the readback with your drawing and clarify any missing writing before checking again.",
  };
  const issues = value.issues as InkIssue[];
  if (issues.some((issue) => !readback.some((line) => line.includes(issue.evidence)))) return null;
  return {
    readback: [...readback], legibility: "readable", observations: [...value.observations],
    issues: issues.map((issue) => ({ evidence: issue.evidence, concern: issue.concern, question: issue.question })),
    nextStep: value.nextStep,
  };
}
