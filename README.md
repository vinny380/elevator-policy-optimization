# Elevator Policy Optimization

A full-screen 3D elevator laboratory. Configure up to 40 floors and five cars, change traffic and reward weights, train real policies in a worker, and replay measured checkpoints. The default recreates the starting conditions of a late-night trip: three cars, two offline, an occupied car on floor 30, and a passenger waiting at G for floor 10.

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

The graph retains the latest 100 checkpoints plus the best ever in the current run. Up to 12 best run snapshots remain available in Compare when switching learner, imitation setting, or training seed. Building/reward changes clear all runs; reload clears this tab’s training. Other learning-parameter changes pause and apply on resume. Changing gamma clears DQN replay because stored rewards depend on its discount. The saved run identifies its checkpoint-time settings; changing settings midway makes it a mixed-settings run rather than a reproducible constant-settings experiment. Use a fresh seed/run for clean comparisons.

## Implemented controllers

| Controller | Decision and training |
| --- | --- |
| Selective collective (LOOK) | Conventional reference. Sweep matching-direction calls and onboard destinations, reverse at outstanding demand, share hall-call assignments. Own simplified implementation, not vendor firmware. |
| Tabular Q-learning | Existing educational baseline. Approximate state bins; chooses LOOK, nearest, oldest, or balanced strategy. Duration-aware Q updates. |
| Dueling Double DQN | Direct legal next-stop actions. Shared 32-unit tanh network, separate value/advantage outputs, uniform replay (4,096 transitions), masked online argmax with target-network evaluation, Huber gradients, Adam, gradient-norm clipping, periodic hard target sync. |
| PPO | Direct legal next-stop actions. Shared 32-unit tanh actor/critic trunk, masked categorical policy, clipped surrogate, entropy bonus, value loss, normalized generalized advantages, shuffled minibatches and repeated update epochs. |
| Predictive rollouts | No training. Search up to six diverse next stops using two common independent sampled futures over 45 seconds, with LOOK continuation. Execute one action and replan. |
| PDDL | Generate, parse, solve, and validate an actual grounded STRIPS/action-cost task over up to six known stops. Weighted marginal wait/ride cost; execute first stop and replan. |

The neural implementations use a small dependency-free CPU network (`network.ts`), shared by workers and browser inference. Gradients are checked against finite differences. This keeps inference and serialized Float32 checkpoints portable; it is not a GPU-scale training stack.

### Observations and legal actions

The neural observation has 518 features: a floor-valid flag, up/down queue counts and oldest call ages on each floor, each car’s revealed onboard destinations, car presence/service/position/direction/load/target/pickup-direction/door state, selected-car flag, episode phase, building/objective settings, and traffic pattern. Floors and missing cars use fixed padding, supporting 1–5 cars and 10–40 floors.

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

Neural decisions occur after the current tick’s waiting cost and before movement. A transition receives the subsequent tick costs until the next ready-car decision; simultaneous decisions have zero duration. Bootstrap discount is `gamma ** elapsed`. PPO uses full-episode on-policy rollouts and GAE with lambda 0.95 per decision and duration-aware gamma. Terminal transitions never bootstrap. DQN trains from replay between episodes, keeping the behavior network fixed within each episode. Default gamma is 0.99 per second; gamma 1 matches the undiscounted finite-horizon objective.

PPO’s optional warm start is supervised cross-entropy imitation of LOOK stop choices, followed by PPO. It is explicitly **not** the pickup-time regression pretraining/direct-effect interval formulation in Wan et al. (2026). Imitation episodes count toward displayed trials and are identified in the training phase/settings; the cyan evaluation curve always measures the learned policy, never the teacher. During PPO training actions are sampled; evaluation and replay choose the highest-probability legal action. DQN evaluation disables epsilon exploration. Tabular learning remains strategy selection, so it is a useful baseline rather than an equal action-space ablation.

### PDDL objective and limits

The inspector exports the exact domain, problem, and validated plan used by the controller. Grounded actions encode remaining stop sets so constant action costs can represent weighted latency. For each pending stop, its current marginal rate is `waitWeight × queueCount / 60 + 2 × tailWeight × sum(waitAges) / 3600`, or `rideWeight × onboardCount / 60` for a destination. An action charges its estimated travel/dwell duration against the remaining rates.

These rates freeze at the current snapshot; this approximates the quadratic wait objective rather than modeling its full future evolution. Only six stop floors are considered, prioritizing onboard destinations then oldest calls. Visiting a floor is not a guarantee of serving both hall directions or every passenger; actual capacity and boarding stay in the simulator. Search is capped at 1,500 expanded states with an explicit LOOK fallback. Tests validate exported plans and compare exact bounded travel-cost instances with independent enumeration. Unsupported PDDL syntax is rejected.

