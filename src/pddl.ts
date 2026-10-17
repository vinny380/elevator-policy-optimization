// A deliberately small, browser-native planner for grounded STRIPS + constant action costs.
// Unsupported PDDL is rejected rather than silently interpreted as a different problem.
type Expression = string | Expression[];
export interface PlanningAction { name: string; pre: string[]; add: string[]; del: string[]; cost: number }
export interface PlanningTask { actions: PlanningAction[]; initial: string[]; goals: string[] }
export interface Plan { status: 'solved' | 'limit' | 'unsolvable'; actions: string[]; cost: number; expanded: number }

function expressions(text: string): Expression[] {
  const tokens = text.replace(/;[^\n]*/g, '').toLowerCase().match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  function read(): Expression {
    const token = tokens[position++];
    if (token === undefined || token === ')') throw new Error('Malformed PDDL expression');
    if (token !== '(') return token;
    const result: Expression[] = [];
    while (tokens[position] !== ')') {
      if (position >= tokens.length) throw new Error('Unclosed PDDL expression');
      result.push(read());
    }
    position++; return result;
  }
  const root = read();
  if (!Array.isArray(root) || root[0] !== 'define' || position !== tokens.length) throw new Error('Expected one PDDL define form');
  return root;
}
function form(value: Expression | undefined): Expression[] {
  if (!Array.isArray(value)) throw new Error('Expected a PDDL list');
  return value;
}
function atom(value: Expression): string {
  const list = form(value);
  if (list.length !== 1 || typeof list[0] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(list[0])) throw new Error('Only grounded zero-argument predicates are supported');
  return list[0];
}
function conjunction(value: Expression): Expression[] {
  const list = form(value); return list[0] === 'and' ? list.slice(1) : [list];
}
export function parsePddl(domain: string, problem: string): PlanningTask {
  const d = expressions(domain), p = expressions(problem);
  const domainName = form(d[1]);
  if (domainName[0] !== 'domain' || form(p[1])[0] !== 'problem') throw new Error('Invalid domain or problem header');
  const sections = d.slice(2).map(form), problemSections = p.slice(2).map(form);
  if (sections.some(s => ![':requirements', ':predicates', ':functions', ':action'].includes(String(s[0]))) || problemSections.some(s => ![':domain', ':init', ':goal', ':metric'].includes(String(s[0])))) throw new Error('Unsupported PDDL section');
  const requirements = sections.find(s => s[0] === ':requirements');
  if (!requirements || requirements.slice(1).some(r => r !== ':strips' && r !== ':action-costs')) throw new Error('Only STRIPS and action-costs are supported');
  const declarations = sections.find(s => s[0] === ':predicates');
  if (!declarations) throw new Error('Missing predicates');
  const predicates = new Set(declarations.slice(1).map(atom));
  if (predicates.size !== declarations.length - 1) throw new Error('Duplicate predicate declaration');
  const functions = sections.find(s => s[0] === ':functions');
  if (JSON.stringify(functions) !== JSON.stringify([':functions', ['total-cost']])) throw new Error('Only total-cost is supported');
  if (problemSections.find(s => s[0] === ':domain')?.[1] !== domainName[1]) throw new Error('Problem uses a different domain');
  const metric = problemSections.find(s => s[0] === ':metric');
  if (JSON.stringify(metric) !== JSON.stringify([':metric', 'minimize', ['total-cost']])) throw new Error('Expected minimize total-cost metric');
  const checkedAtom = (v: Expression) => { const name = atom(v); if (!predicates.has(name)) throw new Error(`Undeclared predicate: ${name}`); return name; };
  const actions = sections.filter(s => s[0] === ':action').map(s => {
    if (s.length !== 8 || s[2] !== ':parameters' || form(s[3]).length || s[4] !== ':precondition' || s[6] !== ':effect' || typeof s[1] !== 'string') throw new Error('Expected a grounded STRIPS action');
    const result: PlanningAction = { name: s[1], pre: conjunction(s[5]).map(checkedAtom), add: [], del: [], cost: 0 };
    let costFound = false;
    for (const effect of conjunction(s[7])) {
      const e = form(effect);
      if (e[0] === 'not') { if (e.length !== 2) throw new Error('Malformed delete effect'); result.del.push(checkedAtom(e[1])); }
      else if (e[0] === 'increase') {
        if (costFound || e.length !== 3 || JSON.stringify(e[1]) !== '["total-cost"]' || typeof e[2] !== 'string') throw new Error('Unsupported numeric effect');
        const cost = Number(e[2]); if (!Number.isFinite(cost) || cost < 0) throw new Error('Action cost must be nonnegative');
        result.cost = cost; costFound = true;
      } else result.add.push(checkedAtom(e));
    }
    if (!costFound) throw new Error('Action is missing its cost');
    return result;
  });
  if (new Set(actions.map(a => a.name)).size !== actions.length) throw new Error('Duplicate action name');
  const init = problemSections.find(s => s[0] === ':init');
  const goal = problemSections.find(s => s[0] === ':goal');
  if (!init || !goal) throw new Error('Missing init or goal');
  let initialized = false;
  const initial: string[] = [];
  for (const value of init.slice(1)) {
    const e = form(value);
    if (e[0] === '=') { if (initialized || JSON.stringify(e) !== '["=",["total-cost"],"0"]') throw new Error('Expected initial total-cost of zero'); initialized = true; }
    else initial.push(checkedAtom(e));
  }
  if (!initialized) throw new Error('Missing initial total-cost');
  return { actions, initial, goals: conjunction(goal[1]).map(checkedAtom) };
}

