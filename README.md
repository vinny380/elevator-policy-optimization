# Elevator Policy Optimization

A full-screen 3D elevator laboratory. Configure up to 40 floors and five cars, change traffic and reward weights, train real policies in a worker, and replay measured checkpoints. The optimized predictive planner runs immediately, and a bundled trained PPO checkpoint is available in RL and Compare. The default recreates the starting conditions of a late-night trip: three cars, two offline, an occupied car on floor 30, and a passenger waiting at G for floor 10.

## Toronto scene

The default view is a geographic 3D model of the Entertainment District, anchored at **Bisha Hotel & Residences, 88 Blue Jays Way**. It extends past the **CN Tower and Rogers Centre**, including King, Wellington, Front and Bremner, the railway corridor and Roundhouse Park. The live elevators sit inside Bisha in the same world. Select Bisha (or focus the canvas and press Enter) to fly closer; its facade fades to reveal the running simulation as you approach. Zoom back out to explore the district, or use Reset camera / Escape for the overview. There is no view switch. Camera transitions are interruptible and respect reduced motion.

The bundled OpenStreetMap extract includes 993 building outlines/parts, 1,952 street/path segments, 291 railway segments, 104 park/garden polygons and 592 trees. Buildings containing mapped parts are rendered through their parts, avoiding duplicate tower volumes. Heights use OSM heights where available, then storeys × 3.3m, then a recorded 12m estimate. Street widths and facade details are illustrative. Bisha, the CN Tower and Rogers Centre have custom landmark geometry. The geographic exterior has Bisha’s 44 storeys; the elevator cutaway retains the configurable 40-floor experiment and is not an architectural lift plan.

The map loads from a bundled 586 KB JSON file, without external map requests or API keys. Meshes are merged by material and trees are instanced. The interior is fitted to Bisha’s footprint and height, with G aligned to street level; an x-ray pass keeps cars, passengers and underground parking readable through surrounding geometry. A failed map request leaves the elevator simulation usable. Map attribution remains visible; the ODbL-derived database and [sources/model assumptions](public/toronto/README.md) are shipped with the app. Refresh with `python3 scripts/import-toronto.py`; pass a downloaded OSM XML path to reproduce an extract offline.

## Run

Node.js 22.12+:

```sh
npm install
npm run dev
```

`npm test` checks simulation, planning, neural gradients, and learning invariants. `npm run build` checks TypeScript and produces `dist/`.

## Use the lab

1. Open **Learning settings** on the small chart card. Choose **Dueling Double DQN**, **PPO**, or **Tabular Q-learning**, then train. PPO can start from scratch or imitate LOOK for 20/100 episodes.
2. Change exploration, neural learning rate, target-sync interval, PPO clipping, entropy, batch size, update epochs, discount, or training seed inside the panel. Change waiting/long-wait/ride weights to start a new objective.
3. Select a chart checkpoint or **Replay best** to watch a frozen policy. **LOOK**, **RL**, **Plan** (predictive rollouts), and **PDDL** switch the scene’s controller. Inspect/export actual PDDL from its card.
4. Open the chart icon to compare best saved runs on unseen traffic. Opening Compare pauses training. Switch to the traffic/outage suite for 24 trials per controller; download results as JSON. “Watch” uses the current building seed, not the aggregated test streams.

The world keeps its minimal HUD, orbit/zoom/pan camera, clickable passengers, pause/clock/speed controls, and system typography. Space pauses playback. Building sliders change car count, service status, floors, traffic, capacity, speed, doors, and arrival rate. Advanced controls stay inside dialogs. Reduced-motion/transparency and responsive camera framing remain supported.

The graph retains the latest 100 checkpoints plus the best ever in the current run. Up to 12 best run snapshots remain available in Compare when switching learner, imitation setting, training traffic, or training seed. Building/reward changes clear custom runs; restoring the exact original configuration restores the bundled reference. Reload clears this tab’s custom training, while the bundled reference remains available. Other learning-parameter changes pause and apply on resume. Changing gamma clears DQN replay because stored rewards depend on its discount. The saved run identifies its checkpoint-time settings; changing settings midway makes it a mixed-settings run rather than a reproducible constant-settings experiment. Use a fresh seed/run for clean comparisons.

## Implemented controllers

