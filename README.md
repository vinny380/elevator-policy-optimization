# Elevator Policy Optimization

A local, interactive 3D elevator laboratory with a deterministic simulator and real tabular Q-learning. Configure a building, change passenger traffic and reward weights, train policies, and replay measured checkpoints.

## Run

Requires Node.js 22.12+ or a compatible newer release.

```sh
npm install
npm run dev
```

Open the localhost URL printed by Vite. `npm test` checks engine invariants and learning updates. `npm run build` checks TypeScript and produces `dist/`.

## Implemented

- 10–40 above-ground floors, G, and P1–P5; 1–5 elevators with individual service toggles. Default: 40 floors, three cars, two offline.
- Three.js cutaway with passenger queues, animated cars and doors, orbit/zoom controls, passenger inspection, pause/reset/playback speed, and live metrics.
- Seeded night, morning, evening, and inter-floor traffic; adjustable capacity, speed, door dwell, and arrival rate.
- A collective routing baseline and tabular Q-learning that selects among collective, nearest-stop, oldest-call, and balanced strategies. Each car uses the chosen strategy when it needs its next stop.
- Background-worker training; adjustable learning rate, exploration, and discount; actual episode/decision counts; fixed-seed evaluation; replayable checkpoints.

Configuration changes create a new experiment and reset training. Learning-parameter changes pause training and apply when resumed. Checkpoints are kept in memory for this tab (latest 100); reload discards them. Choosing a checkpoint restarts visual playback with the configured seed. The original scenario recreates the **starting conditions**, not the unknown building controller or observed skipped-pickup route.

## Model and reward

At each one-second step, the learner observes discretized active-call count, oldest call age, fleet load, lobby-call presence, average car height, and active fleet size. It chooses a routing strategy, not arbitrary motor commands. Hall calls expose floor/direction; destinations become available to routing after boarding. Training rewards can use full simulated passenger outcomes.

The accumulated cost is the discrete increment of:

```text
sum over all passengers:
  waitWeight * waitingSeconds / 60
  + tailWeight * (waitingSeconds / 60)^2
  + rideWeight * ridingSeconds / 60
```

The learner receives negative cost increments. The chart reports negative accumulated cost per generated passenger (higher/closer to zero is better). Every episode lasts 360 simulated seconds. Unserved passengers accrue waiting cost through the horizon; their eventual future waits are not predicted. Mean and P95 wait include current waits for passengers not yet boarded. Throughput is displayed separately.

The environment uses constant travel speed, fixed door dwell, and one-second updates. Animation interpolates position. It does not model acceleration, jerk, boarding duration, emergency behavior, or mid-flight insertion of new stops. It is an educational model, not calibrated real-building telemetry or an optimality claim.

Training seeds vary. Evaluation uses seeds 910001–910004, with exploration disabled. The collective baseline uses those exact streams, configuration, objective, and horizon. User-selected visual replay has its own seed. Held-out evaluation is diagnostic, not a guarantee of generalization; policy scores may regress. Compare hardware configurations in separate experiments.

## Project tracking

- [#1 — Interactive simulator](https://github.com/vinny380/elevator-policy-optimization/issues/1)
- [#2 — Live reinforcement learning](https://github.com/vinny380/elevator-policy-optimization/issues/2)
- [#3 — Temporal PDDL planner](https://github.com/vinny380/elevator-policy-optimization/issues/3)
- [#4 — Counterfactuals, branching, and sharing](https://github.com/vinny380/elevator-policy-optimization/issues/4)

PDDL integration, manual dispatch, counterfactual explanations, persistent branching/sharing, and observed-route reconstruction are planned, not implemented. The first two issues track the implementation in this workspace until reviewed and merged.

## References

- [Crites and Barto: Improving Elevator Performance Using Reinforcement Learning](https://papers.neurips.cc/paper/1073-improving-elevator-performance-using-reinforcement-learning.pdf)
- [Fox and Long: PDDL 2.1](https://www.cs.cmu.edu/afs/cs/project/jair/pub/volume20/fox03a-html/JAIRpddl.html)

The learner here is a compact educational implementation; it is not a reproduction of the cited research system.
