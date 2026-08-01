/**
 * Pricing Engine (V3 §5.3, §6.9)
 *
 * The single place registration prices are computed. Every caller that
 * needs a price — request, direct registration, available-subjects
 * listing, swap difference — goes through here so the 50% rule (and,
 * later, per-student exceptions) is applied exactly once, identically.
 *
 * Rules:
 * - Base price = subject.courseFee + subject.registrationFee
 * - Outside school (subject not offered at school, OR a retaking student
 *   choosing to sit it outside) = 50% of the combined fee (D-B),
 *   applied to each component so the split still sums to the total.
 * - Outside school is FORBIDDEN otherwise — validated here.
 */

type PricingSubject = {
  courseFee: number;
  registrationFee: number;
  isOfferedAtSchool: boolean;
};

export type RegistrationPricing = {
  courseFee: number;
  registrationFee: number;
  total: number;
  isOutsideSchool: boolean;
};

const OUTSIDE_SCHOOL_MULTIPLIER = 0.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the price for one registration.
 *
 * @throws when takeOutsideSchool is requested but neither the subject is
 *   outside-school-only nor the student is retaking (V3 §6.9).
 */
export function computeRegistrationPricing(
  subject: PricingSubject,
  opts: { isRetake: boolean; takeOutsideSchool: boolean }
): RegistrationPricing {
  const forcedOutside = !subject.isOfferedAtSchool;

  if (opts.takeOutsideSchool && !forcedOutside && !opts.isRetake) {
    throw new Error(
      'Subjects can only be taken outside school when retaking or when the school does not offer them'
    );
  }

  const isOutsideSchool = forcedOutside || (opts.isRetake && opts.takeOutsideSchool);
  const multiplier = isOutsideSchool ? OUTSIDE_SCHOOL_MULTIPLIER : 1;

  const courseFee = round2(subject.courseFee * multiplier);
  const registrationFee = round2(subject.registrationFee * multiplier);

  return {
    courseFee,
    registrationFee,
    total: round2(courseFee + registrationFee),
    isOutsideSchool,
  };
}