| Controller | Decision and training |
| --- | --- |
| Selective collective (LOOK) | Conventional reference. Sweep matching-direction calls and onboard destinations, reverse at outstanding demand, share hall-call assignments. Own simplified implementation, not vendor firmware. |
| Tabular Q-learning | Existing educational baseline. Approximate state bins; chooses LOOK, nearest, oldest, or balanced strategy. Duration-aware Q updates. |
| Dueling Double DQN | Direct legal next-stop actions. Shared 16-unit tanh stop scorer and a separate 16-unit value network, dueling value/advantage outputs, uniform replay (4,096 transitions), masked online argmax with target-network evaluation, Huber gradients, Adam, gradient-norm clipping, periodic hard target sync. |
| PPO | Direct legal next-stop actions. Shared 16-unit tanh stop scorer and a separate 16-unit critic, masked categorical policy, clipped surrogate, entropy bonus, value loss, normalized generalized advantages, shuffled minibatches and repeated update epochs. |
| Predictive rollouts | No training. Search up to six diverse next stops using four common independent sampled futures over up to 150 seconds, with LOOK continuation. Switch away from LOOK only when estimated savings exceed one paired standard error. Execute one action and replan. |
| PDDL | Generate, parse, solve, and validate an actual grounded STRIPS/action-cost task over up to six known stops. Weighted marginal wait/ride cost; execute first stop and replan. |

The neural implementations use a small dependency-free CPU network (`network.ts`), shared by workers and browser inference. Gradients are checked against finite differences. This keeps inference and serialized Float32 checkpoints portable; it is not a GPU-scale training stack.

### Observations and legal actions

The neural observation contains 24 fleet/traffic/objective features and 18 features per legal stop: distance, direction, queue count and age, capacity, passed onboard destinations, nearby cars, travel time, and LOOK’s recommendation. The same scorer evaluates every stop, sharing learned behavior across floors instead of learning an independent output for each floor. LOOK is an explicit input feature, not a hidden fallback. The separate value network sees the 24 global features. Together they have 1,122 parameters. Fixed action slots support 1–5 cars and 10–40 floors; absent stops are masked.

There are 138 potential action slots: onboard destination, up pickup, or down pickup for each floor P5 through 40. Only the simulator’s current legal candidates are available. Capacity, outages, already claimed calls, and committed movement remain enforced by the shared engine. There is no arbitrary motor action or intentional idle action while a legal request exists. One central policy handles ready cars sequentially; earlier assignments are visible to later cars in the same tick. This is centralized group control, not independent multi-agent learning.

Waiting destinations are hidden until boarding; only origin and direction are exposed. Queue counts and ages assume simulated sensors beyond ordinary binary hall buttons. All controllers can use the same information; the tabular baseline intentionally compresses it. Predictive planning samples hidden destinations from the configured traffic prior conditioned on origin/direction and samples future arrivals with an independent RNG. It does not clone the real future RNG or consult hidden destinations beyond their observed direction. Its current traffic model is a known simulator prior, not a trained transformer or a calibrated building forecast.

### Learning and reward

All episodes last 360 simulated seconds. Total passenger cost is:

```text
waitWeight × waitingSeconds / 60
+ tailWeight × (waitingSeconds / 60)²
+ rideWeight × ridingSeconds / 60
```

Unserved passengers keep accruing cost through the horizon. The displayed score is negative total cost per generated passenger: higher is better. Mean and P95 waiting time include unfinished waits. Throughput and unfinished passengers are reported separately. Arrivals are policy-independent seeded Poisson streams with night, morning, evening, and inter-floor patterns.

Neural decisions occur after the current tick’s waiting cost and before movement. A transition receives the subsequent tick costs until the next ready-car decision; simultaneous decisions have zero duration. Bootstrap discount is `gamma ** elapsed`. PPO uses full-episode on-policy rollouts and GAE with lambda 0.95 per decision and duration-aware gamma. Terminal transitions never bootstrap. DQN trains from replay between episodes, keeping the behavior network fixed within each episode. Default gamma is 0.99 per second; gamma 1 matches the undiscounted finite-horizon objective. By default training rotates through all four traffic patterns, restoring all installed cars every fifth episode. Current-scenario-only training is also available. The default neural learning rate is 0.001; learning is still sensitive to initialization and checkpoint selection.

