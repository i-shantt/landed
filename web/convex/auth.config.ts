// Convex Auth issues JWTs from this deployment's own site URL; functions verify them against /.well-known/jwks.json.
const authConfig = {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }],
};
export default authConfig;
