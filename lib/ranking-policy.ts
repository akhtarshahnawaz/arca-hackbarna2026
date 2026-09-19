import seed from "../config/ranking-policy.json";

export type RankingPolicy = {
  watchIfFewerThanRuns: number;
  note: string;
};

export function loadRankingPolicy(): RankingPolicy {
  const runs = seed.watchIfFewerThanRuns;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error("ranking-policy.json watchIfFewerThanRuns must be a positive integer");
  }
  return seed;
}

/** Share of runs below which a site is watch, not ranked. */
export function watchCut(ensembleMembers: number): number {
  const members = ensembleMembers > 0 ? ensembleMembers : 1;
  return loadRankingPolicy().watchIfFewerThanRuns / members;
}
