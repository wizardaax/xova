from recursive_field_math import (
    GF_F,
    GF_L,
    F,
    L,
    egypt_4_7_11,
    lucas_ratio_cfrac,
    r_theta,
    ratio,
    ratio_error_bounds,
    signature_summary,
)

ROUTES = {
    "fibonacci": lambda a, b: {n: F(n) for n in range(a, b + 1)},
    "lucas": lambda a, b: {n: L(n) for n in range(a, b + 1)},
    "field": lambda a, b: {n: r_theta(n) for n in range(a, b + 1)},
    "ratio": lambda n: {"ratio": ratio(n), "bounds": ratio_error_bounds(n)},
    "cfrac": lambda n: {"ratio": lucas_ratio_cfrac(n)},
    "gf": lambda x: {"F": GF_F(x), "L": GF_L(x)},
    "egypt": lambda: {"num_den": egypt_4_7_11()},
    "sig": lambda: signature_summary(),
}


def query(intent: str, *args):
    intent = (intent or "").strip().lower()
    if intent not in ROUTES:
        return {"error": f"unknown intent: {intent}", "known": sorted(ROUTES.keys())}
    return ROUTES[intent](*args)  # type: ignore[operator]
