import { useRef, useState } from "react";
import type { EvaluationRun, ResultReview } from "../types";
import { storage } from "../services/storage";

/** Runner snapshots own automatic evidence; saved reviews survive every snapshot. */
export function useEvaluationRuns() {
  const [runs, setRuns] = useState<EvaluationRun[]>(storage.getRuns);
  const current = useRef(runs);
  // activeRun follows the most recently *received* run; App's Results view tracks a separate
  // user selection (selectedRunId), so the two notions of "current run" can differ while a run is live.
  const [activeId, setActiveId] = useState<string | null>(null);

  const persist = (next: EvaluationRun[]) => {
    current.current = next;
    setRuns(next);
    try {
      storage.setRuns(next);
    } catch (error) {
      // Persistence must not propagate through the runner's progress callback
      // and abort the evaluation itself (e.g. storage quota on raw responses).
      console.error("Failed to persist evaluation runs", error);
    }
  };

  const receiveRun = (snapshot: EvaluationRun) => {
    const previous = current.current.find((run) => run.id === snapshot.id);
    const previousResults = new Map(previous?.results.map((result) => [result.id, result]));
    const next = {
      ...snapshot,
      results: snapshot.results.map((result) => {
        const saved = previousResults.get(result.id)?.reviews ?? [];
        if (!saved.length) return result;
        // Saved reviews win on duplicate ids: a snapshot may echo one back, but the saved copy is the source of truth.
        const reviews = new Map([...(result.reviews ?? []), ...saved].map((review) => [review.id, review]));
        return { ...result, reviews: [...reviews.values()] };
      })
    };
    persist([next, ...current.current.filter((run) => run.id !== next.id)]);
    setActiveId(next.id);
  };

  const saveResultReview = (runId: string, resultId: string, review: ResultReview) => {
    persist(current.current.map((run) => run.id === runId ? {
      ...run,
      results: run.results.map((result) => result.id === resultId
        ? { ...result, reviews: [...(result.reviews ?? []), review] }
        : result)
    } : run));
  };

  return { runs, activeRun: runs.find((run) => run.id === activeId) ?? null, receiveRun, saveResultReview };
}
