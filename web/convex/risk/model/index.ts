// Public surface of the learned layer. Weights are bundled JSON exported by ml/export.py.
import emailWeights from "../weights/email_tfidf_lr.json";
import { scoreText as scoreTextWith, type TextScore, type TextWeights } from "./text";

export { scoreLinear, type LinearWeights, type Contribution } from "./linear";
export { tokenize, ngrams, type TextScore } from "./text";
export { buildPaymentFeatures, candidateFeatures, FEATURE_NAMES, type HistoryRow } from "./features";
export { assessPayment, assessSentPayment, TRANSACTION_WEIGHTS, type ModelAssessment } from "./assessPayment";

export const EMAIL_WEIGHTS = emailWeights as TextWeights;

export function scoreEmail(subject: string, body: string): TextScore {
  return scoreTextWith(EMAIL_WEIGHTS, `${subject}\n${body}`);
}
