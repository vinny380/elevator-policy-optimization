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
- Full-screen Three.js cutaway with a night city, illuminated cabins, passenger queues, orbit/zoom/pan, and a compact floating HUD. System typography, reduced-motion/transparency support, and responsive camera framing. Space pauses playback; the bottom dock controls speed, replay, and camera reset. Select passengers in the scene or through Building settings.
- Seeded night, morning, evening, and inter-floor traffic; adjustable capacity, speed, door dwell, and arrival rate.
- An explicitly labeled selective collective (LOOK) reference and tabular Q-learning that selects among collective, nearest-stop, oldest-call, and balanced strategies. Each car uses the chosen strategy when it needs its next stop.
- Background-worker training; adjustable learning rate, exploration, and discount; actual episode/policy-choice counts; fixed-seed evaluation; replayable checkpoints.

## Conventional vs. RL vs. PDDL

The comparison table runs each available controller on the same four six-minute traffic streams. Its test seeds (-810001 through -810004) are separate from training and checkpoint selection. It shows mean wait, mean per-run P95, frustration per passenger, completed trips, and unserved passengers. Relative changes are signed; worse results are not hidden. Four seeds are a small diagnostic comparison, not a significance claim. A selected RL checkpoint is frozen with exploration disabled for this comparison. The comparison worker is terminated when the configuration or checkpoint changes, preventing stale results from being displayed.

Use **LOOK**, **RL**, or **PDDL** in the top selector to watch each controller. RL opens Learning until a checkpoint exists. The chart icon opens comparisons; the sliders icon opens Building settings. The compact learning card starts/pauses training, replays the best policy, and opens reward, learning, and checkpoint controls. On phones, the full chart is inside Learning. The PDDL card opens the live plan inspector and exports. The comparison’s Watch buttons replay the environment seed, not the four aggregated test seeds. Select an RL checkpoint to add it to the comparison.

Selective collective control serves matching-direction calls while sweeping the building. This LOOK implementation reverses at outstanding requests rather than empty end floors, and uses the farthest opposite-direction hall call as a turning point. Cars share call assignments. It is a simplified implementation of a conventional algorithm family, not proprietary manufacturer firmware.

### The actual PDDL path

`src/pddl.ts` generates and parses a grounded STRIPS domain/problem with constant action costs, searches it using bounded uniform-cost search, validates the resulting plan against preconditions/effects/goals, and returns its first stop to the simulator. The PDDL panel shows the live action sequence and provides domain, problem, and plan downloads. Unsupported syntax is rejected. Search is capped at 1,500 expanded states, with an explicit LOOK fallback if no plan is found within the cap.

The model minimizes estimated travel ticks plus door dwell across at most six currently legal stop candidates per car, prioritizing onboard destinations then old hall calls. It uses only current information; waiting passengers expose origin and direction, not their destination. Capacity and actual boarding remain enforced by the shared simulator. After the first stop, it generates a fresh snapshot at the next decision, incorporating new calls and revealed destinations. The rest of the plan is an ordering of visits, not a guaranteed future passenger-service schedule.

This is **classical action-cost PDDL**, not a durative-action or full multi-car passenger model. Optimality applies only to a solved bounded stop snapshot's travel/dwell objective; it does not imply globally optimal waiting time. A temporal model with explicit capacity and passenger transitions remains tracked in #3. No planner service, Python runtime, or extra runtime dependency is needed by the site.

Configuration changes create a new experiment and reset training. Learning-parameter changes pause training and apply when resumed. Checkpoints are kept in memory for this tab (latest 100 plus the best-ever evaluation checkpoint); reload discards them. The chart labels the latest evaluation separately from the best saved score and LOOK baseline. Replay best works even after that checkpoint leaves the rolling chart. Restart from scratch clears training and replay while retaining settings. Choosing a checkpoint restarts visual playback with the configured seed. The original scenario recreates the **starting conditions**, not the unknown building controller or observed skipped-pickup route.

## Model and reward

When at least one car is ready to choose a stop, the learner observes discretized active-call count, oldest call age, fleet load, lobby-call presence, average car height, active fleet size, first ready car’s floor and direction, and episode phase. It chooses a routing strategy, not arbitrary motor commands. Hall calls expose floor/direction; destinations become available to routing after boarding. Training rewards can use full simulated passenger outcomes.

The accumulated cost is the discrete increment of:

```text
sum over all passengers:
  waitWeight * waitingSeconds / 60
  + tailWeight * (waitingSeconds / 60)^2
  + rideWeight * ridingSeconds / 60
```

The learner uses a semi-Markov Q update: accumulate `sum(gamma^t * reward_t)` until the next car becomes ready, then bootstrap with `gamma^elapsed * max Q(next)`. Moving and door-only ticks do not select or update unrelated strategies. Policy-choice counts include idle opportunities when a ready car has no requests. The default per-second discount is 0.99 (about 74% weight after 30 seconds); a discount of 1 optimizes the undiscounted finite episode. The chart reports negative accumulated cost per generated passenger (higher/closer to zero is better). Every episode lasts 360 simulated seconds. Unserved passengers accrue waiting cost through the horizon; their eventual future waits are not predicted. Mean and P95 wait include current waits for passengers not yet boarded. Throughput is displayed separately.

The environment uses constant travel speed, fixed door dwell, and one-second updates. Animation interpolates position. It does not model acceleration, jerk, boarding duration, emergency behavior, or mid-flight insertion of new stops. It is an educational model, not calibrated real-building telemetry or an optimality claim.

Training seeds vary. Evaluation uses seeds 910001–910004, with exploration disabled. The collective baseline uses those exact streams, configuration, objective, and horizon. User-selected visual replay has its own seed. Fixed-seed evaluation is used for checkpoint selection, not a guarantee of generalization; policy scores may regress. State bins still alias distinct situations, and a constant learning rate and exploration rate do not guarantee convergence. A flat score alone does not establish a local optimum. Compare hardware configurations in separate experiments.

## Project tracking

- [#1 — Interactive simulator](https://github.com/vinny380/elevator-policy-optimization/issues/1)
- [#2 — Live reinforcement learning](https://github.com/vinny380/elevator-policy-optimization/issues/2)
- [#3 — Temporal PDDL planner](https://github.com/vinny380/elevator-policy-optimization/issues/3)
- [#4 — Counterfactuals, branching, and sharing](https://github.com/vinny380/elevator-policy-optimization/issues/4)

Full temporal PDDL, manual dispatch, counterfactual explanations, persistent branching/sharing, and observed-route reconstruction remain planned. The runnable classical PDDL controller and three-way comparison are included in draft PR #5.

## References

- [Sutton, Precup, and Singh: temporal abstraction and semi-Markov Q-learning](https://people.cs.umass.edu/~barto/courses/cs687/Sutton-Precup-Singh-AIJ99.pdf)
- [Crites and Barto: Improving Elevator Performance Using Reinforcement Learning](https://papers.neurips.cc/paper/1073-improving-elevator-performance-using-reinforcement-learning.pdf)
- [Fox and Long: PDDL 2.1](https://www.cs.cmu.edu/afs/cs/project/jair/pub/volume20/fox03a-html/JAIRpddl.html)
- [IPC 2008: action-cost PDDL specification](https://ipc08.icaps-conference.org/deterministic/PddlActionCosts.html)
- [Mitsubishi: selective collective control as a standard controller option](https://www.mitsubishielectric.com/elevator/products/basic/elevators/nexway_s_ip_ap_v2/pdf/product_guide.pdf)

The learner here is a compact educational implementation; it is not a reproduction of the cited research system.