PPO’s optional warm start is supervised cross-entropy imitation of LOOK stop choices, followed by PPO. It is explicitly **not** the pickup-time regression pretraining/direct-effect interval formulation in Wan et al. (2026). Imitation episodes count toward displayed trials and are identified in the training phase/settings; the cyan evaluation curve always measures the learned policy, never the teacher. During PPO training actions are sampled; evaluation and replay choose the highest-probability legal action. DQN evaluation disables epsilon exploration. Tabular learning remains strategy selection, so it is a useful baseline rather than an equal action-space ablation.

### PDDL objective and limits

The inspector exports the exact domain, problem, and validated plan used by the controller. Grounded actions encode remaining stop sets so constant action costs can represent weighted latency. For each pending stop, its current marginal rate is `waitWeight × queueCount / 60 + 2 × tailWeight × sum(waitAges) / 3600`, or `rideWeight × onboardCount / 60` for a destination. An action charges its estimated travel/dwell duration against the remaining rates.

These rates freeze at the current snapshot; this approximates the quadratic wait objective rather than modeling its full future evolution. Only six stop floors are considered, prioritizing onboard destinations then oldest calls. Visiting a floor is not a guarantee of serving both hall directions or every passenger; actual capacity and boarding stay in the simulator. Search is capped at 1,500 expanded states with an explicit LOOK fallback. Tests validate exported plans and compare exact bounded travel-cost instances with independent enumeration. Unsupported PDDL syntax is rejected.