export function validatePlan(task: PlanningTask, names: string[]) {
  const state = new Set(task.initial); let cost = 0;
  for (const name of names) {
    const action = task.actions.find(a => a.name === name);
    if (!action || !action.pre.every(p => state.has(p))) throw new Error(`Invalid plan action: ${name}`);
    action.del.forEach(p => state.delete(p)); action.add.forEach(p => state.add(p)); cost += action.cost;
  }
  if (!task.goals.every(p => state.has(p))) throw new Error('Plan does not reach its goal');
  return cost;
}

export function solvePddl(domain: string, problem: string, expansionLimit = 1500): Plan {
  const task = parsePddl(domain, problem);
  const predicates = [...new Set([...task.initial, ...task.goals, ...task.actions.flatMap(a => [...a.pre, ...a.add, ...a.del])])];
  if (predicates.length > 30) throw new Error('This bounded planner supports at most 30 predicates');
  const bits = new Map(predicates.map((p, i) => [p, 1 << i]));
  const mask = (names: string[]) => names.reduce((n, p) => n | bits.get(p)!, 0);
  const actions = task.actions.map(a => ({ ...a, preMask: mask(a.pre), addMask: mask(a.add), delMask: mask(a.del) }));
  const goals = mask(task.goals), initial = mask(task.initial);
  const frontier = [{ state: initial, cost: 0, path: [] as string[] }];
  const best = new Map([[initial, 0]]); let expanded = 0;
  while (frontier.length) {
    // The generated six-stop problems have at most hundreds of reachable states.
    frontier.sort((a, b) => b.cost - a.cost);
    const node = frontier.pop()!;
    if (node.cost !== best.get(node.state)) continue;
    if ((node.state & goals) === goals) {
      validatePlan(task, node.path);
      return { status: 'solved', actions: node.path, cost: node.cost, expanded };
    }
    if (expanded++ >= expansionLimit) return { status: 'limit', actions: [], cost: 0, expanded };
    for (const action of actions) {
      if ((node.state & action.preMask) !== action.preMask) continue;
      const state = (node.state & ~action.delMask) | action.addMask, cost = node.cost + action.cost;
      if (cost >= (best.get(state) ?? Infinity)) continue;
      best.set(state, cost); frontier.push({ state, cost, path: [...node.path, action.name] });
    }
  }
  return { status: 'unsolvable', actions: [], cost: 0, expanded };
}

export interface Stop { floor: number; direction: number; age: number; inside: boolean }
export interface PlanningSnapshot extends Plan { domain: string; problem: string; stops: Stop[]; firstStop: Stop | null; car: number; time: number; candidateCount: number }
const token = (floor: number) => floor < 0 ? `p${-floor}` : floor === 0 ? 'g' : `f${floor}`;
export function planStops(position: number, candidates: Stop[], speed: number, doors: number, car: number, time: number): PlanningSnapshot {
  // Receding horizon: prioritize onboard destinations, then old hall calls; apply only the first stop.
  // Capacity and newly revealed destinations are checked again by the simulator before replanning.
  const unique = new Map<number, Stop>();
  for (const stop of [...candidates].sort((a, b) => Number(b.inside) - Number(a.inside) || b.age - a.age)) if (!unique.has(stop.floor)) unique.set(stop.floor, stop);
  const stops = [...unique.values()].slice(0, 6);
  const floors = [...new Set([position, ...stops.map(s => s.floor)])];
  const predicates = [...floors.map(f => `at-${token(f)}`), ...stops.flatMap(s => [`pending-${token(s.floor)}`, `served-${token(s.floor)}`])];
  const stopForAction = new Map<string, Stop>();
  const actions = floors.flatMap(from => stops.map(stop => {
    const a = token(from), b = token(stop.floor), name = `serve-${b}-from-${a}`;
    stopForAction.set(name, stop);
    const duration = Math.max(1, Math.ceil(Math.abs(stop.floor - from) / speed)) + doors;
    return `  (:action ${name}\n    :parameters ()\n    :precondition (and (at-${a}) (pending-${b}))\n    :effect (and ${from === stop.floor ? '' : `(not (at-${a})) `}(at-${b}) (not (pending-${b})) (served-${b}) (increase (total-cost) ${duration})))`;
  }));
  const domain = `; Grounded stop-order model, car ${car + 1}, simulation second ${time}.\n; Constant costs are travel ticks plus door dwell. Only the first stop is executed.\n; This is classical action-cost PDDL, not a temporal passenger/capacity model.\n(define (domain elevator-stops)\n  (:requirements :strips :action-costs)\n  (:predicates ${predicates.map(p => `(${p})`).join(' ')})\n  (:functions (total-cost))\n${actions.join('\n')}\n)`;
  const problem = `(define (problem elevator-snapshot)\n  (:domain elevator-stops)\n  (:init (at-${token(position)}) ${stops.map(s => `(pending-${token(s.floor)})`).join(' ')} (= (total-cost) 0))\n  (:goal (and ${stops.map(s => `(served-${token(s.floor)})`).join(' ')}))\n  (:metric minimize (total-cost))\n)`;
  const plan = solvePddl(domain, problem);
  return { ...plan, domain, problem, stops, firstStop: plan.actions.length ? stopForAction.get(plan.actions[0])! : null, car, time, candidateCount: unique.size };
}