This is classical action-cost PDDL, not durative-action PDDL 2.1 or a full multi-car passenger/resource plan. Full temporal planning remains [issue #3](https://github.com/vinny380/elevator-policy-optimization/issues/3).

## Fair experiments

Training uses changing positive seeds; initialization/exploration have a separate controllable seed. Checkpoint selection uses seeds 910001–910004. Compare freezes each best saved policy and uses held-out seeds -810001 through -810004, the same configuration/objective/arrivals/horizon for every controller. The stress suite crosses those seeds with four traffic patterns and all-cars-online/one-car-online variants. Policies are not retrained for transfer. With only one installed car some outage variants are duplicates; these are diagnostic scenarios, not independent statistical evidence.

The table reports mean wait, mean per-trial P95, cost/person, completed/unfinished passengers, compute time per trial, and standard error of paired wait differences against LOOK. Aggregate traffic/outage rows are heterogeneous; their SE is descriptive, not a significance claim. Four held-out seeds and four selection seeds are small samples, and selecting the best checkpoint can overfit. No controller is assumed to win; worse results stay visible. Compute time includes simulator/control overhead and depends on hardware.

Run a reproducible repeated-training benchmark:

```sh
npm run benchmark -- --episodes 200 --runs 3 --stress --output .context/benchmark.json
```

This trains tabular Q-learning, Double DQN, PPO, and PPO with 20 imitation episodes, each with three initialization/exploration seeds. It selects checkpoints on the same evaluation seeds and tests them all on held-out traffic. `--episodes` is the RL episode budget; imitation is additional and reported separately. `--runs` controls independent training randomness; training traffic is held fixed across runs. Omit `--stress` to test the configured night scenario only. The output contains settings, training duration, decision/update counts, selection scores, and held-out metrics. Larger neural runs require more trials than the table baseline; equal trial counts do not imply equal compute budgets.

Initial 200-episode repeated runs and a 2,000-episode follow-up did **not** establish an improvement over LOOK. This is an experimental comparison environment, not a winning learned elevator controller. A compact flat floor-action network, limited traffic diversity, and checkpoint selection remain practical limitations. The environment also omits acceleration, jerk, boarding duration, emergencies, and mid-flight insertion. Animation interpolates the one-second constant-speed simulation.

## Literature

These papers inform the experiments; this app is not a reproduction of their simulators or reported performance:

- [Crites & Barto — Improving Elevator Performance Using Reinforcement Learning](https://papers.neurips.cc/paper/1073-improving-elevator-performance-using-reinforcement-learning.pdf): neural value approximation and elevator group learning.
- [Van Hasselt et al. — Deep Reinforcement Learning with Double Q-learning](https://arxiv.org/abs/1509.06461), [Schulman et al. — Proximal Policy Optimization Algorithms](https://arxiv.org/abs/1707.06347): learning algorithms.
- [Vaartjes & Francois-Lavet — Novel RL Approach for Efficient Elevator Group Control Systems](https://arxiv.org/abs/2507.00011), [Wan et al. — A Hybrid Approach of Imitation Learning and Deep Reinforcement Learning…](https://doi.org/10.1145/3790252): recent elevator-specific research, with different action spaces and pretraining than this app.
- [MERL — Transformer Networks for Predictive Group Elevator Control](https://www.merl.com/publications/TR2022-100): predictive planning using pedestrian information; our sampler does not assume those sensors or implement that transformer.
- [Sutton, Precup & Singh — Temporal abstraction and semi-Markov learning](https://people.cs.umass.edu/~barto/courses/cs687/Sutton-Precup-Singh-AIJ99.pdf), [Fox & Long — PDDL 2.1](https://www.cs.cmu.edu/afs/cs/project/jair/pub/volume20/fox03a-html/JAIRpddl.html), [IPC action-cost specification](https://ipc08.icaps-conference.org/deterministic/PddlActionCosts.html).

## Project tracking

[Simulator #1](https://github.com/vinny380/elevator-policy-optimization/issues/1) · [Learning #2](https://github.com/vinny380/elevator-policy-optimization/issues/2) · [Temporal PDDL #3](https://github.com/vinny380/elevator-policy-optimization/issues/3) · [Counterfactuals and sharing #4](https://github.com/vinny380/elevator-policy-optimization/issues/4) · [Draft PR #5](https://github.com/vinny380/elevator-policy-optimization/pull/5)
