import { useEffect, useState, useCallback } from "react";
import { getMeshStatus, dispatchMesh, type MeshStatus, type TaskType } from "@/lib/mesh";

export function useMesh(pollMs = 10000) {
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const s = await getMeshStatus();
      setStatus(s);
      setError(null);
      setLastPoll(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const dispatch = useCallback(async (taskType: TaskType, args?: Record<string, unknown>) => {
    return dispatchMesh(taskType, args);
  }, []);

  return { status, error, lastPoll, refresh, dispatch };
}
