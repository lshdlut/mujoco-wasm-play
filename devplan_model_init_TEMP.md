## Model Init/Load/Cutover Plan (Temp)

- Objective: cleanly reset frontend/backend state when loading or switching models via File panel (Load xml / dropdown).
- Checklist:
  1) Ensure default MODEL_POOL / initial model is present in File dropdown.
  2) Fix Load xml button width to match standard pill/primary controls.
  3) Add model init helper that resets frontend state (time, history, selection, dynamic UI) before/after backend load.
  4) Wire File dropdown to call the helper on every model change (local xml or builtin URL).
- Completion criteria:
  - Initial model appears in dropdown on page load.
  - Load xml button matches simulation.run visual width.
  - Switching models resets timers/history/selection and rehydrates dynamic UI without stale data.
- Notes: temporary scratch plan; remove after feature is complete.
