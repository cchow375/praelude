import type { MeasureRange } from "./model";
import type { DomainResult } from "./result";
import { failure, success } from "./result";

export type TargetId = string | number;

export interface TargetRangeNode extends MeasureRange {
  id: TargetId;
  piece_id: number;
  parent_id: TargetId | null;
}

export type RangeRelationshipKind =
  | "equal"
  | "contains"
  | "contained_by"
  | "partial_overlap";

export interface TargetRangeRelationship {
  left_id: TargetId;
  right_id: TargetId;
  kind: RangeRelationshipKind;
}

export type TargetGraphIssueCode =
  | "duplicate_target_id"
  | "invalid_piece"
  | "invalid_range"
  | "missing_parent"
  | "cross_piece_parent"
  | "self_parent"
  | "parent_does_not_contain_target"
  | "parent_cycle";

export interface TargetGraphIssue {
  code: TargetGraphIssueCode;
  target_id: TargetId;
  message: string;
}

export interface TargetGraphAnalysis {
  valid: boolean;
  issues: TargetGraphIssue[];
  /** Overlap is disclosed as structure; it is not itself an error. */
  relationships: TargetRangeRelationship[];
}

export type ParentAssignmentError =
  | "target_not_found"
  | "parent_not_found"
  | "self_parent"
  | "cross_piece_parent"
  | "parent_does_not_contain_target"
  | "parent_cycle"
  | "invalid_graph";

function idKey(id: TargetId): string {
  return `${typeof id}:${String(id)}`;
}

function validRange(target: TargetRangeNode): boolean {
  return (
    Number.isSafeInteger(target.m_start) &&
    Number.isSafeInteger(target.m_end) &&
    target.m_start >= 1 &&
    target.m_end >= target.m_start
  );
}

function contains(parent: TargetRangeNode, child: TargetRangeNode): boolean {
  return parent.m_start <= child.m_start && child.m_end <= parent.m_end;
}

function relationship(
  left: TargetRangeNode,
  right: TargetRangeNode,
): RangeRelationshipKind | null {
  if (left.m_end < right.m_start || right.m_end < left.m_start) return null;
  if (left.m_start === right.m_start && left.m_end === right.m_end) return "equal";
  if (contains(left, right)) return "contains";
  if (contains(right, left)) return "contained_by";
  return "partial_overlap";
}

function cycleTargetKeys(
  targets: TargetRangeNode[],
  byId: Map<string, TargetRangeNode>,
): Set<string> {
  const cycles = new Set<string>();
  for (const origin of targets) {
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: TargetRangeNode | undefined = origin;
    while (current) {
      const key = idKey(current.id);
      const seenAt = positions.get(key);
      if (seenAt !== undefined) {
        for (const cycleKey of path.slice(seenAt)) cycles.add(cycleKey);
        break;
      }
      positions.set(key, path.length);
      path.push(key);
      current = current.parent_id === null ? undefined : byId.get(idKey(current.parent_id));
    }
  }
  return cycles;
}

export function analyzeTargetGraph(targets: TargetRangeNode[]): TargetGraphAnalysis {
  const issues: TargetGraphIssue[] = [];
  const relationships: TargetRangeRelationship[] = [];
  const byId = new Map<string, TargetRangeNode>();

  for (const target of targets) {
    const key = idKey(target.id);
    if (byId.has(key)) {
      issues.push({
        code: "duplicate_target_id",
        target_id: target.id,
        message: `Target ${String(target.id)} appears more than once.`,
      });
    } else {
      byId.set(key, target);
    }
    if (!Number.isSafeInteger(target.piece_id) || target.piece_id < 1) {
      issues.push({
        code: "invalid_piece",
        target_id: target.id,
        message: "A target needs a positive Piece identity.",
      });
    }
    if (!validRange(target)) {
      issues.push({
        code: "invalid_range",
        target_id: target.id,
        message: "A target range needs positive measures in start-to-end order.",
      });
    }
  }

  for (const target of targets) {
    if (target.parent_id === null) continue;
    if (idKey(target.parent_id) === idKey(target.id)) {
      issues.push({
        code: "self_parent",
        target_id: target.id,
        message: "A target cannot be its own parent.",
      });
      continue;
    }
    const parent = byId.get(idKey(target.parent_id));
    if (!parent) {
      issues.push({
        code: "missing_parent",
        target_id: target.id,
        message: `Parent target ${String(target.parent_id)} does not exist.`,
      });
      continue;
    }
    if (parent.piece_id !== target.piece_id) {
      issues.push({
        code: "cross_piece_parent",
        target_id: target.id,
        message: "A parent target must belong to the same Piece.",
      });
    } else if (validRange(parent) && validRange(target) && !contains(parent, target)) {
      issues.push({
        code: "parent_does_not_contain_target",
        target_id: target.id,
        message: "A nested target must remain inside its selected parent range.",
      });
    }
  }

  for (const cycleKey of cycleTargetKeys(targets, byId)) {
    const target = byId.get(cycleKey);
    if (target) {
      issues.push({
        code: "parent_cycle",
        target_id: target.id,
        message: "Target parentage cannot contain a cycle.",
      });
    }
  }

  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    const left = targets[leftIndex];
    if (!validRange(left)) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const right = targets[rightIndex];
      if (left.piece_id !== right.piece_id || !validRange(right)) continue;
      const kind = relationship(left, right);
      if (kind) relationships.push({ left_id: left.id, right_id: right.id, kind });
    }
  }

  return { valid: issues.length === 0, issues, relationships };
}

/**
 * Applies one proposed parent edge to a copied graph after same-Piece,
 * containment, and cycle checks. Partially overlapping peers remain valid.
 */
export function assignTargetParent(
  targets: TargetRangeNode[],
  targetId: TargetId,
  parentId: TargetId | null,
): DomainResult<TargetRangeNode[], ParentAssignmentError> {
  const baseline = analyzeTargetGraph(targets);
  if (baseline.issues.some((issue) => issue.code === "duplicate_target_id")) {
    return failure("invalid_graph", "Parent assignment requires unique target identities.");
  }
  const targetIndex = targets.findIndex((target) => idKey(target.id) === idKey(targetId));
  if (targetIndex < 0) {
    return failure("target_not_found", `Target ${String(targetId)} does not exist.`);
  }
  if (parentId === null) {
    return success(
      targets.map((target, index) =>
        index === targetIndex ? { ...target, parent_id: null } : { ...target },
      ),
    );
  }
  if (idKey(targetId) === idKey(parentId)) {
    return failure("self_parent", "A target cannot be its own parent.");
  }
  const parent = targets.find((target) => idKey(target.id) === idKey(parentId));
  if (!parent) {
    return failure("parent_not_found", `Parent target ${String(parentId)} does not exist.`);
  }
  const target = targets[targetIndex];
  if (target.piece_id !== parent.piece_id) {
    return failure("cross_piece_parent", "A parent target must belong to the same Piece.");
  }
  if (!validRange(target) || !validRange(parent) || !contains(parent, target)) {
    return failure(
      "parent_does_not_contain_target",
      "A nested target must remain inside its selected parent range.",
    );
  }

  const next = targets.map((item, index) =>
    index === targetIndex ? { ...item, parent_id: parent.id } : { ...item },
  );
  const nextById = new Map(next.map((item) => [idKey(item.id), item]));
  if (cycleTargetKeys(next, nextById).has(idKey(targetId))) {
    return failure("parent_cycle", "That parent assignment would create a cycle.");
  }
  return success(next);
}
