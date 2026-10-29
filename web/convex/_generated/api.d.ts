/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analytics from "../analytics.js";
import type * as api_keys from "../api/keys.js";
import type * as api_mutations from "../api/mutations.js";
import type * as api_openapi from "../api/openapi.js";
import type * as api_util from "../api/util.js";
import type * as apiRoutes from "../apiRoutes.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as authCallbacks from "../authCallbacks.js";
import type * as authSetup from "../authSetup.js";
import type * as bankAccounts from "../bankAccounts.js";
import type * as cases from "../cases.js";
import type * as channels_initiate from "../channels/initiate.js";
import type * as channels_portal from "../channels/portal.js";
import type * as channels_simVoice from "../channels/simVoice.js";
import type * as channels_types from "../channels/types.js";
import type * as channels_vapi from "../channels/vapi.js";
import type * as channels_vapiMutations from "../channels/vapiMutations.js";
import type * as channels_vapiWebhook from "../channels/vapiWebhook.js";
import type * as clock from "../clock.js";
import type * as confirmations from "../confirmations.js";
import type * as contacts from "../contacts.js";
import type * as controls_actor from "../controls/actor.js";
import type * as controls_approvals from "../controls/approvals.js";
import type * as controls_demoGuard from "../controls/demoGuard.js";
import type * as controls_operators from "../controls/operators.js";
import type * as controls_policy from "../controls/policy.js";
import type * as crons from "../crons.js";
import type * as crypto from "../crypto.js";
import type * as demoAccounts from "../demoAccounts.js";
import type * as demoControls from "../demoControls.js";
import type * as devTools from "../devTools.js";
import type * as discovery from "../discovery.js";
import type * as emlIntake from "../emlIntake.js";
import type * as env from "../env.js";
import type * as evalQueries from "../evalQueries.js";
import type * as evalRuns from "../evalRuns.js";
import type * as events from "../events.js";
import type * as explain from "../explain.js";
import type * as exportCase from "../exportCase.js";
import type * as exports_nacha from "../exports/nacha.js";
import type * as exports_pain001 from "../exports/pain001.js";
import type * as exports_paymentFiles from "../exports/paymentFiles.js";
import type * as extractors_claude from "../extractors/claude.js";
import type * as extractors_rules from "../extractors/rules.js";
import type * as fixtureTypes from "../fixtureTypes.js";
import type * as guard from "../guard.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as intakeQueries from "../intakeQueries.js";
import type * as invoices from "../invoices.js";
import type * as judge from "../judge.js";
import type * as messages from "../messages.js";
import type * as monitoring_beneficiaryTrust from "../monitoring/beneficiaryTrust.js";
import type * as monitoring_evaluate from "../monitoring/evaluate.js";
import type * as monitoring_queries from "../monitoring/queries.js";
import type * as monitoring_signals from "../monitoring/signals.js";
import type * as monitoring_trend from "../monitoring/trend.js";
import type * as nessieViewer from "../nessieViewer.js";
import type * as onboarding from "../onboarding.js";
import type * as onboardingMutations from "../onboardingMutations.js";
import type * as package_ from "../package.js";
import type * as packageProse from "../packageProse.js";
import type * as packageTemplates from "../packageTemplates.js";
import type * as paymentQueries from "../paymentQueries.js";
import type * as paymentRun from "../paymentRun.js";
import type * as payments from "../payments.js";
import type * as portalAuth from "../portalAuth.js";
import type * as portalGuard from "../portalGuard.js";
import type * as probes from "../probes.js";
import type * as rails_nessie from "../rails/nessie.js";
import type * as rails_select from "../rails/select.js";
import type * as rails_sim from "../rails/sim.js";
import type * as rails_types from "../rails/types.js";
import type * as rateLimit from "../rateLimit.js";
import type * as risk_assess from "../risk/assess.js";
import type * as risk_model_assessPayment from "../risk/model/assessPayment.js";
import type * as risk_model_features from "../risk/model/features.js";
import type * as risk_model_history from "../risk/model/history.js";
import type * as risk_model_index from "../risk/model/index.js";
import type * as risk_model_linear from "../risk/model/linear.js";
import type * as risk_model_text from "../risk/model/text.js";
import type * as risk_score from "../risk/score.js";
import type * as screening_match from "../screening/match.js";
import type * as screening_screen from "../screening/screen.js";
import type * as screening_watchlist from "../screening/watchlist.js";
import type * as seed from "../seed.js";
import type * as seedDemo from "../seedDemo.js";
import type * as settings from "../settings.js";
import type * as settingsInternal from "../settingsInternal.js";
import type * as timerQueries from "../timerQueries.js";
import type * as timers from "../timers.js";
import type * as validation_provider from "../validation/provider.js";
import type * as vendors from "../vendors.js";
import type * as webhooks_dispatch from "../webhooks/dispatch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analytics: typeof analytics;
  "api/keys": typeof api_keys;
  "api/mutations": typeof api_mutations;
  "api/openapi": typeof api_openapi;
  "api/util": typeof api_util;
  apiRoutes: typeof apiRoutes;
  audit: typeof audit;
  auth: typeof auth;
  authCallbacks: typeof authCallbacks;
  authSetup: typeof authSetup;
  bankAccounts: typeof bankAccounts;
  cases: typeof cases;
  "channels/initiate": typeof channels_initiate;
  "channels/portal": typeof channels_portal;
  "channels/simVoice": typeof channels_simVoice;
  "channels/types": typeof channels_types;
  "channels/vapi": typeof channels_vapi;
  "channels/vapiMutations": typeof channels_vapiMutations;
  "channels/vapiWebhook": typeof channels_vapiWebhook;
  clock: typeof clock;
  confirmations: typeof confirmations;
  contacts: typeof contacts;
  "controls/actor": typeof controls_actor;
  "controls/approvals": typeof controls_approvals;
  "controls/demoGuard": typeof controls_demoGuard;
  "controls/operators": typeof controls_operators;
  "controls/policy": typeof controls_policy;
  crons: typeof crons;
  crypto: typeof crypto;
  demoAccounts: typeof demoAccounts;
  demoControls: typeof demoControls;
  devTools: typeof devTools;
  discovery: typeof discovery;
  emlIntake: typeof emlIntake;
  env: typeof env;
  evalQueries: typeof evalQueries;
  evalRuns: typeof evalRuns;
  events: typeof events;
  explain: typeof explain;
  exportCase: typeof exportCase;
  "exports/nacha": typeof exports_nacha;
  "exports/pain001": typeof exports_pain001;
  "exports/paymentFiles": typeof exports_paymentFiles;
  "extractors/claude": typeof extractors_claude;
  "extractors/rules": typeof extractors_rules;
  fixtureTypes: typeof fixtureTypes;
  guard: typeof guard;
  health: typeof health;
  http: typeof http;
  intake: typeof intake;
  intakeQueries: typeof intakeQueries;
  invoices: typeof invoices;
  judge: typeof judge;
  messages: typeof messages;
  "monitoring/beneficiaryTrust": typeof monitoring_beneficiaryTrust;
  "monitoring/evaluate": typeof monitoring_evaluate;
  "monitoring/queries": typeof monitoring_queries;
  "monitoring/signals": typeof monitoring_signals;
  "monitoring/trend": typeof monitoring_trend;
  nessieViewer: typeof nessieViewer;
  onboarding: typeof onboarding;
  onboardingMutations: typeof onboardingMutations;
  package: typeof package_;
  packageProse: typeof packageProse;
  packageTemplates: typeof packageTemplates;
  paymentQueries: typeof paymentQueries;
  paymentRun: typeof paymentRun;
  payments: typeof payments;
  portalAuth: typeof portalAuth;
  portalGuard: typeof portalGuard;
  probes: typeof probes;
  "rails/nessie": typeof rails_nessie;
  "rails/select": typeof rails_select;
  "rails/sim": typeof rails_sim;
  "rails/types": typeof rails_types;
  rateLimit: typeof rateLimit;
  "risk/assess": typeof risk_assess;
  "risk/model/assessPayment": typeof risk_model_assessPayment;
  "risk/model/features": typeof risk_model_features;
  "risk/model/history": typeof risk_model_history;
  "risk/model/index": typeof risk_model_index;
  "risk/model/linear": typeof risk_model_linear;
  "risk/model/text": typeof risk_model_text;
  "risk/score": typeof risk_score;
  "screening/match": typeof screening_match;
  "screening/screen": typeof screening_screen;
  "screening/watchlist": typeof screening_watchlist;
  seed: typeof seed;
  seedDemo: typeof seedDemo;
  settings: typeof settings;
  settingsInternal: typeof settingsInternal;
  timerQueries: typeof timerQueries;
  timers: typeof timers;
  "validation/provider": typeof validation_provider;
  vendors: typeof vendors;
  "webhooks/dispatch": typeof webhooks_dispatch;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
