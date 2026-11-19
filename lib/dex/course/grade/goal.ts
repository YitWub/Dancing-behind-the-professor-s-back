import type { CourseGradeRecord } from '../grade-record.ts';
import { calculateTargetRequirement } from './simulation.ts';
import type { CourseGradeSimulation, GradeScenario } from './simulation.ts';

export function planCourseTarget(record: CourseGradeRecord, simulation: CourseGradeSimulation, target: number, scenario: GradeScenario = {}) {
  const requirement = calculateTargetRequirement(simulation, target);
  const remaining = record.assessments.filter(item =>
    item.weightPercent > 0 && (item.result.status === 'planned' || item.result.status === 'pending') && !Object.hasOwn(scenario, item.id));
  const only = remaining.length === 1 ? remaining[0] : undefined;
  const raw = requirement.status === 'possible' && only
    ? { name: only.name, pending: only.result.status === 'pending', needed: only.maxScore * (requirement.requiredRate / 100), maxScore: only.maxScore }
    : null;
  return { requirement, raw };
}
