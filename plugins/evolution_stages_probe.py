import sys, json
sys.path.insert(0, r'D:\github\wizardaax\recursive-field-math-pro\src')
try:
    from recursive_field_math.evolution.meta_engine import EvolutionEngine
    engine = EvolutionEngine()
    agents = []
    stage_names = ["observe", "propose", "simulate", "apply"]
    for i, agent_id in enumerate(getattr(engine, 'agent_ids', getattr(engine, 'FEDERATION_AGENTS', []))):
        stage_idx = i % 4
        entry = {"agent": str(agent_id), "stage": stage_names[stage_idx]}
        for attr in ['scores', 'agent_scores']:
            scores = getattr(engine, attr, None)
            if isinstance(scores, dict) and agent_id in scores:
                entry["score"] = float(scores[agent_id])
                break
        agents.append(entry)
    engine_state = {}
    for attr in ['current_stage', 'cycle', 'generation', 'state']:
        v = getattr(engine, attr, None)
        if v is not None:
            try:
                engine_state[attr] = v if isinstance(v, (int, float, str, bool)) else str(v)
            except Exception:
                pass
    print(json.dumps({"ok": True, "agents": agents, "engine_state": engine_state}, default=str))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e)}))
