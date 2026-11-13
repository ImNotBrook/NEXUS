export interface QualificationEvidence {
  qualifyingDays: number;
  completedTrades: number;
}

export interface QualificationResult {
  qualified: boolean;
  reasons: string[];
  reviewEligible: boolean;
  liveExecutionEnabled: false;
}

export function evaluateQualification(evidence: QualificationEvidence): QualificationResult {
  const { qualifyingDays, completedTrades } = evidence;

  if (!Number.isInteger(qualifyingDays) || qualifyingDays < 0) {
    throw new RangeError("qualifyingDays must be a non-negative integer");
  }
  if (!Number.isInteger(completedTrades) || completedTrades < 0) {
    throw new RangeError("completedTrades must be a non-negative integer");
  }

  const reasons: string[] = [];
  if (qualifyingDays < 90) reasons.push("At least 90 qualifying days are required");
  if (completedTrades < 1000) reasons.push("At least 1,000 completed trades are required");

  const qualified = reasons.length === 0;
  return {
    qualified,
    reasons,
    reviewEligible: qualified,
    liveExecutionEnabled: false,
  };
}