This is classical action-cost PDDL, not durative-action PDDL 2.1 or a full multi-car passenger/resource plan. Full temporal planning remains [issue #3](https://github.com/vinny380/elevator-policy-optimization/issues/3).

## Fair experiments

Training uses changing positive seeds; initialization/exploration have a separate controllable seed. Checkpoint selection uses seeds 910001–910004 every 20 episodes. Varied training evaluates all four traffic patterns at configured and full service, up to 32 trials; equivalent service configurations are deduplicated. Current-scenario training evaluates four trials. Compare freezes each best saved policy and uses held-out seeds -810001 through -810004, the same configuration/objective/arrivals/horizon for every controller. The stress suite crosses those seeds with four traffic patterns and all-cars-online/one-car-online variants. Policies are not retrained for transfer. With only one installed car some outage variants are duplicates; these are diagnostic scenarios, not independent statistical evidence.

The table reports mean wait, mean per-trial P95, cost/person, completed/unfinished passengers, compute time per trial, and standard error of paired wait differences against LOOK. Aggregate traffic/outage rows are heterogeneous; their SE is descriptive, not a significance claim. Four held-out seeds and four selection seeds are small samples, and selecting the best checkpoint can overfit. No controller is assumed to win; worse results stay visible. Compute time includes simulator/control overhead and depends on hardware.

Run a reproducible repeated-training benchmark:

```sh
npm run benchmark -- --episodes 200 --runs 3 --stress --output .context/benchmark.json
```

This trains tabular Q-learning, Double DQN, PPO, and PPO with 20 imitation episodes, each with three initialization/exploration seeds. It selects checkpoints on the same evaluation seeds and tests them all on held-out traffic. `--episodes` is the RL episode budget; imitation is additional and reported separately. `--runs` controls independent training randomness; training traffic is held fixed across runs. Omit `--stress` to test the configured night scenario only. The output contains settings, training duration, decision/update counts, selection scores, and held-out metrics. Larger neural runs require more trials than the table baseline; equal trial counts do not imply equal compute budgets.

## Measured optimization

The previous flat neural network struggled to beat LOOK. Sharing stop-scoring weights, separating the critic, and varying training traffic improved learning. Extending the planner’s forecast from 45 to 150 seconds and penalizing sampling uncertainty fixed large short-horizon failures.

The [frozen final benchmark](benchmarks/optimization.json) uses **640 trials per controller**: 40 reserved seeds (−970001 through −970040), four traffic patterns, and 1/2/3/5 online cars. Settings and the PPO checkpoint were fixed before this test. All cars share each trial’s arrivals and six-minute horizon; rows weight trials equally.

| Controller | Cost/person ↓ | Change vs LOOK | Mean wait | Mean trial P95 | Unfinished/trial |
| --- | ---: | ---: | ---: | ---: | ---: |
| LOOK | 1.071 | — | 22.3s | 52.2s | 4.16 |
| Previous planner | 0.994 | 7.1% lower | 19.5s | 46.3s | 5.34 |
| **Optimized planner** | **0.829** | **22.6% lower** | **18.4s** | **43.0s** | **4.48** |
| Bundled PPO | 0.965 | 9.9% lower | 19.7s | 49.8s | 4.40 |
| PDDL | 1.196 | 11.7% higher | 20.8s | 53.3s | 5.88 |

The planner reduces cost 16.6% relative to the previous planner and beats LOOK on the mean of each of the 16 scenarios. Paired 95% intervals for absolute cost differences vs LOOK are [−0.272, −0.212] for the planner and [−0.133, −0.078] for PPO. These use 40 independent seed blocks across scenarios, not 640 independent samples. Unfinished counts are slightly higher than LOOK: optimizing the weighted cost does not guarantee better throughput.

The PPO reference is checkpoint 1,360 from a 2,100-episode run (100 LOOK-imitation episodes, then 2,000 PPO episodes), seed 209. Checkpoints used the 32-trial selection suite. We chose this run using a separate 96-trial development suite across three PPO and three DDQN seeds; [all six validation results](benchmarks/learning-validation.json) remain visible, including losing runs. Final test seeds were not used for this choice. PPO still loses to LOOK in the one-car night and mixed scenarios; this is why the planner is the default. PDDL’s bounded frozen-cost approximation also loses overall. These results do not establish that RL is universally best.

Reproduce the final benchmark and the exact bundled weights:

```sh
npx tsx scripts/verify-optimization.ts .context/optimization.json
npx tsx scripts/train-reference.ts .context/ppo-reference.json
cmp src/models/ppo-reference.json .context/ppo-reference.json
```

The bundled checkpoint is an inference reference, not a resumed optimizer state; new interactive training starts a separate run. The environment omits acceleration, jerk, boarding duration, emergencies, and mid-flight insertion. Animation interpolates the one-second constant-speed simulation. Results apply to this simulator, known traffic prior, arrival rate and reward weights; they are not measurements of a real building.

## Literature

These papers inform the experiments; this app is not a reproduction of their simulators or reported performance:

- [Crites & Barto — Improving Elevator Performance Using Reinforcement Learning](https://papers.neurips.cc/paper/1073-improving-elevator-performance-using-reinforcement-learning.pdf): neural value approximation and elevator group learning.
- [Van Hasselt et al. — Deep Reinforcement Learning with Double Q-learning](https://arxiv.org/abs/1509.06461), [Schulman et al. — Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347): learning algorithms.
- [Vaartjes & Francois-Lavet — Novel RL Approach for Efficient Elevator Group Control Systems](https://arxiv.org/abs/2507.00011), [Wan et al. — A Hybrid Approach of Imitation Learning and Deep Reinforcement Learning…](https://doi.org/10.1145/3790252): recent elevator-specific research, with different action spaces and pretraining than this app.
- [MERL — Transformer Networks for Predictive Group Elevator Control](https://www.merl.com/publications/TR2022-100): predictive planning using pedestrian information; our sampler does not assume those sensors or implement that transformer.
- [Sutton, Precup & Singh — Temporal abstraction and semi-Markov learning](https://people.cs.umass.edu/~barto/courses/cs687/Sutton-Precup-Singh-AIJ99.pdf), [Fox & Long — PDDL 2.1](https://www.cs.cmu.edu/afs/cs/project/jair/pub/volume20/fox03a-html/JAIRpddl.html), [IPC action-cost specification](https://ipc08.icaps-conference.org/deterministic/PddlActionCosts.html).

## Project tracking

[Simulator #1](https://github.com/vinny380/elevator-policy-optimization/issues/1) · [Learning #2](https://github.com/vinny380/elevator-policy-optimization/issues/2) · [Temporal PDDL #3](https://github.com/vinny380/elevator-policy-optimization/issues/3) · [Counterfactuals and sharing #4](https://github.com/vinny380/elevator-policy-optimization/issues/4) · [Draft PR #5](https://github.com/vinny380/elevator-policy-optimization/pull/5)
