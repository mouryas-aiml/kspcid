# A18 Integrated ORR / Old Madras Road Scenario

- Scenario: `demo-corridor-patrol-2021-2023-night`
- Narrative corridor: **ORR / Old Madras Road**
- Stations: Kadugondana Halli → Banaswadi → Ramamurthy Nagar → K.R. Puram
- Scripted injection: **Old Madras Road closure** at simulation minute **180**
- Runtime closure multiplier: **×1.12** over validated free-flow durations
- Geometry changed at runtime: **no**

Observed demand and replay events remain derived from complete-window FIR rows. The roster and closure are explicitly generated demonstration inputs.

## Acceptance

- The scenario reuses the validated `demo_corridor` routing fixture and the same four-station East→Whitefield narrative as the judged spine.
- The closure fires from scenario data at minute 180 / 23:00; the client no longer owns an undeclared hard-coded trigger.
- Rain and closure factors modify validated free-flow durations only. Geometry is not changed or re-routed at runtime.
- The injection and roster carry generated-demonstration provenance; the 253 demand rows and 120 replay events retain observed/derived provenance.
- Exported `/patrol/` triggered the Old Madras Road modal, rendered the declared ×1.12 factor, accepted the closure decision, and resumed playback without console errors.
