// Account-validation provider interface. Production would call a bank-account
// validation service here (an account-to-business-name match). The stub always
// returns "no_coverage", which routes every case to the probe path.
export type ValidationResult = "no_coverage" | "match" | "mismatch";

export interface ValidationProvider {
  lookup(args: { routing: string; accountHash: string; vendorName: string }): Promise<ValidationResult>;
}

export class StubValidationProvider implements ValidationProvider {
  async lookup(): Promise<ValidationResult> {
    return "no_coverage";
  }
}

export function getValidationProvider(): ValidationProvider {
  return new StubValidationProvider();
}
