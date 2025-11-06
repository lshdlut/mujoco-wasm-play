
## 2025-11-06
- blocker: wasm exports from forge-3.3.7 do not expose any `_mjwf_*opt*` pointer; cannot read/write `mjOption` (timestep/gravity/etc.). setField currently no-ops. Need forge team to add e.g. `_mjwf_model_opt_ptr`.
- until resolved, UI placeholders stay and physics values unchanged.

